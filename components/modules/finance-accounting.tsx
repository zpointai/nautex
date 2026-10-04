"use client";
import { FinanceWorkflowTools, financeRequest, type FinanceEntryOptions } from "@/components/modules/finance-workflow-tools";
import { openNautexDocument } from "@/lib/client/desktop";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentControls } from "./agent-controls";
import { FinanceSettlements, VatReview } from "./finance-review";
import { INVOICE_TAX_OPTIONS } from "@/lib/finance/invoice-tax";
import type React from "react";
import type {
  AgingBucket,
  CreditNoteRow,
  CustomerInvoiceRow,
  ExportReadinessRow,
  FinanceAuditRow,
  FinanceExceptionRow,
  FinanceKpi,
  MarginControlRow,
  SupplierInvoiceRow,
  UnbilledOrderRow,
} from "@/types/finance";
import { useDialogA11y } from "@/lib/hooks/use-dialog-a11y";
import { money as fmtMoney, totalsByCurrency, formatCurrencyTotals, OPEN_RECEIVABLE_STATUSES } from "@/lib/finance/calculations";

type FinanceLayer = "overview" | "receivables" | "payables" | "margin" | "credits" | "exceptions" | "exportAudit" | "controls" | "settlements" | "vat";

type FinanceData = {
  kpis: FinanceKpi[];
  customerInvoices: CustomerInvoiceRow[];
  supplierInvoices: SupplierInvoiceRow[];
  margins: MarginControlRow[];
  aging: { receivables: AgingBucket[]; payables: AgingBucket[] };
  creditNotes: CreditNoteRow[];
  exceptions: FinanceExceptionRow[];
  exports: ExportReadinessRow[];
  auditEvents: FinanceAuditRow[];
  unbilledOrders: UnbilledOrderRow[];
};

type FinanceTotals = {
  openReceivables: string;
  hasReceivables: boolean;
  overdueCount: number;
  supplierPending: number;
  avgMargin: number;
  pendingCredits: number;
  blockedExports: number;
  openExceptions: number;
};

type PaymentDraft = {
  invoice: CustomerInvoiceRow;
  amount: string;
  reference: string;
};

const emptyData: FinanceData = {
  kpis: [],
  customerInvoices: [],
  supplierInvoices: [],
  margins: [],
  aging: { receivables: [], payables: [] },
  creditNotes: [],
  exceptions: [],
  exports: [],
  auditEvents: [],
  unbilledOrders: [],
};

const layers: Array<{ key: FinanceLayer; label: string; icon: string; detail: string }> = [
  { key: "overview", label: "Control", icon: "space_dashboard", detail: "Finance command queue" },
  { key: "receivables", label: "Receivables", icon: "receipt_long", detail: "Customer invoices and AR" },
  { key: "payables", label: "Payables", icon: "rule", detail: "Supplier invoice matching" },
  { key: "margin", label: "Margin", icon: "monitoring", detail: "Order profit control" },
  { key: "credits", label: "Credit Notes", icon: "assignment_return", detail: "Controlled corrections" },
  { key: "settlements", label: "Payments & Reconciliation", icon: "payments", detail: "Recorded payments, refunds and credit review" },
  { key: "vat", label: "VAT Review", icon: "calculate", detail: "Recorded VAT by period and legal entity" },
  { key: "exceptions", label: "Exceptions", icon: "error", detail: "Human review queue" },
  { key: "exportAudit", label: "Export & Audit", icon: "ios_share", detail: "Accounting handoff" },
  { key: "controls", label: "AI Controls", icon: "psychology_alt", detail: "Human-supervised assistance" },
];

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return <span className={`material-symbols-outlined ${className}`} style={{ fontVariationSettings: "'FILL' 0" }}>{name}</span>;
}

async function getData<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error?.message ?? `Failed to load ${url}`);
  }
  return payload.data;
}

const fmtDate = (value: string | null) => {
  if (!value) return "-";
  return new Date(value).toLocaleDateString([], { month: "short", day: "2-digit", year: "numeric" });
};

const labelize = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/Csv Xlsx/g, "CSV/XLSX");

function toneClass(tone: FinanceKpi["tone"]) {
  if (tone === "success") return "border-success/35 text-success";
  if (tone === "warning") return "border-warning/35 text-warning";
  if (tone === "danger") return "border-error/35 text-error";
  return "border-outline-variant/25 text-on-surface";
}

function statusClass(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.includes("paid") || normalized.includes("matched") || normalized.includes("approved") || normalized.includes("healthy") || normalized.includes("ready") || normalized.includes("prepared") || normalized.includes("posted")) {
    return "bg-success/10 text-success";
  }
  if (normalized.includes("overdue") || normalized.includes("variance") || normalized.includes("missing") || normalized.includes("blocked") || normalized.includes("negative") || normalized.includes("disputed") || normalized.includes("risk")) {
    return "bg-error/10 text-error";
  }
  return "bg-warning/10 text-warning";
}

