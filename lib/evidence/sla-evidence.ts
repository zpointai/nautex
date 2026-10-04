export type DelayStatus = "within" | "boundary" | "exceeded" | "critical";
export type EvidenceFileType = "excel" | "pdf" | "screenshot" | "document";
export type EvidenceUiStatus = "complete" | "analyzing" | "error";
export type SlaGrade = "A" | "B" | "C" | "D" | "F";

export interface OrderForSlaEvidence {
  id: string;
  poNumber: string;
  vessel: string;
  supplier: string;
  status: string;
  requestedDate: Date | null;
  confirmedDate: Date | null;
  updatedAt: Date;
  lines: Array<{
    status: string;
    requestedDate: Date | null;
    confirmedDate: Date | null;
    updatedAt: Date;
  }>;
}

export interface ExtractedEvidenceSignals {
  poNumbers: string[];
  evidenceDate: Date | null;
  warnings: string[];
}

export interface EvidenceKpis {
  totalPOs: number;
  withinSlaRate: number;
  onTimeRate: number;
  avgDelayDays: number;
  maxDelayDays: number;
  arrivedCount: number;
}

export interface EvidenceSummary {
  extractedPOs: Array<{
    poNumber: string;
    vesselName: string;
    requestedDeliveryDate?: string;
    evidenceDate?: string;
    delayDays: number;
    arrivedStatus: "Arrived" | "Pending";
  }>;
  kpis: EvidenceKpis;
  delayDistribution: Array<{ bucket: string; count: number; slaStatus: DelayStatus }>;
  grade: SlaGrade;
}

export interface EvidenceMetricsPayload extends EvidenceSummary {
  evidenceDate?: string;
}

const DATE_PATTERNS = [
  /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g,
  /\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/g,
];

function startOfDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function startOfToday() {
  return startOfDay(new Date());
}

function daysBetween(start: Date, end: Date) {
  return Math.max(0, Math.ceil((startOfDay(end).getTime() - startOfDay(start).getTime()) / 86400000));
}

function isPlausibleDate(date: Date) {
  return !Number.isNaN(date.getTime()) && date.getFullYear() >= 2020 && date.getFullYear() <= 2035;
}

