import type { StoredSourceDocument } from "@/lib/documents/source-types";

export type ProcurementDocumentRole =
  | "rfq"
  | "supplier_quote"
  | "purchase_order"
  | "supplier_confirmation"
  | "supplier_invoice"
  | "goods_receipt"
  | "customer_po"
  | "nautex_quote"
  | "sales_order"
  | "agreement";

export type ProcurementValidationType =
  | "supplier_quote_vs_rfq"
  | "supplier_quote_vs_purchase_order"
  | "supplier_confirmation_vs_purchase_order"
  | "supplier_invoice_vs_purchase_order"
  | "supplier_invoice_vs_goods_receipt"
  | "customer_po_vs_nautex_quote"
  | "agreement_price_vs_supplier_price"
  | "delivered_items_vs_ordered_items";

export type ValidationLineStatus =
  | "Matched"
  | "Partial Match"
  | "Description Mismatch"
  | "Quantity Variance"
  | "Unit Variance"
  | "Price Variance"
  | "Currency Mismatch"
  | "Missing Line"
  | "Extra Line"
  | "Missing Reference"
  | "Delivery Date Variance"
  | "Agreement Price Mismatch"
  | "Duplicate Risk"
  | "Needs Review"
  | "Approved"
  | "Rejected"
  | "Blocked";

export type ValidationReviewStatus = "Pending Review" | "Approved" | "Rejected" | "Blocked";
export type ValidationRiskLevel = "low" | "medium" | "high";
export type ValidationReadiness = "Ready for approval" | "Review required" | "Blocked";

export interface ValidationSourceDocument {
  role: ProcurementDocumentRole;
  documentType: string;
  fileName: string | null;
  mimeType?: string;
  size?: number | null;
  recordId?: string | null;
  recordLabel?: string | null;
  extractedChars: number;
  extractedText?: string;
  sourceDocument?: StoredSourceDocument;
  warnings: string[];
}

export interface NormalizedProcurementLine {
  id: string;
  sourceRole: ProcurementDocumentRole;
  lineNumber: number | null;
  sourceLineNumber?: string | null;
  itemReference: string | null;
  description: string;
  normalizedDescription: string;
  maker: string | null;
  makerPartNumber: string | null;
  impaCode: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  currency: string | null;
  vatRate: number | null;
  taxAmount: number | null;
  lineTotal: number | null;
  deliveryDate: string | null;
  leadTimeDays: number | null;
  supplierReference: string | null;
  customerReference: string | null;
  vesselName: string | null;
  poReference: string | null;
  rfqReference: string | null;
  agreementReference: string | null;
  raw: Record<string, unknown>;
}

export interface ValidationVariance {
  field: string;
  left: string | number | null;
  right: string | number | null;
  amount?: number;
}

export interface ProcurementValidationLineResult {
  id: string;
  status: ValidationLineStatus;
  statuses: ValidationLineStatus[];
  riskLevel: ValidationRiskLevel;
  reviewStatus: ValidationReviewStatus;
  confidence: number;
  matchReasons: string[];
  leftLine: NormalizedProcurementLine | null;
  rightLine: NormalizedProcurementLine | null;
  variances: ValidationVariance[];
  recommendedAction: string;
}

export interface ValidationExceptionDraft {
  severity: "Critical" | "Warning" | "Info";
  title: string;
  description: string;
  suggestedAction: string;
  sourceLineId: string;
  status: "Prepared";
}

export interface ProcurementValidationSummary {
  totalLinesCompared: number;
  matchedLines: number;
  partialMatches: number;
  discrepancies: number;
  highRiskDiscrepancies: number;
  missingLines: number;
  extraLines: number;
  totalValueVariance: number | null;
  currencies: string[];
  currencyVariance: boolean;
  readinessStatus: ValidationReadiness;
  recommendedNextAction: string;
}

