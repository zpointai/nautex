"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type ExceptionSource = "agent" | "finance";
type DataSourceMode = "production" | "demo" | "mixed";
type ExceptionAction = "review" | "resolve" | "dismiss" | "reopen";
type ActionFeedback = { tone: "success" | "error"; message: string } | null;

interface LinkedObject {
  type: string;
  id: string | null;
  label: string;
  module: string;
}

interface AuditEvent {
  id: string;
  action: string;
  actor: string;
  createdAt: string;
  previousStatus: string | null;
  newStatus: string | null;
  note: string | null;
}

interface OperationalException {
  id: string;
  source: ExceptionSource;
  sourceId: string;
  dataSource: DataSourceMode;
  title: string;
  description: string;
  severity: string;
  status: string;
  domain: string;
  module: string;
  createdBy: string;
  creatorType: "agent" | "workflow" | "user" | "system";
  createdAt: string;
  ageHours: number;
  ageLabel: string;
  reviewBy: string | null;
  overdue: boolean;
  confidence: number | null;
  riskScore: number | null;
  riskLevel: string;
  financialImpact: number | null;
  recommendedAction: string | null;
  linkedObject: LinkedObject;
  relatedAgentRunId: string | null;
  relatedTaskId: string | null;
  reason: string;
  evidence: string[];
  allowedActions: ExceptionAction[];
  restrictedActions: string[];
  auditTimeline: AuditEvent[];
  resolvedBy: string | null;
  resolvedAt: string | null;
}

interface ExceptionSummary {
  open: number;
  critical: number;
  warnings: number;
  awaitingReview: number;
  overdue: number;
  resolvedToday: number;
  linkedAgent: number;
  highFinancialImpact: number;
  total: number;
}

interface ExceptionListResult {
  summary: ExceptionSummary;
  exceptions: OperationalException[];
  filters: {
    severities: string[];
    statuses: string[];
    domains: string[];
    sources: string[];
    objectTypes: string[];
    creators: string[];
  };
  generatedAt: string;
}

interface QueueFilters {
  severity: string;
  status: string;
  domain: string;
  source: string;
  objectType: string;
  creator: string;
  overdue: "all" | "true";
  risk: string;
  dateRange: string;
  sort: string;
  q: string;
}

const DEFAULT_FILTERS: QueueFilters = {
  severity: "all",
  status: "all",
  domain: "all",
  source: "all",
  objectType: "all",
  creator: "all",
  overdue: "all",
  risk: "all",
  dateRange: "all",
  sort: "severity",
  q: "",
};

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return <span className={`material-symbols-outlined ${className}`} style={{ fontVariationSettings: "'FILL' 0, 'wght' 300, 'opsz' 20" }}>{name}</span>;
}

