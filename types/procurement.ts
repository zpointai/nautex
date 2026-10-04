// Types for Wrist AI-integrated procurement modules

// ── Price Calculator ────────────────────────────────────────────
export interface PriceCalculation {
  basePrice: number;
  markupPct: number;
  markupAmount: number;
  totalPrice: number;
  currency: string;
}

export type PricingMode = "markup" | "targetMargin";

export type ShippingSpreadMode = "quantity" | "value" | "weight" | "equal";

export interface OperationalPriceInput {
  supplierUnitCost: number;
  quantity: number;
  supplierDiscountPct: number;
  freightTotal: number;
  courierCost: number;
  insurancePct: number;
  customsDutyPct: number;
  bondedHandling: number;
  warehouseHandling: number;
  packaging: number;
  portDeliverySurcharge: number;
  otherFees: number;
  vatPct: number;
  currencyAdjustmentPct: number;
  pricingMode: PricingMode;
  markupPct: number;
  targetMarginPct: number;
  supplierCurrency: string;
  customerCurrency: string;
}

export interface OperationalPriceResult {
  goodsGross: number;
  supplierDiscountAmount: number;
  goodsAfterDiscount: number;
  freightAndDelivery: number;
  insuranceCost: number;
  customsDuty: number;
  handlingAndFees: number;
  currencyAdjustment: number;
  vatAmount: number;
  landedUnitCost: number;
  landedTotalCost: number;
  sellUnitPrice: number;
  sellTotalPrice: number;
  grandTotalPrice: number;
  grossProfit: number;
  grossMarginPct: number;
  markupPct: number;
  effectiveMarkupPct: number;
  targetMarginPct: number;
  warnings: string[];
}

export interface PricingScenarioInput {
  id: string;
  label: string;
  markupPct: number;
  targetMarginPct: number;
  pricingMode: PricingMode;
}

export interface PricingScenarioResult extends PricingScenarioInput {
  sellUnitPrice: number;
  sellTotalPrice: number;
  grossProfit: number;
  grossMarginPct: number;
  effectiveMarkupPct: number;
}

export interface ShippingSpreadLineInput {
  id: string;
  label: string;
  quantity: number;
  unitCost: number;
  weight: number;
}

export interface ShippingSpreadLineResult extends ShippingSpreadLineInput {
  basis: number;
  allocatedCost: number;
  allocatedUnitCost: number;
  landedUnitCost: number;
  landedLineCost: number;
}

// ── HS Code Finder ──────────────────────────────────────────────
export interface HSCodeClassification {
  id: string;
  code: string;
  confidence: number;
  confidenceLevel: string;
  description: string;
  rationale: string;
  logic: string;
}

export interface HSCodeResult {
  id: string;
  query: string;
  eu: HSCodeClassification;
  us: HSCodeClassification;
}

export interface HSVerificationResult {
  id: string;
  query: { code: string; description: string };
  isValid: boolean;
  assessment: string;
  providedCodeDescription: string;
  suggestedCode: string | null;
  suggestedCodeDescription: string | null;
}

export type HSClassificationType = "text" | "verify" | "image" | "bulk";

// ── IMPA Search ─────────────────────────────────────────────────
export interface IMPAProduct {
  id: string;
  impaCode: string;
  itemName: string;
  specifications: string;
  category: string;
  isFavorite: boolean;
  unit?: string | null;
  hsCode?: string | null;
  countryOrigin?: string | null;
  normalizedDescription?: string | null;
  source?: string | null;
  edition?: string | null;
  matchScore?: number;
  matchQuality?: "high" | "medium" | "low";
  matchReasons?: string[];
}

export interface IMPASectionSummary {
  name: string;
  section: string;
  count: number;
}

export interface IMPACatalogueSummary {
  total: number;
  sections: IMPASectionSummary[];
  favorites: number;
  visualized: number;
  needsVisual: number;
  latestImport: {
    id: string;
    fileName: string | null;
    status: string;
    rowCount: number;
    importedCount: number;
    skippedCount: number;
    errorCount: number;
    createdAt: string;
  } | null;
}

