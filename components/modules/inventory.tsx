"use client";
import { InventoryUnitConversions } from "./inventory-unit-conversions";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { InventoryCycleCount, InventoryItem, InventoryMovement } from "@/types/erp";
import { useDialogA11y } from "@/lib/hooks/use-dialog-a11y";

interface InventoryCounts {
  total: number;
  critical: number;
  reorder: number;
  healthy: number;
  dangerousGoods: number;
}

interface InventoryMeta {
  warehouses?: string[];
  counts?: InventoryCounts;
}

interface ApiResponse<T> {
  ok?: boolean;
  data?: T;
  meta?: InventoryMeta;
  error?: { message?: string };
}

interface InventoryDraft {
  itemCode: string;
  description: string;
  category: string;
  warehouse: string;
  locationBin: string;
  uom: string;
  onHand: string;
  reserved: string;
  inbound: string;
  reorderPoint: string;
  dangerousGoods: boolean;
  notes: string;
}

type AdjustmentType = "receipt" | "issue" | "reserve" | "release";

interface AdjustmentDraft {
  movementType: AdjustmentType;
  quantity: string;
  note: string;
}

interface TransferDraft {
  destinationWarehouse: string;
  destinationBin: string;
  quantity: string;
  note: string;
}

interface CycleCountDraft {
  countedQuantity: string;
  note: string;
}

interface CatalogCandidate {
  id: string;
  description: string;
  impaCode: string | null;
  hsCodeEu: string | null;
  hsCodeUs: string | null;
  countryOrigin: string | null;
  category: string | null;
  unit: string | null;
}

interface ImportResult {
  created: number;
  updated: number;
  failed: number;
  errors: Array<{ row: number; message: string }>;
}

const EMPTY_DRAFT: InventoryDraft = {
  itemCode: "",
  description: "",
  category: "",
  warehouse: "",
  locationBin: "",
  uom: "EA",
  onHand: "0",
  reserved: "0",
  inbound: "0",
  reorderPoint: "0",
  dangerousGoods: false,
  notes: "",
};

const EMPTY_ADJUSTMENT: AdjustmentDraft = {
  movementType: "receipt",
  quantity: "1",
  note: "",
};

const STOCK_TONE: Record<string, string> = {
  healthy: "bg-success/10 text-success border-success/15",
  reorder: "bg-warning/10 text-warning border-warning/15",
  critical: "bg-error/10 text-error border-error/15",
};

const MOVEMENT_LABELS: Record<string, string> = {
  initial_stock: "Opening stock",
  receipt: "Receipt",
  issue: "Issue",
  adjustment: "Adjustment",
  count: "Cycle count",
  reserve: "Reserved",
  release: "Released",
  reservation_issue: "Reserved issue",
  po_delivery: "PO delivery",
  po_delivery_reversal: "PO reversal",
  transfer_out: "Transfer out",
  transfer_in: "Transfer in",
};

function Ic({ name, className = "" }: { name: string; className?: string }) {
  return <span className={`material-symbols-outlined ${className}`} style={{ fontVariationSettings: "'FILL' 0, 'wght' 300, 'opsz' 20" }}>{name}</span>;
}

