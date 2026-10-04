"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ImprovementCenter } from "./improvement-center";
import { AgentControls } from "./agent-controls";
import { LearningCorrections } from "./learning-corrections";
import { ItemLearningCorrections } from "./item-learning-corrections";

type HealthTone = "green" | "yellow" | "red" | "gray" | "blue";
type AgentStatus = "Active" | "Idle" | "Running" | "Failed" | "Blocked" | "Disabled" | "Unavailable" | "Awaiting Approval";
type DataSourceMode = "production" | "demo" | "mixed";
type TabKey = "overview" | "agents" | "runs" | "approvals" | "exceptions" | "learning" | "improvements" | "usage";
type ConfidenceFilter = "all" | "high" | "medium" | "low";
type DateRangeFilter = "all" | "today" | "7d";

interface MonitorFilters {
  status: string;
  module: string;
  agent: string;
  approvalRequired: "all" | "yes" | "no";
  severity: string;
  confidence: ConfidenceFilter;
  dateRange: DateRangeFilter;
}

interface BusinessLink {
  type: string;
  id: string | null;
  label: string;
  module: string;
}

interface AgentRegistryItem {
  id: string;
  name: string;
  category: string;
  status: AgentStatus;
  health: HealthTone;
  description: string;
  linkedModules: string[];
  capabilities: string[];
  allowedActions: string[];
  restrictedActions: string[];
  approvalRequiredFor: string[];
  configurationStatus: string;
  lastRun: string | null;
  totalRuns: number;
  successRate: number | null;
  averageConfidence: number | null;
  tasksCompleted: number;
  openExceptions: number;
  pendingApprovals: number;
  lastError: string | null;
  dataSource: DataSourceMode;
}

interface AgentRunRow {
  execution: string;
  id: string;
  agent: string;
  agentName: string;
  module: string;
  trigger: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  status: string;
  resultSummary: string;
  confidence: number | null;
  linkedObject: BusinessLink;
  exceptionCount: number;
  approvalCount: number;
  taskCount: number;
  failedTaskCount: number;
  dataSource: DataSourceMode;
  error: string | null;
}

interface AgentTaskRow {
  id: string;
  runId: string;
  agent: string;
  agentName: string;
  action: string;
  status: string;
  confidence: number | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  linkedObject: BusinessLink;
  error: string | null;
  requiresApproval: boolean;
  exceptionCount: number;
  dataSource: DataSourceMode;
}

interface AgentApprovalRow {
  id: string;
  taskId: string;
  runId: string | null;
  agent: string;
  agentName: string;
  module: string;
  action: string;
  description: string;
  approvalReason: string;
  impact: string;
  status: string;
  confidence: number | null;
  requestedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  linkedObject: BusinessLink;
  dataSource: DataSourceMode;
}

interface AgentExceptionRow {
  id: string;
  taskId: string | null;
  runId: string | null;
  agent: string;
  agentName: string;
  module: string;
  severity: string;
  title: string;
  description: string;
  suggestedAction: string | null;
  status: string;
  createdAt: string;
  linkedObject: BusinessLink;
  dataSource: DataSourceMode;
}

interface MemoryRecord {
  id: string;
  agent: string;
  module: string;
  memoryType: string;
  memoryKey: string;
  confidence: "manual" | "confirmed" | "learned" | "suggested";
  source: string;
  observations: number;
  lastObservedAt: string;
  payload: Record<string, unknown>;
}

interface AuditEvent {
  id: string;
  runId: string | null;
  agent: string;
  agentName: string;
  action: string;
  target: string | null;
  committed: boolean;
  durationMs: number | null;
  createdAt: string;
  summary: string;
  usedAi: boolean;
  usedDeterministicLogic: boolean;
}

interface AgentMonitorSnapshot {
  generatedAt: string;
  overview: {
    activeAgents: number;
    runningAgents: number;
    runsToday: number;
    tasksCompletedToday: number;
    tasksFailedToday: number;
    awaitingApproval: number;
    openExceptions: number;
    averageConfidence: number | null;
    acceptedRecommendations: number;
    rejectedRecommendations: number;
    editedRecommendations: number;
  };
  registry: AgentRegistryItem[];
  recentRuns: AgentRunRow[];
  recentTasks: AgentTaskRow[];
  approvals: AgentApprovalRow[];
  exceptions: AgentExceptionRow[];
  learning: {
    totals: {
      feedbackCount: number;
      sourceCount: number;
      acceptRate: number;
      rejectRate: number;
      editRate: number;
      acceptedRecommendations: number;
      rejectedRecommendations: number;
      editedRecommendations: number;
    };
    records: MemoryRecord[];
  };
  auditEvents: AuditEvent[];
  usage: {
    providerLabel: string;
    aiCalls: number;
    estimatedTokens: number | null;
    estimatedCost: number | null;
    taskCount: number;
    failedOrRetriedCalls: number;
    note: string;
  };
  dataSource: DataSourceMode;
}

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return <span className={`material-symbols-outlined ${className}`} style={{ fontVariationSettings: "'FILL' 0, 'wght' 300, 'opsz' 20" }}>{name}</span>;
}

function pct(value: number | null | undefined) {
  if (value == null) return "-";
  return `${Math.round(value * 100)}%`;
}

function intPct(value: number | null | undefined) {
  if (value == null) return "-";
  return `${value}%`;
}

function formatDuration(ms: number | null) {
  if (!ms) return "-";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60000)}m`;
}

function formatRelative(iso: string | null) {
  if (!iso) return "Never";
  const value = new Date(iso);
  const diffMs = Date.now() - value.getTime();
  if (diffMs < 60000) return "Just now";
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
  if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h ago`;
  return value.toLocaleDateString();
}

function actionLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function statusTone(status: string): "ok" | "warn" | "danger" | "info" | "muted" {
  const normalized = status.toLowerCase();
  if (normalized.includes("running") || normalized.includes("active") || normalized.includes("completed") || normalized.includes("approved")) return "ok";
  if (normalized.includes("awaiting") || normalized.includes("pending") || normalized.includes("review")) return "info";
  if (normalized.includes("blocked") || normalized.includes("failed") || normalized.includes("critical") || normalized.includes("rejected")) return "danger";
  if (normalized.includes("disabled") || normalized.includes("idle")) return "muted";
  return "warn";
}

function healthClass(health: HealthTone) {
  return {
    green: "bg-success/10 text-success border-success/15",
    yellow: "bg-warning/10 text-warning border-warning/15",
    red: "bg-error/10 text-error border-error/15",
    gray: "bg-outline-variant/10 text-outline border-outline-variant/15",
    blue: "bg-primary/10 text-primary border-primary/15",
  }[health];
}

