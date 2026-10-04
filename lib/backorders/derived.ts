import { prisma } from "@/lib/prisma";

export type BackorderStatus = "open" | "escalated" | "resolved" | "dismissed";
export type BackorderPriority = "critical" | "high" | "normal";

export interface BackorderItem {
  id: string;
  description: string;
  qty: number;
  unit: string;
  requestedDate: string;
  delayDays: number;
  remarks: string | null;
}

export interface DerivedBackorder {
  id: string;
  poId: string;
  poNumber: string;
  vendor: string;
  supplierId: string | null;
  supplierEmail: string | null;
  supplierContact: string | null;
  vessel: string;
  port: string | null;
  eta: string;
  status: BackorderStatus;
  priority: BackorderPriority;
  totalDelayDays: number;
  requestDate: string;
  items: BackorderItem[];
  notes?: string;
  escalatedAt?: string;
  resolvedAt?: string;
  backorderNumber?: string;
  source: "purchase_order_lines" | "backorder_case";
}

export interface BackorderKpis {
  openOrders: number;
  openLines: number;
  criticalOrders: number;
  escalatedOrders: number;
  avgDelayDays: number;
  resolvedOrders: number;
  affectedSuppliers: number;
}

function delayDaysFrom(date: Date | null) {
  if (!date) return 0;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfDate = new Date(date);
  startOfDate.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((startOfToday.getTime() - startOfDate.getTime()) / 86_400_000));
}

function priorityFor(orderStatus: string, delayDays: number): BackorderPriority {
  if (orderStatus === "At_Risk" || delayDays >= 20) return "critical";
  if (delayDays >= 7) return "high";
  return "normal";
}

function statusFor(orderStatus: string, delayDays: number): BackorderStatus {
  if (orderStatus === "Delivered") return "resolved";
  if (orderStatus === "At_Risk" && delayDays > 0) return "escalated";
  return "open";
}

export function buildBackorderKpis(backorders: DerivedBackorder[]): BackorderKpis {
  const open = backorders.filter((b) => b.status === "open" || b.status === "escalated");
  const supplierNames = new Set(open.map((b) => b.vendor));

  return {
    openOrders: open.length,
    openLines: open.reduce((sum, b) => sum + b.items.length, 0),
    criticalOrders: open.filter((b) => b.priority === "critical").length,
    escalatedOrders: backorders.filter((b) => b.status === "escalated").length,
    avgDelayDays: open.length > 0 ? Math.round(open.reduce((sum, b) => sum + b.totalDelayDays, 0) / open.length) : 0,
    resolvedOrders: backorders.filter((b) => b.status === "resolved").length,
    affectedSuppliers: supplierNames.size,
  };
}

export async function getDerivedBackorders(organizationId: string): Promise<DerivedBackorder[]> {
  const lines = await prisma.purchaseOrderLine.findMany({
    where: { status: "Backordered", order: { organizationId } },
    include: {
      order: {
        select: {
          id: true,
          poNumber: true,
          supplier: true,
          supplierId: true,
          supplierRel: { select: { email: true, contactPerson: true } },
          vessel: true,
          port: true,
          eta: true,
          status: true,
          requestedDate: true,
          createdAt: true,
          legacyNotes: true,
        },
      },
    },
    orderBy: [{ requestedDate: "asc" }, { createdAt: "asc" }],
  });

  const grouped = new Map<string, DerivedBackorder>();

  for (const line of lines) {
    const requestedDate = line.requestedDate ?? line.order.requestedDate ?? line.createdAt;
    const delayDays = delayDaysFrom(requestedDate);
    const current = grouped.get(line.orderId) ?? {
      id: `derived-${line.orderId}`,
      poId: line.orderId,
      poNumber: line.order.poNumber,
      vendor: line.order.supplier,
      supplierId: line.order.supplierId,
      supplierEmail: line.order.supplierRel?.email ?? null,
      supplierContact: line.order.supplierRel?.contactPerson ?? null,
      vessel: line.order.vessel,
      port: line.order.port,
      eta: line.order.eta.toISOString(),
      status: statusFor(line.order.status, delayDays),
      priority: priorityFor(line.order.status, delayDays),
      totalDelayDays: delayDays,
      requestDate: requestedDate.toISOString(),
      items: [],
      notes: line.order.legacyNotes ?? undefined,
      escalatedAt: line.order.status === "At_Risk" ? line.order.createdAt.toISOString() : undefined,
      resolvedAt: line.order.status === "Delivered" ? line.order.createdAt.toISOString() : undefined,
      source: "purchase_order_lines" as const,
    };

    current.totalDelayDays = Math.max(current.totalDelayDays, delayDays);
    current.priority = priorityFor(line.order.status, current.totalDelayDays);
    current.status = statusFor(line.order.status, current.totalDelayDays);
    current.items.push({
      id: line.id,
      description: line.description,
      qty: Math.max(0, line.qtyOrdered - line.qtyDelivered),
      unit: line.uom,
      requestedDate: requestedDate.toISOString(),
      delayDays,
      remarks: line.remarks,
    });
    grouped.set(line.orderId, current);
  }

  return Array.from(grouped.values()).sort((a, b) => {
    if (b.totalDelayDays !== a.totalDelayDays) return b.totalDelayDays - a.totalDelayDays;
    return a.poNumber.localeCompare(b.poNumber);
  });
}

export async function getDerivedBackorderById(id: string, organizationId: string) {
  const backorders = await getDerivedBackorders(organizationId);
  return backorders.find((b) => b.id === id || b.poId === id || b.poNumber.toLowerCase() === id.toLowerCase()) ?? null;
}
