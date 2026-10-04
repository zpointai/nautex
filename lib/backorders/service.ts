import {
  AuditActorType,
  BackorderLineStatus,
  BackorderPriority,
  BackorderStatus,
  NumberSequenceDocumentType,
  Prisma,
} from "@prisma/client";
import { getDerivedBackorders, type BackorderPriority as UiPriority, type BackorderStatus as UiStatus, type DerivedBackorder } from "@/lib/backorders/derived";
import { ERP_AUDIT_EVENTS, recordAuditEvent } from "@/lib/erp-core/audit";
import { BACKORDER_LIFECYCLE, assertTransitionStatus } from "@/lib/erp-core/lifecycle";
import { issueNumber } from "@/lib/erp-core/number-sequences";
import { provenanceKindForOrganizationDataMode, recordProvenance } from "@/lib/erp-core/provenance";
import { prisma } from "@/lib/prisma";

const backorderInclude = {
  purchaseOrder: {
    include: {
      supplierRel: { select: { email: true, contactPerson: true } },
    },
  },
  lines: {
    include: { purchaseOrderLine: true },
    orderBy: { purchaseOrderLine: { lineNumber: "asc" as const } },
  },
} satisfies Prisma.BackorderInclude;

type BackorderWithContext = Prisma.BackorderGetPayload<{ include: typeof backorderInclude }>;

export type BackorderTransitionAction = "escalate" | "resolve" | "dismiss" | "reopen";

export interface BackorderActor {
  id?: string | null;
  name?: string | null;
  type?: AuditActorType;
  requestId?: string | null;
}

function delayDaysFrom(date: Date | null) {
  if (!date) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((today.getTime() - target.getTime()) / 86_400_000));
}

function uiStatus(status: BackorderStatus): UiStatus {
  return status.toLowerCase() as UiStatus;
}

function uiPriority(priority: BackorderPriority): UiPriority {
  return priority.toLowerCase() as UiPriority;
}

function priorityFor(orderStatus: string, delayDays: number): BackorderPriority {
  if (orderStatus === "At_Risk" || delayDays >= 20) return BackorderPriority.Critical;
  if (delayDays >= 7) return BackorderPriority.High;
  return BackorderPriority.Normal;
}

function mapCase(row: BackorderWithContext): DerivedBackorder {
  const activeLines = row.lines.filter((line) => line.status !== BackorderLineStatus.Cancelled);
  const items = activeLines.map((line) => {
    const requestedDate = line.requestedDate ?? line.purchaseOrderLine.requestedDate ?? line.createdAt;
    return {
      id: line.id,
      description: line.purchaseOrderLine.description,
      qty: line.quantity,
      unit: line.purchaseOrderLine.uom,
      requestedDate: requestedDate.toISOString(),
      delayDays: delayDaysFrom(requestedDate),
      remarks: line.notes ?? line.purchaseOrderLine.remarks,
    };
  });
  const totalDelayDays = items.reduce((max, item) => Math.max(max, item.delayDays), 0);
  const requestDate = items[0]?.requestedDate ?? row.openedAt.toISOString();

  return {
    id: row.id,
    poId: row.purchaseOrderId,
    poNumber: row.purchaseOrder.poNumber,
    vendor: row.purchaseOrder.supplier,
    supplierId: row.supplierId,
    supplierEmail: row.purchaseOrder.supplierRel?.email ?? null,
    supplierContact: row.purchaseOrder.supplierRel?.contactPerson ?? null,
    vessel: row.purchaseOrder.vessel,
    port: row.purchaseOrder.port,
    eta: row.purchaseOrder.eta.toISOString(),
    status: uiStatus(row.status),
    priority: uiPriority(row.priority),
    totalDelayDays,
    requestDate,
    items,
    notes: row.notes ?? row.reason ?? undefined,
    escalatedAt: row.escalatedAt?.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString(),
    backorderNumber: row.backorderNumber ?? undefined,
    source: "backorder_case",
  };
}

export async function listBackorders(organizationId: string): Promise<DerivedBackorder[]> {
  const [cases, derived] = await Promise.all([
    prisma.backorder.findMany({
      where: { organizationId },
      include: backorderInclude,
      orderBy: [{ openedAt: "asc" }, { id: "asc" }],
    }),
    getDerivedBackorders(organizationId),
  ]);
  const materializedOrderIds = new Set(cases.map((row) => row.purchaseOrderId));
  return [
    ...cases.map(mapCase),
    ...derived.filter((row) => !materializedOrderIds.has(row.poId)),
  ].sort((a, b) => b.totalDelayDays - a.totalDelayDays || a.poNumber.localeCompare(b.poNumber));
}

