import { createHash } from "node:crypto";
import type { InventoryItem } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeAlias } from "./supplier-search";

// Stock quantities change routinely; only item identity changes invalidate reuse.
export const itemFingerprint = (item: InventoryItem) => createHash("sha256").update(JSON.stringify([item.id, item.organizationId, item.itemCode, item.catalogItemId, item.description, item.uom, item.category])).digest("hex");
export async function resolveItemCorrection(organizationId: string, query: string, candidateId?: string) {
  const records = await prisma.itemLearningCorrection.findMany({ where: { organizationId, normalizedAlias: normalizeAlias(query), status: "Approved", ...(candidateId ? { id: candidateId } : { active: true }) }, include: { inventoryItem: true }, take: 2 });
  // Never choose arbitrarily if inconsistent historical/manual data is ambiguous.
  if (records.length !== 1) return null;
  const record = records[0];
  if (record.inventoryItem.organizationId !== organizationId || record.sourceFingerprint !== itemFingerprint(record.inventoryItem)) return null;
  return record;
}

export async function baselineItemMatches(organizationId: string, query: string) {
  return prisma.inventoryItem.findMany({ where: { organizationId, OR: [{ itemCode: { equals: query.trim(), mode: "insensitive" } }, { description: { contains: query.trim(), mode: "insensitive" } }] }, orderBy: { description: "asc" }, take: 10 });
}
