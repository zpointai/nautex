import { fail, logApiError, ok, requestId } from "@/lib/api/response";
import { executeIdempotentRequest } from "@/lib/api/idempotency";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { transitionBackorder, type BackorderTransitionAction } from "@/lib/backorders/service";

const ACTIONS = new Set<BackorderTransitionAction>(["escalate", "resolve", "dismiss", "reopen"]);

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.PROCUREMENT_WRITE);
    if (!authorization.ok) return authorization.response;
    const { id } = await context.params;
    return await executeIdempotentRequest({
      request: req,
      organizationId: authorization.context.organizationId,
      route: "POST /api/v1/backorders/:id/transition",
      handler: async () => {
        const body = await readJsonObject(req);
        const action = typeof body.action === "string" ? body.action as BackorderTransitionAction : null;
        if (!action || !ACTIONS.has(action)) return fail("BACKORDER_ACTION_INVALID", "Action must be escalate, resolve, dismiss, or reopen.", 400);
        const result = await transitionBackorder({
          organizationId: authorization.context.organizationId,
          id: decodeURIComponent(id),
          action,
          note: typeof body.note === "string" ? body.note.trim() || null : null,
          actor: {
            id: authorization.context.userId,
            name: authorization.context.displayName,
            requestId: requestId(req),
          },
        });
        return ok(result.backorder, { source: "postgres", status: result.changed ? "changed" : "unchanged" });
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    logApiError("POST /api/v1/backorders/[id]/transition", error);
    return fail("BACKORDER_TRANSITION_FAILED", error instanceof Error ? error.message : "Failed to transition backorder.", 409);
  }
}
