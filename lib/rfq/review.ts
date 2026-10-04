import type { StoredSourceDocument } from "@/lib/documents/source-types";

/** Versioned extraction review. This is business data, never AI telemetry. */
export interface ReviewFields {
  itemNumber: string;
  specifications: string;
  quantity: number;
  unit: string;
  currency?: string;
}
export interface RfqReview {
  version: 1;
  sourceText: string;
  fileName: string | null;
  sourceKind: "parser" | "model" | "legacy";
  warnings: string[];
  originals: ReviewFields[];
  itemNumbers?: string[];
  sourceDocument?: StoredSourceDocument;
  currencies: string[];
  selectedLine: number;
  status: "pending" | "confirmed" | "rejected";
  decisionAt: string | null;
  decisionBy: string | null;
  requestKey: string | null;
  edits: Array<{ at: string; actorId: string; line: number; before: ReviewFields; after: ReviewFields }>;
}
export function readRfqReview(value: unknown): RfqReview | null {
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1) return null;
  return value as RfqReview;
}
export function reviewIssues(lines: ReviewFields[]): string[][] {
  const counts = new Map<string, number>();
  const key = (line: ReviewFields) => `${line.specifications.trim().toLowerCase()}|${line.quantity}|${line.unit.trim().toUpperCase()}`;
  for (const line of lines) counts.set(key(line), (counts.get(key(line)) ?? 0) + 1);
  return lines.map((line) => [
    ...(!line.specifications.trim() ? ["Description missing"] : []),
    ...(!Number.isFinite(line.quantity) || line.quantity <= 0 ? ["Quantity missing or invalid"] : []),
    ...(!line.unit.trim() ? ["Unit missing"] : []),
    ...(line.currency && !/^[A-Z]{3}$/.test(line.currency) ? ["Currency must be a three-letter code"] : []),
    ...((counts.get(key(line)) ?? 0) > 1 ? ["Possible duplicate — verify against source"] : []),
  ]);
}

/** Older reviews may contain an accepted identifier edit only in their history. */
export function reviewedItemNumber(review: RfqReview | null, index: number): string {
  if (typeof review?.itemNumbers?.[index] === "string") return review.itemNumbers[index];
  const lastEdit = review?.edits?.slice().reverse().find(edit => edit.line === index && typeof edit.after?.itemNumber === "string");
  return lastEdit?.after.itemNumber ?? review?.originals[index]?.itemNumber ?? String(index + 1);
}
