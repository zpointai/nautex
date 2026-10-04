/**
 * Supplier Matching Pipeline — Ranking Agent
 *
 * Evaluates normalized candidates and produces an explainable ranked list.
 * Scoring is deterministic + AI-augmented for semantic matching.
 *
 * v2 improvements:
 *   - Dynamic weights based on search mode (identity vs discovery)
 *   - Identity strength score: composite company identity evidence
 *   - Confidence cap: weak name matches can't score above medium confidence
 *   - Much better explanations: natural language, specific, actionable
 */

import { generateJSON } from "@/lib/ai/provider";
import type {
  MatchQuery, NormalizedCandidate, ScoredCandidate,
  ScoreBreakdown, SourceWeight, IdentitySignals,
} from "./types";
import { confidenceBand, detectSearchMode } from "./types";

/* -- Identity Signal Analysis ------------------------------------- */

/**
 * Analyze company identity evidence for a candidate.
 * This is the key improvement: strong identity signals prevent
 * weak name matches from outranking strong ones.
 */
function analyzeIdentity(
  candidate: NormalizedCandidate,
  queryName: string | undefined,
): IdentitySignals {
  const signals: IdentitySignals = {
    nameExact: false,
    nameContains: false,
    nameWordOverlap: 0,
    domainMatch: false,
    placesVerified: false,
    phoneVerified: false,
    sourceAgreement: 0,
  };

  if (!queryName) return signals;

  const cn = normalizeName(candidate.name);
  const qn = normalizeName(queryName);

  // Exact match (ignoring legal suffixes)
  signals.nameExact = cn === qn;

  // Contains match
  signals.nameContains = cn.includes(qn) || qn.includes(cn);

  // Word overlap
  const cWords = cn.split(/\s+/).filter((w) => w.length > 1);
  const qWords = qn.split(/\s+/).filter((w) => w.length > 1);
  if (qWords.length > 0) {
    const overlap = qWords.filter((w) => cWords.some((cw) => cw.includes(w) || w.includes(cw))).length;
    signals.nameWordOverlap = overlap / qWords.length;
  }

  // Domain match: check if website domain contains the query name
  if (candidate.website) {
    const domain = extractDomain(candidate.website);
    if (domain) {
      const nameSlug = qn.replace(/\s+/g, "").toLowerCase();
      const nameWords = qn.split(/\s+/).filter((w) => w.length > 2);
      signals.domainMatch = domain.includes(nameSlug)
        || nameWords.some((w) => domain.includes(w));
    }
  }

  // Google Places verification
  signals.placesVerified = !!(candidate.sourceMeta as Record<string, unknown>)?.placesVerified;
  signals.phoneVerified = signals.placesVerified && !!candidate.phone;

  // Source agreement: how many independent sources found this name
  signals.sourceAgreement = 1; // The candidate's own source
  if (signals.placesVerified && candidate.sourceTag !== "google_places") {
    signals.sourceAgreement++;
  }

  return signals;
}

/* -- Deterministic Score Components ------------------------------- */

function scoreNameMatch(candidateName: string, queryName?: string): number {
  if (!queryName) return 0.5;
  const cn = normalizeName(candidateName);
  const qn = normalizeName(queryName);

  // Exact match (after normalization)
  if (cn === qn) return 1.0;

  // Contains match (one contains the other fully)
  if (cn.includes(qn) || qn.includes(cn)) return 0.88;

  // Strong word overlap
  const cWords = cn.split(/\s+/).filter((w) => w.length > 1);
  const qWords = qn.split(/\s+/).filter((w) => w.length > 1);
  if (qWords.length > 0) {
    const overlap = qWords.filter((w) => cWords.some((cw) => cw.includes(w) || w.includes(cw))).length;
    const ratio = overlap / qWords.length;
    if (ratio >= 0.8) return 0.75;
    if (ratio >= 0.5) return 0.55;
    if (overlap > 0) return 0.3;
  }

  // Initials/acronym check (e.g. "GAC" vs "Gulf Agency Company")
  if (qn.length <= 5 && cWords.length >= 2) {
    const initials = cWords.map((w) => w[0]).join("");
    if (initials.includes(qn) || qn.includes(initials)) return 0.7;
  }

  return 0.05; // No meaningful name match
}

function scoreLocationMatch(candidate: NormalizedCandidate, query: MatchQuery): number {
  let score = 0;
  let factors = 0;

  if (query.country && candidate.country) {
    factors++;
    if (candidate.country.toLowerCase() === query.country.toLowerCase()) score += 1;
    else score += 0.1;
  }

  if (query.region && candidate.region) {
    factors++;
    if (candidate.region.toLowerCase() === query.region.toLowerCase()) score += 1;
    else score += 0.1;
  }

  if (query.port && candidate.portsCovered && candidate.portsCovered.length > 0) {
    factors++;
    const portLower = query.port.toLowerCase();
    if (candidate.portsCovered.some((p) => p.toLowerCase().includes(portLower))) score += 1;
    else score += 0.2;
  }

  return factors > 0 ? score / factors : 0.5;
}

