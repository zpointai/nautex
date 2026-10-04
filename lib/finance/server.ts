import { prisma } from "@/lib/prisma";
import { calculateMargins } from "./controls";
import { makeAgingBuckets, formatCurrencyTotals, totalsByCurrency, OPEN_RECEIVABLE_STATUSES, pct, toNumber } from "@/lib/finance/calculations";
import type {
  CreditNoteRow,
  CustomerInvoiceRow,
  ExportReadinessRow,
  FinanceAuditRow,
  FinanceExceptionRow,
  FinanceKpi,
  MarginControlRow,
  SupplierInvoiceRow,
  UnbilledOrderRow,
} from "@/types/finance";

const pendingSupplierStatuses = ["PriceVariance", "QuantityVariance", "MissingPO", "MissingGoodsReceipt", "DuplicateRisk", "AwaitingApproval"] as const;

export async function getFinanceOverview(organizationId: string): Promise<{ kpis: FinanceKpi[] }> {
  const now = new Date();
  const [
    invoices,
    supplierInvoices,
    margins,
    unbilledDeliveredOrders,
    creditNotesPending,
    openExceptions,
  ] = await Promise.all([
    prisma.customerInvoice.findMany({ where: { legalEntity: { organizationId } } }),
    prisma.supplierInvoice.findMany({ where: { organizationId } }),
    calculateMargins(organizationId),
    prisma.purchaseOrder.count({ where: { organizationId, status: "Delivered", customerInvoices: { none: {} } } }),
    prisma.creditNote.count({ where: { originalInvoice: { legalEntity: { organizationId } }, status: { in: ["Draft", "AwaitingApproval"] } } }),
    prisma.financeException.count({ where: { organizationId, status: { in: ["Open", "InReview"] } } }),
  ]);

  const openInvoices = invoices.filter(invoice => OPEN_RECEIVABLE_STATUSES.includes(invoice.status) && toNumber(invoice.outstandingAmount) > 0);
  const openReceivables = totalsByCurrency(openInvoices, invoice => toNumber(invoice.outstandingAmount), invoice => invoice.currency);
  const overdueReceivables = totalsByCurrency(openInvoices.filter(invoice => invoice.dueDate < now), invoice => toNumber(invoice.outstandingAmount), invoice => invoice.currency);
  const supplierPending = supplierInvoices.filter((invoice) => pendingSupplierStatuses.includes(invoice.matchStatus as (typeof pendingSupplierStatuses)[number])).length;
  const completeMargins = margins.filter(row => row.calculationBasis.complete);
  const avgMargin = completeMargins.length ? completeMargins.reduce((sum, row) => sum + toNumber(row.marginPct), 0) / completeMargins.length : 0;
  const belowTarget = completeMargins.filter((row) => toNumber(row.marginVariance) < 0).length;

  return {
    kpis: [
      { label: "Open Receivables", value: formatCurrencyTotals(openReceivables), tone: openInvoices.length ? "warning" : "success", detail: "Posted balances by currency; drafts excluded. No currency conversion." },
      { label: "Supplier Invoices Pending Match", value: String(supplierPending), tone: supplierPending ? "warning" : "success", detail: "Need PO/evidence or variance approval" },
      { label: "Average Order Margin", value: completeMargins.length ? pct(avgMargin) : "Not established", tone: completeMargins.length && avgMargin >= 14 ? "success" : "warning", detail: "Forecast average excludes incomplete costs; estimates are labelled. Not recognized accounting profit." },
      { label: "Unbilled Delivered Orders", value: String(unbilledDeliveredOrders), tone: unbilledDeliveredOrders ? "danger" : "success", detail: "Delivered POs without customer invoice" },
      { label: "Credit Notes Pending", value: String(creditNotesPending), tone: creditNotesPending ? "warning" : "success", detail: "Draft or awaiting approval" },
      { label: "Finance Exceptions", value: String(openExceptions), tone: openExceptions ? "danger" : "success", detail: "Open finance control queue" },
      { label: "Overdue Receivables", value: formatCurrencyTotals(overdueReceivables), tone: overdueReceivables.length ? "danger" : "success", detail: "Posted invoices past due, separated by currency" },
      { label: "Orders Below Target Margin", value: String(belowTarget), tone: belowTarget ? "warning" : "success", detail: "Margin variance below configured target" },
      { label: "VAT Summary", value: "Period review", tone: "neutral", detail: "Open VAT Review for recorded amounts, reporting basis and excluded documents, separated by legal entity and currency." },
    ],
  };
}

