/**
 * POST /api/v1/suppliers/match — Run the supplier matching pipeline
 * GET  /api/v1/suppliers/match — List recent match runs
 */

import { NextResponse } from "next/server";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { runMatchPipeline } from "@/lib/matching";
import { PrismaClient } from "@prisma/client";
import type { MatchQuery } from "@/lib/matching";
import { assertAgentEnabled } from "@/lib/agents/controls";
import { ApiRequestError } from "@/lib/api/request";
import { startRun, startTask, completeRun, failTask } from "@/lib/ai/engine/workflow";

const prisma = new PrismaClient();

/* ── POST: Start a new match ─────────────────────────────────── */

export async function POST(req: Request) {
  let agentRunId: string | null = null;
  let agentTaskId: string | null = null;
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.SUPPLIERS_WRITE);
    if (!authorization.ok) return authorization.response;
    await assertAgentEnabled(authorization.context.organizationId, "supplier_discovery");
    const body = await req.json();

    const query: MatchQuery = {
      organizationId: authorization.context.organizationId,
      name: body.name?.trim() || undefined,
      country: body.country?.trim() || undefined,
      region: body.region?.trim() || undefined,
      category: body.category?.trim() || undefined,
      keywords: body.keywords?.trim() || undefined,
      port: body.port?.trim() || undefined,
      context: body.context?.trim() || undefined,
      source: body.source || "manual_search",
    };

    // Must have at least one search criterion
    if (!query.name && !query.keywords && !query.category && !query.country && !query.region) {
      return NextResponse.json(
        { error: "At least one search criterion is required (name, keywords, category, country, or region)." },
        { status: 400 },
      );
    }

    const agentRun = await startRun({ organizationId: authorization.context.organizationId, agent: "supplier_discovery", domain: "procurement", trigger: "module", commandText: "Find supplier candidates" });
    agentRunId = agentRun.id;
    const agentTask = await startTask({ runId: agentRun.id, agent: "supplier_discovery", action: "find_suppliers", input: { query } });
    agentTaskId = agentTask.id;
    const result = await runMatchPipeline(query);
    await prisma.agentTask.update({ where: { id: agentTask.id }, data: { status: "Completed", completedAt: new Date(), confidence: null, output: { matchRunId: result.runId, candidateCount: result.candidates.length, humanReviewRequired: true } } });
    await completeRun(agentRun.id, "Completed");

    return NextResponse.json({
      runId: result.runId,
      candidateCount: result.candidates.length,
      bestCandidate: result.bestCandidate ? {
        name: result.bestCandidate.name,
        rank: result.bestCandidate.rank,
        overallScore: result.bestCandidate.overallScore,
        confidenceBand: result.bestCandidate.confidenceBand,
      } : null,
      timing: result.timing,
    });
  } catch (err) {
    if (err instanceof ApiRequestError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (agentTaskId) await failTask(agentTaskId, "Supplier matching failed.");
    if (agentRunId) await completeRun(agentRunId, "Failed");
    console.error("[match] Pipeline error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Match pipeline failed" },
      { status: 500 },
    );
  }
}

/* ── GET: List recent match runs ─────────────────────────────── */

export async function GET(req: Request) {
  const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
  if (!authorization.ok) return authorization.response;
  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 50);

  const runs = await prisma.matchRun.findMany({
    where: { query: { path: ["organizationId"], equals: authorization.context.organizationId } },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      candidates: {
        orderBy: { rank: "asc" },
        take: 3,
        select: {
          id: true,
          rank: true,
          name: true,
          overallScore: true,
          confidenceBand: true,
          outcome: true,
        },
      },
    },
  });

  return NextResponse.json({ data: runs });
}