export function InventoryModule({ onInventoryChanged }: { onInventoryChanged?: () => void }) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [page, setPage] = useState(1);
  const pageSize = 100;
  const [warehouses, setWarehouses] = useState<string[]>([]);
  const [counts, setCounts] = useState<InventoryCounts>({ total: 0, critical: 0, reorder: 0, healthy: 0, dangerousGoods: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<InventoryItem | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [warehouse, setWarehouse] = useState("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [editing, setEditing] = useState<InventoryItem | "new" | null>(null);
  const [adjusting, setAdjusting] = useState<InventoryItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InventoryItem | null>(null);
  const [linking, setLinking] = useState<InventoryItem | null>(null);
  const [importing, setImporting] = useState(false);
  const [transferring, setTransferring] = useState<InventoryItem | null>(null);
  const [counting, setCounting] = useState<InventoryItem | null>(null);
  const [reviewingCount, setReviewingCount] = useState<{ item: InventoryItem; count: InventoryCycleCount; decision: "approve" | "reject" } | null>(null);

  const selected = useMemo(() => items.find((item) => item.id === selectedId) ?? items[0] ?? null, [items, selectedId]);
  const detailItem = selectedDetail?.id === selected?.id ? selectedDetail : selected;

  const loadInventory = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (status !== "all") params.set("status", status);
      if (warehouse !== "all") params.set("warehouse", warehouse);

      const res = await fetch(`/api/v1/inventory?${params.toString()}`, { signal });
      const payload = (await res.json()) as ApiResponse<InventoryItem[]>;
      if (!res.ok || payload.ok === false || !payload.data) throw new Error(payload.error?.message || "Inventory load failed.");

      const nextItems = payload.data;
      setItems(nextItems);
      setPage(1);
      setWarehouses(payload.meta?.warehouses ?? []);
      setCounts(payload.meta?.counts ?? { total: nextItems.length, critical: 0, reorder: 0, healthy: 0, dangerousGoods: 0 });
      setSelectedId((current) => current && nextItems.some((item) => item.id === current) ? current : nextItems[0]?.id ?? null);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setError(err instanceof Error ? err.message : "Inventory load failed.");
      }
    } finally {
      setLoading(false);
    }
  }, [query, status, warehouse]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadInventory(controller.signal), 180);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [loadInventory]);

  useEffect(() => {
    if (!selected?.id) {
      setSelectedDetail(null);
      return;
    }

    const controller = new AbortController();
    void loadSelectedDetail(selected.id, controller.signal);
    return () => controller.abort();
  }, [selected?.id]);

  async function loadSelectedDetail(id: string, signal?: AbortSignal) {
    try {
      const res = await fetch(`/api/v1/inventory/${id}`, { signal });
      const payload = (await res.json()) as ApiResponse<InventoryItem>;
      if (!res.ok || payload.ok === false || !payload.data) throw new Error(payload.error?.message || "Inventory detail failed.");
      setSelectedDetail(payload.data);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setSelectedDetail(null);
      }
    }
  }

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  }

  async function refreshAfterChange(message: string) {
    await loadInventory();
    onInventoryChanged?.();
    showToast(message);
  }

  async function saveItem(draft: InventoryDraft, id?: string) {
    setBusy(true);
    try {
      const payload = {
        itemCode: draft.itemCode || null,
        description: draft.description,
        category: draft.category || null,
        warehouse: draft.warehouse,
        locationBin: draft.locationBin || null,
        uom: draft.uom,
        onHand: Number(draft.onHand),
        reserved: Number(draft.reserved),
        inbound: Number(draft.inbound),
        reorderPoint: Number(draft.reorderPoint),
        dangerousGoods: draft.dangerousGoods,
        notes: draft.notes || null,
      };
      const res = await fetch(id ? `/api/v1/inventory/${id}` : "/api/v1/inventory", {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as ApiResponse<InventoryItem>;
      if (!res.ok || json.ok === false) throw new Error(json.error?.message || "Save failed.");
      setEditing(null);
      await refreshAfterChange(id ? "Inventory item updated" : "Inventory item created");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function applyAdjustment(item: InventoryItem, draft: AdjustmentDraft) {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/inventory/${item.id}/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          movementType: draft.movementType,
          quantity: Number(draft.quantity),
          note: draft.note || null,
        }),
      });
      const json = (await res.json()) as ApiResponse<InventoryItem>;
      if (!res.ok || json.ok === false) throw new Error(json.error?.message || "Adjustment failed.");
      if (json.data) setSelectedDetail(json.data);
      setAdjusting(null);
      await refreshAfterChange("Stock movement recorded");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Adjustment failed.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteItem(item: InventoryItem) {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/inventory/${item.id}`, { method: "DELETE" });
      const json = (await res.json()) as ApiResponse<{ id: string }>;
      if (!res.ok || json.ok === false) throw new Error(json.error?.message || "Delete failed.");
      setDeleteTarget(null);
      await refreshAfterChange("Inventory item deleted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  async function createReorderRfq(item: InventoryItem) {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/inventory/${item.id}/reorder-rfq`, { method: "POST" });
      const json = (await res.json()) as ApiResponse<{ rfq: { id: string }; quantity: number }>;
      if (!res.ok || json.ok === false || !json.data) throw new Error(json.error?.message || "RFQ creation failed.");
      showToast(`Draft RFQ ${json.data.rfq.id} created`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "RFQ creation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function importCsv(csv: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/v1/inventory/import", {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: csv,
      });
      const json = (await res.json()) as ApiResponse<ImportResult>;
      if (!res.ok || json.ok === false || !json.data) throw new Error(json.error?.message || "Import failed.");
      setImporting(false);
      await refreshAfterChange(`Import complete: ${json.data.created} created, ${json.data.updated} updated`);
      if (json.data.failed > 0) setError(`${json.data.failed} import rows failed. First: ${json.data.errors[0]?.message}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  async function linkCatalogItem(item: InventoryItem, catalogItemId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/inventory/${item.id}/catalog-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ catalogItemId }),
      });
      const json = (await res.json()) as ApiResponse<InventoryItem>;
      if (!res.ok || json.ok === false || !json.data) throw new Error(json.error?.message || "Catalog link failed.");
      setSelectedDetail(json.data);
      setLinking(null);
      await refreshAfterChange("Catalog item linked");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Catalog link failed.");
    } finally {
      setBusy(false);
    }
  }

  async function unlinkCatalogItem(item: InventoryItem) {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/inventory/${item.id}/catalog-link`, { method: "DELETE" });
      const json = (await res.json()) as ApiResponse<InventoryItem>;
      if (!res.ok || json.ok === false || !json.data) throw new Error(json.error?.message || "Catalog unlink failed.");
      setSelectedDetail(json.data);
      await refreshAfterChange("Catalog link removed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Catalog unlink failed.");
    } finally {
      setBusy(false);
    }
  }

  async function transferStock(item: InventoryItem, draft: TransferDraft) {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/inventory/${item.id}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destinationWarehouse: draft.destinationWarehouse,
          destinationBin: draft.destinationBin || null,
          quantity: Number(draft.quantity),
          note: draft.note || null,
        }),
      });
      const json = (await res.json()) as ApiResponse<{ source: InventoryItem; destination: InventoryItem }>;
      if (!res.ok || json.ok === false || !json.data) throw new Error(json.error?.message || "Transfer failed.");
      setSelectedDetail(json.data.source);
      setTransferring(null);
      await refreshAfterChange(`Transferred ${draft.quantity} ${item.uom} to ${draft.destinationWarehouse}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transfer failed.");
    } finally {
      setBusy(false);
    }
  }

  async function recordCycleCount(item: InventoryItem, draft: CycleCountDraft) {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/inventory/${item.id}/cycle-counts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ countedQuantity: Number(draft.countedQuantity), note: draft.note || null }),
      });
      const json = (await res.json()) as ApiResponse<InventoryCycleCount>;
      if (!res.ok || json.ok === false || !json.data) throw new Error(json.error?.message || "Cycle count failed.");
      setCounting(null);
      await loadSelectedDetail(item.id);
      showToast("Cycle count submitted for review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cycle count failed.");
    } finally {
      setBusy(false);
    }
  }

  async function reviewCycleCount(reviewNote: string) {
    if (!reviewingCount) return;
    const { item, count, decision } = reviewingCount;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/inventory/${item.id}/cycle-counts/${count.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reviewNote: reviewNote || null }),
      });
      const json = (await res.json()) as ApiResponse<{ item: InventoryItem; count: InventoryCycleCount }>;
      if (!res.ok || json.ok === false || !json.data) throw new Error(json.error?.message || "Cycle count review failed.");
      if (json.data.item) setSelectedDetail(json.data.item);
      setReviewingCount(null);
      await refreshAfterChange(`Cycle count ${decision === "approve" ? "approved" : "rejected"}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cycle count review failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inventory-module space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Ic name="inventory_2" className="text-xl text-primary" />
            <h2 className="text-lg font-semibold text-on-surface">Inventory & Warehouse</h2>
            <StatusPill status="operational" />
          </div>
          <p className="mt-1 text-xs text-on-surface-variant">Stock balances, reorder risk, warehouse actions, and PO receipt movements.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => void loadInventory()} className="inline-flex items-center gap-1.5 rounded-lg bg-surface-high/30 px-3 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-high/50">
            <Ic name="refresh" className="text-sm" /> Refresh
          </button>
          <button onClick={() => setImporting(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-surface-high/30 px-3 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-high/50">
            <Ic name="upload_file" className="text-sm" /> Import
          </button>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- This route returns a file download rather than application navigation. */}
          <a href="/api/v1/inventory/export" className="inline-flex items-center gap-1.5 rounded-lg bg-surface-high/30 px-3 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-high/50">
            <Ic name="download" className="text-sm" /> Export
          </a>
          <button onClick={() => setEditing("new")} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-on-primary hover:brightness-110">
            <Ic name="add" className="text-sm" /> New item
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metric label="Total SKUs" value={String(counts.total)} icon="category" />
        <Metric label="Critical" value={String(counts.critical)} icon="priority_high" tone="danger" />
        <Metric label="Reorder" value={String(counts.reorder)} icon="low_priority" tone="warn" />
        <Metric label="Healthy" value={String(counts.healthy)} icon="task_alt" tone="success" />
        <Metric label="Dangerous Goods" value={String(counts.dangerousGoods)} icon="warning" tone="warn" />
      </div>

      <section className="rounded-xl bg-surface-container/50 ghost-border overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-outline-variant/8 p-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Ic name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-outline" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search item, code, warehouse, category"
                className="w-full rounded-lg border border-outline-variant/8 bg-surface-high/25 py-2 pl-9 pr-3 text-xs text-on-surface outline-none placeholder:text-outline/40 focus:border-primary/20 focus:ring-1 focus:ring-primary/20"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={status} onChange={setStatus} options={[["all", "All status"], ["critical", "Critical"], ["reorder", "Reorder"], ["healthy", "Healthy"]]} />
            <Select value={warehouse} onChange={setWarehouse} options={[["all", "All warehouses"], ...warehouses.map((name) => [name, name] as [string, string])]} />
          </div>
        </div>

        {error && (
          <div className="m-4 flex items-center justify-between gap-3 rounded-lg border border-error/15 bg-error/8 px-3 py-2 text-xs text-error">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="rounded-md px-2 py-1 hover:bg-error/10">Dismiss</button>
          </div>
        )}

        <div className="grid min-h-[520px] lg:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
          <div className="overflow-x-auto border-r border-outline-variant/6">
            {items.length > pageSize && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/15 p-3 text-sm"><span>Items {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, items.length)} of {items.length}</span><div className="flex gap-3"><button className="rounded-md bg-primary/10 px-3 py-2 text-primary disabled:opacity-40" disabled={page === 1} onClick={() => setPage(current => current - 1)}>Previous items</button><button className="rounded-md bg-primary/10 px-3 py-2 text-primary disabled:opacity-40" disabled={page * pageSize >= items.length} onClick={() => setPage(current => current + 1)}>Next items</button></div></div>}
            {loading ? (
              <InventorySkeleton />
            ) : items.length === 0 ? (
              <EmptyState onCreate={() => setEditing("new")} />
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="bg-surface-low/35 text-[0.62rem] uppercase text-outline">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Item</th>
                    <th className="px-4 py-3 font-semibold">Warehouse</th>
                    <th className="px-4 py-3 text-right font-semibold">Available</th>
                    <th className="px-4 py-3 text-right font-semibold">On Hand</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/6">
                  {items.slice((page - 1) * pageSize, page * pageSize).map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => setSelectedId(item.id)}
                      className={`cursor-pointer transition-colors hover:bg-surface-high/15 ${selected?.id === item.id ? "bg-primary/6" : ""}`}
                    >
                      <td className="max-w-[360px] px-4 py-3">
                        <div className="flex items-start gap-3">
                          <StockDot status={item.stockStatus} />
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-on-surface">{item.description}</p>
                            <p className="mt-0.5 flex flex-wrap gap-2 text-[0.65rem] text-outline">
                              <span className="font-mono">{item.itemCode || item.id.slice(0, 8)}</span>
                              {item.category && <span>{item.category}</span>}
                              {item.dangerousGoods && <span className="text-warning">DG</span>}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-on-surface-variant">
                        <p>{item.warehouse}</p>
                        <p className="text-[0.65rem] text-outline">{item.locationBin || "No bin"}</p>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-on-surface">{item.available ?? Math.max(0, item.onHand - (item.reserved ?? 0))}</td>
                      <td className="px-4 py-3 text-right font-mono text-on-surface-variant">{item.onHand} {item.uom}</td>
                      <td className="px-4 py-3"><StatusPill status={item.stockStatus} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <InventoryDetail
            item={detailItem}
            onEdit={(item) => setEditing(item)}
            onAdjust={(item) => setAdjusting(item)}
            onTransfer={(item) => setTransferring(item)}
            onCount={(item) => setCounting(item)}
            onReviewCount={(item, count, decision) => setReviewingCount({ item, count, decision })}
            onLink={(item) => setLinking(item)}
            onUnlink={(item) => void unlinkCatalogItem(item)}
            onReorder={(item) => void createReorderRfq(item)}
            onDelete={(item) => setDeleteTarget(item)}
          />
        </div>
      </section>

      {toast && <div className="fixed bottom-5 right-5 z-50 rounded-lg border border-success/20 bg-surface-container px-4 py-2 text-xs font-semibold text-success shadow-xl">{toast}</div>}
      {editing && <ItemModal item={editing === "new" ? null : editing} busy={busy} onClose={() => setEditing(null)} onSave={saveItem} />}
      {adjusting && <AdjustmentModal item={adjusting} busy={busy} onClose={() => setAdjusting(null)} onSave={(draft) => applyAdjustment(adjusting, draft)} />}
      {transferring && <TransferModal item={transferring} warehouses={warehouses} busy={busy} onClose={() => setTransferring(null)} onSave={(draft) => transferStock(transferring, draft)} />}
      {counting && <CycleCountModal item={counting} busy={busy} onClose={() => setCounting(null)} onSave={(draft) => recordCycleCount(counting, draft)} />}
      {reviewingCount && <CycleCountReviewModal review={reviewingCount} busy={busy} onClose={() => setReviewingCount(null)} onSubmit={reviewCycleCount} />}
      {linking && <CatalogLinkModal item={linking} busy={busy} onClose={() => setLinking(null)} onLink={(catalogItemId) => linkCatalogItem(linking, catalogItemId)} />}
      {importing && <ImportCsvModal busy={busy} onClose={() => setImporting(false)} onImport={importCsv} />}
      {deleteTarget && <ConfirmDeleteModal item={deleteTarget} busy={busy} onCancel={() => setDeleteTarget(null)} onConfirm={() => deleteItem(deleteTarget)} />}
    </div>
  );
}

function Metric({ label, value, icon, tone = "neutral" }: { label: string; value: string; icon: string; tone?: "neutral" | "success" | "warn" | "danger" }) {
  const color = tone === "success" ? "text-success" : tone === "warn" ? "text-warning" : tone === "danger" ? "text-error" : "text-primary";
  return (
    <div className="rounded-xl bg-surface-container/45 p-4 ghost-border">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[0.68rem] font-semibold uppercase text-outline">{label}</span>
        <Ic name={icon} className={`text-base ${color}`} />
      </div>
      <p className="mt-3 font-mono text-2xl font-semibold text-on-surface">{value}</p>
    </div>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return (
    <select aria-label={options[0]?.[1] || "Inventory filter"} value={value} onChange={(event) => onChange(event.target.value)} className="rounded-lg border border-outline-variant/8 bg-surface-high/25 px-3 py-2 text-xs text-on-surface outline-none focus:border-primary/20 focus:ring-1 focus:ring-primary/20">
      {options.map(([optionValue, label]) => <option key={optionValue} value={optionValue}>{label}</option>)}
    </select>
  );
}

function StatusPill({ status }: { status: string }) {
  const label = status.replace(/_/g, " ");
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[0.62rem] font-semibold uppercase ${STOCK_TONE[status] ?? "border-primary/15 bg-primary/10 text-primary"}`}>{label}</span>;
}

function StockDot({ status }: { status: string }) {
  const color = status === "critical" ? "bg-error" : status === "reorder" ? "bg-warning" : "bg-success";
  return <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${color}`} />;
}

function InventoryDetail({ item, onEdit, onAdjust, onTransfer, onCount, onReviewCount, onLink, onUnlink, onReorder, onDelete }: {
  item: InventoryItem | null;
  onEdit: (item: InventoryItem) => void;
  onAdjust: (item: InventoryItem) => void;
  onTransfer: (item: InventoryItem) => void;
  onCount: (item: InventoryItem) => void;
  onReviewCount: (item: InventoryItem, count: InventoryCycleCount, decision: "approve" | "reject") => void;
  onLink: (item: InventoryItem) => void;
  onUnlink: (item: InventoryItem) => void;
  onReorder: (item: InventoryItem) => void;
  onDelete: (item: InventoryItem) => void;
}) {
  if (!item) {
    return (
      <aside className="flex min-h-[420px] items-center justify-center p-6 text-center">
        <div>
          <Ic name="inventory_2" className="text-3xl text-outline" />
          <p className="mt-3 text-sm font-semibold text-on-surface-variant">No stock record selected</p>
          <p className="mt-1 text-xs text-outline">Create or select an item to manage warehouse actions.</p>
        </div>
      </aside>
    );
  }

  const available = item.available ?? Math.max(0, item.onHand - (item.reserved ?? 0));
  const fill = item.reorderPoint > 0 ? Math.min(100, Math.round((item.onHand / Math.max(item.reorderPoint * 2, 1)) * 100)) : 100;

  return (
    <aside className="flex min-h-[520px] flex-col bg-surface-low/10">
      <div className="border-b border-outline-variant/8 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[0.68rem] text-outline">{item.itemCode || item.id}</p>
            <h3 className="mt-1 text-base font-semibold leading-snug text-on-surface">{item.description}</h3>
          </div>
          <StatusPill status={item.stockStatus} />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <DetailStat label="Available" value={String(available)} />
          <DetailStat label="On hand" value={String(item.onHand)} />
          <DetailStat label="Reserved" value={String(item.reserved ?? 0)} />
        </div>
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-[0.65rem] text-outline">
            <span>Reorder threshold</span>
            <span className="font-mono">{item.reorderPoint} {item.uom}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-high/30">
            <div className={`h-full rounded-full ${item.stockStatus === "critical" ? "bg-error" : item.stockStatus === "reorder" ? "bg-warning" : "bg-success"}`} style={{ width: `${fill}%` }} />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={() => onAdjust(item)} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-on-primary hover:brightness-110">
            <Ic name="sync_alt" className="text-sm" /> Stock action
          </button>
          <button onClick={() => onTransfer(item)} disabled={available <= 0} className="inline-flex items-center gap-1.5 rounded-lg bg-surface-high/30 px-3 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-high/50 disabled:cursor-not-allowed disabled:opacity-40">
            <Ic name="move_item" className="text-sm" /> Transfer
          </button>
          <button onClick={() => onCount(item)} className="inline-flex items-center gap-1.5 rounded-lg bg-surface-high/30 px-3 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-high/50">
            <Ic name="fact_check" className="text-sm" /> Cycle count
          </button>
          <button onClick={() => onReorder(item)} className="inline-flex items-center gap-1.5 rounded-lg bg-warning/12 px-3 py-2 text-xs font-semibold text-warning hover:bg-warning/18">
            <Ic name="request_quote" className="text-sm" /> Draft RFQ
          </button>
          <button onClick={() => onLink(item)} className="inline-flex items-center gap-1.5 rounded-lg bg-surface-high/30 px-3 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-high/50">
            <Ic name="link" className="text-sm" /> {item.catalogItemId ? "Relink catalog" : "Link catalog"}
          </button>
          {item.catalogItemId && (
            <button onClick={() => onUnlink(item)} className="inline-flex items-center gap-1.5 rounded-lg bg-surface-high/30 px-3 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-high/50">
              <Ic name="link_off" className="text-sm" /> Unlink
            </button>
          )}
          <button onClick={() => onEdit(item)} className="inline-flex items-center gap-1.5 rounded-lg bg-surface-high/30 px-3 py-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-high/50">
            <Ic name="edit" className="text-sm" /> Edit
          </button>
          <button onClick={() => onDelete(item)} className="inline-flex items-center gap-1.5 rounded-lg bg-error/10 px-3 py-2 text-xs font-semibold text-error hover:bg-error/15">
            <Ic name="delete" className="text-sm" /> Delete
          </button>
        </div>
      </div>

      <div className="space-y-4 p-5">
        <div className="grid grid-cols-2 gap-3 text-xs">
          <Info label="Warehouse" value={item.warehouse} />
          <Info label="Bin" value={item.locationBin || "-"} />
          <Info label="Category" value={item.category || "-"} />
          <Info label="UoM" value={item.uom} />
          <Info label="Inbound" value={String(item.inbound ?? 0)} />
          <Info label="Catalog" value={item.catalogItemId ? item.catalogItemId.slice(0, 8) : "Unlinked"} />
          <Info label="Dangerous goods" value={item.dangerousGoods ? "Yes" : "No"} />
        </div>
        {item.notes && <p className="rounded-lg border border-outline-variant/8 bg-surface-high/15 p-3 text-xs leading-relaxed text-on-surface-variant">{item.notes}</p>}
        <InventoryUnitConversions key={item.id} itemId={item.id} stockUnit={item.uom} />
        {(item.cycleCounts ?? []).filter((count) => count.status === "PendingReview").map((count) => (
          <div key={count.id} className="rounded-lg border border-warning/20 bg-warning/8 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-on-surface">Cycle count awaiting review</p>
                <p className="mt-1 text-[0.68rem] text-on-surface-variant">Expected {count.expectedQuantity}, counted {count.countedQuantity}</p>
              </div>
              <span className={`font-mono text-sm font-semibold ${count.variance === 0 ? "text-success" : count.variance > 0 ? "text-primary" : "text-error"}`}>
                {count.variance > 0 ? "+" : ""}{count.variance}
              </span>
            </div>
            {count.note && <p className="mt-2 text-xs text-outline">{count.note}</p>}
            <div className="mt-3 flex gap-2">
              <button onClick={() => onReviewCount(item, count, "approve")} className="rounded-lg bg-success/12 px-3 py-1.5 text-xs font-semibold text-success hover:bg-success/18">Approve</button>
              <button onClick={() => onReviewCount(item, count, "reject")} className="rounded-lg bg-error/10 px-3 py-1.5 text-xs font-semibold text-error hover:bg-error/15">Reject</button>
            </div>
          </div>
        ))}
        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h4 className="text-xs font-semibold text-on-surface">Movement Ledger</h4>
            <span className="font-mono text-[0.65rem] text-outline">{item.movementCount ?? item.movements?.length ?? 0}</span>
          </div>
          <div className="space-y-2">
            {(item.movements ?? []).slice(0, 8).length === 0 ? (
              <p className="rounded-lg bg-surface-high/10 p-3 text-xs text-outline">No movements recorded yet.</p>
            ) : (
              (item.movements ?? []).slice(0, 8).map((movement) => <MovementRow key={movement.id} movement={movement} />)
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-outline-variant/8 bg-surface-high/15 p-3">
      <p className="text-[0.62rem] uppercase text-outline">{label}</p>
      <p className="mt-1 font-mono text-lg font-semibold text-on-surface">{value}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[0.62rem] uppercase text-outline">{label}</p>
      <p className="mt-1 truncate font-medium text-on-surface-variant" title={value}>{value}</p>
    </div>
  );
}

function MovementRow({ movement }: { movement: InventoryMovement }) {
  const signed = movement.quantity > 0 ? `+${movement.quantity}` : String(movement.quantity);
  const tone = movement.quantity > 0 ? "text-success" : movement.quantity < 0 ? "text-error" : "text-outline";
  return (
    <div className="rounded-lg border border-outline-variant/6 bg-surface-high/10 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-on-surface">{MOVEMENT_LABELS[movement.movementType] || movement.movementType}</p>
          <p className="mt-0.5 truncate text-[0.65rem] text-outline">{movement.referenceLabel || movement.note || movement.source}</p>
        </div>
        <p className={`font-mono text-xs font-semibold ${tone}`}>{signed}</p>
      </div>
      <p className="mt-2 text-[0.62rem] text-outline">{fmtDateTime(movement.createdAt)}</p>
    </div>
  );
}

function ItemModal({ item, busy, onClose, onSave }: {
  item: InventoryItem | null;
  busy: boolean;
  onClose: () => void;
  onSave: (draft: InventoryDraft, id?: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<InventoryDraft>(() => item ? draftFromItem(item) : EMPTY_DRAFT);
  const title = item ? "Edit inventory item" : "New inventory item";

  function set<K extends keyof InventoryDraft>(key: K, value: InventoryDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <Modal onClose={onClose} title={title} icon="inventory_2">
      <form onSubmit={(event) => { event.preventDefault(); void onSave(draft, item?.id); }} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Item code" value={draft.itemCode} onChange={(value) => set("itemCode", value)} />
          <Field label="Category" value={draft.category} onChange={(value) => set("category", value)} />
          <Field className="md:col-span-2" label="Description" value={draft.description} onChange={(value) => set("description", value)} required />
          <Field label="Warehouse" value={draft.warehouse} onChange={(value) => set("warehouse", value)} required />
          <Field label="Bin" value={draft.locationBin} onChange={(value) => set("locationBin", value)} />
          <Field label="UoM" value={draft.uom} onChange={(value) => set("uom", value.toUpperCase())} required />
          <Field label="On hand" value={draft.onHand} onChange={(value) => set("onHand", value)} type="number" />
          <Field label="Reserved" value={draft.reserved} onChange={(value) => set("reserved", value)} type="number" />
          <Field label="Inbound" value={draft.inbound} onChange={(value) => set("inbound", value)} type="number" />
          <Field label="Reorder point" value={draft.reorderPoint} onChange={(value) => set("reorderPoint", value)} type="number" />
          <label className="flex items-center gap-2 rounded-lg border border-outline-variant/8 bg-surface-high/15 px-3 py-2 text-xs text-on-surface-variant">
            <input type="checkbox" checked={draft.dangerousGoods} onChange={(event) => set("dangerousGoods", event.target.checked)} />
            Dangerous goods
          </label>
          <Field className="md:col-span-2" label="Notes" value={draft.notes} onChange={(value) => set("notes", value)} multiline />
        </div>
        <ModalActions onClose={onClose} busy={busy} submitLabel={item ? "Save item" : "Create item"} />
      </form>
    </Modal>
  );
}

function AdjustmentModal({ item, busy, onClose, onSave }: {
  item: InventoryItem;
  busy: boolean;
  onClose: () => void;
  onSave: (draft: AdjustmentDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<AdjustmentDraft>(EMPTY_ADJUSTMENT);

  return (
    <Modal onClose={onClose} title="Stock action" icon="sync_alt">
      <form onSubmit={(event) => { event.preventDefault(); void onSave(draft); }} className="space-y-4">
        <div className="rounded-lg border border-outline-variant/8 bg-surface-high/15 p-3">
          <p className="text-sm font-semibold text-on-surface">{item.description}</p>
          <p className="mt-1 text-xs text-outline">{item.warehouse} - {item.onHand} {item.uom} on hand</p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-[0.65rem] font-semibold uppercase text-outline">Action</span>
            <select value={draft.movementType} onChange={(event) => setDraft((current) => ({ ...current, movementType: event.target.value as AdjustmentType }))} className="w-full rounded-lg border border-outline-variant/8 bg-surface-high/20 px-3 py-2 text-sm text-on-surface outline-none focus:border-primary/20">
              <option value="receipt">Receive stock</option>
              <option value="issue">Issue stock</option>
              <option value="reserve">Reserve stock</option>
              <option value="release">Release reservation</option>
            </select>
          </label>
          <Field label="Quantity" value={draft.quantity} onChange={(value) => setDraft((current) => ({ ...current, quantity: value }))} type="number" />
          <Field className="md:col-span-2" label="Note" value={draft.note} onChange={(value) => setDraft((current) => ({ ...current, note: value }))} multiline />
        </div>
        <ModalActions onClose={onClose} busy={busy} submitLabel="Record movement" />
      </form>
    </Modal>
  );
}

function TransferModal({ item, warehouses, busy, onClose, onSave }: {
  item: InventoryItem;
  warehouses: string[];
  busy: boolean;
  onClose: () => void;
  onSave: (draft: TransferDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<TransferDraft>({ destinationWarehouse: "", destinationBin: "", quantity: "1", note: "" });
  const available = item.available ?? Math.max(0, item.onHand - item.reserved);

  return (
    <Modal onClose={onClose} title="Transfer stock" icon="move_item">
      <form onSubmit={(event) => { event.preventDefault(); void onSave(draft); }} className="space-y-4">
        <div className="rounded-lg border border-outline-variant/8 bg-surface-high/15 p-3">
          <p className="text-sm font-semibold text-on-surface">{item.description}</p>
          <p className="mt-1 text-xs text-outline">From {item.warehouse}{item.locationBin ? ` / ${item.locationBin}` : ""} - {available} {item.uom} available</p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-[0.65rem] font-semibold uppercase text-outline">Destination warehouse</span>
            <input required list="inventory-warehouses" value={draft.destinationWarehouse} onChange={(event) => setDraft((current) => ({ ...current, destinationWarehouse: event.target.value }))} className="w-full rounded-lg border border-outline-variant/8 bg-surface-high/20 px-3 py-2 text-sm text-on-surface outline-none focus:border-primary/20" />
            <datalist id="inventory-warehouses">{warehouses.map((name) => <option key={name} value={name} />)}</datalist>
          </label>
          <Field label="Destination bin" value={draft.destinationBin} onChange={(value) => setDraft((current) => ({ ...current, destinationBin: value }))} />
          <Field label="Quantity" value={draft.quantity} onChange={(value) => setDraft((current) => ({ ...current, quantity: value }))} type="number" required />
          <Field className="md:col-span-2" label="Transfer note" value={draft.note} onChange={(value) => setDraft((current) => ({ ...current, note: value }))} multiline />
        </div>
        <ModalActions onClose={onClose} busy={busy} submitLabel="Complete transfer" />
      </form>
    </Modal>
  );
}

function CycleCountModal({ item, busy, onClose, onSave }: {
  item: InventoryItem;
  busy: boolean;
  onClose: () => void;
  onSave: (draft: CycleCountDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<CycleCountDraft>({ countedQuantity: String(item.onHand), note: "" });
  const counted = Number(draft.countedQuantity);
  const variance = Number.isFinite(counted) ? counted - item.onHand : 0;

  return (
    <Modal onClose={onClose} title="Record cycle count" icon="fact_check">
      <form onSubmit={(event) => { event.preventDefault(); void onSave(draft); }} className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <DetailStat label="Expected" value={String(item.onHand)} />
          <DetailStat label="Counted" value={draft.countedQuantity || "0"} />
          <DetailStat label="Variance" value={`${variance > 0 ? "+" : ""}${variance}`} />
        </div>
        <div className="grid grid-cols-1 gap-3">
          <Field label={`Counted quantity (${item.uom})`} value={draft.countedQuantity} onChange={(value) => setDraft((current) => ({ ...current, countedQuantity: value }))} type="number" required />
          <Field label="Count note" value={draft.note} onChange={(value) => setDraft((current) => ({ ...current, note: value }))} multiline />
        </div>
        <p className="text-xs text-outline">The stock balance will not change until this count is approved.</p>
        <ModalActions onClose={onClose} busy={busy} submitLabel="Submit for review" />
      </form>
    </Modal>
  );
}

function CycleCountReviewModal({ review, busy, onClose, onSubmit }: {
  review: { item: InventoryItem; count: InventoryCycleCount; decision: "approve" | "reject" };
  busy: boolean;
  onClose: () => void;
  onSubmit: (reviewNote: string) => Promise<void>;
}) {
  const [reviewNote, setReviewNote] = useState("");
  const approving = review.decision === "approve";

  return (
    <Modal onClose={onClose} title={`${approving ? "Approve" : "Reject"} cycle count`} icon={approving ? "check_circle" : "cancel"}>
      <form onSubmit={(event) => { event.preventDefault(); void onSubmit(reviewNote); }} className="space-y-4">
        <div className="rounded-lg border border-outline-variant/8 bg-surface-high/15 p-3">
          <p className="text-sm font-semibold text-on-surface">{review.item.description}</p>
          <p className="mt-1 text-xs text-outline">Expected {review.count.expectedQuantity}, counted {review.count.countedQuantity}, variance {review.count.variance > 0 ? "+" : ""}{review.count.variance}</p>
        </div>
        <Field label="Review note" value={reviewNote} onChange={setReviewNote} multiline />
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-xs font-semibold text-outline hover:bg-surface-high/30">Cancel</button>
          <button type="submit" disabled={busy} className={`rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50 ${approving ? "bg-success/15 text-success hover:bg-success/20" : "bg-error/12 text-error hover:bg-error/18"}`}>
            {busy ? "Saving..." : approving ? "Approve adjustment" : "Reject count"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CatalogLinkModal({ item, busy, onClose, onLink }: {
  item: InventoryItem;
  busy: boolean;
  onClose: () => void;
  onLink: (catalogItemId: string) => Promise<void>;
}) {
  const [query, setQuery] = useState(item.itemCode || item.description);
  const [candidates, setCandidates] = useState<CatalogCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set("q", query.trim());
        const res = await fetch(`/api/v1/inventory/${item.id}/catalog-link?${params.toString()}`, { signal: controller.signal });
        const json = (await res.json()) as ApiResponse<CatalogCandidate[]>;
        if (!res.ok || json.ok === false || !json.data) throw new Error(json.error?.message || "Catalog search failed.");
        setCandidates(json.data);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof Error ? err.message : "Catalog search failed.");
        }
      } finally {
        setLoading(false);
      }
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [item.id, query]);

  return (
    <Modal onClose={onClose} title="Link catalog item" icon="link">
      <div className="space-y-4">
        <div className="rounded-lg border border-outline-variant/8 bg-surface-high/15 p-3">
          <p className="text-sm font-semibold text-on-surface">{item.description}</p>
          <p className="mt-1 text-xs text-outline">{item.itemCode || "No item code"} - {item.warehouse}</p>
        </div>
        <Field label="Search catalog" value={query} onChange={setQuery} />
        {error && <p className="rounded-lg border border-error/15 bg-error/8 p-3 text-xs text-error">{error}</p>}
        <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
          {loading ? (
            <p className="rounded-lg bg-surface-high/10 p-3 text-xs text-outline">Searching catalog...</p>
          ) : candidates.length === 0 ? (
            <p className="rounded-lg bg-surface-high/10 p-3 text-xs text-outline">No catalog candidates found.</p>
          ) : (
            candidates.map((candidate) => (
              <div key={candidate.id} className="flex items-start justify-between gap-3 rounded-lg border border-outline-variant/8 bg-surface-high/10 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-on-surface">{candidate.description}</p>
                  <p className="mt-1 flex flex-wrap gap-2 text-[0.65rem] text-outline">
                    {candidate.impaCode && <span className="font-mono">{candidate.impaCode}</span>}
                    {candidate.category && <span>{candidate.category}</span>}
                    {candidate.unit && <span>{candidate.unit}</span>}
                    {candidate.countryOrigin && <span>{candidate.countryOrigin}</span>}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onLink(candidate.id)}
                  className="shrink-0 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-on-primary hover:brightness-110 disabled:opacity-50"
                >
                  {busy ? "Linking..." : "Link"}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}

function ImportCsvModal({ busy, onClose, onImport }: {
  busy: boolean;
  onClose: () => void;
  onImport: (csv: string) => Promise<void>;
}) {
  const [csv, setCsv] = useState("itemCode,description,category,warehouse,locationBin,uom,onHand,reserved,inbound,reorderPoint,dangerousGoods,notes\n");

  return (
    <Modal onClose={onClose} title="Import inventory CSV" icon="upload_file">
      <form onSubmit={(event) => { event.preventDefault(); void onImport(csv); }} className="space-y-4">
        <label className="space-y-1">
          <span className="text-[0.65rem] font-semibold uppercase text-outline">CSV rows</span>
          <textarea
            value={csv}
            onChange={(event) => setCsv(event.target.value)}
            rows={10}
            className="w-full resize-y rounded-lg border border-outline-variant/8 bg-surface-high/20 px-3 py-2 font-mono text-xs text-on-surface outline-none focus:border-primary/20"
          />
        </label>
        <p className="text-xs text-outline">Required columns: description, warehouse, uom. Existing rows update by id or itemCode plus warehouse.</p>
        <ModalActions onClose={onClose} busy={busy} submitLabel="Import CSV" />
      </form>
    </Modal>
  );
}

function ConfirmDeleteModal({ item, busy, onCancel, onConfirm }: { item: InventoryItem; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal onClose={onCancel} title="Delete inventory item" icon="delete">
      <div className="space-y-4">
        <p className="text-sm text-on-surface-variant">Delete <span className="font-semibold text-on-surface">{item.description}</span> and its movement ledger?</p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg px-3 py-2 text-xs font-semibold text-outline hover:bg-surface-high/30">Cancel</button>
          <button onClick={onConfirm} disabled={busy} className="rounded-lg bg-error/12 px-3 py-2 text-xs font-semibold text-error hover:bg-error/18 disabled:opacity-50">{busy ? "Deleting..." : "Delete"}</button>
        </div>
      </div>
    </Modal>
  );
}

function Modal({ children, onClose, title, icon }: { children: ReactNode; onClose: () => void; title: string; icon: string }) {
  const dialogRef = useDialogA11y<HTMLDivElement>(onClose);
  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} className="mt-8 w-full max-w-2xl rounded-xl border border-outline-variant/12 bg-surface-container shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-outline-variant/8 px-5 py-4">
          <div className="flex items-center gap-2">
            <Ic name={icon} className="text-base text-primary" />
            <h3 className="text-sm font-semibold text-on-surface">{title}</h3>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-outline hover:bg-surface-high/30 hover:text-on-surface-variant" title="Close">
            <Ic name="close" className="text-base" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", required = false, multiline = false, className = "" }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  multiline?: boolean;
  className?: string;
}) {
  return (
    <label className={`space-y-1 ${className}`}>
      <span className="text-[0.65rem] font-semibold uppercase text-outline">{label}</span>
      {multiline ? (
        <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={3} className="w-full resize-none rounded-lg border border-outline-variant/8 bg-surface-high/20 px-3 py-2 text-sm text-on-surface outline-none focus:border-primary/20" />
      ) : (
        <input required={required} type={type} min={type === "number" ? 0 : undefined} value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-outline-variant/8 bg-surface-high/20 px-3 py-2 text-sm text-on-surface outline-none focus:border-primary/20" />
      )}
    </label>
  );
}

function ModalActions({ onClose, busy, submitLabel }: { onClose: () => void; busy: boolean; submitLabel: string }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-xs font-semibold text-outline hover:bg-surface-high/30">Cancel</button>
      <button type="submit" disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-on-primary hover:brightness-110 disabled:opacity-50">{busy ? "Saving..." : submitLabel}</button>
    </div>
  );
}

function InventorySkeleton() {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="h-14 animate-pulse rounded-lg bg-surface-high/20" />
      ))}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex min-h-[420px] items-center justify-center p-8 text-center">
      <div>
        <Ic name="inventory_2" className="text-3xl text-outline" />
        <p className="mt-3 text-sm font-semibold text-on-surface-variant">No inventory records</p>
        <button onClick={onCreate} className="mt-4 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-on-primary">Create first item</button>
      </div>
    </div>
  );
}

function draftFromItem(item: InventoryItem): InventoryDraft {
  return {
    itemCode: item.itemCode || "",
    description: item.description,
    category: item.category || "",
    warehouse: item.warehouse,
    locationBin: item.locationBin || "",
    uom: item.uom,
    onHand: String(item.onHand),
    reserved: String(item.reserved ?? 0),
    inbound: String(item.inbound ?? 0),
    reorderPoint: String(item.reorderPoint),
    dangerousGoods: item.dangerousGoods,
    notes: item.notes || "",
  };
}

function fmtDateTime(value: string | Date) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
