import { fail, logApiError, ok } from "@/lib/api/response";
import { listBackorders } from "@/lib/backorders/service";
import { draftBackorderEmail } from "@/lib/backorders/email-draft";
import { prisma } from "@/lib/prisma";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { assertAgentEnabled } from "@/lib/agents/controls";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";

type DraftScope = "active" | "critical" | "escalated";

function inScope(scope: DraftScope, status: string, priority: string) {
  const active = status === "open" || status === "escalated";
  if (scope === "critical") return priority === "critical" && active;
  if (scope === "escalated") return status === "escalated";
  return active;
}

export async function POST(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req);
    if (!authorization.ok) return authorization.response;
    await assertAgentEnabled(authorization.context.organizationId, "backorder_follow_up");
    const body = await readJsonObject(req, 2048);
    const scope = (["active", "critical", "escalated"].includes(String(body.scope)) ? body.scope : "active") as DraftScope;
    const maxDrafts = Math.min(Math.max(Number(body.limit) || 5, 1), 10);
    const useAI = body.useAI !== false;

    const backorders = (await listBackorders(authorization.context.organizationId))
      .filter((backorder) => inScope(scope, backorder.status, backorder.priority))
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority === "critical" ? -1 : b.priority === "critical" ? 1 : 0;
        return b.totalDelayDays - a.totalDelayDays;
      })
      .slice(0, maxDrafts);

    const run = await prisma.agentRun.create({
      data: {
        organizationId: authorization.context.organizationId,
        agent: "backorder_follow_up",
        domain: "procurement",
        trigger: "module",
        commandText: `Bulk draft supplier follow-ups for ${scope} backorders`,
        status: "Running",
      },
    });

    const drafts = [];
    for (const backorder of backorders) {
      const task = await prisma.agentTask.create({
        data: {
          runId: run.id,
          agent: "backorder_follow_up",
          action: "bulk_draft_supplier_email",
          input: {
            backorderId: backorder.id,
            poNumber: backorder.poNumber,
            supplier: backorder.vendor,
            scope,
          },
          status: "Running",
        },
      });

      const draft = await draftBackorderEmail(backorder, { useAI, organizationId: authorization.context.organizationId, signal: req.signal });
      const completedAt = new Date();
      const durationMs = completedAt.getTime() - task.startedAt.getTime();

      await prisma.agentTask.update({
        where: { id: task.id },
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

      await prisma.purchaseOrderEvent.create({
        data: {
          orderId: backorder.poId,
          type: "email_draft_created",
          summary: `Bulk supplier follow-up draft created for ${backorder.vendor}`,
          detail: JSON.stringify({ subject: draft.subject, agentRunId: run.id, fallbackUsed: draft.fallbackUsed, scope }),
          actor: "agent",
        },
      });

      drafts.push({
        backorderId: backorder.id,
        poId: backorder.poId,
        poNumber: backorder.poNumber,
        vendor: backorder.vendor,
        priority: backorder.priority,
        delayDays: backorder.totalDelayDays,
        draft,
      });
    }

    const completedAt = new Date();
    await prisma.agentRun.update({
      where: { id: run.id },
      data: { status: "Completed", completedAt, durationMs: completedAt.getTime() - run.startedAt.getTime() },
    });

    await prisma.auditLog.create({
      data: {
        runId: run.id,
        agent: "backorder_follow_up",
        action: "bulk_draft_supplier_email",
        input: { scope, maxDrafts, useAI },
        output: { draftCount: drafts.length, poNumbers: drafts.map((draft) => draft.poNumber) },
        committed: false,
      },
    });

    return ok({ drafts }, { source: useAI ? "ai_or_fallback" : "deterministic_fallback", status: "drafts_ready", runId: run.id });
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    logApiError("POST /api/v1/backorders/draft-emails", error);
    return fail("BACKORDER_BULK_EMAIL_DRAFT_FAILED", "Failed to bulk draft supplier follow-up emails.", 500);
  }
}
