import { randomUUID } from "node:crypto";
import { resolveUnitConversion, stockQuantity, frozenStockQuantity } from "@/lib/inventory/unit-conversions";
import {
  AuditActorType,
  BackorderLineStatus,
  BackorderStatus,
  GoodsReceiptStatus,
  NumberSequenceDocumentType,
  Prisma,
} from "@prisma/client";
import { ERP_AUDIT_EVENTS, recordAuditEvent } from "@/lib/erp-core/audit";
import { GOODS_RECEIPT_LIFECYCLE, assertTransitionStatus } from "@/lib/erp-core/lifecycle";
import { issueNumber } from "@/lib/erp-core/number-sequences";
import { provenanceKindForOrganizationDataMode, recordProvenance } from "@/lib/erp-core/provenance";
import { prisma } from "@/lib/prisma";

const receiptInclude = {
  purchaseOrder: { select: { id: true, poNumber: true, supplier: true, vessel: true, currency: true } },
  supplier: { select: { id: true, name: true, partyId: true } },
  party: { select: { id: true, displayName: true } },
  lines: {
    include: {
      purchaseOrderLine: { select: { id: true, lineNumber: true, itemCode: true, description: true, uom: true, qtyOrdered: true, qtyDelivered: true, status: true } },
      inventoryItem: { select: { id: true, itemCode: true, description: true, warehouse: true } },
    },
    orderBy: { purchaseOrderLine: { lineNumber: "asc" as const } },
  },
} satisfies Prisma.GoodsReceiptInclude;

type ReceiptWithContext = Prisma.GoodsReceiptGetPayload<{ include: typeof receiptInclude }>;

export interface GoodsReceiptActor {
  id?: string | null;
  name?: string | null;
  type?: AuditActorType;
  requestId?: string | null;
}

export interface CreateGoodsReceiptLineInput {
  purchaseOrderLineId: string;
  quantity: number;
  inventoryItemId?: string | null;
  notes?: string | null;
}

export interface CreateGoodsReceiptInput {
  organizationId: string;
  legalEntityId?: string | null;
  purchaseOrderId: string;
  supplierDeliveryNote?: string | null;
  warehouse?: string | null;
  notes?: string | null;
  receivedAt?: Date;
  sourceKey?: string | null;
  lines: CreateGoodsReceiptLineInput[];
  actor?: GoodsReceiptActor;
}