export function FinanceAccountingModule() {
  const [data, setData] = useState<FinanceData>(emptyData);
  const [activeLayer, setActiveLayer] = useState<FinanceLayer>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [paymentDraft, setPaymentDraft] = useState<PaymentDraft | null>(null);
  const requestKeys = useRef(new Map<string, string>());
  const [entryOptions, setEntryOptions] = useState<FinanceEntryOptions>({ canWrite: false, canApprove: false, legalEntities: [], suppliers: [], orders: [] });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const options = await getData<FinanceEntryOptions>("/api/v1/finance/entry-options");
      setEntryOptions(options);
      if (options.canWrite) await financeRequest("/api/v1/finance/controls", { action: "refresh" });
      const [overview, customerInvoices, supplierInvoices, margins, aging, creditNotes, exceptions, exports, auditEvents, unbilledOrders] = await Promise.all([
        getData<{ kpis: FinanceKpi[] }>("/api/v1/finance/overview"),
        getData<CustomerInvoiceRow[]>("/api/v1/finance/customer-invoices"),
        getData<SupplierInvoiceRow[]>("/api/v1/finance/supplier-invoices"),
        getData<MarginControlRow[]>("/api/v1/finance/margins"),
        getData<FinanceData["aging"]>("/api/v1/finance/payments-aging"),
        getData<CreditNoteRow[]>("/api/v1/finance/credit-notes"),
        getData<FinanceExceptionRow[]>("/api/v1/finance/exceptions"),
        getData<ExportReadinessRow[]>("/api/v1/finance/export-readiness"),
        getData<FinanceAuditRow[]>("/api/v1/finance/audit-events"),
        getData<UnbilledOrderRow[]>("/api/v1/finance/unbilled-orders"),
      ]);
      setData({ kpis: overview.kpis, customerInvoices, supplierInvoices, margins, aging, creditNotes, exceptions, exports, auditEvents, unbilledOrders });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load finance data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const performAction = useCallback(async (key: string, url: string, body?: Record<string, unknown>) => {
    setBusyAction(key);
    setActionError(null);
    try {
      const identity = JSON.stringify({ key, url, body });
      const requestKey = requestKeys.current.get(identity) ?? crypto.randomUUID();
      requestKeys.current.set(identity, requestKey);
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": requestKey },
        body: body ? JSON.stringify(body) : "{}",
      });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) throw new Error(payload.error?.message ?? "Finance action failed.");
      requestKeys.current.delete(identity);
      await loadData();
      return true;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Finance action failed.");
      return false;
    } finally {
      setBusyAction(null);
    }
  }, [loadData]);

  const submitPayment = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!paymentDraft) return;
    const amount = Number(paymentDraft.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setActionError("Payment amount must be greater than zero.");
      return;
    }
    if (amount > paymentDraft.invoice.outstandingAmount) {
      setActionError("Payment amount cannot exceed the invoice outstanding balance.");
      return;
    }
    const ok = await performAction(
      `${paymentDraft.invoice.id}:pay`,
      `/api/v1/finance/customer-invoices/${paymentDraft.invoice.id}/payments`,
      { amount, reference: paymentDraft.reference.trim() || undefined },
    );
    if (ok) setPaymentDraft(null);
  }, [paymentDraft, performAction]);

  const prepareExport = useCallback(async (row: ExportReadinessRow) => {
    const key = `${row.id}:prepare-export`;
    setBusyAction(key);
    setActionError(null);
    setExportNotice(null);
    try {
      const response = await fetch(`/api/v1/finance/export-readiness/${row.id}/prepare`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) throw new Error(payload.error?.message ?? "Accounting export preparation failed.");
      const blob = new Blob([payload.data.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = payload.data.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      await loadData();
      setExportNotice(`Prepared local CSV handoff with ${payload.data.records} finance records for ${labelize(row.target)} as ${payload.data.fileName}.`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Accounting export preparation failed.");
    } finally {
      setBusyAction(null);
    }
  }, [loadData]);

  const totals = useMemo(() => {
    const openInvoices = data.customerInvoices.filter(row => OPEN_RECEIVABLE_STATUSES.includes(row.status) && row.outstandingAmount > 0);
    const openReceivables = formatCurrencyTotals(totalsByCurrency(openInvoices, row => row.outstandingAmount, row => row.currency));
    const overdueInvoices = openInvoices.filter(row => new Date(row.dueDate) < new Date());
    const supplierPending = data.supplierInvoices.filter((row) => !["Matched", "Approved"].includes(row.matchStatus) || row.approvalStatus !== "Approved");
    const completeMargins = data.margins.filter(row => row.calculationBasis.complete);
    const avgMargin = completeMargins.length ? completeMargins.reduce((sum, row) => sum + row.marginPct, 0) / completeMargins.length : 0;
    return {
      openReceivables,
      hasReceivables: openInvoices.length > 0,
      overdueCount: overdueInvoices.length,
      supplierPending: supplierPending.length,
      avgMargin,
      pendingCredits: data.creditNotes.filter((row) => ["Draft", "AwaitingApproval"].includes(row.status)).length,
      blockedExports: data.exports.reduce((sum, row) => sum + row.recordsBlocked, 0),
      openExceptions: data.exceptions.filter((row) => ["Open", "InReview"].includes(row.status)).length,
    };
  }, [data]);

  if (loading) {
    return <div className="rounded-xl border border-outline-variant/20 bg-surface-container p-10 text-center text-sm text-on-surface-variant">Loading finance control layers...</div>;
  }

  if (error) {
    return (
      <div className="rounded-xl border border-error/30 bg-error-container/20 p-5">
        <div className="flex items-center gap-3 text-sm text-error"><Icon name="error" /> {error}</div>
        <button onClick={() => void loadData()} className="mt-4 rounded-lg bg-success px-3 py-2 text-xs font-bold text-on-primary">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-none">
      <section className="rounded-xl border border-outline-variant/20 bg-surface-container p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[0.6rem] font-bold uppercase tracking-wider text-success">Finance Control Layer</p>
            <h2 className="mt-1 text-lg font-bold text-on-surface">Procurement finance and review</h2>
            <p className="mt-1 max-w-4xl text-xs text-on-surface-variant">
              Multi-layer finance controls for customer invoicing, supplier invoice matching, margin leakage, receivables, payables, credit notes, audit trail, and accounting export readiness.
            </p>
          </div>
          <div className="grid w-full gap-2 text-xs sm:grid-cols-2 xl:w-auto xl:max-w-3xl xl:grid-cols-4">
            <SummaryChip label="Open AR by currency" value={totals.openReceivables} tone={totals.hasReceivables ? "warn" : "ok"} />
            <SummaryChip label="Supplier Match" value={totals.supplierPending} tone={totals.supplierPending ? "warn" : "ok"} />
            <SummaryChip label="Avg Forecast Margin" value={data.margins.some(row => row.calculationBasis.complete) ? `${totals.avgMargin.toFixed(1)}%` : "Not established"} tone={totals.avgMargin >= 14 ? "ok" : "warn"} />
            <SummaryChip label="Export Blocks" value={totals.blockedExports} tone={totals.blockedExports ? "danger" : "ok"} />
          </div>
        </div>
      </section>

      {activeLayer === "overview" && <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
        {data.kpis.map((kpi) => <KpiCard key={kpi.label} kpi={kpi} />)}
      </div>}

      <section className="rounded-xl border border-outline-variant/20 bg-surface-container p-3">
        <div className="grid gap-2 md:grid-cols-4 min-[1800px]:grid-cols-8">
          {layers.map((layer) => (
            <button
              key={layer.key}
              onClick={() => setActiveLayer(layer.key)}
              className={`rounded-lg border px-3 py-3 text-left transition-colors ${activeLayer === layer.key ? "border-success/45 bg-success/10 text-success" : "border-outline-variant/20 bg-surface-lowest text-secondary hover:border-success/25"}`}
            >
              <div className="flex items-center gap-2">
                <Icon name={layer.icon} className="text-base" />
                <span className="text-xs font-bold">{layer.label}</span>
              </div>
              <p className="mt-1 text-[0.62rem] text-on-surface-variant">{layer.detail}</p>
            </button>
          ))}
        </div>
      </section>

      {actionError && (
        <div className="rounded-xl border border-error/30 bg-error-container/20 px-4 py-3 text-xs text-error">
          {actionError}
        </div>
      )}
      {exportNotice && (
        <div className="rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-xs text-success">
          {exportNotice}
        </div>
      )}

      <FinanceWorkflowTools options={entryOptions} invoices={data.supplierInvoices} margins={data.margins} layer={activeLayer} onChanged={loadData} />
      {activeLayer === "overview" && <OverviewLayer data={data} totals={totals} setLayer={setActiveLayer} />}
      {activeLayer === "receivables" && <ReceivablesLayer data={data} busyAction={busyAction} onAction={performAction} onRequestPayment={(invoice) => setPaymentDraft({ invoice, amount: "", reference: invoice.bankPaymentReference })} />}
      {activeLayer === "payables" && <PayablesLayer data={data} busyAction={busyAction} onAction={performAction} canApprove={entryOptions.canApprove} />}
      {activeLayer === "margin" && <MarginLayer rows={data.margins} />}
      {activeLayer === "credits" && <CreditLayer rows={data.creditNotes} busyAction={busyAction} onAction={performAction} />}
      {activeLayer === "exceptions" && <ExceptionsLayer rows={data.exceptions} busyAction={busyAction} onAction={performAction} />}
      {activeLayer === "exportAudit" && <ExportAuditLayer exports={data.exports} auditEvents={data.auditEvents} busyAction={busyAction} onPrepareExport={prepareExport} canApprove={entryOptions.canApprove} onAction={performAction} />}
      {activeLayer === "controls" && <ControlsLayer />}
      {activeLayer === "settlements" && <FinanceSettlements onChanged={loadData} />}
      {activeLayer === "vat" && <VatReview />}
      {paymentDraft && (
        <PaymentDialog
          draft={paymentDraft}
          busy={busyAction === `${paymentDraft.invoice.id}:pay`}
          onChange={setPaymentDraft}
          onCancel={() => setPaymentDraft(null)}
          onSubmit={submitPayment}
        />
      )}
    </div>
  );
}

function OverviewLayer({ data, totals, setLayer }: { data: FinanceData; totals: FinanceTotals; setLayer: (layer: FinanceLayer) => void }) {
  const topExceptions = data.exceptions.slice(0, 5);
  const pendingSupplier = data.supplierInvoices.filter((row) => !["Matched", "Approved"].includes(row.matchStatus) || row.approvalStatus !== "Approved").slice(0, 4);
  const overdue = data.customerInvoices.filter((row) => row.status === "Overdue" || new Date(row.dueDate) < new Date() && row.outstandingAmount > 0).slice(0, 4);
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <section className="grid gap-5 lg:grid-cols-3">
        <WorkQueue title="Receivables Risk" icon="receipt_long" action="Open AR" onClick={() => setLayer("receivables")}>
          {overdue.length ? overdue.map((row) => <QueueRow key={row.id} title={row.invoiceNo} meta={`${row.customer} | ${fmtMoney(row.outstandingAmount, row.currency)} outstanding`} tone="danger" />) : <EmptyState text="No overdue customer invoices." />}
        </WorkQueue>
        <WorkQueue title="Supplier Match Queue" icon="rule" action="Open AP" onClick={() => setLayer("payables")}>
          {pendingSupplier.length ? pendingSupplier.map((row) => <QueueRow key={row.id} title={row.supplierInvoiceNo} meta={`${row.supplier} | ${labelize(row.matchStatus)}`} tone="warn" />) : <EmptyState text="No supplier invoices need matching." />}
        </WorkQueue>
        <WorkQueue title="Finance Exceptions" icon="error" action="Review" onClick={() => setLayer("exceptions")}>
          {topExceptions.length ? topExceptions.map((row) => <QueueRow key={row.id} title={row.title} meta={`${row.reference} | ${row.severity}`} tone={row.severity === "High" ? "danger" : "warn"} />) : <EmptyState text="No open finance exceptions." />}
        </WorkQueue>
        <AgingPanel title="Receivables Aging" rows={data.aging.receivables} />
        <AgingPanel title="Payables Aging" rows={data.aging.payables} />
        <section className="rounded-xl border border-outline-variant/20 bg-surface-container p-4">
          <h3 className="flex items-center gap-2 text-sm font-bold text-on-surface"><Icon name="shield" className="text-success" /> Control Status</h3>
          <div className="mt-4 grid gap-2">
            <ControlStatus label="Open receivables by currency" value={totals.openReceivables} alert={totals.hasReceivables} />
            <ControlStatus label="Overdue invoices" value={totals.overdueCount} alert={totals.overdueCount > 0} />
            <ControlStatus label="Pending credit notes" value={totals.pendingCredits} alert={totals.pendingCredits > 0} />
            <ControlStatus label="Audit events" value={data.auditEvents.length} alert={false} />
          </div>
        </section>
      </section>
      <ControlsLayer compact />
    </div>
  );
}

function ReceivablesLayer({
  data,
  busyAction,
  onAction,
  onRequestPayment,
}: {
  data: FinanceData;
  busyAction: string | null;
  onAction: (key: string, url: string, body?: Record<string, unknown>) => Promise<boolean>;
  onRequestPayment: (invoice: CustomerInvoiceRow) => void;
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <FinanceTable
        title="Customer Invoice Workbench"
        icon="receipt_long"
        columns={["Invoice No.", "Customer", "Vessel", "Customer PO", "Invoice", "Delivery", "Due", "Currency", "Net", "VAT", "Gross", "Paid", "Credits applied", "Outstanding", "Status", "Margin", "Order", "Controlled Action"]}
        rows={data.customerInvoices.map((row) => [
          row.invoiceNo, row.customer, row.vessel, row.customerPoRef, fmtDate(row.invoiceDate), fmtDate(row.deliveryDate), fmtDate(row.dueDate), row.currency,
          fmtMoney(row.netAmount, row.currency), fmtMoney(row.vatAmount, row.currency), fmtMoney(row.grossAmount, row.currency),
          fmtMoney(row.paidAmount, row.currency), fmtMoney(row.creditedAmount, row.currency), fmtMoney(row.outstandingAmount, row.currency), <Status key="s" value={row.status === "Paid" && row.creditedAmount > 0 ? "Settled with credit" : row.status} />,
          row.marginPct === null ? "-" : `${row.marginPct.toFixed(1)}%`, row.linkedOrderRef,
          <ActionGroup key="a">
            <ActionButton label="Open invoice" onClick={() => window.open(`/api/v1/finance/customer-invoices/${row.id}/document`, "_blank", "noopener,noreferrer")} />
            {row.status === "Draft" && <ActionButton label="Review" busy={busyAction === `${row.id}:review`} onClick={() => onAction(`${row.id}:review`, `/api/v1/finance/customer-invoices/${row.id}/transition`, { action: "review" })} />}
            {(row.status === "Draft" || row.status === "Reviewed") && <ActionButton label="Post" busy={busyAction === `${row.id}:post`} onClick={() => onAction(`${row.id}:post`, `/api/v1/finance/customer-invoices/${row.id}/transition`, { action: "post" })} />}
            {row.status === "Posted" && <ActionButton label="Mark sent" busy={busyAction === `${row.id}:send`} onClick={() => onAction(`${row.id}:send`, `/api/v1/finance/customer-invoices/${row.id}/transition`, { action: "send" })} />}
            {row.outstandingAmount > 0 && !["Draft", "Reviewed", "Cancelled"].includes(row.status) && <ActionButton label="Record payment" busy={busyAction === `${row.id}:pay`} onClick={() => onRequestPayment(row)} />}
          </ActionGroup>,
        ])}
      />
      <div className="space-y-5">
        <UnbilledOrdersPanel rows={data.unbilledOrders} busyAction={busyAction} onAction={onAction} />
        <AgingPanel title="Receivables Aging" rows={data.aging.receivables} />
        <CompliancePanel />
      </div>
    </div>
  );
}

function PayablesLayer({ data, busyAction, onAction, canApprove }: { data: FinanceData; busyAction: string | null; onAction: (key: string, url: string, body?: Record<string, unknown>) => Promise<boolean>; canApprove: boolean }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <FinanceTable
        title="Supplier Invoice Matching"
        icon="rule"
        columns={["Supplier", "Invoice No.", "PO", "Expected", "Invoiced", "Variance", "VAT", "Due", "Match", "Approval", "Recommended", "Controlled Action"]}
        rows={data.supplierInvoices.map((row) => [
          row.supplier, row.supplierInvoiceNo, row.relatedPurchaseOrder, fmtMoney(row.expectedCost, row.currency), fmtMoney(row.invoicedCost, row.currency),
          fmtMoney(row.variance, row.currency), fmtMoney(row.vatAmount, row.currency), fmtDate(row.dueDate), <Status key="m" value={row.matchStatus} />,
          <Status key="a" value={row.approvalStatus} />, row.action,
          <ActionGroup key="d">
            {row.sourceDocumentId && <ActionButton label="Invoice evidence" onClick={() => void openNautexDocument(`/api/v1/finance/supplier-invoices/${row.id}/evidence`)} />}
            {canApprove && row.approvalStatus !== "Approved" && row.approvalStatus !== "Rejected" && <ActionButton label="Approve" busy={busyAction === `${row.id}:approve-supplier`} onClick={() => onAction(`${row.id}:approve-supplier`, `/api/v1/finance/supplier-invoices/${row.id}/decision`, { decision: "approve", version: row.version })} />}
            {canApprove && row.approvalStatus !== "Rejected" && <ActionButton label="Reject" tone="danger" busy={busyAction === `${row.id}:reject-supplier`} onClick={() => onAction(`${row.id}:reject-supplier`, `/api/v1/finance/supplier-invoices/${row.id}/decision`, { decision: "reject", version: row.version })} />}
          </ActionGroup>,
        ])}
      />
      <div className="space-y-5">
        <AgingPanel title="Supplier Invoice Aging (unpaid)" rows={data.aging.payables} />
        <section className="rounded-xl border border-outline-variant/20 bg-surface-container p-4">
          <h3 className="text-sm font-bold text-on-surface">Matching Rules</h3>
          <RuleRow label="Payment coverage" detail="Aging includes approved invoices less recorded, unreversed payments. Record payments and inspect balances in Payments & Reconciliation." />
          <RuleRow label="PO match" detail="Supplier invoice must link to a purchase order unless explicitly approved." />
          <RuleRow label="Variance control" detail="Price and quantity variance stay in review until a human approves." />
          <RuleRow label="Duplicate risk" detail="Supplier and invoice number are checked within your organization. Repeated requests cannot create another invoice." />
        </section>
      </div>
    </div>
  );
}

function MarginLayer({ rows }: { rows: MarginControlRow[] }) {
  const complete = rows.filter(row => row.calculationBasis.complete);
  const leakage = complete.filter((row) => row.marginVariance < 0);
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-4">
        <SummaryChip label="Orders Tracked" value={rows.length} tone="neutral" />
        <SummaryChip label="Below Target" value={leakage.length} tone={leakage.length ? "warn" : "ok"} />
        <SummaryChip label="Negative Margin" value={complete.filter((row) => row.marginPct < 0).length} tone={complete.some((row) => row.marginPct < 0) ? "danger" : "ok"} />
        <SummaryChip label="Avg Forecast Margin" value={complete.length ? `${(complete.reduce((sum, row) => sum + row.marginPct, 0) / complete.length).toFixed(1)}%` : "Not established"} tone="neutral" />
      </div>
      <FinanceTable
        title="Margin Control"
        icon="monitoring"
        columns={["Order", "Customer", "Vessel", "Revenue", "Supplier", "Freight", "Other", "Forecast Profit", "Margin", "Target", "Variance", "Status", "Basis / completeness"]}
        rows={rows.map((row) => [
          row.orderRef, row.customer, row.vessel, fmtMoney(row.revenue, row.currency), fmtMoney(row.supplierCost, row.currency), fmtMoney(row.freightDeliveryCost, row.currency),
          fmtMoney(row.otherCosts, row.currency), row.calculationBasis.complete ? fmtMoney(row.grossProfit, row.currency) : "Incomplete", row.calculationBasis.complete ? `${row.marginPct.toFixed(1)}%` : "—", `${row.targetMarginPct.toFixed(1)}%`,
          row.calculationBasis.complete ? `${row.marginVariance.toFixed(1)}%` : "—", <Status key="s" value={row.status} />, [...row.calculationBasis.issues, ...row.calculationBasis.supplierBasis, row.snapshotStale ? "Live calculation; saved snapshot needs refresh" : `Snapshot ${fmtDate(row.snapshotAt)}`].join("; "),
        ])}
      />
    </div>
  );
}

