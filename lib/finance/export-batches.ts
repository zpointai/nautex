import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiRequestError } from "@/lib/api/request";
import { financeCsv } from "./vat-review";
import { financialDate } from "./settlements";
import { validCurrency } from "./calculations";
import { financeWriter, fingerprint, productionAudit, requiredText, retryFinanceTransaction, type FinanceContext } from "./production";

type ExportRow = { entityType: string; entityId: string; version: string; data: Record<string, string | number>; errors: string[] };
const posted = ["Posted", "Sent", "PartiallyPaid", "Paid", "Overdue", "Disputed"];
async function candidates(tx: Prisma.TransactionClient, organizationId: string, legalEntityId: string, from: Date, to: Date): Promise<ExportRow[]> {
  const period = { gte: from, lt: new Date(to.getTime() + 86400000) };
  const [invoices, suppliers, credits] = await Promise.all([
    tx.customerInvoice.findMany({ where: { legalEntityId, legalEntity: { organizationId }, invoiceDate: period }, include: { customer: true } }),
    tx.supplierInvoice.findMany({ where: { organizationId, legalEntityId, invoiceDate: period } }),
    tx.creditNote.findMany({ where: { originalInvoice: { legalEntityId, legalEntity: { organizationId } }, issuedAt: period }, include: { customer: true, originalInvoice: true } }),
  ]);
  const result: ExportRow[] = [];
  function add(entityType: string, entityId: string, version: Date, data: Record<string, string | number>, eligible: boolean) {
    if (!eligible) return;
    const errors: string[] = [];
    if (!validCurrency(data.currency)) errors.push("Invalid currency");
    if (!data.document_no || !data.counterparty) errors.push("Missing document number or counterparty");
    if (Math.abs(Number(data.net_amount) + Number(data.vat_amount) - Number(data.gross_amount)) > 0.005) errors.push("Net plus recorded VAT does not equal gross");
    result.push({ entityType, entityId, version: version.toISOString(), data, errors });
  }
  for (const row of invoices) add("CustomerInvoice", row.id, row.updatedAt, { record_type: "customer_invoice", document_no: row.invoiceNo, counterparty: row.customer.name, document_date: row.invoiceDate.toISOString().slice(0, 10), due_date: row.dueDate.toISOString().slice(0, 10), legal_entity_id: legalEntityId, currency: row.currency, net_amount: Number(row.netAmount), vat_amount: Number(row.vatAmount), gross_amount: Number(row.grossAmount), status: row.status, reference: row.customerPoRef ?? "" }, posted.includes(row.status));
  for (const row of suppliers) add("SupplierInvoice", row.id, row.updatedAt, { record_type: "supplier_invoice", document_no: row.supplierInvoiceNo, counterparty: row.supplierName, document_date: row.invoiceDate.toISOString().slice(0, 10), due_date: row.dueDate.toISOString().slice(0, 10), legal_entity_id: legalEntityId, currency: row.currency, net_amount: Number(row.invoicedCost), vat_amount: Number(row.vatAmount), gross_amount: Number(row.grossAmount), status: row.approvalStatus, reference: row.evidenceRef ?? "" }, row.approvalStatus === "Approved");
  for (const row of credits) add("CreditNote", row.id, row.updatedAt, { record_type: "credit_note", document_no: row.creditNoteNo, counterparty: row.customer.name, document_date: row.issuedAt!.toISOString().slice(0, 10), due_date: "", legal_entity_id: legalEntityId, currency: row.currency, net_amount: -Number(row.netAmount), vat_amount: -Number(row.vatAmount), gross_amount: -Number(row.grossAmount), status: row.status, reference: row.originalInvoice.invoiceNo }, row.status === "Issued");
  return result.sort((a, b) => `${a.entityType}:${a.entityId}`.localeCompare(`${b.entityType}:${b.entityId}`));
}
async function selection(tx: Prisma.TransactionClient, organizationId: string, input: Record<string, unknown>) {
  const legalEntityId = requiredText(input.legalEntityId, "a legal entity");
  const from = financialDate(requiredText(input.from, "a start date")), to = financialDate(requiredText(input.to, "an end date"));
  if (from > to || to.getTime() - from.getTime() > 366 * 86400000) throw new ApiRequestError("EXPORT_PERIOD", "Choose a period of up to one year, with the start before the end.", 400);
  const entity = await tx.legalEntity.findFirst({ where: { id: legalEntityId, organizationId } });
  if (!entity) throw new ApiRequestError("EXPORT_ENTITY", "Legal entity not found.", 404);
  const all = await candidates(tx, organizationId, legalEntityId, from, to);
  const reserved = await tx.accountingExportRecord.findMany({ where: { batch: { organizationId, status: { in: ["Ready", "Prepared", "Exported"] } } }, select: { entityType: true, entityId: true } });
  const keys = new Set(reserved.map(row => `${row.entityType}:${row.entityId}`));
  const rows = all.filter(row => !keys.has(`${row.entityType}:${row.entityId}`));
  return { legalEntityId, legalEntity: entity.name, from, to, rows, previouslyBatched: all.length - rows.length, fingerprint: fingerprint({ legalEntityId, from, to, rows }) };
}
export async function previewExportBatch(context: FinanceContext, input: Record<string, unknown>) {
  const organizationId = financeWriter(context, true);
  const value = await selection(prisma, organizationId, input);
  return { ...value, from: value.from.toISOString().slice(0, 10), to: value.to.toISOString().slice(0, 10), canCreate: value.rows.length > 0 && value.rows.every(row => !row.errors.length), basis: "Posted customer invoices and approved supplier invoices by invoice date; issued credit notes by issue date. UTC calendar days. Records already in ready/prepared/exported batches are excluded. This creates a local CSV handoff; it does not send or post records to an accounting system." };
}
export async function createExportBatch(context: FinanceContext, input: Record<string, unknown>) {
  const organizationId = financeWriter(context, true), requestKey = requiredText(input.requestKey, "a request key", 150);
  if (input.confirmReviewed !== true) throw new ApiRequestError("EXPORT_REVIEW", "Review the preview before creating the batch.", 400);
  return retryFinanceTransaction(() => prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-export:${organizationId}`}))`;
    const previous = await tx.accountingExportBatch.findUnique({ where: { organizationId_requestKey: { organizationId, requestKey } } });
    if (previous) { if (previous.sourceFingerprint !== input.fingerprint) throw new ApiRequestError("EXPORT_REQUEST_REUSED", "This request key was used with a different preview.", 409); return previous; }
    const value = await selection(tx, organizationId, input);
    if (value.fingerprint !== input.fingerprint) throw new ApiRequestError("EXPORT_PREVIEW_STALE", "Finance records changed. Preview the batch again.", 409);
    if (!value.rows.length || value.rows.some(row => row.errors.length)) throw new ApiRequestError("EXPORT_BLOCKED", "No ready records, or validation issues remain. Correct them before creating a batch.", 409);
    const batch = await tx.accountingExportBatch.create({ data: { organizationId, legalEntityId: value.legalEntityId, periodFrom: value.from, periodTo: value.to, requestKey, sourceFingerprint: value.fingerprint, target: "CsvXlsx", status: "Ready", recordsReady: value.rows.length, records: { create: value.rows.map(row => ({ entityType: row.entityType, entityId: row.entityId, status: "Ready" })) } } });
    await productionAudit(tx, { ...context, organizationId }, "AccountingExportCreated", "AccountingExportBatch", batch.id, { legalEntityId: value.legalEntityId, from: value.from, to: value.to, records: value.rows.length, sourceFingerprint: value.fingerprint });
    return batch;
  }, { isolationLevel: "Serializable", timeout: 15_000 }));
}
export async function prepareScopedExport(batchId: string, organizationId: string, actor: { id: string; name: string }) {
  return retryFinanceTransaction(() => prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-export:${organizationId}`}))`;
    const batch = await tx.accountingExportBatch.findFirst({ where: { id: batchId, organizationId }, include: { records: true } });
    if (!batch || !batch.legalEntityId || !batch.periodFrom || !batch.periodTo || !["Ready", "Prepared"].includes(batch.status)) throw new ApiRequestError("EXPORT_UNAVAILABLE", "Ready export batch not found.", 409);
    const fileName = `nautex-finance-${batch.id}.csv`;
    if (batch.preparedCsv) return { batch, fileName, csv: batch.preparedCsv, records: batch.records.length };
    const current = await candidates(tx, organizationId, batch.legalEntityId, batch.periodFrom, batch.periodTo);
    const keys = new Set(batch.records.map(row => `${row.entityType}:${row.entityId}`));
    const rows = current.filter(row => keys.has(`${row.entityType}:${row.entityId}`));
    const currentHash = fingerprint({ legalEntityId: batch.legalEntityId, from: batch.periodFrom, to: batch.periodTo, rows });
    if (rows.length !== batch.records.length || rows.some(row => row.errors.length) || currentHash !== batch.sourceFingerprint) throw new ApiRequestError("EXPORT_CHANGED", "Source records changed after preview. Cancel this unprepared batch and create a new reviewed batch.", 409);
    const csv = financeCsv(rows.map(row => row.data));
    const saved = await tx.accountingExportBatch.update({ where: { id: batch.id }, data: { status: "Prepared", preparedCsv: csv, fileUrl: `local://${fileName}` } });
    await tx.accountingExportRecord.updateMany({ where: { batchId }, data: { status: "Prepared" } });
    await productionAudit(tx, { organizationId, userId: actor.id, displayName: actor.name }, "AccountingExportPrepared", "AccountingExportBatch", batchId, { records: rows.length, localHandoffOnly: true, immutablePreparedCopy: true });
    return { batch: saved, fileName, csv, records: rows.length };
  }, { isolationLevel: "Serializable", timeout: 15_000 }));
}
export async function cancelExportBatch(context: FinanceContext, id: string) {
  const organizationId = financeWriter(context, true);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-export:${organizationId}`}))`;
    const batch = await tx.accountingExportBatch.findFirst({ where: { id, organizationId, status: { in: ["Ready", "Blocked", "NotReady"] }, preparedCsv: null } });
    if (!batch) throw new ApiRequestError("EXPORT_LOCKED", "Only an unprepared batch can be cancelled. Prepared exports remain immutable audit evidence.", 409);
    await tx.accountingExportBatch.update({ where: { id }, data: { status: "NotReady", validationErrors: ["Cancelled by reviewer; records released for a new preview"], recordsReady: 0 } });
    await tx.accountingExportRecord.updateMany({ where: { batchId: id }, data: { status: "NotReady" } });
    await tx.auditEvent.create({ data: { organizationId, actorId: context.userId, entityType: "AccountingExportBatch", entityId: id, eventType: "accounting_export_cancelled", sourceModule: "finance" } });
    return { cancelled: true };
  });
}
