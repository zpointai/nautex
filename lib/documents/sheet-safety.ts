/**
 * Spreadsheet parsing safety helpers.
 *
 * Rows returned by `XLSX.utils.sheet_to_json` use the header row as object keys.
 * A malicious upload with a header cell named `__proto__`, `constructor`, or
 * `prototype` can attempt prototype pollution once those rows flow into
 * downstream merges/assignments. SheetJS >= 0.19.3 fixes this at the parser
 * level, but we strip the dangerous keys ourselves as defense-in-depth so the
 * guarantee holds regardless of the installed library version.
 */

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Return a clean own-property copy of a parsed row with dangerous keys removed. */
export function sanitizeParsedRow<T extends Record<string, unknown>>(row: T): T {
  const clean: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    // defineProperty (not assignment) so a literal "__proto__" key can never
    // reach the prototype setter, even if the filter above is ever changed.
    Object.defineProperty(clean, key, {
      value: (row as Record<string, unknown>)[key],
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  return clean as T;
}

/** Sanitize every row produced from an untrusted spreadsheet. */
export function sanitizeParsedRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map(sanitizeParsedRow);
}
