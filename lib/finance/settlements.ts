import { createHash, randomUUID } from "node:crypto";
import { Prisma, type CreditNote, type FinanceAuditAction } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hasPermission, type AuthContext } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ApiRequestError } from "@/lib/api/request";
import { OPEN_RECEIVABLE_STATUSES, requireCurrency } from "./calculations";

export type FinanceReviewContext = Pick<AuthContext, "organizationId" | "userId" | "displayName" | "permissions" | "roles">;
export function requireFinanceReviewer(context: FinanceReviewContext) {
  if (!context.organizationId || context.roles.includes("system-agent") || !hasPermission(context, PERMISSIONS.FINANCE_APPROVE)) throw new ApiRequestError("FORBIDDEN", "An authorized finance reviewer is required.", 403);
  return context.organizationId;
}
export function financialDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Use a YYYY-MM-DD date.");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("Enter a valid calendar date.");
  return date;
}
function referenceText(value: string) {
  if (typeof value !== "string" || value.trim().length < 5 || value.length > 1000) throw new Error("Provide a supporting reference or review reason (5–1000 characters).");
  return value.trim();
}
export function positiveMoney(value: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error("Amount must be positive.");
  const amount = new Prisma.Decimal(value);
  if (!amount.equals(amount.toDecimalPlaces(2))) throw new Error("Amount must have at most two decimal places.");
  return amount;
}
async function ledgerAudit(tx: Prisma.TransactionClient, context: FinanceReviewContext, entityType: string, entityId: string, action: FinanceAuditAction, before: unknown, after: unknown) {
  await tx.financeAuditEvent.create({ data: { organizationId: context.organizationId, entityType, entityId, action, actorType: "user", actorId: context.userId, before: JSON.parse(JSON.stringify(before)), after: JSON.parse(JSON.stringify(after)), metadata: { source: "finance-settlements", actorName: context.displayName, recordsExternalMovementOnly: true } } });
}

// Credit allocation is deterministic; recording a refund remains a separate human action.
export async function allocateIssuedCredit(tx: Prisma.TransactionClient, note: CreditNote) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-invoice:${note.originalInvoiceId}`}))`;
  const invoice = await tx.customerInvoice.findUniqueOrThrow({ where: { id: note.originalInvoiceId } });
  if (requireCurrency(note.currency) !== requireCurrency(invoice.currency)) throw new Error("Credit note currency must match the original invoice.");
  if (![...OPEN_RECEIVABLE_STATUSES, "Paid"].includes(invoice.status)) throw new Error("Only posted customer invoices can receive an issued credit.");
  const expectedOutstanding = Prisma.Decimal.max(invoice.grossAmount.sub(invoice.paidAmount).sub(invoice.creditedAmount), 0);
  if (!expectedOutstanding.equals(invoice.outstandingAmount)) throw new Error("Invoice balances do not reconcile. Review historical credits before issuing another credit.");
  if (note.grossAmount.lte(0) || note.grossAmount.gt(invoice.grossAmount.sub(invoice.creditedAmount))) throw new Error("Total credits cannot exceed the original invoice gross amount.");
  await validateCreditAmounts(tx, note, invoice);
  const applied = Prisma.Decimal.min(note.grossAmount, invoice.outstandingAmount);
  const refundAmount = note.grossAmount.sub(applied);
  const remaining = invoice.outstandingAmount.sub(applied);
  await tx.customerInvoice.update({ where: { id: invoice.id }, data: { creditedAmount: { increment: note.grossAmount }, outstandingAmount: remaining, ...(remaining.isZero() ? { status: "Paid" } : {}) } });
  return refundAmount;
}

async function validateCreditAmounts(tx: Prisma.TransactionClient, note: CreditNote, invoice: { netAmount: Prisma.Decimal; vatAmount: Prisma.Decimal }) {
  if (note.netAmount.lt(0) || note.vatAmount.lt(0) || !note.netAmount.add(note.vatAmount).equals(note.grossAmount)) throw new Error("Credit net plus VAT must equal its gross amount and neither may be negative.");
  const prior = await tx.creditNote.aggregate({ where: { originalInvoiceId: note.originalInvoiceId, id: { not: note.id }, status: "Issued" }, _sum: { netAmount: true, vatAmount: true } });
  if (note.netAmount.add(prior._sum.netAmount ?? 0).gt(invoice.netAmount) || note.vatAmount.add(prior._sum.vatAmount ?? 0).gt(invoice.vatAmount)) throw new Error("Combined issued credits cannot exceed the original invoice's net or VAT amount.");
}

