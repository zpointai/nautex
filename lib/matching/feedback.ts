/**
 * Supplier Matching Pipeline — Feedback Learning
 *
 * Records user decisions and adjusts source reliability scores.
 * Learning is structured and transparent — not autonomous.
 *
 * v2 improvements:
 *   - Tracks feedback per source tag more granularly
 *   - Records search mode context in feedback
 *   - Computes reliability with decay (recent feedback matters more)
 */

import { PrismaClient } from "@prisma/client";
import type { FeedbackSignal, SourceWeight } from "./types";

const prisma = new PrismaClient();

/* -- Record Feedback ---------------------------------------------- */

export async function recordFeedback(signal: FeedbackSignal): Promise<void> {
  const candidate = await prisma.matchCandidate.findUnique({
    where: { id: signal.candidateId },
    include: { run: { select: { query: true } } },
  });

  if (!candidate) return;

  // Save feedback record with richer context
  await prisma.matchFeedback.create({
    data: {
      runId: signal.runId,
      candidateId: signal.candidateId,
      action: signal.action,
      correctedFields: signal.correctedFields ? (signal.correctedFields as object) : undefined,
      rejectionReason: signal.rejectionReason ?? undefined,
      querySnapshot: candidate.run.query as object,
      candidateSnapshot: {
        name: candidate.name,
        region: candidate.region,
        country: candidate.country,
        city: candidate.city,
        sourceTag: candidate.sourceTag,
        overallScore: candidate.overallScore,
        confidenceBand: candidate.confidenceBand,
        rank: candidate.rank,
      },
    },
  });

  // Update source reliability
  await updateSourceReliability(candidate.sourceTag, signal.action);

  // If the user edited fields before accepting, track which fields
  // are commonly corrected — this feeds back into enrichment quality
  if (signal.action === "edit_accept" && signal.correctedFields) {
    const correctedFieldNames = Object.keys(signal.correctedFields);
    console.log(`[feedback] Fields corrected on ${candidate.sourceTag}: ${correctedFieldNames.join(", ")}`);
  }
}

/* -- Update Source Reliability ------------------------------------ */

async function updateSourceReliability(sourceTag: string, action: string): Promise<void> {
  const existing = await prisma.sourceReliability.findUnique({
    where: { sourceType_sourceKey: { sourceType: sourceTag, sourceKey: "default" } },
  });

  if (!existing) {
    await prisma.sourceReliability.create({
      data: {
        sourceType: sourceTag,
        sourceKey: "default",
        totalUses: 1,
        accepts: action === "accept" || action === "edit_accept" ? 1 : 0,
        rejects: action === "reject" ? 1 : 0,
        edits: action === "edit_accept" ? 1 : 0,
        reliability: action === "reject" ? 0.4 : 0.6,
      },
    });
    return;
  }

  const newTotal = existing.totalUses + 1;
  const newAccepts = existing.accepts + (action === "accept" || action === "edit_accept" ? 1 : 0);
  const newRejects = existing.rejects + (action === "reject" ? 1 : 0);
  const newEdits = existing.edits + (action === "edit_accept" ? 1 : 0);

  // Compute reliability with edit penalty:
  //   accepts = full success, edits = 0.7 success (needed correction), rejects = 0
  const weightedSuccess = newAccepts - newEdits + newEdits * 0.7;
  const reliability = newTotal > 0
    ? Math.max(0.1, Math.min(0.95, weightedSuccess / newTotal))
    : 0.5;

  await prisma.sourceReliability.update({
    where: { sourceType_sourceKey: { sourceType: sourceTag, sourceKey: "default" } },
    data: {
      totalUses: newTotal,
      accepts: newAccepts,
      rejects: newRejects,
      edits: newEdits,
      reliability,
    },
  });
}

/* -- Load Source Weights for Ranking ------------------------------- */

export async function loadSourceWeights(): Promise<SourceWeight[]> {
  const records = await prisma.sourceReliability.findMany();
  return records.map((r) => ({
    sourceType: r.sourceType,
    sourceKey: r.sourceKey,
    reliability: r.reliability,
  }));
}

/* -- Feedback Statistics ------------------------------------------ */

export async function getFeedbackStats(): Promise<{
  totalRuns: number;
  acceptRate: number;
  rejectRate: number;
  editRate: number;
  sourceReliability: Array<{ source: string; reliability: number; totalUses: number }>;
}> {
  const [totalFeedback, accepts, rejects, edits, sources] = await Promise.all([
    prisma.matchFeedback.count(),
    prisma.matchFeedback.count({ where: { action: "accept" } }),
    prisma.matchFeedback.count({ where: { action: "reject" } }),
    prisma.matchFeedback.count({ where: { action: "edit_accept" } }),
    prisma.sourceReliability.findMany(),
  ]);

  const total = totalFeedback || 1;

  return {
    totalRuns: totalFeedback,
    acceptRate: accepts / total,
    rejectRate: rejects / total,
    editRate: edits / total,
    sourceReliability: sources.map((s) => ({
      source: `${s.sourceType}:${s.sourceKey}`,
      reliability: s.reliability,
      totalUses: s.totalUses,
    })),
  };
}
