"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { ImprovementModule } from "@/lib/improvements/registry";
import { EXPERIMENTS, defaultCandidate, type CandidateConfig } from "@/lib/improvements/experiments/catalog";
import { OutcomePanel, EvaluationResults, type ReviewedOutcome, type EvaluationRecord } from "./improvement-outcomes";

type Observation = { id: string; moduleKey: string; kind: string; summary: string; sourceId: string | null; sourceHash: string; actorId: string; createdAt: string; snapshot: unknown };
type Proposal = { id: string; moduleKey: string; title: string; hypothesis: string; candidate: string; evaluationPlan: string; successCriteria: string; stopCondition: string; status: string; revision: number; actorId: string; experimentKey: string | null; candidateConfig: CandidateConfig | null; evaluations: EvaluationRecord[]; outcomeLinks: { outcomeRevision: number; outcome: ReviewedOutcome }[]; evidence: { observation: Observation }[]; decisions: { id: string; action: string; reason: string; actorId: string; createdAt: string }[] };
type Snapshot = { modules: ImprovementModule[]; observations: Observation[]; proposals: Proposal[]; outcomes: ReviewedOutcome[]; sources: { id: string; label: string }[]; sourceLimit: number; totals: { observations: number; proposals: number }; limit: number; permissions: { contribute: boolean; review: boolean } };
const inputClass = "mt-1 w-full rounded-lg border border-outline-variant/30 bg-surface p-2 text-sm text-on-surface";
const buttonClass = "rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-40";
const panelClass = "rounded-xl border border-outline-variant/20 bg-surface-container-low p-4";
const statuses: Record<string, string> = { Proposed: "Awaiting review", ExperimentApproved: "Offline experiment approved", Rejected: "Rejected", Revoked: "Approval revoked" };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body.error?.message ?? "Request failed.");
  return body.data as T;
}

