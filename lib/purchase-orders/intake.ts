export type PurchaseOrderIntakeSourceType = "pdf" | "spreadsheet" | "text";

export interface PurchaseOrderIntakeLineDraft {
  lineNumber?: number;
  itemCode?: string | null;
  supplierPartNo?: string | null;
  description: string;
  qtyOrdered: number;
  uom: string;
  unitPrice: number;
  lineTotal?: number;
  requestedDate?: string | null;
  remarks?: string | null;
}

export interface PurchaseOrderIntakeDraft {
  sourceFileName?: string | null;
  sourceType: PurchaseOrderIntakeSourceType;
  orderType: "BuyerPO" | "DirectPO" | "SubPO";
  poNumber?: string | null;
  vessel: string;
  vesselImo?: string | null;
  vesselOwner?: string | null;
  supplier: string;
  buyerName?: string | null;
  buyerRef?: string | null;
  port?: string | null;
  eta: string;
  requestedDate?: string | null;
  currency: string;
  marginPct: number;
  priority: "High" | "Normal" | "Low";
  lines: PurchaseOrderIntakeLineDraft[];
  confidence: number;
  warnings: string[];
  extractionSummary: string;
  rawTextPreview: string;
}

interface ParseOptions {
  fileName?: string | null;
  sourceType?: PurchaseOrderIntakeSourceType;
  warnings?: string[];
}

const CURRENCY_ALIASES: Record<string, string> = {
  "€": "EUR",
  eur: "EUR",
  euro: "EUR",
  "$": "USD",
  usd: "USD",
  us$: "USD",
  gbp: "GBP",
  "£": "GBP",
  nok: "NOK",
  dkk: "DKK",
  sek: "SEK",
  sgd: "SGD",
  aed: "AED",
};

const UOMS = new Set([
  "EA", "PCS", "PC", "PCE", "SET", "BOX", "BX", "PACK", "PK", "PKT", "PA", "LTR", "L", "LT", "KG", "KGM", "GRM", "G",
  "M", "MTR", "M2", "M3", "ROLL", "ROL", "NRL", "PAIR", "PR", "BTL", "BOT", "BO", "BOTTLE", "CAN", "CTN", "CT", "BAG",
  "BG", "TIN", "DRUM", "TUBE", "TUB", "CAR", "CART", "COIL", "CYL", "JAR", "JR", "KIT", "LOT", "PAC", "PAL", "REEL",
  "SHT", "SHEET",
]);

function clean(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function numberFrom(value: string | null | undefined) {
  if (!value) return 0;
  const compact = value.replace(/[^\d,.-]/g, "");
  const normalized = compact.includes(",") && !compact.includes(".")
    ? compact.replace(/,(?=\d{3}(?:\D|$))/g, "").replace(",", ".")
    : compact.replace(/,(?=\d{3}(?:\D|$))/g, "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasNumericValue(value: string | null | undefined) {
  return !!value && /^-?\d[\d,.-]*$/.test(value.replace(/[^\d,.-]/g, ""));
}

function matchValue(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return clean(match[1]);
  }
  return "";
}

function usable(value: string | null | undefined) {
  const result = clean(value);
  return result && !/^not provided$/i.test(result) ? result : "";
}

function valueAfterLabel(lines: string[], label: RegExp) {
  for (const rawLine of lines) {
    const line = clean(rawLine);
    if (!label.test(line)) continue;
    const tabValue = rawLine.split(/\t+/).slice(1).join(" ");
    const colonValue = line.replace(/^.*?:\s*/, "");
    return usable(tabValue || colonValue);
  }
  return "";
}

function shipServSectionName(lines: string[], heading: RegExp) {
  const index = lines.findIndex((line) => heading.test(clean(line)));
  if (index < 0) return "";
  for (let i = index + 1; i < Math.min(lines.length, index + 6); i += 1) {
    const line = clean(lines[i]);
    if (!line || /^(address|contact|tel|email)\s*:/i.test(line)) continue;
    return usable(line.replace(/\s+\(\d+\)$/, ""));
  }
  return "";
}

function normalizeDate(value: string | null | undefined) {
  const raw = clean(value);
  if (!raw) return "";

  const iso = raw.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;

  const european = raw.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  if (european) return `${european[3]}-${european[2].padStart(2, "0")}-${european[1].padStart(2, "0")}`;

  const named = raw.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(20\d{2})\b/);
  if (named) {
    const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].findIndex((m) => named[2].toLowerCase().startsWith(m));
    if (month >= 0) return `${named[3]}-${String(month + 1).padStart(2, "0")}-${named[1].padStart(2, "0")}`;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function parseCsvRow(row: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < row.length; i += 1) {
    const char = row[i];
    const next = row[i + 1];
    if (char === '"' && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(clean(current));
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(clean(current));
  return cells;
}

function detectCurrency(text: string) {
  const lowered = text.toLowerCase();
  for (const [key, currency] of Object.entries(CURRENCY_ALIASES)) {
    if (lowered.includes(key.toLowerCase())) return currency;
  }
  return "EUR";
}

function normalizePort(value: string | null | undefined) {
  const port = usable(value);
  if (/^antwer$/i.test(port)) return "Antwerp";
  return port;
}

function detectSourceType(fileName: string | null | undefined, fallback?: PurchaseOrderIntakeSourceType): PurchaseOrderIntakeSourceType {
  const lower = (fileName ?? "").toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".csv")) return "spreadsheet";
  return fallback ?? "text";
}