export async function getCustomerInvoiceRows(organizationId: string): Promise<CustomerInvoiceRow[]> {
  const invoices = await prisma.customerInvoice.findMany({
    where: { legalEntity: { organizationId } },
    include: { customer: true, order: true },
    orderBy: { invoiceDate: "desc" },
  });
  return invoices.map((invoice) => ({
    id: invoice.id,
    invoiceNo: invoice.invoiceNo,
    customer: invoice.customer.name,
    vessel: invoice.vesselName ?? "-",
    customerPoRef: invoice.customerPoRef ?? "-",
    bankPaymentReference: invoice.bankPaymentReference,
    invoiceDate: invoice.invoiceDate.toISOString(),
    deliveryDate: invoice.deliveryDate.toISOString(),
    dueDate: invoice.dueDate.toISOString(),
    currency: invoice.currency,
    netAmount: toNumber(invoice.netAmount),
    vatAmount: toNumber(invoice.vatAmount),
    grossAmount: toNumber(invoice.grossAmount),
    paidAmount: toNumber(invoice.paidAmount),
    creditedAmount: toNumber(invoice.creditedAmount),
    outstandingAmount: toNumber(invoice.outstandingAmount),
    status: invoice.status,
    marginPct: invoice.marginPct ? toNumber(invoice.marginPct) : null,
    exceptionFlag: invoice.exceptionFlag,
    linkedOrderRef: invoice.order?.poNumber ?? "-",
  }));
}

export async function getSupplierInvoiceRows(organizationId: string): Promise<SupplierInvoiceRow[]> {
  const invoices = await prisma.supplierInvoice.findMany({
    where: { organizationId },
    include: { purchaseOrder: true, payments: { where: { reversedAt: null } } },
    orderBy: { dueDate: "asc" },
  });
  return invoices.map((invoice) => ({
    id: invoice.id,
    supplier: invoice.supplierName,
    supplierId: invoice.supplierId,
    legalEntityId: invoice.legalEntityId,
    purchaseOrderId: invoice.purchaseOrderId,
    invoiceDate: invoice.invoiceDate.toISOString(),
    version: invoice.updatedAt.toISOString(),
    reviewNote: invoice.reviewNote,
    evidenceRef: invoice.evidenceRef,
    sourceDocumentId: invoice.sourceDocumentId,
    isFinalInvoice: invoice.isFinalInvoice,
    supplierInvoiceNo: invoice.supplierInvoiceNo,
    paidAmount: invoice.payments.reduce((sum, row) => sum + toNumber(row.amount), 0),
    outstandingAmount: toNumber(invoice.grossAmount) - invoice.payments.reduce((sum, row) => sum + toNumber(row.amount), 0),
    relatedPurchaseOrder: invoice.purchaseOrder?.poNumber ?? "Missing PO",
    currency: invoice.currency,
    expectedCost: toNumber(invoice.expectedCost),
    invoicedCost: toNumber(invoice.invoicedCost),
    variance: toNumber(invoice.varianceAmount),
    vatAmount: toNumber(invoice.vatAmount),
    dueDate: invoice.dueDate.toISOString(),
    matchStatus: invoice.matchStatus,
    approvalStatus: invoice.approvalStatus,
    action: invoice.approvalStatus === "Approved" ? "Monitor" : "Review",
  }));
}

