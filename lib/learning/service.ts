import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiRequestError } from "@/lib/api/request";
import { hasPermission } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { canManageAgents, type AgentContext } from "@/lib/agents/controls";
import { normalizeAlias, searchRecordedSuppliers, supplierFingerprint } from "./supplier-search";

function permitted(context: AgentContext, review = false) {
  if (!context.organizationId || context.roles.includes("system-agent") || !(review ? canManageAgents(context) : hasPermission(context, PERMISSIONS.SUPPLIERS_WRITE))) throw new ApiRequestError("PERMISSION_DENIED", "An authorized human must record or review corrections.", 403);
}
export async function captureSupplierCorrection(context: AgentContext, input: { query: string; supplierId: string; reason: string; requestKey: string }) {
  permitted(context);
  if (!input.query?.trim() || input.query.length > 200 || input.reason?.trim().length < 10 || input.reason.length > 2000 || !/^[a-zA-Z0-9-]{8,80}$/.test(input.requestKey)) throw new ApiRequestError("INVALID_CORRECTION", "Provide a supplier query, supporting reason (10–2000 characters) and request identifier.", 400);
  const supplier = await prisma.supplier.findFirst({ where: { id: input.supplierId, organizationId: context.organizationId, status: "Active" } });
  if (!supplier) throw new ApiRequestError("SOURCE_NOT_FOUND", "Select an active supplier from this organization.", 404);
  const original = await searchRecordedSuppliers(context.organizationId, input.query, { baseline: true });
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${context.organizationId}:learning-request:${input.requestKey}`}))`;
    const existing = await tx.learningCorrection.findUnique({ where: { organizationId_requestKey: { organizationId: context.organizationId, requestKey: input.requestKey } } });
    if (existing) {
      if (existing.createdBy !== context.userId || existing.originalQuery !== input.query.trim() || existing.supplierId !== input.supplierId || existing.reason !== input.reason.trim()) throw new ApiRequestError("REQUEST_REUSED", "This request already recorded different correction details.", 409);
      return existing;
    }
    const record = await tx.learningCorrection.create({ data: {
      organizationId: context.organizationId, supplierId: supplier.id, originalQuery: input.query.trim(), normalizedAlias: normalizeAlias(input.query),
      originalOutput: original.suppliers.map(row => ({ id: row.id, name: row.name })), expectedName: supplier.name,
      sourceFingerprint: supplierFingerprint(supplier), reason: input.reason.trim(), createdBy: context.userId, requestKey: input.requestKey,
    } });
    await tx.auditEvent.create({ data: { organizationId: context.organizationId, entityType: "LearningCorrection", entityId: record.id, eventType: "correction_captured", actorId: context.userId, actorName: context.displayName, sourceModule: "agentMonitor", after: { supplierId: supplier.id, query: record.originalQuery, status: record.status } } });
    return record;
  });
}

