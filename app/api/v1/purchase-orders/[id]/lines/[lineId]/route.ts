import { NextResponse } from "next/server";
import type { LineStatus, OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { applyPurchaseOrderDeliveryToInventory, issueReservedInventoryForLine } from "@/lib/inventory/operations";
import { authorizePurchaseOrderRequest } from "@/lib/auth/entity-access";
import { PERMISSIONS } from "@/lib/auth/permissions";

/**
 * PATCH /api/v1/purchase-orders/:id/lines/:lineId
 *
 * Update a single order line's editable fields.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; lineId: string }> }
) {
  try {
    const { id, lineId } = await params;
    const authorization = await authorizePurchaseOrderRequest(req, id, PERMISSIONS.PROCUREMENT_WRITE);
    if (!authorization.ok) return authorization.response;
    if (!authorization.order) return NextResponse.json({ ok: false, error: { code: "PURCHASE_ORDER_NOT_FOUND", message: "Purchase order not found." } }, { status: 404 });
    const body = await req.json();

    return await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`purchase-order:${id}`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`inventory-line:${lineId}`}))`;
    // Verify the line belongs to this order
    const existing = await tx.purchaseOrderLine.findFirst({
      where: { id: lineId, orderId: id },
      include: { order: { select: { id: true, poNumber: true, port: true } } },
    });

    if (!existing) {
      return NextResponse.json(
        { ok: false, error: { code: "ORDER_LINE_NOT_FOUND", message: "Order line not found." } },
        { status: 404 }
      );
    }

    // Editable fields allowlist
    const allowed = [
      "description",
      "itemCode",
      "supplierPartNo",
      "qtyOrdered",
      "qtyConfirmed",
      "qtyDelivered",
      "uom",
      "unitPrice",
      "requestedDate",
      "confirmedDate",
      "status",
      "remarks",
    ];

    const data: Record<string, unknown> = {};
    for (const key of allowed) {
      if (body[key] !== undefined) {
        if (["requestedDate", "confirmedDate"].includes(key) && body[key]) {
          data[key] = new Date(body[key]);
        } else if (["requestedDate", "confirmedDate"].includes(key) && body[key] === null) {
          data[key] = null;
        } else {
          data[key] = body[key];
        }
      }
    }

    // Recalculate lineTotal if qty or price changed.
    const qtyOrdered = (data.qtyOrdered as number) ?? existing.qtyOrdered;
    const qtyDelivered = (data.qtyDelivered as number) ?? existing.qtyDelivered;
    const qtyConfirmed = data.qtyConfirmed === null ? null : (data.qtyConfirmed as number | undefined) ?? existing.qtyConfirmed;
    const unitPrice = (data.unitPrice as number) ?? existing.unitPrice;
    if (![qtyOrdered, qtyDelivered, unitPrice].every(value => typeof value === "number" && Number.isFinite(value) && value >= 0) || qtyDelivered > qtyOrdered) throw new Error("Enter valid quantities and price; delivered quantity cannot exceed ordered quantity.");
    const allocation = await tx.inventoryReservation.findFirst({ where: { orderLineId: lineId, status: "Active" } });
    if (allocation && data.uom !== undefined && data.uom !== existing.uom) throw new Error("Release the inventory reservation before changing the order unit.");
    if (qtyDelivered < existing.qtyDelivered && await tx.inventoryMovement.count({ where: { referenceId: lineId, movementType: "reservation_issue" } })) throw new Error("Use a reviewed stock return to reverse an issued delivery.");
    data.lineTotal = qtyOrdered * unitPrice;

    // Delivered quantities should drive line status unless the caller explicitly chose a status.
    if (body.status === undefined) {
      if (qtyDelivered >= qtyOrdered && qtyOrdered > 0) {
        data.status = "Delivered";
        if (!existing.confirmedDate && data.confirmedDate === undefined) data.confirmedDate = new Date();
      } else if (qtyDelivered > 0) {
        data.status = "Partially_Delivered";
      } else if (existing.status === "Delivered" || existing.status === "Partially_Delivered") {
        data.status = qtyConfirmed != null && qtyConfirmed >= qtyOrdered ? "Confirmed" : "Open";
      }
    }

    const line = await tx.purchaseOrderLine.update({
      where: { id: lineId },
      data,
    });

    // Recalculate PO header total from all lines
    const allLines = await tx.purchaseOrderLine.findMany({
      where: { orderId: id },
      select: { lineTotal: true },
    });
    const newTotal = allLines.reduce((sum, l) => sum + l.lineTotal, 0);

    // Also update confirmStatus and operational order status based on lines.
    const allLinesForStatus = await tx.purchaseOrderLine.findMany({
      where: { orderId: id },
      select: { qtyOrdered: true, qtyConfirmed: true, qtyDelivered: true, status: true, requestedDate: true },
    });
    const allConfirmed = allLinesForStatus.every(
      (l) => l.qtyConfirmed != null && l.qtyConfirmed >= l.qtyOrdered
    );
    const someConfirmed = allLinesForStatus.some(
      (l) => l.qtyConfirmed != null && l.qtyConfirmed > 0
    );
    const anyRejected = allLinesForStatus.some(
      (l) => l.status === "Cancelled"
    );

    let confirmStatus: string = "Unconfirmed";
    if (anyRejected) confirmStatus = "Rejected";
    else if (allConfirmed) confirmStatus = "Confirmed";
    else if (someConfirmed) confirmStatus = "Partially_Confirmed";

    const now = Date.now();
    const allDelivered = allLinesForStatus.length > 0 && allLinesForStatus.every(
      (l) => l.status === "Delivered" || l.qtyDelivered >= l.qtyOrdered
    );
    const someDelivered = allLinesForStatus.some((l) => l.qtyDelivered > 0);
    const anyBackordered = allLinesForStatus.some((l) => l.status === "Backordered");
    const anyOverdueOpen = allLinesForStatus.some(
      (l) => l.requestedDate && l.requestedDate.getTime() < now && l.status !== "Delivered" && l.status !== "Cancelled"
    );

    let orderStatus: OrderStatus | undefined;
    if (allDelivered) orderStatus = "Delivered";
    else if (anyBackordered || anyOverdueOpen) orderStatus = "At_Risk";
    else if (someDelivered) orderStatus = "In_Transit";

    await tx.purchaseOrder.update({
      where: { id },
      data: {
        total: newTotal,
        confirmStatus: confirmStatus as import("@prisma/client").ConfirmStatus,
        ...(orderStatus ? { status: orderStatus } : {}),
      },
    });

    if (body.qtyDelivered !== undefined || data.status === "Delivered" || data.status === "Partially_Delivered") {
      const deliveredDelta = qtyDelivered - existing.qtyDelivered;
      if (deliveredDelta !== 0) {
        const movementKey = `po-line-delivery:${lineId}:delivered:${qtyDelivered}`;
        try {
          const issuedReservation = await issueReservedInventoryForLine({
            tx, orderLineId: lineId,
            deliveredDelta,
            idempotencyKey: `reservation-issue:${movementKey}`,
            note: `Reserved stock issued by ${existing.order.poNumber} delivery update.`,
          });

          if (!issuedReservation) {
            await applyPurchaseOrderDeliveryToInventory({
              tx, organizationId: authorization.context.organizationId, lineId,
              lineNumber: line.lineNumber,
              itemCode: line.itemCode,
              description: line.description,
              uom: line.uom,
              deliveredDelta,
              idempotencyKey: `po-receipt:${movementKey}`,
              poId: id,
              poNumber: existing.order.poNumber,
              warehouse: existing.order.port ? `${existing.order.port} Receiving` : "PO Receipts",
            });
          }
        } catch (inventoryError) {
          throw inventoryError;
        }
      }

      await tx.purchaseOrderEvent.create({
        data: {
          orderId: id,
          type: "delivery_updated",
          summary: allDelivered ? "Order marked delivered from line quantities" : `Line ${line.lineNumber} delivery updated`,
          detail: JSON.stringify({
            lineId,
            lineNumber: line.lineNumber,
            qtyOrdered,
            qtyDelivered,
            lineStatus: line.status,
            orderStatus,
          }),
          actor: authorization.context.displayName,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      data: {
        line,
        orderStatus: orderStatus ?? null,
        confirmStatus,
        total: newTotal,
      },
      meta: { source: "postgres" },
    });
    }, { timeout: 15000 });
  } catch (err) {
    console.error("Line PATCH error:", err);
    return NextResponse.json(
      { ok: false, error: { code: "ORDER_LINE_UPDATE_FAILED", message: err instanceof Error ? err.message : "Failed to update order line." } },
      { status: 500 }
    );
  }
}
