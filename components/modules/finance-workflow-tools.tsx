"use client";
import { useState } from "react";
import type { MarginControlRow, SupplierInvoiceRow } from "@/types/finance";

export type FinanceEntryOptions = { canWrite: boolean; canApprove: boolean; legalEntities: { id: string; name: string; defaultCurrency: string }[]; suppliers: { id: string; name: string }[]; orders: { id: string; poNumber: string; supplier: string; supplierId: string | null; currency: string; total: number; costTotal: number | null }[] };
const style = "w-full rounded-lg border border-outline-variant/30 bg-surface-lowest px-3 py-2.5 text-sm text-on-surface";
const button = "rounded-lg bg-primary/15 px-4 py-2.5 text-sm font-semibold text-primary disabled:opacity-40";
export async function financeRequest(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json(); if (!response.ok || !payload.ok) throw new Error(payload.error?.message ?? "Finance action failed."); return payload.data;
}
function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div role="dialog" aria-label={title} aria-modal="true" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-5"><div className="max-h-[94vh] w-full max-w-5xl overflow-auto rounded-xl border border-outline-variant/30 bg-surface-container p-6"><div className="mb-5 flex justify-between items-center"><h2 className="text-lg font-semibold">{title}</h2><button aria-label="Close finance dialog" onClick={onClose} className={button}>Close</button></div>{children}</div></div>;
}
function Field({ label, value, onChange, type = "text", step }: { label: string; value: string; onChange: (value: string) => void; type?: string; step?: string }) { return <label className="block text-sm space-y-1">{label}<input required aria-label={label} type={type} step={step} className={style} value={value} onChange={event => onChange(event.target.value)} /></label>; }

