import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiRequestError } from "@/lib/api/request";
import type { AgentContext } from "@/lib/agents/controls";
import { COMPANY_SOURCE_FIELDS, type CompanySourceCandidate, type CompanySourceReview } from "./source-contract";

const stringify = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const hash = (row: Record<string, unknown>) => createHash("sha256").update(JSON.stringify([row.name, ...COMPANY_SOURCE_FIELDS.map(key => row[key] ?? null)])).digest("hex");
const text = (value: unknown, max = 500) => typeof value === "string" ? value.trim().slice(0, max) : "";
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

// A fixed public endpoint, bounded response, no arbitrary URL fetching or model-generated facts.
export async function searchCompanySources(name: string, signal?: AbortSignal): Promise<CompanySourceCandidate[]> {
  const url = new URL("https://api.gleif.org/api/v1/lei-records");
  // GLEIF treats commas as list separators; avoid widening a single-name query.
  const query = name.replace(/[,;*]/g, " ").replace(/\s+/g, " ").trim();
  if (query.length < 2) throw new Error("Company name is too short for source search");
  url.searchParams.set("filter[entity.legalName]", query);
  url.searchParams.set("page[size]", "5");
  const response = await fetch(url, { redirect: "error", cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000), headers: { Accept: "application/vnd.api+json" } });
  if (!response.ok) throw new Error("Source lookup unavailable");
  const reader = response.body?.getReader(); if (!reader) throw new Error("Empty source response");
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const item = await reader.read(); if (item.done) break; size += item.value.byteLength; if (size > 250_000) throw new Error("Source response too large"); chunks.push(item.value); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const payload = object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  if (!Array.isArray(payload.data)) throw new Error("Invalid source response");
  return payload.data.slice(0, 5).flatMap(value => {
    const record = object(value), attributes = object(record.attributes), entity = object(attributes.entity), registration = object(attributes.registration), address = object(entity.legalAddress);
    const id = text(attributes.lei, 21), legalName = text(object(entity.legalName).name, 200);
    if (!/^[A-Z0-9]{20}$/.test(id) || !legalName) return [];
    return [{ id, sourceUrl: `https://api.gleif.org/api/v1/lei-records/${id}`, source: "GLEIF" as const, name: legalName,
      entityStatus: text(entity.status, 50) || "UNKNOWN", registrationStatus: text(registration.status, 50) || "UNKNOWN", sourceUpdatedAt: text(registration.lastUpdateDate, 50) || null,
      fields: { legalName, address: Array.isArray(address.addressLines) ? address.addressLines.map(v => text(v, 240)).filter(Boolean).join(", ").slice(0, 1000) : "", city: text(address.city, 160), country: text(address.country, 80), postalCode: text(address.postalCode, 40), companyNumber: text(entity.registeredAs, 160) } }];
  });
}

export async function discoverCompany(context: AgentContext, companyId: string, signal?: AbortSignal) {
  const company = await prisma.shippingCompany.findFirst({ where: { id: companyId, organizationId: context.organizationId } });
  if (!company) throw new ApiRequestError("COMPANY_NOT_FOUND", "Shipping company not found.", 404);
  const old = company.sourceReview as CompanySourceReview | null;
  if (old && Date.now() - Date.parse(old.checkedAt) < 60_000) throw new ApiRequestError("SOURCE_LOOKUP_LIMIT", "A lookup was just requested. Review the saved result or wait one minute before retrying.", 429);
  const review: CompanySourceReview = { id: randomUUID(), checkedAt: new Date().toISOString(), baseHash: hash(company), status: "searching", candidates: [], message: "Searching public legal-entity records…" };
  const claim = await prisma.shippingCompany.updateMany({ where: { id: company.id, organizationId: context.organizationId, updatedAt: company.updatedAt }, data: { sourceReview: stringify(review) } });
  if (claim.count !== 1) throw new ApiRequestError("COMPANY_CHANGED", "Company details changed. Reopen the profile before searching.", 409);
  try {
    review.candidates = await searchCompanySources(company.legalName || company.name, signal);
    review.status = review.candidates.length ? "review_required" : "no_matches";
    review.message = review.candidates.length ? "Compare the legal name, address and registration status. Results may include similarly named companies or subsidiaries. No profile fields have been changed."
      : "No matching LEI records were found. Many companies do not have an LEI. Check the company's official website or business register and edit the profile manually.";
  } catch { review.status = "failed"; review.message = "The public source could not be reached or returned an invalid response. Your saved company is unchanged. You can edit the profile manually or retry later."; }
  return prisma.$transaction(async tx => {
    const current = await tx.shippingCompany.findFirst({ where: { id: company.id, organizationId: context.organizationId } });
    if (!current || hash(current) !== review.baseHash || (current.sourceReview as CompanySourceReview | null)?.id !== review.id) throw new ApiRequestError("COMPANY_CHANGED", "Company details changed during lookup. Search again using the current profile.", 409);
    const saved = await tx.shippingCompany.updateMany({ where: { id: current.id, updatedAt: current.updatedAt }, data: { sourceReview: stringify(review) } });
    if (saved.count !== 1) throw new ApiRequestError("COMPANY_CHANGED", "Company details changed during lookup.", 409);
    await tx.auditEvent.create({ data: { organizationId: context.organizationId, entityType: "shipping_company", entityId: company.id, eventType: "company_source_lookup", actorId: context.userId, sourceModule: "purchaseOrders", metadata: { reviewId: review.id, status: review.status, source: "GLEIF", resultCount: review.candidates.length } } });
    return tx.shippingCompany.findUniqueOrThrow({ where: { id: company.id }, include: { fleetVessels: true } });
  });
}

