"use client";

import { useState } from "react";
import type { ShippingCompany } from "@/types/erp";
import { COMPANY_SOURCE_FIELDS, type CompanySourceCandidate, type CompanySourceField } from "@/lib/shipping-companies/source-contract";

export async function requestCompanySources(body: Record<string, unknown>): Promise<ShippingCompany> {
  const response = await fetch("/api/v1/shipping-companies/sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error?.message || "Source review could not be completed.");
  return result.data;
}

const labels: Record<CompanySourceField, string> = { legalName: "Legal name", address: "Registered address", postalCode: "Postal code", city: "City", country: "Country code", companyNumber: "Company registration number" };
const inputStyle = "w-full rounded-md border border-outline-variant/20 bg-surface-high/30 px-3 py-2 text-sm text-on-surface";
const buttonStyle = "rounded-md bg-primary/12 px-3 py-2 text-sm font-semibold text-primary disabled:opacity-40";

export function CompanySourceReview({ company, canManage, disabled, onUpdated }: { company: ShippingCompany; canManage: boolean; disabled: boolean; onUpdated: (company: ShippingCompany) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<CompanySourceCandidate | null>(null);
  const [values, setValues] = useState<Partial<Record<CompanySourceField, string>>>({});
  const [selected, setSelected] = useState<CompanySourceField[]>([]), [identity, setIdentity] = useState(false), [note, setNote] = useState("");
  const review = company.sourceReview;
  const currentCandidate = review?.status === "review_required" ? review.candidates.find(item => item.id === candidate?.id) : undefined;
  const currentStatus = currentCandidate?.entityStatus === "ACTIVE" && currentCandidate.registrationStatus === "ISSUED";
  async function act(body: Record<string, unknown>) {
    setBusy(true); setError(null);
    try { onUpdated(await requestCompanySources({ companyId: company.id, ...body })); setCandidate(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Source review failed."); }
    finally { setBusy(false); }
  }
  function choose(item: CompanySourceCandidate) { setCandidate(item); setValues({ ...item.fields }); setSelected([]); setIdentity(false); setNote(""); setError(null); }
  return <section aria-label="Company source review" className="rounded-lg border border-outline-variant/20 bg-surface-low/20 p-4 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold text-on-surface">Company sources &amp; validation</h3>
      {canManage && <button className={buttonStyle} disabled={disabled || busy} onClick={() => act({ action: "search", allowPublicLookup: true })}>{busy ? "Working…" : "Search public sources"}</button>}
    </div>
    <p className="text-sm text-on-surface-variant">Search sends the company name to GLEIF’s public legal-entity register. Coverage is limited to companies with an LEI. Results do not establish vessel ownership or validate contact details; use manual profile editing for those checks.</p>
    {review && <div className="text-sm text-on-surface-variant"><p>{review.message}</p><p className="mt-1 text-outline">Lookup: {new Date(review.checkedAt).toLocaleString()} · {review.status.replaceAll("_", " ")}</p></div>}
    {review?.status === "applied" && review.candidates.filter(item => item.id === review.selectedCandidateId).map(item => <p key={item.id} className="text-sm text-on-surface-variant">Reviewed source: <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">{item.name} · LEI {item.id}</a>. Fields applied: {review.appliedFields?.map(field => labels[field]).join(", ")}. Reviewed: {review.reviewedAt ? new Date(review.reviewedAt).toLocaleString() : "Not recorded"}.</p>)}
    {error && <p role="alert" className="text-sm text-error">{error}</p>}
    {review?.status === "review_required" && <>
      <div className="space-y-2">{review.candidates.map(item => <div key={item.id} className="rounded-md border border-outline-variant/20 p-3 text-sm space-y-1">
        <p className="font-semibold text-on-surface">{item.name}</p><p className="text-on-surface-variant">{[item.fields.address, item.fields.city, item.fields.country].filter(Boolean).join(" · ")}</p>
        <p className="text-on-surface-variant">Entity: {item.entityStatus} · LEI registration: {item.registrationStatus}</p>
        <p className="text-outline">LEI {item.id} · Source updated: {item.sourceUpdatedAt ? new Date(item.sourceUpdatedAt).toLocaleDateString() : "Not reported"}</p>
        <div className="flex gap-3 items-center"><a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">Open source record</a>
          {canManage && <button className={buttonStyle} disabled={disabled || busy} onClick={() => choose(item)}>Review {item.name}</button>}</div>
      </div>)}</div>
      {canManage && currentCandidate && <div className="space-y-3 rounded-md border border-primary/30 p-3">
        <h4 className="font-semibold text-on-surface">Review selected fields</h4>
        {!currentStatus && <p className="text-sm text-warning">This source record is inactive or its LEI registration is not current. A lapsed LEI does not mean a company has stopped trading. Verify independently and use Edit Profile to enter confirmed details.</p>}
        <p className="text-sm text-on-surface-variant">Select only the fields you checked. You can correct each value before saving.</p>
        {COMPANY_SOURCE_FIELDS.filter(field => currentCandidate.fields[field]).map(field => <div key={field} className="grid grid-cols-1 md:grid-cols-2 gap-2 items-center">
          <label className="text-sm text-on-surface"><input type="checkbox" className="mr-2" checked={selected.includes(field)} onChange={event => setSelected(previous => event.target.checked ? [...previous, field] : previous.filter(value => value !== field))} />Apply {labels[field]}</label>
          <input aria-label={`Proposed ${labels[field]}`} className={inputStyle} value={values[field] ?? ""} onChange={event => setValues(previous => ({ ...previous, [field]: event.target.value }))} />
        </div>)}
        <label className="block text-sm text-on-surface"><input type="checkbox" className="mr-2" checked={identity} onChange={event => setIdentity(event.target.checked)} />I checked that this record identifies the correct company</label>
        <label className="block text-sm text-on-surface">How was the identity checked?<textarea aria-label="Identity review note" className={`${inputStyle} mt-1`} rows={2} value={note} maxLength={1000} onChange={event => setNote(event.target.value)} placeholder="For example, compared the registered address and company number with the customer’s documents." /></label>
        <button className={buttonStyle} disabled={disabled || busy || !currentStatus || !identity || note.trim().length < 10 || !selected.length} onClick={() => act({ action: "apply", reviewId: review.id, candidateId: currentCandidate.id, confirmIdentity: identity, reviewNote: note, fields: Object.fromEntries(selected.map(field => [field, values[field]])) })}>Apply reviewed fields</button>
      </div>}
      {canManage && <button className="text-sm text-outline underline disabled:opacity-40" disabled={disabled || busy} onClick={() => act({ action: "dismiss", reviewId: review.id })}>Dismiss suggestions</button>}
    </>}
  </section>;
}
