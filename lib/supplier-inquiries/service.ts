import { assertRfqReviewConfirmed, lockReviewedRfq } from "@/lib/rfq/review-lock";
import { randomUUID } from "node:crypto";
import {
  AuditActorType,
  NumberSequenceDocumentType,
  Prisma,
  SupplierInquiryLineStatus,
  SupplierInquiryStatus,
} from "@prisma/client";
import { ERP_AUDIT_EVENTS, recordAuditEvent } from "@/lib/erp-core/audit";
import { SUPPLIER_INQUIRY_LIFECYCLE, assertTransitionStatus } from "@/lib/erp-core/lifecycle";
import { issueNumber } from "@/lib/erp-core/number-sequences";
import { provenanceKindForOrganizationDataMode, recordProvenance } from "@/lib/erp-core/provenance";
import { prisma } from "@/lib/prisma";

const inquiryInclude = {
  rfq: { select: { id: true, vessel: true, port: true, neededBy: true, status: true } },
  supplier: { select: { id: true, supplierCode: true, name: true, email: true, contactPerson: true, partyId: true } },
  party: { select: { id: true, displayName: true } },
  lines: {
    include: {
      rfqLine: { select: { id: true, lineNumber: true } },
      supplierQuote: { select: { id: true, unitPrice: true, currency: true, leadTimeDays: true, stockStatus: true, status: true } },
    },
    orderBy: { lineNumber: "asc" as const },
  },
} satisfies Prisma.SupplierInquiryInclude;

type InquiryWithContext = Prisma.SupplierInquiryGetPayload<{ include: typeof inquiryInclude }>;

export interface SupplierInquiryActor {
  id?: string | null;
  name?: string | null;
  type?: AuditActorType;
  requestId?: string | null;
}

export interface CreateSupplierInquiryInput {
  organizationId: string;
  legalEntityId?: string | null;
  rfqId: string;
  supplierId: string;
  rfqLineIds?: string[];
  subject?: string | null;
  message?: string | null;
  responseDueAt?: Date | null;
  sourceKey?: string | null;
  actor?: SupplierInquiryActor;
}

export type InquiryTransitionAction = "send" | "close" | "cancel";
export type InquiryResponseType = "quoted" | "unavailable";

