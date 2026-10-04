import { Prisma, type FinanceExceptionType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiRequestError } from "@/lib/api/request";
import { OPEN_RECEIVABLE_STATUSES, validCurrency } from "./calculations";
import { financeWriter, fingerprint, jsonValue, moneyInput, productionAudit, requiredText, retryFinanceTransaction, type FinanceContext } from "./production";

const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
export async function calculateMargins(organizationId: string, tx: Prisma.TransactionClient = prisma) {
  const orders = await tx.purchaseOrder.findMany({ where: { organizationId, orderType: { not: "SubPO" } }, include: { marginSnapshots: true, supplierInvoices: true, lines: true, childOrders: { where: { organizationId }, include: { supplierInvoices: true } }, customerInvoices: { include: { creditNotes: true } } }, orderBy: { createdAt: "desc" } });
  return orders.map(order => {
    const previous = order.marginSnapshots[0];
    const issues: string[] = [], basis: string[] = [];
    const currentCurrency = order.currency;
    if (!validCurrency(currentCurrency)) issues.push("Order currency is missing or invalid");
    let revenue = D(order.total).toDecimalPlaces(2), supplierCost = D(0);
    const credits = order.customerInvoices.flatMap(invoice => invoice.creditNotes.filter(note => note.status === "Issued"));
    for (const credit of credits) { if (credit.currency !== currentCurrency) issues.push("Credit currency differs from the order; no conversion applied"); else revenue = revenue.sub(credit.netAmount); }
    const branches = order.childOrders.length ? order.childOrders : [order];
    let costKnown = true;
    for (const branch of branches) {
      const approved = branch.supplierInvoices.filter(invoice => invoice.approvalStatus === "Approved");
      if (branch.currency !== currentCurrency || approved.some(invoice => invoice.currency !== currentCurrency)) { issues.push("Supplier cost currency differs from the order; no conversion applied"); costKnown = false; continue; }
      const actual = approved.reduce((sum, invoice) => sum.add(invoice.invoicedCost), D(0));
      if (approved.some(invoice => invoice.isFinalInvoice)) { supplierCost = supplierCost.add(actual); basis.push(`${branch.poNumber}: approved supplier invoices marked final`); }
      else {
        const expected = branch.orderType === "SubPO" ? branch.costTotal ?? branch.total : branch.costTotal;
        if (expected == null) { costKnown = false; supplierCost = supplierCost.add(actual); issues.push(`${branch.poNumber}: supplier cost is incomplete; record a cost estimate or approved final invoice`); }
        else { supplierCost = supplierCost.add(Prisma.Decimal.max(D(expected), actual)); basis.push(`${branch.poNumber}: commitment/recorded cost estimate, at least approved invoice cost`); }
      }
    }
    // An invoice linked directly to a buyer order with supplier suborders must not be ignored.
    if (order.childOrders.length && order.supplierInvoices.some(invoice => invoice.approvalStatus === "Approved")) { costKnown = false; issues.push("Approved invoices are linked to both the buyer order and supplier orders; review allocation to avoid double counting"); }
    const freightDeliveryCost = previous?.freightDeliveryCost ?? D(0), customsBondedCost = previous?.customsBondedCost ?? D(0), warehouseHandlingCost = previous?.warehouseHandlingCost ?? D(0), otherCosts = previous?.otherCosts ?? D(0);
    if (!previous?.costsReviewedAt) issues.push("Additional order costs have not been reviewed (including confirmation of zero costs)");
    const grossProfit = revenue.sub(supplierCost).sub(freightDeliveryCost).sub(customsBondedCost).sub(warehouseHandlingCost).sub(otherCosts).toDecimalPlaces(2);
    if (revenue.lte(0)) issues.push("Order revenue is zero or negative; margin percentage is unavailable");
    const rawMargin = revenue.gt(0) ? grossProfit.div(revenue).mul(100).toDecimalPlaces(2) : D(0);
    const marginPct = Prisma.Decimal.max(-999999.99, Prisma.Decimal.min(999999.99, rawMargin));
    const targetMarginPct = previous?.targetMarginPct ?? D(Math.max(-100, Math.min(100, order.marginPct)));
    const marginVariance = Prisma.Decimal.max(-999999.99, Prisma.Decimal.min(999999.99, marginPct.sub(targetMarginPct)));
    const complete = costKnown && issues.length === 0;
    const status = !complete ? "MissingCost" as const : grossProfit.lt(0) ? "NegativeMargin" as const : marginVariance.lt(0) ? "MarginLeakage" as const : basis.some(line => line.includes("estimate")) ? "Watchlist" as const : "Healthy" as const;
    const calculationBasis = { version: "order-forecast-v1", revenueBasis: "Order agreed revenue less issued customer credits; not recognized accounting profit", supplierBasis: basis, issues, complete, currency: currentCurrency, costsReviewedAt: previous?.costsReviewedAt?.toISOString() ?? null };
    const source = { order: { total: order.total, currency: order.currency, marginPct: order.marginPct }, branches: branches.map(branch => ({ id: branch.id, currency: branch.currency, total: branch.total, costTotal: branch.costTotal, invoices: branch.supplierInvoices.map(invoice => ({ id: invoice.id, amount: invoice.invoicedCost, currency: invoice.currency, status: invoice.approvalStatus, final: invoice.isFinalInvoice })) })), credits: credits.map(note => ({ id: note.id, amount: note.netAmount, currency: note.currency })), freightDeliveryCost, customsBondedCost, warehouseHandlingCost, otherCosts, targetMarginPct, reviewedAt: previous?.costsReviewedAt };
    const inputFingerprint = fingerprint(source);
    return { orderId: order.id, orderRef: order.poNumber, customer: order.buyerName ?? order.vesselOwner ?? "Customer pending", vessel: order.vessel, currency: currentCurrency, revenue, supplierCost, freightDeliveryCost, customsBondedCost, warehouseHandlingCost, otherCosts, grossProfit, marginPct, targetMarginPct, marginVariance, status, calculationBasis, inputFingerprint, snapshotId: previous?.id ?? null, snapshotAt: previous?.computedAt?.toISOString() ?? null, snapshotStale: previous?.inputFingerprint !== inputFingerprint, costReviewNote: previous?.costReviewNote ?? "", version: previous?.updatedAt.toISOString() ?? null };
  });
}