function scoreCategoryFit(candidate: NormalizedCandidate, query: MatchQuery): number {
  if (!query.category || !candidate.categories || candidate.categories.length === 0) return 0.5;

  const queryCategory = query.category.toLowerCase();
  const candidateCategories = candidate.categories.map((c) => c.toLowerCase());

  if (candidateCategories.includes(queryCategory)) return 1.0;
  if (candidateCategories.some((c) => c.includes(queryCategory) || queryCategory.includes(c))) return 0.7;

  return 0.2;
}

function scoreMaritimeRelevance(candidate: NormalizedCandidate): number {
  let score = 0;
  const desc = (candidate.description ?? "").toLowerCase();
  const name = candidate.name.toLowerCase();
  const allText = `${name} ${desc} ${(candidate.categories || []).join(" ")}`.toLowerCase();

  const keywords = [
    "maritime", "marine", "ship", "vessel", "offshore", "port",
    "chandler", "provisions", "deck", "engine", "spare parts",
    "navigation", "safety equipment", "bonded stores",
  ];
  let hits = 0;
  for (const kw of keywords) {
    if (allText.includes(kw)) hits++;
  }
  score = Math.min(1, hits * 0.15);

  if (candidate.portsCovered && candidate.portsCovered.length > 0) {
    score = Math.min(1, score + 0.2);
  }

  return Math.max(score, 0.1);
}

function scoreProfileCompleteness(candidate: NormalizedCandidate): number {
  const fields = [
    candidate.name, candidate.region, candidate.country, candidate.city,
    candidate.email, candidate.phone, candidate.website, candidate.contactPerson,
    candidate.description,
  ];
  const filled = fields.filter((f) => f && String(f).trim().length > 0).length;
  const hasCategories = candidate.categories && candidate.categories.length > 0 ? 1 : 0;
  const hasPorts = candidate.portsCovered && candidate.portsCovered.length > 0 ? 1 : 0;
  const hasCoords = (candidate.lat != null && candidate.lng != null) ? 1 : 0;

  return (filled + hasCategories + hasPorts + hasCoords) / 12;
}

function scoreDomainConsistency(candidate: NormalizedCandidate): number {
  if (!candidate.email || !candidate.website) return 0.5;

  try {
    const emailDomain = candidate.email.split("@")[1]?.toLowerCase();
    const siteDomain = extractDomain(candidate.website);
    if (emailDomain && siteDomain) {
      if (emailDomain.includes(siteDomain) || siteDomain.includes(emailDomain)) return 1.0;
      return 0.3;
    }
  } catch { /* parse error */ }
  return 0.5;
}

function scoreSourceReliability(candidate: NormalizedCandidate, weights: SourceWeight[]): number {
  const sourceWeight = weights.find((w) => w.sourceType === candidate.sourceTag);
  if (sourceWeight) return sourceWeight.reliability;

  switch (candidate.sourceTag) {
    case "internal_db": return 0.85;
    case "google_places": return 0.80;
    case "ai_enrichment": return 0.6;
    case "ai_generated": return 0.5;
    default: return 0.5;
  }
}

/**
 * Identity strength: composite measure of how confident we are
 * this candidate IS the entity the user is looking for.
 */
function scoreIdentityStrength(signals: IdentitySignals): number {
  let score = 0;

  // Name evidence (heaviest factor)
  if (signals.nameExact) score += 0.40;
  else if (signals.nameContains) score += 0.30;
  else score += signals.nameWordOverlap * 0.20;

  // Domain evidence
  if (signals.domainMatch) score += 0.25;

  // Google Places verification
  if (signals.placesVerified) score += 0.20;

  // Phone verification (Places returned a phone)
  if (signals.phoneVerified) score += 0.05;

  // Source agreement
  if (signals.sourceAgreement >= 2) score += 0.10;

  return Math.min(1, score);
}

/* -- Dynamic Weights ---------------------------------------------- */

/**
 * Weight profiles for identity vs discovery searches.
 *
 * Identity: nameMatch and identityStrength dominate.
 *   Weak name matches CANNOT score high regardless of other signals.
 *
 * Discovery: more balanced, location and category matter more.
 */
const IDENTITY_WEIGHTS = {
  nameMatch: 0.30,
  identityStrength: 0.25,
  locationMatch: 0.08,
  categoryFit: 0.05,
  maritimeRelevance: 0.05,
  profileCompleteness: 0.08,
  domainConsistency: 0.09,
  sourceReliability: 0.10,
};

