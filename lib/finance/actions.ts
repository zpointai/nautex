import { Prisma, VatCategory, type FinanceAuditAction } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toNumber, requireCurrency, OPEN_RECEIVABLE_STATUSES } from "@/lib/finance/calculations";
import { findMissingInvoiceFields } from "@/lib/finance/validation";
import { formatInvoiceNumber } from "@/lib/finance/numbering";
import { allocateIssuedCredit } from "@/lib/finance/settlements";
import { reviewedInvoiceTax } from "@/lib/finance/invoice-tax";
import { prepareScopedExport } from "./export-batches";

export interface FinanceActionActor {
  id: string;
  name: string;
  organizationId?: string | null;
  activeLegalEntityId?: string | null;
}

function jsonClone(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

async function audit(entityType: string, entityId: string, action: FinanceAuditAction, metadata: Prisma.InputJsonObject = {}, before?: unknown, after?: unknown, actor?: FinanceActionActor, db: Prisma.TransactionClient = prisma) {
  await db.financeAuditEvent.create({
    data: {
      organizationId: actor?.organizationId ?? null,
      entityType,
      entityId,
      action,
      actorType: actor ? "user" : "operator",
      actorId: actor?.id,
      before: before === undefined ? undefined : jsonClone(before),
      after: after === undefined ? undefined : jsonClone(after),
      metadata: { ...metadata, ...(actor ? { actorName: actor.name } : {}) },
    },
  });
}

async function validateCustomerInvoiceForPosting(invoiceId: string, actor?: FinanceActionActor) {
  const invoice = await prisma.customerInvoice.findFirst({
    where: {
      id: invoiceId,
      ...(actor?.organizationId ? { legalEntity: { organizationId: actor.organizationId } } : {}),
    },
    include: { legalEntity: true, customer: true, lines: true, vatSummaries: true },
  });
  if (!invoice) throw new Error("Invoice not found.");
  const missing = findMissingInvoiceFields(invoice as unknown as Record<string, unknown>);
  if (!invoice.legalEntity.name) missing.push("sellerLegalEntityName");
  if (!invoice.legalEntity.addressLine1 || !invoice.legalEntity.city || !invoice.legalEntity.country) missing.push("sellerAddress");
  if (!invoice.legalEntity.vatId) missing.push("sellerVatId");
  if (!invoice.customer.name) missing.push("customerName");
  if (!invoice.customer.addressLine1 || !invoice.customer.city || !invoice.customer.country) missing.push("customerAddress");
  if (invoice.lines.length === 0) missing.push("invoiceLines");
  if (invoice.vatSummaries.length === 0) missing.push("vatTotalsByRate");
  if (missing.length) {
    throw new Error(`Invoice is missing required legal fields: ${missing.join(", ")}.`);
  }
  return invoice;
}

export async function reviewCustomerInvoice(id: string, actor?: FinanceActionActor) {
  const invoice = await validateCustomerInvoiceForPosting(id, actor);
  if (invoice.status !== "Draft") return invoice;
  const updated = await prisma.customerInvoice.update({ where: { id }, data: { status: "Reviewed" } });
  await audit("CustomerInvoice", id, "InvoiceReviewed", { source: "finance-module" }, invoice, updated, actor);
  return updated;
}

function netDays(paymentTerms: string) {
  const match = paymentTerms.match(/Net\s+(\d+)/i);
  return match ? Number(match[1]) : 30;
}

export async function createCustomerInvoiceFromDeliveredOrder(orderId: string, actor?: FinanceActionActor, taxInput?: unknown) {
  const order = await prisma.purchaseOrder.findFirst({
    where: { id: orderId, ...(actor?.organizationId ? { organizationId: actor.organizationId } : {}) },
    include: { lines: true, customerInvoices: true, marginSnapshots: true },
  });
  if (!order) throw new Error("Purchase order not found.");
  if (order.status !== "Delivered") throw new Error("Only delivered orders can be invoiced.");
  if (order.customerInvoices.length > 0) return order.customerInvoices[0];
  requireCurrency(order.currency);
  const [legalEntity, matchingCustomers] = await Promise.all([
    prisma.legalEntity.findFirst({
      where: actor?.activeLegalEntityId
        ? { id: actor.activeLegalEntityId, ...(actor.organizationId ? { organizationId: actor.organizationId } : {}) }
        : actor?.organizationId ? { organizationId: actor.organizationId } : undefined,
      orderBy: { createdAt: "asc" },
    }),
    order.buyerName
      ? prisma.customerAccount.findMany({ where: { name: { equals: order.buyerName.trim(), mode: "insensitive" }, status: "Active", ...(actor?.organizationId ? { organizationId: actor.organizationId } : {}) }, take: 2 })
      : Promise.resolve([]),
  ]);
  if (!legalEntity) throw new Error("No seller legal entity is configured.");
  if (matchingCustomers.length !== 1) throw new Error("Match the order buyer to exactly one active customer account before invoicing. No customer was selected automatically.");
  const customer = matchingCustomers[0];

  const invoiceDate = new Date();
  const fiscalYear = invoiceDate.getFullYear();
  const taxReview = reviewedInvoiceTax(taxInput);
  const vatRate = taxReview.rate;
  const vatCategory = taxReview.category as VatCategory;
  const dueDate = new Date(invoiceDate);
  dueDate.setDate(dueDate.getDate() + netDays(customer.paymentTerms));
  const lines = order.lines.filter(line => line.qtyDelivered > 0);
  if (!lines.length) throw new Error("Record delivered quantities before creating an invoice.");

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-order:${orderId}`}))`;
    const existing = await tx.customerInvoice.findFirst({ where: { orderId } });
    if (existing) return existing;
    const currentOrder = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: orderId } });
    if (currentOrder.status !== "Delivered" || currentOrder.updatedAt.getTime() !== order.updatedAt.getTime()) throw new Error("Order changed while preparing the invoice. Refresh and review its delivery first.");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice-sequence:${legalEntity.id}:${fiscalYear}`}))`;
    const sequence = await tx.invoiceNumberSequence.findUnique({
      where: { legalEntityId_prefix_fiscalYear: { legalEntityId: legalEntity.id, prefix: "NAX-INV", fiscalYear } },
    });
    const issueNumber = sequence?.nextNumber ?? 1;
    if (sequence) {
      await tx.invoiceNumberSequence.update({
        where: { id: sequence.id },
        data: { nextNumber: { increment: 1 }, lastIssuedAt: invoiceDate },
      });
    } else {
      await tx.invoiceNumberSequence.create({
        data: { legalEntityId: legalEntity.id, prefix: "NAX-INV", fiscalYear, nextNumber: 2, lastIssuedAt: invoiceDate },
      });
    }
    const invoiceNo = formatInvoiceNumber("NAX-INV", fiscalYear, issueNumber);
    const invoiceLines = lines.map((line) => {
      const quantity = line.qtyDelivered;
      const unitPrice = line.buyerUnitPrice ?? line.unitPrice;
      const netAmount = new Prisma.Decimal(quantity).mul(unitPrice).toDecimalPlaces(2);
      const vatAmount = netAmount.mul(vatRate).div(100).toDecimalPlaces(2);
      return {
        lineNumber: line.lineNumber,
        orderLineId: line.id,
        description: line.description,
        quantity,
        unit: line.uom,
        unitPrice,
        netAmount,
        vatCategory,
        vatRate,
        vatAmount,
        grossAmount: netAmount.add(vatAmount),
      };
    });
    const netAmount = invoiceLines.reduce((sum, line) => sum.add(line.netAmount), new Prisma.Decimal(0));
    const vatAmount = invoiceLines.reduce((sum, line) => sum.add(line.vatAmount), new Prisma.Decimal(0));
    const grossAmount = netAmount.add(vatAmount);
    const invoice = await tx.customerInvoice.create({
      data: {
        invoiceNo,
        legalEntityId: legalEntity.id,
        customerId: customer.id,
        orderId: order.id,
        invoiceDate,
        deliveryDate: order.confirmedDate ?? order.eta,
        dueDate,
        customerPoRef: order.buyerRef ?? order.poNumber,
        vesselName: order.vessel,
        vesselImo: order.vesselImo,
        currency: order.currency,
        paymentTerms: customer.paymentTerms,
        bankPaymentReference: invoiceNo,
        netAmount,
        vatAmount,
        grossAmount,
        paidAmount: 0,
        outstandingAmount: grossAmount,
        status: "Draft",
        marginPct: order.marginPct,
        exceptionFlag: false,
        lines: { create: invoiceLines },
        vatSummaries: { create: [{ vatCategory, vatRate, taxableAmount: netAmount, vatAmount, grossAmount }] },
      },
    });
    await audit("CustomerInvoice", invoice.id, "InvoiceCreated", { source: "finance-module", orderRef: order.poNumber, customer: customer.name, taxReview }, undefined, invoice, actor, tx);
    return invoice;
  });
  return result;
}

