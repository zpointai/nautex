"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { MODULE_STATUS, STATUS_STYLE } from "@/lib/modules/module-status";

/* ── Types ───────────────────────────────────────────────────── */

type EvidenceStatus = "complete" | "analyzing" | "error";
type Grade = "A" | "B" | "C" | "D" | "F";
type EvidenceFileType = "excel" | "pdf" | "screenshot" | "document";

interface EvidenceKPIs {
  totalPOs: number;
  withinSlaRate: number;
  onTimeRate: number;
  avgDelayDays: number;
  maxDelayDays: number;
  arrivedCount: number;
}

interface DelayBucket {
  bucket: string;
  count: number;
  slaStatus: "within" | "boundary" | "exceeded" | "critical";
}

interface ExtractedPO {
  poNumber: string;
  vesselName?: string;
  requestedDeliveryDate?: string;
  evidenceDate?: string;
  delayDays?: number;
  arrivedStatus?: string;
}

interface EvidenceRecord {
  id: string;
  evidenceSource?: "sla_evidence" | "stored_document" | "legacy_document_record";
  documentId?: string;
  purchaseOrderId?: string;
  linkedPurchaseOrderIds?: string[];
  linkedPoNumbers?: string[];
  vendorName: string;
  fileName: string;
  originalName?: string | null;
  fileType: EvidenceFileType;
  sizeBytes?: number;
  downloadUrl?: string;
  evidenceDate?: string;
  createdAt: string;
  lifecycleStatus?: string;
  lifecycleLabel?: string;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  archivedAt?: string | null;
  status: EvidenceStatus;
  grade: Grade;
  kpis: EvidenceKPIs;
  delayDistribution: DelayBucket[];
  extractedPOs: ExtractedPO[];
  executiveSummary: {
    reliabilityAssessment: string;
    patternDetection: string;
  };
  recommendedActions: string[];
  parserWarnings?: string[];
  extractedTextPreview?: string | null;
}

interface EvidencePurchaseOrderOption {
  id: string;
  poNumber: string;
  vessel: string;
  supplier: string;
  status: string;
  requestedDate: string | null;
}

/* ── Icon ─────────────────────────────────────────────────────── */

function Ic({ name, className = "" }: { name: string; className?: string }) {
  return <span className={`material-symbols-outlined ${className}`} style={{ fontVariationSettings: "'FILL' 0, 'wght' 300, 'opsz' 20" }}>{name}</span>;
}

function fileIconFor(type: EvidenceFileType) {
  if (type === "excel") return "table_chart";
  if (type === "pdf") return "picture_as_pdf";
  if (type === "screenshot") return "image";
  return "description";
}

function fmtBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/* ── Component ───────────────────────────────────────────────── */