const DISCOVERY_WEIGHTS = {
  nameMatch: 0.15,
  identityStrength: 0.05,
  locationMatch: 0.20,
  categoryFit: 0.18,
  maritimeRelevance: 0.15,
  profileCompleteness: 0.08,
  domainConsistency: 0.06,
  sourceReliability: 0.13,
};

/* -- Composite Scoring -------------------------------------------- */

function computeScore(
  candidate: NormalizedCandidate,
  query: MatchQuery,
  sourceWeights: SourceWeight[],
): { overall: number; breakdown: ScoreBreakdown; identity: IdentitySignals } {
  const mode = detectSearchMode(query);
  const weights = mode === "identity" ? IDENTITY_WEIGHTS : DISCOVERY_WEIGHTS;
  const identity = analyzeIdentity(candidate, query.name);

  const breakdown: ScoreBreakdown = {
    nameMatch: scoreNameMatch(candidate.name, query.name),
    locationMatch: scoreLocationMatch(candidate, query),
    categoryFit: scoreCategoryFit(candidate, query),
    maritimeRelevance: scoreMaritimeRelevance(candidate),
    profileCompleteness: scoreProfileCompleteness(candidate),
    domainConsistency: scoreDomainConsistency(candidate),
    sourceReliability: scoreSourceReliability(candidate, sourceWeights),
    identityStrength: scoreIdentityStrength(identity),
  };

  let overall =
    breakdown.nameMatch * weights.nameMatch +
    breakdown.identityStrength * weights.identityStrength +
    breakdown.locationMatch * weights.locationMatch +
    breakdown.categoryFit * weights.categoryFit +
    breakdown.maritimeRelevance * weights.maritimeRelevance +
    breakdown.profileCompleteness * weights.profileCompleteness +
    breakdown.domainConsistency * weights.domainConsistency +
    breakdown.sourceReliability * weights.sourceReliability;

  // CRITICAL: Confidence cap for identity searches
  // If nameMatch is weak (< 0.4), cap the overall score to prevent
  // broadly-relevant-but-wrong companies from ranking high
  if (mode === "identity" && breakdown.nameMatch < 0.4) {
    overall = Math.min(overall, 0.42); // Can't reach "medium" confidence band
  }

  return { overall, breakdown, identity };
}

/* -- Explanation Generator ---------------------------------------- */

/**
 * Generate natural-language explanations that tell the user WHY
 * a candidate ranked where it did, not just restating score numbers.
 */
function generateExplanation(
  candidate: NormalizedCandidate,
  breakdown: ScoreBreakdown,
  identity: IdentitySignals,
  query: MatchQuery,
): string {
  const mode = detectSearchMode(query);
  const parts: string[] = [];

  if (mode === "identity" && query.name) {
    // Identity search explanations focus on "is this the right company?"
    if (identity.nameExact) {
      parts.push(`Exact match for "${query.name}"`);
    } else if (identity.nameContains) {
      parts.push(`Name closely matches "${query.name}"`);
    } else if (identity.nameWordOverlap > 0.5) {
      parts.push(`Shares key terms with "${query.name}"`);
    } else if (breakdown.nameMatch < 0.3) {
      parts.push(`Name does not closely match "${query.name}" — may be a different company`);
    }

    if (identity.domainMatch) {
      parts.push("Website domain confirms company identity");
    }

    if (identity.placesVerified) {
      parts.push("Verified by Google Places with confirmed address");
    }

    if (identity.sourceAgreement >= 2) {
      parts.push("Multiple independent sources agree on this entity");
    }
  } else {
    // Discovery search explanations focus on relevance
    if (breakdown.nameMatch >= 0.85) {
      parts.push(`Strong name match to "${query.name}"`);
    } else if (breakdown.nameMatch >= 0.5 && query.name) {
      parts.push("Partial name match");
    }

    if (breakdown.locationMatch >= 0.8) {
      parts.push(`Located in the requested ${query.country || query.region || "area"}`);
    }

    if (breakdown.categoryFit >= 0.7) {
      parts.push("Covers the requested supply categories");
    }

    if (breakdown.maritimeRelevance >= 0.6) {
      parts.push("Strong maritime industry profile");
    }
  }

  // Common signals
  if (candidate.sourceTag === "internal_db") {
    parts.push("Already in your supplier directory");
  } else if (candidate.sourceTag === "google_places") {
    parts.push("Found via Google Places");
  }

  if (candidate.conflicts && candidate.conflicts.length > 0) {
    const warnings = candidate.conflicts.filter((c) => c.severity === "warning").length;
    if (warnings > 0) parts.push(`${warnings} data concern${warnings > 1 ? "s" : ""} flagged`);
  }

  const missing = candidate.missingFields?.length ?? 0;
  if (missing > 3) {
    parts.push(`${missing} profile fields still missing`);
  }

  return parts.length > 0 ? parts.join(". ") + "." : "General candidate match.";
}

