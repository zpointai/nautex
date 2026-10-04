import { improvementHash } from "../hash";
import { EVALUATOR_VERSION, experimentFor, validateCandidate, type CandidateConfig, type ExperimentKey } from "./catalog";
import { FROZEN_CASES } from "./cases";
import { referencePrediction } from "./rules";

export const SUITE_HASH = "b084436b23cfbd91c0995d9341b5d3b06d7cdabc56ef7a7aa2a1bb626492c021";
export function evaluateReferenceSuite(key: ExperimentKey, candidate: CandidateConfig) {
  if (!validateCandidate(key, candidate)) throw new Error("Invalid candidate configuration.");
  if (improvementHash(FROZEN_CASES) !== SUITE_HASH) throw new Error("Frozen suite integrity check failed.");
  const cases = FROZEN_CASES.filter(entry => entry.group === key);
  const baseline = Object.fromEntries(experimentFor(key)!.flags.map(flag => [flag, false]));
  const rows = cases.map(entry => {
    const sourceHash = improvementHash(entry.input);
    // Candidate flags cannot name a case or its expected result.
    const baselineInput = structuredClone(entry.input), candidateInput = structuredClone(entry.input);
    const baselineResult = referencePrediction(key, baselineInput, baseline);
    const candidateResult = referencePrediction(key, candidateInput, candidate);
    if (improvementHash(baselineInput) !== sourceHash || improvementHash(candidateInput) !== sourceHash) throw new Error("Evaluation input mutated.");
    return { id: entry.id, expected: entry.expected, baselineResult, candidateResult, baselinePassed: baselineResult === entry.expected, candidatePassed: candidateResult === entry.expected, critical: entry.critical, reason: entry.reason };
  });
  const baselinePassed = rows.filter(row => row.baselinePassed).length;
  const candidatePassed = rows.filter(row => row.candidatePassed).length;
  const regressions = rows.filter(row => row.baselinePassed && !row.candidatePassed).length;
  const criticalFailures = rows.filter(row => row.critical && !row.candidatePassed).length;
  return {
    evaluatorVersion: EVALUATOR_VERSION, suiteHash: SUITE_HASH, baselineVersion: experimentFor(key)!.baseline, candidateVersion: experimentFor(key)!.candidate,
    datasetKind: "synthetic_reference", humanLabelled: false, installedApplicationBaseline: false,
    total: rows.length, baselinePassed, candidatePassed, regressions, criticalFailures,
    gate: candidatePassed > baselinePassed && regressions === 0 && criticalFailures === 0 ? "BenchmarkPassed" : "BenchmarkRejected",
    activationEligible: false, providerCalls: 0, cost: 0, inputMutation: false, cases: rows,
    limitations: "Fixed reference strategies and synthetic cases. No production quality gain, live operational replay, human acceptance or activation is established.",
  };
}
