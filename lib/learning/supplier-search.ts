import { createHash } from "node:crypto";
import type { Supplier } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const normalizeAlias = (value: string) => value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
export const supplierFingerprint = (supplier: Supplier) => createHash("sha256").update(JSON.stringify([supplier.id, supplier.organizationId, supplier.name, supplier.status, supplier.updatedAt.toISOString()])).digest("hex");
const stopwords = new Set("find search lookup look for the and with from code item items classify classification impa supplier suppliers vendor vendors country origin normalize description describe please need marine maritime".split(" "));

export async function searchRecordedSuppliers(organizationId: string, raw: string, options: { baseline?: boolean; candidateId?: string } = {}) {
  const query = raw.replace(/\b(classify|find|search|lookup|identify|normalize|country of origin|coo|impa|supplier|vendor|for|please)\b/gi, " ").replace(/\s+/g, " ").trim() || raw.trim();
  if (!raw.trim()) return { query, suppliers: [], correctionId: null };
  const terms = raw.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(term => term.length >= 3 && !stopwords.has(term)).slice(0, 8);
  const suppliers = await prisma.supplier.findMany({ where: { organizationId, status: "Active", OR: [
    { name: { contains: raw.trim(), mode: "insensitive" } }, { name: { contains: query, mode: "insensitive" } },
    { description: { contains: query, mode: "insensitive" } }, { country: { contains: query, mode: "insensitive" } },
    { city: { contains: query, mode: "insensitive" } }, { categories: { hasSome: terms } }, { portsCovered: { hasSome: terms } },
    ...terms.map(term => ({ description: { contains: term, mode: "insensitive" as const } })),
  ] }, orderBy: [{ score: "desc" }, { leadTimeDays: "asc" }], take: 8 });
  if (options.baseline) return { query, suppliers, correctionId: null };
  const correction = await prisma.learningCorrection.findFirst({ where: {
    organizationId, normalizedAlias: normalizeAlias(raw), status: "Approved",
    ...(options.candidateId ? { id: options.candidateId } : { active: true }),
  }, include: { supplier: true } });
  if (!correction || correction.supplier.organizationId !== organizationId || correction.supplier.status !== "Active" || correction.sourceFingerprint !== supplierFingerprint(correction.supplier)) return { query, suppliers, correctionId: null };
  return { query, suppliers: [correction.supplier, ...suppliers.filter(supplier => supplier.id !== correction.supplierId)].slice(0, 8), correctionId: correction.id };
}
