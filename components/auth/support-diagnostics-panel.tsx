"use client";
import { useState } from "react";
interface Report { applicationVersion: string; generatedAt: string; privacy: string; checks: Array<{ name: string; status: string; detail: string; action: string }> }
export function SupportDiagnosticsPanel({ enabled }: { enabled: boolean }) {
  const [report, setReport] = useState<Report | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  if (!enabled) return null;
  async function inspect() {
    setBusy(true); setError("");
    try { const response = await fetch("/api/v1/admin/diagnostics", { cache: "no-store" }); const result = await response.json(); if (!response.ok || !result.ok) throw new Error(result.error?.message || "Health checks could not be completed."); setReport(result.data); }
    catch (error) { setError(error instanceof Error ? error.message : "Health checks failed."); }
    finally { setBusy(false); }
  }
  function download() {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `Nautex-support-${report.applicationVersion}-${new Date().toISOString().slice(0, 10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="rounded-lg border border-outline-variant/25 p-3 text-sm"><h3 className="font-semibold">Health and support</h3><p className="my-2 text-outline">Check local health and backup status. This does not call paid AI services or send a support report.</p><button disabled={busy} onClick={() => void inspect()} className="rounded bg-primary px-3 py-2 font-medium text-on-primary disabled:opacity-50">{busy ? "Checking…" : "Run health checks"}</button>{error && <p role="alert" className="mt-2 text-error">{error}</p>}{report && <><p className="my-2 text-outline">Nautex {report.applicationVersion} · {new Date(report.generatedAt).toLocaleString()}</p><div className="space-y-3">{report.checks.map(check => <div key={check.name} className="border-t border-outline-variant/20 pt-2"><p className="font-medium">{check.name} · {check.status.replaceAll("_", " ")}</p><p>{check.detail}</p><p className="text-outline">{check.action}</p></div>)}</div><p className="my-3 text-outline">{report.privacy} Review before sharing.</p><button onClick={download} className="rounded border border-primary/30 px-3 py-2 text-primary">Download support report</button></>}</section>;
}
