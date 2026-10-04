import { fail, logApiError, ok } from "@/lib/api/response";
import { listBackorders } from "@/lib/backorders/service";
import { prisma } from "@/lib/prisma";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { assertAgentEnabled } from "@/lib/agents/controls";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";

type MonitorScope = "active" | "critical" | "escalated";

function inScope(scope: MonitorScope, status: string, priority: string) {
  const active = status === "open" || status === "escalated";
  if (scope === "critical") return priority === "critical" && active;
  if (scope === "escalated") return status === "escalated";
  return active;
}

function severityFor(priority: string, delayDays: number): "Critical" | "Warning" {
  if (priority === "critical" || delayDays >= 20) return "Critical";
  return "Warning";
}

export async function POST(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req);
    if (!authorization.ok) return authorization.response;
    await assertAgentEnabled(authorization.context.organizationId, "backorder_reply_monitor");
    const body = await readJsonObject(req, 2048);
    const scope = (["active", "critical", "escalated"].includes(String(body.scope)) ? body.scope : "active") as MonitorScope;
    const minDelayDays = Math.max(Number(body.minDelayDays) || 1, 0);

    const candidates = (await listBackorders(authorization.context.organizationId))
      .filter((backorder) => inScope(scope, backorder.status, backorder.priority))
      .filter((backorder) => backorder.totalDelayDays >= minDelayDays);

    const existing = await prisma.agentException.findMany({
      where: {
        organizationId: authorization.context.organizationId,
        agent: "backorder_reply_monitor",
        domain: "procurement",
        status: { in: ["Open", "Reviewing"] },
      },
      select: { title: true },
    });
    const existingTitles = new Set(existing.map((row) => row.title));

    const run = await prisma.agentRun.create({
      data: {
        organizationId: authorization.context.organizationId,
        agent: "backorder_reply_monitor",
        domain: "procurement",
        trigger: "module",
        commandText: `Monitor supplier replies for ${scope} backorders`,
        status: "Running",
      },
    });

    const task = await prisma.agentTask.create({
      data: {
        runId: run.id,
        agent: "backorder_reply_monitor",
        action: "create_reply_followup_exceptions",
        input: { scope, minDelayDays, candidateCount: candidates.length },
        status: "Running",
      },
    });

    const created = [];
    const skipped = [];
    for (const backorder of candidates) {
      const title = `Supplier reply due: ${backorder.poNumber}`;
      if (existingTitles.has(title)) {
        skipped.push(backorder.poNumber);
        continue;
      }

      await prisma.agentException.create({
        data: {
          organizationId: authorization.context.organizationId,
          taskId: task.id,
          agent: "backorder_reply_monitor",
          domain: "procurement",
          severity: severityFor(backorder.priority, backorder.totalDelayDays),
          title,
          description: `${backorder.vendor} has ${backorder.items.length} backordered line(s) on ${backorder.poNumber}. Current delay signal is ${backorder.totalDelayDays} day(s). Confirm supplier reply, revised dispatch date, partial shipment options, and substitutes if needed.`,
          suggestedAction: `Open ${backorder.poNumber}, draft supplier follow-up, and request written availability confirmation within 24 hours.`,
        },
      });

      await prisma.purchaseOrderEvent.create({
        data: {
          orderId: backorder.poId,
          type: "exception_flagged",
          summary: "Supplier reply monitor exception created",
          detail: JSON.stringify({ agentRunId: run.id, delayDays: backorder.totalDelayDays, supplier: backorder.vendor }),
          actor: "agent",
        },
      });

      created.push(backorder.poNumber);
      existingTitles.add(title);
    }

    const completedAt = new Date();
    await prisma.agentTask.update({
      where: { id: task.id },
      data: {
        output: { created, skipped, scope, minDelayDays },
        confidence: null,
        provider: "nautex",
        model: "backorder-status-rules",
        status: "Completed",
        completedAt,
        durationMs: completedAt.getTime() - task.startedAt.getTime(),
      },
    });

    await prisma.agentRun.update({
      where: { id: run.id },
      data: { status: "Completed", completedAt, durationMs: completedAt.getTime() - run.startedAt.getTime() },
    });

    await prisma.auditLog.create({
      data: {
        runId: run.id,
        agent: "backorder_reply_monitor",
        action: "create_reply_followup_exceptions",
        input: { scope, minDelayDays },
        output: { created, skipped },
        committed: created.length > 0,
      },
    });

    return ok({ created, skipped }, { source: "backorder_cases_with_derived_fallback", status: "monitor_complete", runId: run.id });
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    logApiError("POST /api/v1/backorders/reply-monitor", error);
    return fail("BACKORDER_REPLY_MONITOR_FAILED", "Failed to run backorder reply monitor.", 500);
  }
}
