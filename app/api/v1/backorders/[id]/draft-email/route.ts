import { fail, logApiError, ok } from "@/lib/api/response";
import { getBackorderById } from "@/lib/backorders/service";
import { draftBackorderEmail, type BackorderDraftEmail } from "@/lib/backorders/email-draft";
import { prisma } from "@/lib/prisma";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { assertAgentEnabled } from "@/lib/agents/controls";
import { ApiRequestError } from "@/lib/api/request";

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let runId: string | null = null;
  let taskId: string | null = null;

  try {
    const authorization = await authorizeOrganizationRequest(req);
    if (!authorization.ok) return authorization.response;
    await assertAgentEnabled(authorization.context.organizationId, "backorder_follow_up");
    const backorder = await getBackorderById(decodeURIComponent(id), authorization.context.organizationId);
    if (!backorder) {
      return fail("BACKORDER_NOT_FOUND", "Backorder context was not found.", 404);
    }

    const run = await prisma.agentRun.create({
      data: {
        organizationId: authorization.context.organizationId,
        agent: "backorder_follow_up",
        domain: "procurement",
        trigger: "module",
        commandText: `Draft supplier follow-up for ${backorder.poNumber}`,
        status: "Running",
      },
    });
    runId = run.id;

    const task = await prisma.agentTask.create({
      data: {
        runId,
        agent: "backorder_follow_up",
        action: "draft_supplier_email",
        input: {
          backorderId: backorder.id,
          poNumber: backorder.poNumber,
          supplier: backorder.vendor,
          itemCount: backorder.items.length,
          totalDelayDays: backorder.totalDelayDays,
        },
        status: "Running",
      },
    });
    taskId = task.id;

    const draft: BackorderDraftEmail = await draftBackorderEmail(backorder, { organizationId: authorization.context.organizationId, signal: req.signal });

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - task.startedAt.getTime();
    await prisma.agentTask.update({
      where: { id: taskId },
      data: {
        output: draft as unknown as object,
        confidence: null,
        model: draft.model,
        provider: draft.provider,
        status: "Completed",
        completedAt,
        durationMs,
      },
    });

    await prisma.agentRun.update({
      where: { id: runId },
      data: {
        status: "Completed",
        completedAt,
        durationMs: completedAt.getTime() - run.startedAt.getTime(),
      },
    });

    await prisma.auditLog.create({
      data: {
        runId,
        agent: "backorder_follow_up",
        action: "draft_supplier_email",
        target: backorder.poNumber,
        input: { backorderId: backorder.id, poNumber: backorder.poNumber },
        output: { subject: draft.subject, fallbackUsed: draft.fallbackUsed, confidence: draft.confidence },
        model: draft.model,
        provider: draft.provider,
        durationMs,
        committed: false,
      },
    });

    await prisma.purchaseOrderEvent.create({
      data: {
        orderId: backorder.poId,
        type: "email_draft_created",
        summary: `Supplier follow-up draft created for ${backorder.vendor}`,
        detail: JSON.stringify({ subject: draft.subject, agentRunId: runId, fallbackUsed: draft.fallbackUsed }),
        actor: "agent",
      },
    });

    return ok(draft, {
      source: draft.fallbackUsed ? "deterministic_fallback" : "ai_provider",
      status: "draft_ready",
      runId,
      taskId,
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    if (taskId) {
      await prisma.agentTask.update({
        where: { id: taskId },
        data: {
          status: "Failed",
          error: error instanceof Error ? error.message : "Draft failed",
          completedAt: new Date(),
        },
      }).catch(() => null);
    }
    if (runId) {
      await prisma.agentRun.update({
        where: { id: runId },
        data: { status: "Failed", completedAt: new Date() },
      }).catch(() => null);
    }
    logApiError("POST /api/v1/backorders/[id]/draft-email", error);
    return fail("BACKORDER_EMAIL_DRAFT_FAILED", "Failed to draft supplier follow-up email.", 500);
  }
}