type Finding = { ruleKey: string; type: FinanceExceptionType; severity: string; title: string; description: string; orderId?: string; customerInvoiceId?: string; supplierInvoiceId?: string; creditNoteId?: string; sourceFingerprint: string };
export async function refreshFinanceControls(organizationId: string, actor = { userId: "finance-agent", displayName: "Finance Exception Agent" }) {
  return retryFinanceTransaction(() => prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-controls:${organizationId}`}))`;
    const margins = await calculateMargins(organizationId, tx), now = new Date(), findings: Finding[] = [];
    const add = (type: FinanceExceptionType, id: string, link: Partial<Finding>, title: string, description: string, source: unknown, severity = "Medium") => findings.push({ ruleKey: `${type}:${id}`, type, severity, title, description, ...link, sourceFingerprint: fingerprint(source) });
    for (const margin of margins) {
      const { orderId, revenue, supplierCost, freightDeliveryCost, customsBondedCost, warehouseHandlingCost, otherCosts, grossProfit, marginPct, targetMarginPct, marginVariance, status, calculationBasis, inputFingerprint } = margin;
      const values = { revenue, supplierCost, freightDeliveryCost, customsBondedCost, warehouseHandlingCost, otherCosts, grossProfit, marginPct, targetMarginPct, marginVariance, status, calculationBasis: jsonValue(calculationBasis), inputFingerprint, computedAt: now };
      if (margin.snapshotStale) await tx.orderMarginSnapshot.upsert({ where: { orderId }, create: { orderId, ...values }, update: values });
      if (status === "MissingCost") add("OrderCostIncomplete", orderId, { orderId }, `Review costs for ${margin.orderRef}`, calculationBasis.issues.join("; "), { inputFingerprint });
      else if (marginVariance.lt(0)) add("MarginBelowThreshold", orderId, { orderId }, `Margin below target: ${margin.orderRef}`, `Forecast ${marginPct}% against target ${targetMarginPct}%. ${margin.currency} only; review costs and pricing.`, { inputFingerprint }, grossProfit.lt(0) ? "High" : "Medium");
    }
    const [suppliers, invoices, delivered, credits] = await Promise.all([
      tx.supplierInvoice.findMany({ where: { organizationId }, include: { purchaseOrder: true } }),
      tx.customerInvoice.findMany({ where: { legalEntity: { organizationId } }, include: { customer: true, legalEntity: true } }),
      tx.purchaseOrder.findMany({ where: { organizationId, orderType: { not: "SubPO" }, status: "Delivered", customerInvoices: { none: { status: { not: "Cancelled" } } } } }),
      tx.creditNote.findMany({ where: { originalInvoice: { legalEntity: { organizationId } }, status: { in: ["Draft", "AwaitingApproval"] } } }),
    ]);
    const duplicateGroups = new Map<string, typeof suppliers>();
    for (const invoice of suppliers.filter(row => row.approvalStatus !== "Rejected")) {
      const key = `${invoice.supplierName.trim().toLowerCase()}:${invoice.supplierInvoiceNo.trim().toLowerCase()}`;
      duplicateGroups.set(key, [...duplicateGroups.get(key) ?? [], invoice]);
      const link = { supplierInvoiceId: invoice.id, ...(invoice.purchaseOrderId ? { orderId: invoice.purchaseOrderId } : {}) };
      if (invoice.approvalStatus !== "Approved" && !invoice.varianceAmount.isZero()) add("SupplierInvoicePriceVariance", invoice.id, link, `Review invoice variance: ${invoice.supplierInvoiceNo}`, `Recorded cumulative PO variance ${invoice.varianceAmount} ${invoice.currency}; approval remains a human decision.`, { variance: invoice.varianceAmount, status: invoice.approvalStatus }, "High");
      if (!invoice.purchaseOrderId) add("InvoiceMissingLegalField", invoice.id, link, `Supplier invoice has no PO: ${invoice.supplierInvoiceNo}`, "Link a supplier purchase order or explicitly review the non-PO invoice with supporting evidence.", { po: null, version: invoice.updatedAt });
      if (!invoice.legalEntityId || !validCurrency(invoice.currency) || !invoice.invoicedCost.add(invoice.vatAmount).equals(invoice.grossAmount)) add("VatDataIncomplete", invoice.id, link, `Review invoice accounting data: ${invoice.supplierInvoiceNo}`, "Check legal-entity assignment, currency and net/VAT/gross totals before accounting export.", { legalEntityId: invoice.legalEntityId, currency: invoice.currency, net: invoice.invoicedCost, vat: invoice.vatAmount, gross: invoice.grossAmount }, "High");
      if (!invoice.sourceDocumentId && !invoice.evidenceRef) add("MissingDeliveryEvidence", invoice.id, link, `Invoice source missing: ${invoice.supplierInvoiceNo}`, "Attach the invoice or record its supporting source reference.", { evidence: null });
      if (invoice.approvalStatus !== "Approved" && invoice.matchStatus === "QuantityVariance") add("SupplierInvoiceQuantityVariance", invoice.id, link, `Review quantities: ${invoice.supplierInvoiceNo}`, "Compare supplier invoice quantities with PO and receipt records.", { status: invoice.matchStatus, version: invoice.updatedAt });
    }
    for (const group of duplicateGroups.values()) if (group.length > 1) for (const invoice of group) add("DuplicateSupplierInvoiceRisk", invoice.id, { supplierInvoiceId: invoice.id }, `Possible duplicate: ${invoice.supplierInvoiceNo}`, "Multiple non-rejected invoices have the same normalized supplier name and invoice number. Review before payment.", { ids: group.map(row => row.id).sort() }, "High");
    for (const invoice of invoices) {
      const link = { customerInvoiceId: invoice.id, ...(invoice.orderId ? { orderId: invoice.orderId } : {}) };
      if (OPEN_RECEIVABLE_STATUSES.includes(invoice.status) && invoice.outstandingAmount.gt(0) && invoice.dueDate < now) add("CustomerInvoiceOverdue", invoice.id, link, `Overdue invoice: ${invoice.invoiceNo}`, `Outstanding ${invoice.outstandingAmount} ${invoice.currency}, due ${invoice.dueDate.toISOString().slice(0, 10)}.`, { outstanding: invoice.outstandingAmount, dueDate: invoice.dueDate, status: invoice.status }, "High");
      if (invoice.status !== "Cancelled" && (!invoice.customer.addressLine1 || !invoice.customer.country || !invoice.legalEntity.vatId || !invoice.bankPaymentReference)) add("InvoiceMissingLegalField", invoice.id, link, `Incomplete invoice details: ${invoice.invoiceNo}`, "Review customer address, seller VAT identity and payment reference before posting.", { address: invoice.customer.addressLine1, country: invoice.customer.country, sellerVat: invoice.legalEntity.vatId, reference: invoice.bankPaymentReference });
    }
    for (const order of delivered) add("DeliveredOrderNotInvoiced", order.id, { orderId: order.id }, `Delivered order not invoiced: ${order.poNumber}`, "Review delivered quantities and create a customer invoice from Receivables.", { status: order.status, total: order.total });
    for (const note of credits) add("CreditNoteAwaitingApproval", note.id, { creditNoteId: note.id }, `Credit awaiting review: ${note.creditNoteNo}`, "Review the reason and amounts before approving or issuing this credit.", { status: note.status, amount: note.grossAmount });
    const existing = await tx.financeException.findMany({ where: { organizationId, ruleKey: { not: null } } });
    let created = 0, reopened = 0, resolved = 0;
    for (const finding of findings) {
      const prior = existing.find(row => row.ruleKey === finding.ruleKey);
      const changed = prior?.sourceFingerprint !== finding.sourceFingerprint;
      if (!prior || changed) {
        const saved = await tx.financeException.upsert({ where: { organizationId_ruleKey: { organizationId, ruleKey: finding.ruleKey } }, create: { organizationId, ...finding, lastDetectedAt: now }, update: { ...finding, status: "Open", resolvedAt: null, lastDetectedAt: now } });
        if (!prior) created++; else if (["Resolved", "Dismissed"].includes(prior.status)) reopened++;
        await productionAudit(tx, { organizationId, ...actor }, "ExceptionCreated", "FinanceException", saved.id, { rule: finding.ruleKey, reopened: Boolean(prior), description: finding.description });
      } else await tx.financeException.update({ where: { id: prior.id }, data: { lastDetectedAt: now } });
    }
    const activeKeys = new Set(findings.map(row => row.ruleKey));
    for (const prior of existing) if (!activeKeys.has(prior.ruleKey!) && ["Open", "InReview"].includes(prior.status)) {
      await tx.financeException.update({ where: { id: prior.id }, data: { status: "Resolved", resolvedAt: now } }); resolved++;
      await productionAudit(tx, { organizationId, ...actor }, "ExceptionResolved", "FinanceException", prior.id, { rule: prior.ruleKey, reason: "Underlying condition no longer detected" });
    }
    const result = { checkedAt: now.toISOString(), marginSnapshots: margins.length, findings: findings.length, created, reopened, resolved, rulesVersion: "finance-controls-v1" };
    await productionAudit(tx, { organizationId, ...actor }, "FinanceChecksCompleted", "Organization", organizationId, result);
    return result;
  }, { isolationLevel: "RepeatableRead", timeout: 30_000 }));
}

