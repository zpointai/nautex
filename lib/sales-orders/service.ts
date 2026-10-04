import { randomUUID } from "node:crypto";
import {
  AuditActorType,
  NumberSequenceDocumentType,
  Prisma,
  SalesOrderLineStatus,
  SalesOrderStatus,
} from "@prisma/client";
import { ERP_AUDIT_EVENTS, recordAuditEvent } from "@/lib/erp-core/audit";
import { SALES_ORDER_LIFECYCLE, assertTransitionStatus } from "@/lib/erp-core/lifecycle";
import { issueNumber } from "@/lib/erp-core/number-sequences";
import { provenanceKindForOrganizationDataMode, recordProvenance } from "@/lib/erp-core/provenance";
import { prisma } from "@/lib/prisma";

const salesOrderInclude = {
  customer: { select: { id: true, customerCode: true, name: true, partyId: true } },
  party: { select: { id: true, displayName: true } },
  quote: { select: { id: true, quoteNumber: true, status: true } },
  fulfillmentOrder: { select: { id: true, poNumber: true, status: true, confirmStatus: true } },
  lines: {
    include: { fulfillmentOrderLine: { select: { id: true, status: true, qtyDelivered: true } } },
    orderBy: { lineNumber: "asc" as const },
  },
} satisfies Prisma.SalesOrderInclude;

type SalesOrderWithContext = Prisma.SalesOrderGetPayload<{ include: typeof salesOrderInclude }>;

export interface SalesOrderActor {
  id?: string | null;
  name?: string | null;
  type?: AuditActorType;
  requestId?: string | null;
}

export interface ConvertQuoteToSalesOrderInput {
  organizationId: string;
  quoteId: string;
  legalEntityId?: string | null;
  customerPoReference?: string | null;
  requestedDeliveryAt?: Date | null;
  sourceKey?: string | null;
  actor?: SalesOrderActor;
}

export type SalesOrderTransitionAction = "start" | "cancel";

function decimalNumber(value: Prisma.Decimal) {
  return value.toNumber();
}