export interface ProcurementValidationResult {
  validationType: ProcurementValidationType;
  documentStatus: ValidationLineStatus;
  reviewStatus: ValidationReviewStatus;
  sourceDocuments: ValidationSourceDocument[];
  normalizedLines: {
    left: NormalizedProcurementLine[];
    right: NormalizedProcurementLine[];
  };
  comparisonResults: ProcurementValidationLineResult[];
  summary: ProcurementValidationSummary;
  exceptionDrafts: ValidationExceptionDraft[];
  auditMetadata: {
    deterministic: boolean;
    aiAssisted: boolean;
    parserVersion: string;
    matchVersion: string;
    generatedAt: string;
  };
  discrepancyBreakdown: {
    added: number;
    removed: number;
    quantityChanges: number;
    priceChanges: number;
    compoundChanges: number;
  };
  keyInsights: {
    expandedScope: { impact: "HIGH" | "MEDIUM" | "LOW"; details: string[] };
    consistency: { impact: "HIGH" | "MEDIUM" | "LOW"; details: string[] };
    procurementObstacles: { impact: "HIGH" | "MEDIUM" | "LOW"; details: string[] };
  };
}

export interface ProcurementValidationInputDocument {
  role: ProcurementDocumentRole;
  text: string;
  fileName: string | null;
  mimeType?: string;
  size?: number | null;
  recordId?: string | null;
  recordLabel?: string | null;
  warnings?: string[];
}

export interface BuildValidationInput {
  validationType: ProcurementValidationType;
  leftDocument: ProcurementValidationInputDocument;
  rightDocument: ProcurementValidationInputDocument;
  agreementLines?: NormalizedProcurementLine[];
}

const PARSER_VERSION = "validator-parser-1";
const MATCH_VERSION = "validator-match-1";

const HEADER_ALIASES: Record<string, keyof NormalizedProcurementLine> = {
  line: "lineNumber",
  "line no": "lineNumber",
  "line number": "lineNumber",
  no: "lineNumber",
  item: "itemReference",
  "item code": "itemReference",
  code: "itemReference",
  ref: "itemReference",
  reference: "itemReference",
  "part no": "makerPartNumber",
  "part number": "makerPartNumber",
  "maker part": "makerPartNumber",
  "maker part no": "makerPartNumber",
  "manufacturer part no": "makerPartNumber",
  maker: "maker",
  manufacturer: "maker",
  impa: "impaCode",
  "impa code": "impaCode",
  description: "description",
  desc: "description",
  qty: "quantity",
  quantity: "quantity",
  unit: "unit",
  uom: "unit",
  "unit price": "unitPrice",
  price: "unitPrice",
  currency: "currency",
  curr: "currency",
  vat: "vatRate",
  tax: "taxAmount",
  total: "lineTotal",
  amount: "lineTotal",
  "line total": "lineTotal",
  delivery: "deliveryDate",
  "delivery date": "deliveryDate",
  "lead time": "leadTimeDays",
  "lead time days": "leadTimeDays",
  "supplier ref": "supplierReference",
  "customer ref": "customerReference",
  vessel: "vesselName",
  "vessel name": "vesselName",
  po: "poReference",
  "po ref": "poReference",
  rfq: "rfqReference",
  "rfq ref": "rfqReference",
  agreement: "agreementReference",
  "agreement ref": "agreementReference",
};

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeKey(value: string) {
  return clean(value).toLowerCase().replace(/[_-]+/g, " ");
}

