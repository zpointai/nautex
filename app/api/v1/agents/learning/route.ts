import { authorizeOrganizationRequest, hasPermission } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { canManageAgents } from "@/lib/agents/controls";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { fail, ok, logApiError } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import { captureSupplierCorrection, reviewSupplierCorrection } from "@/lib/learning/service";
import { supplierFingerprint } from "@/lib/learning/supplier-search";

export async function GET(req: Request) {
  try {
    const auth = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!auth.ok) return auth.response;
    const search = (new URL(req.url).searchParams.get("search") ?? "").slice(0, 200);
    const [records, suppliers] = await Promise.all([
      prisma.learningCorrection.findMany({ where: { organizationId: auth.context.organizationId }, include: { supplier: true }, orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.supplier.findMany({ where: { organizationId: auth.context.organizationId, status: "Active", ...(search ? { name: { contains: search, mode: "insensitive" } } : {}) }, orderBy: { name: "asc" }, take: 50, select: { id: true, name: true, supplierCode: true } }),
    ]);
    return ok({ records: records.map(({ supplier, ...record }) => ({ ...record, sourceCurrent: supplier.organizationId === auth.context.organizationId && supplier.status === "Active" && record.sourceFingerprint === supplierFingerprint(supplier) })), suppliers, canManage: canManageAgents(auth.context), canCreate: hasPermission(auth.context, PERMISSIONS.SUPPLIERS_WRITE) && !auth.context.roles.includes("system-agent") });
  } catch (error) { logApiError("GET learning", error); return fail("LEARNING_UNAVAILABLE", "Could not load reviewed corrections."); }
}
export async function POST(req: Request) {
  try {
    const auth = await authorizeOrganizationRequest(req, PERMISSIONS.SUPPLIERS_WRITE);
    if (!auth.ok) return auth.response;
    const body = await readJsonObject(req, 6000);
    if (![body.query, body.supplierId, body.reason, body.requestKey].every(value => typeof value === "string")) return fail("INVALID_CORRECTION", "Query, supplier, reason and request identifier are required.", 400);
    return ok(await captureSupplierCorrection(auth.context, body as { query: string; supplierId: string; reason: string; requestKey: string }));
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    logApiError("POST learning", error); return fail("CORRECTION_FAILED", "Could not save the correction. Your input is retained; retry safely.");
  }
}
export async function PATCH(req: Request) {
  try {
    const auth = await authorizeOrganizationRequest(req, PERMISSIONS.AGENTS_APPROVE);
    if (!auth.ok) return auth.response;
    const body = await readJsonObject(req, 1500);
    if (typeof body.id !== "string" || typeof body.action !== "string" || !Number.isSafeInteger(body.revision)) return fail("INVALID_REVIEW", "Correction, action and current revision are required.", 400);
    return ok(await reviewSupplierCorrection(auth.context, body.id, Number(body.revision), body.action));
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    logApiError("PATCH learning", error); return fail("REVIEW_FAILED", "Could not update the correction. Refresh its current state before retrying.");
  }
}
