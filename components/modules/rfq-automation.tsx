"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RFQProcessedLine, RFQResult, RFQSupplierOption } from "@/types/procurement";
import { RfqReviewWorkspace } from "@/components/modules/rfq-review-workspace";
import { AINotConfiguredBanner } from "@/components/ai-status-badge";
import { CustomerQuotesPanel } from "@/components/modules/customer-quotes-panel";
import { WorkAssignmentSelect } from "@/components/auth/work-assignment-select";

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined ${className}`} style={{ fontVariationSettings: "'FILL' 0" }}>
      {name}
    </span>
  );
}

type ItemStatus = "approved" | "needs_review" | "no_match" | "incomplete";
type FilterType = "all" | "needs_review" | "no_match" | "approved";
type PreferredSupplierContext = {
  supplierId: string;
  supplierName: string;
  categories?: string[];
  portsCovered?: string[];
  source?: string;
};
type RecentRfqLine = {
  id: string;
  lineNumber: number;
  description: string;
  quantity: number;
  unit: string;
};
type RecentRfq = {
  id: string;
  vessel: string;
  port: string;
  neededBy: string;
  status: string;
  source: string | null;
  createdAt: string;
  assignedTo: { id: string; name: string; email: string } | null;
  lines: RecentRfqLine[];
};
type SupplierSummary = {
  id: string;
  supplierCode: string;
  name: string;
};
type SupplierInquiryLine = {
  id: string;
  lineNumber: number;
  description: string;
  quantity: number;
  unit: string;
  status: "Pending" | "Quoted" | "Unavailable" | "NoResponse";
  quote: { unitPrice: number; currency: string; leadTimeDays: number | null } | null;
};
type SupplierInquiry = {
  id: string;
  inquiryNumber: string | null;
  rfqId: string;
  supplierId: string;
  supplier: string;
  vessel: string;
  port: string;
  status: "Draft" | "Sent" | "PartiallyResponded" | "Responded" | "Closed" | "Cancelled";
  responseDueAt: string | null;
  lines: SupplierInquiryLine[];
};

const statusConfig: Record<ItemStatus, { icon: string; color: string; label: string }> = {
  approved: { icon: "check_circle", color: "text-success-dim", label: "Checked" },
  needs_review: { icon: "help", color: "text-warning", label: "Review" },
  no_match: { icon: "error", color: "text-error", label: "No Match" },
  incomplete: { icon: "pending", color: "text-on-surface-variant", label: "Incomplete" },
};

const flagColors: Record<string, string> = {
  NO_SUPPLIER_MATCH: "bg-error/10 text-error border border-error/20",
  BELOW_MOQ: "bg-warning/10 text-warning border border-warning/20",
  LEAD_TIME_WARNING: "bg-warning/10 text-warning border border-warning/20",
  MANUAL_SELECTION: "bg-success/10 text-success border border-success/20",
};

export function RFQAutomationModule() {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RFQResult | null>(null);
  const [preferredSupplier, setPreferredSupplier] = useState<PreferredSupplierContext | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [statuses, setStatuses] = useState<Record<number, ItemStatus>>({});
  const [selections, setSelections] = useState<Record<number, number>>({});
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");
  const [markup, setMarkup] = useState("16.5");
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [recentRfqs, setRecentRfqs] = useState<RecentRfq[]>([]);
  const [recentRfqsLoading, setRecentRfqsLoading] = useState(false);
  const [recentRfqsError, setRecentRfqsError] = useState<string | null>(null);
  const requestKeyRef = useRef<{file:File;key:string}|null>(null);
  const abortRef = useRef<AbortController|null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const readStoredContext = () => {
      try {
        const stored = window.sessionStorage.getItem("nautex:rfq-context");
        if (!stored) return;
        const parsed = JSON.parse(stored) as Partial<PreferredSupplierContext>;
        if (parsed.supplierId && parsed.supplierName) {
          setPreferredSupplier({
            supplierId: parsed.supplierId,
            supplierName: parsed.supplierName,
            categories: Array.isArray(parsed.categories) ? parsed.categories : [],
            portsCovered: Array.isArray(parsed.portsCovered) ? parsed.portsCovered : [],
            source: parsed.source ?? "supplier_directory",
          });
        }
      } catch {
        window.sessionStorage.removeItem("nautex:rfq-context");
      }
    };

    const handleRecordContext = (event: Event) => {
      const detail = (event as CustomEvent<Partial<PreferredSupplierContext> & { moduleKey?: string }>).detail;
      if (detail?.moduleKey !== "rfqAutomation" || !detail.supplierId || !detail.supplierName) return;
      setPreferredSupplier({
        supplierId: detail.supplierId,
        supplierName: detail.supplierName,
        categories: Array.isArray(detail.categories) ? detail.categories : [],
        portsCovered: Array.isArray(detail.portsCovered) ? detail.portsCovered : [],
        source: detail.source ?? "supplier_directory",
      });
    };

    readStoredContext();
    window.addEventListener("nautex:record-context", handleRecordContext);
    return () => window.removeEventListener("nautex:record-context", handleRecordContext);
  }, []);

  const loadRecentRfqs = useCallback(async () => {
    setRecentRfqsLoading(true);
    setRecentRfqsError(null);
    try {
      const res = await fetch("/api/v1/rfqs");
      const payload = await res.json();
      if (!res.ok || payload.ok === false) {
        throw new Error(payload.error?.message ?? payload.error ?? "Recent RFQs could not be loaded.");
      }
      setRecentRfqs(Array.isArray(payload.data) ? payload.data.slice(0, 5) : []);
    } catch (err) {
      setRecentRfqs([]);
      setRecentRfqsError(err instanceof Error ? err.message : "Recent RFQs could not be loaded.");
    } finally {
      setRecentRfqsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecentRfqs();
  }, [loadRecentRfqs]);

  const applyResult = useCallback((data: RFQResult) => {
    setResult(data);
    const initStatuses: Record<number, ItemStatus> = {};
    const initSelections: Record<number, number> = {};
    data.lines.forEach((line: RFQProcessedLine, idx: number) => {
      if (line.noMatchFound) initStatuses[idx] = "no_match";
      else if (line.hasMultipleOptions) initStatuses[idx] = "needs_review";
      else initStatuses[idx] = "needs_review";
      if (line.supplierOptions?.length) {
        const preferredIndex = preferredSupplier
          ? line.supplierOptions.findIndex((option) => option.supplierId === preferredSupplier.supplierId)
          : -1;
        initSelections[idx] = preferredIndex >= 0 ? preferredIndex : 0;

      }
    });
    setStatuses(initStatuses);
    setSelections(initSelections);
  }, [preferredSupplier]);

  const openRecentRfq = useCallback(async (id: string) => {
    setError(null);
    const res = await fetch(`/api/v1/rfqs/${encodeURIComponent(id)}`);
    const payload = await res.json();
    if (!res.ok || payload.ok === false) throw new Error(payload.error?.message ?? "RFQ could not be opened.");
    setFile(null);
    applyResult(payload.data as RFQResult);
  }, [applyResult]);

  const deleteRecentRfq = useCallback(async (id: string) => {
    const res = await fetch(`/api/v1/rfqs/${encodeURIComponent(id)}`, { method: "DELETE" });
    const payload = await res.json();
    if (!res.ok || payload.ok === false) throw new Error(payload.error?.message ?? "RFQ could not be deleted.");
    await loadRecentRfqs();
  }, [loadRecentRfqs]);

  const handleProcess = useCallback(async () => {
    if (!file) return;
    setIsProcessing(true);
    setError(null);
    setResult(null);
    abortRef.current = new AbortController();
    if (requestKeyRef.current?.file !== file) requestKeyRef.current = {file,key:crypto.randomUUID()};

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/v1/rfq/process", { method: "POST", body: formData, headers:{"idempotency-key":requestKeyRef.current!.key}, signal:abortRef.current?.signal });
      const payload = await res.json();
      if (!res.ok || payload.ok === false) throw new Error(payload.error?.message ?? "Processing failed.");

      applyResult(payload.data);
      if (payload.data?.persisted) loadRecentRfqs();
    } catch (err) {
      setError(err instanceof Error && err.name === "AbortError" ? "Processing cancelled. If a draft was already saved, retrying this file reopens that draft." : err instanceof Error ? err.message : "Processing failed.");
    } finally {
      setIsProcessing(false);
    }
  }, [applyResult, file, loadRecentRfqs]);

  const handleDemoProcess = useCallback(async () => {
    setIsProcessing(true);
    setError(null);
    setResult(null);
    setFile(null);

    try {
      const res = await fetch("/api/v1/rfq/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          forceFallback: true,
          text: [
            "001 Oil absorbent pads medium weight 18 PACK",
            "002 Marine safety gloves nitrile coated size L 60 PAIR",
            "003 Engine oil filter cartridge demo equivalent 12 EA",
          ].join("\n"),
        }),
      });
      const payload = await res.json();
      if (!res.ok || payload.ok === false) throw new Error(payload.error?.message ?? "Processing failed.");
      applyResult(payload.data);
      if (payload.data?.persisted) loadRecentRfqs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Processing failed.");
    } finally {
      setIsProcessing(false);
    }
  }, [applyResult, loadRecentRfqs]);

  const filteredLines = useMemo(() => {
    if (!result) return [];
    return result.lines
      .map((line, idx) => ({ line, idx }))
      .filter(({ idx }) => {
        if (activeFilter === "all") return true;
        return statuses[idx] === activeFilter;
      });
  }, [result, activeFilter, statuses]);

  const selectedLine = result?.lines[selectedIndex];
  const selectedOption = selectedLine?.supplierOptions?.[selections[selectedIndex] ?? 0];
  const routingRunCount = result?.matchRunIds?.length ?? (result?.matchRunId ? 1 : 0);

  const handleAcceptSelectedSupplier = useCallback(async () => {
    const matchRunId = selectedOption?.matchRunId ?? result?.matchRunId;
    if (!matchRunId || !selectedOption?.matchCandidateId) return;

    setFeedbackMessage(null);
    const res = await fetch(`/api/v1/suppliers/match/${encodeURIComponent(matchRunId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId: selectedOption.matchCandidateId, action: "accept" }),
    });
    const payload = await res.json();
    if (!res.ok) {
      setFeedbackMessage(payload.error?.message ?? payload.error ?? "Supplier feedback failed.");
      return;
    }
    setStatuses((prev) => ({ ...prev, [selectedIndex]: "approved" }));
    setFeedbackMessage(`Accepted supplier route and saved learning feedback for ${selectedOption.supplierName}.`);
  }, [result?.matchRunId, selectedIndex, selectedOption]);

  const counts = useMemo(() => {
    if (!result) return { approved: 0, needs_review: 0, no_match: 0 };
    const c = { approved: 0, needs_review: 0, no_match: 0 };
    result.lines.forEach((_, idx) => {
      const s = statuses[idx];
      if (s === "approved") c.approved++;
      else if (s === "needs_review") c.needs_review++;
      else if (s === "no_match") c.no_match++;
    });
    return c;
  }, [result, statuses]);

  return (
    <div className="space-y-6">
      <AINotConfiguredBanner moduleName="RFQ Automation" />
      {preferredSupplier && (
        <div className="rounded-xl border border-success/20 bg-success/5 px-4 py-3 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Icon name="route" className="text-success text-xl mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-on-surface">Preferred supplier context active</p>
              <p className="text-[0.7rem] text-on-surface-variant mt-0.5">
                {preferredSupplier.supplierName} will be highlighted when it appears in supplier-match results. Buyer approval is still required before routing.
              </p>
              <div className="flex gap-1.5 mt-2 flex-wrap">
                {(preferredSupplier.categories ?? []).slice(0, 4).map((category) => (
                  <span key={category} className="px-2 py-0.5 rounded-full bg-surface-lowest border border-success/15 text-[0.6rem] text-success">{category}</span>
                ))}
                {(preferredSupplier.portsCovered ?? []).slice(0, 3).map((port) => (
                  <span key={port} className="px-2 py-0.5 rounded-full bg-surface-lowest border border-accent-cyan/15 text-[0.6rem] text-accent-cyan">{port}</span>
                ))}
              </div>
            </div>
          </div>
          <button
            onClick={() => { setPreferredSupplier(null); if (typeof window !== "undefined") window.sessionStorage.removeItem("nautex:rfq-context"); }}
            className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-on-surface-variant hover:text-on-surface transition"
          >
            Clear
          </button>
        </div>
      )}
      {/* Upload Step */}
      {!result && !isProcessing && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="bg-surface-container rounded-xl p-8 max-w-none text-center">
            <Icon name="auto_awesome" className="text-success text-4xl mb-3" />
            <h3 className="text-xl font-bold text-on-surface mb-2">Automate RFQ Sourcing</h3>
            <p className="text-sm text-on-surface-variant mb-6">
              Upload an RFQ document or use the demo RFQ. Nautex extracts a draft for correction and review, with AI used when configured.
            </p>

            {file ? (
              <div className="bg-surface-lowest p-4 rounded-lg border border-success/30 flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 overflow-hidden">
                  <Icon name="description" className="text-success text-lg flex-shrink-0" />
                  <span className="text-sm text-on-surface truncate">{file.name}</span>
                </div>
                <button onClick={() => setFile(null)} className="p-1 text-on-surface-variant hover:text-on-surface">
                  <Icon name="close" className="text-lg" />
                </button>
              </div>
            ) : (
              <div
                role="button" tabIndex={0} aria-label="Choose RFQ file" onKeyDown={e=>{if(e.key === "Enter" || e.key === " "){e.preventDefault();fileInputRef.current?.click();}}}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.[0]) setFile(e.dataTransfer.files[0]); }}
                className="p-8 border-2 border-dashed border-outline-variant/50 rounded-xl cursor-pointer hover:border-success/50 transition-colors mb-4"
              >
                <input ref={fileInputRef} type="file" accept=".pdf,.txt,.csv,.xlsx,.xls,.docx" onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])} className="hidden" />
                <Icon name="cloud_upload" className="text-on-surface-variant text-3xl mb-2" />
                <p className="text-sm text-on-surface-variant">Drag & drop PDF, TXT, CSV, Excel or Word, or choose a file</p>
              </div>
            )}

            <div className="flex items-center justify-center gap-3">
              <button
                onClick={handleProcess}
                disabled={!file}
                className="flex items-center justify-center gap-2 bg-success text-on-primary px-8 py-3 rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-50"
              >
                <Icon name="send" className="text-lg" /> Process RFQ
              </button>
              <button
                onClick={handleDemoProcess}
                className="flex items-center justify-center gap-2 bg-surface-container text-on-surface border border-outline-variant/40 px-5 py-3 rounded-lg text-sm font-semibold hover:border-success/40 hover:text-success"
              >
                <Icon name="auto_fix_high" className="text-lg" /> Use Demo RFQ
              </button>
            </div>
            </div>
            <RecentRfqsPanel
              rfqs={recentRfqs}
              loading={recentRfqsLoading}
              error={recentRfqsError}
              onRefresh={loadRecentRfqs}
              onOpen={openRecentRfq}
              onDelete={deleteRecentRfq}
            />
          </div>
          <SupplierInquiriesPanel
            rfqs={recentRfqs}
            preferredSupplier={preferredSupplier}
            onRfqRefresh={loadRecentRfqs}
          />
          <CustomerQuotesPanel />
        </div>
      )}

      {/* Processing */}
      {isProcessing && (
        <div className="bg-surface-container rounded-xl p-12 text-center">
          <Icon name="sync" className="animate-spin text-success text-3xl mb-3" />
          <p role="status" className="text-sm text-secondary">Extracting document and preparing a review draft…</p>
          <button className="mt-4 text-sm text-on-surface" onClick={()=>abortRef.current?.abort()}>Cancel processing</button>
        </div>
      )}

      {error && (
        <div className="bg-error-container/20 border border-error/30 rounded-xl p-4 flex items-center gap-3">
          <Icon name="error" className="text-error" />
          <span className="text-sm text-error">{error}</span>
        </div>
      )}

      {result?.rfqId && <RfqReviewWorkspace key={result.rfqId} result={result} onSaved={applyResult} onClose={()=>{setResult(null);setFile(null);void loadRecentRfqs();}} />}
      {/* Analysis Results */}
      {result && (
        <div className="grid grid-cols-12 gap-6">
          {"_fallback" in result && (
            <div className="col-span-12 rounded-xl border border-success/15 bg-success/5 px-4 py-3 flex items-start gap-3">
              <Icon name="database" className="text-success text-lg mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-on-surface">Grounded supplier evidence</p>
                <p className="text-[0.65rem] text-on-surface-variant mt-0.5">
                  Supplier prices require a current agreement with an exact description and unit. Missing evidence stays empty.
                </p>
              </div>
            </div>
          )}
          {result.persisted && (
            <div className="col-span-12 rounded-xl border border-success/15 bg-surface-container px-4 py-3 flex items-start gap-3">
              <Icon name="save" className="text-success text-lg mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-on-surface">RFQ draft saved</p>
                <p className="text-[0.65rem] text-on-surface-variant mt-0.5">
                  RFQ {result.rfqId} saved with supplier evidence across {routingRunCount} line routing run{routingRunCount === 1 ? "" : "s"}.
                </p>
              </div>
            </div>
          )}
          {feedbackMessage && (
            <div className="col-span-12 rounded-xl border border-success/15 bg-success/5 px-4 py-3 text-xs text-on-surface">
              {feedbackMessage}
            </div>
          )}
          {/* Left: Item List */}
          <div className="col-span-4 space-y-4">
            {/* Stats */}
            <div className="grid grid-cols-3 gap-2">
              {(["approved", "needs_review", "no_match"] as const).map((s) => {
                const cfg = statusConfig[s];
                return (
                  <div key={s} className="bg-surface-container rounded-lg p-3 text-center">
                    <p className="text-[0.6rem] font-bold uppercase tracking-wider text-on-surface-variant mb-1">{cfg.label}</p>
                    <p className={`text-xl font-bold ${cfg.color}`}>{counts[s]}</p>
                  </div>
                );
              })}
            </div>

            {/* Filters */}
            <div className="flex gap-1 bg-surface-lowest p-1 rounded-lg">
              {(["all", "needs_review", "no_match", "approved"] as FilterType[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setActiveFilter(f)}
                  className={`flex-1 py-1.5 rounded-md text-[0.6rem] font-bold uppercase transition-all ${
                    activeFilter === f ? "bg-success text-on-primary" : "text-on-surface-variant hover:bg-surface-high"
                  }`}
                >
                  {f === "all" ? "All" : statusConfig[f].label}
                </button>
              ))}
            </div>

            {/* Line Items List */}
            <div className="bg-surface-container rounded-xl overflow-hidden max-h-[500px] overflow-y-auto">
              {filteredLines.map(({ line, idx }) => {
                const status = statuses[idx] || "incomplete";
                const cfg = statusConfig[status];
                return (
                  <button
                    key={idx}
                    onClick={() => setSelectedIndex(idx)}
                    className={`w-full text-left p-3 border-b border-outline-variant/10 flex items-start gap-3 transition-all ${
                      selectedIndex === idx ? "bg-surface-high" : "hover:bg-surface-container"
                    }`}
                  >
                    <Icon name={cfg.icon} className={`${cfg.color} text-lg flex-shrink-0 mt-0.5`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-on-surface truncate">
                        #{line.originalItem.itemNumber} — {line.originalItem.specifications}
                      </p>
                      <p className="text-[0.6rem] text-on-surface-variant mt-0.5">
                        Qty: {line.originalItem.quantity} {line.originalItem.unit}
                        {line.supplierOptions?.length ? ` · ${line.supplierOptions.length} options` : ""}
                      </p>
                      {line.flags && line.flags.length > 0 && (
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {line.flags.map((flag) => (
                            <span key={flag} className={`px-1.5 py-0.5 text-[0.55rem] font-bold rounded ${flagColors[flag] || "bg-surface-bright text-secondary"}`}>
                              {flag.replace(/_/g, " ")}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: Detail Panel */}
          <div className="col-span-8 space-y-4">
            {selectedLine && (
              <>
                {/* Item Header */}
                <div className="bg-surface-container rounded-xl p-5">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <p className="text-[0.6rem] font-bold uppercase tracking-wider text-on-surface-variant">Line Item</p>
                      <h3 className="text-lg font-bold text-on-surface">{selectedLine.originalItem.specifications}</h3>
                      <p className="text-xs text-on-surface-variant mt-1">
                        Item #{selectedLine.originalItem.itemNumber} · Qty: {selectedLine.originalItem.quantity} {selectedLine.originalItem.unit}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setStatuses((prev) => ({ ...prev, [selectedIndex]: "approved" }))}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          statuses[selectedIndex] === "approved"
                            ? "bg-success-dim/20 text-success-dim border border-success-dim/30"
                            : "bg-surface-container text-on-surface-variant hover:bg-surface-high"
                        }`}
                      >
                        Mark checked
                      </button>
                      <button
                        onClick={() => setStatuses((prev) => ({ ...prev, [selectedIndex]: "needs_review" }))}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          statuses[selectedIndex] === "needs_review"
                            ? "bg-warning/20 text-warning border border-warning/30"
                            : "bg-surface-container text-on-surface-variant hover:bg-surface-high"
                        }`}
                      >
                        Flag for review
                      </button>
                    </div>
                  </div>

                  {selectedLine.notes && (
                    <p className="text-xs text-on-surface-variant bg-surface-lowest p-3 rounded-lg italic">{selectedLine.notes}</p>
                  )}
                </div>

                {/* Supplier Options */}
                <div className="bg-surface-container rounded-xl p-5">
                  <h4 className="text-xs font-bold text-secondary mb-3 flex items-center gap-2">
                    <Icon name="storefront" className="text-success text-lg" />
                    Supplier Options ({selectedLine.supplierOptions?.length ?? 0})
                  </h4>

                  {selectedLine.supplierOptions && selectedLine.supplierOptions.length > 0 ? (
                    <div className="space-y-2">
                      {selectedLine.supplierOptions.map((option, optIdx) => (
                        <SupplierOptionCard
                          key={optIdx}
                          option={option}
                          isSelected={selections[selectedIndex] === optIdx}
                          isPreferred={preferredSupplier?.supplierId === option.supplierId}
                          onSelect={() => setSelections((prev) => ({ ...prev, [selectedIndex]: optIdx }))}
                          markup={parseFloat(markup) || 0}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="bg-surface-lowest rounded-lg p-6 text-center">
                      <Icon name="search_off" className="text-on-surface-variant text-3xl mb-2" />
                      <p className="text-sm text-on-surface-variant">No supplier matches found for this item.</p>
                    </div>
                  )}
                </div>

                {/* Markup */}
                <div className="bg-surface-container rounded-xl p-5">
                  <div className="flex items-center gap-4">
                    <label className="text-xs font-bold text-secondary">Default Markup:</label>
                    <div className="relative w-24">
                      <input
                        type="text"
                    aria-label="Supplier price markup percent"
                    value={markup}
                        onChange={(e) => setMarkup(e.target.value)}
                        className="w-full bg-surface-lowest rounded-lg px-3 py-2 text-sm text-on-surface text-right pr-7 focus:outline-none focus:ring-1 focus:ring-success"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-sm">%</span>
                    </div>
                    {selectedOption && (
                      <div className="ml-auto text-right">
                        <p className="text-[0.6rem] text-on-surface-variant uppercase">Selling Price</p>
                        <p className="text-lg font-bold text-success">
                          {new Intl.NumberFormat("en-US", { style: "currency", currency: selectedOption.currency || "EUR" }).format(
                            selectedOption.price * (1 + (parseFloat(markup) || 0) / 100)
                          )}
                        </p>
                      </div>
                    )}
                  </div>
                  {(selectedOption?.matchRunId ?? result.matchRunId) && selectedOption?.matchCandidateId && (
                    <button
                      onClick={handleAcceptSelectedSupplier}
                      className="mt-4 w-full bg-success text-on-primary py-2.5 rounded-lg text-xs font-semibold hover:opacity-90"
                    >
                      Accept Selected Supplier Route
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RecentRfqsPanel({
  rfqs,
  loading,
  error,
  onRefresh,
  onOpen,
  onDelete,
}: {
  rfqs: RecentRfq[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void | Promise<void>;
  onOpen: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const runAction = async (id: string, action: () => Promise<void>) => {
    setBusyId(id);
    setActionError(null);
    try {
      await action();
      setPendingDeleteId(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "RFQ action failed.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface-container p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-on-surface">Recent persisted RFQs</p>
          <p className="mt-0.5 text-[0.65rem] text-on-surface-variant">Latest Prisma RFQ records created by sourcing workflows.</p>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="rounded-lg border border-outline-variant/40 bg-surface-container px-2.5 py-1.5 text-[0.65rem] font-semibold text-on-surface-variant hover:border-success/40 hover:text-success disabled:opacity-50"
        >
          {loading ? "Loading" : "Refresh"}
        </button>
      </div>

      <div className="mt-4 space-y-2">
        {actionError ? (
          <div className="rounded-lg border border-error/25 bg-error-container/20 px-3 py-2 text-[0.68rem] text-error">{actionError}</div>
        ) : null}
        {error ? (
          <div className="rounded-lg border border-warning/20 bg-warning/10 px-3 py-2 text-[0.68rem] text-warning">
            {error}
          </div>
        ) : loading && rfqs.length === 0 ? (
          <div className="rounded-lg border border-outline-variant/20 bg-surface-lowest px-3 py-3 text-[0.68rem] text-on-surface-variant">
            Loading persisted RFQs...
          </div>
        ) : rfqs.length === 0 ? (
          <div className="rounded-lg border border-outline-variant/20 bg-surface-lowest px-3 py-3 text-[0.68rem] text-on-surface-variant">
            No persisted RFQs yet.
          </div>
        ) : (
          rfqs.map((rfq) => (
            <div key={rfq.id} className="rounded-lg border border-outline-variant/20 bg-surface-lowest px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-[0.68rem] text-on-surface">{rfq.id}</p>
                  <p className="mt-0.5 truncate text-[0.65rem] text-on-surface-variant">
                    {rfq.vessel} - {rfq.port}
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-success/15 bg-success/10 px-2 py-0.5 text-[0.55rem] font-bold uppercase tracking-wider text-success">
                  {rfq.status}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[0.58rem] text-on-surface-variant">
                <span>{rfq.lines.length} line{rfq.lines.length === 1 ? "" : "s"}</span>
                <span>{rfq.source ?? "manual"}</span>
                <span>{new Date(rfq.createdAt).toLocaleDateString()}</span>
                <WorkAssignmentSelect compact endpoint={`/api/v1/rfqs/${rfq.id}/assignment`} value={rfq.assignedTo} onUpdated={onRefresh} />
              </div>
              <div className="mt-2 flex items-center justify-end gap-2 border-t border-outline-variant/15 pt-2">
                <button
                  type="button"
                  disabled={busyId === rfq.id}
                  onClick={() => void runAction(rfq.id, () => onOpen(rfq.id))}
                  className="inline-flex items-center gap-1 rounded-md bg-success/10 px-2 py-1 text-[0.62rem] font-semibold text-success hover:bg-success/15 disabled:opacity-50"
                >
                  <Icon name="open_in_new" className="text-sm" /> Open
                </button>
                {rfq.status === "Draft" ? (
                  <button
                    type="button"
                    disabled={busyId === rfq.id}
                    onClick={() => pendingDeleteId === rfq.id
                      ? void runAction(rfq.id, () => onDelete(rfq.id))
                      : setPendingDeleteId(rfq.id)}
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[0.62rem] font-semibold disabled:opacity-50 ${pendingDeleteId === rfq.id ? "bg-error text-on-primary" : "bg-error/10 text-error hover:bg-error/15"}`}
                  >
                    <Icon name={pendingDeleteId === rfq.id ? "warning" : "delete"} className="text-sm" />
                    {pendingDeleteId === rfq.id ? "Confirm delete" : "Delete"}
                  </button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function SupplierInquiriesPanel({
  rfqs,
  preferredSupplier,
  onRfqRefresh,
}: {
  rfqs: RecentRfq[];
  preferredSupplier: PreferredSupplierContext | null;
  onRfqRefresh: () => void;
}) {
  const [inquiries, setInquiries] = useState<SupplierInquiry[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierSummary[]>([]);
  const [rfqId, setRfqId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [responseDueAt, setResponseDueAt] = useState("");
  const [responseInputs, setResponseInputs] = useState<Record<string, { unitPrice: string; leadTimeDays: string }>>({});
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [inquiryResponse, supplierResponse] = await Promise.all([
        fetch("/api/v1/supplier-inquiries"),
        fetch("/api/v1/suppliers?limit=100&sort=name&order=asc"),
      ]);
      const [inquiryPayload, supplierPayload] = await Promise.all([inquiryResponse.json(), supplierResponse.json()]);
      if (!inquiryResponse.ok || inquiryPayload.ok === false) throw new Error(inquiryPayload.error?.message ?? "Supplier inquiries could not be loaded.");
      if (!supplierResponse.ok || supplierPayload.ok === false) throw new Error(supplierPayload.error?.message ?? "Suppliers could not be loaded.");
      setInquiries(Array.isArray(inquiryPayload.data) ? inquiryPayload.data : []);
      setSuppliers(Array.isArray(supplierPayload.data) ? supplierPayload.data : []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Supplier inquiries could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!rfqId && rfqs[0]) setRfqId(rfqs[0].id);
  }, [rfqId, rfqs]);
  useEffect(() => {
    if (preferredSupplier && suppliers.some((supplier) => supplier.id === preferredSupplier.supplierId)) {
      setSupplierId(preferredSupplier.supplierId);
    } else if (!supplierId && suppliers[0]) {
      setSupplierId(suppliers[0].id);
    }
  }, [preferredSupplier, supplierId, suppliers]);

  const post = useCallback(async (url: string, body: Record<string, unknown>, key: string) => {
    setBusyKey(key);
    setMessage(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) throw new Error(payload.error?.message ?? "Supplier inquiry action failed.");
      await Promise.all([load(), Promise.resolve(onRfqRefresh())]);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Supplier inquiry action failed.");
      return false;
    } finally {
      setBusyKey(null);
    }
  }, [load, onRfqRefresh]);

  const createInquiry = async () => {
    if (!rfqId || !supplierId) {
      setMessage("Select an RFQ and supplier.");
      return;
    }
    const created = await post("/api/v1/supplier-inquiries", {
      rfqId,
      supplierId,
      responseDueAt: responseDueAt ? new Date(`${responseDueAt}T12:00:00`).toISOString() : null,
    }, "create");
    if (created) setResponseDueAt("");
  };

  const recordResponse = async (inquiry: SupplierInquiry, line: SupplierInquiryLine, responseType: "quoted" | "unavailable") => {
    const input = responseInputs[line.id] ?? { unitPrice: "", leadTimeDays: "" };
    if (responseType === "quoted" && input.unitPrice.trim() === "") {
      setMessage("Enter a unit price before recording a quote.");
      return;
    }
    await post(`/api/v1/supplier-inquiries/${encodeURIComponent(inquiry.id)}/lines/${encodeURIComponent(line.id)}/response`, {
      responseType,
      unitPrice: responseType === "quoted" ? Number(input.unitPrice) : null,
      leadTimeDays: responseType === "quoted" && input.leadTimeDays ? Number(input.leadTimeDays) : null,
      currency: "EUR",
      stockStatus: responseType === "quoted" ? "Available" : null,
    }, `line:${line.id}`);
  };

  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface-container p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-on-surface">Supplier inquiries</h3>
          <p className="mt-0.5 text-[0.68rem] text-on-surface-variant">Group RFQ lines by supplier and record structured responses.</p>
        </div>
        <button onClick={load} disabled={loading} className="rounded-lg border border-outline-variant/40 bg-surface-container px-3 py-2 text-xs font-semibold text-on-surface-variant hover:text-success disabled:opacity-50">
          <Icon name="refresh" className={`mr-1 align-middle text-base ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_170px_auto]">
        <select aria-label="Request for quotation" value={rfqId} onChange={(event) => setRfqId(event.target.value)} className="min-w-0 rounded-lg border border-outline-variant/40 bg-surface-lowest px-3 py-2 text-xs text-on-surface">
          <option value="">Select RFQ</option>
          {rfqs.map((rfq) => <option key={rfq.id} value={rfq.id}>{rfq.vessel} - {rfq.port} ({rfq.lines.length})</option>)}
        </select>
        <select aria-label="Inquiry supplier" value={supplierId} onChange={(event) => setSupplierId(event.target.value)} className="min-w-0 rounded-lg border border-outline-variant/40 bg-surface-lowest px-3 py-2 text-xs text-on-surface">
          <option value="">Select supplier</option>
          {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name} ({supplier.supplierCode})</option>)}
        </select>
        <input type="date" value={responseDueAt} onChange={(event) => setResponseDueAt(event.target.value)} aria-label="Response due date" className="rounded-lg border border-outline-variant/40 bg-surface-lowest px-3 py-2 text-xs text-on-surface" />
        <button onClick={createInquiry} disabled={busyKey !== null || !rfqId || !supplierId} className="rounded-lg bg-success px-4 py-2 text-xs font-semibold text-on-primary disabled:opacity-50">
          Create inquiry
        </button>
      </div>

      {message && <div className="mt-3 rounded-lg border border-warning/20 bg-warning/10 px-3 py-2 text-xs text-warning">{message}</div>}

      <div className="mt-4 space-y-3">
        {!loading && inquiries.length === 0 ? (
          <div className="rounded-lg border border-outline-variant/20 bg-surface-lowest px-3 py-4 text-xs text-on-surface-variant">No supplier inquiries yet.</div>
        ) : inquiries.map((inquiry) => (
          <div key={inquiry.id} className="rounded-lg border border-outline-variant/25 bg-surface-lowest p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-on-surface">{inquiry.inquiryNumber ?? inquiry.id.slice(0, 8)}</span>
                  <span className="rounded border border-success/20 bg-success/10 px-1.5 py-0.5 text-[0.58rem] font-bold uppercase text-success">{inquiry.status}</span>
                </div>
                <p className="mt-1 text-xs text-secondary">{inquiry.supplier} · {inquiry.vessel} / {inquiry.port}</p>
              </div>
              <div className="flex gap-2">
                {inquiry.status === "Draft" && <button onClick={() => post(`/api/v1/supplier-inquiries/${inquiry.id}/transition`, { action: "send" }, `send:${inquiry.id}`)} disabled={busyKey !== null} className="rounded bg-success px-3 py-1.5 text-[0.68rem] font-semibold text-on-primary">Mark sent</button>}
                {(inquiry.status === "Sent" || inquiry.status === "PartiallyResponded" || inquiry.status === "Responded") && <button onClick={() => post(`/api/v1/supplier-inquiries/${inquiry.id}/transition`, { action: "close" }, `close:${inquiry.id}`)} disabled={busyKey !== null} className="rounded border border-outline-variant/40 px-3 py-1.5 text-[0.68rem] font-semibold text-secondary">Close</button>}
                {inquiry.status === "Draft" && <button onClick={() => post(`/api/v1/supplier-inquiries/${inquiry.id}/transition`, { action: "cancel" }, `cancel:${inquiry.id}`)} disabled={busyKey !== null} className="rounded border border-error/20 px-3 py-1.5 text-[0.68rem] font-semibold text-error">Cancel</button>}
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {inquiry.lines.map((line) => {
                const editable = line.status === "Pending" && (inquiry.status === "Sent" || inquiry.status === "PartiallyResponded");
                const input = responseInputs[line.id] ?? { unitPrice: "", leadTimeDays: "" };
                return (
                  <div key={line.id} className="grid items-center gap-2 rounded border border-outline-variant/20 bg-surface-container px-3 py-2 lg:grid-cols-[minmax(0,1fr)_90px_80px_auto]">
                    <div className="min-w-0">
                      <p className="truncate text-xs text-on-surface">{line.lineNumber}. {line.description}</p>
                      <p className="text-[0.62rem] text-on-surface-variant">{line.quantity} {line.unit} · {line.status}{line.quote ? ` · ${line.quote.currency} ${line.quote.unitPrice}` : ""}</p>
                    </div>
                    {editable ? <input inputMode="decimal" placeholder="Unit price" value={input.unitPrice} onChange={(event) => setResponseInputs((current) => ({ ...current, [line.id]: { ...input, unitPrice: event.target.value } }))} className="min-w-0 rounded border border-outline-variant/30 bg-surface-lowest px-2 py-1.5 text-[0.68rem] text-on-surface" /> : <span />}
                    {editable ? <input inputMode="numeric" placeholder="Lead days" value={input.leadTimeDays} onChange={(event) => setResponseInputs((current) => ({ ...current, [line.id]: { ...input, leadTimeDays: event.target.value } }))} className="min-w-0 rounded border border-outline-variant/30 bg-surface-lowest px-2 py-1.5 text-[0.68rem] text-on-surface" /> : <span />}
                    {editable && <div className="flex gap-1.5"><button onClick={() => recordResponse(inquiry, line, "quoted")} disabled={busyKey !== null} className="rounded bg-success/15 px-2 py-1.5 text-[0.62rem] font-semibold text-success">Quote</button><button onClick={() => recordResponse(inquiry, line, "unavailable")} disabled={busyKey !== null} className="rounded bg-warning/10 px-2 py-1.5 text-[0.62rem] font-semibold text-warning">Unavailable</button></div>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SupplierOptionCard({
  option,
  isSelected,
  isPreferred,
  onSelect,
  markup,
}: {
  option: RFQSupplierOption;
  isSelected: boolean;
  isPreferred?: boolean;
  onSelect: () => void;
  markup: number;
}) {
  const sellingPrice = option.price * (1 + markup / 100);
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left p-4 rounded-lg border transition-all ${
        isSelected
          ? "border-success/50 bg-success/5"
          : "border-outline-variant/20 bg-surface-container hover:border-outline-variant/50"
      }`}
    >
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[0.6rem] font-bold text-on-surface-variant bg-surface-lowest px-1.5 py-0.5 rounded">#{option.rank}</span>
            <span className="text-sm font-semibold text-on-surface">{option.supplierName}</span>
            {isPreferred && (
              <span className="text-[0.55rem] font-bold uppercase tracking-wider bg-success/10 text-success border border-success/20 px-1.5 py-0.5 rounded">
                Preferred
              </span>
            )}
          </div>
          <p className="text-[0.65rem] text-on-surface-variant mt-1">{option.reasoning}</p>
        </div>
        <div className="text-right flex-shrink-0 ml-4">
          <p className="text-sm font-bold text-on-surface">
            {new Intl.NumberFormat("en-US", { style: "currency", currency: option.currency || "EUR" }).format(option.price)}
          </p>
          <p className="text-[0.6rem] text-success">
            Sell: {new Intl.NumberFormat("en-US", { style: "currency", currency: option.currency || "EUR" }).format(sellingPrice)}
          </p>
        </div>
      </div>

      <div className="flex gap-2 mt-2 flex-wrap">
        <span className={`text-[0.55rem] font-bold px-1.5 py-0.5 rounded ${
          option.stockStatus === "In Stock" ? "bg-success-dim/10 text-success-dim" : "bg-warning/10 text-warning"
        }`}>
          {option.stockStatus}
        </span>
        <span className="text-[0.55rem] font-bold px-1.5 py-0.5 rounded bg-surface-bright text-secondary">
          {option.leadTimeDays}d lead
        </span>
        {option.moqCompliant && (
          <span className="text-[0.55rem] font-bold px-1.5 py-0.5 rounded bg-success-dim/10 text-success-dim">MOQ OK</span>
        )}
        {option.flags?.map((flag) => (
          <span key={flag} className={`text-[0.55rem] font-bold px-1.5 py-0.5 rounded ${flagColors[flag] || "bg-surface-bright text-secondary"}`}>
            {flag.replace(/_/g, " ")}
          </span>
        ))}
      </div>
    </button>
  );
}
