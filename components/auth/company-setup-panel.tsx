"use client";

import { useEffect, useState } from "react";

type CompanyState = { organization: { name: string }; legalEntities: { id: string; code: string | null; name: string }[]; customers: { id: string; customerCode: string; name: string }[] };
const inputClass = "w-full rounded-md border border-outline-variant/30 bg-surface-base px-3 py-2 text-sm";
const initial = { kind: "legal_entity", code: "", name: "", addressLine1: "", city: "", country: "", postalCode: "", vatId: "", defaultCurrency: "", paymentTerms: "Net 30" };

export function CompanySetupPanel({ enabled, onSaved }: { enabled: boolean; onSaved?: (entities: CompanyState["legalEntities"]) => void }) {
  const [data, setData] = useState<CompanyState | null>(null);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function load() {
    const response = await fetch("/api/v1/admin/company");
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message ?? "Company setup could not be loaded.");
    setData(payload.data);
    return payload.data as CompanyState;
  }
  useEffect(() => { if (enabled) void load().catch(cause => setError(String(cause.message))); }, [enabled]);
  if (!enabled) return null;
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/v1/admin/company", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Company setup could not be saved.");
      setNotice(`${form.kind === "legal_entity" ? "Seller legal entity" : "Customer account"} saved. Existing business documents were not changed.`);
      setForm({ ...initial, kind: form.kind }); const updated = await load(); onSaved?.(updated.legalEntities);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Save failed. Your entered details are retained."); }
    finally { setBusy(false); }
  }
  const fields = [["code", "Account code"], ["name", "Registered name"], ["addressLine1", "Address"], ["city", "City"], ["country", "Country"], ["postalCode", "Postal code"], ["vatId", "VAT / tax registration"], ["defaultCurrency", "Default currency (for example EUR)"]] as const;
  return <section aria-label="Company setup" className="space-y-3 rounded-lg border border-outline-variant/25 bg-surface-base p-3">
    <h3 className="font-semibold">Company setup</h3>
    <p className="text-sm text-on-surface-variant">Enter your seller identity and customer accounts before preparing quotations or invoices. Use reviewed company details; currency and tax registration are never inferred.</p>
    {data && <><p className="text-sm">{data.organization.name} · {data.legalEntities.length} seller entities · {data.customers.length} customer accounts</p>
      {!data.legalEntities.length && <p className="text-sm text-warning">Seller legal entity required before invoicing.</p>}
      <details><summary className="cursor-pointer text-sm">View saved company records</summary><ul className="space-y-1 py-2 text-sm">{data.legalEntities.map(row => <li key={row.id}>Seller · {row.code} · {row.name}</li>)}{data.customers.map(row => <li key={row.id}>Customer · {row.customerCode} · {row.name}</li>)}</ul></details></>}
    <form onSubmit={save} className="space-y-3">
      <label className="block text-sm">Record type<select className={inputClass} value={form.kind} disabled={busy} onChange={e => setForm({ ...form, kind: e.target.value })}><option value="legal_entity">Seller legal entity</option><option value="customer">Customer account</option></select></label>
      {fields.map(([key, label]) => <label key={key} className="block text-sm">{label}<input className={inputClass} value={form[key]} disabled={busy} required={key !== "postalCode" && (key !== "vatId" || form.kind === "legal_entity")} maxLength={key === "defaultCurrency" ? 3 : key === "addressLine1" ? 240 : 160} onChange={e => setForm({ ...form, [key]: e.target.value })} /></label>)}
      {form.kind === "customer" && <label className="block text-sm">Payment terms<input className={inputClass} value={form.paymentTerms} required disabled={busy} onChange={e => setForm({ ...form, paymentTerms: e.target.value })} /><span className="text-xs text-on-surface-variant">Use Net 0 for immediate payment or the agreed number of days, for example Net 30.</span></label>}
      <p className="text-sm text-on-surface-variant">Check names, addresses and currency before saving. For invoices, the order buyer name must match one active customer account.</p>
      <button disabled={busy || !data} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-on-primary disabled:opacity-50">{busy ? "Saving…" : "Save company record"}</button>
    </form>
    {error && <p role="alert" className="text-sm text-error">{error}</p>}{notice && <p role="status" className="text-sm text-success">{notice}</p>}
  </section>;
}
