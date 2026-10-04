"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import type { Supplier, SupplierStatus, EnrichmentState } from "@/types/erp";
import { openExternalUrl } from "@/lib/client/desktop";
import { COLORS } from "@/lib/design/tokens";
import { JevReviewPanel } from "@/components/jev-review-panel";

/* ═══════════════════════════════════════════════════════════════
   SUPPLIER INTELLIGENCE MODULE — v5
   Maps Grounding + 3D-Ready Architecture
   ═══════════════════════════════════════════════════════════════ */

type ViewMode = "list" | "grid" | "map";
type StatusFilter = "All" | SupplierStatus;
type SupplierFocusFilter = "All" | "Ready" | "Review" | "Gaps" | "Coverage" | "Linked";
type Tab = "overview" | "contacts" | "performance" | "history";
type SupplierRiskTone = "low" | "medium" | "high";

interface PortCoverageStat {
  port: string;
  supplierCount: number;
  readyCount: number;
  linkedOrders: number;
  avgLeadTime: number;
}

interface DuplicateSupplierGroup {
  key: string;
  reason: string;
  suppliers: Supplier[];
}

interface RecordContextDetail {
  moduleKey?: string;
  id?: string;
}

/* ── Match pipeline types (client-side) ─────────────────────── */

interface MatchCandidateUI {
  id: string;
  rank: number;
  sourceTag: string;
  name: string;
  region: string | null;
  country: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  contactPerson: string | null;
  description: string | null;
  categories: string[];
  portsCovered: string[];
  lat: number | null;
  lng: number | null;
  overallScore: number;
  confidenceBand: string;
  scoreBreakdown: Record<string, number>;
  explanation: string;
  conflicts: Array<{ field: string; issue: string; severity: string }> | null;
  missingFields: string[];
  existingSupplierId: string | null;
  outcome: string;
  identitySignals?: {
    nameExact: boolean;
    nameContains: boolean;
    nameWordOverlap: number;
    domainMatch: boolean;
    placesVerified: boolean;
    phoneVerified: boolean;
    sourceAgreement: number;
  };
}

interface MatchRunUI {
  id: string;
  query: Record<string, string>;
  source: string;
  status: string;
  candidateCount: number;
  candidates: MatchCandidateUI[];
  createdAt: string;
  completedAt: string | null;
}

type MemoryConfidence = "manual" | "confirmed" | "learned" | "suggested";

interface SupplierMemoryCandidate {
  id?: string;
  name?: string;
  sourceTag?: string;
  outcome?: string;
  score?: number;
}

interface SupplierMemoryRecord {
  id: string;
  agent: string;
  module: string;
  memoryType: string;
  memoryKey: string;
  confidence: MemoryConfidence;
  source: string;
  observations: number;
  lastObservedAt: string;
  payload: Record<string, unknown>;
}

interface SupplierMemoryTotals {
  feedbackCount: number;
  sourceCount: number;
  acceptRate: number;
  rejectRate: number;
  editRate: number;
}

/* ── Lazy-load Leaflet (SSR-incompatible) ────────────────────── */

const SupplierMapView = dynamic(() => import("./supplier-map").then((m) => m.SupplierMapView), { ssr: false });
const SupplierMiniMap = dynamic(() => import("./supplier-map").then((m) => m.SupplierMiniMap), { ssr: false });
const SupplierProfileMap = dynamic(() => import("./supplier-map").then((m) => m.SupplierProfileMap), { ssr: false });

/* ── Design tokens ───────────────────────────────────────────── */

const STATUS_STYLE: Record<string, string> = {
  Active:       "bg-success/20 text-success border-success/30",
  Verified:     "bg-info/20 text-info border-info/30",
  Suggested:    "bg-ai/20 text-ai border-ai/30",
  Watch:        "bg-warning/20 text-warning border-warning/30",
  Inactive:     "bg-white/10 text-on-surface-variant border-white/20",
  Blocked:      "bg-error/30 text-error border-error/40",
  Rejected:     "bg-error/20 text-error border-error/30",
  Needs_Review: "bg-warning/20 text-warning border-warning/30",
};

/* ── Canonical maritime region taxonomy ─────────────────────── */

const MARITIME_REGIONS: string[] = [
  "Northwest Europe",
  "Scandinavia / Nordic",
  "Mediterranean",
  "Southeast Europe / Black Sea",
  "Middle East",
  "East Africa",
  "West Africa",
  "Southern Africa",
  "Indian Subcontinent",
  "Southeast Asia",
  "East Asia",
  "Gulf of Mexico",
  "Caribbean",
  "South America",
  "Central America",
  "North America Atlantic",
  "North America Pacific",
  "Pacific",
];

const ENRICHMENT_STYLE: Record<EnrichmentState, { label: string; color: string }> = {
  None:      { label: "Not Enriched", color: "text-on-surface-variant" },
  Pending:   { label: "Queued",       color: "text-warning" },
  Enriching: { label: "Enriching...", color: "text-info animate-pulse" },
  Enriched:  { label: "Enriched",     color: "text-success" },
  Failed:    { label: "Failed",       color: "text-error" },
};

function scoreBadge(score: number) {
  if (score >= 90) return "text-success";
  if (score >= 70) return "text-warning";
  return "text-error";
}

function confidencePct(c: number | null) {
  if (c === null || c === undefined) return "\u2014";
  return `${Math.round(c * 100)}%`;
}

function statusLabel(s: string) {
  if (s === "Blocked") return "Archived";
  return s.replace("_", " ");
}

type ReadinessTone = "ready" | "review" | "blocked";

function supplierReadiness(s: Supplier): { label: string; tone: ReadinessTone; issues: string[] } {
  const issues: string[] = [];
  if (!s.email && !s.phone) issues.push("No ordering contact");
  if (s.portsCovered.length === 0) issues.push("No port coverage");
  if (s.categories.length === 0) issues.push("No supply categories");
  if (s.lat === null || s.lng === null) issues.push("No verified location");
  if (s.status === "Blocked" || s.status === "Rejected") issues.push("Unavailable supplier");
  if (s.status === "Watch" || s.status === "Needs_Review") issues.push("Needs buyer review");
  if (s.status === "Suggested") issues.push("Suggested supplier not approved");
  if (s.status === "Inactive") issues.push("Inactive supplier");

  if (s.status === "Blocked" || s.status === "Rejected" || issues.length >= 3) {
    return { label: "Not RFQ-ready", tone: "blocked", issues };
  }
  if (issues.length > 0 || s.score < 75) {
    return { label: "Review before RFQ", tone: "review", issues };
  }
  return { label: "RFQ-ready", tone: "ready", issues };
}

function readinessClass(tone: ReadinessTone) {
  if (tone === "ready") return "bg-success/15 text-success border-success/25";
  if (tone === "review") return "bg-warning/15 text-warning border-warning/25";
  return "bg-error/15 text-error border-error/25";
}

function supplierFocusLabel(filter: SupplierFocusFilter) {
  if (filter === "Ready") return "RFQ-ready";
  if (filter === "Review") return "Buyer review";
  if (filter === "Gaps") return "Profile gaps";
  if (filter === "Coverage") return "Port coverage";
  if (filter === "Linked") return "Linked POs";
  return "All";
}

function supplierRisk(s: Supplier): { label: string; tone: SupplierRiskTone; score: number; reasons: string[] } {
  const readiness = supplierReadiness(s);
  const reasons: string[] = [];
  let score = 0;

  if (readiness.tone === "blocked") {
    score += 45;
    reasons.push("Not RFQ-ready");
  } else if (readiness.tone === "review") {
    score += 25;
    reasons.push("Needs buyer review");
  }

  if (s.status === "Watch" || s.status === "Needs_Review") {
    score += 20;
    reasons.push("Watch status");
  }
  if (s.status === "Suggested") {
    score += 15;
    reasons.push("Not approved yet");
  }
  if (s.status === "Inactive") {
    score += 20;
    reasons.push("Inactive profile");
  }
  if (s.status === "Blocked" || s.status === "Rejected") {
    score += 35;
    reasons.push("Unavailable supplier");
  }
  if (s.score < 60) {
    score += 20;
    reasons.push("Low profile score");
  } else if (s.score < 75) {
    score += 10;
    reasons.push("Moderate profile score");
  }
  if (s.leadTimeDays >= 8) {
    score += 15;
    reasons.push("Long lead time");
  } else if (s.leadTimeDays >= 5) {
    score += 8;
    reasons.push("Extended lead time");
  }
  if ((s._count?.purchaseOrders ?? 0) === 0 && (s._count?.supplierQuotes ?? 0) === 0) {
    score += 6;
    reasons.push("No transaction history");
  }

  const normalizedScore = Math.min(100, score);
  if (normalizedScore >= 60) return { label: "High risk", tone: "high", score: normalizedScore, reasons };
  if (normalizedScore >= 30) return { label: "Medium risk", tone: "medium", score: normalizedScore, reasons };
  return { label: "Low risk", tone: "low", score: normalizedScore, reasons };
}

function riskClass(tone: SupplierRiskTone) {
  if (tone === "high") return "bg-error/15 text-error border-error/25";
  if (tone === "medium") return "bg-warning/15 text-warning border-warning/25";
  return "bg-success/15 text-success border-success/25";
}

