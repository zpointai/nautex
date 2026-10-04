export type ModuleKey =
  | "dashboard"
  | "purchaseOrders" | "suppliers" | "contracts" | "backorders" | "vessels" | "inventory" | "finance"
  | "evidenceAnalyzer"
  | "procurementSearch" | "impaSearch" | "hsCodeFinder" | "rfqAutomation" | "procurementValidator" | "priceCalculator"
  | "agentMonitor" | "exceptionsQueue";

export type DomainKey = "operations" | "intelligence" | "automation";

export interface ModuleDef {
  key: ModuleKey;
  label: string;
  icon: string;
  domain: DomainKey;
  description: string;
}

export interface DomainDef {
  key: DomainKey;
  label: string;
  icon: string;
}

export interface NavigationTarget {
  moduleKey: ModuleKey;
  id?: string;
  filterStatus?: string;
}

export const DOMAINS: DomainDef[] = [
  { key: "operations", label: "Operations", icon: "anchor" },
  { key: "intelligence", label: "Intelligence", icon: "psychology" },
  { key: "automation", label: "Automation", icon: "smart_toy" },
];

export const MODULES: ModuleDef[] = [
  { key: "dashboard", label: "Command Center", icon: "space_dashboard", domain: "operations", description: "Operational control layer across procurement, vessels, finance, and agents." },
  { key: "purchaseOrders", label: "Purchase Orders", icon: "receipt_long", domain: "operations", description: "Track and manage purchase orders across your fleet." },
  { key: "suppliers", label: "Suppliers", icon: "storefront", domain: "operations", description: "Global supplier registry with performance scoring." },
  { key: "contracts", label: "Agreements", icon: "handshake", domain: "operations", description: "Supplier agreements, item catalogs, and markup pricing." },
  { key: "backorders", label: "Backorders", icon: "pending_actions", domain: "operations", description: "Track overdue orders and manage escalations." },
  { key: "vessels", label: "Fleet Tracking", icon: "directions_boat", domain: "operations", description: "Live vessel tracking and fleet operations." },
  { key: "inventory", label: "Inventory", icon: "inventory_2", domain: "operations", description: "Warehouse inventory and stock management." },
  { key: "evidenceAnalyzer", label: "SLA Evidence", icon: "fact_check", domain: "operations", description: "Upload and analyze supplier delivery evidence." },
  { key: "finance", label: "Finance", icon: "account_balance_wallet", domain: "operations", description: "Invoice control, supplier matching, margin, aging, and export readiness." },
  { key: "procurementSearch", label: "Item Search", icon: "manage_search", domain: "intelligence", description: "Search catalogue for pricing and specs." },
  { key: "impaSearch", label: "IMPA Catalogue", icon: "menu_book", domain: "intelligence", description: "Browse the IMPA Marine Stores Guide." },
  { key: "hsCodeFinder", label: "HS Codes", icon: "travel_explore", domain: "intelligence", description: "AI-powered dual-jurisdiction HS classification." },
  { key: "rfqAutomation", label: "RFQ Automation", icon: "bolt", domain: "intelligence", description: "AI-powered RFQ processing and supplier matching." },
  { key: "procurementValidator", label: "Validator", icon: "compare_arrows", domain: "intelligence", description: "Compare supplier quotes against purchase orders." },
  { key: "priceCalculator", label: "Price Calculator", icon: "calculate", domain: "intelligence", description: "Calculate final pricing with configurable markup." },
  { key: "agentMonitor", label: "Agent Monitor", icon: "smart_toy", domain: "automation", description: "Monitor AI agent activity and performance." },
  { key: "exceptionsQueue", label: "Exceptions", icon: "playlist_add_check", domain: "automation", description: "Review items that need human intervention." },
];

export function findModule(moduleKey: string | undefined) {
  return MODULES.find((module) => module.key === moduleKey);
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseNavigationTarget(value: string): NavigationTarget | null {
  const input = value.trim();
  if (!input) return null;

  if (input.startsWith("nautex://")) {
    const url = new URL(input);
    if (url.protocol !== "nautex:" || url.hostname !== "open") return null;
    const [moduleKey, ...idParts] = url.pathname.split("/").filter(Boolean);
    const target = findModule(moduleKey);
    if (!target) return null;
    const id = idParts.length ? safeDecode(idParts.join("/")) : undefined;
    return { moduleKey: target.key, ...(id ? { id } : {}) };
  }

  const hash = input.includes("#") ? new URL(input, "https://nautex.invalid").hash : input;
  const [moduleKey, ...parts] = hash.replace(/^#/, "").split(":");
  const target = findModule(moduleKey || "dashboard");
  if (!target) return null;
  const encodedId = parts.join(":");
  if (!encodedId) return { moduleKey: target.key };
  return {
    moduleKey: target.key,
    id: safeDecode(encodedId),
    ...(parts[0] === "status" && parts[1] ? { filterStatus: safeDecode(parts[1]) } : {}),
  };
}

export function moduleHash(moduleKey: ModuleKey, pathname = "/") {
  return moduleKey === "dashboard" ? pathname : `#${moduleKey}`;
}

export function navigationHash(target: NavigationTarget, pathname = "/") {
  if (!target.id) return moduleHash(target.moduleKey, pathname);
  if (target.filterStatus) return `#${target.moduleKey}:status:${encodeURIComponent(target.filterStatus)}`;
  return `#${target.moduleKey}:${encodeURIComponent(target.id)}`;
}
