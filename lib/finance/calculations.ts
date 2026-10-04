import type { AgingBucket } from "@/types/finance";

export function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (value && typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") {
    return value.toNumber();
  }
  return Number(value ?? 0);
}

export const OPEN_RECEIVABLE_STATUSES = ["Posted", "Sent", "PartiallyPaid", "Overdue", "Disputed"];

export function validCurrency(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value);
}

export function requireCurrency(value: unknown): string {
  if (!validCurrency(value)) throw new Error("A valid three-letter currency is required. Correct the source record before continuing.");
  return value;
}

export type CurrencyTotal = { currency: string | null; amount: number; count: number };

export function totalsByCurrency<T>(rows: T[], amount: (row: T) => number, currency: (row: T) => unknown): CurrencyTotal[] {
  const groups = new Map<string | null, CurrencyTotal>();
  for (const row of rows) {
    const code = currency(row);
    const key = validCurrency(code) ? code : null;
    const group = groups.get(key) ?? { currency: key, amount: 0, count: 0 };
    group.amount = Math.round((group.amount + amount(row)) * 100) / 100;
    group.count++;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => (a.currency ?? "~").localeCompare(b.currency ?? "~"));
}

export function formatCurrencyTotals(totals: CurrencyTotal[]): string {
  return totals.length ? totals.map(total => total.currency ? money(total.amount, total.currency) : `Currency missing or invalid (${total.count} records)`).join(" · ") : "No balance";
}

export function money(value: number, currency?: string | null) {
  if (!validCurrency(currency)) return "Currency missing or invalid";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    currencyDisplay: "code",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function pct(value: number) {
  return `${value.toFixed(1)}%`;
}

export function daysBetween(date: Date, base = new Date()) {
  const a = Date.UTC(base.getFullYear(), base.getMonth(), base.getDate());
  const b = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((a - b) / 86_400_000);
}

export function makeAgingBuckets<T>(
  rows: T[],
  getDueDate: (row: T) => Date,
  getAmount: (row: T) => number,
  labels: string[],
  classify: (daysOverdue: number) => number,
  getCurrency: (row: T) => unknown,
): AgingBucket[] {
  const groups = new Map<string | null, AgingBucket[]>();
  for (const row of rows) {
    const value = getCurrency(row);
    const currency = validCurrency(value) ? value : null;
    const buckets = groups.get(currency) ?? labels.map(label => ({ label, currency, amount: 0, count: 0 }));
    const idx = classify(daysBetween(getDueDate(row)));
    buckets[idx].amount = Math.round((buckets[idx].amount + getAmount(row)) * 100) / 100;
    buckets[idx].count += 1;
    groups.set(currency, buckets);
  }
  return [...groups.entries()].sort(([a], [b]) => (a ?? "~").localeCompare(b ?? "~")).flatMap(([, buckets]) => buckets);
}
