import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiRequestError } from "@/lib/api/request";
import { hasPermission } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { canManageAgents, type AgentContext } from "@/lib/agents/controls";
import { normalizeAlias } from "./supplier-search";
import { baselineItemMatches, itemFingerprint, resolveItemCorrection } from "./item-search";
function authorize(context: AgentContext, review = false) {
  if (context.roles.includes("system-agent") || !(review ? canManageAgents(context) : hasPermission(context, PERMISSIONS.INVENTORY_WRITE))) throw new ApiRequestError("PERMISSION_DENIED", "An authorized human must record or review item corrections.", 403);
}
export async function captureItemCorrection(context: AgentContext, body: Record<string, unknown>) {
  authorize(context);
  const { query, inventoryItemId, reason, requestKey } = body;
  if (typeof query !== "string" || query.trim().length < 2 || query.length > 200 || typeof inventoryItemId !== "string" || typeof reason !== "string" || reason.trim().length < 10 || reason.length > 2000 || typeof requestKey !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(requestKey)) throw new ApiRequestError("INVALID_CORRECTION", "Provide a description, a supporting item, a reason of at least 10 characters and a request identifier.", 400);
  const item = await prisma.inventoryItem.findFirst({ where: { id: inventoryItemId, organizationId: context.organizationId } });
  if (!item) throw new ApiRequestError("ITEM_NOT_FOUND", "Select an item belonging to this company.", 404);
  const baseline = await baselineItemMatches(context.organizationId, query);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`item-learning:${context.organizationId}:${requestKey}`}))`;
    const old = await tx.itemLearningCorrection.findUnique({ where: { organizationId_requestKey: { organizationId: context.organizationId, requestKey } } });
    if (old) {
      if (old.createdBy !== context.userId || old.originalQuery !== query.trim() || old.inventoryItemId !== inventoryItemId || old.reason !== reason.trim()) throw new ApiRequestError("REQUEST_REUSED", "This request already captured different details.", 409);
      return old;
    }
    const record = await tx.itemLearningCorrection.create({ data: { organizationId: context.organizationId, inventoryItemId, originalQuery: query.trim(), normalizedAlias: normalizeAlias(query), expectedName: item.description, originalOutput: baseline.map(row => ({ id: row.id, name: row.description })), reason: reason.trim(), sourceFingerprint: itemFingerprint(item), createdBy: context.userId, requestKey } });
    await tx.auditEvent.create({ data: { organizationId: context.organizationId, entityType: "ItemLearningCorrection", entityId: record.id, eventType: "item_correction_captured", actorId: context.userId, actorName: context.displayName, sourceModule: "agentMonitor", after: { inventoryItemId, query: record.originalQuery } } });
    return record;
  });
}
export async function reviewItemCorrection(context: AgentContext, id: string, revision: number, action: string) {
  authorize(context, true);
  if (!["approve", "reject", "evaluate", "activate", "deactivate", "revoke"].includes(action)) throw new ApiRequestError("ACTION_INVALID", "Choose a supported review action.", 400);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`item-learning-review:${context.organizationId}`}))`;
    const record = await tx.itemLearningCorrection.findFirst({ where: { id, organizationId: context.organizationId }, include: { inventoryItem: true } });
    if (!record) throw new ApiRequestError("CORRECTION_NOT_FOUND", "Correction not found.", 404);
    if (record.revision !== revision) throw new ApiRequestError("STALE_CORRECTION", "Correction changed. Refresh before reviewing.", 409);
    const fresh = record.inventoryItem.organizationId === context.organizationId && record.sourceFingerprint === itemFingerprint(record.inventoryItem);
    if (["approve", "evaluate", "activate"].includes(action) && !fresh) throw new ApiRequestError("SOURCE_CHANGED", "Item identity changed. Capture a new correction.", 409);
    const data: Prisma.ItemLearningCorrectionUpdateInput = { revision: { increment: 1 } };
    if (action === "approve" || action === "reject") {
      if (record.status !== "Pending") throw new ApiRequestError("TRANSITION_INVALID", "Only pending corrections can be approved or rejected.", 409);
      Object.assign(data, { status: action === "approve" ? "Approved" : "Rejected", reviewedBy: context.userId, reviewedAt: new Date() });
    } else if (action === "revoke") Object.assign(data, { status: "Revoked", active: false });
    else {
      if (record.status !== "Approved") throw new ApiRequestError("APPROVAL_REQUIRED", "Approve before evaluation or activation.", 409);
      if (action === "evaluate") {
        const queries = [record.originalQuery, record.originalQuery.toUpperCase(), `  ${record.originalQuery.replace(/ /g, "  ")} `];
        const cases = [];
        for (const query of queries) {
          const baseline = await baselineItemMatches(context.organizationId, query);
          const candidate = await resolveItemCorrection(context.organizationId, query, id);
          cases.push({ query, expectedItemId: record.inventoryItemId, baselineTop: baseline[0]?.id ?? null, candidateTop: candidate?.inventoryItemId ?? null });
        }
        const negative = await resolveItemCorrection(context.organizationId, `${record.originalQuery} unverified alternative`, id);
        data.evaluation = { version: "reviewed-item-alias-v1", sourceFingerprint: record.sourceFingerprint, cases, negativeExcluded: negative === null, passed: cases.every(row => row.candidateTop === row.expectedItemId) && negative === null, evaluatedBy: context.userId, evaluatedAt: new Date().toISOString() };
      } else if (action === "activate") {
        const evaluation = record.evaluation as { passed?: boolean; sourceFingerprint?: string } | null;
        if (!evaluation?.passed || evaluation.sourceFingerprint !== record.sourceFingerprint) throw new ApiRequestError("EVALUATION_REQUIRED", "Pass evaluation before activation.", 409);
        if (await tx.itemLearningCorrection.findFirst({ where: { organizationId: context.organizationId, normalizedAlias: record.normalizedAlias, active: true, id: { not: id } } })) throw new ApiRequestError("ALIAS_ACTIVE", "Deactivate the conflicting alias first.", 409);
        data.active = true;
      } else data.active = false;
    }
    const updated = await tx.itemLearningCorrection.update({ where: { id }, data });
    await tx.auditEvent.create({ data: { organizationId: context.organizationId, entityType: "ItemLearningCorrection", entityId: id, eventType: `item_correction_${action}`, actorId: context.userId, actorName: context.displayName, sourceModule: "agentMonitor", before: { status: record.status, active: record.active, revision: record.revision }, after: { status: updated.status, active: updated.active, revision: updated.revision, evaluation: updated.evaluation } } });
    return updated;
  }, { timeout: 15000 });
}
