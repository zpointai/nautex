/**
 * Supplier Matching Pipeline — Orchestrator
 *
 * Coordinates: retrieval -> normalize -> enrich -> rank -> persist
 * Returns a complete MatchResult with ranked candidates.
 *
 * v2: Added enrichment step between normalize and rank.
 */

import { PrismaClient } from "@prisma/client";
import { retrieveCandidates } from "./retrieval";
import { normalizeCandidates } from "./normalize";
import { enrichCandidates } from "./enrich";
import { rankCandidates } from "./ranking";
import { loadSourceWeights } from "./feedback";
import type { MatchQuery, MatchResult } from "./types";
import { detectSearchMode } from "./types";

const prisma = new PrismaClient();

/**
 * Run the full supplier matching pipeline.
 *
 * 1. Detect search mode (identity vs discovery)
 * 2. Retrieve candidates from all sources (DB + Google Places + AI)
 * 3. Normalize and validate
 * 4. Enrich with Google Places data (fill missing address/phone/website/coords)
 * 5. Rank with explainable scoring
 * 6. Persist to database for user review
 */
export async function runMatchPipeline(query: MatchQuery): Promise<MatchResult> {
  const t0 = Date.now();

  // Detect and attach search mode
  const searchMode = detectSearchMode(query);
  const enrichedQuery: MatchQuery = { ...query, searchMode };

  // Create the run record
  const run = await prisma.matchRun.create({
    data: {
      query: enrichedQuery as object,
      source: query.source,
      status: "Running",
    },
  });

  try {
    // Phase 1: Retrieval
    const tRetrieval = Date.now();
    const raw = await retrieveCandidates(enrichedQuery);
    const retrievalMs = Date.now() - tRetrieval;

    // Phase 2: Normalization
    const tNorm = Date.now();
    const normalized = normalizeCandidates(raw);
    const normalizationMs = Date.now() - tNorm;

    // Phase 3: Enrichment (Google Places fills missing contact/location data)
    const tEnrich = Date.now();
    const enriched = await enrichCandidates(normalized, enrichedQuery);
    const enrichmentMs = Date.now() - tEnrich;

    // Phase 4: Ranking
    const tRank = Date.now();
    const sourceWeights = await loadSourceWeights();
    const ranked = await rankCandidates(enriched, enrichedQuery, sourceWeights);
    const rankingMs = Date.now() - tRank;

    // Persist candidates
    if (ranked.length > 0) {
      await prisma.matchCandidate.createMany({
        data: ranked.map((c) => ({
          runId: run.id,
          rank: c.rank,
          sourceTag: c.sourceTag,
          name: c.name,
          region: c.region ?? "",
          country: c.country,
          city: c.city,
          address: c.address,
          phone: c.phone,
          email: c.email,
          website: c.website,
          contactPerson: c.contactPerson,
          description: c.description,
          categories: c.categories || [],
          portsCovered: c.portsCovered || [],
          lat: c.lat,
          lng: c.lng,
          overallScore: c.overallScore,
          confidenceBand: c.confidenceBand,
          scoreBreakdown: c.scoreBreakdown as object,
          explanation: c.explanation,
          conflicts: c.conflicts && c.conflicts.length > 0 ? c.conflicts as object[] : undefined,
          missingFields: c.missingFields || [],
          existingSupplierId: c.existingSupplierId,
          outcome: "Pending",
        })),
      });
    }

    // Update run status
    await prisma.matchRun.update({
      where: { id: run.id },
      data: {
        status: "Ranked",
        candidateCount: ranked.length,
        completedAt: new Date(),
      },
    });

    const totalMs = Date.now() - t0;

    return {
      runId: run.id,
      query: enrichedQuery,
      candidates: ranked,
      bestCandidate: ranked[0] ?? null,
      alternatives: ranked.slice(1),
      timing: { retrievalMs, normalizationMs, enrichmentMs, rankingMs, totalMs },
    };
  } catch (err) {
    await prisma.matchRun.update({
      where: { id: run.id },
      data: { status: "Failed", completedAt: new Date() },
    });
    throw err;
  }
}

/**
 * Load a previous match run with its candidates.
 */
export async function loadMatchRun(runId: string) {
  const run = await prisma.matchRun.findUnique({
    where: { id: runId },
    include: {
      candidates: { orderBy: { rank: "asc" } },
    },
  });
  return run;
}