export async function postCustomerInvoice(id: string, actor?: FinanceActionActor) {
  const invoice = await validateCustomerInvoiceForPosting(id, actor);
  if (!["Draft", "Reviewed"].includes(invoice.status)) throw new Error("Only draft or reviewed invoices can be posted.");
  const updated = await prisma.customerInvoice.update({
    where: { id },
    data: { status: "Posted", postedAt: new Date(), lockedAt: new Date() },
  });
  await audit("CustomerInvoice", id, "InvoicePosted", { source: "finance-module", immutableRecord: true }, invoice, updated, actor);
  return updated;
}

export async function sendCustomerInvoice(id: string, actor?: FinanceActionActor) {
  const invoice = await prisma.customerInvoice.findFirst({ where: { id, ...(actor?.organizationId ? { legalEntity: { organizationId: actor.organizationId } } : {}) } });
  if (!invoice) throw new Error("Invoice not found.");
  if (invoice.status !== "Posted") throw new Error("Only posted invoices can be marked sent.");
  const updated = await prisma.customerInvoice.update({ where: { id }, data: { status: "Sent", sentAt: new Date() } });
  await audit("CustomerInvoice", id, "InvoiceSent", { source: "finance-module", delivery: "manual-status" }, invoice, updated, actor);
  return updated;
}

