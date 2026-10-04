import { Prisma, type ImprovementProposalStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiRequestError } from "@/lib/api/request";
import { hasPermission, type AuthContext } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { IMPROVEMENT_MODULES, IMPROVEMENT_POLICY, improvementModule } from "./registry";
import { improvementHash as hash } from "./hash";
import { EXPERIMENTS, experimentFor, validateCandidate } from "./experiments/catalog";

export type ImprovementContext = AuthContext & { organizationId: string };
type Context = ImprovementContext;
type Db = Prisma.TransactionClient;
const invalid = (message: string) => new ApiRequestError("IMPROVEMENT_INVALID", message, 400);
const missing = () => new ApiRequestError("IMPROVEMENT_NOT_FOUND", "Record is unavailable in your permitted scope.", 404);
const conflict = (message: string) => new ApiRequestError("IMPROVEMENT_CONFLICT", message, 409);

export function requirePermission(context: Context, permission: typeof PERMISSIONS.APP_WRITE | typeof PERMISSIONS.AGENTS_APPROVE) {
  if (!hasPermission(context, permission) || (permission === PERMISSIONS.AGENTS_APPROVE && context.roles.includes("system-agent"))) {
    throw new ApiRequestError("IMPROVEMENT_FORBIDDEN", "This action requires an authorized human reviewer.", 403);
  }
}
export function fields(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some(key => !allowed.includes(key))) throw invalid("Unexpected fields. Actor, organization, verification and status are controlled by the server.");
}
export function text(body: Record<string, unknown>, key: string, max = 2000) {
  const value = body[key];
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw invalid(`${key} must contain 1–${max} characters.`);
  return value.trim();
}
function moduleFor(body: Record<string, unknown>) {
  const capability = improvementModule(body.moduleKey);
  if (!capability) throw invalid("Choose a registered Nautex module.");
  return capability;
}
export function scope(context: Context) {
  return { organizationId: context.organizationId, OR: [{ legalEntityId: null }, { legalEntityId: { in: context.legalEntityIds } }] };
}
function accessibleEntity(context: Context, id: string | null) {
  return id === null || context.legalEntityIds.includes(id);
}

// Explicit projections only: no documents, credentials, external calls, or business writes.
// A snapshot proves what a record said, never whether the business outcome was correct.
export async function sourceSnapshot(db: Db, context: Context, moduleKey: string, id: string) {
  const where = { id, organizationId: context.organizationId };
  let record: unknown = null;
  let legalEntityId: string | null = null;
  switch (improvementModule(moduleKey)?.connector) {
    case "supplier":
      record = await db.supplier.findFirst({ where, select: { id: true, supplierCode: true, name: true, status: true, updatedAt: true } });
      break;
    case "agreement": {
      const row = await db.agreementVersion.findFirst({ where: { ...where, supplier: { organizationId: context.organizationId } }, select: { id: true, supplierId: true, versionNumber: true, status: true, currency: true, validFrom: true, validTo: true, updatedAt: true, items: { take: 1001, orderBy: { id: "asc" }, select: { id: true, offiNumber: true, vendorPartNumber: true, basePrice: true, currency: true, unit: true, updatedAt: true } } } });
      if (row && row.items.length > 1000) throw invalid("This agreement exceeds the 1,000-line capture limit. Use a bounded agreement version for this experiment.");
      record = row;
      break;
    }
    case "inventory":
      record = await db.inventoryItem.findFirst({ where, select: { id: true, itemCode: true, uom: true, onHand: true, reserved: true, inbound: true, reorderPoint: true, lastCountedAt: true, updatedAt: true } });
      break;
    case "backorder": {
      const row = await db.backorder.findFirst({ where: { ...where, ...scope(context), purchaseOrder: { organizationId: context.organizationId } }, select: { id: true, legalEntityId: true, purchaseOrderId: true, status: true, priority: true, version: true, openedAt: true, resolvedAt: true, updatedAt: true } });
      legalEntityId = row?.legalEntityId ?? null;
      record = row;
      break;
    }
    case "validation": {
      const row = await db.validationRun.findFirst({ where, select: { id: true, status: true, createdAt: true, comparisonResults: true, summary: true } });
      record = row ? { id: row.id, status: row.status, createdAt: row.createdAt, comparedRows: Array.isArray(row.comparisonResults) ? row.comparisonResults.length : 0, resultHash: hash(row.comparisonResults), reviewHash: hash(row.summary) } : null;
      break;
    }
    case "item_search": {
      const row = await db.searchHistory.findFirst({ where: { ...where, module: "catalog_search" }, select: { id: true, query: true, resultCount: true, topResults: true, createdAt: true } });
      record = row ? { id: row.id, query: row.query, resultCount: row.resultCount, resultsHash: hash(row.topResults), topResults: Array.isArray(row.topResults) ? row.topResults.slice(0, 5) : [], createdAt: row.createdAt } : null;
      break;
    }
    default: throw invalid("This module currently accepts operator reports only. Record capture is not connected.");
  }
  if (!record) throw missing();
  return { snapshot: JSON.parse(JSON.stringify(record)) as Prisma.InputJsonObject, legalEntityId };
}

