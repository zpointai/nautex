/**
 * Supplier Matching Pipeline — Public API
 *
 * Usage:
 *   import { runMatchPipeline, loadMatchRun, recordFeedback } from "@/lib/matching";
 */

export { runMatchPipeline, loadMatchRun } from "./pipeline";
export { recordFeedback, loadSourceWeights, getFeedbackStats } from "./feedback";
export {
  searchGooglePlaces, searchGooglePlacesMulti, searchGooglePlacesBestMatch,
  enrichCandidates, geocodeAddress,
} from "./enrich";
export type {
  MatchQuery, MatchResult, ScoredCandidate,
  FeedbackSignal, ScoreBreakdown, IdentitySignals, SourceTag,
} from "./types";
export { confidenceBand, detectSearchMode } from "./types";