export async function recordCustomerPayment(id: string, amount?: number, reference?: string, actor?: FinanceActionActor, requestKey?: string) {
  if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) throw new Error("Payment amount must be greater than zero.");
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-invoice:${id}`}))`;
    const invoice = await tx.customerInvoice.findFirst({ where: { id, ...(actor?.organizationId ? { legalEntity: { organizationId: actor.organizationId } } : {}) } });
    if (!invoice) throw new Error("Invoice not found.");
    requireCurrency(invoice.currency);
    if (requestKey) {
      const previous = await tx.customerPayment.findUnique({ where: { requestKey } });
      if (previous) {
        if (previous.invoiceId !== id || (amount !== undefined && !previous.amount.equals(amount)) || previous.paymentReference !== (reference ?? invoice.bankPaymentReference)) throw new Error("Payment request was already used with different details.");
        return invoice;
      }
    }
    if (!OPEN_RECEIVABLE_STATUSES.includes(invoice.status)) throw new Error("Only posted invoices with an outstanding balance can receive payment.");
    const paymentAmount = new Prisma.Decimal(amount ?? invoice.outstandingAmount);
    if (!paymentAmount.equals(paymentAmount.toDecimalPlaces(2))) throw new Error("Payment amount must have at most two decimal places.");
    if (paymentAmount.lte(0) || paymentAmount.gt(invoice.outstandingAmount)) throw new Error("Payment must be positive and cannot exceed the current outstanding balance. Refresh the invoice and review the amount.");
    const paidAmount = invoice.paidAmount.add(paymentAmount);
    const remaining = invoice.outstandingAmount.sub(paymentAmount);
    const status = remaining.isZero() ? "Paid" : "PartiallyPaid";
    const payment = await tx.customerPayment.create({
      data: {
        invoiceId: id,
        requestKey,
        amount: paymentAmount,
        currency: invoice.currency,
        receivedAt: new Date(),
        paymentReference: reference ?? invoice.bankPaymentReference,
        method: "Manual",
      },
    });
    const updated = await tx.customerInvoice.update({
      where: { id },
      data: { paidAmount, outstandingAmount: remaining, status },
    });
    await audit("CustomerInvoice", id, remaining.isZero() ? "PaymentReceived" : "PartialPaymentReceived", { source: "finance-module", amount: paymentAmount.toNumber(), paymentId: payment.id }, invoice, updated, actor, tx);
    return updated;
  });
}

