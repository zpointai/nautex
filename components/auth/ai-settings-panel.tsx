"use client";
import { AIUsagePanel } from "./ai-usage-panel";

import { useCallback, useEffect, useState } from "react";

interface AIProviderState {
  configured: boolean;
  storedKeyPreview: string | null;
  baseUrl: string | null;
  updatedAt: string | null;
  managedByEnvironment: boolean;
}

interface AISettingsState {
  configured: boolean;
  activeProvider: string;
  storedProvider: string | null;
  storedKeyPreview: string | null;
  baseUrl: string | null;
  updatedAt: string | null;
  managedByEnvironment: boolean;
  providers: Record<string, AIProviderState>;
  models: {
    default: string;
    fast: string;
    reasoning: string;
  };
  providerModels: Record<string, {
    default: string;
    fast: string;
    reasoning: string;
  }>;
}

const PROVIDERS = [["deepseek", "DeepSeek"], ["gemini", "Google Gemini"]] as const;

export function AISettingsPanel({ enabled }: { enabled: boolean }) {
  const [state, setState] = useState<AISettingsState | null>(null);
  const [provider, setProvider] = useState("deepseek");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<{ default: string; fast: string; reasoning: string } | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    const response = await fetch("/api/v1/settings/ai");
    const payload = await response.json();
    if (!response.ok || payload.ok === false) throw new Error(payload.error?.message ?? "AI settings could not be loaded.");
    const data = payload.data as AISettingsState;
    setState(data);
    if (data.storedProvider && data.storedProvider !== "none") setProvider(data.storedProvider);
  }, [enabled]);

  useEffect(() => { void load().catch((error) => setMessage(error.message)); }, [load]);
  if (!enabled) return null;

  async function save(nextProvider: string, key: string, action: "save" | "activate" | "disconnect" = "save") {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/settings/ai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: nextProvider, apiKey: key, action, ...(action === "save" && models ? { models } : {}) }),
      });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) throw new Error(payload.error?.message ?? "AI settings could not be saved.");
      setApiKey("");
      await load();
      window.dispatchEvent(new Event("nautex-ai-settings-changed"));
      setMessage(action === "disconnect" ? "AI provider disconnected." : action === "activate" ? "Active AI provider updated." : "AI provider connected and selected.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AI settings could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const selectedProvider = state?.providers?.[provider];
  const selectedModels = state?.providerModels?.[provider] ?? state?.models;
  const statusTone = state?.configured ? "text-success" : "text-warning";
  const statusLabel = state?.configured ? `Active - ${state.activeProvider}` : "Not connected";

  return (
    <section className="border-t border-outline-variant/15 pt-3">
      <div className="mb-3 flex items-center gap-2">
        <span aria-hidden="true" className="material-symbols-outlined text-base text-primary">smart_toy</span>
        <h3 className="text-xs font-semibold text-on-surface">AI providers</h3>
        <span className={`ml-auto text-[0.62rem] font-medium ${statusTone}`}>{statusLabel}</span>
      </div>

      <details className="mb-3 text-xs leading-6"><summary className="cursor-pointer text-primary">Provider setup, costs and privacy</summary>
        <p>Recommended starting point: DeepSeek Flash for economical text extraction and drafting. Google Gemini is the supported alternative. Quality depends on your documents; verify outputs. Consumer chat subscriptions do not include Nautex API usage.</p>
        <p>Create an account, enable API billing or credits, and create your own key in <a className="text-primary underline" href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">DeepSeek Platform</a> or <a className="text-primary underline" href="https://aistudio.google.com/api-keys" target="_blank" rel="noreferrer">Google AI Studio</a>. Paste it below and choose Connect provider. Saving does not make a paid request.</p>
        <p>Test sends a small synthetic prompt and may incur a charge. AI actions send the selected document text, prompts and relevant record fields to your selected provider. Review its data terms before using confidential records. Keys are encrypted in this workspace and never returned in full.</p>
        <p>Update key replaces the saved key. Disconnect removes it and disables AI if it was active. Select Make active to switch explicitly. Local workflows stay available.</p>
        <p>401/403: check or replace the key and access. 402/429: check billing, quota and limits. 404: select a model available to your account. Timeout/5xx: keep your input and retry later.</p>
        <a className="text-primary underline" href="https://api-docs.deepseek.com/quick_start/pricing" target="_blank" rel="noreferrer">DeepSeek models/pricing</a>{" · "}<a className="text-primary underline" href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noreferrer">Gemini billing</a>
      </details>
      {state?.managedByEnvironment ? (
        <p className="rounded-md border border-outline-variant/15 bg-surface-base/50 px-2.5 py-2 text-[0.62rem] leading-5 text-on-surface-variant">
          The active AI provider is set through environment variables on this machine, so provider selection cannot be changed here.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[0.62rem] text-outline">Provider
              <select
                value={provider}
                disabled={busy || !state}
                onChange={(event) => { setProvider(event.target.value); setModels(null); setApiKey(""); setRevealed(false); }}
                className="mt-1 h-9 w-full rounded-md border border-outline-variant/15 bg-surface-base px-2 text-xs text-on-surface"
              >
                {PROVIDERS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            </label>
            <label className="text-[0.62rem] text-outline">API key
              <div className="relative mt-1">
                <input
                  type={revealed ? "text" : "password"}
                  disabled={busy || !state}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={selectedProvider?.storedKeyPreview ?? "Paste provider key"}
                  autoComplete="off"
                  className="h-9 w-full rounded-md border border-outline-variant/15 bg-surface-base pl-2 pr-9 text-xs text-on-surface outline-none focus:border-primary/40"
                />
                <button
                  type="button"
                  onClick={() => setRevealed((current) => !current)}
                  aria-label={revealed ? "Hide API key" : "Show API key"}
                  aria-pressed={revealed}
                  className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-md text-on-surface-variant transition hover:text-on-surface focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-base leading-none">{revealed ? "visibility_off" : "visibility"}</span>
                </button>
              </div>
            </label>
          </div>

          <p className="mt-1.5 text-[0.58rem] leading-4 text-outline">
            Keys are stored separately and encrypted on this machine. Only the active provider receives item or document text when an AI feature runs.
          </p>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {PROVIDERS.map(([code, name]) => {
              const connected = state?.providers?.[code]?.configured;
              return (
                <span key={code} className={`rounded-md px-2 py-1 text-[0.58rem] font-semibold ${connected ? "bg-success/10 text-success" : "bg-surface-base text-outline"}`}>
                  {name}: {connected ? (state?.activeProvider === code ? "active" : "connected") : "not connected"}
                </span>
              );
            })}
          </div>

          {selectedModels && (
            <div className="mt-2 rounded-md border border-outline-variant/15 bg-surface-base/45 p-2.5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[0.62rem] font-semibold text-on-surface">{state?.activeProvider === provider ? "Active" : "Available"} model routing</p>
                <span className="text-[0.56rem] uppercase text-outline">One key per provider</span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                <ModelTier label="Fast" model={selectedModels.fast} detail="Routing, classification, drafts" />
                <ModelTier label="Standard" model={selectedModels.default} detail="RFQs, matching, validation" />
                <ModelTier label="Reasoning" model={selectedModels.reasoning} detail="Reserved escalation tier" />
              </div>
              <p className="mt-2 text-[0.56rem] leading-4 text-outline">
                DeepSeek uses V4.1 Flash for standard and fast tasks, with V4 Pro retained for the reasoning tier. A Gemini API key enables the configured Gemini tiers. Only the currently active provider is called.
              </p>
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy || !state || selectedProvider?.managedByEnvironment || (!apiKey && !selectedProvider?.storedKeyPreview)}
              onClick={() => void save(provider, apiKey)}
              className="h-9 rounded-md bg-primary px-3 text-xs font-semibold text-on-primary disabled:opacity-50"
            >
              {busy ? "Saving..." : selectedProvider?.storedKeyPreview ? "Update key" : "Connect provider"}
            </button>
            {selectedProvider?.configured && state?.activeProvider !== provider && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void save(provider, "", "activate")}
                className="h-9 rounded-md border border-success/20 px-3 text-xs font-medium text-success disabled:opacity-50"
              >
                Make active
              </button>
            )}
            {selectedProvider?.storedKeyPreview && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void save(provider, "", "disconnect")}
                className="h-9 rounded-md border border-error/20 px-3 text-xs font-medium text-error disabled:opacity-50"
              >
                Disconnect
              </button>
            )}
          </div>
        </>
      )}

      <details className="my-3 text-xs"><summary className="cursor-pointer text-primary">Model selection</summary>
        <p className="my-2">Defaults match the implemented adapters. Change a model only after checking the provider's current model list. Test checks the fast tier.</p>
        {(["default", "fast", "reasoning"] as const).map(tier => <label key={tier} className="block my-2">{tier}<input aria-label={tier + " model"} className="block w-full bg-surface-base p-2" value={(models ?? selectedModels)?.[tier] ?? ""} onChange={e => setModels({ ...(models ?? selectedModels ?? { default: "", fast: "", reasoning: "" }), [tier]: e.target.value })} /></label>)}
        <button type="button" className="text-primary underline" disabled={busy || !selectedProvider?.configured} onClick={() => void save(provider, apiKey)}>Save models</button>
      </details>
      <p className="text-xs text-outline">Connection tests may use paid API credits.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {PROVIDERS.filter(([code]) => state?.providers?.[code]?.configured).map(([code, name]) => (
          <button key={code} type="button" disabled={busy} className="h-9 rounded-md border border-outline-variant/20 px-3 text-xs disabled:opacity-50"
            onClick={async () => {
              setBusy(true); setMessage(null);
              try {
                const response = await fetch("/api/v1/settings/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: code }) });
                const payload = await response.json();
                if (!response.ok || payload.ok === false) throw new Error(payload.error?.message || "Connection test failed.");
                setMessage(`${name} responded successfully (${payload.data.model}, ${payload.data.latencyMs} ms).`);
              } catch (error) { setMessage(error instanceof Error ? error.message : "Connection test failed."); }
              finally { setBusy(false); }
            }}>Test {name}</button>
        ))}
      </div>
      {message && <p role="status" className="mt-2 text-[0.65rem] leading-5 text-on-surface-variant">{message}</p>}
      <AIUsagePanel />
    </section>
  );
}

function ModelTier({ label, model, detail }: { label: string; model: string; detail: string }) {
  return (
    <div className="min-w-0 rounded-md bg-surface-lowest px-2 py-1.5">
      <p className="text-[0.54rem] font-semibold uppercase text-outline">{label}</p>
      <p className="mt-0.5 truncate font-mono text-[0.58rem] text-primary" title={model}>{model}</p>
      <p className="mt-0.5 text-[0.52rem] leading-3 text-on-surface-variant">{detail}</p>
    </div>
  );
}