export function ImprovementCenter() {
  const [moduleKey, setModuleKey] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadedModule, setLoadedModule] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [benchmark, setBenchmark] = useState(false);
  const [candidateConfig, setCandidateConfig] = useState<CandidateConfig>({});
  const evaluationKeys = useRef<Record<string, string>>({});
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const generation = ++sequence.current;
    setLoading(true);
    try {
      const result = await api<Snapshot>(`/api/v1/improvements${moduleKey ? `?module=${encodeURIComponent(moduleKey)}` : ""}`);
      if (generation === sequence.current) { setSnapshot(result); setLoadedModule(moduleKey); setError(""); }
    } catch (failure) { if (generation === sequence.current) setError(failure instanceof Error ? failure.message : "Could not load improvements."); }
    finally { if (generation === sequence.current) setLoading(false); }
  }, [moduleKey]);
  useEffect(() => { const generation = sequence; void load(); return () => { generation.current++; }; }, [load]);
  const capability = snapshot?.modules.find(item => item.key === moduleKey);
  const experiment = EXPERIMENTS.find(entry => (entry.modules as readonly string[]).includes(moduleKey));
  const eligibleOutcomes = snapshot?.outcomes.filter(outcome => selected.includes(outcome.observationId) && outcome.status === "Confirmed") ?? [];
  const label = (key: string) => snapshot?.modules.find(item => item.key === key)?.label ?? key;

  async function mutate(body: Record<string, unknown>, method: "POST" | "PATCH", done?: () => void, subpath = ""): Promise<boolean> {
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/api/v1/improvements${subpath ? `/${subpath}` : ""}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      done?.(); setNotice("Saved. Business records and active rules are unchanged.");
      await load();
      return true;
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save."); return false; }
    finally { setBusy(false); }
  }
  function record(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const sourceId = String(values.get("sourceId") ?? "").trim();
    void mutate({ action: sourceId ? "capture" : "report", moduleKey, summary: values.get("summary"), ...(sourceId ? { sourceId } : {}) }, "POST", () => form.reset());
  }
  function propose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    void mutate({ ...Object.fromEntries(new FormData(form)), action: "propose", moduleKey, observationIds: selected, requestKey, ...(benchmark && experiment ? { experimentKey: experiment.key, candidateConfig, outcomeIds: eligibleOutcomes.slice(0, 20).map(outcome => outcome.id) } : {}) }, "POST", () => { form.reset(); setSelected([]); setBenchmark(false); setRequestKey(crypto.randomUUID()); });
  }
  return <section className="space-y-4" aria-label="Improvement Center">
    <div className={panelClass}>
      <h2 className="text-lg font-semibold">Improvement Center</h2>
      <p className="mt-1 text-sm text-on-surface-variant">Record reviewed outcomes and compare bounded candidates on frozen offline cases. Each run requires a separate human action after approval. Automatic learning and activation remain inactive.</p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="min-w-60 text-sm">Module
          <select aria-label="Improvement module" className={inputClass} value={moduleKey} disabled={busy} onChange={event => { setModuleKey(event.target.value); setSelected([]); setBenchmark(false); setRequestKey(crypto.randomUUID()); setNotice(""); }}>
            <option value="">All modules</option>
            {snapshot?.modules.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </label>
        <button className={buttonClass} type="button" onClick={() => void load()} disabled={loading || busy}>Refresh</button>
        {snapshot ? <p className="pb-2 text-sm text-on-surface-variant">{snapshot.modules.length} modules registered · {snapshot.modules.filter(item => item.connector).length} record connectors</p> : null}
      </div>
      {capability ? <div className="mt-3 space-y-1 text-sm">
        <p><strong>{capability.connector ? "Record capture available on request" : "Operator reports only; record connector pending"}</strong></p>
        <p>Objective: {capability.objective}</p><p>Required evaluation: {capability.evaluation}</p>
        <p className="text-on-surface-variant">Related workflows to assess: {capability.workflows.map(workflow => workflow.replaceAll("-", " ")).join(", ")}. These are test scope, not verified record links.</p>
      </div> : <p className="mt-3 text-sm text-on-surface-variant">Select a module to contribute evidence or propose an experiment.</p>}
    </div>
    {error ? <p role="alert" className="rounded-lg border border-error/30 p-3 text-sm text-error">{error}</p> : null}
    {notice ? <p role="status" className="text-sm text-primary">{notice}</p> : null}
    {loading ? <p role="status" className="text-sm">Loading scoped records…</p> : null}
    {snapshot && loadedModule === moduleKey ? <fieldset className="min-w-0 space-y-4" disabled={busy || loading}>
      {capability && snapshot.permissions.contribute ? <div key={moduleKey} className="grid gap-4 xl:grid-cols-2">
        <form className={panelClass} onSubmit={record}>
          <h3 className="font-semibold">Record evidence</h3>
          <label className="mt-3 block text-sm">Observation or correction
            <textarea name="summary" aria-label="Evidence summary" required maxLength={1200} rows={3} className={inputClass} />
          </label>
          {capability.connector ? <label className="mt-3 block text-sm">Source record (optional)
            <select name="sourceId" aria-label="Evidence source record" className={inputClass}>
              <option value="">Operator report (no record)</option>
              {snapshot.sources.map(source => <option key={source.id} value={source.id}>{source.label}</option>)}
            </select>
            <span className="mt-1 block text-xs text-on-surface-variant">{snapshot.sources.length ? `Latest ${snapshot.sourceLimit} permitted records, where available.` : "No eligible records available. You can still save an operator report."}</span>
          </label> : null}
          <p className="my-3 text-xs text-on-surface-variant">{capability.connector ? "Selecting a record captures its permitted fields and revision. Otherwise this is an operator report. Neither is a verified business outcome." : "This is an operator report, pending verification against source evidence."}</p>
          <button className={buttonClass} disabled={busy}>Save evidence</button>
        </form>
        <form className={panelClass} onSubmit={propose}>
          <h3 className="font-semibold">Propose an experiment</h3>
          <p className="mt-1 text-xs text-on-surface-variant">Select supporting evidence below. Proposals are immutable; a changed candidate needs a new proposal and review.</p>
          {([ ["title", "Title", 160], ["hypothesis", "Expected benefit", 2000], ["candidate", "Candidate change", 2000], ["evaluationPlan", "Evaluation plan and baseline", 2000], ["successCriteria", "Success criteria", 2000], ["stopCondition", "Stop condition", 2000] ] as const).map(([name, title, max]) => <label key={name} className="mt-2 block text-sm">{title}
            <textarea name={name} aria-label={title} required maxLength={max} rows={name === "title" ? 1 : 2} className={inputClass} />
          </label>)}
          {experiment ? <div className="mt-3 text-sm"><label className="flex gap-2"><input type="checkbox" aria-label="Attach frozen reference benchmark" checked={benchmark} onChange={event => { setBenchmark(event.target.checked); setCandidateConfig(defaultCandidate(experiment.key)); }} />Attach frozen reference benchmark</label>
            {benchmark ? <div className="mt-2 space-y-2"><p>{experiment.label}</p><p className="text-xs">10 synthetic reference cases; zero provider cost. These strategies are prototypes, not the installed module algorithms.</p>
              {experiment.flags.map(flag => <label key={flag} className="flex gap-2 text-xs"><input type="checkbox" checked={candidateConfig[flag] ?? false} onChange={event => setCandidateConfig(value => ({ ...value, [flag]: event.target.checked }))} />{flag.replace(/([A-Z])/g, " $1").toLowerCase()}</label>)}
              <p className="text-xs">{eligibleOutcomes.length} confirmed outcomes linked to selected evidence. At least one is required. Outcomes justify the proposal; the frozen benchmark does not replay their text.</p>
            </div> : null}
          </div> : null}
          <p className="my-3 text-xs">{selected.length} evidence records selected (maximum 20)</p>
          <button className={buttonClass} disabled={busy || selected.length === 0 || (benchmark && eligibleOutcomes.length === 0)}>Submit proposal</button>
        </form>
      </div> : null}
      <div className="grid gap-4 xl:grid-cols-2">
        <div className={panelClass}>
          <h3 className="font-semibold">Evidence ({snapshot.totals.observations})</h3>
          {snapshot.totals.observations > snapshot.limit ? <p className="text-xs">Showing the latest {snapshot.limit}. Select a module to narrow the list.</p> : null}
          {!snapshot.observations.length ? <p className="mt-3 text-sm text-on-surface-variant">No evidence recorded in this scope.</p> : null}
          <div className="mt-3 space-y-3">{snapshot.observations.map(item => <article key={item.id} className="rounded-lg border border-outline-variant/20 p-3">
            <div className="flex items-start gap-2">
              {capability && snapshot.permissions.contribute ? <input type="checkbox" aria-label={`Select evidence: ${item.summary}`} checked={selected.includes(item.id)} disabled={busy || (!selected.includes(item.id) && selected.length >= 20)} onChange={event => setSelected(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} className="mt-1" /> : null}
              <p className="whitespace-pre-wrap break-words text-sm">{item.summary}</p>
            </div>
            <p className="mt-2 text-xs text-on-surface-variant">{label(item.moduleKey)} · {item.kind === "record_snapshot" ? "Record snapshot; outcome unverified" : "Operator report; unverified"} · {new Date(item.createdAt).toLocaleString()}</p>
            <details className="mt-2 text-xs"><summary className="cursor-pointer">Provenance and captured fields</summary>
              <p className="mt-2 break-all">Actor: {item.actorId}<br />Source: {item.sourceId ?? "Operator report"}<br />SHA-256: {item.sourceHash}</p>
              <pre className="mt-2 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(item.snapshot, null, 2)}</pre>
            </details>
            {item.kind === "record_snapshot" ? <OutcomePanel observationId={item.id} outcomes={snapshot.outcomes.filter(outcome => outcome.observationId === item.id)} contribute={snapshot.permissions.contribute} review={snapshot.permissions.review} send={(path, body, method) => mutate(body, method, undefined, path)} /> : null}
          </article>)}</div>
        </div>
        <div className={panelClass}>
          <h3 className="font-semibold">Proposals ({snapshot.totals.proposals})</h3>
          {snapshot.totals.proposals > snapshot.limit ? <p className="text-xs">Showing the latest {snapshot.limit}. Select a module to narrow the list.</p> : null}
          {!snapshot.proposals.length ? <p className="mt-3 text-sm text-on-surface-variant">No proposals submitted in this scope.</p> : null}
          <div className="mt-3 space-y-3">{snapshot.proposals.map(proposal => <article key={proposal.id} className="rounded-lg border border-outline-variant/20 p-3">
            <h4 className="break-words font-medium">{proposal.title}</h4>
            <p className="mt-1 text-xs text-primary">{label(proposal.moduleKey)} · {statuses[proposal.status] ?? proposal.status} · Revision {proposal.revision}</p>
            <details className="mt-3 text-sm"><summary className="cursor-pointer">Review candidate and evidence</summary>
              <dl className="mt-2 space-y-2">{[["Expected benefit", proposal.hypothesis], ["Candidate", proposal.candidate], ["Evaluation plan", proposal.evaluationPlan], ["Success criteria", proposal.successCriteria], ["Stop condition", proposal.stopCondition]].map(([title, value]) => <div key={title}><dt className="font-medium">{title}</dt><dd className="whitespace-pre-wrap break-words">{value}</dd></div>)}</dl>
              <p className="mt-3 text-xs">Submitted by {proposal.actorId}. {proposal.evaluations.length} evaluation results recorded.</p>
              {proposal.experimentKey ? <p className="mt-2 text-xs">Frozen candidate flags: {Object.entries(proposal.candidateConfig ?? {}).map(([key, value]) => `${key.replace(/([A-Z])/g, " $1").toLowerCase()}: ${value ? "on" : "off"}`).join("; ")}</p> : null}
              {proposal.outcomeLinks.map(link => <p key={link.outcome.id} className="mt-2 text-xs">Linked outcome: {link.outcome.finding} · reviewed revision {link.outcomeRevision} · currently {link.outcome.status}. {link.outcome.expected} / {link.outcome.actual}</p>)}
              {proposal.evidence.map(({ observation }) => <div key={observation.id} className="mt-2 text-xs"><p>{observation.summary}</p><p className="break-all">{observation.kind === "record_snapshot" ? "Record snapshot" : "Unverified report"}: {observation.sourceId ?? observation.id} · {observation.sourceHash}</p><pre className="overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(observation.snapshot, null, 2)}</pre></div>)}
            </details>
            {proposal.decisions.map(decision => <p key={decision.id} className="mt-3 break-words text-xs text-on-surface-variant">{decision.action.replaceAll("_", " ")} by {decision.actorId} · {new Date(decision.createdAt).toLocaleString()}: {decision.reason}</p>)}
            {snapshot.permissions.review && ["Proposed", "ExperimentApproved"].includes(proposal.status) ? <form className="mt-3" onSubmit={event => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void mutate({ id: proposal.id, revision: proposal.revision, action: data.get("action"), reason: data.get("reason") }, "PATCH");
            }}>
              <label className="text-sm">Review decision
                <select name="action" aria-label={`Decision for ${proposal.title}`} className={inputClass}>{proposal.status === "Proposed" ? <><option value="approve_experiment">Approve offline experiment</option><option value="reject">Reject proposal</option></> : <option value="revoke">Revoke experiment approval</option>}</select>
              </label>
              <label className="mt-2 block text-sm">Reason
                <textarea name="reason" aria-label={`Review reason for ${proposal.title}`} required maxLength={1200} rows={2} className={inputClass} />
              </label>
              <p className="my-2 text-xs text-on-surface-variant">Approval covers offline preparation only. It does not authorize provider spending, business actions or release installation.</p>
              <button className={buttonClass} disabled={busy}>Save review</button>
            </form> : null}
            {snapshot.permissions.review && proposal.status === "ExperimentApproved" && proposal.experimentKey ? <button type="button" className={`${buttonClass} mt-3`} disabled={busy || proposal.outcomeLinks.some(link => link.outcome.status !== "Confirmed" || link.outcome.revision !== link.outcomeRevision)} onClick={() => {
              const key = evaluationKeys.current[proposal.id] ??= crypto.randomUUID();
              void mutate({ proposalId: proposal.id, revision: proposal.revision, requestKey: key }, "POST", () => { delete evaluationKeys.current[proposal.id]; }, "evaluations");
            }}>Run frozen offline benchmark</button> : null}
            <EvaluationResults records={proposal.evaluations} />
          </article>)}</div>
        </div>
      </div>
    </fieldset> : null}
  </section>;
}