export interface IMPACataloguePage {
  items: IMPAProduct[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface IMPAContextInventory {
  id: string;
  itemCode: string | null;
  description: string;
  warehouse: string;
  locationBin: string | null;
  uom: string;
  onHand: number;
  reserved: number;
  available: number;
  stockStatus: "critical" | "reorder" | "healthy";
}

export interface IMPAContextAgreement {
  id: string;
  supplierName: string;
  status: string;
  itemNumber: string | null;
  description: string;
  unit: string | null;
  unitPrice: number;
  currency: string;
  leadTimeDays: number | null;
}

export interface IMPAContextPurchase {
  id: string;
  purchaseOrderId: string;
  poNumber: string;
  supplierName: string;
  vessel: string;
  port: string | null;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  currency: string;
  lastPurchaseDate: string;
}

export interface IMPAContextRfq {
  id: string;
  rfqId: string;
  vessel: string;
  port: string;
  status: string;
  description: string;
  quantity: number;
  unit: string;
  quotedSupplier: string | null;
  quotedPrice: number | null;
  currency: string | null;
  createdAt: string;
}

export interface IMPAItemDetail {
  item: IMPAProduct;
  context: {
    inventory: IMPAContextInventory[];
    agreements: IMPAContextAgreement[];
    purchaseHistory: IMPAContextPurchase[];
    rfqHistory: IMPAContextRfq[];
    supplierNames: string[];
  };
}

export const IMPA_SECTION_NAMES: Record<string, string> = {
  "15": "Cloth & Linen",
  "17": "Tableware & Galley",
  "19": "Clothing",
  "21": "Rope & Hawsers",
  "23": "Rigging Equipment",
  "25": "Marine Paint",
  "27": "Painting Equipment",
  "31": "Safety Protective",
  "33": "Safety Equipment",
  "35": "Hose & Couplings",
  "37": "Nautical Equipment",
  "41": "Measuring Tools",
  "45": "Petroleum Products",
  "47": "Stationery",
  "49": "Hardware",
  "51": "Brushware",
  "53": "Brushware",
  "55": "Cleaning Products",
  "59": "Pneumatic Tools",
  "61": "Electrical Tools",
  "63": "Hand Tools",
  "65": "Measuring Tools",
  "67": "Metal Sheets & Bars",
  "69": "Screws & Nuts",
  "71": "Pipes & Tubes",
  "73": "Valves & Cocks",
  "75": "Bearings",
  "77": "Electrical Equipment",
  "79": "Packing & Jointing",
  "81": "Welfare Items",
};

export function inferIMPACategory(code: string): string {
  if (!code || code.length < 2) return "General Stores";
  const prefix = code.substring(0, 2);
  const name = IMPA_SECTION_NAMES[prefix];
  return name ? `${prefix} - ${name}` : "General Stores";
}

// ── Procurement Validator ───────────────────────────────────────
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

export interface ValidationSourceDocument {
  extractedText?: string;
  sourceDocument?: import("@/lib/documents/source-types").StoredSourceDocument;
  role: ProcurementDocumentRole;
  documentType: string;
  fileName: string | null;
  mimeType?: string;
  size?: number | null;
  recordId?: string | null;
  recordLabel?: string | null;
  extractedChars: number;
  warnings: string[];
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
  variances: Array<{ field: string; left: string | number | null; right: string | number | null; amount?: number }>;
  recommendedAction: string;
}

export interface ValidationExceptionDraft {
  severity: "Critical" | "Warning" | "Info";
  title: string;
  description: string;
  suggestedAction: string;
  sourceLineId: string;
  status: "Prepared" | "Created";
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

export interface ProcurementValidationResults {
  validationRunId?: string;
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
  _ai?: { enabled: boolean };
  _stub?: boolean;
  _localFallback?: boolean;
  message?: string;
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

// ── RFQ Automation ──────────────────────────────────────────────
export interface RFQLineItem {
  currency?: string;
  itemNumber: string;
  quantity: number;
  specifications: string;
  unit: string;
}

export interface RFQSupplierOption {
  rank: number;
  supplierId: string;
  supplierName: string;
  price: number;
  currency: string;
  stockStatus: string;
  leadTimeDays: number;
  moqCompliant: boolean;
  minimumOrderQuantity?: number;
  reasoning: string;
  flags: string[];
  supplierArticleNumber: string;
  impaCode: string;
  matchConfidence?: string;
  matchMethod?: string;
  matchRunId?: string;
  matchCandidateId?: string;
}

export interface RFQProcessedLine {
  originalItem: RFQLineItem;
  supplierOptions?: RFQSupplierOption[];
  hasMultipleOptions: boolean;
  noMatchFound: boolean;
  notes: string;
  flags?: string[];
  matchConfidence: string;
  matchMethod: string;
}

export interface RFQResult {
  review?: import("@/lib/rfq/review").RfqReview | null;
  updatedAt?: string;
  ok: boolean;
  summary: string;
  rfqId?: string;
  matchRunId?: string | null;
  matchRunIds?: string[];
  agentRunId?: string;
  persisted?: boolean;
  lines: RFQProcessedLine[];
  audit: {
    invocationId: string;
    timestamp: string;
    modelUsed: string;
    executionTimeMs: number;
  };
}

// ── Procurement Search / Catalog ────────────────────────────────
export interface CatalogItem {
  id: string;
  itemNumber: string;
  description: string;
  supplierName: string;
  hsCode: string;
  countryOfOrigin: string;
  vessel: string;
  unitPrice?: number;
  currency?: string;
  lastPurchaseDate?: string;
}

export type ItemSearchSource =
  | "catalog"
  | "inventory"
  | "agreement"
  | "customer_contract"
  | "purchase_history"
  | "rfq_history"
  | "supplier_quote"
  | "purchase_order";

export type ItemSearchSort = "relevance" | "last_purchase" | "price_asc" | "price_desc";

export interface ItemSearchResult {
  id: string;
  source: ItemSearchSource;
  sourceLabel: string;
  itemNumber: string;
  description: string;
  category: string | null;
  supplierName: string | null;
  supplierId: string | null;
  manufacturer: string | null;
  makerNumber: string | null;
  impaCode: string | null;
  hsCode: string | null;
  countryOfOrigin: string | null;
  customerReference: string | null;
  supplierReference: string | null;
  vessel: string | null;
  port: string | null;
  unit: string | null;
  quantity: number | null;
  unitPrice: number | null;
  currency: string | null;
  leadTimeDays: number | null;
  stockOnHand: number | null;
  stockAvailable: number | null;
  warehouse: string | null;
  agreementStatus: string | null;
  agreementValidTo: string | null;
  poNumber: string | null;
  rfqId: string | null;
  lastPurchaseDate: string | null;
  matchScore: number;
  matchQuality: "high" | "medium" | "low";
  matchReasons: string[];
  links: {
    itemId?: string;
    inventoryItemId?: string;
    agreementVersionId?: string;
    customerContractId?: string;
    purchaseOrderId?: string;
    purchaseOrderLineId?: string;
    rfqId?: string;
    rfqLineId?: string;
    supplierQuoteId?: string;
  };
}

export interface ItemSearchSummary {
  totalCandidates: number;
  totalReturned: number;
  page: number;
  pageSize: number;
  sourceCounts: Record<ItemSearchSource, number>;
  topMatchQuality: ItemSearchResult["matchQuality"] | null;
  hasAgreementCoverage: boolean;
  hasInventoryCoverage: boolean;
  hasPurchaseHistory: boolean;
  hasRfqHistory: boolean;
  bestLastPrice: {
    supplierName: string | null;
    unitPrice: number;
    currency: string;
    poNumber: string | null;
    lastPurchaseDate: string | null;
  } | null;
}

export interface ItemSearchHistoryRow {
  id: string;
  query: string;
  resultCount: number;
  createdAt: string;
}

export interface ItemSearchPriorPurchase {
  id: string;
  itemNumber: string;
  description: string;
  supplierName: string;
  vessel: string;
  quantity: number;
  unit: string;
  unitPrice: number | null;
  currency: string | null;
  lastPurchaseDate: string;
  poNumber: string;
}
