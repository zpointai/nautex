import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiRequestError } from "@/lib/api/request";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { fields, text, scope, requirePermission, checkProposalSources, proposalInclude, type ImprovementContext } from "./service";
import { improvementHash as hash } from "./hash";
import { IMPROVEMENT_POLICY } from "./registry";
import { EVALUATOR_VERSION, EXPERIMENT_SOFTWARE_VERSION, experimentFor, validateCandidate } from "./experiments/catalog";
import { evaluateReferenceSuite, SUITE_HASH } from "./experiments/evaluator";

export async function runEvaluation(context: ImprovementContext, body: Record<string, unknown>) {
  requirePermission(context, PERMISSIONS.AGENTS_APPROVE);
  fields(body, ["proposalId", "revision", "requestKey"]);
  const proposalId = text(body, "proposalId", 200), requestKey = text(body, "requestKey", 100);
  if (!Number.isSafeInteger(body.revision) || (body.revision as number) < 1) throw new ApiRequestError("EVALUATION_INVALID", "Expected proposal revision is required.", 400);
  return prisma.$transaction(async tx => {
    const proposal = await tx.improvementProposal.findFirst({ where: { ...scope(context), id: proposalId }, include: proposalInclude });
    if (!proposal) throw new ApiRequestError("EVALUATION_NOT_FOUND", "Proposal is unavailable in this scope.", 404);
    if (proposal.status !== "ExperimentApproved") throw new ApiRequestError("EVALUATION_NOT_APPROVED", "An approved, unrevoked experiment proposal is required.", 409);
    const experiment = experimentFor(proposal.experimentKey);
    if (!experiment || !validateCandidate(experiment.key, proposal.candidateConfig) || proposal.outcomeLinks.length === 0) throw new ApiRequestError("EVALUATION_NOT_CONFIGURED", "This proposal has no frozen candidate and reviewed outcomes. Submit a new benchmark proposal.", 409);
    await checkProposalSources(tx, context, proposal);
    const inputHash = hash([proposal.contentHash, proposal.outcomeLinks.map(link => [link.outcomeId, link.outcomeRevision, link.outcome.contentHash]).sort(), SUITE_HASH, EVALUATOR_VERSION]);
    const prior = await tx.improvementEvaluation.findUnique({ where: { organizationId_requestKey: { organizationId: context.organizationId, requestKey } } });
    if (prior) {
      if (prior.proposalId !== proposalId || prior.inputHash !== inputHash || prior.actorId !== context.userId) throw new ApiRequestError("EVALUATION_CONFLICT", "Request key was already used for a different evaluation.", 409);
      return prior;
    }
    if (proposal.revision !== body.revision) throw new ApiRequestError("EVALUATION_CONFLICT", "Proposal changed. Refresh before running.", 409);
    if (await tx.improvementEvaluation.count({ where: { organizationId: context.organizationId, proposalId } }) >= 5) throw new ApiRequestError("EVALUATION_LIMIT", "This immutable proposal has reached its five-run limit.", 409);
    const result = evaluateReferenceSuite(experiment.key, proposal.candidateConfig);
    const changed = await tx.improvementProposal.updateMany({ where: { id: proposalId, organizationId: context.organizationId, status: "ExperimentApproved", revision: proposal.revision }, data: { revision: { increment: 1 } } });
    if (changed.count !== 1) throw new ApiRequestError("EVALUATION_CONFLICT", "Approval changed during the evaluation.", 409);
    return tx.improvementEvaluation.create({ data: {
      organizationId: context.organizationId, proposalId, proposalRevision: proposal.revision + 1, requestKey, inputHash, actorId: context.userId,
      experimentKey: experiment.key, evaluatorVersion: EVALUATOR_VERSION, suiteHash: SUITE_HASH, configurationHash: hash(proposal.candidateConfig), softwareVersion: EXPERIMENT_SOFTWARE_VERSION, policyVersion: IMPROVEMENT_POLICY.version,
      result: { ...result, evidence: proposal.evidence.map(link => ({ observationId: link.observationId, sourceHash: link.observation.sourceHash })), outcomes: proposal.outcomeLinks.map(link => ({ outcomeId: link.outcomeId, revision: link.outcomeRevision, contentHash: link.outcome.contentHash })), replayedOperationalOutcomes: false },
    } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
