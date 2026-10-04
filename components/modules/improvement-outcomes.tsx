"use client";
import { useState } from "react";
export type ReviewedOutcome = { id: string; observationId: string; finding: string; expected: string; actual: string; basis: string; status: string; revision: number; actorId: string; reviews: { id: string; action: string; reason: string; actorId: string; createdAt: string }[] };
export type EvaluationRecord = { id: string; createdAt: string; evaluatorVersion: string; softwareVersion: string; policyVersion: string; suiteHash: string; configurationHash: string; actorId: string; result: { total: number; baselinePassed: number; candidatePassed: number; criticalFailures: number; regressions: number; gate: string; limitations: string; cases: { id: string; expected: string; baselineResult: string; candidateResult: string; candidatePassed: boolean; reason: string }[] } };
type Send = (path: string, body: Record<string, unknown>, method: "POST" | "PATCH") => Promise<boolean>;
const input = "mt-1 w-full rounded-lg border border-outline-variant/30 bg-surface p-2 text-sm";
const button = "rounded-lg bg-primary px-3 py-2 text-sm text-on-primary disabled:opacity-40";

export function OutcomePanel({ observationId, outcomes, contribute, review, send }: { observationId: string; outcomes: ReviewedOutcome[]; contribute: boolean; review: boolean; send: Send }) {
  const [key, setKey] = useState(() => crypto.randomUUID());
  return <div className="mt-3 space-y-3 border-t border-outline-variant/20 pt-3">
    {outcomes.map(outcome => <div key={outcome.id} className="space-y-2 text-xs">
      <p className="font-medium">Outcome: {outcome.finding} · {outcome.status === "Confirmed" ? "Reviewer confirmed" : outcome.status} · Revision {outcome.revision}</p>
      <p>Expected: {outcome.expected}</p><p>Observed: {outcome.actual}</p><p>Verification basis: {outcome.basis}</p>
      <p>Submitted by {outcome.actorId}</p>
      {outcome.reviews.map(entry => <p key={entry.id} className="text-on-surface-variant">{entry.action} by {entry.actorId} · {new Date(entry.createdAt).toLocaleString()}: {entry.reason}</p>)}
      {review && ["Pending", "Confirmed"].includes(outcome.status) ? <form onSubmit={async event => {
        event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form));
        if (await send("outcomes", { ...values, id: outcome.id, revision: outcome.revision }, "PATCH")) form.reset();
      }}>
        <label>Outcome decision<select aria-label={`Outcome decision ${outcome.id}`} name="action" className={input}>{outcome.status === "Pending" ? <><option value="confirm">Confirm reviewed outcome</option><option value="reject">Reject outcome</option></> : <option value="revoke">Revoke outcome confirmation</option>}</select></label>
        <label className="mt-2 block">Review reason<textarea aria-label={`Outcome review reason ${outcome.id}`} name="reason" required maxLength={1200} className={input} rows={2} /></label>
        <p className="my-2 text-on-surface-variant">Confirm only after checking the stated result against the source. Confirmation records your judgement; it is not an automatic truth check.</p>
        <button className={button}>Save outcome review</button>
      </form> : null}
    </div>)}
    {contribute ? <details className="text-sm"><summary className="cursor-pointer">Record an outcome</summary>
      <form className="mt-2" onSubmit={async event => {
        event.preventDefault(); const form = event.currentTarget;
        if (await send("outcomes", { ...Object.fromEntries(new FormData(form)), observationId, requestKey: key }, "POST")) { form.reset(); setKey(crypto.randomUUID()); }
      }}>
        <label>Finding<select name="finding" className={input}><option>Useful</option><option>Incorrect</option><option>Inconclusive</option></select></label>
        {[["expected", "Expected result"], ["actual", "Observed result"], ["basis", "Source and verification basis"]].map(([name, label]) => <label key={name} className="mt-2 block">{label}<textarea aria-label={label} name={name} required maxLength={2000} className={input} rows={2} /></label>)}
        <p className="my-2 text-xs text-on-surface-variant">Saved as pending review. A changed source requires a fresh snapshot.</p>
        <button className={button}>Save outcome</button>
      </form>
    </details> : null}
  </div>;
}

export function EvaluationResults({ records }: { records: EvaluationRecord[] }) {
  return <div className="mt-3 space-y-3">{records.map(record => <details key={record.id} className="rounded-lg border border-outline-variant/20 p-3 text-sm" open>
    <summary className="cursor-pointer font-medium">{record.result.gate === "BenchmarkPassed" ? "Reference benchmark passed" : "Reference benchmark rejected"} · {new Date(record.createdAt).toLocaleString()}</summary>
    <table className="mt-2 w-full text-left text-xs"><caption className="py-2 text-left">Synthetic reference cases; this is not a comparison against installed Nautex.</caption><thead><tr><th>Reference baseline</th><th>Candidate</th><th>Regressions</th><th>Critical failures</th></tr></thead><tbody><tr><td>{record.result.baselinePassed}/{record.result.total}</td><td>{record.result.candidatePassed}/{record.result.total}</td><td>{record.result.regressions}</td><td>{record.result.criticalFailures}</td></tr></tbody></table>
    <p className="mt-2 text-xs text-on-surface-variant">{record.result.limitations}</p>
    <details className="mt-2 text-xs"><summary>Case results and provenance</summary>
      <p className="my-2 break-all">Evaluator {record.evaluatorVersion} · Software {record.softwareVersion} · Policy {record.policyVersion}<br />Suite SHA-256: {record.suiteHash}<br />Configuration SHA-256: {record.configurationHash}<br />Run by {record.actorId}</p>
      {record.result.cases.map(row => <p key={row.id} className="mt-2 break-words">{row.candidatePassed ? "PASS" : "FAIL"} {row.id}: expected {row.expected}, baseline {row.baselineResult}, candidate {row.candidateResult}. {row.reason}</p>)}
    </details>
    <p className="mt-2 text-xs">Historical result. Source freshness and authorization were checked at run time. This result cannot activate a change.</p>
  </details>)}</div>;
}
