import { fail, logApiError, ok } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import {
  findReservationCandidates,
  getActiveReservationForLine,
  releaseInventoryReservation,
  reserveInventoryForLine,
} from "@/lib/inventory/operations";
import { authorizePurchaseOrderRequest } from "@/lib/auth/entity-access";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getInventoryItem } from "@/lib/inventory/operations";

type Ctx = { params: Promise<{ id: string; lineId: string }> };

async function getLine(id: string, lineId: string) {
  return prisma.purchaseOrderLine.findFirst({
    where: { id: lineId, orderId: id },
    include: { order: { select: { id: true, poNumber: true } } },
  });
}

export async function GET(req: Request, ctx: Ctx) {
  const { id, lineId } = await ctx.params;

  try {
    const authorization = await authorizePurchaseOrderRequest(req, id, PERMISSIONS.APP_READ);
    if (!authorization.ok) return authorization.response;
    if (!authorization.order) return fail("PURCHASE_ORDER_NOT_FOUND", "Purchase order not found.", 404);
    const line = await getLine(id, lineId);
    if (!line) return fail("ORDER_LINE_NOT_FOUND", "Order line not found.", 404);

    const [reservation, candidates] = await Promise.all([
      getActiveReservationForLine(lineId),
      findReservationCandidates({ itemCode: line.itemCode, description: line.description, organizationId: authorization.context.organizationId }),
    ]);
    const conversions = await prisma.inventoryUnitConversion.findMany({ where: { inventoryItemId: { in: candidates.map(row => row.id) }, orderUnit: line.uom.trim().toUpperCase(), status: "Approved" } });

    return ok(
      {
        reservation,
        candidates: candidates.map(row => ({ ...row, stockPerOrderUnit: row.uom.trim().toUpperCase() === line.uom.trim().toUpperCase() ? 1 : Number(conversions.find(conversion => conversion.inventoryItemId === row.id && conversion.stockUnit === row.uom.trim().toUpperCase())?.stockPerOrderUnit) || null })),
        recommendedQuantity: Math.max(0, line.qtyOrdered - line.qtyDelivered),
      },
      { source: "postgres" },
    );
  } catch (error) {
    logApiError("GET /api/v1/purchase-orders/[id]/lines/[lineId]/reservations", error);
    return fail("RESERVATION_LOOKUP_FAILED", "Failed to load reservation candidates.", 500);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const { id, lineId } = await ctx.params;

  try {
    const authorization = await authorizePurchaseOrderRequest(req, id, PERMISSIONS.INVENTORY_WRITE);
    if (!authorization.ok) return authorization.response;
    if (!authorization.order) return fail("PURCHASE_ORDER_NOT_FOUND", "Purchase order not found.", 404);
    const line = await getLine(id, lineId);
    if (!line) return fail("ORDER_LINE_NOT_FOUND", "Order line not found.", 404);

    const body = (await req.json()) as Record<string, unknown>;
    const inventoryItemId = typeof body.inventoryItemId === "string" ? body.inventoryItemId : "";
    const quantity = Number(body.quantity);
    if (!inventoryItemId) return fail("INVENTORY_ITEM_REQUIRED", "inventoryItemId is required.", 400);
    if (!await getInventoryItem(inventoryItemId, false, authorization.context.organizationId)) {
      return fail("INVENTORY_ITEM_NOT_FOUND", "Inventory item not found.", 404);
    }

    const reservation = await reserveInventoryForLine({
      inventoryItemId,
      orderId: id,
      orderLineId: lineId,
      quantity,
      referenceLabel: `${line.order.poNumber} line ${line.lineNumber}`,
      note: typeof body.note === "string" ? body.note : null,
      actor: authorization.context.displayName,
    });

    await prisma.purchaseOrderEvent.create({
      data: {
        orderId: id,
        type: "line_updated",
        summary: `Line ${line.lineNumber} inventory reserved`,
        detail: JSON.stringify({ lineId, inventoryItemId, quantity: reservation?.quantity ?? quantity }),
        actor: authorization.context.displayName,
      },
    });

    return ok({ reservation }, { source: "postgres" }, { status: 201 });
  } catch (error) {
    logApiError("POST /api/v1/purchase-orders/[id]/lines/[lineId]/reservations", error);
    const message = error instanceof Error ? error.message : "Failed to reserve inventory.";
    return fail("INVENTORY_RESERVE_FAILED", message, 400);
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { id, lineId } = await ctx.params;

  try {
    const authorization = await authorizePurchaseOrderRequest(req, id, PERMISSIONS.INVENTORY_WRITE);
    if (!authorization.ok) return authorization.response;
    if (!authorization.order) return fail("PURCHASE_ORDER_NOT_FOUND", "Purchase order not found.", 404);
    const line = await getLine(id, lineId);
    if (!line) return fail("ORDER_LINE_NOT_FOUND", "Order line not found.", 404);

    const { searchParams } = new URL(req.url);
    const note = searchParams.get("note") || "Reservation released from purchase order line.";
    const reservation = await releaseInventoryReservation(lineId, note, authorization.context.displayName);
    if (!reservation) return fail("RESERVATION_NOT_FOUND", "No active reservation found for this line.", 404);

    await prisma.purchaseOrderEvent.create({
      data: {
        orderId: id,
        type: "line_updated",
        summary: `Line ${line.lineNumber} inventory reservation released`,
        detail: JSON.stringify({ lineId, reservationId: reservation.id }),
        actor: authorization.context.displayName,
      },
    });

    return ok({ reservation }, { source: "postgres" });
  } catch (error) {
    logApiError("DELETE /api/v1/purchase-orders/[id]/lines/[lineId]/reservations", error);
    const message = error instanceof Error ? error.message : "Failed to release reservation.";
    return fail("INVENTORY_RELEASE_FAILED", message, 400);
  }
}