function badgeClass(tone: ReturnType<typeof statusTone>) {
  return {
    ok: "bg-success/8 text-success border-success/12",
    warn: "bg-warning/8 text-warning border-warning/12",
    danger: "bg-error/8 text-error border-error/12",
    info: "bg-primary/8 text-primary border-primary/12",
    muted: "bg-outline-variant/10 text-outline border-outline-variant/12",
  }[tone];
}

const TAB_ITEMS: Array<{ key: TabKey; label: string; icon: string }> = [
  { key: "overview", label: "Overview", icon: "dashboard" },
  { key: "agents", label: "Agents", icon: "smart_toy" },
  { key: "runs", label: "Runs", icon: "timeline" },
  { key: "approvals", label: "Approvals", icon: "approval" },
  { key: "exceptions", label: "Exceptions", icon: "report" },
  { key: "learning", label: "Learning", icon: "psychology" },
  { key: "improvements", label: "Improvements", icon: "science" },
  { key: "usage", label: "Usage", icon: "query_stats" },
];

const DEFAULT_FILTERS: MonitorFilters = {
  status: "all",
  module: "all",
  agent: "all",
  approvalRequired: "all",
  severity: "all",
  confidence: "all",
  dateRange: "all",
};

function inDateRange(iso: string | null, range: DateRangeFilter) {
  if (range === "all" || !iso) return true;
  const value = new Date(iso).getTime();
  const now = Date.now();
  if (range === "today") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return value >= start.getTime();
  }
  return value >= now - 7 * 24 * 60 * 60 * 1000;
}

function confidenceMatches(value: number | null, filter: ConfidenceFilter) {
  if (filter === "all" || value == null) return true;
  if (filter === "high") return value >= 0.85;
  if (filter === "medium") return value >= 0.6 && value < 0.85;
  return value < 0.6;
}

