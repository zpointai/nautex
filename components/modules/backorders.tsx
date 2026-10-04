"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MODULE_STATUS, STATUS_STYLE } from "@/lib/modules/module-status";

type BackorderStatus = "open" | "escalated" | "resolved" | "dismissed";
type BackorderPriority = "critical" | "high" | "normal";

interface BackorderItem {
  id?: string;
  description: string;
  qty: number;
  unit: string;
  requestedDate: string;
  delayDays: number;
  remarks?: string | null;
}

interface Backorder {
  id: string;
  poId?: string;
  poNumber: string;
  vendor: string;
  supplierId?: string | null;
  supplierEmail?: string | null;
  supplierContact?: string | null;
  vessel: string;
  port?: string | null;
  eta?: string;
  status: BackorderStatus;
  priority: BackorderPriority;
  totalDelayDays: number;
  requestDate: string;
  items: BackorderItem[];
  notes?: string;
  escalatedAt?: string;
  resolvedAt?: string;
  backorderNumber?: string;
  source?: "purchase_order_lines" | "backorder_case";
}

interface BackorderKpis {
  openOrders: number;
  openLines: number;
  criticalOrders: number;
  escalatedOrders: number;
  avgDelayDays: number;
  resolvedOrders: number;
  affectedSuppliers: number;
}

interface DraftEmail {
  to: string | null;
  subject: string;
  body: string;
  confidence: number;
  provider: string;
  model: string;
  fallbackUsed: boolean;
  automationIdeas: string[];
}

interface BulkDraftRow {
  backorderId: string;
  poId: string;
  poNumber: string;
  vendor: string;
  priority: BackorderPriority;
  delayDays: number;
  draft: DraftEmail;
}

interface BackordersPayload {
  ok?: boolean;
  data?: Backorder[];
  error?: { message?: string };
  meta?: { kpis?: BackorderKpis };
}

interface RecordContextDetail {
  moduleKey?: string;
  id?: string;
  label?: string;
  title?: string;
  tab?: string;
}

interface BackordersModuleProps {
  onNavigate?: (moduleKey: string) => void;
}

function Ic({ name, className = "" }: { name: string; className?: string }) {
  return <span className={`material-symbols-outlined ${className}`} style={{ fontVariationSettings: "'FILL' 0, 'wght' 300, 'opsz' 20" }}>{name}</span>;
}

type DropdownId = "priority" | "vendor" | "sort";

interface DropdownOption<T extends string> {
  value: T;
  label: string;
}

