"use client";

import { Fragment, useState, useMemo, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type {
  AgreementVersion, AgreementItem, AgreementComparison,
  AgreementChange, AgreementInsight, AgreementStatus, ChangeType,
  CustomerContract, CustomerContractItem, CustomerContractStatus, ShippingCompany,
} from "@/types/erp";
import { useDialogA11y } from "@/lib/hooks/use-dialog-a11y";

/* ════════════════════════════════════════════════════════════
   Micro helpers
   ════════════════════════════════════════════════════════════ */

function Ic({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span
      className={`material-symbols-outlined ${className}`}
      style={{ fontVariationSettings: "'FILL' 0, 'wght' 300, 'opsz' 20" }}
    >{name}</span>
  );
}

const STATUS_COLORS: Record<string, string> = {
  Draft: "bg-warning/12 text-warning border border-warning/20",
  Sent: "bg-info/8 text-info",
  Active: "bg-success/8 text-success",
  Expired: "bg-error/8 text-error",
  Archived: "bg-surface-high/20 text-outline",
};

const CHANGE_COLORS: Record<string, string> = {
  New: "bg-success/8 text-success border border-success/20",
  Removed: "bg-error/8 text-error border border-error/20",
  PriceChange: "bg-warning/8 text-warning border border-warning/20",
  FieldChange: "bg-info/8 text-info border border-info/20",
};

const REVIEW_COLORS: Record<string, string> = {
  Pending: "bg-surface-high/40 text-on-surface-variant",
  Accepted: "bg-success/8 text-success",
  Rejected: "bg-error/8 text-error",
  AutoApplied: "bg-info/8 text-info",
};

const SEVERITY_STYLES: Record<string, { border: string; bg: string; icon: string; iconColor: string }> = {
  info: { border: "border-l-info/60", bg: "bg-info/4", icon: "lightbulb", iconColor: "text-info" },
  warning: { border: "border-l-warning/60", bg: "bg-warning/4", icon: "warning_amber", iconColor: "text-warning" },
  critical: { border: "border-l-error/60", bg: "bg-error/4", icon: "error_outline", iconColor: "text-error" },
};

function StatusBadge({ status, className = "" }: { status: string; className?: string }) {
  return (
    <span className={`text-[0.65rem] font-semibold px-2 py-0.5 rounded ${STATUS_COLORS[status] || STATUS_COLORS.Draft} ${className}`}>
      {status}
    </span>
  );
}

function MiniKpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="p-3 rounded-lg bg-surface-low/25 border border-outline-variant/5">
      <p className="text-[0.68rem] text-outline mb-1 font-medium">{label}</p>
      <p className={`text-base font-semibold font-mono leading-tight ${accent || ""}`}>{value}</p>
      {sub && <p className="text-[0.65rem] text-outline mt-1">{sub}</p>}
    </div>
  );
}

function MarkupKpi({ currentMarkup, onSave }: { currentMarkup: number; onSave: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentMarkup);
  useEffect(() => { setValue(currentMarkup); }, [currentMarkup]);
  return (
    <div className="p-2.5 rounded-lg bg-surface-low/20">
      <p className="text-[0.55rem] text-outline mb-0.5">Markup %</p>
      {editing ? (
        <div className="flex items-center gap-1">
          <input type="number" value={value} onChange={(e) => setValue(Number(e.target.value))} min={0} max={100} step={0.5}
            className="w-14 text-sm font-mono font-semibold bg-transparent border-b border-primary/40 focus:outline-none text-center" autoFocus />
          <button onClick={() => { onSave(value); setEditing(false); }} className="text-success"><Ic name="check" className="text-xs" /></button>
          <button onClick={() => { setValue(currentMarkup); setEditing(false); }} className="text-outline"><Ic name="close" className="text-xs" /></button>
        </div>
      ) : (
        <button onClick={() => setEditing(true)} className="text-sm font-semibold font-mono hover:text-primary transition-colors flex items-center gap-1">
          {currentMarkup}%<Ic name="edit" className="text-[0.6rem] text-outline/40" />
        </button>
      )}
    </div>
  );
}