function mapSalesOrder(row: SalesOrderWithContext) {
  return {
    id: row.id,
    salesOrderNumber: row.salesOrderNumber,
    quoteId: row.quoteId,
    quoteNumber: row.quote.quoteNumber,
    customerId: row.customerId,
    partyId: row.partyId,
    customer: row.customer.name,
    customerCode: row.customer.customerCode,
    rfqId: row.rfqId,
    fulfillmentOrderId: row.fulfillmentOrderId,
    fulfillmentOrderNumber: row.fulfillmentOrder.poNumber,
    fulfillmentOrderStatus: row.fulfillmentOrder.status,
    status: row.status,
    customerPoReference: row.customerPoReference,
    vessel: row.vesselName,
    vesselImo: row.vesselImo,
    port: row.port,
    requestedDeliveryAt: row.requestedDeliveryAt.toISOString(),
    currency: row.currency,
    paymentTerms: row.paymentTerms,
    netAmount: decimalNumber(row.netAmount),
    vatAmount: decimalNumber(row.vatAmount),
    grossAmount: decimalNumber(row.grossAmount),
    costAmount: decimalNumber(row.costAmount),
    marginPct: decimalNumber(row.marginPct),
    confirmedAt: row.confirmedAt.toISOString(),
    fulfillmentStartedAt: row.fulfillmentStartedAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    lines: row.lines.map((line) => ({
      id: line.id,
      quoteLineId: line.quoteLineId,
      rfqLineId: line.rfqLineId,
      fulfillmentOrderLineId: line.fulfillmentOrderLineId,
      lineNumber: line.lineNumber,
      description: line.description,
      quantity: decimalNumber(line.quantity),
      deliveredQuantity: decimalNumber(line.deliveredQuantity),
      unit: line.unit,
      impaCode: line.impaCode,
      unitCost: decimalNumber(line.unitCost),
      unitPrice: decimalNumber(line.unitPrice),
      netAmount: decimalNumber(line.netAmount),
      marginPct: decimalNumber(line.marginPct),
      currency: line.currency,
      status: line.status,
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function parseRequestedDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function issueSalesOrderNumber(organizationId: string, legalEntityId?: string | null) {
  if (!legalEntityId) return null;
  const issued = await issueNumber({
    organizationId,
    legalEntityId,
    documentType: NumberSequenceDocumentType.SalesOrder,
    prefix: "SO",
    padding: 5,
    metadata: { source: "accepted_customer_quote" },
  });
  return issued.number;
}

export async function listSalesOrders(organizationId: string, filters: { customerId?: string; quoteId?: string } = {}) {
  const rows = await prisma.salesOrder.findMany({
    where: {
      organizationId,
      ...(filters.customerId ? { customerId: filters.customerId } : {}),
      ...(filters.quoteId ? { quoteId: filters.quoteId } : {}),
    },
    include: salesOrderInclude,
    orderBy: [{ requestedDeliveryAt: "asc" }, { createdAt: "desc" }, { id: "desc" }],
  });
  return rows.map(mapSalesOrder);
}

export async function convertAcceptedQuoteToSalesOrder(input: ConvertQuoteToSalesOrderInput) {
  const existing = await prisma.salesOrder.findFirst({
    where: { quoteId: input.quoteId, organizationId: input.organizationId },
    include: salesOrderInclude,
  });
  if (existing) return { created: false, salesOrder: mapSalesOrder(existing) };

  const quote = await prisma.customerQuote.findFirst({
    where: { id: input.quoteId, organizationId: input.organizationId },
    include: {
      customer: true,
      legalEntity: { select: { id: true, name: true } },
      rfq: { select: { id: true, neededBy: true } },
      lines: { orderBy: { lineNumber: "asc" } },
      organization: { select: { code: true, dataMode: true } },
    },
  });
  if (!quote) throw new Error("Customer quote was not found in the active organization.");
  if (quote.status !== "Accepted") throw new Error("Only accepted customer quotes can be converted to sales orders.");
  if (quote.lines.length === 0) throw new Error("Accepted customer quote has no lines.");
  const legalEntityId = input.legalEntityId ?? quote.legalEntityId;
  let legalEntityName = quote.legalEntity?.name ?? null;
  if (legalEntityId && legalEntityId !== quote.legalEntityId) {
    const legalEntity = await prisma.legalEntity.findFirst({ where: { id: legalEntityId, organizationId: input.organizationId }, select: { name: true } });
    if (!legalEntity) throw new Error("Legal entity does not belong to the active organization.");
    legalEntityName = legalEntity.name;
  }
  const requestedDeliveryAt = input.requestedDeliveryAt
    ?? parseRequestedDate(quote.rfq?.neededBy)
    ?? new Date(Date.now() + 7 * 86_400_000);
  if (Number.isNaN(requestedDeliveryAt.getTime())) throw new Error("Requested delivery date is invalid.");
  const salesOrderNumber = await issueSalesOrderNumber(input.organizationId, legalEntityId);
  const adapterOrderNumber = salesOrderNumber
    ? `CUS-${quote.organization.code}-${salesOrderNumber}`
    : `CUS-${randomUUID().slice(0, 8).toUpperCase()}`;
  const customerPoReference = input.customerPoReference?.trim() || quote.customerReference || null;
  const costAmount = quote.lines.reduce((sum, line) => sum + line.unitCost.toNumber() * line.quantity.toNumber(), 0);
  const provenanceKind = provenanceKindForOrganizationDataMode(quote.organization.dataMode);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const duplicate = await tx.salesOrder.findUnique({ where: { quoteId: quote.id }, include: salesOrderInclude });
      if (duplicate) return duplicate;
      const now = new Date();
      const fulfillmentOrder = await tx.purchaseOrder.create({
        data: {
          organizationId: input.organizationId,
          poNumber: adapterOrderNumber,
          orderType: "BuyerPO",
          vessel: quote.vesselName ?? "Unassigned vessel",
          vesselImo: quote.vesselImo,
          vesselOwner: quote.customer.name,
          supplier: legalEntityName ?? "Internal sales fulfillment",
          supplierRef: salesOrderNumber,
          buyerName: quote.customer.name,
          buyerRef: customerPoReference ?? quote.quoteNumber,
          shipservQuoteId: quote.quoteNumber,
          shipservLifecycle: "Order_Confirmed",
          rfqId: quote.rfqId,
          port: quote.port,
          eta: requestedDeliveryAt,
          requestedDate: requestedDeliveryAt,
          confirmedDate: now,
          total: quote.netAmount.toNumber(),
          currency: quote.currency,
          marginPct: quote.marginPct.toNumber(),
          markupPct: quote.markupPct.toNumber(),
          costTotal: costAmount,
          status: "Procurement",
          confirmStatus: "Confirmed",
          legacyNotes: `Compatibility fulfillment order for ${salesOrderNumber ?? quote.quoteNumber ?? quote.id}.`,
          lines: {
            create: quote.lines.map((line) => ({
              lineNumber: line.lineNumber,
              itemCode: line.impaCode,
              description: line.description,
              qtyOrdered: line.quantity.toNumber(),
              qtyConfirmed: line.quantity.toNumber(),
              uom: line.unit,
              unitPrice: line.unitPrice.toNumber(),
              lineTotal: line.netAmount.toNumber(),
              currency: line.currency,
              buyerUnitPrice: line.unitPrice.toNumber(),
              requestedDate: requestedDeliveryAt,
              confirmedDate: now,
              status: "Confirmed",
              remarks: `Created from customer quote ${quote.quoteNumber ?? quote.id}.`,
            })),
          },
          events: {
            create: {
              type: "sales_order_adapter_created",
              summary: `Fulfillment order created from accepted quote ${quote.quoteNumber ?? quote.id}`,
              detail: JSON.stringify({ quoteId: quote.id, quoteNumber: quote.quoteNumber, salesOrderNumber }),
              actor: input.actor?.name ?? "system",
            },
          },
        },
        include: { lines: { orderBy: { lineNumber: "asc" } } },
      });
      const fulfillmentLines = new Map(fulfillmentOrder.lines.map((line) => [line.lineNumber, line]));
      const row = await tx.salesOrder.create({
        data: {
          organizationId: input.organizationId,
          legalEntityId,
          customerId: quote.customerId,
          partyId: quote.partyId,
          quoteId: quote.id,
          rfqId: quote.rfqId,
          fulfillmentOrderId: fulfillmentOrder.id,
          salesOrderNumber,
          sourceKey: input.sourceKey?.trim() || `quote:${quote.id}`,
          customerPoReference,
          vesselName: quote.vesselName,
          vesselImo: quote.vesselImo,
          port: quote.port,
          requestedDeliveryAt,
          currency: quote.currency,
          paymentTerms: quote.paymentTerms,
          netAmount: quote.netAmount,
          vatAmount: quote.vatAmount,
          grossAmount: quote.grossAmount,
          costAmount,
          marginPct: quote.marginPct,
          createdById: input.actor?.id ?? null,
          createdByName: input.actor?.name ?? null,
          confirmedAt: now,
          lines: {
            create: quote.lines.map((line) => ({
              quoteLineId: line.id,
              rfqLineId: line.rfqLineId,
              fulfillmentOrderLineId: fulfillmentLines.get(line.lineNumber)!.id,
              lineNumber: line.lineNumber,
              description: line.description,
              quantity: line.quantity,
              unit: line.unit,
              impaCode: line.impaCode,
              unitCost: line.unitCost,
              unitPrice: line.unitPrice,
              netAmount: line.netAmount,
              marginPct: line.marginPct,
              currency: line.currency,
            })),
          },
        },
      });
      await recordAuditEvent({
        organizationId: input.organizationId,
        entityType: "SalesOrder",
        entityId: row.id,
        entityNumber: row.salesOrderNumber,
        eventType: ERP_AUDIT_EVENTS.CREATED,
        actorType: input.actor?.type ?? AuditActorType.Operator,
        actorId: input.actor?.id,
        actorName: input.actor?.name,
        sourceModule: "sales-orders",
        after: { status: row.status, quoteId: quote.id, fulfillmentOrderId: fulfillmentOrder.id, lineCount: quote.lines.length },
        requestId: input.actor?.requestId,
      }, tx);
      await recordAuditEvent({
        organizationId: input.organizationId,
        entityType: "CustomerQuote",
        entityId: quote.id,
        entityNumber: quote.quoteNumber,
        eventType: "converted_to_sales_order",
        actorType: input.actor?.type ?? AuditActorType.Operator,
        actorId: input.actor?.id,
        actorName: input.actor?.name,
        sourceModule: "sales-orders",
        after: { salesOrderId: row.id, salesOrderNumber: row.salesOrderNumber, fulfillmentOrderId: fulfillmentOrder.id },
        requestId: input.actor?.requestId,
      }, tx);
      await recordAuditEvent({
        organizationId: input.organizationId,
        entityType: "PurchaseOrder",
        entityId: fulfillmentOrder.id,
        entityNumber: fulfillmentOrder.poNumber,
        eventType: ERP_AUDIT_EVENTS.CREATED,
        actorType: input.actor?.type ?? AuditActorType.Operator,
        actorId: input.actor?.id,
        actorName: input.actor?.name,
        sourceModule: "sales-orders",
        after: { role: "sales_order_fulfillment_adapter", salesOrderId: row.id },
        requestId: input.actor?.requestId,
      }, tx);
      await recordProvenance({
        organizationId: input.organizationId,
        entityType: "SalesOrder",
        entityId: row.id,
        kind: provenanceKind,
        source: "accepted_customer_quote",
        metadata: { quoteId: quote.id, fulfillmentOrderId: fulfillmentOrder.id },
      }, tx);
      await recordProvenance({
        organizationId: input.organizationId,
        entityType: "PurchaseOrder",
        entityId: fulfillmentOrder.id,
        kind: provenanceKind,
        source: "sales_order_adapter",
        metadata: { salesOrderId: row.id, quoteId: quote.id },
      }, tx);
      return tx.salesOrder.findUniqueOrThrow({ where: { id: row.id }, include: salesOrderInclude });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { created: true, salesOrder: mapSalesOrder(created) };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await prisma.salesOrder.findFirst({ where: { quoteId: input.quoteId, organizationId: input.organizationId }, include: salesOrderInclude });
      if (raced) return { created: false, salesOrder: mapSalesOrder(raced) };
    }
    throw error;
  }
}

export async function transitionSalesOrder(input: {
  organizationId: string;
  id: string;
  action: SalesOrderTransitionAction;
  note?: string | null;
  actor?: SalesOrderActor;
}) {
  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.salesOrder.findFirst({ where: { id: input.id, organizationId: input.organizationId }, include: salesOrderInclude });
    if (!current) throw new Error("Sales order was not found in the active organization.");
    const nextStatus = input.action === "start" ? SalesOrderStatus.InFulfillment : SalesOrderStatus.Cancelled;
    if (current.status === nextStatus) return current;
    assertTransitionStatus(SALES_ORDER_LIFECYCLE, current.status, nextStatus);
    const now = new Date();
    if (input.action === "cancel") {
      const [deliveredLines, activeDeliveries] = await Promise.all([
        tx.purchaseOrderLine.count({ where: { orderId: current.fulfillmentOrderId, qtyDelivered: { gt: 0 } } }),
        tx.delivery.count({ where: { purchaseOrderId: current.fulfillmentOrderId, status: { not: "Cancelled" } } }),
      ]);
      if (deliveredLines > 0 || activeDeliveries > 0) throw new Error("Sales order cannot be cancelled after delivery activity has started.");
      await tx.salesOrderLine.updateMany({ where: { salesOrderId: current.id }, data: { status: SalesOrderLineStatus.Cancelled } });
      await tx.purchaseOrderLine.updateMany({ where: { orderId: current.fulfillmentOrderId }, data: { status: "Cancelled" } });
      await tx.purchaseOrder.update({ where: { id: current.fulfillmentOrderId }, data: { confirmStatus: "Rejected" } });
    }
    const updated = await tx.salesOrder.updateMany({
      where: { id: current.id, status: current.status, version: current.version },
      data: {
        status: nextStatus,
        fulfillmentStartedAt: input.action === "start" ? now : current.fulfillmentStartedAt,
        cancelledAt: input.action === "cancel" ? now : current.cancelledAt,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new Error("Sales order changed concurrently; reload and retry.");
    await tx.purchaseOrderEvent.create({
      data: {
        orderId: current.fulfillmentOrderId,
        type: `sales_order_${input.action}`,
        summary: `Sales order ${current.salesOrderNumber ?? current.id} changed from ${current.status} to ${nextStatus}`,
        detail: JSON.stringify({ salesOrderId: current.id, note: input.note?.trim() || null }),
        actor: input.actor?.name ?? "operator",
      },
    });
    await recordAuditEvent({
      organizationId: input.organizationId,
      entityType: "SalesOrder",
      entityId: current.id,
      entityNumber: current.salesOrderNumber,
      eventType: ERP_AUDIT_EVENTS.STATUS_CHANGED,
      actorType: input.actor?.type ?? AuditActorType.Operator,
      actorId: input.actor?.id,
      actorName: input.actor?.name,
      sourceModule: "sales-orders",
      before: { status: current.status },
      after: { status: nextStatus },
      metadata: { action: input.action, note: input.note?.trim() || null },
      requestId: input.actor?.requestId,
    }, tx);
    return tx.salesOrder.findUniqueOrThrow({ where: { id: current.id }, include: salesOrderInclude });
  });
  return mapSalesOrder(result);
}

export async function synchronizeSalesOrderFromFulfillment(
  tx: Prisma.TransactionClient,
  purchaseOrderId: string,
  options: { started?: boolean; actor?: SalesOrderActor } = {},
) {
  const current = await tx.salesOrder.findUnique({
    where: { fulfillmentOrderId: purchaseOrderId },
    include: { lines: true },
  });
  if (!current || current.status === SalesOrderStatus.Cancelled || current.status === SalesOrderStatus.Delivered) return current;
  const fulfillmentLines = await tx.purchaseOrderLine.findMany({ where: { orderId: purchaseOrderId }, select: { id: true, qtyDelivered: true } });
  const deliveredByLine = new Map(fulfillmentLines.map((line) => [line.id, line.qtyDelivered]));
  let deliveredLineCount = 0;
  let deliveredQuantity = 0;
  for (const line of current.lines) {
    const quantity = line.quantity.toNumber();
    const delivered = Math.min(quantity, deliveredByLine.get(line.fulfillmentOrderLineId) ?? 0);
    const status = delivered >= quantity - 0.000001
      ? SalesOrderLineStatus.Delivered
      : delivered > 0
        ? SalesOrderLineStatus.PartiallyDelivered
        : SalesOrderLineStatus.Open;
    if (status === SalesOrderLineStatus.Delivered) deliveredLineCount += 1;
    deliveredQuantity += delivered;
    await tx.salesOrderLine.update({ where: { id: line.id }, data: { deliveredQuantity: delivered, status } });
  }
  const allDelivered = current.lines.length > 0 && deliveredLineCount === current.lines.length;
  const anyDelivered = deliveredQuantity > 0;
  const nextStatus = allDelivered
    ? SalesOrderStatus.Delivered
    : anyDelivered
      ? SalesOrderStatus.PartiallyDelivered
      : options.started && current.status === SalesOrderStatus.Confirmed
        ? SalesOrderStatus.InFulfillment
        : current.status;
  if (nextStatus !== current.status) {
    assertTransitionStatus(SALES_ORDER_LIFECYCLE, current.status, nextStatus);
  }
  const now = new Date();
  await tx.salesOrder.update({
    where: { id: current.id },
    data: {
      status: nextStatus,
      fulfillmentStartedAt: options.started && !current.fulfillmentStartedAt ? now : current.fulfillmentStartedAt,
      deliveredAt: allDelivered ? now : current.deliveredAt,
      version: { increment: 1 },
    },
  });
  if (nextStatus !== current.status) {
    await recordAuditEvent({
      organizationId: current.organizationId,
      entityType: "SalesOrder",
      entityId: current.id,
      entityNumber: current.salesOrderNumber,
      eventType: ERP_AUDIT_EVENTS.STATUS_CHANGED,
      actorType: options.actor?.type ?? AuditActorType.Operator,
      actorId: options.actor?.id,
      actorName: options.actor?.name,
      sourceModule: "deliveries",
      before: { status: current.status },
      after: { status: nextStatus },
      metadata: { purchaseOrderId, deliveredQuantity },
      requestId: options.actor?.requestId,
    }, tx);
  }
  return tx.salesOrder.findUnique({ where: { id: current.id }, include: salesOrderInclude });
}
