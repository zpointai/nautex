"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { navigationHash } from "@/lib/client/navigation";

type Correction = {
  id: string; originalQuery: string; supplierId: string; expectedName: string; reason: string;
  originalOutput: { id: string; name: string }[]; status: string; active: boolean; revision: number;
  sourceCurrent: boolean; reviewedBy: string | null; reviewedAt: string | null;
  evaluation: null | { passed: boolean; cases: { baselineTop: string | null; candidateTop: string | null; expectedSupplierId: string }[] };
};
type Data = { records: Correction[]; suppliers: { id: string; name: string; supplierCode: string }[]; canManage: boolean; canCreate: boolean };
const field = "w-full rounded-lg border border-outline-variant/30 bg-surface-lowest p-3 text-sm text-on-surface focus:outline-2 focus:outline-primary";
const button = "rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-medium text-primary disabled:opacity-40";

export function LearningCorrections({ onChanged }: { onChanged: () => Promise<void> }) {
  const [data, setData] = useState<Data | null>(null);
  const [query, setQuery] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [reason, setReason] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const captureRequest = useRef({ payload: "", key: "" });
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/v1/agents/learning?search=${encodeURIComponent(search)}`, { signal });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error?.message ?? "Could not load corrections.");
    if (!signal?.aborted) setData(result.data);
  }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => { void load(controller.signal).catch(error => { if (!controller.signal.aborted) setError(error.message); }); }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [load]);
  async function save() {
    setBusy(true); setError(""); setNotice("");
    try {
      const payload = JSON.stringify({ query, supplierId, reason });
      if (captureRequest.current.payload !== payload) captureRequest.current = { payload, key: crypto.randomUUID() };
      const response = await fetch("/api/v1/agents/learning", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, supplierId, reason, requestKey: captureRequest.current.key }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error?.message ?? "Could not save correction.");
      setQuery(""); setReason(""); captureRequest.current = { payload: "", key: "" };
      setNotice("Correction saved for review. Search behavior has not changed.");
      await load();
      await onChanged();
    } catch (error) { setError(error instanceof Error ? error.message : "Save failed. Your input is retained."); }
    finally { setBusy(false); }
  }
  async function review(record: Correction, action: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/v1/agents/learning", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: record.id, revision: record.revision, action }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error?.message ?? "Review failed.");
      const messages: Record<string, string> = { approve: "Correction approved. Evaluate it before activation.", reject: "Correction rejected.", evaluate: "Correction evaluated against the recorded supplier search.", activate: "Reviewed alias activated.", deactivate: "Alias deactivated. Normal recorded-supplier search is restored.", revoke: "Approval revoked. This alias will not be reused." };
      setNotice(messages[action]);
      await load();
      await onChanged();
    } catch (error) { setError(error instanceof Error ? error.message : "Review failed."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4 rounded-xl border border-outline-variant/20 bg-surface-container p-5">
    <div><h2 className="text-lg font-bold text-on-surface">Reviewed supplier corrections</h2><p className="mt-2 text-sm text-outline">Capture a supplier query and the verified supplier it should find. Approval, evaluation and activation are separate actions. An active exact alias is used by Find recorded suppliers; it does not send RFQs or change orders.</p></div>
    {error && <div role="alert" className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">{error} <button className={button} onClick={() => { setError(""); void load().catch(error => setError(error.message)); }}>Refresh corrections</button></div>}
    {notice && <p role="status" className="rounded-lg bg-success/10 p-3 text-sm text-success">{notice}</p>}
    {!data && !error && <p role="status">Loading reviewed corrections…</p>}
    {data?.canCreate && <form onSubmit={event => { event.preventDefault(); void save(); }} className="grid items-start gap-4 lg:grid-cols-2">
      <div className="space-y-2 text-sm"><label htmlFor="learning-query">Supplier query to correct</label><input id="learning-query" className={field} required maxLength={200} value={query} onChange={event => setQuery(event.target.value)} placeholder="The exact name or alias used in a search" /></div>
      <div className="space-y-2 text-sm"><label htmlFor="learning-search">Find supporting supplier</label><input id="learning-search" className={field} value={search} onChange={event => { setSearch(event.target.value); setSupplierId(""); }} placeholder="Filter suppliers by registered name" /><label htmlFor="learning-supplier">Expected supplier</label><select id="learning-supplier" className={field} required value={supplierId} onChange={event => setSupplierId(event.target.value)}><option value="">Select an active supplier</option>{data.suppliers.map(row => <option key={row.id} value={row.id}>{row.name} ({row.supplierCode})</option>)}</select></div>
      <div className="space-y-2 text-sm lg:col-span-2"><label htmlFor="learning-reason">Verification basis</label><textarea id="learning-reason" className={field} required minLength={10} maxLength={2000} rows={2} value={reason} onChange={event => setReason(event.target.value)} placeholder="Explain how the supplier identity was checked against the supporting record." /></div>
      <button className={`${button} justify-self-start`} disabled={busy || !supplierId}>Save correction for review</button>
    </form>}
    {data && !data.records.length && <p className="rounded-lg bg-surface-lowest p-4 text-sm text-outline">No scoped corrections yet. Historical feedback without confirmed organization ownership is excluded.</p>}
    {data?.records.map(record => <article key={record.id} className="space-y-3 rounded-lg border border-outline-variant/20 bg-surface-lowest p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-base font-semibold text-on-surface">{record.originalQuery} → {record.expectedName}</h3><span className="text-sm text-primary">{record.status} · {record.active ? "Active alias" : "Inactive"} · revision {record.revision}</span></div>
      <p className="text-sm text-outline">Original search: {record.originalOutput.map(row => row.name).join(", ") || "No supplier matched"}</p>
      <p className="text-sm text-on-surface">{record.reason}</p>
      <a className="inline-block text-sm text-primary underline" href={navigationHash({ moduleKey: "suppliers", id: record.supplierId })}>Open supporting supplier record</a>
      {!record.sourceCurrent && <p className="text-sm text-warning">Source changed. This alias will not be reused; capture a new correction for review.</p>}
      {record.reviewedAt && <p className="text-sm text-outline">Reviewed {new Date(record.reviewedAt).toLocaleString()} · reviewer {record.reviewedBy}</p>}
      {record.evaluation && <p className="text-sm text-outline">Exact alias, case and spacing checks: baseline {record.evaluation.cases.filter(row => row.baselineTop === row.expectedSupplierId).length}/{record.evaluation.cases.length}; candidate {record.evaluation.cases.filter(row => row.candidateTop === row.expectedSupplierId).length}/{record.evaluation.cases.length}. This verifies this correction, not general search accuracy.</p>}
      {data.canManage && <div className="flex flex-wrap gap-2">
        {record.status === "Pending" && <><button disabled={busy || !record.sourceCurrent} className={button} onClick={() => void review(record, "approve")}>Approve correction</button><button disabled={busy} className={button} onClick={() => void review(record, "reject")}>Reject</button></>}
        {record.status === "Approved" && <><button disabled={busy || !record.sourceCurrent} className={button} onClick={() => void review(record, "evaluate")}>Evaluate candidate</button><button disabled={busy || (!record.active && (!record.sourceCurrent || !record.evaluation?.passed))} className={button} onClick={() => void review(record, record.active ? "deactivate" : "activate")}>{record.active ? "Deactivate alias" : "Activate alias"}</button><button disabled={busy} className={button} onClick={() => void review(record, "revoke")}>Revoke approval</button></>}
      </div>}
    </article>)}
  </section>;
}
