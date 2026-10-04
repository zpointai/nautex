// Supported accounting labels, not a determination of which treatment applies.
export const INVOICE_TAX_OPTIONS = [
  { category: "Standard21", rate: 21, label: "Standard 21%" },
  { category: "Reduced9", rate: 9, label: "Reduced 9%" },
  { category: "Zero", rate: 0, label: "Zero rate" },
  { category: "ReverseCharge", rate: 0, label: "Reverse charge" },
  { category: "Exempt", rate: 0, label: "Exempt" },
  { category: "OutsideScope", rate: 0, label: "Outside scope" },
  { category: "BondedCustoms", rate: 0, label: "Bonded customs" },
] as const;

export function reviewedInvoiceTax(input: unknown) {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const option = INVOICE_TAX_OPTIONS.find(row => row.category === value.category);
  const reason = typeof value.reason === "string" ? value.reason.trim() : "";
  if (!option || reason.length < 10 || reason.length > 1000) throw new Error("Select a supported VAT treatment and record its reviewed basis (10–1000 characters). Country alone does not establish tax treatment.");
  return { category: option.category, rate: option.rate, reason };
}