export function BackordersModule({ onNavigate }: BackordersModuleProps) {
  const [backorders, setBackorders] = useState<Backorder[]>([]);
  const [apiKpis, setApiKpis] = useState<BackorderKpis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | BackorderStatus>("all");
  const [priorityFilter, setPriorityFilter] = useState<"all" | BackorderPriority>("all");
  const [vendorFilter, setVendorFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"delay" | "date" | "vendor">("delay");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, DraftEmail>>({});
  const [draftingId, setDraftingId] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [caseBusyId, setCaseBusyId] = useState<string | null>(null);
  const [automationBusy, setAutomationBusy] = useState<"bulk" | "monitor" | null>(null);
  const [bulkDrafts, setBulkDrafts] = useState<BulkDraftRow[]>([]);
  const [automationNotice, setAutomationNotice] = useState<string | null>(null);
  const [openDropdown, setOpenDropdown] = useState<DropdownId | null>(null);

  const fetchBackorders = useCallback(async () => {
    setLoading(true);
    setError(null);
    setAutomationNotice(null);
    try {
      const res = await fetch("/api/v1/backorders");
      const payload = await res.json() as BackordersPayload;
      if (!res.ok || payload.ok === false) {
        throw new Error(payload.error?.message || "Failed to load backorders.");
      }
      setBackorders(Array.isArray(payload.data) ? payload.data : []);
      setApiKpis(payload.meta?.kpis ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load backorders.");
      setBackorders([]);
      setApiKpis(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchBackorders();
  }, [fetchBackorders]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const applyContext = (value: string) => {
      const decoded = decodeURIComponent(value);
      setSearch(decoded);
      setVendorFilter("all");
      setStatusFilter("all");
      setPriorityFilter("all");
    };

    const openFromHash = () => {
      const hash = window.location.hash.replace(/^#/, "");
      const [moduleKey, id] = hash.split(":");
      if (moduleKey === "backorders" && id) applyContext(id);
    };

    const handleRecordContext = (event: Event) => {
      const detail = (event as CustomEvent<RecordContextDetail>).detail;
      if (detail?.moduleKey === "backorders" && detail.id) {
        applyContext(detail.title ?? detail.label ?? detail.id);
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

  const vendors = useMemo(() => [...new Set(backorders.map((b) => b.vendor))], [backorders]);
  const priorityOptions = useMemo<DropdownOption<typeof priorityFilter>[]>(() => [
    { value: "all", label: "All priorities" },
    { value: "critical", label: "Critical" },
    { value: "high", label: "High" },
    { value: "normal", label: "Normal" },
  ], []);
  const vendorOptions = useMemo<DropdownOption<string>[]>(() => [
    { value: "all", label: "All vendors" },
    ...vendors.map((vendor) => ({ value: vendor, label: vendor })),
  ], [vendors]);
  const sortOptions = useMemo<DropdownOption<typeof sortBy>[]>(() => [
    { value: "delay", label: "Sort: Delay down" },
    { value: "date", label: "Sort: Date down" },
    { value: "vendor", label: "Sort: Vendor A-Z" },
  ], []);
  const supplierExposure = useMemo(() => {
    const counts = new Map<string, { vendor: string; orders: number; lines: number; maxDelay: number }>();
    for (const backorder of backorders) {
      if (backorder.status !== "open" && backorder.status !== "escalated") continue;
      const current = counts.get(backorder.vendor) ?? { vendor: backorder.vendor, orders: 0, lines: 0, maxDelay: 0 };
      current.orders += 1;
      current.lines += backorder.items.length;
      current.maxDelay = Math.max(current.maxDelay, backorder.totalDelayDays);
      counts.set(backorder.vendor, current);
    }
    return [...counts.values()].sort((a, b) => b.lines - a.lines || b.maxDelay - a.maxDelay || a.vendor.localeCompare(b.vendor));
  }, [backorders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
      const items = backorders.filter((b) => {
      if (statusFilter === "active" && !["open", "escalated"].includes(b.status)) return false;
      if (statusFilter !== "all" && statusFilter !== "active" && b.status !== statusFilter) return false;
      if (priorityFilter !== "all" && b.priority !== priorityFilter) return false;
      if (vendorFilter !== "all" && b.vendor !== vendorFilter) return false;
      if (!q) return true;
      return b.poNumber.toLowerCase().includes(q) ||
        b.vendor.toLowerCase().includes(q) ||
        b.vessel.toLowerCase().includes(q) ||
        b.items.some((i) => i.description.toLowerCase().includes(q));
    });

    return [...items].sort((a, b) => {
      if (sortBy === "delay") return b.totalDelayDays - a.totalDelayDays;
      if (sortBy === "vendor") return a.vendor.localeCompare(b.vendor);
      return new Date(b.requestDate).getTime() - new Date(a.requestDate).getTime();
    });
  }, [backorders, statusFilter, priorityFilter, vendorFilter, sortBy, search]);

  const kpis = useMemo(() => {
    if (apiKpis) return apiKpis;
    const open = backorders.filter((b) => b.status === "open" || b.status === "escalated");
    const affectedSuppliers = new Set(open.map((b) => b.vendor)).size;
    return {
      openOrders: open.length,
      openLines: open.reduce((sum, b) => sum + b.items.length, 0),
      criticalOrders: open.filter((b) => b.priority === "critical").length,
      escalatedOrders: backorders.filter((b) => b.status === "escalated").length,
      avgDelayDays: open.length > 0 ? Math.round(open.reduce((s, b) => s + b.totalDelayDays, 0) / open.length) : 0,
      resolvedOrders: backorders.filter((b) => b.status === "resolved").length,
      affectedSuppliers,
    };
  }, [apiKpis, backorders]);

  const automationSignals = useMemo(() => {
    const signals = [];
    if (kpis.criticalOrders > 0) signals.push({ icon: "priority_high", label: "Critical chase queue", value: `${kpis.criticalOrders} PO${kpis.criticalOrders === 1 ? "" : "s"}`, tone: "danger" as const });
    if (kpis.openLines > 0) signals.push({ icon: "mark_email_unread", label: "Supplier follow-ups", value: `${kpis.openLines} line${kpis.openLines === 1 ? "" : "s"}`, tone: "warn" as const });
    if (kpis.affectedSuppliers > 0) signals.push({ icon: "manage_history", label: "24h reply monitor", value: `${kpis.affectedSuppliers} supplier${kpis.affectedSuppliers === 1 ? "" : "s"}`, tone: "ok" as const });
    signals.push({ icon: "fact_check", label: "Dispatch evidence", value: "On confirmation", tone: "ok" as const });
    return signals;
  }, [kpis]);

  useEffect(() => {
    if (!search.trim()) return;
    const q = search.trim().toLowerCase();
    const match = backorders.find((b) => b.poNumber.toLowerCase() === q || b.id.toLowerCase() === q);
    if (match) setExpandedId(match.id);
  }, [backorders, search]);

  const statusInfo = MODULE_STATUS.backorders;

  const resetBackorderFocus = useCallback(() => {
    setSearch("");
    setStatusFilter("all");
    setPriorityFilter("all");
    setVendorFilter("all");
    setExpandedId(null);
  }, []);

  const focusFirstMatch = useCallback((items: Backorder[]) => {
    const first = items[0];
    if (first) setExpandedId(first.id);
  }, []);

  const handleKpiAction = useCallback((action: "open" | "lines" | "critical" | "escalated" | "delay" | "suppliers") => {
    resetBackorderFocus();
    setSortBy("delay");

    if (action === "open" || action === "lines") {
      setStatusFilter("active");
      return;
    }

    if (action === "critical") {
      setPriorityFilter("critical");
      return;
    }

    if (action === "escalated") {
      setStatusFilter("escalated");
      return;
    }

    if (action === "delay") {
      focusFirstMatch([...backorders].filter((b) => b.status !== "resolved").sort((a, b) => b.totalDelayDays - a.totalDelayDays));
      return;
    }

    const topSupplier = supplierExposure[0]?.vendor;
    if (topSupplier) {
      setVendorFilter(topSupplier);
    }
  }, [backorders, focusFirstMatch, resetBackorderFocus, supplierExposure]);

  const openPurchaseOrder = useCallback((backorder: Backorder) => {
    const id = backorder.poId ?? backorder.poNumber;
    if (typeof window !== "undefined") {
      const detail: RecordContextDetail = {
        moduleKey: "purchaseOrders",
        id,
        label: backorder.poNumber,
        title: backorder.poNumber,
        tab: "lines",
      };
      window.history.replaceState(null, "", `#purchaseOrders:${encodeURIComponent(id)}`);
      window.dispatchEvent(new CustomEvent("nautex:record-context", { detail }));
    }
    onNavigate?.("purchaseOrders");
  }, [onNavigate]);

  const handleDraftEmail = useCallback(async (backorder: Backorder) => {
    setDraftingId(backorder.id);
    setDraftError(null);
    try {
      const res = await fetch(`/api/v1/backorders/${encodeURIComponent(backorder.id)}/draft-email`, { method: "POST" });
      const payload = await res.json() as { ok?: boolean; data?: DraftEmail; error?: { message?: string } };
      if (!res.ok || payload.ok === false || !payload.data) {
        throw new Error(payload.error?.message || "Failed to draft supplier email.");
      }
      setDrafts((current) => ({ ...current, [backorder.id]: payload.data as DraftEmail }));
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "Failed to draft supplier email.");
    } finally {
      setDraftingId(null);
    }
  }, []);

  const handleCreateCase = useCallback(async (backorder: Backorder) => {
    if (!backorder.poId) return;
    setCaseBusyId(backorder.id);
    setDraftError(null);
    try {
      const res = await fetch("/api/v1/backorders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `backorder-create-${backorder.poId}`,
        },
        body: JSON.stringify({ purchaseOrderId: backorder.poId }),
      });
      const payload = await res.json() as { ok?: boolean; error?: { message?: string } };
      if (!res.ok || payload.ok === false) throw new Error(payload.error?.message || "Failed to create backorder case.");
      await fetchBackorders();
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "Failed to create backorder case.");
    } finally {
      setCaseBusyId(null);
    }
  }, [fetchBackorders]);

  const handleTransition = useCallback(async (backorder: Backorder, action: "escalate" | "resolve" | "dismiss" | "reopen") => {
    setCaseBusyId(backorder.id);
    setDraftError(null);
    try {
      const res = await fetch(`/api/v1/backorders/${encodeURIComponent(backorder.id)}/transition`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `backorder-${action}-${backorder.id}-${backorder.status}`,
        },
        body: JSON.stringify({ action }),
      });
      const payload = await res.json() as { ok?: boolean; error?: { message?: string } };
      if (!res.ok || payload.ok === false) throw new Error(payload.error?.message || "Failed to update backorder case.");
      await fetchBackorders();
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "Failed to update backorder case.");
    } finally {
      setCaseBusyId(null);
    }
  }, [fetchBackorders]);

  const handleBulkDraft = useCallback(async () => {
    setAutomationBusy("bulk");
    setDraftError(null);
    setAutomationNotice(null);
    try {
      const scope = kpis.criticalOrders > 0 ? "critical" : "active";
      const res = await fetch("/api/v1/backorders/draft-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, limit: 5 }),
      });
      const payload = await res.json() as { ok?: boolean; data?: { drafts?: BulkDraftRow[] }; error?: { message?: string } };
      if (!res.ok || payload.ok === false) throw new Error(payload.error?.message || "Failed to draft supplier follow-ups.");
      const rows = payload.data?.drafts ?? [];
      setBulkDrafts(rows);
      setAutomationNotice(rows.length > 0 ? `${rows.length} supplier follow-up draft${rows.length === 1 ? "" : "s"} prepared.` : "No active backorders required drafts.");
      setDrafts((current) => {
        const next = { ...current };
        for (const row of rows) next[row.backorderId] = row.draft;
        return next;
      });
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "Failed to draft supplier follow-ups.");
    } finally {
      setAutomationBusy(null);
    }
  }, [kpis.criticalOrders]);

  const handleReplyMonitor = useCallback(async () => {
    setAutomationBusy("monitor");
    setDraftError(null);
    setAutomationNotice(null);
    try {
      const res = await fetch("/api/v1/backorders/reply-monitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "active", minDelayDays: 1 }),
      });
      const payload = await res.json() as { ok?: boolean; data?: { created?: string[]; skipped?: string[] }; error?: { message?: string } };
      if (!res.ok || payload.ok === false) throw new Error(payload.error?.message || "Failed to run reply monitor.");
      const created = payload.data?.created ?? [];
      const skipped = payload.data?.skipped ?? [];
      setAutomationNotice(created.length > 0
        ? `${created.length} reply-monitor exception${created.length === 1 ? "" : "s"} created. ${skipped.length} duplicate${skipped.length === 1 ? "" : "s"} skipped.`
        : `No new exceptions created. ${skipped.length} active monitor item${skipped.length === 1 ? "" : "s"} already exist.`);
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "Failed to run reply monitor.");
    } finally {
      setAutomationBusy(null);
    }
  }, []);

  const copyDraft = useCallback(async (draft: DraftEmail) => {
    const text = `Subject: ${draft.subject}\n\n${draft.body}`;
    await navigator.clipboard?.writeText(text);
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-xl bg-primary/4 border border-primary/10 px-4 py-3">
        <Ic name="info" className="text-base text-primary mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-on-surface-variant">Backorder case management</p>
          <p className="text-[0.65rem] text-outline mt-0.5">
            Durable cases support controlled escalation and resolution. Unconverted PO-line signals remain visible until an operator creates a case.
          </p>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[0.58rem] font-semibold uppercase tracking-[0.08em] ${STATUS_STYLE[statusInfo.status]}`}>
          {statusInfo.label}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <KpiCard label="Open POs" value={kpis.openOrders} icon="pending_actions" tone={kpis.openOrders > 0 ? "warn" : "ok"} action="Show open POs" onClick={() => handleKpiAction("open")} />
        <KpiCard label="Open Lines" value={kpis.openLines} icon="format_list_numbered" tone={kpis.openLines > 0 ? "warn" : "ok"} action="Review lines" onClick={() => handleKpiAction("lines")} />
        <KpiCard label="Critical" value={kpis.criticalOrders} icon="priority_high" tone={kpis.criticalOrders > 0 ? "danger" : "ok"} action="Filter critical" onClick={() => handleKpiAction("critical")} />
        <KpiCard label="Escalated" value={kpis.escalatedOrders} icon="arrow_upward" tone={kpis.escalatedOrders > 0 ? "danger" : "ok"} action="Show escalated" onClick={() => handleKpiAction("escalated")} />
        <KpiCard label="Avg Delay" value={`${kpis.avgDelayDays}d`} icon="schedule" tone={kpis.avgDelayDays > 20 ? "danger" : kpis.avgDelayDays > 10 ? "warn" : "ok"} action="Longest delay" onClick={() => handleKpiAction("delay")} />
        <KpiCard label="Suppliers" value={kpis.affectedSuppliers} icon="storefront" tone={kpis.affectedSuppliers > 0 ? "warn" : "ok"} action="Top supplier" onClick={() => handleKpiAction("suppliers")} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {automationSignals.map((signal) => (
          <AutomationSignal key={signal.label} icon={signal.icon} label={signal.label} value={signal.value} tone={signal.tone} />
        ))}
      </div>

      <div className="rounded-xl border border-outline-variant/8 bg-surface-container/45 p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => void handleBulkDraft()} disabled={automationBusy !== null || kpis.openOrders === 0}
            className="flex items-center gap-1.5 rounded-md bg-primary/10 px-3 py-1.5 text-[0.65rem] font-semibold text-primary transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50">
            <Ic name={automationBusy === "bulk" ? "progress_activity" : "mark_email_unread"} className={`text-xs ${automationBusy === "bulk" ? "animate-spin" : ""}`} />
            Bulk draft follow-ups
          </button>
          <button onClick={() => void handleReplyMonitor()} disabled={automationBusy !== null || kpis.openOrders === 0}
            className="flex items-center gap-1.5 rounded-md bg-warning/10 px-3 py-1.5 text-[0.65rem] font-semibold text-warning transition-colors hover:bg-warning/15 disabled:cursor-not-allowed disabled:opacity-50">
            <Ic name={automationBusy === "monitor" ? "progress_activity" : "manage_history"} className={`text-xs ${automationBusy === "monitor" ? "animate-spin" : ""}`} />
            Check overdue follow-ups
          </button>
          {automationNotice && <span className="text-[0.65rem] text-on-surface-variant">{automationNotice}</span>}
          {draftError && <span className="text-[0.65rem] text-error">{draftError}</span>}
        </div>
        {bulkDrafts.length > 0 && (
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {bulkDrafts.map((row) => (
              <button key={row.backorderId} onClick={() => {
                setExpandedId(row.backorderId);
                setSearch(row.poNumber);
                setStatusFilter("all");
                setPriorityFilter("all");
                setVendorFilter("all");
              }} className="rounded-lg border border-primary/10 bg-primary/4 px-3 py-2 text-left transition-colors hover:bg-primary/8">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-on-surface">{row.poNumber}</span>
                  <span className="text-[0.58rem] font-medium text-primary">draft ready</span>
                </div>
                <p className="mt-1 truncate text-[0.65rem] text-outline">{row.vendor} / {row.delayDays}d / {row.draft.subject}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Ic name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-outline/40" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search PO, vendor, vessel, item..."
            className="w-full bg-surface-high/30 border border-outline-variant/8 rounded-md pl-8 pr-3 py-1.5 text-xs placeholder:text-outline/30 focus:outline-none focus:ring-1 focus:ring-primary/20"
          />
        </div>

        <div className="flex items-center gap-2">
          {(["all", "active", "open", "escalated", "resolved"] as const).map((s) => (
            <button key={s} onClick={() => { setStatusFilter(s); setExpandedId(null); }} className={`px-2.5 py-1 rounded-md text-[0.65rem] font-medium transition-colors capitalize ${statusFilter === s ? "bg-primary/10 text-primary" : "bg-surface-high/20 text-on-surface-variant hover:bg-surface-high/30"}`}>
              {s === "all" ? `All (${backorders.length})` : s === "active" ? `Active (${kpis.openOrders})` : s}
            </button>
          ))}
        </div>

        <DropdownSelect
          id="priority"
          value={priorityFilter}
          options={priorityOptions}
          openDropdown={openDropdown}
          setOpenDropdown={setOpenDropdown}
          onChange={(value) => { setPriorityFilter(value); setExpandedId(null); }}
        />

        <DropdownSelect
          id="vendor"
          value={vendorFilter}
          options={vendorOptions}
          openDropdown={openDropdown}
          setOpenDropdown={setOpenDropdown}
          onChange={(value) => { setVendorFilter(value); setExpandedId(null); }}
          minWidthClass="min-w-[210px]"
        />

        <DropdownSelect
          id="sort"
          value={sortBy}
          options={sortOptions}
          openDropdown={openDropdown}
          setOpenDropdown={setOpenDropdown}
          onChange={(value) => { setSortBy(value); setExpandedId(null); }}
          minWidthClass="min-w-[170px]"
        />
      </div>

      <section className="bg-surface-container/50 rounded-xl ghost-border overflow-hidden">
        <div className="divide-y divide-outline-variant/4">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-5 h-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-10 h-10 rounded-xl bg-error/8 flex items-center justify-center mb-3">
                <Ic name="cloud_off" className="text-lg text-error" />
              </div>
              <p className="text-sm font-medium text-on-surface-variant">Unable to load backorders</p>
              <p className="text-xs text-outline mt-1 max-w-xs">{error}</p>
              <button onClick={fetchBackorders} className="mt-3 text-xs font-medium text-primary hover:text-primary/80">Retry</button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-10 h-10 rounded-xl bg-surface-highest/15 flex items-center justify-center mb-3">
                <Ic name="pending_actions" className="text-lg text-outline" />
              </div>
              <p className="text-sm font-medium text-on-surface-variant">
                {backorders.length === 0 ? "No backorders" : "No results match your filters"}
              </p>
              <p className="text-xs text-outline mt-1 max-w-xs">
                {backorders.length === 0 ? "Backordered purchase order lines will appear here." : "Adjust filters or search terms."}
              </p>
            </div>
          ) : filtered.map((bo) => {
            const isExpanded = expandedId === bo.id;
            return (
              <div key={bo.id} className={`transition-colors ${bo.status === "resolved" ? "opacity-60" : ""}`}>
                <button onClick={() => setExpandedId(isExpanded ? null : bo.id)}
                  className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-surface-high/15 transition-colors">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    bo.status === "escalated" ? "bg-error/8" :
                    bo.status === "resolved" ? "bg-success/8" :
                    bo.priority === "critical" ? "bg-error/6" :
                    bo.priority === "high" ? "bg-warning/6" : "bg-surface-high/30"
                  }`}>
                    <Ic name={
                      bo.status === "escalated" ? "arrow_upward" :
                      bo.status === "resolved" ? "check_circle" :
                      bo.priority === "critical" ? "error" : "pending_actions"
                    } className={`text-base ${
                      bo.status === "escalated" ? "text-error" :
                      bo.status === "resolved" ? "text-success" :
                      bo.priority === "critical" ? "text-error" :
                      bo.priority === "high" ? "text-warning" : "text-outline"
                    }`} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-mono text-xs font-medium">{bo.poNumber}</span>
                      <StatusPill status={bo.status} />
                      <PriorityPill priority={bo.priority} />
                    </div>
                    <div className="flex items-center gap-3 text-[0.65rem] text-outline">
                      <span className="flex items-center gap-1"><Ic name="storefront" className="text-xs" />{bo.vendor}</span>
                      <span className="flex items-center gap-1"><Ic name="directions_boat" className="text-xs" />{bo.vessel}</span>
                      <span>{bo.items.length} item{bo.items.length !== 1 ? "s" : ""}</span>
                    </div>
                  </div>

                  <div className={`text-right shrink-0 ${bo.totalDelayDays > 30 ? "text-error" : bo.totalDelayDays > 14 ? "text-warning" : "text-on-surface-variant"}`}>
                    <p className="text-lg font-semibold font-mono">{bo.totalDelayDays}d</p>
                    <p className="text-[0.55rem] text-outline">overdue</p>
                  </div>

                  <Ic name={isExpanded ? "expand_less" : "expand_more"} className="text-base text-outline shrink-0" />
                </button>

                {isExpanded && (
                  <div className="px-5 pb-4 animate-fade-in">
                    <div className="ml-11 bg-surface-low/25 rounded-lg p-4 space-y-4">
                      <div>
                        <p className="text-[0.6rem] font-semibold uppercase tracking-wider text-on-surface-variant mb-2">Line Items</p>
                        <table className="w-full text-xs">
                          <thead><tr className="border-b border-outline-variant/8">
                            <th className="text-left py-1.5 text-[0.6rem] text-outline font-medium">Description</th>
                            <th className="text-right py-1.5 text-[0.6rem] text-outline font-medium">Qty</th>
                            <th className="text-right py-1.5 text-[0.6rem] text-outline font-medium">Unit</th>
                            <th className="text-right py-1.5 text-[0.6rem] text-outline font-medium">Requested</th>
                            <th className="text-right py-1.5 text-[0.6rem] text-outline font-medium">Delay</th>
                          </tr></thead>
                          <tbody>{bo.items.map((item) => (
                            <tr key={item.id ?? item.description} className="border-b border-outline-variant/4">
                              <td className="py-1.5 text-on-surface-variant">{item.description}</td>
                              <td className="py-1.5 text-right font-mono">{item.qty}</td>
                              <td className="py-1.5 text-right text-outline">{item.unit}</td>
                              <td className="py-1.5 text-right text-outline">{new Date(item.requestedDate).toLocaleDateString()}</td>
                              <td className={`py-1.5 text-right font-mono font-medium ${item.delayDays > 20 ? "text-error" : item.delayDays > 0 ? "text-warning" : "text-outline"}`}>{item.delayDays}d</td>
                            </tr>
                          ))}</tbody>
                        </table>
                      </div>

                      {bo.notes && (
                        <div>
                          <p className="text-[0.6rem] font-semibold uppercase tracking-wider text-on-surface-variant mb-1">Notes</p>
                          <p className="text-xs text-outline leading-relaxed">{bo.notes}</p>
                        </div>
                      )}

                      <div className="flex items-center gap-4 text-[0.6rem] text-outline">
                        <span>Requested: {new Date(bo.requestDate).toLocaleDateString()}</span>
                        {bo.backorderNumber && <span>Case: {bo.backorderNumber}</span>}
                        {bo.escalatedAt && <span className="text-error">Escalated: {new Date(bo.escalatedAt).toLocaleDateString()}</span>}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {bo.source === "purchase_order_lines" ? (
                          <button onClick={() => void handleCreateCase(bo)} disabled={caseBusyId === bo.id} className="flex items-center gap-1.5 text-[0.65rem] font-medium bg-primary/8 text-primary px-3 py-1.5 rounded-md hover:bg-primary/12 disabled:opacity-60 disabled:cursor-wait transition-colors">
                            <Ic name={caseBusyId === bo.id ? "progress_activity" : "add_task"} className={`text-xs ${caseBusyId === bo.id ? "animate-spin" : ""}`} />
                            {caseBusyId === bo.id ? "Creating" : "Create case"}
                          </button>
                        ) : bo.status === "resolved" || bo.status === "dismissed" ? (
                          <button onClick={() => void handleTransition(bo, "reopen")} disabled={caseBusyId === bo.id} className="flex items-center gap-1.5 text-[0.65rem] font-medium bg-warning/8 text-warning px-3 py-1.5 rounded-md hover:bg-warning/12 disabled:opacity-60 transition-colors">
                            <Ic name="refresh" className="text-xs" />Reopen
                          </button>
                        ) : (
                          <>
                          {bo.status !== "escalated" && (
                            <button onClick={() => void handleTransition(bo, "escalate")} disabled={caseBusyId === bo.id} className="flex items-center gap-1.5 text-[0.65rem] font-medium bg-error/8 text-error px-3 py-1.5 rounded-md hover:bg-error/12 disabled:opacity-60 transition-colors">
                              <Ic name="arrow_upward" className="text-xs" />Escalate
                            </button>
                          )}
                          <button onClick={() => void handleTransition(bo, "resolve")} disabled={caseBusyId === bo.id} className="flex items-center gap-1.5 text-[0.65rem] font-medium bg-success/8 text-success px-3 py-1.5 rounded-md hover:bg-success/12 disabled:opacity-60 transition-colors">
                            <Ic name="check_circle" className="text-xs" />Resolve
                          </button>
                          <button onClick={() => void handleTransition(bo, "dismiss")} disabled={caseBusyId === bo.id} className="flex items-center gap-1.5 text-[0.65rem] font-medium bg-surface-high/30 text-on-surface-variant px-3 py-1.5 rounded-md hover:bg-surface-high/45 disabled:opacity-60 transition-colors">
                            <Ic name="cancel" className="text-xs" />Dismiss
                          </button>
                          </>
                        )}
                        {(bo.status === "open" || bo.status === "escalated") && (
                          <button onClick={() => void handleDraftEmail(bo)} disabled={draftingId === bo.id} className="flex items-center gap-1.5 text-[0.65rem] font-medium bg-primary/8 text-primary px-3 py-1.5 rounded-md hover:bg-primary/12 disabled:opacity-60 disabled:cursor-wait transition-colors">
                            <Ic name={draftingId === bo.id ? "progress_activity" : "mail"} className={`text-xs ${draftingId === bo.id ? "animate-spin" : ""}`} />
                            {draftingId === bo.id ? "Drafting" : "Draft email"}
                          </button>
                        )}
                        <button onClick={() => openPurchaseOrder(bo)} className="flex items-center gap-1.5 text-[0.65rem] font-medium bg-surface-high/25 text-on-surface-variant px-3 py-1.5 rounded-md hover:bg-surface-high/40 transition-colors">
                          <Ic name="receipt_long" className="text-xs" />Open PO
                        </button>
                      </div>

                      {draftError && draftingId !== bo.id && (
                        <p className="text-[0.65rem] text-error">{draftError}</p>
                      )}

                      {drafts[bo.id] && (
                        <EmailDraftPanel draft={drafts[bo.id]} onCopy={() => void copyDraft(drafts[bo.id])} />
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function DropdownSelect<T extends string>({
  id,
  value,
  options,
  openDropdown,
  setOpenDropdown,
  onChange,
  minWidthClass = "min-w-[150px]",
}: {
  id: DropdownId;
  value: T;
  options: DropdownOption<T>[];
  openDropdown: DropdownId | null;
  setOpenDropdown: (id: DropdownId | null) => void;
  onChange: (value: T) => void;
  minWidthClass?: string;
}) {
  const open = openDropdown === id;
  const selected = options.find((option) => option.value === value) ?? options[0];

  return (
    <div
      className={`relative ${minWidthClass}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpenDropdown(null);
        }
      }}
    >
      <button
        type="button"
        onClick={() => setOpenDropdown(open ? null : id)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-1.5 text-left text-[0.65rem] font-medium transition-colors ${
          open
            ? "border-primary/45 bg-surface-high text-on-surface shadow-[0_0_0_1px_rgba(78,222,163,0.18)]"
            : "border-outline-variant/10 bg-surface-container text-on-surface hover:border-primary/25 hover:bg-surface-high"
        }`}
      >
        <span className="truncate">{selected?.label ?? value}</span>
        <Ic name={open ? "expand_less" : "expand_more"} className="text-sm text-primary shrink-0" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-[calc(100%+6px)] z-40 max-h-64 w-full overflow-auto rounded-lg border border-outline-variant/14 bg-surface-low p-1 shadow-2xl shadow-black/45"
        >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(option.value);
                  setOpenDropdown(null);
                }}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-[0.68rem] transition-colors ${
                  active
                    ? "bg-primary/14 text-primary"
                    : "text-on-surface hover:bg-surface-high/35 hover:text-white"
                }`}
              >
                <span className="truncate">{option.label}</span>
                {active && <Ic name="check" className="text-xs text-primary shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AutomationSignal({ icon, label, value, tone }: { icon: string; label: string; value: string; tone: "danger" | "warn" | "ok" }) {
  const t = {
    danger: "bg-error/5 border-error/10 text-error",
    warn: "bg-warning/5 border-warning/10 text-warning",
    ok: "bg-surface-container/50 border-outline-variant/6 text-on-surface-variant",
  }[tone];
  return (
    <div className={`rounded-xl border px-3.5 py-3 flex items-center gap-3 ${t}`}>
      <div className="w-7 h-7 rounded-lg bg-surface-low/30 flex items-center justify-center shrink-0">
        <Ic name={icon} className="text-sm" />
      </div>
      <div className="min-w-0">
        <p className="text-[0.6rem] font-medium text-on-surface-variant">{label}</p>
        <p className="text-xs font-semibold truncate">{value}</p>
      </div>
    </div>
  );
}

function EmailDraftPanel({ draft, onCopy }: { draft: DraftEmail; onCopy: () => void }) {
  const mailto = `mailto:${encodeURIComponent(draft.to ?? "")}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
  return (
    <div className="rounded-lg border border-primary/10 bg-primary/4 p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[0.6rem] font-semibold uppercase tracking-wider text-on-surface-variant">Supplier Email Draft</p>
          <p className="text-xs font-medium text-on-surface truncate">{draft.subject}</p>
          <p className="text-[0.6rem] text-outline">
            {draft.to ? `To ${draft.to}` : "Supplier email not available"} / Draft requires review
          </p>
        </div>
        <button onClick={onCopy} className="flex items-center gap-1.5 text-[0.65rem] font-medium bg-surface-high/30 text-on-surface-variant px-3 py-1.5 rounded-md hover:bg-surface-high/45 transition-colors">
          <Ic name="content_copy" className="text-xs" />Copy
        </button>
        <a href={mailto} className="flex items-center gap-1.5 text-[0.65rem] font-medium bg-primary text-on-primary px-3 py-1.5 rounded-md hover:bg-primary/90 transition-colors">
          <Ic name="open_in_new" className="text-xs" />Open
        </a>
      </div>
      <pre className="whitespace-pre-wrap rounded-md bg-surface-low/35 p-3 text-[0.68rem] leading-relaxed text-on-surface-variant font-sans max-h-72 overflow-auto">{draft.body}</pre>
      <div className="flex flex-wrap gap-1.5">
        {draft.automationIdeas.map((idea) => (
          <span key={idea} className="rounded-full bg-surface-high/25 px-2 py-1 text-[0.55rem] text-outline">{idea}</span>
        ))}
      </div>
    </div>
  );
}

function KpiCard({ label, value, icon, tone, action, onClick }: { label: string; value: number | string; icon: string; tone: "danger" | "warn" | "ok"; action: string; onClick: () => void }) {
  const t = {
    danger: { bg: "bg-error/5", bd: "border-error/10", tx: "text-error", ib: "bg-error/8" },
    warn: { bg: "bg-warning/5", bd: "border-warning/10", tx: "text-warning", ib: "bg-warning/8" },
    ok: { bg: "bg-surface-container/50", bd: "border-outline-variant/6", tx: "text-on-surface", ib: "bg-success/8" },
  }[tone];
  return (
    <button type="button" onClick={onClick} className={`group rounded-xl p-3.5 ${t.bg} border ${t.bd} text-left transition-colors hover:border-primary/25 hover:bg-primary/6 focus:outline-none focus:ring-1 focus:ring-primary/30`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[0.6rem] font-medium text-on-surface-variant">{label}</span>
        <div className={`w-5 h-5 rounded-md ${t.ib} flex items-center justify-center`}><Ic name={icon} className={`text-xs ${t.tx}`} /></div>
      </div>
      <p className={`text-lg font-semibold font-mono ${t.tx}`}>{value}</p>
      <p className="mt-1 flex items-center gap-1 text-[0.55rem] font-medium text-outline group-hover:text-primary">
        {action}<Ic name="arrow_forward" className="text-[0.65rem]" />
      </p>
    </button>
  );
}

function StatusPill({ status }: { status: BackorderStatus }) {
  const m: Record<BackorderStatus, string> = { open: "bg-warning/8 text-warning", escalated: "bg-error/8 text-error", resolved: "bg-success/8 text-success", dismissed: "bg-surface-high/30 text-outline" };
  return <span className={`text-[0.55rem] font-medium px-1.5 py-0.5 rounded capitalize ${m[status]}`}>{status}</span>;
}

function PriorityPill({ priority }: { priority: BackorderPriority }) {
  const m: Record<BackorderPriority, string> = { critical: "bg-error/6 text-error", high: "bg-warning/6 text-warning", normal: "bg-surface-high/30 text-outline" };
  return <span className={`text-[0.55rem] font-medium px-1.5 py-0.5 rounded capitalize ${m[priority]}`}>{priority}</span>;
}
