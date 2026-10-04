"use client";
import { useCallback, useEffect, useState } from "react";
import type { AgentAction } from "@/lib/agents/capabilities";
import { AgentSchedules } from "./agent-schedules";
import { MailboxReplyReview } from "./mailbox-reply-review";

type Control = { id: string; enabled: boolean; revision: number; available: boolean; actions: (AgentAction & { ready: boolean; permitted: boolean })[] };
type Controls = { currentUserId: string; canManage: boolean; policy: string; provider: { configured: boolean; name: string; model: string | null; fastModel: string | null; reasoningModel: string | null }; agents: Control[] };
type Run = { id: string; agent: string; status: string; startedAt: string; requestedBy: string; tasks: { action: string; input: Record<string, string>; output: unknown; error: string | null; provider: string | null; model: string | null }[] };
const button = "rounded-md bg-primary/10 px-4 py-2 text-sm font-semibold text-primary disabled:opacity-40 disabled:cursor-not-allowed";
async function request(url: string, method = "GET", body?: unknown) {
  const response = await fetch(url, { method, cache: "no-store", ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok || result.ok === false) throw new Error(result.error?.message ?? "Request failed.");
  return result.data;
}
export function AgentControls({ agentId, agentName, onChanged }: { agentId: string; agentName: string; onChanged: () => void }) {
  const [controls, setControls] = useState<Controls | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [actionId, setActionId] = useState("");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const [nextControls, nextRuns] = await Promise.all([request("/api/v1/agents/controls"), request("/api/v1/agents/execute")]);
      setControls(nextControls); setRuns(nextRuns);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Controls are unavailable."); }
  }, []);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 3000); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => { setActionId(""); setInputs({}); setError(""); setExpanded(null); }, [agentId]);
  const control = controls?.agents.find(agent => agent.id === agentId);
  const action = control?.actions.find(item => item.action === actionId) ?? control?.actions[0];
  const recent = runs.filter(run => run.agent === agentId);
  async function change(enabled: boolean) {
    if (!control) return;
    setBusy(true); setError("");
    try { await request("/api/v1/agents/controls", "PATCH", { agentId, enabled, revision: control.revision }); await refresh(); onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Control change failed."); await refresh(); }
    finally { setBusy(false); }
  }
  async function run(retry?: Run) {
    if (!action && !retry) return;
    setBusy(true); setError("");
    try {
      const result: Run = await request("/api/v1/agents/execute", "POST", { agentId, action: retry?.tasks[0]?.action ?? action!.action, params: retry?.tasks[0]?.input ?? inputs, requestKey: crypto.randomUUID(), ...(retry ? { retryOfId: retry.id } : {}) });
      setExpanded(result.id); await refresh(); onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Execution failed."); }
    finally { setBusy(false); }
  }
  async function cancel(id: string) {
    setError("");
    try { await request("/api/v1/agents/execute", "PATCH", { id }); await refresh(); onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Cancellation failed."); }
  }
  return <section className="mb-4 rounded-lg bg-surface-container/50 p-4 ghost-border" aria-label="Agent execution controls">
    <p className="mb-1 text-sm text-outline">Execution controls</p>
    <h3 className="text-lg font-semibold text-primary">{agentName}</h3>
    {error && <p role="alert" className="my-3 text-sm text-error">{error}</p>}
    {!controls || !control ? <p className="my-3 text-sm text-outline">Loading controls…</p> : <>
      <p className="my-3 text-sm text-on-surface-variant">{controls.policy}</p>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <strong className="text-sm">{!control.available ? "Unavailable · workflow not implemented" : control.enabled ? "Enabled · manual or scheduled work allowed" : "Disabled · new work blocked"}</strong>
        {control.available && <button className={button} disabled={!controls.canManage || busy} onClick={() => void change(!control.enabled)}>{control.enabled ? "Disable agent" : "Enable agent"}</button>}
      </div>
      {!controls.canManage && <p className="mb-3 text-sm text-outline">Only authorized human reviewers can enable or disable agents.</p>}
      <p className="mb-3 text-sm text-outline">Configured AI provider: <strong>{controls.provider.configured ? `${controls.provider.name} · ${controls.provider.model}` : "None"}</strong>. Local actions use Nautex rules or stored catalogue records. Actual provider and model appear with each result.</p>
      {agentId === "command_router" && <p className="text-sm">Start routing through <a className="text-primary underline" href="#dashboard">Command Center</a> or Ask Nautex. The destination agent must also be enabled. Routing does not approve or apply recommendations.</p>}
      {agentId === "agreement_comparison" && <p className="text-sm">Open <a className="text-primary underline" href="#contracts">Agreements</a>, select a supplier agreement, and use Comparisons to upload the new CSV or spreadsheet. The server enforces this control before starting a comparison.</p>}
      {agentId === "nautex_po_intake" && <p className="text-sm">Open <a className="text-primary underline" href="#purchaseOrders">Purchase Orders</a> and choose Process PO File. This control also governs reprocessing an existing order upload. Manual entry is independent.</p>}
      {action && <form className="space-y-3" onSubmit={event => { event.preventDefault(); void run(); }}>
        <label className="block text-sm">Action<select aria-label="Agent action" value={action.action} onChange={event => { setActionId(event.target.value); setInputs({}); }} className="mt-1 block w-full rounded bg-surface-high p-2 text-sm">
          {control.actions.map(item => <option key={item.action} value={item.action}>{item.label}</option>)}
        </select></label>
        <p className="text-sm text-outline">{action.mode === "mailbox" ? "Reads metadata from the configured Microsoft mailbox · no AI provider call" : action.mode === "local" ? "Local processing · no AI provider call" : action.mode === "provider" ? "Uses the configured AI provider" : "Uses local data when applicable; may use the configured AI provider"}. Result is a reviewable preview. Use the linked module to save business records.</p>
        {action.fields.map(field => <label className="block text-sm" key={field.key}>{field.label}<textarea aria-label={field.label} required maxLength={field.maxLength} value={inputs[field.key] ?? ""} onChange={event => setInputs(current => ({ ...current, [field.key]: event.target.value }))} rows={field.key === "id" ? 1 : 3} className="mt-1 block w-full rounded bg-surface-high p-3 text-sm" /></label>)}
        {!action.ready && <p className="text-sm text-amber-400">{action.mode === "mailbox" ? "Connect and enable a Microsoft mailbox in Settings before running this action." : "Connect an AI provider in Settings before running this action."}</p>}
        {!action.permitted && <p className="text-sm text-outline">Your role does not permit this action.</p>}
        <button type="submit" className={button} disabled={busy || !control.enabled || !action.permitted || !action.ready || recent.some(run => run.status === "Running")}>{busy ? "Working…" : "Run preview"}</button>
      </form>}
      <AgentSchedules agentId={agentId} action={action} inputs={inputs} canManage={controls.canManage} />
      <h4 className="mb-2 mt-5 text-sm font-semibold">Monitor execution history</h4>
      {recent.length === 0 && <p className="text-sm text-outline">No monitor runs yet. Module and command history appears in Runs.</p>}
      {recent.slice(0, 8).map(item => <div key={item.id} className="mt-2 rounded border border-outline/20 p-3">
        <div className="flex flex-wrap items-center gap-2 text-sm"><strong>{item.status}</strong><span>{item.tasks[0]?.action.replaceAll("_", " ")}</span><span className="text-outline">{new Date(item.startedAt).toLocaleString()}</span></div>
        <div className="my-2 flex flex-wrap gap-2">
          <button className={button} onClick={() => setExpanded(expanded === item.id ? null : item.id)}>{expanded === item.id ? "Hide result" : "View result"}</button>
          {item.status === "Running" && <button className={button} disabled={!controls.canManage && !(item.requestedBy === controls.currentUserId && control.actions.find(a => a.action === item.tasks[0]?.action)?.permitted)} onClick={() => void cancel(item.id)}>Cancel run</button>}
          {["Failed", "Cancelled"].includes(item.status) && <button className={button} disabled={busy || !control.enabled || !control.actions.find(a => a.action === item.tasks[0]?.action)?.permitted} onClick={() => void run(item)}>Retry run</button>}
        </div>
        {expanded === item.id && <div className="text-sm"><p>Execution: {item.tasks[0]?.provider ?? "Not recorded"} · {item.tasks[0]?.model ?? "No model result"}</p>{item.tasks[0]?.error && <p className="my-2 text-error">{item.tasks[0].error}</p>}{item.tasks[0]?.action === "check_supplier_mailbox" && <MailboxReplyReview runId={item.id} output={item.tasks[0]?.output} />}<pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-surface-lowest p-3 text-sm">{JSON.stringify(item.tasks[0]?.output ?? item.tasks[0]?.input, null, 2)}</pre></div>}
      </div>)}
    </>}
  </section>;
}
