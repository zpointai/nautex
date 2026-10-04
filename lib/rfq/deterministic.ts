import { prisma } from "@/lib/prisma";
import { parseHeaderTable } from "@/lib/procurement/validator";
import type { RFQLineItem, RFQProcessResult, SupplierMatch } from "@/lib/ai/services/rfq";

/* Structural noise in ShipServ RFQ exports: repeated column headers, page
   footers, and section separators that carry no item information. */
const SHIPSERV_NOISE = [
  /^#\s*Part$/i,
  /^Type\s+Part Number\s+Supplier Part$/i,
  /^No\.\s+Description\s+UoM\s+Qty$/i,
  /^Sent from .+ To .+ Document Number/i,
  /^--\s*\d+\s+of\s+\d+\s*--$/,
  /^Declined\s+Added\s+Changed\s+Currency/i,
  /^Equipment Section Name:/i,
];

/** A ShipServ item row: sequence, part type, part number, optional description. */
const SHIPSERV_ITEM = /^(\d{1,3})\s+([A-Z]{2})\s+(\S+)(?:\s+(.+))?$/;
/** Trailing unit and quantity, e.g. "PCE  6.0" or "MTR 20.0". */
const SHIPSERV_UOM_QTY = /\b([A-Z]{2,4})\s+(\d+(?:\.\d+)?)\s*$/;

/**
 * Parse the tabular line items of a ShipServ RFQ export.
 *
 * These documents carry ~60 lines of buyer, supplier, vessel, and billing
 * metadata before the item table. The generic heuristic below treats any line
 * ending in a number as an item, so telephone numbers and vessel identifiers
 * become line items. Recognising the actual table avoids that.
 */
function extractShipServLines(lines: string[]): RFQLineItem[] {
  const items: RFQLineItem[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(SHIPSERV_ITEM);
    if (!match) continue;

    const [, sequence, partType, partNumber, inlineDescription] = match;
    const descriptionParts: string[] = [];
    if (inlineDescription) descriptionParts.push(inlineDescription.trim());

    let unit = "";
    let quantity = 0;
    // "Buyer Comments:" starts a free-text sourcing note that wraps across
    // several lines. Its continuation lines carry no marker of their own, so
    // once the note begins, only the trailing unit/quantity is still of
    // interest — everything else would pollute the item description and
    // degrade supplier matching.
    let inBuyerComments = false;

    // Consume continuation lines until the next item row or section boundary.
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (SHIPSERV_ITEM.test(line) || /^Equipment Section Name:/i.test(line)) break;
      if (SHIPSERV_NOISE.some((pattern) => pattern.test(line))) continue;

      const uomQty = line.match(SHIPSERV_UOM_QTY);
      if (uomQty) {
        unit = uomQty[1].toUpperCase();
        quantity = Number(uomQty[2]);
      }

      if (/^Buyer Comments:/i.test(line)) inBuyerComments = true;
      if (inBuyerComments) continue;
      if (uomQty && line.replace(SHIPSERV_UOM_QTY, "").trim().length === 0) continue;

      const cleaned = line.replace(SHIPSERV_UOM_QTY, "").trim();
      if (cleaned) descriptionParts.push(cleaned);
    }

    const specifications = descriptionParts.join(" ").replace(/\s+/g, " ").trim();


    items.push({
      itemNumber: sequence.padStart(3, "0"),
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 0,
      specifications: `${specifications} (${partType} ${partNumber})`,
      unit,
    });
  }

  return items;
}

export function extractLines(documentText: string): RFQLineItem[] {
  const table = parseHeaderTable(documentText, "rfq");
  if (table.length) return table.map((line,index)=>({itemNumber:String(line.lineNumber ?? index+1), specifications:String(line.raw.description ?? ""),quantity:line.quantity ?? 0,unit:line.unit ?? "",currency:line.currency ?? ""}));
  const lines = documentText
    .split(/\r?\n/)
    .map((line) => line.replace(/\t/g, " ").trim())
    .filter(Boolean);

  // Structured exports are parsed by layout; free text falls back to the
  // generic "description then quantity" heuristic below.
  if (/Equipment Section Name:/i.test(documentText)) {
    const shipServ = extractShipServLines(lines);
    if (shipServ.length > 0) return shipServ;
  }

  const parsed = lines.flatMap((line, index) => {
    const match = line.match(/^(?:[-*#]?\s*)?(\d{1,4})?[\s.)-]*(.+?)\s+(\d+(?:\.\d+)?)\s*([A-Za-z]{1,8})?$/);
    if (!match) return [{ itemNumber: String(index + 1), quantity: 0, specifications: line, unit: "" }];

    const specifications = match[2]?.trim();
    const quantity = Number(match[3]);
    if (!specifications || !Number.isFinite(quantity)) return [];

    return [{
      itemNumber: match[1] || String(index + 1).padStart(3, "0"),
      quantity,
      specifications,
      unit: (match[4] || "").toUpperCase(),
    }];
  });

  return parsed;
}

/** Only an exact, same-unit line in a current organization-owned agreement supports a price. */
export async function processRFQDeterministic(documentText: string, organizationId: string): Promise<RFQProcessResult> {
  const lines = extractLines(documentText);
  const now = new Date();
  const agreements = await prisma.agreementItem.findMany({
    where: { version: { organizationId, status: "AgreementActive", supplier: { organizationId, status: { not: "Blocked" } },
      AND: [{ OR: [{validFrom:null}, {validFrom:{lte:now}}] }, { OR: [{validTo:null}, {validTo:{gte:now}}] }] } },
    include: { version: { include: { supplier: true } } },
  });
  return { summary: `Extracted ${lines.length} line(s). Human review required; prices appear only with exact current agreement evidence.`,
    lines: lines.map(line => {
      const matches = agreements.filter(a => a.description.trim().toLowerCase() === line.specifications.trim().toLowerCase()
        && !!line.unit && a.unit?.toUpperCase() === line.unit.toUpperCase() && Number.isFinite(a.basePrice) && a.basePrice >= 0);
      const supplierOptions: SupplierMatch[] = matches.map((a,index)=>({
        rank:index+1, supplierId:a.version.supplierId, supplierName:a.version.supplier.name,
        price:a.basePrice, currency:a.currency, stockStatus:"Unknown", leadTimeDays:a.leadTimeDays ?? 0,
        moqCompliant:a.moq != null && line.quantity >= a.moq, minimumOrderQuantity:a.moq ?? undefined,
        reasoning:`Exact description and unit in active agreement ${a.versionId}, line ${a.lineNumber}. Stock availability requires confirmation.`,
        flags: ["VERIFY_AVAILABILITY", ...(a.moq == null ? ["MOQ_UNKNOWN"] : line.quantity < a.moq ? ["BELOW_MOQ"] : []), ...(a.leadTimeDays == null ? ["LEAD_TIME_UNKNOWN"] : [])],
        supplierArticleNumber:a.vendorPartNumber ?? "", impaCode:"", matchConfidence:"NONE", matchMethod:"DIRECT",
      }));
      return {originalItem:line, supplierOptions, hasMultipleOptions:supplierOptions.length>1, noMatchFound:!supplierOptions.length,
        notes:"Parser extraction; source page coordinates unavailable. Review all values before use.", flags:[], matchConfidence:"NONE" as const, matchMethod:supplierOptions.length ? "DIRECT" as const : "NONE" as const};
    }) };
}