export async function reviewSupplierCorrection(context: AgentContext, id: string, revision: number, action: string) {
  permitted(context, true);
  if (!["approve", "reject", "evaluate", "activate", "deactivate", "revoke"].includes(action)) throw new ApiRequestError("INVALID_ACTION", "Choose a supported correction action.", 400);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${context.organizationId}:learning-review`}))`;
    const record = await tx.learningCorrection.findFirst({ where: { id, organizationId: context.organizationId }, include: { supplier: true } });
    if (!record) throw new ApiRequestError("CORRECTION_NOT_FOUND", "Correction not found.", 404);
    if (record.revision !== revision) throw new ApiRequestError("STALE_CORRECTION", "Correction changed. Refresh before reviewing it.", 409);
    const fresh = record.supplier.organizationId === context.organizationId && record.supplier.status === "Active" && record.sourceFingerprint === supplierFingerprint(record.supplier);
    if (["approve", "evaluate", "activate"].includes(action) && !fresh) throw new ApiRequestError("SOURCE_CHANGED", "The supplier changed. Capture and review a new correction.", 409);
    const data: Prisma.LearningCorrectionUpdateInput = { revision: { increment: 1 } };
    if (action === "approve" || action === "reject") {
      if (record.status !== "Pending") throw new ApiRequestError("INVALID_TRANSITION", "Only pending corrections can be approved or rejected.", 409);
      Object.assign(data, { status: action === "approve" ? "Approved" : "Rejected", reviewedBy: context.userId, reviewedAt: new Date() });
    } else if (action === "revoke") Object.assign(data, { status: "Revoked", active: false });
    else {
      if (record.status !== "Approved") throw new ApiRequestError("REVIEW_REQUIRED", "Approve this correction before evaluation or activation.", 409);
      if (action === "evaluate") {
        const queries = [record.originalQuery, record.originalQuery.toUpperCase(), `  ${record.originalQuery.replace(/ /g, "  ")}  `];
        const cases = [];
        for (const query of queries) {
          const baseline = await searchRecordedSuppliers(context.organizationId, query, { baseline: true });
          const candidate = await searchRecordedSuppliers(context.organizationId, query, { candidateId: id });
          cases.push({ query, expectedSupplierId: record.supplierId, baselineTop: baseline.suppliers[0]?.id ?? null, candidateTop: candidate.suppliers[0]?.id ?? null });
        }
        data.evaluation = { version: "recorded-supplier-alias-v1", sourceFingerprint: record.sourceFingerprint, cases, passed: cases.every(row => row.candidateTop === row.expectedSupplierId), evaluatedBy: context.userId, evaluatedAt: new Date().toISOString() };
      } else if (action === "activate") {
        const evaluation = record.evaluation as { passed?: boolean; sourceFingerprint?: string } | null;
        if (!evaluation?.passed || evaluation.sourceFingerprint !== record.sourceFingerprint) throw new ApiRequestError("EVALUATION_REQUIRED", "Run and pass the correction check before activation.", 409);
        const other = await tx.learningCorrection.findFirst({ where: { organizationId: context.organizationId, normalizedAlias: record.normalizedAlias, active: true, id: { not: id } } });
        if (other) throw new ApiRequestError("ALIAS_ACTIVE", "Deactivate the current version of this alias before activating another.", 409);
        data.active = true;
      } else data.active = false;
    }
    const updated = await tx.learningCorrection.update({ where: { id }, data });
    await tx.auditEvent.create({ data: { organizationId: context.organizationId, entityType: "LearningCorrection", entityId: id, eventType: `correction_${action}`, actorId: context.userId, actorName: context.displayName, sourceModule: "agentMonitor", before: { status: record.status, active: record.active, revision: record.revision, evaluation: record.evaluation }, after: { status: updated.status, active: updated.active, revision: updated.revision, evaluation: updated.evaluation } } });
    return updated;
  }, { timeout: 15000 });
}

export async function learningSummary(organizationId: string, limit = 50) {
  const [records, counts, sources, itemRecords, itemCounts, itemSources] = await Promise.all([
    prisma.learningCorrection.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: Math.min(limit, 100) }),
    prisma.learningCorrection.groupBy({ by: ["status"], where: { organizationId }, _count: true }),
    prisma.learningCorrection.findMany({ where: { organizationId }, distinct: ["supplierId"], select: { supplierId: true } }),
    prisma.itemLearningCorrection.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: Math.min(limit, 100) }),
    prisma.itemLearningCorrection.groupBy({ by: ["status"], where: { organizationId }, _count: true }),
    prisma.itemLearningCorrection.findMany({ where: { organizationId }, distinct: ["inventoryItemId"], select: { inventoryItemId: true } }),
  ]);
  const allCounts = [...counts, ...itemCounts];
  const feedbackCount = allCounts.reduce((sum, row) => sum + row._count, 0);
  const acceptedRecommendations = allCounts.filter(row => row.status === "Approved").reduce((sum, row) => sum + row._count, 0);
  const rejectedRecommendations = allCounts.filter(row => row.status === "Rejected").reduce((sum, row) => sum + row._count, 0);
  return { totals: { feedbackCount, sourceCount: sources.length + itemSources.length, acceptedRecommendations, rejectedRecommendations, acceptRate: feedbackCount ? Math.round(100 * acceptedRecommendations / feedbackCount) : 0, rejectRate: feedbackCount ? Math.round(100 * rejectedRecommendations / feedbackCount) : 0, editRate: 0 }, records: [...records.map(row => ({
    id: row.id, agent: "supplier_discovery", module: "suppliers", memoryType: "reviewed_supplier_alias", memoryKey: row.originalQuery,
    confidence: row.status === "Approved" ? "confirmed" as const : "suggested" as const, source: "organization_review", observations: 1, lastObservedAt: row.updatedAt.toISOString(),
    payload: { status: row.status, active: row.active, expectedName: row.expectedName, supplierId: row.supplierId, inventoryItemId: null, revision: row.revision },
  })), ...itemRecords.map(row => ({ id: row.id, agent: "classification", module: "inventory", memoryType: "reviewed_item_alias", memoryKey: row.originalQuery, confidence: row.status === "Approved" ? "confirmed" as const : "suggested" as const, source: "organization_review", observations: 1, lastObservedAt: row.updatedAt.toISOString(), payload: { status: row.status, active: row.active, expectedName: row.expectedName, supplierId: null, inventoryItemId: row.inventoryItemId, revision: row.revision } }))].sort((a, b) => b.lastObservedAt.localeCompare(a.lastObservedAt)).slice(0, Math.min(limit, 100)) };
}
