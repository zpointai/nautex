import type { ComparisonLine, ValidationResult } from "./procurement";

// Keep model interpretation reviewable, but calculate arithmetic and change counts locally.
export function reconcileComparison(result: ValidationResult): ValidationResult {
  const quoteLines = new Set<number>(), poLines = new Set<number>();
  const counts = { added: 0, removed: 0, quantityChanges: 0, priceChanges: 0, compoundChanges: 0 };
  const comparisonResults = result.comparisonResults.map(source => {
    const line: ComparisonLine = { ...source };
    for (const side of ["quote", "po"] as const) {
      const number = line[`${side}Line`], qty = line[`${side}Qty`], price = line[`${side}Price`];
      const seen = side === "quote" ? quoteLines : poLines;
      if (number === null) {
        if (qty !== null || price !== null || line[`${side}Total`] !== null) throw new Error("Missing document sides must not contain quantities, prices or totals.");
      } else {
        if (!Number.isInteger(number) || number < 1 || seen.has(number)) throw new Error("Duplicate or invalid source line reference. Review the documents and retry.");
        seen.add(number);
        if (qty === null || price === null) throw new Error("A present line is missing quantity or price; review the source before comparing.");
        const total = Math.round(qty * price * 100) / 100;
        if (!Number.isFinite(total)) throw new Error("Line total is outside the supported range.");
        line[`${side}Total`] = total;
      }
    }
    if (line.quoteLine === null && line.poLine === null) throw new Error("Comparison line has no source reference.");
    if (line.quoteLine === null) { line.changeType = "Added"; counts.added++; }
    else if (line.poLine === null) { line.changeType = "Removed"; counts.removed++; }
    else {
      const quantity = line.quoteQty !== line.poQty, price = line.quotePrice !== line.poPrice;
      if (quantity || price) line.changeType = "Modified";
      else if (["Added", "Removed"].includes(line.changeType)) throw new Error("Added/removed line references both documents.");
      if (quantity && price) counts.compoundChanges++;
      else if (quantity) counts.quantityChanges++;
      else if (price) counts.priceChanges++;
    }
    return line;
  });
  return { ...result, comparisonResults, discrepancyBreakdown: counts };
}