function mapReceipt(row: ReceiptWithContext) {
  return {
    id: row.id,
    receiptNumber: row.receiptNumber,
    purchaseOrderId: row.purchaseOrderId,
    poNumber: row.purchaseOrder.poNumber,
    supplier: row.supplier?.name ?? row.purchaseOrder.supplier,
    supplierId: row.supplierId,
    partyId: row.partyId,
    vessel: row.purchaseOrder.vessel,
    status: row.status.toLowerCase() as "draft" | "posted" | "cancelled",
    supplierDeliveryNote: row.supplierDeliveryNote,
    warehouse: row.warehouse,
    notes: row.notes,
    receivedAt: row.receivedAt.toISOString(),
    receivedByName: row.receivedByName,
    postedAt: row.postedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
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
      inventoryMovementId: line.inventoryMovementId,
      notes: line.notes,
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listGoodsReceipts(organizationId: string, purchaseOrderId?: string) {
  const rows = await prisma.goodsReceipt.findMany({
    where: { organizationId, ...(purchaseOrderId ? { purchaseOrderId } : {}) },
    include: receiptInclude,
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
  });
  return rows.map(mapReceipt);
}

export async function getGoodsReceipt(id: string, organizationId: string) {
  const row = await prisma.goodsReceipt.findFirst({ where: { id, organizationId }, include: receiptInclude });
  return row ? mapReceipt(row) : null;
}

async function issueReceiptNumber(organizationId: string, legalEntityId?: string | null) {
  if (!legalEntityId) return null;
  const issued = await issueNumber({
    organizationId,
    legalEntityId,
    documentType: NumberSequenceDocumentType.GoodsReceipt,
    prefix: "GRN",
    padding: 5,
    metadata: { source: "goods_receipt" },
  });
  return issued.number;
}

function validateInputLines(lines: CreateGoodsReceiptLineInput[]) {
  if (lines.length === 0) throw new Error("At least one receipt line is required.");
  const ids = new Set<string>();
  for (const line of lines) {
    if (!line.purchaseOrderLineId.trim()) throw new Error("Each receipt line requires a purchaseOrderLineId.");
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) throw new Error("Receipt quantities must be greater than zero.");
    if (ids.has(line.purchaseOrderLineId)) throw new Error("A purchase order line can appear only once per receipt.");
    ids.add(line.purchaseOrderLineId);
  }
}

export async function createGoodsReceipt(input: CreateGoodsReceiptInput) {
  validateInputLines(input.lines);
  const purchaseOrder = await prisma.purchaseOrder.findFirst({
    where: { id: input.purchaseOrderId, organizationId: input.organizationId },
    include: {
      supplierRel: { select: { id: true, partyId: true } },
      lines: { where: { id: { in: input.lines.map((line) => line.purchaseOrderLineId) } } },
      organization: { select: { dataMode: true } },
    },
  });
  if (!purchaseOrder) throw new Error("Purchase order was not found in the active organization.");
  if (purchaseOrder.lines.length !== input.lines.length) throw new Error("One or more receipt lines do not belong to the purchase order.");
  if (input.legalEntityId) {
    const valid = await prisma.legalEntity.count({ where: { id: input.legalEntityId, organizationId: input.organizationId } });
    if (!valid) throw new Error("Legal entity does not belong to the active organization.");
  }
  const receiptNumber = await issueReceiptNumber(input.organizationId, input.legalEntityId);

  const created = await prisma.$transaction(async (tx) => {
    const draftLines = await tx.goodsReceiptLine.findMany({
      where: {
        purchaseOrderLineId: { in: input.lines.map((line) => line.purchaseOrderLineId) },
        goodsReceipt: { organizationId: input.organizationId, status: GoodsReceiptStatus.Draft },
      },
      select: { purchaseOrderLineId: true, quantity: true },
    });
    const reserved = new Map<string, number>();
    for (const line of draftLines) reserved.set(line.purchaseOrderLineId, (reserved.get(line.purchaseOrderLineId) ?? 0) + line.quantity);
    const orderLineMap = new Map(purchaseOrder.lines.map((line) => [line.id, line]));
    const conversions = new Map<string, Awaited<ReturnType<typeof resolveUnitConversion>>>();
    for (const line of input.lines) {
      const orderLine = orderLineMap.get(line.purchaseOrderLineId)!;
      if (orderLine.qtyDelivered + (reserved.get(line.purchaseOrderLineId) ?? 0) + line.quantity > orderLine.qtyOrdered + 0.000001) {
        throw new Error(`Receipt quantity exceeds the remaining quantity for PO line ${orderLine.lineNumber}.`);
      }
      if (line.inventoryItemId) {
        const inventory = await tx.inventoryItem.findFirst({ where: { id: line.inventoryItemId, organizationId: input.organizationId }, select: { id: true, uom: true } });
        if (!inventory) throw new Error(`Inventory item for PO line ${orderLine.lineNumber} is not in the active organization.`);
        const conversion = await resolveUnitConversion(tx, inventory, orderLine.uom);
        stockQuantity(line.quantity, conversion.stockPerOrderUnit);
        conversions.set(line.purchaseOrderLineId, conversion);
      }
    }

    const row = await tx.goodsReceipt.create({
      data: {
        organizationId: input.organizationId,
        legalEntityId: input.legalEntityId ?? null,
        purchaseOrderId: purchaseOrder.id,
        supplierId: purchaseOrder.supplierRel?.id ?? null,
        partyId: purchaseOrder.supplierRel?.partyId ?? null,
        receiptNumber,
        sourceKey: input.sourceKey?.trim() || `manual:${randomUUID()}`,
        supplierDeliveryNote: input.supplierDeliveryNote?.trim() || null,
        warehouse: input.warehouse?.trim() || null,
        notes: input.notes?.trim() || null,
        receivedAt: input.receivedAt ?? new Date(),
        receivedById: input.actor?.id ?? null,
        receivedByName: input.actor?.name ?? null,
        lines: {
          create: input.lines.map((line) => ({
            purchaseOrderLineId: line.purchaseOrderLineId,
            inventoryItemId: line.inventoryItemId ?? null,
            quantity: line.quantity,
            ...conversions.get(line.purchaseOrderLineId),
            notes: line.notes?.trim() || null,
          })),
        },
      },
    });
    await tx.purchaseOrderEvent.create({
      data: {
        orderId: purchaseOrder.id,
        type: "goods_receipt_created",
        summary: `Goods receipt ${receiptNumber ?? row.id} created`,
        detail: JSON.stringify({ goodsReceiptId: row.id, receiptNumber, lineCount: input.lines.length }),
        actor: input.actor?.name ?? "operator",
      },
    });
    await recordAuditEvent({
      organizationId: input.organizationId,
      entityType: "GoodsReceipt",
      entityId: row.id,
      entityNumber: row.receiptNumber,
      eventType: ERP_AUDIT_EVENTS.CREATED,
      actorType: input.actor?.type ?? AuditActorType.Operator,
      actorId: input.actor?.id,
      actorName: input.actor?.name,
      sourceModule: "goods-receipts",
      after: { status: row.status, purchaseOrderId: row.purchaseOrderId, lineCount: input.lines.length },
      requestId: input.actor?.requestId,
    }, tx);
    await recordProvenance({
      organizationId: input.organizationId,
      entityType: "GoodsReceipt",
      entityId: row.id,
      kind: provenanceKindForOrganizationDataMode(purchaseOrder.organization!.dataMode),
      source: "manual_receipt",
      metadata: { purchaseOrderId: purchaseOrder.id },
    }, tx);
    return tx.goodsReceipt.findUniqueOrThrow({ where: { id: row.id }, include: receiptInclude });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return mapReceipt(created);
}

async function resolveCompletedBackorder(tx: Prisma.TransactionClient, organizationId: string, purchaseOrderId: string, actor?: GoodsReceiptActor) {
  const backorder = await tx.backorder.findFirst({
    where: { organizationId, purchaseOrderId, status: { in: [BackorderStatus.Open, BackorderStatus.Escalated] } },
    include: { lines: true },
  });
  if (!backorder || backorder.lines.some((line) => line.status === BackorderLineStatus.Open)) return;
  const now = new Date();
  await tx.backorder.update({ where: { id: backorder.id }, data: { status: BackorderStatus.Resolved, resolvedAt: now, lastReviewedAt: now, version: { increment: 1 } } });
  await recordAuditEvent({
    organizationId,
    entityType: "Backorder",
    entityId: backorder.id,
    entityNumber: backorder.backorderNumber,
    eventType: ERP_AUDIT_EVENTS.STATUS_CHANGED,
    actorType: actor?.type ?? AuditActorType.System,
    actorId: actor?.id,
    actorName: actor?.name ?? "Goods receipt posting",
    sourceModule: "goods-receipts",
    before: { status: backorder.status },
    after: { status: BackorderStatus.Resolved },
    metadata: { reason: "All backordered PO lines were received." },
    requestId: actor?.requestId,
  }, tx);
}

export async function transitionGoodsReceipt(input: {
  organizationId: string;
  id: string;
  action: "post" | "cancel";
  actor?: GoodsReceiptActor;
}) {
  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.goodsReceipt.findFirst({ where: { id: input.id, organizationId: input.organizationId }, include: receiptInclude });
    if (!current) throw new Error("Goods receipt was not found in the active organization.");
    if (current.status !== GoodsReceiptStatus.Draft) throw new Error("Only draft goods receipts can be posted or cancelled.");
    const nextStatus = input.action === "post" ? GoodsReceiptStatus.Posted : GoodsReceiptStatus.Cancelled;
    assertTransitionStatus(GOODS_RECEIPT_LIFECYCLE, current.status, nextStatus);
    const now = new Date();

    if (nextStatus === GoodsReceiptStatus.Posted) {
      for (const line of current.lines) {
        const orderLine = await tx.purchaseOrderLine.findUniqueOrThrow({ where: { id: line.purchaseOrderLineId } });
        const nextDelivered = orderLine.qtyDelivered + line.quantity;
        if (nextDelivered > orderLine.qtyOrdered + 0.000001) throw new Error(`Receipt quantity exceeds PO line ${orderLine.lineNumber}.`);
        if (line.inventoryItemId) {
          const item = await tx.inventoryItem.findFirst({ where: { id: line.inventoryItemId, organizationId: input.organizationId } });
          if (!item) throw new Error(`Inventory item for PO line ${orderLine.lineNumber} is unavailable.`);
          const quantity = frozenStockQuantity(line.quantity, line, orderLine.uom, item.uom);
          const movement = await tx.inventoryMovement.create({
            data: {
              inventoryItemId: item.id,
              movementType: "goods_receipt",
              quantity,
              quantityBefore: item.onHand,
              quantityAfter: item.onHand + quantity,
              source: "goods_receipt",
              referenceType: "goods_receipt",
              referenceId: current.id,
              referenceLabel: current.receiptNumber ?? current.id,
              idempotencyKey: `goods-receipt-line:${line.id}`,
              note: `Receipt for ${current.purchaseOrder.poNumber} line ${orderLine.lineNumber}.`,
              actor: input.actor?.name ?? "operator",
            },
          });
          await tx.inventoryItem.update({ where: { id: item.id }, data: { onHand: { increment: quantity } } });
          await tx.goodsReceiptLine.update({ where: { id: line.id }, data: { inventoryMovementId: movement.id } });
        }
        await tx.purchaseOrderLine.update({
          where: { id: orderLine.id },
          data: {
            qtyDelivered: nextDelivered,
            status: nextDelivered >= orderLine.qtyOrdered ? "Delivered" : "Partially_Delivered",
          },
        });
        const backorderLine = await tx.backorderLine.findFirst({
          where: { purchaseOrderLineId: orderLine.id, backorder: { organizationId: input.organizationId } },
        });
        if (backorderLine) {
          const remaining = Math.max(0, orderLine.qtyOrdered - nextDelivered);
          await tx.backorderLine.update({
            where: { id: backorderLine.id },
            data: { quantity: remaining, status: remaining === 0 ? BackorderLineStatus.Resolved : BackorderLineStatus.Open, resolvedAt: remaining === 0 ? now : null },
          });
        }
      }
      const remainingLines = await tx.purchaseOrderLine.count({ where: { orderId: current.purchaseOrderId, status: { notIn: ["Delivered", "Cancelled"] } } });
      if (remainingLines === 0) await tx.purchaseOrder.update({ where: { id: current.purchaseOrderId }, data: { status: "Delivered" } });
      await resolveCompletedBackorder(tx, input.organizationId, current.purchaseOrderId, input.actor);
    }

    const update = await tx.goodsReceipt.updateMany({
      where: { id: current.id, organizationId: input.organizationId, status: GoodsReceiptStatus.Draft, version: current.version },
      data: {
        status: nextStatus,
        postedAt: nextStatus === GoodsReceiptStatus.Posted ? now : null,
        cancelledAt: nextStatus === GoodsReceiptStatus.Cancelled ? now : null,
        version: { increment: 1 },
      },
    });
    if (update.count !== 1) throw new Error("Goods receipt changed concurrently; reload and retry.");
    await tx.purchaseOrderEvent.create({
      data: {
        orderId: current.purchaseOrderId,
        type: `goods_receipt_${input.action === "post" ? "posted" : "cancelled"}`,
        summary: `Goods receipt ${current.receiptNumber ?? current.id} ${input.action === "post" ? "posted" : "cancelled"}`,
        detail: JSON.stringify({ goodsReceiptId: current.id, receiptNumber: current.receiptNumber }),
        actor: input.actor?.name ?? "operator",
      },
    });
    await recordAuditEvent({
      organizationId: input.organizationId,
      entityType: "GoodsReceipt",
      entityId: current.id,
      entityNumber: current.receiptNumber,
      eventType: ERP_AUDIT_EVENTS.STATUS_CHANGED,
      actorType: input.actor?.type ?? AuditActorType.Operator,
      actorId: input.actor?.id,
      actorName: input.actor?.name,
      sourceModule: "goods-receipts",
      before: { status: current.status },
      after: { status: nextStatus },
      metadata: { action: input.action },
      requestId: input.actor?.requestId,
    }, tx);
    return tx.goodsReceipt.findUniqueOrThrow({ where: { id: current.id }, include: receiptInclude });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return mapReceipt(result);
}