export async function getBackorderById(id: string, organizationId: string) {
  const decoded = decodeURIComponent(id);
  const rows = await listBackorders(organizationId);
  return rows.find((row) => row.id === decoded || row.poId === decoded || row.poNumber.toLowerCase() === decoded.toLowerCase()) ?? null;
}

async function backorderNumber(organizationId: string, legalEntityId?: string | null) {
  if (!legalEntityId) return null;
  const issued = await issueNumber({
    organizationId,
    legalEntityId,
    documentType: NumberSequenceDocumentType.Backorder,
    prefix: "BO",
    padding: 5,
    metadata: { source: "backorder_materialization" },
  });
  return issued.number;
}

async function synchronizeLines(tx: Prisma.TransactionClient, backorderId: string, lines: Array<{
  id: string;
  qtyOrdered: number;
  qtyDelivered: number;
  requestedDate: Date | null;
  confirmedDate: Date | null;
  remarks: string | null;
}>, caseStatus: BackorderStatus = BackorderStatus.Open) {
  for (const line of lines) {
    await tx.backorderLine.upsert({
      where: { backorderId_purchaseOrderLineId: { backorderId, purchaseOrderLineId: line.id } },
      update: {
        quantity: Math.max(0, line.qtyOrdered - line.qtyDelivered),
        requestedDate: line.requestedDate,
        expectedDate: line.confirmedDate,
        notes: line.remarks,
      },
      create: {
        backorderId,
        purchaseOrderLineId: line.id,
        quantity: Math.max(0, line.qtyOrdered - line.qtyDelivered),
        requestedDate: line.requestedDate,
        expectedDate: line.confirmedDate,
        notes: line.remarks,
        status: caseStatus === BackorderStatus.Resolved ? BackorderLineStatus.Resolved : BackorderLineStatus.Open,
        resolvedAt: caseStatus === BackorderStatus.Resolved ? new Date() : null,
      },
    });
  }
}

