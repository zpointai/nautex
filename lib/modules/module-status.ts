export type ModuleStatus =
  | "real"
  | "partial"
  | "demo_data"
  | "mock_only"
  | "not_connected"
  | "requires_integration";

export type ModuleKey =
  | "dashboard"
  | "purchaseOrders"
  | "suppliers"
  | "contracts"
  | "backorders"
  | "vessels"
  | "inventory"
  | "finance"
  | "evidenceAnalyzer"
  | "procurementSearch"
  | "impaSearch"
  | "hsCodeFinder"
  | "rfqAutomation"
  | "procurementValidator"
  | "priceCalculator"
  | "agentMonitor"
  | "exceptionsQueue";

export interface ModuleStatusInfo {
  status: ModuleStatus;
  label: string;
  description: string;
}

export const MODULE_STATUS: Record<ModuleKey, ModuleStatusInfo> = {
  dashboard: {
    status: "demo_data",
    label: "Demo data",
    description: "Command Center metrics are backed by seeded anonymized Nautex demo records.",
  },
  purchaseOrders: {
    status: "real",
    label: "Real",
    description: "Backed by Prisma purchase order APIs with seeded demo orders and line items.",
  },
  suppliers: {
    status: "real",
    label: "Real",
    description: "Backed by Prisma supplier APIs and supplier matching/enrichment services.",
  },
  contracts: {
    status: "real",
    label: "Real",
    description: "Backed by Prisma agreement versions, items, comparisons, and insights.",
  },
  backorders: {
    status: "partial",
    label: "Partial",
    description: "Derived from Prisma purchase order lines marked Backordered; lifecycle persistence is planned.",
  },
  vessels: {
    status: "partial",
    label: "Partial",
    description: "Server-side live vessel lookup with Postgres cache, watchlist, order links, track snapshots, ETA risk, and interactive map.",
  },
  inventory: {
    status: "real",
    label: "Real",
    description: "Backed by Prisma inventory records, stock movements, warehouse actions, and purchase-order delivery receipts.",
  },
  finance: {
    status: "partial",
    label: "Partial",
    description: "Prisma-backed finance foundation with seeded anonymized records, invoice controls, matching, aging, exceptions, and export readiness.",
  },
  evidenceAnalyzer: {
    status: "real",
    label: "Real",
    description: "Prisma-backed SLA evidence ingestion with local source-file storage, parser metadata, multi-PO links, review lifecycle, and PO audit events.",
  },
  procurementSearch: {
    status: "real",
    label: "Real",
    description: "Searches Nautex catalogue, inventory, PO history, and persists search history in Prisma.",
  },
  impaSearch: {
    status: "partial",
    label: "Postgres catalog",
    description: "Uses the local approved IMPA catalogue import with Prisma-backed search and favorites.",
  },
  hsCodeFinder: {
    status: "partial",
    label: "Partial",
    description: "Server-side AI classification with Prisma history and favorites. No full HS dataset is imported.",
  },
  rfqAutomation: {
    status: "partial",
    label: "Partial",
    description: "Persists RFQs, lines, supplier quotes, agent runs, and supplier-route candidates. AI parsing is optional.",
  },
  procurementValidator: {
    status: "real",
    label: "Real",
    description: "Operational procurement validation with deterministic parsing, normalized line matching, Prisma audit history, review controls, and exception preparation.",
  },
  priceCalculator: {
    status: "real",
    label: "Real",
    description: "Client-side calculator is functional; persistence is planned for later phases.",
  },
  agentMonitor: {
    status: "real",
    label: "Real",
    description: "Operational Prisma-backed control center for agent registry, runs, tasks, approvals, exceptions, audit snippets, and learning memory.",
  },
  exceptionsQueue: {
    status: "partial",
    label: "Operational queue",
    description: "Prisma-backed human-intervention queue for agent and finance exceptions, with record-level demo indicators where seeded data is present.",
  },
};

export const STATUS_STYLE: Record<ModuleStatus, string> = {
  real: "bg-success/8 text-success border-success/12",
  partial: "bg-primary/8 text-primary border-primary/12",
  demo_data: "bg-warning/8 text-warning border-warning/12",
  mock_only: "bg-outline-variant/10 text-outline border-outline-variant/12",
  not_connected: "bg-error/8 text-error border-error/12",
  requires_integration: "bg-warning/8 text-warning border-warning/12",
};