export async function getMarginControlRows(organizationId: string): Promise<MarginControlRow[]> {
  const rows = await calculateMargins(organizationId);
  return rows.map((row) => ({
    id: row.snapshotId ?? row.orderId,
    orderId: row.orderId,
    orderRef: row.orderRef,
    currency: row.currency,
    customer: row.customer,
    vessel: row.vessel,
    customsBondedCost: toNumber(row.customsBondedCost),
    warehouseHandlingCost: toNumber(row.warehouseHandlingCost),
    additionalOtherCosts: toNumber(row.otherCosts),
    calculationBasis: row.calculationBasis,
    snapshotAt: row.snapshotAt,
    snapshotStale: row.snapshotStale,
    version: row.version,
    costReviewNote: row.costReviewNote,
    revenue: toNumber(row.revenue),
    supplierCost: toNumber(row.supplierCost),
    freightDeliveryCost: toNumber(row.freightDeliveryCost),
    otherCosts: toNumber(row.customsBondedCost) + toNumber(row.warehouseHandlingCost) + toNumber(row.otherCosts),
    grossProfit: toNumber(row.grossProfit),
    marginPct: toNumber(row.marginPct),
    targetMarginPct: toNumber(row.targetMarginPct),
    marginVariance: toNumber(row.marginVariance),
    status: row.status,
  }));
}

export async function getPaymentsAging(organizationId: string) {
  const [customerInvoices, supplierInvoices] = await Promise.all([
    prisma.customerInvoice.findMany({ where: { legalEntity: { organizationId }, status: { in: ["Posted", "Sent", "PartiallyPaid", "Overdue", "Disputed"] }, outstandingAmount: { gt: 0 } } }),
    prisma.supplierInvoice.findMany({ where: { organizationId, approvalStatus: "Approved" }, include: { payments: { where: { reversedAt: null } } } }),
  ]);
  return {
    receivables: makeAgingBuckets(
      customerInvoices,
      (invoice) => invoice.dueDate,
      (invoice) => toNumber(invoice.outstandingAmount),
      ["Current", "1-30 Days Overdue", "31-60 Days Overdue", "61-90 Days Overdue", "90+ Days Overdue"],
      (days) => days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4,
      invoice => invoice.currency,
    ),
    payables: makeAgingBuckets(
      supplierInvoices.map(invoice => ({ ...invoice, outstanding: toNumber(invoice.grossAmount) - invoice.payments.reduce((sum, row) => sum + toNumber(row.amount), 0) })).filter(invoice => invoice.outstanding > 0.005),
      (invoice) => invoice.dueDate,
      (invoice) => invoice.outstanding,
      ["Current", "Due This Week", "1-30 Days Overdue", "31-60 Days Overdue", "60+ Days Overdue"],
      (days) => days <= -7 ? 0 : days <= 0 ? 1 : days <= 30 ? 2 : days <= 60 ? 3 : 4,
      invoice => invoice.currency,
    ),
  };
}

