import { executeIdempotentRequest } from "@/lib/api/idempotency";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { fail, logApiError, ok, requestId } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { convertAcceptedQuoteToSalesOrder } from "@/lib/sales-orders/service";

export async function POST(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.PROCUREMENT_WRITE);
    if (!authorization.ok) return authorization.response;
    return await executeIdempotentRequest({
      request: req,
      organizationId: authorization.context.organizationId,
      route: "POST /api/v1/sales-orders/from-quote",
      handler: async () => {
        const body = await readJsonObject(req);
        const quoteId = typeof body.quoteId === "string" ? body.quoteId.trim() : "";
        if (!quoteId) return fail("QUOTE_ID_REQUIRED", "quoteId is required.", 400);
        const requestedDeliveryAt = typeof body.requestedDeliveryAt === "string" && body.requestedDeliveryAt
          ? new Date(body.requestedDeliveryAt)
          : null;
        if (requestedDeliveryAt && Number.isNaN(requestedDeliveryAt.getTime())) {
          return fail("REQUESTED_DELIVERY_AT_INVALID", "requestedDeliveryAt must be a valid date.", 400);
        }
        const result = await convertAcceptedQuoteToSalesOrder({
          organizationId: authorization.context.organizationId,
          legalEntityId: authorization.context.activeLegalEntityId,
          quoteId,
          customerPoReference: typeof body.customerPoReference === "string" ? body.customerPoReference : null,
          requestedDeliveryAt,
          sourceKey: typeof body.sourceKey === "string" ? body.sourceKey : null,
          actor: { id: authorization.context.userId, name: authorization.context.displayName, requestId: requestId(req) },
        });
        return ok(result.salesOrder, { source: "postgres", created: result.created }, { status: result.created ? 201 : 200 });
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    logApiError("POST /api/v1/sales-orders/from-quote", error);
    return fail("SALES_ORDER_CONVERSION_FAILED", error instanceof Error ? error.message : "Failed to convert customer quote.", 409);
  }
}
