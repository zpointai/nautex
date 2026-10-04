import { executeIdempotentRequest } from "@/lib/api/idempotency";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { fail, logApiError, ok, requestId } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { transitionCustomerQuote } from "@/lib/customer-quotes/service";

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.PROCUREMENT_APPROVE);
    if (!authorization.ok) return authorization.response;
    const { id } = await context.params;
    return await executeIdempotentRequest({
      request: req,
      organizationId: authorization.context.organizationId,
      route: "POST /api/v1/customer-quotes/:id/decision",
      handler: async () => {
        const body = await readJsonObject(req);
        const action = body.action === "approve" || body.action === "return" ? body.action : null;
        if (!action) return fail("CUSTOMER_QUOTE_DECISION_INVALID", "Action must be approve or return.", 400);
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
    logApiError("POST /api/v1/customer-quotes/[id]/decision", error);
    return fail("CUSTOMER_QUOTE_DECISION_FAILED", error instanceof Error ? error.message : "Failed to decide customer quote.", 409);
  }
}