export async function getCreditNoteRows(organizationId: string): Promise<CreditNoteRow[]> {
  const rows = await prisma.creditNote.findMany({
    where: { originalInvoice: { legalEntity: { organizationId } } },
    include: { originalInvoice: true, customer: true },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => ({
    id: row.id,
    creditNoteNo: row.creditNoteNo,
    originalInvoiceNo: row.originalInvoice.invoiceNo,
    customer: row.customer.name,
    vessel: row.vesselName ?? "-",
    reasonCode: row.reasonCode,
    reviewNote: row.reviewNote,
    currency: row.currency,
    netAmount: toNumber(row.netAmount),
    vatAmount: toNumber(row.vatAmount),
    grossAmount: toNumber(row.grossAmount),
    status: row.status,
    createdDate: row.createdAt.toISOString(),
    approvalStatus: row.approvalStatus,
  }));
}

export async function getFinanceExceptionRows(organizationId: string): Promise<FinanceExceptionRow[]> {
  const rows = await prisma.financeException.findMany({
    where: { organizationId },
    include: { order: true, customerInvoice: true, supplierInvoice: true, creditNote: true },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    severity: row.severity,
    status: row.status,
    title: row.title,
    description: row.description,
    reference: row.customerInvoice?.invoiceNo ?? row.supplierInvoice?.supplierInvoiceNo ?? row.creditNote?.creditNoteNo ?? row.order?.poNumber ?? "-",
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function getExportReadinessRows(organizationId: string): Promise<ExportReadinessRow[]> {
  const rows = await prisma.accountingExportBatch.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } });
  return rows.map((row) => ({
    id: row.id,
    target: row.target,
    legalEntityId: row.legalEntityId,
    periodFrom: row.periodFrom?.toISOString().slice(0, 10) ?? null,
    periodTo: row.periodTo?.toISOString().slice(0, 10) ?? null,
    status: row.status,
    lastExportDate: row.exportedAt?.toISOString() ?? null,
    recordsReady: row.recordsReady,
    recordsBlocked: row.recordsBlocked,
    validationErrors: Array.isArray(row.validationErrors) ? row.validationErrors.map(String) : [],
  }));
}

export async function getFinanceAuditRows(organizationId: string): Promise<FinanceAuditRow[]> {
  const rows = await prisma.financeAuditEvent.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const customerInvoiceIds = rows.filter((row) => row.entityType === "CustomerInvoice").map((row) => row.entityId);
  const supplierInvoiceIds = rows.filter((row) => row.entityType === "SupplierInvoice").map((row) => row.entityId);
  const creditNoteIds = rows.filter((row) => row.entityType === "CreditNote").map((row) => row.entityId);
  const [customerInvoices, supplierInvoices, creditNotes] = await Promise.all([
    customerInvoiceIds.length ? prisma.customerInvoice.findMany({ where: { id: { in: customerInvoiceIds }, legalEntity: { organizationId } }, select: { id: true, invoiceNo: true } }) : [],
    supplierInvoiceIds.length ? prisma.supplierInvoice.findMany({ where: { id: { in: supplierInvoiceIds }, organizationId }, select: { id: true, supplierInvoiceNo: true } }) : [],
    creditNoteIds.length ? prisma.creditNote.findMany({ where: { id: { in: creditNoteIds }, originalInvoice: { legalEntity: { organizationId } } }, select: { id: true, creditNoteNo: true } }) : [],
  ]);
  const refs = new Map<string, string>();
  customerInvoices.forEach((invoice) => refs.set(invoice.id, invoice.invoiceNo));
  supplierInvoices.forEach((invoice) => refs.set(invoice.id, invoice.supplierInvoiceNo));
  creditNotes.forEach((note) => refs.set(note.id, note.creditNoteNo));

  return rows.map((row) => {
    const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? Object.entries(row.metadata).map(([key, value]) => `${key}: ${String(value)}`).join("; ")
      : "";
    return {
      id: row.id,
      entityType: row.entityType,
      entityRef: refs.get(row.entityId) ?? row.entityId,
      action: row.action,
      actorType: row.actorType,
      createdAt: row.createdAt.toISOString(),
      metadataSummary: metadata || "No metadata",
    };
  });
}

export async function getUnbilledDeliveredOrderRows(organizationId: string): Promise<UnbilledOrderRow[]> {
  const rows = await prisma.purchaseOrder.findMany({
    where: { organizationId, status: "Delivered", customerInvoices: { none: {} } },
    include: { lines: true },
    orderBy: { confirmedDate: "desc" },
  });
  return rows.map((order) => ({
    id: order.id,
    orderRef: order.poNumber,
    buyer: order.buyerName ?? "Customer pending",
    vessel: order.vessel,
    deliveryDate: (order.confirmedDate ?? order.eta).toISOString(),
    currency: order.currency,
    amount: order.lines.length ? order.lines.reduce((sum, line) => sum + line.lineTotal, 0) : order.total,
    lineCount: order.lines.length,
  }));
}