export function FinanceWorkflowTools({ options, invoices, margins, layer, onChanged }: { options: FinanceEntryOptions; invoices: SupplierInvoiceRow[]; margins: MarginControlRow[]; layer: string; onChanged: () => Promise<void> }) {
  const [dialog, setDialog] = useState<"invoice" | "export" | "costs" | null>(null), [invoice, setInvoice] = useState<SupplierInvoiceRow | null>(null), [margin, setMargin] = useState<MarginControlRow | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function refresh() { setBusy(true); setError(""); try { await financeRequest("/api/v1/finance/controls", { action: "refresh" }); await onChanged(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Checks failed"); } finally { setBusy(false); } }
  async function completed() { setDialog(null); await onChanged(); }
  return <>
    <div className="rounded-xl border border-outline-variant/20 bg-surface-container p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {options.canWrite && <button disabled={busy} onClick={refresh} className={button}>{busy ? "Checking…" : "Run finance checks"}</button>}
        {layer === "payables" && options.canWrite && <>
          <button className={button} onClick={() => { setInvoice(null); setDialog("invoice"); }}>Add supplier invoice</button>
          <select aria-label="Edit supplier invoice" className={`${style} max-w-xs`} value="" onChange={event => { const row = invoices.find(item => item.id === event.target.value); if (row) { setInvoice(row); setDialog("invoice"); } }}><option value="">Edit invoice / attach evidence…</option>{invoices.filter(row => row.approvalStatus !== "Approved").map(row => <option key={row.id} value={row.id}>{row.supplierInvoiceNo} · {row.supplier}</option>)}</select>
        </>}
        {layer === "exportAudit" && options.canApprove && <button className={button} onClick={() => setDialog("export")}>Create export batch</button>}
        {layer === "margin" && options.canApprove && <select aria-label="Review order costs" className={`${style} max-w-sm`} value="" onChange={event => { const row = margins.find(item => item.orderId === event.target.value); if (row) { setMargin(row); setDialog("costs"); } }}><option value="">Review order costs and margin target…</option>{margins.map(row => <option key={row.orderId} value={row.orderId}>{row.orderRef} · {row.currency}</option>)}</select>}
      </div>
      <p className="text-sm text-on-surface-variant">Finance checks detect missing costs, overdue invoices, unmatched records and other review conditions. They run when an authorized operator refreshes Finance, or through a configured Finance agent schedule. They do not approve invoices or send payments.</p>
      {error && <p role="alert" className="text-sm text-error">{error}</p>}
    </div>
    {dialog === "invoice" && <SupplierInvoiceDialog key={invoice?.id ?? "new"} row={invoice} options={options} onClose={() => setDialog(null)} onDone={completed} />}
    {dialog === "export" && <ExportDialog options={options} onClose={() => setDialog(null)} onDone={completed} />}
    {dialog === "costs" && margin && <CostDialog row={margin} onClose={() => setDialog(null)} onDone={completed} />}
  </>;
}

function SupplierInvoiceDialog({ row, options, onClose, onDone }: { row: SupplierInvoiceRow | null; options: FinanceEntryOptions; onClose: () => void; onDone: () => Promise<void> }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ supplierId: row?.supplierId ?? "", legalEntityId: row?.legalEntityId ?? "", purchaseOrderId: row?.purchaseOrderId ?? "", supplierInvoiceNo: row?.supplierInvoiceNo ?? "", invoiceDate: row?.invoiceDate.slice(0, 10) ?? today, dueDate: row?.dueDate.slice(0, 10) ?? today, currency: row?.currency ?? "EUR", netAmount: row ? String(row.invoicedCost) : "", vatAmount: row ? String(row.vatAmount) : "0", evidenceRef: row?.evidenceRef ?? "", reviewNote: row?.reviewNote ?? "" });
  const [final, setFinal] = useState(row?.isFinalInvoice ?? false), [confirmed, setConfirmed] = useState(false), [file, setFile] = useState<File | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [requestKey] = useState(() => crypto.randomUUID());
  const set = (key: keyof typeof form, value: string) => setForm(previous => ({ ...previous, [key]: value }));
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); let savedId: string | null = null;
    try {
      const saved = await financeRequest("/api/v1/finance/supplier-invoices", { ...form, id: row?.id, version: row?.version, netAmount: Number(form.netAmount), vatAmount: Number(form.vatAmount), isFinalInvoice: final, confirmAmounts: confirmed, requestKey }); savedId = saved.id;
      if (file) { const body = new FormData(); body.set("file", file); const response = await fetch(`/api/v1/finance/supplier-invoices/${saved.id}/evidence`, { method: "POST", body }); const value = await response.json(); if (!response.ok || !value.ok) throw new Error(value.error?.message ?? "Document upload failed"); }
      await onDone();
    } catch (cause) { setError(`${savedId ? "Invoice saved. If attachment failed, close and use Edit invoice / attach evidence to retry. " : ""}${cause instanceof Error ? cause.message : "Could not save invoice"}`); }
    finally { setBusy(false); }
  }
  const availableOrders = options.orders.filter(order => order.supplierId === form.supplierId || (!order.supplierId && order.supplier === options.suppliers.find(supplier => supplier.id === form.supplierId)?.name));
  return <Dialog title={row ? "Edit supplier invoice" : "Add supplier invoice"} onClose={onClose}>
    <p className="mb-4 text-sm text-on-surface-variant">Enter reviewed invoice totals and optionally attach the source file. This is manual document intake; Nautex does not infer tax treatment or extract totals automatically. Saved invoices await a separate approval.</p>
    {(!options.suppliers.length || !options.legalEntities.length) && <p className="mb-4 text-sm text-warning">Add a supplier in Suppliers and a seller legal entity in Settings → Company setup first.</p>}
    <form onSubmit={submit} className="space-y-4"><div className="grid gap-3 md:grid-cols-2">
      <label className="text-sm space-y-1">Supplier<select required aria-label="Invoice supplier" className={style} value={form.supplierId} onChange={event => setForm(previous => ({ ...previous, supplierId: event.target.value, purchaseOrderId: "" }))}><option value="">Choose supplier…</option>{options.suppliers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="text-sm space-y-1">Legal entity<select required aria-label="Invoice legal entity" className={style} value={form.legalEntityId} onChange={event => set("legalEntityId", event.target.value)}><option value="">Choose legal entity…</option>{options.legalEntities.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="text-sm space-y-1 md:col-span-2">Supplier purchase order<select aria-label="Invoice purchase order" className={style} value={form.purchaseOrderId} onChange={event => { const order = availableOrders.find(item => item.id === event.target.value); setForm(previous => ({ ...previous, purchaseOrderId: event.target.value, currency: order?.currency ?? previous.currency })); }}><option value="">No PO — retain for explicit review</option>{availableOrders.map(item => <option key={item.id} value={item.id}>{item.poNumber} · {item.currency}</option>)}</select></label>
      <Field label="Supplier invoice number" value={form.supplierInvoiceNo} onChange={value => set("supplierInvoiceNo", value)} />
      <Field label="Invoice currency" value={form.currency} onChange={value => set("currency", value.toUpperCase())} />
      <Field label="Invoice date" type="date" value={form.invoiceDate} onChange={value => set("invoiceDate", value)} />
      <Field label="Due date" type="date" value={form.dueDate} onChange={value => set("dueDate", value)} />
      <Field label="Net amount" type="number" step="0.01" value={form.netAmount} onChange={value => set("netAmount", value)} />
      <Field label="Recorded VAT amount" type="number" step="0.01" value={form.vatAmount} onChange={value => set("vatAmount", value)} />
      <Field label="Source reference" value={form.evidenceRef} onChange={value => set("evidenceRef", value)} />
      <label className="text-sm space-y-1">Invoice evidence (optional, up to 10 MB)<input aria-label="Invoice evidence file" type="file" accept=".pdf,.png,.jpg,.jpeg,.txt,.csv,.xlsx,.docx" className={style} onChange={event => { const chosen = event.target.files?.[0] ?? null; setFile(chosen); if (chosen && !form.evidenceRef) set("evidenceRef", chosen.name); }} /></label>
    </div><Field label="Invoice review note" value={form.reviewNote} onChange={value => set("reviewNote", value)} />
    <label className="block text-sm"><input type="checkbox" className="mr-2" checked={final} onChange={event => setFinal(event.target.checked)} />This is the final supplier invoice for this PO (earlier approved invoices remain included)</label>
    <label className="block text-sm"><input type="checkbox" className="mr-2" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I reviewed the supplier, currency, net and recorded VAT against the source</label>
    {error && <p role="alert" className="text-sm text-error">{error}</p>}<button disabled={busy || !confirmed || !form.supplierId || !form.legalEntityId} className={button}>{busy ? "Saving…" : "Save invoice for review"}</button>
    </form>
  </Dialog>;
}

type ExportPreview = { fingerprint: string; canCreate: boolean; previouslyBatched: number; basis: string; rows: { entityId: string; data: Record<string, string | number>; errors: string[] }[] };
function ExportDialog({ options, onClose, onDone }: { options: FinanceEntryOptions; onClose: () => void; onDone: () => Promise<void> }) {
  const today = new Date().toISOString().slice(0, 10);
  const [entity, setEntity] = useState(""), [from, setFrom] = useState(`${today.slice(0, 7)}-01`), [to, setTo] = useState(today), [preview, setPreview] = useState<ExportPreview | null>(null), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [requestKey] = useState(() => crypto.randomUUID());
  function reset() { setPreview(null); setConfirmed(false); }
  async function act(create: boolean) { setBusy(true); setError(""); try { const result = await financeRequest("/api/v1/finance/export-readiness", { action: create ? "create" : "preview", legalEntityId: entity, from, to, requestKey, fingerprint: preview?.fingerprint, confirmReviewed: confirmed }); if (create) await onDone(); else setPreview(result); } catch (cause) { setError(cause instanceof Error ? cause.message : "Export failed"); } finally { setBusy(false); } }
  return <Dialog title="Create accounting export batch" onClose={onClose}><div className="space-y-4">
    <label className="block text-sm">Export legal entity<select aria-label="Export legal entity" value={entity} className={style} onChange={event => { setEntity(event.target.value); reset(); }}><option value="">Choose legal entity…</option>{options.legalEntities.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
    {!options.legalEntities.length && <p className="text-sm text-warning">Create a seller legal entity in Settings → Company setup first.</p>}
    <div className="grid grid-cols-2 gap-3"><Field label="Period from" type="date" value={from} onChange={value => { setFrom(value); reset(); }} /><Field label="Period to" type="date" value={to} onChange={value => { setTo(value); reset(); }} /></div>
    <button disabled={busy || !entity} onClick={() => act(false)} className={button}>Preview export records</button>
    {preview && <><p className="text-sm text-on-surface-variant">{preview.basis}</p><p className="text-sm">{preview.rows.length} candidate records; {preview.previouslyBatched} already batched and excluded.</p><div className="max-h-72 overflow-auto"><table className="w-full text-sm"><thead><tr>{["Document", "Party", "Currency", "Net", "VAT", "Gross", "Validation"].map(label => <th className="p-2 text-left" key={label}>{label}</th>)}</tr></thead><tbody>{preview.rows.map(row => <tr key={row.entityId}>{[row.data.document_no, row.data.counterparty, row.data.currency, row.data.net_amount, row.data.vat_amount, row.data.gross_amount, row.errors.join("; ") || "Ready"].map((value, index) => <td className="p-2 border-t border-outline-variant/20" key={index}>{value}</td>)}</tr>)}</tbody></table></div>
    <label className="block text-sm"><input type="checkbox" className="mr-2" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I reviewed this batch and its accounting period</label><button disabled={busy || !preview.canCreate || !confirmed} className={button} onClick={() => act(true)}>Create reviewed batch</button></>}
    {error && <p role="alert" className="text-sm text-error">{error}</p>}
  </div></Dialog>;
}
function CostDialog({ row, onClose, onDone }: { row: MarginControlRow; onClose: () => void; onDone: () => Promise<void> }) {
  const [values, setValues] = useState({ freightDeliveryCost: String(row.freightDeliveryCost), customsBondedCost: String(row.customsBondedCost), warehouseHandlingCost: String(row.warehouseHandlingCost), otherCosts: String(row.additionalOtherCosts), targetMarginPct: String(row.targetMarginPct) });
  const [note, setNote] = useState(row.costReviewNote), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const labels = { freightDeliveryCost: "Freight and delivery cost", customsBondedCost: "Customs and bonded cost", warehouseHandlingCost: "Warehouse handling cost", otherCosts: "Other order costs", targetMarginPct: "Target margin percent" };
  async function save(event: React.FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { await financeRequest("/api/v1/finance/controls", { action: "review_costs", orderId: row.orderId, version: row.version, ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Number(value)])), reviewNote: note, confirmCosts: confirmed }); await onDone(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Cost review failed"); } finally { setBusy(false); } }
  return <Dialog title={`Review order costs: ${row.orderRef}`} onClose={onClose}><form onSubmit={save} className="space-y-4"><p className="text-sm">Amounts are in {row.currency}. These costs are additional to supplier invoices/commitments. Confirm zero amounts only after review. Revenue and supplier cost are derived from source orders and invoices.</p><div className="grid grid-cols-2 gap-3">{(Object.keys(values) as (keyof typeof values)[]).map(key => <Field key={key} label={labels[key]} type="number" step="0.01" value={values[key]} onChange={value => setValues(previous => ({ ...previous, [key]: value }))} />)}</div><Field label="Cost review note" value={note} onChange={setNote} /><label className="block text-sm"><input type="checkbox" className="mr-2" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I reviewed all additional costs, including zero amounts</label>{error && <p role="alert" className="text-sm text-error">{error}</p>}<button disabled={busy || !confirmed} className={button}>Save reviewed costs</button></form></Dialog>;
}