export function ExceptionsQueueModule() {
  const [payload, setPayload] = useState<ExceptionListResult | null>(null);
  const [filters, setFilters] = useState<QueueFilters>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingAction, setSavingAction] = useState<ExceptionAction | null>(null);
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ limit: "150" });
    Object.entries(filters).forEach(([key, value]) => {
      if (value && value !== "all") params.set(key === "q" ? "q" : key, value);
    });
    return params.toString();
  }, [filters]);

  const fetchData = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/v1/agents/exceptions?${queryString}`);
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.error?.message ?? "Failed to load exceptions.");
      setPayload(json.data);
      setSelectedId((current) => {
        const rows = (json.data?.exceptions ?? []) as OperationalException[];
        if (current && rows.some((row) => row.id === current)) return current;
        return rows[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load exceptions.");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const exceptions = payload?.exceptions ?? [];
  const selected = exceptions.find((item) => item.id === selectedId) ?? exceptions[0] ?? null;
  const summary = payload?.summary ?? {
    open: 0,
    critical: 0,
    warnings: 0,
    awaitingReview: 0,
    overdue: 0,
    resolvedToday: 0,
    linkedAgent: 0,
    highFinancialImpact: 0,
    total: 0,
  };

  const updateFilter = (key: keyof QueueFilters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const runAction = async (item: OperationalException, action: ExceptionAction) => {
    const note = actionNote.trim();
    setActionFeedback(null);
    if ((action === "resolve" || action === "dismiss") && !note) {
      setActionFeedback({ tone: "error", message: action === "resolve" ? "Add a resolution note before resolving." : "Add a dismissal reason before dismissing." });
      return;
    }

    setSavingAction(action);
    setError(null);
    try {
      const res = await fetch("/api/v1/agents/exceptions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          action,
          actor: "operator",
          note: note || undefined,
          reason: action === "dismiss" ? note : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.error?.message ?? "Failed to update exception.");
      setActionNote("");
      setActionFeedback({ tone: "success", message: actionSuccessMessage(action) });
      await fetchData();
    } catch (err) {
      setActionFeedback({ tone: "error", message: err instanceof Error ? err.message : "Failed to update exception." });
    } finally {
      setSavingAction(null);
    }
  };

  const copyRecommendedAction = async () => {
    if (!selected?.recommendedAction) return;
    await navigator.clipboard?.writeText(selected.recommendedAction);
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-4 min-[1800px]:grid-cols-8">
        <SummaryCard label="Open" value={summary.open} icon="error" tone={summary.open > 0 ? "warn" : "ok"} />
        <SummaryCard label="Critical" value={summary.critical} icon="priority_high" tone={summary.critical > 0 ? "danger" : "ok"} />
        <SummaryCard label="Warnings" value={summary.warnings} icon="warning" tone={summary.warnings > 0 ? "warn" : "ok"} />
        <SummaryCard label="Awaiting Review" value={summary.awaitingReview} icon="rate_review" tone={summary.awaitingReview > 0 ? "warn" : "ok"} />
        <SummaryCard label="Overdue" value={summary.overdue} icon="timer_off" tone={summary.overdue > 0 ? "danger" : "ok"} />
        <SummaryCard label="Resolved Today" value={summary.resolvedToday} icon="task_alt" tone="ok" />
        <SummaryCard label="Linked Agents" value={summary.linkedAgent} icon="smart_toy" tone="neutral" />
        <SummaryCard label="High Impact" value={summary.highFinancialImpact} icon="payments" tone={summary.highFinancialImpact > 0 ? "warn" : "neutral"} />
      </div>

      <section className="rounded-lg bg-surface-container/50 ghost-border">
        <div className="border-b border-outline-variant/6 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Icon name="playlist_add_check" className="text-base text-on-surface-variant" />
              <h3 className="text-[0.82rem] font-semibold">Human Intervention Queue</h3>
              <span className="rounded border border-primary/12 bg-primary/8 px-1.5 py-0.5 text-[0.56rem] font-semibold text-primary">Prisma-backed</span>
            </div>
            <button onClick={fetchData} className="inline-flex items-center gap-1.5 rounded-md bg-surface-high/30 px-2.5 py-1.5 text-[0.62rem] font-medium text-on-surface-variant hover:bg-surface-high/50">
              <Icon name="refresh" className="text-sm" />
              Refresh
            </button>
          </div>

          <div className="grid gap-2 md:grid-cols-4 min-[1800px]:grid-cols-8">
            <label className="md:col-span-2">
              <span className="sr-only">Search exceptions</span>
              <div className="flex items-center gap-2 rounded-md border border-outline-variant/8 bg-surface-low/20 px-2.5 py-1.5">
                <Icon name="search" className="text-sm text-outline" />
                <input
                  value={filters.q}
                  onChange={(event) => updateFilter("q", event.target.value)}
                  placeholder="PO, RFQ, supplier, invoice, vessel..."
                  className="min-w-0 flex-1 bg-transparent text-[0.65rem] text-on-surface-variant outline-none placeholder:text-outline"
                />
              </div>
            </label>
            <FilterSelect label="Severity" value={filters.severity} onChange={(value) => updateFilter("severity", value)} options={payload?.filters.severities ?? []} />
            <FilterSelect label="Status" value={filters.status} onChange={(value) => updateFilter("status", value)} options={payload?.filters.statuses ?? []} />
            <FilterSelect label="Module" value={filters.domain} onChange={(value) => updateFilter("domain", value)} options={payload?.filters.domains ?? []} formatter={humanize} />
            <FilterSelect label="Created By" value={filters.creator} onChange={(value) => updateFilter("creator", value)} options={payload?.filters.creators ?? []} formatter={humanize} />
            <FilterSelect label="Object" value={filters.objectType} onChange={(value) => updateFilter("objectType", value)} options={payload?.filters.objectTypes ?? []} />
            <FilterSelect label="Risk" value={filters.risk} onChange={(value) => updateFilter("risk", value)} options={["Critical", "High", "Medium", "Low"]} />
            <FilterSelect label="Source" value={filters.source} onChange={(value) => updateFilter("source", value)} options={payload?.filters.sources ?? []} formatter={humanize} />
            <FilterSelect label="Overdue" value={filters.overdue} onChange={(value) => updateFilter("overdue", value as QueueFilters["overdue"])} options={["true"]} formatter={(value) => value === "true" ? "Overdue only" : value} />
            <FilterSelect label="Date" value={filters.dateRange} onChange={(value) => updateFilter("dateRange", value)} options={["today", "7d", "30d"]} formatter={(value) => value === "7d" ? "Last 7 days" : value === "30d" ? "Last 30 days" : humanize(value)} />
            <FilterSelect label="Sort" value={filters.sort} onChange={(value) => updateFilter("sort", value)} options={["severity", "newest", "oldest", "age", "risk", "module", "status"]} formatter={humanize} includeAll={false} />
            <button onClick={() => setFilters(DEFAULT_FILTERS)} className="rounded-md border border-outline-variant/8 bg-surface-high/15 px-2.5 py-1.5 text-[0.62rem] font-medium text-outline hover:text-on-surface-variant">Clear</button>
          </div>
        </div>

        {error ? (
          <div className="border-b border-error/10 bg-error/5 px-4 py-2.5">
            <div className="flex items-center gap-2 text-[0.65rem] text-error">
              <Icon name="error" className="text-sm" />
              <span>{error}</span>
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="flex min-h-[360px] items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
          </div>
        ) : exceptions.length === 0 ? (
          <EmptyState onRetry={fetchData} />
        ) : (
          <div className="grid min-h-[520px] xl:grid-cols-[minmax(0,1fr)_420px]">
            <div className="divide-y divide-outline-variant/4">
              {exceptions.map((item) => (
                <ExceptionRow key={item.id} item={item} selected={selected?.id === item.id} onSelect={() => { setSelectedId(item.id); setActionNote(""); setActionFeedback(null); }} />
              ))}
            </div>
            <DetailPanel
              item={selected}
              actionNote={actionNote}
              savingAction={savingAction}
          onNoteChange={setActionNote}
          onAction={runAction}
          actionFeedback={actionFeedback}
          onCopyRecommendedAction={copyRecommendedAction}
        />
          </div>
        )}
      </section>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
  formatter = (item) => item,
  includeAll = true,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  formatter?: (value: string) => string;
  includeAll?: boolean;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[0.52rem] font-semibold uppercase tracking-wider text-outline">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="min-w-0 rounded-md border border-outline-variant/8 bg-surface-low/20 px-2 py-1.5 text-[0.62rem] text-on-surface-variant outline-none focus:border-primary/25">
        {includeAll ? <option value="all">All</option> : null}
        {options.map((option) => <option key={option} value={option}>{formatter(option)}</option>)}
      </select>
    </label>
  );
}

function ExceptionRow({ item, selected, onSelect }: { item: OperationalException; selected: boolean; onSelect: () => void }) {
  return (
    <button onClick={onSelect} className={`w-full px-4 py-3 text-left transition-colors ${selected ? "bg-primary/6" : "hover:bg-surface-high/10"}`}>
      <div className="grid gap-3 sm:grid-cols-2 min-[1800px]:grid-cols-[minmax(0,1.5fr)_130px_130px_110px_96px] min-[1800px]:items-center">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <SeverityBadge value={item.severity} />
            <StatusBadge value={item.status} />
            {item.overdue ? <MiniBadge value="Overdue" tone="danger" /> : null}
            <SourceBadge mode={item.dataSource} />
          </div>
          <p className="text-sm font-semibold text-on-surface">{item.title}</p>
          <p className="mt-1 line-clamp-2 text-[0.65rem] leading-relaxed text-outline">{item.description}</p>
        </div>
        <InfoCell label={item.module} sub={humanize(item.domain)} icon="apps" />
        <InfoCell label={item.linkedObject.label} sub={item.linkedObject.type} icon="link" />
        <InfoCell label={humanize(item.createdBy)} sub={humanize(item.creatorType)} icon={item.creatorType === "agent" ? "smart_toy" : "account_tree"} />
        <div className="flex flex-wrap items-center gap-2 xl:justify-end">
          <MetricPill label="Age" value={item.ageLabel} />
          <MetricPill label="Risk" value={item.riskScore == null ? item.riskLevel : `${item.riskScore}`} />
        </div>
      </div>
    </button>
  );
}

function DetailPanel({
  item,
  actionNote,
  savingAction,
  onNoteChange,
  onAction,
  actionFeedback,
  onCopyRecommendedAction,
}: {
  item: OperationalException | null;
  actionNote: string;
  savingAction: ExceptionAction | null;
  onNoteChange: (value: string) => void;
  onAction: (item: OperationalException, action: ExceptionAction) => void;
  actionFeedback: ActionFeedback;
  onCopyRecommendedAction: () => void;
}) {
  if (!item) return null;
  const can = new Set(item.allowedActions);
  const note = actionNote.trim();
  const busy = savingAction != null;
  const resolveDisabledReason = busy
    ? "Another action is in progress."
    : !can.has("resolve")
      ? "Resolve is available for open or reviewing exceptions only."
      : !note
        ? "Add a resolution note first."
        : undefined;
  const dismissDisabledReason = busy
    ? "Another action is in progress."
    : !can.has("dismiss")
      ? "Dismiss is available for open or reviewing exceptions only."
      : !note
        ? "Add a dismissal reason first."
        : undefined;
  const reviewDisabledReason = busy
    ? "Another action is in progress."
    : !can.has("review")
      ? "Review is available only for open exceptions."
      : undefined;
  const reopenDisabledReason = busy
    ? "Another action is in progress."
    : !can.has("reopen")
      ? "Reopen is available only for resolved or dismissed exceptions."
      : undefined;

  return (
    <aside className="border-t border-outline-variant/6 bg-surface-low/10 xl:border-l xl:border-t-0">
      <div className="sticky top-0 max-h-[calc(100vh-150px)] overflow-y-auto p-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <SeverityBadge value={item.severity} />
              <StatusBadge value={item.status} />
              <SourceBadge mode={item.dataSource} />
            </div>
            <h3 className="text-sm font-semibold leading-snug text-on-surface">{item.title}</h3>
            <p className="mt-1 text-[0.65rem] text-outline">{item.module} / {item.linkedObject.type} / {item.ageLabel}</p>
          </div>
          <Icon name="fact_check" className="text-base text-primary" />
        </div>

        <DetailSection title="Why It Exists">
          <p className="text-[0.68rem] leading-relaxed text-on-surface-variant">{item.description}</p>
          <p className="mt-2 rounded-md bg-surface-high/20 px-2.5 py-2 text-[0.65rem] leading-relaxed text-outline">{item.reason}</p>
        </DetailSection>

        <DetailSection title="Business Context">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Linked Module" value={item.module} />
            <Field label="Linked Record" value={item.linkedObject.label} />
            <Field label="Object Type" value={item.linkedObject.type} />
            <Field label="Created By" value={`${humanize(item.createdBy)} (${humanize(item.creatorType)})`} />
            <Field label="Created" value={formatDateTime(item.createdAt)} />
            <Field label="Review By" value={item.reviewBy ? formatDateTime(item.reviewBy) : "Not set"} tone={item.overdue ? "danger" : "normal"} />
            <Field label="Confidence" value={item.confidence == null ? "Not available" : `${Math.round(item.confidence * 100)}%`} />
            <Field label="Risk" value={item.riskScore == null ? item.riskLevel : `${item.riskLevel} (${item.riskScore})`} />
            <Field label="Financial Impact" value={item.financialImpact == null ? "Not available" : formatMoney(item.financialImpact)} />
            <Field label="Agent Run" value={item.relatedAgentRunId ?? "Not linked"} />
          </div>
        </DetailSection>

        <DetailSection title="Recommended Next Action">
          {item.recommendedAction ? (
            <div className="space-y-2">
              <p className="rounded-md bg-primary/8 px-2.5 py-2 text-[0.68rem] leading-relaxed text-primary">{item.recommendedAction}</p>
              <button onClick={onCopyRecommendedAction} className="inline-flex items-center gap-1.5 rounded-md bg-surface-high/25 px-2.5 py-1.5 text-[0.62rem] font-medium text-on-surface-variant hover:bg-surface-high/40">
                <Icon name="content_copy" className="text-sm" />
                Copy action
              </button>
            </div>
          ) : (
            <p className="text-[0.65rem] text-outline">No recommended action is recorded for this exception.</p>
          )}
        </DetailSection>

        <DetailSection title="Evidence">
          <div className="space-y-2">
            {item.evidence.map((entry, index) => (
              <div key={`${item.id}:evidence:${index}`} className="rounded-md border border-outline-variant/6 bg-surface-high/10 px-2.5 py-2 text-[0.65rem] leading-relaxed text-on-surface-variant">{entry}</div>
            ))}
          </div>
        </DetailSection>

        <DetailSection title="Workflow Actions">
          <div className="mb-3 rounded-md border border-outline-variant/6 bg-surface-high/10 px-2.5 py-2">
            <p className="text-[0.62rem] font-medium text-on-surface-variant">{workflowHint(item.status)}</p>
            <p className="mt-1 text-[0.58rem] text-outline">Resolve and dismiss require a human note. No linked business record is changed by these actions.</p>
          </div>

          {actionFeedback ? (
            <div className={`mb-3 flex items-start gap-2 rounded-md px-2.5 py-2 text-[0.64rem] ${actionFeedback.tone === "success" ? "bg-success/8 text-success" : "bg-error/8 text-error"}`}>
              <Icon name={actionFeedback.tone === "success" ? "check_circle" : "error"} className="mt-0.5 text-sm" />
              <span>{actionFeedback.message}</span>
            </div>
          ) : null}

          <label className="mb-3 block">
            <span className="mb-1 block text-[0.56rem] font-semibold uppercase tracking-wider text-outline">Human note</span>
            <textarea
              value={actionNote}
              onChange={(event) => onNoteChange(event.target.value)}
              placeholder="Required for resolve or dismiss. Optional for review and reopen."
              className="min-h-20 w-full resize-y rounded-md border border-outline-variant/8 bg-surface-low/20 px-2.5 py-2 text-[0.68rem] text-on-surface-variant outline-none placeholder:text-outline focus:border-primary/25"
            />
          </label>

          <ActionGroup title="Primary">
            <ActionButton
              icon="rate_review"
              label="Start Review"
              disabledReason={reviewDisabledReason}
              loading={savingAction === "review"}
              tone="primary"
              onClick={() => onAction(item, "review")}
            />
            <ActionButton
              icon="task_alt"
              label="Resolve"
              disabledReason={resolveDisabledReason}
              loading={savingAction === "resolve"}
              tone="success"
              onClick={() => onAction(item, "resolve")}
            />
          </ActionGroup>

          <ActionGroup title="Secondary">
            <ActionButton
              icon="block"
              label="Dismiss"
              disabledReason={dismissDisabledReason}
              loading={savingAction === "dismiss"}
              tone="danger"
              onClick={() => onAction(item, "dismiss")}
            />
            <ActionButton
              icon="restart_alt"
              label="Reopen"
              disabledReason={reopenDisabledReason}
              loading={savingAction === "reopen"}
              tone="neutral"
              onClick={() => onAction(item, "reopen")}
            />
          </ActionGroup>

          <ActionGroup title="Escalation">
            <PlannedAction icon="priority_high" label="Escalate" reason="Escalation workflow not configured yet." />
            <PlannedAction icon="lock" label="Block" reason="Blocking is planned; current exception statuses do not support Blocked." />
          </ActionGroup>
        </DetailSection>

        <DetailSection title="Restricted Actions">
          <div className="space-y-1.5">
            {item.restrictedActions.map((action) => (
              <div key={action} className="flex items-start gap-2 rounded-md bg-error/5 px-2.5 py-1.5 text-[0.62rem] text-error">
                <Icon name="lock" className="mt-0.5 text-xs" />
                <span>{action}</span>
              </div>
            ))}
          </div>
        </DetailSection>

        <DetailSection title="Audit Timeline">
          <div className="space-y-2">
            {item.auditTimeline.map((event) => (
              <div key={event.id} className="rounded-md border border-outline-variant/6 bg-surface-high/10 px-2.5 py-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[0.65rem] font-medium text-on-surface-variant">{event.action}</p>
                  <p className="shrink-0 text-[0.56rem] text-outline">{formatDateTime(event.createdAt)}</p>
                </div>
                <p className="mt-1 text-[0.58rem] text-outline">
                  {event.actor}
                  {event.previousStatus || event.newStatus ? ` / ${event.previousStatus ?? "-"} -> ${event.newStatus ?? "-"}` : ""}
                </p>
                {event.note ? <p className="mt-1 text-[0.62rem] text-on-surface-variant">{event.note}</p> : null}
              </div>
            ))}
          </div>
        </DetailSection>
      </div>
    </aside>
  );
}

function SummaryCard({ label, value, icon, tone }: { label: string; value: number; icon: string; tone: "ok" | "warn" | "danger" | "neutral" }) {
  const toneClass = tone === "danger" ? "text-error bg-error/6 border-error/10" : tone === "warn" ? "text-warning bg-warning/6 border-warning/10" : tone === "ok" ? "text-success bg-success/6 border-success/10" : "text-on-surface bg-surface-container/50 border-outline-variant/6";
  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="truncate text-[0.58rem] font-semibold uppercase tracking-wider text-current/80">{label}</p>
        <Icon name={icon} className="text-sm" />
      </div>
      <p className="font-mono text-lg font-semibold">{value}</p>
    </div>
  );
}

function InfoCell({ label, sub, icon }: { label: string; sub: string; icon: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Icon name={icon} className="text-sm text-outline" />
      <div className="min-w-0">
        <p className="truncate text-[0.66rem] font-medium text-on-surface-variant">{label}</p>
        <p className="truncate text-[0.56rem] text-outline">{sub}</p>
      </div>
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <h4 className="mb-2 text-[0.58rem] font-semibold uppercase tracking-wider text-outline">{title}</h4>
      {children}
    </section>
  );
}

function Field({ label, value, tone = "normal" }: { label: string; value: string; tone?: "normal" | "danger" }) {
  return (
    <div className="rounded-md bg-surface-high/12 px-2.5 py-2">
      <p className="text-[0.54rem] uppercase tracking-wider text-outline">{label}</p>
      <p className={`mt-1 break-words text-[0.64rem] font-medium ${tone === "danger" ? "text-error" : "text-on-surface-variant"}`}>{value}</p>
    </div>
  );
}

function ActionGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <p className="mb-1.5 text-[0.54rem] font-semibold uppercase tracking-wider text-outline">{title}</p>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  disabledReason,
  loading,
  tone = "primary",
  onClick,
}: {
  icon: string;
  label: string;
  disabledReason?: string;
  loading?: boolean;
  tone?: "primary" | "success" | "danger" | "neutral";
  onClick?: () => void;
}) {
  const classes = tone === "success"
    ? "border-success/20 bg-success/10 text-success hover:bg-success/15"
    : tone === "danger"
      ? "border-error/18 bg-error/8 text-error hover:bg-error/12"
      : tone === "neutral"
        ? "border-outline-variant/10 bg-surface-high/20 text-on-surface-variant hover:bg-surface-high/35"
        : "border-primary/20 bg-primary/10 text-primary hover:bg-primary/15";
  const disabled = Boolean(disabledReason);
  return (
    <div>
      <button
        disabled={disabled}
        title={disabledReason}
        onClick={onClick}
        className={`inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[0.62rem] font-semibold transition-colors disabled:cursor-not-allowed disabled:border-outline-variant/8 disabled:bg-surface-high/10 disabled:text-outline disabled:opacity-75 ${classes}`}
      >
        <Icon name={loading ? "progress_activity" : icon} className={`text-sm ${loading ? "animate-spin" : ""}`} />
        {label}
      </button>
      {disabledReason ? <p className="mt-1 min-h-6 text-[0.54rem] leading-snug text-outline">{disabledReason}</p> : null}
    </div>
  );
}

function PlannedAction({ icon, label, reason }: { icon: string; label: string; reason: string }) {
  return (
    <div className="rounded-md border border-outline-variant/8 bg-surface-high/10 px-2.5 py-2 opacity-80" title={reason}>
      <div className="flex items-center gap-1.5 text-[0.62rem] font-semibold text-outline">
        <Icon name={icon} className="text-sm" />
        <span>{label}</span>
        <Icon name="lock" className="ml-auto text-xs" />
      </div>
      <p className="mt-1 text-[0.54rem] leading-snug text-outline">{reason}</p>
    </div>
  );
}

function EmptyState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center px-4 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-success/8">
        <Icon name="task_alt" className="text-lg text-success" />
      </div>
      <p className="mb-0.5 text-xs font-medium text-on-surface-variant">No exceptions match this queue</p>
      <p className="max-w-sm text-[0.65rem] text-outline">Human-intervention records from agents, finance controls, validation, backorders, and purchase-order review appear here.</p>
      <button onClick={onRetry} className="mt-3 rounded-md bg-primary/10 px-3 py-1.5 text-[0.65rem] font-medium text-primary hover:bg-primary/15">Retry</button>
    </div>
  );
}

function SeverityBadge({ value }: { value: string }) {
  return <MiniBadge value={value} tone={value === "Critical" || value === "High" ? "danger" : value === "Warning" || value === "Medium" ? "warn" : "neutral"} />;
}

function StatusBadge({ value }: { value: string }) {
  const tone = value === "Resolved" ? "success" : value === "Dismissed" ? "neutral" : value === "Reviewing" ? "warn" : "danger";
  return <MiniBadge value={value} tone={tone} />;
}

function SourceBadge({ mode }: { mode: DataSourceMode }) {
  const label = mode === "production" ? "Prisma" : mode === "demo" ? "Demo record" : "Mixed";
  return <MiniBadge value={label} tone={mode === "production" ? "success" : "warn"} />;
}

function MiniBadge({ value, tone }: { value: string; tone: "success" | "warn" | "danger" | "neutral" }) {
  const classes = tone === "success"
    ? "border-success/12 bg-success/8 text-success"
    : tone === "warn"
      ? "border-warning/12 bg-warning/8 text-warning"
      : tone === "danger"
        ? "border-error/12 bg-error/8 text-error"
        : "border-outline-variant/10 bg-surface-high/20 text-outline";
  return <span className={`inline-flex rounded border px-1.5 py-0.5 text-[0.54rem] font-semibold ${classes}`}>{value}</span>;
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-surface-high/20 px-1.5 py-1 text-[0.55rem] text-outline">
      <span>{label}</span>
      <span className="font-mono text-on-surface-variant">{value}</span>
    </span>
  );
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatMoney(value: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);
}

function workflowHint(status: string) {
  if (status === "Resolved") return "This exception is resolved. Reopen it before taking another workflow action.";
  if (status === "Dismissed") return "This exception is dismissed. Reopen it if it needs active review again.";
  if (status === "Reviewing") return "This exception is under human review. Resolve it with a note or dismiss it with a reason.";
  return "This exception is open. Start review, resolve with a note, or dismiss with a reason.";
}

function actionSuccessMessage(action: ExceptionAction) {
  const messages: Record<ExceptionAction, string> = {
    review: "Exception marked as Reviewing.",
    resolve: "Exception resolved and audit metadata recorded.",
    dismiss: "Exception dismissed with reason; the record was preserved.",
    reopen: "Exception reopened for active review.",
  };
  return messages[action];
}

function humanize(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
