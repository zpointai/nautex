import { assertRfqReviewConfirmed, lockReviewedRfq } from "@/lib/rfq/review-lock";
import { randomUUID } from "node:crypto";
import {
  AuditActorType,
  CustomerQuoteStatus,
  NumberSequenceDocumentType,
  Prisma,
} from "@prisma/client";
import { ERP_AUDIT_EVENTS, recordAuditEvent } from "@/lib/erp-core/audit";
import { CUSTOMER_QUOTE_LIFECYCLE, assertTransitionStatus } from "@/lib/erp-core/lifecycle";
import { issueNumber } from "@/lib/erp-core/number-sequences";
import { provenanceKindForOrganizationDataMode, recordProvenance } from "@/lib/erp-core/provenance";
import { prisma } from "@/lib/prisma";

const quoteInclude = {
  customer: { select: { id: true, customerCode: true, name: true, paymentTerms: true, defaultCurrency: true, partyId: true } },
  party: { select: { id: true, displayName: true } },
  rfq: { select: { id: true, vessel: true, port: true, neededBy: true, status: true } },
  lines: {
    include: {
      sourceSupplierQuote: {
        select: { id: true, supplierId: true, unitPrice: true, currency: true, supplier: { select: { name: true } } },
      },
    },
    orderBy: { lineNumber: "asc" as const },
  },
} satisfies Prisma.CustomerQuoteInclude;

type QuoteWithContext = Prisma.CustomerQuoteGetPayload<{ include: typeof quoteInclude }>;

export interface CustomerQuoteActor {
  id?: string | null;
  name?: string | null;
  type?: AuditActorType;
  requestId?: string | null;
}

export interface CreateCustomerQuoteInput {
  organizationId: string;
  legalEntityId?: string | null;
  customerId: string;
  rfqId: string;
  rfqLineIds?: string[];
  markupPct: number;
  vatRate?: number;
  validityDays?: number;
  customerReference?: string | null;
  subject?: string | null;
  notes?: string | null;
  sourceKey?: string | null;
  actor?: CustomerQuoteActor;
}

export type CustomerQuoteTransitionAction =
  | "submit"
  | "approve"
  | "return"
  | "send"
  | "accept"
  | "decline"
  | "expire"
  | "cancel";

function decimalNumber(value: Prisma.Decimal) {
  return value.toNumber();
}

