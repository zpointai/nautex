import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiRequestError } from "@/lib/api/request";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { fields, text, scope, requirePermission, sourceSnapshot, type ImprovementContext } from "./service";
import { improvementHash as hash } from "./hash";

export async function submitOutcome(context: ImprovementContext, body: Record<string, unknown>) {
  requirePermission(context, PERMISSIONS.APP_WRITE);
  fields(body, ["observationId", "finding", "expected", "actual", "basis", "requestKey"]);
  const observationId = text(body, "observationId", 200), requestKey = text(body, "requestKey", 100);
  const content = { finding: text(body, "finding", 40), expected: text(body, "expected"), actual: text(body, "actual"), basis: text(body, "basis") };
  if (!["Useful", "Incorrect", "Inconclusive"].includes(content.finding)) throw new ApiRequestError("OUTCOME_INVALID", "Choose Useful, Incorrect or Inconclusive.", 400);
  const observation = await prisma.improvementObservation.findFirst({ where: { ...scope(context), id: observationId, kind: "record_snapshot", sourceId: { not: null } } });
  if (!observation) throw new ApiRequestError("OUTCOME_SOURCE_REQUIRED", "A permitted source snapshot is required; an operator report alone cannot substantiate an outcome.", 404);
  const contentHash = hash([observationId, content]);
  const prior = await prisma.improvementOutcome.findUnique({ where: { organizationId_requestKey: { organizationId: context.organizationId, requestKey } }, include: { reviews: true } });
  if (prior) {
    if (prior.contentHash !== contentHash || prior.actorId !== context.userId) throw new ApiRequestError("OUTCOME_CONFLICT", "Request key already used for different outcome content.", 409);
    return prior;
  }
  return prisma.improvementOutcome.create({ data: { ...content, organizationId: context.organizationId, observationId, requestKey, contentHash, actorId: context.userId }, include: { reviews: true } });
}

export async function reviewOutcome(context: ImprovementContext, body: Record<string, unknown>) {
  requirePermission(context, PERMISSIONS.AGENTS_APPROVE);
  fields(body, ["id", "revision", "action", "reason"]);
  const id = text(body, "id", 200), action = text(body, "action", 20), reason = text(body, "reason", 1200);
  if (!Number.isSafeInteger(body.revision) || (body.revision as number) < 1 || !["confirm", "reject", "revoke"].includes(action)) throw new ApiRequestError("OUTCOME_INVALID", "Valid revision and review action are required.", 400);
  const from = action === "revoke" ? "Confirmed" : "Pending";
  const to = action === "confirm" ? "Confirmed" : action === "reject" ? "Rejected" : "Revoked";
  return prisma.$transaction(async tx => {
    const current = await tx.improvementOutcome.findFirst({ where: { id, organizationId: context.organizationId, observation: scope(context) }, include: { observation: true } });
    if (!current) throw new ApiRequestError("OUTCOME_NOT_FOUND", "Outcome is unavailable in this scope.", 404);
    if (current.revision !== body.revision || current.status !== from) throw new ApiRequestError("OUTCOME_CONFLICT", "Outcome changed. Refresh before reviewing.", 409);
    if (action === "confirm") {
      const observation = current.observation;
      if (!observation.sourceId) throw new ApiRequestError("OUTCOME_SOURCE_REQUIRED", "Source record required.", 409);
      const source = await sourceSnapshot(tx, context, observation.moduleKey, observation.sourceId);
      if (hash(source.snapshot) !== observation.sourceHash || source.legalEntityId !== observation.legalEntityId) throw new ApiRequestError("OUTCOME_STALE", "Source changed. Capture a fresh snapshot and record a new outcome.", 409);
    }
    const changed = await tx.improvementOutcome.updateMany({ where: { id, organizationId: context.organizationId, revision: current.revision, status: from }, data: { status: to, revision: { increment: 1 } } });
    if (changed.count !== 1) throw new ApiRequestError("OUTCOME_CONFLICT", "Another reviewer changed the outcome.", 409);
    await tx.improvementOutcomeReview.create({ data: { organizationId: context.organizationId, outcomeId: id, revision: current.revision + 1, action, reason, actorId: context.userId } });
    return tx.improvementOutcome.findUniqueOrThrow({ where: { id }, include: { reviews: { orderBy: { revision: "asc" } } } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
