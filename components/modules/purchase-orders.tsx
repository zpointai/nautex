"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import type { PurchaseOrderIntakeDraft } from "@/lib/purchase-orders/intake";
import type { PurchaseOrderNotification } from "@/lib/purchase-orders/notifications";
import { openNautexDocument } from "@/lib/client/desktop";
import { WorkAssignmentSelect } from "@/components/auth/work-assignment-select";
import { FleetVesselForm } from "@/components/modules/fleet-vessel-form";
import { CompanySourceReview, requestCompanySources } from "@/components/modules/company-source-review";
import { matchesFleetSelection } from "@/lib/purchase-orders/fleet-selection";
import type {
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderEvent,
  PurchaseOrderDocument,
  PurchaseOrderNote,
  PurchaseOrderSummary,
  PurchaseOrderErpCoreReadModel,
  ErpCoreAuditEvent,
  ErpCoreDocumentLink,
  ErpCoreProvenance,
  ErpCorePartyLink,
  ShippingCompany,
  ShippingCompanyVessel,
  OrderStatus,
  OrderType,
  ConfirmStatus,
  Priority,
  LineStatus,
  POEventType,
} from "@/types/erp";

/* ── Types ───────────────────────────────────────────────────── */

type SortField = "createdAt" | "eta" | "total" | "poNumber" | "status" | "priority";
type SortOrder = "asc" | "desc";
type StatusFilter = "all" | OrderStatus;
type OrderTypeFilter = "all" | OrderType;
type AssignmentFilter = "all" | "me" | "unassigned";
type WorkspaceTab = "overview" | "lines" | "delivery" | "documents" | "supply-chain" | "activity";

interface StatusCounts {
  Pending_Approval?: number;
  Procurement?: number;
  In_Transit?: number;
  Delivered?: number;
  At_Risk?: number;
}

interface POWithCount extends PurchaseOrder {
  _count?: { lines: number; childOrders: number };
}

interface RecordContextDetail {
  moduleKey?: string;
  id?: string;
  filterStatus?: OrderStatus;
  tab?: WorkspaceTab;
  label?: string;
  title?: string;
  subtitle?: string;
  module?: string;
  icon?: string;
}

interface AgentReviewResult {
  runId: string;
  risk: "High" | "Medium" | "Low";
  findings: string[];
  recommendation: string;
  humanReviewRequired: boolean;
  exceptionCreated: boolean;
}

interface InventoryReservationSummary {
  stockUnit: string | null;
  id: string;
  inventoryItemId: string;
  orderId: string;
  orderLineId: string;
  quantity: number;
  status: "Active" | "Released" | "Issued";
  referenceLabel: string | null;
}

interface ReservationCandidateSummary {
  stockPerOrderUnit?: number | null;
  id: string;
  itemCode: string | null;
  description: string;
  warehouse: string;
  locationBin: string | null;
  uom: string;
  onHand: number;
  reserved: number;
  available: number;
  stockStatus: "critical" | "reorder" | "healthy";
  matchReason: string;
}

interface ReservationLookup {
  reservation: InventoryReservationSummary | null;
  candidates: ReservationCandidateSummary[];
  recommendedQuantity: number;
}

interface GoodsReceiptSummary {
  id: string;
  receiptNumber: string | null;
  status: "draft" | "posted" | "cancelled";
  supplierDeliveryNote: string | null;
  warehouse: string | null;
  receivedAt: string;
  receivedByName: string | null;
  lines: Array<{
    id: string;
    purchaseOrderLineId: string;
    lineNumber: number;
    description: string;
    uom: string;
    quantity: number;
    inventoryMovementId: string | null;
  }>;
}

interface DeliverySummary {
  id: string;
  deliveryNumber: string | null;
  status: "draft" | "ready" | "dispatched" | "delivered" | "cancelled";
  customerName: string;
  vessel: string;
  port: string | null;
  scheduledAt: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  deliveredToName: string | null;
  lines: Array<{
    id: string;
    purchaseOrderLineId: string;
    lineNumber: number;
    description: string;
    uom: string;
    quantity: number;
    inventoryReservationId: string | null;
    inventoryMovementId: string | null;
  }>;
}

type ShippingCompanyDraft = Pick<
  ShippingCompany,
  "name" | "legalName" | "address" | "postalCode" | "city" | "country" | "contactName" | "email" | "phone" | "vatId" | "companyNumber" | "paymentTerms" | "invoiceEmail" | "notes" | "website"
>;

function hasBlockingIntakeWarning(draft: PurchaseOrderIntakeDraft | null) {
  return !!draft?.warnings.some((warning) => /line item sequence has gaps|ocr\/visual review required|pdf text layer may be incomplete/i.test(warning));
}

