export type Priority = "High" | "Normal" | "Low";
export type OrderStatus = "Pending_Approval" | "Procurement" | "In_Transit" | "Delivered" | "At_Risk";
export type ConfirmStatus = "Unconfirmed" | "Partially_Confirmed" | "Confirmed" | "Rejected";
export type LineStatus = "Open" | "Confirmed" | "Partially_Delivered" | "Delivered" | "Backordered" | "Cancelled";
export type OrderType = "BuyerPO" | "SubPO" | "DirectPO";
export type ShipServLifecycle = "RFQ_Received" | "Quote_Sent" | "PO_Received" | "Order_Confirmed" | "Invoiced" | "Closed";

export interface RFQ {
  id: string;
  vessel: string;
  port: string;
  neededBy: string;
  items: number;
  status: "Draft" | "Sent" | "Quoted" | "Awarded";
  assignedToId?: string | null;
  assignedTo?: { id: string; name: string; email: string } | null;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  orderType: OrderType;
  vessel: string;
  vesselImo: string | null;
  vesselOwner: string | null;
  supplier: string;
  supplierRef: string | null;
  supplierId: string | null;
  buyerName: string | null;
  buyerRef: string | null;
  parentOrderId: string | null;
  shipservRfqId: string | null;
  shipservPoId: string | null;
  shipservQuoteId: string | null;
  shipservLifecycle: ShipServLifecycle | null;
  rfqId: string | null;
  port: string | null;
  eta: string;
  requestedDate: string | null;
  confirmedDate: string | null;
  total: number;
  currency: string;
  marginPct: number;
  markupPct: number | null;
  costTotal: number | null;
  marginOverride: boolean;
  status: OrderStatus;
  confirmStatus: ConfirmStatus;
  priority: Priority;
  legacyNotes: string | null;
  assignedToId: string | null;
  assignedTo?: { id: string; name: string; email: string } | null;
  createdAt: string;
  updatedAt: string;
  lines?: PurchaseOrderLine[];
  events?: PurchaseOrderEvent[];
  orderNotes?: PurchaseOrderNote[];
  documents?: PurchaseOrderDocument[];
  erpCore?: PurchaseOrderErpCoreReadModel;
  childOrders?: PurchaseOrderSummary[];
  parentOrder?: PurchaseOrderSummary | null;
  supplierRel?: { id: string; name: string; supplierCode: string } | null;
  _count?: { lines: number; childOrders: number };
}

/** Lightweight PO reference for parent/child display */
export interface PurchaseOrderSummary {
  id: string;
  poNumber: string;
  orderType: OrderType;
  supplier: string;
  supplierRef?: string | null;
  buyerName?: string | null;
  vessel?: string;
  vesselOwner?: string | null;
  status: OrderStatus;
  total: number;
  currency: string;
  _count?: { lines: number };
}