function detectSplitHeaderParty(lines: string[], side: "buyer" | "supplier") {
  const headerIndex = lines.findIndex((line) => /buyer details/i.test(line) && /supplier details/i.test(line));
  if (headerIndex < 0) return "";
  const row = lines[headerIndex + 1] ?? "";
  const cells = row.split(/\t+/).map(clean).filter(Boolean);
  if (cells.length >= 2) return side === "buyer" ? cells[0] : cells[1];
  return "";
}

function parseSpreadsheetLines(lines: string[]) {
  const drafts: PurchaseOrderIntakeLineDraft[] = [];
  let headers: string[] | null = null;

  for (const rawLine of lines) {
    const cells = parseCsvRow(rawLine);
    if (cells.length < 3) continue;
    const normalized = cells.map((cell) => cell.toLowerCase());
    const looksLikeHeader = normalized.some((cell) => /description|item|article|material/.test(cell)) && normalized.some((cell) => /qty|quantity|ordered/.test(cell));
    if (looksLikeHeader) {
      headers = normalized;
      continue;
    }
    if (!headers) continue;

    const findIndex = (...names: string[]) => headers!.findIndex((header) => names.some((name) => header.includes(name)));
    const descriptionIndex = findIndex("description", "item name", "article", "material");
    const qtyIndex = findIndex("qty", "quantity", "ordered");
    const uomIndex = findIndex("uom", "unit");
    const unitPriceIndex = findIndex("unit price", "price", "rate");
    const itemIndex = findIndex("impa", "code", "item no", "part");

    const description = clean(cells[descriptionIndex] || cells[1] || cells[0]);
    if (!description || /total|subtotal|vat|tax/i.test(description)) continue;
    const qtyOrdered = numberFrom(cells[qtyIndex] || "1");
    const uom = clean(cells[uomIndex] || "EA").toUpperCase();
    const unitPrice = numberFrom(cells[unitPriceIndex]);

    drafts.push({
      lineNumber: drafts.length + 1,
      itemCode: itemIndex >= 0 ? clean(cells[itemIndex]) || null : null,
      description,
      qtyOrdered: qtyOrdered || 1,
      uom: UOMS.has(uom) ? uom : "EA",
      unitPrice,
      lineTotal: (qtyOrdered || 1) * unitPrice,
    });
  }

  return drafts;
}

function isShipServDocument(text: string) {
  return /SHIPSERV BUYER RECORD/i.test(text) && /SHIPSERV SUPPLIER RECORD/i.test(text);
}