function parseEvidenceDate(text: string) {
  const candidates: Array<{ date: Date; index: number; score: number }> = [];
  const lower = text.toLowerCase();

  for (const pattern of DATE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      let date: Date | null = null;
      if (match[0].includes("-")) {
        date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
      } else {
        date = new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
      }
      if (!isPlausibleDate(date)) continue;
      const context = lower.slice(Math.max(0, match.index! - 40), match.index! + 60);
      const score = /(delivered|delivery|received|arrival|arrived|pod|proof)/i.test(context) ? 2 : 1;
      candidates.push({ date, index: match.index ?? 0, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  return candidates[0]?.date ?? null;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function fileTypeFor(fileName: string, mimeType = ""): EvidenceFileType {
  const lowerName = fileName.toLowerCase();
  const lowerMime = mimeType.toLowerCase();
  if (lowerMime.includes("pdf") || lowerName.endsWith(".pdf")) return "pdf";
  if (lowerMime.includes("image") || /\.(png|jpe?g|webp|gif)$/i.test(lowerName)) return "screenshot";
  if (lowerMime.includes("spreadsheet") || lowerMime.includes("excel") || /\.(xlsx?|csv)$/i.test(lowerName)) return "excel";
  return "document";
}

export function extractEvidenceSignals(text: string, knownPoNumbers: string[] = []): ExtractedEvidenceSignals {
  const normalizedText = text || "";
  const matches = new Set<string>();

  for (const poNumber of knownPoNumbers) {
    if (!poNumber.trim()) continue;
    const pattern = new RegExp(`\\b${escapeRegex(poNumber)}\\b`, "i");
    if (pattern.test(normalizedText)) matches.add(poNumber);
  }

  for (const match of normalizedText.matchAll(/\b(?:[A-Z]{2,6}-)?PO[-\s]?\d{3,}\b/gi)) {
    matches.add(match[0].replace(/\s+/g, "-").toUpperCase());
  }

  const evidenceDate = parseEvidenceDate(normalizedText);
  const warnings: string[] = [];
  if (!normalizedText.trim()) warnings.push("No selectable text was extracted from the evidence file.");
  if (!evidenceDate) warnings.push("No delivery or received date was detected in the evidence text.");
  if (matches.size === 0) warnings.push("No purchase order number was detected in the evidence text.");

  return {
    poNumbers: Array.from(matches),
    evidenceDate,
    warnings,
  };
}

export function delayDaysFor(requestedDate: Date | null, status: string, completedDate?: Date | null) {
  if (!requestedDate) return 0;
  if (completedDate) return daysBetween(requestedDate, completedDate);
  if (status === "Delivered") return 0;
  return daysBetween(requestedDate, startOfToday());
}

export function gradeFor(rate: number, maxDelayDays: number): SlaGrade {
  if (rate >= 95 && maxDelayDays <= 1) return "A";
  if (rate >= 85 && maxDelayDays <= 3) return "B";
  if (rate >= 70 && maxDelayDays <= 7) return "C";
  if (rate >= 50) return "D";
  return "F";
}

export function bucketFor(delayDays: number): { bucket: string; slaStatus: DelayStatus } {
  if (delayDays <= 0) return { bucket: "On time", slaStatus: "within" };
  if (delayDays <= 2) return { bucket: "1-2 days late", slaStatus: "boundary" };
  if (delayDays <= 7) return { bucket: "3-7 days late", slaStatus: "exceeded" };
  return { bucket: "8+ days late", slaStatus: "critical" };
}

function orderDelay(order: OrderForSlaEvidence, evidenceDate: Date | null) {
  return Math.max(
    0,
    ...order.lines.map((line) => delayDaysFor(line.requestedDate, line.status, evidenceDate ?? line.confirmedDate ?? line.updatedAt)),
    delayDaysFor(order.requestedDate, order.status, evidenceDate ?? order.confirmedDate ?? order.updatedAt),
  );
}

export function summarizeOrders(orders: OrderForSlaEvidence[], evidenceDate: Date | null = null): EvidenceSummary {
  const extractedPOs = orders.map((order) => {
    const delayDays = orderDelay(order, evidenceDate);
    const arrivedStatus: "Arrived" | "Pending" = evidenceDate || order.status === "Delivered" ? "Arrived" : "Pending";
    return {
      poNumber: order.poNumber,
      vesselName: order.vessel,
      requestedDeliveryDate: order.requestedDate?.toISOString(),
      evidenceDate: evidenceDate?.toISOString(),
      delayDays,
      arrivedStatus,
    };
  });

  const totalPOs = extractedPOs.length;
  const arrivedCount = extractedPOs.filter((po) => po.arrivedStatus === "Arrived").length;
  const withinSlaCount = extractedPOs.filter((po) => po.delayDays <= 2).length;
  const onTimeCount = extractedPOs.filter((po) => po.delayDays === 0).length;
  const maxDelayDays = Math.max(0, ...extractedPOs.map((po) => po.delayDays));
  const avgDelayDays = totalPOs > 0
    ? Math.round((extractedPOs.reduce((sum, po) => sum + po.delayDays, 0) / totalPOs) * 10) / 10
    : 0;
  const withinSlaRate = totalPOs > 0 ? Math.round((withinSlaCount / totalPOs) * 100) : 0;
  const onTimeRate = totalPOs > 0 ? Math.round((onTimeCount / totalPOs) * 100) : 0;
  const buckets = new Map<string, { bucket: string; count: number; slaStatus: DelayStatus }>();

  for (const po of extractedPOs) {
    const bucket = bucketFor(po.delayDays);
    const current = buckets.get(bucket.bucket) ?? { ...bucket, count: 0 };
    current.count += 1;
    buckets.set(bucket.bucket, current);
  }

  return {
    extractedPOs,
    kpis: { totalPOs, withinSlaRate, onTimeRate, avgDelayDays, maxDelayDays, arrivedCount },
    delayDistribution: Array.from(buckets.values()),
    grade: gradeFor(withinSlaRate, maxDelayDays),
  };
}

export function buildMetricsPayload(orders: OrderForSlaEvidence[], evidenceDate: Date | null): EvidenceMetricsPayload {
  const summary = summarizeOrders(orders, evidenceDate);
  return {
    ...summary,
    evidenceDate: evidenceDate?.toISOString(),
  };
}

export function statusForUi(status: string): EvidenceUiStatus {
  if (status === "Processing") return "analyzing";
  if (status === "Failed") return "error";
  return "complete";
}

export function evidenceLifecycleLabel(status: string) {
  if (status === "NeedsReview") return "Needs review";
  return status;
}

export function trimExtractedText(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 20000) : null;
}