function CreditLayer({ rows, busyAction, onAction }: { rows: CreditNoteRow[]; busyAction: string | null; onAction: (key: string, url: string, body?: Record<string, unknown>) => Promise<boolean> }) {
  return (
    <FinanceTable
      title="Credit Notes"
      icon="assignment_return"
      columns={["Credit No.", "Original", "Customer", "Vessel", "Reason", "Net", "VAT", "Gross", "Status", "Created", "Approval", "Controlled Action"]}
      rows={rows.map((row) => [
        row.creditNoteNo, row.originalInvoiceNo, row.customer, row.vessel, row.reviewNote ?? labelize(row.reasonCode), fmtMoney(row.netAmount, row.currency),
        fmtMoney(row.vatAmount, row.currency), fmtMoney(row.grossAmount, row.currency), <Status key="s" value={row.status} />, fmtDate(row.createdDate), <Status key="a" value={row.approvalStatus} />,
        <ActionGroup key="a">
          {["Draft", "AwaitingApproval"].includes(row.status) && <ActionButton label="Approve" busy={busyAction === `${row.id}:approve-credit`} onClick={() => onAction(`${row.id}:approve-credit`, `/api/v1/finance/credit-notes/${row.id}/decision`, { decision: "approve" })} />}
          {row.status === "Approved" && <ActionButton label="Issue" busy={busyAction === `${row.id}:issue-credit`} onClick={() => onAction(`${row.id}:issue-credit`, `/api/v1/finance/credit-notes/${row.id}/decision`, { decision: "issue" })} />}
          {!["Issued", "Rejected"].includes(row.status) && <ActionButton label="Reject" tone="danger" busy={busyAction === `${row.id}:reject-credit`} onClick={() => onAction(`${row.id}:reject-credit`, `/api/v1/finance/credit-notes/${row.id}/decision`, { decision: "reject" })} />}
        </ActionGroup>,
      ])}
    />
  );
}

