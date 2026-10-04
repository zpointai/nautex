/**
 * Agreement Comparison API
 *
 * POST /api/v1/agreements/:id/compare  — upload file and start comparison
 * GET  /api/v1/agreements/:id/compare  — get comparison status/results
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseAgreementFile, runComparison } from "@/lib/agreements";
import { authorizeAgreementRequest } from "@/lib/auth/entity-access";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { assertAgentEnabled } from "@/lib/agents/controls";
import { ApiRequestError } from "@/lib/api/request";
import { startRun, startTask, completeRun, failTask } from "@/lib/ai/engine/workflow";

type Ctx = { params: Promise<{ id: string }> };

/* ── POST — Upload file and run comparison ─────────────────────── */

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id: versionId } = await ctx.params;
  const authorization = await authorizeAgreementRequest(req, versionId, PERMISSIONS.AGREEMENTS_WRITE);
  if (!authorization.ok) return authorization.response;
  try { await assertAgentEnabled(authorization.context.organizationId, "agreement_comparison"); }
  catch (error) { if (error instanceof ApiRequestError) return NextResponse.json({ error: error.message }, { status: error.status }); throw error; }
  if (!authorization.agreement) return NextResponse.json({ error: "Agreement version not found" }, { status: 404 });

  // Verify version exists
  const version = await prisma.agreementVersion.findFirst({
    where: { id: versionId, organizationId: authorization.context.organizationId },
    select: { id: true, supplierName: true, _count: { select: { items: true } } },
  });
  if (!version) {
    return NextResponse.json({ error: "Agreement version not found" }, { status: 404 });
  }

  // Parse multipart form data
  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  const fileName = file.name;
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  if (!["csv", "xlsx", "xls"].includes(ext)) {
    return NextResponse.json({ error: "Unsupported file type. Use CSV, XLSX, or XLS." }, { status: 400 });
  }

  // Read file buffer
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Parse file
  let parsed;
  try {
    parsed = await parseAgreementFile(buffer, ext);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "File parsing failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  if (parsed.rows.length === 0) {
    return NextResponse.json({ error: "No data rows found in file" }, { status: 400 });
  }

  // Create comparison job
  const comparison = await prisma.agreementComparison.create({
    data: {
      versionId,
      status: "Queued",
      sourceFileName: fileName,
      sourceFileType: ext,
      sourceRowCount: parsed.rawCount,
    },
  });

  const run = await startRun({ organizationId: authorization.context.organizationId, agent: "agreement_comparison", domain: "agreements", trigger: "module", commandText: `Compare ${version.supplierName} agreement` });
  const task = await startTask({ runId: run.id, agent: "agreement_comparison", action: "compare_agreement", input: { versionId, comparisonId: comparison.id } });
  try {
    await runComparison(comparison.id, versionId, parsed.rows);
    await prisma.agentTask.update({ where: { id: task.id }, data: { status: "Completed", completedAt: new Date(), provider: "nautex", model: "agreement-comparison-rules", confidence: null, output: { comparisonId: comparison.id, humanReviewRequired: true } } });
    await completeRun(run.id, "Completed");
  } catch (error) {
    await failTask(task.id, error instanceof Error ? error.message : "Comparison failed.");
    await completeRun(run.id, "Failed");
    return NextResponse.json({ error: "Agreement comparison failed. Review the run in Agent Monitor." }, { status: 500 });
  }

  return NextResponse.json({
    comparison: {
      id: comparison.id,
      status: "ComparisonCompleted",
      sourceFileName: fileName,
      sourceRowCount: parsed.rawCount,
      mappedColumns: parsed.mappedColumns,
      baselineItemCount: version._count.items,
    },
  }, { status: 202 });
}

/* ── GET — Get latest comparison status/results ────────────────── */

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id: versionId } = await ctx.params;
  const authorization = await authorizeAgreementRequest(req, versionId, PERMISSIONS.APP_READ);
  if (!authorization.ok) return authorization.response;
  if (!authorization.agreement) return NextResponse.json({ error: "Agreement version not found" }, { status: 404 });
  const comparisonId = req.nextUrl.searchParams.get("comparisonId");

  const where = comparisonId
    ? { id: comparisonId, versionId }
    : { versionId };

  const comparison = await prisma.agreementComparison.findFirst({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      changes: {
        orderBy: [{ changeType: "asc" }, { matchKey: "asc" }],
      },
    },
  });

  if (!comparison) {
    return NextResponse.json({ error: "No comparison found" }, { status: 404 });
  }

  return NextResponse.json({
    comparison: {
      ...comparison,
      status: comparison.status === "ComparisonCompleted" ? "Completed"
        : comparison.status === "ComparisonFailed" ? "Failed"
        : comparison.status,
      changes: comparison.changes.map((c) => ({
        ...c,
        changeType: c.changeType === "PriceChange" ? "PriceChange"
          : c.changeType === "FieldChange" ? "FieldChange"
          : c.changeType,
        reviewStatus: c.reviewStatus === "RejectedReview" ? "Rejected"
          : c.reviewStatus === "AutoApplied" ? "AutoApplied"
          : c.reviewStatus,
      })),
    },
  });
}

/* ── DELETE — Remove comparison history entry ───────────────────── */

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id: versionId } = await ctx.params;
  const authorization = await authorizeAgreementRequest(req, versionId, PERMISSIONS.AGREEMENTS_WRITE);
  if (!authorization.ok) return authorization.response;
  if (!authorization.agreement) return NextResponse.json({ error: "Agreement version not found" }, { status: 404 });
  const comparisonId = req.nextUrl.searchParams.get("comparisonId");

  if (!comparisonId) {
    return NextResponse.json({ error: "comparisonId is required" }, { status: 400 });
  }

  const comparison = await prisma.agreementComparison.findFirst({
    where: { id: comparisonId, versionId },
    select: { id: true },
  });

  if (!comparison) {
    return NextResponse.json({ error: "Comparison not found" }, { status: 404 });
  }

  await prisma.agreementComparison.delete({ where: { id: comparisonId } });
  return NextResponse.json({ success: true });
}
