/**
 * Confidence-Based Automation
 *
 * Determines how results should be handled based on confidence level:
 *   - HIGH (>= 0.85): auto-commit, log the action
 *   - MEDIUM (>= 0.60): draft result, require approval
 *   - LOW (< 0.60): create exception, do not commit
 */

export type ConfidenceTier = "high" | "medium" | "low";

export interface ConfidenceDecision {
  tier: ConfidenceTier;
  autoCommit: boolean;
  requiresApproval: boolean;
  createException: boolean;
}

const HIGH_THRESHOLD = 0.85;
const MEDIUM_THRESHOLD = 0.60;

export function evaluateConfidence(confidence: number): ConfidenceDecision {
  if (confidence >= HIGH_THRESHOLD) {
    return { tier: "high", autoCommit: true, requiresApproval: false, createException: false };
  }
  if (confidence >= MEDIUM_THRESHOLD) {
    return { tier: "medium", autoCommit: false, requiresApproval: true, createException: false };
  }
  return { tier: "low", autoCommit: false, requiresApproval: false, createException: true };
}

export { HIGH_THRESHOLD, MEDIUM_THRESHOLD };