function ExceptionsLayer({ rows, busyAction, onAction }: { rows: FinanceExceptionRow[]; busyAction: string | null; onAction: (key: string, url: string, body?: Record<string, unknown>) => Promise<boolean> }) {
  return (
    <FinanceTable
      title="Finance Exceptions"
      icon="error"
      columns={["Type", "Severity", "Status", "Title", "Description", "Reference", "Created", "Controlled Action"]}
      rows={rows.map((row) => [
        labelize(row.type), row.severity, <Status key="s" value={row.status} />, row.title, row.description, row.reference, fmtDate(row.createdAt),
        <ActionGroup key="a">
          {row.status !== "Resolved" && row.status !== "Dismissed" && <ActionButton label="Resolve" busy={busyAction === `${row.id}:resolve`} onClick={() => onAction(`${row.id}:resolve`, `/api/v1/finance/exceptions/${row.id}/resolve`)} />}
        </ActionGroup>,
      ])}
    />
  );
}

function ExportAuditLayer({ exports, auditEvents, busyAction, onPrepareExport, onAction, canApprove }: { exports: ExportReadinessRow[]; auditEvents: FinanceAuditRow[]; busyAction: string | null; onPrepareExport: (row: ExportReadinessRow) => void; onAction: (key: string, url: string, body?: Record<string, unknown>) => Promise<boolean>; canApprove: boolean }) {
  return (
    <div className="space-y-5">
      <FinanceTable
        title="Accounting Export Readiness"
        icon="ios_share"
        columns={["Target", "Status", "Prepared/Exported", "Ready", "Blocked", "Validation Errors", "Controlled Action"]}
        rows={exports.map((row) => [
          `${labelize(row.target)}${row.periodFrom ? ` · ${row.periodFrom} to ${row.periodTo}` : " · legacy batch"}`, <Status key="s" value={row.status} />, fmtDate(row.lastExportDate), row.recordsReady, row.recordsBlocked,
          row.validationErrors.length ? row.validationErrors.join("; ") : "None",
          <ActionGroup key="a">
            {canApprove && (row.status === "Ready" || row.status === "Prepared") && row.recordsBlocked === 0 && <ActionButton label={row.status === "Prepared" ? "Download prepared CSV" : "Prepare local CSV"} busy={busyAction === `${row.id}:prepare-export`} onClick={() => onPrepareExport(row)} />}
            {canApprove && ["Ready", "Blocked"].includes(row.status) && <ActionButton label="Cancel unprepared batch" tone="danger" onClick={() => void onAction(`${row.id}:cancel`, "/api/v1/finance/export-readiness", { action: "cancel", id: row.id })} />}
            {((row.status !== "Ready" && row.status !== "Prepared") || row.recordsBlocked > 0) && <span className="text-[0.62rem] text-on-surface-variant">Resolve validation blocks first</span>}
          </ActionGroup>,
        ])}
      />
      <FinanceTable
        title="Finance Audit Trail"
        icon="history"
        columns={["Action", "Entity", "Reference", "Actor", "Timestamp", "Metadata"]}
        rows={auditEvents.map((row) => [
          labelize(row.action), row.entityType, row.entityRef, row.actorType, fmtDate(row.createdAt), row.metadataSummary,
        ])}
      />
    </div>
  );
}

