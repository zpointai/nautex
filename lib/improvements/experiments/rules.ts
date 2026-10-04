import type { CandidateConfig, ExperimentKey } from "./catalog";
export type IdentityInput = { requestedPart: string; requestedUnit: string | null; candidates: { id: string; part: string; unit: string | null; supplierActive: boolean }[] };
export type AgreementInput = { sourcePrice: string | null; offeredPrice: string | null; sourceCurrency: string | null; offeredCurrency: string | null; sourceUnit: string | null; offeredUnit: string | null; validFrom: string | null; validTo: string | null; asOf: string };
export type StockInput = { onHand: number; reserved: number; outstanding: number; stockUnit: string | null; demandUnit: string | null; closed: boolean; daysUntilDue: number };
export type ExperimentInput = IdentityInput | AgreementInput | StockInput;
const normalized = (value: string | null) => value?.trim().toUpperCase() ?? "";
const sameUnit = (a: string | null, b: string | null) => !!normalized(a) && normalized(a) === normalized(b);
function minorUnits(value: string | null) {
  if (value === null || !/^\d{1,9}(\.\d{1,2})?$/.test(value)) return null;
  const [integer, fraction = ""] = value.split(".");
  return Number(integer) * 100 + Number(fraction.padEnd(2, "0"));
}

// Fixed pure implementations. Configurations contain boolean flags only: no code,
// expressions, file paths, tools, case IDs, expected answers, or network access.
export function referencePrediction(key: ExperimentKey, input: ExperimentInput, flags: CandidateConfig): string {
  if (key === "supplier_item_identity") {
    const value = input as IdentityInput;
    const matches = value.candidates.filter(candidate => normalized(candidate.part) === normalized(value.requestedPart) && !!normalized(value.requestedPart)
      && (!flags.requireUnitMatch || sameUnit(candidate.unit, value.requestedUnit))
      && (!flags.requireActiveSupplier || candidate.supplierActive));
    if (flags.requireUniqueMatch && matches.length !== 1) return "review";
    return matches[0]?.id ?? "review";
  }
  if (key === "agreement_validation") {
    const value = input as AgreementInput;
    const source = minorUnits(value.sourcePrice), offered = minorUnits(value.offeredPrice);
    if (flags.requirePriceEvidence && (source === null || offered === null)) return "review";
    if (flags.checkCurrency && (!/^[A-Z]{3}$/.test(value.sourceCurrency ?? "") || value.sourceCurrency !== value.offeredCurrency)) return "review";
    if (flags.checkUnit && !sameUnit(value.sourceUnit, value.offeredUnit)) return "review";
    if (flags.checkValidity && ((!value.validFrom && !value.validTo) || (value.validFrom && value.asOf < value.validFrom) || (value.validTo && value.asOf > value.validTo))) return "review";
    return (source ?? 0) === (offered ?? 0) ? "match" : "review";
  }
  const value = input as StockInput;
  if (flags.checkLedger && (![value.onHand, value.reserved, value.outstanding].every(number => Number.isSafeInteger(number) && number >= 0) || value.reserved > value.onHand)) return "review";
  if (flags.ignoreClosedCases && value.closed) return "clear";
  if (flags.checkUnits && !sameUnit(value.stockUnit, value.demandUnit)) return "review";
  const available = value.onHand - (flags.useAvailableStock ? value.reserved : 0);
  return value.outstanding > available && (!flags.checkDueWindow || value.daysUntilDue <= 2) ? "warn" : "clear";
}
