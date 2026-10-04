import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { validCurrency } from "./calculations";
import { financialDate } from "./settlements";

export async function getVatReview(organizationId: string, input: { from: string; to: string; legalEntityId?: string }) {
  const from = financialDate(input.from), to = financialDate(input.to);
  if (from > to || to.getTime() - from.getTime() > 366 * 86400000) throw new Error("Choose a reporting period of up to one year with the start before the end.");
  const end = new Date(to.getTime() + 86400000), period = { gte: from, lt: end };
  const legalEntities = await prisma.legalEntity.findMany({ where: { organizationId }, select: { id: true, name: true } });
  if (input.legalEntityId && !legalEntities.some(row => row.id === input.legalEntityId)) throw new Error("Legal entity not found in this organization.");
  const [invoices, suppliers, credits] = await Promise.all([
    prisma.customerInvoice.findMany({ where: { legalEntity: { organizationId }, invoiceDate: period }, include: { legalEntity: true } }),
    prisma.supplierInvoice.findMany({ where: { organizationId, invoiceDate: period } }),
    prisma.creditNote.findMany({ where: { originalInvoice: { legalEntity: { organizationId } }, OR: [{ issuedAt: period }, { issuedAt: null, status: "Issued" }] }, include: { originalInvoice: { include: { legalEntity: true } } } }),
  ]);
  type Row = { kind: "CustomerInvoice" | "SupplierInvoice" | "CreditNote"; id: string; reference: string; date: string | null; legalEntityId: string | null; legalEntity: string; currency: string; net: number; vat: number; gross: number; included: boolean; exclusion: string | null };
  const rows: Row[] = [];
  const add = (row: Omit<Row, "included" | "exclusion">, exclusion?: string) => {
    let reason = exclusion;
    if (!validCurrency(row.currency)) reason = "Currency missing or invalid";
    if (row.legalEntityId && !legalEntities.some(entity => entity.id === row.legalEntityId)) reason = "Legal entity no longer belongs to this organization";
    if (!row.legalEntityId) reason = "Supplier legal entity requires reviewed assignment";
    if (input.legalEntityId && row.legalEntityId && row.legalEntityId !== input.legalEntityId) return;
    if (Math.abs(row.net + row.vat - row.gross) > 0.005) reason = "Net plus recorded VAT does not equal gross";
    rows.push({ ...row, included: !reason, exclusion: reason ?? null });
  };
  for (const row of invoices) add({ kind: "CustomerInvoice", id: row.id, reference: row.invoiceNo, date: row.invoiceDate.toISOString().slice(0, 10), legalEntityId: row.legalEntityId, legalEntity: row.legalEntity.name, currency: row.currency, net: Number(row.netAmount), vat: Number(row.vatAmount), gross: Number(row.grossAmount) }, ["Posted", "Sent", "PartiallyPaid", "Paid", "Overdue", "Disputed"].includes(row.status) ? undefined : `Invoice is ${row.status}`);
  for (const row of suppliers) add({ kind: "SupplierInvoice", id: row.id, reference: row.supplierInvoiceNo, date: row.invoiceDate.toISOString().slice(0, 10), legalEntityId: row.legalEntityId, legalEntity: legalEntities.find(entity => entity.id === row.legalEntityId)?.name ?? "Unassigned", currency: row.currency, net: Number(row.invoicedCost), vat: Number(row.vatAmount), gross: Number(row.grossAmount) }, row.approvalStatus === "Approved" ? undefined : `Supplier invoice is ${row.approvalStatus}`);
  for (const row of credits) add({ kind: "CreditNote", id: row.id, reference: row.creditNoteNo, date: row.issuedAt?.toISOString().slice(0, 10) ?? null, legalEntityId: row.originalInvoice.legalEntityId, legalEntity: row.originalInvoice.legalEntity.name, currency: row.currency, net: -Number(row.netAmount), vat: -Number(row.vatAmount), gross: -Number(row.grossAmount) }, row.status !== "Issued" ? `Credit is ${row.status}` : !row.issuedAt ? "Issued credit has no verified issue date" : undefined);
  const groups = new Map<string, { legalEntity: string; currency: string; salesVat: Prisma.Decimal; creditVat: Prisma.Decimal; purchaseVat: Prisma.Decimal; records: number }>();
  for (const row of rows.filter(row => row.included)) {
    const key = `${row.legalEntityId}:${row.currency}`;
    const group = groups.get(key) ?? { legalEntity: row.legalEntity, currency: row.currency, salesVat: new Prisma.Decimal(0), creditVat: new Prisma.Decimal(0), purchaseVat: new Prisma.Decimal(0), records: 0 };
    if (row.kind === "CustomerInvoice") group.salesVat = group.salesVat.add(row.vat);
    if (row.kind === "CreditNote") group.creditVat = group.creditVat.add(row.vat);
    if (row.kind === "SupplierInvoice") group.purchaseVat = group.purchaseVat.add(row.vat);
    group.records++; groups.set(key, group);
  }
  return { rulesVersion: "recorded-documents-v1", from: input.from, to: input.to, legalEntities, rows, excludedCount: rows.filter(row => !row.included).length, groups: [...groups.values()].map(group => ({ ...group, salesVat: Number(group.salesVat), creditVat: Number(group.creditVat), purchaseVat: Number(group.purchaseVat), recordedDifference: Number(group.salesVat.add(group.creditVat).sub(group.purchaseVat)) })), basis: "Invoice date for posted customer and approved supplier invoices; issue date for issued credits. Dates are calendar days in UTC. Currencies and legal entities are never combined. Recorded VAT is not recalculated; supplier deductibility and tax-return boxes are not determined." };
}

export function financeCsv(rows: Record<string, unknown>[]) {
  const cell = (value: unknown) => { let text = value == null ? "" : String(value); if (typeof value === "string" && /^[=+@\-\t\r]/.test(text)) text = `'${text}`; return `"${text.replace(/"/g, '""')}"`; };
  if (!rows.length) return "";
  const columns = Object.keys(rows[0]);
  return [columns.map(cell).join(","), ...rows.map(row => columns.map(column => cell(row[column])).join(","))].join("\r\n");
}
