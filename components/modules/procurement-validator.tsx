"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReviewNotice } from "@/components/ui/review-notice";
import { SourceDocumentDownload } from "@/components/ui/source-document-download";
import type {
  NormalizedProcurementLine,
  ProcurementDocumentRole,
  ProcurementValidationResults,
  ProcurementValidationType,
  ValidationLineStatus,
} from "@/types/procurement";

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined ${className}`} style={{ fontVariationSettings: "'FILL' 0" }}>
      {name}
    </span>
  );
}

const VALIDATION_TYPES: Array<{ value: ProcurementValidationType; label: string; left: string; right: string }> = [
  { value: "supplier_quote_vs_purchase_order", label: "Quote vs PO", left: "Supplier Quote", right: "Purchase Order" },
  { value:"supplier_quote_vs_rfq",label:"Quote vs RFQ",left:"Supplier Quote",right:"Reviewed RFQ" },
  { value: "supplier_confirmation_vs_purchase_order", label: "Confirmation vs PO", left: "Supplier Confirmation", right: "Purchase Order" },
  { value: "supplier_invoice_vs_purchase_order", label: "Invoice vs PO", left: "Supplier Invoice", right: "Purchase Order" },
  { value: "supplier_invoice_vs_goods_receipt", label: "Invoice vs Receipt", left: "Supplier Invoice", right: "Goods Receipt" },
  { value: "customer_po_vs_nautex_quote", label: "Customer PO vs Quote", left: "Customer PO", right: "Nautex Quote" },
  { value: "agreement_price_vs_supplier_price", label: "Agreement vs Supplier Price", left: "Agreement", right: "Supplier Quote / PO" },
  { value: "delivered_items_vs_ordered_items", label: "Delivered vs Ordered", left: "Goods Receipt", right: "Purchase Order" },
];

const ROLE_LABELS: Record<ProcurementDocumentRole, string> = {
  rfq:"Reviewed RFQ",
  supplier_quote: "Supplier Quote",
  purchase_order: "Purchase Order",
  supplier_confirmation: "Supplier Confirmation",
  supplier_invoice: "Supplier Invoice",
  goods_receipt: "Goods Receipt",
  customer_po: "Customer PO",
  nautex_quote: "Nautex Quote",
  sales_order: "Sales Order",
  agreement: "Agreement",
};

const STATUS_STYLE: Record<ValidationLineStatus, string> = {
  Matched: "bg-success-dim/10 text-success",
  "Partial Match": "bg-warning/10 text-warning",
  "Description Mismatch": "bg-warning/10 text-warning",
  "Quantity Variance": "bg-warning/10 text-warning",
  "Unit Variance": "bg-warning/10 text-warning",
  "Price Variance": "bg-error/10 text-error",
  "Currency Mismatch": "bg-error/10 text-error",
  "Missing Line": "bg-error/10 text-error",
  "Extra Line": "bg-error/10 text-error",
  "Missing Reference": "bg-warning/10 text-warning",
  "Delivery Date Variance": "bg-warning/10 text-warning",
  "Agreement Price Mismatch": "bg-error/10 text-error",
  "Duplicate Risk": "bg-warning/10 text-warning",
  "Needs Review": "bg-warning/10 text-warning",
  Approved: "bg-success-dim/10 text-success",
  Rejected: "bg-error/10 text-error",
  Blocked: "bg-error/10 text-error",
};

const RISK_STYLE = {
  low: "text-success",
  medium: "text-warning",
  high: "text-error",
};

function displayStatus(status: ValidationLineStatus) {
  if (status === "Extra Line") return "Right source only";
  if (status === "Missing Line") return "Left source only";
  return status;
}

function statusDescription(status: ValidationLineStatus) {
  if (status === "Extra Line") return "Right source line is absent from the left source.";
  if (status === "Missing Line") return "Left source line is absent from the right source.";
  if (status === "Price Variance") return "Unit price differs between the sources.";
  if (status === "Quantity Variance") return "Quantity differs between the sources.";
  return "Review before approval or downstream action.";
}

type SelectorContext = {
  purchaseOrders: Array<{
    id: string;
    poNumber: string;
    vessel: string;
    supplier: string;
    currency: string;
    total: number;
    status: string;
  }>;
};

type HistoryRow = {
  id: string;
  quoteFileName: string | null;
  poFileName: string | null;
  createdAt: string;
  status: string;
  source?: string | null;
  counts?: {
    matched: number;
    mismatched: number;
    added: number;
    missing: number;
    priceVariance: number;
    quantityVariance: number;
  };
  summary?: {
    validationType?: ProcurementValidationType;
    documentStatus?: ValidationLineStatus;
    summary?: ProcurementValidationResults["summary"];
    humanReview?: { status?: string };
  };
};

function fileToBase64(file: File): Promise<{ name: string; data: string; mimeType: string; size: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Failed to read file."));
        return;
      }
      const [header, data] = reader.result.split(",");
      resolve({
        name: file.name,
        data: data || "",
        mimeType: header.match(/:(.*?);/)?.[1] || file.type || "application/octet-stream",
        size: file.size,
      });
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
  });
}

function money(value: number | null | undefined, currency?: string | null) {
  if (value === null || value === undefined) return "--";
  return `${currency || ""} ${value.toFixed(2)}`.trim();
}

function qty(value: number | null | undefined, unit?: string | null) {
  if (value === null || value === undefined) return "--";
  return `${value}${unit ? ` ${unit}` : ""}`;
}

function describeLine(line: NormalizedProcurementLine | null) {
  if (!line) return "--";
  const ref = line.itemReference || line.makerPartNumber || line.impaCode;
  return ref ? `${ref} / ${line.description}` : line.description;
}

function tableDescription(leftLine: NormalizedProcurementLine | null, rightLine: NormalizedProcurementLine | null) {
  const line = rightLine ?? leftLine;
  return describeLine(line);
}

function validationTypeLabel(value?: ProcurementValidationType) {
  return VALIDATION_TYPES.find((type) => type.value === value)?.label ?? "Quote vs PO";
}

function historyCounts(run: HistoryRow) {
  const summary = run.summary?.summary;
  return {
    matched: run.counts?.matched ?? summary?.matchedLines ?? 0,
    mismatched: run.counts?.mismatched ?? summary?.discrepancies ?? 0,
    added: run.counts?.added ?? summary?.extraLines ?? 0,
    missing: run.counts?.missing ?? summary?.missingLines ?? 0,
    priceVariance: run.counts?.priceVariance ?? 0,
    quantityVariance: run.counts?.quantityVariance ?? 0,
  };
}

function historyReviewStatus(run: HistoryRow) {
  return run.summary?.humanReview?.status || run.summary?.documentStatus || run.status || "Pending Review";
}

function historySourceLabel(run: HistoryRow) {
  return `${run.quoteFileName || "Left source"} vs ${run.poFileName || "Right source"}`;
}

function formatRunDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ProcurementValidatorModule() {
  const [validationType, setValidationType] = useState<ProcurementValidationType>("supplier_quote_vs_purchase_order");
  const [leftFile, setLeftFile] = useState<File | null>(null);
  const [rightFile, setRightFile] = useState<File | null>(null);
  const [leftText, setLeftText] = useState("");
  const [rightText, setRightText] = useState("");
  const [rfqContext,setRfqContext]=useState<string|null>(null);
  const [rightRecordId, setRightRecordId] = useState("");
  const [useRightRecord, setUseRightRecord] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isCreatingExceptions, setIsCreatingExceptions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ProcurementValidationResults | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [context, setContext] = useState<SelectorContext>({ purchaseOrders: [] });
  const [activeStatus, setActiveStatus] = useState<ValidationLineStatus | "All" | "Differences">("Differences");
  const [selectedHistoryRunId, setSelectedHistoryRunId] = useState<string | null>(null);
  const [isOpeningHistory, setIsOpeningHistory] = useState(false);
  const [pendingClearHistory, setPendingClearHistory] = useState(false);

  const selectedType = useMemo(() => VALIDATION_TYPES.find((item) => item.value === validationType) ?? VALIDATION_TYPES[0], [validationType]);
  const rightSideCanUsePoRecord = selectedType.right === "Purchase Order";

  const loadHistory = useCallback(async () => {
    const res = await fetch("/api/v1/procurement/validate?limit=6");
    const payload = await res.json();
    if (payload.data) setHistory(payload.data);
  }, []);

  const loadContext = useCallback(async () => {
    const res = await fetch("/api/v1/procurement/validate?context=selectors");
    const payload = await res.json();
    if (payload.data) setContext({ purchaseOrders: payload.data.purchaseOrders ?? [] });
  }, []);

  useEffect(() => {
    loadHistory().catch(() => undefined);
    loadContext().catch(() => undefined);
  }, [loadContext, loadHistory]);

  useEffect(() => {
    if (!rightSideCanUsePoRecord) setUseRightRecord(false);
  }, [rightSideCanUsePoRecord]);

  const clearHistory = useCallback(async () => {
    if (!pendingClearHistory) {
      setPendingClearHistory(true);
      return;
    }

    const res = await fetch("/api/v1/procurement/validate", { method: "DELETE" });
    if (res.ok) {
      setHistory([]);
      setSelectedHistoryRunId(null);
      setPendingClearHistory(false);
    }
  }, [pendingClearHistory]);

  const openHistoryRun = useCallback(async (id: string) => {
    setIsOpeningHistory(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/procurement/validate?id=${encodeURIComponent(id)}`);
      const payload = await res.json();
      if (!res.ok || payload.ok === false) throw new Error(payload.error?.message ?? "Could not reopen validation run.");
      setResults(payload.data);
      if (payload.data?.validationType) setValidationType(payload.data.validationType);
      setSelectedHistoryRunId(id);
      setActiveStatus("Differences");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reopen validation run.");
    } finally {
      setIsOpeningHistory(false);
    }
  }, []);

  useEffect(()=>{
    const id=decodeURIComponent(window.location.hash.split(":").slice(1).join(":"));
    if(!id) return;
    let alive=true;
    fetch(`/api/v1/rfqs/${encodeURIComponent(id)}`).then(async response=>{
      const payload=await response.json();
      if(!response.ok || payload.data?.review?.status !== "confirmed") throw new Error("Reopen and confirm the source RFQ before comparing.");
      if(alive){setRfqContext(id);setValidationType("supplier_quote_vs_rfq");setRightText("Saved, reviewed RFQ " + id);setError(null);}
    }).catch(e=>{if(alive)setError(e.message);});
    return ()=>{alive=false;};
  },[]);
  const canValidate = Boolean((leftFile || leftText.trim()) && ((useRightRecord && rightRecordId) || rightFile || rightText.trim()));

  const handleValidate = useCallback(async () => {
    if (!canValidate) {
      setError("Provide both validation sides before running Validator.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setResults(null);
    setActiveStatus("Differences");
    setSelectedHistoryRunId(null);

    try {
      const [leftPayload, rightPayload] = await Promise.all([
        leftFile ? fileToBase64(leftFile) : Promise.resolve(null),
        rightFile && !useRightRecord ? fileToBase64(rightFile) : Promise.resolve(null),
      ]);

      const res = await fetch("/api/v1/procurement/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          validationType,
          leftFile: leftPayload,
          rightFile: rightPayload,
          leftText,
          rightText: useRightRecord ? "" : rightText,
          rightRecordType: rfqContext ? "rfq" : useRightRecord ? "purchase_order" : null,
          rightRecordId: rfqContext ?? (useRightRecord ? rightRecordId : null),
        }),
      });
      const payload = await res.json();
      if (!res.ok || payload.ok === false) throw new Error(payload.error?.message ?? "Validation failed.");
      setResults(payload.data);
      setSelectedHistoryRunId(null);
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation failed.");
    } finally {
      setIsLoading(false);
    }
  }, [rfqContext, canValidate, leftFile, leftText, loadHistory, rightFile, rightRecordId, rightText, useRightRecord, validationType]);

  const handleReview = useCallback(async (action: "approve" | "reject" | "block") => {
    if (!results?.validationRunId) return;
    setIsReviewing(true);
    try {
      const res = await fetch("/api/v1/procurement/validate", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: results.validationRunId, action, reviewedBy: "operator" }),
      });
      const payload = await res.json();
      if (!res.ok || payload.ok === false) throw new Error(payload.error?.message ?? "Review update failed.");
      setResults(payload.data);
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review update failed.");
    } finally {
      setIsReviewing(false);
    }
  }, [loadHistory, results?.validationRunId]);

  const handleCreateExceptions = useCallback(async () => {
    if (!results?.validationRunId) return;
    setIsCreatingExceptions(true);
    try {
      const res = await fetch("/api/v1/procurement/validate", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: results.validationRunId, action: "create_exceptions", reviewedBy: "operator" }),
      });
      const payload = await res.json();
      if (!res.ok || payload.ok === false) throw new Error(payload.error?.message ?? "Exception creation failed.");
      setResults((current) => current ? {
        ...current,
        exceptionDrafts: current.exceptionDrafts.map((draft) => ({ ...draft, status: "Created" as const })),
      } : current);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Exception creation failed.");
    } finally {
      setIsCreatingExceptions(false);
    }
  }, [results?.validationRunId]);

  const filteredResults = useMemo(() => {
    if (!results) return [];
    if (activeStatus === "Differences") return results.comparisonResults.filter(row=>row.statuses.some(status=>status !== "Matched"));
    if (activeStatus === "All") return results.comparisonResults;
    return results.comparisonResults.filter((item) => item.statuses.includes(activeStatus));
  }, [activeStatus, results]);

  const statusFilters = useMemo(() => {
    if (!results) return [];
    const statuses = new Set<ValidationLineStatus>();
    results.comparisonResults.forEach((item) => item.statuses.forEach((status) => statuses.add(status)));
    return Array.from(statuses);
  }, [results]);

  return (
    <div className="space-y-6 max-w-none">
      {error ? (
        <div className="rounded-xl border border-error/30 bg-error-container/20 p-4 text-sm text-error flex items-center gap-3">
          <Icon name="error" />
          {error}
        </div>
      ) : null}

      <section className="bg-surface-container rounded-xl p-5 border border-outline-variant/20">
        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-sm font-bold flex items-center gap-2">
              <Icon name="rule_settings" className="text-success text-lg" />
              Procurement Validation
            </h3>
            <p className="mt-1 text-[0.7rem] text-on-surface-variant">Deterministic comparison with advisory AI availability kept behind Nautex controls.</p>
          </div>
          <span className={`w-fit rounded-lg px-2.5 py-1 text-[0.65rem] font-bold ${results ? STATUS_STYLE[results.documentStatus] : "bg-surface-lowest text-on-surface-variant"}`}>
            {results ? results.documentStatus : "Awaiting Input"}
          </span>
        </div>

        <div className="mb-5 flex flex-wrap gap-2">
          {VALIDATION_TYPES.map((type) => (
            <button
              key={type.value}
              onClick={() => {
                setRfqContext(null);
                setValidationType(type.value);
                setResults(null);
                setSelectedHistoryRunId(null);
                setLeftFile(null);
                setRightFile(null);
                setLeftText("");
                setRightText("");
                setRightRecordId("");
                setUseRightRecord(false);
              }}
              className={`rounded-lg px-3 py-2 text-[0.68rem] font-bold transition-colors ${
                validationType === type.value ? "bg-success text-on-primary" : "bg-surface-lowest text-on-surface-variant hover:bg-surface-high"
              }`}
            >
              {type.label}
            </button>
          ))}
        </div>

        <HistoryPanel
          history={history}
          selectedRunId={selectedHistoryRunId}
          isOpening={isOpeningHistory}
          pendingClear={pendingClearHistory}
          onOpen={openHistoryRun}
          onClear={() => void clearHistory()}
        />

        {!results ? (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <ValidationInputPanel
              title={selectedType.left}
              file={leftFile}
              text={leftText}
              onFile={(file) => { setLeftFile(file); setLeftText(""); }}
              onText={(text) => { setLeftText(text); if (text.trim()) setLeftFile(null); }}
              onClear={() => setLeftFile(null)}
            />
            <div className="space-y-3">
              {rightSideCanUsePoRecord && context.purchaseOrders.length > 0 ? (
                <div className="rounded-xl border border-outline-variant/20 bg-surface-lowest p-3">
                  <label className="mb-2 flex items-center gap-2 text-xs font-semibold text-secondary">
                    <input
                      type="checkbox"
                      checked={useRightRecord}
                      onChange={(event) => setUseRightRecord(event.target.checked)}
                      className="h-4 w-4 accent-success"
                    />
                    Existing Nautex PO
                  </label>
                  <select
                    aria-label="Existing Nautex purchase order"
                    value={rightRecordId}
                    onChange={(event) => setRightRecordId(event.target.value)}
                    disabled={!useRightRecord}
                    className="w-full rounded-lg border border-outline-variant/30 bg-surface-container px-3 py-2 text-xs text-on-surface outline-none disabled:opacity-50"
                  >
                    <option value="">Select purchase order</option>
                    {context.purchaseOrders.map((po) => (
                      <option key={po.id} value={po.id}>{po.poNumber} / {po.vessel} / {po.supplier}</option>
                    ))}
                  </select>
                </div>
              ) : null}
              <ValidationInputPanel
                title={selectedType.right}
                file={rightFile}
                text={rightText}
                onFile={(file) => { setRightFile(file); setRightText(""); }}
                onText={(text) => { setRightText(text); if (text.trim()) setRightFile(null); }}
                onClear={() => setRightFile(null)}
                disabled={!!rfqContext || (useRightRecord && rightSideCanUsePoRecord)}
              />
            </div>
          </div>
        ) : (
          <ResultsView
            results={results}
            activeStatus={activeStatus}
            statusFilters={statusFilters}
            filteredResults={filteredResults}
            isHistoricalView={Boolean(selectedHistoryRunId)}
            onStatus={setActiveStatus}
            onNew={() => { setResults(null); setSelectedHistoryRunId(null); setLeftFile(null); setRightFile(null); setLeftText(""); setRightText(""); setActiveStatus("Differences"); }}
            onReview={handleReview}
            onCreateExceptions={handleCreateExceptions}
            isReviewing={isReviewing}
            isCreatingExceptions={isCreatingExceptions}
          />
        )}

        {!results ? (
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-[0.68rem] text-on-surface-variant">
              {useRightRecord && rightSideCanUsePoRecord ? "Right side is linked to the selected purchase order record." : "Upload or paste extractable source content for both sides."}
            </div>
            <button
              onClick={handleValidate}
              disabled={!canValidate || isLoading}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-success px-4 py-2.5 text-sm font-semibold text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Icon name={isLoading ? "sync" : "fact_check"} className={`text-lg ${isLoading ? "animate-spin" : ""}`} />
              Run Validation
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function HistoryPanel({
  history,
  selectedRunId,
  isOpening,
  pendingClear,
  onOpen,
  onClear,
}: {
  history: HistoryRow[];
  selectedRunId: string | null;
  isOpening: boolean;
  pendingClear: boolean;
  onOpen: (id: string) => void;
  onClear: () => void;
}) {
  return (
    <section className="mb-5 rounded-xl border border-outline-variant/20 bg-surface-lowest p-4">
      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h4 className="text-xs font-bold text-on-surface flex items-center gap-2">
            <Icon name="history" className="text-success text-lg" />
            Validation History
          </h4>
          <p className="mt-1 text-[0.65rem] text-on-surface-variant">Recent runs reopen in this workspace and do not reduce table width.</p>
        </div>
        {history.length > 0 ? (
          <button
            onClick={onClear}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[0.65rem] font-bold ${
              pendingClear ? "bg-error-container/30 text-error" : "bg-surface-container text-on-surface-variant hover:text-error"
            }`}
          >
            <Icon name={pendingClear ? "warning" : "delete_sweep"} className="text-base" />
            {pendingClear ? "Confirm clear history" : "Clear History"}
          </button>
        ) : null}
      </div>

      {history.length === 0 ? (
        <div className="rounded-lg border border-dashed border-outline-variant/30 bg-surface-container p-3 text-xs text-on-surface-variant">
          No validation runs saved yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="flex min-w-full gap-3 pb-1">
            {history.map((run) => {
              const counts = historyCounts(run);
              const selected = selectedRunId === run.id;
              return (
                <button
                  key={run.id}
                  type="button"
                  data-testid="validation-history-run"
                  onClick={() => onOpen(run.id)}
                  disabled={isOpening}
                  className={`min-w-[280px] max-w-[360px] flex-1 rounded-xl border p-3 text-left transition-colors disabled:opacity-60 ${
                    selected ? "border-success/60 bg-surface-low" : "border-outline-variant/20 bg-surface-container hover:border-success/35"
                  }`}
                >
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-on-surface">{validationTypeLabel(run.summary?.validationType)}</p>
                      <p className="mt-1 truncate text-[0.65rem] text-on-surface-variant">{historySourceLabel(run)}</p>
                    </div>
                    <span className={`shrink-0 rounded-md px-2 py-0.5 text-[0.55rem] font-bold ${selected ? "bg-success text-on-primary" : "bg-surface-lowest text-success"}`}>
                      {historyReviewStatus(run)}
                    </span>
                  </div>
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-[0.62rem] text-on-surface-variant">
                    <span className="inline-flex items-center gap-1">
                      <Icon name="schedule" className="text-sm" />
                      {formatRunDate(run.createdAt)}
                    </span>
                    <span>{run.source || "manual"}</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <HistoryMetric label="Matched" value={counts.matched} />
                    <HistoryMetric label="Added" value={counts.added} tone="text-success" />
                    <HistoryMetric label="Missing" value={counts.missing} tone="text-error" />
                    <HistoryMetric label="Variance" value={counts.priceVariance + counts.quantityVariance} tone="text-warning" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function HistoryMetric({ label, value, tone = "text-on-surface" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg bg-surface-lowest px-2 py-1.5">
      <p className={`text-sm font-bold ${tone}`}>{value}</p>
      <p className="mt-0.5 truncate text-[0.52rem] uppercase tracking-wide text-on-surface-variant">{label}</p>
    </div>
  );
}

function ValidationInputPanel({
  title,
  file,
  text,
  onFile,
  onText,
  onClear,
  disabled = false,
}: {
  title: string;
  file: File | null;
  text: string;
  onFile: (file: File) => void;
  onText: (text: string) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file && inputRef.current) inputRef.current.value = "";
  }, [file]);

  return (
    <div className={`rounded-xl border border-outline-variant/20 bg-surface-lowest p-3 ${disabled ? "opacity-45" : ""}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="text-xs font-semibold text-secondary">{title}</h4>
        {file ? (
          <button onClick={onClear} disabled={disabled} className="rounded-md p-1 text-on-surface-variant hover:text-on-surface disabled:pointer-events-none">
            <Icon name="close" className="text-lg" />
          </button>
        ) : null}
      </div>

      {file ? (
        <div className="mb-3 flex items-center gap-2 overflow-hidden rounded-lg border border-success/25 bg-surface-container p-3">
          <Icon name="description" className="shrink-0 text-success text-lg" />
          <span className="truncate text-sm text-on-surface">{file.name}</span>
        </div>
      ) : (
        <>
          <input
            ref={inputRef}
            type="file"
            accept=".txt,.csv,.log,.pdf,.xlsx,.xls,.docx"
            onChange={(event) => {
              const selected = event.currentTarget.files?.[0];
              if (selected) onFile(selected);
              event.currentTarget.value = "";
            }}
            className="hidden"
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (!disabled && event.dataTransfer.files?.[0]) onFile(event.dataTransfer.files[0]);
            }}
            className="mb-3 w-full rounded-xl border-2 border-dashed border-outline-variant/50 p-6 text-center transition-colors hover:border-success/50 disabled:pointer-events-none"
          >
            <Icon name="cloud_upload" className="mb-2 text-on-surface-variant text-3xl" />
            <p className="text-xs text-on-surface-variant">PDF, XLSX, DOCX, CSV, TXT</p>
          </button>
        </>
      )}

      <textarea
        value={text}
        onChange={(event) => onText(event.target.value)}
        disabled={disabled}
        rows={5}
        placeholder="Paste table or document text"
        className="w-full resize-none rounded-lg border border-outline-variant/30 bg-surface-container p-3 text-xs leading-relaxed text-on-surface outline-none placeholder:text-on-surface-variant disabled:pointer-events-none"
      />
    </div>
  );
}

function ResultsView({
  results,
  activeStatus,
  statusFilters,
  filteredResults,
  isHistoricalView,
  onStatus,
  onNew,
  onReview,
  onCreateExceptions,
  isReviewing,
  isCreatingExceptions,
}: {
  results: ProcurementValidationResults;
  activeStatus: ValidationLineStatus | "All" | "Differences";
  statusFilters: ValidationLineStatus[];
  filteredResults: ProcurementValidationResults["comparisonResults"];
  isHistoricalView: boolean;
  onStatus: (status: ValidationLineStatus | "All" | "Differences") => void;
  onNew: () => void;
  onReview: (action: "approve" | "reject" | "block") => void;
  onCreateExceptions: () => void;
  isReviewing: boolean;
  isCreatingExceptions: boolean;
}) {
  const addedLines = results.comparisonResults.filter((item) => item.statuses.includes("Extra Line"));
  const missingLines = results.comparisonResults.filter((item) => item.statuses.includes("Missing Line"));
  const quantityChanges = results.comparisonResults.filter((item) => item.statuses.includes("Quantity Variance"));
  const priceChanges = results.comparisonResults.filter((item) => item.statuses.includes("Price Variance") || item.statuses.includes("Agreement Price Mismatch"));
  const compoundChanges = results.comparisonResults.filter((item) => item.statuses.includes("Quantity Variance") && (item.statuses.includes("Price Variance") || item.statuses.includes("Agreement Price Mismatch")));
  const firstAddedLine = addedLines[0]?.rightLine;
  const rightLabel = results.validationType === "supplier_quote_vs_rfq" ? "RFQ" : "PO";

  return (
    <div className="space-y-5">
      {isHistoricalView ? (
        <div className="rounded-xl border border-success/20 bg-surface-low p-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-center gap-2">
              <Icon name="history" className="shrink-0 text-success text-lg" />
              <div className="min-w-0">
                <p className="text-xs font-bold text-on-surface">Viewing past validation</p>
                <p className="mt-0.5 truncate text-[0.65rem] text-on-surface-variant">
                  Generated {new Date(results.auditMetadata.generatedAt).toLocaleString()} / {validationTypeLabel(results.validationType)}
                </p>
              </div>
            </div>
            <span className="w-fit rounded-lg bg-surface-lowest px-2.5 py-1 text-[0.65rem] font-bold text-success">
              {results.reviewStatus}
            </span>
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-success/15 bg-surface-lowest p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <ReviewNotice title="Analysis Complete">Review decision: {results.reviewStatus}. Deterministic comparisons do not approve or execute a business action.</ReviewNotice>
            <h4 className="mt-1 text-lg font-bold text-on-surface">
              {addedLines.length > 0
                ? `${addedLines.length} ${rightLabel} line${addedLines.length === 1 ? "" : "s"} have no corresponding quotation line`
                : `${results.summary.totalLinesCompared} line${results.summary.totalLinesCompared === 1 ? "" : "s"} compared`}
            </h4>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-secondary">
              {addedLines.length > 0
                ? `These ${rightLabel} lines do not exist in the supplier quotation and require review before approval, supplier communication, or finance matching.`
                : results.summary.recommendedNextAction}
            </p>
            {firstAddedLine ? (
              <p className="mt-2 text-[0.68rem] text-on-surface-variant">
                First added line: <span className="text-on-surface">{firstAddedLine.lineNumber ?? "--"} / {firstAddedLine.description}</span>
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {addedLines.length > 0 ? (
              <button
                onClick={() => onStatus("Extra Line")}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-success px-3 py-2 text-[0.68rem] font-bold text-on-primary"
              >
                <Icon name="add_circle" className="text-base" />
                Show Added Lines
              </button>
            ) : null}
            <button onClick={onNew} className="inline-flex items-center gap-1.5 rounded-lg bg-surface-container px-3 py-2 text-[0.68rem] font-bold text-on-surface-variant hover:text-on-surface">
              <Icon name="restart_alt" className="text-base" /> New Validation
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          { label: `${rightLabel} only`, value: addedLines.length, helper: "not in quote", icon: "add_circle", tone: "border-success", status: "Extra Line" as const },
          { label: `Missing from ${rightLabel}`, value: missingLines.length, helper: "quoted only", icon: "remove_circle", tone: "border-error", status: "Missing Line" as const },
          { label: "Qty Changes", value: quantityChanges.length, helper: "quantity differs", icon: "swap_vert", tone: "border-warning", status: "Quantity Variance" as const },
          { label: "Price Changes", value: priceChanges.length, helper: "price differs", icon: "trending_up", tone: "border-warning", status: "Price Variance" as const },
          { label: "Compound", value: compoundChanges.length, helper: "qty + price", icon: "warning", tone: "border-warning", status: "All" as const },
        ].map((item) => (
          <button
            key={item.label}
            onClick={() => onStatus(item.status)}
            className={`rounded-xl bg-surface-lowest p-4 border-l-4 text-left transition-colors hover:bg-surface-low ${item.tone}`}
          >
            <p className="mb-1 text-[0.6rem] font-bold uppercase tracking-wider text-on-surface-variant">{item.label}</p>
            <div className="flex items-end justify-between gap-2">
              <span className="truncate text-xl font-bold text-on-surface">{item.value}</span>
              <Icon name={item.icon} className="text-xl text-on-surface-variant" />
            </div>
            <p className="mt-1 text-[0.6rem] uppercase tracking-wide text-on-surface-variant">{item.helper}</p>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.48fr)]">
        <div className="rounded-xl border border-outline-variant/20 bg-surface-lowest p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h4 className="text-xs font-bold text-on-surface flex items-center gap-2">
              <Icon name="insights" className="text-success text-lg" />
              Key Findings
            </h4>
            <span className={`rounded-lg px-2.5 py-1 text-[0.65rem] font-bold ${STATUS_STYLE[results.documentStatus]}`}>
              {results.summary.readinessStatus}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <FindingCard
              title="Expanded scope in purchase order"
              impact={addedLines.length > 0 ? "HIGH" : "LOW"}
              icon="add_circle"
              text={addedLines.length > 0 ? `${addedLines.length} ${rightLabel} line(s) are not present in the supplier quotation.` : `No additional ${rightLabel}-only lines detected.`}
              onClick={addedLines.length > 0 ? () => onStatus("Extra Line") : undefined}
            />
            <FindingCard
              title="Quoted item consistency"
              impact={missingLines.length > 0 || quantityChanges.length > 0 || priceChanges.length > 0 ? "MEDIUM" : "LOW"}
              icon="verified"
              text={`${results.summary.matchedLines} matched, ${results.summary.partialMatches} partial, ${results.summary.discrepancies} requiring review.`}
            />
            <FindingCard
              title="Recommended next action"
              impact={results.summary.highRiskDiscrepancies > 0 ? "HIGH" : "LOW"}
              icon="rule"
              text={results.summary.recommendedNextAction}
            />
          </div>
        </div>

        <div className="rounded-xl border border-outline-variant/20 bg-surface-lowest p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="rounded-lg bg-surface-container px-2.5 py-1 text-[0.65rem] font-bold text-on-surface-variant">
              Review: {results.reviewStatus}
            </span>
            <span className="rounded-lg bg-surface-container px-2.5 py-1 text-[0.65rem] font-bold text-on-surface-variant">
              {results.auditMetadata.deterministic ? "Deterministic" : "Advisory"}
            </span>
          </div>
          <p className="mb-4 text-xs leading-relaxed text-secondary">Operator approval is required before correction, invoice approval, or supplier/customer messaging.</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => onReview("approve")} disabled={isReviewing || !results.validationRunId} className="inline-flex items-center gap-1.5 rounded-lg bg-success px-3 py-2 text-[0.68rem] font-bold text-on-primary disabled:opacity-50">
              <Icon name="check" className="text-base" /> Approve
            </button>
            <button onClick={() => onReview("reject")} disabled={isReviewing || !results.validationRunId} className="inline-flex items-center gap-1.5 rounded-lg bg-error-container/30 px-3 py-2 text-[0.68rem] font-bold text-error disabled:opacity-50">
              <Icon name="close" className="text-base" /> Reject
            </button>
            <button onClick={() => onReview("block")} disabled={isReviewing || !results.validationRunId} className="inline-flex items-center gap-1.5 rounded-lg bg-surface-container px-3 py-2 text-[0.68rem] font-bold text-warning disabled:opacity-50">
              <Icon name="block" className="text-base" /> Block
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-outline-variant/20 bg-surface-lowest p-3">
        <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h4 className="text-xs font-bold text-on-surface">Line Comparison</h4>
            <p className="mt-1 text-[0.65rem] text-on-surface-variant">
              Showing {filteredResults.length} of {results.comparisonResults.length} validation line(s).
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={()=>onStatus("Differences")} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${activeStatus === "Differences" ? "bg-success text-on-primary" : "bg-surface-container text-on-surface"}`}>Differences requiring review</button>
            <button
              onClick={() => onStatus("All")}
              className={`rounded-lg px-3 py-1.5 text-[0.65rem] font-bold ${activeStatus === "All" ? "bg-success text-on-primary" : "bg-surface-container text-on-surface-variant hover:bg-surface-high"}`}
            >
              All
            </button>
            {statusFilters.map((status) => (
              <button
                key={status}
                onClick={() => onStatus(status)}
                className={`rounded-lg px-3 py-1.5 text-[0.65rem] font-bold ${activeStatus === status ? "bg-success text-on-primary" : "bg-surface-container text-on-surface-variant hover:bg-surface-high"}`}
                title={statusDescription(status)}
              >
                {displayStatus(status)}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-xl bg-surface-lowest">
          <div role="region" aria-label="Comparison lines" tabIndex={0} className="max-h-[640px] overflow-auto">
            <table className="min-w-[1420px] w-full text-left text-xs">
              <thead className="sticky top-0 z-10 bg-surface-container text-secondary uppercase text-[0.55rem] font-bold tracking-wider shadow-[0_1px_0_rgba(66,71,84,0.35)]">
                <tr>
                  {["Change Type", "Quote Line", `${rightLabel} Line`, "Description", "Quote Qty", `${rightLabel} Qty`, "Quote Price", `${rightLabel} Price`, "Quote Total", `${rightLabel} Total`, "Reason"].map((heading) => (
                    <th
                      key={heading}
                      className={`whitespace-nowrap px-3 py-2.5 ${
                        heading === "Description" ? "min-w-[460px]" : heading === "Reason" ? "min-w-[260px]" : ""
                      }`}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/10">
                {filteredResults.map((item) => (
                  <tr key={item.id} className="hover:bg-surface-container">
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex rounded-md px-2 py-0.5 text-[0.6rem] font-bold ${STATUS_STYLE[item.status]}`}>
                        {displayStatus(item.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-on-surface-variant">{item.leftLine?.sourceLineNumber ?? item.leftLine?.lineNumber ?? "--"}</td>
                    <td className="px-3 py-2.5 text-on-surface">{item.rightLine?.sourceLineNumber ?? item.rightLine?.lineNumber ?? "--"}</td>
                    <td className="min-w-[460px] px-3 py-2.5 leading-relaxed text-on-surface">{tableDescription(item.leftLine, item.rightLine)}</td>
                    <td className={`px-3 py-2.5 ${item.leftLine ? "text-secondary" : "font-bold text-warning"}`}>{item.leftLine ? qty(item.leftLine.quantity, item.leftLine.unit) : "0"}</td>
                    <td className="px-3 py-2.5 font-semibold text-on-surface">{item.rightLine ? qty(item.rightLine.quantity, item.rightLine.unit) : "0"}</td>
                    <td className={`px-3 py-2.5 ${item.leftLine ? "text-secondary" : "font-bold text-warning"}`}>{item.leftLine ? money(item.leftLine.unitPrice, item.leftLine.currency) : money(0, item.rightLine?.currency)}</td>
                    <td className="px-3 py-2.5 font-semibold text-on-surface">{item.rightLine ? money(item.rightLine.unitPrice, item.rightLine.currency) : money(0, item.leftLine?.currency)}</td>
                    <td className={`px-3 py-2.5 ${item.leftLine ? "text-secondary" : "font-bold text-warning"}`}>{item.leftLine ? money(item.leftLine.lineTotal, item.leftLine.currency) : money(0, item.rightLine?.currency)}</td>
                    <td className="px-3 py-2.5 font-semibold text-on-surface">{item.rightLine ? money(item.rightLine.lineTotal, item.rightLine.currency) : money(0, item.leftLine?.currency)}</td>
                    <td className="min-w-[260px] px-3 py-2.5 text-on-surface-variant">{item.statuses.map(displayStatus).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filteredResults.length === 0 ? (
            <div className="p-8 text-center text-sm text-on-surface-variant">No validation lines match the current filter.</div>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SourcePreview title="Quote Source" lines={results.normalizedLines.left} documents={results.sourceDocuments.slice(0, 1)} sourceUrl={results.validationRunId ? `/api/v1/procurement/validate/${encodeURIComponent(results.validationRunId)}/sources/left` : undefined} />
        <SourcePreview title={results.validationType === "supplier_quote_vs_rfq" ? "RFQ Source" : "Purchase Order Source"} lines={results.normalizedLines.right} documents={results.sourceDocuments.slice(1, 2)} sourceUrl={results.validationRunId ? `/api/v1/procurement/validate/${encodeURIComponent(results.validationRunId)}/sources/right` : undefined} />
      </div>

      {results.exceptionDrafts.length > 0 ? (
        <div className="rounded-xl border border-warning/20 bg-surface-lowest p-4">
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h4 className="text-xs font-bold text-on-surface flex items-center gap-2">
              <Icon name="playlist_add_check" className="text-warning text-lg" />
              Exception Drafts
            </h4>
            <button
              onClick={onCreateExceptions}
              disabled={isCreatingExceptions || !results.validationRunId || results.exceptionDrafts.every((draft) => draft.status === "Created")}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-surface-container px-3 py-2 text-[0.68rem] font-bold text-warning disabled:opacity-50"
            >
              <Icon name={isCreatingExceptions ? "sync" : "add_task"} className={`text-base ${isCreatingExceptions ? "animate-spin" : ""}`} />
              Create Exceptions
            </button>
          </div>
          <div className="space-y-2">
            {results.exceptionDrafts.slice(0, 6).map((draft) => (
              <div key={draft.sourceLineId} className="rounded-lg bg-surface-container p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-xs font-semibold text-on-surface">{draft.title.replace("Extra Line", `${rightLabel} only`).replace("Missing Line", `Missing from ${rightLabel}`)}</p>
                  <span className="text-[0.6rem] font-bold text-warning">{draft.status}</span>
                </div>
                <p className="mt-1 text-[0.68rem] leading-relaxed text-on-surface-variant">{draft.suggestedAction}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FindingCard({
  title,
  impact,
  icon,
  text,
  onClick,
}: {
  title: string;
  impact: "HIGH" | "MEDIUM" | "LOW";
  icon: string;
  text: string;
  onClick?: () => void;
}) {
  const impactClass = {
    HIGH: "border-error/25 text-error",
    MEDIUM: "border-warning/25 text-warning",
    LOW: "border-success/25 text-success",
  }[impact];
  const content = (
    <>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon name={icon} className="shrink-0 text-base" />
          <p className="truncate text-xs font-bold text-on-surface">{title}</p>
        </div>
        <span className={`rounded-md border px-2 py-0.5 text-[0.55rem] font-bold ${impactClass}`}>{impact}</span>
      </div>
      <p className="text-[0.68rem] leading-relaxed text-secondary">{text}</p>
    </>
  );

  if (onClick) {
    return (
      <button onClick={onClick} className="rounded-lg border border-outline-variant/20 bg-surface-container p-3 text-left transition-colors hover:bg-surface-high">
        {content}
      </button>
    );
  }

  return <div className="rounded-lg border border-outline-variant/20 bg-surface-container p-3">{content}</div>;
}

function SourcePreview({
  title,
  lines,
  documents,
  sourceUrl,
}: {
  title: string;
  lines: NormalizedProcurementLine[];
  documents: ProcurementValidationResults["sourceDocuments"];
  sourceUrl?: string;
}) {
  const document = documents[0];
  return (
    <div className="rounded-xl border border-outline-variant/20 bg-surface-lowest p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h4 className="text-xs font-bold text-on-surface">{title}</h4>
          <p className="mt-1 text-[0.65rem] text-on-surface-variant">{document ? `${ROLE_LABELS[document.role]} / ${document.fileName || document.recordLabel || "record"}` : "No source metadata"}</p>
        </div>
        <span className="rounded-lg bg-surface-container px-2.5 py-1 text-[0.6rem] font-bold text-on-surface-variant">{lines.length} lines</span>
      </div>
      {document?.sourceDocument && sourceUrl
        ? <SourceDocumentDownload document={document.sourceDocument} url={sourceUrl} />
        : <p className="mb-2 text-xs text-on-surface-variant">Original source was not retained for this historical run.</p>}
      {document?.extractedText !== undefined && <details className="mb-3 text-xs text-on-surface-variant">
        <summary>Comparison text</summary>
        <pre tabIndex={0} className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words">{document.extractedText}</pre>
      </details>}
      <div className="space-y-2">
        {lines.slice(0, 4).map((line) => (
          <div key={line.id} className="rounded-lg bg-surface-container px-3 py-2">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 text-xs text-on-surface">{describeLine(line)}</p>
              <span className="shrink-0 text-[0.65rem] text-on-surface-variant">{qty(line.quantity, line.unit)}</span>
            </div>
            <p className="mt-1 text-[0.62rem] text-on-surface-variant">{money(line.unitPrice, line.currency)} / total {money(line.lineTotal, line.currency)}</p>
          </div>
        ))}
        {lines.length === 0 ? <div className="rounded-lg bg-surface-container p-3 text-xs text-on-surface-variant">No structured lines extracted.</div> : null}
      </div>
    </div>
  );
}