function ControlsLayer({ compact = false }: { compact?: boolean }) {
  return (
    <section className="rounded-xl border border-outline-variant/20 bg-surface-container p-4">
      <h3 className="flex items-center gap-2 text-sm font-bold text-on-surface"><Icon name="psychology_alt" className="text-success" /> Finance Review Controls</h3>
      <p className="my-3 text-sm text-on-surface-variant">Review recorded exceptions and their source references. Posting, payments, credit notes and accounting exports use the existing reviewed Finance workflows.</p>
      {compact ? <a href="#agentMonitor" className="text-sm text-primary underline">Open agent execution controls</a> : <AgentControls agentId="finance_exception" agentName="Finance Exception Agent" onChanged={() => {}} />}
    </section>
  );
}

function Status({ value }: { value: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-[0.58rem] font-bold uppercase tracking-wider ${statusClass(value)}`}>{labelize(value)}</span>;
}

function ActionGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex min-w-[160px] flex-wrap gap-1.5">{children}</div>;
}

function ActionButton({ label, busy = false, tone = "primary", onClick }: { label: string; busy?: boolean; tone?: "primary" | "danger"; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className={`rounded-md border px-2 py-1 text-[0.58rem] font-bold uppercase tracking-wider disabled:opacity-50 ${
        tone === "danger" ? "border-error/30 text-error hover:bg-error/10" : "border-success/30 text-success hover:bg-success/10"
      }`}
    >
      {busy ? "Working" : label}
    </button>
  );
}

function PaymentDialog({
  draft,
  busy,
  onChange,
  onCancel,
  onSubmit,
}: {
  draft: PaymentDraft;
  busy: boolean;
  onChange: (draft: PaymentDraft) => void;
  onCancel: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const dialogRef = useDialogA11y<HTMLFormElement>(onCancel);
  const amount = Number(draft.amount);
  const validAmount = Number.isFinite(amount) && amount > 0 ? amount : 0;
  const remaining = Math.max(0, draft.invoice.outstandingAmount - validAmount);
  const isFullSettlement = validAmount > 0 && remaining === 0;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-lowest/80 p-4">
      <form
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Record payment for ${draft.invoice.invoiceNo}`}
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-xl border border-outline-variant/30 bg-surface-container p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[0.6rem] font-bold uppercase tracking-wider text-success">Record Payment</p>
            <h3 className="mt-1 text-base font-bold text-on-surface">{draft.invoice.invoiceNo}</h3>
            <p className="mt-1 text-xs text-on-surface-variant">
              Outstanding {fmtMoney(draft.invoice.outstandingAmount, draft.invoice.currency)} from {draft.invoice.customer}
            </p>
          </div>
          <button type="button" onClick={onCancel} className="rounded-md border border-outline-variant/30 px-2 py-1 text-xs font-bold text-secondary hover:border-error/40 hover:text-error">
            Close
          </button>
        </div>
        <label className="mt-5 block text-xs font-bold text-secondary">
          Amount
          <input
            type="number"
            min="0.01"
            step="0.01"
            max={draft.invoice.outstandingAmount}
            value={draft.amount}
            onChange={(event) => onChange({ ...draft, amount: event.target.value })}
            className="mt-2 w-full rounded-lg border border-outline-variant/30 bg-surface-lowest px-3 py-2 text-sm text-on-surface outline-none focus:border-success/50"
          />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border border-outline-variant/20 bg-surface-lowest px-3 py-2">
            <p className="text-[0.55rem] font-bold uppercase tracking-wider text-on-surface-variant">Remaining</p>
            <p className="mt-1 font-bold text-on-surface">{fmtMoney(remaining, draft.invoice.currency)}</p>
          </div>
          <div className={`rounded-lg border px-3 py-2 ${isFullSettlement ? "border-success/30 bg-success/10 text-success" : "border-warning/30 bg-warning/10 text-warning"}`}>
            <p className="text-[0.55rem] font-bold uppercase tracking-wider text-on-surface-variant">Result</p>
            <p className="mt-1 font-bold">{isFullSettlement ? "Full settlement" : "Partial payment"}</p>
          </div>
        </div>
        <label className="mt-4 block text-xs font-bold text-secondary">
          Payment reference
          <input
            type="text"
            value={draft.reference}
            onChange={(event) => onChange({ ...draft, reference: event.target.value })}
            className="mt-2 w-full rounded-lg border border-outline-variant/30 bg-surface-lowest px-3 py-2 text-sm text-on-surface outline-none focus:border-success/50"
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-outline-variant/30 px-3 py-2 text-xs font-bold text-secondary hover:border-on-surface/35">
            Cancel
          </button>
          <button type="submit" disabled={busy || validAmount <= 0 || validAmount > draft.invoice.outstandingAmount} className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs font-bold text-success disabled:opacity-50">
            {busy ? "Recording" : "Record payment"}
          </button>
        </div>
      </form>
    </div>
  );
}