function mapInquiry(row: InquiryWithContext) {
  return {
    id: row.id,
    inquiryNumber: row.inquiryNumber,
    rfqId: row.rfqId,
    supplierId: row.supplierId,
    partyId: row.partyId,
    supplier: row.supplier.name,
    supplierCode: row.supplier.supplierCode,
    supplierEmail: row.supplier.email,
    supplierContact: row.supplier.contactPerson,
    vessel: row.rfq.vessel,
    port: row.rfq.port,
    neededBy: row.rfq.neededBy,
    status: row.status,
    subject: row.subject,
    message: row.message,
    responseDueAt: row.responseDueAt?.toISOString() ?? null,
    sentAt: row.sentAt?.toISOString() ?? null,
    respondedAt: row.respondedAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    lines: row.lines.map((line) => ({
      id: line.id,
      rfqLineId: line.rfqLineId,
      lineNumber: line.lineNumber,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      impaCode: line.impaCode,
      status: line.status,
      responseNote: line.responseNote,
      respondedAt: line.respondedAt?.toISOString() ?? null,
      quote: line.supplierQuote,
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listSupplierInquiries(organizationId: string, filters: { rfqId?: string; supplierId?: string } = {}) {
  const rows = await prisma.supplierInquiry.findMany({
    where: { organizationId, ...(filters.rfqId ? { rfqId: filters.rfqId } : {}), ...(filters.supplierId ? { supplierId: filters.supplierId } : {}) },
    include: inquiryInclude,
    orderBy: [{ responseDueAt: "asc" }, { createdAt: "desc" }, { id: "desc" }],
  });
  return rows.map(mapInquiry);
}

async function issueInquiryNumber(organizationId: string, legalEntityId?: string | null) {
  if (!legalEntityId) return null;
  const issued = await issueNumber({
    organizationId,
    legalEntityId,
    documentType: NumberSequenceDocumentType.SupplierInquiry,
    prefix: "INQ",
    padding: 5,
    metadata: { source: "supplier_inquiry" },
  });
  return issued.number;
}

export async function createSupplierInquiry(input: CreateSupplierInquiryInput) {
  const rfq = await prisma.rfq.findFirst({
    where: { id: input.rfqId, organizationId: input.organizationId },
    include: { lines: { orderBy: { lineNumber: "asc" } }, organization: { select: { dataMode: true } } },
  });
  if (!rfq) throw new Error("RFQ was not found in the active organization.");
  assertRfqReviewConfirmed(rfq.review);

  const supplier = await prisma.supplier.findFirst({ where: { id: input.supplierId, organizationId: input.organizationId } });
  if (!supplier) throw new Error("Supplier was not found in the active organization.");
  if (input.legalEntityId) {
    const valid = await prisma.legalEntity.count({ where: { id: input.legalEntityId, organizationId: input.organizationId } });
    if (!valid) throw new Error("Legal entity does not belong to the active organization.");
  }
  const selectedIds = input.rfqLineIds?.length ? new Set(input.rfqLineIds) : null;
  const selectedLines = selectedIds ? rfq.lines.filter((line) => selectedIds.has(line.id)) : rfq.lines;
  if (selectedLines.length === 0) throw new Error("At least one RFQ line is required for a supplier inquiry.");
  if (selectedIds && selectedLines.length !== selectedIds.size) throw new Error("One or more selected lines do not belong to the RFQ.");
  const inquiryNumber = await issueInquiryNumber(input.organizationId, input.legalEntityId);

  const created = await prisma.$transaction(async (tx) => {
    await lockReviewedRfq(tx,rfq.id,input.organizationId,rfq.updatedAt);
    const row = await tx.supplierInquiry.create({
      data: {
        organizationId: input.organizationId,
        legalEntityId: input.legalEntityId ?? null,
        rfqId: rfq.id,
        supplierId: supplier.id,
        partyId: supplier.partyId,
        inquiryNumber,
        sourceKey: input.sourceKey?.trim() || `manual:${randomUUID()}`,
        subject: input.subject?.trim() || `Request for quotation - ${rfq.vessel} / ${rfq.port}`,
        message: input.message?.trim() || null,
        responseDueAt: input.responseDueAt ?? null,
        createdById: input.actor?.id ?? null,
        createdByName: input.actor?.name ?? null,
        lines: {
          create: selectedLines.map((line, index) => ({
            rfqLineId: line.id,
            lineNumber: index + 1,
            description: line.description,
            quantity: line.quantity,
            unit: line.unit,
            impaCode: line.impaCode,
          })),
        },
      },
    });
    await recordAuditEvent({
      organizationId: input.organizationId,
      entityType: "SupplierInquiry",
      entityId: row.id,
      entityNumber: row.inquiryNumber,
      eventType: ERP_AUDIT_EVENTS.CREATED,
      actorType: input.actor?.type ?? AuditActorType.Operator,
      actorId: input.actor?.id,
      actorName: input.actor?.name,
      sourceModule: "supplier-inquiries",
      after: { status: row.status, rfqId: row.rfqId, supplierId: row.supplierId, lineCount: selectedLines.length },
      requestId: input.actor?.requestId,
    }, tx);
    await recordProvenance({
      organizationId: input.organizationId,
      entityType: "SupplierInquiry",
      entityId: row.id,
      kind: provenanceKindForOrganizationDataMode(rfq.organization!.dataMode),
      source: "rfq",
      metadata: { rfqId: rfq.id, supplierId: supplier.id },
    }, tx);
    return tx.supplierInquiry.findUniqueOrThrow({ where: { id: row.id }, include: inquiryInclude });
  });
  return mapInquiry(created);
}

function transitionTarget(action: InquiryTransitionAction) {
  if (action === "send") return SupplierInquiryStatus.Sent;
  if (action === "close") return SupplierInquiryStatus.Closed;
  return SupplierInquiryStatus.Cancelled;
}

export async function transitionSupplierInquiry(input: {
  organizationId: string;
  id: string;
  action: InquiryTransitionAction;
  actor?: SupplierInquiryActor;
}) {
  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.supplierInquiry.findFirst({ where: { id: input.id, organizationId: input.organizationId }, include: inquiryInclude });
    if (!current) throw new Error("Supplier inquiry was not found in the active organization.");
    const nextStatus = transitionTarget(input.action);
    if (current.status === nextStatus) return current;
    assertTransitionStatus(SUPPLIER_INQUIRY_LIFECYCLE, current.status, nextStatus);
    const now = new Date();
    if (input.action === "send") await tx.rfq.update({ where: { id: current.rfqId }, data: { status: "Sent" } });
    if (input.action === "close") {
      await tx.supplierInquiryLine.updateMany({
        where: { inquiryId: current.id, status: SupplierInquiryLineStatus.Pending },
        data: { status: SupplierInquiryLineStatus.NoResponse, respondedAt: now },
      });
    }
    const updated = await tx.supplierInquiry.updateMany({
      where: { id: current.id, status: current.status, version: current.version },
      data: {
        status: nextStatus,
        sentAt: nextStatus === SupplierInquiryStatus.Sent ? now : current.sentAt,
        closedAt: nextStatus === SupplierInquiryStatus.Closed ? now : current.closedAt,
        cancelledAt: nextStatus === SupplierInquiryStatus.Cancelled ? now : current.cancelledAt,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new Error("Supplier inquiry changed concurrently; reload and retry.");
    await recordAuditEvent({
      organizationId: input.organizationId,
      entityType: "SupplierInquiry",
      entityId: current.id,
      entityNumber: current.inquiryNumber,
      eventType: ERP_AUDIT_EVENTS.STATUS_CHANGED,
      actorType: input.actor?.type ?? AuditActorType.Operator,
      actorId: input.actor?.id,
      actorName: input.actor?.name,
      sourceModule: "supplier-inquiries",
      before: { status: current.status },
      after: { status: nextStatus },
      metadata: { action: input.action },
      requestId: input.actor?.requestId,
    }, tx);
    return tx.supplierInquiry.findUniqueOrThrow({ where: { id: current.id }, include: inquiryInclude });
  });
  return mapInquiry(result);
}

async function updateRfqQuoteStatus(tx: Prisma.TransactionClient, rfqId: string) {
  const lines = await tx.rfqLine.findMany({
    where: { rfqId },
    select: { id: true, supplierQuotes: { where: { status: "Received" }, select: { id: true }, take: 1 } },
  });
  if (lines.length > 0 && lines.every((line) => line.supplierQuotes.length > 0)) {
    await tx.rfq.update({ where: { id: rfqId }, data: { status: "Quoted" } });
  }
}

export async function recordSupplierInquiryResponse(input: {
  organizationId: string;
  inquiryId: string;
  lineId: string;
  responseType: InquiryResponseType;
  unitPrice?: number | null;
  currency?: string | null;
  leadTimeDays?: number | null;
  stockStatus?: string | null;
  note?: string | null;
  actor?: SupplierInquiryActor;
}) {
  const result = await prisma.$transaction(async (tx) => {
    const inquiry = await tx.supplierInquiry.findFirst({
      where: { id: input.inquiryId, organizationId: input.organizationId },
      include: { lines: true },
    });
    if (!inquiry) throw new Error("Supplier inquiry was not found in the active organization.");
    if (inquiry.status !== SupplierInquiryStatus.Sent && inquiry.status !== SupplierInquiryStatus.PartiallyResponded) throw new Error("Responses can only be recorded for sent supplier inquiries.");
    const line = inquiry.lines.find((entry) => entry.id === input.lineId);
    if (!line) throw new Error("Supplier inquiry line was not found.");
    if (input.responseType === "quoted") {
      if (!Number.isFinite(input.unitPrice) || (input.unitPrice ?? -1) < 0) throw new Error("A non-negative unit price is required for a quoted response.");
      await tx.supplierQuote.upsert({
        where: { supplierInquiryLineId: line.id },
        update: {
          unitPrice: input.unitPrice!,
          currency: input.currency?.trim().toUpperCase() || "EUR",
          leadTimeDays: input.leadTimeDays ?? null,
          stockStatus: input.stockStatus?.trim() || null,
          status: "Received",
        },
        create: {
          supplierId: inquiry.supplierId,
          rfqLineId: line.rfqLineId,
          supplierInquiryLineId: line.id,
          description: line.description,
          unitPrice: input.unitPrice!,
          currency: input.currency?.trim().toUpperCase() || "EUR",
          leadTimeDays: input.leadTimeDays ?? null,
          stockStatus: input.stockStatus?.trim() || null,
          status: "Received",
        },
      });
    } else {
      await tx.supplierQuote.deleteMany({ where: { supplierInquiryLineId: line.id } });
    }
    const now = new Date();
    await tx.supplierInquiryLine.update({
      where: { id: line.id },
      data: {
        status: input.responseType === "quoted" ? SupplierInquiryLineStatus.Quoted : SupplierInquiryLineStatus.Unavailable,
        responseNote: input.note?.trim() || null,
        respondedAt: now,
      },
    });
    const pending = await tx.supplierInquiryLine.count({ where: { inquiryId: inquiry.id, status: SupplierInquiryLineStatus.Pending } });
    const nextStatus = pending === 0 ? SupplierInquiryStatus.Responded : SupplierInquiryStatus.PartiallyResponded;
    assertTransitionStatus(SUPPLIER_INQUIRY_LIFECYCLE, inquiry.status, nextStatus);
    await tx.supplierInquiry.update({ where: { id: inquiry.id }, data: { status: nextStatus, respondedAt: now, version: { increment: 1 } } });
    await updateRfqQuoteStatus(tx, inquiry.rfqId);
    await recordAuditEvent({
      organizationId: input.organizationId,
      entityType: "SupplierInquiry",
      entityId: inquiry.id,
      entityNumber: inquiry.inquiryNumber,
      eventType: ERP_AUDIT_EVENTS.EDITED,
      actorType: input.actor?.type ?? AuditActorType.Operator,
      actorId: input.actor?.id,
      actorName: input.actor?.name,
      sourceModule: "supplier-inquiries",
      before: { status: inquiry.status, lineStatus: line.status },
      after: { status: nextStatus, lineStatus: input.responseType === "quoted" ? SupplierInquiryLineStatus.Quoted : SupplierInquiryLineStatus.Unavailable },
      metadata: { action: "response_recorded", lineId: line.id, responseType: input.responseType },
      requestId: input.actor?.requestId,
    }, tx);
    return tx.supplierInquiry.findUniqueOrThrow({ where: { id: inquiry.id }, include: inquiryInclude });
  });
  return mapInquiry(result);
}
