import { randomUUID } from "node:crypto";
import { frozenStockQuantity } from "@/lib/inventory/unit-conversions";
import {
  AuditActorType,
  DeliveryStatus,
  NumberSequenceDocumentType,
  Prisma,
} from "@prisma/client";
import { ERP_AUDIT_EVENTS, recordAuditEvent } from "@/lib/erp-core/audit";
import { DELIVERY_LIFECYCLE, assertTransitionStatus } from "@/lib/erp-core/lifecycle";
import { issueNumber } from "@/lib/erp-core/number-sequences";
import { provenanceKindForOrganizationDataMode, recordProvenance } from "@/lib/erp-core/provenance";
import { prisma } from "@/lib/prisma";
import { synchronizeSalesOrderFromFulfillment } from "@/lib/sales-orders/service";

const deliveryInclude = {
  purchaseOrder: { select: { id: true, poNumber: true, buyerName: true, vessel: true, vesselImo: true, port: true, currency: true } },
  shippingCompany: { select: { id: true, name: true, partyId: true } },
  party: { select: { id: true, displayName: true } },
  lines: {
    include: {
      purchaseOrderLine: { select: { id: true, lineNumber: true, itemCode: true, description: true, uom: true, qtyOrdered: true, qtyDelivered: true, status: true } },
      inventoryItem: { select: { id: true, itemCode: true, description: true, warehouse: true } },
      inventoryReservation: { select: { id: true, quantity: true, status: true } },
    },
    orderBy: { purchaseOrderLine: { lineNumber: "asc" as const } },
  },
} satisfies Prisma.DeliveryInclude;

type DeliveryWithContext = Prisma.DeliveryGetPayload<{ include: typeof deliveryInclude }>;

export interface DeliveryActor {
  id?: string | null;
  name?: string | null;
  type?: AuditActorType;
  requestId?: string | null;
}

export interface CreateDeliveryLineInput {
  purchaseOrderLineId: string;
  quantity: number;
  notes?: string | null;
}

export interface CreateDeliveryInput {
  organizationId: string;
  legalEntityId?: string | null;
  purchaseOrderId: string;
  scheduledAt?: Date | null;
  deliveryAddress?: string | null;
  port?: string | null;
  notes?: string | null;
  sourceKey?: string | null;
  lines: CreateDeliveryLineInput[];
  actor?: DeliveryActor;
}

export type DeliveryTransitionAction = "ready" | "dispatch" | "deliver" | "cancel";