export async function decideSupplierInvoice(id: string, decision: "approve" | "reject", actor?: FinanceActionActor, expectedVersion?: string) {
  return prisma.$transaction(async tx => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-supplier:${id}`}))`;
  const invoice = await tx.supplierInvoice.findFirst({ where: { id, ...(actor?.organizationId ? { organizationId: actor.organizationId } : {}) } });
  if (!invoice) throw new Error("Supplier invoice not found.");
  if (invoice.intakeRequestKey && invoice.updatedAt.toISOString() !== expectedVersion) throw new Error("Invoice changed since it was displayed. Refresh and review the current amounts before deciding.");
  if (decision === "reject" && await tx.supplierPayment.count({ where: { invoiceId: id, reversedAt: null } })) throw new Error("Reverse or reconcile recorded payments before rejecting this invoice.");
  const updated = await tx.supplierInvoice.update({
    where: { id },
    data: decision === "approve"
      ? { approvalStatus: "Approved", matchStatus: "Approved" }
      : { approvalStatus: "Rejected", matchStatus: "Rejected" },
  });
  await audit(
    "SupplierInvoice",
    id,
    decision === "approve" ? "SupplierInvoiceApproved" : "SupplierInvoiceRejected",
    { source: "finance-module" },
    invoice,
    updated,
    actor,
    tx,
  );
  return updated;
  });
}

export async function decideCreditNote(id: string, decision: "approve" | "issue" | "reject", actor?: FinanceActionActor) {
  return prisma.$transaction(async tx => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-credit:${id}`}))`;
  const note = await tx.creditNote.findFirst({ where: { id, ...(actor?.organizationId ? { originalInvoice: { legalEntity: { organizationId: actor.organizationId } } } : {}) } });
  if (!note) throw new Error("Credit note not found.");
  if (decision === "issue" && note.status === "Issued") return note;
  if (["Issued", "Rejected"].includes(note.status)) throw new Error("An issued or rejected credit note cannot be changed. Create a reviewed correction instead.");
  if (decision === "issue" && note.status !== "Approved") throw new Error("Only approved credit notes can be issued.");
  const refundAmount = decision === "issue" ? await allocateIssuedCredit(tx, note) : new Prisma.Decimal(0);
  const data =
    decision === "approve" ? { status: "Approved" as const, approvalStatus: "Approved" as const, approvedAt: new Date() } :
    decision === "issue" ? { status: "Issued" as const, issuedAt: new Date(), appliedToInvoiceAt: new Date(), refundAmount } :
    { status: "Rejected" as const, approvalStatus: "Rejected" as const };
  const updated = await tx.creditNote.update({ where: { id }, data });
  const action =
    decision === "approve" ? "CreditNoteApproved" :
    decision === "issue" ? "CreditNoteIssued" :
    "CreditNoteRejected";
  await audit("CreditNote", id, action, { source: "finance-module", ...(decision === "issue" ? { appliedToInvoiceId: note.originalInvoiceId, amount: note.grossAmount.toString(), currency: note.currency } : {}) }, note, updated, actor, tx);
  return updated;
  });
}

export async function resolveFinanceException(id: string, actor?: FinanceActionActor) {
  const item = await prisma.financeException.findFirst({ where: { id, ...(actor?.organizationId ? { organizationId: actor.organizationId } : {}) } });
  if (!item) throw new Error("Finance exception not found.");
  const updated = await prisma.financeException.update({ where: { id }, data: { status: "Resolved", resolvedAt: new Date() } });
  await audit("FinanceException", id, "ExceptionResolved", { source: "finance-module" }, item, updated, actor);
  return updated;
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return "";
  const columns = Object.keys(rows[0]);
  return [
    columns.map(csvCell).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ].join("\n");
}