export async function recordObservation(context: Context, body: Record<string, unknown>) {
  requirePermission(context, PERMISSIONS.APP_WRITE);
  fields(body, ["action", "moduleKey", "summary", "sourceId"]);
  const capability = moduleFor(body);
  const summary = text(body, "summary", 1200);
  const sourceId = body.action === "capture" ? text(body, "sourceId", 200) : null;
  if (body.action !== "capture" && body.action !== "report") throw invalid("Choose report or capture.");
  if (body.action === "report" && body.sourceId !== undefined) throw invalid("An operator report cannot claim a source record.");
  const source = sourceId ? await sourceSnapshot(prisma, context, capability.key, sourceId) : { snapshot: { report: summary }, legalEntityId: context.activeLegalEntityId };
  if (!accessibleEntity(context, source.legalEntityId)) throw missing();
  const sourceHash = hash(source.snapshot);
  const kind = sourceId ? "record_snapshot" : "operator_report";
  const dedupeKey = hash([capability.key, kind, sourceId, source.legalEntityId, sourceHash, summary, context.userId]);
  return prisma.improvementObservation.upsert({
    where: { organizationId_dedupeKey: { organizationId: context.organizationId, dedupeKey } }, update: {},
    create: { organizationId: context.organizationId, legalEntityId: source.legalEntityId, moduleKey: capability.key, kind, sourceId, sourceHash, summary, snapshot: source.snapshot, actorId: context.userId, dedupeKey },
  });
}

export const proposalInclude = { evidence: { include: { observation: true } }, decisions: { orderBy: { revision: "asc" as const } }, outcomeLinks: { include: { outcome: { include: { observation: true } } } }, evaluations: { orderBy: { createdAt: "desc" as const }, take: 20 } };

export async function checkProposalSources(db: Db, context: Context, proposal: Prisma.ImprovementProposalGetPayload<{ include: typeof proposalInclude }>) {
  for (const { observation } of proposal.evidence) {
    if (!accessibleEntity(context, observation.legalEntityId)) throw missing();
    if (observation.sourceId) {
      const source = await sourceSnapshot(db, context, observation.moduleKey, observation.sourceId);
      if (hash(source.snapshot) !== observation.sourceHash || source.legalEntityId !== observation.legalEntityId) throw conflict("Source evidence has changed. Capture its current version and submit a new proposal.");
    }
  }
  for (const link of proposal.outcomeLinks) {
    if (link.outcome.status !== "Confirmed" || link.outcome.revision !== link.outcomeRevision) throw conflict("A linked outcome changed or was revoked. Submit a new proposal with current reviewed outcomes.");
    if (!accessibleEntity(context, link.outcome.observation.legalEntityId)) throw missing();
  }
}