export interface PurchaseOrderNote {
  id: string;
  orderId: string;
  text: string;
  author: string;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrderLine {
  id: string;
  orderId: string;
  lineNumber: number;
  itemCode: string | null;
  description: string;
  supplierPartNo: string | null;
  qtyOrdered: number;
  qtyConfirmed: number | null;
  qtyDelivered: number;
  uom: string;
  unitPrice: number;
  lineTotal: number;
  currency: string;
  parentLineId: string | null;
  buyerUnitPrice: number | null;
  forwardedToOrderId: string | null;
  requestedDate: string | null;
  confirmedDate: string | null;
  status: LineStatus;
  remarks: string | null;
  createdAt: string;
  updatedAt: string;
}

export type POEventType =
  | "created"
  | "status_changed"
  | "eta_updated"
  | "note_added"
  | "exception_flagged"
  | "confirmation_requested"
  | "line_updated"
  | "approval"
  | "document_attached"
  | "document_deleted"
  | "note_edited"
  | "note_deleted"
  | "delivery_updated"
  | "margin_updated"
  | "sub_po_created"
  | "order_confirmed"
  | "supplier_pos_generated"
  | "lines_forwarded"
  | "shipserv_sync";

export interface OrderLineAllocation {
  id: string;
  buyerLineId: string;
  subPoLineId: string;
  allocatedQty: number;
  buyerUnitPrice: number;
  supplierUnitPrice: number;
  createdAt: string;
}

export interface PurchaseOrderEvent {
  id: string;
  orderId: string;
  type: POEventType;
  summary: string;
  detail: string | null;
  actor: string;
  createdAt: string;
}

export interface PurchaseOrderDocument {
  id: string;
  orderId: string;
  fileName: string;
  originalName: string | null;
  mimeType: string;
  sizeBytes: number;
  storageProvider: string;
  storageKey: string;
  category: string;
  description: string | null;
  uploadedBy: string;
  createdAt: string;
}

export type ErpAuditActorType = "Operator" | "User" | "System" | "Agent" | "Import" | "Api";
export type ErpDocumentStatus = "Active" | "Archived" | "Deleted";
export type ErpProvenanceKind = "Operational" | "Seed" | "Demo" | "Imported" | "Screenshot" | "System";
export type ErpPartyKind = "Organization" | "Person" | "Unknown";
export type ErpPartyStatus = "Active" | "Inactive" | "Watch" | "Blocked" | "Archived";
export type ErpPartyRoleType = "Customer" | "Supplier" | "Vendor" | "ShippingCompany" | "Owner" | "Agent" | "Broker" | "LegalEntity" | "Contact" | "Other";

export interface ErpCoreAuditEvent {
  id: string;
  entityType: string;
  entityId: string;
  entityNumber: string | null;
  eventType: string;
  actorType: ErpAuditActorType;
  actorId: string | null;
  actorName: string | null;
  sourceModule: string;
  before: unknown | null;
  after: unknown | null;
  metadata: unknown;
  aiAssisted: boolean;
  agentRunId: string | null;
  requestId: string | null;
  createdAt: string;
}

export interface ErpCoreDocument {
  id: string;
  documentNo: string | null;
  documentType: string;
  title: string | null;
  originalFileName: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  checksumSha256: string | null;
  storageProvider: string;
  storageKey: string | null;
  sourceModule: string;
  status: ErpDocumentStatus;
  metadata: unknown;
  archivedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ErpCoreDocumentLink {
  id: string;
  documentId: string;
  entityType: string;
  entityId: string;
  entityNumber: string | null;
  linkRole: string;
  sourceModule: string;
  metadata: unknown;
  createdAt: string;
  document: ErpCoreDocument;
}

export interface ErpCoreProvenance {
  id: string;
  entityType: string;
  entityId: string;
  kind: ErpProvenanceKind;
  source: string | null;
  scenario: string | null;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface ErpCorePartySummary {
  id: string;
  displayName: string;
  legalName: string | null;
  kind: ErpPartyKind;
  status: ErpPartyStatus;
  country: string | null;
  city: string | null;
  vatId: string | null;
  companyNumber: string | null;
  roles: { role: ErpPartyRoleType; isPrimary: boolean }[];
}

export interface ErpCorePartyLink {
  sourceModel: "Supplier" | "ShippingCompany";
  sourceId: string;
  sourceName: string;
  sourceCode: string | null;
  partyId: string | null;
  party: ErpCorePartySummary | null;
}

export interface PurchaseOrderErpCoreReadModel {
  available: boolean;
  auditEvents: ErpCoreAuditEvent[];
  documentLinks: ErpCoreDocumentLink[];
  provenance: ErpCoreProvenance | null;
  parties: {
    supplier: ErpCorePartyLink | null;
    buyer: ErpCorePartyLink | null;
  };
  error?: string;
}

export interface ShippingCompany {
  website?: string | null;
  sourceReview?: import("@/lib/shipping-companies/source-contract").CompanySourceReview | null;
  fleetVessels?: ShippingCompanyVessel[];
  id: string;
  name: string;
  legalName: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  vatId: string | null;
  companyNumber: string | null;
  paymentTerms: string | null;
  invoiceEmail: string | null;
  notes: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShippingCompanyVessel {
  id: string;
  shippingCompanyId: string;
  name: string;
  imo: string | null;
  mmsi: string | null;
  notes: string | null;
}

export type SupplierStatus = "Suggested" | "Active" | "Inactive" | "Verified" | "Watch" | "Blocked" | "Rejected" | "Needs_Review";
export type EnrichmentState = "None" | "Pending" | "Enriching" | "Enriched" | "Failed";

export interface Supplier {
  id: string;
  supplierCode: string;
  name: string;
  region: string;
  country: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  contactPerson: string | null;
  description: string | null;
  categories: string[];
  portsCovered: string[];
  score: number;
  leadTimeDays: number;
  lat: number | null;
  lng: number | null;
  status: SupplierStatus;
  enrichmentStatus: EnrichmentState;
  confidence: number | null;
  sourceReferences: string[];
  createdAt: string;
  updatedAt: string;
  /** Included when fetched from list endpoint */
  _count?: {
    contracts: number;
    agreementVersions?: number;
    supplierQuotes: number;
    purchaseOrders?: number;
    supplierInvoices?: number;
  };
}

export interface ContractAgreement {
  id: string;
  supplierId: string;
  title: string;
  startDate: string;
  endDate: string;
  discountPct: number;
  status: "Active" | "Expiring" | "Expired";
}

export interface InventoryItem {
  id: string;
  itemCode: string | null;
  catalogItemId: string | null;
  description: string;
  category: string | null;
  warehouse: string;
  locationBin: string | null;
  uom: string;
  onHand: number;
  reserved: number;
  inbound: number;
  available: number;
  reorderPoint: number;
  stockStatus: "critical" | "reorder" | "healthy";
  dangerousGoods: boolean;
  notes: string | null;
  lastCountedAt: string | null;
  movementCount: number;
  lastMovementAt: string | null;
  createdAt: string;
  updatedAt: string;
  movements?: InventoryMovement[];
  cycleCounts?: InventoryCycleCount[];
}

export interface InventoryMovement {
  id: string;
  inventoryItemId: string;
  movementType: string;
  quantity: number;
  quantityBefore: number;
  quantityAfter: number;
  source: string;
  referenceType: string | null;
  referenceId: string | null;
  referenceLabel: string | null;
  note: string | null;
  actor: string;
  createdAt: string;
}

export interface InventoryCycleCount {
  id: string;
  inventoryItemId: string;
  expectedQuantity: number;
  countedQuantity: number;
  variance: number;
  status: "PendingReview" | "Approved" | "Rejected";
  note: string | null;
  reviewNote: string | null;
  countedBy: string;
  reviewedBy: string | null;
  countedAt: string;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PricingIssue {
  id: string;
  orderId: string;
  expectedMarginPct: number;
  actualMarginPct: number;
  severity: "Low" | "Medium" | "High";
}

export interface FinanceRecord {
  id: string;
  orderId: string;
  type: "Invoice" | "Credit_Note" | "Accrual";
  amount: number;
  currency: string;
  status: "Pending" | "Posted" | "Failed";
}

export interface ComplianceCase {
  id: string;
  type: "DG" | "Sanctions" | "UoM" | "Document";
  vessel: string;
  status: "Open" | "Under_Review" | "Resolved";
  details: string;
}

export interface DocumentRecord {
  id: string;
  type: "RFQ" | "Quote" | "PO" | "Invoice" | "SDS" | "POD";
  relatedId: string;
  uploadedAt: string;
  extracted: boolean;
}

export interface AICheckResult {
  id: string;
  orderId: string;
  risk: "Low" | "Medium" | "High";
  findings: string[];
  recommendation: string;
}

// ═══════════════════════════════════════════════════════════════
// AGREEMENTS MODULE
// ═══════════════════════════════════════════════════════════════

export type AgreementStatus = "Draft" | "Sent" | "Active" | "Expired" | "Archived";
export type ComparisonStatus = "Queued" | "Processing" | "Completed" | "Failed";
export type ChangeType = "New" | "Removed" | "PriceChange" | "FieldChange";
export type ReviewStatus = "Pending" | "Accepted" | "Rejected" | "AutoApplied";

export interface AgreementVersion {
  id: string;
  supplierId: string;
  supplierName: string;
  versionNumber: number;
  status: AgreementStatus;
  markupPercent: number;
  totalBaseValue: number;
  totalMarkedUpValue: number;
  currency: string;
  validFrom: string | null;
  validTo: string | null;
  sentAt: string | null;
  exportedFileName: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  // Included via relations
  _count?: { items: number; comparisons: number };
  items?: AgreementItem[];
}

export interface AgreementItem {
  id: string;
  versionId: string;
  lineNumber: number;
  offiNumber: string | null;
  systemId: string | null;
  vendorPartNumber: string | null;
  description: string;
  basePrice: number;
  markedUpPrice: number | null;
  currency: string;
  unit: string | null;
  moq: number | null;
  leadTimeDays: number | null;
  hsCode: string | null;           // 8-digit TARIC, e.g. "73269098"
  countryOfOrigin: string | null;  // ISO 3166-1 alpha-3, e.g. "DEU"
  cooConfidence: string | null;    // "High" | "Medium" | "Low"
  manufacturer: string | null;
}

export interface AgreementComparison {
  id: string;
  versionId: string;
  status: ComparisonStatus;
  sourceFileName: string;
  sourceFileType: string;
  sourceRowCount: number | null;
  totalChanges: number;
  newItems: number;
  removedItems: number;
  changedItems: number;
  priceChanges: number;
  totalPriceImpact: number | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  progressPct: number;
  progressMessage: string | null;
  error: string | null;
  createdAt: string;
  // Included via relations
  changes?: AgreementChange[];
}

export interface AgreementChange {
  id: string;
  comparisonId: string;
  changeType: ChangeType;
  matchKey: string;
  offiNumber: string | null;
  systemId: string | null;
  vendorPartNumber: string | null;
  description: string | null;
  oldValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
  changedFields: string[];
  priceOld: number | null;
  priceNew: number | null;
  priceDiffPct: number | null;
  reviewStatus: ReviewStatus;
  reviewedAt: string | null;
  reviewedBy: string | null;
  appliedToItemId: string | null;
  baselineItemId: string | null;
  createdAt: string;
}

export interface AgreementInsight {
  id: string;
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  suggestion: string | null;
  supplierId: string | null;
  supplierName: string | null;
  versionId: string | null;
  comparisonId: string | null;
  payload: Record<string, unknown>;
  dismissed: boolean;
  createdAt: string;
}

export type CustomerContractStatus = "Draft" | "UnderReview" | "Active" | "Expired" | "Archived";
export type CustomerContractItemStatus = "Active" | "Excluded" | "NeedsReview";

export interface CustomerContractSourceAgreement {
  id: string;
  contractId: string;
  agreementVersionId: string;
  supplierId: string;
  supplierName: string;
  includedItemCount: number;
  createdAt: string;
  agreementVersion?: Pick<AgreementVersion, "id" | "supplierName" | "versionNumber" | "status" | "validFrom" | "validTo" | "markupPercent">;
}

export interface CustomerContractItem {
  id: string;
  contractId: string;
  sourceAgreementId: string | null;
  agreementItemId: string | null;
  supplierId: string;
  supplierName: string;
  lineNumber: number;
  itemCode: string | null;
  vendorPartNumber: string | null;
  description: string;
  basePrice: number;
  contractMarkupPercent: number;
  sellPrice: number;
  currency: string;
  unit: string | null;
  moq: number | null;
  leadTimeDays: number | null;
  hsCode: string | null;
  countryOfOrigin: string | null;
  manufacturer: string | null;
  status: CustomerContractItemStatus;
  reviewNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerContractAuditEvent {
  id: string;
  contractId: string;
  action: string;
  summary: string;
  actor: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CustomerContract {
  id: string;
  contractNumber: string;
  shippingCompanyId: string;
  shippingCompanyName: string;
  title: string;
  status: CustomerContractStatus;
  markupPercent: number;
  currency: string;
  validFrom: string | null;
  validTo: string | null;
  paymentTerms: string | null;
  deliveryTerms: string | null;
  notes: string | null;
  totalBaseValue: number;
  totalSellValue: number;
  itemCount: number;
  createdBy: string;
  reviewedAt: string | null;
  activatedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  shippingCompany?: ShippingCompany;
  sourceAgreements?: CustomerContractSourceAgreement[];
  items?: CustomerContractItem[];
  auditEvents?: CustomerContractAuditEvent[];
  _count?: { items?: number; auditEvents?: number };
}
