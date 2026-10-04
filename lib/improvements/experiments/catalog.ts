export const EXPERIMENTS = [
  { key: "supplier_item_identity", label: "Supplier / Item Search: item identity", modules: ["suppliers", "procurementSearch"], baseline: "Identifier-only reference v1", candidate: "Guarded identity reference v1", flags: ["requireUnitMatch", "requireActiveSupplier", "requireUniqueMatch"], workflows: ["supplier enquiries", "item selection", "quote line identity"] },
  { key: "agreement_validation", label: "Agreements / Validator: commercial consistency", modules: ["contracts", "procurementValidator"], baseline: "Price-only reference v1", candidate: "Source-aware comparison reference v1", flags: ["checkCurrency", "checkUnit", "checkValidity", "requirePriceEvidence"], workflows: ["agreement applicability", "quote comparison", "invoice variance"] },
  { key: "inventory_backorders", label: "Inventory / Backorders: fulfillment warnings", modules: ["inventory", "backorders"], baseline: "On-hand-only reference v1", candidate: "Available-stock warning reference v1", flags: ["useAvailableStock", "ignoreClosedCases", "checkUnits", "checkLedger", "checkDueWindow"], workflows: ["reservations", "backorder triage", "receipt and delivery quantities"] },
] as const;
export type ExperimentKey = typeof EXPERIMENTS[number]["key"];
export type CandidateConfig = Record<string, boolean>;
export const EVALUATOR_VERSION = "offline-reference.v1";
export const EXPERIMENT_SOFTWARE_VERSION = "0.3.14";
export function experimentFor(key: unknown) { return EXPERIMENTS.find(entry => entry.key === key); }
export function defaultCandidate(key: unknown): CandidateConfig { return Object.fromEntries((experimentFor(key)?.flags ?? []).map(flag => [flag, true])); }
export function validateCandidate(key: unknown, value: unknown): value is CandidateConfig {
  const experiment = experimentFor(key);
  if (!experiment || !value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length === experiment.flags.length && entries.every(([name, setting]) => (experiment.flags as readonly string[]).includes(name) && typeof setting === "boolean");
}