export async function recordSettlement(context: FinanceReviewContext, input: { kind: "supplier_payment" | "customer_refund"; id: string; amount: number; paidAt: string; reference: string; requestKey: string }) {
  const organizationId = requireFinanceReviewer(context);
  if (!["supplier_payment", "customer_refund"].includes(input.kind)) throw new Error("Choose a supported settlement type.");
  const amount = positiveMoney(input.amount), reference = referenceText(input.reference), paidAt = financialDate(input.paidAt);
  if (paidAt > new Date()) throw new Error("Record only payments already made; future dates are not allowed.");
  if (!/^[A-Za-z0-9-]{8,100}$/.test(input.requestKey)) throw new Error("A valid retry identifier is required.");
  const requestKey = createHash("sha256").update(`${organizationId}:${context.userId}:${input.kind}:${input.requestKey}`).digest("hex");
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`settlement-request:${requestKey}`}))`;
    const previous = input.kind === "supplier_payment" ? await tx.supplierPayment.findUnique({ where: { requestKey } }) : await tx.customerRefund.findUnique({ where: { requestKey } });
    if (previous) {
      const parent = "invoiceId" in previous ? previous.invoiceId : previous.creditNoteId;
      if (parent !== input.id || !previous.amount.equals(amount) || previous.reference !== reference || previous.paidAt.getTime() !== paidAt.getTime()) throw new Error("Retry identifier was used with different payment details.");
      return previous;
    }
    if (input.kind === "supplier_payment") {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-supplier:${input.id}`}))`;
      const invoice = await tx.supplierInvoice.findFirst({ where: { id: input.id, organizationId }, include: { payments: { where: { reversedAt: null } } } });
      if (!invoice) throw new Error("Supplier invoice not found in this organization.");
      if (invoice.approvalStatus !== "Approved") throw new Error("Approve the supplier invoice before recording payment.");
      const paid = invoice.payments.reduce((sum, row) => sum.add(row.amount), new Prisma.Decimal(0));
      if (amount.gt(invoice.grossAmount.sub(paid))) throw new Error("Payment exceeds the supplier invoice outstanding balance.");
      const payment = await tx.supplierPayment.create({ data: { invoiceId: invoice.id, amount, currency: requireCurrency(invoice.currency), paidAt, reference, requestKey, recordedBy: context.userId } });
      await ledgerAudit(tx, context, "SupplierInvoice", invoice.id, "SupplierPaymentRecorded", { paid }, payment);
      return payment;
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-credit:${input.id}`}))`;
    const note = await tx.creditNote.findFirst({ where: { id: input.id, originalInvoice: { legalEntity: { organizationId } } }, include: { refunds: { where: { reversedAt: null } } } });
    if (!note) throw new Error("Credit note not found in this organization.");
    if (note.status !== "Issued" || !note.appliedToInvoiceAt) throw new Error("Issue or reconcile the credit before recording a refund.");
    const refunded = note.refunds.reduce((sum, row) => sum.add(row.amount), new Prisma.Decimal(0));
    if (amount.gt(note.refundAmount.sub(refunded))) throw new Error("Refund exceeds this credit note's refundable balance.");
    const refund = await tx.customerRefund.create({ data: { creditNoteId: note.id, amount, currency: requireCurrency(note.currency), paidAt, reference, requestKey, recordedBy: context.userId } });
    await ledgerAudit(tx, context, "CreditNote", note.id, "CustomerRefundRecorded", { refunded }, refund);
    return refund;
  });
}

export async function reverseSettlement(context: FinanceReviewContext, kind: "supplier_payment" | "customer_refund", id: string, reason: string) {
  const organizationId = requireFinanceReviewer(context), reviewReason = referenceText(reason);
  if (!["supplier_payment", "customer_refund"].includes(kind)) throw new Error("Choose a supported settlement type.");
  return prisma.$transaction(async tx => {
    const original = kind === "supplier_payment" ? await tx.supplierPayment.findFirst({ where: { id, invoice: { organizationId } } }) : await tx.customerRefund.findFirst({ where: { id, creditNote: { originalInvoice: { legalEntity: { organizationId } } } } });
    if (!original) throw new Error("Settlement not found in this organization.");
    const parentId = "invoiceId" in original ? original.invoiceId : original.creditNoteId;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${kind === "supplier_payment" ? "finance-supplier" : "finance-credit"}:${parentId}`}))`;
    const current = kind === "supplier_payment" ? await tx.supplierPayment.findUniqueOrThrow({ where: { id } }) : await tx.customerRefund.findUniqueOrThrow({ where: { id } });
    if (current.reversedAt) return current;
    const data = { reversedAt: new Date(), reversedBy: context.userId, reversalReason: reviewReason };
    const updated = kind === "supplier_payment" ? await tx.supplierPayment.update({ where: { id }, data }) : await tx.customerRefund.update({ where: { id }, data });
    await ledgerAudit(tx, context, kind === "supplier_payment" ? "SupplierInvoice" : "CreditNote", parentId, "SettlementReversed", current, updated);
    return updated;
  });
}

export async function reconcileLegacyCredit(context: FinanceReviewContext, input: { id: string; method: "apply_now" | "already_reflected"; reason: string; invoiceVersion: string }) {
  const organizationId = requireFinanceReviewer(context), reason = referenceText(input.reason);
  if (!["apply_now", "already_reflected"].includes(input.method)) throw new Error("Choose how this historical credit is reflected in the invoice.");
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-credit:${input.id}`}))`;
    const note = await tx.creditNote.findFirst({ where: { id: input.id, originalInvoice: { legalEntity: { organizationId } } } });
    if (!note || note.status !== "Issued") throw new Error("Only an issued credit in this organization can be reconciled.");
    if (note.appliedToInvoiceAt) {
      if (note.reconciliationMethod !== input.method || note.reconciliationReason !== reason) throw new Error("This credit has already been reconciled. Refresh the ledger.");
      return note;
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-invoice:${note.originalInvoiceId}`}))`;
    const invoice = await tx.customerInvoice.findUniqueOrThrow({ where: { id: note.originalInvoiceId } });
    if (invoice.updatedAt.toISOString() !== input.invoiceVersion) throw new Error("Invoice changed. Refresh balances before confirming reconciliation.");
    if (requireCurrency(note.currency) !== requireCurrency(invoice.currency)) throw new Error("Credit currency must match the original invoice.");
    let refundAmount = new Prisma.Decimal(0);
    if (input.method === "apply_now") refundAmount = await allocateIssuedCredit(tx, note);
    else {
      if (![...OPEN_RECEIVABLE_STATUSES, "Paid"].includes(invoice.status)) throw new Error("Only posted invoices can be reconciled.");
      await validateCreditAmounts(tx, note, invoice);
      const gap = invoice.grossAmount.sub(invoice.paidAmount).sub(invoice.creditedAmount).sub(invoice.outstandingAmount);
      if (note.grossAmount.lte(0) || !gap.equals(note.grossAmount)) throw new Error("The existing balance gap does not equal this credit. Review the source statements; no balance was changed.");
      await tx.customerInvoice.update({ where: { id: invoice.id }, data: { creditedAmount: { increment: note.grossAmount } } });
    }
    const updated = await tx.creditNote.update({ where: { id: note.id }, data: { appliedToInvoiceAt: new Date(), refundAmount, reconciliationMethod: input.method, reconciliationReason: reason, reconciledBy: context.userId } });
    await ledgerAudit(tx, context, "CreditNote", note.id, "CreditNoteReconciled", { note, invoice }, updated);
    return updated;
  });
}

export async function assignSupplierLegalEntity(context: FinanceReviewContext, id: string, legalEntityId: string, reason: string) {
  const organizationId = requireFinanceReviewer(context), reviewReason = referenceText(reason);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-supplier:${id}`}))`;
    const entity = await tx.legalEntity.findFirst({ where: { id: legalEntityId, organizationId } });
    const invoice = await tx.supplierInvoice.findFirst({ where: { id, organizationId } });
    if (!entity || !invoice) throw new Error("Supplier invoice and legal entity must belong to this organization.");
    const updated = await tx.supplierInvoice.update({ where: { id }, data: { legalEntityId } });
    await ledgerAudit(tx, context, "SupplierInvoice", id, "SupplierEntityAssigned", { legalEntityId: invoice.legalEntityId }, { legalEntityId, reason: reviewReason });
    return updated;
  });
}

export async function getSettlementReview(organizationId: string) {
  const [suppliers, credits, legalEntities, invoices] = await Promise.all([
    prisma.supplierInvoice.findMany({ where: { organizationId }, include: { payments: { orderBy: { createdAt: "desc" } } }, orderBy: { dueDate: "asc" } }),
    prisma.creditNote.findMany({ where: { originalInvoice: { legalEntity: { organizationId } }, status: "Issued" }, include: { originalInvoice: true, refunds: { orderBy: { createdAt: "desc" } } }, orderBy: { createdAt: "desc" } }),
    prisma.legalEntity.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    prisma.customerInvoice.findMany({ where: { legalEntity: { organizationId }, status: { in: ["Posted", "Sent", "PartiallyPaid", "Overdue", "Disputed", "Paid"] } }, select: { id: true, invoiceNo: true, currency: true, grossAmount: true, vatAmount: true, creditedAmount: true }, orderBy: { invoiceDate: "desc" } }),
  ]);
  return {
    legalEntities, invoices,
    suppliers: suppliers.map(row => { const paid = row.payments.filter(payment => !payment.reversedAt).reduce((sum, payment) => sum.add(payment.amount), new Prisma.Decimal(0)); return { ...row, grossAmount: Number(row.grossAmount), paidAmount: Number(paid), outstandingAmount: Number(row.grossAmount.sub(paid)) }; }),
    credits: credits.map(row => ({ ...row, refundOutstanding: Number(row.refundAmount.sub(row.refunds.filter(refund => !refund.reversedAt).reduce((sum, refund) => sum.add(refund.amount), new Prisma.Decimal(0)))) })),
  };
}

export async function draftCustomerCredit(context: FinanceReviewContext, input: { id: string; grossAmount: number; vatAmount: number; reason: string; requestKey: string }) {
  const organizationId = requireFinanceReviewer(context), grossAmount = positiveMoney(input.grossAmount), reason = referenceText(input.reason);
  if (!Number.isFinite(input.vatAmount) || input.vatAmount < 0 || input.vatAmount > input.grossAmount || !new Prisma.Decimal(input.vatAmount).equals(new Prisma.Decimal(input.vatAmount).toDecimalPlaces(2))) throw new Error("Enter the credit's recorded VAT amount, between zero and its gross amount, to two decimal places.");
  if (!/^[A-Za-z0-9-]{8,100}$/.test(input.requestKey)) throw new Error("A valid retry identifier is required.");
  const requestKey = createHash("sha256").update(`${organizationId}:${context.userId}:credit-draft:${input.requestKey}`).digest("hex");
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestKey}))`;
    const previous = await tx.creditNote.findUnique({ where: { requestKey } });
    if (previous) {
      if (previous.originalInvoiceId !== input.id || !previous.grossAmount.equals(grossAmount) || !previous.vatAmount.equals(input.vatAmount) || previous.reviewNote !== reason) throw new Error("Retry identifier was used with different credit details.");
      return previous;
    }
    const invoice = await tx.customerInvoice.findFirst({ where: { id: input.id, legalEntity: { organizationId } } });
    if (!invoice || ![...OPEN_RECEIVABLE_STATUSES, "Paid"].includes(invoice.status)) throw new Error("Choose a posted invoice in this organization.");
    if (grossAmount.gt(invoice.grossAmount.sub(invoice.creditedAmount)) || new Prisma.Decimal(input.vatAmount).gt(invoice.vatAmount)) throw new Error("Credit exceeds the invoice's remaining gross or original VAT amount.");
    const note = await tx.creditNote.create({ data: { originalInvoiceId: invoice.id, customerId: invoice.customerId, creditNoteNo: `NAX-CN-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`, currency: requireCurrency(invoice.currency), netAmount: grossAmount.sub(input.vatAmount), vatAmount: input.vatAmount, grossAmount, reasonCode: "PriceCorrection", status: "Draft", approvalStatus: "Pending", reviewNote: reason, requestKey } });
    await ledgerAudit(tx, context, "CreditNote", note.id, "CreditNoteCreated", null, note);
    return note;
  });
}
