import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateOrder } from "@/lib/ai/services/order-validation";
import { completeRun, failTask, startRun, startTask } from "@/lib/ai/engine/workflow";
import { logAudit } from "@/lib/ai/engine/audit";
import { authorizePurchaseOrderRequest } from "@/lib/auth/entity-access";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ApiRequestError } from "@/lib/api/request";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let taskId: string | null = null;
  let runId: string | null = null;

  try {
    const authorization = await authorizePurchaseOrderRequest(req, id, PERMISSIONS.PROCUREMENT_APPROVE);
    if (!authorization.ok) return authorization.response;
    if (!authorization.order) return NextResponse.json({ ok: false, error: { code: "PURCHASE_ORDER_NOT_FOUND", message: "Purchase order not found." } }, { status: 404 });
    const po = await prisma.purchaseOrder.findFirst({
      where: { id, organizationId: authorization.context.organizationId },
      include: {
        lines: { orderBy: { lineNumber: "asc" } },
        childOrders: { select: { id: true, poNumber: true, supplier: true, total: true, status: true } },
      },
    });

    if (!po) {
      return NextResponse.json(
        { ok: false, error: { code: "PURCHASE_ORDER_NOT_FOUND", message: "Purchase order not found." } },
        { status: 404 },
      );
    }

    const run = await startRun({
      organizationId: authorization.context.organizationId,
      agent: "order_validation",
      domain: "purchase_orders",
      trigger: "module",
      commandText: `Review purchase order ${po.poNumber}`,
    });
    runId = run.id;

    const task = await startTask({
      runId: run.id,
      agent: "order_validation",
      action: "validate_purchase_order",
      input: {
        purchaseOrderId: po.id,
        poNumber: po.poNumber,
        vessel: po.vessel,
        supplier: po.supplier,
        total: po.total,
        currency: po.currency,
        marginPct: po.marginPct,
        lineCount: po.lines.length,
        childOrderCount: po.childOrders.length,
      },
    });
    taskId = task.id;

    const result = await validateOrder({
      id: po.poNumber,
      vessel: po.vessel,
      supplier: po.supplier,
      total: po.total,
      currency: po.currency,
      marginPct: po.marginPct,
      items: po.lines.slice(0, 25).map((line) => `${line.lineNumber}. ${line.description} (${line.qtyOrdered} ${line.uom})`),
    }, { organizationId: authorization.context.organizationId });

    if (!result.ok || !result.data) {
      await failTask(task.id, result.reason === "not_configured" ? "AI provider is not configured." : "AI order validation failed.");
      await completeRun(run.id, "Failed");
      return NextResponse.json(
        { ok: false, error: { code: "ORDER_AGENT_REVIEW_FAILED", message: "Purchase order agent review could not be completed." } },
        { status: result.reason === "not_configured" ? 503 : 502 },
      );
    }

    const output = {
        purchaseOrderId: po.id,
        poNumber: po.poNumber,
        risk: result.data.risk,
        findings: result.data.findings,
        recommendation: result.data.recommendation,
        humanSupervised: true,
      };
    const durationMs = Date.now() - task.startedAt.getTime();
    // This endpoint requests human review. Risk labels are not measured confidence.
    await prisma.$transaction([
      prisma.agentTask.update({ where: { id: task.id }, data: {
        output, confidence: null, model: result.model, provider: result.provider,
        status: "AwaitingApproval", completedAt: new Date(), durationMs,
      } }),
      prisma.approval.create({ data: {
        taskId: task.id, agent: "order_validation", domain: "purchase_orders",
        description: `Review purchase order ${po.poNumber} before approval`,
        impact: result.data.risk === "High" ? "high" : "medium", data: output,
      } }),
    ]);
    await logAudit({ runId: run.id, agent: "order_validation", action: "validate_purchase_order",
      output: { risk: result.data.risk, humanReviewRequired: true, status: "AwaitingApproval" },
      model: result.model, provider: result.provider, durationMs, committed: false });

    const exceptionCreated = result.data.risk === "High";
    if (exceptionCreated) {
      await prisma.agentException.create({
        data: {
          organizationId: authorization.context.organizationId,
          taskId: task.id,
          agent: "order_validation",
          domain: "purchase_orders",
          severity: "Warning",
          title: `High-risk purchase order: ${po.poNumber}`,
          description: result.data.findings.join("\n") || "Agent review marked this purchase order as high risk.",
          suggestedAction: result.data.recommendation,
        },
      });
    }

    await prisma.purchaseOrderEvent.create({
      data: {
        orderId: po.id,
        type: result.data.risk === "High" ? "exception_flagged" : "agent_review",
        summary: `Agent review completed: ${result.data.risk} risk`,
        detail: JSON.stringify({
          runId: run.id,
          taskId: task.id,
          findings: result.data.findings,
          recommendation: result.data.recommendation,
          humanSupervised: true,
        }),
        actor: "agent",
      },
    });

    await completeRun(run.id, "AwaitingApproval");

    return NextResponse.json({
      ok: true,
      data: {
        runId: run.id,
        risk: result.data.risk,
        findings: result.data.findings,
        recommendation: result.data.recommendation,
        humanReviewRequired: true,
        exceptionCreated,
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return NextResponse.json({ ok: false, error: { code: error.code, message: error.message } }, { status: error.status });
    if (taskId) await failTask(taskId, error instanceof Error ? error.message : "Purchase order agent review failed.");
    if (runId) await completeRun(runId, "Failed");
    return NextResponse.json(
      { ok: false, error: { code: "ORDER_AGENT_REVIEW_FAILED", message: "Purchase order agent review failed." } },
      { status: 500 },
    );
  }
}
