import { fail, logApiError, ok, requestId } from "@/lib/api/response";
import { executeIdempotentRequest } from "@/lib/api/idempotency";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { transitionDelivery, type DeliveryTransitionAction } from "@/lib/deliveries/service";

const ACTIONS = new Set<DeliveryTransitionAction>(["ready", "dispatch", "deliver", "cancel"]);

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.PROCUREMENT_WRITE);
    if (!authorization.ok) return authorization.response;
    const { id } = await context.params;
    return await executeIdempotentRequest({
      request: req,
      organizationId: authorization.context.organizationId,
      route: "POST /api/v1/deliveries/:id/transition",
      handler: async () => {
        const body = await readJsonObject(req);
        const action = typeof body.action === "string" ? body.action as DeliveryTransitionAction : null;
        if (!action || !ACTIONS.has(action)) return fail("DELIVERY_ACTION_INVALID", "Action must be ready, dispatch, deliver, or cancel.", 400);
        const deliveredAt = typeof body.deliveredAt === "string" && body.deliveredAt ? new Date(body.deliveredAt) : null;
        if (deliveredAt && Number.isNaN(deliveredAt.getTime())) return fail("DELIVERED_AT_INVALID", "deliveredAt must be a valid date.", 400);
        const data = await transitionDelivery({
          organizationId: authorization.context.organizationId,
          id: decodeURIComponent(id),
          action,
          deliveredToName: typeof body.deliveredToName === "string" ? body.deliveredToName : null,
          deliveredAt,
          actor: { id: authorization.context.userId, name: authorization.context.displayName, requestId: requestId(req) },
        });
        return ok(data, { source: "postgres", status: data.status });
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    logApiError("POST /api/v1/deliveries/[id]/transition", error);
    return fail("DELIVERY_TRANSITION_FAILED", error instanceof Error ? error.message : "Failed to transition delivery.", 409);
  }
}
