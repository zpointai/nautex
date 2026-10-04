import type { PurchaseOrder, PurchaseOrderLine } from "@prisma/client";

function escapePdfText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function line(text: string, x: number, y: number, size = 10) {
  return `BT /F1 ${size} Tf ${x} ${y} Td (${escapePdfText(text)}) Tj ET`;
}

export function createPurchaseOrderPdf(order: PurchaseOrder & { lines: PurchaseOrderLine[] }) {
  const rows = [
    line("Nautex AI - Supplier Purchase Order", 48, 790, 16),
    line(`PO Number: ${order.poNumber}`, 48, 758, 11),
    line(`Linked Sales Order: ${order.buyerRef || order.supplierRef || "-"}`, 48, 742, 10),
    line(`Customer PO: ${order.supplierRef && !order.supplierRef.startsWith("SO-") ? order.supplierRef : order.poNumber}`, 48, 726, 10),
    line(`Supplier: ${order.supplier}`, 48, 710, 10),
    line(`Vessel: ${order.vessel}${order.vesselImo ? ` / IMO ${order.vesselImo}` : ""}`, 48, 694, 10),
    line(`Port/ETA: ${order.port || "-"} / ${order.eta.toISOString().slice(0, 10)}`, 48, 678, 10),
    line(`Currency: ${order.currency}`, 48, 662, 10),
    line("Lines", 48, 632, 12),
    line("#", 48, 612, 9),
    line("Description", 74, 612, 9),
    line("Qty", 378, 612, 9),
    line("UOM", 420, 612, 9),
    line("Unit", 462, 612, 9),
    line("Total", 520, 612, 9),
  ];

  let y = 594;
  for (const item of order.lines.slice(0, 26)) {
    const description = item.description.length > 52 ? `${item.description.slice(0, 49)}...` : item.description;
    rows.push(line(String(item.lineNumber), 48, y, 8));
    rows.push(line(description, 74, y, 8));
    rows.push(line(String(item.qtyOrdered), 378, y, 8));
    rows.push(line(item.uom, 420, y, 8));
    rows.push(line(item.unitPrice.toFixed(2), 462, y, 8));
    rows.push(line(item.lineTotal.toFixed(2), 520, y, 8));
    y -= 16;
  }

  if (order.lines.length > 26) {
    rows.push(line(`Additional ${order.lines.length - 26} lines omitted from this preview PDF.`, 48, y - 8, 8));
  }

  const content = rows.join("\n");
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    `5 0 obj << /Length ${Buffer.byteLength(content)} >> stream\n${content}\nendstream endobj`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${obj}\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}