function supplierDomain(s: Supplier) {
  const website = normalizeUrl(s.website);
  if (!website) return null;
  try {
    return new URL(website).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function normalizeSupplierName(value: string) {
  return value
    .toLowerCase()
    .replace(/\b(bv|b\.v\.|ltd|limited|llc|inc|gmbh|sa|s\.a\.|as|a\/s|co|company|marine|maritime|ship|shipping|supply|supplies|stores|chandler|chandlers)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function findDuplicateSupplierGroups(suppliers: Supplier[]): DuplicateSupplierGroup[] {
  const groups = new Map<string, DuplicateSupplierGroup>();

  for (const supplier of suppliers) {
    const domain = supplierDomain(supplier);
    const normalizedName = normalizeSupplierName(supplier.name);
    const location = `${supplier.country ?? ""}|${supplier.city ?? ""}`.toLowerCase();
    const candidates: Array<{ key: string; reason: string }> = [];

    if (domain) candidates.push({ key: `domain:${domain}`, reason: `Shared website domain ${domain}` });
    if (normalizedName.length >= 5) candidates.push({ key: `name:${normalizedName}|${location}`, reason: "Similar name and location" });

    for (const candidate of candidates) {
      const group = groups.get(candidate.key) ?? { key: candidate.key, reason: candidate.reason, suppliers: [] };
      if (!group.suppliers.some((s) => s.id === supplier.id)) group.suppliers.push(supplier);
      groups.set(candidate.key, group);
    }
  }

  return Array.from(groups.values())
    .filter((group) => group.suppliers.length > 1)
    .sort((a, b) => b.suppliers.length - a.suppliers.length);
}

function buildPortCoverageStats(suppliers: Supplier[]): PortCoverageStat[] {
  const portMap = new Map<string, { port: string; supplierIds: Set<string>; readyIds: Set<string>; linkedOrders: number; leadTimeTotal: number; leadTimeCount: number }>();

  for (const supplier of suppliers) {
    for (const rawPort of supplier.portsCovered) {
      const port = rawPort.trim();
      if (!port) continue;
      const key = port.toLowerCase();
      const stat = portMap.get(key) ?? { port, supplierIds: new Set<string>(), readyIds: new Set<string>(), linkedOrders: 0, leadTimeTotal: 0, leadTimeCount: 0 };
      if (!stat.supplierIds.has(supplier.id)) {
        stat.supplierIds.add(supplier.id);
        if (supplierReadiness(supplier).tone === "ready") stat.readyIds.add(supplier.id);
        stat.linkedOrders += supplier._count?.purchaseOrders ?? 0;
        if (supplier.leadTimeDays > 0) {
          stat.leadTimeTotal += supplier.leadTimeDays;
          stat.leadTimeCount += 1;
        }
      }
      portMap.set(key, stat);
    }
  }

  return Array.from(portMap.values())
    .map((stat) => ({
      port: stat.port,
      supplierCount: stat.supplierIds.size,
      readyCount: stat.readyIds.size,
      linkedOrders: stat.linkedOrders,
      avgLeadTime: stat.leadTimeCount > 0 ? Math.round((stat.leadTimeTotal / stat.leadTimeCount) * 10) / 10 : 0,
    }))
    .sort((a, b) => b.supplierCount - a.supplierCount || b.readyCount - a.readyCount || a.port.localeCompare(b.port));
}

function supplierProcurementInsights(s: Supplier) {
  const readiness = supplierReadiness(s);
  const risk = supplierRisk(s);
  const agreementCount = (s._count?.contracts ?? 0) + (s._count?.agreementVersions ?? 0);
  const bestCategories = s.categories.slice(0, 3);
  const purchaseActivity = s._count?.purchaseOrders ?? 0;
  const quoteActivity = s._count?.supplierQuotes ?? 0;
  const hasAgreement = agreementCount > 0;
  const recommendedUse =
    readiness.tone === "ready" && risk.tone === "low"
      ? "Can be considered for supervised RFQ routing."
      : readiness.tone === "ready"
        ? "Usable for RFQ routing after buyer review of risk signals."
        : "Resolve readiness gaps before routing critical orders.";

  return {
    bestCategories,
    agreementLabel: hasAgreement ? `${agreementCount} agreement record${agreementCount === 1 ? "" : "s"}` : "No active agreement record",
    purchaseLabel: purchaseActivity > 0 || quoteActivity > 0
      ? `${purchaseActivity} POs, ${quoteActivity} quotes`
      : "No purchase or quote history",
    recommendedUse,
    gaps: readiness.issues,
  };
}

/** Normalize a URL for safe external linking */
function normalizeUrl(url: string | null): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function memoryCandidates(record: SupplierMemoryRecord): SupplierMemoryCandidate[] {
  const candidates = record.payload.candidates;
  if (!Array.isArray(candidates)) return [];
  return candidates
    .filter((candidate): candidate is Record<string, unknown> => !!candidate && typeof candidate === "object")
    .map((candidate) => ({
      id: typeof candidate.id === "string" ? candidate.id : undefined,
      name: typeof candidate.name === "string" ? candidate.name : undefined,
      sourceTag: typeof candidate.sourceTag === "string" ? candidate.sourceTag : undefined,
      outcome: typeof candidate.outcome === "string" ? candidate.outcome : undefined,
      score: typeof candidate.score === "number" ? candidate.score : undefined,
    }));
}

function supplierMemoryMatch(record: SupplierMemoryRecord, supplier: Supplier) {
  const normalizedSupplier = normalizeSupplierName(supplier.name);
  const memoryKey = record.memoryKey.toLowerCase();
  const savedSupplierId = typeof record.payload.savedSupplierId === "string" ? record.payload.savedSupplierId : null;
  if (savedSupplierId === supplier.id || memoryKey.includes(supplier.id.toLowerCase())) return true;
  if (normalizedSupplier.length >= 5 && memoryKey.includes(normalizedSupplier)) return true;

  return memoryCandidates(record).some((candidate) => {
    const normalizedCandidate = normalizeSupplierName(candidate.name ?? "");
    return normalizedCandidate.length >= 5 && (
      normalizedCandidate === normalizedSupplier ||
      normalizedCandidate.includes(normalizedSupplier) ||
      normalizedSupplier.includes(normalizedCandidate)
    );
  });
}

function supplierMemoryCandidate(record: SupplierMemoryRecord, supplier: Supplier) {
  const normalizedSupplier = normalizeSupplierName(supplier.name);
  return memoryCandidates(record).find((candidate) => {
    const normalizedCandidate = normalizeSupplierName(candidate.name ?? "");
    return normalizedCandidate.length >= 5 && (
      normalizedCandidate === normalizedSupplier ||
      normalizedCandidate.includes(normalizedSupplier) ||
      normalizedSupplier.includes(normalizedCandidate)
    );
  });
}

function supplierMemoryDescription(record: SupplierMemoryRecord, supplier: Supplier) {
  if (record.memoryType === "source_reliability") {
    const reliability = typeof record.payload.reliability === "number" ? Math.round(record.payload.reliability * 100) : null;
    const accepts = typeof record.payload.accepts === "number" ? record.payload.accepts : 0;
    const rejects = typeof record.payload.rejects === "number" ? record.payload.rejects : 0;
    const edits = typeof record.payload.edits === "number" ? record.payload.edits : 0;
    return `${reliability ?? "-"}% source reliability from ${accepts} accepted, ${rejects} rejected, and ${edits} edited routing signals.`;
  }

  const status = typeof record.payload.status === "string" ? record.payload.status : "tracked";
  const candidate = supplierMemoryCandidate(record, supplier);
  if (candidate) {
    const score = typeof candidate.score === "number" ? ` at ${Math.round(candidate.score)}% score` : "";
    return `${supplier.name} appeared in a ${status.toLowerCase()} supplier-routing run${score}.`;
  }
  return `${status} supplier-routing memory retained for this supplier context.`;
}

function candidateMemoryMatch(record: SupplierMemoryRecord, candidate: MatchCandidateUI) {
  const normalizedCandidate = normalizeSupplierName(candidate.name);
  const memoryKey = record.memoryKey.toLowerCase();
  if (candidate.existingSupplierId && memoryKey.includes(candidate.existingSupplierId.toLowerCase())) return true;
  if (candidate.sourceTag && memoryKey.includes(candidate.sourceTag.toLowerCase())) return true;
  if (normalizedCandidate.length >= 5 && memoryKey.includes(normalizedCandidate)) return true;

  return memoryCandidates(record).some((memoryCandidate) => {
    if (memoryCandidate.id && memoryCandidate.id === candidate.id) return true;
    if (candidate.existingSupplierId && memoryCandidate.id === candidate.existingSupplierId) return true;
    if (memoryCandidate.sourceTag && memoryCandidate.sourceTag === candidate.sourceTag) return true;

    const normalizedMemoryCandidate = normalizeSupplierName(memoryCandidate.name ?? "");
    return normalizedMemoryCandidate.length >= 5 && (
      normalizedMemoryCandidate === normalizedCandidate ||
      normalizedMemoryCandidate.includes(normalizedCandidate) ||
      normalizedCandidate.includes(normalizedMemoryCandidate)
    );
  });
}

function candidateMemoryDescription(record: SupplierMemoryRecord, candidate: MatchCandidateUI) {
  if (record.memoryType === "source_reliability") {
    const reliability = typeof record.payload.reliability === "number" ? Math.round(record.payload.reliability * 100) : null;
    const accepts = typeof record.payload.accepts === "number" ? record.payload.accepts : 0;
    const rejects = typeof record.payload.rejects === "number" ? record.payload.rejects : 0;
    const edits = typeof record.payload.edits === "number" ? record.payload.edits : 0;
    return `${candidate.sourceTag} source has ${reliability ?? "-"}% learned reliability from ${accepts} accepted, ${rejects} rejected, and ${edits} edited decisions.`;
  }

  const status = typeof record.payload.status === "string" ? record.payload.status : "tracked";
  const matchedCandidate = memoryCandidates(record).find((memoryCandidate) => {
    const normalizedMemoryCandidate = normalizeSupplierName(memoryCandidate.name ?? "");
    const normalizedCandidate = normalizeSupplierName(candidate.name);
    return normalizedMemoryCandidate.length >= 5 && (
      normalizedMemoryCandidate === normalizedCandidate ||
      normalizedMemoryCandidate.includes(normalizedCandidate) ||
      normalizedCandidate.includes(normalizedMemoryCandidate)
    );
  });
  const score = typeof matchedCandidate?.score === "number" ? ` at ${Math.round(matchedCandidate.score)}% score` : "";
  return `${candidate.name} appeared in a ${status.toLowerCase()} supplier-routing run${score}.`;
}

function memoryConfidenceClass(confidence: MemoryConfidence) {
  if (confidence === "manual" || confidence === "confirmed") return "bg-success/10 text-success border-success/20";
  if (confidence === "learned") return "bg-warning/10 text-warning border-warning/20";
  return "bg-white/5 text-on-surface-variant border-white/10";
}

function memoryTypeLabel(value: string) {
  return value.replace(/_/g, " ");
}

/* ── SVG icons ───────────────────────────────────────────────── */

function IcSearch() { return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>; }
function IcPlus() { return <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M12 5v14m-7-7h14" /></svg>; }
function IcList() { return <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M4 6h16M4 12h16M4 18h16" /></svg>; }
function IcGrid() { return <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>; }
function IcMap() { return <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="m9 18-6 3V7l6-3m0 14 6 3m-6-3V4m6 17 6-3V2l-6 3m0 16V5M3 4l6-3 6 3 6-3" /></svg>; }
function IcClose() { return <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M6 18L18 6M6 6l12 12" /></svg>; }
function IcPin() { return <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>; }
function IcWand() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m15 4-1 1m-3-2.5.5 1.5M9 3l-.5 1.5M4 9l1.5-.5M3 12l1.5.5M21 12l-1.5-.5M19.5 4.5l-1 1M12 21l-9-9 9.5-9.5L22 12l-9.5 9z" /></svg>; }
function IcCheck() { return <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path d="M5 13l4 4L19 7" /></svg>; }
function IcChevron() { return <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M9 5l7 7-7 7" /></svg>; }
function IcArrowLeft() { return <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M19 12H5m7-7-7 7 7 7" /></svg>; }
function IcEdit() { return <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>; }
function IcGlobe() { return <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>; }
function IcMail() { return <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></svg>; }
function IcPhone() { return <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" /></svg>; }
function IcStar() { return <svg width="14" height="14" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>; }
function IcTrash() { return <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6" /></svg>; }
function IcArchive() { return <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" /></svg>; }
function IcTarget() { return <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg>; }
function IcThumbUp() { return <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" /></svg>; }
function IcThumbDown() { return <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" /></svg>; }

/* ═══════════════════════════════════════════════════════════════
   MAIN MODULE
   ═══════════════════════════════════════════════════════════════ */

export function SupplierDirectoryModule() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [supplierFocus, setSupplierFocus] = useState<SupplierFocusFilter>("All");
  const [regionFilter, setRegionFilter] = useState("");
  const [selectedPort, setSelectedPort] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const [moduleError, setModuleError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showMatch, setShowMatch] = useState(false);
  const [dismissedDuplicateKeys, setDismissedDuplicateKeys] = useState<Set<string>>(() => new Set());
  const isFirstLoad = useRef(true);

  // Debounce search input — keeps the UI responsive while typing
  useEffect(() => {
    if (isFirstLoad.current) { setDebouncedSearch(search); return; }
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const loadSuppliers = useCallback(async () => {
    setFetching(true);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("q", debouncedSearch);
      if (statusFilter !== "All") params.set("status", statusFilter);
      if (regionFilter) params.set("region", regionFilter);
      params.set("limit", "100");
      params.set("sort", "score");
      params.set("order", "desc");
      const res = await fetch(`/api/v1/suppliers?${params}`);
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        throw new Error(json.error?.message || json.error || "Failed to fetch suppliers.");
      }
      setSuppliers(json.data ?? []);
      setModuleError(null);
    } catch (err) {
      setModuleError(err instanceof Error ? err.message : "Supplier directory could not be loaded.");
      setSuppliers([]);
    } finally {
      setLoading(false);
      setFetching(false);
      isFirstLoad.current = false;
    }
  }, [debouncedSearch, statusFilter, regionFilter]);

  // Trigger fetch when debounced search or filters change — no jitter
  useEffect(() => { loadSuppliers(); }, [loadSuppliers]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const openFromHash = () => {
      const hash = window.location.hash.replace(/^#/, "");
      const [moduleKey, id] = hash.split(":");
      if (moduleKey === "suppliers" && id) {
        setSelectedId(decodeURIComponent(id));
        setShowCreate(false);
        setShowMatch(false);
      }
    };

    const handleRecordContext = (event: Event) => {
      const detail = (event as CustomEvent<RecordContextDetail>).detail;
      if (detail?.moduleKey === "suppliers" && detail.id) {
        setSelectedId(detail.id);
        setShowCreate(false);
        setShowMatch(false);
      }
    };

    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    window.addEventListener("nautex:record-context", handleRecordContext);
    return () => {
      window.removeEventListener("hashchange", openFromHash);
      window.removeEventListener("nautex:record-context", handleRecordContext);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadSelectedSupplier() {
      if (!selectedId) {
        setSelectedSupplier(null);
        setSelectedLoading(false);
        return;
      }

      const local = suppliers.find((s) => s.id === selectedId);
      if (local) {
        setSelectedSupplier(local);
        setSelectedLoading(false);
        return;
      }

      setSelectedLoading(true);
      try {
        const res = await fetch(`/api/v1/suppliers/${encodeURIComponent(selectedId)}`);
        const json = await res.json();
        if (!res.ok || json.ok === false || !json.data) {
          throw new Error(json.error?.message || json.error || "Supplier record could not be opened.");
        }
        if (!cancelled) {
          setSelectedSupplier(json.data);
          setModuleError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setModuleError(err instanceof Error ? err.message : "Supplier record could not be opened.");
          setSelectedSupplier(null);
          setSelectedId(null);
        }
      } finally {
        if (!cancelled) setSelectedLoading(false);
      }
    }

    loadSelectedSupplier();
    return () => { cancelled = true; };
  }, [selectedId, suppliers]);

  const supplierMetrics = useMemo(() => {
    const rfqReady = suppliers.filter((s) => supplierReadiness(s).tone === "ready").length;
    const needsReview = suppliers.filter((s) => {
      const readiness = supplierReadiness(s);
      return s.status === "Watch" || s.status === "Needs_Review" || readiness.tone !== "ready";
    }).length;
    const uniquePorts = new Set(suppliers.flatMap((s) => s.portsCovered.map((p) => p.trim()).filter(Boolean))).size;
    const missingProfiles = suppliers.filter((s) => supplierReadiness(s).issues.length > 0).length;
    const linkedOrders = suppliers.reduce((sum, s) => sum + (s._count?.purchaseOrders ?? 0), 0);
    return { rfqReady, needsReview, uniquePorts, missingProfiles, linkedOrders };
  }, [suppliers]);

  const portStats = useMemo(() => buildPortCoverageStats(suppliers), [suppliers]);
  const duplicateGroups = useMemo(() => findDuplicateSupplierGroups(suppliers), [suppliers]);
  const visibleDuplicateGroups = useMemo(
    () => duplicateGroups.filter((group) => !dismissedDuplicateKeys.has(group.key)),
    [dismissedDuplicateKeys, duplicateGroups],
  );

  const visibleSuppliers = useMemo(() => {
    const focusFiltered = supplierFocus === "All" ? suppliers : suppliers.filter((supplier) => {
      const readiness = supplierReadiness(supplier);
      if (supplierFocus === "Ready") return readiness.tone === "ready";
      if (supplierFocus === "Review") return readiness.tone !== "ready";
      if (supplierFocus === "Coverage") return supplier.portsCovered.length > 0;
      if (supplierFocus === "Linked") return (supplier._count?.purchaseOrders ?? 0) > 0;
      return readiness.issues.length > 0;
    });
    if (!selectedPort) return focusFiltered;
    const portKey = selectedPort.toLowerCase();
    return focusFiltered.filter((supplier) => supplier.portsCovered.some((port) => port.trim().toLowerCase() === portKey));
  }, [suppliers, supplierFocus, selectedPort]);

  const selectedPortSuppliers = useMemo(() => {
    if (!selectedPort) return [];
    const portKey = selectedPort.toLowerCase();
    const readinessRank: Record<ReadinessTone, number> = { ready: 0, review: 1, blocked: 2 };
    return suppliers
      .filter((supplier) => supplier.portsCovered.some((port) => port.trim().toLowerCase() === portKey))
      .sort((a, b) => {
        const ar = supplierReadiness(a);
        const br = supplierReadiness(b);
        return readinessRank[ar.tone] - readinessRank[br.tone] || supplierRisk(a).score - supplierRisk(b).score || b.score - a.score || a.leadTimeDays - b.leadTimeDays;
      });
  }, [suppliers, selectedPort]);

  // Collect unique regions for filter
  const regions = useMemo(() => {
    const set = new Set<string>();
    visibleSuppliers.forEach((s) => { if (s.region && s.region !== "Unknown") set.add(s.region); });
    return Array.from(set).sort();
  }, [visibleSuppliers]);

  // Suppliers with coordinates for map
  const mappable = useMemo(() => visibleSuppliers.filter((s) => s.lat !== null && s.lng !== null), [visibleSuppliers]);

  if (selectedLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-2 border-success/30 border-t-success rounded-full animate-spin" />
      </div>
    );
  }

  if (selectedSupplier) {
    return (
      <SupplierWorkspace
        supplier={selectedSupplier}
        onBack={() => { setSelectedId(null); setSelectedSupplier(null); }}
        onRefresh={loadSuppliers}
      />
    );
  }

  if (showMatch) {
    return <SupplierMatchFlow onCancel={() => setShowMatch(false)} onAccepted={(supplierId) => { setShowMatch(false); setSelectedId(supplierId); loadSuppliers(); }} />;
  }

  if (showCreate) {
    return <CreateSupplierForm onCancel={() => setShowCreate(false)} onCreated={(s) => { setShowCreate(false); setSelectedId(s.id); loadSuppliers(); }} />;
  }

  if (loading) {
    return <div className="flex items-center justify-center py-24"><div className="w-8 h-8 border-2 border-success/30 border-t-success rounded-full animate-spin" /></div>;
  }

  const statusCounts = visibleSuppliers.reduce((acc, s) => { acc[s.status] = (acc[s.status] || 0) + 1; return acc; }, {} as Record<string, number>);

  return (
    <div className="space-y-4">
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-white">Supplier Intelligence</h2>
          <p className="text-xs text-on-surface-variant">
            {visibleSuppliers.length} supplier{visibleSuppliers.length !== 1 ? "s" : ""} in directory
            {statusCounts.Active ? ` \u00b7 ${statusCounts.Active} active` : ""}
            {statusCounts.Suggested ? ` \u00b7 ${statusCounts.Suggested} suggested` : ""}
            {statusCounts.Blocked ? ` \u00b7 ${statusCounts.Blocked} archived` : ""}
            {debouncedSearch && ` \u00b7 Search: "${debouncedSearch}"`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowMatch(true)} className="px-4 py-2 rounded-lg bg-ai/15 text-ai border border-ai/25 text-sm font-semibold hover:bg-ai/25 transition flex items-center gap-1.5">
            <IcTarget /> Find Supplier
          </button>
          <button onClick={() => setShowCreate(true)} className="px-4 py-2 rounded-lg bg-success text-surface-lowest text-sm font-semibold hover:brightness-110 transition flex items-center gap-1.5">
            <IcPlus /> Add Supplier
          </button>
        </div>
      </div>

      {/* ── Search & filters — z-20 keeps controls above Leaflet maps ── */}
      {moduleError && (
        <div className="rounded-xl bg-error/10 border border-error/25 px-4 py-3 text-sm text-error flex items-center justify-between gap-3">
          <span>{moduleError}</span>
          <button onClick={loadSuppliers} className="px-3 py-1.5 rounded-lg bg-error/10 border border-error/25 text-xs text-error hover:bg-error/20 transition">
            Retry
          </button>
        </div>
      )}

      <SupplierOperationsStrip
        metrics={supplierMetrics}
        onReady={() => { setSupplierFocus("Ready"); setStatusFilter("All"); setRegionFilter(""); setSearch(""); setViewMode("list"); }}
        onReview={() => { setSupplierFocus("Review"); setStatusFilter("All"); setRegionFilter(""); setSearch(""); setViewMode("list"); }}
        onCoverage={() => { setSupplierFocus("Coverage"); setStatusFilter("All"); setRegionFilter(""); setSearch(""); setSelectedPort(portStats[0]?.port ?? ""); setViewMode("list"); }}
        onGaps={() => { setSupplierFocus("Gaps"); setStatusFilter("All"); setRegionFilter(""); setSearch(""); setViewMode("list"); }}
        onLinked={() => { setSupplierFocus("Linked"); setStatusFilter("All"); setRegionFilter(""); setSearch(""); setViewMode("list"); }}
      />

      <div className="flex items-center gap-3 flex-wrap relative z-20">
        <div className="relative flex-1 min-w-[240px]">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant"><IcSearch /></div>
          <input
            type="text"
            placeholder="Search by name, code, region, port, category, email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-surface-container border border-white/10 text-sm text-white placeholder:text-on-surface-variant focus:outline-none focus:border-success/40"
          />
          {/* Subtle fetching indicator — no layout shift */}
          {fetching && <div className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 border-2 border-success/20 border-t-success rounded-full animate-spin" />}
        </div>

        <StatusDropdown value={statusFilter} onChange={setStatusFilter} />

        {supplierFocus !== "All" && (
          <button onClick={() => { setSupplierFocus("All"); setSelectedPort(""); }} className="px-3 py-2.5 rounded-lg bg-success/10 border border-success/20 text-xs text-success font-semibold hover:bg-success/15 transition">
            {supplierFocusLabel(supplierFocus)} filter x
          </button>
        )}

        {/* Region filter */}
        <RegionDropdown value={regionFilter} onChange={setRegionFilter} regions={regions} />

        {/* View toggle: list / grid / map */}
        <div className="flex rounded-lg border border-white/10 overflow-hidden">
          {([["list", IcList, "List"], ["grid", IcGrid, "Grid"], ["map", IcMap, "Map"]] as const).map(([mode, Icon, title]) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode as ViewMode)}
              className={`px-3 py-2 text-sm transition ${viewMode === mode ? "bg-success/15 text-success" : "text-on-surface-variant hover:text-on-surface-variant"}`}
              title={`${title} view`}
            >
              <Icon />
            </button>
          ))}
        </div>
      </div>

      {(supplierFocus === "Coverage" || selectedPort) && portStats.length > 0 && (
        <PortCoverageDrilldown
          ports={portStats}
          selectedPort={selectedPort}
          suppliers={selectedPortSuppliers}
          onSelectPort={(port) => { setSelectedPort(port); setSupplierFocus("Coverage"); }}
          onClear={() => { setSelectedPort(""); setSupplierFocus("All"); }}
          onOpenSupplier={(id) => setSelectedId(id)}
        />
      )}

      {visibleDuplicateGroups.length > 0 && (
        <DuplicateSupplierWatch
          groups={visibleDuplicateGroups}
          onOpenSupplier={(id) => setSelectedId(id)}
          onDismissGroup={(key) => setDismissedDuplicateKeys((current) => new Set(current).add(key))}
        />
      )}

      {/* ── Views — z-0 isolates Leaflet stacking from toolbar z-20 ── */}
      <div className="relative z-0">
      {visibleSuppliers.length === 0 ? (
        <EmptyState onAdd={() => setShowCreate(true)} />
      ) : viewMode === "list" ? (
        <div className="space-y-2">
          {visibleSuppliers.map((s) => (
            <SupplierListRow key={s.id} supplier={s} onSelect={() => setSelectedId(s.id)} />
          ))}
        </div>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {visibleSuppliers.map((s) => (
            <SupplierGridCard key={s.id} supplier={s} onSelect={() => setSelectedId(s.id)} />
          ))}
        </div>
      ) : (
        /* Map view — sourcing workspace */
        <div className="space-y-3">
          <div className="rounded-xl overflow-hidden border border-white/10" style={{ height: 600 }}>
            <SupplierMapView
              suppliers={mappable}
              onSelect={(id) => setSelectedId(id)}
              showHubs={true}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-on-surface-variant px-1">
            <span>
              Showing {mappable.length} of {visibleSuppliers.length} supplier{visibleSuppliers.length !== 1 ? "s" : ""} on map
              {mappable.length < visibleSuppliers.length && ` (${visibleSuppliers.length - mappable.length} missing coordinates)`}
            </span>
            <span className="flex items-center gap-3">
              {[["Active", COLORS.success], ["Verified", COLORS.info], ["Suggested", COLORS.ai], ["Watch", COLORS.accentAmber]].map(([label, color]) => (
                <span key={label} className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full" style={{ background: color as string }} />
                  {label}
                </span>
              ))}
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-white/30" />
                Hub
              </span>
            </span>
          </div>
        </div>
      )}
      </div>{/* end z-0 isolation wrapper */}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DROPDOWNS
   ═══════════════════════════════════════════════════════════════ */

function SupplierOperationsStrip({
  metrics,
  onReady,
  onReview,
  onCoverage,
  onGaps,
  onLinked,
}: {
  metrics: { rfqReady: number; needsReview: number; uniquePorts: number; missingProfiles: number; linkedOrders: number };
  onReady: () => void;
  onReview: () => void;
  onCoverage: () => void;
  onGaps: () => void;
  onLinked: () => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
      <SupplierKpiCard label="RFQ-ready suppliers" value={metrics.rfqReady} hint="Approved records ready for routing" tone="ready" onClick={onReady} />
      <SupplierKpiCard label="Needs buyer review" value={metrics.needsReview} hint="Profile gaps or watch status" tone="review" onClick={onReview} />
      <SupplierKpiCard label="Port coverage" value={metrics.uniquePorts} hint="Open suppliers with mapped ports" tone="neutral" onClick={onCoverage} />
      <SupplierKpiCard label="Profile gaps" value={metrics.missingProfiles} hint="Missing contacts, ports, categories, or location" tone="blocked" onClick={onGaps} />
      <SupplierKpiCard label="Linked PO activity" value={metrics.linkedOrders} hint="Purchase orders tied to suppliers" tone="neutral" onClick={onLinked} />
    </div>
  );
}

function SupplierKpiCard({
  label,
  value,
  hint,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  hint: string;
  tone: "ready" | "review" | "blocked" | "neutral";
  onClick?: () => void;
}) {
  const toneClass =
    tone === "ready" ? "border-success/20 bg-success/5" :
    tone === "review" ? "border-warning/20 bg-warning/5" :
    tone === "blocked" ? "border-error/20 bg-error/5" :
    "border-white/5 bg-surface-container";
  const valueClass =
    tone === "ready" ? "text-success" :
    tone === "review" ? "text-warning" :
    tone === "blocked" ? "text-error" :
    "text-white";

  const content = (
    <>
      <div className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">{label}</div>
      <div className={`text-2xl font-bold ${valueClass}`}>{value}</div>
      <div className="text-[11px] text-on-surface-variant">{hint}</div>
    </>
  );

  if (!onClick) return <div className={`rounded-xl border p-4 space-y-1 ${toneClass}`}>{content}</div>;

  return (
    <button onClick={onClick} className={`text-left rounded-xl border p-4 space-y-1 hover:border-success/35 transition ${toneClass}`}>
      {content}
    </button>
  );
}

function PortCoverageDrilldown({
  ports,
  selectedPort,
  suppliers,
  onSelectPort,
  onClear,
  onOpenSupplier,
}: {
  ports: PortCoverageStat[];
  selectedPort: string;
  suppliers: Supplier[];
  onSelectPort: (port: string) => void;
  onClear: () => void;
  onOpenSupplier: (id: string) => void;
}) {
  const activePort = selectedPort || ports[0]?.port || "";
  const activeStat = ports.find((port) => port.port.toLowerCase() === activePort.toLowerCase()) ?? ports[0];

  return (
    <div className="rounded-xl bg-surface-container border border-white/5 p-4 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-success">
            <IcMap />
            <h3 className="text-sm font-bold text-white">Port Coverage Drilldown</h3>
          </div>
          <p className="text-xs text-on-surface-variant mt-1">Use this to select routing candidates by delivery port, readiness, lead time, and linked PO activity.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={activePort}
            onChange={(event) => onSelectPort(event.target.value)}
            className="min-w-[220px] px-3 py-2 rounded-lg bg-surface-low border border-white/10 text-xs text-white focus:outline-none focus:border-success/40"
          >
            {ports.slice(0, 80).map((port) => (
              <option key={port.port} value={port.port}>{port.port}</option>
            ))}
          </select>
          <button onClick={onClear} className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-on-surface-variant hover:text-white/70 transition">
            Clear
          </button>
        </div>
      </div>

      {activeStat && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <ReadinessMetric label="Suppliers" value={activeStat.supplierCount} />
          <ReadinessMetric label="RFQ-ready" value={activeStat.readyCount} />
          <ReadinessMetric label="Linked POs" value={activeStat.linkedOrders} />
          <ReadinessMetric label="Avg lead time" value={activeStat.avgLeadTime ? `${activeStat.avgLeadTime}d` : "-"} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
        {suppliers.slice(0, 6).map((supplier) => {
          const readiness = supplierReadiness(supplier);
          const risk = supplierRisk(supplier);
          return (
            <button
              key={supplier.id}
              onClick={() => onOpenSupplier(supplier.id)}
              className="text-left rounded-lg bg-surface-low border border-white/5 hover:border-success/25 p-3 transition"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white truncate">{supplier.name}</p>
                  <p className="text-[10px] text-on-surface-variant truncate">{supplier.region}{supplier.country ? `, ${supplier.country}` : ""}</p>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${riskClass(risk.tone)}`}>{risk.label}</span>
              </div>
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${readinessClass(readiness.tone)}`}>{readiness.label}</span>
                <span className="text-[10px] text-on-surface-variant">Lead {supplier.leadTimeDays || "-"}d</span>
                <span className="text-[10px] text-on-surface-variant">POs {supplier._count?.purchaseOrders ?? 0}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DuplicateSupplierWatch({
  groups,
  onOpenSupplier,
  onDismissGroup,
}: {
  groups: DuplicateSupplierGroup[];
  onOpenSupplier: (id: string) => void;
  onDismissGroup: (key: string) => void;
}) {
  return (
    <div className="rounded-xl bg-warning/5 border border-warning/15 p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-white">Duplicate Supplier Watch</h3>
          <p className="text-xs text-on-surface-variant mt-1">Potential duplicate records detected from website domains or similar names and locations. Review before RFQ routing.</p>
        </div>
        <span className="text-[10px] px-2 py-1 rounded-full bg-warning/10 border border-warning/20 text-warning font-semibold">
          {groups.length} group{groups.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
        {groups.slice(0, 4).map((group) => (
          <div key={group.key} className="rounded-lg bg-surface-low border border-white/5 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] uppercase tracking-wider text-warning/70 font-semibold">{group.reason}</p>
              <button
                onClick={() => onDismissGroup(group.key)}
                className="text-[10px] text-on-surface-variant hover:text-on-surface-variant transition"
                title="Dismiss this duplicate signal for the current session"
              >
                Reviewed
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {group.suppliers.map((supplier) => (
                <button
                  key={supplier.id}
                  onClick={() => onOpenSupplier(supplier.id)}
                  className="px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white/65 hover:text-white hover:border-success/30 transition"
                >
                  {supplier.name}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusDropdown({ value, onChange }: { value: StatusFilter; onChange: (v: StatusFilter) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function h(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    if (open) document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const options: StatusFilter[] = ["All", "Active", "Verified", "Suggested", "Watch", "Inactive", "Needs_Review", "Blocked"];
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="px-3 py-2.5 rounded-lg bg-surface-container border border-white/10 text-sm text-white focus:outline-none focus:border-success/40 flex items-center gap-2 min-w-[130px]">
        {value === "All" ? <span className="text-on-surface-variant">All Status</span> : (
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${STATUS_STYLE[value] ?? "text-on-surface-variant"}`}>{statusLabel(value)}</span>
        )}
        <svg className={`w-3 h-3 text-on-surface-variant ml-auto transition ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M19 9l-7 7-7-7" /></svg>
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 w-44 bg-surface-container border border-white/10 rounded-lg shadow-xl py-1">
          {options.map((opt) => (
            <button key={opt} onClick={() => { onChange(opt); setOpen(false); }}
              className={`w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 transition ${value === opt ? "bg-success/10 text-success" : "text-on-surface-variant hover:bg-white/5"}`}>
              {opt === "All" ? <span>All Status</span> : <span className={`px-1.5 py-0.5 rounded-full border text-[10px] font-medium ${STATUS_STYLE[opt]}`}>{statusLabel(opt)}</span>}
              {value === opt && <span className="ml-auto text-success"><IcCheck /></span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RegionDropdown({ value, onChange, regions }: { value: string; onChange: (v: string) => void; regions: string[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function h(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    if (open) document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  // Merge canonical taxonomy with any data-derived regions not in the canonical set
  const extraRegions = regions.filter((r) => !MARITIME_REGIONS.includes(r));
  const allRegions = [...MARITIME_REGIONS, ...extraRegions];

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="px-3 py-2.5 rounded-lg bg-surface-container border border-white/10 text-sm text-white focus:outline-none focus:border-success/40 flex items-center gap-2 min-w-[120px]">
        <IcPin />
        <span className={value ? "text-white" : "text-on-surface-variant"}>{value || "All Regions"}</span>
        <svg className={`w-3 h-3 text-on-surface-variant ml-auto transition ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M19 9l-7 7-7-7" /></svg>
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 w-56 bg-surface-container border border-white/10 rounded-lg shadow-xl py-1 max-h-72 overflow-y-auto">
          <button onClick={() => { onChange(""); setOpen(false); }}
            className={`w-full px-3 py-1.5 text-left text-xs transition ${!value ? "bg-success/10 text-success" : "text-on-surface-variant hover:bg-white/5"}`}>
            All Regions
          </button>
          <div className="border-t border-white/5 mt-1 pt-1">
            {allRegions.map((r) => (
              <button key={r} onClick={() => { onChange(r); setOpen(false); }}
                className={`w-full px-3 py-1.5 text-left text-xs transition flex items-center justify-between ${value === r ? "bg-success/10 text-success" : "text-on-surface-variant hover:bg-white/5"}`}>
                <span>{r}</span>
                {value === r && <IcCheck />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   EMPTY STATE
   ═══════════════════════════════════════════════════════════════ */

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="text-center py-20 space-y-4">
      <div className="w-16 h-16 rounded-2xl bg-success/10 flex items-center justify-center mx-auto">
        <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} className="text-success"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
      </div>
      <div>
        <p className="text-on-surface-variant text-sm font-medium">No suppliers found</p>
        <p className="text-on-surface-variant text-xs mt-1">Try adjusting your filters or add a new supplier.</p>
      </div>
      <button onClick={onAdd} className="px-4 py-2 rounded-lg bg-success text-surface-lowest text-sm font-semibold hover:brightness-110 transition inline-flex items-center gap-1.5">
        <IcPlus /> Add Supplier
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   LIST ROW (Wrist AI-style: info left, mini-map right)
   ═══════════════════════════════════════════════════════════════ */

function SupplierListRow({ supplier: s, onSelect }: { supplier: Supplier; onSelect: () => void }) {
  const readiness = supplierReadiness(s);
  const risk = supplierRisk(s);
  return (
    <div className="w-full text-left rounded-xl border bg-surface-container border-white/5 hover:border-white/15 transition-all group">
      <div className="flex items-stretch">
        {/* Left: supplier info */}
        <div className="flex-1 p-4 space-y-1.5 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-on-surface-variant font-mono">{s.supplierCode}</span>
            <h3 className="font-bold text-white text-sm group-hover:text-success transition"><button type="button" onClick={onSelect} className="text-left hover:underline focus-visible:outline focus-visible:outline-success">{s.name}</button></h3>
            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${STATUS_STYLE[s.status] ?? "text-on-surface-variant"}`}>{statusLabel(s.status)}</span>
            {s.enrichmentStatus === "Enriched" && s.confidence !== null && (
              <span className="text-[10px] text-success flex items-center gap-0.5"><IcStar /> {confidencePct(s.confidence)}</span>
            )}
            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${readinessClass(readiness.tone)}`}>{readiness.label}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${riskClass(risk.tone)}`}>{risk.label}</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-on-surface-variant flex-wrap">
            <span className="flex items-center gap-1"><IcPin /> {s.region}{s.country ? `, ${s.country}` : ""}</span>
            {s.email && <span className="flex items-center gap-1"><IcMail /> {s.email}</span>}
            {s.phone && <span className="flex items-center gap-1"><IcPhone /> {s.phone}</span>}
            {s.website && (
              <button type="button" aria-label={`Open website for ${s.name}`}
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); void openExternalUrl(normalizeUrl(s.website)!); }}
                className="flex items-center gap-1 text-info hover:underline transition cursor-pointer">
                <IcGlobe /> {s.website.replace(/^https?:\/\//i, "").replace(/\/$/, "")}
              </button>
            )}
            <span>Lead: {s.leadTimeDays}d</span>
          </div>
          {s.description && (
            <p className="text-xs text-on-surface-variant line-clamp-2 mt-1">{s.description}</p>
          )}
          {s.categories.length > 0 && (
            <div className="flex items-center gap-1 mt-1 text-[10px] text-on-surface-variant">
              <span>Supplies:</span> {s.categories.slice(0, 4).join(", ")}{s.categories.length > 4 && `, +${s.categories.length - 4}`}
            </div>
          )}
          <div className="flex items-center gap-4 mt-1 text-[10px] text-on-surface-variant flex-wrap">
            <span>Ports: <span className="text-on-surface-variant">{s.portsCovered.length}</span></span>
            <span>POs: <span className="text-on-surface-variant">{s._count?.purchaseOrders ?? 0}</span></span>
            <span>Quotes: <span className="text-on-surface-variant">{s._count?.supplierQuotes ?? 0}</span></span>
            {risk.reasons[0] && <span className="text-on-surface-variant">Risk: {risk.reasons[0]}</span>}
            {readiness.issues[0] && <span className="text-warning/70">Review: {readiness.issues[0]}</span>}
          </div>
        </div>

        {/* Center: score */}
        <div className="flex items-center justify-center px-4 border-l border-white/5">
          <div className="text-center">
            <div className={`text-2xl font-bold ${scoreBadge(s.score)}`}>{s.score}</div>
            <div className="text-[10px] text-on-surface-variant mt-0.5">Score</div>
          </div>
        </div>

        {/* Right: mini map */}
        <div className="w-[200px] shrink-0 border-l border-white/5 overflow-hidden rounded-r-xl">
          {s.lat !== null && s.lng !== null ? (
            <SupplierMiniMap lat={s.lat} lng={s.lng} />
          ) : (
            <div className="w-full h-full bg-surface-low flex items-center justify-center">
              <span className="text-[10px] text-on-surface-variant">No location</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   GRID CARD
   ═══════════════════════════════════════════════════════════════ */

function SupplierGridCard({ supplier: s, onSelect }: { supplier: Supplier; onSelect: () => void }) {
  const readiness = supplierReadiness(s);
  const risk = supplierRisk(s);
  return (
    <button onClick={onSelect} className="w-full text-left rounded-xl border p-4 space-y-3 transition-all bg-surface-container border-white/5 hover:border-white/15 group">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-success/10 flex items-center justify-center text-success text-xs font-bold">
            {s.name.substring(0, 2).toUpperCase()}
          </div>
          <div>
            <h3 className="font-bold text-white text-sm leading-tight group-hover:text-success transition">{s.name}</h3>
            <p className="text-[10px] text-on-surface-variant font-mono">{s.supplierCode}</p>
          </div>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${STATUS_STYLE[s.status] ?? "text-on-surface-variant"}`}>{statusLabel(s.status)}</span>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-on-surface-variant">
        <IcPin /> {s.region}{s.country ? `, ${s.country}` : ""}
        {s.categories.length > 0 && <span className="ml-auto truncate max-w-[120px]">{s.categories[0]}</span>}
      </div>
      <div className="flex items-center justify-between text-xs text-on-surface-variant">
        <span>Lead: {s.leadTimeDays}d</span>
        <span className={`font-bold text-base ${scoreBadge(s.score)}`}>{s.score}</span>
      </div>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${readinessClass(readiness.tone)}`}>{readiness.label}</span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${riskClass(risk.tone)}`}>{risk.label}</span>
        <span className="text-[10px] text-on-surface-variant">{s._count?.purchaseOrders ?? 0} POs</span>
      </div>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SUPPLIER MATCH FLOW — Find, Review, Accept/Reject
   ═══════════════════════════════════════════════════════════════ */

function SupplierMatchFlow({ onCancel, onAccepted }: { onCancel: () => void; onAccepted: (supplierId: string) => void }) {
  const [phase, setPhase] = useState<"search" | "loading" | "review">("search");
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<MatchRunUI | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingCandidate, setEditingCandidate] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  const [actionBusy, setActionBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [memoryRecords, setMemoryRecords] = useState<SupplierMemoryRecord[]>([]);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [searchForm, setSearchForm] = useState({
    name: "", country: "", region: "", category: "", keywords: "", port: "",
  });

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 4000); }

  useEffect(() => {
    if (phase !== "review") return;
    let cancelled = false;

    async function loadMatchMemory() {
      setMemoryLoading(true);
      setMemoryError(null);
      try {
        const res = await fetch("/api/v1/agents/memory?limit=50");
        const json = await res.json();
        if (!res.ok || json.ok === false) {
          throw new Error(json.error?.message || json.error || "Failed to load supplier routing memory.");
        }
        const data = json.data as { records?: SupplierMemoryRecord[] } | undefined;
        if (!cancelled) setMemoryRecords(Array.isArray(data?.records) ? data.records : []);
      } catch (err) {
        if (!cancelled) {
          setMemoryRecords([]);
          setMemoryError(err instanceof Error ? err.message : "Supplier routing memory could not be loaded.");
        }
      } finally {
        if (!cancelled) setMemoryLoading(false);
      }
    }

    loadMatchMemory();
    return () => { cancelled = true; };
  }, [phase, run?.id]);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const hasInput = Object.values(searchForm).some((v) => v.trim());
    if (!hasInput) { setError("Enter at least one search criterion."); return; }
    setPhase("loading"); setError(null);
    try {
      const res = await fetch("/api/v1/suppliers/match", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...searchForm, source: "manual_search" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Match pipeline failed");

      // Load full run details
      const runRes = await fetch(`/api/v1/suppliers/match/${json.runId}`);
      const runJson = await runRes.json();
      if (!runRes.ok) throw new Error(runJson.error || "Failed to load results");

      setRun(runJson.data);
      setPhase("review");
      if (runJson.data.candidates.length > 0) {
        setExpandedId(runJson.data.candidates[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Match failed");
      setPhase("search");
    }
  }

  async function handleAccept(candidate: MatchCandidateUI, withEdits: boolean) {
    if (!run) return;
    setActionBusy(true);
    try {
      const correctedFields: Record<string, { from: unknown; to: unknown }> = {};
      if (withEdits) {
        for (const [field, value] of Object.entries(editFields)) {
          const original = (candidate as unknown as Record<string, unknown>)[field];
          if (value !== String(original ?? "")) {
            correctedFields[field] = { from: original, to: value };
          }
        }
      }

      const res = await fetch(`/api/v1/suppliers/match/${run.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: candidate.id,
          action: withEdits && Object.keys(correctedFields).length > 0 ? "edit_accept" : "accept",
          correctedFields: Object.keys(correctedFields).length > 0 ? correctedFields : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Accept failed");
      onAccepted(json.savedSupplierId);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to accept candidate");
    } finally { setActionBusy(false); }
  }

  async function handleReject(candidateId: string, reason?: string) {
    if (!run) return;
    setActionBusy(true);
    try {
      const res = await fetch(`/api/v1/suppliers/match/${run.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId, action: "reject", rejectionReason: reason }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Reject failed");

      // Update local state
      setRun((prev) => {
        if (!prev) return prev;
        const updated = prev.candidates.map((c) =>
          c.id === candidateId ? { ...c, outcome: "Rejected" } : c
        );
        return { ...prev, candidates: updated, status: json.remainingPending === 0 ? "AllRejected" : prev.status };
      });

      if (json.remainingPending === 0) {
        showToast("All candidates rejected — try refining your search.");
      } else {
        showToast("Candidate rejected.");
        // Auto-expand next pending
        const next = run.candidates.find((c) => c.id !== candidateId && c.outcome === "Pending");
        if (next) setExpandedId(next.id);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to reject candidate");
    } finally { setActionBusy(false); }
  }

  function startEditing(candidate: MatchCandidateUI) {
    setEditingCandidate(candidate.id);
    setEditFields({
      name: candidate.name,
      region: candidate.region ?? "",
      country: candidate.country ?? "",
      city: candidate.city ?? "",
      email: candidate.email ?? "",
      phone: candidate.phone ?? "",
      website: candidate.website ?? "",
      contactPerson: candidate.contactPerson ?? "",
      description: candidate.description ?? "",
    });
  }

  const pendingCandidates = run?.candidates.filter((c) => c.outcome === "Pending") ?? [];
  const rejectedCandidates = run?.candidates.filter((c) => c.outcome === "Rejected") ?? [];

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onCancel} className="p-2 rounded-lg hover:bg-white/5 text-on-surface-variant hover:text-white transition"><IcArrowLeft /></button>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-white flex items-center gap-2"><IcTarget /> Find Supplier</h2>
          <p className="text-xs text-on-surface-variant">
            {phase === "search" && "Search across internal database and AI-powered discovery."}
            {phase === "loading" && "Running matching pipeline..."}
            {phase === "review" && `${pendingCandidates.length} candidate${pendingCandidates.length !== 1 ? "s" : ""} to review`}
          </p>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="px-4 py-3 rounded-lg bg-success/10 border border-success/20 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-success"><IcCheck /> <span>{toast}</span></div>
          <button onClick={() => setToast(null)} className="text-success hover:text-success transition"><IcClose /></button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="px-4 py-3 rounded-lg bg-error/10 border border-error/20 text-error text-xs">{error}</div>
      )}

      {/* ── SEARCH PHASE ──────────────────────────────────── */}
      {phase === "search" && (
        <form onSubmit={handleSearch} className="rounded-xl bg-surface-container border border-white/5 p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Company Name" value={searchForm.name} onChange={(v) => setSearchForm((p) => ({ ...p, name: v as string }))} placeholder="e.g. Kroonint, GAC Marine" />
            <FormField label="Keywords" value={searchForm.keywords} onChange={(v) => setSearchForm((p) => ({ ...p, keywords: v as string }))} placeholder="e.g. provisions, safety equipment" />
            <div>
              <label className="text-[10px] font-semibold text-on-surface-variant uppercase tracking-wider mb-1 block">Region</label>
              <select value={searchForm.region} onChange={(e) => setSearchForm((p) => ({ ...p, region: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-surface-low border border-white/10 text-sm text-white focus:outline-none focus:border-success/40 appearance-none">
                <option value="">Any region</option>
                {MARITIME_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <FormField label="Country" value={searchForm.country} onChange={(v) => setSearchForm((p) => ({ ...p, country: v as string }))} placeholder="e.g. Netherlands, UAE" />
            <FormField label="Category" value={searchForm.category} onChange={(v) => setSearchForm((p) => ({ ...p, category: v as string }))} placeholder="e.g. Marine Provisions" />
            <FormField label="Port" value={searchForm.port} onChange={(v) => setSearchForm((p) => ({ ...p, port: v as string }))} placeholder="e.g. Rotterdam, Fujairah" />
          </div>
          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg border border-white/10 text-sm text-on-surface-variant hover:text-white hover:border-white/20 transition">Cancel</button>
            <button type="submit" className="px-5 py-2 rounded-lg bg-ai/20 text-ai border border-ai/30 text-sm font-semibold hover:bg-ai/30 transition flex items-center gap-1.5">
              <IcTarget /> Search &amp; Match
            </button>
          </div>
        </form>
      )}

      {/* ── LOADING PHASE ─────────────────────────────────── */}
      {phase === "loading" && (
        <div className="rounded-xl bg-surface-container border border-white/5 p-12 flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-ai/30 border-t-ai rounded-full animate-spin" />
          <div className="text-center">
            <p className="text-sm text-on-surface-variant">Searching databases, Google Places &amp; AI...</p>
            <p className="text-xs text-on-surface-variant mt-1">Retrieving, enriching, and ranking candidates</p>
          </div>
        </div>
      )}

      {/* ── REVIEW PHASE ──────────────────────────────────── */}
      {phase === "review" && run && (
        <div className="space-y-3">
          {/* Run summary bar */}
          <div className="rounded-xl bg-surface-container border border-white/5 p-4 flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2 text-xs text-on-surface-variant flex-wrap">
              <span className="font-medium text-on-surface-variant">Query:</span>
              {run.query.name && <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10">{run.query.name}</span>}
              {run.query.keywords && <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10">{run.query.keywords}</span>}
              {run.query.region && <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10">{run.query.region}</span>}
              {run.query.country && <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10">{run.query.country}</span>}
              {run.query.category && <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10">{run.query.category}</span>}
              {run.query.searchMode && (
                <span className={`px-2 py-0.5 rounded-full border text-[10px] font-medium ${
                  run.query.searchMode === "identity"
                    ? "text-ai border-ai/30 bg-ai/10"
                    : "text-accent-cyan border-accent-cyan/30 bg-accent-cyan/10"
                }`}>
                  {run.query.searchMode === "identity" ? "Company Lookup" : "Discovery"}
                </span>
              )}
            </div>
            <div className="ml-auto flex items-center gap-3 text-[10px] text-on-surface-variant">
              <span>{run.candidateCount} candidate{run.candidateCount !== 1 ? "s" : ""}</span>
              <span className={`px-2 py-0.5 rounded-full border font-medium ${
                run.status === "Ranked" ? "text-info border-info/30 bg-info/10" :
                run.status === "Accepted" ? "text-success border-success/30 bg-success/10" :
                run.status === "AllRejected" ? "text-error border-error/30 bg-error/10" :
                "text-on-surface-variant border-white/10"
              }`}>{run.status}</span>
            </div>
          </div>

          {/* All candidates rejected — offer new search */}
          {pendingCandidates.length === 0 && run.status !== "Accepted" && (
            <div className="rounded-xl bg-surface-container border border-white/5 p-6 text-center space-y-3">
              <p className="text-sm text-on-surface-variant">All candidates reviewed. No matches accepted.</p>
              <button onClick={() => { setPhase("search"); setRun(null); setError(null); }}
                className="px-4 py-2 rounded-lg bg-ai/15 text-ai border border-ai/25 text-sm font-semibold hover:bg-ai/25 transition inline-flex items-center gap-1.5">
                <IcTarget /> New Search
              </button>
            </div>
          )}

          {/* Candidate cards */}
          {pendingCandidates.map((c) => (
            <CandidateCard
              key={c.id}
              candidate={c}
              expanded={expandedId === c.id}
              onToggle={() => setExpandedId(expandedId === c.id ? null : c.id)}
              editing={editingCandidate === c.id}
              editFields={editFields}
              onEditField={(f, v) => setEditFields((p) => ({ ...p, [f]: v }))}
              onStartEdit={() => startEditing(c)}
              onCancelEdit={() => { setEditingCandidate(null); setEditFields({}); }}
              onAccept={(withEdits) => handleAccept(c, withEdits)}
              onReject={() => handleReject(c.id)}
              busy={actionBusy}
              memoryRecords={memoryRecords.filter((record) => candidateMemoryMatch(record, c)).slice(0, 3)}
              memoryLoading={memoryLoading}
              memoryError={memoryError}
            />
          ))}

          {/* Rejected candidates — collapsed */}
          {rejectedCandidates.length > 0 && (
            <details className="group">
              <summary className="text-xs text-on-surface-variant cursor-pointer hover:text-on-surface-variant transition py-2">
                {rejectedCandidates.length} rejected candidate{rejectedCandidates.length !== 1 ? "s" : ""}
              </summary>
              <div className="space-y-2 mt-2 opacity-50">
                {rejectedCandidates.map((c) => (
                  <div key={c.id} className="rounded-xl bg-surface-container border border-white/5 p-4">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-on-surface-variant font-mono">#{c.rank}</span>
                      <span className="text-sm text-on-surface-variant line-through">{c.name}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full border text-error/60 border-error/20">Rejected</span>
                      <span className="text-[10px] text-on-surface-variant ml-auto">{c.sourceTag}</span>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Back to search */}
          {pendingCandidates.length > 0 && (
            <div className="flex items-center justify-between pt-2">
              <button onClick={() => { setPhase("search"); setRun(null); setError(null); }}
                className="text-xs text-on-surface-variant hover:text-on-surface-variant transition flex items-center gap-1">
                <IcArrowLeft /> New search
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Candidate Card ─────────────────────────────────────────── */

function CandidateCard({ candidate: c, expanded, onToggle, editing, editFields, onEditField, onStartEdit, onCancelEdit, onAccept, onReject, busy, memoryRecords, memoryLoading, memoryError }: {
  candidate: MatchCandidateUI;
  expanded: boolean;
  onToggle: () => void;
  editing: boolean;
  editFields: Record<string, string>;
  onEditField: (f: string, v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onAccept: (withEdits: boolean) => void;
  onReject: () => void;
  busy: boolean;
  memoryRecords: SupplierMemoryRecord[];
  memoryLoading: boolean;
  memoryError: string | null;
}) {
  const bandStyle = {
    high: "text-success border-success/30 bg-success/10",
    medium: "text-warning border-warning/30 bg-warning/10",
    low: "text-error border-error/30 bg-error/10",
  }[c.confidenceBand] ?? "text-on-surface-variant border-white/10";

  const scoreColor = c.overallScore >= 0.75 ? "text-success" : c.overallScore >= 0.45 ? "text-warning" : "text-error";

  const breakdownLabels: Record<string, string> = {
    nameMatch: "Name Match",
    identityStrength: "Identity",
    locationMatch: "Location",
    categoryFit: "Category Fit",
    maritimeRelevance: "Maritime Signal",
    profileCompleteness: "Completeness",
    domainConsistency: "Domain Check",
    sourceReliability: "Source Trust",
  };

  return (
    <div className={`rounded-xl bg-surface-container border transition-all ${expanded ? "border-ai/30" : "border-white/5 hover:border-white/15"}`}>
      {/* Header row — always visible */}
      <button onClick={onToggle} className="w-full text-left p-4 flex items-center gap-3">
        <span className="text-xs text-on-surface-variant font-mono w-6">#{c.rank}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-white text-sm">{c.name}</h3>
            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${bandStyle}`}>
              {c.confidenceBand} confidence
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-on-surface-variant">
              {c.sourceTag === "internal_db" ? "Database" : c.sourceTag === "ai_generated" ? "AI Discovery" : c.sourceTag === "google_places" ? "Google Places" : c.sourceTag}
            </span>
            {c.existingSupplierId && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-info/10 border border-info/20 text-info">Existing</span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-on-surface-variant mt-1">
            {(c.region || c.country) && <span className="flex items-center gap-1"><IcPin /> {c.region}{c.country ? `, ${c.country}` : ""}</span>}
            {c.email && <span className="flex items-center gap-1"><IcMail /> {c.email}</span>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className={`text-xl font-bold ${scoreColor}`}>{Math.round(c.overallScore * 100)}</div>
          <div className="text-[10px] text-on-surface-variant">score</div>
        </div>
        <svg className={`w-4 h-4 text-on-surface-variant transition ${expanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M9 5l7 7-7 7" /></svg>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-white/5 p-4 space-y-4">
          {/* Identity verification badges */}
          {c.identitySignals && (c.identitySignals.nameExact || c.identitySignals.domainMatch || c.identitySignals.placesVerified) && (
            <div className="flex items-center gap-2 flex-wrap">
              {c.identitySignals.nameExact && (
                <span className="px-2 py-0.5 rounded-full bg-success/10 text-success text-[10px] border border-success/20 flex items-center gap-1">
                  <IcCheck /> Exact Name Match
                </span>
              )}
              {c.identitySignals.domainMatch && (
                <span className="px-2 py-0.5 rounded-full bg-info/10 text-info text-[10px] border border-info/20 flex items-center gap-1">
                  <IcGlobe /> Domain Verified
                </span>
              )}
              {c.identitySignals.placesVerified && (
                <span className="px-2 py-0.5 rounded-full bg-ai/10 text-ai text-[10px] border border-ai/20 flex items-center gap-1">
                  <IcPin /> Google Places Verified
                </span>
              )}
              {c.identitySignals.sourceAgreement >= 2 && (
                <span className="px-2 py-0.5 rounded-full bg-warning/10 text-warning text-[10px] border border-warning/20">
                  {c.identitySignals.sourceAgreement} sources agree
                </span>
              )}
            </div>
          )}

          {/* Explanation */}
          <p className="text-xs text-on-surface-variant italic leading-relaxed">{c.explanation}</p>

          <CandidateMemoryPanel
            candidate={c}
            records={memoryRecords}
            loading={memoryLoading}
            error={memoryError}
          />

          {/* Score breakdown */}
          <div>
            <p className="text-[10px] font-semibold text-on-surface-variant uppercase tracking-wider mb-2">Score Breakdown</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {Object.entries(c.scoreBreakdown).map(([key, val]) => (
                <div key={key} className="rounded-lg bg-surface-low p-2">
                  <div className="text-[10px] text-on-surface-variant">{breakdownLabels[key] ?? key}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <div className={`h-full rounded-full ${val >= 0.7 ? "bg-success" : val >= 0.4 ? "bg-warning" : "bg-error/60"}`} style={{ width: `${val * 100}%` }} />
                    </div>
                    <span className="text-[10px] text-on-surface-variant font-mono">{Math.round(val * 100)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Supplier details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="space-y-2">
              {c.description && <div><span className="text-on-surface-variant">About:</span> <span className="text-on-surface-variant">{c.description}</span></div>}
              {c.phone && <div className="flex items-center gap-1 text-on-surface-variant"><IcPhone /> {c.phone}</div>}
              {c.website && <div className="flex items-center gap-1 text-info/60"><IcGlobe /> {c.website}</div>}
              {c.contactPerson && <div className="flex items-center gap-1 text-on-surface-variant"><IcStar /> {c.contactPerson}</div>}
              {c.address && <div className="flex items-center gap-1 text-on-surface-variant"><IcPin /> {c.address}</div>}
            </div>
            <div className="space-y-2">
              {c.categories.length > 0 && (
                <div>
                  <span className="text-on-surface-variant">Categories:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {c.categories.map((cat) => (
                      <span key={cat} className="px-2 py-0.5 rounded-full bg-success/10 text-success text-[10px] border border-success/20">{cat}</span>
                    ))}
                  </div>
                </div>
              )}
              {c.portsCovered.length > 0 && (
                <div>
                  <span className="text-on-surface-variant">Ports:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {c.portsCovered.map((port) => (
                      <span key={port} className="px-2 py-0.5 rounded-full bg-info/10 text-info text-[10px] border border-info/20">{port}</span>
                    ))}
                  </div>
                </div>
              )}
              {c.missingFields.length > 0 && (
                <div className="text-on-surface-variant text-[10px]">Missing: {c.missingFields.join(", ")}</div>
              )}
            </div>
          </div>

          {/* Conflicts / warnings */}
          {c.conflicts && Array.isArray(c.conflicts) && c.conflicts.length > 0 && (
            <div className="space-y-1">
              {c.conflicts.map((conflict, i) => (
                <div key={i} className={`text-[10px] px-2 py-1 rounded ${conflict.severity === "error" ? "bg-error/10 text-error" : "bg-warning/10 text-warning"}`}>
                  {conflict.field}: {conflict.issue}
                </div>
              ))}
            </div>
          )}

          {/* Edit mode */}
          {editing && (
            <div className="rounded-lg bg-surface-low border border-white/10 p-4 space-y-3">
              <p className="text-[10px] font-semibold text-on-surface-variant uppercase tracking-wider">Edit Before Accepting</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(["name", "region", "country", "city", "email", "phone", "website", "contactPerson"] as const).map((field) => (
                  <div key={field}>
                    <label className="text-[10px] text-on-surface-variant capitalize block mb-0.5">{field === "contactPerson" ? "Contact Person" : field}</label>
                    <input type="text" value={editFields[field] ?? ""} onChange={(e) => onEditField(field, e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-surface-container border border-white/10 text-xs text-white placeholder:text-on-surface-variant focus:outline-none focus:border-ai/40" />
                  </div>
                ))}
              </div>
              <div>
                <label className="text-[10px] text-on-surface-variant block mb-0.5">Description</label>
                <textarea value={editFields.description ?? ""} onChange={(e) => onEditField("description", e.target.value)} rows={2}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-surface-container border border-white/10 text-xs text-white placeholder:text-on-surface-variant focus:outline-none focus:border-ai/40 resize-none" />
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            {!editing ? (
              <>
                <button onClick={() => onAccept(false)} disabled={busy}
                  className="px-4 py-2 rounded-lg bg-success/15 text-success border border-success/25 text-xs font-semibold hover:bg-success/25 transition flex items-center gap-1.5 disabled:opacity-50">
                  {busy ? <div className="w-3.5 h-3.5 border-2 border-success/30 border-t-success rounded-full animate-spin" /> : <IcThumbUp />} Accept
                </button>
                <button onClick={onStartEdit} disabled={busy}
                  className="px-4 py-2 rounded-lg bg-white/5 text-on-surface-variant border border-white/10 text-xs font-medium hover:bg-white/10 transition flex items-center gap-1.5 disabled:opacity-50">
                  <IcEdit /> Edit &amp; Accept
                </button>
                <button onClick={onReject} disabled={busy}
                  className="px-4 py-2 rounded-lg text-error/60 border border-error/15 text-xs hover:bg-error/10 hover:text-error transition flex items-center gap-1.5 disabled:opacity-50">
                  <IcThumbDown /> Reject
                </button>
              </>
            ) : (
              <>
                <button onClick={() => onAccept(true)} disabled={busy}
                  className="px-4 py-2 rounded-lg bg-ai/15 text-ai border border-ai/25 text-xs font-semibold hover:bg-ai/25 transition flex items-center gap-1.5 disabled:opacity-50">
                  {busy ? <div className="w-3.5 h-3.5 border-2 border-ai/30 border-t-ai rounded-full animate-spin" /> : <IcCheck />} Save &amp; Accept
                </button>
                <button onClick={onCancelEdit} className="px-4 py-2 rounded-lg border border-white/10 text-xs text-on-surface-variant hover:text-white transition">
                  Cancel Edit
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CandidateMemoryPanel({
  candidate,
  records,
  loading,
  error,
}: {
  candidate: MatchCandidateUI;
  records: SupplierMemoryRecord[];
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return (
      <div className="rounded-lg bg-surface-low border border-white/5 px-3 py-2 text-xs text-on-surface-variant">
        Checking supplier-routing memory...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-warning/10 border border-warning/20 px-3 py-2 text-xs text-warning/70">
        {error}
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="rounded-lg bg-surface-low border border-white/5 px-3 py-2 text-xs text-on-surface-variant">
        No prior routing-memory signal found for this candidate or source.
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-surface-low border border-ai/15 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-ai/70">Routing memory</p>
        <span className="rounded-full border border-ai/20 bg-ai/10 px-2 py-0.5 text-[10px] text-ai/70">
          {records.length} signal{records.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="mt-2 space-y-2">
        {records.map((record) => (
          <div key={record.id} className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${memoryConfidenceClass(record.confidence)}`}>
                {record.confidence}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-on-surface-variant">{memoryTypeLabel(record.memoryType)}</span>
              <span className="ml-auto text-[10px] text-on-surface-variant">{new Date(record.lastObservedAt).toLocaleDateString()}</span>
            </div>
            <p className="mt-1 text-xs text-on-surface-variant">{candidateMemoryDescription(record, candidate)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   CREATE FORM
   ═══════════════════════════════════════════════════════════════ */

function CreateSupplierForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (s: Supplier) => void }) {
  const [busy, setBusy] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enriched, setEnriched] = useState(false);
  const [enrichSource, setEnrichSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "", region: "", country: "", city: "", address: "", email: "", phone: "",
    website: "", contactPerson: "", description: "", categories: "" as string | string[], portsCovered: "" as string | string[],
    lat: null as number | null, lng: null as number | null,
  });

  function set(f: string, v: string | string[]) { setForm((p) => ({ ...p, [f]: v })); }

  /** AI Suggest: fill form from enrich-form endpoint before saving */
  async function handleAISuggest() {
    if (!form.name.trim()) { setError("Enter a company name first."); return; }
    setEnriching(true); setError(null);
    try {
      const res = await fetch("/api/v1/suppliers/enrich-form", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          region: form.region || undefined,
          country: form.country || undefined,
          city: form.city || undefined,
          description: form.description || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.suggestion) throw new Error(json.error ?? "AI suggestion failed");
      const s = json.suggestion;
      setForm((prev) => ({
        name: prev.name,
        region: s.region ?? prev.region,
        country: s.country ?? prev.country,
        city: s.city ?? prev.city,
        address: s.address ?? prev.address,
        email: s.email ?? prev.email,
        phone: s.phone ?? prev.phone,
        website: s.website ?? prev.website,
        contactPerson: s.contactPerson ?? prev.contactPerson,
        description: s.description ?? prev.description,
        categories: Array.isArray(s.categories) ? s.categories : prev.categories,
        portsCovered: Array.isArray(s.portsCovered) ? s.portsCovered : prev.portsCovered,
        lat: s.lat ?? prev.lat,
        lng: s.lng ?? prev.lng,
      }));
      setEnriched(true);
      setEnrichSource(s.placesMatch ? `Business registry match: "${s.placesMatch}" (${Math.round((s.placesNameScore ?? 0) * 100)}% match)` : "AI enrichment only");
    } catch (err) { setError(err instanceof Error ? err.message : "AI suggest failed"); }
    finally { setEnriching(false); }
  }

  function getCategoriesString() {
    return Array.isArray(form.categories) ? form.categories.join(", ") : form.categories;
  }
  function getPortsString() {
    return Array.isArray(form.portsCovered) ? form.portsCovered.join(", ") : form.portsCovered;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Supplier name is required."); return; }
    setBusy(true); setError(null);
    try {
      const cats = Array.isArray(form.categories)
        ? form.categories
        : form.categories.split(",").map((c) => c.trim()).filter(Boolean);
      const ports = Array.isArray(form.portsCovered)
        ? form.portsCovered
        : form.portsCovered.split(",").map((p) => p.trim()).filter(Boolean);
      const res = await fetch("/api/v1/suppliers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(), region: form.region.trim() || "Unknown",
          country: form.country.trim() || null, city: form.city.trim() || null,
          address: form.address.trim() || null,
          email: form.email.trim() || null, phone: form.phone.trim() || null,
          website: form.website.trim() || null, contactPerson: form.contactPerson.trim() || null,
          description: form.description.trim() || null,
          categories: cats, portsCovered: ports,
          lat: form.lat, lng: form.lng,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.error?.message || json.error || "Failed to create supplier");
      onCreated(json.data);
    } catch (err) { setError(err instanceof Error ? err.message : "Failed"); } finally { setBusy(false); }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onCancel} className="p-2 rounded-lg hover:bg-white/5 text-on-surface-variant hover:text-white transition"><IcArrowLeft /></button>
        <div>
          <h2 className="text-lg font-bold text-white">Add New Supplier</h2>
          <p className="text-xs text-on-surface-variant">Enter the company name, then use AI Suggest to pre-fill the profile.</p>
        </div>
      </div>
      <form onSubmit={handleSubmit} className="rounded-xl bg-surface-container border border-white/5 p-5 space-y-4">
        {error && <div className="px-3 py-2 rounded-lg bg-error/10 border border-error/20 text-error text-xs">{error}</div>}

        {/* Company Name + AI Suggest button */}
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <FormField label="Company Name *" value={form.name} onChange={(v) => set("name", v as string)} placeholder="e.g. GAC Marine Services" />
          </div>
          <button type="button" onClick={handleAISuggest} disabled={enriching || !form.name.trim()}
            className={`px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition mb-0.5 ${enriching ? "bg-ai/20 text-ai border-ai/30" : "bg-ai/10 text-ai border-ai/20 hover:bg-ai/20 disabled:opacity-40"}`}>
            {enriching ? <div className="w-3.5 h-3.5 border-2 border-ai/30 border-t-ai rounded-full animate-spin" /> : <IcWand />}
            {enriching ? "Analyzing..." : "AI Suggest"}
          </button>
        </div>

        {enriched && (
          <div className="px-3 py-2 rounded-lg bg-ai/10 border border-ai/20 text-xs space-y-1">
            <div className="flex items-center gap-2 text-ai"><IcCheck /> AI data filled in — review and adjust before saving.</div>
            {enrichSource && <div className="text-ai/60 text-[10px] pl-5">Source: {enrichSource}</div>}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Region: select from canonical taxonomy */}
          <div>
            <label className="text-[10px] font-semibold text-on-surface-variant uppercase tracking-wider mb-1 block">Region</label>
            <select value={form.region} onChange={(e) => set("region", e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-surface-low border border-white/10 text-sm text-white focus:outline-none focus:border-success/40 appearance-none">
              <option value="">Select region...</option>
              {MARITIME_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <FormField label="Country" value={form.country} onChange={(v) => set("country", v as string)} placeholder="e.g. UAE" />
          <FormField label="City" value={form.city} onChange={(v) => set("city", v as string)} placeholder="e.g. Dubai" />
          <FormField label="Address" value={form.address} onChange={(v) => set("address", v as string)} placeholder="Full street address" />
          <FormField label="Email" value={form.email} onChange={(v) => set("email", v as string)} placeholder="sales@example.com" type="email" />
          <FormField label="Phone" value={form.phone} onChange={(v) => set("phone", v as string)} placeholder="+971 4 123 4567" />
          <FormField label="Website" value={form.website} onChange={(v) => set("website", v as string)} placeholder="https://..." />
          <FormField label="Contact Person" value={form.contactPerson} onChange={(v) => set("contactPerson", v as string)} placeholder="Primary contact" />
        </div>
        <FormField label="Description" value={form.description} onChange={(v) => set("description", v as string)} placeholder="Brief description..." multiline />
        <FormField label="Categories (comma-separated)" value={getCategoriesString()} onChange={(v) => set("categories", v as string)} placeholder="Provisions, Deck Supplies, Engine Parts" />
        <FormField label="Ports Covered (comma-separated)" value={getPortsString()} onChange={(v) => set("portsCovered", v as string)} placeholder="Rotterdam, Singapore, Fujairah" />
        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg border border-white/10 text-sm text-on-surface-variant hover:text-white hover:border-white/20 transition">Cancel</button>
          <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-success text-surface-lowest text-sm font-semibold hover:brightness-110 transition disabled:opacity-50 flex items-center gap-1.5">
            {busy ? <div className="w-4 h-4 border-2 border-surface-lowest/30 border-t-surface-lowest rounded-full animate-spin" /> : <IcPlus />} Create Supplier
          </button>
        </div>
      </form>
    </div>
  );
}

function FormField({ label, value, onChange, placeholder, type = "text", multiline = false }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; multiline?: boolean;
}) {
  const cls = "w-full px-3 py-2 rounded-lg bg-surface-low border border-white/10 text-sm text-white placeholder:text-on-surface-variant focus:outline-none focus:border-success/40";
  return (
    <div>
      <label className="text-[10px] font-semibold text-on-surface-variant uppercase tracking-wider mb-1 block">{label}</label>
      {multiline ? <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={2} className={cls} />
        : <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cls} />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SUPPLIER WORKSPACE (detail view)
   ═══════════════════════════════════════════════════════════════ */

function SupplierWorkspace({ supplier: initial, onBack, onRefresh }: { supplier: Supplier; onBack: () => void; onRefresh: () => void }) {
  const [supplier, setSupplier] = useState(initial);
  const [tab, setTab] = useState<Tab>("overview");
  const [enriching, setEnriching] = useState(false);
  const [enrichPreview, setEnrichPreview] = useState<EnrichPreviewData | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showHardDeleteConfirm, setShowHardDeleteConfirm] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [memoryRecords, setMemoryRecords] = useState<SupplierMemoryRecord[]>([]);
  const [memoryTotals, setMemoryTotals] = useState<SupplierMemoryTotals | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const isArchived = supplier.status === "Blocked";
  const readiness = supplierReadiness(supplier);
  const risk = supplierRisk(supplier);
  const procurementInsights = supplierProcurementInsights(supplier);
  const supplierMemory = useMemo(
    () => memoryRecords.filter((record) => supplierMemoryMatch(record, supplier)).slice(0, 5),
    [memoryRecords, supplier],
  );

  useEffect(() => { setSupplier(initial); }, [initial]);

  useEffect(() => {
    let cancelled = false;

    async function loadSupplierMemory() {
      setMemoryLoading(true);
      setMemoryError(null);
      try {
        const res = await fetch("/api/v1/agents/memory?limit=50");
        const json = await res.json();
        if (!res.ok || json.ok === false) {
          throw new Error(json.error?.message || json.error || "Failed to load supplier routing memory.");
        }
        const data = json.data as { records?: SupplierMemoryRecord[]; totals?: SupplierMemoryTotals } | undefined;
        if (!cancelled) {
          setMemoryRecords(Array.isArray(data?.records) ? data.records : []);
          setMemoryTotals(data?.totals ?? null);
        }
      } catch (err) {
        if (!cancelled) {
          setMemoryRecords([]);
          setMemoryTotals(null);
          setMemoryError(err instanceof Error ? err.message : "Supplier routing memory could not be loaded.");
        }
      } finally {
        if (!cancelled) setMemoryLoading(false);
      }
    }

    loadSupplierMemory();
    return () => { cancelled = true; };
  }, [supplier.id]);

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 4000); }

  async function patchSupplier(data: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/suppliers/${supplier.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        showToast(json.error?.message || json.error || "Failed to update supplier.");
        return false;
      }
      setSupplier(json.data); onRefresh(); return true;
    } catch {
      showToast("Failed to update supplier.");
      return false;
    } finally { setBusy(false); }
  }

  // Enrich: step 1 — get preview
  async function handleEnrichPreview() {
    setEnriching(true); setEnrichPreview(null);
    try {
      const res = await fetch("/api/v1/suppliers/enrich", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ supplierId: supplier.id, mode: "preview" }) });
      const json = await res.json();
      if (json.preview) {
        setEnrichPreview(json.preview);
      } else {
        showToast("Enrichment failed: " + (json.error ?? "Unknown error"));
      }
    } catch { showToast("Enrichment request failed."); }
    finally { setEnriching(false); }
  }

  // Enrich: step 2 — commit reviewed data
  async function handleEnrichCommit() {
    if (!enrichPreview) return;
    setBusy(true);
    try {
      const res = await fetch("/api/v1/suppliers/enrich", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ supplierId: supplier.id, mode: "commit", enrichmentData: enrichPreview.proposed }) });
      const json = await res.json();
      if (json.data) {
        setSupplier(json.data); onRefresh();
        showToast(`Enrichment applied \u2014 ${json.enrichment?.fieldsUpdated?.length ?? 0} fields updated`);
      }
    } catch { showToast("Failed to apply enrichment."); }
    finally { setBusy(false); setEnrichPreview(null); }
  }

  // Soft archive (set to Blocked)
  async function handleDelete() {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/suppliers/${supplier.id}`, { method: "DELETE" });
      if (res.ok) { onRefresh(); onBack(); }
    } catch { showToast("Failed to archive supplier."); }
    finally { setBusy(false); setShowDeleteConfirm(false); }
  }

  // Permanent hard delete (only when already archived)
  async function handleHardDelete() {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/suppliers/${supplier.id}?permanent=true`, { method: "DELETE" });
      if (res.ok) { onRefresh(); onBack(); }
      else { const j = await res.json(); showToast(j.error?.message ?? j.error ?? "Failed to delete supplier."); }
    } catch { showToast("Failed to delete supplier permanently."); }
    finally { setBusy(false); setShowHardDeleteConfirm(false); }
  }

  // Restore from archive (set to Active)
  async function handleRestore() {
    const ok = await patchSupplier({ status: "Active" });
    if (ok) showToast("Supplier restored to Active.");
  }

  function openLinkedModule(moduleKey: string, contextId: string, title: string, subtitle: string, extra: Record<string, unknown> = {}) {
    if (typeof window === "undefined") return;
    const detail = {
      id: contextId,
      moduleKey,
      title,
      subtitle,
      icon: moduleKey === "rfqAutomation" ? "bolt" : moduleKey === "contracts" ? "handshake" : "playlist_add_check",
      ...extra,
    };
    window.history.replaceState(null, "", `#${moduleKey}:${encodeURIComponent(contextId)}`);
    window.dispatchEvent(new CustomEvent("nautex:record-context", { detail }));
  }

  function handlePrepareRFQRoute() {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("nautex:rfq-context", JSON.stringify({
        supplierId: supplier.id,
        supplierName: supplier.name,
        categories: supplier.categories,
        portsCovered: supplier.portsCovered,
        source: "supplier_directory",
      }));
    }
    openLinkedModule(
      "rfqAutomation",
      `preferred-supplier:${supplier.id}`,
      `RFQ route: ${supplier.name}`,
      "Preferred supplier context opened from Supplier Intelligence.",
      {
        supplierId: supplier.id,
        supplierName: supplier.name,
        categories: supplier.categories,
        portsCovered: supplier.portsCovered,
        source: "supplier_directory",
      },
    );
  }

  function handleCheckAgreementGap() {
    openLinkedModule(
      "contracts",
      supplier.id,
      `Agreement gap: ${supplier.name}`,
      `${procurementInsights.agreementLabel}. Review supplier agreement coverage before routing.`,
      { supplierId: supplier.id, supplierName: supplier.name },
    );
  }

  function handleFlagSupplierException() {
    openLinkedModule(
      "exceptionsQueue",
      supplier.id,
      `Supplier exception: ${supplier.name}`,
      risk.reasons.length > 0 ? risk.reasons.join(" | ") : "Supplier review context opened from Supplier Intelligence.",
      { supplierId: supplier.id, supplierName: supplier.name, riskScore: risk.score },
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "contacts", label: "Contacts" },
    { key: "performance", label: "Performance" },
    { key: "history", label: "History" },
  ];

  return (
    <div className="space-y-4">
      {/* ── Toast ────────────────────────────────────────────── */}
      {toast && (
        <div className="px-4 py-3 rounded-lg bg-success/10 border border-success/20 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-success"><IcCheck /> <span>{toast}</span></div>
          <button onClick={() => setToast(null)} className="text-success hover:text-success transition"><IcClose /></button>
        </div>
      )}

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-white/5 text-on-surface-variant hover:text-white transition"><IcArrowLeft /></button>
        <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center text-success font-bold text-sm">
          {supplier.name.substring(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-on-surface-variant font-mono">{supplier.supplierCode}</span>
            <h2 className="text-lg font-bold text-white">{supplier.name}</h2>
            <SupplierStatusSelect value={supplier.status} onCommit={async (v) => { await patchSupplier({ status: v }); }} />
            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${readinessClass(readiness.tone)}`}>{readiness.label}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${riskClass(risk.tone)}`}>{risk.label}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-on-surface-variant mt-0.5">
            <span className="flex items-center gap-1"><IcPin /> {supplier.region}{supplier.country ? `, ${supplier.country}` : ""}</span>
            {supplier.enrichmentStatus !== "None" && (
              <span className={`flex items-center gap-1 ${ENRICHMENT_STYLE[supplier.enrichmentStatus].color}`}>
                {supplier.enrichmentStatus === "Enriched" && <IcCheck />}
                {ENRICHMENT_STYLE[supplier.enrichmentStatus].label}
                {supplier.confidence !== null && supplier.enrichmentStatus === "Enriched" && ` (${confidencePct(supplier.confidence)})`}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isArchived && (
            <button onClick={handleEnrichPreview} disabled={enriching} className={`px-3 py-2 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${enriching ? "bg-ai/20 text-ai border border-ai/30" : "bg-ai/10 text-ai border border-ai/20 hover:bg-ai/20"}`} title="AI Enrich">
              {enriching ? <div className="w-3.5 h-3.5 border-2 border-ai/30 border-t-ai rounded-full animate-spin" /> : <IcWand />}
              {enriching ? "Analyzing..." : "Enrich"}
            </button>
          )}
          <button onClick={() => setEditing(!editing)} className={`px-3 py-2 rounded-lg text-xs transition flex items-center gap-1.5 border ${editing ? "bg-success/15 text-success border-success/30" : "text-on-surface-variant border-white/10 hover:border-white/20 hover:text-white"}`}>
            <IcEdit /> {editing ? "Done" : "Edit"}
          </button>
          {isArchived ? (
            <>
              <button onClick={handleRestore} disabled={busy} className="px-3 py-2 rounded-lg text-xs transition flex items-center gap-1.5 border border-success/20 text-success hover:bg-success/10" title="Restore supplier to Active">
                <IcCheck /> Restore
              </button>
              <button onClick={() => setShowHardDeleteConfirm(true)} className="px-3 py-2 rounded-lg text-xs transition flex items-center gap-1.5 border border-error/30 text-error hover:bg-error/10" title="Permanently delete this supplier">
                <IcTrash />
              </button>
            </>
          ) : (
            <button onClick={() => setShowDeleteConfirm(true)} className="px-3 py-2 rounded-lg text-xs transition flex items-center gap-1.5 border text-on-surface-variant border-white/10 hover:border-error/30 hover:text-error" title="Archive — hides from directory, reversible">
              <IcArchive />
            </button>
          )}
        </div>
      </div>

      {/* ── Archived state banner ───────────────────────────── */}
      {isArchived && !showHardDeleteConfirm && !showDeleteConfirm && (
        <div className="px-4 py-3 rounded-lg bg-error/20 border border-error/30 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs text-error">
            <IcArchive />
            <span>This supplier is <strong>archived</strong> — hidden from the directory. Restore it to make it active again, or permanently delete it.</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={handleRestore} disabled={busy} className="px-3 py-1.5 rounded-lg border border-success/20 text-xs text-success hover:bg-success/10 transition">Restore</button>
          </div>
        </div>
      )}

      {/* ── Archive confirmation ─────────────────────────────── */}
      {showDeleteConfirm && (
        <div className="px-4 py-3 rounded-lg bg-error/10 border border-error/20 flex items-center justify-between gap-4">
          <div className="text-xs text-error">
            <strong>Archive {supplier.name}?</strong> The supplier will be hidden from the directory and marked as archived. You can restore it later by changing its status back to Active.
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => setShowDeleteConfirm(false)} className="px-3 py-1.5 rounded-lg border border-white/10 text-xs text-on-surface-variant hover:text-white transition">Cancel</button>
            <button onClick={handleDelete} disabled={busy} className="px-3 py-1.5 rounded-lg bg-error/20 border border-error/30 text-xs text-error hover:bg-error/30 transition flex items-center gap-1">
              {busy ? <div className="w-3 h-3 border-2 border-error/30 border-t-error rounded-full animate-spin" /> : <IcArchive />} Archive
            </button>
          </div>
        </div>
      )}

      {/* ── Permanent delete confirmation ───────────────────── */}
      {showHardDeleteConfirm && (
        <div className="px-4 py-3 rounded-lg bg-error/10 border border-error/30 flex items-center justify-between gap-4">
          <div className="text-xs text-error">
            <strong>Permanently delete {supplier.name}?</strong> This cannot be undone — all data will be removed from the system. This action is only available for archived suppliers.
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => setShowHardDeleteConfirm(false)} className="px-3 py-1.5 rounded-lg border border-white/10 text-xs text-on-surface-variant hover:text-white transition">Cancel</button>
            <button onClick={handleHardDelete} disabled={busy} className="px-3 py-1.5 rounded-lg bg-error/30 border border-error/50 text-xs text-error hover:bg-error/40 transition flex items-center gap-1">
              {busy ? <div className="w-3 h-3 border-2 border-error/30 border-t-error rounded-full animate-spin" /> : <IcTrash />} Delete Permanently
            </button>
          </div>
        </div>
      )}

      {/* ── Enrichment review panel ─────────────────────────── */}
      <div className="rounded-xl bg-surface-container border border-white/5 p-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-bold text-white">Supplier Operations Readiness</h3>
            <p className="text-xs text-on-surface-variant mt-1">
              Buyer-controlled supplier record for RFQ routing, PO fulfillment, agreements, and invoice matching.
            </p>
          </div>
          <span className={`text-[10px] px-2.5 py-1 rounded-full border font-semibold ${readinessClass(readiness.tone)}`}>{readiness.label}</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-4">
          <ReadinessMetric label="POs" value={supplier._count?.purchaseOrders ?? 0} />
          <ReadinessMetric label="RFQ Quotes" value={supplier._count?.supplierQuotes ?? 0} />
          <ReadinessMetric label="Agreements" value={(supplier._count?.contracts ?? 0) + (supplier._count?.agreementVersions ?? 0)} />
          <ReadinessMetric label="Supplier Invoices" value={supplier._count?.supplierInvoices ?? 0} />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-4">
          <div className="rounded-lg bg-surface-low border border-white/5 p-3">
            <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">RFQ routing fit</p>
            <p className="text-sm text-white/80 font-semibold mt-2">
              {procurementInsights.bestCategories.length > 0 ? procurementInsights.bestCategories.join(", ") : "No categories mapped"}
            </p>
            <p className="text-xs text-on-surface-variant mt-1">{procurementInsights.recommendedUse}</p>
          </div>
          <div className="rounded-lg bg-surface-low border border-white/5 p-3">
            <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">Commercial context</p>
            <p className="text-sm text-white/80 font-semibold mt-2">{procurementInsights.agreementLabel}</p>
            <p className="text-xs text-on-surface-variant mt-1">{procurementInsights.purchaseLabel}</p>
          </div>
          <div className="rounded-lg bg-surface-low border border-white/5 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">Risk controls</p>
              <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${riskClass(risk.tone)}`}>{risk.score}/100</span>
            </div>
            <p className="text-sm text-white/80 font-semibold mt-2">{risk.label}</p>
            <p className="text-xs text-on-surface-variant mt-1">{risk.reasons.length > 0 ? risk.reasons.slice(0, 3).join(" | ") : "No material routing risk detected."}</p>
          </div>
        </div>
        {readiness.issues.length > 0 ? (
          <div className="mt-4 rounded-lg bg-warning/10 border border-warning/20 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-warning/80 font-semibold">Buyer review needed</p>
            <p className="text-xs text-warning/70 mt-1">{readiness.issues.join(" | ")}</p>
          </div>
        ) : (
          <div className="mt-4 rounded-lg bg-success/10 border border-success/20 px-3 py-2 text-xs text-success/70">
            Supplier has the minimum contact, coverage, category, and location data needed for supervised RFQ routing.
          </div>
        )}

        <SupplierRoutingMemoryPanel
          supplier={supplier}
          records={supplierMemory}
          totals={memoryTotals}
          loading={memoryLoading}
          error={memoryError}
        />

        <div className="flex items-center gap-2 mt-4 flex-wrap">
          <button
            onClick={handlePrepareRFQRoute}
            className="px-3 py-1.5 rounded-lg bg-success/10 border border-success/20 text-xs text-success hover:bg-success/15 transition"
          >
            Prepare RFQ Route
          </button>
          <button
            onClick={handleCheckAgreementGap}
            className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-on-surface-variant hover:text-white hover:border-white/20 transition"
          >
            Check Agreement Gap
          </button>
          <button
            onClick={handleFlagSupplierException}
            className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-on-surface-variant hover:text-white hover:border-white/20 transition"
          >
            Flag Supplier Exception
          </button>
        </div>
      </div>

      {enrichPreview && (
        <EnrichmentReviewPanel
          preview={enrichPreview}
          supplier={supplier}
          onCommit={handleEnrichCommit}
          onDismiss={() => setEnrichPreview(null)}
          busy={busy}
        />
      )}

      {/* ── Tabs ────────────────────────────────────────────── */}
      <div className="flex gap-1 border-b border-white/5 pb-px">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-xs font-medium rounded-t-lg transition ${tab === t.key ? "bg-surface-container text-success border-b-2 border-success" : "text-on-surface-variant hover:text-on-surface-variant"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab supplier={supplier} editing={editing} onPatch={patchSupplier} busy={busy} />}
      {tab === "overview" && <JevReviewPanel key={`${supplier.id}:${supplier.updatedAt ?? ""}`} kind="supplier" recordId={supplier.id} />}
      {tab === "contacts" && <ContactsTab supplier={supplier} editing={editing} onPatch={patchSupplier} />}
      {tab === "performance" && <PerformanceTab supplier={supplier} editing={editing} onPatch={patchSupplier} />}
      {tab === "history" && <HistoryTab supplier={supplier} />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ENRICHMENT REVIEW PANEL
   ═══════════════════════════════════════════════════════════════ */

interface EnrichPreviewData {
  proposed: Record<string, unknown>;
  changes: Record<string, { from: unknown; to: unknown }>;
  changeCount: number;
  confidence: number;
  sourceNotes: string | null;
  model: string;
  provider: string;
}

function EnrichmentReviewPanel({ preview, supplier, onCommit, onDismiss, busy }: {
  preview: EnrichPreviewData; supplier: Supplier; onCommit: () => void; onDismiss: () => void; busy: boolean;
}) {
  const changeKeys = Object.keys(preview.changes);

  return (
    <div className="rounded-xl bg-ai/5 border border-ai/20 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <IcWand />
          <h4 className="text-sm font-bold text-ai">AI Enrichment Preview</h4>
          <span className="text-[10px] text-on-surface-variant">
            {changeKeys.length} change{changeKeys.length !== 1 ? "s" : ""} proposed \u00b7 Confidence: {confidencePct(preview.confidence)}
          </span>
        </div>
        <button onClick={onDismiss} className="text-on-surface-variant hover:text-on-surface-variant transition"><IcClose /></button>
      </div>

      {preview.sourceNotes && (
        <p className="text-[10px] text-on-surface-variant italic">{preview.sourceNotes}</p>
      )}

      {changeKeys.length === 0 ? (
        <p className="text-xs text-on-surface-variant">No changes to apply \u2014 profile is already up to date.</p>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {changeKeys.map((key) => {
            const { from, to } = preview.changes[key];
            return (
              <div key={key} className="flex items-start gap-3 text-xs">
                <span className="text-on-surface-variant w-28 shrink-0 capitalize">{key.replace(/([A-Z])/g, " $1").trim()}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-error/60 line-through truncate">{Array.isArray(from) ? (from as string[]).join(", ") || "\u2014" : String(from ?? "\u2014")}</div>
                  <div className="text-success truncate">{Array.isArray(to) ? (to as string[]).join(", ") : String(to ?? "\u2014")}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button onClick={onDismiss} className="px-3 py-1.5 rounded-lg border border-white/10 text-xs text-on-surface-variant hover:text-white transition">Dismiss</button>
        {changeKeys.length > 0 && (
          <button onClick={onCommit} disabled={busy} className="px-4 py-1.5 rounded-lg bg-ai/20 border border-ai/30 text-xs text-ai hover:bg-ai/30 transition flex items-center gap-1.5 font-semibold">
            {busy ? <div className="w-3 h-3 border-2 border-ai/30 border-t-ai rounded-full animate-spin" /> : <IcCheck />} Apply Changes
          </button>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   OVERVIEW TAB
   ═══════════════════════════════════════════════════════════════ */

function SupplierRoutingMemoryPanel({
  supplier,
  records,
  totals,
  loading,
  error,
}: {
  supplier: Supplier;
  records: SupplierMemoryRecord[];
  totals: SupplierMemoryTotals | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="mt-4 rounded-lg bg-surface-low border border-white/5 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">Supplier routing memory</p>
          <p className="mt-1 text-xs text-on-surface-variant">
            Wrist-style supplier routing evidence from Nautex match feedback and source reliability.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[10px]">
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-on-surface-variant">
            {records.length} relevant
          </span>
          {totals && (
            <span className="rounded-full border border-success/20 bg-success/10 px-2 py-0.5 text-success">
              {totals.acceptRate}% accept rate
            </span>
          )}
        </div>
      </div>

      {totals && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <ReadinessMetric label="Signals" value={totals.feedbackCount} />
          <ReadinessMetric label="Sources" value={totals.sourceCount} />
          <ReadinessMetric label="Edits" value={`${totals.editRate}%`} />
        </div>
      )}

      <div className="mt-3 space-y-2">
        {loading ? (
          <div className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-on-surface-variant">
            Loading supplier routing memory...
          </div>
        ) : error ? (
          <div className="rounded-lg border border-warning/20 bg-warning/10 px-3 py-2 text-xs text-warning/70">
            {error}
          </div>
        ) : records.length === 0 ? (
          <div className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-on-surface-variant">
            No supplier-specific routing memory found for {supplier.name}. Future accepted, rejected, or edited routing decisions will appear here.
          </div>
        ) : (
          records.map((record) => (
            <div key={record.id} className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${memoryConfidenceClass(record.confidence)}`}>
                  {record.confidence}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-on-surface-variant">{memoryTypeLabel(record.memoryType)}</span>
                <span className="ml-auto text-[10px] text-on-surface-variant">{new Date(record.lastObservedAt).toLocaleDateString()}</span>
              </div>
              <p className="mt-1 text-xs text-white/65">{supplierMemoryDescription(record, supplier)}</p>
              <p className="mt-1 truncate font-mono text-[10px] text-on-surface-variant" title={record.memoryKey}>{record.memoryKey}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function OverviewTab({ supplier: s, editing, onPatch, busy }: {
  supplier: Supplier; editing: boolean; onPatch: (d: Record<string, unknown>) => Promise<boolean>; busy: boolean;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <InfoCard title="About">
          {editing ? <InlineTextarea value={s.description ?? ""} placeholder="Add a description..." onCommit={(v) => onPatch({ description: v || null })} busy={busy} />
            : <p className="text-sm text-white/70">{s.description || <span className="text-on-surface-variant italic">No description</span>}</p>}
        </InfoCard>

        <InfoCard title="Details">
          <div className="grid grid-cols-2 gap-3">
            <EditableDetail label="Region" value={s.region} field="region" editing={editing} onPatch={onPatch} />
            <EditableDetail label="Country" value={s.country} field="country" editing={editing} onPatch={onPatch} />
            <EditableDetail label="City" value={s.city} field="city" editing={editing} onPatch={onPatch} />
            <EditableDetail label="Address" value={s.address} field="address" editing={editing} onPatch={onPatch} />
            <EditableDetail label="Lead Time" value={s.leadTimeDays ? `${s.leadTimeDays} days` : null} field="leadTimeDays" editing={editing} onPatch={(d) => onPatch({ leadTimeDays: parseInt(d.leadTimeDays as string) || 0 })} />
            <DetailItem label="Supplier Code" value={s.supplierCode} />
          </div>
        </InfoCard>

        <InfoCard title="Categories & Ports">
          <div className="space-y-4">
            <div>
              <p className="text-[10px] text-on-surface-variant mb-1.5">Categories</p>
              <EditableTags
                values={s.categories}
                editing={editing}
                onCommit={(v) => onPatch({ categories: v })}
                colorClass="bg-success/10 text-success"
                borderClass="border-success/20"
                placeholder="Add category..."
                emptyText="No categories"
              />
            </div>
            <div>
              <p className="text-[10px] text-on-surface-variant mb-1.5">Ports Covered</p>
              <EditableTags
                values={s.portsCovered}
                editing={editing}
                onCommit={(v) => onPatch({ portsCovered: v })}
                colorClass="bg-info/10 text-info"
                borderClass="border-info/20"
                placeholder="Add port..."
                emptyText="No ports specified"
              />
            </div>
          </div>
        </InfoCard>
      </div>

      <div className="space-y-4">
        {/* Embedded map — regional context with nearby hubs */}
        <InfoCard title="Location">
          <div className="rounded-lg overflow-hidden" style={{ height: 240 }}>
            {s.lat !== null && s.lng !== null ? (
              <SupplierProfileMap
                lat={s.lat}
                lng={s.lng}
                name={s.name}
                address={s.address ?? `${s.city ?? ""}, ${s.country ?? ""}`}
                portsCovered={s.portsCovered}
                status={s.status}
              />
            ) : (
              <div className="w-full h-full bg-surface-low flex flex-col items-center justify-center gap-2">
                <IcPin />
                <span className="text-[10px] text-on-surface-variant">No location data</span>
                {editing && <span className="text-[10px] text-on-surface-variant">Use Enrich to add coordinates</span>}
              </div>
            )}
          </div>
          {s.lat !== null && s.lng !== null && (
            <div className="flex items-center justify-between text-[10px] text-on-surface-variant mt-1 px-0.5">
              <span>{s.city ?? s.region}{s.country ? `, ${s.country}` : ""}</span>
              <span className="font-mono">{s.lat.toFixed(3)}, {s.lng.toFixed(3)}</span>
            </div>
          )}
        </InfoCard>

        <InfoCard title="Score Breakdown">
          <div className="flex items-center gap-4 mb-2">
            <div className={`text-4xl font-bold ${scoreBadge(s.score)}`}>{s.score}</div>
            <div className="flex-1">
              <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                <div className={`h-full rounded-full transition-all ${s.score >= 90 ? "bg-success" : s.score >= 70 ? "bg-warning" : "bg-error"}`} style={{ width: `${s.score}%` }} />
              </div>
              <p className="text-[10px] text-on-surface-variant mt-1">Profile completeness score</p>
            </div>
          </div>
          <ScoreBreakdown supplier={s} />
        </InfoCard>

        <InfoCard title="Status">
          <SupplierStatusSelect value={s.status} onCommit={(v) => onPatch({ status: v })} />
        </InfoCard>

        <InfoCard title="AI Enrichment">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-on-surface-variant">Status</span>
              <span className={`text-xs font-medium ${ENRICHMENT_STYLE[s.enrichmentStatus].color}`}>{ENRICHMENT_STYLE[s.enrichmentStatus].label}</span>
            </div>
            {s.confidence !== null && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-on-surface-variant">Confidence</span>
                <span className="text-xs text-white/70 font-medium">{confidencePct(s.confidence)}</span>
              </div>
            )}
          </div>
        </InfoCard>

        <InfoCard title="Linked Activity">
          <div className="space-y-2.5">
            {/* Contracts — real count from DB */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-on-surface-variant">Contracts on file</span>
              {(s._count?.contracts ?? 0) > 0
                ? <span className="text-success font-semibold">{s._count!.contracts}</span>
                : <span className="text-on-surface-variant">None</span>}
            </div>
            {/* Quotes — real count from DB */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-on-surface-variant">Quotes on file</span>
              {(s._count?.supplierQuotes ?? 0) > 0
                ? <span className="text-info font-semibold">{s._count!.supplierQuotes}</span>
                : <span className="text-on-surface-variant">None</span>}
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-on-surface-variant">Agreement versions</span>
              {(s._count?.agreementVersions ?? 0) > 0
                ? <span className="text-success font-semibold">{s._count!.agreementVersions}</span>
                : <span className="text-on-surface-variant">None</span>}
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-on-surface-variant">Purchase orders</span>
              {(s._count?.purchaseOrders ?? 0) > 0
                ? <span className="text-warning font-semibold">{s._count!.purchaseOrders}</span>
                : <span className="text-on-surface-variant">None</span>}
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-on-surface-variant">Supplier invoices</span>
              {(s._count?.supplierInvoices ?? 0) > 0
                ? <span className="text-ai font-semibold">{s._count!.supplierInvoices}</span>
                : <span className="text-on-surface-variant">None</span>}
            </div>
          </div>
        </InfoCard>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SCORE BREAKDOWN
   ═══════════════════════════════════════════════════════════════ */

function ScoreBreakdown({ supplier: s }: { supplier: Supplier }) {
  const factors = [
    { label: "Name", filled: !!s.name, w: 10 },
    { label: "Region", filled: s.region !== "Unknown", w: 8 },
    { label: "Country", filled: !!s.country, w: 8 },
    { label: "City", filled: !!s.city, w: 5 },
    { label: "Address", filled: !!s.address, w: 5 },
    { label: "Email", filled: !!s.email, w: 10 },
    { label: "Phone", filled: !!s.phone, w: 8 },
    { label: "Website", filled: !!s.website, w: 8 },
    { label: "Contact", filled: !!s.contactPerson, w: 8 },
    { label: "Description", filled: !!s.description, w: 10 },
    { label: "Categories", filled: s.categories.length > 0, w: 10 },
    { label: "Ports", filled: s.portsCovered.length > 0, w: 5 },
    { label: "Location", filled: s.lat !== null, w: 5 },
  ];

  return (
    <div className="space-y-1">
      {factors.map((f) => (
        <div key={f.label} className="flex items-center gap-2 text-[10px]">
          <span className={`w-3 h-3 rounded-sm flex items-center justify-center ${f.filled ? "bg-success/20 text-success" : "bg-white/5 text-on-surface-variant"}`}>
            {f.filled ? "\u2713" : ""}
          </span>
          <span className={f.filled ? "text-on-surface-variant" : "text-on-surface-variant"}>{f.label}</span>
          <span className={`ml-auto font-mono ${f.filled ? "text-success" : "text-on-surface-variant"}`}>+{f.w}</span>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   CONTACTS TAB
   ═══════════════════════════════════════════════════════════════ */

function ContactsTab({ supplier: s, editing, onPatch }: {
  supplier: Supplier; editing: boolean; onPatch: (d: Record<string, unknown>) => Promise<boolean>;
}) {
  return (
    <div className="max-w-xl space-y-4">
      <InfoCard title="Contact Information">
        <div className="space-y-3">
          <EditableDetail label="Contact Person" value={s.contactPerson} field="contactPerson" editing={editing} onPatch={onPatch} icon={<IcStar />} />
          <EditableDetail label="Email" value={s.email} field="email" editing={editing} onPatch={onPatch} icon={<IcMail />} />
          <EditableDetail label="Phone" value={s.phone} field="phone" editing={editing} onPatch={onPatch} icon={<IcPhone />} />
          <EditableDetail label="Website" value={s.website} field="website" editing={editing} onPatch={onPatch} icon={<IcGlobe />} />
          <EditableDetail label="Address" value={s.address} field="address" editing={editing} onPatch={onPatch} icon={<IcPin />} />
        </div>
      </InfoCard>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PERFORMANCE TAB
   ═══════════════════════════════════════════════════════════════ */

function PerformanceTab({ supplier: s, editing, onPatch }: {
  supplier: Supplier; editing: boolean; onPatch: (d: Record<string, unknown>) => Promise<boolean>;
}) {
  return (
    <div className="max-w-xl space-y-4">
      <InfoCard title="Performance Metrics">
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className={`text-5xl font-bold ${scoreBadge(s.score)}`}>{s.score}</div>
            <div className="flex-1 space-y-1">
              <div className="h-3 rounded-full bg-white/5 overflow-hidden">
                <div className={`h-full rounded-full transition-all ${s.score >= 90 ? "bg-success" : s.score >= 70 ? "bg-warning" : "bg-error"}`} style={{ width: `${s.score}%` }} />
              </div>
              <p className="text-xs text-on-surface-variant">Profile completeness score \u2014 based on filled data fields</p>
            </div>
          </div>
          {editing && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-on-surface-variant">Override score:</label>
              <input type="number" min={0} max={100} defaultValue={s.score}
                onBlur={(e) => { const v = Math.max(0, Math.min(100, parseInt(e.target.value) || 0)); if (v !== s.score) onPatch({ score: v }); }}
                className="w-20 px-2 py-1 rounded bg-surface-low border border-white/10 text-sm text-white focus:outline-none focus:border-success/40" />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="rounded-lg bg-surface-low p-3">
              <p className="text-[10px] text-on-surface-variant">Lead Time</p>
              <p className="text-lg font-bold text-white">{s.leadTimeDays} <span className="text-xs text-on-surface-variant font-normal">days</span></p>
            </div>
            <div className="rounded-lg bg-surface-low p-3">
              <p className="text-[10px] text-on-surface-variant">AI Confidence</p>
              <p className="text-lg font-bold text-white">{confidencePct(s.confidence)}</p>
            </div>
          </div>
          <ScoreBreakdown supplier={s} />
        </div>
      </InfoCard>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   HISTORY TAB
   ═══════════════════════════════════════════════════════════════ */

function HistoryTab({ supplier: s }: { supplier: Supplier }) {
  return (
    <div className="max-w-xl space-y-4">
      <InfoCard title="Supplier Timeline">
        <div className="space-y-3">
          <TimelineEntry color="bg-success" label="Created" value={new Date(s.createdAt).toLocaleDateString()} />
          <TimelineEntry color="bg-info" label="Last Updated" value={new Date(s.updatedAt).toLocaleDateString()} />
          {s.enrichmentStatus === "Enriched" && <TimelineEntry color="bg-ai" label="AI Enriched" value={`Confidence: ${confidencePct(s.confidence)}`} />}
          <TimelineEntry color={s.status === "Active" || s.status === "Verified" ? "bg-success" : "bg-warning"} label="Current Status" value={statusLabel(s.status)} />
        </div>
      </InfoCard>
    </div>
  );
}

function TimelineEntry({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 text-xs">
      <div className={`w-2 h-2 rounded-full ${color}`} />
      <span className="text-on-surface-variant">{label}</span>
      <span className="text-on-surface-variant ml-auto">{value}</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SHARED COMPONENTS
   ═══════════════════════════════════════════════════════════════ */

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-surface-container border border-white/5 p-4 space-y-3">
      <h4 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">{title}</h4>
      {children}
    </div>
  );
}

function ReadinessMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-surface-low border border-white/5 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">{label}</p>
      <p className="text-lg font-bold text-white mt-1">{value}</p>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string | null }) {
  return <div><p className="text-[10px] text-on-surface-variant">{label}</p><p className="text-sm text-white/80 font-medium">{value || <span className="text-on-surface-variant italic">{"\u2014"}</span>}</p></div>;
}

function EditableDetail({ label, value, field, editing, onPatch, icon }: {
  label: string; value: string | null; field: string; editing: boolean; onPatch: (d: Record<string, unknown>) => Promise<boolean>; icon?: React.ReactNode;
}) {
  const [localValue, setLocalValue] = useState(value ?? "");
  // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset the draft when the selected supplier record changes.
  useEffect(() => { setLocalValue(value ?? ""); }, [value]);

  const isWebsite = field === "website";
  const href = isWebsite ? normalizeUrl(value) : null;

  if (!editing) {
    return (
      <div>
        <p className="text-[10px] text-on-surface-variant flex items-center gap-1">{icon}{label}</p>
        {isWebsite && href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
            className="text-sm text-info hover:text-info font-medium transition underline underline-offset-2 decoration-info/30 hover:decoration-info/50 truncate block">
            {value}
          </a>
        ) : (
          <p className="text-sm text-white/80 font-medium">{value || <span className="text-on-surface-variant italic">{"\u2014"}</span>}</p>
        )}
      </div>
    );
  }
  return (
    <div>
      <p className="text-[10px] text-on-surface-variant flex items-center gap-1">{icon}{label}</p>
      <input type="text" value={localValue} onChange={(e) => setLocalValue(e.target.value)}
        onBlur={() => { const t = localValue.trim(); if (t !== (value ?? "")) onPatch({ [field]: t || null }); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="w-full px-2 py-1 rounded bg-surface-low border border-white/10 text-sm text-white placeholder:text-on-surface-variant focus:outline-none focus:border-success/40 mt-0.5"
        placeholder={`Enter ${label.toLowerCase()}...`} />
    </div>
  );
}

function InlineTextarea({ value, placeholder, onCommit, busy }: { value: string; placeholder: string; onCommit: (v: string) => void; busy: boolean }) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  return <textarea value={local} onChange={(e) => setLocal(e.target.value)} onBlur={() => { if (local.trim() !== value) onCommit(local.trim()); }} placeholder={placeholder} rows={3} disabled={busy} className="w-full px-3 py-2 rounded-lg bg-surface-low border border-white/10 text-sm text-white placeholder:text-on-surface-variant focus:outline-none focus:border-success/40 resize-none" />;
}

function SupplierStatusSelect({ value, onCommit }: { value: SupplierStatus; onCommit: (v: SupplierStatus) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { function h(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); } if (open) document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, [open]);
  const options: SupplierStatus[] = ["Active", "Verified", "Suggested", "Watch", "Inactive", "Blocked", "Rejected", "Needs_Review"];
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className={`text-xs px-2.5 py-1 rounded-full border font-medium transition ${STATUS_STYLE[value] ?? "text-on-surface-variant"}`}>{statusLabel(value)}</button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 w-40 bg-surface-container border border-white/10 rounded-lg shadow-xl py-1">
          {options.map((opt) => (
            <button key={opt} onClick={() => { onCommit(opt); setOpen(false); }}
              className={`w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 transition ${value === opt ? "bg-success/10 text-success" : "text-on-surface-variant hover:bg-white/5"}`}>
              <span className={`px-1.5 py-0.5 rounded-full border text-[10px] font-medium ${STATUS_STYLE[opt]}`}>{statusLabel(opt)}</span>
              {value === opt && <span className="ml-auto text-success"><IcCheck /></span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   EDITABLE TAGS — for Categories and Ports
   ═══════════════════════════════════════════════════════════════ */

function EditableTags({ values, editing, onCommit, colorClass, borderClass, placeholder, emptyText }: {
  values: string[];
  editing: boolean;
  onCommit: (v: string[]) => void;
  colorClass: string;
  borderClass: string;
  placeholder?: string;
  emptyText?: string;
}) {
  const [local, setLocal] = useState(values);
  const [input, setInput] = useState("");

  useEffect(() => { setLocal(values); }, [values]);

  function addTag(raw: string) {
    const tags = raw.split(",").map((t) => t.trim()).filter(Boolean);
    const next = [...local, ...tags.filter((t) => !local.includes(t))];
    setLocal(next);
    onCommit(next);
    setInput("");
  }

  function removeTag(tag: string) {
    const next = local.filter((t) => t !== tag);
    setLocal(next);
    onCommit(next);
  }

  if (!editing) {
    return local.length > 0 ? (
      <div className="flex flex-wrap gap-1.5">
        {local.map((t) => (
          <span key={t} className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${colorClass} ${borderClass}`}>{t}</span>
        ))}
      </div>
    ) : <p className="text-xs text-on-surface-variant italic">{emptyText ?? "None"}</p>;
  }

  return (
    <div className="space-y-2">
      {local.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {local.map((t) => (
            <span key={t} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${colorClass} ${borderClass}`}>
              {t}
              <button type="button" onClick={() => removeTag(t)} className="opacity-50 hover:opacity-100 transition leading-none ml-0.5">&times;</button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(input); }
            if (e.key === "Backspace" && !input && local.length > 0) { removeTag(local[local.length - 1]); }
          }}
          placeholder={placeholder ?? "Add item..."}
          className="flex-1 px-2.5 py-1.5 rounded-lg bg-surface-low border border-white/10 text-xs text-white placeholder:text-on-surface-variant focus:outline-none focus:border-success/40"
        />
        <button type="button" onClick={() => addTag(input)}
          className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-on-surface-variant hover:text-white hover:bg-white/10 transition">
          Add
        </button>
      </div>
    </div>
  );
}
