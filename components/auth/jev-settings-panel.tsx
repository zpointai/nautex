"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { JevStatus } from "@/lib/ai/jev-contract";
export function JevSettingsPanel({ enabled }: { enabled: boolean }) {
  const [status, setStatus] = useState<JevStatus | null>(null), [apiKey, setApiKey] = useState("");
  const [active, setActive] = useState(false), [consent, setConsent] = useState(false), [limit, setLimit] = useState(20);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(enabled);
  const pending = useRef(false);
  const apply = (v: JevStatus) => { setStatus(v); setActive(v.enabled); setConsent(v.enabled); setLimit(v.dailyLimit); };
  const load = useCallback(async (signal?: AbortSignal) => {
    const r = await fetch("/api/v1/admin/jev", { cache: "no-store", signal }); const p = await r.json();
    if (!r.ok || !p.ok) throw new Error(p.error?.message || "Jev settings are unavailable."); if (!signal?.aborted) apply(p.data);
  }, []);
  useEffect(() => { const control = new AbortController(); if (enabled) load(control.signal).catch(e => { if (!control.signal.aborted) setMessage(e.message); }).finally(() => { if (!control.signal.aborted) setLoading(false); }); return () => control.abort(); }, [enabled, load]);
  async function refresh() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setRefreshing(true); setMessage("");
    try { await load(); setMessage(`Jev status refreshed at ${new Date().toLocaleTimeString()}. No model request was made.`); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Jev status could not be refreshed."); }
    finally { pending.current = false; setBusy(false); setRefreshing(false); }
  }
  async function save(action: "save" | "disconnect") {
    if (!status || pending.current) return; pending.current = true; setBusy(true); setMessage("");
    try {
      const r = await fetch("/api/v1/admin/jev", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...(action === "save" ? { apiKey, enabled: active, dailyLimit: limit, allowExternalProcessing: consent } : {}), revision: status.revision }) });
      const p = await r.json(); if (!r.ok || !p.ok) throw new Error(p.error?.message || "Settings could not be saved.");
      apply(p.data); setApiKey(""); setMessage(action === "disconnect" ? "Jev disconnected and its saved key removed." : "Jev settings saved. No model request was made.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Settings could not be saved."); }
    finally { pending.current = false; setBusy(false); }
  }
  if (!enabled) return null;
  return <section className="rounded-xl border border-outline-variant/20 bg-surface-container p-5 space-y-4">
    <h3 className="font-semibold text-base">TypeSafe / Jev reviews</h3>
    <p className="text-sm text-on-surface-variant">Optional reviews for selected stock items, catalogue items and suppliers. Reviews offer advice; they do not select suppliers, change stock or activate learning.</p>
    <p className="text-sm">{!status ? "Loading Jev settings…" : status.configured ? "Key saved securely" : "No key saved"} · {status?.model ?? "jev-1.13.0"} · {status?.usedToday ?? 0} requests today (UTC)</p>
    <div className="grid gap-4 md:grid-cols-2">
      <label className="text-sm space-y-1">Jev API key<input disabled={busy || !status} type="password" autoComplete="off" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={status?.configured ? "Keep saved key" : "Enter API key"} className="w-full rounded border border-outline-variant/30 bg-surface-lowest p-2.5" /></label>
      <label className="text-sm space-y-1">Daily Jev request limit<input disabled={busy || !status} type="number" min={1} max={100} value={limit} onChange={e => setLimit(Number(e.target.value))} className="w-full rounded border border-outline-variant/30 bg-surface-lowest p-2.5" /></label>
    </div>
    <label className="flex items-center gap-3 text-sm"><input disabled={busy || !status} type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="size-4 accent-teal-400" />Enable Jev reviews for this company</label>
    <label className="flex items-start gap-3 text-sm"><input disabled={busy || !status} type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-1 size-4 shrink-0 accent-teal-400" />Allow requirements and selected description, code, unit, category and supplier coverage fields to be sent to TypeSafe when an operator requests a review. These requests may incur API charges.</label>
    <p className="text-sm text-on-surface-variant">The daily limit counts attempted requests, including failures; it is not a monetary cap. Turning reviews off discards results still in progress, whose API usage may already have been charged.</p>
    <div className="flex flex-wrap gap-3">
      <button disabled={busy || !status || (active && !consent)} onClick={() => save("save")} className="rounded bg-success/15 px-4 py-2.5 text-sm font-semibold text-success disabled:opacity-50">Save Jev settings</button>
      <button disabled={busy || !status?.configured} onClick={() => save("disconnect")} className="rounded border border-outline-variant/30 px-4 py-2.5 text-sm disabled:opacity-50">Disconnect Jev</button>
      <button disabled={busy || loading} aria-busy={refreshing} onClick={() => void refresh()} className="rounded border border-outline-variant/30 px-4 py-2.5 text-sm disabled:opacity-50">{refreshing ? "Refreshing Jev status…" : "Refresh Jev status"}</button>
    </div>
    {message && <p role="status" className="text-sm">{message}</p>}
    {!!status?.recent?.length && <details className="text-sm"><summary className="cursor-pointer">Recent Jev reviews and usage</summary><ul className="mt-2 space-y-2">{status.recent.map(r => <li key={r.id}>{new Date(r.createdAt).toLocaleString()} · {r.kind} · {r.status} · {r.providerAttempted ? `${r.inputTokens ?? "unknown"} input tokens` : "no API request"}</li>)}</ul></details>}
  </section>;
}