function mapDelivery(row: DeliveryWithContext) {
  return {
    id: row.id,
    deliveryNumber: row.deliveryNumber,
    purchaseOrderId: row.purchaseOrderId,
    poNumber: row.purchaseOrder.poNumber,
    shippingCompanyId: row.shippingCompanyId,
    partyId: row.partyId,
    customerName: row.customerName,
    vessel: row.vessel,
    vesselImo: row.vesselImo,
    port: row.port,
    deliveryAddress: row.deliveryAddress,
    status: row.status.toLowerCase() as "draft" | "ready" | "dispatched" | "delivered" | "cancelled",
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    dispatchedAt: row.dispatchedAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    deliveredToName: row.deliveredToName,
    notes: row.notes,
    lines: row.lines.map((line) => ({
      id: line.id,
      purchaseOrderLineId: line.purchaseOrderLineId,
      lineNumber: line.purchaseOrderLine.lineNumber,
      itemCode: line.purchaseOrderLine.itemCode,
      description: line.purchaseOrderLine.description,
      uom: line.purchaseOrderLine.uom,
      quantity: line.quantity,
      orderedQuantity: line.purchaseOrderLine.qtyOrdered,
      deliveredQuantity: line.purchaseOrderLine.qtyDelivered,
      inventoryItem: line.inventoryItem,
      inventoryReservationId: line.inventoryReservationId,
      inventoryMovementId: line.inventoryMovementId,
      notes: line.notes,
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listDeliveries(organizationId: string, purchaseOrderId?: string) {
  const rows = await prisma.delivery.findMany({
    where: { organizationId, ...(purchaseOrderId ? { purchaseOrderId } : {}) },
    include: deliveryInclude,
    orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
  });
  return rows.map(mapDelivery);
}

async function issueDeliveryNumber(organizationId: string, legalEntityId?: string | null) {
  if (!legalEntityId) return null;
  const issued = await issueNumber({
    organizationId,
    legalEntityId,
    documentType: NumberSequenceDocumentType.Delivery,
    prefix: "DLV",
    padding: 5,
    metadata: { source: "delivery" },
  });
  return issued.number;
}

function validateLines(lines: CreateDeliveryLineInput[]) {
  if (lines.length === 0) throw new Error("At least one delivery line is required.");
  const ids = new Set<string>();
  for (const line of lines) {
    if (!line.purchaseOrderLineId.trim()) throw new Error("Each delivery line requires a purchaseOrderLineId.");
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) throw new Error("Delivery quantities must be greater than zero.");
    if (ids.has(line.purchaseOrderLineId)) throw new Error("A purchase order line can appear only once per delivery.");
    ids.add(line.purchaseOrderLineId);
  }
}

export async function createDelivery(input: CreateDeliveryInput) {
  validateLines(input.lines);
  const order = await prisma.purchaseOrder.findFirst({
    where: { id: input.purchaseOrderId, organizationId: input.organizationId },
    include: {
      lines: { where: { id: { in: input.lines.map((line) => line.purchaseOrderLineId) } } },
      organization: { select: { dataMode: true } },
    },
  });
  if (!order) throw new Error("Customer purchase order was not found in the active organization.");
  if (order.orderType !== "BuyerPO") throw new Error("Outbound deliveries can only be created for inbound customer purchase orders.");
  if (order.lines.length !== input.lines.length) throw new Error("One or more delivery lines do not belong to the customer purchase order.");
  if (input.legalEntityId) {
    const valid = await prisma.legalEntity.count({ where: { id: input.legalEntityId, organizationId: input.organizationId } });
    if (!valid) throw new Error("Legal entity does not belong to the active organization.");
  }
  const customerName = order.buyerName?.trim() || order.vesselOwner?.trim() || "Unassigned shipping company";
  const shippingCompany = await prisma.shippingCompany.findFirst({
    where: { organizationId: input.organizationId, name: { equals: customerName, mode: "insensitive" } },
    select: { id: true, partyId: true },
  });
  const deliveryNumber = await issueDeliveryNumber(input.organizationId, input.legalEntityId);

  const created = await prisma.$transaction(async (tx) => {
    const activeLines = await tx.deliveryLine.findMany({
      where: {
        purchaseOrderLineId: { in: input.lines.map((line) => line.purchaseOrderLineId) },
        delivery: { organizationId: input.organizationId, status: { in: [DeliveryStatus.Draft, DeliveryStatus.Ready, DeliveryStatus.Dispatched] } },
      },
      select: { purchaseOrderLineId: true, quantity: true },
    });
    const committed = new Map<string, number>();
    for (const line of activeLines) committed.set(line.purchaseOrderLineId, (committed.get(line.purchaseOrderLineId) ?? 0) + line.quantity);
    const orderLines = new Map(order.lines.map((line) => [line.id, line]));
    const lineData: Array<CreateDeliveryLineInput & { inventoryItemId: string | null; inventoryReservationId: string | null }> = [];
    for (const line of input.lines) {
      const orderLine = orderLines.get(line.purchaseOrderLineId)!;
      if (orderLine.qtyDelivered + (committed.get(line.purchaseOrderLineId) ?? 0) + line.quantity > orderLine.qtyOrdered + 0.000001) {
        throw new Error(`Delivery quantity exceeds the remaining quantity for customer PO line ${orderLine.lineNumber}.`);
      }
      const reservation = await tx.inventoryReservation.findFirst({
        where: { orderId: order.id, orderLineId: orderLine.id, status: "Active" },
        include: { inventoryItem: true },
        orderBy: { reservedAt: "asc" },
      });
      if (reservation) {
        if (reservation.inventoryItem.organizationId !== input.organizationId) throw new Error(`Reserved inventory for customer PO line ${orderLine.lineNumber} is outside the active organization.`);
        const quantity = frozenStockQuantity(line.quantity, reservation, orderLine.uom, reservation.inventoryItem.uom);
        if (reservation.quantity < quantity) throw new Error(`Inventory reservation does not cover customer PO line ${orderLine.lineNumber}.`);
      }
      lineData.push({ ...line, inventoryItemId: reservation?.inventoryItemId ?? null, inventoryReservationId: reservation?.id ?? null });
    }

    const row = await tx.delivery.create({
      data: {
        organizationId: input.organizationId,
        legalEntityId: input.legalEntityId ?? null,
        purchaseOrderId: order.id,
        shippingCompanyId: shippingCompany?.id ?? null,
        partyId: shippingCompany?.partyId ?? null,
        deliveryNumber,
        sourceKey: input.sourceKey?.trim() || `manual:${randomUUID()}`,
        customerName,
        vessel: order.vessel,
        vesselImo: order.vesselImo,
        port: input.port?.trim() || order.port,
        deliveryAddress: input.deliveryAddress?.trim() || null,
        scheduledAt: input.scheduledAt ?? order.eta,
        notes: input.notes?.trim() || null,
        createdById: input.actor?.id ?? null,
        createdByName: input.actor?.name ?? null,
        lines: {
          create: lineData.map((line) => ({
            purchaseOrderLineId: line.purchaseOrderLineId,
            inventoryItemId: line.inventoryItemId,
            inventoryReservationId: line.inventoryReservationId,
            quantity: line.quantity,
            notes: line.notes?.trim() || null,
          })),
        },
      },
    });
    await tx.purchaseOrderEvent.create({
      data: {
        orderId: order.id,
        type: "delivery_created",
        summary: `Delivery ${deliveryNumber ?? row.id} created`,
        detail: JSON.stringify({ deliveryId: row.id, deliveryNumber, lineCount: input.lines.length }),
        actor: input.actor?.name ?? "operator",
      },
    });
    await recordAuditEvent({
      organizationId: input.organizationId,
      entityType: "Delivery",
      entityId: row.id,
      entityNumber: row.deliveryNumber,
      eventType: ERP_AUDIT_EVENTS.CREATED,
      actorType: input.actor?.type ?? AuditActorType.Operator,
      actorId: input.actor?.id,
      actorName: input.actor?.name,
      sourceModule: "deliveries",
      after: { status: row.status, purchaseOrderId: row.purchaseOrderId, lineCount: input.lines.length },
      requestId: input.actor?.requestId,
    }, tx);
    await recordProvenance({
      organizationId: input.organizationId,
      entityType: "Delivery",
      entityId: row.id,
      kind: provenanceKindForOrganizationDataMode(order.organization!.dataMode),
      source: "customer_purchase_order",
      metadata: { purchaseOrderId: order.id },
    }, tx);
    return tx.delivery.findUniqueOrThrow({ where: { id: row.id }, include: deliveryInclude });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return mapDelivery(created);
}

function targetStatus(action: DeliveryTransitionAction) {
  if (action === "ready") return DeliveryStatus.Ready;
  if (action === "dispatch") return DeliveryStatus.Dispatched;
  if (action === "deliver") return DeliveryStatus.Delivered;
  return DeliveryStatus.Cancelled;
}

async function issueReservedStock(tx: Prisma.TransactionClient, delivery: DeliveryWithContext, actor?: DeliveryActor) {
  for (const line of delivery.lines) {
    if (!line.inventoryReservationId || !line.inventoryItemId) continue;
    const reservation = await tx.inventoryReservation.findFirst({
      where: { id: line.inventoryReservationId, orderId: delivery.purchaseOrderId, orderLineId: line.purchaseOrderLineId, status: "Active" },
      include: { inventoryItem: true },
    });
    if (!reservation || reservation.inventoryItemId !== line.inventoryItemId) throw new Error(`Inventory reservation for delivery line ${line.purchaseOrderLine.lineNumber} is no longer active.`);
    const issueQuantity = frozenStockQuantity(line.quantity, reservation, line.purchaseOrderLine.uom, reservation.inventoryItem.uom);
    if (reservation.quantity < issueQuantity) throw new Error(`Inventory reservation no longer covers delivery line ${line.purchaseOrderLine.lineNumber}.`);
    if (reservation.inventoryItem.organizationId !== delivery.organizationId) throw new Error("Reserved inventory is outside the active organization.");
    if (reservation.inventoryItem.onHand < issueQuantity || reservation.inventoryItem.reserved < issueQuantity) throw new Error(`Insufficient reserved stock for delivery line ${line.purchaseOrderLine.lineNumber}.`);
    const remaining = reservation.quantity - issueQuantity;
    const movement = await tx.inventoryMovement.create({
      data: {
        inventoryItemId: reservation.inventoryItemId,
        movementType: "delivery_issue",
        quantity: -issueQuantity,
        quantityBefore: reservation.inventoryItem.onHand,
        quantityAfter: reservation.inventoryItem.onHand - issueQuantity,
        source: "delivery",
        referenceType: "delivery",
        referenceId: delivery.id,
        referenceLabel: delivery.deliveryNumber ?? delivery.id,
        idempotencyKey: `delivery-line:${line.id}:dispatch`,
        note: `Dispatch for ${delivery.purchaseOrder.poNumber} line ${line.purchaseOrderLine.lineNumber}.`,
        actor: actor?.name ?? "operator",
      },
    });
    await tx.inventoryItem.update({ where: { id: reservation.inventoryItemId }, data: { onHand: { decrement: issueQuantity }, reserved: { decrement: issueQuantity } } });
    await tx.inventoryReservation.update({
      where: { id: reservation.id },
      data: remaining > 0 ? { quantity: remaining } : { quantity: 0, status: "Issued", issuedAt: new Date() },
    });
    await tx.deliveryLine.update({ where: { id: line.id }, data: { inventoryMovementId: movement.id } });
  }
}

export async function transitionDelivery(input: {
  organizationId: string;
  id: string;
  action: DeliveryTransitionAction;
  deliveredToName?: string | null;
  deliveredAt?: Date | null;
  actor?: DeliveryActor;
}) {
  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.delivery.findFirst({ where: { id: input.id, organizationId: input.organizationId }, include: deliveryInclude });
    if (!current) throw new Error("Delivery was not found in the active organization.");
    const nextStatus = targetStatus(input.action);
    if (current.status === nextStatus) return current;
    assertTransitionStatus(DELIVERY_LIFECYCLE, current.status, nextStatus);
    if (input.action === "deliver" && !input.deliveredToName?.trim()) throw new Error("Recipient name is required to complete a delivery.");
    const now = new Date();

    if (input.action === "ready") {
      for (const line of current.lines) {
        if (!line.inventoryReservationId) continue;
        const reservation = await tx.inventoryReservation.findFirst({ where: { id: line.inventoryReservationId, status: "Active" }, include: { inventoryItem: true } });
        if (!reservation || reservation.quantity < frozenStockQuantity(line.quantity, reservation, line.purchaseOrderLine.uom, reservation.inventoryItem.uom)) throw new Error(`Inventory reservation for delivery line ${line.purchaseOrderLine.lineNumber} is not ready.`);
      }
    } else if (input.action === "dispatch") {
      await issueReservedStock(tx, current, input.actor);
      await tx.purchaseOrder.update({ where: { id: current.purchaseOrderId }, data: { status: "In_Transit" } });
      await synchronizeSalesOrderFromFulfillment(tx, current.purchaseOrderId, { started: true, actor: input.actor });
    } else if (input.action === "deliver") {
      for (const line of current.lines) {
        const orderLine = await tx.purchaseOrderLine.findUniqueOrThrow({ where: { id: line.purchaseOrderLineId } });
        const nextDelivered = orderLine.qtyDelivered + line.quantity;
        if (nextDelivered > orderLine.qtyOrdered + 0.000001) throw new Error(`Delivery quantity exceeds customer PO line ${orderLine.lineNumber}.`);
        await tx.purchaseOrderLine.update({
          where: { id: orderLine.id },
          data: { qtyDelivered: nextDelivered, status: nextDelivered >= orderLine.qtyOrdered ? "Delivered" : "Partially_Delivered" },
        });
      }
      const remainingLines = await tx.purchaseOrderLine.count({ where: { orderId: current.purchaseOrderId, status: { notIn: ["Delivered", "Cancelled"] } } });
      if (remainingLines === 0) await tx.purchaseOrder.update({ where: { id: current.purchaseOrderId }, data: { status: "Delivered" } });
      await synchronizeSalesOrderFromFulfillment(tx, current.purchaseOrderId, { started: true, actor: input.actor });
    }

    const updated = await tx.delivery.updateMany({
      where: { id: current.id, organizationId: input.organizationId, status: current.status, version: current.version },
      data: {
        status: nextStatus,
        dispatchedAt: nextStatus === DeliveryStatus.Dispatched ? now : current.dispatchedAt,
        deliveredAt: nextStatus === DeliveryStatus.Delivered ? input.deliveredAt ?? now : current.deliveredAt,
        deliveredToName: nextStatus === DeliveryStatus.Delivered ? input.deliveredToName!.trim() : current.deliveredToName,
        cancelledAt: nextStatus === DeliveryStatus.Cancelled ? now : current.cancelledAt,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new Error("Delivery changed concurrently; reload and retry.");
    await tx.purchaseOrderEvent.create({
      data: {
        orderId: current.purchaseOrderId,
        type: `delivery_${input.action}`,
        summary: `Delivery ${current.deliveryNumber ?? current.id} changed from ${current.status} to ${nextStatus}`,
        detail: JSON.stringify({ deliveryId: current.id, deliveryNumber: current.deliveryNumber, recipient: input.deliveredToName ?? null }),
        actor: input.actor?.name ?? "operator",
      },
    });
    await recordAuditEvent({
      organizationId: input.organizationId,
      entityType: "Delivery",
      entityId: current.id,
      entityNumber: current.deliveryNumber,
      eventType: ERP_AUDIT_EVENTS.STATUS_CHANGED,
      actorType: input.actor?.type ?? AuditActorType.Operator,
      actorId: input.actor?.id,
      actorName: input.actor?.name,
      sourceModule: "deliveries",
      before: { status: current.status },
      after: { status: nextStatus },
      metadata: { action: input.action, recipient: input.deliveredToName ?? null },
      requestId: input.actor?.requestId,
    }, tx);
    return tx.delivery.findUniqueOrThrow({ where: { id: current.id }, include: deliveryInclude });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return mapDelivery(result);
}
