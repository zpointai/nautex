import type { Prisma, PurchaseOrderLine } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { routeLineForFulfillment, supplierCostFromBuyerPrice } from "@/lib/purchase-orders/fulfillment";

export interface ConfirmBuyerPurchaseOrderResult {
  salesOrderNo: string;
  subOrders: { id: string; poNumber: string; supplier: string; lineCount?: number }[];
  internalLineCount: number;
  message: string;
}

function parseSalesOrderNumber(value: string | null) {
  const match = value?.match(/^SO-(\d{6,})$/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

async function nextSalesOrderNumber(tx: Prisma.TransactionClient, organizationId: string) {
  const existing = await tx.purchaseOrder.findMany({
    where: { organizationId, supplierRef: { startsWith: "SO-" } },
    select: { supplierRef: true },
    take: 1000,
  });
  const max = existing.reduce((highest, order) => Math.max(highest, parseSalesOrderNumber(order.supplierRef) ?? 0), 567556);
  return `SO-${max + 1}`;
}

function parseSupplierPoNumber(value: string | null) {
  const match = value?.match(/^PO-(\d{5,})$/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

async function nextSupplierPoNumber(tx: Prisma.TransactionClient, organizationId?: string) {
  const existing = await tx.purchaseOrder.findMany({
    where: { ...(organizationId ? { organizationId } : {}), poNumber: { startsWith: "PO-" } },
    select: { poNumber: true },
    take: 5000,
  });
  const max = existing.reduce((highest, order) => Math.max(highest, parseSupplierPoNumber(order.poNumber) ?? 0), 4556);
  return `PO-${String(max + 1).padStart(5, "0")}`;
}

type BuyerOrderWithLines = Prisma.PurchaseOrderGetPayload<{
  include: {
    lines: true;
    childOrders: { select: { id: true; poNumber: true; supplier: true } };
  };
}>;

function groupSupplierFulfillment(lines: PurchaseOrderLine[]) {
  const groups = new Map<string, PurchaseOrderLine[]>();
  const internalLineIds: string[] = [];

  for (const line of lines) {
    const route = routeLineForFulfillment(line);
    if (route.mode === "internal_stock") {
      internalLineIds.push(line.id);
    } else {
      const current = groups.get(route.supplier) ?? [];
      groups.set(route.supplier, [...current, line]);
    }
  }

  return { groups, internalLineIds };
}

async function createSupplierPos(tx: Prisma.TransactionClient, current: BuyerOrderWithLines, salesOrderNo: string) {
  const { groups, internalLineIds } = groupSupplierFulfillment(current.lines);
  const createdSubOrders: { id: string; poNumber: string; supplier: string; lineCount: number }[] = [];

  if (internalLineIds.length > 0) {
    for (const lineId of internalLineIds) {
      const line = current.lines.find((item) => item.id === lineId);
      if (!line) continue;
      await tx.purchaseOrderLine.update({
        where: { id: lineId },
        data: {
          qtyConfirmed: line.qtyOrdered,
          status: "Confirmed",
          remarks: [line.remarks, `Reserved against ${salesOrderNo} from Nautex internal stock.`].filter(Boolean).join("\n"),
        },
      });
    }
  }

  for (const [supplier, lines] of groups) {
    const supplierPoNumber = await nextSupplierPoNumber(tx, current.organizationId!);
    const total = lines.reduce((sum, line) => sum + line.qtyOrdered * supplierCostFromBuyerPrice(line.unitPrice), 0);
    const subOrder = await tx.purchaseOrder.create({
      data: {
        organizationId: current.organizationId,
        poNumber: supplierPoNumber,
        orderType: "SubPO",
        vessel: current.vessel,
        vesselImo: current.vesselImo,
        vesselOwner: current.vesselOwner,
        supplier,
        supplierRef: salesOrderNo,
        buyerName: current.buyerName,
        buyerRef: current.poNumber,
        parentOrderId: current.id,
        port: current.port,
        eta: current.eta,
        requestedDate: current.requestedDate,
        total,
        currency: current.currency,
        marginPct: 0,
        markupPct: 16.3,
        status: "Procurement",
        confirmStatus: "Unconfirmed",
        priority: current.priority,
        legacyNotes: `Generated from Nautex sales order ${salesOrderNo}. Customer PO: ${current.poNumber}.`,
        lines: {
          create: lines.map((line, lineIndex) => {
            const supplierUnitPrice = supplierCostFromBuyerPrice(line.unitPrice);
            return {
              lineNumber: lineIndex + 1,
              itemCode: line.itemCode,
              description: line.description,
              supplierPartNo: line.supplierPartNo,
              qtyOrdered: line.qtyOrdered,
              qtyDelivered: 0,
              uom: line.uom,
              unitPrice: supplierUnitPrice,
              lineTotal: supplierUnitPrice * line.qtyOrdered,
              currency: current.currency,
              parentLineId: line.id,
              buyerUnitPrice: line.unitPrice,
              requestedDate: line.requestedDate,
              status: "Open",
              remarks: `Linked to Nautex sales order ${salesOrderNo}. Customer PO: ${current.poNumber}.`,
            };
          }),
        },
        events: {
          create: {
            type: "sub_po_created",
            summary: `Supplier PO ${supplierPoNumber} generated for ${supplier}`,
            detail: JSON.stringify({ salesOrderNo, parentPo: current.poNumber, lineCount: lines.length }),
            actor: "system",
          },
        },
      },
      include: { lines: { select: { id: true, parentLineId: true } } },
    });

    for (const childLine of subOrder.lines) {
      if (childLine.parentLineId) {
        await tx.purchaseOrderLine.update({
          where: { id: childLine.parentLineId },
          data: { forwardedToOrderId: subOrder.id },
        });
      }
    }

    createdSubOrders.push({ id: subOrder.id, poNumber: subOrder.poNumber, supplier: subOrder.supplier, lineCount: lines.length });
  }

  return { createdSubOrders, internalLineCount: internalLineIds.length };
}

export async function repairSupplierPurchaseOrderNumbering() {
  return prisma.$transaction(async (tx) => {
    const orders = await tx.purchaseOrder.findMany({
      where: {
        orderType: "SubPO",
        poNumber: { startsWith: "SO-" },
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        poNumber: true,
        buyerRef: true,
        supplierRef: true,
        parentOrder: { select: { poNumber: true, supplierRef: true } },
      },
    });

    const repaired: { id: string; oldPoNumber: string; newPoNumber: string }[] = [];
    for (const order of orders) {
      const salesOrderNo = order.buyerRef?.startsWith("SO-")
        ? order.buyerRef
        : order.parentOrder?.supplierRef?.startsWith("SO-")
          ? order.parentOrder.supplierRef
          : order.supplierRef?.startsWith("SO-")
            ? order.supplierRef
            : null;
      const customerPo = order.parentOrder?.poNumber ?? (order.supplierRef?.startsWith("SO-") ? null : order.supplierRef);
      const newPoNumber = await nextSupplierPoNumber(tx);
      await tx.purchaseOrder.update({
        where: { id: order.id },
        data: {
          poNumber: newPoNumber,
          supplierRef: salesOrderNo,
          buyerRef: customerPo,
        },
      });
      await tx.purchaseOrderEvent.create({
        data: {
          orderId: order.id,
          type: "supplier_pos_generated",
          summary: `Supplier PO renumbered from ${order.poNumber} to ${newPoNumber}`,
          detail: JSON.stringify({ oldPoNumber: order.poNumber, newPoNumber, salesOrderNo, customerPo }),
          actor: "system",
        },
      });
      repaired.push({ id: order.id, oldPoNumber: order.poNumber, newPoNumber });
    }

    return { repaired };
  });
}

export async function confirmBuyerPurchaseOrder(orderId: string, organizationId: string): Promise<ConfirmBuyerPurchaseOrderResult> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.purchaseOrder.findFirst({
      where: { id: orderId, organizationId },
      include: {
        lines: { orderBy: { lineNumber: "asc" } },
        childOrders: { select: { id: true, poNumber: true, supplier: true } },
      },
    });

    if (!current) throw new Error("Purchase order not found.");
    if (current.orderType !== "BuyerPO") throw new Error("Only inbound buyer purchase orders can be confirmed into a sales order.");

    const salesOrderNo = current.supplierRef?.startsWith("SO-") ? current.supplierRef : await nextSalesOrderNumber(tx, organizationId);
    const existingChildOrders = current.childOrders;
    let createdSubOrders: { id: string; poNumber: string; supplier: string; lineCount: number }[] = [];
    let internalLineCount = 0;

    await tx.purchaseOrder.update({
      where: { id: orderId },
      data: {
        status: "Procurement",
        confirmStatus: "Confirmed",
        confirmedDate: new Date(),
        supplierRef: salesOrderNo,
        shipservLifecycle: "Order_Confirmed",
      },
    });

    if (existingChildOrders.length === 0) {
      const routed = await createSupplierPos(tx, current, salesOrderNo);
      createdSubOrders = routed.createdSubOrders;
      internalLineCount = routed.internalLineCount;
    }

    await tx.purchaseOrderEvent.createMany({
      data: [
        {
          orderId,
          type: "order_confirmed",
          summary: `Customer PO confirmed and linked to ${salesOrderNo}`,
          detail: JSON.stringify({
            salesOrderNo,
            customerPo: current.poNumber,
            buyer: current.buyerName,
            vessel: current.vessel,
            confirmationPrepared: true,
          }),
          actor: "operator",
        },
        {
          orderId,
          type: "supplier_pos_generated",
          summary: existingChildOrders.length > 0
            ? `Supplier POs already existed for ${salesOrderNo}`
            : `${createdSubOrders.length} supplier PO(s) generated for ${salesOrderNo}`,
          detail: JSON.stringify({ salesOrderNo, createdSubOrders, internalLineCount }),
          actor: "system",
        },
      ],
    });

    return {
      salesOrderNo,
      subOrders: createdSubOrders.length > 0 ? createdSubOrders : existingChildOrders,
      internalLineCount,
      message: `Order confirmed as ${salesOrderNo}.`,
    };
  });
}

export async function collectLinkedShippingCompanyOrderIds(companyName: string, organizationId: string) {
  const rootOrders = await prisma.purchaseOrder.findMany({
    where: {
      organizationId,
      OR: [
        { buyerName: companyName },
        { vesselOwner: companyName },
      ],
    },
    select: { id: true },
  });
  const ids = new Set(rootOrders.map((order) => order.id));
  let frontier = rootOrders.map((order) => order.id);

  while (frontier.length > 0) {
    const children = await prisma.purchaseOrder.findMany({
      where: { organizationId, parentOrderId: { in: frontier } },
      select: { id: true },
    });
    frontier = children.map((order) => order.id).filter((id) => !ids.has(id));
    for (const id of frontier) ids.add(id);
  }

  return Array.from(ids);
}

export async function collectOrderAndDescendantIds(orderId: string, organizationId: string) {
  const ids = new Set([orderId]);
  let frontier = [orderId];

  while (frontier.length > 0) {
    const children = await prisma.purchaseOrder.findMany({
      where: { organizationId, parentOrderId: { in: frontier } },
      select: { id: true },
    });
    frontier = children.map((order) => order.id).filter((id) => !ids.has(id));
    for (const id of frontier) ids.add(id);
  }

  return Array.from(ids);
}

export async function deletePurchaseOrderWithLinks(orderId: string, organizationId: string) {
  const orderIds = await collectOrderAndDescendantIds(orderId, organizationId);

  return prisma.$transaction(async (tx) => {
    const protectedLinkCount = await Promise.all([
      tx.customerInvoice.count({ where: { orderId: { in: orderIds } } }),
      tx.supplierInvoice.count({ where: { purchaseOrderId: { in: orderIds } } }),
      tx.financeRecord.count({ where: { orderId: { in: orderIds } } }),
      tx.orderMarginSnapshot.count({ where: { orderId: { in: orderIds } } }),
      tx.financeException.count({ where: { orderId: { in: orderIds } } }),
    ]).then((counts) => counts.reduce((sum, count) => sum + count, 0));

    if (protectedLinkCount > 0) {
      throw new Error("Purchase order has finance or accounting links and cannot be deleted from the PO workspace.");
    }

    const linkedLines = await tx.purchaseOrderLine.findMany({
      where: { orderId: { in: orderIds } },
      select: { id: true },
    });
    const lineIds = linkedLines.map((line) => line.id);

    if (lineIds.length > 0) {
      await tx.orderLineAllocation.deleteMany({
        where: {
          OR: [
            { buyerLineId: { in: lineIds } },
            { subPoLineId: { in: lineIds } },
          ],
        },
      });
      await tx.purchaseOrderLine.updateMany({
        where: { parentLineId: { in: lineIds } },
        data: { parentLineId: null },
      });
    }

    await tx.purchaseOrderLine.updateMany({
      where: { forwardedToOrderId: { in: orderIds } },
      data: { forwardedToOrderId: null },
    });
    await tx.purchaseOrder.updateMany({
      where: { parentOrderId: { in: orderIds } },
      data: { parentOrderId: null },
    });
    await tx.purchaseOrder.deleteMany({
      where: { id: { in: orderIds }, organizationId },
    });

    return { deletedOrders: orderIds.length };
  });
}

export async function deleteShippingCompanyWithLinkedOrders(companyName: string, organizationId: string) {
  const orderIds = await collectLinkedShippingCompanyOrderIds(companyName, organizationId);
  await prisma.$transaction(async (tx) => {
    if (orderIds.length > 0) {
      const linkedLines = await tx.purchaseOrderLine.findMany({
        where: { orderId: { in: orderIds } },
        select: { id: true },
      });
      const lineIds = linkedLines.map((line) => line.id);
      if (lineIds.length > 0) {
        await tx.orderLineAllocation.deleteMany({
          where: {
            OR: [
              { buyerLineId: { in: lineIds } },
              { subPoLineId: { in: lineIds } },
            ],
          },
        });
        await tx.purchaseOrderLine.updateMany({
          where: { parentLineId: { in: lineIds } },
          data: { parentLineId: null },
        });
      }
      await tx.purchaseOrderLine.updateMany({
        where: { forwardedToOrderId: { in: orderIds } },
        data: { forwardedToOrderId: null },
      });
      await tx.purchaseOrder.updateMany({
        where: { parentOrderId: { in: orderIds } },
        data: { parentOrderId: null },
      });
      await tx.purchaseOrder.deleteMany({
        where: { id: { in: orderIds } },
      });
    }
    await tx.shippingCompany.deleteMany({ where: { name: companyName, organizationId } });
  });

  return { name: companyName, deletedOrders: orderIds.length };
}