export async function materializeBackorder(input: {
  organizationId: string;
  legalEntityId?: string | null;
  purchaseOrderId: string;
  actor?: BackorderActor;
}) {
  const existing = await prisma.backorder.findFirst({
    where: { organizationId: input.organizationId, purchaseOrderId: input.purchaseOrderId },
    include: backorderInclude,
  });
  const purchaseOrder = await prisma.purchaseOrder.findFirst({
    where: { id: input.purchaseOrderId, organizationId: input.organizationId },
    include: { lines: { where: { status: "Backordered" }, orderBy: { lineNumber: "asc" } } },
  });
  if (!purchaseOrder) throw new Error("Purchase order was not found in the active organization.");
  if (purchaseOrder.lines.length === 0) throw new Error("Purchase order has no lines marked Backordered.");

  if (existing) {
    await prisma.$transaction((tx) => synchronizeLines(tx, existing.id, purchaseOrder.lines, existing.status));
    const refreshed = await prisma.backorder.findUniqueOrThrow({ where: { id: existing.id }, include: backorderInclude });
    return { created: false, backorder: mapCase(refreshed) };
  }

  if (input.legalEntityId) {
    const validScope = await prisma.legalEntity.count({ where: { id: input.legalEntityId, organizationId: input.organizationId } });
    if (!validScope) throw new Error("Legal entity does not belong to the active organization.");
  }
  const maxDelay = purchaseOrder.lines.reduce((max, line) => Math.max(max, delayDaysFrom(line.requestedDate ?? purchaseOrder.requestedDate)), 0);
  const number = await backorderNumber(input.organizationId, input.legalEntityId);
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: input.organizationId }, select: { dataMode: true } });
  let created: BackorderWithContext;
  try {
    created = await prisma.$transaction(async (tx) => {
      const row = await tx.backorder.create({
        data: {
          organizationId: input.organizationId,
          legalEntityId: input.legalEntityId ?? null,
          purchaseOrderId: purchaseOrder.id,
          supplierId: purchaseOrder.supplierId,
          backorderNumber: number,
          sourceKey: `purchase-order:${purchaseOrder.id}`,
          priority: priorityFor(purchaseOrder.status, maxDelay),
          ownerId: input.actor?.id ?? null,
          ownerName: input.actor?.name ?? null,
        },
      });
      await synchronizeLines(tx, row.id, purchaseOrder.lines);
      await tx.purchaseOrderEvent.create({
        data: {
          orderId: purchaseOrder.id,
          type: "backorder_created",
          summary: `Backorder case ${number ?? row.id} created`,
          detail: JSON.stringify({ backorderId: row.id, backorderNumber: number, lineCount: purchaseOrder.lines.length }),
          actor: input.actor?.name ?? "operator",
        },
      });
      await recordAuditEvent({
        organizationId: input.organizationId,
        entityType: "Backorder",
        entityId: row.id,
        entityNumber: row.backorderNumber,
        eventType: ERP_AUDIT_EVENTS.CREATED,
        actorType: input.actor?.type ?? AuditActorType.Operator,
        actorId: input.actor?.id,
        actorName: input.actor?.name,
        sourceModule: "backorders",
        after: { status: row.status, priority: row.priority, purchaseOrderId: row.purchaseOrderId },
        requestId: input.actor?.requestId,
      }, tx);
      await recordProvenance({
        organizationId: input.organizationId,
        entityType: "Backorder",
        entityId: row.id,
        kind: provenanceKindForOrganizationDataMode(organization.dataMode),
        source: "purchase_order_lines",
        metadata: { purchaseOrderId: purchaseOrder.id },
      }, tx);
      return tx.backorder.findUniqueOrThrow({ where: { id: row.id }, include: backorderInclude });
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    created = await prisma.backorder.findFirstOrThrow({
      where: { organizationId: input.organizationId, purchaseOrderId: purchaseOrder.id },
      include: backorderInclude,
    });
    return { created: false, backorder: mapCase(created) };
  }

  return { created: true, backorder: mapCase(created) };
}

function targetStatus(action: BackorderTransitionAction): BackorderStatus {
  if (action === "escalate") return BackorderStatus.Escalated;
  if (action === "resolve") return BackorderStatus.Resolved;
  if (action === "dismiss") return BackorderStatus.Dismissed;
  return BackorderStatus.Open;
}

export async function transitionBackorder(input: {
  organizationId: string;
  id: string;
  action: BackorderTransitionAction;
  note?: string | null;
  actor?: BackorderActor;
}) {
  const current = await prisma.backorder.findFirst({ where: { id: input.id, organizationId: input.organizationId } });
  if (!current) throw new Error("Backorder case was not found in the active organization.");
  const nextStatus = targetStatus(input.action);
  assertTransitionStatus(BACKORDER_LIFECYCLE, current.status, nextStatus);
  if (current.status === nextStatus) {
    const row = await prisma.backorder.findUniqueOrThrow({ where: { id: current.id }, include: backorderInclude });
    return { changed: false, backorder: mapCase(row) };
  }

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.backorder.updateMany({
      where: { id: current.id, organizationId: input.organizationId, version: current.version },
      data: {
        status: nextStatus,
        notes: input.note ?? current.notes,
        lastReviewedAt: now,
        escalatedAt: nextStatus === BackorderStatus.Escalated ? now : current.escalatedAt,
        resolvedAt: nextStatus === BackorderStatus.Resolved ? now : nextStatus === BackorderStatus.Open ? null : current.resolvedAt,
        dismissedAt: nextStatus === BackorderStatus.Dismissed ? now : nextStatus === BackorderStatus.Open ? null : current.dismissedAt,
        version: { increment: 1 },
      },
    });
    if (result.count !== 1) throw new Error("Backorder changed concurrently; reload and retry.");
    if (nextStatus === BackorderStatus.Resolved) {
      await tx.backorderLine.updateMany({ where: { backorderId: current.id, status: BackorderLineStatus.Open }, data: { status: BackorderLineStatus.Resolved, resolvedAt: now } });
    } else if (nextStatus === BackorderStatus.Open) {
      await tx.backorderLine.updateMany({ where: { backorderId: current.id, purchaseOrderLine: { status: "Backordered" } }, data: { status: BackorderLineStatus.Open, resolvedAt: null } });
    }
    await tx.purchaseOrderEvent.create({
      data: {
        orderId: current.purchaseOrderId,
        type: "backorder_status_changed",
        summary: `Backorder changed from ${current.status} to ${nextStatus}`,
        detail: JSON.stringify({ backorderId: current.id, from: current.status, to: nextStatus, note: input.note ?? null }),
        actor: input.actor?.name ?? "operator",
      },
    });
    await recordAuditEvent({
      organizationId: input.organizationId,
      entityType: "Backorder",
      entityId: current.id,
      entityNumber: current.backorderNumber,
      eventType: ERP_AUDIT_EVENTS.STATUS_CHANGED,
      actorType: input.actor?.type ?? AuditActorType.Operator,
      actorId: input.actor?.id,
      actorName: input.actor?.name,
      sourceModule: "backorders",
      before: { status: current.status },
      after: { status: nextStatus },
      metadata: { action: input.action, note: input.note ?? null },
      requestId: input.actor?.requestId,
    }, tx);
    return tx.backorder.findUniqueOrThrow({ where: { id: current.id }, include: backorderInclude });
  });
  return { changed: true, backorder: mapCase(updated) };
}
