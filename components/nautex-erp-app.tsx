"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { CommunitySetup, CommunityLegal, FeatureAvailability } from "@/components/community-setup";
import { VesselTrackingPanel } from "@/components/vessel-tracking-panel";
import { DonutChart } from "@/components/charts/donut-chart";
import { BarChart } from "@/components/charts/bar-chart";
import { PriceCalculatorModule } from "@/components/modules/price-calculator";
import { HSCodeFinderModule } from "@/components/modules/hs-code-finder";
import { IMPASearchModule } from "@/components/modules/impa-search";
import { ProcurementSearchModule } from "@/components/modules/procurement-search";
import { ProcurementValidatorModule } from "@/components/modules/procurement-validator";
import { RFQAutomationModule } from "@/components/modules/rfq-automation";
import { SupplierDirectoryModule } from "@/components/modules/supplier-directory";
import { AgentMonitorModule } from "@/components/modules/agent-monitor";
import { ExceptionsQueueModule } from "@/components/modules/exceptions-queue";
import { BackordersModule } from "@/components/modules/backorders";
import { ContractsModule } from "@/components/modules/contracts";
import { EvidenceAnalyzerModule } from "@/components/modules/evidence-analyzer";
import { PurchaseOrdersModule } from "@/components/modules/purchase-orders";
import { FinanceAccountingModule } from "@/components/modules/finance-accounting";
import { InventoryModule } from "@/components/modules/inventory";
import { EmployeeAdminPanel } from "@/components/auth/employee-admin-panel";
import { SupportDiagnosticsPanel } from "@/components/auth/support-diagnostics-panel";
import { MailboxSettingsPanel } from "@/components/auth/mailbox-settings-panel";
import { AISettingsPanel } from "@/components/auth/ai-settings-panel";
import { JevSettingsPanel } from "@/components/auth/jev-settings-panel";
import { CompanySetupPanel } from "@/components/auth/company-setup-panel";
import { ProfileAvatar, ProfilePhotoEditor } from "@/components/auth/profile-photo";
import { useAIStatus } from "@/components/ai-status-badge";
import { authClient } from "@/lib/auth/client";
import { MODULE_STATUS, STATUS_STYLE } from "@/lib/modules/module-status";
import { apiClient } from "@/lib/client/api-client";
import { subscribeDesktopDeepLinks } from "@/lib/client/desktop";
import {
  DOMAINS,
  MODULES,
  findModule,
  moduleHash,
  navigationHash,
  parseNavigationTarget,
  type DomainDef,
  type ModuleDef,
  type ModuleKey,
  type NavigationTarget,
} from "@/lib/client/navigation";
import type { AICheckResult, PurchaseOrder, RFQ, Supplier, InventoryItem } from "@/types/erp";
import type { PurchaseOrderNotification } from "@/lib/purchase-orders/notifications";
import { COLORS } from "@/lib/design/tokens";

/* ════════════════════════════════════════════════════════════════
   MODULE & DOMAIN REGISTRY
   ════════════════════════════════════════════════════════════════ */

/* ── Layout ──────────────────────────────────────────────────── */

const SW = 272;
const SW_C = 72;
const TH = 64;

/* ── Data ────────────────────────────────────────────────────── */

interface AgentRunSummary { id: string; agent: string; domain: string; status: string; startedAt: string; tasks?: unknown[]; }
interface AgentExceptionSummary { id: string; severity: string; status: string; title: string; domain: string; }
interface CommandResponse {
  runId: string;
  agentId: string;
  action: string;
  status: "completed" | "awaiting_approval" | "failed";
  output?: Record<string, unknown>;
  confidence?: number;
  error?: string;
}
interface CommandHistorySummary {
  id: string;
  command: string;
  routedTo: string;
  status: string;
  resultSummary?: string | null;
  createdAt: string;
}
interface ApprovalSummary {
  id: string;
  agent: string;
  description: string;
  impact: string;
  status: string;
  requestedAt: string;
  task?: { action: string; runId: string; agent: string } | null;
}
interface SystemHealth {
  checks: Record<string, { ok: boolean; label: string; detail: string }>;
  mode: string;
  provider: string;
  generatedAt: string;
}
interface AuthContextSummary {
  organizationDataMode?: "Operational" | "Demo" | "Screenshot" | "Test";
  userId: string;
  displayName: string;
  email: string;
  image: string | null;
  roles: string[];
  permissions: string[];
  development: boolean;
}
interface CommandCenterOverview {
  mode: "operational" | "demo" | "all";
  generatedAt: string;
  kpis: {
    openRfqs: number;
    atRiskPurchaseOrders: number;
    pendingApprovalOrders: number;
    backorderLines: number;
    lowMarginOrders: number;
    reorderItems: number;
    openExceptions: number;
    inTransitOrders: number;
    totalPurchaseOrderValue: { amount: number; currency: "EUR" };
    agentRuns: number;
    runningAgentRuns: number;
    pendingAgentApprovals: number;
    totalPurchaseOrders: number;
  };
  series: {
    procurementMonthly: Array<{
      month: string;
      purchaseOrders: number;
      purchaseOrderValue: number;
      rfqs: number;
    }>;
  };
}
interface CommandSearchResult {
  id: string;
  module: string;
  moduleKey: ModuleKey;
  title: string;
  subtitle: string;
  icon: string;
  filterStatus?: PurchaseOrder["status"];
  vesselQuery?: string;
}
interface DS {
  rfqs: RFQ[];
  purchaseOrders: PurchaseOrder[];
  suppliers: Supplier[];
  inventory: InventoryItem[];
  aiInsights: AICheckResult[];
  agentRuns: AgentRunSummary[];
  agentExceptions: AgentExceptionSummary[];
  purchaseOrderNotifications: PurchaseOrderNotification[];
  commandCenterOverview: CommandCenterOverview | null;
}
const emptyDS: DS = { rfqs: [], purchaseOrders: [], suppliers: [], inventory: [], aiInsights: [], agentRuns: [], agentExceptions: [], purchaseOrderNotifications: [], commandCenterOverview: null };
type TopPanel = "ask" | "settings" | "operator" | null;

function monthShortLabel(month: string) {
  const index = Number(month.slice(5, 7)) - 1;
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][index] ?? month;
}

/* ── Icons ───────────────────────────────────────────────────── */

function Ic({ name, className = "" }: { name: string; className?: string }) {
  return <span className={`material-symbols-outlined ${className}`} style={{ fontVariationSettings: "'FILL' 0, 'wght' 300, 'opsz' 20" }}>{name}</span>;
}
function IcF({ name, className = "" }: { name: string; className?: string }) {
  return <span className={`material-symbols-outlined ${className}`} style={{ fontVariationSettings: "'FILL' 1, 'wght' 400, 'opsz' 20" }}>{name}</span>;
}

/* ── Skeleton ────────────────────────────────────────────────── */

function Sk({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`animate-pulse rounded-md bg-surface-highest/25 ${className}`} style={style} />;
}
function KPISkel() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 min-[1800px]:grid-cols-8">
      {[0,1,2,3,4,5,6,7].map((i) => <div key={i} className="rounded-xl p-5 bg-surface-container/50 ghost-border"><Sk className="h-3 w-16 mb-5" /><Sk className="h-7 w-14 mb-3" /><Sk className="h-3 w-full" /></div>)}
    </div>
  );
}
function CardSkel({ lines = 3 }: { lines?: number }) {
  return <div className="bg-surface-container/50 rounded-xl ghost-border p-5 space-y-3"><Sk className="h-4 w-32" />{Array.from({length:lines}).map((_,i)=><Sk key={i} className="h-3 w-full" />)}</div>;
}
function TableSkel() {
  return <div className="bg-surface-container/50 rounded-xl ghost-border overflow-hidden"><div className="p-5 border-b border-outline-variant/8"><Sk className="h-4 w-28" /></div><div className="p-5 space-y-4">{[0,1,2,3].map(i=><div key={i} className="flex gap-6"><Sk className="h-3 w-24"/><Sk className="h-3 w-32"/><Sk className="h-3 w-20"/><Sk className="h-3 w-16"/></div>)}</div></div>;
}

/* ── Shared UI ───────────────────────────────────────────────── */

function WidgetErr({ title, onRetry }: { title: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl ghost-border bg-surface-container/30 p-8 flex flex-col items-center justify-center gap-3 text-center min-h-[140px]">
      <div className="w-9 h-9 rounded-full bg-outline-variant/8 flex items-center justify-center"><Ic name="cloud_off" className="text-lg text-outline" /></div>
      <p className="text-xs text-on-surface-variant">Unable to load {title}</p>
      {onRetry && <button onClick={onRetry} className="text-xs font-medium text-primary hover:text-primary/80 transition-colors">Try again</button>}
    </div>
  );
}

function Empty({ icon, title, sub }: { icon: string; title: string; sub: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center animate-fade-in">
      <div className="w-11 h-11 rounded-xl bg-surface-highest/20 flex items-center justify-center mb-3"><Ic name={icon} className="text-xl text-outline" /></div>
      <p className="text-sm font-medium text-on-surface-variant mb-0.5">{title}</p>
      <p className="text-xs text-outline">{sub}</p>
    </div>
  );
}

