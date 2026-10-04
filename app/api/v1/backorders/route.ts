import { fail, logApiError, ok, requestId } from "@/lib/api/response";
import { executeIdempotentRequest } from "@/lib/api/idempotency";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { buildBackorderKpis } from "@/lib/backorders/derived";
import { listBackorders, materializeBackorder } from "@/lib/backorders/service";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";

export async function GET(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!authorization.ok) return authorization.response;
    const data = await listBackorders(authorization.context.organizationId);
    const materialized = data.filter((row) => row.source === "backorder_case").length;
    return ok(data, {
      source: "backorder_cases_with_derived_fallback",
      status: materialized === data.length ? "operational" : "transitioning",
      kpis: buildBackorderKpis(data),
      materialized,
      derived: data.length - materialized,
    });
  } catch (error) {
    logApiError("GET /api/v1/backorders", error);
    return fail("BACKORDER_LIST_FAILED", "Failed to fetch derived backorders.", 500);
  }
}

export async function POST(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.PROCUREMENT_WRITE);
    if (!authorization.ok) return authorization.response;
    return await executeIdempotentRequest({
      request: req,
      organizationId: authorization.context.organizationId,
      route: "POST /api/v1/backorders",
      handler: async () => {
        const body = await readJsonObject(req);
        const purchaseOrderId = typeof body.purchaseOrderId === "string" ? body.purchaseOrderId.trim() : "";
        if (!purchaseOrderId) return fail("PURCHASE_ORDER_REQUIRED", "purchaseOrderId is required.", 400);
        const result = await materializeBackorder({
          organizationId: authorization.context.organizationId,
          legalEntityId: authorization.context.activeLegalEntityId,
          purchaseOrderId,
          actor: {
            id: authorization.context.userId,
            name: authorization.context.displayName,
            requestId: requestId(req),
          },
        });
        return ok(result.backorder, {
          source: "postgres",
          status: result.created ? "created" : "existing",
        }, { status: result.created ? 201 : 200 });
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    logApiError("POST /api/v1/backorders", error);
    return fail("BACKORDER_CREATE_FAILED", error instanceof Error ? error.message : "Failed to create backorder case.", 409);
  }
}
