/**
 * Agent Registry
 *
 * Defines all available agents, their capabilities, and domains.
 * The command router uses this registry to dispatch commands.
 */

export interface AgentDefinition {
  id: string;
  name: string;
  domain: string;
  category: string;
  description: string;
  actions: string[];
  linkedModules: string[];
  capabilities: string[];
  allowedActions: string[];
  restrictedActions: string[];
  approvalRequiredFor: string[];
  icon: string;
  enabled: boolean;
}

/* ── Registry ──────────────────────────────────────────────── */

const agents: AgentDefinition[] = [
  {
    id: "nautex_po_intake", name: "Purchase Order Intake Agent", domain: "purchase_orders", category: "Purchase Order Intake",
    description: "Extracts purchase order files for review. Starts through Process PO File or reprocess upload in Purchase Orders; manual order entry stays available.",
    actions: ["process_purchase_order"], linkedModules: ["Purchase Orders"], capabilities: ["Document extraction", "Local parsing", "Optional AI assistance"],
    allowedActions: ["Prepare intake draft"], restrictedActions: ["Approve orders", "Send purchase orders"], approvalRequiredFor: ["Confirm extracted order data"], icon: "receipt_long", enabled: true,
  },
  {
    id: "command_router",
    name: "Command Router Agent",
    domain: "system",
    category: "Command Router",
    description: "Parses natural-language commands and routes them to the correct agent.",
    actions: ["route_command"],
    linkedModules: ["Command Center", "Agent Monitor"],
    capabilities: ["Intent detection", "Agent dispatch", "Command audit logging"],
    allowedActions: ["Route commands", "Summarize command outcomes", "Create auditable agent runs"],
    restrictedActions: ["Approve business records", "Send external messages", "Post finance transactions"],
    approvalRequiredFor: ["Any routed action that changes procurement, finance, supplier, customer, or inventory records"],
    icon: "route",
    enabled: true,
  },
  {
    id: "rfq_intake",
    name: "RFQ Intake Agent",
    domain: "procurement",
    category: "RFQ Intake Agent",
    description: "Parses RFQ documents and extracts structured line items.",
    actions: ["parse_rfq", "extract_lines"],
    linkedModules: ["RFQ Automation", "Supplier Routing", "Agent Monitor"],
    capabilities: ["RFQ parsing", "Line extraction", "Supplier candidate preparation"],
    allowedActions: ["Draft RFQ structure", "Rank supplier candidates", "Record parsing evidence"],
    restrictedActions: ["Send RFQs", "Award suppliers", "Create final quotes"],
    approvalRequiredFor: ["Supplier routing", "Customer-facing quote output", "Commercial record changes"],
    icon: "description",
    enabled: true,
  },
  {
    id: "classification",
    name: "HS Classification Agent",
    domain: "classification",
    category: "HS Classification Agent",
    description: "Classifies items with HS codes (EU/US), IMPA codes, and country of origin.",
    actions: ["classify_hs", "classify_impa", "identify_coo", "normalize_description"],
    linkedModules: ["HS Codes", "Inventory", "Agreements", "RFQ Automation"],
    capabilities: ["HS draft classification", "IMPA lookup", "Country-of-origin suggestion", "Description normalization"],
    allowedActions: ["Draft classifications", "Explain confidence", "Flag low-confidence records"],
    restrictedActions: ["Commit customs classifications", "Override supplier documents", "Change commercial records"],
    approvalRequiredFor: ["Applying HS, IMPA, COO, or normalized descriptions to business records"],
    icon: "category",
    enabled: true,
  },
  {
    id: "supplier_discovery",
    name: "Supplier Routing Agent",
    domain: "procurement",
    category: "Supplier Routing Agent",
    description: "Finds and scores suppliers for given items based on region, lead time, and history.",
    actions: ["find_suppliers", "score_suppliers", "match_contracts"],
    linkedModules: ["Suppliers", "RFQ Automation", "Agreements", "Backorders"],
    capabilities: ["Supplier matching", "Source reliability scoring", "Agreement-aware routing"],
    allowedActions: ["Recommend suppliers", "Explain rankings", "Learn from accept/reject/edit feedback"],
    restrictedActions: ["Select final supplier autonomously", "Send supplier email", "Change supplier commercial terms"],
    approvalRequiredFor: ["Routing RFQs", "Creating supplier-facing messages", "Updating supplier records"],
    icon: "storefront",
    enabled: true,
  },
  {
    id: "order_validation",
    name: "Order Validation Agent",
    domain: "validation",
    category: "Order Validation Agent",
    description: "Validates purchase orders for risk, pricing anomalies, and compliance.",
    actions: ["validate_order", "check_pricing", "check_compliance"],
    linkedModules: ["Purchase Orders", "Procurement Validator", "Finance", "Exceptions"],
    capabilities: ["PO risk review", "Pricing anomaly detection", "Compliance checks"],
    allowedActions: ["Draft review findings", "Create exceptions", "Suggest next action"],
    restrictedActions: ["Approve purchase orders", "Approve invoices", "Issue credit notes"],
    approvalRequiredFor: ["PO approval", "Supplier/customer messaging", "Finance downstream actions"],
    icon: "verified",
    enabled: true,
  },
  {
    id: "procurement_validation",
    name: "Procurement Validator Agent",
    domain: "procurement",
    category: "Procurement Validator",
    description: "Compares supplier quotes against purchase orders to detect discrepancies.",
    actions: ["validate_quote_vs_po"],
    linkedModules: ["Validator", "Purchase Orders", "Finance", "Exceptions"],
    capabilities: ["Quote-vs-PO comparison", "Discrepancy explanation", "Review readiness scoring"],
    allowedActions: ["Flag discrepancies", "Draft explanations", "Create review tasks"],
    restrictedActions: ["Approve discrepancies", "Change PO lines", "Approve invoices"],
    approvalRequiredFor: ["Supplier communication", "PO correction", "Invoice approval"],
    icon: "compare_arrows",
    enabled: true,
  },
  {
    id: "backorder_follow_up",
    name: "Backorder Supplier Follow-up Agent",
    domain: "backorders",
    category: "Backorder Supplier Follow-up Agent",
    description: "Prepares supervised supplier follow-up drafts for delayed and backordered lines.",
    actions: ["draft_backorder_follow_up"],
    linkedModules: ["Backorders", "Purchase Orders", "Suppliers", "Exceptions"],
    capabilities: ["Backorder analysis", "Supplier follow-up drafting", "ETA risk explanation"],
    allowedActions: ["Draft supplier emails", "Flag missing ETA evidence", "Suggest escalation"],
    restrictedActions: ["Send emails", "Confirm delivery dates", "Change supplier commitments"],
    approvalRequiredFor: ["Any supplier-facing email or ETA update"],
    icon: "outgoing_mail",
    enabled: true,
  },
  {
    id: "backorder_reply_monitor",
    name: "Backorder Follow-up Check",
    domain: "backorders",
    category: "Backorder Follow-up Check",
    description: "Checks recorded overdue backorders on request. No mailbox connection or scheduled reply monitoring is implemented.",
    actions: ["monitor_backorder_replies"],
    linkedModules: ["Backorders", "Purchase Orders", "Command Center"],
    capabilities: ["Overdue-record checks", "Priority filtering", "Follow-up review queue"],
    allowedActions: ["Preview overdue records", "Create follow-up exceptions from Backorders"],
    restrictedActions: ["Send replies", "Update confirmed ETAs", "Close backorder exceptions"],
    approvalRequiredFor: ["PO note creation", "ETA changes", "Supplier/customer messaging"],
    icon: "mark_email_read",
    enabled: true,
  },
  {
    id: "finance_exception",
    name: "Finance Exception Agent",
    domain: "finance",
    category: "Finance Exception Agent",
    description: "Runs local finance checks, recalculates order margin snapshots and detects review conditions before summarizing the exception queue. No accounting decisions are automated.",
    actions: ["analyze_finance_exception"],
    linkedModules: ["Finance", "Purchase Orders", "Exceptions"],
    capabilities: ["Rule-based exception detection", "Margin snapshot calculation", "Source record references", "Open queue summary"],
    allowedActions: ["Detect and update review conditions", "Summarize recorded exceptions", "Identify linked evidence for review"],
    restrictedActions: ["Approve invoices", "Approve payments", "Issue credit notes", "Post accounting exports"],
    approvalRequiredFor: ["Invoice approval", "Payment approval", "Credit-note issue", "Accounting export"],
    icon: "account_balance",
    enabled: true,
  },
  {
    id: "agreement_comparison",
    name: "Agreement Comparison Agent",
    domain: "agreements",
    category: "Agreement Comparison Agent",
    description: "Compares an uploaded supplier spreadsheet against stored agreement items from the Agreements workspace. Review is required before applying changes.",
    actions: ["compare_agreement"],
    linkedModules: ["Agreements", "Suppliers", "Finance", "Inventory"],
    capabilities: ["Agreement comparison", "Price-change detection", "Item-change explanation"],
    allowedActions: ["Draft comparison results", "Flag pricing changes", "Suggest review priorities"],
    restrictedActions: ["Activate agreements", "Apply price changes", "Change customer contracts"],
    approvalRequiredFor: ["Applying agreement changes", "Activating contracts", "Updating sell prices"],
    icon: "contract",
    enabled: true,
  },
];

/* ── Lookups ───────────────────────────────────────────────── */

export function getAgent(id: string): AgentDefinition | undefined {
  return agents.find((a) => a.id === id);
}

export function getAgentByAction(action: string): AgentDefinition | undefined {
  return agents.find((a) => a.actions.includes(action));
}

export function getAgentsByDomain(domain: string): AgentDefinition[] {
  return agents.filter((a) => a.domain === domain && a.enabled);
}

export function getAllAgents(): AgentDefinition[] {
  return agents;
}

export function getEnabledAgents(): AgentDefinition[] {
  return agents.filter((a) => a.enabled);
}
