import { MODULES, type ModuleKey } from "@/lib/client/navigation";

export type ObservationConnector = "supplier" | "agreement" | "inventory" | "backorder" | "validation" | "item_search";
type Capability = {
  connector: ObservationConnector | null;
  objective: string;
  evaluation: string;
  workflows: string[];
};

// This is coverage, not a claim of operational learning or model accuracy.
const capabilities = {
  dashboard: { connector: null, objective: "Useful, source-backed priorities", evaluation: "Freshness, valid record links and reviewed alert usefulness", workflows: ["operational-alerts"] },
  purchaseOrders: { connector: null, objective: "Complete orders and valid fulfillment", evaluation: "Exact fields, quantities, approval and transition checks", workflows: ["supplier-inquiries", "supplier-responses", "customer-quotes", "sales-orders", "purchase-orders", "goods-receipts", "deliveries"] },
  suppliers: { connector: "supplier", objective: "Relevant suppliers and attributed outcomes", evaluation: "Verified relevance and delivery attribution; no pooled organization weights", workflows: ["supplier-discovery", "supplier-inquiries", "supplier-responses"] },
  contracts: { connector: "agreement", objective: "Accurate terms and item mappings", evaluation: "Source differences, exact currency and prices, effective dates and approval", workflows: ["agreement-versions", "agreement-items", "customer-contracts"] },
  backorders: { connector: "backorder", objective: "Earlier useful delay warnings", evaluation: "Warning lead time, false alarms and confirmed resolution", workflows: ["backorder-transitions", "purchase-orders", "goods-receipts", "deliveries"] },
  vessels: { connector: null, objective: "Better vessel identity and ETA risk", evaluation: "Permitted source freshness and actual arrival error", workflows: ["vessel-watchlist", "vessel-order-links", "vessel-tracks"] },
  inventory: { connector: "inventory", objective: "Useful replenishment and item suggestions", evaluation: "Stock conservation, units, reservation limits and approved counts", workflows: ["inventory-reservations", "inventory-transfers", "cycle-counts", "reorder-rfq", "goods-receipts", "deliveries"] },
  evidenceAnalyzer: { connector: null, objective: "Correct delivery evidence and SLA attribution", evaluation: "Source integrity, order links and reviewed timestamp semantics", workflows: ["sla-evidence", "goods-receipts", "deliveries"] },
  finance: { connector: null, objective: "Better invoice matching and exception explanations", evaluation: "Exact arithmetic, currencies, reconciliation and posting permissions", workflows: ["customer-invoices", "supplier-invoices", "payments", "credit-notes", "accounting-exports"] },
  procurementSearch: { connector: "item_search", objective: "Relevant item matches", evaluation: "Verified part number, pack size, unit and ranking quality", workflows: ["item-search", "catalogue-links"] },
  impaSearch: { connector: null, objective: "Correct catalogue retrieval and mappings", evaluation: "Exact authorized catalogue version, codes and provenance", workflows: ["impa-search", "catalogue-links"] },
  hsCodeFinder: { connector: null, objective: "Better supported classification suggestions", evaluation: "Applicable authoritative references and qualified reviewer acceptance", workflows: ["hs-classification"] },
  rfqAutomation: { connector: null, objective: "Faithful intake and draft preparation", evaluation: "Original field fidelity, completeness and confirmed review", workflows: ["rfq-intake", "rfq-review", "supplier-inquiries", "customer-quotes"] },
  procurementValidator: { connector: "validation", objective: "Correct discrepancy detection", evaluation: "Deterministic comparison, missing evidence, false positives and negatives", workflows: ["quote-po-comparison", "agreement-items", "supplier-invoices"] },
  priceCalculator: { connector: null, objective: "Clear pricing scenarios and input assistance", evaluation: "Fixed formula, rounding, currency and accounting identity tests", workflows: ["price-scenarios", "customer-quotes", "agreement-items"] },
  agentMonitor: { connector: null, objective: "Reliable bounded task execution", evaluation: "Actual outcomes, budgets, tool failures and permission enforcement", workflows: ["agent-tasks", "agent-approvals", "improvement-experiments"] },
  exceptionsQueue: { connector: null, objective: "Useful triage and durable resolutions", evaluation: "Correct ownership, reviewed root cause, recurrence and reopening", workflows: ["agent-exceptions", "finance-exceptions", "operational-exceptions"] },
} satisfies Record<ModuleKey, Capability>;

export const IMPROVEMENT_POLICY = {
  version: "offline-experiments.v1",
  evidenceReuse: "organization-and-legal-entity-scoped",
  automaticCollection: false,
  automaticExecution: false,
  productionActivation: false,
  providerCalls: false,
  crossModuleReuse: false,
  approvalMeaning: "Permission for offline preparation. Configured proposals may run the fixed reference benchmark through a separate human action. No activation or operational quality gain is implied.",
} as const;

export const IMPROVEMENT_MODULES = MODULES.map(module => ({
  ...module, ...capabilities[module.key],
  coverage: capabilities[module.key].connector ? "record_capture_available" : "operator_reports_only",
  learningState: "inactive" as const,
}));
export type ImprovementModule = typeof IMPROVEMENT_MODULES[number];
export function improvementModule(key: unknown) {
  return IMPROVEMENT_MODULES.find(module => module.key === key);
}
