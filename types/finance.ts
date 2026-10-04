export type FinanceKpi = {
  label: string;
  value: string;
  tone: "neutral" | "success" | "warning" | "danger";
  detail: string;
};

export type CustomerInvoiceRow = {
  id: string;
  invoiceNo: string;
  customer: string;
  vessel: string;
  customerPoRef: string;
  bankPaymentReference: string;
  invoiceDate: string;
  deliveryDate: string;
  dueDate: string;
  currency: string;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  paidAmount: number;
  creditedAmount: number;
  outstandingAmount: number;
  status: string;
  marginPct: number | null;
  exceptionFlag: boolean;
  linkedOrderRef: string;
};

export type SupplierInvoiceRow = {
  supplierId: string | null;
  legalEntityId: string | null;
  purchaseOrderId: string | null;
  invoiceDate: string;
  version: string;
  reviewNote: string | null;
  evidenceRef: string | null;
  sourceDocumentId: string | null;
  isFinalInvoice: boolean;
  paidAmount: number;
  outstandingAmount: number;
  id: string;
  supplier: string;
  supplierInvoiceNo: string;
  relatedPurchaseOrder: string;
  currency: string;
  expectedCost: number;
  invoicedCost: number;
  variance: number;
  vatAmount: number;
  dueDate: string;
  matchStatus: string;
  approvalStatus: string;
  action: string;
};

export type MarginControlRow = {
  orderId: string;
  customsBondedCost: number;
  warehouseHandlingCost: number;
  additionalOtherCosts: number;
  calculationBasis: { issues: string[]; supplierBasis: string[]; revenueBasis: string; complete: boolean };
  snapshotAt: string | null;
  snapshotStale: boolean;
  version: string | null;
  costReviewNote: string;
  id: string;
  currency: string;
  orderRef: string;
  customer: string;
  vessel: string;
  revenue: number;
  supplierCost: number;
  freightDeliveryCost: number;
  otherCosts: number;
  grossProfit: number;
  marginPct: number;
  targetMarginPct: number;
  marginVariance: number;
  status: string;
};

export type AgingBucket = {
  label: string;
  currency: string | null;
  amount: number;
  count: number;
};

export type CreditNoteRow = {
  reviewNote: string | null;
  id: string;
  creditNoteNo: string;
  originalInvoiceNo: string;
  customer: string;
  vessel: string;
  reasonCode: string;
  currency: string;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  status: string;
  createdDate: string;
  approvalStatus: string;
};

export type FinanceExceptionRow = {
  id: string;
  type: string;
  severity: string;
  status: string;
  title: string;
  description: string;
  reference: string;
  createdAt: string;
};

export type ExportReadinessRow = {
  legalEntityId: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  id: string;
  target: string;
  status: string;
  lastExportDate: string | null;
  recordsReady: number;
  recordsBlocked: number;
  validationErrors: string[];
};

export type FinanceAuditRow = {
  id: string;
  entityType: string;
  entityRef: string;
  action: string;
  actorType: string;
  createdAt: string;
  metadataSummary: string;
};

export type UnbilledOrderRow = {
  id: string;
  orderRef: string;
  buyer: string;
  vessel: string;
  deliveryDate: string;
  currency: string;
  amount: number;
  lineCount: number;
};