function fmt(n: number) {
  if (n >= 1_000_000) return `€${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `€${(n / 1000).toFixed(1)}K`;
  return `€${n.toFixed(2)}`;
}

function fmtDate(d: string | Date | null | undefined, short = false) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", short
    ? { day: "2-digit", month: "short" }
    : { day: "2-digit", month: "short", year: "numeric" });
}

function daysUntil(d: string | Date | null | undefined): number | null {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

/* ════════════════════════════════════════════════════════════
   Types
   ════════════════════════════════════════════════════════════ */

type GlobalTab = "versions" | "customer-contracts" | "compare" | "insights";
type WorkspaceTab = "items" | "comparisons" | "history";

interface CustomerContractKpis {
  total: number;
  active: number;
  draft: number;
  underReview: number;
  expiring: number;
  value: number;
}

interface VersionDetail extends AgreementVersion {
  items: AgreementItem[];
  comparisons: AgreementComparison[];
}

interface AgreementContextDetail {
  moduleKey?: string;
  id?: string;
  supplierId?: string;
  supplierName?: string;
}

function agreementItemCode(item: Pick<AgreementItem, "offiNumber" | "lineNumber">) {
  const raw = item.offiNumber?.trim();
  if (raw && /^OFFI[-_\s]?\d+$/i.test(raw)) {
    const suffix = raw.replace(/\D/g, "");
    return suffix ? `NTX-${suffix}` : `NTX-${String(1000 + item.lineNumber).padStart(4, "0")}`;
  }
  return raw || `NTX-${String(1000 + item.lineNumber).padStart(4, "0")}`;
}

/* ════════════════════════════════════════════════════════════
   ContractsModule — main
   ════════════════════════════════════════════════════════════ */

export function ContractsModule() {
  const [tab, setTab] = useState<GlobalTab>("versions");
  const [wsTab, setWsTab] = useState<WorkspaceTab>("items");

  // Version list
  const [versions, setVersions] = useState<AgreementVersion[]>([]);
  const [agreementPool, setAgreementPool] = useState<AgreementVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [draftingFromId, setDraftingFromId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | AgreementStatus>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<VersionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pendingSupplierContext, setPendingSupplierContext] = useState<{ supplierId?: string; supplierName?: string } | null>(null);

  // Comparison
  const [comparison, setComparison] = useState<(AgreementComparison & { changes: AgreementChange[] }) | null>(null);
  const [comparisonVersionId, setComparisonVersionId] = useState<string | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Insights
  const [insights, setInsights] = useState<AgreementInsight[]>([]);
  const [scanning, setScanning] = useState(false);

  // Customer contracts
  const [customerContracts, setCustomerContracts] = useState<CustomerContract[]>([]);
  const [customerContractKpis, setCustomerContractKpis] = useState<CustomerContractKpis>({ total: 0, active: 0, draft: 0, underReview: 0, expiring: 0, value: 0 });
  const [contractsLoading, setContractsLoading] = useState(false);
  const [contractSearch, setContractSearch] = useState("");
  const [contractStatusFilter, setContractStatusFilter] = useState<"all" | CustomerContractStatus>("all");
  const [selectedContractId, setSelectedContractId] = useState<string | null>(null);
  const [selectedContract, setSelectedContract] = useState<CustomerContract | null>(null);
  const [contractDetailLoading, setContractDetailLoading] = useState(false);
  const [showCreateContract, setShowCreateContract] = useState(false);
  const [shippingCompanies, setShippingCompanies] = useState<ShippingCompany[]>([]);

  // Items
  const [itemSearch, setItemSearch] = useState("");
  const [sortField, setSortField] = useState<string>("lineNumber");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // UI
  const [showCreate, setShowCreate] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ── Derived: other versions for selected supplier ───────── */
  const supplierVersions = useMemo(() => {
    if (!detail) return [];
    return agreementPool
      .filter((v) => v.supplierId === detail.supplierId)
      .sort((a, b) => b.versionNumber - a.versionNumber);
  }, [agreementPool, detail]);

  const compareAgreementOptions = useMemo(() => {
    return agreementPool
      .filter((agreement) => agreement.status !== "Archived")
      .sort((a, b) => {
        const activeRank = (b.status === "Active" ? 1 : 0) - (a.status === "Active" ? 1 : 0);
        return activeRank || a.supplierName.localeCompare(b.supplierName) || b.versionNumber - a.versionNumber;
      });
  }, [agreementPool]);

  const comparisonSource = useMemo(() => {
    const versionId = comparisonVersionId || comparison?.versionId || selectedId;
    if (!versionId) return null;
    return agreementPool.find((agreement) => agreement.id === versionId) || detail || null;
  }, [agreementPool, comparison?.versionId, comparisonVersionId, detail, selectedId]);

  /* ── Data fetching ─────────────────────────────────────────── */
  const fetchVersions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (search) params.set("search", search);
      const res = await fetch(`/api/v1/agreements?${params}&limit=200`);
      const data = await res.json();
      setVersions(data.versions || []);
    } catch { /* no-op */ }
    setLoading(false);
  }, [statusFilter, search]);

  const fetchAgreementPool = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/agreements?limit=200");
      const data = await res.json();
      setAgreementPool(data.versions || []);
    } catch {
      setAgreementPool([]);
    }
  }, []);

  const fetchDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/v1/agreements/${id}`);
      const data = await res.json();
      setDetail(data.version || null);
    } catch { /* no-op */ }
    setDetailLoading(false);
  }, []);

  const fetchInsights = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/agreements/insights");
      const data = await res.json();
      setInsights(data.insights || []);
    } catch { /* no-op */ }
  }, []);

  const fetchCustomerContracts = useCallback(async () => {
    setContractsLoading(true);
    try {
      const params = new URLSearchParams();
      if (contractStatusFilter !== "all") params.set("status", contractStatusFilter);
      if (contractSearch) params.set("search", contractSearch);
      const res = await fetch(`/api/v1/agreements/customer-contracts?${params.toString()}`);
      const data = await res.json();
      setCustomerContracts(data.contracts || []);
      setCustomerContractKpis(data.kpis || { total: 0, active: 0, draft: 0, underReview: 0, expiring: 0, value: 0 });
    } catch {
      setCustomerContracts([]);
    }
    setContractsLoading(false);
  }, [contractSearch, contractStatusFilter]);

  const fetchSelectedContract = useCallback(async (id: string) => {
    setContractDetailLoading(true);
    try {
      const res = await fetch(`/api/v1/agreements/customer-contracts/${id}`);
      const data = await res.json();
      setSelectedContract(data.contract || null);
    } catch {
      setSelectedContract(null);
    }
    setContractDetailLoading(false);
  }, []);

  const fetchShippingCompanies = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/shipping-companies");
      const data = await res.json();
      setShippingCompanies(data.data || []);
    } catch {
      setShippingCompanies([]);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- These effects synchronize network and navigation state with the active workspace. */
  useEffect(() => { fetchVersions(); }, [fetchVersions]);
  useEffect(() => { fetchAgreementPool(); }, [fetchAgreementPool]);
  useEffect(() => { if (selectedId) fetchDetail(selectedId); else setDetail(null); }, [selectedId, fetchDetail]);
  useEffect(() => { if (tab === "insights") fetchInsights(); }, [tab, fetchInsights]);
  useEffect(() => { if (tab === "customer-contracts") { fetchCustomerContracts(); fetchShippingCompanies(); } }, [tab, fetchCustomerContracts, fetchShippingCompanies]);
  useEffect(() => { if (selectedContractId) fetchSelectedContract(selectedContractId); else setSelectedContract(null); }, [selectedContractId, fetchSelectedContract]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const applyContext = (detail: AgreementContextDetail) => {
      if (detail.moduleKey !== "contracts") return;
      setTab("versions");
      setWsTab("items");
      setItemSearch("");
      setComparison(null);
      setComparisonVersionId(null);
      if (detail.id && detail.id.startsWith("agreement:")) {
        setSelectedId(detail.id.replace(/^agreement:/, ""));
        return;
      }
      setPendingSupplierContext({ supplierId: detail.supplierId ?? detail.id, supplierName: detail.supplierName });
    };

    const openFromHash = () => {
      const hash = window.location.hash.replace(/^#/, "");
      const [moduleKey, id] = hash.split(":");
      if (moduleKey === "contracts" && id) {
        applyContext({ moduleKey, id: decodeURIComponent(id) });
      }
    };

    const handleRecordContext = (event: Event) => {
      applyContext((event as CustomEvent<AgreementContextDetail>).detail);
    };

    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    window.addEventListener("nautex:record-context", handleRecordContext);
    return () => {
      window.removeEventListener("hashchange", openFromHash);
      window.removeEventListener("nautex:record-context", handleRecordContext);
    };
  }, []);

  useEffect(() => {
    if (!pendingSupplierContext || loading) return;
    const supplierId = pendingSupplierContext.supplierId;
    const supplierName = pendingSupplierContext.supplierName?.toLowerCase();
    const match = versions
      .filter((version) =>
        (supplierId && version.supplierId === supplierId) ||
        (supplierName && version.supplierName.toLowerCase() === supplierName),
      )
      .sort((a, b) => {
        const activeRank = (b.status === "Active" ? 1 : 0) - (a.status === "Active" ? 1 : 0);
        return activeRank || b.versionNumber - a.versionNumber;
      })[0];
    if (match) setSelectedId(match.id);
    setPendingSupplierContext(null);
  }, [loading, pendingSupplierContext, versions]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /* ── Filtered + sorted items ────────────────────────────────── */
  const filteredItems = useMemo(() => {
    if (!detail?.items) return [];
    let items = [...detail.items];
    if (itemSearch) {
      const q = itemSearch.toLowerCase();
      items = items.filter((i) =>
        i.description.toLowerCase().includes(q) ||
        (i.offiNumber || "").toLowerCase().includes(q) ||
        (i.vendorPartNumber || "").toLowerCase().includes(q) ||
        (i.hsCode || "").toLowerCase().includes(q) ||
        (i.countryOfOrigin || "").toLowerCase().includes(q) ||
        (i.manufacturer || "").toLowerCase().includes(q),
      );
    }
    items.sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortField];
      const bv = (b as unknown as Record<string, unknown>)[sortField];
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return items;
  }, [detail, itemSearch, sortField, sortDir]);

  /* ── Summary KPIs (global bar) ──────────────────────────────── */
  const kpis = useMemo(() => ({
    total: agreementPool.length,
    active: agreementPool.filter((v) => v.status === "Active").length,
    draft: agreementPool.filter((v) => v.status === "Draft").length,
    expiring: agreementPool.filter((v) => {
      const d = daysUntil(v.validTo);
      return v.status === "Active" && d !== null && d > 0 && d <= 30;
    }).length,
    totalValue: agreementPool.reduce((s, v) => s + (v.totalBaseValue || 0), 0),
    totalItems: agreementPool.reduce((s, v) => s + (v._count?.items || 0), 0),
  }), [agreementPool]);

  /* ── Actions ───────────────────────────────────────────────── */
  const handleUploadFile = async (file: File) => {
    if (!selectedId) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/v1/agreements/${selectedId}/compare`, { method: "POST", body: form });
      const data = await res.json();
      if (data.comparison) {
        setTab("compare");
        setComparisonVersionId(selectedId);
        pollComparison(selectedId, data.comparison.id);
      }
    } catch { /* no-op */ }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const pollComparison = useCallback(async (versionId: string, compId: string) => {
    setComparisonLoading(true);
    setComparisonVersionId(versionId);
    const poll = async () => {
      const res = await fetch(`/api/v1/agreements/${versionId}/compare?comparisonId=${compId}`);
      const data = await res.json();
      if (data.comparison) {
        setComparison(data.comparison);
        if (data.comparison.status === "Queued" || data.comparison.status === "Processing") {
          setTimeout(poll, 1500);
          return;
        }
      }
      setComparisonLoading(false);
    };
    poll();
  }, []);

  const handleReview = async (action: "accept" | "reject" | "auto_apply", changeIds?: string[]) => {
    const versionId = comparisonVersionId || selectedId;
    if (!versionId || !comparison) return;
    const res = await fetch(`/api/v1/agreements/${versionId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, changeIds, comparisonId: comparison.id }),
    });
    if (res.ok) {
      pollComparison(versionId, comparison.id);
      fetchDetail(versionId);
    }
  };

  const handleSelectCompareAgreement = (versionId: string) => {
    setSelectedId(versionId || null);
    setComparisonVersionId(versionId || null);
    setComparison(null);
  };

  const handleDeleteComparison = async () => {
    const versionId = comparisonVersionId || comparison?.versionId || selectedId;
    if (!versionId || !comparison || !confirm("Delete this comparison history entry? This will remove its detected changes as well.")) return;
    const res = await fetch(`/api/v1/agreements/${versionId}/compare?comparisonId=${comparison.id}`, { method: "DELETE" });
    if (res.ok) {
      setComparison(null);
      setComparisonVersionId(versionId);
      await Promise.all([fetchDetail(versionId), fetchVersions(), fetchAgreementPool()]);
    }
  };

  const handleExport = async (markAsSent = false) => {
    if (!selectedId) return;
    const url = `/api/v1/agreements/${selectedId}/export${markAsSent ? "?markAsSent=true" : ""}`;
    const res = await fetch(url);
    if (res.ok) {
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = res.headers.get("content-disposition")?.split("filename=")[1]?.replace(/"/g, "") || "agreement.xlsx";
      a.click();
      if (markAsSent) { fetchVersions(); fetchAgreementPool(); fetchDetail(selectedId); }
    }
  };

  const handleExportPdf = async () => {
    if (!selectedId) return;
    const res = await fetch(`/api/v1/agreements/${selectedId}/export/pdf`);
    if (res.ok) {
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = res.headers.get("content-disposition")?.split("filename=")[1]?.replace(/"/g, "") || "agreement.pdf";
      a.click();
      URL.revokeObjectURL(a.href);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!selectedId) return;
    await fetch(`/api/v1/agreements/${selectedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    fetchVersions();
    fetchAgreementPool();
    fetchDetail(selectedId);
  };

  const handleMarkupChange = async (newMarkup: number) => {
    if (!selectedId) return;
    await fetch(`/api/v1/agreements/${selectedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markupPercent: newMarkup }),
    });
    fetchDetail(selectedId);
    fetchVersions();
    fetchAgreementPool();
  };

  const handleValidityChange = async (validFrom: string, validTo: string) => {
    if (!selectedId) return;
    await fetch(`/api/v1/agreements/${selectedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ validFrom: validFrom || null, validTo: validTo || null }),
    });
    fetchDetail(selectedId);
    fetchVersions();
    fetchAgreementPool();
  };

  const handleDuplicate = async () => {
    if (!selectedId) return;
    const res = await fetch(`/api/v1/agreements/${selectedId}/duplicate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (res.ok) {
      const data = await res.json();
      await Promise.all([fetchVersions(), fetchAgreementPool()]);
      setSelectedId(data.version.id);
      setWsTab("items");
    }
  };

  const handleCreateDraftFromAgreement = async (agreement: AgreementVersion) => {
    setDraftingFromId(agreement.id);
    const res = await fetch(`/api/v1/agreements/${agreement.id}/duplicate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: `Editable draft copied from active v${agreement.versionNumber}` }),
    });
    setDraftingFromId(null);
    if (res.ok) {
      const data = await res.json();
      setStatusFilter("Draft");
      await Promise.all([fetchVersions(), fetchAgreementPool()]);
      setSelectedId(data.version.id);
      setWsTab("items");
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Draft copy could not be created.");
    }
  };

  const handleDelete = async () => {
    if (!selectedId || !confirm("Delete this draft agreement? This cannot be undone.")) return;
    const res = await fetch(`/api/v1/agreements/${selectedId}`, { method: "DELETE" });
    if (res.ok) { setSelectedId(null); setDetail(null); fetchVersions(); fetchAgreementPool(); }
    else {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Agreement could not be deleted.");
    }
  };

  const handleDismissInsight = async (insightId: string) => {
    await fetch("/api/v1/agreements/insights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ insightId, action: "dismiss" }),
    });
    fetchInsights();
  };

  const handleScan = async () => {
    setScanning(true);
    await fetch("/api/v1/agreements/scan", { method: "POST" });
    await fetchInsights();
    setScanning(false);
  };

  const handleCreateCustomerContract = async (payload: {
    shippingCompanyId: string;
    title: string;
    markupPercent: number;
    validFrom: string;
    validTo: string;
    paymentTerms: string;
    deliveryTerms: string;
    notes: string;
    agreementVersionIds: string[];
  }) => {
    const res = await fetch("/api/v1/agreements/customer-contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const data = await res.json();
      setShowCreateContract(false);
      await Promise.all([fetchCustomerContracts(), fetchAgreementPool()]);
      setSelectedContractId(data.contract?.id || null);
    }
  };

  const handleUpdateCustomerContract = async (id: string, payload: Record<string, unknown>) => {
    const res = await fetch(`/api/v1/agreements/customer-contracts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const data = await res.json();
      setSelectedContract(data.contract || null);
      await Promise.all([fetchCustomerContracts(), fetchAgreementPool()]);
    }
  };

  const handleDeleteCustomerContract = async (id: string) => {
    if (!confirm("Delete this customer contract draft? This cannot be undone.")) return;
    const res = await fetch(`/api/v1/agreements/customer-contracts/${id}`, { method: "DELETE" });
    if (res.ok) {
      setSelectedContractId(null);
      setSelectedContract(null);
      await fetchCustomerContracts();
    }
  };

  /* ── Render ─────────────────────────────────────────────────── */
  return (
    <div className="space-y-4">
      <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
        onChange={(e) => { if (e.target.files?.[0]) handleUploadFile(e.target.files[0]); }} />
      {/* ── Global tab bar + summary strip ─────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 bg-surface-container/50 p-0.5 rounded-lg ghost-border">
          {(["versions", "customer-contracts", "compare", "insights"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`relative px-4 py-2 rounded-md text-sm font-semibold transition-colors ${tab === t ? "bg-primary/10 text-primary" : "text-on-surface-variant hover:bg-surface-high/30"}`}>
              {t === "versions" ? "Supplier Agreements" : t === "customer-contracts" ? "Customer Contracts" : t === "compare" ? "Compare" : "Insights"}
              {t === "insights" && insights.filter((i) => !i.dismissed).length > 0 && (
                <span className="ml-1.5 text-[0.62rem] bg-warning/20 text-warning px-1.5 py-0.5 rounded-full font-mono">
                  {insights.filter((i) => !i.dismissed).length}
                </span>
              )}
              {t === "customer-contracts" && customerContractKpis.underReview > 0 && (
                <span className="ml-1.5 text-[0.62rem] bg-warning/20 text-warning px-1.5 py-0.5 rounded-full font-mono">
                  {customerContractKpis.underReview}
                </span>
              )}
              {t === "compare" && comparison && (
                <span className="ml-1.5 text-[0.62rem] bg-primary/15 text-primary px-1.5 py-0.5 rounded-full font-mono">1</span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-5 text-xs text-outline">
          <span><strong className="text-on-surface font-mono">{kpis.active}</strong> active</span>
          <span><strong className="text-on-surface font-mono">{kpis.draft}</strong> draft</span>
          {kpis.expiring > 0 && (
            <span className="text-warning font-medium flex items-center gap-1">
              <Ic name="schedule" className="text-xs" /><strong className="font-mono">{kpis.expiring}</strong> expiring
            </span>
          )}
          <span><strong className="text-on-surface font-mono">{kpis.totalItems.toLocaleString()}</strong> items</span>
          <span><strong className="text-on-surface font-mono">{fmt(kpis.totalValue)}</strong></span>
          <span><strong className="text-on-surface font-mono">{customerContractKpis.active}</strong> customer contracts</span>
        </div>
      </div>

      {/* ══ VERSIONS TAB ══════════════════════════════════════════ */}
      {tab === "versions" && (
        <div className="grid grid-cols-12 gap-5">

          {/* Left: version list */}
          <div className="col-span-12 space-y-4">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Ic name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-outline/40" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search agreements..."
                  className="w-full bg-surface-high/30 border border-outline-variant/8 rounded-lg pl-9 pr-3 py-2.5 text-sm placeholder:text-outline/35 focus:outline-none focus:ring-1 focus:ring-primary/25" />
              </div>
              <button onClick={() => setShowCreate(!showCreate)}
                className="flex items-center gap-2 text-sm font-semibold bg-primary/10 text-primary px-4 py-2.5 rounded-lg hover:bg-primary/15 transition-colors whitespace-nowrap">
                <Ic name="add" className="text-base" />New Agreement
              </button>
            </div>

            {/* Status filters */}
            <div className="flex items-center gap-1">
              {(["all", "Draft", "Sent", "Active", "Expired", "Archived"] as const).map((s) => (
                <button key={s} onClick={() => setStatusFilter(s as typeof statusFilter)}
                  className={`px-3 py-1.5 rounded-md text-sm font-semibold transition-colors ${statusFilter === s ? "bg-primary/10 text-primary" : "text-on-surface-variant hover:bg-surface-high/25"}`}>
                  {s === "all" ? "All" : s}
                </button>
              ))}
            </div>

            {showCreate && (
              <CreateAgreementForm
                onCreated={(id) => { setShowCreate(false); fetchVersions(); fetchAgreementPool(); if (id) { setSelectedId(id); setWsTab("items"); } }}
                onCancel={() => setShowCreate(false)}
              />
            )}

            {statusFilter === "Draft" && (
              <section className="rounded-xl bg-surface-container/45 ghost-border p-4">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Ic name="edit_document" className="text-primary text-base" />
                      <h3 className="text-sm font-semibold">Create Editable Draft from Active Agreement</h3>
                    </div>
                    <p className="text-sm text-outline mt-1">
                      Active trade agreements stay available for customer contracts. Use this to copy an active Ship Chandler agreement into Draft for edits, adjustments, or renewal work.
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-mono text-outline bg-surface-high/35 px-2 py-1 rounded">
                    {agreementPool.filter((agreement) => agreement.status === "Active").length} active sources
                  </span>
                </div>
                <div className="mt-4 divide-y divide-outline-variant/5 rounded-lg border border-outline-variant/8 overflow-hidden">
                  {agreementPool.filter((agreement) => agreement.status === "Active").length === 0 ? (
                    <div className="p-4 text-sm text-outline">No active trade agreements are available to copy into Draft.</div>
                  ) : agreementPool.filter((agreement) => agreement.status === "Active").map((agreement) => (
                    <div key={agreement.id} className="flex flex-col gap-3 p-3 bg-surface-low/10 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold truncate">{agreement.supplierName}</p>
                          <span className="text-xs font-mono text-outline bg-surface-high/40 px-1.5 py-0.5 rounded">v{agreement.versionNumber}</span>
                          <StatusBadge status={agreement.status} />
                        </div>
                        <p className="text-sm text-outline mt-1">
                          {agreement._count?.items || 0} items / markup {agreement.markupPercent}% / sell value {fmt(agreement.totalMarkedUpValue || 0)}
                        </p>
                      </div>
                      <button
                        onClick={() => handleCreateDraftFromAgreement(agreement)}
                        disabled={draftingFromId === agreement.id}
                        className="flex shrink-0 items-center justify-center gap-1.5 text-sm font-semibold bg-primary/10 text-primary px-3 py-2 rounded-md hover:bg-primary/15 transition-colors disabled:opacity-50"
                      >
                        <Ic name={draftingFromId === agreement.id ? "sync" : "content_copy"} className={`text-base ${draftingFromId === agreement.id ? "animate-spin" : ""}`} />
                        {draftingFromId === agreement.id ? "Creating Draft" : "Copy to Draft"}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Version workbench */}
            <div className="bg-surface-container/50 rounded-xl ghost-border overflow-hidden">
              <div className="grid grid-cols-[minmax(280px,1.5fr)_100px_110px_110px_130px_150px_100px] items-center gap-4 bg-surface-high/25 px-5 py-3 text-xs font-semibold uppercase tracking-wider text-outline">
                <span>Supplier Agreement</span>
                <span>Version</span>
                <span>Items</span>
                <span>Markup</span>
                <span>Sell Value</span>
                <span>Validity</span>
                <span>Status</span>
              </div>
              <div className="divide-y divide-outline-variant/4">
              {loading ? (
                <div className="px-4 py-10 text-center">
                  <p className="text-sm text-outline animate-pulse">Loading agreements...</p>
                </div>
              ) : versions.length === 0 ? (
                <div className="px-4 py-10 text-center space-y-2">
                  <Ic name="description" className="text-2xl text-outline/30" />
                  <p className="text-sm text-on-surface-variant font-semibold">No agreements found</p>
                  <button onClick={() => setShowCreate(true)} className="text-sm text-primary hover:underline">
                    Create first agreement
                  </button>
                </div>
              ) : versions.map((v) => {
                const days = daysUntil(v.validTo);
                const expiring = v.status === "Active" && days !== null && days > 0 && days <= 30;
                const expired = days !== null && days <= 0;
                return (
                  <button key={v.id}
                    onClick={() => { setSelectedId(v.id); setWsTab("items"); setItemSearch(""); setComparison(null); setComparisonVersionId(null); }}
                    className={`w-full text-left px-5 py-4 transition-colors grid grid-cols-[minmax(280px,1.5fr)_100px_110px_110px_130px_150px_100px] items-center gap-4 ${selectedId === v.id ? "bg-primary/5 border-l-2 border-l-primary" : "hover:bg-surface-high/15"}`}>
                    <div className="min-w-0">
                      <p className="text-base font-semibold truncate">{v.supplierName}</p>
                      <p className="mt-1 text-xs text-outline truncate">Trade agreement for supplier item pricing and customer contract composition</p>
                    </div>
                    <span className="text-sm font-mono text-on-surface-variant font-medium">v{v.versionNumber}</span>
                    <span className="text-sm font-mono text-on-surface">{v._count?.items || 0} items</span>
                    <span className="text-sm font-mono text-primary">{v.markupPercent}%</span>
                    <span className="text-sm font-mono text-success">{fmt(v.totalMarkedUpValue || 0)}</span>
                    <div className="text-sm text-outline">
                      {v.validTo && !expiring && !expired && (
                        <span>{fmtDate(v.validTo, true)}</span>
                      )}
                      {expiring && <span className="text-warning font-semibold">{days}d left</span>}
                      {expired && v.status === "Active" && <span className="text-error font-semibold">Expired</span>}
                    </div>
                    <StatusBadge status={v.status} />
                  </button>
                );
              })}
              </div>
            </div>
          </div>

        </div>
      )}

      {tab === "versions" && selectedId && detail && !detailLoading && (
        <FullscreenPortal>
          <AgreementWorkspaceModal
            detail={detail}
            onClose={() => { setSelectedId(null); setDetail(null); }}
          >
            <AgreementWorkspace
              detail={detail}
              supplierVersions={supplierVersions}
              wsTab={wsTab}
              setWsTab={setWsTab}
              filteredItems={filteredItems}
              itemSearch={itemSearch}
              setItemSearch={setItemSearch}
              sortField={sortField}
              setSortField={setSortField}
              sortDir={sortDir}
              setSortDir={setSortDir}
              fileInputRef={fileInputRef}
              uploading={uploading}
              onUpload={handleUploadFile}
              onStatusChange={handleStatusChange}
              onMarkupChange={handleMarkupChange}
              onValidityChange={handleValidityChange}
              onExport={handleExport}
              onExportPdf={handleExportPdf}
              onDuplicate={handleDuplicate}
              onDelete={handleDelete}
              onRunControlScan={handleScan}
              scanning={scanning}
              onSelectVersion={(id) => { setSelectedId(id); setWsTab("items"); }}
              onOpenComparison={(versionId, compId) => {
                setTab("compare");
                pollComparison(versionId, compId);
              }}
              onItemSaved={() => { if (selectedId) fetchDetail(selectedId); fetchVersions(); }}
              onItemDeleted={() => { if (selectedId) fetchDetail(selectedId); fetchVersions(); }}
            />
          </AgreementWorkspaceModal>
        </FullscreenPortal>
      )}

      {/* ══ COMPARE TAB ══════════════════════════════════════════ */}
      {tab === "customer-contracts" && (
        <CustomerContractsWorkbench
          contracts={customerContracts}
          kpis={customerContractKpis}
          loading={contractsLoading}
          search={contractSearch}
          setSearch={setContractSearch}
          statusFilter={contractStatusFilter}
          setStatusFilter={setContractStatusFilter}
          selectedContractId={selectedContractId}
          setSelectedContractId={setSelectedContractId}
          selectedContract={selectedContract}
          selectedContractLoading={contractDetailLoading}
          showCreate={showCreateContract}
          setShowCreate={setShowCreateContract}
          shippingCompanies={shippingCompanies}
          supplierAgreements={agreementPool}
          onCreate={handleCreateCustomerContract}
          onUpdate={handleUpdateCustomerContract}
          onDelete={handleDeleteCustomerContract}
          onLocalContractUpdate={setSelectedContract}
        />
      )}

      {tab === "compare" && (
        <ComparisonPanel
          comparison={comparison}
          loading={comparisonLoading}
          agreementOptions={compareAgreementOptions}
          selectedVersionId={comparisonVersionId || selectedId}
          comparisonSource={comparisonSource}
          uploading={uploading}
          onSelectVersion={handleSelectCompareAgreement}
          onStartCompare={() => fileInputRef.current?.click()}
          onReview={handleReview}
          onDeleteComparison={handleDeleteComparison}
        />
      )}

      {/* ══ INSIGHTS TAB ══════════════════════════════════════════ */}
      {tab === "insights" && (
        <InsightsPanel
          insights={insights}
          scanning={scanning}
          onDismiss={handleDismissInsight}
          onRefresh={fetchInsights}
          onScan={handleScan}
        />
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   Agreement Workspace
   ════════════════════════════════════════════════════════════ */

function CustomerContractsWorkbench({
  contracts,
  kpis,
  loading,
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
  selectedContractId,
  setSelectedContractId,
  selectedContract,
  selectedContractLoading,
  showCreate,
  setShowCreate,
  shippingCompanies,
  supplierAgreements,
  onCreate,
  onUpdate,
  onDelete,
  onLocalContractUpdate,
}: {
  contracts: CustomerContract[];
  kpis: CustomerContractKpis;
  loading: boolean;
  search: string;
  setSearch: (value: string) => void;
  statusFilter: "all" | CustomerContractStatus;
  setStatusFilter: (value: "all" | CustomerContractStatus) => void;
  selectedContractId: string | null;
  setSelectedContractId: (id: string | null) => void;
  selectedContract: CustomerContract | null;
  selectedContractLoading: boolean;
  showCreate: boolean;
  setShowCreate: (value: boolean) => void;
  shippingCompanies: ShippingCompany[];
  supplierAgreements: AgreementVersion[];
  onCreate: (payload: { shippingCompanyId: string; title: string; markupPercent: number; validFrom: string; validTo: string; paymentTerms: string; deliveryTerms: string; notes: string; agreementVersionIds: string[] }) => void;
  onUpdate: (id: string, payload: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
  onLocalContractUpdate: (contract: CustomerContract | null) => void;
}) {
  const contractAgreementPool = supplierAgreements.filter((agreement) => agreement.status === "Active");

  return (
    <div className="agreements-module space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MiniKpi label="Customer Contracts" value={String(kpis.total)} sub={`${kpis.active} active`} />
        <MiniKpi label="Under Review" value={String(kpis.underReview)} accent={kpis.underReview > 0 ? "text-warning" : ""} />
        <MiniKpi label="Drafts" value={String(kpis.draft)} />
        <MiniKpi label="Expiring" value={String(kpis.expiring)} accent={kpis.expiring > 0 ? "text-warning" : ""} />
        <MiniKpi label="Contract Value" value={fmt(kpis.value || 0)} />
      </div>

      <section className="rounded-xl bg-surface-container/45 ghost-border p-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Ic name="account_tree" className="text-base" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">Trade Agreement to Customer Contract Workflow</h3>
            <p className="text-sm text-outline mt-1">
              Trade agreements are Ship Chandler side price books. Customer contracts compose selected trade agreements into shipping-company pricing, terms, and contract items.
            </p>
          </div>
        </div>
      </section>

      {showCreate && (
        <section className="rounded-xl bg-surface-container/50 ghost-border p-5">
          <CustomerContractComposer
            shippingCompanies={shippingCompanies}
            supplierAgreements={contractAgreementPool}
            onCreate={onCreate}
            onCancel={() => setShowCreate(false)}
          />
        </section>
      )}

      <section className="rounded-xl bg-surface-container/50 ghost-border overflow-hidden">
        <div className="p-4 border-b border-outline-variant/6 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Ic name="contract" className="text-primary text-base" />
              <h3 className="text-sm font-semibold">Shipping-Company Contracts</h3>
            </div>
            <p className="text-xs text-outline mt-1">Customer-facing fixed-markup contracts composed from supplier trade agreements.</p>
          </div>
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 text-sm font-semibold bg-primary/10 text-primary px-4 py-2 rounded-lg hover:bg-primary/15 transition-colors">
            <Ic name="add" className="text-base" />New Contract
          </button>
        </div>

        <div className="p-3 border-b border-outline-variant/6 flex flex-col gap-2 xl:flex-row xl:items-center">
          <div className="relative flex-1 max-w-xl">
            <Ic name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-outline/40" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search contracts, shipping company, contract number..."
              className="w-full bg-surface-high/30 border border-outline-variant/8 rounded-lg pl-9 pr-3 py-2 text-sm placeholder:text-outline/35 focus:outline-none focus:ring-1 focus:ring-primary/25" />
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {(["all", "Draft", "UnderReview", "Active", "Expired", "Archived"] as const).map((status) => (
              <button key={status} onClick={() => setStatusFilter(status)}
                className={`px-3 py-1.5 rounded-md text-sm font-semibold transition-colors ${statusFilter === status ? "bg-primary/10 text-primary" : "text-on-surface-variant hover:bg-surface-high/25"}`}>
                {status === "all" ? "All" : status.replace(/([A-Z])/g, " $1").trim()}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-high/25 text-xs text-outline uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3 text-left font-semibold">Contract</th>
                <th className="px-4 py-3 text-left font-semibold">Shipping Company</th>
                <th className="px-4 py-3 text-right font-semibold">Items</th>
                <th className="px-4 py-3 text-right font-semibold">Markup</th>
                <th className="px-4 py-3 text-right font-semibold">Base</th>
                <th className="px-4 py-3 text-right font-semibold">Sell</th>
                <th className="px-4 py-3 text-right font-semibold">Margin</th>
                <th className="px-4 py-3 text-left font-semibold">Validity</th>
                <th className="px-5 py-3 text-left font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/5">
              {loading ? (
                <tr><td colSpan={9} className="py-12 text-center text-sm text-outline animate-pulse">Loading customer contracts...</td></tr>
              ) : contracts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-14 text-center">
                    <Ic name="contract" className="text-3xl text-outline/25 mb-2" />
                    <p className="text-sm text-on-surface-variant font-semibold">No customer contracts found</p>
                    <p className="text-xs text-outline mt-1">Create a contract by selecting a shipping company and one or more supplier agreements.</p>
                  </td>
                </tr>
              ) : contracts.map((contract) => {
                const gross = (contract.totalSellValue || 0) - (contract.totalBaseValue || 0);
                const marginPct = contract.totalBaseValue > 0 ? (gross / contract.totalBaseValue) * 100 : 0;
                return (
                  <tr key={contract.id}
                    onClick={() => setSelectedContractId(contract.id)}
                    className={`cursor-pointer transition-colors ${selectedContractId === contract.id ? "bg-primary/5" : "hover:bg-surface-high/15"}`}>
                    <td className="px-5 py-4">
                      <p className="font-mono text-sm font-semibold text-on-surface">{contract.contractNumber}</p>
                      <p className="text-xs text-outline mt-1 max-w-md truncate">{contract.title}</p>
                    </td>
                    <td className="px-4 py-4 text-on-surface-variant font-semibold">{contract.shippingCompanyName}</td>
                    <td className="px-4 py-4 text-right font-mono text-on-surface">{contract.itemCount}</td>
                    <td className="px-4 py-4 text-right font-mono text-primary">{contract.markupPercent}%</td>
                    <td className="px-4 py-4 text-right font-mono text-on-surface-variant">{fmt(contract.totalBaseValue || 0)}</td>
                    <td className="px-4 py-4 text-right font-mono text-success">{fmt(contract.totalSellValue || 0)}</td>
                    <td className={`px-4 py-4 text-right font-mono font-semibold ${marginPct >= contract.markupPercent - 0.1 ? "text-success" : "text-warning"}`}>{marginPct.toFixed(1)}%</td>
                    <td className="px-4 py-4 text-on-surface-variant">{fmtDate(contract.validFrom, true)} - {fmtDate(contract.validTo, true)}</td>
                    <td className="px-5 py-4"><StatusBadge status={contract.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {selectedContractLoading && (
        <FullscreenPortal>
          <div className="fixed inset-0 z-[80] bg-surface-lowest text-on-surface flex items-center justify-center">
            <div className="text-center">
              <Ic name="sync" className="text-2xl text-outline/30 animate-spin mb-2" />
              <p className="text-sm text-outline">Loading contract workspace...</p>
            </div>
          </div>
        </FullscreenPortal>
      )}

      {selectedContract && !selectedContractLoading && (
        <FullscreenPortal>
          <CustomerContractWorkspace
            contract={selectedContract}
            supplierAgreements={contractAgreementPool}
            onClose={() => setSelectedContractId(null)}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onLocalContractUpdate={onLocalContractUpdate}
          />
        </FullscreenPortal>
      )}
    </div>
  );
}

function FullscreenPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- The portal requires the client document after hydration.
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}

function CustomerContractComposer({
  shippingCompanies,
  supplierAgreements,
  onCreate,
  onCancel,
}: {
  shippingCompanies: ShippingCompany[];
  supplierAgreements: AgreementVersion[];
  onCreate: (payload: { shippingCompanyId: string; title: string; markupPercent: number; validFrom: string; validTo: string; paymentTerms: string; deliveryTerms: string; notes: string; agreementVersionIds: string[] }) => void;
  onCancel: () => void;
}) {
  const [shippingCompanyId, setShippingCompanyId] = useState(shippingCompanies[0]?.id || "");
  const [title, setTitle] = useState("");
  const [markupPercent, setMarkupPercent] = useState(16);
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10));
  const [validTo, setValidTo] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [deliveryTerms, setDeliveryTerms] = useState("Port delivery unless otherwise stated");
  const [notes, setNotes] = useState("");
  const [agreementIds, setAgreementIds] = useState<Set<string>>(new Set());
  const effectiveShippingCompanyId = shippingCompanyId || shippingCompanies[0]?.id || "";

  const selectedAgreements = supplierAgreements.filter((agreement) => agreementIds.has(agreement.id));
  const baseValue = selectedAgreements.reduce((sum, agreement) => sum + (agreement.totalBaseValue || 0), 0);
  const sellValue = Math.round(baseValue * (1 + markupPercent / 100) * 100) / 100;

  const toggleAgreement = (id: string) => {
    setAgreementIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2 justify-end">
          <Ic name="call_merge" className="text-primary text-base" />
          <h3 className="text-sm font-semibold">Compose Customer Contract</h3>
        </div>
        <p className="text-sm text-outline mt-1">Select a shipping company, bring in one or more Ship Chandler trade agreements, and apply the customer contract markup.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="space-y-1">
          <span className="text-[0.6rem] uppercase tracking-wider text-outline font-semibold">Shipping Company</span>
          <select value={effectiveShippingCompanyId} onChange={(event) => setShippingCompanyId(event.target.value)}
            className="w-full bg-surface-high/25 border border-outline-variant/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/20">
            <option value="">Select company...</option>
            {shippingCompanies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
          </select>
          {shippingCompanies.length === 0 && <span className="block text-sm text-warning">Add a shipping company in <a href="#purchaseOrders" className="underline">Purchase Orders → Shipping Companies &amp; Fleet</a>, then return to create its contract.</span>}
        </label>
        <label className="space-y-1">
          <span className="text-[0.6rem] uppercase tracking-wider text-outline font-semibold">Contract Title</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Annual vessel stores fixed markup"
            className="w-full bg-surface-high/25 border border-outline-variant/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/20" />
        </label>
        <label className="space-y-1">
          <span className="text-[0.6rem] uppercase tracking-wider text-outline font-semibold">Customer Markup %</span>
          <input type="number" min={0} step={0.5} value={markupPercent} onChange={(event) => setMarkupPercent(Number(event.target.value))}
            className="w-full bg-surface-high/25 border border-outline-variant/10 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/20" />
        </label>
        <label className="space-y-1">
          <span className="text-[0.6rem] uppercase tracking-wider text-outline font-semibold">Payment Terms</span>
          <input value={paymentTerms} onChange={(event) => setPaymentTerms(event.target.value)} placeholder="Net 30"
            className="w-full bg-surface-high/25 border border-outline-variant/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/20" />
        </label>
        <label className="space-y-1">
          <span className="text-[0.6rem] uppercase tracking-wider text-outline font-semibold">Valid From</span>
          <input type="date" value={validFrom} onChange={(event) => setValidFrom(event.target.value)}
            className="w-full bg-surface-high/25 border border-outline-variant/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/20" />
        </label>
        <label className="space-y-1">
          <span className="text-[0.6rem] uppercase tracking-wider text-outline font-semibold">Valid To</span>
          <input type="date" value={validTo} onChange={(event) => setValidTo(event.target.value)}
            className="w-full bg-surface-high/25 border border-outline-variant/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/20" />
        </label>
      </div>
      <label className="space-y-1 block">
        <span className="text-[0.6rem] uppercase tracking-wider text-outline font-semibold">Delivery Terms</span>
        <input value={deliveryTerms} onChange={(event) => setDeliveryTerms(event.target.value)}
          className="w-full bg-surface-high/25 border border-outline-variant/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/20" />
      </label>

      <div className="rounded-xl bg-surface-low/20 border border-outline-variant/8 overflow-hidden">
        <div className="px-4 py-3 border-b border-outline-variant/6 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Trade Agreements to Include</p>
            <p className="text-sm text-outline">{selectedAgreements.length} selected / {supplierAgreements.length} available trade agreements</p>
          </div>
          <div className="text-right text-[0.6rem]">
            <p className="text-outline">Projected sell value</p>
            <p className="font-mono text-success font-semibold">{fmt(sellValue)}</p>
          </div>
        </div>
        <div className="max-h-56 overflow-y-auto divide-y divide-outline-variant/5">
          {supplierAgreements.length === 0 ? (
            <div className="p-5 text-center text-sm text-outline">No trade agreements are available for customer contract composition.</div>
          ) : supplierAgreements.map((agreement) => (
            <button key={agreement.id} onClick={() => toggleAgreement(agreement.id)}
              className={`w-full px-4 py-3 text-left flex items-center gap-3 hover:bg-surface-high/15 ${agreementIds.has(agreement.id) ? "bg-primary/5" : ""}`}>
              <span className={`w-4 h-4 rounded border flex items-center justify-center ${agreementIds.has(agreement.id) ? "bg-primary border-primary text-background" : "border-outline/40"}`}>
                {agreementIds.has(agreement.id) && <Ic name="check" className="text-[0.65rem]" />}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">{agreement.supplierName}</p>
                  <StatusBadge status={agreement.status} />
                </div>
                <p className="text-sm text-outline">v{agreement.versionNumber} / {agreement._count?.items || 0} items / supplier markup {agreement.markupPercent}%</p>
              </div>
              <p className="text-sm font-mono text-on-surface-variant">{fmt(agreement.totalBaseValue || 0)}</p>
            </button>
          ))}
        </div>
      </div>

      <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} placeholder="Contract notes, exclusions, vessel scope, customer-specific clauses..."
        className="w-full bg-surface-high/25 border border-outline-variant/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/20 resize-none" />

      <div className="flex items-center justify-end gap-2">
        <button onClick={onCancel} className="text-[0.65rem] font-medium text-outline px-3 py-1.5 rounded-md hover:bg-surface-high/20">Cancel</button>
        <button onClick={() => onCreate({ shippingCompanyId: effectiveShippingCompanyId, title, markupPercent, validFrom, validTo, paymentTerms, deliveryTerms, notes, agreementVersionIds: [...agreementIds] })}
          disabled={!effectiveShippingCompanyId || agreementIds.size === 0}
          className="flex items-center gap-1 text-[0.65rem] font-medium bg-primary/10 text-primary px-3.5 py-1.5 rounded-md hover:bg-primary/15 transition-colors disabled:opacity-40">
          <Ic name="contract_edit" className="text-xs" />Create Contract Draft
        </button>
        </div>
      </div>
  );
}

function CustomerContractWorkspace({
  contract,
  supplierAgreements,
  onClose,
  onUpdate,
  onDelete,
  onLocalContractUpdate,
}: {
  contract: CustomerContract;
  supplierAgreements: AgreementVersion[];
  onClose: () => void;
  onUpdate: (id: string, payload: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
  onLocalContractUpdate: (contract: CustomerContract | null) => void;
}) {
  const activeSupplierAgreementIds = useMemo(() => new Set(supplierAgreements.map((agreement) => agreement.id)), [supplierAgreements]);
  const initialAgreementIds = contract.sourceAgreements
    ?.map((source) => source.agreementVersionId)
    .filter((id) => activeSupplierAgreementIds.has(id)) || [];
  const [markup, setMarkup] = useState(contract.markupPercent);
  const [agreementIds, setAgreementIds] = useState<Set<string>>(new Set(initialAgreementIds));
  const [editingDetails, setEditingDetails] = useState(false);
  const [editingItem, setEditingItem] = useState<CustomerContractItem | null>(null);
  const [addingItem, setAddingItem] = useState(false);
  const [contractSelectionMode, setContractSelectionMode] = useState(false);
  const [selectedContractItemIds, setSelectedContractItemIds] = useState<Set<string>>(new Set());
  const [contractDraft, setContractDraft] = useState({
    title: contract.title || "",
    paymentTerms: contract.paymentTerms || "",
    deliveryTerms: contract.deliveryTerms || "",
    validFrom: contract.validFrom ? new Date(contract.validFrom).toISOString().slice(0, 10) : "",
    validTo: contract.validTo ? new Date(contract.validTo).toISOString().slice(0, 10) : "",
    notes: contract.notes || "",
  });
  const needsReview = (contract.items || []).filter((item) => item.status === "NeedsReview").length;
  const gross = (contract.totalSellValue || 0) - (contract.totalBaseValue || 0);
  const grossPct = contract.totalBaseValue > 0 ? (gross / contract.totalBaseValue) * 100 : 0;

  /* eslint-disable react-hooks/set-state-in-effect -- Refresh editable drafts when the selected contract changes or is reloaded. */
  useEffect(() => {
    setMarkup(contract.markupPercent);
    setAgreementIds(new Set(contract.sourceAgreements?.map((source) => source.agreementVersionId).filter((id) => activeSupplierAgreementIds.has(id)) || []));
    setContractDraft({
      title: contract.title || "",
      paymentTerms: contract.paymentTerms || "",
      deliveryTerms: contract.deliveryTerms || "",
      validFrom: contract.validFrom ? new Date(contract.validFrom).toISOString().slice(0, 10) : "",
      validTo: contract.validTo ? new Date(contract.validTo).toISOString().slice(0, 10) : "",
      notes: contract.notes || "",
    });
    setSelectedContractItemIds(new Set());
  }, [contract, activeSupplierAgreementIds]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const toggleAgreement = (id: string) => {
    setAgreementIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const downloadContractPdf = async () => {
    const res = await fetch(`/api/v1/agreements/customer-contracts/${contract.id}/export/pdf`);
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = res.headers.get("content-disposition")?.split("filename=")[1]?.replace(/"/g, "") || `${contract.contractNumber}.pdf`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const downloadContractExcel = async () => {
    const res = await fetch(`/api/v1/agreements/customer-contracts/${contract.id}/export`);
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = res.headers.get("content-disposition")?.split("filename=")[1]?.replace(/"/g, "") || `${contract.contractNumber}.xlsx`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const saveContractDetails = () => {
    onUpdate(contract.id, contractDraft);
    setEditingDetails(false);
  };

  const handleContractItemSaved = (updated: CustomerContract) => {
    onLocalContractUpdate(updated);
    setEditingItem(null);
    setAddingItem(false);
  };

  const contractItems = contract.items || [];
  const selectedContractItems = contractItems.filter((item) => selectedContractItemIds.has(item.id));

  const refreshContractFromServer = async () => {
    const res = await fetch(`/api/v1/agreements/customer-contracts/${contract.id}`);
    if (!res.ok) return;
    const data = await res.json();
    onLocalContractUpdate(data.contract || null);
  };

  const toggleContractItemSelection = (id: string) => {
    setSelectedContractItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectVisibleContractItems = () => setSelectedContractItemIds(new Set(contractItems.map((item) => item.id)));
  const clearContractItemSelection = () => setSelectedContractItemIds(new Set());

  const applyStatusToSelectedContractItems = async (status: "Active" | "Excluded" | "NeedsReview") => {
    if (selectedContractItems.length === 0) return;
    await Promise.all(selectedContractItems.map((item) => fetch(`/api/v1/agreements/customer-contracts/${contract.id}/items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })));
    clearContractItemSelection();
    await refreshContractFromServer();
  };

  const deleteSelectedContractItems = async () => {
    if (selectedContractItems.length === 0 || !confirm(`Delete ${selectedContractItems.length} selected contract item(s)?`)) return;
    await Promise.all(selectedContractItems.map((item) => fetch(`/api/v1/agreements/customer-contracts/${contract.id}/items/${item.id}`, { method: "DELETE" })));
    clearContractItemSelection();
    setContractSelectionMode(false);
    await refreshContractFromServer();
  };

  return (
    <div className="fixed inset-0 z-[80] bg-surface-lowest text-on-surface flex flex-col overflow-hidden">
      <div className="h-14 shrink-0 bg-surface-container border-b border-outline-variant/8 flex items-center justify-between px-5">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center"><Ic name="contract" className="text-base" /></div>
          <div className="min-w-0">
            <div className="flex items-center gap-2"><h2 className="text-sm font-semibold truncate">{contract.contractNumber}</h2><StatusBadge status={contract.status} /></div>
            <p className="text-[0.65rem] text-outline truncate">{contract.shippingCompanyName} / {contract.title}</p>
          </div>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg text-outline hover:text-on-surface-variant hover:bg-surface-high/30 transition-colors"><Ic name="close" className="text-base" /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <section className="rounded-xl bg-surface-container/50 ghost-border p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">{contract.title}</h3>
              <p className="text-xs text-outline mt-1">Contract between Nautex and {contract.shippingCompanyName}. Supplier agreement prices are composed into customer-facing fixed markup contract items.</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 xl:justify-end">
              <button onClick={downloadContractExcel} className="flex items-center gap-1 text-[0.65rem] font-medium bg-surface-high/30 text-on-surface-variant px-3 py-1.5 rounded-md hover:bg-surface-high/50"><Ic name="table_view" className="text-xs" />Excel</button>
              <button onClick={downloadContractPdf} className="flex items-center gap-1 text-[0.65rem] font-medium bg-surface-high/30 text-on-surface-variant px-3 py-1.5 rounded-md hover:bg-surface-high/50"><Ic name="picture_as_pdf" className="text-xs" />PDF</button>
              <button onClick={() => editingDetails ? saveContractDetails() : setEditingDetails(true)} className="flex items-center gap-1 text-[0.65rem] font-medium bg-primary/10 text-primary px-3 py-1.5 rounded-md hover:bg-primary/15"><Ic name={editingDetails ? "save" : "edit"} className="text-xs" />{editingDetails ? "Save Details" : "Edit Details"}</button>
              {editingDetails && <button onClick={() => setEditingDetails(false)} className="flex items-center gap-1 text-[0.65rem] font-medium bg-surface-high/30 text-outline px-3 py-1.5 rounded-md hover:bg-surface-high/50"><Ic name="close" className="text-xs" />Cancel</button>}
              {contract.status === "Draft" && <button onClick={() => onUpdate(contract.id, { status: "UnderReview" })} className="flex items-center gap-1 text-[0.65rem] font-medium bg-warning/10 text-warning px-3 py-1.5 rounded-md hover:bg-warning/15"><Ic name="rate_review" className="text-xs" />Submit Review</button>}
              {(contract.status === "Draft" || contract.status === "UnderReview") && <button onClick={() => onUpdate(contract.id, { status: "Active" })} className="flex items-center gap-1 text-[0.65rem] font-medium bg-success/10 text-success px-3 py-1.5 rounded-md hover:bg-success/15"><Ic name="verified" className="text-xs" />Activate</button>}
              {contract.status === "Active" && <button onClick={() => onUpdate(contract.id, { status: "Archived" })} className="flex items-center gap-1 text-[0.65rem] font-medium bg-surface-high/30 text-on-surface-variant px-3 py-1.5 rounded-md hover:bg-surface-high/50"><Ic name="archive" className="text-xs" />Archive</button>}
              {contract.status !== "Active" && <button onClick={() => onDelete(contract.id)} className="flex items-center gap-1 text-[0.65rem] font-medium bg-error/8 text-error px-3 py-1.5 rounded-md hover:bg-error/12"><Ic name="delete" className="text-xs" />Delete</button>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-5 md:grid-cols-3 xl:grid-cols-6">
            <MiniKpi label="Items" value={String(contract.itemCount)} sub={`${needsReview} need review`} accent={needsReview > 0 ? "text-warning" : ""} />
            <MiniKpi label="Base Value" value={fmt(contract.totalBaseValue || 0)} />
            <MiniKpi label="Sell Value" value={fmt(contract.totalSellValue || 0)} accent="text-success" />
            <MiniKpi label="Gross Margin" value={fmt(gross)} sub={`${grossPct.toFixed(1)}%`} accent={gross >= 0 ? "text-success" : "text-error"} />
            <div className="p-2.5 rounded-lg bg-surface-low/20">
              <p className="text-[0.55rem] text-outline mb-0.5">Markup %</p>
              <div className="flex items-center gap-2">
                <input type="number" min={0} step={0.5} value={markup} onChange={(event) => setMarkup(Number(event.target.value))} className="w-16 bg-transparent border-b border-primary/30 text-sm font-mono font-semibold focus:outline-none" />
                <button onClick={() => onUpdate(contract.id, { markupPercent: markup, agreementVersionIds: [...agreementIds] })} className="text-[0.6rem] text-primary font-medium">Save</button>
              </div>
            </div>
            <MiniKpi label="Validity" value={contract.validTo ? fmtDate(contract.validTo, true) : "Open"} sub={contract.validFrom ? `From ${fmtDate(contract.validFrom, true)}` : undefined} />
          </div>
          <div className="grid grid-cols-12 gap-3 mt-5">
            <label className="col-span-12 xl:col-span-4 space-y-1">
              <span className="text-[0.68rem] text-outline font-semibold uppercase tracking-wide">Contract Title</span>
              {editingDetails ? (
                <input value={contractDraft.title} onChange={(event) => setContractDraft((prev) => ({ ...prev, title: event.target.value }))} className="w-full bg-surface-high/25 border border-outline-variant/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/25" />
              ) : (
                <p className="text-sm text-on-surface-variant">{contract.title}</p>
              )}
            </label>
            <label className="col-span-6 xl:col-span-2 space-y-1">
              <span className="text-[0.68rem] text-outline font-semibold uppercase tracking-wide">Valid From</span>
              {editingDetails ? (
                <input type="date" value={contractDraft.validFrom} onChange={(event) => setContractDraft((prev) => ({ ...prev, validFrom: event.target.value }))} className="w-full bg-surface-high/25 border border-outline-variant/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/25" />
              ) : (
                <p className="text-sm text-on-surface-variant">{fmtDate(contract.validFrom)}</p>
              )}
            </label>
            <label className="col-span-6 xl:col-span-2 space-y-1">
              <span className="text-[0.68rem] text-outline font-semibold uppercase tracking-wide">Valid To</span>
              {editingDetails ? (
                <input type="date" value={contractDraft.validTo} onChange={(event) => setContractDraft((prev) => ({ ...prev, validTo: event.target.value }))} className="w-full bg-surface-high/25 border border-outline-variant/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/25" />
              ) : (
                <p className="text-sm text-on-surface-variant">{fmtDate(contract.validTo)}</p>
              )}
            </label>
            <label className="col-span-12 xl:col-span-2 space-y-1">
              <span className="text-[0.68rem] text-outline font-semibold uppercase tracking-wide">Payment Terms</span>
              {editingDetails ? (
                <input value={contractDraft.paymentTerms} onChange={(event) => setContractDraft((prev) => ({ ...prev, paymentTerms: event.target.value }))} className="w-full bg-surface-high/25 border border-outline-variant/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/25" />
              ) : (
                <p className="text-sm text-on-surface-variant">{contract.paymentTerms || "-"}</p>
              )}
            </label>
            <label className="col-span-12 xl:col-span-2 space-y-1">
              <span className="text-[0.68rem] text-outline font-semibold uppercase tracking-wide">Delivery Terms</span>
              {editingDetails ? (
                <input value={contractDraft.deliveryTerms} onChange={(event) => setContractDraft((prev) => ({ ...prev, deliveryTerms: event.target.value }))} className="w-full bg-surface-high/25 border border-outline-variant/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/25" />
              ) : (
                <p className="text-sm text-on-surface-variant">{contract.deliveryTerms || "-"}</p>
              )}
            </label>
            <label className="col-span-12 space-y-1">
              <span className="text-[0.68rem] text-outline font-semibold uppercase tracking-wide">Notes</span>
              {editingDetails ? (
                <textarea value={contractDraft.notes} onChange={(event) => setContractDraft((prev) => ({ ...prev, notes: event.target.value }))} rows={2} className="w-full bg-surface-high/25 border border-outline-variant/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/25 resize-none" />
              ) : (
                <p className="text-sm text-on-surface-variant">{contract.notes || "No notes recorded."}</p>
              )}
            </label>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
          <div className="min-w-0 rounded-xl bg-surface-container/50 ghost-border overflow-hidden">
            <div className="p-4 border-b border-outline-variant/6"><h4 className="text-sm font-semibold">Linked Trade Agreements</h4><p className="text-sm text-outline mt-1">Only active Ship Chandler trade agreements can be linked to this customer contract.</p></div>
            <div className="divide-y divide-outline-variant/5">
              {supplierAgreements.map((agreement) => (
                <button key={agreement.id} onClick={() => toggleAgreement(agreement.id)} className={`w-full p-3 text-left flex items-center gap-3 hover:bg-surface-high/15 ${agreementIds.has(agreement.id) ? "bg-primary/5" : ""}`}>
                  <span className={`w-4 h-4 rounded border flex items-center justify-center ${agreementIds.has(agreement.id) ? "bg-primary border-primary text-background" : "border-outline/40"}`}>{agreementIds.has(agreement.id) && <Ic name="check" className="text-[0.65rem]" />}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2"><p className="text-sm font-medium truncate">{agreement.supplierName}</p><StatusBadge status={agreement.status} /></div>
                    <p className="text-sm text-outline">v{agreement.versionNumber} / {agreement._count?.items || 0} items / {agreement.markupPercent}% supplier markup</p>
                  </div>
                </button>
              ))}
            </div>
            <div className="p-3 border-t border-outline-variant/6">
              <button onClick={() => onUpdate(contract.id, { agreementVersionIds: [...agreementIds], markupPercent: markup })} disabled={agreementIds.size === 0} className="w-full flex items-center justify-center gap-1 text-sm font-semibold bg-primary/10 text-primary px-3 py-2 rounded-md hover:bg-primary/15 disabled:opacity-40"><Ic name="link" className="text-base" />Link Contract Items</button>
            </div>
          </div>
          <div className="min-w-0 rounded-xl bg-surface-container/50 ghost-border overflow-hidden">
            <div className="p-4 border-b border-outline-variant/6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div><h4 className="text-xs font-semibold">Contract Items</h4><p className="text-[0.6rem] text-outline">Customer-facing prices generated from linked supplier agreements.</p></div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-[0.65rem] font-semibold px-2 py-1 rounded ${needsReview > 0 ? "bg-warning/10 text-warning" : "bg-success/10 text-success"}`}>{needsReview > 0 ? `${needsReview} review gaps` : "Ready"}</span>
                <button onClick={() => { setContractSelectionMode((value) => !value); clearContractItemSelection(); }} className={`flex items-center gap-1 text-[0.65rem] font-medium px-3 py-1.5 rounded-md ${contractSelectionMode ? "bg-primary/12 text-primary" : "bg-surface-high/30 text-on-surface-variant hover:bg-surface-high/50"}`}><Ic name="select_all" className="text-xs" />Smart Select</button>
                {contractSelectionMode && (
                  <>
                    <span className="text-[0.65rem] text-outline">{selectedContractItems.length} selected</span>
                    <button onClick={selectVisibleContractItems} className="text-[0.65rem] font-medium text-primary px-2 py-1 rounded-md hover:bg-primary/10">Select Visible</button>
                    <button onClick={clearContractItemSelection} className="text-[0.65rem] font-medium text-outline px-2 py-1 rounded-md hover:bg-surface-high/30">Clear</button>
                    <button onClick={() => applyStatusToSelectedContractItems("Active")} disabled={selectedContractItems.length === 0} className="text-[0.65rem] font-medium text-success px-2 py-1 rounded-md hover:bg-success/10 disabled:opacity-40">Mark Active</button>
                    <button onClick={() => applyStatusToSelectedContractItems("Excluded")} disabled={selectedContractItems.length === 0} className="text-[0.65rem] font-medium text-warning px-2 py-1 rounded-md hover:bg-warning/10 disabled:opacity-40">Exclude</button>
                    <button onClick={deleteSelectedContractItems} disabled={selectedContractItems.length === 0} className="text-[0.65rem] font-medium text-error px-2 py-1 rounded-md hover:bg-error/10 disabled:opacity-40">Delete</button>
                  </>
                )}
                <button onClick={() => setAddingItem(true)} className="flex items-center gap-1 text-[0.65rem] font-medium bg-primary/10 text-primary px-3 py-1.5 rounded-md hover:bg-primary/15"><Ic name="add" className="text-xs" />Add Item</button>
              </div>
            </div>
            <div className="min-h-[280px] overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface-container/95">
                  <tr className="border-b border-outline-variant/6 text-[0.68rem] uppercase tracking-wider text-outline">
                    <th className="px-3 py-2 text-left font-semibold">Item Code</th>
                    <th className="px-3 py-2 text-left font-semibold">Description</th>
                    <th className="px-3 py-2 text-left font-semibold">Supplier</th>
                    <th className="px-3 py-2 text-right font-semibold">Base</th>
                    <th className="px-3 py-2 text-right font-semibold">Sell</th>
                    <th className="px-3 py-2 text-left font-semibold">HS / COO</th>
                    <th className="px-3 py-2 text-left font-semibold">Status</th>
                    <th className="px-3 py-2 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/5">
                  {contractItems.map((item) => {
                    const isSelected = selectedContractItemIds.has(item.id);
                    return (
                    <tr key={item.id} onClick={() => contractSelectionMode ? toggleContractItemSelection(item.id) : setEditingItem(item)} className={`cursor-pointer hover:bg-primary/5 ${item.status === "Excluded" ? "opacity-55" : ""} ${isSelected ? "bg-primary/10 ring-1 ring-inset ring-primary/20" : ""}`}>
                      <td className="px-3 py-2 font-mono text-primary font-semibold">
                        {contractSelectionMode && <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle ${isSelected ? "bg-primary shadow-[0_0_0_3px_rgba(83,255,180,0.12)]" : "bg-outline/30"}`} />}
                        {item.itemCode || `NTX-${String(1000 + item.lineNumber)}`}
                      </td>
                      <td className="px-3 py-2 text-on-surface-variant max-w-sm">{item.description}</td>
                      <td className="px-3 py-2 text-outline">{item.supplierName}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmt(item.basePrice || 0)}</td>
                      <td className="px-3 py-2 text-right font-mono text-success">{fmt(item.sellPrice || 0)}</td>
                      <td className="px-3 py-2 font-mono text-[0.65rem]">{item.hsCode || "missing"} / {item.countryOfOrigin || "missing"}</td>
                      <td className="px-3 py-2">
                        <span className={`text-[0.65rem] font-semibold px-2 py-0.5 rounded ${
                          item.status === "NeedsReview"
                            ? "bg-warning/10 text-warning"
                            : item.status === "Excluded"
                              ? "bg-surface-high/30 text-outline"
                              : "bg-success/10 text-success"
                        }`}>
                          {item.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={(event) => { event.stopPropagation(); contractSelectionMode ? toggleContractItemSelection(item.id) : setEditingItem(item); }} className="text-[0.65rem] text-primary hover:underline">{contractSelectionMode ? (isSelected ? "Selected" : "Select") : "Edit"}</button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {(editingItem || addingItem) && (
          <CustomerContractItemModal
            contractId={contract.id}
            item={editingItem}
            defaultMarkup={markup}
            onClose={() => { setEditingItem(null); setAddingItem(false); }}
            onSaved={handleContractItemSaved}
          />
        )}

        <section className="rounded-xl bg-surface-container/50 ghost-border p-4">
          <div className="flex items-center gap-2 mb-3">
            <Ic name="smart_toy" className="text-primary text-base" />
            <h4 className="text-xs font-semibold">Contract Control Agent</h4>
            <span className={`text-[0.55rem] font-semibold px-1.5 py-0.5 rounded ${needsReview > 0 ? "bg-warning/10 text-warning" : "bg-success/10 text-success"}`}>{needsReview > 0 ? "Human review required" : "Ready for approval"}</span>
          </div>
          <div className="grid grid-cols-1 gap-3 text-[0.65rem] md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg bg-surface-low/20 p-3"><p className="text-outline uppercase text-[0.55rem] font-semibold">Composition</p><p className="mt-1 text-on-surface-variant">{contract.sourceAgreements?.length || 0} supplier agreements linked</p></div>
            <div className="rounded-lg bg-surface-low/20 p-3"><p className="text-outline uppercase text-[0.55rem] font-semibold">Data Quality</p><p className={`mt-1 ${needsReview > 0 ? "text-warning" : "text-success"}`}>{needsReview > 0 ? `${needsReview} item gaps` : "All items controlled"}</p></div>
            <div className="rounded-lg bg-surface-low/20 p-3"><p className="text-outline uppercase text-[0.55rem] font-semibold">Approval Guardrail</p><p className="mt-1 text-on-surface-variant">Human activation required</p></div>
            <div className="rounded-lg bg-surface-low/20 p-3"><p className="text-outline uppercase text-[0.55rem] font-semibold">Audit</p><p className="mt-1 text-on-surface-variant">{contract.auditEvents?.length || 0} recent events</p></div>
          </div>
          <div className="mt-4 divide-y divide-outline-variant/5">
            {(contract.auditEvents || []).slice(0, 5).map((event) => (
              <div key={event.id} className="py-2 flex items-center justify-between gap-3"><p className="text-xs text-on-surface-variant">{event.summary}</p><p className="text-[0.6rem] text-outline">{fmtDate(event.createdAt)}</p></div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function CustomerContractItemModal({
  contractId,
  item,
  defaultMarkup,
  onClose,
  onSaved,
}: {
  contractId: string;
  item: CustomerContractItem | null;
  defaultMarkup: number;
  onClose: () => void;
  onSaved: (contract: CustomerContract) => void;
}) {
  const dialogRef = useDialogA11y<HTMLDivElement>(onClose);
  const isNew = !item;
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    itemCode: item?.itemCode || "",
    supplierName: item?.supplierName || "",
    vendorPartNumber: item?.vendorPartNumber || "",
    description: item?.description || "",
    basePrice: item ? String(item.basePrice) : "0",
    contractMarkupPercent: item ? String(item.contractMarkupPercent) : String(defaultMarkup),
    sellPrice: item ? String(item.sellPrice) : "",
    currency: item?.currency || "EUR",
    unit: item?.unit || "",
    moq: item?.moq != null ? String(item.moq) : "",
    leadTimeDays: item?.leadTimeDays != null ? String(item.leadTimeDays) : "",
    hsCode: item?.hsCode || "",
    countryOfOrigin: item?.countryOfOrigin || "",
    manufacturer: item?.manufacturer || "",
    status: item?.status || "NeedsReview",
    reviewNote: item?.reviewNote || "",
  });

  const set = (field: string, value: string) => setDraft((prev) => ({ ...prev, [field]: value }));

  const save = async () => {
    setSaving(true);
    const res = await fetch(isNew
      ? `/api/v1/agreements/customer-contracts/${contractId}/items`
      : `/api/v1/agreements/customer-contracts/${contractId}/items/${item.id}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...draft,
        basePrice: Number(draft.basePrice || 0),
        contractMarkupPercent: Number(draft.contractMarkupPercent || 0),
        sellPrice: draft.sellPrice === "" ? undefined : Number(draft.sellPrice),
      }),
    });
    setSaving(false);
    if (res.ok) {
      const data = await res.json();
      onSaved(data.contract);
    }
  };

  const patchStatus = async (status: "Active" | "Excluded" | "NeedsReview") => {
    if (!item) return;
    setSaving(true);
    const res = await fetch(`/api/v1/agreements/customer-contracts/${contractId}/items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setSaving(false);
    if (res.ok) {
      const data = await res.json();
      onSaved(data.contract);
    }
  };

  const deleteItem = async () => {
    if (!item || !confirm("Delete this customer contract item?")) return;
    setSaving(true);
    const res = await fetch(`/api/v1/agreements/customer-contracts/${contractId}/items/${item.id}`, { method: "DELETE" });
    setSaving(false);
    if (res.ok) {
      const data = await res.json();
      onSaved(data.contract);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/55 flex items-center justify-center p-5" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={isNew ? "Add customer contract item" : "Edit customer contract item"}
        className="w-full max-w-5xl rounded-2xl bg-surface-container border border-outline-variant/12 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-outline-variant/8 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold">{isNew ? "Add Customer Contract Item" : item.itemCode || `Line ${item.lineNumber}`}</h3>
            <p className="text-xs text-outline mt-1">Contract item changes are logged and contract totals are recalculated immediately.</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-outline hover:text-on-surface-variant hover:bg-surface-high/30"><Ic name="close" className="text-base" /></button>
        </div>
        <div className="p-5 grid grid-cols-12 gap-4">
          <label className="col-span-12 md:col-span-3 space-y-1"><span className="text-xs text-outline font-semibold">Item Code</span><input value={draft.itemCode} onChange={(e) => set("itemCode", e.target.value)} className="w-full bg-surface-high/25 border border-outline-variant/10 rounded-lg px-3 py-2 text-sm font-mono" /></label>
          <label className="col-span-12 md:col-span-3 space-y-1"><span className="text-xs text-outline font-semibold">Supplier</span><input value={draft.supplierName} onChange={(e) => set("supplierName", e.target.value)} className="w-full bg-surface-high/25 border border-outline-variant/10 rounded-lg px-3 py-2 text-sm" /></label>
          <label className="col-span-12 md:col-span-3 space-y-1"><span className="text-xs text-outline font-semibold">Vendor P/N</span><input value={draft.vendorPartNumber} onChange={(e) => set("vendorPartNumber", e.target.value)} className="w-full bg-surface-high/25 border border-outline-variant/10 rounded-lg px-3 py-2 text-sm font-mono" /></label>
          <label className="col-span-12 md:col-span-3 space-y-1"><span className="text-xs text-outline font-semibold">Status</span><select value={draft.status} onChange={(e) => set("status", e.target.value)} className="w-full bg-surface-high/25 border border-outline-variant/10 rounded-lg px-3 py-2 text-sm"><option>Active</option><option>NeedsReview</option><option>Excluded</option></select></label>
          <label className="col-span-12 space-y-1"><span className="text-xs text-outline font-semibold">Description</span><input value={draft.description} onChange={(e) => set("description", e.target.value)} className="w-full bg-surface-high/25 border border-outline-variant/10 rounded-lg px-3 py-2 text-sm" /></label>
          <label className="col-span-6 md:col-span-2 space-y-1"><span className="text-xs text-outline font-semibold">Base</span><input type="number" value={draft.basePrice} onChange={(e) => set("basePrice", e.target.value)} className="w-full bg-surface-high/25 border border-outline-variant/10 rounded-lg px-3 py-2 text-sm font-mono" /></label>
          <label className="col-span-6 md:col-span-2 space-y-1"><span className="text-xs text-outline font-semibold">Markup %</span><input type="number" value={draft.contractMarkupPercent} onChange={(e) => set("contractMarkupPercent", e.target.value)} className="w-full bg-surface-high/25 border border-outline-variant/10 rounded-lg px-3 py-2 text-sm font-mono" /></label>
          <label className="col-span-6 md:col-span-2 space-y-1"><span className="text-xs text-outline font-semibold">Sell</span><input type="number" value={draft.sellPrice} onChange={(e) => set("sellPrice", e.target.value)} placeholder="auto" className="w-full bg-surface-high/25 border border-outline-variant/10 rounded-lg px-3 py-2 text-sm font-mono" /></label>
          <label className="col-span-6 md:col-span-2 space-y-1"><span className="text-xs text-outline font-semibold">Unit</span><input value={draft.unit} onChange={(e) => set("unit", e.target.value)} className="w-full bg-surface-high/25 border border-outline-variant/10 rounded-lg px-3 py-2 text-sm" /></label>
          <label className="col-span-6 md:col-span-2 space-y-1"><span className="text-xs text-outline font-semibold">MOQ</span><input type="number" value={draft.moq} onChange={(e) => set("moq", e.target.value)} className="w-full bg-surface-high/25 border border-outline-variant/10 rounded-lg px-3 py-2 text-sm font-mono" /></label>
          <label className="col-span-6 md:col-span-2 space-y-1"><span className="text-xs text-outline font-semibold">Lead Days</span><input type="number" value={draft.leadTimeDays} onChange={(e) => set("leadTimeDays", e.target.value)} className="w-full bg-surface-high/25 border border-outline-variant/10 rounded-lg px-3 py-2 text-sm font-mono" /></label>
          <label className="col-span-6 md:col-span-3 space-y-1"><span className="text-xs text-outline font-semibold">HS Code</span><input value={draft.hsCode} onChange={(e) => set("hsCode", e.target.value)} className="w-full bg-surface-high/25 border border-outline-variant/10 rounded-lg px-3 py-2 text-sm font-mono" /></label>
          <label className="col-span-6 md:col-span-3 space-y-1"><span className="text-xs text-outline font-semibold">COO</span><input value={draft.countryOfOrigin} onChange={(e) => set("countryOfOrigin", e.target.value.toUpperCase())} className="w-full bg-surface-high/25 border border-outline-variant/10 rounded-lg px-3 py-2 text-sm font-mono" /></label>
          <label className="col-span-12 md:col-span-6 space-y-1"><span className="text-xs text-outline font-semibold">Manufacturer</span><input value={draft.manufacturer} onChange={(e) => set("manufacturer", e.target.value)} className="w-full bg-surface-high/25 border border-outline-variant/10 rounded-lg px-3 py-2 text-sm" /></label>
          <label className="col-span-12 space-y-1"><span className="text-xs text-outline font-semibold">Review Note</span><textarea value={draft.reviewNote} onChange={(e) => set("reviewNote", e.target.value)} rows={2} className="w-full bg-surface-high/25 border border-outline-variant/10 rounded-lg px-3 py-2 text-sm resize-none" /></label>
        </div>
        <div className="px-5 py-4 border-t border-outline-variant/8 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {!isNew && item.status !== "Excluded" && <button onClick={() => patchStatus("Excluded")} disabled={saving} className="text-[0.7rem] font-semibold text-warning px-3 py-1.5 rounded-md hover:bg-warning/10">Exclude</button>}
            {!isNew && item.status === "Excluded" && <button onClick={() => patchStatus("Active")} disabled={saving} className="text-[0.7rem] font-semibold text-success px-3 py-1.5 rounded-md hover:bg-success/10">Restore</button>}
            {!isNew && <button onClick={deleteItem} disabled={saving} className="text-[0.7rem] font-semibold text-error px-3 py-1.5 rounded-md hover:bg-error/10">Delete</button>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="text-[0.7rem] font-semibold text-outline px-3 py-1.5 rounded-md hover:bg-surface-high/25">Cancel</button>
            <button onClick={save} disabled={saving || !draft.description} className="flex items-center gap-1 text-[0.7rem] font-semibold bg-primary/10 text-primary px-4 py-1.5 rounded-md hover:bg-primary/15 disabled:opacity-40"><Ic name={saving ? "sync" : "save"} className={`text-xs ${saving ? "animate-spin" : ""}`} />Save Item</button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface WorkspaceProps {
  detail: VersionDetail;
  supplierVersions: AgreementVersion[];
  wsTab: WorkspaceTab;
  setWsTab: (t: WorkspaceTab) => void;
  filteredItems: AgreementItem[];
  itemSearch: string;
  setItemSearch: (s: string) => void;
  sortField: string;
  setSortField: (f: string) => void;
  sortDir: "asc" | "desc";
  setSortDir: (d: "asc" | "desc") => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  uploading: boolean;
  onUpload: (f: File) => void;
  onStatusChange: (s: string) => void;
  onMarkupChange: (v: number) => void;
  onValidityChange: (validFrom: string, validTo: string) => void;
  onExport: (markAsSent?: boolean) => void;
  onExportPdf: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onRunControlScan: () => void;
  scanning: boolean;
  onSelectVersion: (id: string) => void;
  onOpenComparison: (versionId: string, compId: string) => void;
  onItemSaved?: () => void;
  onItemDeleted?: () => void;
}

function AgreementWorkspaceModal({ detail, onClose, children }: { detail: VersionDetail; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[80] bg-surface-lowest text-on-surface flex flex-col overflow-hidden">
      <div className="h-14 shrink-0 bg-surface-container border-b border-outline-variant/8 flex items-center justify-between px-5">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Ic name="handshake" className="text-base" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold truncate">{detail.supplierName}</h2>
              <StatusBadge status={detail.status} />
              <span className="text-[0.55rem] font-mono bg-surface-high/50 text-outline px-1.5 py-0.5 rounded">v{detail.versionNumber}</span>
            </div>
            <p className="text-[0.65rem] text-outline truncate">
              Supplier trade agreement / markup {detail.markupPercent}% / {detail.items.length} item{detail.items.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg text-outline hover:text-on-surface-variant hover:bg-surface-high/30 transition-colors" title="Close agreement workspace">
          <Ic name="close" className="text-base" />
        </button>
      </div>
      <div className="flex-1 overflow-hidden p-3">
        {children}
      </div>
    </div>
  );
}

function AgreementWorkspace(props: WorkspaceProps) {
  const { detail, supplierVersions, wsTab, setWsTab } = props;
  const [selectedItem, setSelectedItem] = useState<AgreementItem | null>(null);
  const [editingValidity, setEditingValidity] = useState(false);
  const [validityDraft, setValidityDraft] = useState({
    validFrom: detail.validFrom ? new Date(detail.validFrom).toISOString().slice(0, 10) : "",
    validTo: detail.validTo ? new Date(detail.validTo).toISOString().slice(0, 10) : "",
  });

  /* eslint-disable react-hooks/set-state-in-effect -- Reset the validity draft when a different agreement record is loaded. */
  useEffect(() => {
    setValidityDraft({
      validFrom: detail.validFrom ? new Date(detail.validFrom).toISOString().slice(0, 10) : "",
      validTo: detail.validTo ? new Date(detail.validTo).toISOString().slice(0, 10) : "",
    });
    setEditingValidity(false);
  }, [detail.id, detail.validFrom, detail.validTo]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const days = daysUntil(detail.validTo);
  const isExpiring = detail.status === "Active" && days !== null && days > 0 && days <= 30;
  const isExpired = detail.status === "Active" && days !== null && days <= 0;

  const margin = (detail.totalMarkedUpValue || 0) - (detail.totalBaseValue || 0);
  const marginPct = detail.totalBaseValue > 0 ? ((margin / detail.totalBaseValue) * 100).toFixed(1) : null;
  const saveValidity = () => {
    props.onValidityChange(validityDraft.validFrom, validityDraft.validTo);
    setEditingValidity(false);
  };

  return (
    <div className="h-full min-h-0 flex flex-col gap-3">
      {/* ── Header card ────────────────────────────────────── */}
      <div className="shrink-0 bg-surface-container/45 rounded-xl ghost-border p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="text-base font-semibold">{detail.supplierName}</h3>
              <StatusBadge status={detail.status} />
              <span className="text-xs font-mono bg-surface-high/40 text-outline px-2 py-0.5 rounded">
                v{detail.versionNumber}
              </span>
              {isExpiring && (
                <span className="text-[0.55rem] font-medium bg-warning/10 text-warning px-1.5 py-0.5 rounded flex items-center gap-0.5">
                  <Ic name="schedule" className="text-[0.65rem]" />{days}d left
                </span>
              )}
              {isExpired && (
                <span className="text-[0.55rem] font-medium bg-error/10 text-error px-1.5 py-0.5 rounded">Expired</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-outline">
              {detail.validFrom && detail.validTo ? (
                <span className="flex items-center gap-1">
                  <Ic name="calendar_today" className="text-[0.65rem] text-outline/60" />
                  {fmtDate(detail.validFrom, true)} – {fmtDate(detail.validTo)}
                </span>
              ) : (
                <span className="text-outline/40 italic">No validity dates set</span>
              )}
              <button onClick={() => setEditingValidity((value) => !value)} className="flex items-center gap-1 text-primary hover:underline">
                <Ic name="edit_calendar" className="text-sm" />
                {editingValidity ? "Close validity editor" : "Edit validity"}
              </button>
              {editingValidity && (
                <span className="flex items-center gap-2 flex-wrap basis-full mt-1">
                  <span className="text-outline/70">Valid from</span>
                  <input type="date" value={validityDraft.validFrom} onChange={(event) => setValidityDraft((prev) => ({ ...prev, validFrom: event.target.value }))}
                    className="bg-surface-high/35 border border-outline-variant/10 rounded-md px-2 py-1 text-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/20" />
                  <span className="text-outline/70">to</span>
                  <input type="date" value={validityDraft.validTo} onChange={(event) => setValidityDraft((prev) => ({ ...prev, validTo: event.target.value }))}
                    className="bg-surface-high/35 border border-outline-variant/10 rounded-md px-2 py-1 text-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/20" />
                  <button onClick={saveValidity} className="text-sm font-semibold text-primary hover:underline">Save dates</button>
                  <button onClick={() => setEditingValidity(false)} className="text-sm text-outline hover:text-on-surface-variant">Cancel</button>
                </span>
              )}
              {detail.sentAt && (
                <span className="flex items-center gap-1">
                  <Ic name="send" className="text-[0.65rem] text-outline/60" />
                  Sent {fmtDate(detail.sentAt)}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Ic name="update" className="text-[0.65rem] text-outline/60" />
                Updated {fmtDate(detail.updatedAt)}
              </span>
              {detail.notes && (
                <span className="italic truncate max-w-[200px]" title={detail.notes}>{detail.notes}</span>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1.5 flex-wrap justify-end shrink-0">
            {detail.status === "Draft" && (
              <button onClick={() => props.onStatusChange("Sent")}
                className="flex items-center gap-1 text-sm font-semibold bg-info/8 text-info px-3 py-1.5 rounded-md hover:bg-info/12 transition-colors">
                <Ic name="send" className="text-xs" />Mark Sent
              </button>
            )}
            {(detail.status === "Draft" || detail.status === "Sent") && (
              <button onClick={() => props.onStatusChange("Active")}
                className="flex items-center gap-1 text-sm font-semibold bg-success/8 text-success px-3 py-1.5 rounded-md hover:bg-success/12 transition-colors">
                <Ic name="check_circle" className="text-xs" />Activate
              </button>
            )}
            {(detail.status === "Active" || detail.status === "Expired") && (
              <button onClick={() => props.onStatusChange("Archived")}
                className="flex items-center gap-1 text-[0.65rem] font-medium bg-surface-high/30 text-outline px-2.5 py-1.5 rounded-md hover:bg-surface-high/50 transition-colors">
                <Ic name="archive" className="text-xs" />Archive
              </button>
            )}
            <button onClick={() => props.fileInputRef.current?.click()} disabled={props.uploading}
              className="flex items-center gap-1 text-[0.65rem] font-medium bg-primary/8 text-primary px-2.5 py-1.5 rounded-md hover:bg-primary/12 transition-colors disabled:opacity-50">
              <Ic name="compare_arrows" className="text-xs" />{props.uploading ? "Uploading…" : "Compare"}
            </button>
            <button onClick={props.onDuplicate}
              className="flex items-center gap-1 text-[0.65rem] font-medium bg-surface-high/30 text-on-surface-variant px-2.5 py-1.5 rounded-md hover:bg-surface-high/50 transition-colors">
              <Ic name="content_copy" className="text-xs" />{detail.status === "Draft" ? "Duplicate Draft" : "Copy to Draft"}
            </button>
            <button onClick={() => props.onExport(detail.status === "Sent")}
              className="flex items-center gap-1 text-[0.65rem] font-medium bg-surface-high/30 text-on-surface-variant px-2.5 py-1.5 rounded-md hover:bg-surface-high/50 transition-colors">
              <Ic name={detail.status === "Sent" ? "mark_email_read" : "download"} className="text-xs" />
              {detail.status === "Sent" ? "Export & Mark Sent" : "Export"}
            </button>
            <button onClick={props.onExportPdf}
              className="flex items-center gap-1 text-[0.65rem] font-medium bg-surface-high/30 text-on-surface-variant px-2.5 py-1.5 rounded-md hover:bg-surface-high/50 transition-colors">
              <Ic name="picture_as_pdf" className="text-xs" />PDF
            </button>
            {detail.status === "Draft" && (
              <button onClick={props.onDelete}
                className="flex items-center gap-1 text-[0.65rem] font-medium text-error/70 hover:text-error px-2 py-1.5 rounded-md hover:bg-error/6 transition-colors">
                <Ic name="delete" className="text-xs" />Delete
              </button>
            )}
          </div>
        </div>

        {/* Validity bar */}
        {detail.validFrom && detail.validTo && detail.status === "Active" && (
          <ValidityBar validFrom={detail.validFrom} validTo={detail.validTo} />
        )}

        {/* KPI strip */}
        <div className="grid grid-cols-5 gap-2.5 mt-2">
          <MiniKpi label="Items" value={String(detail.items.length)} />
          <MiniKpi label="Base Value" value={fmt(detail.totalBaseValue || 0)} />
          <MiniKpi label="Marked-up" value={fmt(detail.totalMarkedUpValue || 0)} />
          <MiniKpi
            label="Margin"
            value={fmt(margin)}
            sub={marginPct ? `${marginPct}% of base` : undefined}
            accent={margin > 0 ? "text-success" : undefined}
          />
          <MarkupKpi currentMarkup={detail.markupPercent} onSave={props.onMarkupChange} />
        </div>
      </div>

      {/* ── Inner tab strip ────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-1 bg-surface-container/30 px-4 py-2 rounded-xl ghost-border">
        {(
          [
            { key: "items", label: "Items", icon: "list_alt", count: detail.items.length },
            { key: "comparisons", label: "Comparisons", icon: "compare_arrows", count: detail.comparisons?.length || 0 },
            { key: "history", label: "Version History", icon: "history", count: supplierVersions.length },
          ] as const
        ).map(({ key, label, icon, count }) => (
          <button key={key} onClick={() => setWsTab(key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold transition-colors ${wsTab === key ? "bg-primary/10 text-primary" : "text-on-surface-variant hover:bg-surface-high/20"}`}>
            <Ic name={icon} className="text-sm" />
            {label}
            {count > 0 && (
              <span className={`text-[0.5rem] font-mono px-1 py-0.5 rounded ${wsTab === key ? "bg-primary/20 text-primary" : "bg-surface-high/40 text-outline"}`}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Item detail modal ──────────────────────────────── */}
      {selectedItem && (
        <ItemDetailModal
          item={selectedItem}
          versionId={detail.id}
          onClose={() => setSelectedItem(null)}
          onSaved={() => { setSelectedItem(null); props.onItemSaved?.(); }}
          onDeleted={() => { setSelectedItem(null); props.onItemDeleted?.(); }}
        />
      )}

      {/* ── Tab content ────────────────────────────────────── */}
      {wsTab === "items" && (
        <div className="flex-1 min-h-0 flex flex-col gap-3">
          <AgreementControlAgentPanel
            detail={detail}
            supplierVersions={supplierVersions}
            scanning={props.scanning}
            onRunScan={props.onRunControlScan}
            onCompare={() => props.fileInputRef.current?.click()}
            onRenew={props.onDuplicate}
          />
          <ItemsTab
            items={props.filteredItems}
            totalItems={detail.items.length}
            search={props.itemSearch}
            setSearch={props.setItemSearch}
            sortField={props.sortField}
            setSortField={props.setSortField}
            sortDir={props.sortDir}
            setSortDir={props.setSortDir}
            onExport={() => props.onExport(false)}
            onExportPdf={props.onExportPdf}
            onItemClick={setSelectedItem}
            versionId={detail.id}
            onEnriched={() => props.onItemSaved?.()}
            onBulkChanged={() => props.onItemSaved?.()}
          />
        </div>
      )}

      {wsTab === "comparisons" && (
        <div className="flex-1 min-h-0">
          <ComparisonsTab
            comparisons={detail.comparisons || []}
            fileInputRef={props.fileInputRef}
            uploading={props.uploading}
            onOpenComparison={(compId) => props.onOpenComparison(detail.id, compId)}
          />
        </div>
      )}
      {wsTab === "history" && (
        <div className="flex-1 min-h-0">
          <HistoryTab
            versions={supplierVersions}
            selectedId={detail.id}
            onSelect={props.onSelectVersion}
          />
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   Validity Bar
   ════════════════════════════════════════════════════════════ */

function AgreementControlAgentPanel({
  detail,
  supplierVersions,
  scanning,
  onRunScan,
  onCompare,
  onRenew,
}: {
  detail: VersionDetail;
  supplierVersions: AgreementVersion[];
  scanning: boolean;
  onRunScan: () => void;
  onCompare: () => void;
  onRenew: () => void;
}) {
  const otherDrafts = supplierVersions.filter((version) => version.id !== detail.id && version.status === "Draft").length;
  const activeVersions = supplierVersions.filter((version) => version.status === "Active").length;
  const missingTradeData = detail.items.filter((item) => !item.basePrice || !item.unit || !item.vendorPartNumber).length;
  const missingCompliance = detail.items.filter((item) => !item.hsCode || !item.countryOfOrigin).length;
  const days = daysUntil(detail.validTo);
  const expiringSoon = detail.status === "Active" && days !== null && days > 0 && days <= 30;
  const needsReview = otherDrafts > 0 || activeVersions > 1 || missingTradeData > 0 || missingCompliance > 0 || expiringSoon;

  const signals = [
    {
      label: "Supplier trade agreement",
      value: detail.status === "Active" ? "Active" : detail.status,
      tone: detail.status === "Active" ? "text-success" : detail.status === "Draft" ? "text-warning" : "text-on-surface-variant",
      note: `${detail.items.length} item${detail.items.length !== 1 ? "s" : ""} under ${detail.markupPercent}% markup`,
    },
    {
      label: "Version control",
      value: activeVersions > 1 ? `${activeVersions} active` : `${supplierVersions.length} version${supplierVersions.length !== 1 ? "s" : ""}`,
      tone: activeVersions > 1 || otherDrafts > 0 ? "text-warning" : "text-success",
      note: otherDrafts > 0 ? `${otherDrafts} draft renewal${otherDrafts !== 1 ? "s" : ""} open` : "No conflicting draft renewal detected",
    },
    {
      label: "Data quality",
      value: missingTradeData + missingCompliance > 0 ? `${missingTradeData + missingCompliance} gaps` : "Clean",
      tone: missingTradeData + missingCompliance > 0 ? "text-warning" : "text-success",
      note: `${missingTradeData} trade data / ${missingCompliance} HS-COO gaps`,
    },
    {
      label: "Shipping-company contracts",
      value: "Linked",
      tone: "text-success",
      note: "Supplier agreements can now be composed into customer fixed-markup contracts",
    },
  ];

  return (
    <div className="shrink-0 rounded-xl bg-surface-container/50 ghost-border p-4 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Ic name="smart_toy" className="text-primary text-base" />
            <h4 className="text-sm font-semibold">Agreement Control Agent</h4>
            <span className={`text-[0.55rem] font-semibold px-1.5 py-0.5 rounded ${needsReview ? "bg-warning/10 text-warning" : "bg-success/10 text-success"}`}>
              {needsReview ? "Review" : "Controlled"}
            </span>
          </div>
          <p className="text-xs text-outline mt-1">
            Keeps supplier trade agreements organized for item pricing, markup updates, renewal control, and shipping-company contract linkage.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={onRunScan} disabled={scanning}
            className="flex items-center gap-1 text-[0.65rem] font-medium bg-primary/8 text-primary px-2.5 py-1.5 rounded-md hover:bg-primary/12 transition-colors disabled:opacity-50">
            <Ic name={scanning ? "sync" : "rule"} className={`text-xs ${scanning ? "animate-spin" : ""}`} />
            {scanning ? "Scanning" : "Run Control Scan"}
          </button>
          <button onClick={onCompare}
            className="flex items-center gap-1 text-[0.65rem] font-medium bg-surface-high/30 text-on-surface-variant px-2.5 py-1.5 rounded-md hover:bg-surface-high/50 transition-colors">
            <Ic name="upload_file" className="text-xs" />Update Prices
          </button>
          <button onClick={onRenew}
            className="flex items-center gap-1 text-[0.65rem] font-medium bg-surface-high/30 text-on-surface-variant px-2.5 py-1.5 rounded-md hover:bg-surface-high/50 transition-colors">
            <Ic name="call_merge" className="text-xs" />Renew / Combine Draft
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5">
        {signals.map((signal) => (
          <div key={signal.label} className="rounded-lg bg-surface-low/25 border border-outline-variant/5 p-3">
            <p className="text-[0.55rem] uppercase tracking-wider text-outline font-semibold">{signal.label}</p>
            <p className={`text-sm font-semibold mt-1 ${signal.tone}`}>{signal.value}</p>
            <p className="text-[0.62rem] text-outline mt-1 leading-snug">{signal.note}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ValidityBar({ validFrom, validTo }: { validFrom: string | Date; validTo: string | Date }) {
  const from = new Date(validFrom).getTime();
  const to = new Date(validTo).getTime();
  const [now] = useState(() => Date.now());
  const progress = Math.min(100, Math.max(0, ((now - from) / (to - from)) * 100));
  const days = Math.ceil((to - now) / (1000 * 60 * 60 * 24));
  const isExpired = days <= 0;
  const isExpiring = days > 0 && days <= 30;

  return (
    <div className="mt-3 mb-1">
      <div className="flex items-center justify-between text-[0.58rem] text-outline mb-1.5">
        <span>{fmtDate(validFrom)}</span>
        <span className={`font-medium ${isExpired ? "text-error" : isExpiring ? "text-warning" : "text-success"}`}>
          {isExpired
            ? `Expired ${Math.abs(days)} days ago`
            : isExpiring
            ? `${days} days remaining — expiring soon`
            : `${days} days remaining`}
        </span>
        <span>{fmtDate(validTo)}</span>
      </div>
      <div className="h-1 bg-surface-high/20 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${isExpired ? "bg-error/50" : isExpiring ? "bg-warning/60" : "bg-success/50"}`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   Items Tab
   ════════════════════════════════════════════════════════════ */

const ITEM_COLS: { key: string; label: string; align?: "right" }[] = [
  { key: "lineNumber", label: "#" },
  { key: "offiNumber", label: "Item Code" },
  { key: "vendorPartNumber", label: "Vendor Part" },
  { key: "description", label: "Description" },
  { key: "basePrice", label: "Base €", align: "right" },
  { key: "markedUpPrice", label: "Sell €", align: "right" },
  { key: "unit", label: "Unit" },
  { key: "moq", label: "MOQ", align: "right" },
  { key: "leadTimeDays", label: "Lead" },
  { key: "hsCode", label: "HS Code" },
  { key: "countryOfOrigin", label: "COO" },
  { key: "cooConfidence", label: "Confidence" },
  { key: "manufacturer", label: "Manufacturer" },
];

/* ── Display normalizers ──────────────────────────────────────
   Database may hold legacy 2-letter codes ("DE") or full country
   names ("Germany"). Normalize to ISO 3166-1 alpha-3 for display. */
const ALPHA2_TO_ALPHA3: Record<string, string> = {
  DE: "DEU", US: "USA", GB: "GBR", UK: "GBR", NL: "NLD", IT: "ITA",
  FR: "FRA", SE: "SWE", FI: "FIN", NO: "NOR", DK: "DNK", CH: "CHE",
  JP: "JPN", KR: "KOR", CN: "CHN", SG: "SGP", TR: "TUR", ES: "ESP",
  GR: "GRC",
};
const NAME_TO_ALPHA3: Record<string, string> = {
  germany: "DEU", "united states": "USA", usa: "USA",
  "united kingdom": "GBR", britain: "GBR",
  netherlands: "NLD", holland: "NLD",
  italy: "ITA", france: "FRA", sweden: "SWE", finland: "FIN",
  norway: "NOR", denmark: "DNK", switzerland: "CHE",
  japan: "JPN", "south korea": "KOR", korea: "KOR",
  china: "CHN", singapore: "SGP", turkey: "TUR", spain: "ESP",
  greece: "GRC",
};
function normalizeCoo(value: string | null | undefined): string {
  if (!value) return "";
  const v = value.trim();
  if (/^[A-Z]{3}$/i.test(v)) return v.toUpperCase();          // already alpha-3
  if (/^[A-Z]{2}$/i.test(v)) return ALPHA2_TO_ALPHA3[v.toUpperCase()] || v.toUpperCase();
  const key = v.toLowerCase();
  return NAME_TO_ALPHA3[key] || v.toUpperCase().slice(0, 3);
}

/* Normalize HS code display to 8-digit TARIC: strip dots, pad if needed. */
function normalizeHs(value: string | null | undefined): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  if (digits.length === 0) return "";
  if (digits.length >= 8) return digits.slice(0, 8);
  // pad legacy 6-digit codes with trailing zeroes to reach 8-digit TARIC form.
  return (digits + "00000000").slice(0, 8);
}

/* Confidence pill styling */
const CONFIDENCE_STYLE: Record<string, string> = {
  High:   "bg-success/10 text-success",
  Medium: "bg-warning/10 text-warning",
  Low:    "bg-surface-high/40 text-on-surface-variant",
};

function ItemsTab({
  items, totalItems, search, setSearch,
  sortField, setSortField, sortDir, setSortDir, onExport, onItemClick,
  onExportPdf, versionId, onEnriched, onBulkChanged, expanded = false, onToggleExpand,
}: {
  items: AgreementItem[];
  totalItems: number;
  search: string;
  setSearch: (s: string) => void;
  sortField: string;
  setSortField: (f: string) => void;
  sortDir: "asc" | "desc";
  setSortDir: (d: "asc" | "desc") => void;
  onExport: () => void;
  onExportPdf?: () => void;
  onItemClick?: (item: AgreementItem) => void;
  versionId?: string;
  onEnriched?: () => void;
  onBulkChanged?: () => void;
  expanded?: boolean;
  onToggleExpand?: () => void;
}) {
  const [enriching, setEnriching] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [enrichResult, setEnrichResult] = useState<{
    candidatesScanned: number;
    hsFilled: number;
    cooFilled: number;
    enrichedCount: number;
  } | null>(null);

  function toggleSort(field: string) {
    if (sortField === field) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  }

  const missingHs = items.filter((i) => !i.hsCode).length;
  const missingCoo = items.filter((i) => !i.countryOfOrigin).length;
  const totalMissing = missingHs + missingCoo;
  const selectedItems = items.filter((item) => selectedIds.has(item.id));

  const toggleItemSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());
  const selectVisibleItems = () => setSelectedIds(new Set(items.map((item) => item.id)));

  async function applyMarkupToSelected() {
    if (!versionId || selectedItems.length === 0) return;
    const raw = prompt("Apply markup % to selected agreement items", "20");
    if (raw === null) return;
    const markup = Number(raw);
    if (!Number.isFinite(markup)) return;
    await Promise.all(selectedItems.map((item) => fetch(`/api/v1/agreements/${versionId}/items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markedUpPrice: Math.round((item.basePrice || 0) * (1 + markup / 100) * 100) / 100 }),
    })));
    clearSelection();
    setSelectionMode(false);
    onBulkChanged?.();
  }

  async function deleteSelectedItems() {
    if (!versionId || selectedItems.length === 0 || !confirm(`Delete ${selectedItems.length} selected agreement item(s)?`)) return;
    await Promise.all(selectedItems.map((item) => fetch(`/api/v1/agreements/${versionId}/items/${item.id}`, { method: "DELETE" })));
    clearSelection();
    setSelectionMode(false);
    onBulkChanged?.();
  }

  async function runEnrich() {
    if (!versionId || enriching) return;
    setEnriching(true);
    setEnrichResult(null);
    try {
      const res = await fetch(`/api/v1/agreements/${versionId}/enrich`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: ["hsCode", "countryOfOrigin"] }),
      });
      if (res.ok) {
        const data = await res.json();
        setEnrichResult({
          candidatesScanned: data.candidatesScanned,
          hsFilled: data.hsFilled,
          cooFilled: data.cooFilled,
          enrichedCount: data.enrichedCount,
        });
        onEnriched?.();
      }
    } catch { /* no-op */ }
    setEnriching(false);
  }

  const tableHeight = expanded ? "max-h-[calc(100vh-260px)]" : "h-full min-h-[300px]";

  return (
    <div className={`${expanded ? "h-full" : "flex-1 min-h-0"} bg-surface-container/50 rounded-xl ghost-border overflow-hidden flex flex-col`}>
      <div className="flex items-center justify-between px-5 py-3 border-b border-outline-variant/6">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold">Agreement Items</h4>
          {totalItems > 0 && (
            <span className="text-xs font-medium bg-surface-high/40 text-on-surface-variant px-2 py-0.5 rounded">
              {items.length}{items.length !== totalItems ? ` of ${totalItems}` : " items"}
            </span>
          )}
          {totalMissing > 0 && (
            <span className="text-[0.55rem] font-medium bg-warning/10 text-warning px-1.5 py-0.5 rounded flex items-center gap-0.5">
              <Ic name="warning_amber" className="text-[0.65rem]" />
              {missingHs > 0 && `${missingHs} HS`}
              {missingHs > 0 && missingCoo > 0 && " · "}
              {missingCoo > 0 && `${missingCoo} COO`} missing
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-64">
            <Ic name="search" className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-outline/40" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter items…"
              className="w-full bg-surface-high/30 border border-outline-variant/8 rounded-lg pl-7 pr-2 py-1.5 text-sm placeholder:text-outline/35 focus:outline-none focus:ring-1 focus:ring-primary/20" />
          </div>
          {totalItems > 0 && versionId && (
            <button onClick={() => { setSelectionMode((value) => !value); clearSelection(); }}
              className={`flex items-center gap-1 text-[0.65rem] font-medium px-2.5 py-1 rounded-md transition-colors ${selectionMode ? "bg-primary/12 text-primary" : "text-outline hover:bg-surface-high/20"}`}>
              <Ic name="select_all" className="text-xs" />Smart Select
            </button>
          )}
          {selectionMode && (
            <>
              <span className="text-[0.65rem] text-outline">{selectedItems.length} selected</span>
              <button onClick={selectVisibleItems} className="text-[0.65rem] font-medium text-primary px-2 py-1 rounded-md hover:bg-primary/10">Select Visible</button>
              <button onClick={clearSelection} className="text-[0.65rem] font-medium text-outline px-2 py-1 rounded-md hover:bg-surface-high/30">Clear</button>
              <button onClick={applyMarkupToSelected} disabled={selectedItems.length === 0} className="text-[0.65rem] font-medium text-success px-2 py-1 rounded-md hover:bg-success/10 disabled:opacity-40">Apply Markup</button>
              <button onClick={deleteSelectedItems} disabled={selectedItems.length === 0} className="text-[0.65rem] font-medium text-error px-2 py-1 rounded-md hover:bg-error/10 disabled:opacity-40">Delete</button>
            </>
          )}
          {totalMissing > 0 && versionId && (
            <button onClick={runEnrich} disabled={enriching}
              className="flex items-center gap-1 text-[0.65rem] font-medium bg-primary/10 text-primary px-2.5 py-1 rounded-md hover:bg-primary/15 transition-colors disabled:opacity-50">
              <Ic name={enriching ? "sync" : "auto_awesome"} className={`text-xs ${enriching ? "animate-spin" : ""}`} />
              {enriching ? "Enriching…" : "Auto-fill missing"}
            </button>
          )}
          {totalItems > 0 && (
            <button onClick={onExport}
              className="flex items-center gap-1 text-[0.65rem] font-medium text-outline px-2 py-1 rounded-md hover:bg-surface-high/20 transition-colors">
              <Ic name="download" className="text-xs" />XLSX
            </button>
          )}
          {totalItems > 0 && onExportPdf && (
            <button onClick={onExportPdf}
              className="flex items-center gap-1 text-[0.65rem] font-medium text-outline px-2 py-1 rounded-md hover:bg-surface-high/20 transition-colors">
              <Ic name="picture_as_pdf" className="text-xs" />PDF
            </button>
          )}
          {onToggleExpand && (
            <button onClick={onToggleExpand}
              className="flex items-center gap-1 text-[0.65rem] font-medium text-outline px-2 py-1 rounded-md hover:bg-surface-high/20 transition-colors"
              title={expanded ? "Collapse" : "Expand to full screen"}>
              <Ic name={expanded ? "close_fullscreen" : "open_in_full"} className="text-xs" />
              {expanded ? "Collapse" : "Expand"}
            </button>
          )}
        </div>
      </div>

      {/* Enrichment result banner */}
      {enrichResult && (
        <div className={`px-5 py-2 border-b border-outline-variant/6 flex items-center justify-between text-[0.65rem] ${
          enrichResult.enrichedCount > 0 ? "bg-success/6" : "bg-surface-high/20"
        }`}>
          <div className="flex items-center gap-2">
            <Ic name={enrichResult.enrichedCount > 0 ? "task_alt" : "info"}
              className={`text-sm ${enrichResult.enrichedCount > 0 ? "text-success" : "text-outline"}`} />
            <span className={enrichResult.enrichedCount > 0 ? "text-success" : "text-outline"}>
              {enrichResult.enrichedCount > 0
                ? `Enriched ${enrichResult.enrichedCount} item${enrichResult.enrichedCount !== 1 ? "s" : ""} · ${enrichResult.hsFilled} HS code${enrichResult.hsFilled !== 1 ? "s" : ""}, ${enrichResult.cooFilled} COO value${enrichResult.cooFilled !== 1 ? "s" : ""} filled in`
                : enrichResult.candidatesScanned === 0
                  ? "No items have missing data to enrich"
                  : `Scanned ${enrichResult.candidatesScanned} item${enrichResult.candidatesScanned !== 1 ? "s" : ""} · no confident matches found`}
            </span>
          </div>
          <button onClick={() => setEnrichResult(null)} className="text-outline/60 hover:text-on-surface-variant transition-colors">
            <Ic name="close" className="text-xs" />
          </button>
        </div>
      )}

      {totalItems === 0 ? (
        <div className="py-14 text-center space-y-2">
          <Ic name="inbox" className="text-2xl text-outline/30" />
          <p className="text-xs text-on-surface-variant">No items in this agreement</p>
          <p className="text-[0.65rem] text-outline">Import a supplier file or upload one via Compare to populate items</p>
        </div>
      ) : (
        <div className={`overflow-x-auto ${tableHeight} overflow-y-auto`}>
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-outline-variant/6 bg-surface-container/95">
                {ITEM_COLS.map((col) => (
                  <th key={col.key} onClick={() => toggleSort(col.key)}
                    className={`px-3 py-2 text-xs font-semibold text-on-surface-variant uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-on-surface select-none ${col.align === "right" ? "text-right" : "text-left"}`}>
                    <span className="inline-flex items-center gap-0.5">
                      {col.label}
                      {sortField === col.key && (
                        <Ic name={sortDir === "asc" ? "arrow_upward" : "arrow_downward"} className={`${expanded ? "text-xs" : "text-[0.6rem]"} text-primary`} />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/4">
              {items.map((item) => {
                const isSelected = selectedIds.has(item.id);
                // ── size + color tokens, upgraded in fullscreen for readability ──
                const cellRow = "py-2.5";
                const num = "text-xs";
                const numSm = "text-xs";
                const textSm = "text-xs";
                const textBase = "text-sm";
                const txtDim = "text-on-surface-variant";
                const txtNormal = "text-on-surface";
                const descMax = expanded ? "max-w-none" : "max-w-[320px] truncate";
                const mfgMax = expanded ? "max-w-none" : "max-w-[180px] truncate";
                return (
                  <tr key={item.id}
                    onClick={() => selectionMode ? toggleItemSelection(item.id) : onItemClick?.(item)}
                    className={`transition-colors ${onItemClick || selectionMode ? "cursor-pointer hover:bg-primary/5" : "hover:bg-surface-high/10"} ${isSelected ? "bg-primary/10 ring-1 ring-inset ring-primary/20" : ""}`}>
                    <td className={`px-3 ${cellRow} font-mono ${num} ${txtDim}`}>
                      {selectionMode && <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle ${isSelected ? "bg-primary shadow-[0_0_0_3px_rgba(83,255,180,0.12)]" : "bg-outline/30"}`} />}
                      {item.lineNumber}
                    </td>
                    <td className={`px-3 ${cellRow} font-mono ${expanded ? "text-sm" : "text-[0.65rem]"} font-semibold text-primary`}>{agreementItemCode(item)}</td>
                    <td className={`px-3 ${cellRow} font-mono ${num} ${txtDim}`}>{item.vendorPartNumber || "—"}</td>
                    <td className={`px-3 ${cellRow} ${textBase} ${txtNormal} ${descMax}`} title={item.description}>{item.description}</td>
                    <td className={`px-3 ${cellRow} font-mono ${textBase} text-right font-semibold`}>{item.basePrice != null ? `€${item.basePrice.toFixed(2)}` : "—"}</td>
                    <td className={`px-3 ${cellRow} font-mono ${textBase} text-right font-semibold text-success`}>{item.markedUpPrice ? `€${item.markedUpPrice.toFixed(2)}` : "—"}</td>
                    <td className={`px-3 ${cellRow} ${numSm} ${txtNormal}`}>{item.unit || "—"}</td>
                    <td className={`px-3 ${cellRow} font-mono ${numSm} ${txtNormal} text-right`}>{item.moq ?? "—"}</td>
                    <td className={`px-3 ${cellRow} font-mono ${numSm} ${txtNormal}`}>{item.leadTimeDays ? `${item.leadTimeDays}d` : "—"}</td>
                    <td className={`px-3 ${cellRow} font-mono ${textSm} ${item.hsCode ? txtNormal : "text-warning/80 italic"}`}>{item.hsCode ? normalizeHs(item.hsCode) : "missing"}</td>
                    <td className={`px-3 ${cellRow} font-mono ${textSm} ${item.countryOfOrigin ? txtNormal : "text-warning/80 italic"}`}>{item.countryOfOrigin ? normalizeCoo(item.countryOfOrigin) : "missing"}</td>
                    <td className={`px-3 ${cellRow} ${textSm}`}>
                      {item.cooConfidence ? (
                        <span className={`inline-block px-1.5 py-0.5 rounded font-medium ${CONFIDENCE_STYLE[item.cooConfidence] || "bg-surface-high/40 text-on-surface-variant"}`}>
                          {item.cooConfidence}
                        </span>
                      ) : (
                        <span className={txtDim}>—</span>
                      )}
                    </td>
                    <td className={`px-3 ${cellRow} ${textSm} ${txtNormal} ${mfgMax}`} title={item.manufacturer || ""}>{item.manufacturer || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {items.length === 0 && totalItems > 0 && (
            <div className="py-8 text-center">
              <p className="text-xs text-outline">No items match filter</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   Item Detail Modal
   ════════════════════════════════════════════════════════════ */

/* Module-level Field component — must NOT be defined inside ItemDetailModal,
   otherwise each parent re-render creates a new component reference and the
   <input> is unmounted/remounted on every keystroke (focus loss). */
function Field({
  label, value, field, editing, onChange, mono = false,
}: {
  label: string;
  value: string;
  field: string;
  editing: boolean;
  onChange: (field: string, value: string) => void;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-[0.55rem] text-outline mb-0.5">{label}</p>
      {editing ? (
        <input
          value={value}
          onChange={(e) => onChange(field, e.target.value)}
          className={`w-full bg-surface-high/20 border border-outline-variant/15 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/20 ${mono ? "font-mono" : ""}`}
        />
      ) : (
        <p className={`text-xs ${mono ? "font-mono" : ""} ${value ? "text-on-surface-variant" : "text-outline/40 italic"}`}>
          {value || "—"}
        </p>
      )}
    </div>
  );
}

function ItemDetailModal({
  item, versionId, onClose, onSaved, onDeleted,
}: {
  item: AgreementItem;
  versionId: string;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const dialogRef = useDialogA11y<HTMLDivElement>(onClose);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [draft, setDraft] = useState({
    description: item.description ?? "",
    offiNumber: agreementItemCode(item),
    vendorPartNumber: item.vendorPartNumber ?? "",
    basePrice: item.basePrice != null ? String(item.basePrice) : "",
    markedUpPrice: item.markedUpPrice != null ? String(item.markedUpPrice) : "",
    currency: item.currency ?? "EUR",
    unit: item.unit ?? "",
    moq: item.moq != null ? String(item.moq) : "",
    leadTimeDays: item.leadTimeDays != null ? String(item.leadTimeDays) : "",
    hsCode: item.hsCode ?? "",
    countryOfOrigin: item.countryOfOrigin ?? "",
    cooConfidence: item.cooConfidence ?? "",
    manufacturer: item.manufacturer ?? "",
  });

  function set(field: string, value: string) {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }

  const handleSave = async () => {
    setSaving(true);
    await fetch(`/api/v1/agreements/${versionId}/items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: draft.description || undefined,
        offiNumber: draft.offiNumber || null,
        vendorPartNumber: draft.vendorPartNumber || null,
        basePrice: draft.basePrice !== "" ? Number(draft.basePrice) : undefined,
        markedUpPrice: draft.markedUpPrice !== "" ? Number(draft.markedUpPrice) : undefined,
        currency: draft.currency || undefined,
        unit: draft.unit || null,
        moq: draft.moq !== "" ? Number(draft.moq) : null,
        leadTimeDays: draft.leadTimeDays !== "" ? Number(draft.leadTimeDays) : null,
        hsCode: draft.hsCode ? draft.hsCode.replace(/\D/g, "").slice(0, 8) : null,
        countryOfOrigin: draft.countryOfOrigin ? draft.countryOfOrigin.toUpperCase().slice(0, 3) : null,
        cooConfidence: draft.cooConfidence || null,
        manufacturer: draft.manufacturer || null,
      }),
    });
    setSaving(false);
    setEditing(false);
    onSaved();
  };

  const handleDelete = async () => {
    await fetch(`/api/v1/agreements/${versionId}/items/${item.id}`, { method: "DELETE" });
    onDeleted();
  };

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    const res = await fetch(`/api/v1/agreements/${versionId}/items/${item.id}/export/pdf`);
    setDownloadingPdf(false);
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = res.headers.get("content-disposition")?.split("filename=")[1]?.replace(/"/g, "") || `${agreementItemCode(item)}.pdf`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/45" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={item.description || "Agreement item"}
        className="relative bg-surface-container rounded-2xl ghost-border shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-outline-variant/8">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[0.65rem] font-mono bg-surface-high/40 text-outline px-2 py-0.5 rounded">Line {item.lineNumber}</span>
              <span className="text-[0.65rem] font-mono font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded">{agreementItemCode(item)}</span>
            </div>
            <h3 className="text-base font-semibold leading-snug">{item.description || "Unnamed Item"}</h3>
            {item.manufacturer && <p className="text-xs text-outline mt-1">{item.manufacturer}</p>}
          </div>
          <button onClick={onClose} className="ml-3 p-2 rounded-lg text-outline hover:text-on-surface-variant hover:bg-surface-high/30 transition-colors">
            <Ic name="close" className="text-base" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Item Code" value={draft.offiNumber} field="offiNumber" editing={editing} onChange={set} mono />
            <Field label="Vendor SKU" value={draft.vendorPartNumber} field="vendorPartNumber" editing={editing} onChange={set} mono />
            <Field label="Currency" value={draft.currency} field="currency" editing={editing} onChange={set} mono />
            <Field label="Base Price" value={draft.basePrice} field="basePrice" editing={editing} onChange={set} mono />
            <Field label="Sell Price" value={draft.markedUpPrice} field="markedUpPrice" editing={editing} onChange={set} mono />
            <Field label="Unit" value={draft.unit} field="unit" editing={editing} onChange={set} mono />
            <Field label="MOQ" value={draft.moq} field="moq" editing={editing} onChange={set} mono />
            <Field label="Lead Time Days" value={draft.leadTimeDays} field="leadTimeDays" editing={editing} onChange={set} mono />
            <Field label="Manufacturer" value={draft.manufacturer} field="manufacturer" editing={editing} onChange={set} />
            <Field label="HS Code" value={editing ? draft.hsCode : normalizeHs(draft.hsCode)} field="hsCode" editing={editing} onChange={set} mono />
            <Field label="Country of Origin" value={editing ? draft.countryOfOrigin : normalizeCoo(draft.countryOfOrigin)} field="countryOfOrigin" editing={editing} onChange={set} mono />
            <div>
              <p className="text-[0.55rem] text-outline mb-0.5">COO Confidence</p>
              {editing ? (
                <select value={draft.cooConfidence} onChange={(e) => set("cooConfidence", e.target.value)} className="w-full bg-surface-high/20 border border-outline-variant/15 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/20">
                  <option value="">-</option>
                  <option value="High">High</option>
                  <option value="Medium">Medium</option>
                  <option value="Low">Low</option>
                </select>
              ) : (
                <p className="text-xs text-on-surface-variant">{draft.cooConfidence || "-"}</p>
              )}
            </div>
          </div>

          <div>
            <p className="text-[0.55rem] text-outline mb-1">Description</p>
            {editing ? (
              <textarea value={draft.description} onChange={(e) => set("description", e.target.value)} rows={3} className="w-full bg-surface-high/20 border border-outline-variant/15 rounded px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/20 resize-none" />
            ) : (
              <p className="text-sm text-on-surface-variant leading-relaxed">{draft.description || "-"}</p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-outline-variant/8">
          <div>
            {!confirmDelete ? (
              <button onClick={() => setConfirmDelete(true)} className="flex items-center gap-1 text-xs font-medium text-error/70 hover:text-error px-2 py-1.5 rounded-md hover:bg-error/6 transition-colors">
                <Ic name="delete" className="text-xs" />Delete
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-error font-medium">Delete this item?</span>
                <button onClick={handleDelete} className="text-xs font-medium bg-error/10 text-error px-2.5 py-1 rounded-md hover:bg-error/15 transition-colors">Confirm</button>
                <button onClick={() => setConfirmDelete(false)} className="text-xs text-outline hover:text-on-surface-variant transition-colors">Cancel</button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {editing ? (
              <>
                <button onClick={() => setEditing(false)} className="text-xs font-medium text-outline px-3 py-1.5 rounded-md hover:bg-surface-high/20 transition-colors">Cancel</button>
                <button onClick={handleSave} disabled={saving} className="flex items-center gap-1 text-xs font-medium bg-primary/10 text-primary px-3.5 py-1.5 rounded-md hover:bg-primary/15 transition-colors disabled:opacity-50">
                  <Ic name="check" className="text-xs" />{saving ? "Saving" : "Save"}
                </button>
              </>
            ) : (
              <>
                <button onClick={handleDownloadPdf} disabled={downloadingPdf} className="flex items-center gap-1 text-xs font-medium bg-surface-high/30 text-on-surface-variant px-3.5 py-1.5 rounded-md hover:bg-surface-high/50 transition-colors disabled:opacity-50">
                  <Ic name={downloadingPdf ? "sync" : "picture_as_pdf"} className={`text-xs ${downloadingPdf ? "animate-spin" : ""}`} />
                  {downloadingPdf ? "Preparing" : "PDF"}
                </button>
                <button onClick={onClose} className="text-xs font-medium text-outline px-3 py-1.5 rounded-md hover:bg-surface-high/20 transition-colors">Close</button>
                <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-xs font-medium bg-surface-high/30 text-on-surface-variant px-3.5 py-1.5 rounded-md hover:bg-surface-high/50 transition-colors">
                  <Ic name="edit" className="text-xs" />Edit
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   Comparisons Tab
   ════════════════════════════════════════════════════════════ */

const COMP_STATUS_COLORS: Record<string, string> = {
  Queued: "bg-surface-high/40 text-outline",
  Processing: "bg-info/8 text-info",
  Completed: "bg-success/8 text-success",
  Failed: "bg-error/8 text-error",
};

function ComparisonsTab({
  comparisons, fileInputRef, uploading, onOpenComparison,
}: {
  comparisons: AgreementComparison[];
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  uploading: boolean;
  onOpenComparison: (compId: string) => void;
}) {
  return (
    <div className="bg-surface-container/50 rounded-xl ghost-border overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-outline-variant/6">
        <div className="flex items-center gap-2">
          <h4 className="text-[0.75rem] font-semibold">Comparison History</h4>
          <span className="text-[0.55rem] font-medium bg-surface-high/40 text-on-surface-variant px-1.5 py-0.5 rounded">
            {comparisons.length}
          </span>
        </div>
        <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
          className="flex items-center gap-1 text-[0.65rem] font-medium bg-primary/8 text-primary px-2.5 py-1.5 rounded-md hover:bg-primary/12 transition-colors disabled:opacity-50">
          <Ic name="upload_file" className="text-xs" />{uploading ? "Uploading…" : "Upload New File"}
        </button>
      </div>

      {comparisons.length === 0 ? (
        <div className="py-12 text-center space-y-2">
          <Ic name="compare_arrows" className="text-2xl text-outline/30" />
          <p className="text-xs text-on-surface-variant">No comparisons yet</p>
          <p className="text-[0.65rem] text-outline">{"Upload a supplier price file to compare against this version's items"}</p>
        </div>
      ) : (
        <div className="divide-y divide-outline-variant/4">
          {comparisons.map((c) => (
            <button key={c.id} onClick={() => onOpenComparison(c.id)}
              className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-surface-high/10 transition-colors text-left">
              <div className="flex items-center gap-3">
                <span className={`text-[0.55rem] font-medium px-1.5 py-0.5 rounded ${COMP_STATUS_COLORS[c.status] || ""}`}>
                  {c.status}
                </span>
                <div>
                  <p className="text-xs font-medium">{c.sourceFileName || "Unnamed file"}</p>
                  <p className="text-[0.6rem] text-outline">
                    {fmtDate(c.createdAt)} {c.sourceRowCount ? `· ${c.sourceRowCount} rows` : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 text-[0.6rem]">
                {c.status === "Completed" && (
                  <>
                    <span className="text-on-surface-variant font-medium">{c.totalChanges} changes</span>
                    {c.newItems > 0 && <span className="text-success font-medium">+{c.newItems}</span>}
                    {c.removedItems > 0 && <span className="text-error font-medium">−{c.removedItems}</span>}
                    {c.priceChanges > 0 && <span className="text-warning">{c.priceChanges} price</span>}
                    {c.totalPriceImpact != null && (
                      <span className={`font-mono font-medium ${c.totalPriceImpact > 0 ? "text-error" : "text-success"}`}>
                        {c.totalPriceImpact > 0 ? "+" : ""}€{Math.abs(c.totalPriceImpact).toFixed(0)}
                      </span>
                    )}
                  </>
                )}
                {c.status === "Processing" && (
                  <span className="text-info animate-pulse">{c.progressPct}%</span>
                )}
                {c.status === "Failed" && (
                  <span className="text-error text-[0.6rem]">{c.error || "Failed"}</span>
                )}
                <Ic name="chevron_right" className="text-sm text-outline/40" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   History Tab
   ════════════════════════════════════════════════════════════ */

function HistoryTab({
  versions, selectedId, onSelect,
}: {
  versions: AgreementVersion[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="bg-surface-container/50 rounded-xl ghost-border overflow-hidden">
      <div className="px-5 py-3 border-b border-outline-variant/6">
        <h4 className="text-[0.75rem] font-semibold">Version History</h4>
        <p className="text-[0.6rem] text-outline mt-0.5">
          {versions.length} version{versions.length !== 1 ? "s" : ""} for this supplier
        </p>
      </div>
      <div className="divide-y divide-outline-variant/4">
        {versions.map((v, idx) => {
          const isCurrent = v.id === selectedId;
          const days = daysUntil(v.validTo);
          return (
            <button key={v.id} onClick={() => !isCurrent && onSelect(v.id)}
              className={`w-full flex items-stretch gap-0 text-left transition-colors ${isCurrent ? "bg-primary/5 cursor-default" : "hover:bg-surface-high/10"}`}>
              {/* Version timeline */}
              <div className="flex flex-col items-center px-4 py-3.5 w-16 shrink-0">
                <span className={`text-[0.75rem] font-mono font-bold ${isCurrent ? "text-primary" : "text-outline"}`}>
                  v{v.versionNumber}
                </span>
                {idx < versions.length - 1 && (
                  <div className="flex-1 w-px bg-outline-variant/20 mt-1.5" />
                )}
              </div>
              {/* Version details */}
              <div className="flex-1 py-3.5 pr-5 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <StatusBadge status={v.status} />
                  {isCurrent && (
                    <span className="text-[0.55rem] text-primary font-semibold">Current</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.6rem] text-outline">
                  <span>{v._count?.items || 0} items</span>
                  <span>{v.markupPercent}% markup</span>
                  <span className="font-mono">base {fmt(v.totalBaseValue || 0)}</span>
                  {v.validFrom && v.validTo && (
                    <span>{fmtDate(v.validFrom, true)} – {fmtDate(v.validTo, true)}</span>
                  )}
                  {v.status === "Active" && days !== null && days > 0 && days <= 30 && (
                    <span className="text-warning font-medium">{days}d left</span>
                  )}
                </div>
              </div>
              {/* Right: date + nav */}
              <div className="py-3.5 pr-5 text-right shrink-0">
                <p className="text-[0.6rem] text-outline">{fmtDate(v.createdAt, true)}</p>
                {!isCurrent && (
                  <p className="text-[0.55rem] text-primary mt-0.5">Open →</p>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   Comparison Panel (Compare tab)
   ════════════════════════════════════════════════════════════ */

function ComparisonPanel({
  comparison, loading, agreementOptions, selectedVersionId, comparisonSource, uploading,
  onSelectVersion, onStartCompare, onReview, onDeleteComparison,
}: {
  comparison: (AgreementComparison & { changes: AgreementChange[] }) | null;
  loading: boolean;
  agreementOptions: AgreementVersion[];
  selectedVersionId: string | null;
  comparisonSource: AgreementVersion | null;
  uploading: boolean;
  onSelectVersion: (versionId: string) => void;
  onStartCompare: () => void;
  onReview: (action: "accept" | "reject" | "auto_apply", changeIds?: string[]) => void;
  onDeleteComparison: () => void;
}) {
  const [selectedChanges, setSelectedChanges] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [changeFilter, setChangeFilter] = useState<"all" | ChangeType>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [baselineMenuOpen, setBaselineMenuOpen] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect -- Selection state belongs to one comparison and resets when its identity changes. */
  useEffect(() => {
    setSelectedChanges(new Set());
    setSelectionMode(false);
    setExpandedId(null);
  }, [comparison?.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const selectedBaseline = agreementOptions.find((agreement) => agreement.id === selectedVersionId) || null;

  if (loading) {
    return (
      <div className="bg-surface-container/50 rounded-xl ghost-border py-20 text-center space-y-2">
        <Ic name="sync" className="text-2xl text-primary animate-spin" />
        <p className="text-base text-on-surface-variant">Running comparison…</p>
        {comparison && comparison.progressPct > 0 && (
          <div className="max-w-xs mx-auto mt-3">
            <div className="flex justify-between text-xs text-outline mb-1">
              <span>{comparison.progressMessage || "Processing…"}</span>
              <span>{comparison.progressPct}%</span>
            </div>
            <div className="h-1 bg-surface-high/20 rounded-full overflow-hidden">
              <div className="h-full bg-primary/60 rounded-full transition-all duration-300" style={{ width: `${comparison.progressPct}%` }} />
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!comparison) {
    return (
      <div className="bg-surface-container/50 rounded-xl ghost-border p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Ic name="compare_arrows" className="text-primary text-base" />
              <h3 className="text-base font-semibold">Start Supplier File Compare</h3>
            </div>
            <p className="text-sm text-outline mt-1">Choose the baseline Ship Chandler trade agreement, then upload a supplier CSV or Excel file.</p>
          </div>
          <span className="text-xs font-mono text-outline bg-surface-high/35 px-2 py-1 rounded">{agreementOptions.length} available</span>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(280px,420px)_minmax(0,1fr)]">
          <div className="rounded-lg bg-surface-low/20 border border-outline-variant/8 p-4 space-y-3">
            <div className="relative space-y-1.5">
              <span className="text-[0.68rem] uppercase tracking-wide text-outline font-semibold">Baseline Agreement</span>
              <button type="button" onClick={() => setBaselineMenuOpen((value) => !value)}
                className={`w-full flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${baselineMenuOpen ? "border-primary/45 bg-primary/8 ring-1 ring-primary/20" : "border-outline-variant/12 bg-surface-high/30 hover:bg-surface-high/45"}`}>
                <span className="min-w-0">
                  {selectedBaseline ? (
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate font-semibold text-on-surface">{selectedBaseline.supplierName} / v{selectedBaseline.versionNumber}</span>
                      <span className="flex items-center gap-2 text-xs text-outline">
                        <StatusBadge status={selectedBaseline.status} className="text-[0.55rem]" />
                        <span>{selectedBaseline._count?.items || 0} items</span>
                      </span>
                    </span>
                  ) : (
                    <span className="text-on-surface-variant">Select supplier agreement...</span>
                  )}
                </span>
                <Ic name={baselineMenuOpen ? "expand_less" : "expand_more"} className="shrink-0 text-base text-primary" />
              </button>
              {baselineMenuOpen && (
                <div className="absolute left-0 right-0 top-full z-30 mt-2 max-h-72 overflow-y-auto rounded-lg border border-primary/20 bg-surface-low shadow-2xl shadow-black/40 ring-1 ring-primary/10">
                  {agreementOptions.length === 0 ? (
                    <div className="px-3 py-3 text-sm text-outline">No agreements available.</div>
                  ) : agreementOptions.map((agreement) => {
                    const isSelected = agreement.id === selectedVersionId;
                    return (
                      <button key={agreement.id} type="button"
                        onClick={() => { onSelectVersion(agreement.id); setBaselineMenuOpen(false); }}
                        className={`w-full px-3 py-3 text-left transition-colors ${isSelected ? "bg-primary/14 text-primary" : "text-on-surface-variant hover:bg-surface-high/45 hover:text-on-surface"}`}>
                        <span className="flex items-center justify-between gap-3">
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold">{agreement.supplierName} / v{agreement.versionNumber}</span>
                            <span className="mt-1 flex items-center gap-2 text-xs text-outline">
                              <StatusBadge status={agreement.status} className="text-[0.55rem]" />
                              <span>{agreement._count?.items || 0} items</span>
                            </span>
                          </span>
                          {isSelected && <Ic name="check" className="shrink-0 text-sm text-primary" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <button onClick={onStartCompare} disabled={!selectedVersionId || uploading}
              className="w-full flex items-center justify-center gap-2 text-sm font-semibold bg-primary/10 text-primary px-4 py-2.5 rounded-lg hover:bg-primary/15 transition-colors disabled:opacity-40">
              <Ic name={uploading ? "sync" : "upload_file"} className={`text-base ${uploading ? "animate-spin" : ""}`} />
              {uploading ? "Uploading" : "Upload Supplier File"}
            </button>
          </div>

          <div className="rounded-lg bg-surface-low/20 border border-outline-variant/8 p-4">
            {comparisonSource ? (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <MiniKpi label="Supplier" value={comparisonSource.supplierName} />
                <MiniKpi label="Version" value={`v${comparisonSource.versionNumber}`} />
                <MiniKpi label="Status" value={comparisonSource.status} accent={comparisonSource.status === "Active" ? "text-success" : comparisonSource.status === "Draft" ? "text-warning" : undefined} />
                <MiniKpi label="Items" value={String(comparisonSource._count?.items || comparisonSource.items?.length || 0)} />
              </div>
            ) : (
              <div className="h-full min-h-24 flex items-center justify-center text-sm text-outline">
                Select an agreement to see the comparison source.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (comparison.status === "Failed") {
    return (
      <div className="bg-surface-container/50 rounded-xl ghost-border p-6">
        <div className="flex items-center gap-2 text-error mb-2">
          <Ic name="error_outline" className="text-base" />
          <span className="text-sm font-semibold">Comparison failed</span>
        </div>
        <p className="text-xs text-outline">{comparison.error || "An unknown error occurred"}</p>
      </div>
    );
  }

  const changes = comparison.changes || [];
  const filteredChanges = changeFilter === "all" ? changes : changes.filter((c) => c.changeType === changeFilter);
  const pendingChanges = changes.filter((c) => c.reviewStatus === "Pending");
  const reviewedCount = changes.filter((c) => c.reviewStatus !== "Pending").length;

  const toggleChange = (id: string) => {
    const next = new Set(selectedChanges);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedChanges(next);
  };

  const selectAllVisible = () => {
    const visible = filteredChanges.filter((c) => c.reviewStatus === "Pending").map((c) => c.id);
    setSelectedChanges(new Set(visible));
  };

  const FILTER_LABELS: Record<string, string> = {
    all: `All (${changes.length})`,
    New: `New (${changes.filter((c) => c.changeType === "New").length})`,
    Removed: `Removed (${changes.filter((c) => c.changeType === "Removed").length})`,
    PriceChange: `Price (${changes.filter((c) => c.changeType === "PriceChange").length})`,
    FieldChange: `Fields (${changes.filter((c) => c.changeType === "FieldChange").length})`,
  };

  return (
    <div className="space-y-4">
      {/* ── Summary card ─────────────────────────────────── */}
      <div className="bg-surface-container/50 rounded-xl ghost-border p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {comparisonSource && (
              <>
                <span className="text-sm font-semibold">{comparisonSource.supplierName}</span>
                <span className="text-xs font-mono bg-surface-high/40 text-outline px-2 py-0.5 rounded">v{comparisonSource.versionNumber}</span>
                <StatusBadge status={comparisonSource.status} />
                <Ic name="compare_arrows" className="text-sm text-outline/40" />
              </>
            )}
            <span className="text-sm font-mono text-outline truncate max-w-[360px]">{comparison.sourceFileName}</span>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={comparison.status} />
            {comparison.sourceRowCount && (
              <span className="text-xs text-outline">{comparison.sourceRowCount} rows</span>
            )}
            <button onClick={onDeleteComparison}
              className="flex items-center gap-1 text-xs font-semibold bg-error/8 text-error px-2.5 py-1.5 rounded-md hover:bg-error/12 transition-colors">
              <Ic name="delete" className="text-xs" />Delete
            </button>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-6 gap-2.5 mb-3">
          <MiniKpi label="Total Changes" value={String(comparison.totalChanges)} />
          <MiniKpi label="New Items" value={String(comparison.newItems)} accent="text-success" />
          <MiniKpi label="Removed" value={String(comparison.removedItems)} accent="text-error" />
          <MiniKpi label="Price Changes" value={String(comparison.priceChanges)} accent="text-warning" />
          <MiniKpi label="Field Changes" value={String(comparison.changedItems - comparison.priceChanges)} />
          <MiniKpi
            label="Net Price Impact"
            value={comparison.totalPriceImpact != null ? `${comparison.totalPriceImpact > 0 ? "+" : ""}€${comparison.totalPriceImpact.toFixed(0)}` : "—"}
            accent={comparison.totalPriceImpact != null ? (comparison.totalPriceImpact > 0 ? "text-error" : "text-success") : undefined}
          />
        </div>

        {/* Review progress */}
        {changes.length > 0 && (
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1 bg-surface-high/20 rounded-full overflow-hidden">
              <div className="h-full bg-primary/50 rounded-full transition-all" style={{ width: `${(reviewedCount / changes.length) * 100}%` }} />
            </div>
            <span className="text-xs text-outline whitespace-nowrap">
              {reviewedCount} / {changes.length} reviewed
            </span>
          </div>
        )}
      </div>

      {/* ── Review action bar ─────────────────────────────── */}
      {pendingChanges.length > 0 && (
        <div className="flex flex-col gap-3 bg-surface-container/50 rounded-xl ghost-border px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-2 text-sm">
            <Ic name="pending_actions" className="text-sm text-outline/60" />
            <span className="text-outline">{pendingChanges.length} pending</span>
            {selectedChanges.size > 0 && (
              <span className="text-primary font-semibold">{selectedChanges.size} selected</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => { setSelectionMode((value) => !value); setSelectedChanges(new Set()); }}
              className={`flex items-center gap-1 text-sm font-semibold px-3 py-1.5 rounded-md transition-colors ${selectionMode ? "bg-primary/12 text-primary" : "bg-surface-high/30 text-on-surface-variant hover:bg-surface-high/50"}`}>
              <Ic name="select_all" className="text-xs" />Smart Select
            </button>
            {selectionMode && (
              <>
                <button onClick={selectAllVisible}
                  className="text-sm font-semibold text-primary px-3 py-1.5 rounded hover:bg-primary/10 transition-colors">
                  Select Visible
                </button>
                <button onClick={() => setSelectedChanges(new Set())}
                  className="text-sm font-semibold text-outline px-3 py-1.5 rounded hover:bg-surface-high/20 transition-colors">
                  Clear
                </button>
              </>
            )}
            <button onClick={() => onReview("auto_apply")}
              className="flex items-center gap-1 text-sm font-semibold bg-info/8 text-info px-3 py-1.5 rounded-md hover:bg-info/12 transition-colors">
              <Ic name="auto_fix_high" className="text-xs" />Auto-Apply Safe
            </button>
            {selectedChanges.size > 0 && (
              <>
                <button onClick={() => { onReview("accept", [...selectedChanges]); setSelectedChanges(new Set()); }}
                  className="flex items-center gap-1 text-sm font-semibold bg-success/8 text-success px-3 py-1.5 rounded-md hover:bg-success/12 transition-colors">
                  <Ic name="check" className="text-xs" />Accept ({selectedChanges.size})
                </button>
                <button onClick={() => { onReview("reject", [...selectedChanges]); setSelectedChanges(new Set()); }}
                  className="flex items-center gap-1 text-sm font-semibold bg-error/8 text-error px-3 py-1.5 rounded-md hover:bg-error/12 transition-colors">
                  <Ic name="close" className="text-xs" />Reject ({selectedChanges.size})
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Change type filters ───────────────────────────── */}
      <div className="flex items-center gap-1.5">
        {(["all", "New", "Removed", "PriceChange", "FieldChange"] as const).map((f) => (
          <button key={f} onClick={() => setChangeFilter(f as typeof changeFilter)}
            className={`px-3 py-1 rounded-full text-sm font-semibold transition-colors border ${changeFilter === f
              ? "bg-primary/10 text-primary border-primary/20"
              : "text-outline border-outline-variant/10 hover:text-on-surface-variant hover:border-outline-variant/20"
            }`}>
            {FILTER_LABELS[f]}
          </button>
        ))}
      </div>

      {/* ── Changes table ────────────────────────────────── */}
      <div className="bg-surface-container/50 rounded-xl ghost-border overflow-hidden">
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-outline-variant/6 bg-surface-container/95">
                <th className="px-3 py-2 w-8" />
                <th className="px-3 py-2 text-left text-xs font-semibold text-outline uppercase w-20">Type</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-outline uppercase">Key</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-outline uppercase">Description</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-outline uppercase w-24">Old Price</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-outline uppercase w-24">New Price</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-outline uppercase w-16">Δ%</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-outline uppercase">Changed Fields</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-outline uppercase w-20">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/4">
              {filteredChanges.map((c) => {
                const isSelected = selectedChanges.has(c.id);
                return (
                <Fragment key={c.id}>
                  <tr key={c.id}
                    className={`transition-colors ${isSelected ? "bg-primary/10 ring-1 ring-inset ring-primary/20" : "hover:bg-surface-high/10"} ${expandedId === c.id ? "bg-surface-high/8" : ""} ${selectionMode && c.reviewStatus === "Pending" ? "cursor-pointer" : ""}`}
                    onClick={() => {
                      if (selectionMode && c.reviewStatus === "Pending") toggleChange(c.id);
                      else if (c.changeType === "FieldChange") setExpandedId(expandedId === c.id ? null : c.id);
                    }}>
                    <td className="px-3 py-2">
                      {selectionMode && c.reviewStatus === "Pending" && (
                        <span className={`inline-block h-2.5 w-2.5 rounded-full align-middle ${isSelected ? "bg-primary shadow-[0_0_0_3px_rgba(83,255,180,0.12)]" : "bg-outline/30"}`} />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded ${CHANGE_COLORS[c.changeType] || ""}`}>
                        {c.changeType === "PriceChange" ? "Price" : c.changeType === "FieldChange" ? "Field" : c.changeType}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-sm text-primary max-w-[160px] truncate">{c.matchKey}</td>
                    <td className="px-3 py-2 text-on-surface-variant max-w-[200px] truncate" title={c.description || ""}>{c.description || "—"}</td>
                    <td className="px-3 py-2 font-mono text-right">{c.priceOld != null ? `€${c.priceOld.toFixed(2)}` : "—"}</td>
                    <td className="px-3 py-2 font-mono text-right font-medium">{c.priceNew != null ? `€${c.priceNew.toFixed(2)}` : "—"}</td>
                    <td className="px-3 py-2 font-mono text-right">
                      {c.priceDiffPct != null ? (
                        <span className={c.priceDiffPct > 0 ? "text-error font-semibold" : "text-success font-semibold"}>
                          {c.priceDiffPct > 0 ? "+" : ""}{c.priceDiffPct.toFixed(1)}%
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-outline max-w-[220px]">
                      {c.changedFields.length > 0 ? (
                        <span className="flex items-center gap-1 flex-wrap">
                          {c.changedFields.slice(0, 3).map((f) => (
                            <span key={f} className="bg-info/6 text-info/80 px-1.5 py-0.5 rounded text-xs">{f}</span>
                          ))}
                          {c.changedFields.length > 3 && <span className="text-outline">+{c.changedFields.length - 3}</span>}
                          {c.changeType === "FieldChange" && (
                            <Ic name={expandedId === c.id ? "expand_less" : "expand_more"} className="text-xs text-outline/50 cursor-pointer" />
                          )}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded ${REVIEW_COLORS[c.reviewStatus] || ""}`}>
                        {c.reviewStatus === "AutoApplied" ? "Auto" : c.reviewStatus}
                      </span>
                    </td>
                  </tr>
                  {/* Expanded field diff row */}
                  {expandedId === c.id && c.changeType === "FieldChange" && Object.keys(c.oldValues || {}).length > 0 && (
                    <tr key={`${c.id}-exp`} className="bg-surface-high/6">
                      <td colSpan={9} className="px-5 py-3">
                        <div className="space-y-1.5">
                          <p className="text-[0.6rem] font-semibold text-outline mb-2">Field-level changes</p>
                          {c.changedFields.map((field) => {
                            const oldVal = (c.oldValues || {})[field];
                            const newVal = (c.newValues || {})[field];
                            return (
                              <div key={field} className="flex items-center gap-3 text-[0.65rem]">
                                <span className="text-outline w-28 shrink-0 font-mono">{field}</span>
                                <span className="text-error/80 font-mono bg-error/6 px-2 py-0.5 rounded line-through">
                                  {oldVal != null ? String(oldVal) : "—"}
                                </span>
                                <Ic name="arrow_forward" className="text-xs text-outline/40" />
                                <span className="text-success font-mono bg-success/6 px-2 py-0.5 rounded">
                                  {newVal != null ? String(newVal) : "—"}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
                );
              })}
            </tbody>
          </table>
          {filteredChanges.length === 0 && (
            <div className="py-10 text-center">
              <p className="text-xs text-outline">No changes in this category</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   Insights Panel
   ════════════════════════════════════════════════════════════ */

const INSIGHT_TYPE_LABELS: Record<string, string> = {
  agreement_created: "Created",
  agreement_updated: "Updated",
  status_changed: "Status Change",
  comparison_complete: "Comparison",
  expiring_soon: "Expiring",
  expired: "Expired",
  stale_draft: "Stale Draft",
};

function InsightsPanel({
  insights, scanning, onDismiss, onRefresh, onScan,
}: {
  insights: AgreementInsight[];
  scanning: boolean;
  onDismiss: (id: string) => void;
  onRefresh: () => void;
  onScan: () => void;
}) {
  const active = insights.filter((i) => !i.dismissed);
  const bySeverity = {
    critical: active.filter((i) => i.severity === "critical"),
    warning: active.filter((i) => i.severity === "warning"),
    info: active.filter((i) => i.severity === "info"),
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-base font-semibold">Agreement Insights</span>
          {active.length > 0 && (
            <span className="ml-2 text-sm text-outline">{active.length} active</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onRefresh} className="text-sm text-outline hover:text-on-surface-variant transition-colors">
            Refresh
          </button>
          <button onClick={onScan} disabled={scanning}
            className="flex items-center gap-1.5 text-sm font-semibold bg-primary/8 text-primary px-3 py-2 rounded-md hover:bg-primary/12 transition-colors disabled:opacity-50">
            <Ic name={scanning ? "sync" : "search"} className={`text-base ${scanning ? "animate-spin" : ""}`} />
            {scanning ? "Scanning…" : "Run Expiry Scan"}
          </button>
        </div>
      </div>

      {active.length === 0 ? (
        <div className="bg-surface-container/50 rounded-xl ghost-border py-20 text-center space-y-3">
          <Ic name="notifications_none" className="text-3xl text-outline/30" />
          <div>
            <p className="text-base text-on-surface-variant font-medium">No active insights</p>
            <p className="text-sm text-outline mt-1">Insights appear automatically when agreements are created, compared, or approaching expiry</p>
          </div>
          <button onClick={onScan} disabled={scanning}
            className="flex items-center gap-1.5 text-sm font-semibold bg-primary/8 text-primary px-3 py-2 rounded-md hover:bg-primary/12 transition-colors disabled:opacity-50 mx-auto">
            <Ic name="search" className="text-base" />Run Expiry Scan
          </button>
        </div>
      ) : (
        <>
          {(["critical", "warning", "info"] as const).map((sev) => {
            const group = bySeverity[sev];
            if (group.length === 0) return null;
            const style = SEVERITY_STYLES[sev];
            return (
              <div key={sev} className="space-y-2">
                <div className="flex items-center gap-2">
                  <Ic name={style.icon} className={`text-base ${style.iconColor}`} />
                  <span className="text-sm font-semibold uppercase tracking-wider text-outline">
                    {sev === "critical" ? "Critical" : sev === "warning" ? "Warnings" : "Information"}
                  </span>
                  <span className="text-xs bg-surface-high/40 text-outline px-1.5 py-0.5 rounded font-mono">{group.length}</span>
                </div>
                {group.map((insight) => (
                  <div key={insight.id}
                    className={`rounded-xl ghost-border p-4 border-l-4 ${style.border} ${style.bg}`}>
                    <div className="flex items-start justify-between mb-1">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <p className="text-sm font-semibold">{insight.title}</p>
                        {INSIGHT_TYPE_LABELS[insight.type] && (
                          <span className="text-xs bg-surface-high/40 text-outline px-1.5 py-0.5 rounded shrink-0">
                            {INSIGHT_TYPE_LABELS[insight.type]}
                          </span>
                        )}
                      </div>
                      <button onClick={() => onDismiss(insight.id)}
                        className="text-outline/50 hover:text-on-surface-variant transition-colors ml-2 shrink-0 p-0.5">
                        <Ic name="close" className="text-sm" />
                      </button>
                    </div>
                    <p className="text-sm text-on-surface-variant mb-1.5">{insight.message}</p>
                    {insight.suggestion && (
                      <p className="text-sm text-outline italic">{insight.suggestion}</p>
                    )}
                    <div className="flex items-center gap-3 mt-2">
                      {insight.supplierName && (
                        <span className="text-sm text-outline flex items-center gap-1">
                          <Ic name="storefront" className="text-base" />{insight.supplierName}
                        </span>
                      )}
                      <span className="text-sm text-outline">{fmtDate(insight.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   Create Agreement Form
   ════════════════════════════════════════════════════════════ */

function CreateAgreementForm({
  onCreated, onCancel,
}: {
  onCreated: (id?: string) => void;
  onCancel: () => void;
}) {
  const [supplierId, setSupplierId] = useState("");
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [markupPercent, setMarkupPercent] = useState(15);
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/v1/suppliers?limit=200")
      .then((r) => r.json())
      .then((d) => setSuppliers((d.suppliers || d.data || []).map((s: Record<string, string>) => ({ id: s.id, name: s.name }))))
      .catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    if (!supplierSearch) return suppliers.slice(0, 20);
    const q = supplierSearch.toLowerCase();
    return suppliers.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 20);
  }, [suppliers, supplierSearch]);

  const canSubmit = Boolean(supplierId || supplierSearch.trim()) && !submitting;

  const resolveSupplierId = async () => {
    if (supplierId) return supplierId;
    const name = supplierSearch.trim();
    if (!name) return "";
    const existing = suppliers.find((supplier) => supplier.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing.id;

    const res = await fetch("/api/v1/suppliers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        region: "Unknown",
        categories: ["Trade Agreement"],
        sourceReferences: ["Agreement import"],
      }),
    });
    if (!res.ok) return "";
    const data = await res.json();
    const created = data.data as { id: string; name: string } | undefined;
    if (created?.id) {
      setSuppliers((prev) => [...prev, { id: created.id, name: created.name }]);
      setSupplierId(created.id);
      setSupplierSearch(created.name);
      return created.id;
    }
    return "";
  };

  const handleSubmit = async () => {
    if (!supplierId && !supplierSearch.trim()) return;
    setSubmitting(true);
    try {
      if (importFile) {
        const form = new FormData();
        form.append("file", importFile);
        if (supplierId) form.append("supplierId", supplierId);
        if (supplierSearch.trim()) form.append("supplierName", supplierSearch.trim());
        form.append("markupPercent", String(markupPercent));
        if (validFrom) form.append("validFrom", validFrom);
        if (validTo) form.append("validTo", validTo);
        if (notes) form.append("notes", notes);
        const res = await fetch("/api/v1/agreements/import", { method: "POST", body: form });
        if (res.ok) { const d = await res.json(); onCreated(d.version?.id); }
        else {
          const data = await res.json().catch(() => ({}));
          alert(data.error || "Agreement import failed.");
        }
      } else {
        const resolvedSupplierId = await resolveSupplierId();
        if (!resolvedSupplierId) throw new Error("Supplier could not be created.");
        const res = await fetch("/api/v1/agreements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ supplierId: resolvedSupplierId, markupPercent, validFrom: validFrom || null, validTo: validTo || null, notes: notes || null }),
        });
        if (res.ok) { const d = await res.json(); onCreated(d.version?.id); }
        else {
          const data = await res.json().catch(() => ({}));
          alert(data.error || "Agreement could not be created.");
        }
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Agreement could not be created.");
    }
    setSubmitting(false);
  };

  return (
    <div className="bg-surface-container/50 rounded-xl ghost-border p-5 mb-4">
      <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
        <Ic name="add_circle" className="text-base text-primary" />New Agreement Version
      </h3>
      <div className="grid grid-cols-2 gap-4 mb-4">
        {/* Supplier */}
        <div className="col-span-2 relative">
          <label className="text-[0.6rem] text-outline block mb-1">Supplier *</label>
          <input
            value={supplierSearch}
            onChange={(e) => { setSupplierSearch(e.target.value); setSupplierId(""); setShowDropdown(true); }}
            onFocus={() => setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
            placeholder="Search or type a new supplier name..."
            className="w-full bg-surface-high/30 border border-outline-variant/8 rounded-md px-3 py-1.5 text-xs placeholder:text-outline/30 focus:outline-none focus:ring-1 focus:ring-primary/20"
          />
          {supplierId && (
            <Ic name="check_circle" className="absolute right-3 top-[1.8rem] text-xs text-success" />
          )}
          {showDropdown && filtered.length > 0 && !supplierId && (
            <div className="absolute top-full left-0 right-0 z-20 bg-surface-container border border-outline-variant/10 rounded-md shadow-lg max-h-36 overflow-y-auto mt-0.5">
              {filtered.map((s) => (
                <button key={s.id} onMouseDown={() => { setSupplierId(s.id); setSupplierSearch(s.name); setShowDropdown(false); }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-surface-high/20 transition-colors">{s.name}</button>
              ))}
            </div>
          )}
          {!supplierId && supplierSearch.trim() && filtered.length === 0 && (
            <p className="text-xs text-primary mt-1">A supplier profile will be created for &quot;{supplierSearch.trim()}&quot;.</p>
          )}
        </div>

        {/* Markup */}
        <div>
          <label className="text-[0.6rem] text-outline block mb-1">Markup %</label>
          <input type="number" value={markupPercent} onChange={(e) => setMarkupPercent(Number(e.target.value))} min={0} max={100} step={0.5}
            className="w-full bg-surface-high/30 border border-outline-variant/8 rounded-md px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/20" />
        </div>

        {/* Notes */}
        <div>
          <label className="text-[0.6rem] text-outline block mb-1">Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes…"
            className="w-full bg-surface-high/30 border border-outline-variant/8 rounded-md px-3 py-1.5 text-xs placeholder:text-outline/30 focus:outline-none focus:ring-1 focus:ring-primary/20" />
        </div>

        {/* Dates */}
        <div>
          <label className="text-[0.6rem] text-outline block mb-1">Valid From</label>
          <input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)}
            className="w-full bg-surface-high/30 border border-outline-variant/8 rounded-md px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/20" />
        </div>
        <div>
          <label className="text-[0.6rem] text-outline block mb-1">Valid To</label>
          <input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)}
            className="w-full bg-surface-high/30 border border-outline-variant/8 rounded-md px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/20" />
        </div>

        {/* File import */}
        <div className="col-span-2">
          <label className="text-[0.6rem] text-outline block mb-1">Import items from file (optional)</label>
          <input ref={importRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
            onChange={(e) => { if (e.target.files?.[0]) setImportFile(e.target.files[0]); }} />
          <div className="flex items-center gap-2">
            <button onClick={() => importRef.current?.click()}
              className={`flex items-center gap-1.5 text-[0.65rem] font-medium px-3 py-1.5 rounded-md transition-colors ${importFile ? "bg-success/8 text-success" : "bg-surface-high/30 text-on-surface-variant hover:bg-surface-high/50"}`}>
              <Ic name={importFile ? "check_circle" : "upload_file"} className="text-xs" />
              {importFile ? importFile.name : "Choose CSV / XLSX"}
            </button>
            {importFile && (
              <button onClick={() => { setImportFile(null); if (importRef.current) importRef.current.value = ""; }}
                className="text-outline/50 hover:text-error transition-colors">
                <Ic name="close" className="text-xs" />
              </button>
            )}
          </div>
          {importFile && (
            <p className="text-[0.55rem] text-outline mt-1">
              Items will be parsed from the file and added to the agreement automatically
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 justify-end pt-1 border-t border-outline-variant/6">
        <button onClick={onCancel} className="text-[0.65rem] font-medium text-outline px-3 py-1.5 rounded-md hover:bg-surface-high/20 transition-colors">
          Cancel
        </button>
        <button onClick={handleSubmit} disabled={!canSubmit}
          className="flex items-center gap-1 text-[0.65rem] font-medium bg-primary/10 text-primary px-3.5 py-1.5 rounded-md hover:bg-primary/15 transition-colors disabled:opacity-40">
          <Ic name={importFile ? "upload" : "save"} className="text-xs" />
          {submitting
            ? importFile ? "Importing…" : "Creating…"
            : importFile ? "Import & Create" : "Create Draft"
          }
        </button>
      </div>
    </div>
  );
}