export async function proposeImprovement(context: Context, body: Record<string, unknown>) {
  requirePermission(context, PERMISSIONS.APP_WRITE);
  fields(body, ["action", "moduleKey", "title", "hypothesis", "candidate", "evaluationPlan", "successCriteria", "stopCondition", "observationIds", "requestKey", "experimentKey", "candidateConfig", "outcomeIds"]);
  const capability = moduleFor(body);
  const content = { moduleKey: capability.key, title: text(body, "title", 160), hypothesis: text(body, "hypothesis"), candidate: text(body, "candidate"), evaluationPlan: text(body, "evaluationPlan"), successCriteria: text(body, "successCriteria"), stopCondition: text(body, "stopCondition") };
  const requestKey = text(body, "requestKey", 100);
  if (!Array.isArray(body.observationIds) || body.observationIds.length < 1 || body.observationIds.length > 20 || body.observationIds.some(id => typeof id !== "string" || !id || id.length > 200)) throw invalid("Select 1–20 evidence records from the same module.");
  const ids = [...new Set(body.observationIds as string[])].sort();
  const experiment = body.experimentKey === undefined ? null : experimentFor(body.experimentKey);
  if (body.experimentKey !== undefined && (!experiment || !(experiment.modules as readonly string[]).includes(capability.key) || !validateCandidate(experiment.key, body.candidateConfig))) throw invalid("Experiment and boolean candidate flags must match this module's registered experiment.");
  const outcomeIds = body.outcomeIds;
  if (experiment && (!Array.isArray(outcomeIds) || outcomeIds.length < 1 || outcomeIds.length > 20 || outcomeIds.some(id => typeof id !== "string" || !id || id.length > 200))) throw invalid("Select 1–20 confirmed outcomes for a benchmark proposal.");
  if (!experiment && (body.candidateConfig !== undefined || outcomeIds !== undefined)) throw invalid("Outcome links and candidate flags require a registered experiment.");
  const linkedIds = experiment ? [...new Set(outcomeIds as string[])].sort() : [];
  const contentHash = experiment ? hash([content, ids, experiment.key, body.candidateConfig, linkedIds]) : hash([content, ids]);
  return prisma.$transaction(async tx => {
    const prior = await tx.improvementProposal.findUnique({ where: { organizationId_requestKey: { organizationId: context.organizationId, requestKey } }, include: proposalInclude });
    if (prior) {
      if (!accessibleEntity(context, prior.legalEntityId)) throw missing();
      if (prior.contentHash !== contentHash || prior.actorId !== context.userId) throw conflict("This request key was already used for another proposal.");
      return prior;
    }
    const observations = await tx.improvementObservation.findMany({ where: { ...scope(context), id: { in: ids }, moduleKey: capability.key } });
    if (observations.length !== ids.length) throw missing();
    const outcomes = await tx.improvementOutcome.findMany({ where: { organizationId: context.organizationId, id: { in: linkedIds }, status: "Confirmed", observationId: { in: ids } } });
    if (outcomes.length !== linkedIds.length) throw invalid("Outcomes must be confirmed and linked to the selected evidence.");
    const entities = [...new Set(observations.map(item => item.legalEntityId).filter((id): id is string => id !== null))];
    if (entities.length > 1) throw invalid("Keep an experiment within one legal entity. Cross-entity evidence reuse is not supported.");
    return tx.improvementProposal.create({
      data: { ...content, organizationId: context.organizationId, legalEntityId: entities[0] ?? null, requestKey, contentHash, actorId: context.userId,
        ...(experiment ? { experimentKey: experiment.key, candidateConfig: body.candidateConfig as Prisma.InputJsonObject } : {}),
        outcomeLinks: { create: outcomes.map(outcome => ({ outcomeRevision: outcome.revision, outcome: { connect: { organizationId_id: { organizationId: context.organizationId, id: outcome.id } } } })) },
        evidence: { create: ids.map(observationId => ({ observation: { connect: { organizationId_id: { organizationId: context.organizationId, id: observationId } } } })) } },
      include: proposalInclude,
    });
  });
}

export async function decideImprovement(context: Context, body: Record<string, unknown>) {
  requirePermission(context, PERMISSIONS.AGENTS_APPROVE);
  fields(body, ["id", "action", "revision", "reason"]);
  const id = text(body, "id", 200);
  const reason = text(body, "reason", 1200);
  const action = text(body, "action", 30);
  if (!Number.isSafeInteger(body.revision) || (body.revision as number) < 1) throw invalid("A positive expected revision is required.");
  const revision = body.revision as number;
  const transitions: Record<string, { from: ImprovementProposalStatus; to: ImprovementProposalStatus }> = {
    approve_experiment: { from: "Proposed", to: "ExperimentApproved" },
    reject: { from: "Proposed", to: "Rejected" },
    revoke: { from: "ExperimentApproved", to: "Revoked" },
  };
  const transition = Object.hasOwn(transitions, action) ? transitions[action] : undefined;
  if (!transition) throw invalid("Only approve_experiment, reject and revoke are supported. Production activation is unavailable.");
  return prisma.$transaction(async tx => {
    const current = await tx.improvementProposal.findFirst({ where: { ...scope(context), id }, include: proposalInclude });
    if (!current) throw missing();
    if (current.revision !== revision || current.status !== transition.from) throw conflict("Proposal changed or this transition is unavailable. Refresh before reviewing.");
    if (action === "approve_experiment") await checkProposalSources(tx, context, current);
    const updated = await tx.improvementProposal.updateMany({ where: { id, organizationId: context.organizationId, revision, status: transition.from }, data: { status: transition.to, revision: { increment: 1 } } });
    if (updated.count !== 1) throw conflict("Another reviewer changed this proposal. Refresh before reviewing.");
    await tx.improvementDecision.create({ data: { organizationId: context.organizationId, proposalId: id, revision: revision + 1, action, reason, actorId: context.userId } });
    return tx.improvementProposal.findUniqueOrThrow({ where: { id }, include: proposalInclude });
  });
}