function isUom(value: string) {
  return UOMS.has(value.toUpperCase());
}

function looksLikeItemCode(value: string) {
  const normalized = clean(value);
  return /^[A-Z0-9][A-Z0-9/._-]{1,24}$/i.test(normalized) && !/\s/.test(normalized);
}

function isShipServItemStart(cells: string[]) {
  return cells.length >= 2 && /^\d{1,4}$/.test(cells[0]) && /^[A-Z]{1,4}$/.test(cells[1]);
}

function splitShipServCells(raw: string) {
  const cells = raw.split(/\t+/).map(clean).filter(Boolean);
  const firstCell = cells[0]?.match(/^(\d{1,4})\s+([A-Z]{1,4})$/);
  if (firstCell && cells.length > 1) {
    return [firstCell[1], firstCell[2], ...cells.slice(1)];
  }
  return cells;
}

function extractShipServDescription(lines: string[]) {
  const descriptionLines: string[] = [];
  let collectingName = false;

  for (const raw of lines) {
    const line = clean(raw);
    if (!line) continue;
    if (/^(#|type|no\.?|description|%|total cost|equipment section|sent from|--\s*\d+ of)/i.test(line)) continue;

    const nameMatch = line.match(/^Name(?:\s*\d+)?:\s*(.+)$/i);
    if (nameMatch) {
      descriptionLines.push(nameMatch[1]);
      collectingName = true;
      continue;
    }

    if (/^(buyer comments|maker|makers no|original maker|original makers no|model|drawing no|comments to vendor|installed by|also see|page\s+\d+|document number|sent from)\s*:?/i.test(line)) {
      if (descriptionLines.length > 0) break;
      collectingName = false;
      continue;
    }

    if (collectingName || descriptionLines.length === 0 || !/^(contact|tel|email|address)\s*:/i.test(line)) {
      descriptionLines.push(line);
    }
  }

  return clean(descriptionLines.join(" ").replace(/\s+,/g, ","));
}

function buildShipServLine(lineNumber: number, itemCode: string | null, description: string, uom: string, qty: string, unitPrice: string, total?: string | null): PurchaseOrderIntakeLineDraft | null {
  const cleanDescription = clean(description);
  if (!cleanDescription || cleanDescription.length < 3) return null;
  const qtyOrdered = hasNumericValue(qty) ? numberFrom(qty) : 1;
  const price = numberFrom(unitPrice);
  const normalizedUom = clean(uom).toUpperCase();
  return {
    lineNumber,
    itemCode: itemCode || null,
    description: cleanDescription,
    qtyOrdered,
    uom: isUom(normalizedUom) ? normalizedUom : normalizedUom.slice(0, 8) || "EA",
    unitPrice: price,
    lineTotal: hasNumericValue(total) ? numberFrom(total) : qtyOrdered * price,
  };
}

function parseShipServLines(rawLines: string[]) {
  const drafts: PurchaseOrderIntakeLineDraft[] = [];
  let inItems = false;
  let current: { lineNumber: number; itemCode: string | null; descriptionParts: string[] } | null = null;

  function flushWithPrice(cells: string[]) {
    if (!current || cells.length < 3) return false;
    const uomIndex = cells.findIndex((cell, index) => isUom(cell) && hasNumericValue(cells[index + 1]) && hasNumericValue(cells[index + 2]));
    if (uomIndex < 0) return false;
    const line = buildShipServLine(current.lineNumber, current.itemCode, extractShipServDescription(current.descriptionParts), cells[uomIndex], cells[uomIndex + 1], cells[uomIndex + 2], cells[cells.length - 1]);
    if (line) drafts.push(line);
    current = null;
    return true;
  }

  for (const raw of rawLines) {
    const line = clean(raw);
    const cells = splitShipServCells(raw);
    if (!inItems && /Currency\s*:/i.test(line)) {
      inItems = true;
      continue;
    }
    if (!inItems) continue;
    if (/^Sent from .* Document Number:/i.test(line)) continue;
    if (/^--\s*\d+\s+of\s+\d+\s*--$/i.test(line)) continue;
    if (/^(#|Type|No\.?|Description|%|Total Cost)$/i.test(line)) continue;
    if (/^Equipment Section/i.test(line)) continue;

    if (isShipServItemStart(cells)) {
      current = null;
      const lineNumber = Number.parseInt(cells[0], 10);

      if (cells.length >= 7) {
        const uomIndex = cells.findIndex((cell, index) => index >= 2 && isUom(cell) && hasNumericValue(cells[index + 1]) && hasNumericValue(cells[index + 2]));
        if (uomIndex >= 0) {
          const descriptionCells = cells.slice(2, uomIndex);
          const itemCode = descriptionCells.length > 1 && looksLikeItemCode(descriptionCells[0]) ? descriptionCells.shift()! : null;
          const lineDraft = buildShipServLine(lineNumber, itemCode, descriptionCells.join(" "), cells[uomIndex], cells[uomIndex + 1], cells[uomIndex + 2], cells[cells.length - 1]);
          if (lineDraft) drafts.push(lineDraft);
          continue;
        }
      }

      const rest = cells.slice(2);
      let itemCode: string | null = null;
      const descriptionParts: string[] = [];
      if (rest.length > 0) {
        const combinedCodeAndDescription = rest[0].match(/^([A-Z0-9][A-Z0-9/._-]{1,24})\s+(.+)$/i);
        if (combinedCodeAndDescription && /^Name\s*:/i.test(combinedCodeAndDescription[2])) {
          itemCode = combinedCodeAndDescription[1];
          rest[0] = combinedCodeAndDescription[2];
        } else if (looksLikeItemCode(rest[0])) {
          itemCode = rest.shift() || null;
        }
        if (rest.length > 0) descriptionParts.push(rest.join(" "));
      }
      current = { lineNumber, itemCode, descriptionParts };
      continue;
    }

    if (flushWithPrice(cells)) continue;
    if (current && line) current.descriptionParts.push(line);
  }

  return drafts;
}

function parseTextLines(lines: string[]) {
  const drafts: PurchaseOrderIntakeLineDraft[] = [];
  const skip = /^(page|sent from|document number|subtotal|total|vat|tax|delivery|payment|terms|buyer|seller|shipserv|purchase order|quotation|invoice|line item|currency)\b/i;

  for (const raw of lines) {
    const line = clean(raw);
    if (line.length < 8 || skip.test(line)) continue;

    const cells = raw.split(/\t+/).map(clean).filter(Boolean);
    if (cells.length >= 6 && /^\d{1,3}(?:\s+[A-Z]{1,4})?$/.test(cells[0])) {
      const lineNumber = Number.parseInt(cells[0].match(/^\d{1,3}/)?.[0] ?? String(drafts.length + 1), 10);
      const firstCellHasType = /\s+[A-Z]{1,4}$/.test(cells[0]);
      const itemCode = firstCellHasType ? cells[1] : cells[2];
      const description = firstCellHasType ? cells[2] : cells[3];
      const uom = firstCellHasType ? cells[3] : cells[4];
      const qty = firstCellHasType ? cells[4] : cells[5];
      const unitPrice = firstCellHasType ? cells[5] : cells[6];
      const total = cells[cells.length - 1];
      if (description && !skip.test(description)) {
        const qtyOrdered = numberFrom(qty) || 1;
        const price = numberFrom(unitPrice);
        drafts.push({
          lineNumber,
          itemCode: itemCode || null,
          description,
          qtyOrdered,
          uom: clean(uom).toUpperCase() || "EA",
          unitPrice: price,
          lineTotal: numberFrom(total) || qtyOrdered * price,
        });
        continue;
      }
    }

    const tableMatch = line.match(/^(?:(\d{1,3})\s+)?(?:(\d{5,8})\s+)?(.{8,}?)\s+(\d+(?:[,.]\d+)?)\s+([A-Za-z]{1,8})\s+(?:[A-Z]{3}|\€|\$|£)?\s*([\d.,]+)(?:\s+(?:[A-Z]{3}|\€|\$|£)?\s*([\d.,]+))?$/);
    if (!tableMatch) continue;

    const description = clean(tableMatch[3]);
    if (!description || description.length < 4) continue;
    const qtyOrdered = numberFrom(tableMatch[4]) || 1;
    const uom = clean(tableMatch[5]).toUpperCase();
    const unitPrice = numberFrom(tableMatch[6]);

    drafts.push({
      lineNumber: drafts.length + 1,
      itemCode: tableMatch[2] ? tableMatch[2] : null,
      description,
      qtyOrdered,
      uom: UOMS.has(uom) ? uom : uom.slice(0, 8) || "EA",
      unitPrice,
      lineTotal: numberFrom(tableMatch[7]) || qtyOrdered * unitPrice,
    });
  }

  return drafts;
}

function detectLineSequenceGaps(lines: PurchaseOrderIntakeLineDraft[]) {
  const numbers = Array.from(
    new Set(lines.map((line) => line.lineNumber).filter((value): value is number => typeof value === "number" && Number.isFinite(value))),
  ).sort((a, b) => a - b);
  if (numbers.length < 2) return [];

  const missing: number[] = [];
  for (let expected = numbers[0]; expected <= numbers[numbers.length - 1]; expected += 1) {
    if (!numbers.includes(expected)) missing.push(expected);
  }
  return missing;
}

export function parsePurchaseOrderText(text: string, options: ParseOptions = {}): PurchaseOrderIntakeDraft {
  const normalizedText = text.replace(/\r/g, "\n");
  const compactText = normalizedText.replace(/[ \t]+/g, " ");
  const rawLines = normalizedText.split("\n").map((line) => line.trim()).filter(Boolean);
  const lines = rawLines.map(clean).filter(Boolean);
  const warnings = [...(options.warnings ?? [])];
  const shipServ = isShipServDocument(normalizedText);

  const poNumber = shipServ ? (valueAfterLabel(rawLines, /^PO Ref\s*:/i) || matchValue(compactText, [/\bReference\s*:\s*([A-Z0-9][A-Z0-9/._-]{3,})/i])) : matchValue(compactText, [
    /\b(?:purchase\s*order|po|order)\s*(?:no\.?|number|ref(?:erence)?)?\s*[:#-]\s*([A-Z0-9][A-Z0-9/._-]{3,})/i,
    /\b(PO[-\s]?\d{4,})\b/i,
  ]);
  const buyerName = shipServ ? shipServSectionName(rawLines, /^SHIPSERV BUYER RECORD$/i) : detectSplitHeaderParty(rawLines, "buyer") || matchValue(compactText, [
    /\b(?:buyer|customer|ship\s*owner|owner|account)\s*[:#-]\s*([^\n]{3,80})/i,
    /\b(?:for account of)\s*[:#-]?\s*([^\n]{3,80})/i,
  ]);
  const supplier = shipServ ? "Nautex" : detectSplitHeaderParty(rawLines, "supplier") || matchValue(compactText, [
    /\b(?:supplier|vendor|seller)\s*[:#-]\s*([^\n]{3,80})/i,
  ]);
  const rawVessel = shipServ ? valueAfterLabel(rawLines, /^Vessel\s*:/i) : matchValue(compactText, [
    /\b(?:vessel|ship|m\/v|mv|mt)\s*(?:name)?\s*[:#-]\s*([^\n]{2,60})/i,
  ]);
  const vesselImoFromName = rawVessel.match(/\((\d{7})\)/)?.[1] ?? "";
  const vessel = clean(rawVessel.replace(/\(\d{7}\)/, ""));
  const vesselImo = (shipServ ? valueAfterLabel(rawLines, /^IMO\s*#\s*:/i) : "") || matchValue(compactText, [
    /\bIMO\s*(?:no\.?|number)?\s*[:#-]?\s*(\d{7})\b/i,
  ]) || vesselImoFromName;
  const buyerCommentsPort = matchValue(compactText, [/\[Port\s*:\s*([^\]]{2,40})\]/i]);
  const port = normalizePort((shipServ ? usable(valueAfterLabel(rawLines, /^Port Name\s*:/i)) : "") || buyerCommentsPort || matchValue(compactText, [
    /\b(?:delivery\s*port|port|place\s*of\s*delivery|delivery\s*place)\s*[:#-]\s*([^\n]{3,60})/i,
  ]));
  const buyerRef = shipServ ? poNumber : matchValue(compactText, [
    /\b(?:buyer\s*ref(?:erence)?|customer\s*ref(?:erence)?|rfq|shipserv\s*(?:rfq|ref))\s*[:#-]\s*([A-Z0-9][A-Z0-9/._-]{2,})/i,
  ]);
  const eta = normalizeDate((shipServ ? (valueAfterLabel(rawLines, /^Vessel ETA\s*:/i) || valueAfterLabel(rawLines, /^Requested Delivery\s*:/i)) : "") || matchValue(compactText, [
    /\b(?:eta|delivery\s*date|required\s*date|requested\s*delivery|needed\s*by)\s*[:#-]\s*([A-Za-z0-9 ,./-]{6,30})/i,
  ]));
  const requestedDate = normalizeDate((shipServ ? valueAfterLabel(rawLines, /^Requested Delivery\s*:/i) : "") || matchValue(compactText, [
    /\b(?:order\s*date|request\s*date|po\s*date|date)\s*[:#-]\s*([A-Za-z0-9 ,./-]{6,30})/i,
  ]));

  const spreadsheetLines = parseSpreadsheetLines(rawLines);
  const shipServLines = shipServ ? parseShipServLines(rawLines) : [];
  const parsedLines = shipServLines.length > 0 ? shipServLines : spreadsheetLines.length > 0 ? spreadsheetLines : parseTextLines(rawLines);
  const missingLineNumbers = detectLineSequenceGaps(parsedLines);
  if (parsedLines.length === 0) {
    warnings.push("No structured line items were detected. Review the extracted text manually before creating an order.");
  }
  if (missingLineNumbers.length > 0) {
    warnings.push(`Line item sequence has gaps (${missingLineNumbers.join(", ")}). The PDF text layer may be incomplete; use OCR/visual review before creating the order.`);
  }
  if (!vessel) warnings.push("Vessel name was not confidently detected.");
  if (!supplier) warnings.push("Supplier was not confidently detected.");
  if (!eta) warnings.push("ETA or requested delivery date was not confidently detected.");

  const fieldScore = [
    poNumber,
    buyerName,
    supplier,
    vessel,
    vesselImo,
    port,
    eta,
    parsedLines.length > 0 ? "lines" : "",
  ].filter(Boolean).length;
  const baseConfidence = Math.max(20, Math.min(95, Math.round((fieldScore / 8) * 70 + Math.min(parsedLines.length, 8) * 3)));
  const confidence = missingLineNumbers.length > 0 ? Math.min(baseConfidence, 60) : baseConfidence;
  const sourceType = detectSourceType(options.fileName, options.sourceType);

  return {
    sourceFileName: options.fileName ?? null,
    sourceType,
    orderType: "BuyerPO",
    poNumber: poNumber || null,
    vessel: vessel || "",
    vesselImo: vesselImo || null,
    vesselOwner: buyerName || null,
    supplier: supplier || "Unassigned Supplier",
    buyerName: buyerName || null,
    buyerRef: buyerRef || poNumber || null,
    port: port || null,
    eta,
    requestedDate: requestedDate || null,
    currency: detectCurrency(compactText),
    marginPct: 0,
    priority: warnings.length > 2 ? "High" : "Normal",
    lines: parsedLines,
    confidence,
    warnings,
    extractionSummary: `Detected ${parsedLines.length} line item${parsedLines.length === 1 ? "" : "s"} from ${sourceType.toUpperCase()} purchase order content.`,
    rawTextPreview: clean(compactText).slice(0, 1200),
  };
}
