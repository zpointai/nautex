"use client";
import { useCallback, useEffect, useState } from "react";
type State = { connected: boolean; enabled: boolean; clientId: string; tenantId: string; account: string };
type Flow = { flowId: string; userCode: string; verificationUri: string; interval: number; expiresIn: number };
const button = "rounded border border-primary/25 px-3 py-2 text-sm text-primary disabled:opacity-40";
export function MailboxSettingsPanel({ enabled }: { enabled: boolean }) {
  const [state, setState] = useState<State | null>(null), [clientId, setClientId] = useState(""), [tenantId, setTenantId] = useState("organizations"), [flow, setFlow] = useState<Flow | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const load = useCallback(async () => { const response = await fetch("/api/v1/admin/mailbox", { cache: "no-store" }); const result = await response.json(); if (!response.ok || !result.ok) throw new Error(result.error?.message || "Could not load mailbox settings."); setState(result.data); setClientId(result.data.clientId); setTenantId(result.data.tenantId); }, []);
  useEffect(() => { if (enabled) void load().catch(error => setMessage(error.message)); }, [enabled, load]);
  if (!enabled) return null;
  async function change(action: string) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/v1/admin/mailbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, clientId, tenantId, flowId: flow?.flowId }) });
      const result = await response.json(); if (!response.ok || !result.ok) throw new Error(result.error?.message || "Mailbox change failed.");
      if (action === "connect") { setFlow(result.data); setMessage("Complete Microsoft sign-in, then check sign-in below. Connecting enables read-only message detection."); }
      else if (result.data.pending) setMessage(`Waiting for Microsoft sign-in. Check again in ${result.data.retryAfter} seconds.`);
      else { setFlow(null); await load(); setMessage("Mailbox settings updated. No email was sent."); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Mailbox change failed."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 border-t border-outline-variant/20 pt-4 text-sm"><h3 className="font-semibold">Supplier reply detection · Microsoft 365 / Outlook</h3><p className="text-outline">Reads inbox message metadata and suggests matches using supplier email and order reference. No email bodies, attachments or sending permissions are requested. Review matches in the Backorder Reply Monitor agent.</p><p>{state?.connected ? `${state.account} · ${state.enabled ? "Enabled" : "Paused"}` : "No account connected"}</p><details><summary className="cursor-pointer">Microsoft application setup</summary><p className="mt-2 text-outline">Use your company’s Microsoft Entra public-client app registration with device sign-in enabled. Delegated permissions: Mail.ReadBasic and User.Read, plus offline_access for renewal. Tenant policies may require administrator consent.</p></details><label className="block">Application (client) ID<input className="mt-1 w-full rounded bg-surface-base p-2" value={clientId} onChange={event => setClientId(event.target.value)} /></label><label className="block">Tenant GUID or organizations<input className="mt-1 w-full rounded bg-surface-base p-2" value={tenantId} onChange={event => setTenantId(event.target.value)} /></label><div className="flex flex-wrap gap-2"><button className={button} disabled={busy || !clientId} onClick={() => void change("connect")}>{state?.connected ? "Reconnect Microsoft account" : "Start Microsoft sign-in"}</button>{state?.connected && <><button className={button} disabled={busy} onClick={() => void change(state.enabled ? "disable" : "enable")}>{state.enabled ? "Pause mailbox detection" : "Enable mailbox detection"}</button><button className={button} disabled={busy} onClick={() => void change("disconnect")}>Disconnect account</button></>}</div>{flow && <div className="space-y-2 rounded border border-primary/30 p-3"><p>Open <a className="text-primary underline" href={flow.verificationUri} target="_blank" rel="noreferrer">Microsoft sign-in</a> and enter code <strong>{flow.userCode}</strong>. Only enter this code for the connection you just requested.</p><button className={button} disabled={busy} onClick={() => void change("poll")}>Check Microsoft sign-in</button></div>}{message && <p role="status">{message}</p>}</section>;
}