function uniqueOptions(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

export function AgentMonitorModule() {
  const [snapshot, setSnapshot] = useState<AgentMonitorSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [filters, setFilters] = useState<MonitorFilters>(DEFAULT_FILTERS);
  const [learningExpanded, setLearningExpanded] = useState(false);

  const fetchData = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/v1/agents/monitor", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        throw new Error(json.error?.message ?? "Failed to load agent monitor.");
      }
      setSnapshot(json.data);
      setSelectedAgentId((current) => current ?? json.data.registry[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agent monitor.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
    const interval = window.setInterval(() => void fetchData(), 15000);
    return () => window.clearInterval(interval);
  }, [fetchData]);

  const selectedAgent = useMemo(
    () => snapshot?.registry.find((agent) => agent.id === selectedAgentId) ?? snapshot?.registry[0] ?? null,
    [selectedAgentId, snapshot],
  );

  const agentRuns = useMemo(
    () => selectedAgent ? snapshot?.recentRuns.filter((run) => run.agent === selectedAgent.id) ?? [] : [],
    [selectedAgent, snapshot],
  );

  const agentTasks = useMemo(
    () => selectedAgent ? snapshot?.recentTasks.filter((task) => task.agent === selectedAgent.id) ?? [] : [],
    [selectedAgent, snapshot],
  );

  const agentExceptions = useMemo(
    () => selectedAgent ? snapshot?.exceptions.filter((item) => item.agent === selectedAgent.id) ?? [] : [],
    [selectedAgent, snapshot],
  );

  const agentAudit = useMemo(
    () => selectedAgent ? snapshot?.auditEvents.filter((event) => event.agent === selectedAgent.id).slice(0, 5) ?? [] : [],
    [selectedAgent, snapshot],
  );

  const filterOptions = useMemo(() => {
    if (!snapshot) return { agents: [], modules: [], statuses: [], severities: [] };
    return {
      agents: uniqueOptions(snapshot.registry.map((agent) => agent.name)),
      modules: uniqueOptions([
        ...snapshot.registry.flatMap((agent) => agent.linkedModules),
        ...snapshot.recentRuns.map((run) => run.module),
        ...snapshot.approvals.map((approval) => approval.module),
        ...snapshot.exceptions.map((exception) => exception.module),
      ]),
      statuses: uniqueOptions([
        ...snapshot.registry.map((agent) => agent.status),
        ...snapshot.recentRuns.map((run) => run.status),
        ...snapshot.approvals.map((approval) => approval.status),
        ...snapshot.exceptions.map((exception) => exception.status),
      ]),
      severities: uniqueOptions(snapshot.exceptions.map((exception) => exception.severity)),
    };
  }, [snapshot]);

  const filteredAgents = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.registry.filter((agent) => {
      if (filters.status !== "all" && agent.status !== filters.status) return false;
      if (filters.agent !== "all" && agent.name !== filters.agent) return false;
      if (filters.module !== "all" && !agent.linkedModules.includes(filters.module)) return false;
      if (!confidenceMatches(agent.averageConfidence, filters.confidence)) return false;
      if (filters.approvalRequired === "yes" && agent.pendingApprovals === 0) return false;
      if (filters.approvalRequired === "no" && agent.pendingApprovals > 0) return false;
      return true;
    });
  }, [filters, snapshot]);

  const filteredRuns = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.recentRuns.filter((run) => {
      if (filters.status !== "all" && run.status !== filters.status) return false;
      if (filters.agent !== "all" && run.agentName !== filters.agent) return false;
      if (filters.module !== "all" && run.module !== filters.module && run.linkedObject.module !== filters.module) return false;
      if (filters.approvalRequired === "yes" && run.approvalCount === 0) return false;
      if (filters.approvalRequired === "no" && run.approvalCount > 0) return false;
      if (!confidenceMatches(run.confidence, filters.confidence)) return false;
      return inDateRange(run.startedAt, filters.dateRange);
    });
  }, [filters, snapshot]);

  const filteredTasks = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.recentTasks.filter((task) => {
      if (filters.status !== "all" && task.status !== filters.status) return false;
      if (filters.agent !== "all" && task.agentName !== filters.agent) return false;
      if (filters.module !== "all" && task.linkedObject.module !== filters.module) return false;
      if (filters.approvalRequired === "yes" && !task.requiresApproval) return false;
      if (filters.approvalRequired === "no" && task.requiresApproval) return false;
      if (!confidenceMatches(task.confidence, filters.confidence)) return false;
      return inDateRange(task.startedAt, filters.dateRange);
    });
  }, [filters, snapshot]);

  const filteredApprovals = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.approvals.filter((approval) => {
      if (filters.status !== "all" && approval.status !== filters.status) return false;
      if (filters.agent !== "all" && approval.agentName !== filters.agent) return false;
      if (filters.module !== "all" && approval.module !== filters.module && approval.linkedObject.module !== filters.module) return false;
      if (!confidenceMatches(approval.confidence, filters.confidence)) return false;
      return inDateRange(approval.requestedAt, filters.dateRange);
    });
  }, [filters, snapshot]);

  const filteredExceptions = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.exceptions.filter((exception) => {
      if (filters.status !== "all" && exception.status !== filters.status) return false;
      if (filters.agent !== "all" && exception.agentName !== filters.agent) return false;
      if (filters.module !== "all" && exception.module !== filters.module && exception.linkedObject.module !== filters.module) return false;
      if (filters.severity !== "all" && exception.severity !== filters.severity) return false;
      return inDateRange(exception.createdAt, filters.dateRange);
    });
  }, [filters, snapshot]);

  const nextActions = useMemo(() => {
    const approvals = filteredApprovals
      .filter((approval) => approval.status === "Pending")
      .slice(0, 4)
      .map((approval) => ({
        id: `approval-${approval.id}`,
        icon: "approval",
        title: actionLabel(approval.action),
        detail: approval.approvalReason,
        agent: approval.agentName,
        module: approval.module,
        tone: "info" as const,
        onClick: () => setActiveTab("approvals"),
      }));
    const exceptions = filteredExceptions
      .filter((exception) => ["Open", "Reviewing"].includes(exception.status))
      .slice(0, 4)
      .map((exception) => ({
        id: `exception-${exception.id}`,
        icon: "report",
        title: exception.title,
        detail: exception.suggestedAction ?? exception.description,
        agent: exception.agentName,
        module: exception.module,
        tone: statusTone(exception.severity),
        onClick: () => setActiveTab("exceptions"),
      }));
    return [...approvals, ...exceptions].slice(0, 6);
  }, [filteredApprovals, filteredExceptions]);

  const resolveApproval = useCallback(async (id: string, action: "approve" | "reject") => {
    setResolvingId(id);
    try {
      const res = await fetch("/api/v1/agents/approvals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.error?.message ?? "Approval update failed.");
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval update failed.");
    } finally {
      setResolvingId(null);
    }
  }, [fetchData]);

  const resolveException = useCallback(async (id: string, action: "resolve" | "dismiss" | "review") => {
    setResolvingId(id);
    try {
      const res = await fetch("/api/v1/agents/exceptions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.error?.message ?? "Exception update failed.");
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Exception update failed.");
    } finally {
      setResolvingId(null);
    }
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center rounded-lg bg-surface-container/50 ghost-border">
        <div className="h-6 w-6 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
      </div>
    );
  }

  if (error && !snapshot) {
    return <ErrorState message={error} onRetry={fetchData} />;
  }

  if (!snapshot) {
    return <EmptyState icon="smart_toy" title="No agent monitor data" sub="Agent activity appears after a command, RFQ, validation, or review run is recorded." />;
  }

  const pendingApprovals = filteredApprovals.filter((approval) => approval.status === "Pending");
  const openExceptions = filteredExceptions.filter((item) => ["Open", "Reviewing"].includes(item.status));
  const blockedAgents = snapshot.registry.filter((agent) => agent.status === "Blocked").length;
  const failedRuns = snapshot.recentRuns.filter((run) => run.status === "Failed").length;

  return (
    <div className="space-y-4">
      {error ? (
        <div className="flex items-center gap-2 rounded-lg border border-error/15 bg-error/8 px-3 py-2 text-xs text-error">
          <Icon name="warning" className="text-sm" />
          <span>{error}</span>
        </div>
      ) : null}

      <section className="rounded-lg bg-surface-container/50 ghost-border">
        <div className="flex flex-wrap items-center gap-2 border-b border-outline-variant/6 px-4 py-3">
          <Icon name="smart_toy" className="text-base text-on-surface-variant" />
          <h3 className="text-[0.8rem] font-semibold">Agent Control Center</h3>
          <SourceBadge mode={snapshot.dataSource} />
          <span className="hidden sm:inline-flex"><StatusBadge value="Human supervised" /></span>
          <span className="ml-auto text-[0.6rem] text-outline">Updated {formatRelative(snapshot.generatedAt)}</span>
        </div>
        <div className="grid grid-cols-1 gap-2 p-4 sm:grid-cols-2 md:grid-cols-4 min-[1800px]:grid-cols-8">
          <Metric label="Enabled agents" value={String(snapshot.overview.activeAgents)} sub={`${snapshot.overview.runningAgents} running now`} icon="memory" />
          <Metric label="Running" value={String(snapshot.overview.runningAgents)} sub="Live work" icon="sync" />
          <Metric label="Blocked" value={String(blockedAgents)} sub="Needs review" icon="block" tone={blockedAgents > 0 ? "warn" : "ok"} />
          <Metric label="Awaiting approval" value={String(snapshot.overview.awaitingApproval)} sub="Human gate" icon="approval" tone={snapshot.overview.awaitingApproval > 0 ? "warn" : "ok"} />
          <Metric label="Open exceptions" value={String(snapshot.overview.openExceptions)} sub="Needs action" icon="report" tone={snapshot.overview.openExceptions > 0 ? "warn" : "ok"} />
          <Metric label="Failed runs" value={String(failedRuns)} sub="Recent runs" icon="error" tone={failedRuns > 0 ? "warn" : "ok"} />
          <Metric label="Avg confidence" value={pct(snapshot.overview.averageConfidence)} sub="Tracked tasks" icon="speed" />
          <Metric label="Feedback" value={`${snapshot.overview.acceptedRecommendations}/${snapshot.overview.rejectedRecommendations}/${snapshot.overview.editedRecommendations}`} sub="Accept / reject / edit" icon="rule" />
        </div>
      </section>

      <SegmentedTabs active={activeTab} counts={{
        overview: nextActions.length,
        agents: filteredAgents.length,
        runs: filteredRuns.length,
        approvals: pendingApprovals.length,
        exceptions: openExceptions.length,
        learning: snapshot.learning.totals.feedbackCount,
        improvements: 0,
        usage: snapshot.usage.taskCount,
      }} onChange={setActiveTab} />

      {activeTab !== "improvements" ? <FilterBar filters={filters} options={filterOptions} onChange={setFilters} onReset={() => setFilters(DEFAULT_FILTERS)} /> : null}

      {activeTab === "improvements" ? <ImprovementCenter /> : null}

      {activeTab === "overview" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <NextActionPanel actions={nextActions} />
          <AgentRegistry agents={filteredAgents} selectedAgentId={selectedAgent?.id ?? null} onSelect={(id) => { setSelectedAgentId(id); setActiveTab("agents"); }} compact />
        </div>
      ) : null}

      {activeTab === "agents" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
          <AgentRegistry agents={filteredAgents} selectedAgentId={selectedAgent?.id ?? null} onSelect={setSelectedAgentId} selector />
          <div>{selectedAgent && <AgentControls key={selectedAgent.id} agentId={selectedAgent.id} agentName={selectedAgent.name} onChanged={fetchData} />}<AgentDetailPanel agent={selectedAgent} runs={agentRuns} tasks={agentTasks} approvals={snapshot.approvals.filter((approval) => approval.agent === selectedAgent?.id)} exceptions={agentExceptions} auditEvents={agentAudit} learningRecords={snapshot.learning.records.filter((record) => record.agent === selectedAgent?.id)} /></div>
        </div>
      ) : null}

      {activeTab === "runs" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.75fr)]">
          <RunTimeline runs={filteredRuns} />
          <TaskTimeline tasks={filteredTasks} />
        </div>
      ) : null}

      {activeTab === "approvals" ? (
        <ApprovalQueue approvals={pendingApprovals} resolvingId={resolvingId} onResolve={resolveApproval} onReview={(agentId) => { setSelectedAgentId(agentId); setActiveTab("agents"); }} />
      ) : null}

      {activeTab === "exceptions" ? (
        <ExceptionQueue exceptions={openExceptions} resolvingId={resolvingId} onResolve={resolveException} onReview={(agentId) => { setSelectedAgentId(agentId); setActiveTab("agents"); }} />
      ) : null}

      {activeTab === "learning" ? (
        <div className="space-y-5"><LearningCorrections onChanged={fetchData} /><ItemLearningCorrections onChanged={fetchData} /><p className="text-sm text-outline">Supplier and item aliases require explicit review, evaluation and activation. They do not retrain a model or edit application code. Other module experiments remain in Improvements.</p><LearningMemory records={snapshot.learning.records} totals={snapshot.learning.totals} expanded={learningExpanded} onToggle={() => setLearningExpanded((value) => !value)} /></div>
      ) : null}

      {activeTab === "usage" ? (
        <UsageReadiness usage={snapshot.usage} />
      ) : null}
    </div>
  );
}