export async function reviewCompanySources(context: AgentContext, body: Record<string, unknown>) {
  if (!["apply", "dismiss"].includes(String(body.action)) || typeof body.companyId !== "string" || typeof body.reviewId !== "string") throw new ApiRequestError("SOURCE_INPUT_INVALID", "Refresh the source review and choose an action.", 400);
  return prisma.$transaction(async tx => {
    const current = await tx.shippingCompany.findFirst({ where: { id: String(body.companyId), organizationId: context.organizationId } });
    if (!current) throw new ApiRequestError("COMPANY_NOT_FOUND", "Shipping company not found.", 404);
    const review = current.sourceReview as CompanySourceReview | null;
    if (!review || review.id !== body.reviewId || review.status !== "review_required" || hash(current) !== review.baseHash) throw new ApiRequestError("SOURCE_REVIEW_STALE", "This source review is no longer current. Refresh and search again.", 409);
    const edits: Record<string, string> = {};
    if (body.action === "apply") {
      const candidate = review.candidates.find(c => c.id === body.candidateId);
      if (!candidate || body.confirmIdentity !== true || text(body.reviewNote, 1000).length < 10) throw new ApiRequestError("SOURCE_REVIEW_REQUIRED", "Confirm the company identity and record how you checked it.", 400);
      if (candidate.entityStatus !== "ACTIVE" || candidate.registrationStatus !== "ISSUED") throw new ApiRequestError("SOURCE_STATUS_REVIEW", "This record is inactive or its LEI registration is not current. Verify it independently and use manual profile editing instead.", 409);
      const proposed = object(body.fields), keys = Object.keys(proposed);
      if (!keys.length || keys.some(k => !COMPANY_SOURCE_FIELDS.includes(k as typeof COMPANY_SOURCE_FIELDS[number]))) throw new ApiRequestError("SOURCE_FIELDS_INVALID", "Select supported company fields to apply.", 400);
      for (const key of keys) {
        if (typeof proposed[key] !== "string" || !String(proposed[key]).trim() || String(proposed[key]).length > (key === "address" ? 1000 : 200)) throw new ApiRequestError("SOURCE_FIELDS_INVALID", "Check the selected field values.", 400);
        edits[key] = String(proposed[key]).trim();
      }
      review.selectedCandidateId = candidate.id;
      review.appliedFields = keys as CompanySourceReview["appliedFields"];
    }
    review.status = body.action === "apply" ? "applied" : "dismissed"; review.reviewedAt = new Date().toISOString();
    review.message = body.action === "apply" ? "Selected fields saved after human identity review. Fleet ownership has not been verified by this lookup." : "Suggestions dismissed. Company details were not changed.";
    const saved = await tx.shippingCompany.updateMany({ where: { id: current.id, updatedAt: current.updatedAt }, data: { ...edits, sourceReview: stringify(review) } });
    if (saved.count !== 1) throw new ApiRequestError("COMPANY_CHANGED", "Another operator changed the profile. Refresh before applying.", 409);
    await tx.auditEvent.create({ data: { organizationId: context.organizationId, entityType: "shipping_company", entityId: current.id, eventType: body.action === "apply" ? "company_sources_applied" : "company_sources_dismissed", actorId: context.userId, sourceModule: "purchaseOrders", metadata: { reviewId: review.id, candidateId: review.selectedCandidateId ?? null, fields: Object.keys(edits), reviewNote: text(body.reviewNote, 1000), sourceUrl: review.candidates.find(c => c.id === review.selectedCandidateId)?.sourceUrl ?? null } } });
    return tx.shippingCompany.findUniqueOrThrow({ where: { id: current.id }, include: { fleetVessels: true } });
  });
}
