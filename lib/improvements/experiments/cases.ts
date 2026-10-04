import type { ExperimentKey } from "./catalog";
import type { AgreementInput, ExperimentInput, IdentityInput, StockInput } from "./rules";
export type FrozenCase = { id: string; group: ExperimentKey; input: ExperimentInput; expected: string; critical: boolean; reason: string };
const item: IdentityInput = { requestedPart: "ABC-10", requestedUnit: "EA", candidates: [{ id: "a", part: "ABC-10", unit: "EA", supplierActive: true }] };
const agreement: AgreementInput = { sourcePrice: "12.10", offeredPrice: "12.10", sourceCurrency: "EUR", offeredCurrency: "EUR", sourceUnit: "EA", offeredUnit: "EA", validFrom: "2026-01-01", validTo: "2026-12-31", asOf: "2026-09-12" };
const stock: StockInput = { onHand: 10, reserved: 0, outstanding: 5, stockUnit: "EA", demandUnit: "EA", closed: false, daysUntilDue: 1 };
const identity = (id: string, changes: Partial<IdentityInput>, expected: string, reason: string): FrozenCase => ({ id, group: "supplier_item_identity", input: { ...item, ...changes }, expected, critical: true, reason });
const commercial = (id: string, changes: Partial<AgreementInput>, expected: string, reason: string): FrozenCase => ({ id, group: "agreement_validation", input: { ...agreement, ...changes }, expected, critical: true, reason });
const fulfillment = (id: string, changes: Partial<StockInput>, expected: string, reason: string): FrozenCase => ({ id, group: "inventory_backorders", input: { ...stock, ...changes }, expected, critical: true, reason });

// Expected outcomes are maintained separately from rules and pinned by the evaluator.
// Synthetic reference cases; not independently human-labelled customer cases.
export const FROZEN_CASES: FrozenCase[] = [
  identity("identity-exact", {}, "a", "Exact identifier and unit"),
  identity("identity-case", { requestedPart: " abc-10 " }, "a", "Case and outer whitespace preserve identity"),
  identity("identity-unit", { requestedUnit: "BOX" }, "review", "A box is not one each"),
  identity("identity-missing-unit", { requestedUnit: null }, "review", "Unknown unit needs evidence"),
  identity("identity-inactive", { candidates: [{ ...item.candidates[0], supplierActive: false }] }, "review", "Inactive supplier needs review"),
  identity("identity-ambiguous", { candidates: [...item.candidates, { ...item.candidates[0], id: "b" }] }, "review", "Two eligible records do not establish a unique choice"),
  identity("identity-distinct", { requestedPart: "ABC10" }, "review", "Interior punctuation is not silently removed"),
  identity("identity-empty", { candidates: [] }, "review", "No eligible source"),
  identity("identity-filter", { candidates: [{ ...item.candidates[0], id: "wrong-pack", unit: "BOX" }, item.candidates[0]] }, "a", "Compatible unit wins over earlier incompatible record"),
  identity("identity-one-active", { candidates: [{ ...item.candidates[0], id: "inactive", supplierActive: false }, item.candidates[0]] }, "a", "Active eligible supplier remains available"),
  commercial("commercial-exact", {}, "match", "Same amount, currency, unit and applicability"),
  commercial("commercial-currency", { offeredCurrency: "USD" }, "review", "Equal numbers in different currencies are not equal prices"),
  commercial("commercial-unit", { offeredUnit: "BOX" }, "review", "Price basis differs"),
  commercial("commercial-expired", { validTo: "2026-09-11" }, "review", "Expired agreement cannot establish current terms"),
  commercial("commercial-future", { validFrom: "2026-09-13" }, "review", "Future terms are not yet applicable"),
  commercial("commercial-unknown-price", { sourcePrice: null, offeredPrice: "0" }, "review", "Missing price is distinct from zero"),
  commercial("commercial-zero", { sourcePrice: "0.00", offeredPrice: "0" }, "match", "Explicit zero price is valid"),
  commercial("commercial-difference", { offeredPrice: "12.11" }, "review", "One cent is a real difference"),
  commercial("commercial-unknown-validity", { validFrom: null, validTo: null }, "review", "Unknown applicability needs review"),
  commercial("commercial-boundary", { validTo: "2026-09-12" }, "match", "End date is inclusive"),
  fulfillment("stock-enough", {}, "clear", "Available stock covers the outstanding quantity"),
  fulfillment("stock-reserved", { reserved: 8 }, "warn", "Committed stock is not available for this demand"),
  fulfillment("stock-closed", { outstanding: 20, closed: true }, "clear", "Closed demand must not create a fresh warning"),
  fulfillment("stock-future", { outstanding: 20, daysUntilDue: 8 }, "clear", "Outside the fixed two-day warning window"),
  fulfillment("stock-due", { outstanding: 20, daysUntilDue: 2 }, "warn", "Window boundary is included"),
  fulfillment("stock-unit", { demandUnit: "BOX" }, "review", "Different units cannot be compared as quantities"),
  fulfillment("stock-ledger", { reserved: 11 }, "review", "Reservations above on-hand need investigation"),
  fulfillment("stock-negative", { onHand: -1 }, "review", "Invalid ledger quantity must not become a routine recommendation"),
  fulfillment("stock-equal", { outstanding: 10 }, "clear", "Exact available quantity is sufficient"),
  fulfillment("stock-overdue", { outstanding: 12, daysUntilDue: -1 }, "warn", "Unfilled overdue demand needs a warning"),
];