function SectionHeader({ icon, title, trailing }: { icon: string; title: string; trailing?: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-outline-variant/6 px-4 py-3">
      <Icon name={icon} className="text-base text-on-surface-variant" />
      <h3 className="text-[0.8rem] font-semibold">{title}</h3>
      {trailing ? <span className="ml-auto text-[0.6rem] text-outline">{trailing}</span> : null}
    </div>
  );
}

function Metric({ label, value, sub, icon, tone = "ok" }: { label: string; value: string; sub: string; icon: string; tone?: "ok" | "warn" }) {
  return (
    <div className="rounded-md bg-surface-low/20 px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[0.6rem] text-outline">{label}</p>
        <Icon name={icon} className={`text-sm ${tone === "warn" ? "text-warning" : "text-on-surface-variant"}`} />
      </div>
      <p className={`font-mono text-lg font-semibold ${tone === "warn" ? "text-warning" : "text-on-surface"}`}>{value}</p>
      <p className="text-[0.55rem] text-outline">{sub}</p>
    </div>
  );
}

function StatusBadge({ value }: { value: string }) {
  return <span className={`inline-flex rounded border px-1.5 py-0.5 text-[0.56rem] font-semibold ${badgeClass(statusTone(value))}`}>{value}</span>;
}

function SourceBadge({ mode }: { mode: DataSourceMode }) {
  const label = mode === "production" ? "Operational data" : mode === "demo" ? "Demo records" : "Mixed records";
  return <span className={`rounded border px-1.5 py-0.5 text-[0.55rem] font-semibold ${mode === "production" ? "border-success/12 bg-success/8 text-success" : "border-warning/12 bg-warning/8 text-warning"}`}>{label}</span>;
}

function MiniPill({ label }: { label: string }) {
  return <span className="rounded bg-surface-high/25 px-1.5 py-0.5 text-[0.55rem] text-on-surface-variant">{label}</span>;
}

function ConfidencePill({ value }: { value: number | null }) {
  if (value == null) return <span className="font-mono text-[0.65rem] text-outline">-</span>;
  const percent = Math.round(value * 100);
  const tone = percent >= 85 ? "ok" : percent >= 60 ? "warn" : "danger";
  return <span className={`inline-flex rounded px-1.5 py-0.5 font-mono text-[0.56rem] font-semibold ${badgeClass(tone)}`}>{percent}%</span>;
}

function EmptyState({ icon, title, sub }: { icon: string; title: string; sub: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-surface-highest/15">
        <Icon name={icon} className="text-lg text-outline" />
      </div>
      <p className="mb-0.5 text-xs font-medium text-on-surface-variant">{title}</p>
      <p className="max-w-sm text-[0.65rem] text-outline">{sub}</p>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg bg-surface-container/50 px-4 text-center ghost-border">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-error/8">
        <Icon name="cloud_off" className="text-lg text-error" />
      </div>
      <p className="mb-0.5 text-xs font-medium text-on-surface-variant">Agent data unavailable</p>
      <p className="max-w-sm text-[0.65rem] text-outline">{message}</p>
      <button onClick={onRetry} className="mt-3 rounded-md bg-primary/10 px-3 py-1.5 text-[0.65rem] font-medium text-primary hover:bg-primary/15">Retry</button>
    </div>
  );
}

