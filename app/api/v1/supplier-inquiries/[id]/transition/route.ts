import { fail, logApiError, ok, requestId } from "@/lib/api/response";
import { executeIdempotentRequest } from "@/lib/api/idempotency";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { transitionSupplierInquiry, type InquiryTransitionAction } from "@/lib/supplier-inquiries/service";

const ACTIONS = new Set<InquiryTransitionAction>(["send", "close", "cancel"]);

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.PROCUREMENT_WRITE);
    if (!authorization.ok) return authorization.response;
    const { id } = await context.params;
    return await executeIdempotentRequest({
      request: req,
      organizationId: authorization.context.organizationId,
      route: "POST /api/v1/supplier-inquiries/:id/transition",
      handler: async () => {
        const body = await readJsonObject(req);
        const action = typeof body.action === "string" ? body.action as InquiryTransitionAction : null;
        if (!action || !ACTIONS.has(action)) return fail("SUPPLIER_INQUIRY_ACTION_INVALID", "Action must be send, close, or cancel.", 400);
        const data = await transitionSupplierInquiry({
          organizationId: authorization.context.organizationId,
          id: decodeURIComponent(id),
          action,
          actor: { id: authorization.context.userId, name: authorization.context.displayName, requestId: requestId(req) },
        });
        return ok(data, { source: "postgres", status: data.status });
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    logApiError("POST /api/v1/supplier-inquiries/[id]/transition", error);
    return fail("SUPPLIER_INQUIRY_TRANSITION_FAILED", error instanceof Error ? error.message : "Failed to transition supplier inquiry.", 409);
  }
}
