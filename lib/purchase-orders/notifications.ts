import { prisma } from "@/lib/prisma";

export interface PurchaseOrderNotification {
  id: string;
  type: "inbound_customer_po" | "confirmation_required" | "supplier_po_ready";
  severity: "info" | "warning" | "success";
  title: string;
  detail: string;
  orderId: string;
  poNumber: string;
  vessel: string;
  buyerName: string | null;
  salesOrderNo: string | null;
  createdAt: string;
}

export async function getPurchaseOrderNotifications(organizationId: string, limit = 12): Promise<PurchaseOrderNotification[]> {
  if (!organizationId) throw new Error("An organization is required for notifications.");
  const [inbound, supplierReady] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where: {
        orderType: "BuyerPO",
        organizationId,
        OR: [
          { status: "Pending_Approval" },
          { confirmStatus: "Unconfirmed" },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.purchaseOrder.findMany({
      where: {
        orderType: "SubPO",
        organizationId,
        status: "Procurement",
        confirmStatus: "Unconfirmed",
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  ]);

  return [
    ...inbound.map((order) => ({
      id: `inbound-${order.id}`,
      type: "inbound_customer_po" as const,
      severity: "warning" as const,
      title: `Inbound customer PO ${order.poNumber}`,
      detail: `${order.buyerName || order.vesselOwner || "Shipping company"} / ${order.vessel} requires Nautex operator review and confirmation.`,
      orderId: order.id,
      poNumber: order.poNumber,
      vessel: order.vessel,
      buyerName: order.buyerName,
      salesOrderNo: order.supplierRef?.startsWith("SO-") ? order.supplierRef : null,
      createdAt: order.createdAt.toISOString(),
    })),
    ...supplierReady.map((order) => ({
      id: `supplier-${order.id}`,
      type: "supplier_po_ready" as const,
      severity: "info" as const,
      title: `Supplier PO ready ${order.poNumber}`,
      detail: `${order.supplier} purchase order is linked to sales order ${order.supplierRef || "not assigned"} and can be reviewed or downloaded.`,
      orderId: order.id,
      poNumber: order.poNumber,
      vessel: order.vessel,
      buyerName: order.buyerName,
      salesOrderNo: order.supplierRef,
      createdAt: order.createdAt.toISOString(),
    })),
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}