function SegmentedTabs({ active, counts, onChange }: { active: TabKey; counts: Record<TabKey, number>; onChange: (tab: TabKey) => void }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg bg-surface-container/50 p-1 ghost-border">
      {TAB_ITEMS.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-[0.65rem] font-medium transition-colors ${
            active === tab.key ? "bg-primary/12 text-primary" : "text-outline hover:bg-surface-high/20 hover:text-on-surface-variant"
          }`}
        >
          <Icon name={tab.icon} className="text-sm" />
          <span>{tab.label}</span>
          <span className="rounded bg-surface-high/30 px-1.5 py-0.5 font-mono text-[0.55rem]">{counts[tab.key]}</span>
        </button>
      ))}
    </div>
  );
}

function FilterBar({ filters, options, onChange, onReset }: { filters: MonitorFilters; options: { agents: string[]; modules: string[]; statuses: string[]; severities: string[] }; onChange: (filters: MonitorFilters) => void; onReset: () => void }) {
  const update = (patch: Partial<MonitorFilters>) => onChange({ ...filters, ...patch });
  const selectClass = "rounded-md border border-outline-variant/8 bg-surface-container/60 px-2 py-1.5 text-[0.62rem] text-on-surface-variant outline-none focus:border-primary/30";

  return (
    <section className="rounded-lg bg-surface-container/45 px-3 py-3 ghost-border">
      <div className="flex flex-wrap items-center gap-2">
        <Icon name="filter_alt" className="text-sm text-outline" />
        <select value={filters.status} onChange={(event) => update({ status: event.target.value })} className={selectClass} aria-label="Status filter">
          <option value="all">All statuses</option>
          {options.statuses.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <select value={filters.module} onChange={(event) => update({ module: event.target.value })} className={selectClass} aria-label="Module filter">
          <option value="all">All modules</option>
          {options.modules.map((module) => <option key={module} value={module}>{module}</option>)}
        </select>
        <select value={filters.agent} onChange={(event) => update({ agent: event.target.value })} className={selectClass} aria-label="Agent filter">
          <option value="all">All agents</option>
          {options.agents.map((agent) => <option key={agent} value={agent}>{agent}</option>)}
        </select>
        <select value={filters.approvalRequired} onChange={(event) => update({ approvalRequired: event.target.value as MonitorFilters["approvalRequired"] })} className={selectClass} aria-label="Approval required filter">
          <option value="all">Any approval state</option>
          <option value="yes">Approval required</option>
          <option value="no">No approval required</option>
        </select>
        <select value={filters.severity} onChange={(event) => update({ severity: event.target.value })} className={selectClass} aria-label="Severity filter">
          <option value="all">All severities</option>
          {options.severities.map((severity) => <option key={severity} value={severity}>{severity}</option>)}
        </select>
        <select value={filters.confidence} onChange={(event) => update({ confidence: event.target.value as ConfidenceFilter })} className={selectClass} aria-label="Confidence filter">
          <option value="all">Any confidence</option>
          <option value="high">High confidence</option>
          <option value="medium">Medium confidence</option>
          <option value="low">Low confidence</option>
        </select>
        <select value={filters.dateRange} onChange={(event) => update({ dateRange: event.target.value as DateRangeFilter })} className={selectClass} aria-label="Date range filter">
          <option value="all">Any date</option>
          <option value="today">Today</option>
          <option value="7d">Last 7 days</option>
        </select>
        <button onClick={onReset} className="ml-auto rounded-md bg-surface-high/25 px-2.5 py-1.5 text-[0.62rem] font-medium text-on-surface-variant hover:bg-surface-high/40">
          Reset
        </button>
      </div>
    </section>
  );
}

function NextActionPanel({ actions }: { actions: Array<{ id: string; icon: string; title: string; detail: string; agent: string; module: string; tone: ReturnType<typeof statusTone>; onClick: () => void }> }) {
  return (
    <section className="rounded-lg bg-surface-container/50 ghost-border">
      <SectionHeader icon="priority_high" title="Next Review Queue" trailing={`${actions.length} actions`} />
      <div className="divide-y divide-outline-variant/4">
        {actions.length === 0 ? <EmptyState icon="task_alt" title="No urgent agent work" sub="Approvals and open exceptions will appear here first." /> : actions.map((action) => (
          <button key={action.id} onClick={action.onClick} className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-high/15">
            <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${badgeClass(action.tone)}`}>
              <Icon name={action.icon} className="text-sm" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-on-surface">{action.title}</span>
                <MiniPill label={action.module} />
              </span>
              <span className="mt-1 line-clamp-2 block text-[0.65rem] text-outline">{action.detail}</span>
              <span className="mt-1 block text-[0.56rem] text-outline">{action.agent}</span>
            </span>
            <Icon name="chevron_right" className="text-base text-outline" />
          </button>
        ))}
      </div>
    </section>
  );
}