type AccountingExportEntityType = "CustomerInvoice" | "SupplierInvoice" | "CreditNote";

type AccountingExportCandidate = {
  entityType: AccountingExportEntityType;
  entityId: string;
};

async function findAccountingExportCandidates(organizationId: string): Promise<AccountingExportCandidate[]> {
  const [customerInvoices, supplierInvoices, creditNotes] = await Promise.all([
    prisma.customerInvoice.findMany({
      where: { legalEntity: { organizationId }, status: { in: ["Posted", "Sent", "PartiallyPaid", "Paid"] } },
      select: { id: true },
      orderBy: { invoiceDate: "asc" },
    }),
    prisma.supplierInvoice.findMany({
      where: { organizationId, approvalStatus: "Approved" },
      select: { id: true },
      orderBy: { invoiceDate: "asc" },
    }),
    prisma.creditNote.findMany({
      where: { originalInvoice: { legalEntity: { organizationId } }, status: "Issued" },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return [
    ...customerInvoices.map((invoice) => ({ entityType: "CustomerInvoice" as const, entityId: invoice.id })),
    ...supplierInvoices.map((invoice) => ({ entityType: "SupplierInvoice" as const, entityId: invoice.id })),
    ...creditNotes.map((note) => ({ entityType: "CreditNote" as const, entityId: note.id })),
  ];
}

async function ensureAccountingExportRecords(batchId: string, organizationId: string) {
  const existing = await prisma.accountingExportRecord.findMany({
    where: { batchId },
    orderBy: { createdAt: "asc" },
  });
  if (existing.length) return existing;

  const candidates = await findAccountingExportCandidates(organizationId);
  if (!candidates.length) throw new Error("No exportable finance records are available.");

  await prisma.accountingExportRecord.createMany({
    data: candidates.map((candidate) => ({
      batchId,
      entityType: candidate.entityType,
      entityId: candidate.entityId,
      status: "Ready",
    })),
  });

  return prisma.accountingExportRecord.findMany({
    where: { batchId },
    orderBy: { createdAt: "asc" },
  });
}

function indexById<T extends { id: string }>(rows: T[]) {
  return new Map(rows.map((row) => [row.id, row]));
}

export async function prepareAccountingExport(batchId: string, actor?: FinanceActionActor) {
  if (!actor?.organizationId) throw new Error("An active customer organization is required.");
  const batch = await prisma.accountingExportBatch.findFirst({ where: { id: batchId, organizationId: actor.organizationId } });
  if (!batch) throw new Error("Accounting export batch not found.");
  if (batch.legalEntityId && batch.periodFrom && batch.periodTo) return prepareScopedExport(batchId, actor.organizationId, { id: actor.id, name: actor.name });
  const validationErrors = Array.isArray(batch.validationErrors) ? batch.validationErrors.map(String) : [];
  if (!["Ready", "Prepared"].includes(batch.status) || batch.recordsBlocked > 0 || validationErrors.length > 0) {
    throw new Error("Export batch is blocked by validation errors.");
  }

  const exportRecords = await ensureAccountingExportRecords(batchId, actor.organizationId);
  const blockedRecords = exportRecords.filter((record) => record.status === "Blocked" || record.status === "Failed");
  if (blockedRecords.length) throw new Error("Export batch contains blocked records.");

  const customerInvoiceIds = exportRecords.filter((record) => record.entityType === "CustomerInvoice").map((record) => record.entityId);
  const supplierInvoiceIds = exportRecords.filter((record) => record.entityType === "SupplierInvoice").map((record) => record.entityId);
  const creditNoteIds = exportRecords.filter((record) => record.entityType === "CreditNote").map((record) => record.entityId);

  const [customerInvoices, supplierInvoices, creditNotes] = await Promise.all([
    customerInvoiceIds.length ? prisma.customerInvoice.findMany({
      where: { id: { in: customerInvoiceIds }, legalEntity: { organizationId: actor.organizationId } },
      include: { customer: true, legalEntity: true },
    }) : [],
    supplierInvoiceIds.length ? prisma.supplierInvoice.findMany({
      where: { id: { in: supplierInvoiceIds }, organizationId: actor.organizationId },
    }) : [],
    creditNoteIds.length ? prisma.creditNote.findMany({
      where: { id: { in: creditNoteIds }, originalInvoice: { legalEntity: { organizationId: actor.organizationId } } },
      include: { customer: true, originalInvoice: true },
    }) : [],
  ]);
  const customerInvoiceById = indexById(customerInvoices);
  const supplierInvoiceById = indexById(supplierInvoices);
  const creditNoteById = indexById(creditNotes);
  for (const record of [...customerInvoices, ...supplierInvoices, ...creditNotes]) requireCurrency(record.currency);

  const rows: Array<Record<string, unknown>> = exportRecords.flatMap((record): Array<Record<string, unknown>> => {
    if (record.entityType === "CustomerInvoice") {
      const invoice = customerInvoiceById.get(record.entityId);
      if (!invoice) return [];
      return [{
      record_type: "customer_invoice",
      document_no: invoice.invoiceNo,
      counterparty: invoice.customer.name,
      document_date: invoice.invoiceDate.toISOString().slice(0, 10),
      due_date: invoice.dueDate.toISOString().slice(0, 10),
      currency: invoice.currency,
      net_amount: toNumber(invoice.netAmount).toFixed(2),
      vat_amount: toNumber(invoice.vatAmount).toFixed(2),
      gross_amount: toNumber(invoice.grossAmount).toFixed(2),
      status: invoice.status,
      reference: invoice.customerPoRef ?? "",
      }];
    }
    if (record.entityType === "SupplierInvoice") {
      const invoice = supplierInvoiceById.get(record.entityId);
      if (!invoice) return [];
      return [{
      record_type: "supplier_invoice",
      document_no: invoice.supplierInvoiceNo,
      counterparty: invoice.supplierName,
      document_date: invoice.invoiceDate.toISOString().slice(0, 10),
      due_date: invoice.dueDate.toISOString().slice(0, 10),
      currency: invoice.currency,
      net_amount: toNumber(invoice.invoicedCost).toFixed(2),
      vat_amount: toNumber(invoice.vatAmount).toFixed(2),
      gross_amount: toNumber(invoice.grossAmount).toFixed(2),
      status: invoice.approvalStatus,
      reference: invoice.evidenceRef ?? "",
      }];
    }
    if (record.entityType === "CreditNote") {
      const note = creditNoteById.get(record.entityId);
      if (!note) return [];
      return [{
      record_type: "credit_note",
      document_no: note.creditNoteNo,
      counterparty: note.customer.name,
      document_date: note.createdAt.toISOString().slice(0, 10),
      due_date: "",
      currency: note.currency,
      net_amount: (-toNumber(note.netAmount)).toFixed(2),
      vat_amount: (-toNumber(note.vatAmount)).toFixed(2),
      gross_amount: (-toNumber(note.grossAmount)).toFixed(2),
      status: note.status,
      reference: note.originalInvoice.invoiceNo,
      }];
    }
    return [];
  });

  if (!rows.length) throw new Error("No exportable finance records are available.");
  const csv = toCsv(rows);
  const fileName = `nautex-finance-${batch.target.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
  const result = await prisma.$transaction(async (tx) => {
    await tx.accountingExportRecord.updateMany({
      where: { batchId, id: { in: exportRecords.map((record) => record.id) } },
      data: { status: "Prepared", error: null },
    });
    const updated = await tx.accountingExportBatch.update({
      where: { id: batchId },
      data: {
        status: "Prepared",
        exportedAt: null,
        fileUrl: `local://${fileName}`,
        recordsReady: rows.length,
        recordsBlocked: 0,
        validationErrors: [],
      },
    });
    return updated;
  });
  await audit("AccountingExportBatch", batchId, "AccountingExportPrepared", { source: "finance-module", target: batch.target, mode: "local-csv-prepare", fileName, records: rows.length }, batch, result, actor);
  return { fileName, csv, records: rows.length, batch: result };
}
