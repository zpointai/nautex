/**
 * Supplier Matching Pipeline — Types
 *
 * Shared types for the retrieval -> normalize -> rank -> enrich -> confirm -> feedback pipeline.
 */

/* -- Query -------------------------------------------------------- */

export interface MatchQuery {
  /** Internal tenant scope; populated by authenticated server routes. */
  organizationId?: string;
  /** Company name (primary search key) */
  name?: string;
  /** Country hint */
  country?: string;
  /** Region hint */
  region?: string;
  /** Product/service category */
  category?: string;
  /** Free-text keywords */
  keywords?: string;
  /** Port of delivery (for PO-driven matching) */
  port?: string;
  /** Contextual description (e.g. PO line items) */
  context?: string;
  /** Caller origin */
  source: "manual_search" | "create_form" | "po_context" | "enrich";

  /**
   * Search mode — auto-detected or user-specified.
   *
   * "identity"  — The user typed a specific company name and wants to find
   *               that exact entity (e.g. "GAC Marine", "Kroonint").
   *               Ranking heavily weights name/domain identity signals.
   *
   * "discovery" — The user is searching broadly for suppliers by region,
   *               category, port, or keywords (e.g. "provisions in Rotterdam").
   *               Ranking weights location/category/maritime relevance more evenly.
   */
  searchMode?: "identity" | "discovery";
}

/* -- Raw Candidate (pre-normalization) ---------------------------- */

export interface RawCandidate {
  name: string;
  region?: string | null;
  country?: string | null;
  city?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  contactPerson?: string | null;
  description?: string | null;
  categories?: string[];
  portsCovered?: string[];
  lat?: number | null;
  lng?: number | null;
  /** Which retrieval source produced this candidate */
  sourceTag: SourceTag;
  /** If sourced from internal DB, the existing supplier ID */
  existingSupplierId?: string | null;
  /** Source-specific metadata */
  sourceMeta?: Record<string, unknown>;
}

export type SourceTag =
  | "internal_db"
  | "ai_generated"
  | "ai_enrichment"
  | "google_places";

/* -- Normalized Candidate (post-validation) ----------------------- */

export interface NormalizedCandidate extends RawCandidate {
  /** Fields that failed validation or have inconsistencies */
  conflicts: FieldConflict[];
  /** Required fields that are missing */
  missingFields: string[];
  /** Whether the candidate passed basic validation */
  isValid: boolean;
}

export interface FieldConflict {
  field: string;
  issue: string;
  severity: "warning" | "error";
}

/* -- Identity Signals (company-level evidence) -------------------- */

export interface IdentitySignals {
  /** Exact or near-exact name match (considers legal suffixes, abbreviations) */
  nameExact: boolean;
  /** Name is a substring/contains match */
  nameContains: boolean;
  /** Shared word overlap ratio (0-1) */
  nameWordOverlap: number;
  /** Website domain matches a known pattern for the company */
  domainMatch: boolean;
  /** Google Places confirmed this entity exists at this address */
  placesVerified: boolean;
  /** Phone number verified by Google Places */
  phoneVerified: boolean;
  /** How many independent sources agree on the name */
  sourceAgreement: number;
}

/* -- Scored Candidate (post-ranking) ------------------------------ */

export interface ScoredCandidate extends NormalizedCandidate {
  rank: number;
  overallScore: number;
  confidenceBand: "high" | "medium" | "low";
  scoreBreakdown: ScoreBreakdown;
  explanation: string;
  /** Structured identity evidence for UI display */
  identitySignals?: IdentitySignals;
}

export interface ScoreBreakdown {
  nameMatch: number;          // 0-1: how well name matches query
  locationMatch: number;      // 0-1: country/region/city relevance
  categoryFit: number;        // 0-1: category/product alignment
  maritimeRelevance: number;  // 0-1: maritime industry signals
  profileCompleteness: number; // 0-1: how many fields are filled
  domainConsistency: number;  // 0-1: website/email/name alignment
  sourceReliability: number;  // 0-1: historical source quality
  identityStrength: number;   // 0-1: composite company identity evidence
}

/* -- Pipeline Result ---------------------------------------------- */

export interface MatchResult {
  runId: string;
  query: MatchQuery;
  candidates: ScoredCandidate[];
  bestCandidate: ScoredCandidate | null;
  alternatives: ScoredCandidate[];
  timing: {
    retrievalMs: number;
    normalizationMs: number;
    enrichmentMs: number;
    rankingMs: number;
    totalMs: number;
  };
}

/* -- Feedback ----------------------------------------------------- */

export interface FeedbackSignal {
  runId: string;
  candidateId: string;
  action: "accept" | "reject" | "edit_accept";
  correctedFields?: Record<string, { from: unknown; to: unknown }>;
  rejectionReason?: string;
}

/* -- Source Reliability -------------------------------------------- */

export interface SourceWeight {
  sourceType: string;
  sourceKey: string;
  reliability: number;
}

/* -- Confidence bands --------------------------------------------- */

export function confidenceBand(score: number): "high" | "medium" | "low" {
  if (score >= 0.75) return "high";
  if (score >= 0.45) return "medium";
  return "low";
}

/* -- Search mode detection ---------------------------------------- */

/**
 * Detect whether a query is an identity lookup or a discovery search.
 *
 * Identity: user typed a specific company name (e.g. "GAC", "Kroonint BV")
 * Discovery: user is browsing by category/region/keywords without a clear company name
 */
export function detectSearchMode(query: MatchQuery): "identity" | "discovery" {
  // If explicitly set, honor it
  if (query.searchMode) return query.searchMode;

  // If there's a company name and no broad search criteria, it's identity
  if (query.name && query.name.trim().length >= 2) {
    // If name is the primary criterion (no keywords, no category as primary driver)
    const hasBroadCriteria = !!(query.keywords || query.category);
    const nameIsShort = query.name.trim().split(/\s+/).length <= 4;

    // If the name looks like a company name (not a description), treat as identity
    if (nameIsShort && !hasBroadCriteria) return "identity";
    if (nameIsShort && hasBroadCriteria) return "identity"; // name + context = still identity
  }

  // No name, or name is very long (like a description) -> discovery
  if (!query.name && (query.keywords || query.category || query.region || query.port)) {
    return "discovery";
  }

  return "identity"; // default to identity when a name is provided
}