async function sourceOptions(context: Context, moduleKey: string | null) {
  const where = { organizationId: context.organizationId };
  const take = 30;
  const orderBy = { updatedAt: "desc" as const };
  switch (improvementModule(moduleKey)?.connector) {
    case "supplier": return (await prisma.supplier.findMany({ where, take, orderBy, select: { id: true, supplierCode: true, name: true, status: true } })).map(row => ({ id: row.id, label: `${row.supplierCode} · ${row.name} · ${row.status}` }));
    case "agreement": return (await prisma.agreementVersion.findMany({ where: { ...where, supplier: where }, take, orderBy, select: { id: true, versionNumber: true, supplierName: true, status: true, currency: true } })).map(row => ({ id: row.id, label: `${row.supplierName} · Version ${row.versionNumber} · ${row.currency} · ${row.status}` }));
    case "inventory": return (await prisma.inventoryItem.findMany({ where, take, orderBy, select: { id: true, itemCode: true, description: true, warehouse: true } })).map(row => ({ id: row.id, label: `${row.itemCode ?? "Uncoded"} · ${row.description} · ${row.warehouse}` }));
    case "backorder": return (await prisma.backorder.findMany({ where: { ...scope(context), purchaseOrder: where }, take, orderBy, select: { id: true, backorderNumber: true, status: true, purchaseOrder: { select: { poNumber: true } } } })).map(row => ({ id: row.id, label: `${row.backorderNumber ?? row.purchaseOrder.poNumber} · ${row.status}` }));
    case "validation": return (await prisma.validationRun.findMany({ where, take, orderBy: { createdAt: "desc" }, select: { id: true, status: true, createdAt: true } })).map(row => ({ id: row.id, label: `Comparison ${row.createdAt.toISOString()} · ${row.status}` }));
    case "item_search": return (await prisma.searchHistory.findMany({ where: { ...where, module: "catalog_search" }, take, orderBy: { createdAt: "desc" }, select: { id: true, query: true, resultCount: true } })).map(row => ({ id: row.id, label: `${row.query} · ${row.resultCount} results` }));
    default: return [];
  }
}

export async function improvementSnapshot(context: Context, moduleKey: string | null) {
  if (moduleKey && !improvementModule(moduleKey)) throw invalid("Unknown module filter.");
  const where = { ...scope(context), ...(moduleKey ? { moduleKey } : {}) };
  const proposalWhere = { ...where, evidence: { every: { observation: scope(context) } } };
  const [observations, proposals, observationCount, proposalCount, sources, outcomes] = await Promise.all([
    prisma.improvementObservation.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 }),
    prisma.improvementProposal.findMany({ where: proposalWhere, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100, include: proposalInclude }),
    prisma.improvementObservation.count({ where }), prisma.improvementProposal.count({ where: proposalWhere }), sourceOptions(context, moduleKey),
    prisma.improvementOutcome.findMany({ where: { organizationId: context.organizationId, observation: where }, orderBy: { createdAt: "desc" }, take: 100, include: { reviews: { orderBy: { revision: "asc" } } } }),
  ]);
  return {
    policy: IMPROVEMENT_POLICY, experiments: EXPERIMENTS, modules: IMPROVEMENT_MODULES, observations, proposals, sources, outcomes, sourceLimit: 30,
    totals: { observations: observationCount, proposals: proposalCount }, limit: 100,
    permissions: { contribute: hasPermission(context, PERMISSIONS.APP_WRITE), review: hasPermission(context, PERMISSIONS.AGENTS_APPROVE) && !context.roles.includes("system-agent") },
  };
}