function ModuleStatusBadge({ moduleKey, demonstration = false }: { moduleKey: ModuleKey; demonstration?: boolean }) {
  const info = demonstration ? { status: "demo_data" as const, label: "Demo data", description: "Synthetic demonstration records in an isolated workspace." }
    : moduleKey === "dashboard" ? { status: "real" as const, label: "Operational", description: "Records from the current operational workspace." } : MODULE_STATUS[moduleKey];
  return (
    <span
      title={info.description}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.58rem] font-semibold uppercase tracking-[0.08em] ${STATUS_STYLE[info.status]}`}
    >
      {info.label}
    </span>
  );
}

function sanitizeCommandOutput(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeCommandOutput(item));
  if (value && typeof value === "object") {
    const cleaned: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const lowered = key.toLowerCase();
      if (lowered === "_ai" || lowered === "provider" || lowered === "model") continue;
      cleaned[key] = sanitizeCommandOutput(nested);
    }
    return cleaned;
  }
  return value;
}

/* ════════════════════════════════════════════════════════════════
   MAIN APP
   ════════════════════════════════════════════════════════════════ */

export function NautexErpApp() {
  const [active, setActive] = useState<ModuleKey>("dashboard");
  const [data, setData] = useState<DS>(emptyDS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [collapsedDomains, setCollapsedDomains] = useState<Record<string, boolean>>({});
  const [topPanel, setTopPanel] = useState<TopPanel>(null);
  const [commandText, setCommandText] = useState("");
  const [commandResult, setCommandResult] = useState<CommandResponse | null>(null);
  const [commandBusy, setCommandBusy] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [settingsRefreshing, setSettingsRefreshing] = useState(false);
  const [commandHistory, setCommandHistory] = useState<CommandHistorySummary[]>([]);
  const [approvals, setApprovals] = useState<ApprovalSummary[]>([]);
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
  const [authContext, setAuthContext] = useState<AuthContextSummary | null>(null);
  const [globalQuery, setGlobalQuery] = useState("");
  const [globalResults, setGlobalResults] = useState<CommandSearchResult[]>([]);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalSearching, setGlobalSearching] = useState(false);
  const [globalSearchError, setGlobalSearchError] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<CommandSearchResult | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [resolvingApprovalId, setResolvingApprovalId] = useState<string | null>(null);
  const { status: aiStatus } = useAIStatus();
  useEffect(() => { const open = () => setTopPanel("settings"); window.addEventListener("nautex-open-provider-settings", open); return () => window.removeEventListener("nautex-open-provider-settings", open); }, []);

  const selectModule = useCallback((moduleKey: ModuleKey) => {
    setActive(moduleKey);
    setMobileNavOpen(false);
    setSelectedRecord(null);
    window.history.replaceState(null, "", moduleHash(moduleKey, window.location.pathname));
  }, []);

  const applyNavigationTarget = useCallback((target: NavigationTarget) => {
    const targetModule = findModule(target.moduleKey);
    if (!targetModule) return false;
    setActive(targetModule.key);
    if (!target.id) {
      setSelectedRecord(null);
      return true;
    }
    setSelectedRecord({
      id: target.id,
      module: targetModule.label,
      moduleKey: targetModule.key,
      title: target.id,
      subtitle: "Opened from direct record link.",
      icon: targetModule.icon,
      filterStatus: target.filterStatus as PurchaseOrder["status"] | undefined,
    });
    return true;
  }, []);

  const applyHashRoute = useCallback(() => {
    const target = parseNavigationTarget(window.location.href);
    return target ? applyNavigationTarget(target) : false;
  }, [applyNavigationTarget]);

  // Persist sidebar state
  useEffect(() => {
    try {
      const s = localStorage.getItem("nautex-sb");
      if (s === "c") setCollapsed(true);
    } catch { /* ignore */ }
    try {
      const d = localStorage.getItem("nautex-domains");
      if (d) setCollapsedDomains(JSON.parse(d));
    } catch { /* ignore */ }
    applyHashRoute();

    window.addEventListener("hashchange", applyHashRoute);
    return () => window.removeEventListener("hashchange", applyHashRoute);
  }, [applyHashRoute]);

  useEffect(() => subscribeDesktopDeepLinks((url) => {
    const target = parseNavigationTarget(url);
    if (!target) return;
    window.history.replaceState(null, "", navigationHash(target, window.location.pathname));
    applyNavigationTarget(target);
  }), [applyNavigationTarget]);

  const toggle = useCallback(() => {
    setCollapsed((p) => { localStorage.setItem("nautex-sb", !p ? "c" : "e"); return !p; });
  }, []);

  const toggleDomain = useCallback((key: string) => {
    setCollapsedDomains((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem("nautex-domains", JSON.stringify(next));
      return next;
    });
  }, []);

  const openPanel = useCallback((panel: Exclude<TopPanel, null>) => {
    setTopPanel((current) => current === panel ? null : panel);
    setSettingsNotice(null);
  }, []);

  const resetDomainLayout = useCallback(() => {
    setCollapsedDomains({});
    localStorage.removeItem("nautex-domains");
    setSettingsNotice("Navigation groups reset.");
  }, []);

  const openSearchResult = useCallback((result: CommandSearchResult) => {
    setActive(result.moduleKey);
    setSelectedRecord(result);
    setGlobalQuery("");
    setGlobalSearchOpen(false);
    const hash = `#${result.moduleKey}:${encodeURIComponent(result.id)}`;
    window.history.replaceState(null, "", hash);
    window.dispatchEvent(new CustomEvent("nautex:record-context", { detail: result }));
  }, []);

  const openPurchaseOrder = useCallback((po: PurchaseOrder) => {
    openSearchResult({
      id: po.id,
      module: "Purchase Orders",
      moduleKey: "purchaseOrders",
      title: po.poNumber,
      subtitle: `${po.vessel} / ${po.buyerName || po.vesselOwner || po.supplier}`,
      icon: "receipt_long",
    });
  }, [openSearchResult]);

  const openPurchaseOrdersByStatus = useCallback((status: PurchaseOrder["status"], label: string) => {
    const detail: CommandSearchResult = {
      id: `status:${status}`,
      module: "Purchase Orders",
      moduleKey: "purchaseOrders",
      title: label,
      subtitle: `Filtered by ${label.toLowerCase()}.`,
      icon: "receipt_long",
      filterStatus: status,
    };
    setActive("purchaseOrders");
    setSelectedRecord(detail);
    window.history.replaceState(null, "", `#purchaseOrders:status:${encodeURIComponent(status)}`);
    window.dispatchEvent(new CustomEvent("nautex:record-context", { detail }));
  }, []);

  useEffect(() => {
    const handleRecordContext = (event: Event) => {
      const detail = (event as CustomEvent<Partial<CommandSearchResult> & { label?: string }>).detail;
      if (!detail?.moduleKey || !detail.id) return;
      const targetModule = MODULES.find((item) => item.key === detail.moduleKey);
      if (!targetModule) return;
      setActive(targetModule.key);
      setSelectedRecord({
        id: detail.id,
        module: detail.module ?? targetModule.label,
        moduleKey: targetModule.key,
        title: detail.title ?? detail.label ?? detail.id,
        subtitle: detail.subtitle ?? "Opened from linked Nautex record.",
        icon: detail.icon ?? targetModule.icon,
        filterStatus: detail.filterStatus,
        vesselQuery: detail.vesselQuery,
      });
    };

    window.addEventListener("nautex:record-context", handleRecordContext);
    return () => window.removeEventListener("nautex:record-context", handleRecordContext);
  }, []);

  // Data loading
  const loadData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [commandCenterOverview, rfqs, purchaseOrders, suppliers, inventory, aiInsights, agentRuns, agentExceptionQueue, purchaseOrderNotifications] = await Promise.all([
        apiClient.get<CommandCenterOverview>("/api/v1/command-center/overview").catch(() => null),
        apiClient.get<RFQ[]>("/api/v1/rfqs"), apiClient.get<PurchaseOrder[]>("/api/v1/purchase-orders?include=lines"),
        apiClient.get<Supplier[]>("/api/v1/suppliers"), apiClient.get<InventoryItem[]>("/api/v1/inventory"),
        apiClient.get<AICheckResult[]>("/api/v1/ai/order-validation"),
        apiClient.get<AgentRunSummary[]>("/api/v1/agents/runs?limit=20"),
        apiClient.get<{ exceptions: AgentExceptionSummary[] }>("/api/v1/agents/exceptions?limit=20"),
        apiClient.get<PurchaseOrderNotification[]>("/api/v1/purchase-orders/notifications?limit=8"),
      ]);
      setData({ rfqs, purchaseOrders, suppliers, inventory, aiInsights, agentRuns, agentExceptions: agentExceptionQueue.exceptions, purchaseOrderNotifications, commandCenterOverview });
      return commandCenterOverview !== null;
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to load data."); return false; }
    finally { setLoading(false); }
  }, []);

  const loadControlData = useCallback(async () => {
    try {
      const [history, pendingApprovals, health, currentAuth] = await Promise.all([
        apiClient.get<CommandHistorySummary[]>("/api/v1/command/history?limit=8"),
        apiClient.get<ApprovalSummary[]>("/api/v1/agents/approvals?status=Pending&limit=8"),
        apiClient.get<SystemHealth>("/api/v1/system/health"),
        apiClient.get<AuthContextSummary>("/api/v1/auth/context"),
      ]);
      setCommandHistory(history);
      setApprovals(pendingApprovals);
      setSystemHealth(health);
      setAuthContext(currentAuth);
      return true;
    } catch {
      setSystemHealth((current) => current ?? null);
      return false;
    }
  }, []);

  const resolveApproval = useCallback(async (id: string, action: "approve" | "reject") => {
    setResolvingApprovalId(id);
    try {
      await apiClient.patch("/api/v1/agents/approvals", { id, action });
      await loadControlData();
      await loadData();
    } finally {
      setResolvingApprovalId(null);
    }
  }, [loadControlData, loadData]);

  const submitCommand = useCallback(async (evt?: React.FormEvent) => {
    evt?.preventDefault();
    const command = commandText.trim();
    if (!command || commandBusy) return;

    setCommandBusy(true);
    setCommandError(null);
    setCommandResult(null);
    try {
      const result = await apiClient.post<CommandResponse>("/api/v1/command", { command });
      setCommandResult(result);
      await loadData();
      await loadControlData();
    } catch (err) {
      setCommandError(err instanceof Error ? err.message : "Command execution failed.");
    } finally {
      setCommandBusy(false);
    }
  }, [commandBusy, commandText, loadControlData, loadData]);

  useEffect(() => { void loadData(); void loadControlData(); }, [loadControlData, loadData]);

  useEffect(() => {
    const query = globalQuery.trim();
    if (query.length < 2) {
      setGlobalResults([]);
      setGlobalSearchError(null);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setGlobalSearching(true);
      setGlobalSearchError(null);
      try {
        const results = await apiClient.get<CommandSearchResult[]>(`/api/v1/command-center/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        setGlobalResults(results);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setGlobalSearchError(err instanceof Error ? err.message : "Search failed.");
        }
      } finally {
        setGlobalSearching(false);
      }
    }, 220);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [globalQuery]);

  /* ── Derived KPIs ──────────────────────────────────────────── */

  const kpis = useMemo(() => {
    const po = data.purchaseOrders;
    const rfqs = data.rfqs;
    const sup = data.suppliers;
    const inv = data.inventory;
    const overview = data.commandCenterOverview;
    const overviewKpis = overview?.kpis;

    const atRiskOrders = po.filter((x) => x.status === "At_Risk");
    const pendingApproval = po.filter((x) => x.status === "Pending_Approval");
    const inTransit = po.filter((x) => x.status === "In_Transit");
    const openRfqs = rfqs.filter((x) => x.status !== "Awarded").length;
    const activeSup = sup.filter((x) => x.status === "Active").length;
    const totalVal = overviewKpis?.totalPurchaseOrderValue.amount ?? po.reduce((s, r) => s + r.total, 0);
    const avgMargin = po.length > 0 ? po.reduce((s, r) => s + r.marginPct, 0) / po.length : 0;
    const supPct = sup.length > 0 ? Math.round((activeSup / sup.length) * 100) : 0;
    const rfqConv = rfqs.length > 0 ? Math.round((rfqs.filter((r) => r.status === "Awarded").length / rfqs.length) * 100) : 0;
    const lowMargin = po.filter((x) => x.marginPct < 10);
    const belowReorder = inv.filter((i) => i.onHand <= i.reorderPoint);
    const backorderLines = po.flatMap((order) =>
      (order.lines ?? [])
        .filter((line) => line.status === "Backordered")
        .map((line) => ({ order, line }))
    );
    const openExceptions = data.agentExceptions.filter((item) => item.status === "Open" || item.status === "Reviewing");
    const runningAgents = data.agentRuns.filter((run) => run.status === "Running" || run.status === "AwaitingApproval");
    const procurementMonthly = overview?.series.procurementMonthly ?? [];

    return {
      atRisk: overviewKpis?.atRiskPurchaseOrders ?? atRiskOrders.length,
      pendingApproval,
      pendingApprovalCount: overviewKpis?.pendingApprovalOrders ?? pendingApproval.length,
      inTransit,
      inTransitCount: overviewKpis?.inTransitOrders ?? inTransit.length,
      openRfqs: overviewKpis?.openRfqs ?? openRfqs,
      activeSup,
      totalVal,
      avgMargin,
      supPct,
      rfqConv,
      lowMargin,
      lowMarginCount: overviewKpis?.lowMarginOrders ?? lowMargin.length,
      belowReorder,
      belowReorderCount: overviewKpis?.reorderItems ?? belowReorder.length,
      backorderLines,
      backorderLineCount: overviewKpis?.backorderLines ?? backorderLines.length,
      openExceptions,
      openExceptionsCount: overviewKpis?.openExceptions ?? openExceptions.length,
      runningAgents,
      agentRunsCount: overviewKpis?.agentRuns ?? data.agentRuns.length,
      runningAgentsCount: overviewKpis?.runningAgentRuns ?? runningAgents.length,
      totalOrders: overviewKpis?.totalPurchaseOrders ?? po.length,
      procurementMonthLabels: procurementMonthly.map((point) => monthShortLabel(point.month)),
      procurementOrderSeries: procurementMonthly.map((point) => point.purchaseOrders),
      procurementRfqSeries: procurementMonthly.map((point) => point.rfqs),
    };
  }, [data]);

  const openInTransitContext = useCallback(() => {
    if (kpis.inTransit.length === 1) {
      const po = kpis.inTransit[0];
      const query = po.vesselImo || po.vessel;
      const detail: CommandSearchResult = {
        id: query,
        module: "Fleet Tracking",
        moduleKey: "vessels",
        title: po.vessel,
        subtitle: `In-transit order ${po.poNumber}.`,
        icon: "local_shipping",
        vesselQuery: query,
      };
      setActive("vessels");
      setSelectedRecord(detail);
      window.history.replaceState(null, "", `#vessels:${encodeURIComponent(query)}`);
      window.dispatchEvent(new CustomEvent("nautex:record-context", { detail }));
      return;
    }
    openPurchaseOrdersByStatus("In_Transit", "In Transit Orders");
  }, [kpis.inTransit, openPurchaseOrdersByStatus]);

  const activeDef = MODULES.find((m) => m.key === active)!;
  const demonstration = authContext?.organizationDataMode === "Demo" || data.commandCenterOverview?.mode === "demo" || (typeof window !== "undefined" && window.nautexDesktop?.workspace === "demonstration");
  const sw = collapsed ? SW_C : SW;
  const [isNarrowShell, setIsNarrowShell] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const update = () => setIsNarrowShell(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const shellOffset = isNarrowShell ? 0 : sw;

  useEffect(() => {
    if (!mobileNavOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileNavOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [mobileNavOpen]);

  return (
    <div className="flex min-h-screen w-full overflow-x-hidden bg-gradient-subtle">

      {/* ═══ SIDEBAR ═══════════════════════════════════════════════ */}
      {mobileNavOpen && <button type="button" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} className="fixed inset-0 z-30 bg-black/50 lg:hidden" />}
      <aside
        id="main-navigation"
        aria-label="Main navigation"
        className={`fixed left-0 top-0 z-40 ${mobileNavOpen ? "flex" : "hidden"} h-full flex-col bg-surface-lowest border-r border-outline-variant/6 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] lg:flex`}
        style={{ width: isNarrowShell ? SW : sw }}
      >
        {/* Brand */}
        <div className={`flex items-center shrink-0 transition-all duration-300 ${collapsed ? "justify-center px-1 h-16" : "px-4 h-16"}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- The local logo uses intrinsic sizing inside the animated desktop shell. */}
          <img
            src={collapsed ? "/brand/nautex-mark-compact-reversed.svg" : "/brand/nautex-logo-horizontal-compact-reversed.svg"}
            alt="Nautex AI"
            className="object-contain shrink-0 transition-all duration-300"
            style={{ width: collapsed ? 36 : 158, height: collapsed ? 40 : "auto" }}
          />
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-1.5 overflow-y-auto overflow-x-hidden py-1.5 space-y-0.5">
          {DOMAINS.map((domain) => {
            const mods = MODULES.filter((m) => m.domain === domain.key);
            const isCollapsed = collapsedDomains[domain.key] ?? false;
            return (
              <NavDomain
                key={domain.key}
                domain={domain}
                modules={mods}
                active={active}
                sidebarCollapsed={collapsed}
                domainCollapsed={isCollapsed}
                onToggleDomain={() => toggleDomain(domain.key)}
                onSelect={selectModule}
              />
            );
          })}
        </nav>

        {/* Sidebar toggle */}
        <div className="px-1.5 py-2 border-t border-outline-variant/6">
          <button onClick={toggle} className="w-full flex items-center justify-center gap-2 px-2 py-1.5 rounded-md text-outline hover:text-on-surface-variant hover:bg-surface-high/30 transition-all">
            <Ic name={collapsed ? "chevron_right" : "chevron_left"} className="text-base" />
            {!collapsed && <span className="text-[0.7rem]">Collapse</span>}
          </button>
        </div>
      </aside>

      {/* ═══ TOP BAR ═══════════════════════════════════════════════ */}
      <header className="fixed top-0 right-0 flex items-center gap-3 px-3 sm:px-4 z-30 bg-surface-lowest/80 backdrop-blur-xl border-b border-outline-variant/5 transition-all duration-300" style={{ left: shellOffset, height: TH }}>
        {demonstration && <span title="Demonstration workspace — synthetic data" className="shrink-0 rounded border border-primary/40 px-2 py-1 text-xs font-semibold text-primary"><span className="xl:hidden">DEMO</span><span className="hidden xl:inline">DEMO · SYNTHETIC DATA</span></span>}
        <button aria-label="Toggle navigation" aria-controls="main-navigation" aria-expanded={isNarrowShell ? mobileNavOpen : !collapsed} onClick={() => { if (isNarrowShell) setMobileNavOpen((open) => !open); else toggle(); }} className="p-1 -ml-1 rounded-md text-outline hover:text-on-surface-variant hover:bg-surface-high/30 transition-all"><Ic name="menu" className="text-lg" /></button>

        {active !== "dashboard" && (
          <button onClick={() => selectModule("dashboard")} className="p-1 rounded-md text-outline hover:text-on-surface-variant hover:bg-surface-high/30 transition-all"><Ic name="arrow_back" className="text-base" /></button>
        )}

        <div className="flex flex-1 sm:flex-initial items-baseline gap-2 min-w-0">
          <h1 className="text-xl font-semibold tracking-tight truncate">{activeDef.label}</h1>
          {!demonstration && <span className="hidden sm:inline-flex"><ModuleStatusBadge moduleKey={active} /></span>}
          {active !== "dashboard" && activeDef.description && <span className="text-sm text-outline truncate hidden 2xl:inline">{activeDef.description}</span>}
        </div>

        {/* Search */}
        <div className="hidden sm:flex flex-1 min-w-0 justify-center">
          <div className={`relative transition-all duration-200 ${searchFocused ? "w-full max-w-lg" : "w-full max-w-xs"}`}>
            <Ic name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-outline text-[1rem]" />
            <input
              className="w-full bg-surface-high/30 border border-outline-variant/6 rounded-md pl-9 pr-3 py-2 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary/20 focus:border-primary/15 focus:bg-surface-high/50 transition-all"
              placeholder="Search orders, suppliers, vessels..."
              type="text"
              value={globalQuery}
              onChange={(event) => {
                setGlobalQuery(event.target.value);
                setGlobalSearchOpen(true);
              }}
              onFocus={() => {
                setSearchFocused(true);
                setGlobalSearchOpen(true);
              }}
              onBlur={() => window.setTimeout(() => {
                setSearchFocused(false);
                setGlobalSearchOpen(false);
              }, 150)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && globalResults[0]) {
                  openSearchResult(globalResults[0]);
                }
              }}
            />
            {globalSearchOpen && globalQuery.trim().length >= 2 && (
              <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-xl border border-outline-variant/30 bg-surface-container shadow-2xl shadow-black/30">
                <div className="border-b border-outline-variant/20 px-3 py-2 text-[0.62rem] font-semibold uppercase tracking-[0.08em] text-outline">
                  {globalSearching ? "Searching Nautex..." : `Results for "${globalQuery.trim()}"`}
                </div>
                <div className="max-h-80 overflow-auto p-1.5">
                  {globalSearchError ? (
                    <p className="px-3 py-4 text-xs text-error">{globalSearchError}</p>
                  ) : globalResults.length === 0 && !globalSearching ? (
                    <p className="px-3 py-4 text-xs text-outline">No matching records found.</p>
                  ) : (
                    globalResults.map((result) => (
                      <button
                        key={`${result.moduleKey}:${result.id}`}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => openSearchResult(result)}
                        className="flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition hover:bg-primary/[0.06]"
                      >
                        <Ic name={result.icon} className="mt-0.5 text-base text-primary" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-semibold text-on-surface">{result.title}</span>
                          <span className="mt-0.5 block truncate text-[0.64rem] text-outline">{result.module} - {result.subtitle}</span>
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => openPanel("ask")}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-primary text-[0.7rem] font-medium transition-all ${topPanel === "ask" ? "bg-primary/14" : "bg-primary/6 hover:bg-primary/10"}`}
            title="Ask Nautex"
          >
            <Ic name="auto_awesome" className="text-sm" /><span className="hidden xl:inline">Ask Nautex</span>
          </button>

          <button onClick={() => setActive("exceptionsQueue")} className="p-1.5 text-outline hover:text-on-surface-variant hover:bg-surface-high/30 rounded-md transition-all relative" title="Exceptions Queue">
            <Ic name="notification_important" className="text-[1.1rem]" />
            {(kpis.atRisk > 0 || kpis.lowMarginCount > 0) && <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-error rounded-full" />}
          </button>

          <button onClick={() => setActive("agentMonitor")} className="p-1.5 text-outline hover:text-on-surface-variant hover:bg-surface-high/30 rounded-md transition-all" title="Agent Monitor">
            <Ic name="smart_toy" className="text-[1.1rem]" />
          </button>

          <button
            onClick={() => openPanel("settings")}
            className={`p-1.5 rounded-md transition-all ${topPanel === "settings" ? "bg-surface-high/50 text-on-surface-variant" : "text-outline hover:text-on-surface-variant hover:bg-surface-high/30"}`}
            title="Command Center settings"
          >
            <Ic name="settings" className="text-[1.1rem]" />
          </button>

          <div className="w-px h-4 bg-outline-variant/8 mx-1" />
          <button
            onClick={() => openPanel("operator")}
            className={`flex items-center gap-1.5 pl-0.5 pr-2 py-0.5 rounded-md transition-all ${topPanel === "operator" ? "bg-surface-high/50" : "hover:bg-surface-high/30"}`}
            title={`${authContext?.displayName ?? "Operator"} workspace`}
          >
            <ProfileAvatar image={authContext?.image} name={authContext?.displayName ?? "Operator"} size="sm" />
            <span className="max-w-32 truncate text-[0.7rem] text-on-surface-variant hidden xl:inline">{authContext?.displayName ?? "Operator"}</span>
          </button>
        </div>
      </header>

      {/* ═══ MAIN ══════════════════════════════════════════════════ */}
      {topPanel && (
        <TopActionPanel
          panel={topPanel}
          leftOffset={shellOffset}
          commandText={commandText}
          commandResult={commandResult}
          commandBusy={commandBusy}
          commandError={commandError}
          aiConfigured={aiStatus?.configured ?? false}
          settingsNotice={settingsNotice}
          settingsRefreshing={settingsRefreshing}
          sidebarCollapsed={collapsed}
          openExceptions={kpis.openExceptionsCount}
          runningAgents={kpis.runningAgentsCount}
          commandHistory={commandHistory}
          approvals={approvals}
          systemHealth={systemHealth}
          authContext={authContext}
          onProfileImageChange={(image) => setAuthContext((current) => current ? { ...current, image } : current)}
          agentRuns={data.agentRuns}
          resolvingApprovalId={resolvingApprovalId}
          onClose={() => setTopPanel(null)}
          onCommandText={setCommandText}
          onSubmitCommand={submitCommand}
          onUsePrompt={(text) => {
            setCommandText(text);
            setCommandResult(null);
            setCommandError(null);
          }}
          onOpenModule={(module) => {
            setActive(module);
            setTopPanel(null);
          }}
          onToggleSidebar={toggle}
          onResetDomains={resetDomainLayout}
          onRefresh={async () => {
            if (settingsRefreshing) return;
            setSettingsRefreshing(true); setSettingsNotice(null);
            try {
              const results = await Promise.all([loadData(), loadControlData()]);
              setSettingsNotice(results.every(Boolean) ? `Command Center data refreshed at ${new Date().toLocaleTimeString()}.` : "Some Command Center data could not be refreshed. Previously loaded information may be out of date. Try again.");
            } finally { setSettingsRefreshing(false); }
          }}
          onResolveApproval={resolveApproval}
        />
      )}

      <main className="min-h-screen min-w-0 flex-1 overflow-x-hidden transition-all duration-300" style={{ paddingLeft: shellOffset, paddingTop: TH }}>
        <div className="mx-auto max-w-none p-3 sm:p-5">
          <CommunitySetup userId={authContext?.userId} onSettings={() => setTopPanel("settings")} onCatalogue={() => selectModule("impaSearch")} />
          <FeatureAvailability moduleKey={active} configured={aiStatus?.configured ?? false} onSettings={() => setTopPanel("settings")} />
          {selectedRecord && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/15 bg-primary/[0.04] px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Ic name={selectedRecord.icon} className="text-base text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-on-surface">Record context active: {selectedRecord.title}</p>
                  <p className="truncate text-[0.65rem] text-outline">{selectedRecord.module} - {selectedRecord.subtitle} - ID {selectedRecord.id}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => navigator.clipboard?.writeText(window.location.href)}
                  className="rounded-md bg-surface-high/30 px-2.5 py-1.5 text-[0.65rem] font-medium text-primary hover:bg-primary/10"
                >
                  Copy link
                </button>
                <button
                  onClick={() => {
                    setSelectedRecord(null);
                    window.history.replaceState(null, "", window.location.pathname);
                  }}
                  className="rounded-md bg-surface-high/30 px-2.5 py-1.5 text-[0.65rem] font-medium text-on-surface-variant hover:bg-surface-high/50"
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          {/* ── COMMAND CENTER ─────────────────────────────────── */}
          {active === "dashboard" && (
            <div className="space-y-5 animate-fade-up">

              {/* DB warning */}
              {error && !loading && (
                <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-warning/4 border border-warning/10 animate-fade-in">
                  <Ic name="warning" className="text-warning text-base" />
                  <p className="text-xs text-on-surface-variant flex-1">Database unavailable — showing empty state. <button onClick={loadData} className="text-primary font-medium hover:underline ml-1">Retry</button></p>
                </div>
              )}

              <section className="rounded-xl border border-outline-variant/20 bg-surface-container p-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[0.6rem] font-bold uppercase tracking-wider text-success">Operations Control Layer</p>
                      <ModuleStatusBadge moduleKey="dashboard" demonstration={demonstration} />
                    </div>
                    <h2 className="mt-1 text-lg font-bold text-on-surface">Fleet procurement command center</h2>
                    <p className="mt-1 max-w-3xl text-xs text-on-surface-variant">
                      Track purchase orders, supplier commitments, inventory, and approvals across your fleet.
                    </p>
                  </div>
                  <div className="grid min-w-[320px] grid-cols-3 gap-2 text-xs">
                    <CommandChip label="PO Value" value={`EUR ${(kpis.totalVal / 1000).toFixed(0)}K`} tone="neutral" />
                    <CommandChip label="Open Review" value={kpis.openExceptionsCount} tone={kpis.openExceptionsCount > 0 ? "warn" : "ok"} />
                    <CommandChip label="Agent Runs" value={kpis.agentRunsCount} tone="neutral" />
                  </div>
                </div>
              </section>

              {/* Row 1: Critical metrics */}
              {loading ? <KPISkel /> : (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4 min-[1800px]:grid-cols-8">
                  <MetricCard label="At-Risk Orders" value={kpis.atRisk} icon="error" tone={kpis.atRisk > 0 ? "danger" : "ok"} sub={kpis.atRisk > 0 ? `of ${kpis.totalOrders} total` : "All orders on track"} onClick={() => openPurchaseOrdersByStatus("At_Risk", "At-Risk Orders")} />
                  <MetricCard label="Pending Approval" value={kpis.pendingApprovalCount} icon="hourglass_top" tone={kpis.pendingApprovalCount > 0 ? "warn" : "ok"} sub="Awaiting review" onClick={() => openPurchaseOrdersByStatus("Pending_Approval", "Pending Approval Orders")} />
                  <MetricCard label="Open RFQs" value={kpis.openRfqs} icon="draft" tone="neutral" sub={`${kpis.rfqConv}% conversion`} onClick={() => setActive("rfqAutomation")} />
                  <MetricCard label="Backorder Lines" value={kpis.backorderLineCount} icon="pending_actions" tone={kpis.backorderLineCount > 0 ? "warn" : "ok"} sub="PO line exposure" onClick={() => setActive("backorders")} />
                  <MetricCard label="Low Margin" value={kpis.lowMarginCount} icon="trending_down" tone={kpis.lowMarginCount > 0 ? "danger" : "ok"} sub="Below threshold" onClick={() => setActive("finance")} />
                  <MetricCard label="Reorder Items" value={kpis.belowReorderCount} icon="inventory_2" tone={kpis.belowReorderCount > 0 ? "warn" : "ok"} sub="Warehouse watch" onClick={() => setActive("inventory")} />
                  <MetricCard label="Exceptions" value={kpis.openExceptionsCount} icon="playlist_add_check" tone={kpis.openExceptionsCount > 0 ? "warn" : "ok"} sub="Human review" onClick={() => setActive("exceptionsQueue")} />
                  <MetricCard label="In Transit" value={kpis.inTransitCount} icon="local_shipping" tone="neutral" sub={`EUR ${(kpis.totalVal / 1000).toFixed(0)}K value`} onClick={openInTransitContext} />
                </div>
              )}

              {/* Row 2: Alerts + Actions + Agent Status */}
              <div className="grid grid-cols-12 gap-5">
                {/* Critical Alerts */}
                <div className="col-span-12 lg:col-span-4">
                  {loading ? <CardSkel lines={4} /> : (
                    <Sec title="Critical Alerts" icon="notification_important" count={data.aiInsights.length + data.purchaseOrderNotifications.length + kpis.atRisk + kpis.lowMarginCount + kpis.backorderLineCount}>
                      {data.aiInsights.length === 0 && data.purchaseOrderNotifications.length === 0 && kpis.atRisk === 0 && kpis.lowMarginCount === 0 && kpis.backorderLineCount === 0 ? (
                        <div className="text-center py-6"><Ic name="check_circle" className="text-xl text-success-dim mb-1" /><p className="text-xs text-outline">No critical alerts</p></div>
                      ) : (
                        <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
                          {data.purchaseOrderNotifications.slice(0, 4).map((notification) => (
                            <AlertRow key={notification.id} tone={notification.severity === "warning" ? "warn" : "info"} icon="assignment_turned_in" onClick={() => {
                              const detail: CommandSearchResult = {
                                id: notification.orderId,
                                module: "Purchase Orders",
                                moduleKey: "purchaseOrders",
                                title: notification.poNumber,
                                subtitle: notification.detail,
                                icon: "receipt_long",
                              };
                              openSearchResult(detail);
                            }}>
                              <span className="font-mono text-[0.65rem] text-on-surface-variant mr-1.5">{notification.poNumber}</span>{notification.detail}
                            </AlertRow>
                          ))}
                          {data.purchaseOrders.filter((p) => p.status === "At_Risk").map((po) => (
                            <AlertRow key={po.id} tone="danger" icon="error" onClick={() => openPurchaseOrder(po)}>
                              <span className="font-mono text-[0.65rem] text-on-surface-variant mr-1.5">{po.poNumber}</span>delivery at risk - {po.vessel}
                            </AlertRow>
                          ))}
                          {kpis.lowMargin.map((po) => (
                            <AlertRow key={`m-${po.id}`} tone="warn" icon="trending_down" onClick={() => openPurchaseOrder(po)}>
                              <span className="font-mono text-[0.65rem] text-on-surface-variant mr-1.5">{po.poNumber}</span>margin {po.marginPct.toFixed(1)}% below threshold
                            </AlertRow>
                          ))}
                          {kpis.backorderLines.slice(0, 3).map(({ order, line }) => (
                            <AlertRow key={`bo-${line.id}`} tone="warn" icon="pending_actions" onClick={() => openPurchaseOrder(order)}>
                              <span className="font-mono text-[0.65rem] text-on-surface-variant mr-1.5">{order.poNumber}</span>
                              {line.description} is backordered
                            </AlertRow>
                          ))}
                          {data.aiInsights.slice(0, 3).map((ins) => (
                            <AlertRow key={ins.id} tone={ins.risk === "High" ? "danger" : ins.risk === "Medium" ? "warn" : "info"} icon="psychology">
                              <span className="font-mono text-[0.65rem] text-on-surface-variant mr-1.5">{ins.orderId}</span>
                              <span className="line-clamp-1">{ins.findings[0]}</span>
                            </AlertRow>
                          ))}
                        </div>
                      )}
                    </Sec>
                  )}
                </div>

                {/* Action Queue */}
                <div className="col-span-12 lg:col-span-4">
                  {loading ? <CardSkel lines={4} /> : (
                    <Sec title="Action Queue" icon="task_alt">
                      <div className="space-y-1.5">
                        {kpis.pendingApprovalCount > 0 && <ActionRow icon="check_circle" label={`${kpis.pendingApprovalCount} orders pending approval`} action="Review" onClick={() => openPurchaseOrdersByStatus("Pending_Approval", "Pending Approval Orders")} />}
                        {data.purchaseOrderNotifications.length > 0 && <ActionRow icon="assignment_turned_in" label={`${data.purchaseOrderNotifications.length} PO intake notifications`} action="Open" onClick={() => setActive("purchaseOrders")} />}
                        {kpis.openRfqs > 0 && <ActionRow icon="bolt" label={`${kpis.openRfqs} RFQs awaiting response`} action="Process" onClick={() => setActive("rfqAutomation")} />}
                        {kpis.atRisk > 0 && <ActionRow icon="warning" label={`${kpis.atRisk} at-risk deliveries`} action="Review" onClick={() => openPurchaseOrdersByStatus("At_Risk", "At-Risk Orders")} />}
                        {kpis.backorderLineCount > 0 && <ActionRow icon="pending_actions" label={`${kpis.backorderLineCount} backordered PO lines`} action="Review" onClick={() => setActive("backorders")} />}
                        {kpis.belowReorderCount > 0 && <ActionRow icon="inventory_2" label={`${kpis.belowReorderCount} items below reorder`} action="Review" onClick={() => setActive("inventory")} />}
                        {kpis.pendingApprovalCount === 0 && data.purchaseOrderNotifications.length === 0 && kpis.openRfqs === 0 && kpis.atRisk === 0 && kpis.belowReorderCount === 0 && kpis.backorderLineCount === 0 && (
                          <div className="text-center py-6"><Ic name="done_all" className="text-xl text-success-dim mb-1" /><p className="text-xs text-outline">All caught up</p></div>
                        )}
                      </div>
                    </Sec>
                  )}
                </div>

                {/* Automation Status */}
                <div className="col-span-12 lg:col-span-4">
                  <Sec title="Automation" icon="smart_toy" headerRight={
                    <button onClick={() => setActive("agentMonitor")} className="text-[0.65rem] font-medium text-primary hover:text-primary/80 transition-colors">Monitor →</button>
                  }>
                    {data.agentRuns.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-6 text-center">
                        <div className="w-10 h-10 rounded-xl bg-surface-highest/15 flex items-center justify-center mb-3">
                          <Ic name="smart_toy" className="text-lg text-outline" />
                        </div>
                        <p className="text-xs font-medium text-on-surface-variant mb-0.5">No agents seeded</p>
                        <p className="text-[0.65rem] text-outline max-w-[220px]">Agent activity appears after RFQ routing, validation, matching, or command workflows run.</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <MiniStat label="Runs" value={kpis.agentRunsCount} icon="smart_toy" />
                          <MiniStat label="Open review" value={kpis.openExceptionsCount} icon="playlist_add_check" />
                        </div>
                        {data.agentRuns.slice(0, 3).map((run) => (
                          <button key={run.id} onClick={() => setActive("agentMonitor")} className="w-full flex items-center gap-2 p-2.5 rounded-lg bg-surface-low/15 hover:bg-surface-low/25 transition-colors text-left">
                            <Ic name={run.status === "Completed" ? "check_circle" : "pending"} className={`text-sm ${run.status === "Completed" ? "text-success" : "text-warning"}`} />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-on-surface-variant truncate">{run.agent}</p>
                              <p className="text-[0.6rem] text-outline truncate">{run.domain} | {run.status.replace(/([A-Z])/g, " $1").trim()}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    <button onClick={() => setActive("exceptionsQueue")} className="w-full flex items-center justify-center gap-2 mt-2 p-2 rounded-lg bg-surface-high/20 border border-outline-variant/6 hover:bg-surface-high/30 transition-colors">
                      <Ic name="playlist_add_check" className="text-sm text-outline" />
                      <span className="text-[0.65rem] font-medium text-on-surface-variant">Exceptions Queue</span>
                    </button>
                  </Sec>
                </div>
              </div>

              {/* Row 3: Procurement Overview + Performance */}
              <div className="grid grid-cols-12 gap-5">
                <div className="col-span-12 lg:col-span-8">
                  {loading ? <CardSkel lines={6} /> : (
                    <Sec title="Procurement Overview" icon="query_stats" headerRight={
                      <div className="flex gap-3"><Legend color={COLORS.success} label="Orders" /><Legend color={COLORS.accentCyan} label="RFQs" /></div>
                    }><BarChart labels={kpis.procurementMonthLabels} values={kpis.procurementOrderSeries} secondaryValues={kpis.procurementRfqSeries} /></Sec>
                  )}
                </div>
                <div className="col-span-12 lg:col-span-4">
                  {loading ? <CardSkel lines={6} /> : (
                    <Sec title="Performance" icon="speed">
                      <div className="grid grid-cols-2 gap-3">
                        <DonutCell value={kpis.supPct} label="Suppliers" sub="Active" color={COLORS.success} />
                        <DonutCell value={kpis.rfqConv} label="RFQ" sub="Conversion" color={COLORS.accentCyan} />
                        <DonutCell value={Math.round(kpis.avgMargin)} label="Margin" sub="Avg Gross" color={COLORS.accentLime} />
                        <DonutCell value={kpis.totalOrders > 0 ? Math.round(((kpis.totalOrders - kpis.atRisk) / kpis.totalOrders) * 100) : 100} label="Delivery" sub="On Track" color={COLORS.accentAmber} />
                      </div>
                    </Sec>
                  )}
                </div>
              </div>

              {/* Row 4: Recent Orders */}
              {loading ? <TableSkel /> : data.purchaseOrders.length > 0 && (
                <Sec title="Recent Orders" icon="receipt_long" headerRight={
                  <button onClick={() => setActive("purchaseOrders")} className="text-[0.65rem] font-medium text-primary hover:text-primary/80 transition-colors">View all →</button>
                }>
                  <div className="overflow-x-auto -mx-5">
                    <table className="w-full text-left text-xs">
                      <thead><tr className="border-b border-outline-variant/6">
                        {["Order","Vessel","Supplier","Status","Priority","Margin","Total"].map(h=><th key={h} className="px-5 py-2.5 text-[0.6rem] font-medium text-outline uppercase tracking-wider">{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {data.purchaseOrders.slice(0, 5).map((po) => (
                          <tr key={po.id} className="border-b border-outline-variant/4 hover:bg-surface-high/20 transition-colors cursor-pointer" onClick={() => openPurchaseOrder(po)}>
                            <td className="px-5 py-2.5 font-mono text-[0.7rem] font-medium">{po.poNumber}</td>
                            <td className="px-5 py-2.5">{po.vessel}</td>
                            <td className="px-5 py-2.5 text-on-surface-variant">{po.supplier}</td>
                            <td className="px-5 py-2.5"><Badge status={po.status} /></td>
                            <td className="px-5 py-2.5"><PrioDot p={po.priority} /></td>
                            <td className="px-5 py-2.5 font-mono"><span className={po.marginPct < 10 ? "text-error" : "text-on-surface-variant"}>{po.marginPct.toFixed(1)}%</span></td>
                            <td className="px-5 py-2.5 font-mono font-medium">EUR {po.total.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Sec>
              )}

              {/* Row 5: Quick Access */}
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {[
                  { icon: "bolt", label: "Process RFQ", desc: "AI supplier matching", target: "rfqAutomation" as ModuleKey },
                  { icon: "manage_search", label: "Item Search", desc: "Pricing & specs", target: "procurementSearch" as ModuleKey },
                  { icon: "handshake", label: "Agreements", desc: "Contracts & items", target: "contracts" as ModuleKey },
                  { icon: "pending_actions", label: "Backorders", desc: "Overdue tracking", target: "backorders" as ModuleKey },
                  { icon: "fact_check", label: "SLA Evidence", desc: "Upload & analyze", target: "evidenceAnalyzer" as ModuleKey },
                  { icon: "travel_explore", label: "HS Codes", desc: "Dual-jurisdiction", target: "hsCodeFinder" as ModuleKey },
                ].map((a) => (
                  <button key={a.label} onClick={() => setActive(a.target)} className="flex items-center gap-3 p-3.5 rounded-xl bg-surface-container/40 border border-white/[0.04] hover:border-primary/20 hover:bg-primary/[0.04] hover:shadow-[0_0_20px_rgba(78,222,163,0.06)] transition-all duration-200 group text-left">
                    <div className="w-9 h-9 rounded-lg bg-primary/6 flex items-center justify-center shrink-0 group-hover:bg-primary/12 group-hover:shadow-[0_0_12px_rgba(78,222,163,0.15)] transition-all duration-200">
                      <Ic name={a.icon} className="text-primary text-base group-hover:scale-110 transition-transform duration-200" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium group-hover:text-primary transition-colors duration-200">{a.label}</p>
                      <p className="text-[0.6rem] text-outline truncate">{a.desc}</p>
                    </div>
                    <Ic name="arrow_forward" className="text-sm text-transparent group-hover:text-primary/50 transition-all duration-200 shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── MODULE VIEWS ───────────────────────────────────── */}

          {active === "purchaseOrders" && <div className="animate-fade-up"><PurchaseOrdersModule onNavigate={(m) => setActive(m as ModuleKey)} /></div>}

          {active === "suppliers" && <div className="animate-fade-up"><SupplierDirectoryModule /></div>}

          {active === "inventory" && (
            <div className="animate-fade-up">
              <InventoryModule onInventoryChanged={loadData} />
            </div>
          )}

          {active === "vessels" && <div className="animate-fade-up">{loading ? <TableSkel /> : error ? <WidgetErr title="fleet" onRetry={loadData} /> : <VesselTrackingPanel purchaseOrders={data.purchaseOrders} />}</div>}
          {active === "finance" && <div className="animate-fade-up"><FinanceAccountingModule /></div>}

          {active === "contracts" && <div className="animate-fade-up"><ContractsModule /></div>}
          {active === "backorders" && <div className="animate-fade-up"><BackordersModule onNavigate={(m) => setActive(m as ModuleKey)} /></div>}
          {active === "evidenceAnalyzer" && <div className="animate-fade-up"><EvidenceAnalyzerModule /></div>}

          {active === "procurementSearch" && <div className="animate-fade-up"><ProcurementSearchModule /></div>}
          {active === "impaSearch" && <div className="animate-fade-up"><IMPASearchModule /></div>}
          {active === "hsCodeFinder" && <div className="animate-fade-up"><HSCodeFinderModule /></div>}
          {active === "rfqAutomation" && <div className="animate-fade-up"><RFQAutomationModule /></div>}
          {active === "procurementValidator" && <div className="animate-fade-up"><ProcurementValidatorModule /></div>}
          {active === "priceCalculator" && <div className="animate-fade-up"><PriceCalculatorModule /></div>}
          {active === "agentMonitor" && <div className="animate-fade-up"><AgentMonitorModule /></div>}
          {active === "exceptionsQueue" && <div className="animate-fade-up"><ExceptionsQueueModule /></div>}
        </div>
      </main>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   SUBCOMPONENTS
   ════════════════════════════════════════════════════════════════ */

/* ── Nav Domain (collapsible group) ──────────────────────────── */

function TopActionPanel({
  panel,
  leftOffset,
  commandText,
  commandResult,
  commandBusy,
  commandError,
  aiConfigured,
  settingsNotice,
  settingsRefreshing,
  sidebarCollapsed,
  openExceptions,
  runningAgents,
  commandHistory,
  approvals,
  systemHealth,
  authContext,
  onProfileImageChange,
  agentRuns,
  resolvingApprovalId,
  onClose,
  onCommandText,
  onSubmitCommand,
  onUsePrompt,
  onOpenModule,
  onToggleSidebar,
  onResetDomains,
  onRefresh,
  onResolveApproval,
}: {
  panel: Exclude<TopPanel, null>;
  leftOffset: number;
  commandText: string;
  commandResult: CommandResponse | null;
  commandBusy: boolean;
  commandError: string | null;
  aiConfigured: boolean;
  settingsNotice: string | null;
  settingsRefreshing: boolean;
  sidebarCollapsed: boolean;
  openExceptions: number;
  runningAgents: number;
  commandHistory: CommandHistorySummary[];
  approvals: ApprovalSummary[];
  systemHealth: SystemHealth | null;
  authContext: AuthContextSummary | null;
  onProfileImageChange: (image: string | null) => void;
  agentRuns: AgentRunSummary[];
  resolvingApprovalId: string | null;
  onClose: () => void;
  onCommandText: (value: string) => void;
  onSubmitCommand: (evt?: React.FormEvent) => void;
  onUsePrompt: (value: string) => void;
  onOpenModule: (module: ModuleKey) => void;
  onToggleSidebar: () => void;
  onResetDomains: () => void;
  onRefresh: () => Promise<void>;
  onResolveApproval: (id: string, action: "approve" | "reject") => Promise<void>;
}) {
  const title = panel === "ask" ? "Ask Nautex" : panel === "settings" ? "Command Center Settings" : "Operator Workspace";
  const [settingsEntities, setSettingsEntities] = useState<Array<{ id: string; name: string }> | undefined>();
  const icon = panel === "ask" ? "auto_awesome" : panel === "settings" ? "settings" : "person";
  const samplePrompts = [
    "Classify HS code for marine hydraulic pump",
    "Parse RFQ for deck consumables and safety equipment",
    "Validate order for MV Nautex Horizon with low margin risk",
  ];
  const cleanedOutput = commandResult?.output ? sanitizeCommandOutput(commandResult.output) : null;
  const agentTimeline = agentRuns.slice(0, 8).map((run) => ({
    id: run.id,
    agent: run.agent,
    status: run.status,
    startedAt: run.startedAt,
    taskCount: Array.isArray(run.tasks) ? run.tasks.length : 0,
  }));
  const permitted = (permission: string) => authContext?.permissions.some(value => value === "*" || value === permission) === true;
  const humanOperator = authContext?.roles.includes("system-agent") !== true;
  const rolePermissions = [
    { label: "Manage agent controls", enabled: humanOperator && permitted("agents.approve") },
    { label: "Review exceptions", enabled: permitted("exceptions.manage") },
    { label: "Approve agent drafts", enabled: humanOperator && permitted("agents.approve") },
    { label: "Approve finance records", enabled: permitted("finance.approve") },
    { label: "Create finance drafts", enabled: permitted("finance.write") },
    { label: "Admin settings", enabled: permitted("admin.users") },
  ];

  return (
    <div className="fixed z-50 right-4 top-[72px] max-h-[calc(100vh-88px)] w-[min(480px,calc(100vw-2rem))] overflow-auto rounded-xl border border-outline-variant/30 bg-surface-container shadow-2xl shadow-black/35">
      <div className="flex items-center justify-between border-b border-outline-variant/25 px-4 py-3">
        <div className="flex items-center gap-2">
          <Ic name={icon} className="text-base text-success" />
          <h2 className="text-sm font-semibold text-on-surface">{title}</h2>
        </div>
        <button onClick={onClose} className="rounded-md p-1 text-outline hover:bg-surface-high/35 hover:text-on-surface-variant" title="Close">
          <Ic name="close" className="text-base" />
        </button>
      </div>

      {panel === "ask" && (
        <div className="space-y-4 p-4">
          <div className="rounded-lg border border-primary/12 bg-primary/[0.04] px-3 py-2">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-primary">Human-supervised orchestration</p>
            <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
              Commands route through the Nautex agent engine. Actions that affect records still require review and approval in the relevant module.
            </p>
          </div>

          <form onSubmit={onSubmitCommand} className="space-y-3">
            <textarea
              value={commandText}
              onChange={(event) => onCommandText(event.target.value)}
              rows={4}
              className="w-full resize-none rounded-lg border border-outline-variant/10 bg-surface-base px-3 py-2 text-xs text-on-surface outline-none transition focus:border-primary/30 focus:ring-1 focus:ring-primary/20"
              placeholder="Ask Nautex to classify, validate, parse, search, or summarize an operational issue..."
            />
            <div className="flex flex-wrap gap-2">
              {samplePrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => onUsePrompt(prompt)}
                  className="rounded-md border border-outline-variant/10 bg-surface-high/20 px-2 py-1 text-[0.62rem] text-on-surface-variant hover:border-primary/25 hover:text-primary"
                >
                  {prompt}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[0.62rem] font-medium ${aiConfigured ? "bg-success/8 text-success" : "bg-warning/8 text-warning"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${aiConfigured ? "bg-success" : "bg-warning"}`} />
                {aiConfigured ? "Private AI active" : "Keyword fallback active"}
              </span>
              <button
                type="submit"
                disabled={!commandText.trim() || commandBusy}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-surface-base transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Ic name={commandBusy ? "progress_activity" : "send"} className={`text-sm ${commandBusy ? "animate-spin" : ""}`} />
                Run command
              </button>
            </div>
          </form>

          {commandError && (
            <div className="rounded-lg border border-error/15 bg-error/8 px-3 py-2 text-xs text-error">{commandError}</div>
          )}

          {commandResult && (
            <div className="rounded-lg border border-outline-variant/25 bg-surface-base">
              <div className="flex items-center justify-between border-b border-outline-variant/20 px-3 py-2">
                <div>
                  <p className="text-xs font-semibold text-on-surface">{commandResult.agentId} / {commandResult.action}</p>
                  <p className="text-[0.62rem] text-outline">Run {commandResult.runId.slice(0, 12)} - routing confidence {Math.round((commandResult.confidence ?? 0) * 100)}%</p>
                </div>
                <Badge status={commandResult.status === "awaiting_approval" ? "Pending Approval" : commandResult.status} />
              </div>
              <div className="max-h-56 overflow-auto p-3">
                {commandResult.error ? (
                  <p className="text-xs text-error">{commandResult.error}</p>
                ) : (
                  <pre className="whitespace-pre-wrap text-[0.68rem] leading-relaxed text-on-surface-variant">{JSON.stringify(cleanedOutput ?? { status: commandResult.status }, null, 2)}</pre>
                )}
              </div>
              <div className="flex justify-end gap-2 border-t border-outline-variant/20 px-3 py-2">
                <button onClick={() => onOpenModule("agentMonitor")} className="rounded-md bg-surface-high/30 px-2.5 py-1.5 text-[0.65rem] font-medium text-primary hover:bg-primary/10">
                  Open Agent Monitor
                </button>
                <button onClick={() => onOpenModule("exceptionsQueue")} className="rounded-md bg-surface-high/30 px-2.5 py-1.5 text-[0.65rem] font-medium text-on-surface-variant hover:bg-surface-high/50">
                  Review Exceptions
                </button>
              </div>
            </div>
          )}

          <div className="rounded-lg border border-outline-variant/25 bg-surface-base">
            <div className="flex items-center justify-between border-b border-outline-variant/20 px-3 py-2">
              <p className="text-xs font-semibold text-on-surface">Recent command history</p>
              <button onClick={() => onOpenModule("agentMonitor")} className="text-[0.62rem] font-medium text-primary hover:text-primary/80">Agent Monitor</button>
            </div>
            <div className="max-h-44 overflow-auto p-2">
              {commandHistory.length === 0 ? (
                <p className="px-2 py-3 text-xs text-outline">No commands have been run yet.</p>
              ) : (
                commandHistory.map((item) => (
                  <div key={item.id} className="rounded-md px-2 py-2 hover:bg-surface-high/20">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-xs font-medium text-on-surface-variant">{item.command}</p>
                      <Badge status={item.status} />
                    </div>
                    <p className="mt-0.5 truncate text-[0.62rem] text-outline">{item.routedTo} - {item.resultSummary || "No summary"}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {panel === "settings" && (
        <div className="space-y-3 p-4">
          <TopPanelAction icon="refresh" label={settingsRefreshing ? "Refreshing Command Center data…" : "Refresh Command Center data"} detail="Reload KPIs, agent runs, exceptions, and module summaries from local APIs." disabled={settingsRefreshing} onClick={() => void onRefresh()} />
          <TopPanelAction icon={sidebarCollapsed ? "left_panel_open" : "left_panel_close"} label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} detail="Change the persistent navigation shell state." onClick={onToggleSidebar} />
          <TopPanelAction icon="account_tree" label="Reset navigation groups" detail="Reopen Operations, Intelligence, and Automation groups in the sidebar." onClick={onResetDomains} />
          <div className="grid grid-cols-2 gap-2 pt-1">
            <CommandChip label="Data Source" value="Postgres" tone="neutral" />
            <CommandChip label="Agent Mode" value={aiConfigured ? "Private AI" : "Fallback"} tone={aiConfigured ? "ok" : "warn"} />
          </div>
          <div className="rounded-lg border border-outline-variant/25 bg-surface-base p-2">
            <p className="mb-2 px-1 text-xs font-semibold text-on-surface">System health</p>
            {systemHealth ? Object.entries(systemHealth.checks).map(([key, check]) => (
              <div key={key} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${check.ok ? "bg-success" : "bg-error"}`} />
                  <span className="text-xs text-on-surface-variant">{check.label}</span>
                </div>
                <span className="text-[0.62rem] text-outline">{check.detail}</span>
              </div>
            )) : (
              <p className="px-2 py-3 text-xs text-outline">Health checks not loaded.</p>
            )}
          </div>
          {settingsNotice && <p role="status" className="rounded-lg border border-outline-variant/25 px-3 py-2 text-sm text-on-surface">{settingsNotice}</p>}
          <CommunityLegal />
          <CompanySetupPanel enabled={humanOperator && permitted("admin.users")} onSaved={setSettingsEntities} />
          <SupportDiagnosticsPanel enabled={humanOperator && permitted("admin.users")} />
          <MailboxSettingsPanel enabled={humanOperator && permitted("admin.users")} />
          <AISettingsPanel enabled={authContext?.permissions.includes("*") === true || authContext?.permissions.includes("admin.users") === true} />
          <JevSettingsPanel enabled={humanOperator && permitted("admin.users")} />
          <EmployeeAdminPanel availableEntities={settingsEntities} currentUserId={authContext?.userId ?? null} enabled={authContext?.permissions.includes("*") === true || authContext?.permissions.includes("admin.users") === true} />
        </div>
      )}

      {panel === "operator" && (
        <div className="space-y-4 p-4">
          <div>
            <ProfilePhotoEditor
              image={authContext?.image}
              name={authContext?.displayName ?? "Operator"}
              subtitle={`${authContext?.email ?? "Local workspace"} - ${authContext?.roles.join(", ") || "operator"}`}
              enabled={Boolean(authContext && !authContext.development)}
              onChange={onProfileImageChange}
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <CommandChip label="Open Exceptions" value={openExceptions} tone={openExceptions > 0 ? "warn" : "ok"} />
            <CommandChip label="Running Agents" value={runningAgents} tone={runningAgents > 0 ? "warn" : "neutral"} />
            <CommandChip label="Pending Approvals" value={approvals.length} tone={approvals.length > 0 ? "warn" : "ok"} />
          </div>
          <div className="rounded-lg border border-outline-variant/25 bg-surface-base p-2">
            <p className="mb-2 px-1 text-xs font-semibold text-on-surface">Approval inbox</p>
            {approvals.length === 0 ? (
              <p className="px-2 py-3 text-xs text-outline">No pending agent approvals.</p>
            ) : approvals.slice(0, 4).map((approval) => (
              <div key={approval.id} className="rounded-md px-2 py-2 hover:bg-surface-high/20">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs font-medium text-on-surface-variant">{approval.task?.action || approval.agent}</p>
                  <Badge status={approval.impact} />
                </div>
                <p className="mt-0.5 line-clamp-2 text-[0.62rem] text-outline">{approval.description}</p>
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    disabled={!humanOperator || !permitted("agents.approve") || resolvingApprovalId === approval.id}
                    onClick={() => void onResolveApproval(approval.id, "reject")}
                    className="rounded-md bg-error/8 px-2 py-1 text-[0.6rem] font-medium text-error hover:bg-error/12 disabled:opacity-50"
                  >
                    Reject
                  </button>
                  <button
                    disabled={!humanOperator || !permitted("agents.approve") || resolvingApprovalId === approval.id}
                    onClick={() => void onResolveApproval(approval.id, "approve")}
                    className="rounded-md bg-primary/10 px-2 py-1 text-[0.6rem] font-medium text-primary hover:bg-primary/15 disabled:opacity-50"
                  >
                    Approve
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-outline-variant/25 bg-surface-base p-2">
            <p className="mb-2 px-1 text-xs font-semibold text-on-surface">Agent health timeline</p>
            {agentTimeline.length === 0 ? (
              <p className="px-2 py-3 text-xs text-outline">No agent runs recorded.</p>
            ) : agentTimeline.map((run) => (
              <div key={run.id} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5">
                <div className="min-w-0">
                  <p className="truncate text-xs text-on-surface-variant">{run.agent}</p>
                  <p className="text-[0.58rem] text-outline">{new Date(run.startedAt).toLocaleString()} - {run.taskCount} tasks</p>
                </div>
                <Badge status={run.status} />
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-outline-variant/25 bg-surface-base p-2">
            <p className="mb-2 px-1 text-xs font-semibold text-on-surface">Role readiness</p>
            <div className="grid grid-cols-2 gap-1.5">
              {rolePermissions.map((permission) => (
                <div key={permission.label} title={`${permission.label}: ${permission.enabled ? "Allowed" : "Not allowed"}`} className="flex items-center gap-2 rounded-md bg-surface-high/15 px-2 py-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${permission.enabled ? "bg-success" : "bg-outline/45"}`} />
                  <span className="text-[0.62rem] text-on-surface-variant">{permission.label}</span>
                </div>
              ))}
            </div>
          </div>
          <TopPanelAction icon="smart_toy" label="Open Agent Monitor" detail="Inspect command runs, task status, confidence, and approval states." onClick={() => onOpenModule("agentMonitor")} />
          <TopPanelAction icon="playlist_add_check" label="Open Exceptions" detail="Review blocked work that needs a human decision." onClick={() => onOpenModule("exceptionsQueue")} />
          <TopPanelAction icon="account_balance_wallet" label="Open Finance Controls" detail="Review invoice, margin, credit note, and export readiness workflows." onClick={() => onOpenModule("finance")} />
          {!authContext?.development && <TopPanelAction icon="logout" label="Sign out" detail="End this Nautex employee session on the current computer." onClick={() => void authClient.signOut().then(() => window.location.assign("/sign-in"))} />}
        </div>
      )}
    </div>
  );
}

function TopPanelAction({ icon, label, detail, onClick, disabled = false }: { icon: string; label: string; detail: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button disabled={disabled} onClick={onClick} className="flex w-full items-start gap-3 rounded-lg border border-outline-variant/8 bg-surface-base px-3 py-2.5 text-left transition hover:border-primary/20 hover:bg-primary/[0.04] disabled:opacity-50">
      <Ic name={icon} className="mt-0.5 text-base text-primary" />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-on-surface">{label}</span>
        <span className="mt-0.5 block text-[0.65rem] leading-relaxed text-outline">{detail}</span>
      </span>
    </button>
  );
}

function NavDomain({ domain, modules, active, sidebarCollapsed, domainCollapsed, onToggleDomain, onSelect }: {
  domain: DomainDef; modules: ModuleDef[]; active: ModuleKey; sidebarCollapsed: boolean; domainCollapsed: boolean;
  onToggleDomain: () => void; onSelect: (k: ModuleKey) => void;
}) {
  const hasActive = modules.some((m) => m.key === active);

  return (
    <div className="py-1">
      {/* Domain header */}
      {!sidebarCollapsed ? (
        <button onClick={onToggleDomain} className="w-full flex items-center gap-2 px-3 py-2 rounded-md hover:bg-surface-high/15 transition-colors group" aria-expanded={!domainCollapsed}>
          <Ic name={domainCollapsed ? "chevron_right" : "expand_more"} className="text-[0.85rem] text-outline group-hover:text-outline transition-colors" />
          <span className="text-xs font-semibold uppercase tracking-[0.06em] text-on-surface-variant transition-colors">{domain.label}</span>
          {domainCollapsed && hasActive && <div className="w-1 h-1 rounded-full bg-primary ml-auto" />}
        </button>
      ) : (
        <div className="flex justify-center py-1 mb-0.5">
          <div className="w-4 h-px bg-outline-variant/10" />
        </div>
      )}

      {/* Module items */}
      {(!domainCollapsed || sidebarCollapsed) && (
        <div className="space-y-px mt-0.5">
          {modules.map((m) => {
            const on = m.key === active;
            return (
              <button
                key={m.key}
                onClick={() => onSelect(m.key)}
                className={`w-full flex items-center gap-2 rounded-md transition-all text-left group relative ${
                  sidebarCollapsed ? "justify-center px-0 min-h-11 py-2" : "px-3 min-h-11 py-2"
                } ${on ? "bg-primary/8 text-primary" : "text-on-surface-variant hover:bg-surface-high/25 hover:text-on-surface"}`}
                title={m.label}
                aria-label={m.label}
                aria-current={on ? "page" : undefined}
              >
                {on && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-3.5 bg-primary rounded-r-full" />}
                <Ic name={m.icon} className={`text-[1.375rem] shrink-0 ${on ? "text-primary" : ""}`} />
                {!sidebarCollapsed && <span className={`text-base truncate ${on ? "font-semibold" : "font-medium"}`}>{m.label}</span>}
                {sidebarCollapsed && (
                  <div className="absolute left-full ml-2 px-2 py-1 bg-surface-highest text-[0.7rem] font-medium rounded-md whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-xl border border-outline-variant/8">
                    {m.label}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Dashboard Section ───────────────────────────────────────── */

function Sec({ title, icon, count, headerRight, children }: {
  title: string; icon: string; count?: number; headerRight?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-outline-variant/20 bg-surface-container overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-outline-variant/20">
        <div className="flex items-center gap-2">
          <Ic name={icon} className="text-base text-success" />
          <h3 className="text-[0.8rem] font-semibold text-on-surface">{title}</h3>
          {count !== undefined && count > 0 && <span className="text-[0.55rem] font-medium bg-error/8 text-error px-1.5 py-0.5 rounded-full">{count}</span>}
        </div>
        {headerRight}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function CommandChip({ label, value, tone }: { label: string; value: string | number; tone: "neutral" | "ok" | "warn" }) {
  const c = {
    neutral: "border-outline-variant/25 text-on-surface",
    ok: "border-success/35 text-success",
    warn: "border-warning/35 text-warning",
  }[tone];
  return (
    <div className={`rounded-lg border bg-surface-lowest px-3 py-2 ${c}`}>
      <p className="text-[0.55rem] font-bold uppercase tracking-wider text-on-surface-variant">{label}</p>
      <p className="mt-1 text-sm font-bold">{value}</p>
    </div>
  );
}

function SecHdr({ title, badge }: { title: string; badge?: string }) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline-variant/6">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {badge && <span className="text-[0.6rem] font-medium bg-error/8 text-error px-2 py-0.5 rounded-full">{badge}</span>}
      </div>
    </div>
  );
}

/* ── Metric Card ─────────────────────────────────────────────── */

function MetricCard({ label, value, icon, tone, sub, onClick }: {
  label: string; value: number; icon: string; tone: "danger"|"warn"|"ok"|"neutral"; sub: string; onClick?: () => void;
}) {
  const t = {
    danger: { bg: "bg-error/5", bd: "border-error/10", tx: "text-error", ib: "bg-error/8" },
    warn: { bg: "bg-warning/5", bd: "border-warning/10", tx: "text-warning", ib: "bg-warning/8" },
    ok: { bg: "bg-success/5", bd: "border-success/10", tx: "text-success", ib: "bg-success/8" },
    neutral: { bg: "bg-surface-container/50", bd: "border-outline-variant/6", tx: "text-on-surface", ib: "bg-surface-high/50" },
  }[tone];
  return (
    <button onClick={onClick} className={`rounded-xl p-4 ${t.bg} border ${t.bd} transition-all hover:border-opacity-20 text-left w-full`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[0.65rem] font-medium text-on-surface-variant">{label}</span>
        <div className={`w-6 h-6 rounded-md ${t.ib} flex items-center justify-center`}><Ic name={icon} className={`text-sm ${t.tx}`} /></div>
      </div>
      <p className={`text-xl font-semibold font-mono tracking-tight ${t.tx} mb-0.5`}>{value}</p>
      <p className="text-[0.6rem] text-outline">{sub}</p>
    </button>
  );
}

/* ── Alert / Action Rows ─────────────────────────────────────── */

function AlertRow({ tone, icon, children, onClick }: { tone: "danger"|"warn"|"info"; icon: string; children: React.ReactNode; onClick?: () => void }) {
  const c = { danger: "text-error border-error/12", warn: "text-warning border-warning/12", info: "text-primary border-primary/12" }[tone];
  return (
    <button onClick={onClick} className={`w-full flex items-start gap-2.5 p-2.5 rounded-lg border ${c} bg-surface-low/20 hover:bg-surface-low/35 transition-colors text-left text-xs`}>
      <Ic name={icon} className={`text-sm mt-0.5 shrink-0 ${c.split(" ")[0]}`} />
      <div className="flex-1 min-w-0 leading-relaxed text-on-surface-variant">{children}</div>
    </button>
  );
}

function ActionRow({ icon, label, action, onClick }: { icon: string; label: string; action: string; onClick: () => void }) {
  return (
    <div className="flex items-center gap-3 p-2.5 rounded-lg bg-surface-low/15 hover:bg-surface-low/25 transition-colors">
      <Ic name={icon} className="text-base text-on-surface-variant shrink-0" />
      <span className="flex-1 text-xs text-on-surface-variant">{label}</span>
      <button onClick={onClick} className="text-[0.65rem] font-medium text-primary hover:text-primary/80 transition-colors shrink-0">{action} →</button>
    </div>
  );
}

function MiniStat({ label, value, icon }: { label: string; value: number; icon: string }) {
  return (
    <button className="flex items-center gap-2 rounded-lg bg-surface-low/15 p-2 text-left" type="button">
      <div className="w-7 h-7 rounded-md bg-primary/6 flex items-center justify-center shrink-0">
        <Ic name={icon} className="text-sm text-primary" />
      </div>
      <div>
        <p className="text-sm font-semibold font-mono text-on-surface">{value}</p>
        <p className="text-[0.58rem] text-outline">{label}</p>
      </div>
    </button>
  );
}

/* ── Small helpers ────────────────────────────────────────────── */

function Legend({ color, label }: { color: string; label: string }) {
  return <div className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} /><span className="text-[0.6rem] text-outline">{label}</span></div>;
}

function DonutCell({ value, label, sub, color }: { value: number; label: string; sub: string; color: string }) {
  return (
    <div className="flex flex-col items-center gap-2 p-4 rounded-lg bg-surface-low/20 hover:bg-surface-low/30 transition-colors">
      <DonutChart value={value} label={label} color={color} size={68} />
      <span className="text-[0.6rem] text-outline">{sub}</span>
    </div>
  );
}

function Badge({ status }: { status: string }) {
  const s = status.replace(/_/g, " ");
  let c = "bg-surface-highest/40 text-on-surface-variant";
  if (["Delivered","Active","Awarded","Posted","Resolved","Shipped"].includes(s)) c = "bg-success/8 text-success";
  else if (["At Risk","High","Blocked","Failed"].includes(s)) c = "bg-error/8 text-error";
  else if (["In Transit","Processing","Procurement","Sent","Quoted","Pending","Under Review","Pending Approval"].includes(s)) c = "bg-primary/8 text-primary";
  else if (["Expiring","Medium","Watch"].includes(s)) c = "bg-warning/8 text-warning";
  return <span className={`${c} px-1.5 py-0.5 rounded text-[0.6rem] font-medium`}>{s}</span>;
}

function PrioDot({ p }: { p: string }) {
  const c: Record<string, string> = { High: "bg-error", Normal: "bg-primary", Low: "bg-outline" };
  return <div className="flex items-center gap-1.5"><div className={`w-1.5 h-1.5 rounded-full ${c[p] ?? "bg-outline"}`} /><span className="text-[0.6rem] text-on-surface-variant">{p}</span></div>;
}