export async function reviewOrderCosts(context: FinanceContext, input: Record<string, unknown>) {
  const organizationId = financeWriter(context, true), orderId = requiredText(input.orderId, "an order"), note = requiredText(input.reviewNote, "a cost review note", 2000);
  if (note.length < 10 || input.confirmCosts !== true) throw new ApiRequestError("COST_REVIEW", "Confirm all additional costs, including zero amounts, and explain the review.", 400);
  const data = { freightDeliveryCost: moneyInput(input.freightDeliveryCost, "freight cost"), customsBondedCost: moneyInput(input.customsBondedCost, "customs cost"), warehouseHandlingCost: moneyInput(input.warehouseHandlingCost, "warehouse cost"), otherCosts: moneyInput(input.otherCosts, "other costs") };
  if (typeof input.targetMarginPct !== "number" || !Number.isFinite(input.targetMarginPct) || input.targetMarginPct < -100 || input.targetMarginPct > 100) throw new ApiRequestError("MARGIN_TARGET", "Enter a target percentage from -100 to 100.", 400);
  const targetMarginPct = input.targetMarginPct;
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-controls:${organizationId}`}))`;
    const margin = (await calculateMargins(organizationId, tx)).find(row => row.orderId === orderId);
    if (!margin) throw new ApiRequestError("ORDER_NOT_FOUND", "Customer order not found.", 404);
    if (margin.version !== (input.version ?? null)) throw new ApiRequestError("COSTS_CHANGED", "Cost review changed. Refresh before saving.", 409);
    const saved = { ...data, targetMarginPct, costReviewNote: note, costsReviewedAt: new Date(), inputFingerprint: null };
    await tx.orderMarginSnapshot.upsert({ where: { orderId }, create: { orderId, revenue: margin.revenue, supplierCost: margin.supplierCost, grossProfit: margin.grossProfit, marginPct: margin.marginPct, marginVariance: margin.marginVariance, status: "MissingCost", ...saved }, update: saved });
    await productionAudit(tx, { ...context, organizationId }, "MarginCostsReviewed", "PurchaseOrder", orderId, { ...data, targetMarginPct: input.targetMarginPct, note });
  });
  return refreshFinanceControls(organizationId, context);
}