export function EvidenceAnalyzerModule() {
  const [records, setRecords] = useState<EvidenceRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [purchaseOrders, setPurchaseOrders] = useState<EvidencePurchaseOrderOption[]>([]);
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploadState, setUploadState] = useState<"idle" | "uploading" | "done">("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [poFilter, setPOFilter] = useState<"all" | "delayed" | "arrived" | "pending">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadEvidence = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/evidence");
      const payload = await res.json();
      if (!res.ok || payload.ok === false) {
        throw new Error(payload.error?.message ?? "Failed to load evidence records.");
      }
      const data = (payload.data ?? []) as EvidenceRecord[];
      setRecords(data);
      setSelectedId((current) => current ?? data[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load evidence records.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEvidence();
  }, [loadEvidence]);

  const loadPurchaseOrders = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/purchase-orders?limit=200&sort=createdAt&order=desc");
      const payload = await res.json();
      if (!res.ok || payload.ok === false) {
        throw new Error(payload.error?.message ?? "Failed to load purchase orders.");
      }
      const data = (payload.data ?? []) as EvidencePurchaseOrderOption[];
      setPurchaseOrders(data);
      setSelectedOrderIds((current) => current.length > 0 ? current : data[0]?.id ? [data[0].id] : []);
    } catch {
      setPurchaseOrders([]);
    }
  }, []);

  useEffect(() => {
    void loadPurchaseOrders();
  }, [loadPurchaseOrders]);

  const selected = records.find((r) => r.id === selectedId);

  const overallKpis = useMemo(() => {
    const complete = records.filter((r) => r.status === "complete");
    const totalPOs = complete.reduce((s, r) => s + r.kpis.totalPOs, 0);
    const avgSla = complete.length > 0 ? complete.reduce((s, r) => s + r.kpis.withinSlaRate, 0) / complete.length : 0;
    return { documents: complete.length, totalPOs, avgSla: Math.round(avgSla * 10) / 10, vendors: new Set(complete.map((r) => r.vendorName)).size };
  }, [records]);

  const filteredPOs = useMemo(() => {
    if (!selected) return [];
    return selected.extractedPOs.filter((po) => {
      if (poFilter === "delayed") return (po.delayDays ?? 0) > 0;
      if (poFilter === "arrived") return po.arrivedStatus === "Arrived";
      if (poFilter === "pending") return po.arrivedStatus === "Pending";
      return true;
    });
  }, [selected, poFilter]);

  const handleUpload = useCallback(async () => {
    if (selectedOrderIds.length === 0 || !uploadFile || uploadState === "uploading") return;
    setUploadState("uploading");
    setUploadError(null);
    try {
      const form = new FormData();
      for (const orderId of selectedOrderIds) form.append("purchaseOrderIds", orderId);
      form.append("file", uploadFile);
      form.append("description", uploadDescription.trim());
      const res = await fetch("/api/v1/evidence", { method: "POST", body: form });
      const payload = await res.json();
      if (!res.ok || payload.ok === false) {
        throw new Error(payload.error?.message ?? "Failed to upload delivery evidence.");
      }
      const record = payload.data as EvidenceRecord;
      setUploadState("done");
      setUploadFile(null);
      setUploadDescription("");
      await loadEvidence();
      setSelectedId(record.id);
      window.setTimeout(() => setUploadState("idle"), 2000);
    } catch (err) {
      setUploadState("idle");
      setUploadError(err instanceof Error ? err.message : "Failed to upload delivery evidence.");
    }
  }, [loadEvidence, selectedOrderIds, uploadDescription, uploadFile, uploadState]);

  const handleEvidenceAction = useCallback(async (action: "review" | "reprocess" | "archive" | "delete") => {
    if (!selected || actionBusy) return;
    if (action === "delete" && !window.confirm("Delete this evidence record and source file?")) return;
    setActionBusy(action);
    try {
      const res = await fetch(action === "delete" ? `/api/v1/evidence?id=${encodeURIComponent(selected.id)}` : "/api/v1/evidence", {
        method: action === "delete" ? "DELETE" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selected.id, action }),
      });
      const payload = await res.json();
      if (!res.ok || payload.ok === false) {
        throw new Error(payload.error?.message ?? "Evidence action failed.");
      }
      await loadEvidence();
      if (action === "archive" || action === "delete") {
        setSelectedId(null);
      } else {
        setSelectedId((payload.data as EvidenceRecord)?.id ?? selected.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evidence action failed.");
    } finally {
      setActionBusy(null);
    }
  }, [actionBusy, loadEvidence, selected]);

  const statusInfo = MODULE_STATUS.evidenceAnalyzer;

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-xl bg-outline-variant/5 border border-outline-variant/10 px-4 py-3">
        <Ic name="info" className="text-base text-outline mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-on-surface-variant">SLA Evidence stores delivery evidence on purchase orders</p>
          <p className="text-[0.65rem] text-outline mt-0.5">
            Uploaded files are persisted in local object storage, attached to the PO audit trail, and used to calculate SLA evidence records.
          </p>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[0.58rem] font-semibold uppercase tracking-[0.08em] ${STATUS_STYLE[statusInfo.status]}`}>
          {statusInfo.label}
        </span>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <EvidenceKpiCard label="Documents Analyzed" value={overallKpis.documents} icon="description" />
        <EvidenceKpiCard label="Total POs Tracked" value={overallKpis.totalPOs} icon="receipt_long" />
        <EvidenceKpiCard label="Avg SLA Compliance" value={`${overallKpis.avgSla}%`} icon="verified" tone={overallKpis.avgSla >= 80 ? "ok" : "warn"} />
        <EvidenceKpiCard label="Monitored Vendors" value={overallKpis.vendors} icon="storefront" />
      </div>

      <div className="grid grid-cols-12 gap-5">
        {/* Left: Upload + History */}
        <div className="col-span-12 lg:col-span-4 space-y-4">
          {/* Upload zone */}
          <div className="bg-surface-container/50 rounded-xl ghost-border overflow-hidden">
            <div className="px-5 py-3 border-b border-outline-variant/6">
              <div className="flex items-center gap-2">
                <Ic name="cloud_upload" className="text-base text-on-surface-variant" />
                <h3 className="text-[0.8rem] font-semibold">Upload Evidence</h3>
              </div>
            </div>
            <div className="p-5">
              <div className="space-y-3">
                <div>
                  <label className="text-[0.6rem] text-outline uppercase tracking-wider block mb-1.5">Linked Purchase Orders</label>
                  <select aria-label="Linked purchase orders" multiple value={selectedOrderIds} onChange={(event) => setSelectedOrderIds(Array.from(event.target.selectedOptions).map((option) => option.value))}
                    className="w-full rounded-lg border border-outline-variant/8 bg-surface-high/30 px-3 py-2 text-xs text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/20">
                    {purchaseOrders.length === 0 ? (
                      <option value="">No purchase orders available</option>
                    ) : purchaseOrders.map((order) => (
                      <option key={order.id} value={order.id}>{order.poNumber} - {order.supplier} - {order.vessel}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-[0.58rem] text-outline">Select one or more. Parser-detected PO numbers are linked automatically when found.</p>
                </div>

                <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-outline-variant/15 bg-surface-low/20 px-4 py-5 text-center transition-colors hover:border-primary/25 hover:bg-primary/5">
                  <Ic name={uploadFile ? "check_circle" : "cloud_upload"} className={`text-2xl ${uploadFile ? "text-success" : "text-outline/50"}`} />
                  <span className="mt-2 text-xs font-semibold text-on-surface">{uploadFile ? uploadFile.name : "Choose delivery evidence"}</span>
                  <span className="mt-1 text-[0.6rem] text-outline">{uploadFile ? fmtBytes(uploadFile.size) : "PDF, XLSX, CSV, image, or supplier proof file"}</span>
                  <input
                    type="file"
                    className="hidden"
                    accept=".pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.webp,.txt,.docx"
                    onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                  />
                </label>

                <div>
                  <label className="text-[0.6rem] text-outline uppercase tracking-wider block mb-1.5">Audit Note</label>
                  <input value={uploadDescription} onChange={(event) => setUploadDescription(event.target.value)} placeholder="Optional supplier note or delivery reference"
                    className="w-full rounded-lg border border-outline-variant/8 bg-surface-high/30 px-3 py-2 text-xs text-on-surface placeholder:text-outline/30 focus:outline-none focus:ring-1 focus:ring-primary/20" />
                </div>

                {uploadError && <p className="text-[0.65rem] text-error">{uploadError}</p>}
                {uploadState === "done" && <p className="text-[0.65rem] text-success">Evidence uploaded and attached to the PO audit trail.</p>}

                <button onClick={() => void handleUpload()} disabled={selectedOrderIds.length === 0 || !uploadFile || uploadState === "uploading"}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[0.7rem] font-semibold text-on-primary transition-all hover:brightness-110 disabled:opacity-45">
                  {uploadState === "uploading" ? <div className="w-3.5 h-3.5 border-2 border-on-primary/30 border-t-on-primary rounded-full animate-spin" /> : <Ic name="upload_file" className="text-sm" />}
                  {uploadState === "uploading" ? "Uploading evidence" : "Upload Evidence"}
                </button>
              </div>
            </div>
          </div>

          {/* Audit History */}
          <div className="bg-surface-container/50 rounded-xl ghost-border overflow-hidden">
            <div className="px-5 py-3 border-b border-outline-variant/6">
              <div className="flex items-center gap-2">
                <Ic name="history" className="text-base text-on-surface-variant" />
                <h3 className="text-[0.8rem] font-semibold">Audit History</h3>
                <span className="text-[0.55rem] font-medium bg-surface-high/40 text-on-surface-variant px-1.5 py-0.5 rounded ml-auto">{records.length}</span>
              </div>
            </div>
            <div className="divide-y divide-outline-variant/4 max-h-[400px] overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center py-10">
                  <div className="w-5 h-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center py-10 text-center px-4">
                  <Ic name="cloud_off" className="text-lg text-outline mb-2" />
                  <p className="text-xs text-on-surface-variant">Unable to load audit history</p>
                  <p className="text-[0.6rem] text-outline mt-0.5">{error}</p>
                  <button onClick={loadEvidence} className="mt-3 text-[0.65rem] font-medium text-primary hover:text-primary/80">Try again</button>
                </div>
              ) : records.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center px-4">
                  <Ic name="history" className="text-lg text-outline mb-2" />
                  <p className="text-xs text-on-surface-variant">No audit history</p>
                  <p className="text-[0.6rem] text-outline mt-0.5">Upload delivery evidence against a purchase order to create the audit history.</p>
                </div>
              ) : records.map((rec) => (
                <button key={rec.id} onClick={() => { setSelectedId(rec.id); setPOFilter("all"); }}
                  className={`w-full text-left px-5 py-3 transition-colors ${selectedId === rec.id ? "bg-primary/5" : "hover:bg-surface-high/15"}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium truncate">{rec.vendorName}</span>
                    <GradeBadge grade={rec.grade} />
                  </div>
                  <div className="flex items-center gap-2 text-[0.6rem] text-outline">
                    <Ic name={fileIconFor(rec.fileType)} className="text-xs" />
                    <span className="truncate">{rec.fileName}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-[0.55rem] text-outline">
                    <span>SLA: {rec.kpis.withinSlaRate}%</span>
                    <span>{rec.kpis.totalPOs} POs</span>
                    {rec.lifecycleLabel && <span>{rec.lifecycleLabel}</span>}
                    <span>{new Date(rec.createdAt).toLocaleDateString()}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Analysis Report */}
        <div className="col-span-12 lg:col-span-8">
          {loading ? (
            <div className="bg-surface-container/50 rounded-xl ghost-border flex flex-col items-center justify-center py-20 text-center">
              <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin mb-3" />
              <p className="text-sm text-on-surface-variant">Loading evidence records</p>
            </div>
          ) : error ? (
            <div className="bg-surface-container/50 rounded-xl ghost-border flex flex-col items-center justify-center py-20 text-center">
              <Ic name="cloud_off" className="text-2xl text-outline mb-2" />
              <p className="text-sm text-on-surface-variant">Evidence unavailable</p>
              <p className="text-xs text-outline mt-1">{error}</p>
            </div>
          ) : !selected ? (
            <div className="bg-surface-container/50 rounded-xl ghost-border flex flex-col items-center justify-center py-20 text-center">
              <Ic name="analytics" className="text-2xl text-outline mb-2" />
              <p className="text-sm text-on-surface-variant">No report selected</p>
              <p className="text-xs text-outline mt-1">Choose a seeded audit record from the history panel.</p>
            </div>
          ) : (
            <div className="space-y-4 animate-fade-in">
              {/* Report Header */}
              <div className="bg-surface-container/50 rounded-xl ghost-border p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="text-sm font-semibold">{selected.vendorName}</h3>
                      <GradeBadge grade={selected.grade} large />
                    </div>
                    <p className="text-[0.65rem] text-outline">
                      {selected.fileName} - {new Date(selected.createdAt).toLocaleDateString()}
                      {selected.sizeBytes ? ` - ${fmtBytes(selected.sizeBytes)}` : ""}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {selected.lifecycleLabel && <span className="rounded-full bg-surface-high/35 px-2 py-0.5 text-[0.55rem] font-semibold text-on-surface-variant">{selected.lifecycleLabel}</span>}
                      {selected.evidenceDate && <span className="rounded-full bg-success/8 px-2 py-0.5 text-[0.55rem] font-semibold text-success">Evidence {new Date(selected.evidenceDate).toLocaleDateString()}</span>}
                      {(selected.linkedPoNumbers ?? []).map((poNumber) => <span key={poNumber} className="rounded-full bg-primary/8 px-2 py-0.5 text-[0.55rem] font-semibold text-primary">{poNumber}</span>)}
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <button
                      onClick={() => selected.downloadUrl && window.open(selected.downloadUrl, "_blank", "noopener,noreferrer")}
                      disabled={!selected.downloadUrl}
                      className="flex items-center gap-1 text-[0.65rem] font-medium bg-surface-high/30 text-on-surface-variant px-2.5 py-1.5 rounded-md hover:bg-surface-high/50 transition-colors disabled:opacity-40">
                      <Ic name={selected.downloadUrl ? "download" : "lock"} className="text-xs" />{selected.downloadUrl ? "Source" : "No Source"}
                    </button>
                    {selected.evidenceSource === "sla_evidence" && (
                      <>
                        <button onClick={() => void handleEvidenceAction("review")} disabled={Boolean(actionBusy) || selected.lifecycleStatus === "Reviewed"}
                          className="flex items-center gap-1 text-[0.65rem] font-medium bg-success/8 text-success px-2.5 py-1.5 rounded-md hover:bg-success/12 transition-colors disabled:opacity-40">
                          <Ic name="verified" className="text-xs" />Review
                        </button>
                        <button onClick={() => void handleEvidenceAction("reprocess")} disabled={Boolean(actionBusy)}
                          className="flex items-center gap-1 text-[0.65rem] font-medium bg-primary/8 text-primary px-2.5 py-1.5 rounded-md hover:bg-primary/12 transition-colors disabled:opacity-40">
                          <Ic name="autorenew" className="text-xs" />Reprocess
                        </button>
                        <button onClick={() => void handleEvidenceAction("archive")} disabled={Boolean(actionBusy)}
                          className="flex items-center gap-1 text-[0.65rem] font-medium bg-surface-high/30 text-on-surface-variant px-2.5 py-1.5 rounded-md hover:bg-surface-high/50 transition-colors disabled:opacity-40">
                          <Ic name="archive" className="text-xs" />Archive
                        </button>
                        <button onClick={() => void handleEvidenceAction("delete")} disabled={Boolean(actionBusy)}
                          className="flex items-center gap-1 text-[0.65rem] font-medium bg-error/8 text-error px-2.5 py-1.5 rounded-md hover:bg-error/12 transition-colors disabled:opacity-40">
                          <Ic name="delete" className="text-xs" />Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                  <MiniStat label="SLA Compliance" value={`${selected.kpis.withinSlaRate}%`} tone={selected.kpis.withinSlaRate >= 90 ? "ok" : selected.kpis.withinSlaRate >= 70 ? "warn" : "danger"} />
                  <MiniStat label="On-Time Rate" value={`${selected.kpis.onTimeRate}%`} tone={selected.kpis.onTimeRate >= 80 ? "ok" : "warn"} />
                  <MiniStat label="Avg Delay" value={`${selected.kpis.avgDelayDays}d`} tone={selected.kpis.avgDelayDays <= 5 ? "ok" : "warn"} />
                  <MiniStat label="Max Delay" value={`${selected.kpis.maxDelayDays}d`} tone={selected.kpis.maxDelayDays <= 10 ? "ok" : "danger"} />
                  <MiniStat label="Total POs" value={selected.kpis.totalPOs.toString()} />
                  <MiniStat label="Arrived" value={selected.kpis.arrivedCount.toString()} />
                </div>
              </div>

              {/* Executive Summary */}
              <div className="bg-surface-container/50 rounded-xl ghost-border p-5 space-y-3">
                <h4 className="text-[0.8rem] font-semibold flex items-center gap-2">
                  <Ic name="psychology" className="text-base text-primary" />Executive Summary
                </h4>
                <div>
                  <p className="text-[0.6rem] font-semibold uppercase tracking-wider text-on-surface-variant mb-1">Reliability Assessment</p>
                  <p className="text-xs text-on-surface-variant leading-relaxed">{selected.executiveSummary.reliabilityAssessment}</p>
                </div>
                <div>
                  <p className="text-[0.6rem] font-semibold uppercase tracking-wider text-on-surface-variant mb-1">Pattern Detection</p>
                  <p className="text-xs text-on-surface-variant leading-relaxed">{selected.executiveSummary.patternDetection}</p>
                </div>
              </div>

              {((selected.parserWarnings?.length ?? 0) > 0 || selected.extractedTextPreview) && (
                <div className="bg-surface-container/50 rounded-xl ghost-border p-5 space-y-3">
                  <h4 className="text-[0.8rem] font-semibold flex items-center gap-2">
                    <Ic name="plagiarism" className="text-base text-primary" />Parser Evidence
                  </h4>
                  {(selected.parserWarnings?.length ?? 0) > 0 && (
                    <div className="space-y-1.5">
                      {selected.parserWarnings!.map((warning) => (
                        <div key={warning} className="flex items-start gap-2 rounded-lg bg-warning/8 px-3 py-2 text-[0.65rem] text-warning">
                          <Ic name="warning" className="text-xs mt-0.5" />
                          <span>{warning}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {selected.extractedTextPreview && (
                    <div>
                      <p className="text-[0.6rem] font-semibold uppercase tracking-wider text-on-surface-variant mb-1">Extracted Text Preview</p>
                      <p className="max-h-28 overflow-auto rounded-lg bg-surface-low/20 p-3 text-[0.65rem] leading-relaxed text-on-surface-variant">{selected.extractedTextPreview}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Delay Distribution */}
              <div className="bg-surface-container/50 rounded-xl ghost-border p-5">
                <h4 className="text-[0.8rem] font-semibold mb-3">Delay Distribution</h4>
                <div className="space-y-2">
                  {selected.delayDistribution.map((bucket) => {
                    const maxCount = Math.max(...selected.delayDistribution.map((b) => b.count));
                    const pct = maxCount > 0 ? (bucket.count / maxCount) * 100 : 0;
                    const color = bucket.slaStatus === "within" ? "bg-success" : bucket.slaStatus === "boundary" ? "bg-warning" : bucket.slaStatus === "exceeded" ? "bg-error/80" : "bg-error";
                    return (
                      <div key={bucket.bucket} className="flex items-center gap-3">
                        <span className="text-[0.6rem] text-on-surface-variant w-44 shrink-0 truncate">{bucket.bucket}</span>
                        <div className="flex-1 h-4 bg-surface-low/20 rounded overflow-hidden">
                          <div className={`h-full ${color} rounded transition-all`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs font-mono font-medium w-8 text-right">{bucket.count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Extracted POs */}
              <div className="bg-surface-container/50 rounded-xl ghost-border overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-outline-variant/6">
                  <h4 className="text-[0.8rem] font-semibold">Extracted Purchase Orders</h4>
                  <div className="flex gap-1.5">
                    {(["all", "delayed", "arrived", "pending"] as const).map((f) => (
                      <button key={f} onClick={() => setPOFilter(f)} className={`px-2 py-0.5 rounded text-[0.6rem] font-medium transition-colors capitalize ${poFilter === f ? "bg-primary/10 text-primary" : "text-outline hover:text-on-surface-variant"}`}>{f}</button>
                    ))}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="border-b border-outline-variant/6 bg-surface-low/10">
                      {["PO Number", "Vessel", "Requested Date", "Delay", "Status"].map((h) => (
                        <th key={h} className="px-4 py-2 text-left text-[0.55rem] font-medium text-outline uppercase tracking-wider">{h}</th>
                      ))}
                    </tr></thead>
                    <tbody className="divide-y divide-outline-variant/4">
                      {filteredPOs.map((po) => (
                        <tr key={po.poNumber} className="hover:bg-surface-high/15 transition-colors">
                          <td className="px-4 py-2 font-mono font-medium">{po.poNumber}</td>
                          <td className="px-4 py-2 text-on-surface-variant">{po.vesselName ?? "-"}</td>
                          <td className="px-4 py-2 text-outline">{po.requestedDeliveryDate ? new Date(po.requestedDeliveryDate).toLocaleDateString() : "-"}</td>
                          <td className={`px-4 py-2 font-mono font-medium ${(po.delayDays ?? 0) > 10 ? "text-error" : (po.delayDays ?? 0) > 0 ? "text-warning" : "text-success"}`}>
                            {(po.delayDays ?? 0) === 0 ? "On time" : `${po.delayDays}d`}
                          </td>
                          <td className="px-4 py-2">
                            <span className={`text-[0.55rem] font-medium px-1.5 py-0.5 rounded ${po.arrivedStatus === "Arrived" ? "bg-success/8 text-success" : "bg-warning/8 text-warning"}`}>
                              {po.arrivedStatus}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredPOs.length === 0 && (
                    <div className="py-6 text-center"><p className="text-xs text-outline">No POs match filter</p></div>
                  )}
                </div>
              </div>

              {/* Recommended Actions */}
              <div className="bg-surface-container/50 rounded-xl ghost-border p-5">
                <h4 className="text-[0.8rem] font-semibold mb-3 flex items-center gap-2">
                  <Ic name="lightbulb" className="text-base text-warning" />Recommended Actions
                </h4>
                <div className="space-y-2">
                  {selected.recommendedActions.map((action, i) => (
                    <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-surface-low/15 hover:bg-surface-low/25 transition-colors">
                      <span className="text-[0.6rem] font-mono font-medium text-outline mt-0.5 shrink-0">{i + 1}.</span>
                      <p className="text-xs text-on-surface-variant leading-relaxed">{action}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Subcomponents ───────────────────────────────────────────── */

function EvidenceKpiCard({ label, value, icon, tone = "neutral" }: { label: string; value: number | string; icon: string; tone?: "ok" | "warn" | "neutral" }) {
  const t = {
    ok: "bg-success/5 border-success/10",
    warn: "bg-warning/5 border-warning/10",
    neutral: "bg-surface-container/50 border-outline-variant/6",
  }[tone];
  return (
    <div className={`rounded-xl p-3.5 border ${t}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[0.6rem] font-medium text-on-surface-variant">{label}</span>
        <Ic name={icon} className="text-sm text-outline" />
      </div>
      <p className="text-lg font-semibold font-mono">{value}</p>
    </div>
  );
}

function GradeBadge({ grade, large = false }: { grade: Grade; large?: boolean }) {
  const colors: Record<Grade, string> = {
    A: "bg-success/10 text-success border-success/15",
    B: "bg-primary/10 text-primary border-primary/15",
    C: "bg-warning/10 text-warning border-warning/15",
    D: "bg-error/10 text-error border-error/15",
    F: "bg-error/15 text-error border-error/20",
  };
  return (
    <span className={`font-bold border rounded-md ${colors[grade]} ${large ? "text-sm px-2.5 py-1" : "text-[0.6rem] px-1.5 py-0.5"}`}>
      Grade {grade}
    </span>
  );
}

function MiniStat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "ok" | "warn" | "danger" | "neutral" }) {
  const tx = { ok: "text-success", warn: "text-warning", danger: "text-error", neutral: "text-on-surface" }[tone];
  return (
    <div className="p-2.5 rounded-lg bg-surface-low/20 text-center">
      <p className="text-[0.5rem] text-outline mb-1">{label}</p>
      <p className={`text-sm font-semibold font-mono ${tx}`}>{value}</p>
    </div>
  );
}
