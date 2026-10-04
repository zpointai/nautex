import { createHash } from "node:crypto";
import { Prisma, type FinanceAuditAction } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiRequestError } from "@/lib/api/request";
import { hasPermission, type AuthContext } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { financialDate } from "./settlements";
import { requireCurrency } from "./calculations";

export type FinanceContext = Pick<AuthContext, "organizationId" | "userId" | "displayName" | "permissions" | "roles">;
export const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const jsonValue = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export async function retryFinanceTransaction<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) { if (attempt >= 2 || !(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034") throw error; }
  }
}
export function financeWriter(context: FinanceContext, approval = false) {
  if (!context.organizationId || context.roles.includes("system-agent") || !hasPermission(context, approval ? PERMISSIONS.FINANCE_APPROVE : PERMISSIONS.FINANCE_WRITE)) throw new ApiRequestError("FINANCE_FORBIDDEN", "An authorized human finance operator is required.", 403);
  return context.organizationId;
}
export function requiredText(value: unknown, label: string, max = 200) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new ApiRequestError("FINANCE_INPUT", `Enter ${label} (up to ${max} characters).`, 400);
  return value.trim();
}
export function moneyInput(value: unknown, label: string, positive = false) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (positive && value === 0) || value > 99999999999.99) throw new ApiRequestError("FINANCE_AMOUNT", `Enter a valid ${label}.`, 400);
  const amount = new Prisma.Decimal(value);
  if (!amount.equals(amount.toDecimalPlaces(2))) throw new ApiRequestError("FINANCE_PRECISION", `${label} must have at most two decimal places.`, 400);
  return amount;
}
export async function productionAudit(tx: Prisma.TransactionClient, context: { organizationId: string; userId: string; displayName: string }, action: FinanceAuditAction, entityType: string, entityId: string, metadata: unknown) {
  await tx.financeAuditEvent.create({ data: { organizationId: context.organizationId, actorId: context.userId, actorType: context.userId === "finance-agent" ? "agent" : "user", action, entityType, entityId, metadata: jsonValue({ ...metadata as object, actorName: context.displayName, source: "finance-production" }) } });
}
export async function financeEntryOptions(organizationId: string) {
  const [legalEntities, suppliers, orders] = await Promise.all([
    prisma.legalEntity.findMany({ where: { organizationId }, select: { id: true, name: true, defaultCurrency: true }, orderBy: { name: "asc" } }),
    prisma.supplier.findMany({ where: { organizationId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.purchaseOrder.findMany({ where: { organizationId, orderType: { not: "BuyerPO" } }, select: { id: true, poNumber: true, supplier: true, supplierId: true, currency: true, total: true, costTotal: true, status: true }, orderBy: { createdAt: "desc" } }),
  ]);
  return { legalEntities, suppliers, orders };
}

export async function saveSupplierInvoice(context: FinanceContext, input: Record<string, unknown>) {
  const organizationId = financeWriter(context);
  const supplierId = requiredText(input.supplierId, "a supplier"), legalEntityId = requiredText(input.legalEntityId, "a legal entity");
  const supplierInvoiceNo = requiredText(input.supplierInvoiceNo, "the supplier invoice number", 100);
  const invoiceDate = financialDate(requiredText(input.invoiceDate, "the invoice date")), dueDate = financialDate(requiredText(input.dueDate, "the due date"));
  if (dueDate < invoiceDate) throw new ApiRequestError("FINANCE_DATES", "The due date cannot precede the invoice date.", 400);
  const currency = requireCurrency(input.currency), invoicedCost = moneyInput(input.netAmount, "net invoice amount", true), vatAmount = moneyInput(input.vatAmount, "recorded VAT amount");
  const grossAmount = invoicedCost.add(vatAmount); if (grossAmount.gt(99999999999.99)) throw new ApiRequestError("FINANCE_AMOUNT", "Invoice total exceeds the supported amount.", 400);
  const reviewNote = requiredText(input.reviewNote, "a review note", 2000), evidenceRef = requiredText(input.evidenceRef, "a source reference", 500);
  if (reviewNote.length < 10 || evidenceRef.length < 5 || input.confirmAmounts !== true || typeof input.isFinalInvoice !== "boolean") throw new ApiRequestError("FINANCE_REVIEW_REQUIRED", "Review the recorded net/VAT amounts, enter a source reference and explain the review (at least 10 characters).", 400);
  const purchaseOrderId = input.purchaseOrderId ? requiredText(input.purchaseOrderId, "a purchase order") : null;
  const id = input.id ? requiredText(input.id, "an invoice id") : null;
  const requestKey = requiredText(input.requestKey, "a request key", 150);
  const isFinalInvoice = input.isFinalInvoice;
  const normalized = { supplierId, legalEntityId, supplierInvoiceNo, invoiceDate, dueDate, currency, invoicedCost, vatAmount, reviewNote, evidenceRef, purchaseOrderId, isFinalInvoice: input.isFinalInvoice };
  const inputHash = fingerprint(normalized);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-intake:${organizationId}`}))`;
    if (id) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-supplier:${id}`}))`;
    const existingRequest = await tx.supplierInvoice.findUnique({ where: { organizationId_intakeRequestKey: { organizationId, intakeRequestKey: requestKey } } });
    if (!id && existingRequest) { if (existingRequest.intakeFingerprint !== inputHash) throw new ApiRequestError("REQUEST_REUSED", "This request key was already used for different details.", 409); return existingRequest; }
    const previous = id ? await tx.supplierInvoice.findFirst({ where: { id, organizationId } }) : null;
    if (id && !previous) throw new ApiRequestError("INVOICE_NOT_FOUND", "Supplier invoice not found.", 404);
    if (previous && (previous.updatedAt.toISOString() !== input.version || previous.approvalStatus === "Approved" || await tx.supplierPayment.count({ where: { invoiceId: previous.id, reversedAt: null } }))) throw new ApiRequestError("INVOICE_LOCKED", "Invoice changed, is approved, or has recorded payments. Refresh and review before editing.", 409);
    const supplier = await tx.supplier.findFirst({ where: { id: supplierId, organizationId } });
    const legalEntity = await tx.legalEntity.findFirst({ where: { id: legalEntityId, organizationId } });
    if (!supplier || !legalEntity) throw new ApiRequestError("FINANCE_PARTY_NOT_FOUND", "Supplier or legal entity not found in this organization.", 404);
    const duplicate = await tx.supplierInvoice.findFirst({ where: { organizationId, ...(id ? { id: { not: id } } : {}), supplierInvoiceNo: { equals: supplierInvoiceNo, mode: "insensitive" }, OR: [{ supplierId }, { supplierName: { equals: supplier.name, mode: "insensitive" } }] } });
    if (duplicate) throw new ApiRequestError("DUPLICATE_SUPPLIER_INVOICE", "This supplier invoice number is already recorded. Open the existing invoice instead.", 409);
    const order = purchaseOrderId ? await tx.purchaseOrder.findFirst({ where: { id: purchaseOrderId, organizationId } }) : null;
    if (purchaseOrderId && !order) throw new ApiRequestError("ORDER_NOT_FOUND", "Purchase order not found.", 404);
    if (order && (order.orderType === "BuyerPO" || order.currency !== currency || (order.supplierId ? order.supplierId !== supplierId : order.supplier.trim().toLowerCase() !== supplier.name.trim().toLowerCase()))) throw new ApiRequestError("INVOICE_PO_MISMATCH", "Choose a supplier purchase order with the same supplier and currency.", 400);
    const expectedCost = new Prisma.Decimal(order ? order.costTotal ?? order.total : 0).toDecimalPlaces(2);
    const other = order ? await tx.supplierInvoice.aggregate({ where: { purchaseOrderId: order.id, organizationId, approvalStatus: { not: "Rejected" }, ...(id ? { id: { not: id } } : {}) }, _sum: { invoicedCost: true } }) : null;
    const cumulative = invoicedCost.add(other?._sum.invoicedCost ?? 0), varianceAmount = order ? (input.isFinalInvoice ? cumulative.sub(expectedCost) : Prisma.Decimal.max(0, cumulative.sub(expectedCost))) : new Prisma.Decimal(0);
    const data = { organizationId, supplierId, legalEntityId, supplierName: supplier.name, supplierInvoiceNo, invoiceDate, dueDate, currency, expectedCost, invoicedCost, varianceAmount, vatAmount, grossAmount, evidenceRef, reviewNote, purchaseOrderId, isFinalInvoice, approvalStatus: "Pending" as const, matchStatus: !order ? "MissingPO" as const : !varianceAmount.isZero() ? "PriceVariance" as const : "AwaitingApproval" as const, intakeFingerprint: inputHash };
    const saved = previous ? await tx.supplierInvoice.update({ where: { id: previous.id }, data }) : await tx.supplierInvoice.create({ data: { ...data, intakeRequestKey: requestKey } });
    await productionAudit(tx, { ...context, organizationId }, previous ? "SupplierInvoiceEdited" : "SupplierInvoiceCreated", "SupplierInvoice", saved.id, { invoiceNo: supplierInvoiceNo, net: invoicedCost.toString(), vat: vatAmount.toString(), currency, purchaseOrderId, legalEntityId, reviewNote, summaryEntry: true, amountsManuallyReviewed: true });
    return saved;
  });
}