function KpiCard({ kpi }: { kpi: FinanceKpi }) {
  return (
    <div className={`min-w-0 rounded-xl border bg-surface-container p-4 text-left ${toneClass(kpi.tone)}`}>
      <div className="text-[0.56rem] font-bold uppercase tracking-wider text-on-surface-variant">{kpi.label}</div>
      <div className="mt-2 break-words text-lg font-bold">{kpi.value}</div>
      <div className="mt-2 text-[0.65rem] leading-relaxed text-on-surface-variant">{kpi.detail}</div>
    </div>
  );
}

function FinanceTable({ title, icon, columns, rows }: { title: string; icon: string; columns: string[]; rows: Array<Array<React.ReactNode>> }) {
  return (
    <section className="overflow-hidden rounded-xl border border-outline-variant/20 bg-surface-container">
      <div className="flex items-center justify-between border-b border-outline-variant/20 px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-on-surface"><Icon name={icon} className="text-success" /> {title}</h3>
        <span className="text-[0.65rem] text-on-surface-variant">{rows.length} records</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] text-left text-xs">
          <thead className="bg-surface-lowest text-[0.56rem] uppercase tracking-wider text-on-surface-variant">
            <tr>{columns.map((column) => <th key={column} className="whitespace-nowrap px-3 py-2.5 font-bold">{column}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/10">
            {rows.map((row, index) => (
              <tr key={index} className="hover:bg-surface-high/45">
                {row.map((cell, cellIndex) => <td key={cellIndex} className="max-w-[280px] whitespace-nowrap px-3 py-3 text-secondary">{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <div className="p-8 text-center text-sm text-on-surface-variant">No finance records available.</div>}
    </section>
  );
}

function AgingPanel({ title, rows }: { title: string; rows: AgingBucket[] }) {
  const max = Math.max(...rows.map((row) => row.amount), 1);
  return (
    <section className="rounded-xl border border-outline-variant/20 bg-surface-container p-4">
      <h3 className="text-sm font-bold text-on-surface">{title}</h3>
      <div className="mt-4 space-y-3">
        {rows.map((row) => (
          <div key={`${row.currency}:${row.label}`}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-secondary">{row.label} · {row.currency ?? "Currency required"}</span>
              <span className="text-on-surface-variant">{fmtMoney(row.amount, row.currency)} / {row.count}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-lowest">
              <div className="h-full rounded-full bg-success" style={{ width: `${Math.max(4, (row.amount / max) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SummaryChip({ label, value, tone }: { label: string; value: string | number; tone: "neutral" | "ok" | "warn" | "danger" }) {
  const c = {
    neutral: "border-outline-variant/25 text-on-surface",
    ok: "border-success/35 text-success",
    warn: "border-warning/35 text-warning",
    danger: "border-error/35 text-error",
  }[tone];
  return (
    <div className={`rounded-lg border bg-surface-lowest px-3 py-2 ${c}`}>
      <p className="text-[0.55rem] font-bold uppercase tracking-wider text-on-surface-variant">{label}</p>
      <p className="mt-1 text-sm font-bold">{value}</p>
    </div>
  );
}

function WorkQueue({ title, icon, action, onClick, children }: { title: string; icon: string; action: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-outline-variant/20 bg-surface-container">
      <div className="flex items-center justify-between border-b border-outline-variant/20 px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-on-surface"><Icon name={icon} className="text-success" /> {title}</h3>
        <button onClick={onClick} className="text-[0.65rem] font-bold text-success">{action}</button>
      </div>
      <div className="space-y-2 p-4">{children}</div>
    </section>
  );
}

function QueueRow({ title, meta, tone }: { title: string; meta: string; tone: "warn" | "danger" }) {
  const c = tone === "danger" ? "border-error/25 text-error" : "border-warning/25 text-warning";
  return (
    <div className={`rounded-lg border bg-surface-lowest p-3 ${c}`}>
      <p className="text-xs font-bold">{title}</p>
      <p className="mt-1 text-[0.65rem] text-on-surface-variant">{meta}</p>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-outline-variant/35 bg-surface-lowest/45 p-5 text-center text-xs text-on-surface-variant">{text}</div>;
}

function ControlStatus({ label, value, alert }: { label: string; value: string | number; alert: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-surface-lowest px-3 py-2 text-xs">
      <span className="text-on-surface-variant">{label}</span>
      <span className={alert ? "font-bold text-warning" : "font-bold text-success"}>{value}</span>
    </div>
  );
}

function CompliancePanel() {
  const fields = ["Seller legal entity", "Seller VAT ID", "Seller KVK", "Customer identity", "Customer PO ref", "Vessel/IMO", "Line VAT totals", "Payment reference"];
  return (
    <section className="rounded-xl border border-outline-variant/20 bg-surface-container p-4">
      <h3 className="text-sm font-bold text-on-surface">Invoice fields to review</h3>
      <p className="mt-2 text-sm text-on-surface-variant">Required review areas; this list does not certify an invoice or its tax treatment.</p>
      <div className="mt-4 grid gap-2">
        {fields.map((field) => (
          <div key={field} className="flex items-center gap-2 rounded-lg bg-surface-lowest px-3 py-2 text-xs text-secondary">
            <Icon name="radio_button_unchecked" className="text-sm text-outline" />
            <span>{field}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function UnbilledOrdersPanel({ rows, busyAction, onAction }: { rows: UnbilledOrderRow[]; busyAction: string | null; onAction: (key: string, url: string, body?: Record<string, unknown>) => Promise<boolean> }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [reason, setReason] = useState("");
  return (
    <section className="rounded-xl border border-outline-variant/20 bg-surface-container p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-on-surface">Unbilled Delivered Orders</h3>
        <span className="text-[0.65rem] text-on-surface-variant">{rows.length} orders</span>
      </div>
      <div className="mt-4 space-y-2">
        {rows.length === 0 && <EmptyState text="No delivered orders are waiting for invoicing." />}
        {rows.map((row) => (
          <div key={row.id} className="rounded-lg border border-outline-variant/20 bg-surface-lowest p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-bold text-on-surface">{row.orderRef}</p>
                <p className="mt-1 text-[0.65rem] text-on-surface-variant">{row.buyer} | {row.vessel} | {fmtMoney(row.amount, row.currency)}</p>
              </div>
              <ActionButton
                label="Create draft"
                busy={busyAction === `${row.id}:create-invoice`}
                onClick={() => { setSelected(row.id); setCategory(""); setReason(""); }}
              />
            </div>
            {selected === row.id && <form aria-label="Invoice tax review" className="mt-3 space-y-3 text-sm" onSubmit={async event => { event.preventDefault(); if (await onAction(`${row.id}:create-invoice`, "/api/v1/finance/customer-invoices/from-order", { orderId: row.id, taxReview: { category, reason } })) setSelected(null); }}>
              <p>Review the VAT treatment with your responsible finance person. Nautex does not determine it from the customer country. This draft uses one treatment for all lines; stop if another rate or mixed treatment is needed.</p>
              <label className="block">VAT treatment<select required value={category} disabled={Boolean(busyAction)} onChange={event => setCategory(event.target.value)} className="mt-1 block w-full rounded border border-outline-variant/30 bg-surface-base p-2"><option value="">Select reviewed treatment</option>{INVOICE_TAX_OPTIONS.map(option => <option key={option.category} value={option.category}>{option.label}</option>)}</select></label>
              <label className="block">Review basis<textarea required minLength={10} maxLength={1000} value={reason} disabled={Boolean(busyAction)} onChange={event => setReason(event.target.value)} className="mt-1 block w-full rounded border border-outline-variant/30 bg-surface-base p-2" /></label>
              <div className="flex gap-3"><button disabled={Boolean(busyAction)} className="rounded bg-primary px-3 py-2 font-semibold text-on-primary">Create reviewed draft</button><button type="button" disabled={Boolean(busyAction)} onClick={() => setSelected(null)}>Cancel</button></div>
            </form>}
          </div>
        ))}
      </div>
    </section>
  );
}

function RuleRow({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="mt-3 rounded-lg border border-outline-variant/20 bg-surface-lowest p-3">
      <p className="text-xs font-bold text-secondary">{label}</p>
      <p className="mt-1 text-[0.65rem] leading-relaxed text-on-surface-variant">{detail}</p>
    </div>
  );
}
