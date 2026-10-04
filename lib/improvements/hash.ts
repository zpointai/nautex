import { createHash } from "node:crypto";

// PostgreSQL JSONB may reorder object keys. Hash the JSON value, not driver order.
export function improvementHash(value: unknown) {
  function canonical(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(canonical);
    if (item !== null && typeof item === "object") return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, canonical(entry)]));
    return item;
  }
  return createHash("sha256").update(JSON.stringify(canonical(JSON.parse(JSON.stringify(value))))).digest("hex");
}
