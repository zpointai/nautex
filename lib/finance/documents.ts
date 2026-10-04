import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/finance/calculations";
import { requireCurrency } from "@/lib/finance/calculations";

function esc(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char] ?? char));
}

function money(value: unknown, currency = "EUR") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: requireCurrency(currency), currencyDisplay: "code", minimumFractionDigits: 2 }).format(toNumber(value));
}

function date(value: Date) {
  return value.toISOString().slice(0, 10);
}

export async function renderCustomerInvoiceHtml(id: string) {
  const invoice = await prisma.customerInvoice.findUnique({
    where: { id },
    include: { legalEntity: true, customer: true, lines: true, vatSummaries: true, payments: true, order: true },
  });
  if (!invoice) throw new Error("Invoice not found.");
  const sellerAddress = [invoice.legalEntity.addressLine1, invoice.legalEntity.addressLine2, invoice.legalEntity.postalCode, invoice.legalEntity.city, invoice.legalEntity.country].filter(Boolean).join(", ");
  const customerAddress = [invoice.customer.addressLine1, invoice.customer.addressLine2, invoice.customer.postalCode, invoice.customer.city, invoice.customer.country].filter(Boolean).join(", ");
  const lineRows = invoice.lines.map((line) => `
    <tr>
      <td>${line.lineNumber}</td>
      <td>${esc(line.description)}</td>
      <td class="num">${toNumber(line.quantity).toFixed(3)}</td>
      <td>${esc(line.unit)}</td>
      <td class="num">${money(line.unitPrice, invoice.currency)}</td>
      <td>${esc(line.vatCategory)}</td>
      <td class="num">${toNumber(line.vatRate).toFixed(2)}%</td>
      <td class="num">${money(line.netAmount, invoice.currency)}</td>
      <td class="num">${money(line.vatAmount, invoice.currency)}</td>
      <td class="num">${money(line.grossAmount, invoice.currency)}</td>
    </tr>
  `).join("");
  const vatRows = invoice.vatSummaries.map((row) => `
    <tr>
      <td>${esc(row.vatCategory)}</td>
      <td class="num">${toNumber(row.vatRate).toFixed(2)}%</td>
      <td class="num">${money(row.taxableAmount, invoice.currency)}</td>
      <td class="num">${money(row.vatAmount, invoice.currency)}</td>
      <td class="num">${money(row.grossAmount, invoice.currency)}</td>
    </tr>
  `).join("");
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${esc(invoice.invoiceNo)}</title>
  <style>
    body { font-family: Inter, Arial, sans-serif; margin: 40px; color: #132033; }
    header { display: flex; justify-content: space-between; gap: 32px; border-bottom: 2px solid #0f766e; padding-bottom: 24px; margin-bottom: 28px; }
    h1 { margin: 0; font-size: 28px; letter-spacing: .02em; }
    h2 { margin: 28px 0 10px; font-size: 15px; color: #0f766e; text-transform: uppercase; letter-spacing: .08em; }
    .muted { color: #667085; font-size: 12px; line-height: 1.6; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    .box { border: 1px solid #d0d5dd; border-radius: 8px; padding: 14px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
    th { background: #f2f4f7; text-align: left; color: #344054; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; }
    th, td { border-bottom: 1px solid #eaecf0; padding: 8px; vertical-align: top; }
    .num { text-align: right; white-space: nowrap; }
    .totals { margin-left: auto; width: 360px; }
    .totals td:first-child { font-weight: 700; }
    .total { font-size: 15px; font-weight: 800; }
    @media print { body { margin: 20mm; } button { display: none; } }
  </style>
</head>
<body>
  <button onclick="window.print()" style="float:right;padding:8px 12px;border-radius:6px;border:1px solid #0f766e;background:#0f766e;color:white;">Print / Save PDF</button>
  <header>
    <div>
      <h1>Invoice ${esc(invoice.invoiceNo)}</h1>
      <p class="muted">Status: ${esc(invoice.status)} | Currency: ${esc(invoice.currency)}</p>
    </div>
    <div class="muted">
      <strong>${esc(invoice.legalEntity.name)}</strong><br/>
      ${esc(sellerAddress)}<br/>
      VAT: ${esc(invoice.legalEntity.vatId)}${invoice.legalEntity.kvkNumber ? `<br/>KVK: ${esc(invoice.legalEntity.kvkNumber)}` : ""}<br/>
      IBAN: ${esc(invoice.legalEntity.bankIban ?? "")}
    </div>
  </header>

  <section class="grid">
    <div class="box">
      <h2>Bill To</h2>
      <strong>${esc(invoice.customer.name)}</strong><br/>
      <span class="muted">${esc(customerAddress)}<br/>VAT: ${esc(invoice.customer.vatId ?? "N/A")}</span>
    </div>
    <div class="box">
      <h2>Invoice Details</h2>
      <table>
        <tr><td>Invoice date</td><td class="num">${date(invoice.invoiceDate)}</td></tr>
        <tr><td>Delivery date</td><td class="num">${date(invoice.deliveryDate)}</td></tr>
        <tr><td>Due date</td><td class="num">${date(invoice.dueDate)}</td></tr>
        <tr><td>Customer PO</td><td class="num">${esc(invoice.customerPoRef ?? "")}</td></tr>
        <tr><td>Vessel</td><td class="num">${esc(invoice.vesselName ?? "")} ${invoice.vesselImo ? `(IMO ${esc(invoice.vesselImo)})` : ""}</td></tr>
        <tr><td>Payment terms</td><td class="num">${esc(invoice.paymentTerms)}</td></tr>
        <tr><td>Payment ref</td><td class="num">${esc(invoice.bankPaymentReference)}</td></tr>
      </table>
    </div>
  </section>

  <h2>Goods / Services</h2>
  <table>
    <thead><tr><th>#</th><th>Description</th><th class="num">Qty</th><th>Unit</th><th class="num">Unit Price</th><th>VAT Cat.</th><th class="num">VAT Rate</th><th class="num">Net</th><th class="num">VAT</th><th class="num">Gross</th></tr></thead>
    <tbody>${lineRows}</tbody>
  </table>

  <h2>VAT Totals</h2>
  <table class="totals">
    <thead><tr><th>Category</th><th class="num">Rate</th><th class="num">Taxable</th><th class="num">VAT</th><th class="num">Gross</th></tr></thead>
    <tbody>${vatRows}</tbody>
    <tr><td colspan="3">Net amount</td><td colspan="2" class="num">${money(invoice.netAmount, invoice.currency)}</td></tr>
    <tr><td colspan="3">VAT amount</td><td colspan="2" class="num">${money(invoice.vatAmount, invoice.currency)}</td></tr>
    <tr class="total"><td colspan="3">Gross amount</td><td colspan="2" class="num">${money(invoice.grossAmount, invoice.currency)}</td></tr>
    <tr><td colspan="3">Paid</td><td colspan="2" class="num">${money(invoice.paidAmount, invoice.currency)}</td></tr>
    <tr><td colspan="3">Credits applied</td><td colspan="2" class="num">${money(invoice.creditedAmount, invoice.currency)}</td></tr>
    <tr><td colspan="3">Outstanding</td><td colspan="2" class="num">${money(invoice.outstandingAmount, invoice.currency)}</td></tr>
  </table>
</body>
</html>`;
}
