"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { JevAdvice, JevKind, JevStatus } from "@/lib/ai/jev-contract";
export function JevReviewPanel({ kind, recordId, requirement: initial = "" }: { kind: JevKind; recordId: string; requirement?: string }) {
  const requirementId = useId();
  const [status, setStatus] = useState<(JevStatus & { canReview: boolean }) | null>(null);
  const [requirement, setRequirement] = useState(initial), [unit, setUnit] = useState(""), [code, setCode] = useState(""), [port, setPort] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [advice, setAdvice] = useState<JevAdvice | null>(null);
  const running = useRef(false), controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const control = new AbortController();
    fetch("/api/v1/jev/review", { cache: "no-store", signal: control.signal }).then(async r => { const p = await r.json(); if (!r.ok || !p.ok) throw new Error(p.error?.message || "Jev status unavailable."); setStatus(p.data); }).catch(e => { if (!control.signal.aborted) setError(e.message); });
    return () => { control.abort(); controller.current?.abort(); };
  }, []);
  const invalidate = () => { setAdvice(null); setError(""); };
  async function review() {
    if (running.current) return; running.current = true; setBusy(true); setError(""); setAdvice(null);
    const control = new AbortController(); controller.current = control;
    try {
      const r = await fetch("/api/v1/jev/review", { method: "POST", headers: { "Content-Type": "application/json" }, signal: control.signal,
        body: JSON.stringify({ kind, recordId, requirement, expectedUnit: unit, exactCode: code, requiredPort: port, requestKey: crypto.randomUUID() }) });
      const p = await r.json(); if (!r.ok || !p.ok) throw new Error(p.error?.message || "Jev review unavailable. Ordinary search remains available.");
      setAdvice(p.data);
    } catch (e) { if (!control.signal.aborted) setError(e instanceof Error ? e.message : "Jev review unavailable."); }
    finally { running.current = false; setBusy(false); }
  }
  return <section aria-label="Jev candidate review" className="rounded-xl border border-outline-variant/25 bg-surface-lowest p-4 space-y-3 text-sm">
    <h4 className="text-base font-semibold">Jev candidate review</h4>
    <p className="text-on-surface-variant">Checks this record against your requirement. Specifications, availability, prices and delivery still need your verification.</p>
    {!status?.enabled ? <p>{status ? "Jev is off. An administrator can enable it in Settings." : "Checking Jev availability…"}</p> : <>
      <div><label htmlFor={requirementId} className="block">Requirement</label><textarea id={requirementId} disabled={busy} value={requirement} maxLength={1000} onChange={e => { setRequirement(e.target.value); invalidate(); }} className="mt-1 w-full rounded border border-outline-variant/30 bg-surface-container p-2.5" rows={3} /></div>
      {kind !== "supplier" ? <div className="grid gap-3 sm:grid-cols-2">
        <label>Required unit code<input disabled={busy} value={unit} maxLength={24} onChange={e => { setUnit(e.target.value); invalidate(); }} placeholder="EA, M, BOX…" className="mt-1 w-full rounded border border-outline-variant/30 bg-surface-container p-2.5" /></label>
        <label>Exact required code (optional)<input disabled={busy} value={code} maxLength={80} onChange={e => { setCode(e.target.value); invalidate(); }} className="mt-1 w-full rounded border border-outline-variant/30 bg-surface-container p-2.5" /></label>
      </div> : <label className="block">Required port (optional)<input disabled={busy} value={port} maxLength={80} onChange={e => { setPort(e.target.value); invalidate(); }} className="mt-1 w-full rounded border border-outline-variant/30 bg-surface-container p-2.5" /></label>}
      <p className="text-on-surface-variant">This sends your requirement and selected record fields to TypeSafe. Avoid personal or payment details. One request may incur a charge.</p>
      <button disabled={busy || !status.canReview || requirement.trim().length < 5 || (kind !== "supplier" && !unit.trim())} onClick={review} className="rounded bg-success/15 px-4 py-2.5 font-semibold text-success disabled:opacity-50">{busy ? "Reviewing with Jev…" : "Review with Jev"}</button>
      {!status.canReview && <p>Write access is required to request a review.</p>}
    </>}
    {error && <p role="alert" className="text-warning">{error}</p>}
    {advice && <div role="status" className="space-y-2 border-t border-outline-variant/20 pt-3">
      <p className="font-semibold">{advice.status === "completed" ? advice.decision === "potential_match" ? "Possible match — human review required" : advice.decision === "not_match" ? "Possible mismatch — check the source" : "Insufficient evidence" : advice.status === "blocked" ? "Record check blocked the request" : "Review unavailable"}</p>
      <p>{advice.message}</p>
      {advice.confidence !== undefined && <p>Model confidence: {Math.round(advice.confidence * 100)}% · This is not an accuracy guarantee.</p>}
      <p className="text-on-surface-variant">{advice.model} · Checked {new Date(advice.sourceCheckedAt).toLocaleTimeString()} · Advice only; no records changed.</p>
    </div>}
  </section>;
}
