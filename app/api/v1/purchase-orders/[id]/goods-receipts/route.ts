import { fail, logApiError, ok, requestId } from "@/lib/api/response";
import { executeIdempotentRequest } from "@/lib/api/idempotency";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { createGoodsReceipt, listGoodsReceipts, type CreateGoodsReceiptLineInput } from "@/lib/goods-receipts/service";

function parseLines(value: unknown): CreateGoodsReceiptLineInput[] {
  if (!Array.isArray(value)) throw new ApiRequestError("GOODS_RECEIPT_LINES_REQUIRED", "lines must be an array.", 400);
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new ApiRequestError("GOODS_RECEIPT_LINE_INVALID", `Line ${index + 1} must be an object.`, 400);
    const row = entry as Record<string, unknown>;
    const purchaseOrderLineId = typeof row.purchaseOrderLineId === "string" ? row.purchaseOrderLineId.trim() : "";
    const quantity = typeof row.quantity === "number" ? row.quantity : Number(row.quantity);
    if (!purchaseOrderLineId || !Number.isFinite(quantity)) throw new ApiRequestError("GOODS_RECEIPT_LINE_INVALID", `Line ${index + 1} requires purchaseOrderLineId and a numeric quantity.`, 400);
    return {
      purchaseOrderLineId,
      quantity,
      inventoryItemId: typeof row.inventoryItemId === "string" ? row.inventoryItemId.trim() || null : null,
      notes: typeof row.notes === "string" ? row.notes.trim() || null : null,
    };
  });
}

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!authorization.ok) return authorization.response;
    const { id } = await context.params;
    const data = await listGoodsReceipts(authorization.context.organizationId, decodeURIComponent(id));
    return ok(data, { source: "postgres" });
  } catch (error) {
    logApiError("GET /api/v1/purchase-orders/[id]/goods-receipts", error);
    return fail("GOODS_RECEIPT_LIST_FAILED", "Failed to load goods receipts.", 500);
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
      route: "POST /api/v1/purchase-orders/:id/goods-receipts",
      handler: async () => {
        const body = await readJsonObject(req);
        const receivedAt = typeof body.receivedAt === "string" && body.receivedAt ? new Date(body.receivedAt) : undefined;
        if (receivedAt && Number.isNaN(receivedAt.getTime())) return fail("RECEIVED_AT_INVALID", "receivedAt must be a valid date.", 400);
        const data = await createGoodsReceipt({
          organizationId: authorization.context.organizationId,
          legalEntityId: authorization.context.activeLegalEntityId,
          purchaseOrderId: decodeURIComponent(id),
          supplierDeliveryNote: typeof body.supplierDeliveryNote === "string" ? body.supplierDeliveryNote : null,
          warehouse: typeof body.warehouse === "string" ? body.warehouse : null,
          notes: typeof body.notes === "string" ? body.notes : null,
          receivedAt,
          sourceKey: typeof body.sourceKey === "string" ? body.sourceKey : null,
          lines: parseLines(body.lines),
          actor: {
            id: authorization.context.userId,
            name: authorization.context.displayName,
            requestId: requestId(req),
          },
        });
        return ok(data, { source: "postgres", status: "draft" }, { status: 201 });
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    logApiError("POST /api/v1/purchase-orders/[id]/goods-receipts", error);
    return fail("GOODS_RECEIPT_CREATE_FAILED", error instanceof Error ? error.message : "Failed to create goods receipt.", 409);
  }
}