function AgentRegistry({ agents, selectedAgentId, onSelect, compact = false, selector = false }: { agents: AgentRegistryItem[]; selectedAgentId: string | null; onSelect: (id: string) => void; compact?: boolean; selector?: boolean }) {
  return (
    <section className="min-w-0 rounded-lg bg-surface-container/50 ghost-border">
      <SectionHeader icon="table_rows" title="Agent Registry" trailing={`${agents.length} agents`} />
      <div className="overflow-x-auto">
        <table className={`w-full text-left ${selector ? "min-w-[400px]" : "min-w-[900px]"}`}>
          <thead className="border-b border-outline-variant/6 text-[0.58rem] uppercase tracking-[0.08em] text-outline">
            <tr>
              <th className="px-4 py-2 font-medium">Agent</th>
              <th className="px-3 py-2 font-medium">Status</th>
              {!selector && <>
              <th className="px-3 py-2 font-medium">Last run</th>
              <th className="px-3 py-2 font-medium">Success</th>
              <th className="px-3 py-2 font-medium">Confidence</th>
              <th className="px-3 py-2 font-medium">Approvals</th>
              <th className="px-3 py-2 font-medium">Exceptions</th>
              <th className="px-3 py-2 font-medium">Modules</th>
              </>}
              <th className="px-3 py-2 font-medium">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/4">
            {agents.length === 0 ? (
              <tr><td colSpan={selector ? 3 : 9}><EmptyState icon="smart_toy" title="No agents match filters" sub="Reset filters or choose a broader status/module selection." /></td></tr>
            ) : agents.map((agent) => (
              <tr key={agent.id} onClick={() => onSelect(agent.id)} className={`cursor-pointer transition-colors hover:bg-surface-high/15 ${selectedAgentId === agent.id ? "bg-primary/10" : ""}`}>
                <td className="px-4 py-3">
                  <button type="button" aria-label={`Select ${agent.name}`} aria-pressed={selectedAgentId === agent.id} onClick={event => { event.stopPropagation(); onSelect(agent.id); }} className="flex w-full items-center gap-2 rounded text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
                    <span className={`flex h-7 w-7 items-center justify-center rounded-md border ${healthClass(agent.health)}`}>
                      <Icon name={agent.status === "Disabled" ? "power_settings_new" : "smart_toy"} className="text-sm" />
                    </span>
                    <span className="min-w-0">
                      <span className={`block ${selector ? "whitespace-normal" : "truncate"} text-xs font-medium text-on-surface`}>{agent.name}</span>
                      <span className="block truncate text-[0.6rem] text-outline">{selectedAgentId === agent.id ? "Selected" : agent.category}</span>
                    </span>
                  </button>
                </td>
                <td className="px-3 py-3"><StatusBadge value={agent.status} /></td>
                {!selector && <>
                <td className="px-3 py-3 text-[0.65rem] text-outline">{formatRelative(agent.lastRun)}</td>
                <td className="px-3 py-3 font-mono text-xs">{intPct(agent.successRate)}</td>
                <td className="px-3 py-3"><ConfidencePill value={agent.averageConfidence} /></td>
                <td className="px-3 py-3 font-mono text-xs">{agent.pendingApprovals}</td>
                <td className="px-3 py-3 font-mono text-xs">{agent.openExceptions}</td>
                <td className="px-3 py-3">
                  <div className="flex max-w-[240px] flex-wrap gap-1">
                    {agent.linkedModules.slice(0, compact ? 2 : 3).map((module) => <MiniPill key={module} label={module} />)}
                  </div>
                </td>
                </>}
                <td className="px-3 py-3">
                  <button type="button" onClick={event => { event.stopPropagation(); onSelect(agent.id); }} className="rounded-md bg-primary/10 px-2.5 py-1.5 text-[0.62rem] font-medium text-primary hover:bg-primary/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                    View details
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LinkedObject({ link }: { link: BusinessLink }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[0.65rem] font-medium text-on-surface-variant">{link.label}</p>
      <p className="text-[0.56rem] text-outline">{link.type} - {link.module}</p>
    </div>
  );
}

function RunTimeline({ runs }: { runs: AgentRunRow[] }) {
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  return (
    <section className="rounded-lg bg-surface-container/50 ghost-border">
      <SectionHeader icon="timeline" title="Agent Run Timeline" trailing={`${runs.length} recent`} />
      <div className="max-h-[520px] overflow-y-auto divide-y divide-outline-variant/4">
        {runs.length === 0 ? <EmptyState icon="timeline" title="No runs recorded" sub="Runs appear after command, RFQ, validation, or review workflows execute." /> : runs.slice(0, 18).map((run) => (
          <div key={run.id} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_160px]">
            <div className="min-w-0">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="font-mono text-[0.58rem] text-outline">{run.id}</span>
                <StatusBadge value={run.status} />
                <SourceBadge mode={run.dataSource} />
              </div>
              <p className="truncate text-xs font-medium text-on-surface">{run.agentName}</p>
              <p className="mt-1 text-sm text-outline">Execution: {run.execution}</p>
              {expandedRunId === run.id ? <p className="mt-0.5 text-[0.65rem] leading-relaxed text-outline">{run.resultSummary}</p> : null}
              {run.error ? <p className="mt-1 text-[0.62rem] text-error">{run.error}</p> : null}
              <div className="mt-2 flex flex-wrap items-center gap-3 text-[0.56rem] text-outline">
                <span>{run.module}</span>
                <span>{run.trigger}</span>
                <span>{formatRelative(run.startedAt)}</span>
                <span>{formatDuration(run.durationMs)}</span>
                <span>{run.taskCount} tasks</span>
                <span>{run.exceptionCount} exceptions</span>
              </div>
            </div>
            <div className="flex items-start justify-between gap-3 md:block">
              <LinkedObject link={run.linkedObject} />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <ConfidencePill value={run.confidence} />
                <button onClick={() => setExpandedRunId((current) => current === run.id ? null : run.id)} className="rounded-md bg-primary/10 px-2 py-1 text-[0.58rem] font-medium text-primary hover:bg-primary/15">
                  {expandedRunId === run.id ? "Close" : "Details"}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TaskTimeline({ tasks }: { tasks: AgentTaskRow[] }) {
  return (
    <section className="rounded-lg bg-surface-container/50 ghost-border">
      <SectionHeader icon="format_list_bulleted" title="Agent Task History" trailing={`${tasks.length} tasks`} />
      <div className="max-h-[520px] overflow-y-auto divide-y divide-outline-variant/4">
        {tasks.length === 0 ? <EmptyState icon="task_alt" title="No task records" sub="Task-level tracking appears after agents create auditable work items." /> : tasks.slice(0, 20).map((task) => (
          <div key={task.id} className="flex items-start gap-3 px-4 py-3">
            <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${task.status === "Failed" ? "bg-error/8 text-error" : task.requiresApproval ? "bg-primary/8 text-primary" : "bg-success/8 text-success"}`}>
              <Icon name={task.status === "Failed" ? "close" : task.requiresApproval ? "approval" : "check"} className="text-sm" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <p className="text-xs font-medium text-on-surface">{actionLabel(task.action)}</p>
                <StatusBadge value={task.status} />
                {task.requiresApproval ? <StatusBadge value="Human Approval" /> : null}
              </div>
              <LinkedObject link={task.linkedObject} />
              {task.error ? <p className="mt-1 text-[0.62rem] text-error">{task.error}</p> : null}
              <div className="mt-2 flex flex-wrap items-center gap-3 text-[0.56rem] text-outline">
                <span>{task.agentName}</span>
                <span>{formatRelative(task.startedAt)}</span>
                <span>{formatDuration(task.durationMs)}</span>
                <span>{task.exceptionCount} exceptions</span>
                <ConfidencePill value={task.confidence} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ApprovalQueue({ approvals, resolvingId, onResolve, onReview }: { approvals: AgentApprovalRow[]; resolvingId: string | null; onResolve: (id: string, action: "approve" | "reject") => void; onReview: (agentId: string) => void }) {
  return (
    <section className="rounded-lg bg-surface-container/50 ghost-border">
      <SectionHeader icon="approval" title="Approval Queue" trailing={`${approvals.length} pending`} />
      <div className="grid gap-3 p-4 xl:grid-cols-2">
        {approvals.length === 0 ? <EmptyState icon="verified" title="No pending approvals" sub="Agent-generated actions that affect business workflows will queue here." /> : approvals.slice(0, 10).map((approval) => (
          <div key={approval.id} className="rounded-lg border border-outline-variant/6 bg-surface-low/15 p-3">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <p className="text-xs font-medium text-on-surface">{actionLabel(approval.action)}</p>
              <StatusBadge value={approval.impact} />
              <SourceBadge mode={approval.dataSource} />
              <ConfidencePill value={approval.confidence} />
            </div>
            <p className="line-clamp-2 text-[0.65rem] text-outline">{approval.approvalReason}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[0.56rem] text-outline">
              <span>{approval.agentName}</span>
              <span>{approval.module}</span>
              <span>{formatRelative(approval.requestedAt)}</span>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
              <LinkedObject link={approval.linkedObject} />
              <div className="flex flex-wrap items-center gap-2">
                <button disabled={resolvingId === approval.id} onClick={() => onReview(approval.agent)} className="rounded-md border border-primary/15 bg-primary/8 px-2.5 py-1.5 text-[0.62rem] font-medium text-primary disabled:opacity-50">
                  Review
                </button>
                <button disabled className="rounded-md border border-outline-variant/10 bg-surface-high/15 px-2.5 py-1.5 text-[0.62rem] font-medium text-outline disabled:opacity-60" title="Edit-required workflow is prepared for future task-specific editors.">
                  Edit required
                </button>
                <button disabled={resolvingId === approval.id} onClick={() => onResolve(approval.id, "reject")} className="rounded-md border border-error/15 bg-error/8 px-2.5 py-1.5 text-[0.62rem] font-medium text-error disabled:opacity-50">
                  Reject
                </button>
                <button disabled={resolvingId === approval.id} onClick={() => onResolve(approval.id, "approve")} className="rounded-md border border-success/15 bg-success/8 px-2.5 py-1.5 text-[0.62rem] font-medium text-success disabled:opacity-50">
                  Approve
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ExceptionQueue({ exceptions, resolvingId, onResolve, onReview }: { exceptions: AgentExceptionRow[]; resolvingId: string | null; onResolve: (id: string, action: "resolve" | "dismiss" | "review") => void; onReview: (agentId: string) => void }) {
  return (
    <section className="rounded-lg bg-surface-container/50 ghost-border">
      <SectionHeader icon="report" title="Exceptions" trailing={`${exceptions.length} open`} />
      <div className="grid gap-3 p-4 xl:grid-cols-2">
        {exceptions.length === 0 ? <EmptyState icon="task_alt" title="No open agent exceptions" sub="Failed, low-confidence, or blocked agent work appears here." /> : exceptions.slice(0, 10).map((item) => (
          <div key={item.id} className="rounded-lg border border-outline-variant/6 bg-surface-low/15 p-3">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <p className="text-xs font-medium text-on-surface">{item.title}</p>
              <StatusBadge value={item.severity} />
              <StatusBadge value={item.status} />
            </div>
            <p className="line-clamp-2 text-[0.65rem] text-outline">{item.description}</p>
            {item.suggestedAction ? <p className="mt-2 rounded-md bg-warning/8 px-2 py-1.5 text-[0.62rem] text-warning">{item.suggestedAction}</p> : null}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[0.56rem] text-outline">
              <span>{item.agentName}</span>
              <span>{item.module}</span>
              <span>{formatRelative(item.createdAt)}</span>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
              <LinkedObject link={item.linkedObject} />
              <div className="flex flex-wrap items-center gap-2">
                <button disabled={resolvingId === item.id} onClick={() => { onResolve(item.id, "review"); onReview(item.agent); }} className="rounded-md border border-primary/15 bg-primary/8 px-2.5 py-1.5 text-[0.62rem] font-medium text-primary disabled:opacity-50">
                  Review
                </button>
                <button disabled={resolvingId === item.id} onClick={() => onResolve(item.id, "resolve")} className="rounded-md border border-success/15 bg-success/8 px-2.5 py-1.5 text-[0.62rem] font-medium text-success disabled:opacity-50">
                  Resolve
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function LearningMemory({ records, totals, expanded, onToggle }: { records: MemoryRecord[]; totals: AgentMonitorSnapshot["learning"]["totals"]; expanded: boolean; onToggle: () => void }) {
  const confirmed = records.filter((record) => record.confidence === "confirmed" || record.confidence === "manual").length;
  const suggested = records.filter((record) => record.confidence === "suggested" || record.confidence === "learned").length;
  const reliabilityValues = records
    .map((record) => typeof record.payload.reliability === "number" ? record.payload.reliability : null)
    .filter((value): value is number => value != null);
  const reliability = reliabilityValues.length
    ? `${Math.round((reliabilityValues.reduce((sum, value) => sum + value, 0) / reliabilityValues.length) * 100)}%`
    : "-";

  return (
    <section className="rounded-lg bg-surface-container/50 ghost-border">
      <SectionHeader icon="psychology" title="Learning Memory" trailing={`${totals.feedbackCount} signals`} />
      <div className="grid grid-cols-2 gap-2 p-4 md:grid-cols-4 xl:grid-cols-7">
        <Metric label="Approved corrections" value={String(totals.acceptedRecommendations)} sub={`${totals.acceptRate}% of corrections`} icon="thumb_up" />
        <Metric label="Rejected corrections" value={String(totals.rejectedRecommendations)} sub={`${totals.rejectRate}% of corrections`} icon="thumb_down" />
        <Metric label="Pending / revoked" value={String(totals.feedbackCount - totals.acceptedRecommendations - totals.rejectedRecommendations)} sub="Excluded from reuse" icon="edit" />
        <Metric label="Supporting records" value={String(totals.sourceCount)} sub="Supplier and inventory sources" icon="database" />
        <Metric label="Reliability" value={reliability} sub="Not scored for aliases" icon="verified" />
        <Metric label="Approved in view" value={String(confirmed)} sub="Activation is separate" icon="task_alt" />
        <Metric label="Other in view" value={String(suggested)} sub="Not approved for reuse" icon="tips_and_updates" />
      </div>
      <div className="border-t border-outline-variant/6 px-4 py-3">
        <button onClick={onToggle} className="rounded-md bg-primary/10 px-3 py-1.5 text-[0.65rem] font-medium text-primary hover:bg-primary/15">
          {expanded ? "Hide memory records" : "Show memory records"}
        </button>
      </div>
      {expanded ? (
        <div className="divide-y divide-outline-variant/4">
          {records.length === 0 ? <EmptyState icon="psychology" title="No scoped corrections" sub="Capture and review a supplier correction above. Unowned historical feedback stays excluded." /> : records.slice(0, 12).map((record) => (
            <div key={record.id} className="px-4 py-3">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <p className="text-xs font-medium text-on-surface">{record.memoryKey}</p>
                <MemoryBadge value={record.confidence} />
                <MiniPill label={record.memoryType.replace(/_/g, " ")} />
              </div>
              <p className="text-[0.65rem] text-outline">{describeMemory(record)}</p>
              <p className="mt-1 text-[0.56rem] text-outline">{record.observations} observations - {formatRelative(record.lastObservedAt)}</p>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function MemoryBadge({ value }: { value: MemoryRecord["confidence"] }) {
  const tone = value === "confirmed" || value === "manual" ? "ok" : value === "learned" ? "warn" : "muted";
  return <span className={`rounded border px-1.5 py-0.5 text-[0.56rem] font-semibold ${badgeClass(tone)}`}>{value}</span>;
}

function describeMemory(memory: MemoryRecord) {
  if (["reviewed_supplier_alias", "reviewed_item_alias"].includes(memory.memoryType)) return `${String(memory.payload.status)} correction for ${String(memory.payload.expectedName)}; ${memory.payload.active ? "explicitly activated" : "not active"}.`;
  if (memory.memoryType === "source_reliability") {
    const reliability = typeof memory.payload.reliability === "number" ? Math.round(memory.payload.reliability * 100) : 0;
    const accepts = typeof memory.payload.accepts === "number" ? memory.payload.accepts : 0;
    const rejects = typeof memory.payload.rejects === "number" ? memory.payload.rejects : 0;
    const edits = typeof memory.payload.edits === "number" ? memory.payload.edits : 0;
    return `${reliability}% reliability from ${accepts} accepted, ${rejects} rejected, and ${edits} edited routing signals.`;
  }
  const status = typeof memory.payload.status === "string" ? memory.payload.status : "tracked";
  return `${status} supplier-routing memory retained for future ranking and review.`;
}

function UsageReadiness({ usage }: { usage: AgentMonitorSnapshot["usage"] }) {
  return (
    <section className="rounded-lg bg-surface-container/50 ghost-border">
      <SectionHeader icon="query_stats" title="Cost / Usage Readiness" trailing={usage.providerLabel} />
      <div className="grid grid-cols-2 gap-2 p-4">
        <Metric label="Provider attempts" value={String(usage.aiCalls)} sub="Recorded · last 30 days" icon="auto_awesome" />
        <Metric label="Tasks" value={String(usage.taskCount)} sub="Tracked work" icon="format_list_bulleted" />
        <Metric label="Failed / retried" value={String(usage.failedOrRetriedCalls)} sub="Needs follow-up" icon="sync_problem" tone={usage.failedOrRetriedCalls > 0 ? "warn" : "ok"} />
        <Metric label="Cost details" value="Settings" sub="AI provider usage" icon="payments" />
      </div>
      <div className="border-t border-outline-variant/6 px-4 py-3">
        <p className="text-[0.65rem] leading-relaxed text-outline">{usage.note}</p>
      </div>
    </section>
  );
}

function AgentDetailPanel({ agent, runs, tasks, approvals, exceptions, auditEvents, learningRecords }: { agent: AgentRegistryItem | null; runs: AgentRunRow[]; tasks: AgentTaskRow[]; approvals: AgentApprovalRow[]; exceptions: AgentExceptionRow[]; auditEvents: AuditEvent[]; learningRecords: MemoryRecord[] }) {
  if (!agent) {
    return (
      <section className="rounded-lg bg-surface-container/50 ghost-border">
        <EmptyState icon="smart_toy" title="No agent selected" sub="Select an agent to inspect configuration, restrictions, tasks, and audit records." />
      </section>
    );
  }

  return (
    <section className="rounded-lg bg-surface-container/50 ghost-border">
      <SectionHeader icon="manage_search" title="Agent Detail" trailing={agent.configurationStatus} />
      <div className="space-y-4 p-4">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold text-on-surface">{agent.name}</h4>
            <StatusBadge value={agent.status} />
            <SourceBadge mode={agent.dataSource} />
          </div>
          <p className="text-[0.68rem] leading-relaxed text-outline">{agent.description}</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Metric label="Runs" value={String(agent.totalRuns)} sub={`${intPct(agent.successRate)} success`} icon="history" />
          <Metric label="Tasks done" value={String(agent.tasksCompleted)} sub={`${pct(agent.averageConfidence)} avg confidence`} icon="task_alt" />
          <Metric label="Approvals" value={String(agent.pendingApprovals)} sub="Pending" icon="approval" tone={agent.pendingApprovals > 0 ? "warn" : "ok"} />
          <Metric label="Exceptions" value={String(agent.openExceptions)} sub="Open" icon="report" tone={agent.openExceptions > 0 ? "warn" : "ok"} />
        </div>

        <DetailGroup title="Linked modules" items={agent.linkedModules} />
        <DetailGroup title="Capabilities" items={agent.capabilities} />
        <DetailGroup title="Allowed actions" items={agent.allowedActions} />
        <DetailGroup title="Restricted actions" items={agent.restrictedActions} danger />
        <DetailGroup title="Approval required for" items={agent.approvalRequiredFor} />

        {agent.lastError ? (
          <div className="rounded-md border border-error/15 bg-error/8 px-3 py-2">
            <p className="text-[0.6rem] font-medium text-error">Last error</p>
            <p className="mt-1 text-[0.65rem] text-error">{agent.lastError}</p>
          </div>
        ) : null}

        <CompactList title="Recent runs" items={runs.slice(0, 4).map((run) => `${run.status}: ${run.resultSummary}`)} empty="No recent runs." />
        <CompactList title="Recent tasks" items={tasks.slice(0, 4).map((task) => `${actionLabel(task.action)} - ${task.status}`)} empty="No recent tasks." />
        <CompactList title="Recent approvals" items={approvals.slice(0, 4).map((approval) => `${approval.status}: ${actionLabel(approval.action)}`)} empty="No recent approvals." />
        <CompactList title="Recent exceptions" items={exceptions.slice(0, 3).map((item) => `${item.severity}: ${item.title}`)} empty="No recent exceptions." />
        <CompactList title="Learning signals" items={learningRecords.slice(0, 3).map((record) => `${record.confidence}: ${record.memoryKey}`)} empty="No learning signals for this agent." />
        <CompactList title="Audit events" items={auditEvents.map((event) => `${actionLabel(event.action)} - ${event.summary}`)} empty="No audit events." />
      </div>
    </section>
  );
}

function DetailGroup({ title, items, danger = false }: { title: string; items: string[]; danger?: boolean }) {
  return (
    <div>
      <p className="mb-1.5 text-[0.6rem] font-medium uppercase tracking-[0.08em] text-outline">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span key={item} className={`rounded px-1.5 py-1 text-[0.58rem] ${danger ? "bg-error/8 text-error" : "bg-surface-high/25 text-on-surface-variant"}`}>{item}</span>
        ))}
      </div>
    </div>
  );
}

function CompactList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div>
      <p className="mb-1.5 text-[0.6rem] font-medium uppercase tracking-[0.08em] text-outline">{title}</p>
      {items.length === 0 ? (
        <p className="text-[0.65rem] text-outline">{empty}</p>
      ) : (
        <div className="space-y-1">
          {items.map((item, index) => (
            <p key={`${item}-${index}`} className="line-clamp-1 rounded bg-surface-low/20 px-2 py-1.5 text-[0.62rem] text-on-surface-variant">{item}</p>
          ))}
        </div>
      )}
    </div>
  );
}
