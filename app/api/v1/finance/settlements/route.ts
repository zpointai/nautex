import { authorizeOrganizationRequest, hasPermission } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { fail, ok } from "@/lib/api/response";
import { assignSupplierLegalEntity, draftCustomerCredit, getSettlementReview, reconcileLegacyCredit, recordSettlement, reverseSettlement } from "@/lib/finance/settlements";

export async function GET(req: Request) {
  const auth = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
  if (!auth.ok) return auth.response;
  try { return ok({ ...await getSettlementReview(auth.context.organizationId), canManage: hasPermission(auth.context, PERMISSIONS.FINANCE_APPROVE) && !auth.context.roles.includes("system-agent") }); }
  catch { return fail("LEDGER_UNAVAILABLE", "Could not load the finance settlement ledger.", 500); }
}
export async function POST(req: Request) {
  const auth = await authorizeOrganizationRequest(req, PERMISSIONS.FINANCE_APPROVE);
  if (!auth.ok) return auth.response;
  try {
    const body = await readJsonObject(req, 5000);
    if (typeof body.id !== "string" || typeof body.action !== "string") return fail("INVALID_SETTLEMENT", "A record and supported action are required.", 400);
    if (body.action === "draft_credit" && typeof body.grossAmount === "number" && typeof body.vatAmount === "number" && typeof body.reason === "string" && typeof body.requestKey === "string") return ok(await draftCustomerCredit(auth.context, { id: body.id, grossAmount: body.grossAmount, vatAmount: body.vatAmount, reason: body.reason, requestKey: body.requestKey }));
    if (body.action === "record" && ["supplier_payment", "customer_refund"].includes(String(body.kind)) && typeof body.amount === "number" && typeof body.paidAt === "string" && typeof body.reference === "string" && typeof body.requestKey === "string") return ok(await recordSettlement(auth.context, { kind: body.kind as "supplier_payment" | "customer_refund", id: body.id, amount: body.amount, paidAt: body.paidAt, reference: body.reference, requestKey: body.requestKey }));
    if (body.action === "reverse" && ["supplier_payment", "customer_refund"].includes(String(body.kind)) && typeof body.reason === "string") return ok(await reverseSettlement(auth.context, body.kind as "supplier_payment" | "customer_refund", body.id, body.reason));
    if (body.action === "reconcile" && ["apply_now", "already_reflected"].includes(String(body.method)) && typeof body.reason === "string" && typeof body.invoiceVersion === "string") return ok(await reconcileLegacyCredit(auth.context, { id: body.id, method: body.method as "apply_now" | "already_reflected", reason: body.reason, invoiceVersion: body.invoiceVersion }));
    if (body.action === "assign_entity" && typeof body.legalEntityId === "string" && typeof body.reason === "string") return ok(await assignSupplierLegalEntity(auth.context, body.id, body.legalEntityId, body.reason));
    return fail("INVALID_SETTLEMENT", "Complete the required settlement or reconciliation details.", 400);
  } catch (error) { return fail("SETTLEMENT_FAILED", error instanceof Error ? error.message : "Settlement failed; refresh and review the record.", error instanceof ApiRequestError ? error.status : 409); }
}
