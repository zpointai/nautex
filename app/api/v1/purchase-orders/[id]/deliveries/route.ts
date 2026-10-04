import { fail, logApiError, ok, requestId } from "@/lib/api/response";
import { executeIdempotentRequest } from "@/lib/api/idempotency";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { createDelivery, listDeliveries, type CreateDeliveryLineInput } from "@/lib/deliveries/service";

function parseLines(value: unknown): CreateDeliveryLineInput[] {
  if (!Array.isArray(value)) throw new ApiRequestError("DELIVERY_LINES_REQUIRED", "lines must be an array.", 400);
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new ApiRequestError("DELIVERY_LINE_INVALID", `Line ${index + 1} must be an object.`, 400);
    const row = entry as Record<string, unknown>;
    const purchaseOrderLineId = typeof row.purchaseOrderLineId === "string" ? row.purchaseOrderLineId.trim() : "";
    const quantity = typeof row.quantity === "number" ? row.quantity : Number(row.quantity);
    if (!purchaseOrderLineId || !Number.isFinite(quantity)) throw new ApiRequestError("DELIVERY_LINE_INVALID", `Line ${index + 1} requires purchaseOrderLineId and a numeric quantity.`, 400);
    return { purchaseOrderLineId, quantity, notes: typeof row.notes === "string" ? row.notes.trim() || null : null };
  });
}

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!authorization.ok) return authorization.response;
    const { id } = await context.params;
    const data = await listDeliveries(authorization.context.organizationId, decodeURIComponent(id));
    return ok(data, { source: "postgres" });
  } catch (error) {
    logApiError("GET /api/v1/purchase-orders/[id]/deliveries", error);
    return fail("DELIVERY_LIST_FAILED", "Failed to load deliveries.", 500);
  }
}

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.PROCUREMENT_WRITE);
    if (!authorization.ok) return authorization.response;
    const { id } = await context.params;
    return await executeIdempotentRequest({
      request: req,
      organizationId: authorization.context.organizationId,
      route: "POST /api/v1/purchase-orders/:id/deliveries",
      handler: async () => {
        const body = await readJsonObject(req);
        const scheduledAt = typeof body.scheduledAt === "string" && body.scheduledAt ? new Date(body.scheduledAt) : null;
        if (scheduledAt && Number.isNaN(scheduledAt.getTime())) return fail("SCHEDULED_AT_INVALID", "scheduledAt must be a valid date.", 400);
        const data = await createDelivery({
          organizationId: authorization.context.organizationId,
          legalEntityId: authorization.context.activeLegalEntityId,
          purchaseOrderId: decodeURIComponent(id),
          scheduledAt,
          deliveryAddress: typeof body.deliveryAddress === "string" ? body.deliveryAddress : null,
          port: typeof body.port === "string" ? body.port : null,
          notes: typeof body.notes === "string" ? body.notes : null,
          sourceKey: typeof body.sourceKey === "string" ? body.sourceKey : null,
          lines: parseLines(body.lines),
          actor: { id: authorization.context.userId, name: authorization.context.displayName, requestId: requestId(req) },
        });
        return ok(data, { source: "postgres", status: "draft" }, { status: 201 });
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    logApiError("POST /api/v1/purchase-orders/[id]/deliveries", error);
    return fail("DELIVERY_CREATE_FAILED", error instanceof Error ? error.message : "Failed to create delivery.", 409);
  }
}
