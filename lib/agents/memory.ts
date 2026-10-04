import { prisma } from "@/lib/prisma";

type MemoryConfidence = "manual" | "confirmed" | "learned" | "suggested";

export interface AgentMemoryRecord {
  id: string;
  agent: string;
  module: string;
  memoryType: string;
  memoryKey: string;
  confidence: MemoryConfidence;
  source: string;
  observations: number;
  lastObservedAt: string;
  payload: Record<string, unknown>;
}

function confidenceFromReliability(reliability: number): MemoryConfidence {
  if (reliability >= 0.8) return "confirmed";
  if (reliability >= 0.55) return "learned";
  return "suggested";
}

export async function listAgentMemory(limit = 25): Promise<AgentMemoryRecord[]> {
  const [sources, runs] = await Promise.all([
    prisma.sourceReliability.findMany({
      orderBy: [{ reliability: "desc" }, { totalUses: "desc" }],
      take: limit,
    }),
    prisma.matchRun.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 10),
      include: {
        candidates: {
          orderBy: { rank: "asc" },
          take: 3,
        },
      },
    }),
  ]);

  const sourceMemory: AgentMemoryRecord[] = sources.map((source) => ({
    id: `source-${source.sourceType}-${source.sourceKey}`,
    agent: "supplier_router",
    module: "supplier_directory",
    memoryType: "source_reliability",
    memoryKey: `${source.sourceType}:${source.sourceKey}`,
    confidence: confidenceFromReliability(source.reliability),
    source: "prisma_source_reliability",
    observations: source.totalUses,
    lastObservedAt: source.updatedAt.toISOString(),
    payload: {
      reliability: source.reliability,
      accepts: source.accepts,
      rejects: source.rejects,
      edits: source.edits,
    },
  }));

  const runMemory: AgentMemoryRecord[] = runs.map((run) => ({
    id: `match-run-${run.id}`,
    agent: "supplier_router",
    module: "supplier_directory",
    memoryType: "routing_run",
    memoryKey: run.id,
    confidence: run.status === "Accepted" ? "confirmed" : "learned",
    source: "prisma_match_runs",
    observations: run.candidateCount,
    lastObservedAt: (run.completedAt ?? run.createdAt).toISOString(),
    payload: {
      status: run.status,
      source: run.source,
      acceptedCandidateId: run.acceptedCandidateId,
      savedSupplierId: run.savedSupplierId,
      candidates: run.candidates.map((candidate) => ({
        id: candidate.id,
        rank: candidate.rank,
        name: candidate.name,
        sourceTag: candidate.sourceTag,
        outcome: candidate.outcome,
        score: candidate.overallScore,
      })),
    },
  }));

  return [...sourceMemory, ...runMemory]
    .sort((a, b) => new Date(b.lastObservedAt).getTime() - new Date(a.lastObservedAt).getTime())
    .slice(0, limit);
}

export async function getAgentMemorySummary() {
  const [feedbackCount, acceptedCount, rejectedCount, editedCount, sourceCount, recentMemory] = await Promise.all([
    prisma.matchFeedback.count(),
    prisma.matchFeedback.count({ where: { action: { in: ["accept", "edit_accept"] } } }),
    prisma.matchFeedback.count({ where: { action: "reject" } }),
    prisma.matchFeedback.count({ where: { action: "edit_accept" } }),
    prisma.sourceReliability.count(),
    listAgentMemory(10),
  ]);

  const total = Math.max(feedbackCount, 1);

  return {
    totals: {
      feedbackCount,
      sourceCount,
      acceptRate: Math.round((acceptedCount / total) * 100),
      rejectRate: Math.round((rejectedCount / total) * 100),
      editRate: Math.round((editedCount / total) * 100),
    },
    records: recentMemory,
  };
}
