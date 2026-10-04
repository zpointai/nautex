"use client";
import { useEffect, useState } from "react";
import requirements from "@/lib/modules/requirements.json";
import type { ModuleKey } from "@/lib/client/navigation";

export function CommunitySetup({ userId, onSettings, onCatalogue }: { userId?: string; onSettings: () => void; onCatalogue: () => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (userId) { try { setOpen(localStorage.getItem(`nautex-setup:${userId}`) !== "complete"); } catch { setOpen(true); } } }, [userId]);
  if (!userId || !open) return null;
  function finish(action?: () => void) { try { localStorage.setItem(`nautex-setup:${userId}`, "complete"); } catch { /* setup remains repeatable */ } setOpen(false); action?.(); }
  return <section aria-label="Welcome to your workspace" className="mb-4 rounded-xl border border-primary/30 bg-surface-container p-5">
    <h2 className="text-lg font-semibold">Your private workspace is ready</h2>
    <p className="my-3 text-sm">Orders, suppliers, inventory, finance, calculations and rule validation work without an AI key. This workspace starts without business records or a catalogue.</p>
    <div className="flex flex-wrap gap-3 text-sm">
      <button className="rounded bg-primary px-3 py-2 text-on-primary" onClick={() => finish(onSettings)}>Connect an optional AI provider</button>
      <button className="rounded border border-primary/30 px-3 py-2" onClick={() => finish(onCatalogue)}>Import my authorised catalogue</button>
      <button className="rounded border border-outline-variant/30 px-3 py-2" onClick={() => finish()}>Skip and start locally</button>
    </div>
    <p className="mt-3 text-xs text-on-surface-variant">You can do either later in Settings or IMPA Catalogue. IMPA data is not included. API usage is charged separately by the provider you choose.</p>
  </section>;
}

export function FeatureAvailability({ moduleKey, configured, onSettings }: { moduleKey: ModuleKey; configured: boolean; onSettings: () => void }) {
  const requirement = requirements.find(r => r.key === moduleKey);
  if (!requirement) return null;
  return <details className="mb-4 rounded-lg border border-outline-variant/20 bg-surface-container p-3 text-xs leading-6">
    <summary className="cursor-pointer">Feature availability · {configured ? "AI provider connected" : "Local workspace · AI not connected"}</summary>
    <p><strong>Without AI:</strong> {requirement.local}</p><p><strong>AI:</strong> {requirement.ai}</p><p><strong>Data and services:</strong> {requirement.data}</p><p>{requirement.state}</p>
    {!configured && <button className="text-primary underline" onClick={onSettings}>Connect provider in Settings</button>}
  </details>;
}

export function CommunityLegal() {
  return <section className="border-t border-outline-variant/20 pt-4 text-xs leading-6">
    <h3 className="font-semibold">About / Legal · Nautex AI 0.3.14</h3>
    <p>Copyright 2026 Zlatin Gorov. An OASIS AI project. Licensed AGPL-3.0-only, without warranty. Commercial use is permitted subject to the licence.</p>
    <p><a href="/legal/LICENSE.txt" target="_blank" rel="noreferrer" className="text-primary underline">Licence</a>{" · "}<a href="/legal/source.zip" download="Nautex-AI-Source-0.3.14.zip" className="text-primary underline">Corresponding source</a></p>
    <p>Desktop users can open the included source and third-party notices from Help → Corresponding source and licences. Network deployments must preserve this source offer and supply source for their modified running version.</p>
  </section>;
}
