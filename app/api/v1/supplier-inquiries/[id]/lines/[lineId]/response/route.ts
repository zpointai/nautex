import { fail, logApiError, ok, requestId } from "@/lib/api/response";
import { executeIdempotentRequest } from "@/lib/api/idempotency";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { recordSupplierInquiryResponse, type InquiryResponseType } from "@/lib/supplier-inquiries/service";

export async function POST(req: Request, context: { params: Promise<{ id: string; lineId: string }> }) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.PROCUREMENT_WRITE);
    if (!authorization.ok) return authorization.response;
    const { id, lineId } = await context.params;
    return await executeIdempotentRequest({
      request: req,
      organizationId: authorization.context.organizationId,
      route: "POST /api/v1/supplier-inquiries/:id/lines/:lineId/response",
      handler: async () => {
        const body = await readJsonObject(req);
        const responseType = typeof body.responseType === "string" ? body.responseType as InquiryResponseType : null;
        if (responseType !== "quoted" && responseType !== "unavailable") return fail("SUPPLIER_RESPONSE_TYPE_INVALID", "responseType must be quoted or unavailable.", 400);
        const unitPrice = body.unitPrice == null || body.unitPrice === "" ? null : Number(body.unitPrice);
        const leadTimeDays = body.leadTimeDays == null || body.leadTimeDays === "" ? null : Number(body.leadTimeDays);
        if (unitPrice != null && !Number.isFinite(unitPrice)) return fail("UNIT_PRICE_INVALID", "unitPrice must be numeric.", 400);
        if (leadTimeDays != null && (!Number.isInteger(leadTimeDays) || leadTimeDays < 0)) return fail("LEAD_TIME_INVALID", "leadTimeDays must be a non-negative whole number.", 400);
        const data = await recordSupplierInquiryResponse({
          organizationId: authorization.context.organizationId,
          inquiryId: decodeURIComponent(id),
          lineId: decodeURIComponent(lineId),
          responseType,
          unitPrice,
          currency: typeof body.currency === "string" ? body.currency : null,
          leadTimeDays,
          stockStatus: typeof body.stockStatus === "string" ? body.stockStatus : null,
          note: typeof body.note === "string" ? body.note : null,
          actor: { id: authorization.context.userId, name: authorization.context.displayName, requestId: requestId(req) },
        });
        return ok(data, { source: "postgres", status: data.status });
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    logApiError("POST /api/v1/supplier-inquiries/[id]/lines/[lineId]/response", error);
    return fail("SUPPLIER_INQUIRY_RESPONSE_FAILED", error instanceof Error ? error.message : "Failed to record supplier response.", 409);
  }
}
