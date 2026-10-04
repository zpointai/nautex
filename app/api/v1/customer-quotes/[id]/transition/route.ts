import { executeIdempotentRequest } from "@/lib/api/idempotency";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { fail, logApiError, ok, requestId } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { transitionCustomerQuote, type CustomerQuoteTransitionAction } from "@/lib/customer-quotes/service";

const ACTIONS = new Set<CustomerQuoteTransitionAction>(["submit", "send", "accept", "decline", "expire", "cancel"]);

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.PROCUREMENT_WRITE);
    if (!authorization.ok) return authorization.response;
    const { id } = await context.params;
    return await executeIdempotentRequest({
      request: req,
      organizationId: authorization.context.organizationId,
      route: "POST /api/v1/customer-quotes/:id/transition",
      handler: async () => {
        const body = await readJsonObject(req);
        const action = typeof body.action === "string" ? body.action as CustomerQuoteTransitionAction : null;
        if (!action || !ACTIONS.has(action)) return fail("CUSTOMER_QUOTE_ACTION_INVALID", "Action must be submit, send, accept, decline, expire, or cancel.", 400);
        const data = await transitionCustomerQuote({
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
    logApiError("POST /api/v1/customer-quotes/[id]/transition", error);
    return fail("CUSTOMER_QUOTE_TRANSITION_FAILED", error instanceof Error ? error.message : "Failed to transition customer quote.", 409);
  }
}
