"use client";
import { useState } from "react";
import type { ShippingCompanyVessel } from "@/types/erp";

export function FleetVesselForm({ companyName, shippingCompanyId, vessel, onSaved, onClose }: {
  companyName: string; shippingCompanyId: string; vessel?: ShippingCompanyVessel;
  onSaved: (vessel: ShippingCompanyVessel) => void; onClose: () => void;
}) {
  const [name, setName] = useState(vessel?.name ?? ""), [imo, setImo] = useState(vessel?.imo ?? ""), [mmsi, setMmsi] = useState(vessel?.mmsi ?? ""), [notes, setNotes] = useState(vessel?.notes ?? "");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function save() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/shipping-companies/fleet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: vessel?.id, shippingCompanyId, name, imo, mmsi, notes }) });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error?.message || "Could not save vessel.");
      onSaved(payload.data);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save vessel."); }
    finally { setBusy(false); }
  }
  const inputClass = "w-full rounded-lg border border-outline-variant/30 bg-surface-lowest px-3 py-2.5 text-base";
  return <div role="dialog" aria-modal="true" aria-label={vessel ? "Edit vessel" : "Add vessel"} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
    <form onSubmit={e => { e.preventDefault(); void save(); }} className="w-full max-w-xl space-y-4 rounded-xl border border-outline-variant/20 bg-surface-container p-6 shadow-xl">
      <h3 className="text-lg font-semibold">{vessel ? "Edit vessel" : "Add vessel"}</h3>
      <p className="text-sm text-outline">{companyName} · Register the vessel before its first order. Live AIS tracking is managed in Fleet Tracking.</p>
      <label className="block space-y-1 text-sm">Vessel name<input autoFocus required maxLength={200} value={name} onChange={e => setName(e.target.value)} className={inputClass} /></label>
      <div className="grid grid-cols-2 gap-4">
        <label className="block space-y-1 text-sm">IMO (optional)<input inputMode="numeric" pattern="[0-9]{7}" maxLength={7} value={imo} onChange={e => setImo(e.target.value)} className={inputClass} /></label>
        <label className="block space-y-1 text-sm">MMSI (optional)<input inputMode="numeric" pattern="[0-9]{9}" maxLength={9} value={mmsi} onChange={e => setMmsi(e.target.value)} className={inputClass} /></label>
      </div>
      <label className="block space-y-1 text-sm">Vessel notes<textarea maxLength={2000} rows={3} value={notes} onChange={e => setNotes(e.target.value)} className={inputClass} /></label>
      {error && <p role="alert" className="text-sm text-error">{error}</p>}
      <div className="flex justify-end gap-3"><button type="button" disabled={busy} onClick={onClose} className="rounded px-4 py-2.5 text-sm">Cancel</button><button disabled={busy || !name.trim()} className="rounded bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary">{busy ? "Saving…" : "Save vessel"}</button></div>
    </form>
  </div>;
}