function mapQuote(row: QuoteWithContext) {
  return {
    id: row.id,
    quoteNumber: row.quoteNumber,
    customerId: row.customerId,
    partyId: row.partyId,
    customer: row.customer.name,
    customerCode: row.customer.customerCode,
    rfqId: row.rfqId,
    vessel: row.vesselName,
    port: row.port,
    status: row.status,
    currency: row.currency,
    validUntil: row.validUntil.toISOString(),
    paymentTerms: row.paymentTerms,
    customerReference: row.customerReference,
    subject: row.subject,
    notes: row.notes,
    markupPct: decimalNumber(row.markupPct),
    marginPct: decimalNumber(row.marginPct),
    netAmount: decimalNumber(row.netAmount),
    vatRate: decimalNumber(row.vatRate),
    vatAmount: decimalNumber(row.vatAmount),
    grossAmount: decimalNumber(row.grossAmount),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    approvedByName: row.approvedByName,
    sentAt: row.sentAt?.toISOString() ?? null,
    respondedAt: row.respondedAt?.toISOString() ?? null,
    lines: row.lines.map((line) => ({
      id: line.id,
      rfqLineId: line.rfqLineId,
      sourceSupplierQuoteId: line.sourceSupplierQuoteId,
      sourceSupplier: line.sourceSupplierQuote?.supplier.name ?? null,
      lineNumber: line.lineNumber,
      description: line.description,
      quantity: decimalNumber(line.quantity),
      unit: line.unit,
      impaCode: line.impaCode,
      unitCost: decimalNumber(line.unitCost),
      unitPrice: decimalNumber(line.unitPrice),
      netAmount: decimalNumber(line.netAmount),
      marginPct: decimalNumber(line.marginPct),
      currency: line.currency,
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function bounded(value: number, label: string, min: number, max: number) {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return value;
}

async function issueQuoteNumber(organizationId: string, legalEntityId?: string | null) {
  if (!legalEntityId) return null;
  const issued = await issueNumber({
    organizationId,
    legalEntityId,
    documentType: NumberSequenceDocumentType.Quote,
    prefix: "QUO",
    padding: 5,
    metadata: { source: "customer_quote" },
  });
  return issued.number;
}

export async function listCustomerQuotes(organizationId: string, filters: { customerId?: string; rfqId?: string } = {}) {
  const rows = await prisma.customerQuote.findMany({
    where: {
      organizationId,
      ...(filters.customerId ? { customerId: filters.customerId } : {}),
      ...(filters.rfqId ? { rfqId: filters.rfqId } : {}),
    },
    include: quoteInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return rows.map(mapQuote);
}

export async function createCustomerQuote(input: CreateCustomerQuoteInput) {
  const markupPct = bounded(input.markupPct, "Markup percentage", 0, 500);
  const vatRate = bounded(input.vatRate ?? 0, "VAT rate", 0, 100);
  const validityDays = bounded(input.validityDays ?? 30, "Validity days", 1, 365);
  if (!Number.isInteger(validityDays)) throw new Error("Validity days must be a whole number.");
  const [rfq, customer] = await Promise.all([
    prisma.rfq.findFirst({
      where: { id: input.rfqId, organizationId: input.organizationId },
      include: { lines: { orderBy: { lineNumber: "asc" } }, organization: { select: { dataMode: true } } },
    }),
    prisma.customerAccount.findFirst({ where: { id: input.customerId, organizationId: input.organizationId, status: "Active" } }),
  ]);
  if (!rfq) throw new Error("RFQ was not found in the active organization.");
  assertRfqReviewConfirmed(rfq.review);
  if (!customer) throw new Error("Active customer account was not found in the active organization.");
  if (input.legalEntityId) {
    const valid = await prisma.legalEntity.count({ where: { id: input.legalEntityId, organizationId: input.organizationId } });
    if (!valid) throw new Error("Legal entity does not belong to the active organization.");
  }

  const requestedLineIds = input.rfqLineIds?.length ? new Set(input.rfqLineIds) : null;
  const selectedLines = requestedLineIds ? rfq.lines.filter((line) => requestedLineIds.has(line.id)) : rfq.lines;
  if (selectedLines.length === 0) throw new Error("At least one RFQ line is required for a customer quote.");
  if (requestedLineIds && requestedLineIds.size !== selectedLines.length) throw new Error("One or more selected lines do not belong to the RFQ.");

  const currency = customer.defaultCurrency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Customer default currency must be a three-letter ISO code.");
  const supplierQuotes = await prisma.supplierQuote.findMany({
    where: {
      rfqLineId: { in: selectedLines.map((line) => line.id) },
      status: "Received",
      currency,
      supplier: { organizationId: input.organizationId },
    },
    orderBy: [{ unitPrice: "asc" }, { createdAt: "asc" }],
  });
  const bestQuoteByLine = new Map<string, typeof supplierQuotes[number]>();
  for (const quote of supplierQuotes) {
    if (quote.rfqLineId && !bestQuoteByLine.has(quote.rfqLineId)) bestQuoteByLine.set(quote.rfqLineId, quote);
  }
  const missing = selectedLines.filter((line) => !bestQuoteByLine.has(line.id));
  if (missing.length) {
    throw new Error(`Received supplier pricing in ${currency} is required for RFQ line${missing.length === 1 ? "" : "s"} ${missing.map((line) => line.lineNumber).join(", ")}.`);
  }

  const preparedLines = selectedLines.map((line, index) => {
    const sourceQuote = bestQuoteByLine.get(line.id)!;
    const unitCost = round(sourceQuote.unitPrice, 4);
    const unitPrice = round(unitCost * (1 + markupPct / 100), 4);
    const netAmount = round(unitPrice * line.quantity, 2);
    const marginPct = unitPrice > 0 ? round(((unitPrice - unitCost) / unitPrice) * 100, 2) : 0;
    return { line, sourceQuote, lineNumber: index + 1, unitCost, unitPrice, netAmount, marginPct };
  });
  const netAmount = round(preparedLines.reduce((sum, line) => sum + line.netAmount, 0), 2);
  const totalCost = round(preparedLines.reduce((sum, line) => sum + line.unitCost * line.line.quantity, 0), 2);
  const marginPct = netAmount > 0 ? round(((netAmount - totalCost) / netAmount) * 100, 2) : 0;
  const vatAmount = round(netAmount * (vatRate / 100), 2);
  const grossAmount = round(netAmount + vatAmount, 2);
  const quoteNumber = await issueQuoteNumber(input.organizationId, input.legalEntityId);
  const validUntil = new Date(Date.now() + validityDays * 86_400_000);

  const created = await prisma.$transaction(async (tx) => {
    await lockReviewedRfq(tx,rfq.id,input.organizationId,rfq.updatedAt);
    const row = await tx.customerQuote.create({
      data: {
        organizationId: input.organizationId,
        legalEntityId: input.legalEntityId ?? null,
        customerId: customer.id,
        partyId: customer.partyId,
        rfqId: rfq.id,
        quoteNumber,
        sourceKey: input.sourceKey?.trim() || `manual:${randomUUID()}`,
        currency,
        validUntil,
        paymentTerms: customer.paymentTerms,
        vesselName: rfq.vessel,
        port: rfq.port,
        customerReference: input.customerReference?.trim() || null,
        subject: input.subject?.trim() || `Quotation - ${rfq.vessel} / ${rfq.port}`,
        notes: input.notes?.trim() || null,
        markupPct,
        marginPct,
        netAmount,
        vatRate,
        vatAmount,
        grossAmount,
        createdById: input.actor?.id ?? null,
        createdByName: input.actor?.name ?? null,
        lines: {
          create: preparedLines.map((entry) => ({
            rfqLineId: entry.line.id,
            sourceSupplierQuoteId: entry.sourceQuote.id,
            lineNumber: entry.lineNumber,
            description: entry.line.description,
            quantity: entry.line.quantity,
            unit: entry.line.unit,
            impaCode: entry.line.impaCode,
            unitCost: entry.unitCost,
            unitPrice: entry.unitPrice,
            netAmount: entry.netAmount,
            marginPct: entry.marginPct,
            currency,
          })),
        },
      },
    });
    await recordAuditEvent({
      organizationId: input.organizationId,
      entityType: "CustomerQuote",
      entityId: row.id,
      entityNumber: row.quoteNumber,
      eventType: ERP_AUDIT_EVENTS.CREATED,
      actorType: input.actor?.type ?? AuditActorType.Operator,
      actorId: input.actor?.id,
      actorName: input.actor?.name,
      sourceModule: "customer-quotes",
      after: { status: row.status, customerId: row.customerId, rfqId: row.rfqId, lineCount: selectedLines.length, netAmount, grossAmount },
      requestId: input.actor?.requestId,
    }, tx);
    await recordProvenance({
      organizationId: input.organizationId,
      entityType: "CustomerQuote",
      entityId: row.id,
      kind: provenanceKindForOrganizationDataMode(rfq.organization!.dataMode),
      source: "rfq_supplier_quotes",
      metadata: { rfqId: rfq.id, customerId: customer.id },
    }, tx);
    return tx.customerQuote.findUniqueOrThrow({ where: { id: row.id }, include: quoteInclude });
  });
  return mapQuote(created);
}

function transitionTarget(action: CustomerQuoteTransitionAction) {
  const targets: Record<CustomerQuoteTransitionAction, CustomerQuoteStatus> = {
    submit: CustomerQuoteStatus.PendingApproval,
    approve: CustomerQuoteStatus.Approved,
    return: CustomerQuoteStatus.Draft,
    send: CustomerQuoteStatus.Sent,
    accept: CustomerQuoteStatus.Accepted,
    decline: CustomerQuoteStatus.Declined,
    expire: CustomerQuoteStatus.Expired,
    cancel: CustomerQuoteStatus.Cancelled,
  };
  return targets[action];
}

export async function transitionCustomerQuote(input: {
  organizationId: string;
  id: string;
  action: CustomerQuoteTransitionAction;
  note?: string | null;
  actor?: CustomerQuoteActor;
}) {
  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.customerQuote.findFirst({ where: { id: input.id, organizationId: input.organizationId }, include: quoteInclude });
    if (!current) throw new Error("Customer quote was not found in the active organization.");
    const nextStatus = transitionTarget(input.action);
    if (current.status === nextStatus) return current;
    assertTransitionStatus(CUSTOMER_QUOTE_LIFECYCLE, current.status, nextStatus);
    const now = new Date();
    if (input.action === "expire" && current.validUntil > now) throw new Error("Customer quote cannot be expired before its validity date.");

    const updated = await tx.customerQuote.updateMany({
      where: { id: current.id, status: current.status, version: current.version },
      data: {
        status: nextStatus,
        submittedAt: input.action === "submit" ? now : current.submittedAt,
        approvedAt: input.action === "approve" ? now : current.approvedAt,
        approvedById: input.action === "approve" ? input.actor?.id ?? null : current.approvedById,
        approvedByName: input.action === "approve" ? input.actor?.name ?? null : current.approvedByName,
        sentAt: input.action === "send" ? now : current.sentAt,
        respondedAt: input.action === "accept" || input.action === "decline" ? now : current.respondedAt,
        acceptedAt: input.action === "accept" ? now : current.acceptedAt,
        declinedAt: input.action === "decline" ? now : current.declinedAt,
        expiredAt: input.action === "expire" ? now : current.expiredAt,
        cancelledAt: input.action === "cancel" ? now : current.cancelledAt,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new Error("Customer quote changed concurrently; reload and retry.");
    const eventType = input.action === "approve"
      ? ERP_AUDIT_EVENTS.APPROVED
      : input.action === "return"
        ? ERP_AUDIT_EVENTS.REJECTED
        : ERP_AUDIT_EVENTS.STATUS_CHANGED;
    await recordAuditEvent({
      organizationId: input.organizationId,
      entityType: "CustomerQuote",
      entityId: current.id,
      entityNumber: current.quoteNumber,
      eventType,
      actorType: input.actor?.type ?? AuditActorType.Operator,
      actorId: input.actor?.id,
      actorName: input.actor?.name,
      sourceModule: "customer-quotes",
      before: { status: current.status },
      after: { status: nextStatus },
      metadata: { action: input.action, note: input.note?.trim() || null },
      requestId: input.actor?.requestId,
    }, tx);
    return tx.customerQuote.findUniqueOrThrow({ where: { id: current.id }, include: quoteInclude });
  });
  return mapQuote(result);
}
