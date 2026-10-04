import { executeIdempotentRequest } from "@/lib/api/idempotency";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { fail, logApiError, ok, requestId } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { createCustomerQuote, listCustomerQuotes } from "@/lib/customer-quotes/service";

export async function GET(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!authorization.ok) return authorization.response;
    const url = new URL(req.url);
    const data = await listCustomerQuotes(authorization.context.organizationId, {
      customerId: url.searchParams.get("customerId") || undefined,
      rfqId: url.searchParams.get("rfqId") || undefined,
    });
    return ok(data, { source: "postgres" });
  } catch (error) {
    logApiError("GET /api/v1/customer-quotes", error);
    return fail("CUSTOMER_QUOTE_LIST_FAILED", "Failed to load customer quotes.", 500);
  }
}

export async function POST(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.PROCUREMENT_WRITE);
    if (!authorization.ok) return authorization.response;
    return await executeIdempotentRequest({
      request: req,
      organizationId: authorization.context.organizationId,
      route: "POST /api/v1/customer-quotes",
      handler: async () => {
        const body = await readJsonObject(req);
        const customerId = typeof body.customerId === "string" ? body.customerId.trim() : "";
        const rfqId = typeof body.rfqId === "string" ? body.rfqId.trim() : "";
        if (!customerId || !rfqId) return fail("CUSTOMER_QUOTE_CONTEXT_REQUIRED", "customerId and rfqId are required.", 400);
        const markupPct = Number(body.markupPct);
        const vatRate = body.vatRate == null || body.vatRate === "" ? 0 : Number(body.vatRate);
        const validityDays = body.validityDays == null || body.validityDays === "" ? 30 : Number(body.validityDays);
        if (!Number.isFinite(markupPct)) return fail("MARKUP_INVALID", "markupPct must be numeric.", 400);
        if (!Number.isFinite(vatRate)) return fail("VAT_RATE_INVALID", "vatRate must be numeric.", 400);
        if (!Number.isInteger(validityDays)) return fail("VALIDITY_DAYS_INVALID", "validityDays must be a whole number.", 400);
        const rfqLineIds = Array.isArray(body.rfqLineIds)
          ? body.rfqLineIds.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim())
          : undefined;
        const data = await createCustomerQuote({
          organizationId: authorization.context.organizationId,
          legalEntityId: authorization.context.activeLegalEntityId,
          customerId,
          rfqId,
          rfqLineIds,
          markupPct,
          vatRate,
          validityDays,
          customerReference: typeof body.customerReference === "string" ? body.customerReference : null,
          subject: typeof body.subject === "string" ? body.subject : null,
          notes: typeof body.notes === "string" ? body.notes : null,
          sourceKey: typeof body.sourceKey === "string" ? body.sourceKey : null,
          actor: { id: authorization.context.userId, name: authorization.context.displayName, requestId: requestId(req) },
        });
        return ok(data, { source: "postgres", status: "draft" }, { status: 201 });
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    logApiError("POST /api/v1/customer-quotes", error);
    return fail("CUSTOMER_QUOTE_CREATE_FAILED", error instanceof Error ? error.message : "Failed to create customer quote.", 409);
  }
}
