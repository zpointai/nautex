import { fail, logApiError, ok, requestId } from "@/lib/api/response";
import { executeIdempotentRequest } from "@/lib/api/idempotency";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { transitionGoodsReceipt } from "@/lib/goods-receipts/service";

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.PROCUREMENT_WRITE);
    if (!authorization.ok) return authorization.response;
    const { id } = await context.params;
    return await executeIdempotentRequest({
      request: req,
      organizationId: authorization.context.organizationId,
      route: "POST /api/v1/goods-receipts/:id/transition",
      handler: async () => {
        const body = await readJsonObject(req);
        if (body.action !== "post" && body.action !== "cancel") return fail("GOODS_RECEIPT_ACTION_INVALID", "Action must be post or cancel.", 400);
        const data = await transitionGoodsReceipt({
          organizationId: authorization.context.organizationId,
          id: decodeURIComponent(id),
          action: body.action,
          actor: {
            id: authorization.context.userId,
            name: authorization.context.displayName,
            requestId: requestId(req),
          },
        });
        return ok(data, { source: "postgres", status: data.status });
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    logApiError("POST /api/v1/goods-receipts/[id]/transition", error);
    return fail("GOODS_RECEIPT_TRANSITION_FAILED", error instanceof Error ? error.message : "Failed to transition goods receipt.", 409);
  }
}
