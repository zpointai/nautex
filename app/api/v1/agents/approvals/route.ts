import { fail, logApiError, ok } from "@/lib/api/response";
import { executeIdempotentRequest } from "@/lib/api/idempotency";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/v1/agents/approvals
 *
 * Returns pending and recent approval requests.
 * Query params: ?status=Pending&limit=20
 */
export async function GET(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!authorization.ok) return authorization.response;
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 100);
    const status = url.searchParams.get("status");

    const where: Record<string, unknown> = { task: { run: { organizationId: authorization.context.organizationId } } };
    if (status) where.status = status;

    const approvals = await prisma.approval.findMany({
      where,
      include: {
        task: {
          select: { action: true, runId: true, agent: true },
        },
      },
      orderBy: { requestedAt: "desc" },
      take: limit,
    });

    return ok(approvals, { source: "prisma", status: "real" });
  } catch (error) {
    logApiError("GET /api/v1/agents/approvals", error);
    return fail("AGENT_APPROVALS_LIST_FAILED", "Failed to fetch approvals.");
  }
}

/**
 * PATCH /api/v1/agents/approvals
 *
 * Resolve an approval request (approve or reject).
 * Body: { id, action: "approve" | "reject" }
 */
export async function PATCH(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.AGENTS_APPROVE);
    if (!authorization.ok) return authorization.response;

    return await executeIdempotentRequest({
      request: req,
      organizationId: authorization.context.organizationId,
      route: "PATCH /api/v1/agents/approvals",
      handler: async () => {
    const body = await readJsonObject(req);
    const id = typeof body.id === "string" ? body.id : "";
    const action = typeof body.action === "string" ? body.action : "";

    if (!id || !["approve", "reject"].includes(action)) {
      return fail("AGENT_APPROVAL_INVALID_ACTION", "Valid id and action (approve/reject) are required.", 400);
    }

    const now = new Date();
    const actor = authorization.context.displayName;
    const approval = await prisma.$transaction(async (tx) => {
      const current = await tx.approval.findFirst({
        where: { id, task: { run: { organizationId: authorization.context.organizationId } } },
        include: {
          task: {
            select: { id: true, runId: true, agent: true, action: true, status: true },
          },
        },
      });

      if (!current) {
        throw new Error("APPROVAL_NOT_FOUND");
      }
      const intendedStatus = action === "approve" ? "Approved" : "Rejected";
      if (current.status === intendedStatus) return current;
      if (current.status !== "Pending") throw new Error("APPROVAL_ALREADY_RESOLVED");

      const updated = await tx.approval.update({
        where: { id },
        data: {
          status: action === "approve" ? "Approved" : "Rejected",
          resolvedBy: actor,
          resolvedAt: now,
        },
      });

      await tx.agentTask.update({
        where: { id: current.taskId },
        data: {
          status: action === "approve" ? "Completed" : "Failed",
          completedAt: now,
        },
      });

      const pendingApprovals = await tx.approval.count({
        where: {
          task: { runId: current.task.runId },
          status: "Pending",
        },
      });

      if (pendingApprovals === 0) {
        await tx.agentRun.update({
          where: { id: current.task.runId },
          data: {
            status: action === "approve" ? "Completed" : "Failed",
            completedAt: now,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          runId: current.task.runId,
          agent: current.agent,
          action: `approval_${action}`,
          target: id,
          input: {
            approvalId: id,
            taskId: current.taskId,
            taskAction: current.task.action,
            previousStatus: current.status,
          },
          output: {
            status: updated.status,
            resolvedBy: actor,
            resolvedAt: now.toISOString(),
          },
          committed: false,
        },
      });

      return updated;
    });

    return ok(approval, { source: "prisma", status: "real" });
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    logApiError("PATCH /api/v1/agents/approvals", error);
    if (error instanceof Error && error.message === "APPROVAL_NOT_FOUND") {
      return fail("AGENT_APPROVAL_NOT_FOUND", "Approval request not found.", 404);
    }
    if (error instanceof Error && error.message === "APPROVAL_ALREADY_RESOLVED") {
      return fail("AGENT_APPROVAL_ALREADY_RESOLVED", "Approval request has already been resolved with a different decision.", 409);
    }
    return fail("AGENT_APPROVAL_UPDATE_FAILED", "Failed to update approval.");
  }
}