/* -- AI-Augmented Re-Ranking -------------------------------------- */

interface AIRankingResult {
  rankings: Array<{
    name: string;
    relevanceBoost: number;
    reason: string;
  }>;
}

async function aiRerank(
  candidates: Array<{ name: string; description: string | null; score: number }>,
  query: MatchQuery,
): Promise<Map<string, { boost: number; reason: string }>> {
  const boosts = new Map<string, { boost: number; reason: string }>();

  if (candidates.length < 2) return boosts;

  const mode = detectSearchMode(query);
  const candidateList = candidates
    .slice(0, 8)
    .map((c, i) => `${i + 1}. ${c.name} (score: ${c.score.toFixed(2)}) — ${c.description || "No description"}`)
    .join("\n");

  const queryDesc = [
    query.name && `Name: "${query.name}"`,
    query.country && `Country: ${query.country}`,
    query.region && `Region: ${query.region}`,
    query.category && `Category: ${query.category}`,
    query.keywords && `Keywords: ${query.keywords}`,
  ].filter(Boolean).join(", ");

  const modeNote = mode === "identity"
    ? `\n\nIMPORTANT: This is an IDENTITY search — the user is looking for a specific company named "${query.name}". Boost candidates that ARE that company. Penalize candidates that are different companies even if they serve the same market.`
    : "";

  const prompt = `You are evaluating supplier candidates for a maritime procurement search.

SEARCH: ${queryDesc}${modeNote}

CANDIDATES (pre-scored):
${candidateList}

For each candidate, assess whether the deterministic score is fair.

Return JSON:
{
  "rankings": [
    { "name": "Company Name", "relevanceBoost": 0.05, "reason": "Brief explanation" }
  ]
}

Rules:
- relevanceBoost ranges from -0.15 to +0.15
- Only boost/penalize when the score clearly misses something
- A boost of 0 means the score is already fair
- Be conservative — small adjustments only`;

  const result = await generateJSON<AIRankingResult>(prompt, { tier: "fast", temperature: 0.2 });

  if (result.ok && result.data?.rankings) {
    for (const r of result.data.rankings) {
      const clamped = Math.max(-0.15, Math.min(0.15, r.relevanceBoost));
      boosts.set(r.name.toLowerCase().trim(), { boost: clamped, reason: r.reason });
    }
  }

  return boosts;
}

/* -- Helper ------------------------------------------------------- */

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\b(b\.?v\.?|n\.?v\.?|ltd\.?|llc\.?|inc\.?|co\.?|corp\.?|gmbh|s\.?a\.?|s\.?r\.?l\.?|pte\.?|pvt\.?)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/* -- Main Ranking Function ---------------------------------------- */

export async function rankCandidates(
  candidates: NormalizedCandidate[],
  query: MatchQuery,
  sourceWeights: SourceWeight[] = [],
): Promise<ScoredCandidate[]> {
  if (candidates.length === 0) return [];

  const valid = candidates.filter((c) => c.isValid);

  // Phase 1: Deterministic scoring with identity analysis
  const scored = valid.map((c) => {
    const { overall, breakdown, identity } = computeScore(c, query, sourceWeights);
    return { candidate: c, overall, breakdown, identity };
  });

  // Phase 2: AI re-ranking
  let aiBoosts = new Map<string, { boost: number; reason: string }>();
  try {
    aiBoosts = await aiRerank(
      scored.map((s) => ({
        name: s.candidate.name,
        description: s.candidate.description ?? null,
        score: s.overall,
      })),
      query,
    );
  } catch {
    // AI re-ranking is optional
  }

  // Phase 3: Apply boosts, cap, and sort
  const mode = detectSearchMode(query);
  const final: ScoredCandidate[] = scored.map((s) => {
    const boost = aiBoosts.get(s.candidate.name.toLowerCase().trim());
    let adjustedScore = Math.max(0, Math.min(1, s.overall + (boost?.boost ?? 0)));

    // Re-apply confidence cap after AI boost for identity searches
    if (mode === "identity" && s.breakdown.nameMatch < 0.4) {
      adjustedScore = Math.min(adjustedScore, 0.42);
    }

    return {
      ...s.candidate,
      rank: 0,
      overallScore: adjustedScore,
      confidenceBand: confidenceBand(adjustedScore),
      scoreBreakdown: s.breakdown,
      explanation: generateExplanation(s.candidate, s.breakdown, s.identity, query)
        + (boost?.reason ? ` AI note: ${boost.reason}` : ""),
      identitySignals: s.identity,
    };
  });

  // Sort by score descending, then assign ranks
  final.sort((a, b) => b.overallScore - a.overallScore);
  final.forEach((c, i) => { c.rank = i + 1; });

  return final;
}
