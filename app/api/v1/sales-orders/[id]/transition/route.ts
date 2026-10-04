import { executeIdempotentRequest } from "@/lib/api/idempotency";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { fail, logApiError, ok, requestId } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { transitionSalesOrder, type SalesOrderTransitionAction } from "@/lib/sales-orders/service";

const ACTIONS = new Set<SalesOrderTransitionAction>(["start", "cancel"]);

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.PROCUREMENT_WRITE);
    if (!authorization.ok) return authorization.response;
    const { id } = await context.params;
    return await executeIdempotentRequest({
      request: req,
      organizationId: authorization.context.organizationId,
      route: "POST /api/v1/sales-orders/:id/transition",
      handler: async () => {
        const body = await readJsonObject(req);
        const action = typeof body.action === "string" ? body.action as SalesOrderTransitionAction : null;
        if (!action || !ACTIONS.has(action)) return fail("SALES_ORDER_ACTION_INVALID", "Action must be start or cancel.", 400);
        const data = await transitionSalesOrder({
          organizationId: authorization.context.organizationId,
          id: decodeURIComponent(id),
          action,
          note: typeof body.note === "string" ? body.note : null,
          actor: { id: authorization.context.userId, name: authorization.context.displayName, requestId: requestId(req) },
        });
        return ok(data, { source: "postgres", status: data.status });
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    logApiError("POST /api/v1/sales-orders/[id]/transition", error);
    return fail("SALES_ORDER_TRANSITION_FAILED", error instanceof Error ? error.message : "Failed to transition sales order.", 409);
  }
}
