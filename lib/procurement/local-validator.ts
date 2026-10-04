import { buildProcurementValidation } from "@/lib/procurement/validator";
import type { ProcurementValidationResult } from "@/lib/procurement/validator";

export function compareQuoteAndPoLocally(quoteText: string, poText: string): ProcurementValidationResult | null {
  const result = buildProcurementValidation({
    validationType: "supplier_quote_vs_purchase_order",
    leftDocument: {
      role: "supplier_quote",
      text: quoteText,
      fileName: null,
      warnings: [],
    },
    rightDocument: {
      role: "purchase_order",
      text: poText,
      fileName: null,
      warnings: [],
    },
  });

  if (result.normalizedLines.left.length === 0 || result.normalizedLines.right.length === 0) return null;
  return result;
}