function parseNumericInput(value: string, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/* ── Props ───────────────────────────────────────────────────── */

interface PurchaseOrdersModuleProps {
  onNavigate?: (module: string) => void;
}

/* ── Icons ───────────────────────────────────────────────────── */

function Ic({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span
      className={`material-symbols-outlined ${className}`}
      style={{ fontVariationSettings: "'FILL' 0, 'wght' 300, 'opsz' 20" }}
    >
      {name}
    </span>
  );
}

/* ── Constants ───────────────────────────────────────────────── */

const STATUS_LABELS: Record<OrderStatus, string> = {
  Pending_Approval: "Pending Approval",
  Procurement: "Procurement",
  In_Transit: "In Transit",
  Delivered: "Delivered",
  At_Risk: "At Risk",
};

const STATUS_STYLES: Record<OrderStatus, string> = {
  Pending_Approval: "bg-warning/10 text-warning",
  Procurement: "bg-primary/10 text-primary",
  In_Transit: "bg-primary/10 text-primary",
  Delivered: "bg-success/10 text-success",
  At_Risk: "bg-error/10 text-error",
};

const CONFIRM_LABELS: Record<ConfirmStatus, string> = {
  Unconfirmed: "Unconfirmed",
  Partially_Confirmed: "Partial",
  Confirmed: "Confirmed",
  Rejected: "Rejected",
};

const CONFIRM_STYLES: Record<ConfirmStatus, string> = {
  Unconfirmed: "bg-surface-high/40 text-outline",
  Partially_Confirmed: "bg-warning/10 text-warning",
  Confirmed: "bg-success/10 text-success",
  Rejected: "bg-error/10 text-error",
};

const LINE_STATUS_LABELS: Record<LineStatus, string> = {
  Open: "Open",
  Confirmed: "Confirmed",
  Partially_Delivered: "Partial Delivery",
  Delivered: "Delivered",
  Backordered: "Backordered",
  Cancelled: "Cancelled",
};

const LINE_STATUS_STYLES: Record<LineStatus, string> = {
  Open: "bg-surface-high/40 text-on-surface-variant",
  Confirmed: "bg-primary/10 text-primary",
  Partially_Delivered: "bg-warning/10 text-warning",
  Delivered: "bg-success/10 text-success",
  Backordered: "bg-error/10 text-error",
  Cancelled: "bg-surface-high/30 text-outline",
};

const ALL_LINE_STATUSES: LineStatus[] = ["Open", "Confirmed", "Partially_Delivered", "Delivered", "Backordered", "Cancelled"];

const DOCUMENT_CATEGORY_LABELS: Record<string, string> = {
  incoming_customer_po: "Incoming Customer PO",
  supplier_confirmation: "Supplier Confirmation",
  delivery_evidence: "Delivery Evidence",
  supplier_invoice: "Supplier Invoice",
  customer_communication: "Customer Communication",
  other: "Other",
};

function effectiveLineStatus(line: PurchaseOrderLine): LineStatus {
  if (line.status === "Cancelled") return "Cancelled";
  if (line.qtyOrdered > 0 && line.qtyDelivered >= line.qtyOrdered) return "Delivered";
  if (line.qtyDelivered > 0) return "Partially_Delivered";
  if (line.qtyConfirmed != null && line.qtyOrdered > 0 && line.qtyConfirmed >= line.qtyOrdered && line.status === "Open") return "Confirmed";
  return line.status;
}

const PRIORITY_STYLES: Record<Priority, string> = {
  High: "bg-error/8 text-error",
  Normal: "bg-surface-high/40 text-on-surface-variant",
  Low: "bg-surface-high/30 text-outline",
};

const EVENT_ICONS: Record<POEventType, string> = {
  created: "add_circle",
  status_changed: "swap_horiz",
  eta_updated: "edit_calendar",
  note_added: "comment",
  note_edited: "edit_note",
  note_deleted: "delete",
  exception_flagged: "flag",
  confirmation_requested: "mail",
  line_updated: "edit",
  approval: "check_circle",
  document_attached: "attach_file",
  document_deleted: "delete",
  delivery_updated: "local_shipping",
  margin_updated: "percent",
  sub_po_created: "account_tree",
  order_confirmed: "task_alt",
  supplier_pos_generated: "account_tree",
  lines_forwarded: "forward",
  shipserv_sync: "sync",
};

const EVENT_COLORS: Record<POEventType, string> = {
  created: "text-primary bg-primary/8",
  status_changed: "text-warning bg-warning/8",
  eta_updated: "text-primary bg-primary/8",
  note_added: "text-on-surface-variant bg-surface-high/40",
  note_edited: "text-on-surface-variant bg-surface-high/40",
  note_deleted: "text-warning bg-warning/8",
  exception_flagged: "text-error bg-error/8",
  confirmation_requested: "text-primary bg-primary/8",
  line_updated: "text-on-surface-variant bg-surface-high/40",
  approval: "text-success bg-success/8",
  document_attached: "text-on-surface-variant bg-surface-high/40",
  document_deleted: "text-warning bg-warning/8",
  delivery_updated: "text-primary bg-primary/8",
  margin_updated: "text-warning bg-warning/8",
  sub_po_created: "text-primary bg-primary/8",
  order_confirmed: "text-success bg-success/8",
  supplier_pos_generated: "text-primary bg-primary/8",
  lines_forwarded: "text-on-surface-variant bg-surface-high/40",
  shipserv_sync: "text-primary bg-primary/8",
};

/* ── Helpers ─────────────────────────────────────────────────── */

function fmt(value: number, currency: string) {
  return new Intl.NumberFormat("en-EU", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
}

function fmtDate(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtBytes(size: number | null | undefined) {
  if (size == null || !Number.isFinite(size)) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatCodeLabel(value: string | null | undefined) {
  if (!value) return "-";
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function shortHash(value: string | null | undefined) {
  if (!value) return "-";
  return value.length > 14 ? `${value.slice(0, 12)}...` : value;
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function formatAuditValue(value: unknown) {
  if (value == null) return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "[object]";
}

function formatAuditChange(event: ErpCoreAuditEvent) {
  const before = jsonRecord(event.before);
  const after = jsonRecord(event.after);
  if (!before && !after) return null;

  const keys = Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]))
    .filter((key) => formatAuditValue(before?.[key]) !== formatAuditValue(after?.[key]))
    .slice(0, 2);

  if (keys.length === 0) return null;
  return keys.map((key) => `${formatCodeLabel(key)}: ${formatAuditValue(before?.[key])} -> ${formatAuditValue(after?.[key])}`).join("; ");
}

function formatAuditActor(event: ErpCoreAuditEvent) {
  return event.actorName || formatCodeLabel(event.actorType);
}

function coreDocumentTitle(link: ErpCoreDocumentLink) {
  const document = link.document;
  return document.title || document.originalFileName || document.fileName || document.documentNo || "Untitled document";
}

function metadataText(metadata: unknown, key: string) {
  const value = jsonRecord(metadata)?.[key];
  if (value == null) return null;
  if (typeof value === "string") return value || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function provenanceBadgeClass(provenance: ErpCoreProvenance | null | undefined) {
  switch (provenance?.kind) {
    case "Operational":
    case "Imported":
      return "bg-success/8 text-success";
    case "Demo":
    case "Seed":
    case "Screenshot":
      return "bg-warning/8 text-warning";
    case "System":
      return "bg-primary/8 text-primary";
    default:
      return "bg-surface-high/35 text-on-surface-variant";
  }
}

function partyRolesLabel(link: ErpCorePartyLink) {
  const roles = link.party?.roles ?? [];
  if (roles.length === 0) return "-";
  return roles
    .filter((role) => role.isPrimary)
    .concat(roles.filter((role) => !role.isPrimary))
    .slice(0, 2)
    .map((role) => formatCodeLabel(role.role))
    .join(", ");
}

function toInputDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toISOString().split("T")[0];
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

function isOverdue(iso: string | null): boolean {
  if (!iso) return false;
  return new Date(iso).getTime() < Date.now();
}

/* ══════════════════════════════════════════════════════════════
   MAIN MODULE
   ══════════════════════════════════════════════════════════════ */

export function PurchaseOrdersModule({ onNavigate }: PurchaseOrdersModuleProps = {}) {
  const [orders, setOrders] = useState<POWithCount[]>([]);
  const [notifications, setNotifications] = useState<PurchaseOrderNotification[]>([]);
  const [companyProfiles, setCompanyProfiles] = useState<Record<string, ShippingCompany>>({});
  const [counts, setCounts] = useState<StatusCounts>({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [orderTypeFilter, setOrderTypeFilter] = useState<OrderTypeFilter>("all");
  const [assignmentFilter, setAssignmentFilter] = useState<AssignmentFilter>("all");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [vesselFilter, setVesselFilter] = useState("all");
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("overview");
  const [showCreate, setShowCreate] = useState(false);
  const [createDraft, setCreateDraft] = useState<PurchaseOrderIntakeDraft | null>(null);
  const [companyModal, setCompanyModal] = useState<string | null>(null);
  const [fleetEditor, setFleetEditor] = useState<{ company: ShippingCompany; vessel?: ShippingCompanyVessel } | null>(null);
  const [canManageFleet, setCanManageFleet] = useState(false);
  const [orderModalId, setOrderModalId] = useState<string | null>(null);
  const [orderModalStack, setOrderModalStack] = useState<string[]>([]);
  const [companySearch, setCompanySearch] = useState("");
  const [vesselSearch, setVesselSearch] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const detailRequestRef = useRef(0);

  /* ── List fetch ──────────────────────────────────────────────── */

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      p.set("sort", sortField);
      p.set("order", sortOrder);
      p.set("limit", "200");
      if (assignmentFilter !== "all") p.set("assignedTo", assignmentFilter);

      const res = await fetch(`/api/v1/purchase-orders?${p}`);
      if (!res.ok) throw new Error("Failed to load purchase orders");
      const json = await res.json();
      setOrders(json.data ?? []);
      setCounts(json.counts ?? {});
      setTotal(json.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [sortField, sortOrder, assignmentFilter]);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/purchase-orders/notifications?limit=8");
      const json = await res.json();
      if (res.ok && json.ok) setNotifications(json.data ?? []);
    } catch { /* non-blocking */ }
  }, []);

  useEffect(() => { fetchOrders(); fetchNotifications(); }, [fetchOrders, fetchNotifications]);

  useEffect(() => {
    const controller = new AbortController();
    async function fetchProfiles() {
      try {
        const res = await fetch("/api/v1/shipping-companies", { signal: controller.signal });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error("Could not load shipping companies and fleet.");
        const next: Record<string, ShippingCompany> = {};
        for (const profile of json.data ?? []) next[profile.name] = profile;
        setCompanyProfiles(next);
      } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Could not load fleet."); }
    }
    void fetchProfiles();
    return () => controller.abort();
  }, [orders]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/auth/context", { signal: controller.signal }).then(r => r.json()).then(payload => {
      const permissions: string[] = payload.data?.permissions ?? [];
      setCanManageFleet(payload.ok && (permissions.includes("*") || permissions.includes("suppliers.write")));
    }).catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  /* ── Detail fetch ────────────────────────────────────────────── */

  const fetchDetail = useCallback(async (id: string) => {
    const requestId = ++detailRequestRef.current;
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/v1/purchase-orders/${id}`);
      if (!res.ok) throw new Error("Failed");
      const json = await res.json();
      if (requestId === detailRequestRef.current) setSelectedPO(json.data);
    } catch {
      if (requestId === detailRequestRef.current) setSelectedPO(null);
    } finally {
      if (requestId === detailRequestRef.current) setDetailLoading(false);
    }
  }, []);

  const openOrder = useCallback((id: string, options?: { syncHierarchy?: boolean }) => {
    if (options?.syncHierarchy) {
      const order = orders.find((po) => po.id === id);
      if (order) {
        setCompanyFilter(order.buyerName || order.vesselOwner || "Unassigned shipping company");
        setVesselFilter(order.vessel);
      }
    }
    setSelectedId(id);
    setActiveTab("overview");
    fetchDetail(id);
  }, [fetchDetail, orders]);

  function selectOrder(id: string) {
    if (selectedId === id) {
      detailRequestRef.current += 1;
      setSelectedId(null);
      setSelectedPO(null);
      setDetailLoading(false);
    } else {
      openOrder(id);
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return;

    const openFromHash = () => {
      const hash = window.location.hash.replace(/^#/, "");
      const [moduleKey, ...parts] = hash.split(":");
      const id = parts.join(":");
      if (moduleKey === "purchaseOrders" && id.startsWith("status:")) {
        const status = decodeURIComponent(id.replace(/^status:/, "")) as OrderStatus;
        setStatusFilter(status);
        setOrderTypeFilter("all");
        setCompanyFilter("all");
        setVesselFilter("all");
        setSearch("");
        setSearchInput("");
        setOrderModalId(null);
        setSelectedId(null);
        setSelectedPO(null);
      } else if (moduleKey === "purchaseOrders" && id) {
        const decoded = decodeURIComponent(id);
        setOrderModalId(decoded);
        openOrder(decoded, { syncHierarchy: true });
      } else {
        setOrderModalId(null);
      }
    };

    const handleRecordContext = (event: Event) => {
      const detail = (event as CustomEvent<RecordContextDetail>).detail;
      if (detail?.moduleKey === "purchaseOrders" && detail.filterStatus) {
        setStatusFilter(detail.filterStatus);
        setOrderTypeFilter("all");
        setCompanyFilter("all");
        setVesselFilter("all");
        setSearch("");
        setSearchInput("");
        setOrderModalId(null);
        setSelectedId(null);
        setSelectedPO(null);
      } else if (detail?.moduleKey === "purchaseOrders" && detail.id) {
        setOrderModalId(detail.id);
        openOrder(detail.id, { syncHierarchy: true });
        if (detail.tab) setActiveTab(detail.tab);
      }
    };

    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    window.addEventListener("nautex:record-context", handleRecordContext);
    return () => {
      window.removeEventListener("hashchange", openFromHash);
      window.removeEventListener("nautex:record-context", handleRecordContext);
    };
  }, [openOrder]);

  const refreshAll = useCallback(() => {
    if (selectedId) fetchDetail(selectedId);
    fetchOrders();
    fetchNotifications();
  }, [selectedId, fetchDetail, fetchOrders, fetchNotifications]);

  /* ── Derived ────────────────────────────────────────────────── */

  const customerOrders = useMemo(() => orders.filter((po) => po.orderType !== "SubPO"), [orders]);
  const supplierFulfillmentOrders = useMemo(() => orders.filter((po) => po.orderType === "SubPO"), [orders]);
  const customerStatusCounts = useMemo(() => {
    return customerOrders.reduce<Record<OrderStatus, number>>((acc, po) => {
      acc[po.status] = (acc[po.status] ?? 0) + 1;
      return acc;
    }, { Pending_Approval: 0, Procurement: 0, In_Transit: 0, Delivered: 0, At_Risk: 0 });
  }, [customerOrders]);
  const customerTotal = customerOrders.length;
  const totalAll = customerTotal;
  const visibleOrderTotal = orderTypeFilter === "SubPO" ? supplierFulfillmentOrders.length : customerTotal;
  const orderListTitle = orderTypeFilter === "SubPO" ? "Supplier Fulfillment Purchase Orders" : orderTypeFilter === "BuyerPO" ? "Inbound Customer Purchase Orders" : orderTypeFilter === "DirectPO" ? "Direct Supplier Purchase Orders" : "Customer Purchase Orders";
  const atRiskCount = customerStatusCounts.At_Risk ?? 0;
  const pendingCount = customerStatusCounts.Pending_Approval ?? 0;
  const inTransitCount = customerStatusCounts.In_Transit ?? 0;
  const hasFilters = search !== "" || statusFilter !== "all" || orderTypeFilter !== "all" || assignmentFilter !== "all" || companyFilter !== "all" || vesselFilter !== "all";

  const companyGroups = useMemo(() => {
    const map = new Map<string, { company: string; vessels: Map<string, POWithCount[]>; total: number; atRisk: number; value: number }>();
    for (const profile of Object.values(companyProfiles)) {
      map.set(profile.name, { company: profile.name, vessels: new Map((profile.fleetVessels ?? []).map(v => [v.name, []])), total: 0, atRisk: 0, value: 0 });
    }
    customerOrders.forEach((po) => {
      const company = po.buyerName || po.vesselOwner || "Unassigned shipping company";
      if (!map.has(company)) map.set(company, { company, vessels: new Map(), total: 0, atRisk: 0, value: 0 });
      const group = map.get(company)!;
      const registered = companyProfiles[company]?.fleetVessels?.find(v => (v.imo && v.imo === po.vesselImo) || v.name.toLocaleLowerCase("en-US") === po.vessel.toLocaleLowerCase("en-US"));
      const vesselName = registered?.name ?? po.vessel;
      group.total += 1;
      group.value += po.total;
      if (po.status === "At_Risk") group.atRisk += 1;
      if (!group.vessels.has(vesselName)) group.vessels.set(vesselName, []);
      group.vessels.get(vesselName)!.push(po);
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total || a.company.localeCompare(b.company));
  }, [customerOrders, companyProfiles]);

  const companyVessels = useMemo(() => {
    if (companyFilter === "all") return new Map<string, POWithCount[]>();
    return companyGroups.find((group) => group.company === companyFilter)?.vessels ?? new Map<string, POWithCount[]>();
  }, [companyFilter, companyGroups]);

  const filteredCompanyGroups = useMemo(() => {
    const q = companySearch.trim().toLowerCase();
    if (!q) return companyGroups;
    return companyGroups.filter((group) => group.company.toLowerCase().includes(q));
  }, [companyGroups, companySearch]);

  const filteredCompanyVessels = useMemo(() => {
    const q = vesselSearch.trim().toLowerCase();
    return Array.from(companyVessels.entries())
      .filter(([vessel, vesselOrders]) => {
        if (!q) return true;
        const registered = companyProfiles[companyFilter]?.fleetVessels?.find(v => v.name === vessel);
        return vessel.toLowerCase().includes(q) || registered?.imo?.includes(q) || registered?.mmsi?.includes(q) || vesselOrders.some((po) => po.vesselImo?.toLowerCase().includes(q));
      })
      .sort(([, a], [, b]) => {
        const riskDelta = b.filter((po) => po.status === "At_Risk").length - a.filter((po) => po.status === "At_Risk").length;
        if (riskDelta !== 0) return riskDelta;
        return b.length - a.length;
      });
  }, [companyVessels, vesselSearch, companyProfiles, companyFilter]);

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((po) => {
      const company = po.buyerName || po.vesselOwner || "Unassigned shipping company";
      if (statusFilter !== "all" && po.status !== statusFilter) return false;
      if (orderTypeFilter === "all" && po.orderType === "SubPO") return false;
      if (orderTypeFilter !== "all" && po.orderType !== orderTypeFilter) return false;
      if (companyFilter !== "all" && company !== companyFilter) return false;
      if (!matchesFleetSelection(po, vesselFilter, companyProfiles[companyFilter]?.fleetVessels?.find(v => v.name === vesselFilter))) return false;
      if (!q) return true;
      return [
        po.poNumber, po.vessel, po.vesselImo, po.vesselOwner, po.buyerName,
        po.buyerRef, po.supplier, po.supplierRef, po.port,
      ].some((value) => value?.toLowerCase().includes(q));
    });
  }, [orders, search, statusFilter, orderTypeFilter, companyFilter, vesselFilter, companyProfiles]);

  function clearFilters() {
    setSearchInput("");
    setSearch("");
    setStatusFilter("all");
    setOrderTypeFilter("all");
    setAssignmentFilter("all");
    setCompanyFilter("all");
    setVesselFilter("all");
    setCompanySearch("");
    setVesselSearch("");
  }

  function selectCompany(company: string) {
    setCompanyFilter(companyFilter === company ? "all" : company);
    setVesselFilter("all");
    setVesselSearch("");
    setStatusFilter("all");
    setOrderTypeFilter("all");
  }

  function selectVessel(vessel: string, vesselOrders?: POWithCount[]) {
    if (vesselOrders?.length === 1) {
      setVesselFilter(vessel);
      setStatusFilter("all");
      setOrderTypeFilter("all");
      openOrderModal(vesselOrders[0].id);
      return;
    }
    setVesselFilter(vesselFilter === vessel ? "all" : vessel);
    setStatusFilter("all");
    setOrderTypeFilter("all");
  }

  function applyKpiFilter(status: StatusFilter) {
    setSearchInput("");
    setSearch("");
    setCompanyFilter("all");
    setVesselFilter("all");
    setCompanySearch("");
    setVesselSearch("");
    setOrderTypeFilter("all");
    setStatusFilter(status);
  }

  function openOrderModal(id: string, options?: { pushCurrent?: boolean }) {
    if (options?.pushCurrent && orderModalId && orderModalId !== id) {
      setOrderModalStack((stack) => [...stack, orderModalId]);
    }
    setOrderModalId(id);
    openOrder(id);
    if (typeof window !== "undefined") {
      window.history.pushState(null, "", `#purchaseOrders:${encodeURIComponent(id)}`);
    }
  }

  const closeOrderModal = useCallback(() => {
    const previousId = orderModalStack[orderModalStack.length - 1];
    if (previousId) {
      setOrderModalStack((stack) => stack.slice(0, -1));
      setOrderModalId(previousId);
      openOrder(previousId);
      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", `#purchaseOrders:${encodeURIComponent(previousId)}`);
      }
      return;
    }
    const parentId = selectedPO?.orderType === "SubPO" ? selectedPO.parentOrder?.id || selectedPO.parentOrderId : null;
    if (parentId) {
      setOrderModalId(parentId);
      openOrder(parentId);
      setActiveTab("supply-chain");
      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", `#purchaseOrders:${encodeURIComponent(parentId)}`);
      }
      return;
    }
    setOrderModalId(null);
    setOrderModalStack([]);
    if (typeof window !== "undefined" && window.location.hash.startsWith("#purchaseOrders:")) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [openOrder, orderModalStack, selectedPO]);

  async function saveCompanyProfile(previousName: string, draft: ShippingCompanyDraft) {
    const res = await fetch("/api/v1/shipping-companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...draft, previousName, createOnly: !previousName }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error?.message || "Failed to save shipping company.");
    const saved = json.data as ShippingCompany;
    setCompanyProfiles((prev) => {
      const next: Record<string, ShippingCompany> = { ...prev, [saved.name]: saved };
      if (previousName !== saved.name) delete next[previousName];
      return next;
    });
    if (!previousName || companyFilter === previousName) setCompanyFilter(saved.name);
    setCompanySearch("");
    setCompanyModal(saved.name);
    await fetchOrders();
    await fetchNotifications();
    return saved;
  }

  async function deleteShippingCompany(companyName: string) {
    const res = await fetch(`/api/v1/shipping-companies?name=${encodeURIComponent(companyName)}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error?.message || "Failed to delete shipping company.");
    setCompanyModal(null);
    setCompanyProfiles((prev) => {
      const next = { ...prev };
      delete next[companyName];
      return next;
    });
    clearFilters();
    await fetchOrders();
    await fetchNotifications();
  }

  async function handlePOUpload(file: File | null) {
    if (!file) return;
    setUploadBusy(true);
    setUploadError(null);
    try {
      const payload = new FormData();
      payload.append("file", file);
      const res = await fetch("/api/v1/purchase-orders/process-upload", {
        method: "POST",
        body: payload,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error?.message || "Failed to process purchase order upload.");
      }
      setCreateDraft(json.data);
      setShowCreate(true);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Failed to process purchase order upload.");
    } finally {
      setUploadBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleSort(field: SortField) {
    if (sortField === field) setSortOrder(o => o === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortOrder("desc"); }
  }

  /* ── Render ──────────────────────────────────────────────────── */

  if (showCreate) {
    return (
      <CreatePOForm
        initialDraft={createDraft}
        shippingCompanies={Object.values(companyProfiles)}
        onCancel={() => {
          setCreateDraft(null);
          setShowCreate(false);
        }}
        onCreated={(po) => {
          setCreateDraft(null);
          setShowCreate(false);
          fetchOrders();
          openOrderModal(po.id);
        }}
      />
    );
  }

  return (
    <div className="space-y-5 animate-fade-up">
      {fleetEditor && <FleetVesselForm companyName={fleetEditor.company.name} shippingCompanyId={fleetEditor.company.id} vessel={fleetEditor.vessel} onClose={() => setFleetEditor(null)} onSaved={vessel => {
        setCompanyProfiles(previous => { const company = previous[fleetEditor.company.name]; return { ...previous, [company.name]: { ...company, fleetVessels: [...(company.fleetVessels ?? []).filter(v => v.id !== vessel.id), vessel] } }; });
        setVesselSearch(""); setFleetEditor(null);
      }} />}
      {companyModal !== null && (
        <ShippingCompanyModal
          companyName={companyModal}
          profile={companyProfiles[companyModal] ?? null}
          orders={customerOrders.filter((po) => (po.buyerName || po.vesselOwner || "Unassigned shipping company") === companyModal)}
          onClose={() => setCompanyModal(null)}
          onOpenOrder={(id) => {
            setCompanyModal(null);
            openOrderModal(id);
          }}
          onSave={saveCompanyProfile}
          onSourceUpdated={saved => setCompanyProfiles(previous => ({ ...previous, [saved.name]: saved }))}
          canEdit={canManageFleet}
          onDelete={canManageFleet && companyModal ? deleteShippingCompany : undefined}
        />
      )}
      {orderModalId && selectedPO && selectedPO.id === orderModalId && (
        <PurchaseOrderDetailModal
          po={selectedPO}
          tab={activeTab}
          onTabChange={setActiveTab}
          onClose={closeOrderModal}
          onOpenOrder={(id) => openOrderModal(id, { pushCurrent: true })}
          onRefresh={refreshAll}
          onNavigate={onNavigate}
        />
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard label="Total Orders" value={totalAll} icon="receipt_long" tone="neutral" active={statusFilter === "all" && orderTypeFilter === "all" && companyFilter === "all" && vesselFilter === "all"} onClick={() => applyKpiFilter("all")} />
        <SummaryCard label="At Risk" value={atRiskCount} icon="error" tone={atRiskCount > 0 ? "danger" : "neutral"} active={statusFilter === "At_Risk"} onClick={() => applyKpiFilter(statusFilter === "At_Risk" ? "all" : "At_Risk")} />
        <SummaryCard label="Pending Approval" value={pendingCount} icon="hourglass_top" tone={pendingCount > 0 ? "warn" : "neutral"} active={statusFilter === "Pending_Approval"} onClick={() => applyKpiFilter(statusFilter === "Pending_Approval" ? "all" : "Pending_Approval")} />
        <SummaryCard label="In Transit" value={inTransitCount} icon="local_shipping" tone="neutral" active={statusFilter === "In_Transit"} onClick={() => applyKpiFilter(statusFilter === "In_Transit" ? "all" : "In_Transit")} />
      </div>

      {notifications.length > 0 && (
        <section className="rounded-xl border border-warning/15 bg-warning/5 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Ic name="notifications_active" className="text-base text-warning" />
              <h3 className="text-sm font-semibold text-on-surface">Purchase order intake notifications</h3>
              <Badge className="bg-warning/10 text-warning">{notifications.length}</Badge>
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {notifications.slice(0, 6).map((item) => (
              <button key={item.id} onClick={() => openOrderModal(item.orderId)}
                className="rounded-lg border border-outline-variant/8 bg-surface-low/25 px-3 py-2.5 text-left transition-colors hover:border-primary/20 hover:bg-primary/6">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-on-surface">{item.title}</p>
                    <p className="mt-1 line-clamp-2 text-[0.65rem] text-outline">{item.detail}</p>
                  </div>
                  <Ic name={item.type === "supplier_po_ready" ? "local_shipping" : "assignment_turned_in"} className={`text-sm ${item.severity === "warning" ? "text-warning" : "text-primary"}`} />
                </div>
                {item.salesOrderNo && <p className="mt-2 text-[0.6rem] font-mono text-primary">{item.salesOrderNo}</p>}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Maritime account -> fleet -> vessel drilldown */}
      <section className="bg-surface-container/45 rounded-xl ghost-border overflow-hidden">
        <div className="px-5 py-4 border-b border-outline-variant/6 flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Ic name="account_tree" className="text-base text-primary" />
              <h3 className="text-sm font-semibold">Shipping Companies & Fleet</h3>
            </div>
            <p className="text-[0.65rem] text-outline mt-1">Drill down by customer, vessel, and then purchase orders.</p>
          </div>
          <div className="flex items-center gap-3">
          {canManageFleet && <button onClick={() => setCompanyModal("")} className="rounded-md bg-primary/12 px-4 py-2.5 text-sm font-semibold text-primary"><Ic name="add" className="mr-1 text-lg align-middle" />Add Shipping Company</button>}
          {hasFilters && (
            <button onClick={clearFilters} className="px-3 py-1.5 text-[0.65rem] font-semibold rounded-md bg-surface-high/30 text-on-surface-variant hover:bg-surface-high/50 transition-colors">
              Clear filters
            </button>
          )}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(380px,0.36fr)_minmax(0,0.64fr)] 2xl:grid-cols-[minmax(430px,0.34fr)_minmax(0,0.66fr)] divide-y xl:divide-y-0 xl:divide-x divide-outline-variant/6">
          <div className="p-4">
            <div className="relative mb-3">
              <Ic name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-base text-outline/40" />
              <input
                value={companySearch}
                onChange={(event) => setCompanySearch(event.target.value)}
                placeholder="Search shipping companies..."
                className="w-full rounded-lg border border-outline-variant/8 bg-surface-high/25 py-2 pl-9 pr-3 text-xs text-on-surface placeholder:text-outline/35 focus:border-primary/15 focus:outline-none focus:ring-1 focus:ring-primary/20"
              />
            </div>
            <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
            {filteredCompanyGroups.map((group) => (
              <div key={group.company}
                className={`rounded-lg border px-3 py-2.5 transition-colors ${companyFilter === group.company ? "border-primary/30 bg-primary/8" : "border-outline-variant/6 bg-surface-low/20 hover:bg-surface-high/20"}`}>
                <div className="flex items-center justify-between gap-3">
                  <button onClick={() => selectCompany(group.company)} className="min-w-0 text-left flex-1">
                    <p className="text-xs font-semibold text-on-surface truncate">{group.company}</p>
                    <p className="text-[0.6rem] text-outline mt-0.5">{group.vessels.size} vessel{group.vessels.size !== 1 ? "s" : ""} / {group.total} order{group.total !== 1 ? "s" : ""}</p>
                    {companyProfiles[group.company]?.contactName && <p className="text-[0.55rem] text-primary/80 mt-1">{companyProfiles[group.company].contactName}</p>}
                  </button>
                  <div className="text-right shrink-0">
                    <p className="text-[0.65rem] font-mono text-on-surface-variant">{fmt(group.value, "EUR")}</p>
                    {group.atRisk > 0 && <p className="text-[0.55rem] text-error mt-0.5">{group.atRisk} at risk</p>}
                    <button onClick={() => setCompanyModal(group.company)} className="mt-1 text-[0.55rem] font-semibold text-primary hover:text-primary/80">
                      Details
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {filteredCompanyGroups.length === 0 && (
              <div className="rounded-lg border border-dashed border-outline-variant/10 px-3 py-8 text-center text-xs text-outline">
                {companySearch ? "No shipping companies match this search." : "No shipping companies yet. Add a shipping company to register its fleet before the first order."}
              </div>
            )}
            </div>
          </div>

          <div className="p-4">
            {companyFilter === "all" ? (
              <div className="h-full min-h-32 rounded-lg border border-dashed border-outline-variant/10 bg-surface-low/10 flex items-center justify-center text-center px-6">
                <div>
                  <Ic name="directions_boat" className="text-xl text-outline/70" />
                  <p className="mt-2 text-xs font-medium text-on-surface-variant">Select a shipping company to see its fleet.</p>
                  <p className="mt-1 text-[0.65rem] text-outline">This keeps vessel-specific orders, supplier confirmations, and delivery risks in one operational context.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-col gap-3 border-b border-outline-variant/6 pb-3 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-on-surface">{companyFilter}</p>
                    <p className="mt-1 text-[0.65rem] text-outline">
                      {companyVessels.size} vessels / {companyGroups.find((group) => group.company === companyFilter)?.total ?? 0} customer purchase orders
                    </p>
                    {canManageFleet && (companyProfiles[companyFilter]
                      ? <button onClick={() => setFleetEditor({ company: companyProfiles[companyFilter] })} className="mt-2 rounded-md bg-primary/12 px-4 py-2.5 text-sm font-semibold text-primary">Add vessel</button>
                      : <button onClick={() => setCompanyModal(companyFilter)} className="mt-2 rounded-md bg-primary/12 px-4 py-2.5 text-sm font-semibold text-primary">Save company profile to add vessels</button>)}
                  </div>
                  <div className="relative w-full lg:w-80">
                    <Ic name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-base text-outline/40" />
                    <input
                      value={vesselSearch}
                      onChange={(event) => setVesselSearch(event.target.value)}
                      placeholder="Search vessel or IMO..."
                      className="w-full rounded-lg border border-outline-variant/8 bg-surface-high/25 py-2 pl-9 pr-3 text-xs text-on-surface placeholder:text-outline/35 focus:border-primary/15 focus:outline-none focus:ring-1 focus:ring-primary/20"
                    />
                  </div>
                </div>
                <div className="max-h-[360px] overflow-y-auto rounded-lg border border-outline-variant/6">
                  <table className="w-full table-fixed text-left text-xs">
                    <thead className="sticky top-0 z-10 bg-surface-container text-[0.58rem] uppercase tracking-wider text-outline">
                      <tr>
                        <th className="w-[34%] px-3 py-2">Vessel</th>
                        <th className="w-[12%] px-3 py-2">Orders</th>
                        <th className="w-[20%] px-3 py-2">Next ETA</th>
                        <th className="w-[20%] px-3 py-2">Value</th>
                        <th className="w-[14%] px-3 py-2 text-right">Risk</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant/4">
                {filteredCompanyVessels.map(([vessel, vesselOrders]) => {
                  const registered = companyProfiles[companyFilter]?.fleetVessels?.find(v => v.name === vessel);
                  const riskCount = vesselOrders.filter((po) => po.status === "At_Risk").length;
                  const nextEta = [...vesselOrders].sort((a, b) => new Date(a.eta).getTime() - new Date(b.eta).getTime())[0]?.eta;
                  const value = vesselOrders.reduce((sum, po) => sum + po.total, 0);
                  return (
                    <tr key={vessel} onClick={() => selectVessel(vessel, vesselOrders)}
                      className={`cursor-pointer border-l-2 transition-colors ${
                        riskCount > 0
                          ? vesselFilter === vessel
                            ? "border-l-error bg-error/12"
                            : "border-l-error/70 bg-error/6 hover:bg-error/10"
                          : vesselFilter === vessel
                            ? "border-l-primary bg-primary/8"
                            : "border-l-transparent hover:bg-surface-high/15"
                      }`}>
                      <td className="px-3 py-2.5">
                        <p className="truncate font-semibold text-on-surface" title={vessel}>{vessel}</p>
                        <p className="mt-0.5 text-[0.58rem] text-outline">{registered?.imo || vesselOrders[0]?.vesselImo ? `IMO ${registered?.imo || vesselOrders[0]?.vesselImo}` : "IMO not captured"}</p>
                        {registered?.mmsi && <p className="text-xs text-outline">MMSI {registered.mmsi}</p>}
                        {registered && canManageFleet && <button onClick={event => { event.stopPropagation(); setFleetEditor({ company: companyProfiles[companyFilter], vessel: registered }); }} className="mt-1 text-sm font-semibold text-primary">Edit vessel</button>}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-on-surface-variant">{vesselOrders.length}</td>
                      <td className="px-3 py-2.5 font-mono text-on-surface-variant">{fmtDate(nextEta ?? null)}</td>
                      <td className="px-3 py-2.5 font-mono text-on-surface-variant">{fmt(value, vesselOrders[0]?.currency || "EUR")}</td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {vesselOrders.length === 1 && <span className="text-[0.58rem] font-semibold text-primary">Open</span>}
                          <Badge className={riskCount > 0 ? "bg-error/10 text-error" : "bg-success/10 text-success"}>{riskCount > 0 ? `${riskCount} risk` : "clear"}</Badge>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                    </tbody>
                  </table>
                  {filteredCompanyVessels.length === 0 && (
                    <div className="px-4 py-10 text-center text-xs text-outline">No vessels match this search.</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Order list */}
      <section className="bg-surface-container/50 rounded-xl ghost-border overflow-hidden">
        <div className="px-5 py-3.5 border-b border-outline-variant/6">
          <div className="flex flex-col gap-3 mb-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">{orderListTitle}</h3>
              {visibleOrderTotal > 0 && <span className="text-[0.6rem] font-medium bg-surface-high/40 text-on-surface-variant px-2 py-0.5 rounded-full">{filteredOrders.length} of {visibleOrderTotal}</span>}
              {atRiskCount > 0 && <span className="text-[0.6rem] font-medium bg-error/8 text-error px-2 py-0.5 rounded-full">{atRiskCount} at risk</span>}
              {hasFilters && <span className="text-[0.6rem] font-medium bg-primary/8 text-primary px-2 py-0.5 rounded-full">filtered</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.xlsx,.xls,.csv,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                className="hidden"
                onChange={(event) => void handlePOUpload(event.target.files?.[0] ?? null)}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadBusy}
                className="px-3.5 py-1.5 text-[0.65rem] font-semibold rounded-lg bg-primary/12 text-primary hover:bg-primary/18 transition-all flex items-center gap-1.5 disabled:opacity-50"
              >
                {uploadBusy ? <span className="w-3 h-3 border-2 border-primary/25 border-t-primary rounded-full animate-spin" /> : <Ic name="upload_file" className="text-sm" />}
                Process PO File
              </button>
              <button onClick={() => { setCreateDraft(null); setShowCreate(true); }}
                className="px-3.5 py-1.5 text-[0.65rem] font-semibold rounded-lg bg-surface-high/45 text-on-surface-variant hover:bg-surface-high/65 hover:text-on-surface transition-all flex items-center gap-1.5">
                <Ic name="edit_document" className="text-sm" /> Manual Fallback
              </button>
            </div>
          </div>
          {uploadError && (
            <div className="mb-3 rounded-lg border border-error/15 bg-error/8 px-3 py-2 text-xs text-error">
              {uploadError}
            </div>
          )}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Ic name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-base text-outline/40" />
              <input type="text" placeholder="Search by PO, vessel, supplier, IMO..." value={searchInput} onChange={e => setSearchInput(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs bg-surface-high/30 border border-outline-variant/8 rounded-lg text-on-surface placeholder:text-outline/30 focus:outline-none focus:ring-1 focus:ring-primary/20 focus:border-primary/15 focus:bg-surface-high/50 transition-all" />
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {(["all", "me", "unassigned"] as AssignmentFilter[]).map((assignment) => <button key={assignment} onClick={() => setAssignmentFilter(assignment)} className={`text-[0.6rem] font-medium px-2.5 py-1 rounded-md whitespace-nowrap ${assignmentFilter === assignment ? "bg-primary/12 text-primary" : "text-outline hover:bg-surface-high/30"}`}>{assignment === "all" ? "All owners" : assignment === "me" ? "My work" : "Unassigned"}</button>)}
              <span className="w-px h-4 bg-outline-variant/10 mx-1" />
              {(["all", "Pending_Approval", "Procurement", "In_Transit", "Delivered", "At_Risk"] as StatusFilter[]).map(s => {
                const label = s === "all" ? "All" : STATUS_LABELS[s];
                const count = s === "all" ? totalAll : customerStatusCounts[s] ?? 0;
                return (
                  <button key={s} onClick={() => setStatusFilter(s)}
                    className={`text-[0.6rem] font-medium px-2.5 py-1 rounded-md whitespace-nowrap transition-colors ${statusFilter === s ? "bg-primary/12 text-primary" : "text-outline hover:text-on-surface-variant hover:bg-surface-high/30"}`}>
                    {label}{count > 0 && <span className="ml-1 opacity-60">{count}</span>}
                  </button>
                );
              })}
              <span className="w-px h-4 bg-outline-variant/10 mx-1" />
              {(["all", "BuyerPO", "DirectPO", "SubPO"] as OrderTypeFilter[]).map(t => {
                const label = t === "all" ? "Customer Orders" : t === "DirectPO" ? "Direct" : t === "BuyerPO" ? "Inbound Customer PO" : "Supplier Fulfillment POs";
                const icon = t === "BuyerPO" ? "call_received" : t === "SubPO" ? "local_shipping" : t === "DirectPO" ? "description" : "";
                return (
                  <button key={t} onClick={() => setOrderTypeFilter(t)}
                    className={`text-[0.6rem] font-medium px-2.5 py-1 rounded-md whitespace-nowrap transition-colors flex items-center gap-1 ${orderTypeFilter === t ? "bg-tertiary/12 text-tertiary" : "text-outline hover:text-on-surface-variant hover:bg-surface-high/30"}`}>
                    {icon && <Ic name={icon} className="text-[0.6rem]" />}
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {loading ? <ListSkeleton /> : error ? (
          <ErrorState message={error} onRetry={fetchOrders} />
        ) : filteredOrders.length === 0 ? (
          <EmptyState hasFilters={hasFilters} onClear={clearFilters} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1280px] text-left text-sm">
              <thead className="bg-surface-low/30 text-outline uppercase text-[0.6rem] font-medium tracking-wider">
                <tr>
                  <SortTh label="PO" field="poNumber" current={sortField} order={sortOrder} onSort={handleSort} />
                  <th className="px-4 py-2.5">Vessel</th>
                  <th className="px-4 py-2.5">Supplier</th>
                  <SortTh label="ETA" field="eta" current={sortField} order={sortOrder} onSort={handleSort} />
                  <SortTh label="Total" field="total" current={sortField} order={sortOrder} onSort={handleSort} />
                  <th className="px-4 py-2.5">Margin</th>
                  <SortTh label="Status" field="status" current={sortField} order={sortOrder} onSort={handleSort} />
                  <th className="px-4 py-2.5">Confirm</th>
                  <th className="px-4 py-2.5">Lines</th>
                  <th className="px-4 py-2.5">Timing</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/4">
                {filteredOrders.map(po => {
                  const days = daysUntil(po.eta);
                  const isSelected = selectedId === po.id;
                  const lineCount = po._count?.lines ?? 0;
                  const isRisk = po.status === "At_Risk";
                  return (
                    <tr key={po.id} onClick={() => openOrderModal(po.id)}
                      className={`transition-colors cursor-pointer border-l-2 ${
                        isRisk
                          ? isSelected
                            ? "border-l-error bg-error/12"
                            : "border-l-error/70 bg-error/6 hover:bg-error/10"
                          : isSelected
                            ? "border-l-primary bg-primary/6"
                            : "border-l-transparent hover:bg-surface-high/15"
                      }`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[0.7rem] font-semibold text-on-surface">{po.poNumber}</span>
                          {po.orderType === "BuyerPO" && <Badge className="bg-info/10 text-info border-info/20">Buyer</Badge>}
                          {po.orderType === "SubPO" && <Badge className="bg-warning/10 text-warning border-warning/20">Supplier PO</Badge>}
                        </div>
                        {po.parentOrder && (
                          <div className="text-[0.55rem] text-outline/50 mt-0.5 flex items-center gap-0.5">
                            <Ic name="subdirectory_arrow_right" className="text-[0.55rem]" />
                            SO {po.supplierRef || po.buyerRef || "linked"} / customer PO {po.parentOrder.poNumber}
                          </div>
                        )}
                        {(po._count?.childOrders ?? 0) > 0 && (
                          <div className="text-[0.55rem] text-outline/50 mt-0.5">{po._count!.childOrders} supplier PO{po._count!.childOrders !== 1 ? "s" : ""}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Ic name="directions_boat" className="text-xs text-outline/50" />
                          <span>{po.vessel}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-on-surface-variant">
                        <span>{po.supplier}</span>
                        {po.buyerName && <div className="text-[0.55rem] text-outline/40 mt-0.5">Buyer: {po.buyerName}</div>}
                      </td>
                      <td className="px-4 py-3 text-on-surface-variant">{fmtDate(po.eta)}</td>
                      <td className="px-4 py-3 font-mono">{fmt(po.total, po.currency)}</td>
                      <td className="px-4 py-3">
                        <span className={`font-mono ${po.marginPct < 5 ? "text-error" : po.marginPct < 10 ? "text-warning" : "text-on-surface-variant"}`}>
                          {po.marginPct.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-3"><Badge className={STATUS_STYLES[po.status]}>{STATUS_LABELS[po.status]}</Badge></td>
                      <td className="px-4 py-3"><Badge className={CONFIRM_STYLES[po.confirmStatus]}>{CONFIRM_LABELS[po.confirmStatus]}</Badge></td>
                      <td className="px-4 py-3 text-on-surface-variant font-mono">{lineCount}</td>
                      <td className="px-4 py-3">
                        <span className={`font-mono text-[0.65rem] ${days < 0 ? "text-error font-semibold" : days <= 3 ? "text-warning" : "text-on-surface-variant"}`}>
                          {days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "Today" : `${days}d`}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── PO WORKSPACE ──────────────────────────────────────────── */}

      {orderModalId && detailLoading && <ModalLoading title="Loading purchase order" />}
      {orderModalId && !detailLoading && !selectedPO && <ModalError title="Unable to load order details" onClose={closeOrderModal} onRetry={() => fetchDetail(orderModalId)} />}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   PO WORKSPACE
   ══════════════════════════════════════════════════════════════ */

function DialogShell({ title, subtitle, icon, children, onClose }: {
  title: string; subtitle?: string; icon: string; children: React.ReactNode; onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Portals render only after the client document is available.
    setMounted(true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-surface-base">
      <section role="dialog" aria-modal="true" aria-label={title} className="flex h-dvh w-dvw max-w-full flex-col overflow-hidden bg-surface-base">
        <div className="shrink-0 flex items-start justify-between gap-4 border-b border-outline-variant/10 bg-surface-container px-6 py-4 shadow-lg shadow-black/10">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Ic name={icon} className="text-lg" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-on-surface truncate">{title}</h2>
              {subtitle && <p className="mt-0.5 text-xs text-outline">{subtitle}</p>}
            </div>
          </div>
          <button aria-label="Close dialog" onClick={onClose} className="p-1.5 rounded-md text-outline hover:text-on-surface hover:bg-surface-high/30 transition-colors">
            <Ic name="close" className="text-base" />
          </button>
        </div>
        <div className="flex-1 overflow-x-hidden overflow-y-auto bg-surface-base px-4 py-4 lg:px-5">{children}</div>
      </section>
    </div>,
    document.body,
  );
}

function ModalLoading({ title }: { title: string }) {
  return (
    <DialogShell title={title} icon="hourglass_top" onClose={() => undefined}>
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-primary/25 border-t-primary rounded-full animate-spin" />
      </div>
    </DialogShell>
  );
}

function ModalError({ title, onClose, onRetry }: { title: string; onClose: () => void; onRetry: () => void }) {
  return (
    <DialogShell title={title} icon="error" onClose={onClose}>
      <div className="flex flex-col items-center justify-center py-14 text-center">
        <p className="text-sm text-on-surface-variant">The selected record could not be loaded.</p>
        <button onClick={onRetry} className="mt-4 rounded-md bg-primary/12 px-4 py-2 text-xs font-semibold text-primary hover:bg-primary/18">Retry</button>
      </div>
    </DialogShell>
  );
}

function PurchaseOrderDetailModal({ po, tab, onTabChange, onClose, onOpenOrder, onRefresh, onNavigate }: {
  po: PurchaseOrder; tab: WorkspaceTab; onTabChange: (t: WorkspaceTab) => void;
  onClose: () => void; onOpenOrder: (id: string) => void; onRefresh: () => void; onNavigate?: (module: string) => void;
}) {
  return (
    <DialogShell
      title={po.poNumber}
      subtitle={`${po.buyerName || po.vesselOwner || "Unassigned shipping company"} / ${po.vessel} / ${po.supplier}`}
      icon="receipt_long"
      onClose={onClose}
    >
      <POWorkspace po={po} tab={tab} onTabChange={onTabChange} onClose={onClose} onOpenOrder={onOpenOrder} onRefresh={onRefresh} onNavigate={onNavigate} />
    </DialogShell>
  );
}

function ShippingCompanyModal({ companyName, profile, orders, onClose, onOpenOrder, onSave, onSourceUpdated, onDelete, canEdit }: {
  companyName: string;
  profile: ShippingCompany | null;
  orders: POWithCount[];
  onClose: () => void;
  onOpenOrder: (id: string) => void;
  onSave: (previousName: string, draft: ShippingCompanyDraft) => Promise<ShippingCompany>;
  onSourceUpdated: (company: ShippingCompany) => void;
  onDelete?: (companyName: string) => Promise<void>;
  canEdit: boolean;
}) {
  const [draft, setDraft] = useState<ShippingCompanyDraft>({
    name: companyName,
    legalName: profile?.legalName ?? companyName,
    address: profile?.address ?? "",
    postalCode: profile?.postalCode ?? "",
    city: profile?.city ?? "",
    country: profile?.country ?? "",
    contactName: profile?.contactName ?? "",
    email: profile?.email ?? "",
    phone: profile?.phone ?? "",
    website: profile?.website ?? "",
    vatId: profile?.vatId ?? "",
    companyNumber: profile?.companyNumber ?? "",
    paymentTerms: profile?.paymentTerms ?? "",
    invoiceEmail: profile?.invoiceEmail ?? "",
    notes: profile?.notes ?? "",
  });
  const [editing, setEditing] = useState(!companyName);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchAfterSave, setSearchAfterSave] = useState(true);

  const vessels = Array.from(new Set([...(profile?.fleetVessels ?? []).map(v => v.name), ...orders.map((po) => po.vessel)]));
  const orderValue = orders.reduce((sum, po) => sum + po.total, 0);

  function setField(field: keyof ShippingCompanyDraft, value: string) {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      const discover = !companyName && searchAfterSave;
      const saved = await onSave(companyName, draft);
      setDraft((prev) => ({ ...prev, ...saved }));
      setEditing(false);
      if (discover) {
        try { onSourceUpdated(await requestCompanySources({ action: "search", companyId: saved.id, allowPublicLookup: true })); }
        catch (cause) { setError(`Company saved. ${cause instanceof Error ? cause.message : "Source lookup failed; retry from Company sources & validation."}`); }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!onDelete) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(companyName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete shipping company.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell title={companyName || "Add Shipping Company"} subtitle="Shipping company profile" icon="business" onClose={onClose}>
      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-12 lg:col-span-8 space-y-4">
          {error && <div className="rounded-lg border border-error/20 bg-error/8 px-3 py-2 text-xs text-error">{error}</div>}
          <div className="flex items-center justify-between gap-3 rounded-lg border border-outline-variant/8 bg-surface-low/20 px-4 py-3">
            <div>
              <p className="text-xs font-semibold text-on-surface">{draft.legalName || companyName}</p>
              <p className="mt-0.5 text-[0.65rem] text-outline">{profile ? "Stored shipping company record" : "New shipping company profile"}</p>
            </div>
            {!editing && canEdit && (
              <div className="flex items-center gap-2">
                {onDelete && (
                  <button onClick={() => setConfirmDelete(true)} className="rounded-md bg-error/8 px-3 py-1.5 text-xs font-semibold text-error hover:bg-error/12">
                    Delete
                  </button>
                )}
                <button disabled={busy} onClick={() => setEditing(true)} className="rounded-md bg-primary/12 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/18 disabled:opacity-40">
                  Edit Profile
                </button>
              </div>
            )}
          </div>
          {confirmDelete && (
            <div className="rounded-lg border border-error/20 bg-error/8 px-4 py-3">
              <p className="text-xs font-semibold text-error">Delete {companyName} and all linked purchase orders?</p>
              <p className="mt-1 text-[0.65rem] text-on-surface-variant">
                This removes the shipping company profile and registered fleet, inbound customer POs, generated supplier POs, order lines, notes, and events linked to this account.
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <button onClick={() => setConfirmDelete(false)} className="rounded-md px-3 py-1.5 text-xs font-semibold text-outline hover:text-on-surface">Cancel</button>
                <button onClick={handleDelete} disabled={busy} className="rounded-md bg-error px-4 py-1.5 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50">
                  {busy ? "Deleting..." : `Delete ${orders.length} order${orders.length === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          )}
          {editing ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <CompanyInput label="Display Name" value={draft.name ?? ""} onChange={(v) => setField("name", v)} />
                <CompanyInput label="Legal Name" value={draft.legalName ?? ""} onChange={(v) => setField("legalName", v)} />
                <CompanyInput label="Contact Name" value={draft.contactName ?? ""} onChange={(v) => setField("contactName", v)} />
                <CompanyInput label="Email" value={draft.email ?? ""} onChange={(v) => setField("email", v)} />
                <CompanyInput label="Phone" value={draft.phone ?? ""} onChange={(v) => setField("phone", v)} />
                <CompanyInput label="Website" value={draft.website ?? ""} onChange={(v) => setField("website", v)} />
                <CompanyInput label="Invoice Email" value={draft.invoiceEmail ?? ""} onChange={(v) => setField("invoiceEmail", v)} />
                <CompanyInput label="Payment Terms" value={draft.paymentTerms ?? ""} onChange={(v) => setField("paymentTerms", v)} />
                <CompanyInput label="VAT ID" value={draft.vatId ?? ""} onChange={(v) => setField("vatId", v)} />
                <CompanyInput label="Company Number" value={draft.companyNumber ?? ""} onChange={(v) => setField("companyNumber", v)} />
                <CompanyInput label="Address" value={draft.address ?? ""} onChange={(v) => setField("address", v)} wide />
                <CompanyInput label="Postal Code" value={draft.postalCode ?? ""} onChange={(v) => setField("postalCode", v)} />
                <CompanyInput label="City" value={draft.city ?? ""} onChange={(v) => setField("city", v)} />
                <CompanyInput label="Country" value={draft.country ?? ""} onChange={(v) => setField("country", v)} />
              </div>
              <div>
                <label className="text-[0.6rem] text-outline uppercase tracking-wider block mb-1.5">Notes</label>
                <textarea value={draft.notes ?? ""} onChange={(e) => setField("notes", e.target.value)} rows={3}
                  className="w-full rounded-lg border border-outline-variant/8 bg-surface-high/25 px-3 py-2 text-xs text-on-surface placeholder:text-outline/30 focus:outline-none focus:ring-1 focus:ring-primary/20 resize-none" />
              </div>
              {!companyName && <label className="block text-sm text-on-surface-variant"><input type="checkbox" className="mr-2" checked={searchAfterSave} onChange={event => setSearchAfterSave(event.target.checked)} />Search public company sources after saving (company name sent to GLEIF only)</label>}
              <div className="flex justify-end gap-2">
                <button onClick={() => companyName ? setEditing(false) : onClose()} className="rounded-md px-3 py-1.5 text-xs font-semibold text-outline hover:text-on-surface">Cancel</button>
                <button onClick={handleSave} disabled={busy || !draft.name?.trim()} className="rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-on-primary hover:brightness-110 disabled:opacity-50">
                  {busy ? "Saving..." : "Save Profile"}
                </button>
              </div>
            </>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <CompanyProfileField label="Display Name" value={draft.name} />
              <CompanyProfileField label="Legal Name" value={draft.legalName || companyName} />
              <CompanyProfileField label="Contact Name" value={draft.contactName} />
              <CompanyProfileField label="Email" value={draft.email} />
              <CompanyProfileField label="Phone" value={draft.phone} />
              <CompanyProfileField label="Website" value={draft.website} />
              <CompanyProfileField label="Invoice Email" value={draft.invoiceEmail} />
              <CompanyProfileField label="Payment Terms" value={draft.paymentTerms} />
              <CompanyProfileField label="VAT ID" value={draft.vatId} />
              <CompanyProfileField label="Company Number" value={draft.companyNumber} />
              <CompanyProfileField label="Address" value={draft.address} wide />
              <CompanyProfileField label="Postal Code" value={draft.postalCode} />
              <CompanyProfileField label="City" value={draft.city} />
              <CompanyProfileField label="Country" value={draft.country} />
              <CompanyProfileField label="Notes" value={draft.notes} wide multiline />
            </div>
          )}
          {profile && <>
            {busy && !editing && <p role="status" className="text-sm text-primary">Company saved. Searching public sources…</p>}
            <CompanySourceReview key={profile.id} company={profile} canManage={canEdit} disabled={busy || editing} onUpdated={saved => { onSourceUpdated(saved); setDraft(previous => ({ ...previous, ...saved })); }} />
          </>}
        </div>

        <aside className="col-span-12 lg:col-span-4 space-y-3">
          <div className="rounded-lg bg-surface-low/20 p-4">
            <p className="text-[0.6rem] uppercase tracking-wider text-outline">Operational Scope</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <MiniStat label="Vessels" value={String(vessels.length)} sub={vessels.join(", ") || "None"} />
              <MiniStat label="Orders" value={String(orders.length)} sub={fmt(orderValue, orders[0]?.currency || "EUR")} />
            </div>
          </div>
          <div className="rounded-lg bg-surface-low/20 p-4">
            <p className="text-[0.6rem] uppercase tracking-wider text-outline mb-3">Recent Orders</p>
            <div className="space-y-2">
              {orders.slice(0, 5).map((po) => (
                <button key={po.id} onClick={() => onOpenOrder(po.id)} className="block w-full rounded-md bg-surface-high/20 px-3 py-2 text-left transition-colors hover:bg-primary/8 hover:ring-1 hover:ring-primary/15">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs">{po.poNumber}</span>
                    <Badge className={STATUS_STYLES[po.status]}>{STATUS_LABELS[po.status]}</Badge>
                  </div>
                  <p className="mt-1 text-[0.6rem] text-outline">{po.vessel} / {fmtDate(po.eta)}</p>
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </DialogShell>
  );
}

function CompanyInput({ label, value, onChange, wide }: { label: string; value: string; onChange: (value: string) => void; wide?: boolean }) {
  return (
    <div className={wide ? "md:col-span-2" : ""}>
      <label className="text-[0.6rem] text-outline uppercase tracking-wider block mb-1.5">{label}</label>
      <input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-outline-variant/8 bg-surface-high/25 px-3 py-2 text-xs text-on-surface placeholder:text-outline/30 focus:outline-none focus:ring-1 focus:ring-primary/20" />
    </div>
  );
}

function CompanyProfileField({ label, value, wide, multiline }: { label: string; value?: string | null; wide?: boolean; multiline?: boolean }) {
  const display = value?.trim() || "Not set";
  return (
    <div className={`${wide ? "md:col-span-2" : ""} rounded-lg border border-outline-variant/8 bg-surface-low/20 px-3 py-2.5`}>
      <p className="text-[0.58rem] font-semibold uppercase tracking-wider text-outline">{label}</p>
      <p className={`mt-1 text-xs ${value?.trim() ? "text-on-surface" : "text-outline/70"} ${multiline ? "whitespace-pre-line leading-relaxed" : "truncate"}`} title={!multiline ? display : undefined}>
        {display}
      </p>
    </div>
  );
}

function POWorkspace({ po, tab, onTabChange, onClose, onOpenOrder, onRefresh, onNavigate }: {
  po: PurchaseOrder; tab: WorkspaceTab; onTabChange: (t: WorkspaceTab) => void;
  onClose: () => void; onOpenOrder: (id: string) => void; onRefresh: () => void; onNavigate?: (module: string) => void;
}) {
  const days = daysUntil(po.eta);
  const lines = po.lines ?? [];
  const events = po.events ?? [];
  const lineCount = lines.length;
  const deliveredLines = lines.filter(l => effectiveLineStatus(l) === "Delivered").length;
  const backorderedLines = lines.filter(l => effectiveLineStatus(l) === "Backordered").length;

  /* ── Action state ──────────────────────────────────────────── */
  const [actionBusy, setActionBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const [showETAModal, setShowETAModal] = useState(false);
  const [showExceptionModal, setShowExceptionModal] = useState(false);
  const [showConfirmReqModal, setShowConfirmReqModal] = useState(false);
  const [showMarkDeliveredModal, setShowMarkDeliveredModal] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentResult, setAgentResult] = useState<AgentReviewResult | null>(null);
  const [documents, setDocuments] = useState<PurchaseOrderDocument[]>(po.documents ?? []);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsBusy, setDocumentsBusy] = useState(false);
  const [showDocumentModal, setShowDocumentModal] = useState(false);
  const [showReprocessModal, setShowReprocessModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);

  const fetchDocuments = useCallback(async () => {
    setDocumentsLoading(true);
    try {
      const res = await fetch(`/api/v1/purchase-orders/${po.id}/documents`);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error?.message || "Failed to load documents");
      setDocuments(json.data ?? []);
    } catch {
      setDocuments([]);
    } finally {
      setDocumentsLoading(false);
    }
  }, [po.id]);

  useEffect(() => {
    setDocuments(po.documents ?? []);
    void fetchDocuments();
  }, [po.id, po.documents, fetchDocuments]);

  function showToast(message: string, tone: "success" | "error" = "success") {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 3000);
  }

  /* ── Record event ──────────────────────────────────────────── */

  async function recordEvent(type: POEventType, summary: string, detail?: string) {
    try {
      await fetch(`/api/v1/purchase-orders/${po.id}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, summary, detail }),
      });
    } catch { /* non-blocking */ }
  }

  /* ── PATCH PO helper ───────────────────────────────────────── */

  async function patchPO(data: Record<string, unknown>) {
    setActionBusy(true);
    try {
      const res = await fetch(`/api/v1/purchase-orders/${po.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update");
      return true;
    } catch {
      showToast("Update failed", "error");
      return false;
    } finally {
      setActionBusy(false);
    }
  }

  /* ── Actions ───────────────────────────────────────────────── */

  function handleRefresh() {
    onRefresh();
    showToast("Order refreshed");
  }

  async function handleApprove() {
    const ok = await patchPO({ status: "Procurement" });
    if (ok) {
      await recordEvent("approval", `Order approved - status changed to Procurement`, `Previous status: ${STATUS_LABELS[po.status]}`);
      onRefresh();
      showToast(`${po.poNumber} approved - moved to Procurement`);
    }
  }

  async function handleUpdateETA(newDate: string) {
    const ok = await patchPO({ eta: newDate });
    if (ok) {
      await recordEvent("eta_updated", `ETA updated to ${fmtDate(newDate)}`, `Previous ETA: ${fmtDate(po.eta)}`);
      onRefresh();
      showToast(`ETA updated to ${fmtDate(newDate)}`);
    }
    setShowETAModal(false);
  }

  async function handleConfirmOrder() {
    setActionBusy(true);
    try {
      if (po.orderType === "BuyerPO") {
        const res = await fetch(`/api/v1/purchase-orders/${po.id}/confirm`, { method: "POST" });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error?.message || "Order confirmation failed");
        showToast(`${po.poNumber} confirmed as ${json.data.salesOrderNo}. Supplier POs generated for fulfillment.`);
      } else {
        throw new Error("Only inbound customer POs can be confirmed. Supplier fulfillment POs are generated from the Nautex sales order workflow.");
      }
      onRefresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Order confirmation failed", "error");
    } finally {
      setActionBusy(false);
    }
    setShowConfirmReqModal(false);
  }

  async function handleRejectOrder(reason: string) {
    const ok = await patchPO({ confirmStatus: "Rejected", status: "At_Risk", priority: "High" });
    if (ok) {
      await recordEvent("status_changed", `Customer purchase order rejected`, reason);
      onRefresh();
      showToast(`${po.poNumber} rejected. Reason recorded for audit.`);
    }
    setShowRejectModal(false);
  }

  async function handleMarkOrderDelivered() {
    if (lines.length === 0) return;
    setActionBusy(true);
    try {
      for (const line of lines) {
        if (line.qtyDelivered < line.qtyOrdered || effectiveLineStatus(line) !== "Delivered") {
          const res = await fetch(`/api/v1/purchase-orders/${po.id}/lines/${line.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              qtyDelivered: line.qtyOrdered,
              qtyConfirmed: line.qtyConfirmed != null ? Math.max(line.qtyConfirmed, line.qtyOrdered) : line.qtyOrdered,
              status: "Delivered",
              confirmedDate: new Date().toISOString(),
            }),
          });
          if (!res.ok) throw new Error(`Failed to mark line ${line.lineNumber} delivered`);
        }
      }
      await recordEvent("delivery_updated", `${po.poNumber} marked delivered`, "Manual delivery completion by Nautex operator.");
      onRefresh();
      showToast(`${po.poNumber} marked delivered`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to mark order delivered", "error");
    } finally {
      setActionBusy(false);
      setShowMarkDeliveredModal(false);
    }
  }

  function handleDownloadPdf() {
    void openNautexDocument(`/api/v1/purchase-orders/${po.id}/document`);
  }

  async function handleFlagException(reason: string) {
    const ok = await patchPO({ status: "At_Risk" });
    if (ok) {
      await recordEvent("exception_flagged", `Exception flagged: ${reason.substring(0, 80)}${reason.length > 80 ? "..." : ""}`, reason);
      onRefresh();
      showToast("Order flagged as At Risk");
    }
    setShowExceptionModal(false);
  }

  async function handleAgentReview() {
    setAgentBusy(true);
    setAgentResult(null);
    try {
      const res = await fetch(`/api/v1/purchase-orders/${po.id}/agent-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json?.error?.message || "Agent review failed");
      setAgentResult(json.data);
      onRefresh();
      showToast("Agent review completed. Human review is still required.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Agent review failed", "error");
    } finally {
      setAgentBusy(false);
    }
  }

  async function handleAttachDocument(file: File, category: string, description: string) {
    setDocumentsBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("category", category);
      form.append("description", description);
      const res = await fetch(`/api/v1/purchase-orders/${po.id}/documents`, {
        method: "POST",
        body: form,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error?.message || "Document upload failed");
      await fetchDocuments();
      onRefresh();
      onTabChange("documents");
      setShowDocumentModal(false);
      showToast("Document attached");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Document upload failed", "error");
    } finally {
      setDocumentsBusy(false);
    }
  }

  async function handleDeleteDocument(documentId: string) {
    setDocumentsBusy(true);
    try {
      const res = await fetch(`/api/v1/purchase-orders/${po.id}/documents/${documentId}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error?.message || "Document delete failed");
      await fetchDocuments();
      onRefresh();
      showToast("Document removed");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Document delete failed", "error");
    } finally {
      setDocumentsBusy(false);
    }
  }

  async function handleReprocessUpload(file: File) {
    setActionBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/v1/purchase-orders/${po.id}/reprocess-upload`, {
        method: "POST",
        body: form,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error?.message || "PO reprocessing failed");
      setShowReprocessModal(false);
      onRefresh();
      showToast(`Reprocessed ${json.data?._count?.lines ?? "all"} lines. Total recalculated to ${fmt(json.data?.total ?? 0, json.data?.currency ?? po.currency)}.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "PO reprocessing failed", "error");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleDeleteOrder() {
    setActionBusy(true);
    try {
      const res = await fetch(`/api/v1/purchase-orders/${po.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error?.message || "Purchase order delete failed");
      setShowDeleteModal(false);
      onClose();
      onRefresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Purchase order delete failed", "error");
    } finally {
      setActionBusy(false);
    }
  }

  function navigateToModule(moduleKey: string, recordId?: string, label?: string) {
    if (recordId && typeof window !== "undefined") {
      const detail: RecordContextDetail = {
        moduleKey,
        id: recordId,
        label,
        title: label ?? recordId,
        subtitle: moduleKey === "suppliers" ? `Linked from ${po.poNumber}.` : `Linked from ${po.supplier}.`,
      };
      window.history.replaceState(null, "", `#${moduleKey}:${encodeURIComponent(recordId)}`);
      window.dispatchEvent(new CustomEvent("nautex:record-context", { detail }));
    }
    onNavigate?.(moduleKey);
  }

  /* ── Note handlers ────────────────────────────────────────── */

  async function handleNoteAdd(text: string) {
    try {
      await fetch(`/api/v1/purchase-orders/${po.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      onRefresh();
    } catch { /* handled by API */ }
  }

  async function handleNoteEdit(noteId: string, text: string) {
    try {
      await fetch(`/api/v1/purchase-orders/${po.id}/notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      onRefresh();
    } catch { /* handled by API */ }
  }

  async function handleNoteDelete(noteId: string) {
    try {
      await fetch(`/api/v1/purchase-orders/${po.id}/notes/${noteId}`, {
        method: "DELETE",
      });
      onRefresh();
    } catch { /* handled by API */ }
  }

  /* ── Line edit handler ──────────────────────────────────────── */

  async function handleLineUpdate(lineId: string, data: Record<string, unknown>) {
    try {
      const res = await fetch(`/api/v1/purchase-orders/${po.id}/lines/${lineId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed");
      const line = lines.find(l => l.id === lineId);
      const fieldName = Object.keys(data)[0];
      const fieldValue = Object.values(data)[0];
      await recordEvent("line_updated", `Line ${line?.lineNumber ?? "?"} updated: ${fieldName} -> ${fieldValue}`, JSON.stringify(data));
      onRefresh();
      showToast("Line updated");
      return true;
    } catch {
      showToast("Failed to update line", "error");
      return false;
    }
  }

  const tabs: { key: WorkspaceTab; label: string; icon: string; badge?: number }[] = [
    { key: "overview", label: "Overview", icon: "info" },
    { key: "lines", label: "Order Lines", icon: "list_alt", badge: lineCount },
    { key: "delivery", label: "Delivery", icon: "local_shipping" },
    { key: "documents", label: "Documents", icon: "attach_file", badge: documents.length },
    ...((po.orderType === "BuyerPO" || po.orderType === "SubPO") ? [{ key: "supply-chain" as WorkspaceTab, label: "Supply Chain", icon: "account_tree", badge: (po.childOrders?.length ?? 0) > 0 ? po.childOrders!.length : undefined }] : []),
    { key: "activity", label: "Activity", icon: "history", badge: events.length > 0 ? events.length : undefined },
  ];

  const isApproved = po.status !== "Pending_Approval";
  const salesOrderNo = po.supplierRef?.startsWith("SO-") ? po.supplierRef : null;
  const linkedCustomerPo = po.orderType === "SubPO" ? po.buyerRef || po.parentOrder?.poNumber || null : po.poNumber;
  const canConfirm = po.confirmStatus !== "Confirmed" && po.confirmStatus !== "Rejected";
  const canReprocessFromFile = po.confirmStatus !== "Confirmed" && (po.childOrders?.length ?? 0) === 0;
  const canReject = po.orderType === "BuyerPO" && po.confirmStatus !== "Confirmed" && po.confirmStatus !== "Rejected";

  return (
    <section className="relative min-h-[calc(100dvh-7.5rem)] max-w-full overflow-hidden rounded-xl border border-outline-variant/8 bg-surface-container shadow-xl shadow-black/10">
      {/* Toast notification */}
      {toast && (
        <div className={`absolute top-3 right-14 z-50 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium shadow-lg animate-fade-up ${toast.tone === "success" ? "bg-success/15 text-success border border-success/20" : "bg-error/15 text-error border border-error/20"}`}>
          <Ic name={toast.tone === "success" ? "check_circle" : "error"} className="text-sm" />
          {toast.message}
        </div>
      )}

      {/* Workspace header */}
      <div className="px-5 py-4 border-b border-outline-variant/6">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="text-base font-bold font-mono tracking-tight">{po.poNumber}</h2>
            <Badge className={STATUS_STYLES[po.status]}>{STATUS_LABELS[po.status]}</Badge>
            <Badge className={CONFIRM_STYLES[po.confirmStatus]}>{CONFIRM_LABELS[po.confirmStatus]}</Badge>
            <Badge className={PRIORITY_STYLES[po.priority]}>{po.priority}</Badge>
          </div>
          <ActionButton icon="refresh" label="Refresh" onClick={handleRefresh} disabled={actionBusy} />
        </div>

        {/* Key metrics strip */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <MetricChip icon="directions_boat" label={po.vessel} sub={po.vesselImo ? `IMO ${po.vesselImo}` : undefined} />
          {po.vesselOwner && <MetricChip icon="business" label={po.vesselOwner} />}
          <MetricChip icon="storefront" label={po.supplier} sub={po.supplierRef ? `Ref: ${po.supplierRef}` : undefined} />
          <WorkAssignmentSelect endpoint={`/api/v1/purchase-orders/${po.id}/assignment`} value={po.assignedTo} onUpdated={onRefresh} />
          {po.port && <MetricChip icon="anchor" label={po.port} />}
          <MetricChip icon="payments" label={fmt(po.total, po.currency)} />
          <MetricChip icon="event" label={fmtDate(po.eta)} sub={days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "Today" : `${days}d remaining`} subTone={days < 0 ? "danger" : days <= 3 ? "warn" : "neutral"} />
        </div>

        {agentResult && (
          <div className="mt-4 rounded-lg border border-primary/12 bg-primary/5 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Ic name="smart_toy" className="text-sm text-primary" />
                  <p className="text-xs font-semibold text-on-surface">Purchase order agent review</p>
                  <Badge className={agentResult.risk === "High" ? "bg-error/10 text-error" : agentResult.risk === "Medium" ? "bg-warning/10 text-warning" : "bg-success/10 text-success"}>
                    {agentResult.risk} risk
                  </Badge>
                  {agentResult.humanReviewRequired && <Badge className="bg-surface-high/40 text-on-surface-variant">Human review required</Badge>}
                </div>
                <p className="mt-1 text-xs text-on-surface-variant">{agentResult.recommendation}</p>
                {agentResult.findings.length > 0 && (
                  <ul className="mt-2 space-y-1 text-[0.65rem] text-outline">
                    {agentResult.findings.slice(0, 3).map((finding, index) => <li key={`${finding}-${index}`}>+ {finding}</li>)}
                  </ul>
                )}
              </div>
              <button onClick={() => onNavigate?.("agentMonitor")} className="shrink-0 px-2.5 py-1.5 text-[0.6rem] font-semibold rounded-md bg-surface-high/30 text-on-surface-variant hover:bg-surface-high/50 transition-colors">
                Agent Monitor
              </button>
            </div>
          </div>
        )}
        {salesOrderNo && (
          <div className="mt-4 rounded-lg border border-success/15 bg-success/8 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Ic name="receipt" className="text-sm text-success" />
              <span className="font-semibold text-success">Nautex Sales Order</span>
              <span className="font-mono text-on-surface">{salesOrderNo}</span>
              <span className="text-outline">linked to customer PO</span>
              <span className="font-mono text-on-surface-variant">{linkedCustomerPo || "not assigned"}</span>
            </div>
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex max-w-full items-center gap-1 overflow-x-auto px-5 py-1.5 border-b border-outline-variant/6 bg-surface-low/10">
        {tabs.map(t => (
          <button key={t.key} onClick={() => onTabChange(t.key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-[0.7rem] font-medium rounded-md transition-colors ${tab === t.key ? "bg-primary/10 text-primary" : "text-outline hover:text-on-surface-variant hover:bg-surface-high/20"}`}>
            <Ic name={t.icon} className="text-sm" />
            {t.label}
            {t.badge != null && t.badge > 0 && <span className="text-[0.55rem] font-mono bg-surface-high/40 text-on-surface-variant px-1.5 py-0.5 rounded-full ml-0.5">{t.badge}</span>}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="overflow-x-hidden p-4 lg:p-5">
        {tab === "overview" && <OverviewTab po={po} lineCount={lineCount} deliveredLines={deliveredLines} backorderedLines={backorderedLines} onNoteAdd={handleNoteAdd} onNoteEdit={handleNoteEdit} onNoteDelete={handleNoteDelete} onPatchPO={patchPO} onRefresh={onRefresh} />}
        {tab === "lines" && <LinesTab lines={lines} currency={po.currency} orderId={po.id} onLineUpdate={handleLineUpdate} />}
        {tab === "delivery" && <DeliveryTab po={po} lines={lines} onPatchPO={patchPO} onLineUpdate={handleLineUpdate} onRefresh={onRefresh} actionBusy={actionBusy} />}
        {tab === "documents" && <DocumentsTab orderId={po.id} documents={documents} erpCore={po.erpCore} loading={documentsLoading} busy={documentsBusy} onAttach={() => setShowDocumentModal(true)} onDelete={handleDeleteDocument} />}
        {tab === "supply-chain" && <SupplyChainTab po={po} onRefresh={onRefresh} onOpenOrder={onOpenOrder} />}
        {tab === "activity" && <ActivityTab po={po} events={events} erpCore={po.erpCore} />}
      </div>

      {/* Action bar */}
      <div className="px-5 py-3 border-t border-outline-variant/6 bg-surface-low/10">
        <div className="flex flex-wrap items-center gap-2">
          {po.orderType === "DirectPO" && <ActionButton icon="check_circle" label={isApproved ? "Approved" : "Approve"} primary onClick={handleApprove} disabled={actionBusy || isApproved} />}
          {po.orderType === "BuyerPO" && <ActionButton icon="task_alt" label={po.confirmStatus === "Confirmed" ? "Confirmed" : "Confirm"} primary onClick={() => setShowConfirmReqModal(true)} disabled={actionBusy || !canConfirm} />}
          {po.orderType === "BuyerPO" && <ActionButton icon="block" label={po.confirmStatus === "Rejected" ? "Rejected" : "Reject"} danger onClick={() => setShowRejectModal(true)} disabled={actionBusy || !canReject} />}
          {po.status !== "Delivered" && lines.length > 0 && <ActionButton icon="inventory" label="Mark Delivered" onClick={() => setShowMarkDeliveredModal(true)} disabled={actionBusy} />}
          {(po.orderType === "SubPO" || po.parentOrderId) && <ActionButton icon="download" label="Download PDF" onClick={handleDownloadPdf} disabled={actionBusy} />}
          <ActionButton icon="edit_calendar" label="Update ETA" onClick={() => setShowETAModal(true)} disabled={actionBusy} />
          <ActionButton icon="smart_toy" label={agentBusy ? "Reviewing..." : "Run Agent Review"} onClick={handleAgentReview} disabled={actionBusy || agentBusy} />
          <ActionButton icon="find_replace" label="Reprocess PO File" onClick={() => setShowReprocessModal(true)} disabled={actionBusy || !canReprocessFromFile} />
          <ActionButton icon="upload_file" label="Attach Document" onClick={() => { onTabChange("documents"); setShowDocumentModal(true); }} disabled={actionBusy || documentsBusy} />
          <ActionButton icon="flag" label="Flag Exception" onClick={() => setShowExceptionModal(true)} disabled={actionBusy} />
          <ActionButton icon="storefront" label="Open Supplier" subtle onClick={() => po.supplierId ? navigateToModule("suppliers", po.supplierId, po.supplier) : navigateToModule("suppliers")} />
          <ActionButton icon="pending_actions" label="Backorders" subtle onClick={() => navigateToModule("backorders", po.poNumber, po.poNumber)} />
          <ActionButton icon="delete" label="Delete Order" danger onClick={() => setShowDeleteModal(true)} disabled={actionBusy} />
        </div>
      </div>

      {/* ── Modals ─────────────────────────────────────────────── */}

      {showETAModal && <ETAModal currentETA={po.eta} onSave={handleUpdateETA} onClose={() => setShowETAModal(false)} busy={actionBusy} />}
      {showExceptionModal && <ExceptionModal onSave={handleFlagException} onClose={() => setShowExceptionModal(false)} busy={actionBusy} />}
      {showConfirmReqModal && <ConfirmOrderModal po={po} salesOrderNo={salesOrderNo} onConfirm={handleConfirmOrder} onClose={() => setShowConfirmReqModal(false)} busy={actionBusy} />}
      {showRejectModal && <RejectOrderModal po={po} onReject={handleRejectOrder} onClose={() => setShowRejectModal(false)} busy={actionBusy} />}
      {showMarkDeliveredModal && <MarkDeliveredModal po={po} lines={lines} onConfirm={handleMarkOrderDelivered} onClose={() => setShowMarkDeliveredModal(false)} busy={actionBusy} />}
      {showDocumentModal && <AttachDocumentModal onSave={handleAttachDocument} onClose={() => setShowDocumentModal(false)} busy={documentsBusy} />}
      {showReprocessModal && <ReprocessPOModal po={po} onSave={handleReprocessUpload} onClose={() => setShowReprocessModal(false)} busy={actionBusy} />}
      {showDeleteModal && <DeleteOrderModal po={po} onConfirm={handleDeleteOrder} onClose={() => setShowDeleteModal(false)} busy={actionBusy} />}
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════
   MODALS
   ══════════════════════════════════════════════════════════════ */

function ModalBackdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-40 flex items-start justify-center overflow-y-auto rounded-xl bg-surface-base p-6" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-3xl animate-fade-up rounded-xl border border-outline-variant/10 bg-surface-container shadow-2xl">
        {children}
      </div>
    </div>
  );
}

function ETAModal({ currentETA, onSave, onClose, busy }: { currentETA: string; onSave: (d: string) => void; onClose: () => void; busy: boolean }) {
  const [date, setDate] = useState(toInputDate(currentETA));
  return (
    <ModalBackdrop onClose={onClose}>
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Ic name="edit_calendar" className="text-base text-primary" />
          <h3 className="text-sm font-semibold">Update ETA</h3>
        </div>
        <div>
          <label className="text-[0.6rem] text-outline uppercase tracking-wider block mb-1.5">New ETA Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-surface-high/30 border border-outline-variant/8 rounded-lg text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/20" />
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-medium text-outline hover:text-on-surface-variant rounded-md transition-colors">Cancel</button>
          <button onClick={() => date && onSave(date)} disabled={!date || busy}
            className="px-4 py-1.5 text-xs font-medium bg-primary/12 text-primary rounded-md hover:bg-primary/18 transition-colors disabled:opacity-40">Save</button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

function ExceptionModal({ onSave, onClose, busy }: { onSave: (r: string) => void; onClose: () => void; busy: boolean }) {
  const [reason, setReason] = useState("");
  return (
    <ModalBackdrop onClose={onClose}>
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Ic name="flag" className="text-base text-error" />
          <h3 className="text-sm font-semibold">Flag Exception</h3>
        </div>
        <p className="text-xs text-on-surface-variant">This will mark the order as <span className="font-semibold text-error">At Risk</span> and log the exception reason.</p>
        <div>
          <label className="text-[0.6rem] text-outline uppercase tracking-wider block mb-1.5">Reason</label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="Describe the issue..."
            className="w-full px-3 py-2 text-xs bg-surface-high/30 border border-outline-variant/8 rounded-lg text-on-surface placeholder:text-outline/30 focus:outline-none focus:ring-1 focus:ring-error/20 resize-none" />
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-medium text-outline hover:text-on-surface-variant rounded-md transition-colors">Cancel</button>
          <button onClick={() => reason.trim() && onSave(reason.trim())} disabled={!reason.trim() || busy}
            className="px-4 py-1.5 text-xs font-medium bg-error/12 text-error rounded-md hover:bg-error/18 transition-colors disabled:opacity-40">Flag Exception</button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

function AttachDocumentModal({ onSave, onClose, busy }: {
  onSave: (file: File, category: string, description: string) => Promise<void>;
  onClose: () => void;
  busy: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState("incoming_customer_po");
  const [description, setDescription] = useState("");

  return (
    <ModalBackdrop onClose={onClose}>
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Ic name="upload_file" className="text-base text-primary" />
          <h3 className="text-sm font-semibold">Attach Purchase Order Document</h3>
        </div>
        <p className="text-xs text-on-surface-variant">Attach source files and related evidence to this purchase order. Files are stored locally with auditable metadata.</p>

        <div>
          <label className="text-[0.6rem] text-outline uppercase tracking-wider block mb-1.5">Document</label>
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-outline-variant/15 bg-surface-low/20 px-4 py-6 text-center transition-colors hover:border-primary/25 hover:bg-primary/5">
            <Ic name={file ? "check_circle" : "cloud_upload"} className={`text-2xl ${file ? "text-success" : "text-outline/50"}`} />
            <span className="mt-2 text-xs font-semibold text-on-surface">{file ? file.name : "Choose file"}</span>
            <span className="mt-1 text-[0.6rem] text-outline">{file ? fmtBytes(file.size) : "PDF, XLSX, DOCX, CSV, TXT, images, or supplier documents"}</span>
            <input
              type="file"
              className="hidden"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="text-[0.6rem] text-outline uppercase tracking-wider block mb-1.5">Category</label>
            <select value={category} onChange={(event) => setCategory(event.target.value)}
              className="w-full rounded-lg border border-outline-variant/8 bg-surface-high/30 px-3 py-2 text-xs text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/20">
              {Object.entries(DOCUMENT_CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[0.6rem] text-outline uppercase tracking-wider block mb-1.5">Description</label>
            <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional note"
              className="w-full rounded-lg border border-outline-variant/8 bg-surface-high/30 px-3 py-2 text-xs text-on-surface placeholder:text-outline/30 focus:outline-none focus:ring-1 focus:ring-primary/20" />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-medium text-outline hover:text-on-surface-variant rounded-md transition-colors">Cancel</button>
          <button onClick={() => file && void onSave(file, category, description.trim())} disabled={!file || busy}
            className="px-4 py-1.5 text-xs font-medium bg-primary/12 text-primary rounded-md hover:bg-primary/18 transition-colors disabled:opacity-40">
            {busy ? "Attaching..." : "Attach Document"}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

function ReprocessPOModal({ po, onSave, onClose, busy }: {
  po: PurchaseOrder;
  onSave: (file: File) => Promise<void>;
  onClose: () => void;
  busy: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);

  return (
    <ModalBackdrop onClose={onClose}>
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Ic name="find_replace" className="text-base text-primary" />
          <h3 className="text-sm font-semibold">Reprocess Purchase Order File</h3>
        </div>
        <div className="space-y-2 text-xs text-on-surface-variant">
          <p>
            Replace the extracted header and line items for <span className="font-mono font-semibold text-on-surface">{po.poNumber}</span> from a source PO file.
          </p>
          <p className="rounded-lg border border-warning/15 bg-warning/8 px-3 py-2 text-[0.65rem] text-warning">
            Use this only before confirming the order. It recalculates the persisted line totals and order total; attached documents and activity history remain intact.
          </p>
        </div>
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-outline-variant/15 bg-surface-low/20 px-4 py-6 text-center transition-colors hover:border-primary/25 hover:bg-primary/5">
          <Ic name={file ? "check_circle" : "cloud_upload"} className={`text-2xl ${file ? "text-success" : "text-outline/50"}`} />
          <span className="mt-2 text-xs font-semibold text-on-surface">{file ? file.name : "Choose corrected PO file"}</span>
          <span className="mt-1 text-[0.6rem] text-outline">{file ? fmtBytes(file.size) : "PDF, XLSX, XLS, or CSV"}</span>
          <input
            type="file"
            accept=".pdf,.xlsx,.xls,.csv"
            className="hidden"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-medium text-outline hover:text-on-surface-variant rounded-md transition-colors">Cancel</button>
          <button onClick={() => file && void onSave(file)} disabled={!file || busy}
            className="px-4 py-1.5 text-xs font-medium bg-primary/12 text-primary rounded-md hover:bg-primary/18 transition-colors disabled:opacity-40">
            {busy ? "Reprocessing..." : "Replace Extracted Data"}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

function DeleteOrderModal({ po, onConfirm, onClose, busy }: {
  po: PurchaseOrder;
  onConfirm: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  const childCount = po.childOrders?.length ?? 0;

  return (
    <ModalBackdrop onClose={onClose}>
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Ic name="delete" className="text-base text-error" />
          <h3 className="text-sm font-semibold">Delete Purchase Order</h3>
        </div>
        <div className="space-y-2 text-xs text-on-surface-variant">
          <p>
            Delete <span className="font-mono font-semibold text-on-surface">{po.poNumber}</span> from the purchase order workspace and database.
          </p>
          {childCount > 0 && (
            <p className="rounded-lg border border-warning/15 bg-warning/8 px-3 py-2 text-[0.65rem] text-warning">
              This order has {childCount} linked supplier fulfillment order{childCount === 1 ? "" : "s"}. They will be deleted with the customer order unless finance records block the operation.
            </p>
          )}
          <p className="rounded-lg border border-error/15 bg-error/8 px-3 py-2 text-[0.65rem] text-error">
            Orders with accounting, invoice, or margin records are blocked from deletion and must be corrected through a controlled revision.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-medium text-outline hover:text-on-surface-variant rounded-md transition-colors">Cancel</button>
          <button onClick={onConfirm} disabled={busy}
            className="px-4 py-1.5 text-xs font-medium bg-error/12 text-error rounded-md hover:bg-error/18 transition-colors disabled:opacity-40">
            {busy ? "Deleting..." : "Delete Order"}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

function ConfirmOrderModal({ po, salesOrderNo, onConfirm, onClose, busy }: {
  po: PurchaseOrder;
  salesOrderNo: string | null;
  onConfirm: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  const isBuyerOrder = po.orderType === "BuyerPO";
  return (
    <ModalBackdrop onClose={onClose}>
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Ic name="task_alt" className="text-base text-primary" />
          <h3 className="text-sm font-semibold">{isBuyerOrder ? "Confirm Customer Purchase Order" : "Review Supplier Fulfillment PO"}</h3>
        </div>
        {isBuyerOrder ? (
          <div className="space-y-3 text-xs text-on-surface-variant">
            <p>
              Confirm <span className="font-mono font-semibold text-on-surface">{po.poNumber}</span> from <span className="font-semibold text-on-surface">{po.buyerName || po.vesselOwner || "the shipping company"}</span>.
            </p>
            <div className="rounded-lg border border-outline-variant/8 bg-surface-low/25 p-3">
              <p className="font-semibold text-on-surface">This will:</p>
              <ul className="mt-2 space-y-1 text-[0.65rem] text-outline">
                <li>+ generate or reuse an internal Nautex Sales Order number{salesOrderNo ? ` (${salesOrderNo})` : ""}</li>
                <li>+ mark the customer PO as confirmed and ready for procurement</li>
                <li>+ route lines to internal stock or supplier fulfillment</li>
                <li>+ create linked supplier POs in the background for Nautex operator review</li>
              </ul>
            </div>
          </div>
        ) : (
          <p className="text-xs text-on-surface-variant">
            Review supplier PO <span className="font-mono font-semibold text-on-surface">{po.poNumber}</span> for <span className="font-semibold text-on-surface">{po.supplier}</span>.
          </p>
        )}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-medium text-outline hover:text-on-surface-variant rounded-md transition-colors">Cancel</button>
          <button onClick={onConfirm} disabled={busy}
            className="px-4 py-1.5 text-xs font-medium bg-primary/12 text-primary rounded-md hover:bg-primary/18 transition-colors disabled:opacity-40">{busy ? "Confirming..." : "Confirm"}</button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

/* ══════════════════════════════════════════════════════════════
   TAB: OVERVIEW
   ══════════════════════════════════════════════════════════════ */

function RejectOrderModal({ po, onReject, onClose, busy }: {
  po: PurchaseOrder;
  onReject: (reason: string) => void;
  onClose: () => void;
  busy: boolean;
}) {
  const [reasonCode, setReasonCode] = useState("delivery_window_too_short");
  const [details, setDetails] = useState("");
  const reasonLabels: Record<string, string> = {
    delivery_window_too_short: "Requested delivery time is too short",
    delivery_location_not_serviceable: "Delivery location cannot be serviced",
    items_unavailable: "Requested items cannot be supplied",
    compliance_or_customs_blocked: "Compliance or customs issue",
    commercial_terms_not_accepted: "Commercial terms cannot be accepted",
    duplicate_or_cancelled_order: "Duplicate or cancelled customer order",
    other: "Other reason",
  };
  const reason = `${reasonLabels[reasonCode]}${details.trim() ? ` - ${details.trim()}` : ""}`;

  return (
    <ModalBackdrop onClose={onClose}>
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Ic name="block" className="text-base text-error" />
          <h3 className="text-sm font-semibold">Reject Customer Purchase Order</h3>
        </div>
        <div className="space-y-3 text-xs text-on-surface-variant">
          <p>
            Reject <span className="font-mono font-semibold text-on-surface">{po.poNumber}</span> from <span className="font-semibold text-on-surface">{po.buyerName || po.vesselOwner || "the shipping company"}</span>.
          </p>
          <p className="rounded-lg border border-error/15 bg-error/8 px-3 py-2 text-[0.65rem] text-error">
            This records a human decision. Nautex will not send a rejection notice automatically until outbound communications are connected.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="text-[0.6rem] text-outline uppercase tracking-wider block mb-1.5">Reason</label>
            <select value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}
              className="w-full rounded-lg border border-outline-variant/8 bg-surface-high/30 px-3 py-2 text-xs text-on-surface focus:outline-none focus:ring-1 focus:ring-error/20">
              {Object.entries(reasonLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[0.6rem] text-outline uppercase tracking-wider block mb-1.5">Operational Note</label>
            <input value={details} onChange={(event) => setDetails(event.target.value)} placeholder="Optional details for the activity log"
              className="w-full rounded-lg border border-outline-variant/8 bg-surface-high/30 px-3 py-2 text-xs text-on-surface placeholder:text-outline/30 focus:outline-none focus:ring-1 focus:ring-error/20" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-medium text-outline hover:text-on-surface-variant rounded-md transition-colors">Cancel</button>
          <button onClick={() => onReject(reason)} disabled={busy}
            className="px-4 py-1.5 text-xs font-medium bg-error/12 text-error rounded-md hover:bg-error/18 transition-colors disabled:opacity-40">{busy ? "Rejecting..." : "Reject Order"}</button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

function MarkDeliveredModal({ po, lines, onConfirm, onClose, busy }: {
  po: PurchaseOrder;
  lines: PurchaseOrderLine[];
  onConfirm: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  const totalOrdered = lines.reduce((sum, line) => sum + line.qtyOrdered, 0);
  const totalDelivered = lines.reduce((sum, line) => sum + line.qtyDelivered, 0);
  const remaining = Math.max(0, totalOrdered - totalDelivered);

  return (
    <ModalBackdrop onClose={onClose}>
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Ic name="inventory" className="text-base text-success" />
          <h3 className="text-sm font-semibold">Mark Order Delivered</h3>
        </div>
        <div className="space-y-3 text-xs text-on-surface-variant">
          <p>
            Complete delivery for <span className="font-mono font-semibold text-on-surface">{po.poNumber}</span>. This will set all open line quantities to delivered and update the order status.
          </p>
          <div className="grid grid-cols-3 gap-2">
            <ContextStat label="Ordered" value={`${totalOrdered} units`} />
            <ContextStat label="Delivered" value={`${totalDelivered} units`} />
            <ContextStat label="Remaining" value={`${remaining} units`} />
          </div>
          <p className="rounded-lg border border-warning/15 bg-warning/8 px-3 py-2 text-[0.65rem] text-warning">
            Later this will be driven by logistics scans and proof-of-delivery evidence. For now this is a controlled operator action.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-medium text-outline hover:text-on-surface-variant rounded-md transition-colors">Cancel</button>
          <button onClick={onConfirm} disabled={busy}
            className="px-4 py-1.5 text-xs font-medium bg-success/12 text-success rounded-md hover:bg-success/18 transition-colors disabled:opacity-40">{busy ? "Updating..." : "Mark Delivered"}</button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

function OverviewTab({ po, lineCount, deliveredLines, backorderedLines, onNoteAdd, onNoteEdit, onNoteDelete, onPatchPO, onRefresh }: {
  po: PurchaseOrder; lineCount: number; deliveredLines: number; backorderedLines: number;
  onNoteAdd: (text: string) => Promise<void>;
  onNoteEdit: (noteId: string, text: string) => Promise<void>;
  onNoteDelete: (noteId: string) => Promise<void>;
  onPatchPO: (data: Record<string, unknown>) => Promise<boolean>;
  onRefresh: () => void;
}) {
  const notes = po.orderNotes ?? [];
  const [newNote, setNewNote] = useState("");
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);

  // Margin editing
  const [editingMargin, setEditingMargin] = useState(false);
  const [marginVal, setMarginVal] = useState(String(po.marginPct));
  const marginRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingMargin && marginRef.current) { marginRef.current.focus(); marginRef.current.select(); }
  }, [editingMargin]);

  async function handleAddNote() {
    if (!newNote.trim() || noteBusy) return;
    setNoteBusy(true);
    await onNoteAdd(newNote.trim());
    setNewNote("");
    setNoteBusy(false);
  }

  async function handleEditNote(noteId: string) {
    if (!editText.trim() || noteBusy) return;
    setNoteBusy(true);
    await onNoteEdit(noteId, editText.trim());
    setEditingNote(null);
    setNoteBusy(false);
  }

  async function handleDeleteNote(noteId: string) {
    setNoteBusy(true);
    await onNoteDelete(noteId);
    setConfirmDelete(null);
    setNoteBusy(false);
  }

  async function handleMarginSave() {
    const newPct = parseFloat(marginVal);
    if (isNaN(newPct)) { setEditingMargin(false); return; }
    if (newPct === po.marginPct) { setEditingMargin(false); return; }
    const ok = await onPatchPO({ marginPct: newPct, marginOverride: true });
    if (ok) onRefresh();
    setEditingMargin(false);
  }

  async function handleToggleMarginMode() {
    if (po.marginOverride) {
      // Switch to auto - recalculate if costTotal exists
      if (po.costTotal && po.total > 0) {
        const computed = ((po.total - po.costTotal) / po.total) * 100;
        const ok = await onPatchPO({ marginOverride: false, marginPct: Math.round(computed * 10) / 10 });
        if (ok) onRefresh();
      } else {
        const ok = await onPatchPO({ marginOverride: false });
        if (ok) onRefresh();
      }
    } else {
      // Switch to manual
      await onPatchPO({ marginOverride: true });
      onRefresh();
    }
  }

  return (
    <div className="grid max-w-full grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0 space-y-4">
        <div className="grid grid-cols-2 gap-x-5 gap-y-3 md:grid-cols-3 xl:grid-cols-6">
          <Field label="PO Number" value={po.poNumber} mono />
          <Field label="Status" value={STATUS_LABELS[po.status]} badge={STATUS_STYLES[po.status]} />
          <Field label="Priority" value={po.priority} badge={PRIORITY_STYLES[po.priority]} />
          <Field label="Confirmation" value={CONFIRM_LABELS[po.confirmStatus]} badge={CONFIRM_STYLES[po.confirmStatus]} />
          <Field label="Created" value={fmtDate(po.createdAt)} />
          <Field label="Last Updated" value={fmtDate(po.updatedAt)} />
        </div>

        <FieldGroup title="Vessel Information" icon="directions_boat">
          <div className="grid grid-cols-1 gap-x-5 gap-y-3 md:grid-cols-3">
            <Field label="Vessel Name" value={po.vessel} />
            <Field label="IMO Number" value={po.vesselImo || "-"} mono />
            <Field label="Owner / Operator" value={po.vesselOwner || "-"} />
          </div>
        </FieldGroup>

        <FieldGroup title="Supplier" icon="storefront">
          <div className="grid grid-cols-1 gap-x-5 gap-y-3 md:grid-cols-3">
            <Field label="Supplier Name" value={po.supplier} />
            <Field
              label={po.orderType === "BuyerPO" ? "Nautex Sales Order" : "Linked Customer PO"}
              value={po.orderType === "SubPO" ? po.buyerRef || po.parentOrder?.poNumber || "-" : po.supplierRef || "-"}
              mono
            />
            <Field label="Port / Delivery" value={po.port || "-"} />
          </div>
        </FieldGroup>

        <CorePartyIdentityPanel erpCore={po.erpCore} />

        {/* Notes section */}
        <FieldGroup title="Notes" icon="notes">
          <div className="space-y-3">
            {notes.length === 0 && !newNote && (
              <p className="text-xs text-outline">No notes yet.</p>
            )}
            {notes.map(note => (
              <div key={note.id} className="group/note bg-surface-high/10 rounded-lg p-3 border border-outline-variant/5">
                {editingNote === note.id ? (
                  <div className="space-y-2">
                    <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={2}
                      className="w-full px-2.5 py-1.5 text-xs bg-surface-high/30 border border-primary/20 rounded-lg text-on-surface placeholder:text-outline/30 focus:outline-none focus:ring-1 focus:ring-primary/20 resize-none" autoFocus />
                    <div className="flex items-center justify-end gap-1.5">
                      <button onClick={() => setEditingNote(null)} className="px-2 py-1 text-[0.6rem] font-medium text-outline hover:text-on-surface-variant rounded transition-colors">Cancel</button>
                      <button onClick={() => handleEditNote(note.id)} disabled={!editText.trim() || noteBusy}
                        className="px-2.5 py-1 text-[0.6rem] font-medium bg-primary/12 text-primary rounded hover:bg-primary/18 transition-colors disabled:opacity-40">Save</button>
                    </div>
                  </div>
                ) : confirmDelete === note.id ? (
                  <div className="space-y-2">
                    <p className="text-xs text-on-surface-variant">Delete this note?</p>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => setConfirmDelete(null)} className="px-2 py-1 text-[0.6rem] font-medium text-outline hover:text-on-surface-variant rounded transition-colors">Cancel</button>
                      <button onClick={() => handleDeleteNote(note.id)} disabled={noteBusy}
                        className="px-2.5 py-1 text-[0.6rem] font-medium bg-error/12 text-error rounded hover:bg-error/18 transition-colors disabled:opacity-40">Delete</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-on-surface leading-relaxed whitespace-pre-line">{note.text}</p>
                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-center gap-2 text-[0.55rem] text-outline">
                        <span>{fmtDateTime(note.createdAt)}</span>
                        <span className="capitalize">{note.author}</span>
                        {note.updatedAt !== note.createdAt && <span className="italic">edited</span>}
                      </div>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover/note:opacity-100 transition-opacity">
                        <button onClick={() => { setEditingNote(note.id); setEditText(note.text); }} className="p-1 rounded hover:bg-surface-high/30 text-outline hover:text-on-surface-variant transition-colors">
                          <Ic name="edit" className="text-xs" />
                        </button>
                        <button onClick={() => setConfirmDelete(note.id)} className="p-1 rounded hover:bg-error/10 text-outline hover:text-error transition-colors">
                          <Ic name="delete" className="text-xs" />
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ))}

            {/* Add note inline */}
            <div className="flex items-start gap-2 pt-1">
              <textarea value={newNote} onChange={e => setNewNote(e.target.value)} rows={1} placeholder="Add a note..."
                className="flex-1 px-2.5 py-1.5 text-xs bg-surface-high/20 border border-outline-variant/8 rounded-lg text-on-surface placeholder:text-outline/30 focus:outline-none focus:ring-1 focus:ring-primary/20 focus:bg-surface-high/30 resize-none transition-all"
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAddNote(); } }}
              />
              <button onClick={handleAddNote} disabled={!newNote.trim() || noteBusy}
                className="px-3 py-1.5 text-[0.65rem] font-medium bg-primary/12 text-primary rounded-lg hover:bg-primary/18 transition-colors disabled:opacity-30 shrink-0">
                <Ic name="send" className="text-sm" />
              </button>
            </div>
          </div>
        </FieldGroup>
      </div>

      <div className="min-w-0 space-y-3">
        <div className="bg-surface-low/20 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[0.6rem] font-semibold text-outline uppercase tracking-wider">Financial Summary</p>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-on-surface-variant">Order Total</span>
            <span className="text-lg font-bold font-mono">{fmt(po.total, po.currency)}</span>
          </div>
          {po.costTotal != null && (
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-on-surface-variant">Cost Total</span>
              <span className="text-sm font-mono text-on-surface-variant">{fmt(po.costTotal, po.currency)}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-on-surface-variant">Margin</span>
              <button onClick={handleToggleMarginMode} title={po.marginOverride ? "Manual - click to switch to auto" : "Auto - click to switch to manual"}
                className={`text-[0.5rem] font-bold uppercase px-1.5 py-0.5 rounded-full transition-colors ${po.marginOverride ? "bg-warning/10 text-warning" : "bg-surface-high/40 text-outline"}`}>
                {po.marginOverride ? "manual" : "auto"}
              </button>
            </div>
            {editingMargin ? (
              <div className="flex items-center gap-1">
                <input ref={marginRef} type="number" step="0.1" value={marginVal} onChange={e => setMarginVal(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleMarginSave(); if (e.key === "Escape") setEditingMargin(false); }}
                  onBlur={handleMarginSave}
                  className="w-16 px-1.5 py-0.5 text-sm text-right bg-primary/8 border border-primary/25 rounded text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/30 font-mono font-semibold" />
                <span className="text-sm font-mono text-outline">%</span>
              </div>
            ) : (
              <EditableCell onClick={() => { setMarginVal(String(po.marginPct)); setEditingMargin(true); }} align="right">
                <span className={`text-sm font-mono font-semibold ${po.marginPct < 5 ? "text-error" : po.marginPct < 10 ? "text-warning" : "text-success"}`}>{po.marginPct.toFixed(1)}%</span>
              </EditableCell>
            )}
          </div>
          {lineCount > 0 && (
            <div className="flex items-baseline justify-between pt-2 border-t border-outline-variant/6">
              <span className="text-xs text-on-surface-variant">Line Items</span>
              <span className="text-sm font-mono">{lineCount}</span>
            </div>
          )}
        </div>

        <div className="bg-surface-low/20 rounded-lg p-4 space-y-3">
          <p className="text-[0.6rem] font-semibold text-outline uppercase tracking-wider">Key Dates</p>
          <DateRow label="Requested" date={po.requestedDate} />
          <DateRow label="ETA" date={po.eta} highlight />
          <DateRow label="Confirmed" date={po.confirmedDate} />
          <DateRow label="Created" date={po.createdAt} />
        </div>

        <CoreProvenanceCard erpCore={po.erpCore} />

        {lineCount > 0 && (
          <div className="bg-surface-low/20 rounded-lg p-4 space-y-2">
            <p className="text-[0.6rem] font-semibold text-outline uppercase tracking-wider">Lines Summary</p>
            <div className="flex items-center justify-between text-xs">
              <span className="text-on-surface-variant">Total Lines</span>
              <span className="font-mono">{lineCount}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-on-surface-variant">Delivered</span>
              <span className="font-mono text-success">{deliveredLines}</span>
            </div>
            {backorderedLines > 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-on-surface-variant">Backordered</span>
                <span className="font-mono text-error">{backorderedLines}</span>
              </div>
            )}
            <div className="pt-2 border-t border-outline-variant/6">
              <div className="h-1.5 bg-surface-high/30 rounded-full overflow-hidden">
                <div className="h-full bg-success rounded-full transition-all" style={{ width: `${(deliveredLines / lineCount) * 100}%` }} />
              </div>
              <p className="text-[0.55rem] text-outline mt-1">{Math.round((deliveredLines / lineCount) * 100)}% delivered</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   TAB: ORDER LINES (EDITABLE + RISK MARKERS)
   ══════════════════════════════════════════════════════════════ */

function CorePartyIdentityPanel({ erpCore }: { erpCore?: PurchaseOrderErpCoreReadModel }) {
  const unavailable = erpCore?.available === false;
  const supplier = unavailable ? null : erpCore?.parties?.supplier ?? null;
  const buyer = unavailable ? null : erpCore?.parties?.buyer ?? null;

  return (
    <FieldGroup title="Party Identity" icon="hub">
      {unavailable ? (
        <div className="rounded-lg border border-warning/15 bg-warning/8 px-3 py-2 text-[0.65rem] text-warning" title={erpCore?.error}>
          ERP Core unavailable.
        </div>
      ) : (
        <div className="space-y-3">
          <PartyIdentityRow label="Supplier" link={supplier} fallback="No supplier Party link" />
          <PartyIdentityRow label="Buyer" link={buyer} fallback="No buyer Party link" />
        </div>
      )}
    </FieldGroup>
  );
}

function PartyIdentityRow({ label, link, fallback }: { label: string; link: ErpCorePartyLink | null; fallback: string }) {
  const party = link?.party ?? null;
  return (
    <div className="flex flex-col gap-3 border-b border-outline-variant/6 pb-3 last:border-b-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="text-[0.55rem] font-medium uppercase tracking-wider text-outline">{label}</p>
        {link ? (
          <>
            <p className="mt-0.5 truncate text-xs font-semibold text-on-surface" title={party?.displayName ?? link.sourceName}>
              {party?.displayName ?? link.sourceName}
            </p>
            <p className="mt-0.5 truncate text-[0.6rem] text-outline" title={party?.legalName ?? link.sourceName}>
              {party?.legalName ?? link.sourceName}
            </p>
          </>
        ) : (
          <p className="mt-0.5 text-xs text-outline">{fallback}</p>
        )}
      </div>
      {link && (
        <div className="w-full min-w-0 text-left sm:w-auto sm:shrink-0 sm:text-right">
          <Badge className={party ? "bg-success/8 text-success" : "bg-surface-high/35 text-on-surface-variant"}>
            {party ? formatCodeLabel(party.status) : "Unlinked"}
          </Badge>
          <p className="mt-1 truncate font-mono text-[0.55rem] text-outline">{party?.id.slice(0, 8) ?? link.sourceCode ?? link.sourceId.slice(0, 8)}</p>
          <p className="mt-0.5 max-w-full truncate text-[0.55rem] text-outline sm:max-w-[9rem]" title={party ? partyRolesLabel(link) : link.sourceModel}>
            {party ? partyRolesLabel(link) : formatCodeLabel(link.sourceModel)}
          </p>
        </div>
      )}
    </div>
  );
}

function CoreProvenanceCard({ erpCore }: { erpCore?: PurchaseOrderErpCoreReadModel }) {
  const provenance = erpCore?.available === false ? null : erpCore?.provenance ?? null;
  const sourceFileName = metadataText(provenance?.metadata, "sourceFileName");
  const confidence = metadataText(provenance?.metadata, "confidence");
  const warningCount = metadataText(provenance?.metadata, "warningCount");
  const humanReviewRequired = metadataText(provenance?.metadata, "humanReviewRequired");

  return (
    <div className="bg-surface-low/20 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.6rem] font-semibold text-outline uppercase tracking-wider">ERP Provenance</p>
        <Badge className={provenanceBadgeClass(provenance)}>{provenance ? formatCodeLabel(provenance.kind) : "Untagged"}</Badge>
      </div>

      {erpCore?.available === false ? (
        <div className="rounded-lg border border-warning/15 bg-warning/8 px-3 py-2 text-[0.65rem] text-warning" title={erpCore.error}>
          ERP Core unavailable.
        </div>
      ) : provenance ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-on-surface-variant">Source</span>
            <span className="truncate font-medium text-on-surface" title={provenance.source ?? "-"}>{formatCodeLabel(provenance.source)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-on-surface-variant">Scenario</span>
            <span className="truncate font-medium text-on-surface" title={provenance.scenario ?? "-"}>{formatCodeLabel(provenance.scenario)}</span>
          </div>
          {sourceFileName && (
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-on-surface-variant">File</span>
              <span className="truncate font-mono text-[0.65rem] text-on-surface" title={sourceFileName}>{sourceFileName}</span>
            </div>
          )}
          {confidence && (
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-on-surface-variant">Confidence</span>
              <span className="font-mono text-on-surface">{confidence}%</span>
            </div>
          )}
          {warningCount && (
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-on-surface-variant">Warnings</span>
              <span className="font-mono text-on-surface">{warningCount}</span>
            </div>
          )}
          {humanReviewRequired && (
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-on-surface-variant">Human Review</span>
              <span className="font-medium text-on-surface">{humanReviewRequired === "true" ? "Required" : "Not required"}</span>
            </div>
          )}
          <div className="border-t border-outline-variant/6 pt-2">
            <DateRow label="Tagged" date={provenance.createdAt} />
          </div>
        </div>
      ) : (
        <p className="text-xs text-outline">No provenance tag recorded for this order.</p>
      )}
    </div>
  );
}

function LinesTab({ lines, currency, orderId, onLineUpdate }: {
  lines: PurchaseOrderLine[]; currency: string; orderId: string;
  onLineUpdate: (lineId: string, data: Record<string, unknown>) => Promise<boolean>;
}) {
  const [editingCell, setEditingCell] = useState<{ lineId: string; field: string } | null>(null);

  if (lines.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-14 text-center">
        <div className="w-11 h-11 rounded-xl bg-surface-highest/20 flex items-center justify-center mb-3">
          <Ic name="list_alt" className="text-xl text-outline" />
        </div>
        <p className="text-sm font-medium text-on-surface-variant mb-0.5">No order lines</p>
        <p className="text-xs text-outline">Line items will appear here once they are added to this purchase order.</p>
      </div>
    );
  }

  const totalValue = lines.reduce((s, l) => s + l.lineTotal, 0);
  const totalQty = lines.reduce((s, l) => s + l.qtyOrdered, 0);
  const totalConfirmed = lines.reduce((s, l) => s + (l.qtyConfirmed ?? 0), 0);
  const totalDelivered = lines.reduce((s, l) => s + l.qtyDelivered, 0);
  const totalRemaining = Math.max(0, totalQty - totalDelivered);
  const riskLines = lines.filter(l => {
    const status = effectiveLineStatus(l);
    return status === "Backordered" || (l.requestedDate && isOverdue(l.requestedDate) && status !== "Delivered" && status !== "Cancelled");
  });

  function startEdit(lineId: string, field: string) {
    setEditingCell({ lineId, field });
  }

  async function commitEdit(lineId: string, field: string, value: string | number | null) {
    setEditingCell(null);
    const line = lines.find(l => l.id === lineId);
    if (!line) return;
    const currentVal = (line as unknown as Record<string, unknown>)[field];
    let finalValue: unknown = value;
    if (["qtyOrdered", "qtyConfirmed", "qtyDelivered", "unitPrice"].includes(field)) {
      finalValue = value === "" || value === null ? (field === "qtyConfirmed" ? null : 0) : Number(value);
      if (typeof finalValue === "number" && isNaN(finalValue)) return;
    }
    if (finalValue === currentVal) return;
    if (finalValue === "" && (currentVal === null || currentVal === "-")) return;
    await onLineUpdate(lineId, { [field]: finalValue });
  }

  /** Compute risk flags for a line */
  function lineRisk(line: PurchaseOrderLine): { type: "overdue" | "backordered" | null; label: string } {
    const status = effectiveLineStatus(line);
    if (status === "Backordered") return { type: "backordered", label: "Backordered" };
    if (line.requestedDate && isOverdue(line.requestedDate) && status !== "Delivered" && status !== "Cancelled") {
      return { type: "overdue", label: "Overdue" };
    }
    return { type: null, label: "" };
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-on-surface-variant">{lines.length} line{lines.length !== 1 ? "s" : ""}</span>
          <span className="text-[0.55rem] text-outline">·</span>
          <span className="text-xs font-mono text-on-surface-variant">{totalQty} units</span>
          <span className="text-[0.55rem] text-outline">·</span>
          <span className="text-xs font-mono font-medium">{fmt(totalValue, currency)}</span>
          {riskLines.length > 0 && (
            <>
              <span className="text-[0.55rem] text-outline">·</span>
              <span className="text-[0.6rem] font-medium text-error flex items-center gap-1">
                <Ic name="warning" className="text-xs" />
                {riskLines.length} at risk
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Ic name="edit" className="text-xs text-outline/40" />
          <span className="text-[0.55rem] text-outline">Click any cell to edit</span>
        </div>
      </div>

      <div className="overflow-x-auto -mx-5">
        <table className="min-w-[1480px] w-full table-fixed text-left text-xs">
          <thead className="bg-surface-low/30 text-outline uppercase text-[0.55rem] font-medium tracking-wider">
            <tr>
              <th className="px-4 py-2.5 w-12">#</th>
              <th className="px-2 py-2.5 w-8"></th>
              <th className="px-4 py-2.5 w-28">Item Code</th>
              <th className="px-4 py-2.5 w-72">Description</th>
              <th className="px-4 py-2.5 w-32">Supplier P/N</th>
              <th className="px-4 py-2.5 w-24 text-right">Ordered</th>
              <th className="px-4 py-2.5 w-24 text-right">Confirmed</th>
              <th className="px-4 py-2.5 w-24 text-right">Delivered</th>
              <th className="px-4 py-2.5 w-24 text-right">Remaining</th>
              <th className="px-4 py-2.5 w-20">UoM</th>
              <th className="px-4 py-2.5 w-28 text-right">Unit Price</th>
              <th className="px-4 py-2.5 w-28 text-right">Line Total</th>
              <th className="px-4 py-2.5 w-28">Req. Date</th>
              <th className="px-4 py-2.5 w-28">Conf. Date</th>
              <th className="px-4 py-2.5 w-28">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/4">
            {lines.map(line => {
              const remaining = line.qtyOrdered - line.qtyDelivered;
              const displayStatus = effectiveLineStatus(line);
              const risk = lineRisk(line);
              const isEd = (field: string) => editingCell?.lineId === line.id && editingCell?.field === field;

              return (
                <tr key={line.id} className={`hover:bg-surface-high/10 transition-colors group ${risk.type ? "bg-error/[0.02]" : ""}`}>
                  <td className="px-4 py-3 font-mono text-outline">{line.lineNumber}</td>

                  {/* Risk marker column */}
                  <td className="px-2 py-3">
                    {risk.type && (
                      <span title={risk.label} className="flex items-center">
                        <Ic name={risk.type === "backordered" ? "inventory_2" : "schedule"} className="text-xs text-error" />
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-3 font-mono text-[0.7rem]">
                    {isEd("itemCode") ? (
                      <InlineInput value={line.itemCode || ""} onCommit={v => commitEdit(line.id, "itemCode", v)} autoFocus />
                    ) : (
                      <EditableCell onClick={() => startEdit(line.id, "itemCode")}>{line.itemCode || "-"}</EditableCell>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    {isEd("description") ? (
                      <InlineInput value={line.description} onCommit={v => commitEdit(line.id, "description", v)} autoFocus />
                    ) : (
                      <EditableCell onClick={() => startEdit(line.id, "description")}>
                        <span className="line-clamp-1">{line.description}</span>
                        {line.remarks && <p className="text-[0.6rem] text-outline mt-0.5 line-clamp-1">{line.remarks}</p>}
                      </EditableCell>
                    )}
                  </td>

                  <td className="px-4 py-3 font-mono text-on-surface-variant text-[0.65rem]">
                    {isEd("supplierPartNo") ? (
                      <InlineInput value={line.supplierPartNo || ""} onCommit={v => commitEdit(line.id, "supplierPartNo", v)} autoFocus />
                    ) : (
                      <EditableCell onClick={() => startEdit(line.id, "supplierPartNo")}>{line.supplierPartNo || "-"}</EditableCell>
                    )}
                  </td>

                  <td className="px-4 py-3 text-right font-mono">
                    {isEd("qtyOrdered") ? (
                      <InlineInput value={String(line.qtyOrdered)} type="number" onCommit={v => commitEdit(line.id, "qtyOrdered", v)} autoFocus align="right" />
                    ) : (
                      <EditableCell onClick={() => startEdit(line.id, "qtyOrdered")} align="right">{line.qtyOrdered}</EditableCell>
                    )}
                  </td>

                  <td className="px-4 py-3 text-right font-mono">
                    {isEd("qtyConfirmed") ? (
                      <InlineInput value={line.qtyConfirmed != null ? String(line.qtyConfirmed) : ""} type="number" onCommit={v => commitEdit(line.id, "qtyConfirmed", v === "" ? null : v)} autoFocus align="right" />
                    ) : (
                      <EditableCell onClick={() => startEdit(line.id, "qtyConfirmed")} align="right">{line.qtyConfirmed != null ? line.qtyConfirmed : "-"}</EditableCell>
                    )}
                  </td>

                  <td className="px-4 py-3 text-right font-mono">
                    {isEd("qtyDelivered") ? (
                      <InlineInput value={String(line.qtyDelivered)} type="number" onCommit={v => commitEdit(line.id, "qtyDelivered", v)} autoFocus align="right" />
                    ) : (
                      <EditableCell onClick={() => startEdit(line.id, "qtyDelivered")} align="right">
                        <span className={remaining > 0 && line.qtyDelivered > 0 ? "text-warning" : remaining === 0 && line.qtyOrdered > 0 ? "text-success" : ""}>
                          {line.qtyDelivered}
                        </span>
                      </EditableCell>
                    )}
                  </td>

                  {/* Remaining - computed, not editable */}
                  <td className="px-4 py-3 text-right font-mono">
                    <span className={`${remaining > 0 ? "text-warning" : "text-outline"}`}>
                      {remaining > 0 ? remaining : "-"}
                    </span>
                  </td>

                  <td className="px-4 py-3 text-on-surface-variant">
                    {isEd("uom") ? (
                      <InlineInput value={line.uom} onCommit={v => commitEdit(line.id, "uom", v)} autoFocus />
                    ) : (
                      <EditableCell onClick={() => startEdit(line.id, "uom")}>{line.uom}</EditableCell>
                    )}
                  </td>

                  <td className="px-4 py-3 text-right font-mono">
                    {isEd("unitPrice") ? (
                      <InlineInput value={String(line.unitPrice)} type="number" onCommit={v => commitEdit(line.id, "unitPrice", v)} autoFocus align="right" />
                    ) : (
                      <EditableCell onClick={() => startEdit(line.id, "unitPrice")} align="right">{fmt(line.unitPrice, line.currency)}</EditableCell>
                    )}
                  </td>

                  <td className="px-4 py-3 text-right font-mono font-medium">{fmt(line.lineTotal, line.currency)}</td>

                  <td className="px-4 py-3 text-on-surface-variant">
                    {isEd("requestedDate") ? (
                      <InlineInput value={toInputDate(line.requestedDate)} type="date" onCommit={v => commitEdit(line.id, "requestedDate", v || null)} autoFocus />
                    ) : (
                      <EditableCell onClick={() => startEdit(line.id, "requestedDate")}>
                        <span className={line.requestedDate && isOverdue(line.requestedDate) && displayStatus !== "Delivered" ? "text-error" : ""}>{fmtDate(line.requestedDate)}</span>
                      </EditableCell>
                    )}
                  </td>

                  <td className="px-4 py-3 text-on-surface-variant">
                    {isEd("confirmedDate") ? (
                      <InlineInput value={toInputDate(line.confirmedDate)} type="date" onCommit={v => commitEdit(line.id, "confirmedDate", v || null)} autoFocus />
                    ) : (
                      <EditableCell onClick={() => startEdit(line.id, "confirmedDate")}>{fmtDate(line.confirmedDate)}</EditableCell>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    {isEd("status") ? (
                      <InlineSelect value={displayStatus} options={ALL_LINE_STATUSES.map(s => ({ value: s, label: LINE_STATUS_LABELS[s], style: LINE_STATUS_STYLES[s] }))} onCommit={v => commitEdit(line.id, "status", v)} autoFocus />
                    ) : (
                      <EditableCell onClick={() => startEdit(line.id, "status")}>
                        <Badge className={LINE_STATUS_STYLES[displayStatus]}>{LINE_STATUS_LABELS[displayStatus]}</Badge>
                      </EditableCell>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-outline-variant/8 bg-surface-low/20">
            <tr>
              <td colSpan={5} className="px-4 py-2.5 text-xs font-medium text-on-surface-variant">Total</td>
              <td className="px-4 py-2.5 text-right font-mono font-medium text-xs">{totalQty}</td>
              <td className="px-4 py-2.5 text-right font-mono font-medium text-xs">{totalConfirmed || "-"}</td>
              <td className="px-4 py-2.5 text-right font-mono font-medium text-xs">{totalDelivered || "-"}</td>
              <td className="px-4 py-2.5 text-right font-mono font-medium text-xs">{totalRemaining || "-"}</td>
              <td colSpan={2} />
              <td className="px-4 py-2.5 text-right font-mono font-bold text-xs">{fmt(totalValue, currency)}</td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/* ── Inline Edit Components ──────────────────────────────────── */

function EditableCell({ children, onClick, align }: { children: React.ReactNode; onClick: () => void; align?: "right" }) {
  return (
    <div onClick={onClick}
      className={`cursor-pointer rounded px-1 -mx-1 py-0.5 -my-0.5 hover:bg-primary/6 hover:ring-1 hover:ring-primary/15 transition-all group/cell ${align === "right" ? "text-right" : ""}`}>
      {children}
      <Ic name="edit" className="text-[0.5rem] text-transparent group-hover/cell:text-primary/40 ml-1 inline-block align-middle" />
    </div>
  );
}

function InlineInput({ value, type = "text", onCommit, autoFocus, align }: {
  value: string; type?: string; onCommit: (v: string) => void; autoFocus?: boolean; align?: "right";
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [val, setVal] = useState(value);

  useEffect(() => {
    if (autoFocus && ref.current) {
      ref.current.focus();
      ref.current.select();
    }
  }, [autoFocus]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") onCommit(val);
    if (e.key === "Escape") onCommit(value);
  }

  return (
    <input ref={ref} type={type} value={val} onChange={e => setVal(e.target.value)}
      onBlur={() => onCommit(val)} onKeyDown={handleKeyDown}
      className={`w-full px-1.5 py-0.5 text-xs bg-primary/8 border border-primary/25 rounded text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/30 font-mono ${align === "right" ? "text-right" : ""}`}
      style={{ minWidth: type === "number" ? 50 : type === "date" ? 130 : 60 }}
    />
  );
}

function InlineSelect({ value, options, onCommit }: {
  value: string; options: { value: string; label: string; style?: string }[]; onCommit: (v: string) => void; autoFocus?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        onCommit(value);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") { setOpen(false); onCommit(value); }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => { document.removeEventListener("mousedown", handleClickOutside); document.removeEventListener("keydown", handleEscape); };
  }, [value, onCommit]);

  const selectedOpt = options.find(o => o.value === value);

  return (
    <div ref={containerRef} className="relative">
      <button onClick={() => setOpen(!open)}
        className="px-2 py-1 text-[0.6rem] bg-primary/8 border border-primary/25 rounded text-on-surface font-medium flex items-center gap-1.5 min-w-[90px]">
        <span className="flex-1 text-left">{selectedOpt?.label || value}</span>
        <Ic name="expand_more" className="text-xs text-outline" />
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 min-w-[140px] bg-surface-container rounded-lg border border-outline-variant/10 shadow-xl py-1 animate-fade-up">
          {options.map(o => (
            <button key={o.value} onClick={() => { onCommit(o.value); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-[0.6rem] font-medium flex items-center gap-2 transition-colors ${
                o.value === value
                  ? "bg-primary/10 text-primary"
                  : "text-on-surface-variant hover:bg-surface-high/20 hover:text-on-surface"
              }`}>
              {o.style && <span className={`${o.style} px-1.5 py-0.5 rounded-full text-[0.5rem] font-bold uppercase`}>{o.label}</span>}
              {!o.style && o.label}
              {o.value === value && <Ic name="check" className="text-xs text-primary ml-auto" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   TAB: DELIVERY (ENHANCED WITH PER-LINE BREAKDOWN)
   ══════════════════════════════════════════════════════════════ */

function DeliveryTab({ po, lines, onPatchPO, onLineUpdate, onRefresh, actionBusy }: {
  po: PurchaseOrder; lines: PurchaseOrderLine[];
  onPatchPO: (data: Record<string, unknown>) => Promise<boolean>;
  onLineUpdate: (lineId: string, data: Record<string, unknown>) => Promise<boolean>;
  onRefresh: () => void; actionBusy: boolean;
}) {
  const totalOrdered = lines.reduce((s, l) => s + l.qtyOrdered, 0);
  const totalDelivered = lines.reduce((s, l) => s + l.qtyDelivered, 0);
  const totalConfirmed = lines.reduce((s, l) => s + (l.qtyConfirmed ?? 0), 0);
  const totalBackordered = lines.filter(l => l.status === "Backordered").reduce((s, l) => s + (l.qtyOrdered - l.qtyDelivered), 0);
  const totalPending = totalOrdered - totalDelivered;
  const deliveryPct = totalOrdered > 0 ? Math.round((totalDelivered / totalOrdered) * 100) : 0;
  const confirmPct = totalOrdered > 0 ? Math.round((totalConfirmed / totalOrdered) * 100) : 0;
  const days = daysUntil(po.eta);

  return (
    <div className="space-y-5">
      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MiniStat label="Delivery Progress" value={`${deliveryPct}%`} sub={`${totalDelivered} of ${totalOrdered} units`} />
        <MiniStat label="Confirmed" value={`${confirmPct}%`} sub={`${totalConfirmed} of ${totalOrdered} units`} tone={confirmPct === 100 ? "neutral" : "warn"} />
        <MiniStat label="Pending" value={String(totalPending)} sub={totalPending > 0 ? "units awaiting delivery" : "All delivered"} tone={totalPending > 0 ? "warn" : "neutral"} />
        <MiniStat label="Backordered" value={String(totalBackordered)} sub={totalBackordered > 0 ? "units pending" : "No backorders"} tone={totalBackordered > 0 ? "danger" : "neutral"} />
        <MiniStat label="ETA" value={fmtDate(po.eta)} sub={days < 0 ? `${Math.abs(days)} days overdue` : days === 0 ? "Due today" : `${days} days remaining`} tone={days < 0 ? "danger" : days <= 3 ? "warn" : "neutral"} />
      </div>

      {/* Delivery progress bar */}
      {totalOrdered > 0 && (
        <div className="bg-surface-low/20 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-on-surface-variant">Overall Delivery</span>
            <span className="text-xs font-mono font-medium">{deliveryPct}%</span>
          </div>
          <div className="h-2 bg-surface-high/30 rounded-full overflow-hidden">
            <div className="h-full bg-success rounded-full transition-all duration-500" style={{ width: `${deliveryPct}%` }} />
          </div>
          {confirmPct < 100 && (
            <div className="mt-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[0.6rem] text-outline">Supplier Confirmation</span>
                <span className="text-[0.6rem] font-mono text-outline">{confirmPct}%</span>
              </div>
              <div className="h-1 bg-surface-high/30 rounded-full overflow-hidden">
                <div className="h-full bg-primary/60 rounded-full transition-all duration-500" style={{ width: `${confirmPct}%` }} />
              </div>
            </div>
          )}
        </div>
      )}

      {po.orderType === "BuyerPO"
        ? <CustomerDeliveriesPanel po={po} lines={lines} onRefresh={onRefresh} />
        : <GoodsReceiptsPanel po={po} lines={lines} onRefresh={onRefresh} />}

      {/* Key dates - editable */}
      <DeliveryDatesEditor po={po} onPatchPO={onPatchPO} onRefresh={onRefresh} actionBusy={actionBusy} />

      {/* Port / Destination - editable */}
      <DeliveryPortEditor po={po} onPatchPO={onPatchPO} onRefresh={onRefresh} />

      {/* Per-line delivery breakdown - editable qty delivered */}
      {lines.length > 0 && (
        <DeliveryBreakdownTable orderId={po.id} lines={lines} onLineUpdate={onLineUpdate} />
      )}
    </div>
  );
}

function GoodsReceiptsPanel({ po, lines, onRefresh }: { po: PurchaseOrder; lines: PurchaseOrderLine[]; onRefresh: () => void }) {
  const [receipts, setReceipts] = useState<GoodsReceiptSummary[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [deliveryNote, setDeliveryNote] = useState("");
  const [warehouse, setWarehouse] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadReceipts = useCallback(async () => {
    try {
      const response = await fetch(`/api/v1/purchase-orders/${encodeURIComponent(po.id)}/goods-receipts`);
      const payload = await response.json() as { ok?: boolean; data?: GoodsReceiptSummary[]; error?: { message?: string } };
      if (!response.ok || payload.ok === false) throw new Error(payload.error?.message || "Failed to load goods receipts.");
      setReceipts(payload.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load goods receipts.");
    }
  }, [po.id]);

  useEffect(() => {
    void loadReceipts();
  }, [loadReceipts]);

  const createReceipt = useCallback(async () => {
    const receiptLines = lines.flatMap((line) => {
      const quantity = Number(quantities[line.id] ?? 0);
      return Number.isFinite(quantity) && quantity > 0 ? [{ purchaseOrderLineId: line.id, quantity }] : [];
    });
    if (receiptLines.length === 0) {
      setError("Enter at least one received quantity.");
      return;
    }
    setBusy("create");
    setError(null);
    try {
      const response = await fetch(`/api/v1/purchase-orders/${encodeURIComponent(po.id)}/goods-receipts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": `goods-receipt-${crypto.randomUUID()}` },
        body: JSON.stringify({ supplierDeliveryNote: deliveryNote, warehouse, lines: receiptLines }),
      });
      const payload = await response.json() as { ok?: boolean; error?: { message?: string } };
      if (!response.ok || payload.ok === false) throw new Error(payload.error?.message || "Failed to create goods receipt.");
      setQuantities({});
      setDeliveryNote("");
      await loadReceipts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create goods receipt.");
    } finally {
      setBusy(null);
    }
  }, [deliveryNote, lines, loadReceipts, po.id, quantities, warehouse]);

  const transitionReceipt = useCallback(async (receipt: GoodsReceiptSummary, action: "post" | "cancel") => {
    setBusy(receipt.id);
    setError(null);
    try {
      const response = await fetch(`/api/v1/goods-receipts/${encodeURIComponent(receipt.id)}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": `goods-receipt-${action}-${receipt.id}` },
        body: JSON.stringify({ action }),
      });
      const payload = await response.json() as { ok?: boolean; error?: { message?: string } };
      if (!response.ok || payload.ok === false) throw new Error(payload.error?.message || `Failed to ${action} goods receipt.`);
      await loadReceipts();
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} goods receipt.`);
    } finally {
      setBusy(null);
    }
  }, [loadReceipts, onRefresh]);

  return (
    <FieldGroup title="Goods Receipts" icon="inventory_2">
      <div className="space-y-4">
        <div className="grid gap-2 md:grid-cols-2">
          <input value={deliveryNote} onChange={(event) => setDeliveryNote(event.target.value)} placeholder="Supplier delivery note"
            className="rounded-lg border border-outline-variant/8 bg-surface-high/25 px-3 py-2 text-xs text-on-surface placeholder:text-outline/35 focus:outline-none focus:ring-1 focus:ring-primary/20" />
          <input value={warehouse} onChange={(event) => setWarehouse(event.target.value)} placeholder="Receiving location"
            className="rounded-lg border border-outline-variant/8 bg-surface-high/25 px-3 py-2 text-xs text-on-surface placeholder:text-outline/35 focus:outline-none focus:ring-1 focus:ring-primary/20" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[0.55rem] uppercase text-outline">
              <tr><th className="py-2">Line</th><th className="py-2">Item</th><th className="py-2 text-right">Remaining</th><th className="py-2 text-right">Receive</th></tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/4">
              {lines.map((line) => {
                const remaining = Math.max(0, line.qtyOrdered - line.qtyDelivered);
                return (
                  <tr key={line.id}>
                    <td className="py-2 font-mono text-outline">{line.lineNumber}</td>
                    <td className="py-2 text-on-surface-variant">{line.description}</td>
                    <td className="py-2 text-right font-mono">{remaining} {line.uom}</td>
                    <td className="py-2 text-right">
                      <input type="number" min="0" max={remaining} step="any" disabled={remaining <= 0 || busy !== null}
                        value={quantities[line.id] ?? ""} onChange={(event) => setQuantities((current) => ({ ...current, [line.id]: event.target.value }))}
                        className="w-24 rounded-md border border-outline-variant/8 bg-surface-high/25 px-2 py-1 text-right font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary/20 disabled:opacity-40" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-3">
          {error ? <span className="text-[0.65rem] text-error">{error}</span> : <span />}
          <button onClick={() => void createReceipt()} disabled={busy !== null || lines.every((line) => line.qtyDelivered >= line.qtyOrdered)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[0.65rem] font-semibold text-on-primary hover:brightness-110 disabled:opacity-40">
            <Ic name={busy === "create" ? "progress_activity" : "add"} className={`text-sm ${busy === "create" ? "animate-spin" : ""}`} />Create draft
          </button>
        </div>

        {receipts.length > 0 && (
          <div className="space-y-2 border-t border-outline-variant/6 pt-3">
            {receipts.map((receipt) => (
              <div key={receipt.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-outline-variant/6 bg-surface-low/20 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[0.65rem] font-semibold">{receipt.receiptNumber ?? receipt.id.slice(0, 10)}</span>
                    <Badge className={receipt.status === "posted" ? "bg-success/10 text-success" : receipt.status === "cancelled" ? "bg-surface-high/40 text-outline" : "bg-warning/10 text-warning"}>{receipt.status}</Badge>
                  </div>
                  <p className="mt-1 text-[0.6rem] text-outline">{receipt.lines.length} line{receipt.lines.length === 1 ? "" : "s"} | {receipt.lines.reduce((sum, line) => sum + line.quantity, 0)} units | {fmtDate(receipt.receivedAt)}</p>
                </div>
                {receipt.status === "draft" && (
                  <div className="flex gap-2">
                    <button onClick={() => void transitionReceipt(receipt, "post")} disabled={busy !== null} className="rounded-md bg-success/10 px-2.5 py-1 text-[0.6rem] font-semibold text-success hover:bg-success/15 disabled:opacity-40">Post</button>
                    <button onClick={() => void transitionReceipt(receipt, "cancel")} disabled={busy !== null} className="rounded-md bg-surface-high/30 px-2.5 py-1 text-[0.6rem] font-semibold text-outline hover:text-on-surface-variant disabled:opacity-40">Cancel</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </FieldGroup>
  );
}

function CustomerDeliveriesPanel({ po, lines, onRefresh }: { po: PurchaseOrder; lines: PurchaseOrderLine[]; onRefresh: () => void }) {
  const [deliveries, setDeliveries] = useState<DeliverySummary[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [scheduledAt, setScheduledAt] = useState(po.eta.slice(0, 10));
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [recipients, setRecipients] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadDeliveries = useCallback(async () => {
    try {
      const response = await fetch(`/api/v1/purchase-orders/${encodeURIComponent(po.id)}/deliveries`);
      const payload = await response.json() as { ok?: boolean; data?: DeliverySummary[]; error?: { message?: string } };
      if (!response.ok || payload.ok === false) throw new Error(payload.error?.message || "Failed to load deliveries.");
      setDeliveries(payload.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load deliveries.");
    }
  }, [po.id]);

  useEffect(() => {
    void loadDeliveries();
  }, [loadDeliveries]);

  const createDeliveryDraft = useCallback(async () => {
    const deliveryLines = lines.flatMap((line) => {
      const quantity = Number(quantities[line.id] ?? 0);
      return Number.isFinite(quantity) && quantity > 0 ? [{ purchaseOrderLineId: line.id, quantity }] : [];
    });
    if (deliveryLines.length === 0) {
      setError("Enter at least one delivery quantity.");
      return;
    }
    setBusy("create");
    setError(null);
    try {
      const response = await fetch(`/api/v1/purchase-orders/${encodeURIComponent(po.id)}/deliveries`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": `delivery-create-${crypto.randomUUID()}` },
        body: JSON.stringify({ scheduledAt: scheduledAt || null, deliveryAddress, port: po.port, lines: deliveryLines }),
      });
      const payload = await response.json() as { ok?: boolean; error?: { message?: string } };
      if (!response.ok || payload.ok === false) throw new Error(payload.error?.message || "Failed to create delivery.");
      setQuantities({});
      await loadDeliveries();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create delivery.");
    } finally {
      setBusy(null);
    }
  }, [deliveryAddress, lines, loadDeliveries, po.id, po.port, quantities, scheduledAt]);

  const transition = useCallback(async (delivery: DeliverySummary, action: "ready" | "dispatch" | "deliver" | "cancel") => {
    const deliveredToName = recipients[delivery.id]?.trim() || null;
    if (action === "deliver" && !deliveredToName) {
      setError("Recipient name is required to complete delivery.");
      return;
    }
    setBusy(delivery.id);
    setError(null);
    try {
      const response = await fetch(`/api/v1/deliveries/${encodeURIComponent(delivery.id)}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": `delivery-${action}-${delivery.id}` },
        body: JSON.stringify({ action, deliveredToName }),
      });
      const payload = await response.json() as { ok?: boolean; error?: { message?: string } };
      if (!response.ok || payload.ok === false) throw new Error(payload.error?.message || `Failed to ${action} delivery.`);
      await loadDeliveries();
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} delivery.`);
    } finally {
      setBusy(null);
    }
  }, [loadDeliveries, onRefresh, recipients]);

  const activeCommitted = useMemo(() => {
    const values = new Map<string, number>();
    for (const delivery of deliveries) {
      if (!["draft", "ready", "dispatched"].includes(delivery.status)) continue;
      for (const line of delivery.lines) values.set(line.purchaseOrderLineId, (values.get(line.purchaseOrderLineId) ?? 0) + line.quantity);
    }
    return values;
  }, [deliveries]);

  return (
    <FieldGroup title="Customer Deliveries" icon="local_shipping">
      <div className="space-y-4">
        <div className="grid gap-2 md:grid-cols-2">
          <input type="date" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)}
            className="rounded-lg border border-outline-variant/8 bg-surface-high/25 px-3 py-2 text-xs text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/20" />
          <input value={deliveryAddress} onChange={(event) => setDeliveryAddress(event.target.value)} placeholder="Delivery address or berth"
            className="rounded-lg border border-outline-variant/8 bg-surface-high/25 px-3 py-2 text-xs text-on-surface placeholder:text-outline/35 focus:outline-none focus:ring-1 focus:ring-primary/20" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[0.55rem] uppercase text-outline">
              <tr><th className="py-2">Line</th><th className="py-2">Item</th><th className="py-2 text-right">Available</th><th className="py-2 text-right">Deliver</th></tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/4">
              {lines.map((line) => {
                const available = Math.max(0, line.qtyOrdered - line.qtyDelivered - (activeCommitted.get(line.id) ?? 0));
                return (
                  <tr key={line.id}>
                    <td className="py-2 font-mono text-outline">{line.lineNumber}</td>
                    <td className="py-2 text-on-surface-variant">{line.description}</td>
                    <td className="py-2 text-right font-mono">{available} {line.uom}</td>
                    <td className="py-2 text-right">
                      <input type="number" min="0" max={available} step="any" disabled={available <= 0 || busy !== null}
                        value={quantities[line.id] ?? ""} onChange={(event) => setQuantities((current) => ({ ...current, [line.id]: event.target.value }))}
                        className="w-24 rounded-md border border-outline-variant/8 bg-surface-high/25 px-2 py-1 text-right font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary/20 disabled:opacity-40" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-3">
          {error ? <span className="text-[0.65rem] text-error">{error}</span> : <span />}
          <button onClick={() => void createDeliveryDraft()} disabled={busy !== null || lines.every((line) => line.qtyDelivered >= line.qtyOrdered)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[0.65rem] font-semibold text-on-primary hover:brightness-110 disabled:opacity-40">
            <Ic name={busy === "create" ? "progress_activity" : "add"} className={`text-sm ${busy === "create" ? "animate-spin" : ""}`} />Create delivery
          </button>
        </div>

        {deliveries.length > 0 && (
          <div className="space-y-2 border-t border-outline-variant/6 pt-3">
            {deliveries.map((delivery) => (
              <div key={delivery.id} className="rounded-lg border border-outline-variant/6 bg-surface-low/20 px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[0.65rem] font-semibold">{delivery.deliveryNumber ?? delivery.id.slice(0, 10)}</span>
                      <Badge className={delivery.status === "delivered" ? "bg-success/10 text-success" : delivery.status === "cancelled" ? "bg-surface-high/40 text-outline" : delivery.status === "dispatched" ? "bg-primary/10 text-primary" : "bg-warning/10 text-warning"}>{delivery.status}</Badge>
                    </div>
                    <p className="mt-1 text-[0.6rem] text-outline">{delivery.lines.length} line{delivery.lines.length === 1 ? "" : "s"} | {delivery.lines.reduce((sum, line) => sum + line.quantity, 0)} units | {delivery.scheduledAt ? fmtDate(delivery.scheduledAt) : "Unscheduled"}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {delivery.status === "draft" && <button onClick={() => void transition(delivery, "ready")} disabled={busy !== null} className="rounded-md bg-warning/10 px-2.5 py-1 text-[0.6rem] font-semibold text-warning disabled:opacity-40">Mark ready</button>}
                    {delivery.status === "ready" && <button onClick={() => void transition(delivery, "dispatch")} disabled={busy !== null} className="rounded-md bg-primary/10 px-2.5 py-1 text-[0.6rem] font-semibold text-primary disabled:opacity-40">Dispatch</button>}
                    {(delivery.status === "draft" || delivery.status === "ready") && <button onClick={() => void transition(delivery, "cancel")} disabled={busy !== null} className="rounded-md bg-surface-high/30 px-2.5 py-1 text-[0.6rem] font-semibold text-outline disabled:opacity-40">Cancel</button>}
                  </div>
                </div>
                {delivery.status === "dispatched" && (
                  <div className="mt-2 flex flex-wrap items-center justify-end gap-2 border-t border-outline-variant/5 pt-2">
                    <input value={recipients[delivery.id] ?? ""} onChange={(event) => setRecipients((current) => ({ ...current, [delivery.id]: event.target.value }))} placeholder="Recipient name"
                      className="w-48 rounded-md border border-outline-variant/8 bg-surface-high/25 px-2.5 py-1.5 text-[0.65rem] placeholder:text-outline/35 focus:outline-none focus:ring-1 focus:ring-primary/20" />
                    <button onClick={() => void transition(delivery, "deliver")} disabled={busy !== null} className="rounded-md bg-success/10 px-2.5 py-1.5 text-[0.6rem] font-semibold text-success disabled:opacity-40">Confirm delivered</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </FieldGroup>
  );
}

/* ══════════════════════════════════════════════════════════════
   TAB: ACTIVITY (REAL EVENT TIMELINE)
   ══════════════════════════════════════════════════════════════ */

function DocumentsTab({ orderId, documents, erpCore, loading, busy, onAttach, onDelete }: {
  orderId: string;
  documents: PurchaseOrderDocument[];
  erpCore?: PurchaseOrderErpCoreReadModel;
  loading: boolean;
  busy: boolean;
  onAttach: () => void;
  onDelete: (documentId: string) => Promise<void>;
}) {
  const registryUnavailable = erpCore?.available === false;
  const registryLinks = registryUnavailable ? [] : erpCore?.documentLinks ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Ic name="attach_file" className="text-sm text-primary" />
            <h4 className="text-xs font-semibold text-on-surface">Purchase Order Documents</h4>
            <Badge className="bg-surface-high/40 text-on-surface-variant">{documents.length}</Badge>
          </div>
          <p className="mt-1 text-[0.65rem] text-outline">Attach incoming customer POs, supplier confirmations, delivery evidence, invoices, and correspondence to this order.</p>
        </div>
        <button onClick={onAttach} disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[0.65rem] font-semibold text-on-primary transition-all hover:brightness-110 disabled:opacity-50">
          <Ic name="upload_file" className="text-sm" />
          Attach Document
        </button>
      </div>

      {loading ? (
        <div className="rounded-xl border border-outline-variant/8 bg-surface-low/20 p-8 text-center">
          <div className="mx-auto h-5 w-5 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
          <p className="mt-3 text-xs text-outline">Loading attached documents</p>
        </div>
      ) : documents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-outline-variant/15 bg-surface-low/15 p-8 text-center">
          <Ic name="description" className="text-2xl text-outline/40" />
          <p className="mt-2 text-sm font-semibold text-on-surface">No documents attached yet</p>
          <p className="mt-1 text-xs text-outline">Use attachments to keep PO source files, confirmations, delivery proof, and supplier documents in one audit trail.</p>
          <button onClick={onAttach} disabled={busy}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary/12 px-3.5 py-2 text-[0.65rem] font-semibold text-primary transition-colors hover:bg-primary/18 disabled:opacity-50">
            <Ic name="upload_file" className="text-sm" />
            Attach First Document
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-outline-variant/8">
          <table className="w-full text-left text-xs">
            <thead className="bg-surface-low/25 text-[0.6rem] uppercase tracking-wider text-outline">
              <tr>
                <th className="px-4 py-2.5">Document</th>
                <th className="px-4 py-2.5">Category</th>
                <th className="px-4 py-2.5">Size</th>
                <th className="px-4 py-2.5">Uploaded</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/5 bg-surface-container/35">
              {documents.map((document) => (
                <tr key={document.id} className="transition-colors hover:bg-surface-high/15">
                  <td className="px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/8 text-primary">
                        <Ic name="description" className="text-sm" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-on-surface" title={document.fileName}>{document.fileName}</p>
                        {document.description && <p className="mt-0.5 line-clamp-1 text-[0.6rem] text-outline">{document.description}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-on-surface-variant">{DOCUMENT_CATEGORY_LABELS[document.category] ?? document.category}</td>
                  <td className="px-4 py-3 font-mono text-outline">{fmtBytes(document.sizeBytes)}</td>
                  <td className="px-4 py-3">
                    <p className="font-mono text-[0.65rem] text-on-surface-variant">{fmtDateTime(document.createdAt)}</p>
                    <p className="text-[0.55rem] capitalize text-outline">{document.uploadedBy}</p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => void openNautexDocument(`/api/v1/purchase-orders/${orderId}/documents/${document.id}`)}
                        className="rounded-md bg-surface-high/25 px-2.5 py-1.5 text-[0.6rem] font-semibold text-on-surface-variant transition-colors hover:bg-surface-high/45"
                      >
                        Download
                      </button>
                      <button
                        onClick={() => void onDelete(document.id)}
                        disabled={busy}
                        className="rounded-md bg-error/8 px-2.5 py-1.5 text-[0.6rem] font-semibold text-error transition-colors hover:bg-error/14 disabled:opacity-40"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CoreDocumentRegistry links={registryLinks} unavailable={registryUnavailable} error={erpCore?.error} />
    </div>
  );
}

function CoreDocumentRegistry({ links, unavailable, error }: { links: ErpCoreDocumentLink[]; unavailable: boolean; error?: string }) {
  return (
    <div className="space-y-3 rounded-xl border border-outline-variant/8 bg-surface-low/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Ic name="inventory_2" className="text-sm text-primary" />
          <h4 className="text-xs font-semibold text-on-surface">ERP Registry</h4>
          <Badge className="bg-primary/8 text-primary">{links.length}</Badge>
        </div>
        <span className="text-[0.55rem] uppercase tracking-wider text-outline">Read only</span>
      </div>

      {unavailable ? (
        <div className="rounded-lg border border-warning/15 bg-warning/8 px-3 py-2 text-[0.65rem] text-warning" title={error}>
          ERP registry unavailable.
        </div>
      ) : links.length === 0 ? (
        <div className="rounded-lg border border-dashed border-outline-variant/12 bg-surface-container/25 px-3 py-4 text-center">
          <Ic name="inventory_2" className="text-lg text-outline/40" />
          <p className="mt-1 text-xs font-medium text-on-surface-variant">No registry documents linked yet</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-outline-variant/8">
          <table className="w-full text-left text-xs">
            <thead className="bg-surface-low/25 text-[0.55rem] uppercase tracking-wider text-outline">
              <tr>
                <th className="px-3 py-2">Document</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Link</th>
                <th className="px-3 py-2">Registry</th>
                <th className="px-3 py-2">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/5 bg-surface-container/30">
              {links.map((link) => {
                const document = link.document;
                return (
                  <tr key={link.id} className="transition-colors hover:bg-surface-high/15">
                    <td className="px-3 py-2.5">
                      <p className="max-w-[16rem] truncate font-semibold text-on-surface" title={coreDocumentTitle(link)}>{coreDocumentTitle(link)}</p>
                      <p className="mt-0.5 font-mono text-[0.55rem] text-outline">{document.documentNo || document.id}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge className="bg-surface-high/35 text-on-surface-variant">{formatCodeLabel(document.documentType)}</Badge>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-on-surface-variant">{formatCodeLabel(link.linkRole)}</p>
                      <p className="mt-0.5 text-[0.55rem] text-outline">{formatCodeLabel(link.sourceModule)}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="font-mono text-[0.6rem] text-on-surface-variant">{fmtBytes(document.sizeBytes)}</p>
                      <p className="mt-0.5 font-mono text-[0.55rem] text-outline">sha {shortHash(document.checksumSha256)}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="font-mono text-[0.6rem] text-on-surface-variant">{fmtDateTime(link.createdAt)}</p>
                      <p className="mt-0.5 text-[0.55rem] text-outline">{formatCodeLabel(document.status)}</p>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ActivityTab({ po, events, erpCore }: { po: PurchaseOrder; events: PurchaseOrderEvent[]; erpCore?: PurchaseOrderErpCoreReadModel }) {
  // Always include the system "created" entry from PO timestamps
  const hasCreatedEvent = events.some(e => e.type === "created");
  const auditUnavailable = erpCore?.available === false;
  const auditEvents = auditUnavailable ? [] : erpCore?.auditEvents ?? [];

  return (
    <div className="space-y-4">
      {/* Event count */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Ic name="history" className="text-sm text-outline/60" />
          <span className="text-xs font-medium text-on-surface-variant">{events.length + (hasCreatedEvent ? 0 : 1)} event{events.length + (hasCreatedEvent ? 0 : 1) !== 1 ? "s" : ""}</span>
        </div>
        <span className="text-[0.55rem] text-outline">Newest first</span>
      </div>

      {/* Event timeline */}
      <div className="space-y-0">
        {events.map((event, idx) => (
          <EventRow key={event.id} event={event} isFirst={idx === 0} isLast={idx === events.length - 1 && hasCreatedEvent} />
        ))}

        {/* System-generated "created" event from PO timestamps */}
        {!hasCreatedEvent && (
          <EventRow
            event={{
              id: "__created",
              orderId: po.id,
              type: "created" as POEventType,
              summary: `Purchase order ${po.poNumber} created`,
              detail: `Vessel: ${po.vessel} · Supplier: ${po.supplier} · Total: ${fmt(po.total, po.currency)}`,
              actor: "system",
              createdAt: po.createdAt,
            }}
            isFirst={events.length === 0}
            isLast
          />
        )}
      </div>

      {/* Empty state hint */}
      {events.length === 0 && (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <Ic name="history" className="text-lg text-outline/40 mb-2" />
          <p className="text-xs text-outline">Actions on this order will be recorded here automatically.</p>
          <p className="text-[0.55rem] text-outline mt-1">Try approving the order, updating the ETA, or adding a note.</p>
        </div>
      )}

      <CoreAuditTimeline events={auditEvents} unavailable={auditUnavailable} error={erpCore?.error} />
    </div>
  );
}

function CoreAuditTimeline({ events, unavailable, error }: { events: ErpCoreAuditEvent[]; unavailable: boolean; error?: string }) {
  return (
    <div className="space-y-3 rounded-xl border border-outline-variant/8 bg-surface-low/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Ic name="policy" className="text-sm text-primary" />
          <h4 className="text-xs font-semibold text-on-surface">ERP Audit</h4>
          <Badge className="bg-primary/8 text-primary">{events.length}</Badge>
        </div>
        <span className="text-[0.55rem] uppercase tracking-wider text-outline">Read only</span>
      </div>

      {unavailable ? (
        <div className="rounded-lg border border-warning/15 bg-warning/8 px-3 py-2 text-[0.65rem] text-warning" title={error}>
          ERP audit unavailable.
        </div>
      ) : events.length === 0 ? (
        <div className="rounded-lg border border-dashed border-outline-variant/12 bg-surface-container/25 px-3 py-4 text-center">
          <Ic name="policy" className="text-lg text-outline/40" />
          <p className="mt-1 text-xs font-medium text-on-surface-variant">No ERP audit events recorded yet</p>
        </div>
      ) : (
        <div className="space-y-0">
          {events.map((event, index) => (
            <CoreAuditRow key={event.id} event={event} isLast={index === events.length - 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function CoreAuditRow({ event, isLast }: { event: ErpCoreAuditEvent; isLast: boolean }) {
  const change = formatAuditChange(event);

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/8 text-primary">
          <Ic name={event.aiAssisted ? "smart_toy" : "verified_user"} className="text-sm" />
        </div>
        {!isLast && <div className="min-h-[16px] flex-1 w-px bg-outline-variant/8" />}
      </div>
      <div className={`flex-1 ${isLast ? "" : "pb-4"}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-medium text-on-surface">{formatCodeLabel(event.eventType)}</p>
              {event.aiAssisted && <Badge className="bg-primary/8 text-primary">AI Assisted</Badge>}
            </div>
            <p className="mt-0.5 text-[0.6rem] text-outline">{formatCodeLabel(event.sourceModule)} / {formatAuditActor(event)}</p>
            {change && <p className="mt-1 line-clamp-2 text-[0.6rem] text-on-surface-variant">{change}</p>}
          </div>
          <div className="shrink-0 text-right">
            <p className="font-mono text-[0.6rem] text-outline">{fmtDateTime(event.createdAt)}</p>
            <p className="text-[0.5rem] text-outline/60">{event.requestId || event.agentRunId || event.id.slice(0, 8)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function EventRow({ event, isFirst, isLast }: { event: PurchaseOrderEvent; isFirst: boolean; isLast: boolean }) {
  const iconName = EVENT_ICONS[event.type as POEventType] || "info";
  const colorClass = EVENT_COLORS[event.type as POEventType] || "text-outline bg-surface-high/40";
  const [iconColor, iconBg] = colorClass.split(" ");

  return (
    <div className="flex gap-3 group">
      {/* Timeline connector */}
      <div className="flex flex-col items-center">
        <div className={`w-7 h-7 rounded-lg ${iconBg} flex items-center justify-center shrink-0 z-10`}>
          <Ic name={iconName} className={`text-sm ${iconColor}`} />
        </div>
        {!isLast && <div className="w-px flex-1 bg-outline-variant/8 min-h-[16px]" />}
      </div>

      {/* Content */}
      <div className={`flex-1 pb-4 ${isLast ? "" : ""}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-on-surface leading-snug">{event.summary}</p>
            {event.detail && (
              <p className="text-[0.6rem] text-outline mt-0.5 line-clamp-2">{event.detail}</p>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="text-[0.6rem] font-mono text-outline">{fmtDateTime(event.createdAt)}</p>
            <p className="text-[0.5rem] text-outline/60 capitalize">{event.actor}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   DELIVERY SUB-COMPONENTS (EDITABLE)
   ══════════════════════════════════════════════════════════════ */

function DeliveryDatesEditor({ po, onPatchPO, onRefresh, actionBusy }: {
  po: PurchaseOrder; onPatchPO: (data: Record<string, unknown>) => Promise<boolean>; onRefresh: () => void; actionBusy: boolean;
}) {
  const [editField, setEditField] = useState<string | null>(null);
  const [dateVal, setDateVal] = useState("");
  const days = daysUntil(po.eta);

  async function saveDate(field: string) {
    if (!dateVal) { setEditField(null); return; }
    const currentVal = toInputDate(field === "eta" ? po.eta : field === "requestedDate" ? po.requestedDate : po.confirmedDate);
    if (dateVal === currentVal) { setEditField(null); return; }
    const ok = await onPatchPO({ [field]: dateVal });
    if (ok) onRefresh();
    setEditField(null);
  }

  function startEdit(field: string, current: string | null) {
    setEditField(field);
    setDateVal(toInputDate(current));
  }

  return (
    <FieldGroup title="Delivery Timeline" icon="timeline">
      <div className="space-y-3">
        {([
          { field: "requestedDate", label: "Requested Delivery", icon: "event", value: po.requestedDate },
          { field: "eta", label: "ETA", icon: "schedule", value: po.eta },
          { field: "confirmedDate", label: "Confirmed Delivery", icon: "event_available", value: po.confirmedDate },
        ] as const).map(row => (
          <div key={row.field} className="flex items-center gap-3">
            <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${
              row.field === "eta" && days < 0 ? "bg-error/8" : row.field === "eta" && days >= 0 ? "bg-primary/8" : "bg-surface-high/30"
            }`}>
              <Ic name={row.icon} className={`text-sm ${row.field === "eta" && days < 0 ? "text-error" : row.field === "eta" && days >= 0 ? "text-primary" : "text-outline"}`} />
            </div>
            <div className="flex-1">
              <p className="text-xs font-medium">{row.label}</p>
              {editField === row.field ? (
                <input type="date" value={dateVal} onChange={e => setDateVal(e.target.value)} autoFocus disabled={actionBusy}
                  onBlur={() => saveDate(row.field)} onKeyDown={e => { if (e.key === "Enter") saveDate(row.field); if (e.key === "Escape") setEditField(null); }}
                  className="mt-0.5 px-2 py-1 text-[0.6rem] bg-primary/8 border border-primary/25 rounded text-on-surface font-mono focus:outline-none focus:ring-1 focus:ring-primary/30" />
              ) : (
                <EditableCell onClick={() => startEdit(row.field, row.value)}>
                  <span className={`text-[0.6rem] font-mono ${row.field === "eta" && days < 0 ? "text-error" : "text-outline"}`}>{fmtDate(row.value)}</span>
                </EditableCell>
              )}
            </div>
          </div>
        ))}
      </div>
    </FieldGroup>
  );
}

function DeliveryPortEditor({ po, onPatchPO, onRefresh }: {
  po: PurchaseOrder; onPatchPO: (data: Record<string, unknown>) => Promise<boolean>; onRefresh: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [portVal, setPortVal] = useState(po.port || "");

  async function save() {
    if (portVal === (po.port || "")) { setEditing(false); return; }
    const ok = await onPatchPO({ port: portVal || null });
    if (ok) onRefresh();
    setEditing(false);
  }

  return (
    <FieldGroup title="Destination" icon="anchor">
      <div>
        <p className="text-[0.55rem] font-medium text-outline uppercase tracking-wider mb-0.5">Port</p>
        {editing ? (
          <input type="text" value={portVal} onChange={e => setPortVal(e.target.value)} autoFocus
            onBlur={save} onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
            className="w-full max-w-xs px-2 py-1 text-xs bg-primary/8 border border-primary/25 rounded text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/30" />
        ) : (
          <EditableCell onClick={() => { setPortVal(po.port || ""); setEditing(true); }}>
            <span className="text-xs font-medium">{po.port || "-"}</span>
          </EditableCell>
        )}
      </div>
    </FieldGroup>
  );
}

function DeliveryBreakdownTable({ orderId, lines, onLineUpdate }: {
  orderId: string;
  lines: PurchaseOrderLine[];
  onLineUpdate: (lineId: string, data: Record<string, unknown>) => Promise<boolean>;
}) {
  const [editingCell, setEditingCell] = useState<{ lineId: string; field: string } | null>(null);
  const [reservations, setReservations] = useState<Record<string, ReservationLookup>>({});
  const [reservationModal, setReservationModal] = useState<{ line: PurchaseOrderLine; lookup: ReservationLookup } | null>(null);
  const [reservationBusy, setReservationBusy] = useState<string | null>(null);
  const [reservationError, setReservationError] = useState<string | null>(null);

  const loadReservation = useCallback(async (line: PurchaseOrderLine) => {
    const res = await fetch(`/api/v1/purchase-orders/${orderId}/lines/${line.id}/reservations`);
    const payload = (await res.json()) as { ok?: boolean; data?: ReservationLookup; error?: { message?: string } };
    if (!res.ok || payload.ok === false || !payload.data) throw new Error(payload.error?.message || "Reservation lookup failed.");
    setReservations((current) => ({ ...current, [line.id]: payload.data as ReservationLookup }));
    return payload.data;
  }, [orderId]);

  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      const entries = await Promise.all(
        lines.map(async (line) => {
          try {
            const res = await fetch(`/api/v1/purchase-orders/${orderId}/lines/${line.id}/reservations`);
            const payload = (await res.json()) as { ok?: boolean; data?: ReservationLookup };
            return [line.id, payload.ok !== false && payload.data ? payload.data : { reservation: null, candidates: [], recommendedQuantity: 0 }] as const;
          } catch {
            return [line.id, { reservation: null, candidates: [], recommendedQuantity: 0 }] as const;
          }
        }),
      );
      if (!cancelled) setReservations(Object.fromEntries(entries));
    }
    if (lines.length > 0) void loadAll();
    return () => { cancelled = true; };
  }, [lines, orderId]);

  async function openReservationModal(line: PurchaseOrderLine) {
    setReservationError(null);
    setReservationBusy(line.id);
    try {
      const lookup = await loadReservation(line);
      setReservationModal({ line, lookup });
    } catch (err) {
      setReservationError(err instanceof Error ? err.message : "Reservation lookup failed.");
    } finally {
      setReservationBusy(null);
    }
  }

  async function reserveCandidate(line: PurchaseOrderLine, candidate: ReservationCandidateSummary, quantity: number) {
    setReservationError(null);
    setReservationBusy(line.id);
    try {
      const res = await fetch(`/api/v1/purchase-orders/${orderId}/lines/${line.id}/reservations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inventoryItemId: candidate.id, quantity }),
      });
      const payload = (await res.json()) as { ok?: boolean; error?: { message?: string } };
      if (!res.ok || payload.ok === false) throw new Error(payload.error?.message || "Reservation failed.");
      await loadReservation(line);
      setReservationModal(null);
    } catch (err) {
      setReservationError(err instanceof Error ? err.message : "Reservation failed.");
    } finally {
      setReservationBusy(null);
    }
  }

  async function releaseReservation(line: PurchaseOrderLine) {
    setReservationError(null);
    setReservationBusy(line.id);
    try {
      const res = await fetch(`/api/v1/purchase-orders/${orderId}/lines/${line.id}/reservations`, { method: "DELETE" });
      const payload = (await res.json()) as { ok?: boolean; error?: { message?: string } };
      if (!res.ok || payload.ok === false) throw new Error(payload.error?.message || "Release failed.");
      await loadReservation(line);
    } catch (err) {
      setReservationError(err instanceof Error ? err.message : "Release failed.");
    } finally {
      setReservationBusy(null);
    }
  }

  async function commitEdit(lineId: string, field: string, value: string | number | null) {
    setEditingCell(null);
    const line = lines.find(l => l.id === lineId);
    if (!line) return;
    const currentVal = (line as unknown as Record<string, unknown>)[field];
    let finalValue: unknown = value;
    if (["qtyDelivered", "qtyConfirmed"].includes(field)) {
      finalValue = value === "" || value === null ? (field === "qtyConfirmed" ? null : 0) : Number(value);
      if (typeof finalValue === "number" && isNaN(finalValue)) return;
    }
    if (finalValue === currentVal) return;
    await onLineUpdate(lineId, { [field]: finalValue });
  }

  const isEd = (lineId: string, field: string) => editingCell?.lineId === lineId && editingCell?.field === field;

  return (
    <FieldGroup title="Line Delivery Breakdown" icon="assignment">
      <div className="overflow-x-auto -mx-4 -mb-4">
        <div className="flex items-center gap-1.5 px-4 pb-2">
          <Ic name="edit" className="text-xs text-outline/40" />
          <span className="text-[0.55rem] text-outline">Click delivered or status to edit</span>
          {reservationError && <span className="ml-2 text-[0.6rem] font-medium text-error">{reservationError}</span>}
        </div>
        <table className="w-full text-left text-xs">
          <thead className="bg-surface-low/20 text-outline uppercase text-[0.5rem] font-medium tracking-wider">
            <tr>
              <th className="px-4 py-2">#</th>
              <th className="px-4 py-2">Item</th>
              <th className="px-4 py-2 text-right">Ordered</th>
              <th className="px-4 py-2 text-right">Confirmed</th>
              <th className="px-4 py-2 text-right">Delivered</th>
              <th className="px-4 py-2 text-right">Pending</th>
              <th className="px-4 py-2">Inventory</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Conf. Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/4">
            {lines.map(line => {
              const rem = line.qtyOrdered - line.qtyDelivered;
              const pct = line.qtyOrdered > 0 ? Math.round((line.qtyDelivered / line.qtyOrdered) * 100) : 0;
              const displayStatus = effectiveLineStatus(line);
              const reservation = reservations[line.id]?.reservation ?? null;
              return (
                <tr key={line.id} className={`${displayStatus === "Backordered" ? "bg-error/[0.03]" : ""} hover:bg-surface-high/10 transition-colors`}>
                  <td className="px-4 py-2 font-mono text-outline">{line.lineNumber}</td>
                  <td className="px-4 py-2">
                    <span className="line-clamp-1">{line.itemCode ? `${line.itemCode} - ` : ""}{line.description}</span>
                  </td>
                  <td className="px-4 py-2 text-right font-mono">{line.qtyOrdered}</td>
                  <td className="px-4 py-2 text-right font-mono">{line.qtyConfirmed != null ? line.qtyConfirmed : "-"}</td>
                  <td className="px-4 py-2 text-right font-mono">
                    {isEd(line.id, "qtyDelivered") ? (
                      <InlineInput value={String(line.qtyDelivered)} type="number" onCommit={v => commitEdit(line.id, "qtyDelivered", v)} autoFocus align="right" />
                    ) : (
                      <EditableCell onClick={() => setEditingCell({ lineId: line.id, field: "qtyDelivered" })} align="right">
                        <span className={pct === 100 ? "text-success" : pct > 0 ? "text-warning" : ""}>{line.qtyDelivered}</span>
                      </EditableCell>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">
                    <span className={rem > 0 ? "text-warning font-medium" : "text-outline"}>{rem > 0 ? rem : "-"}</span>
                  </td>
                  <td className="px-4 py-2">
                    {reservation ? (
                      <div className="flex items-center gap-1.5">
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[0.55rem] font-bold uppercase text-primary">
                          {reservation.quantity} {reservation.stockUnit ?? line.uom} reserved
                        </span>
                        <button
                          onClick={() => void releaseReservation(line)}
                          disabled={reservationBusy === line.id}
                          className="rounded-md bg-surface-high/25 px-2 py-1 text-[0.55rem] font-semibold text-outline hover:text-on-surface-variant disabled:opacity-40"
                        >
                          Release
                        </button>
                      </div>
                    ) : rem > 0 ? (
                      <button
                        onClick={() => void openReservationModal(line)}
                        disabled={reservationBusy === line.id}
                        className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-[0.55rem] font-bold uppercase text-primary hover:bg-primary/16 disabled:opacity-40"
                      >
                        <Ic name="inventory_2" className="text-xs" />
                        {reservationBusy === line.id ? "Loading" : "Reserve"}
                      </button>
                    ) : (
                      <span className="text-outline">-</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {isEd(line.id, "status") ? (
                      <InlineSelect value={displayStatus} options={ALL_LINE_STATUSES.map(s => ({ value: s, label: LINE_STATUS_LABELS[s], style: LINE_STATUS_STYLES[s] }))} onCommit={v => commitEdit(line.id, "status", v)} autoFocus />
                    ) : (
                      <EditableCell onClick={() => setEditingCell({ lineId: line.id, field: "status" })}>
                        <Badge className={LINE_STATUS_STYLES[displayStatus]}>{LINE_STATUS_LABELS[displayStatus]}</Badge>
                      </EditableCell>
                    )}
                  </td>
                  <td className="px-4 py-2 text-on-surface-variant">
                    {isEd(line.id, "confirmedDate") ? (
                      <InlineInput value={toInputDate(line.confirmedDate)} type="date" onCommit={v => commitEdit(line.id, "confirmedDate", v || null)} autoFocus />
                    ) : (
                      <EditableCell onClick={() => setEditingCell({ lineId: line.id, field: "confirmedDate" })}>
                        {fmtDate(line.confirmedDate)}
                      </EditableCell>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {reservationModal && (
        <InventoryReservationModal
          line={reservationModal.line}
          lookup={reservationModal.lookup}
          busy={reservationBusy === reservationModal.line.id}
          error={reservationError}
          onClose={() => setReservationModal(null)}
          onReserve={reserveCandidate}
        />
      )}
    </FieldGroup>
  );
}

function InventoryReservationModal({ line, lookup, busy, error, onClose, onReserve }: {
  line: PurchaseOrderLine;
  lookup: ReservationLookup;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onReserve: (line: PurchaseOrderLine, candidate: ReservationCandidateSummary, quantity: number) => Promise<void>;
}) {
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(lookup.candidates.map((candidate) => [candidate.id, String(Math.min(lookup.recommendedQuantity, candidate.available / (candidate.stockPerOrderUnit || 1)))])),
  );

  return (
    <ModalBackdrop onClose={onClose}>
      <div className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Ic name="inventory_2" className="text-base text-primary" />
              <h3 className="text-sm font-semibold">Reserve Inventory</h3>
            </div>
            <p className="mt-1 text-xs text-on-surface-variant">Line {line.lineNumber}: {line.description}</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-outline hover:bg-surface-high/30"><Ic name="close" className="text-base" /></button>
        </div>

        {error && <p className="rounded-lg border border-error/15 bg-error/8 px-3 py-2 text-xs text-error">{error}</p>}

        {lookup.candidates.length === 0 ? (
          <div className="rounded-xl border border-dashed border-outline-variant/15 bg-surface-low/15 p-8 text-center">
            <p className="text-sm font-semibold text-on-surface">No matching stock found</p>
            <p className="mt-1 text-xs text-outline">Create or link an inventory item before reserving this line.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {lookup.candidates.map((candidate) => {
              const quantity = Number(quantities[candidate.id] || 0);
              const stockRequired = quantity * (candidate.stockPerOrderUnit || 1);
              const canReserve = !!candidate.stockPerOrderUnit && quantity > 0 && quantity <= lookup.recommendedQuantity && stockRequired <= candidate.available && Number.isInteger(stockRequired);
              return (
                <div key={candidate.id} className="rounded-xl border border-outline-variant/8 bg-surface-high/12 p-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-on-surface">{candidate.description}</p>
                      <p className="mt-1 text-[0.65rem] text-outline">
                        {candidate.itemCode || candidate.id.slice(0, 8)} - {candidate.warehouse}{candidate.locationBin ? ` / ${candidate.locationBin}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-on-surface-variant">{candidate.available} {candidate.uom} available · {candidate.stockPerOrderUnit ? `1 ${line.uom} = ${candidate.stockPerOrderUnit} ${candidate.uom}` : "Conversion needs approval"}</span>
                      <input
                        value={quantities[candidate.id] ?? ""}
                        onChange={(event) => setQuantities((current) => ({ ...current, [candidate.id]: event.target.value }))}
                        type="number"
                        aria-label={`Reserve quantity in ${line.uom}`}
                        min={0.000001}
                        step="any"
                        max={Math.min(lookup.recommendedQuantity, candidate.available / (candidate.stockPerOrderUnit || 1))}
                        className="w-20 rounded-md border border-outline-variant/10 bg-surface-high/30 px-2 py-1.5 text-right text-xs font-mono outline-none focus:border-primary/30"
                      />
                      <button
                        onClick={() => void onReserve(line, candidate, quantity)}
                        disabled={busy || !canReserve}
                        className="rounded-md bg-primary px-3 py-1.5 text-[0.65rem] font-semibold text-on-primary hover:brightness-110 disabled:opacity-40"
                      >
                        Reserve
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
}

/* ══════════════════════════════════════════════════════════════
   SHARED SUBCOMPONENTS
   ══════════════════════════════════════════════════════════════ */

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`${className} px-2 py-0.5 rounded-full text-[0.55rem] font-bold uppercase whitespace-nowrap`}>{children}</span>;
}

function Field({ label, value, mono, badge }: { label: string; value: string; mono?: boolean; badge?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[0.55rem] font-medium text-outline uppercase tracking-wider mb-0.5">{label}</p>
      {badge ? <Badge className={badge}>{value}</Badge> : <p className={`truncate text-xs font-medium ${mono ? "font-mono" : ""}`} title={value}>{value}</p>}
    </div>
  );
}

function FieldGroup({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-low/15 rounded-lg p-4">
      <div className="flex items-center gap-1.5 mb-3">
        <Ic name={icon} className="text-sm text-outline/60" />
        <p className="text-[0.6rem] font-semibold text-outline uppercase tracking-wider">{title}</p>
      </div>
      {children}
    </div>
  );
}

function MetricChip({ icon, label, sub, subTone = "neutral" }: { icon: string; label: string; sub?: string; subTone?: "danger" | "warn" | "neutral" }) {
  const tones = { danger: "text-error", warn: "text-warning", neutral: "text-outline" };
  return (
    <div className="flex min-w-0 max-w-full items-center gap-1.5">
      <Ic name={icon} className="text-sm text-outline/50" />
      <span className="truncate font-medium text-on-surface" title={label}>{label}</span>
      {sub && <span className={`shrink-0 text-[0.6rem] ${tones[subTone]}`}>{sub}</span>}
    </div>
  );
}

function DateRow({ label, date, highlight }: { label: string; date: string | null; highlight?: boolean }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <span className="min-w-0 truncate text-xs text-on-surface-variant">{label}</span>
      <span className={`shrink-0 text-xs font-mono ${highlight ? "font-semibold" : ""}`}>{fmtDate(date)}</span>
    </div>
  );
}

function TimelineRow({ label, date, icon, active, overdue }: { label: string; date: string | null; icon: string; active?: boolean; overdue?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${overdue ? "bg-error/8" : active ? "bg-primary/8" : "bg-surface-high/30"}`}>
        <Ic name={icon} className={`text-sm ${overdue ? "text-error" : active ? "text-primary" : "text-outline"}`} />
      </div>
      <div className="flex-1">
        <p className="text-xs font-medium">{label}</p>
        <p className={`text-[0.6rem] font-mono ${overdue ? "text-error" : "text-outline"}`}>{fmtDate(date)}</p>
      </div>
    </div>
  );
}

function MiniStat({ label, value, sub, tone = "neutral" }: { label: string; value: string; sub: string; tone?: "danger" | "warn" | "neutral" }) {
  const tones = { danger: "text-error", warn: "text-warning", neutral: "text-on-surface" };
  return (
    <div className="bg-surface-low/20 rounded-lg p-3">
      <p className="text-[0.55rem] text-outline uppercase tracking-wider mb-1.5">{label}</p>
      <p className={`text-base font-semibold font-mono ${tones[tone]}`}>{value}</p>
      <p className={`text-[0.55rem] mt-0.5 ${tone !== "neutral" ? tones[tone] : "text-outline"}`}>{sub}</p>
    </div>
  );
}

function ActionButton({ icon, label, primary, subtle, danger, onClick, disabled, notReady }: {
  icon: string; label: string; primary?: boolean; subtle?: boolean; danger?: boolean; onClick?: () => void; disabled?: boolean; notReady?: boolean;
}) {
  return (
    <button onClick={notReady ? undefined : onClick} disabled={disabled || notReady}
      title={notReady ? "Coming soon" : undefined}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-[0.65rem] font-medium rounded-md transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed ${
        primary ? "bg-primary/12 text-primary hover:bg-primary/18" :
        danger ? "bg-error/10 text-error hover:bg-error/16" :
        subtle ? "text-outline hover:text-on-surface-variant hover:bg-surface-high/20" :
        notReady ? "bg-surface-high/20 text-outline/50 cursor-not-allowed" :
        "bg-surface-high/30 text-on-surface-variant hover:bg-surface-high/50"
      }`}>
      <Ic name={icon} className="text-sm" />
      {label}
    </button>
  );
}

function SortTh({ label, field, current, order, onSort }: { label: string; field: SortField; current: SortField; order: SortOrder; onSort: (f: SortField) => void }) {
  const isActive = current === field;
  return (
    <th className="px-4 py-2.5 cursor-pointer hover:text-on-surface-variant transition-colors select-none" onClick={() => onSort(field)}>
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive && <Ic name={order === "asc" ? "arrow_upward" : "arrow_downward"} className="text-[0.6rem] text-primary" />}
      </span>
    </th>
  );
}

/* ── States ───────────────────────────────────────────────────── */

function SummaryCard({ label, value, icon, tone, active, onClick }: { label: string; value: number; icon: string; tone: "danger" | "warn" | "neutral"; active?: boolean; onClick?: () => void }) {
  const styles = {
    danger: { bg: "bg-error/5", border: "border-error/10", text: "text-error", iconBg: "bg-error/8" },
    warn: { bg: "bg-warning/5", border: "border-warning/10", text: "text-warning", iconBg: "bg-warning/8" },
    neutral: { bg: "bg-surface-container/50", border: "border-outline-variant/6", text: "text-on-surface", iconBg: "bg-surface-high/40" },
  };
  const s = styles[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={!!active}
      title={`Filter purchase orders by ${label}`}
      className={`group rounded-xl p-4 text-left transition-all border ${s.bg} ${active ? "ring-1 ring-primary/35 border-primary/25 shadow-[0_0_24px_rgba(78,222,163,0.08)]" : s.border} hover:border-primary/18 hover:brightness-110`}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-[0.65rem] font-medium text-on-surface-variant">{label}</span>
        <div className={`w-6 h-6 rounded-md ${s.iconBg} flex items-center justify-center`}><Ic name={icon} className={`text-sm ${s.text}`} /></div>
      </div>
      <p className={`text-xl font-semibold font-mono ${s.text}`}>{value}</p>
      <div className="mt-2 flex items-center gap-1 text-[0.55rem] font-semibold uppercase tracking-wider text-outline/60 group-hover:text-primary/80">
        <span>{active ? "Active filter" : "Click to filter"}</span>
        <Ic name={active ? "check" : "filter_list"} className="text-[0.65rem]" />
      </div>
    </button>
  );
}

function ListSkeleton() {
  return (
    <div className="p-5 space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex gap-4 animate-pulse">
          <div className="h-4 bg-surface-high/30 rounded w-20" />
          <div className="h-4 bg-surface-high/30 rounded w-24" />
          <div className="h-4 bg-surface-high/30 rounded flex-1" />
          <div className="h-4 bg-surface-high/30 rounded w-16" />
          <div className="h-4 bg-surface-high/30 rounded w-16" />
        </div>
      ))}
    </div>
  );
}

function WorkspaceSkeleton() {
  return (
    <section className="bg-surface-container/50 rounded-xl ghost-border overflow-hidden p-5">
      <div className="space-y-4 animate-pulse">
        <div className="h-6 bg-surface-high/30 rounded w-48" />
        <div className="h-4 bg-surface-high/30 rounded w-full" />
        <div className="h-4 bg-surface-high/30 rounded w-3/4" />
        <div className="grid grid-cols-3 gap-4 pt-4">
          <div className="h-20 bg-surface-high/30 rounded" />
          <div className="h-20 bg-surface-high/30 rounded" />
          <div className="h-20 bg-surface-high/30 rounded" />
        </div>
      </div>
    </section>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <div className="w-10 h-10 rounded-xl bg-error/8 flex items-center justify-center mb-3"><Ic name="cloud_off" className="text-lg text-error" /></div>
      <p className="text-xs font-medium text-on-surface-variant mb-1">{message}</p>
      <button onClick={onRetry} className="text-xs font-medium text-primary hover:text-primary/80 transition-colors">Try again</button>
    </div>
  );
}

function EmptyState({ hasFilters, onClear }: { hasFilters: boolean; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <div className="w-11 h-11 rounded-xl bg-surface-highest/20 flex items-center justify-center mb-3"><Ic name="receipt_long" className="text-xl text-outline" /></div>
      {hasFilters ? (
        <>
          <p className="text-xs font-medium text-on-surface-variant mb-0.5">No matching orders</p>
          <p className="text-[0.65rem] text-outline mb-3">No purchase orders match the current search or filter.</p>
          <button onClick={onClear} className="text-xs font-medium text-primary hover:text-primary/80 transition-colors">Clear filters</button>
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-on-surface-variant mb-0.5">No purchase orders</p>
          <p className="text-xs text-outline">Purchase orders will appear here once they are created.</p>
        </>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   CREATE PO FORM
   ══════════════════════════════════════════════════════════════ */

interface CreateLine {
  description: string;
  qtyOrdered: string;
  uom: string;
  unitPrice: string;
  itemCode: string;
}

function CreatePOForm({ initialDraft, onCancel, onCreated, shippingCompanies }: {
  initialDraft?: PurchaseOrderIntakeDraft | null;
  shippingCompanies: ShippingCompany[];
  onCancel: () => void;
  onCreated: (po: PurchaseOrder) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inlineUploadBusy, setInlineUploadBusy] = useState(false);
  const [inlineUploadError, setInlineUploadError] = useState<string | null>(null);
  const [currentDraft, setCurrentDraft] = useState<PurchaseOrderIntakeDraft | null>(initialDraft ?? null);
  const [intakeWarningConfirmed, setIntakeWarningConfirmed] = useState(false);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string; supplierCode: string }[]>([]);
  const inlineFileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    poNumber: initialDraft?.poNumber ?? "",
    orderType: (initialDraft?.orderType ?? "DirectPO") as OrderType,
    vessel: initialDraft?.vessel ?? "", vesselImo: initialDraft?.vesselImo ?? "", vesselOwner: initialDraft?.vesselOwner ?? "",
    supplier: initialDraft?.supplier ?? "", supplierId: "",
    buyerName: initialDraft?.buyerName ?? "", buyerRef: initialDraft?.buyerRef ?? "",
    port: initialDraft?.port ?? "", eta: initialDraft?.eta ?? "",
    currency: initialDraft?.currency ?? "EUR", marginPct: String(initialDraft?.marginPct ?? 0),
    priority: (initialDraft?.priority ?? "Normal") as Priority,
  });
  const [lines, setLines] = useState<CreateLine[]>(
    initialDraft?.lines.length
      ? initialDraft.lines.map((line) => ({
          description: line.description,
          qtyOrdered: String(line.qtyOrdered || 1),
          uom: line.uom || "EA",
          unitPrice: String(line.unitPrice || 0),
          itemCode: line.itemCode ?? "",
        }))
      : [{ description: "", qtyOrdered: "1", uom: "EA", unitPrice: "0", itemCode: "" }],
  );

  useEffect(() => {
    fetch("/api/v1/suppliers?limit=100&sort=name&order=asc")
      .then((r) => r.json())
      .then((j) => setSuppliers((j.data ?? []).map((s: { id: string; name: string; supplierCode: string }) => ({ id: s.id, name: s.name, supplierCode: s.supplierCode }))))
      .catch(() => {});
  }, []);

  function set(field: string, value: string) {
    setForm((p) => {
      const next = { ...p, [field]: value };
      if (field === "orderType" && value === "BuyerPO" && !next.supplier.trim()) {
        next.supplier = "Nautex";
      }
      return next;
    });
  }

  function setLine(i: number, field: keyof CreateLine, value: string) {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, [field]: value } : l)));
  }

  function addLine() {
    setLines((p) => [...p, { description: "", qtyOrdered: "1", uom: "EA", unitPrice: "0", itemCode: "" }]);
  }

  function removeLine(i: number) {
    setLines((p) => p.filter((_, j) => j !== i));
  }

  function handleSupplierSelect(id: string) {
    const s = suppliers.find((s) => s.id === id);
    if (s) set("supplier", s.name);
    set("supplierId", id);
  }

  function applyDraft(draft: PurchaseOrderIntakeDraft) {
    setCurrentDraft(draft);
    setIntakeWarningConfirmed(false);
    setForm({
      poNumber: draft.poNumber ?? "",
      orderType: (draft.orderType ?? "DirectPO") as OrderType,
      vessel: draft.vessel ?? "",
      vesselImo: draft.vesselImo ?? "",
      vesselOwner: draft.vesselOwner ?? "",
      supplier: draft.supplier ?? "",
      supplierId: "",
      buyerName: draft.buyerName ?? "",
      buyerRef: draft.buyerRef ?? "",
      port: draft.port ?? "",
      eta: draft.eta ?? "",
      currency: draft.currency ?? "EUR",
      marginPct: String(draft.marginPct ?? 0),
      priority: (draft.priority ?? "Normal") as Priority,
    });
    setLines(
      draft.lines.length
        ? draft.lines.map((line) => ({
            description: line.description,
            qtyOrdered: String(line.qtyOrdered || 1),
            uom: line.uom || "EA",
            unitPrice: String(line.unitPrice || 0),
            itemCode: line.itemCode ?? "",
          }))
        : [{ description: "", qtyOrdered: "1", uom: "EA", unitPrice: "0", itemCode: "" }],
    );
  }

  async function handleInlineUpload(file: File | null) {
    if (!file) return;
    setInlineUploadBusy(true);
    setInlineUploadError(null);
    setError(null);
    try {
      const payload = new FormData();
      payload.append("file", file);
      const res = await fetch("/api/v1/purchase-orders/process-upload", {
        method: "POST",
        body: payload,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error?.message || "Failed to process purchase order upload.");
      }
      applyDraft(json.data);
    } catch (err) {
      setInlineUploadError(err instanceof Error ? err.message : "Failed to process purchase order upload.");
    } finally {
      setInlineUploadBusy(false);
      if (inlineFileInputRef.current) inlineFileInputRef.current.value = "";
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (hasBlockingIntakeWarning(currentDraft) && !intakeWarningConfirmed) {
      setError("Confirm the skipped line numbers were reviewed before creating this order.");
      return;
    }
    if (!form.vessel.trim()) { setError("Vessel is required."); return; }
    if (form.orderType === "SubPO") { setError("Supplier fulfillment POs are generated from a confirmed customer order, not created manually."); return; }
    if (!form.supplier.trim()) { setError("Supplier is required."); return; }
    if (!form.eta) { setError("ETA is required."); return; }
    const validLines = lines.filter((l) => l.description.trim());
    if (validLines.length === 0) { setError("At least one line item is required."); return; }

    setBusy(true); setError(null);
    try {
      const lineData = validLines.map((l) => ({
        description: l.description.trim(),
        qtyOrdered: parseNumericInput(l.qtyOrdered, 1),
        uom: l.uom || "EA",
        unitPrice: parseNumericInput(l.unitPrice, 0),
        lineTotal: parseNumericInput(l.qtyOrdered, 1) * parseNumericInput(l.unitPrice, 0),
        itemCode: l.itemCode || null,
      }));
      const total = lineData.reduce((s, l) => s + l.lineTotal, 0);

      const res = await fetch("/api/v1/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          poNumber: form.poNumber.trim() || null,
          orderType: form.orderType,
          vessel: form.vessel.trim(),
          vesselImo: form.vesselImo.trim() || null,
          vesselOwner: form.vesselOwner.trim() || null,
          supplier: form.supplier.trim(),
          supplierId: form.supplierId || null,
          buyerName: form.buyerName.trim() || null,
          buyerRef: form.buyerRef.trim() || null,
          port: form.port.trim() || null,
          eta: form.eta,
          total,
          currency: form.currency,
          marginPct: parseFloat(form.marginPct) || 0,
          priority: form.priority,
          lines: lineData,
          provenance: currentDraft
            ? {
                source: "po_intake_import",
                trigger: "document_extraction",
                scenario: currentDraft.sourceType,
                metadata: {
                  sourceFileName: currentDraft.sourceFileName ?? null,
                  confidence: currentDraft.confidence,
                  warningCount: currentDraft.warnings.length,
                  humanReviewRequired: true,
                },
              }
            : {
                source: "manual_entry",
                trigger: "operator_create",
                scenario: "purchase_order_intake",
                metadata: { humanReviewRequired: false },
              },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create order");
      onCreated(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(false); }
  }

  const total = lines.reduce((s, l) => s + parseNumericInput(l.qtyOrdered, 0) * parseNumericInput(l.unitPrice, 0), 0);
  const intakeBlocked = hasBlockingIntakeWarning(currentDraft);
  const createBlockedByIntake = intakeBlocked && !intakeWarningConfirmed;

  return (
    <div className="space-y-5 animate-fade-up max-w-none">
      <div className="flex items-center gap-3">
        <button onClick={onCancel} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-surface-high/30 transition-colors">
          <Ic name="arrow_back" className="text-lg text-outline" />
        </button>
        <div>
          <h3 className="text-sm font-semibold">{currentDraft ? "Review Imported Purchase Order" : "Purchase Order Intake"}</h3>
          <p className="text-[0.6rem] text-outline">{currentDraft ? "Confirm extracted fields before creating the order." : "Upload a customer PO file first, or enter the order manually when no file is available."}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && <div className="px-4 py-2.5 rounded-lg bg-error/8 border border-error/15 text-error text-xs">{error}</div>}
        <section className="rounded-xl border border-primary/12 bg-surface-container/50 p-4">
          <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Ic name="upload_file" className="text-base text-primary" />
                <p className="text-xs font-semibold text-on-surface">Process incoming purchase order</p>
                <Badge className="bg-primary/10 text-primary">PDF / XLSX / CSV</Badge>
              </div>
              <p className="mt-1 text-xs text-outline">
                Use this for ShipServ exports, emailed PDF orders, Excel order sheets, and manual fallback review. The extracted draft remains human-supervised before creation.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                ref={inlineFileInputRef}
                type="file"
                accept=".pdf,.xlsx,.xls,.csv,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                className="hidden"
                onChange={(event) => void handleInlineUpload(event.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                onClick={() => inlineFileInputRef.current?.click()}
                disabled={inlineUploadBusy}
                className="px-3.5 py-2 text-[0.65rem] font-semibold rounded-lg bg-primary text-on-primary hover:brightness-110 transition-all flex items-center gap-1.5 disabled:opacity-50"
              >
                {inlineUploadBusy ? <span className="w-3 h-3 border-2 border-on-primary/25 border-t-on-primary rounded-full animate-spin" /> : <Ic name="upload_file" className="text-sm" />}
                {currentDraft ? "Replace File Draft" : "Upload & Extract PO"}
              </button>
            </div>
          </div>
          {inlineUploadError && (
            <div className="mt-3 rounded-lg border border-error/15 bg-error/8 px-3 py-2 text-xs text-error">
              {inlineUploadError}
            </div>
          )}
        </section>

        {currentDraft && (
          <section className="rounded-xl border border-primary/15 bg-primary/6 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Ic name="automation" className="text-base text-primary" />
                  <p className="text-xs font-semibold text-primary">Nautex PO Intake Agent draft</p>
                  <Badge className="bg-primary/12 text-primary">{currentDraft.confidence}% confidence</Badge>
                </div>
                <p className="mt-1 text-xs text-on-surface-variant">{currentDraft.extractionSummary}</p>
                <p className="mt-1 text-[0.6rem] text-outline">{currentDraft.sourceFileName || "Uploaded file"} / Human review required before creating the order.</p>
              </div>
              {currentDraft.warnings.length > 0 && (
                <div className={`max-w-xl rounded-lg border px-3 py-2 text-[0.65rem] ${intakeBlocked ? "border-error/20 bg-error/8 text-error" : "border-warning/15 bg-warning/8 text-warning"}`}>
                  {currentDraft.warnings.slice(0, 3).map((warning) => (
                    <p key={warning}>+ {warning}</p>
                  ))}
                  {intakeBlocked && (
                    <div className="mt-2 space-y-2">
                      <p className="font-semibold">+ Confirm the skipped line numbers were reviewed before creating the order.</p>
                      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-error/15 bg-surface-low/20 px-2.5 py-2 text-[0.62rem] text-on-surface">
                        <input
                          type="checkbox"
                          checked={intakeWarningConfirmed}
                          onChange={(event) => setIntakeWarningConfirmed(event.target.checked)}
                          className="mt-0.5 h-3.5 w-3.5 accent-primary"
                        />
                        <span>
                          I confirm these line numbers are intentionally skipped or have been reviewed against the original PO.
                        </span>
                      </label>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {/* Order Type */}
        <section className="bg-surface-container/50 rounded-xl ghost-border p-5 space-y-4">
          <h4 className="text-[0.65rem] font-semibold text-outline uppercase tracking-wider">Order Type</h4>
          <div className="grid gap-2 lg:grid-cols-[1fr_1fr_1fr]">
            {([["DirectPO", "Direct Supplier PO", "description", "Manual order from Nautex to a supplier"], ["BuyerPO", "Inbound Customer PO", "call_received", "Order received from a shipping company"]] as const).map(([type, label, icon, desc]) => (
              <button key={type} type="button" onClick={() => set("orderType", type)}
                className={`p-3 rounded-lg border text-left transition-all ${form.orderType === type ? "border-primary/30 bg-primary/6" : "border-outline-variant/8 hover:border-outline-variant/15"}`}>
                <div className="flex items-center gap-2 mb-1">
                  <Ic name={icon} className={`text-sm ${form.orderType === type ? "text-primary" : "text-outline/50"}`} />
                  <span className={`text-xs font-semibold ${form.orderType === type ? "text-primary" : "text-on-surface-variant"}`}>{label}</span>
                </div>
                <p className="text-[0.6rem] text-outline/60">{desc}</p>
              </button>
            ))}
            <div className="p-3 rounded-lg border border-outline-variant/8 bg-surface-low/15 text-left opacity-80">
              <div className="flex items-center gap-2 mb-1">
                <Ic name="call_made" className="text-sm text-outline/50" />
                <span className="text-xs font-semibold text-on-surface-variant">Supplier Fulfillment PO</span>
                <Badge className="bg-surface-high/40 text-outline">Generated</Badge>
              </div>
              <p className="text-[0.6rem] text-outline/60">Created automatically after Nautex confirms an inbound customer order.</p>
            </div>
          </div>
        </section>

        {/* Header fields */}
        <section className="bg-surface-container/50 rounded-xl ghost-border p-5 space-y-4">
          <h4 className="text-[0.65rem] font-semibold text-outline uppercase tracking-wider">Order Details</h4>

          {/* Buyer info (only for BuyerPO) */}
          {form.orderType === "BuyerPO" && (
            <div className="grid grid-cols-2 gap-4 pb-3 border-b border-outline-variant/6">
              <InputField label="Buyer (Shipping Company) *" value={form.buyerName} onChange={(v) => set("buyerName", v)} placeholder="e.g. Anthony Veder" />
              <InputField label="Buyer Reference" value={form.buyerRef} onChange={(v) => set("buyerRef", v)} placeholder="Buyer's PO/RFQ ref" />
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <label className="col-span-2 text-sm">Registered customer fleet (optional)
              <select aria-label="Registered customer fleet" defaultValue="" onChange={event => {
                const company = shippingCompanies.find(c => c.fleetVessels?.some(v => v.id === event.target.value));
                const vessel = company?.fleetVessels?.find(v => v.id === event.target.value);
                if (company && vessel) setForm(previous => ({ ...previous, buyerName: company.name, vesselOwner: company.name, vessel: vessel.name, vesselImo: vessel.imo ?? "" }));
              }} className="mt-1 w-full rounded-lg border border-outline-variant/20 bg-surface-high/30 px-3 py-2 text-sm">
                <option value="">Select a registered vessel or enter details below…</option>
                {shippingCompanies.map(company => <optgroup key={company.id} label={company.name}>{(company.fleetVessels ?? []).map(vessel => <option key={vessel.id} value={vessel.id}>{vessel.name}{vessel.imo ? ` · IMO ${vessel.imo}` : ""}</option>)}</optgroup>)}
              </select>
            </label>
            <InputField label="PO Number" value={form.poNumber} onChange={(v) => set("poNumber", v)} placeholder="Auto if blank" />
            <InputField label="Vessel *" value={form.vessel} onChange={(v) => set("vessel", v)} placeholder="e.g. MV Pacific Star" />
            <InputField label="Vessel IMO" value={form.vesselImo} onChange={(v) => set("vesselImo", v)} placeholder="e.g. 9876543" />
            <InputField label="Vessel Owner" value={form.vesselOwner} onChange={(v) => set("vesselOwner", v)} placeholder="Vessel operator" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[0.6rem] font-semibold text-outline uppercase tracking-wider block mb-1">{form.orderType === "BuyerPO" ? "Nautex Selling Entity *" : "Supplier *"}</label>
              <select value={form.supplierId} onChange={(e) => handleSupplierSelect(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-surface-high/30 border border-outline-variant/8 rounded-lg text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/20 appearance-none">
                <option value="">Select or type below...</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.supplierCode})</option>)}
              </select>
              <input type="text" value={form.supplier} onChange={(e) => set("supplier", e.target.value)} placeholder={form.orderType === "BuyerPO" ? "Nautex" : "Or type supplier name"}
                className="w-full px-3 py-1.5 mt-1 text-xs bg-surface-high/20 border border-outline-variant/6 rounded-lg text-on-surface placeholder:text-outline/30 focus:outline-none focus:ring-1 focus:ring-primary/20" />
            </div>
            <InputField label="Port" value={form.port} onChange={(v) => set("port", v)} placeholder="e.g. Rotterdam" />
            <InputField label="ETA *" value={form.eta} onChange={(v) => set("eta", v)} type="date" />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-[0.6rem] font-semibold text-outline uppercase tracking-wider block mb-1">Currency</label>
              <select value={form.currency} onChange={(e) => set("currency", e.target.value)}
                className="w-full px-3 py-2 text-xs bg-surface-high/30 border border-outline-variant/8 rounded-lg text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/20 appearance-none">
                {["EUR", "USD", "GBP", "NOK", "SEK", "DKK", "SGD", "AED"].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <InputField label="Margin %" value={form.marginPct} onChange={(v) => set("marginPct", v)} type="number" />
            <div>
              <label className="text-[0.6rem] font-semibold text-outline uppercase tracking-wider block mb-1">Priority</label>
              <select value={form.priority} onChange={(e) => set("priority", e.target.value as Priority)}
                className="w-full px-3 py-2 text-xs bg-surface-high/30 border border-outline-variant/8 rounded-lg text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/20 appearance-none">
                <option value="Low">Low</option>
                <option value="Normal">Normal</option>
                <option value="High">High</option>
              </select>
            </div>
          </div>
        </section>

        {/* Line items */}
        <section className="bg-surface-container/50 rounded-xl ghost-border p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-[0.65rem] font-semibold text-outline uppercase tracking-wider">Line Items</h4>
            <button type="button" onClick={addLine} className="text-[0.6rem] font-medium text-primary hover:text-primary/80 transition-colors flex items-center gap-1">
              <Ic name="add" className="text-sm" /> Add Line
            </button>
          </div>

          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_80px_60px_100px_32px] gap-2 items-end">
                <InputField label={i === 0 ? "Description" : undefined} value={l.description} onChange={(v) => setLine(i, "description", v)} placeholder="Item description" />
                <InputField label={i === 0 ? "Qty" : undefined} value={l.qtyOrdered} onChange={(v) => setLine(i, "qtyOrdered", v)} type="number" />
                <InputField label={i === 0 ? "UoM" : undefined} value={l.uom} onChange={(v) => setLine(i, "uom", v)} placeholder="EA" />
                <InputField label={i === 0 ? "Unit Price" : undefined} value={l.unitPrice} onChange={(v) => setLine(i, "unitPrice", v)} type="number" />
                <button type="button" onClick={() => removeLine(i)} disabled={lines.length <= 1}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-outline/40 hover:text-error hover:bg-error/6 transition-colors disabled:opacity-20">
                  <Ic name="close" className="text-sm" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-outline-variant/6">
            <span className="text-xs text-outline">{lines.filter((l) => l.description.trim()).length} line item{lines.filter((l) => l.description.trim()).length !== 1 ? "s" : ""}</span>
            <span className="text-sm font-semibold text-on-surface font-mono">
              {new Intl.NumberFormat("en-EU", { style: "currency", currency: form.currency, minimumFractionDigits: 2 }).format(total)}
            </span>
          </div>
        </section>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onCancel} className="px-4 py-2 text-xs font-medium rounded-lg border border-outline-variant/10 text-on-surface-variant hover:bg-surface-high/30 transition-colors">
            Cancel
          </button>
          <button type="submit" disabled={busy || createBlockedByIntake}
            className="px-5 py-2 text-xs font-semibold rounded-lg bg-primary text-on-primary hover:brightness-110 transition-all flex items-center gap-1.5 disabled:opacity-50">
            {busy ? <span className="w-3.5 h-3.5 border-2 border-on-primary/30 border-t-on-primary rounded-full animate-spin" /> : <Ic name="check" className="text-sm" />}
            Create Order
          </button>
        </div>
      </form>
    </div>
  );
}

function InputField({ label, value, onChange, placeholder, type = "text" }: {
  label?: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div>
      {label && <label className="text-[0.6rem] font-semibold text-outline uppercase tracking-wider block mb-1">{label}</label>}
      <input aria-label={label} type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full px-3 py-2 text-xs bg-surface-high/30 border border-outline-variant/8 rounded-lg text-on-surface placeholder:text-outline/30 focus:outline-none focus:ring-1 focus:ring-primary/20 focus:border-primary/15 transition-all" />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   SUPPLY CHAIN TAB
   ══════════════════════════════════════════════════════════════ */

function ContextStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-outline-variant/8 bg-surface-low/20 px-3 py-2.5">
      <p className="text-[0.58rem] font-semibold uppercase tracking-wider text-outline">{label}</p>
      <p className="mt-1 truncate font-mono text-xs font-semibold text-on-surface" title={value}>{value}</p>
    </div>
  );
}

function SupplyChainTab({ po, onOpenOrder }: { po: PurchaseOrder; onRefresh: () => void; onOpenOrder: (id: string) => void }) {
  const childOrders = po.childOrders ?? [];
  const parentOrder = po.parentOrder;
  const lines = po.lines ?? [];

  if (po.orderType === "SubPO" && parentOrder) {
    const salesOrderNo = po.supplierRef?.startsWith("SO-")
      ? po.supplierRef
      : parentOrder.supplierRef?.startsWith("SO-")
        ? parentOrder.supplierRef
        : "Not assigned";
    const customerPo = po.buyerRef || parentOrder.poNumber;
    return (
      <div className="space-y-4 py-2">
        <div className="bg-surface-container/50 rounded-xl ghost-border p-5 space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <Ic name="account_tree" className="text-base text-outline" />
            <h4 className="text-xs font-semibold">Customer Order / Sales Order Context</h4>
          </div>
          <button onClick={() => onOpenOrder(parentOrder.id)} className="flex w-full items-center gap-4 rounded-lg border border-outline-variant/6 bg-surface-high/20 p-3 text-left transition-colors hover:border-primary/20 hover:bg-primary/6">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[0.7rem] font-semibold text-on-surface">{salesOrderNo}</span>
                <Badge className="bg-success/10 text-success border-success/20">Nautex Sales Order</Badge>
                <span className="text-[0.65rem] text-outline">Customer PO</span>
                <span className="font-mono text-[0.65rem] text-on-surface-variant">{customerPo}</span>
              </div>
              <div className="mt-1 text-xs text-outline">{parentOrder.buyerName || parentOrder.vesselOwner || "Shipping company"} / {parentOrder.vessel}</div>
              <div className="text-xs text-outline">Status: <Badge className={STATUS_STYLES[parentOrder.status]}>{STATUS_LABELS[parentOrder.status]}</Badge></div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm font-semibold font-mono">{fmt(parentOrder.total, parentOrder.currency)}</div>
              <div className="text-[0.6rem] text-outline">Open customer order</div>
            </div>
          </button>
          <div className="grid gap-2 md:grid-cols-3">
            <ContextStat label="Supplier PO" value={po.poNumber} />
            <ContextStat label="Supplier" value={po.supplier} />
            <ContextStat label="Linked Sales Order" value={salesOrderNo} />
          </div>
        </div>

        {lines.length > 0 && lines.some((l) => l.buyerUnitPrice != null) && (
          <div className="bg-surface-container/50 rounded-xl ghost-border p-5 space-y-3">
            <h4 className="text-[0.65rem] font-semibold text-outline uppercase tracking-wider">Supplier PO Margin Analysis</h4>
            <table className="w-full text-left text-xs">
              <thead className="text-[0.6rem] text-outline uppercase">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2">Qty</th>
                  <th className="px-3 py-2">Customer Price</th>
                  <th className="px-3 py-2">Supplier Cost</th>
                  <th className="px-3 py-2">Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/4">
                {lines.map((l) => {
                  const margin = l.buyerUnitPrice ? ((l.buyerUnitPrice - l.unitPrice) / l.buyerUnitPrice * 100) : null;
                  return (
                    <tr key={l.id}>
                      <td className="px-3 py-2 font-mono text-outline">{l.lineNumber}</td>
                      <td className="px-3 py-2 text-on-surface-variant">{l.description}</td>
                      <td className="px-3 py-2 font-mono">{l.qtyOrdered} {l.uom}</td>
                      <td className="px-3 py-2 font-mono text-info">{l.buyerUnitPrice != null ? l.buyerUnitPrice.toFixed(2) : "-"}</td>
                      <td className="px-3 py-2 font-mono">{l.unitPrice.toFixed(2)}</td>
                      <td className="px-3 py-2">
                        {margin != null ? (
                          <span className={`font-mono font-semibold ${margin > 10 ? "text-primary" : margin > 0 ? "text-warning" : "text-error"}`}>
                            {margin.toFixed(1)}%
                          </span>
                        ) : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 py-2">
      <div className="bg-surface-container/50 rounded-xl ghost-border p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Ic name="account_tree" className="text-base text-outline" />
            <h4 className="text-xs font-semibold">Supplier Fulfillment POs</h4>
            {childOrders.length > 0 && <Badge className="bg-tertiary/10 text-tertiary border-tertiary/20">{childOrders.length}</Badge>}
          </div>
        </div>

        {childOrders.length === 0 ? (
          <div className="text-center py-8">
            <Ic name="call_split" className="text-2xl text-outline/30 block mx-auto mb-2" />
            <p className="text-xs text-outline">No supplier POs generated yet. Confirm the customer PO to create fulfillment POs.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {childOrders.map((child) => (
              <button key={child.id} onClick={() => onOpenOrder(child.id)} className="flex w-full items-center gap-4 rounded-lg border border-outline-variant/6 bg-surface-high/20 p-3 text-left transition-colors hover:border-primary/20 hover:bg-primary/6">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[0.7rem] font-semibold text-on-surface">{child.poNumber}</span>
                    <Badge className="bg-warning/10 text-warning border-warning/20">Supplier PO</Badge>
                    <Badge className={STATUS_STYLES[child.status]}>{STATUS_LABELS[child.status]}</Badge>
                  </div>
                  <div className="text-[0.6rem] text-outline mt-0.5">Supplier: {child.supplier} | Linked to {child.supplierRef || po.supplierRef || "sales order"} | {child._count?.lines ?? 0} lines</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs font-semibold font-mono">{fmt(child.total, child.currency)}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {childOrders.length > 0 && (
          <div className="border-t border-outline-variant/6 pt-3 flex items-center justify-between text-xs">
            <span className="text-outline">Total supplier PO cost</span>
            <span className="font-mono font-semibold">{fmt(childOrders.reduce((s, c) => s + c.total, 0), po.currency)}</span>
          </div>
        )}
      </div>

      {lines.length > 0 && (
        <div className="bg-surface-container/50 rounded-xl ghost-border p-5 space-y-3">
          <h4 className="text-[0.65rem] font-semibold text-outline uppercase tracking-wider">Line Fulfillment Status</h4>
          <table className="w-full text-left text-xs">
            <thead className="text-[0.6rem] text-outline uppercase">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2">Qty</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/4">
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="px-3 py-2 font-mono text-outline">{l.lineNumber}</td>
                  <td className="px-3 py-2 text-on-surface-variant">{l.description}</td>
                  <td className="px-3 py-2 font-mono">{l.qtyOrdered} {l.uom}</td>
                  <td className="px-3 py-2">
                    {l.forwardedToOrderId ? (
                      <Badge className="bg-primary/10 text-primary border-primary/20">Routed to supplier PO</Badge>
                    ) : l.status === "Confirmed" ? (
                      <Badge className="bg-success/10 text-success border-success/20">Reserved internally</Badge>
                    ) : (
                      <Badge className="bg-surface-high/40 text-outline border-outline-variant/10">Not routed</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