function normalizeDescription(value: string) {
  return clean(value)
    .toLowerCase()
    .replace(/\b(maker|manufacturer|comment|remarks?)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeReference(value: unknown) {
  const text = clean(value).toUpperCase();
  return text || null;
}

function parseNumber(value: unknown) {
  const text = clean(value);
  if (!text) return null;
  const normalized = text.replace(/[^\d,.-]/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCsvRow(row: string) {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < row.length; i += 1) {
    const char = row[i];
    const next = row[i + 1];
    if (char === '"' && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function splitTableRow(row: string) {
  if (row.includes(",")) return parseCsvRow(row);
  if (row.includes("\t")) return row.split("\t").map(clean);
  return row.split(/\s{2,}/).map(clean);
}

function mapHeaders(cells: string[]) {
  return cells.map((cell) => HEADER_ALIASES[normalizeKey(cell)] ?? null);
}

function hasUsefulHeaders(cells: string[]) {
  const mapped = mapHeaders(cells);
  return mapped.includes("description") && (mapped.includes("quantity") || mapped.includes("unitPrice") || mapped.includes("lineTotal"));
}

function createLine(role: ProcurementDocumentRole, index: number, raw: Record<string, unknown>): NormalizedProcurementLine | null {
  const description = clean(raw.description);
  const itemReference = normalizeReference(raw.itemReference);
  const makerPartNumber = normalizeReference(raw.makerPartNumber);
  const impaCode = normalizeReference(raw.impaCode);
  const quantity = parseNumber(raw.quantity);
  const unitPrice = parseNumber(raw.unitPrice);
  const lineTotal = parseNumber(raw.lineTotal) ?? (quantity !== null && unitPrice !== null ? quantity * unitPrice : null);

  if (!description && !itemReference && !makerPartNumber && !impaCode && role !== "rfq") return null;

  const lineNumber = parseNumber(raw.lineNumber);
  return {
    id: `${role}-${lineNumber ?? index + 1}-${itemReference ?? makerPartNumber ?? impaCode ?? index}`,
    sourceRole: role,
    lineNumber,
    sourceLineNumber: clean(raw.lineNumber) || null,
    itemReference,
    description: description || itemReference || makerPartNumber || impaCode || "Unlabelled line",
    normalizedDescription: normalizeDescription(description || itemReference || makerPartNumber || impaCode || ""),
    maker: clean(raw.maker) || null,
    makerPartNumber,
    impaCode,
    quantity,
    unit: normalizeReference(raw.unit),
    unitPrice,
    currency: normalizeReference(raw.currency),
    vatRate: parseNumber(raw.vatRate),
    taxAmount: parseNumber(raw.taxAmount),
    lineTotal,
    deliveryDate: clean(raw.deliveryDate) || null,
    leadTimeDays: parseNumber(raw.leadTimeDays),
    supplierReference: normalizeReference(raw.supplierReference),
    customerReference: normalizeReference(raw.customerReference),
    vesselName: clean(raw.vesselName) || null,
    poReference: normalizeReference(raw.poReference),
    rfqReference: normalizeReference(raw.rfqReference),
    agreementReference: normalizeReference(raw.agreementReference),
    raw,
  };
}

export function parseHeaderTable(text: string, role: ProcurementDocumentRole) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const parsed: NormalizedProcurementLine[] = [];
  let headers: Array<keyof NormalizedProcurementLine | null> | null = null;

  for (const line of lines) {
    if (line.startsWith("# Sheet:")) {
      headers = null;
      continue;
    }

    const cells = splitTableRow(line);
    if (cells.length < 2) continue;

    if (hasUsefulHeaders(cells)) {
      headers = mapHeaders(cells);
      continue;
    }

    if (!headers) continue;

    const raw: Record<string, unknown> = {};
    cells.forEach((cell, cellIndex) => {
      const key = headers?.[cellIndex];
      if (key) raw[key] = cell;
    });

    const normalized = createLine(role, parsed.length, raw);
    if (normalized) parsed.push(normalized);
  }

  return parsed;
}

function parseFallbackRows(text: string, role: ProcurementDocumentRole) {
  const rows: NormalizedProcurementLine[] = [];
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);

  for (const line of lines) {
    const match = line.match(/^(\d{1,4})\s+(?:(IMPA\s*)?(\d{5,6}|[A-Z0-9][A-Z0-9./-]{2,})\s+)?(.+?)\s+([A-Z]{1,6})\s+(\d+(?:[.,]\d+)?)\s+([A-Z]{3})?\s*([\d,]+(?:\.\d{2})?)(?:\s+([\d,]+(?:\.\d{2})?))?$/i);
    if (!match) continue;
    const maybeCode = match[3] ?? "";
    const raw: Record<string, unknown> = {
      lineNumber: match[1],
      itemReference: maybeCode && !/^\d{5,6}$/.test(maybeCode) ? maybeCode : "",
      impaCode: /^\d{5,6}$/.test(maybeCode) ? maybeCode : "",
      description: match[4],
      unit: match[5],
      quantity: match[6],
      currency: match[7],
      unitPrice: match[8],
      lineTotal: match[9],
    };
    const normalized = createLine(role, rows.length, raw);
    if (normalized) rows.push(normalized);
  }

  return rows;
}

function startsShipServLine(line: string) {
  return /^\s*\d{1,4}\s+(?:\t\s*)?[A-Z]{2,4}\b/.test(line);
}

function hasShipServNumericTail(line: string) {
  return /\b[A-Z]{1,6}\s+\d+(?:[.,]\d+)?\s+[\d,]+(?:\.\d+)?\s+[\d,]+(?:\.\d+)?\s+[\d,]+(?:\.\d+)?\s*$/.test(line.replace(/\t/g, " "));
}

function splitShipServReference(value: string) {
  const parts = value.trim().split(/\s+/);
  const first = parts[0] ?? "";
  const looksLikeReference = /[0-9]/.test(first) && /^[A-Z0-9./-]{3,}$/i.test(first);
  if (!looksLikeReference) return { itemReference: "", description: value.trim() };
  return { itemReference: first, description: parts.slice(1).join(" ").trim() };
}

function extractLikelyMakerPart(description: string) {
  const hyphenatedMatch = description.match(/\b\d{3,}-\d+\b/);
  if (hyphenatedMatch?.[0]) return hyphenatedMatch[0];
  const makerMatch = description.match(/\b(?:MAKER|BROTHER|3M)\)?\s+([A-Z0-9][A-Z0-9./-]*\d[A-Z0-9./-]*)\b/i);
  if (makerMatch?.[1]) return makerMatch[1];
  const explicitMatch = description.match(/\b(?:TZE|HG|SJ)[A-Z0-9./-]*\d[A-Z0-9./-]*\b/i);
  if (explicitMatch?.[0]) return explicitMatch[0];
  return "";
}

function parseShipServRows(text: string, role: ProcurementDocumentRole) {
  const rows: NormalizedProcurementLine[] = [];
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!startsShipServLine(line)) continue;

    let candidate = line;
    while (!hasShipServNumericTail(candidate) && index + 1 < lines.length && !startsShipServLine(lines[index + 1])) {
      index += 1;
      candidate = `${candidate} ${lines[index]}`.trim();
    }

    const normalized = candidate.replace(/\t/g, " ").replace(/\s+/g, " ").trim();
    const match = normalized.match(/^(\d{1,4})\s+([A-Z]{2,4})\s+(.+?)\s+([A-Z]{1,6})\s+(\d+(?:[.,]\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)$/);
    if (!match) continue;

    const { itemReference, description } = splitShipServReference(match[3]);
    const raw: Record<string, unknown> = {
      lineNumber: match[1],
      sourceCode: match[2],
      itemReference,
      description,
      makerPartNumber: extractLikelyMakerPart(description),
      unit: match[4],
      quantity: match[5],
      unitPrice: match[6],
      discountPercent: match[7],
      lineTotal: match[8],
      currency: null,
    };

    const normalizedLine = createLine(role, rows.length, raw);
    if (normalizedLine) rows.push(normalizedLine);
  }

  return rows;
}

export function parseProcurementLines(text: string, role: ProcurementDocumentRole) {
  const headerRows = parseHeaderTable(text, role);
  if (headerRows.length > 0) return headerRows;
  const shipServRows = parseShipServRows(text, role);
  if (shipServRows.length > 0) return shipServRows;
  return parseFallbackRows(text, role);
}

function tokenSet(value: string) {
  return new Set(normalizeDescription(value).split(" ").filter((part) => part.length > 2));
}

function descriptionSimilarity(a: string, b: string) {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  left.forEach((token) => {
    if (right.has(token)) shared += 1;
  });
  return shared / Math.max(left.size, right.size);
}

function compactReference(value: string | null) {
  return (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function referenceMatches(left: string | null, right: string | null) {
  const a = compactReference(left);
  const b = compactReference(right);
  if (!a || !b) return false;
  return a === b || (a.length >= 5 && b.endsWith(a)) || (b.length >= 5 && a.endsWith(b));
}

function sameNumber(a: number | null, b: number | null, tolerance = 0) {
  if (a === null || b === null) return false;
  return Math.abs(a - b) <= tolerance;
}

function scoreCandidate(left: NormalizedProcurementLine, right: NormalizedProcurementLine) {
  let score = 0;
  const reasons: string[] = [];

  if (left.lineNumber !== null && left.lineNumber === right.lineNumber) {
    score += 0.2;
    reasons.push("line number");
  }
  if (left.itemReference && right.itemReference && left.itemReference === right.itemReference) {
    score += 0.3;
    reasons.push("item reference");
  } else if (referenceMatches(left.itemReference, right.itemReference)) {
    score += 0.25;
    reasons.push("item reference suffix");
  }
  if (left.makerPartNumber && right.makerPartNumber && left.makerPartNumber === right.makerPartNumber) {
    score += 0.3;
    reasons.push("maker part number");
  } else if (referenceMatches(left.makerPartNumber, right.makerPartNumber) || referenceMatches(left.makerPartNumber, right.itemReference) || referenceMatches(left.itemReference, right.makerPartNumber)) {
    score += 0.25;
    reasons.push("maker/reference match");
  }
  if (left.impaCode && right.impaCode && left.impaCode === right.impaCode) {
    score += 0.35;
    reasons.push("IMPA code");
  }
  const descriptionScore = descriptionSimilarity(left.normalizedDescription, right.normalizedDescription);
  if (descriptionScore >= 0.45) {
    score += Math.min(0.25, descriptionScore * 0.25);
    reasons.push("description similarity");
  }
  if (left.quantity !== null && right.quantity !== null && left.quantity === right.quantity) {
    score += 0.05;
    reasons.push("quantity");
  }

  return { score: Math.min(1, score), reasons };
}

function pickBestMatch(left: NormalizedProcurementLine, candidates: NormalizedProcurementLine[], used: Set<string>) {
  let best: { line: NormalizedProcurementLine; score: number; reasons: string[] } | null = null;
  for (const right of candidates) {
    if (used.has(right.id)) continue;
    const scored = scoreCandidate(left, right);
    if (!best || scored.score > best.score) best = { line: right, score: scored.score, reasons: scored.reasons };
  }
  return best && best.score >= 0.35 ? best : null;
}

function addVariance(variances: ValidationVariance[], field: string, left: string | number | null, right: string | number | null, amount?: number) {
  if (left === right) return;
  variances.push({ field, left, right, ...(amount !== undefined ? { amount } : {}) });
}

function classifyMatch(left: NormalizedProcurementLine, right: NormalizedProcurementLine, confidence: number, reasons: string[], requirePrices: boolean) {
  const statuses: ValidationLineStatus[] = [];
  const variances: ValidationVariance[] = [];

  const requiredFields: Array<"quantity" | "unit" | "currency" | "unitPrice"> = ["quantity", "unit", "currency"];
  if (requirePrices) requiredFields.push("unitPrice");
  for (const field of requiredFields) {
    if (left[field] === null || right[field] === null) {
      if (!statuses.includes("Needs Review")) statuses.push("Needs Review");
      variances.push({field:`${field} (missing evidence)`,left:left[field],right:right[field]});
    }
  }

  if (left.description && right.description && descriptionSimilarity(left.description, right.description) < 0.45) {
    statuses.push("Description Mismatch");
    addVariance(variances, "description", left.description, right.description);
  }
  if (left.quantity !== null && right.quantity !== null && left.quantity !== right.quantity) {
    statuses.push("Quantity Variance");
    addVariance(variances, "quantity", left.quantity, right.quantity, right.quantity - left.quantity);
  }
  if (left.unit && right.unit && left.unit !== right.unit) {
    statuses.push("Unit Variance");
    addVariance(variances, "unit", left.unit, right.unit);
  }
  if (left.unitPrice !== null && right.unitPrice !== null && !sameNumber(left.unitPrice, right.unitPrice, 0.01)) {
    statuses.push("Price Variance");
    addVariance(variances, "unitPrice", left.unitPrice, right.unitPrice,
      left.currency && left.currency === right.currency && left.unit === right.unit ? right.unitPrice - left.unitPrice : undefined);
  }
  if (left.currency && right.currency && left.currency !== right.currency) {
    statuses.push("Currency Mismatch");
    addVariance(variances, "currency", left.currency, right.currency);
  }
  if (left.deliveryDate && right.deliveryDate && left.deliveryDate !== right.deliveryDate) {
    statuses.push("Delivery Date Variance");
    addVariance(variances, "deliveryDate", left.deliveryDate, right.deliveryDate);
  }
  const missingReference = (!left.itemReference && !left.makerPartNumber && !left.impaCode) || (!right.itemReference && !right.makerPartNumber && !right.impaCode);
  if (missingReference) statuses.push("Missing Reference");

  const primaryStatuses = statuses.filter((item) => item !== "Missing Reference");
  const status: ValidationLineStatus =
    primaryStatuses.length > 0
      ? primaryStatuses[0]
      : statuses.includes("Missing Reference")
        ? (confidence >= 0.55 ? "Partial Match" : "Missing Reference")
        : (confidence >= 0.6 ? "Matched" : "Partial Match");
  if (primaryStatuses.length === 0 && status === "Partial Match" && !statuses.includes("Partial Match")) statuses.unshift("Partial Match");
  if (statuses.length === 0) statuses.push("Matched");

  const highRisk = statuses.some((item) => ["Price Variance", "Currency Mismatch", "Missing Line", "Extra Line", "Agreement Price Mismatch"].includes(item));
  const riskLevel: ValidationRiskLevel = highRisk ? "high" : statuses[0] === "Matched" ? "low" : "medium";
  return {
    status,
    statuses,
    variances,
    riskLevel,
    reviewStatus: "Pending Review" as const,
    recommendedAction: statuses[0] === "Matched" ? "Review source evidence before approving the comparison." : "Review discrepancy before approval or downstream action.",
    matchReasons: reasons.length ? reasons : ["best available deterministic match"],
  };
}

function duplicateStatuses(results: ProcurementValidationLineResult[]) {
  const seen = new Map<string, ProcurementValidationLineResult[]>();
  for (const result of results) {
    const line = result.leftLine ?? result.rightLine;
    const key = line?.itemReference ?? line?.makerPartNumber ?? line?.impaCode ?? line?.normalizedDescription;
    if (!key) continue;
    const group = seen.get(key) ?? [];
    group.push(result);
    seen.set(key, group);
  }
  seen.forEach((group) => {
    if (group.length < 2) return;
    group.forEach((result) => {
      if (!result.statuses.includes("Duplicate Risk")) result.statuses.push("Duplicate Risk");
      if (result.status === "Matched") result.status = "Duplicate Risk";
      if (result.riskLevel === "low") result.riskLevel = "medium";
      result.reviewStatus = "Pending Review";
    });
  });
}

function buildResults(leftLines: NormalizedProcurementLine[], rightLines: NormalizedProcurementLine[], requirePrices: boolean) {
  const usedRight = new Set<string>();
  const results: ProcurementValidationLineResult[] = [];

  leftLines.forEach((left, index) => {
    const best = pickBestMatch(left, rightLines, usedRight);
    if (!best) {
      results.push({
        id: `missing-${left.id}`,
        status: "Missing Line",
        statuses: ["Missing Line"],
        riskLevel: "high",
        reviewStatus: "Pending Review",
        confidence: 0,
        matchReasons: ["no corresponding line found"],
        leftLine: left,
        rightLine: null,
        variances: [],
        recommendedAction: "Confirm whether this line should exist in the comparison document.",
      });
      return;
    }

    usedRight.add(best.line.id);
    const classified = classifyMatch(left, best.line, best.score, best.reasons, requirePrices);
    results.push({
      id: `match-${index}-${left.id}-${best.line.id}`,
      confidence: Math.round(best.score * 100) / 100,
      leftLine: left,
      rightLine: best.line,
      ...classified,
    });
  });

  rightLines.forEach((right) => {
    if (usedRight.has(right.id)) return;
    results.push({
      id: `extra-${right.id}`,
      status: "Extra Line",
      statuses: ["Extra Line"],
      riskLevel: "high",
      reviewStatus: "Pending Review",
      confidence: 0,
      matchReasons: ["line exists only in comparison document"],
      leftLine: null,
      rightLine: right,
      variances: [],
      recommendedAction: "Review whether this additional line is valid before approval.",
    });
  });

  duplicateStatuses(results);
  return results;
}

function buildExceptionDrafts(results: ProcurementValidationLineResult[]) {
  return results
    .filter((result) => result.riskLevel === "high" || result.reviewStatus === "Pending Review")
    .map((result) => {
      const label = result.rightLine?.description ?? result.leftLine?.description ?? "Validation line";
      const status = result.statuses.join(", ");
      const severity = result.riskLevel === "high" ? "Critical" as const : "Warning" as const;
      return {
        severity,
        title: `${result.status}: ${label}`,
        description: `Validator detected ${status} using deterministic comparison rules. Review the preserved source values.`,
        suggestedAction: result.recommendedAction,
        sourceLineId: result.id,
        status: "Prepared" as const,
      };
    });
}

function buildSummary(results: ProcurementValidationLineResult[]) {
  const currencies = new Set<string>();
  let totalValueVariance = 0;
  let completeValueEvidence = results.length > 0;
  let matchedLines = 0;
  let partialMatches = 0;
  let discrepancies = 0;
  let highRiskDiscrepancies = 0;
  let missingLines = 0;
  let extraLines = 0;
  let currencyVariance = false;

  results.forEach((result) => {
    if (result.leftLine?.currency) currencies.add(result.leftLine.currency);
    if (result.rightLine?.currency) currencies.add(result.rightLine.currency);
    if (result.status === "Matched") matchedLines += 1;
    if (result.status === "Partial Match") partialMatches += 1;
    if (result.status !== "Matched") discrepancies += 1;
    if (result.riskLevel === "high") highRiskDiscrepancies += 1;
    if (result.statuses.includes("Missing Line")) missingLines += 1;
    if (result.statuses.includes("Extra Line")) extraLines += 1;
    if (result.statuses.includes("Currency Mismatch")) currencyVariance = true;
    const left = result.leftLine;
    const right = result.rightLine;
    if (left?.lineTotal != null && right?.lineTotal != null && left.currency && left.currency === right.currency) {
      totalValueVariance += Math.round(right.lineTotal * 100) - Math.round(left.lineTotal * 100);
    } else completeValueEvidence = false;
  });

  const readinessStatus: ValidationReadiness = highRiskDiscrepancies > 0 ? "Blocked" : discrepancies > 0 ? "Review required" : "Ready for approval";
  const recommendedNextAction =
    readinessStatus === "Ready for approval"
      ? "Approve validation conclusions if the source documents are correct."
      : readinessStatus === "Blocked"
        ? "Resolve high-risk discrepancies before finance, PO correction, or supplier/customer communication."
        : "Review pending discrepancies and approve or reject the validation conclusions.";

  return {
    totalLinesCompared: results.length,
    matchedLines,
    partialMatches,
    discrepancies,
    highRiskDiscrepancies,
    missingLines,
    extraLines,
    totalValueVariance: completeValueEvidence && currencies.size === 1 ? totalValueVariance / 100 : null,
    currencies: Array.from(currencies),
    currencyVariance,
    readinessStatus,
    recommendedNextAction,
  };
}

function buildLegacyBreakdown(results: ProcurementValidationLineResult[]) {
  let added = 0;
  let removed = 0;
  let quantityChanges = 0;
  let priceChanges = 0;
  let compoundChanges = 0;

  results.forEach((result) => {
    const qty = result.statuses.includes("Quantity Variance");
    const price = result.statuses.includes("Price Variance") || result.statuses.includes("Agreement Price Mismatch");
    if (result.statuses.includes("Extra Line")) added += 1;
    if (result.statuses.includes("Missing Line")) removed += 1;
    if (qty && price) compoundChanges += 1;
    else if (qty) quantityChanges += 1;
    else if (price) priceChanges += 1;
  });

  return { added, removed, quantityChanges, priceChanges, compoundChanges };
}

function buildInsights(summary: ProcurementValidationSummary) {
  return {
    expandedScope: {
      impact: summary.extraLines > 0 || summary.missingLines > 0 ? "HIGH" as const : "LOW" as const,
      details: [`Compared ${summary.totalLinesCompared} normalized line(s); ${summary.extraLines} extra and ${summary.missingLines} missing line(s) require review.`],
    },
    consistency: {
      impact: summary.discrepancies > 0 ? "MEDIUM" as const : "LOW" as const,
      details: [`${summary.matchedLines} line(s) matched and ${summary.discrepancies} discrepancy line(s) were detected deterministically.`],
    },
    procurementObstacles: {
      impact: summary.highRiskDiscrepancies > 0 ? "HIGH" as const : summary.discrepancies > 0 ? "MEDIUM" as const : "LOW" as const,
      details: [summary.recommendedNextAction],
    },
  };
}

function documentStatusFromSummary(summary: ProcurementValidationSummary): ValidationLineStatus {
  if (summary.readinessStatus === "Ready for approval") return "Matched";
  if (summary.readinessStatus === "Blocked") return "Blocked";
  return "Needs Review";
}

function documentType(role: ProcurementDocumentRole) {
  return role.split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}

export function buildProcurementValidation(input: BuildValidationInput): ProcurementValidationResult {
  const leftLines = parseProcurementLines(input.leftDocument.text, input.leftDocument.role);
  const rightLines = parseProcurementLines(input.rightDocument.text, input.rightDocument.role);
  const comparisonResults = buildResults(leftLines, rightLines, input.validationType === "supplier_quote_vs_purchase_order");
  const summary = buildSummary(comparisonResults);
  const exceptionDrafts = buildExceptionDrafts(comparisonResults);
  const discrepancyBreakdown = buildLegacyBreakdown(comparisonResults);
  const sourceDocuments: ValidationSourceDocument[] = [input.leftDocument, input.rightDocument].map((doc) => ({
    role: doc.role,
    documentType: documentType(doc.role),
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    size: doc.size ?? null,
    recordId: doc.recordId ?? null,
    recordLabel: doc.recordLabel ?? null,
    extractedChars: doc.text.length,
    extractedText: doc.text,
    warnings: doc.warnings ?? [],
  }));

  return {
    validationType: input.validationType,
    documentStatus: documentStatusFromSummary(summary),
    reviewStatus: "Pending Review",
    sourceDocuments,
    normalizedLines: { left: leftLines, right: rightLines },
    comparisonResults,
    summary,
    exceptionDrafts,
    auditMetadata: {
      deterministic: true,
      aiAssisted: false,
      parserVersion: PARSER_VERSION,
      matchVersion: MATCH_VERSION,
      generatedAt: new Date().toISOString(),
    },
    discrepancyBreakdown,
    keyInsights: buildInsights(summary),
  };
}
