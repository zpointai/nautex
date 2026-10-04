"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import type { PurchaseOrder } from "@/types/erp";
import type { VesselOrderLink, VesselResult, VesselRisk, VesselTrackPoint } from "@/types/vessel";
import { useDialogA11y } from "@/lib/hooks/use-dialog-a11y";

const FleetMap = dynamic(() => import("@/components/fleet-map").then((mod) => mod.FleetMap), { ssr: false });

interface VesselTrackingPanelProps {
  purchaseOrders: PurchaseOrder[];
}

interface RelatedOrderRow extends VesselOrderLink {
  order: PurchaseOrder | null;
}

type WatchlistRow = { id: string; vesselId: string | null; mmsi: string; imo: string | null; name: string; note: string | null };
type VesselPayload<T> = { data?: T; meta?: { warnings?: string[]; source?: string }; error?: string };
type Notice = { tone: "success" | "info" | "warning"; message: string };

const EMPTY_RISK: VesselRisk = {
  vesselId: "",
  confidence: "Low",
  etaRisk: "Monitor",
  summary: "Search for a vessel to generate tracking insights.",
  anomalies: [],
};

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return <span className={`material-symbols-outlined ${className}`} style={{ fontVariationSettings: "'FILL' 0" }}>{name}</span>;
}

function formatDate(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}

function coord(value?: number) {
  if (typeof value !== "number") return "-";
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(5);
}

function coordinatesText(vessel?: Pick<VesselResult, "lat" | "lng"> | null) {
  if (!vessel) return "-";
  const value = `${coord(vessel.lat)}, ${coord(vessel.lng)}`;
  return Number.isInteger(vessel.lat) && Number.isInteger(vessel.lng) ? `${value} (approx.)` : value;
}

function normalizedName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function isPastDate(value?: string) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
}

function etaText(value?: string) {
  if (!value) return "-";
  const formatted = formatDate(value);
  return isPastDate(value) ? `${formatted} (past ETA)` : formatted;
}

function money(value: number, currency = "EUR") {
  return new Intl.NumberFormat([], { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

function shouldAutoSelect(query: string, list: VesselResult[]) {
  if (list.length === 0) return false;
  if (/^\d{7,9}$/.test(query.trim())) return true;
  const exactMatches = list.filter((vessel) => normalizedName(vessel.name) === normalizedName(query));
  return exactMatches.length <= 1;
}

function statusTone(status?: string) {
  const value = (status || "").toLowerCase();
  if (value.includes("moor") || value.includes("anchor")) return "bg-accent-amber";
  if (value.includes("restrict")) return "bg-success";
  return "bg-success";
}

function vesselImage(vessel: Pick<VesselResult, "mmsi" | "imo" | "imageUrl">) {
  if (vessel.imageUrl) return vessel.imageUrl;
  if (vessel.imo === "9811000") return "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0a/IMO_9811000_EVER_GIVEN_%2812%29.JPG/640px-IMO_9811000_EVER_GIVEN_%2812%29.JPG";
  return vessel.mmsi ? `https://photos.marinetraffic.com/ais/showphoto.aspx?mmsi=${vessel.mmsi}&size=large` : "";
}

function VesselThumb({ vessel, large = false }: { vessel: VesselResult; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  const url = failed ? "" : vesselImage(vessel);
  return (
    <div className={`shrink-0 overflow-hidden rounded-lg border border-outline-variant/30 bg-surface-lowest ${large ? "h-36 w-full sm:w-72" : "h-14 w-20"}`}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- Vessel photos come from variable external providers and retain an onError fallback.
        <img src={url} alt={vessel.name} onError={() => setFailed(true)} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-success">
          <Icon name="directions_boat" className={large ? "text-4xl" : "text-xl"} />
        </div>
      )}
    </div>
  );
}

export function VesselTrackingPanel({ purchaseOrders }: VesselTrackingPanelProps) {
  const [searchName, setSearchName] = useState("");
  const [searchMmsi, setSearchMmsi] = useState("");
  const [searchImo, setSearchImo] = useState("");
  const [results, setResults] = useState<VesselResult[]>([]);
  const [selected, setSelected] = useState<VesselResult | null>(null);
  const [track, setTrack] = useState<VesselTrackPoint[]>([]);
  const [risk, setRisk] = useState<VesselRisk>(EMPTY_RISK);
  const [relatedOrders, setRelatedOrders] = useState<RelatedOrderRow[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistRow[]>([]);
  const [recent, setRecent] = useState<VesselResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [recentDeleteTarget, setRecentDeleteTarget] = useState<VesselResult | null>(null);
  const [deletingRecentMmsi, setDeletingRecentMmsi] = useState<string | null>(null);
  const [dialogMounted, setDialogMounted] = useState(false);

  const [linkOrderId, setLinkOrderId] = useState("");
  const [linkPort, setLinkPort] = useState("");
  const [linkStage, setLinkStage] = useState<VesselOrderLink["stage"]>("Delivery");
  const [linkImpact, setLinkImpact] = useState<VesselOrderLink["impact"]>("Medium");
  const [linkingOrder, setLinkingOrder] = useState(false);
  const [linkNotice, setLinkNotice] = useState<Notice | null>(null);

  const loadWatchlist = useCallback(async () => {
    const res = await fetch("/api/v1/vessels/watchlist");
    const payload = await res.json();
    if (payload.data) setWatchlist(payload.data);
  }, []);

  const loadRecent = useCallback(async () => {
    const res = await fetch("/api/v1/vessels/recent");
    const payload = (await res.json()) as VesselPayload<VesselResult[]>;
    if (payload.data) setRecent(payload.data);
  }, []);

  const loadDetails = useCallback(async (id: string) => {
    const liveRes = await fetch(`/api/v1/vessels/${encodeURIComponent(id)}/live`);
    if (!liveRes.ok) {
      const payload = await liveRes.json();
      throw new Error(payload.error ?? "Failed to fetch vessel.");
    }
    const live = (await liveRes.json()) as VesselPayload<VesselResult>;
    setSourceWarnings([...(live.meta?.warnings ?? []), ...(live.data?.warnings ?? [])]);
    if (!live.data) throw new Error("No vessel position was returned.");

    const [trackRes, riskRes, relatedRes] = await Promise.all([
      fetch(`/api/v1/vessels/${encodeURIComponent(live.data.id)}/track`),
      fetch(`/api/v1/vessels/${encodeURIComponent(live.data.id)}/eta-risk`),
      fetch(`/api/v1/vessels/${encodeURIComponent(live.data.id)}/related-orders`),
    ]);
    const trackPayload = (await trackRes.json()) as VesselPayload<VesselTrackPoint[]>;
    const riskPayload = (await riskRes.json()) as VesselPayload<VesselRisk>;
    const relatedPayload = (await relatedRes.json()) as VesselPayload<RelatedOrderRow[]>;
    const vessel = { ...live.data, refreshedAt: live.data.refreshedAt ?? new Date().toISOString() };
    setSelected(vessel);
    setTrack(trackPayload.data ?? []);
    setRisk(riskPayload.data ?? EMPTY_RISK);
    setRelatedOrders(relatedPayload.data ?? []);
    setRecent((prev) => [vessel, ...prev.filter((item) => item.id !== vessel.id)].slice(0, 8));
    return vessel;
  }, []);

  const searchVesselQuery = useCallback(async (query: string) => {
    const q = query.trim();
    if (q.length < 2) {
      setError("Enter a vessel name, MMSI, or IMO number.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/vessels/search?q=${encodeURIComponent(q)}`);
      const payload = (await res.json()) as VesselPayload<VesselResult[]>;
      if (!res.ok) throw new Error(payload.error ?? "Search failed.");
      const list = payload.data ?? [];
      setResults(list);
      setSourceWarnings(payload.meta?.warnings ?? []);
      setNotice(null);
      if (list[0] && shouldAutoSelect(q, list)) {
        await loadDetails(list[0].id);
      } else if (list.length > 1) {
        setSelected(null);
        setTrack([]);
        setRisk(EMPTY_RISK);
        setRelatedOrders([]);
        setNotice({ tone: "warning", message: `${list.length} vessel matches found. Select the correct vessel by IMO, MMSI, flag, type, or destination.` });
      } else if (!list[0]) {
        setSelected(null);
        setTrack([]);
        setRisk(EMPTY_RISK);
        setRelatedOrders([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  }, [loadDetails]);

  const handleSearch = useCallback(async (event?: React.FormEvent) => {
    event?.preventDefault();
    const q = searchMmsi.trim() || searchImo.trim() || searchName.trim();
    await searchVesselQuery(q);
  }, [searchImo, searchMmsi, searchName, searchVesselQuery]);

  useEffect(() => {
    const openFromQuery = (query: string) => {
      const value = query.trim();
      if (value.length < 2) return;
      setSearchName(value);
      setSearchMmsi("");
      setSearchImo("");
      void searchVesselQuery(value);
    };

    const openFromHash = () => {
      const hash = window.location.hash.replace(/^#/, "");
      const [moduleKey, ...parts] = hash.split(":");
      if (moduleKey !== "vessels") return;
      const value = decodeURIComponent(parts.join(":"));
      openFromQuery(value);
    };

    const handleRecordContext = (event: Event) => {
      const detail = (event as CustomEvent<{ moduleKey?: string; id?: string; title?: string; vesselQuery?: string }>).detail;
      if (detail?.moduleKey !== "vessels") return;
      openFromQuery(detail.vesselQuery || detail.id || detail.title || "");
    };

    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    window.addEventListener("nautex:record-context", handleRecordContext);
    return () => {
      window.removeEventListener("hashchange", openFromHash);
      window.removeEventListener("nautex:record-context", handleRecordContext);
    };
  }, [searchVesselQuery]);

  const handleRefresh = useCallback(async (vessel = selected) => {
    if (!vessel) return;
    setRefreshing(true);
    setError(null);
    setNotice(null);
    try {
      const refreshed = await loadDetails(vessel.id);
      setNotice({ tone: "success", message: `${refreshed.name} checked against ${refreshed.sourceLabel || "the live maritime source"} at ${formatDate(refreshed.refreshedAt)}.` });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed.");
    } finally {
      setRefreshing(false);
    }
  }, [loadDetails, selected]);

  const handleToggleWatchlist = useCallback(async () => {
    if (!selected) return;
    const watched = watchlist.some((item) => item.mmsi === selected.mmsi);
    const res = watched
      ? await fetch(`/api/v1/vessels/watchlist?mmsi=${encodeURIComponent(selected.mmsi)}`, { method: "DELETE" })
      : await fetch("/api/v1/vessels/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vesselId: selected.id, mmsi: selected.mmsi, imo: selected.imo, name: selected.name, note: selected.destination }),
        });
    if (!res.ok) setError("Failed to update watchlist.");
    if (watched) setWatchlist((prev) => prev.filter((item) => item.mmsi !== selected.mmsi));
    await loadWatchlist();
  }, [loadWatchlist, selected, watchlist]);

  const handleRemoveFromWatchlist = useCallback(async (vessel: VesselResult) => {
    if (!vessel.mmsi) return;
    const res = await fetch(`/api/v1/vessels/watchlist?mmsi=${encodeURIComponent(vessel.mmsi)}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Failed to remove vessel from watchlist.");
      return;
    }
    setWatchlist((prev) => prev.filter((item) => item.mmsi !== vessel.mmsi));
    await loadWatchlist();
  }, [loadWatchlist]);

  const handleClearRecent = useCallback(() => {
    setRecent([]);
  }, []);

  const requestDeleteRecent = useCallback((vessel: VesselResult) => {
    if (!vessel.mmsi) return;
    setError(null);
    setRecentDeleteTarget(vessel);
  }, []);

  const confirmDeleteRecent = useCallback(async () => {
    if (!recentDeleteTarget?.mmsi) return;
    const targetMmsi = recentDeleteTarget.mmsi;
    setDeletingRecentMmsi(targetMmsi);
    setError(null);
    try {
      const res = await fetch(`/api/v1/vessels/recent?mmsi=${encodeURIComponent(targetMmsi)}`, { method: "DELETE" });
      if (!res.ok) {
        setError("Failed to delete recent vessel.");
        return;
      }
      setRecent((prev) => prev.filter((item) => item.mmsi !== targetMmsi));
      if (selected?.mmsi === targetMmsi) setTrack([]);
      setRecentDeleteTarget(null);
      setNotice({ tone: "success", message: `${recentDeleteTarget.name} was removed from Recent Tracked Vessels.` });
    } finally {
      setDeletingRecentMmsi(null);
    }
  }, [recentDeleteTarget, selected?.mmsi]);

  const openLinkedOrder = useCallback((link: RelatedOrderRow) => {
    const order = link.order;
    if (!order || typeof window === "undefined") return;
    const detail = {
      id: order.id,
      module: "Purchase Orders",
      moduleKey: "purchaseOrders",
      title: order.poNumber,
      subtitle: `${order.vessel} / ${order.buyerName || order.vesselOwner || order.supplier}`,
      icon: "receipt_long",
    };
    window.history.replaceState(null, "", `#purchaseOrders:${encodeURIComponent(order.id)}`);
    window.dispatchEvent(new CustomEvent("nautex:record-context", { detail }));
  }, []);

  const handleLinkOrder = useCallback(async () => {
    if (!selected) return;
    if (!linkOrderId) {
      setLinkNotice({ tone: "warning", message: "Select a purchase order before linking it to this vessel." });
      return;
    }

    const order = purchaseOrders.find((po) => po.id === linkOrderId);
    const port = linkPort.trim() || order?.port?.trim() || selected.destination?.trim();
    if (!port) {
      setLinkNotice({ tone: "warning", message: "Add a port or select an order with a delivery port before linking." });
      return;
    }

    setLinkingOrder(true);
    setLinkNotice(null);
    try {
      const res = await fetch(`/api/v1/vessels/${encodeURIComponent(selected.id)}/link-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: linkOrderId, stage: linkStage, port, impact: linkImpact }),
      });
      const payload = (await res.json()) as VesselPayload<VesselOrderLink>;
      if (!res.ok || !payload.data) {
        setLinkNotice({ tone: "warning", message: typeof payload.error === "string" ? payload.error : "Failed to link order." });
        return;
      }
      await loadDetails(selected.id);
      setLinkPort("");
      setLinkNotice({ tone: "success", message: `${order?.poNumber || "Order"} is linked to ${selected.name} for ${port}.` });
    } catch (err) {
      setLinkNotice({ tone: "warning", message: err instanceof Error ? err.message : "Failed to link order." });
    } finally {
      setLinkingOrder(false);
    }
  }, [linkImpact, linkOrderId, linkPort, linkStage, loadDetails, purchaseOrders, selected]);

  useEffect(() => {
    loadWatchlist().catch(() => undefined);
    loadRecent().catch(() => undefined);
  }, [loadRecent, loadWatchlist]);

  useEffect(() => {
    setDialogMounted(true);
  }, []);

  const isWatched = Boolean(selected && watchlist.some((item) => item.mmsi === selected.mmsi));
  const selectedOrder = useMemo(() => purchaseOrders.find((po) => po.id === linkOrderId) ?? null, [linkOrderId, purchaseOrders]);
  const portPlaceholder = selectedOrder?.port || selected?.destination || "Port";
  const linkedOrderSummary = useMemo(() => {
    const orders = relatedOrders.map((link) => link.order).filter((order): order is PurchaseOrder => Boolean(order));
    const currencies = new Set(orders.map((order) => order.currency));
    const total = orders.reduce((sum, order) => sum + order.total, 0);
    const atRisk = orders.filter((order) => order.status === "At_Risk").length;
    const pending = orders.filter((order) => order.status === "Pending_Approval").length;
    const highImpact = relatedOrders.filter((link) => link.impact === "High").length;
    return {
      count: relatedOrders.length,
      value: orders.length > 0 && currencies.size <= 1 ? money(total, orders[0]?.currency || "EUR") : orders.length > 0 ? "Mixed currency" : "-",
      atRisk,
      pending,
      highImpact,
    };
  }, [relatedOrders]);
  const insights = useMemo(() => {
    const rows = [];
    if (selected && typeof selected.lat === "number" && typeof selected.lng === "number") rows.push({ tone: "success", title: "Position ready", body: `The map can use the last known position for ${selected.name}: ${coordinatesText(selected)}.` });
    if (selected?.sourceLabel) rows.push({ tone: "info", title: "Source checked", body: `${selected.sourceLabel} returned the current vessel record${selected.refreshedAt ? ` at ${formatDate(selected.refreshedAt)}` : ""}.` });
    if (selected?.imageUrl) rows.push({ tone: "success", title: "Image available", body: "A vessel image was found and attached to the tracking record." });
    if (selected?.eta && isPastDate(selected.eta)) rows.push({ tone: "info", title: "Past ETA", body: `${selected.name} has an ETA before the current date. Treat destination timing as stale until the operator verifies it.` });
    if (selected?.destination) rows.push({ tone: "info", title: "Destination captured", body: `${selected.name} is associated with ${selected.destination}${selected.eta ? ` and ETA ${etaText(selected.eta)}` : ""}.` });
    if (track.length > 1) rows.push({ tone: "success", title: "History available", body: `${track.length} track points are available for movement checks.` });
    sourceWarnings.slice(0, 1).forEach((warning) => rows.push({ tone: "info", title: "Source note", body: warning }));
    if (watchlist.length > 0) rows.push({ tone: "info", title: "Watchlist active", body: `${watchlist.length} vessels are pinned for follow-up tracking.` });
    if (!rows.length) rows.push({ tone: "info", title: "Search guidance", body: "Search by IMO or MMSI for the strongest match." });
    return rows.slice(0, 5);
  }, [selected, sourceWarnings, track.length, watchlist.length]);

  return (
    <div className="grid max-w-none gap-4 xl:grid-cols-[320px_minmax(0,1fr)_340px]">
      <aside className="space-y-4">
        <form onSubmit={handleSearch} className="rounded-xl border border-outline-variant/20 bg-surface-container">
          <div className="border-b border-outline-variant/20 p-4">
            <h3 className="flex items-center gap-2 text-sm font-bold text-on-surface">
              <Icon name="search" className="text-lg text-success" /> Find Vessel
            </h3>
            <p className="mt-1 text-[0.7rem] text-on-surface-variant">Search by vessel name, MMSI, or IMO number.</p>
            <p className="mt-2 text-sm text-on-surface-variant">To register a customer fleet before tracking or ordering, use <a href="#purchaseOrders" className="text-primary underline">Shipping Companies &amp; Fleet</a> in Purchase Orders.</p>
          </div>
          <div className="space-y-4 p-4">
            <label className="block">
              <span className="mb-1 block text-[0.6rem] font-bold uppercase tracking-wider text-secondary">Vessel Name</span>
              <input value={searchName} onChange={(e) => setSearchName(e.target.value)} className="w-full rounded-lg border border-outline-variant/40 bg-surface-lowest px-3 py-2 text-sm text-on-surface outline-none focus:border-success/50" placeholder="Enter vessel name" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-[0.6rem] font-bold uppercase tracking-wider text-secondary">MMSI</span>
                <input value={searchMmsi} onChange={(e) => setSearchMmsi(e.target.value)} className="w-full rounded-lg border border-outline-variant/40 bg-surface-lowest px-3 py-2 text-sm text-on-surface outline-none focus:border-success/50" placeholder="9-digit" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[0.6rem] font-bold uppercase tracking-wider text-secondary">IMO Number</span>
                <input value={searchImo} onChange={(e) => setSearchImo(e.target.value)} className="w-full rounded-lg border border-outline-variant/40 bg-surface-lowest px-3 py-2 text-sm text-on-surface outline-none focus:border-success/50" placeholder="7-digit" />
              </label>
            </div>
            <button disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-lg bg-success px-4 py-2.5 text-sm font-bold text-on-primary disabled:opacity-50">
              <Icon name="search" className="text-base" /> {loading ? "Searching..." : "Search Vessel"}
            </button>
          </div>
          <div className="border-t border-outline-variant/20 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-[0.6rem] font-bold uppercase tracking-wider text-secondary">Search Results</span>
              </div>
            {error && <div className="mb-3 rounded-lg border border-error/30 bg-error-container/20 p-3 text-xs text-error">{error}</div>}
            {notice && (
              <div className={`mb-3 rounded-lg border p-3 text-xs ${notice.tone === "success" ? "border-success/25 bg-success/10 text-success" : notice.tone === "warning" ? "border-accent-amber/25 bg-accent-amber/10 text-accent-amber" : "border-outline-variant/30 bg-surface-lowest text-secondary"}`}>
                {notice.message}
              </div>
            )}
            {sourceWarnings.length > 0 && <div className="mb-3 rounded-lg border border-accent-amber/20 bg-accent-amber/8 p-3 text-xs text-accent-amber">{sourceWarnings[0]}</div>}
            {results.length === 0 ? (
              <div className="rounded-lg border border-dashed border-outline-variant/40 bg-surface-lowest/50 px-4 py-8 text-center text-xs text-on-surface-variant">Search VesselFinder by vessel name, MMSI, or IMO number. Results are cached locally after a successful lookup.</div>
            ) : (
              <div className="space-y-2">
                {results.map((vessel) => (
                  <button key={vessel.id} type="button" onClick={() => void loadDetails(vessel.id)} className={`w-full rounded-lg border p-3 text-left transition ${selected?.id === vessel.id ? "border-success/40 bg-success/10" : "border-outline-variant/20 bg-surface-lowest hover:border-success/30"}`}>
                    <div className="flex gap-3">
                      <VesselThumb vessel={vessel} />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-on-surface">{vessel.name}</span>
                        <span className="mt-1 block text-[0.65rem] text-on-surface-variant">IMO {vessel.imo || "-"} | MMSI {vessel.mmsi || "-"}</span>
                        <span className="mt-1 block text-[0.62rem] text-secondary">{vessel.flag || "-"} | {vessel.type || "Type unknown"}</span>
                        <span className="mt-1 block truncate text-[0.62rem] text-on-surface-variant">{vessel.destination || "Destination unknown"} | {vessel.status || "Status unknown"}</span>
                        <span className="mt-1 block text-[0.62rem] text-success">{vessel.sourceLabel || "Live maritime source"}</span>
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </form>
      </aside>

      <main className="min-w-0 space-y-6">
        <FleetMap vessel={selected} track={track} />

        {selected ? (
          <section className="overflow-hidden rounded-xl border border-outline-variant/20 bg-surface-container">
            <div className="flex flex-col gap-4 border-b border-outline-variant/20 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 gap-4">
                <VesselThumb vessel={selected} large />
                <div className="min-w-0">
                  <h2 className="truncate text-xl font-bold text-on-surface">{selected.name}</h2>
                  <div className="mt-2 flex flex-wrap gap-2 text-[0.65rem] text-secondary">
                    <span className="rounded border border-outline-variant/30 bg-surface-lowest px-2 py-1">IMO {selected.imo || "-"}</span>
                    <span className="rounded border border-outline-variant/30 bg-surface-lowest px-2 py-1">MMSI {selected.mmsi}</span>
                    <span className="rounded border border-outline-variant/30 bg-surface-lowest px-2 py-1">{selected.flag || "-"}</span>
                    <span className="rounded border border-success/20 bg-success/10 px-2 py-1 text-success">{selected.sourceLabel || "Live maritime source"}</span>
                    {selected.refreshedAt && <span className="rounded border border-outline-variant/30 bg-surface-lowest px-2 py-1">Checked {formatDate(selected.refreshedAt)}</span>}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button onClick={() => void handleToggleWatchlist()} className={`rounded-lg border px-3 py-2 text-xs font-bold ${isWatched ? "border-accent-amber/30 bg-accent-amber/10 text-accent-amber" : "border-outline-variant/30 bg-surface-lowest text-secondary hover:border-success/40"}`}>
                      {isWatched ? "Watching" : "Watch"}
                    </button>
                    <span className="flex items-center gap-2 rounded-lg border border-outline-variant/30 bg-surface-lowest px-3 py-2 text-xs text-secondary">
                      <span className={`h-2 w-2 rounded-full ${statusTone(selected.status)}`} /> {selected.status || "Status unknown"}
                    </span>
                  </div>
                </div>
              </div>
              <button onClick={() => void handleRefresh()} disabled={refreshing} className="inline-flex items-center justify-center gap-2 rounded-lg border border-success/20 bg-success/10 px-3 py-2 text-xs font-bold text-success disabled:opacity-50">
                <Icon name="sync" className={refreshing ? "animate-spin text-base" : "text-base"} /> Refresh position
              </button>
            </div>

            <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div>
                <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-on-surface"><Icon name="anchor" className="text-base text-secondary" /> Vessel Details</h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {[
                    ["Vessel Type", selected.type],
                    ["Speed", `${selected.speed.toFixed(1)} kn`],
                    ["Course", `${selected.course} deg`],
                    ["Heading", `${selected.heading} deg`],
                    ["Destination", selected.destination],
                    ["ETA", etaText(selected.eta)],
                    ["Draught", selected.draught ? `${selected.draught} m` : "-"],
                    ["Dimensions", selected.length && selected.beam ? `${selected.length} x ${selected.beam} m` : "-"],
                    ["Coordinates", coordinatesText(selected)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-outline-variant/30 bg-surface-lowest p-3">
                      <div className="text-[0.55rem] font-bold uppercase tracking-widest text-on-surface-variant">{label}</div>
                      <div className="mt-1 break-words text-xs font-semibold text-on-surface">{value || "-"}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-on-surface"><Icon name="navigation" className="text-base text-secondary" /> Movement Summary</h3>
                <div className="space-y-4 rounded-lg border border-outline-variant/30 bg-surface-lowest p-4">
                  <div className="flex gap-3">
                    <div className="mt-1 flex flex-col items-center"><span className="h-2.5 w-2.5 rounded-full bg-success" /><span className="h-10 w-px bg-outline-variant/40" /></div>
                    <div>
                      <div className="text-sm font-bold text-on-surface">Position record time</div>
                      <div className="mt-1 text-xs text-on-surface-variant">{formatDate(selected.timestamp)}</div>
                      <div className="mt-1 text-xs text-on-surface-variant">{coordinatesText(selected)}</div>
                      {selected.refreshedAt && <div className="mt-1 text-xs text-success">Checked {formatDate(selected.refreshedAt)}</div>}
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <span className="mt-1 h-2.5 w-2.5 rounded-full bg-accent-amber" />
                    <div>
                      <div className="text-sm font-bold text-on-surface">{selected.destination || "Destination unknown"}</div>
                      <div className={`mt-1 text-xs ${isPastDate(selected.eta) ? "text-accent-amber" : "text-on-surface-variant"}`}>ETA {etaText(selected.eta)}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-outline-variant/20 p-5">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-on-surface"><Icon name="insights" className="text-base text-secondary" /> Operational Context</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {[
                  ["Linked Orders", linkedOrderSummary.count],
                  ["Linked Value", linkedOrderSummary.value],
                  ["High Impact", linkedOrderSummary.highImpact],
                  ["Pending Review", linkedOrderSummary.pending],
                  ["ETA Risk", risk.etaRisk],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-outline-variant/25 bg-surface-lowest p-3">
                    <div className="text-[0.55rem] font-bold uppercase tracking-widest text-on-surface-variant">{label}</div>
                    <div className="mt-1 text-xs font-semibold text-on-surface">{value}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <div className="rounded-lg border border-outline-variant/25 bg-surface-lowest p-3">
                  <div className="text-[0.55rem] font-bold uppercase tracking-widest text-on-surface-variant">Snapshot History</div>
                  <div className="mt-1 text-xs font-semibold text-on-surface">{track.filter((point) => point.source).length} persisted / {track.length} visible</div>
                </div>
                <div className="rounded-lg border border-outline-variant/25 bg-surface-lowest p-3">
                  <div className="text-[0.55rem] font-bold uppercase tracking-widest text-on-surface-variant">Order Exceptions</div>
                  <div className="mt-1 text-xs font-semibold text-on-surface">{linkedOrderSummary.atRisk} at risk / {linkedOrderSummary.pending} pending approval</div>
                </div>
              </div>
            </div>

          <div className="border-t border-outline-variant/20 p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-on-surface">Link Order to Vessel</h3>
              {relatedOrders.length > 0 && <span className="rounded border border-outline-variant/30 bg-surface-lowest px-2 py-1 text-xs text-on-surface-variant">{relatedOrders.length} linked</span>}
            </div>
            <div className="space-y-3">
              {linkNotice && (
                <div className={`rounded-lg border p-3 text-xs ${linkNotice.tone === "success" ? "border-success/25 bg-success/10 text-success" : "border-accent-amber/25 bg-accent-amber/10 text-accent-amber"}`}>
                  {linkNotice.message}
                </div>
              )}
              <div className="grid gap-2 md:grid-cols-[minmax(220px,1.5fr)_minmax(120px,0.8fr)_120px_120px_auto]">
                <select value={linkOrderId} onChange={(e) => setLinkOrderId(e.target.value)} className="min-w-0 rounded-lg bg-surface-lowest px-3 py-2 text-xs text-on-surface outline-none">
                  <option value="">Select order</option>
                  {purchaseOrders.map((po) => <option key={po.id} value={po.id}>{po.poNumber} - {po.vessel}</option>)}
                </select>
                <input value={linkPort} onChange={(e) => setLinkPort(e.target.value)} placeholder={portPlaceholder} className="min-w-0 rounded-lg bg-surface-lowest px-3 py-2 text-xs text-on-surface outline-none" />
                <select value={linkStage} onChange={(e) => setLinkStage(e.target.value as VesselOrderLink["stage"])} className="rounded-lg bg-surface-lowest px-3 py-2 text-xs text-on-surface outline-none">
                  <option value="Delivery">Delivery</option>
                  <option value="PO">PO</option>
                  <option value="RFQ">RFQ</option>
                </select>
                <select value={linkImpact} onChange={(e) => setLinkImpact(e.target.value as VesselOrderLink["impact"])} className="rounded-lg bg-surface-lowest px-3 py-2 text-xs text-on-surface outline-none">
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                  <option value="Low">Low</option>
                </select>
                <button type="button" onClick={() => void handleLinkOrder()} disabled={linkingOrder || !selected} className="rounded-lg bg-success px-4 py-2 text-xs font-bold text-on-primary disabled:opacity-50">
                  {linkingOrder ? "Linking..." : "Link"}
                </button>
              </div>
              {relatedOrders.length > 0 && (
                <div className="grid gap-2 lg:grid-cols-2">
                  {relatedOrders.map((link) => (
                    <button key={link.id} type="button" onClick={() => openLinkedOrder(link)} disabled={!link.order} className="rounded-lg border border-outline-variant/25 bg-surface-lowest p-3 text-left text-xs transition hover:border-success/30 hover:bg-success/5 disabled:cursor-default disabled:hover:border-outline-variant/25 disabled:hover:bg-surface-lowest">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 font-bold text-on-surface">{link.order?.poNumber || link.orderId}</div>
                        <span className={`rounded px-2 py-1 text-[0.6rem] font-bold ${link.impact === "High" ? "bg-error/10 text-error" : link.impact === "Low" ? "bg-success/10 text-success" : "bg-accent-amber/10 text-accent-amber"}`}>{link.impact}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-on-surface-variant">
                        <span>{link.stage}</span>
                        <span>{link.port}</span>
                        {link.order?.status && <span>{link.order.status.replace(/_/g, " ")}</span>}
                        {link.order && <span>{money(link.order.total, link.order.currency)}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          </section>
        ) : null}

        <section className="rounded-xl border border-outline-variant/20 bg-surface-container">
          <div className="flex items-center justify-between border-b border-outline-variant/20 p-4">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-bold text-on-surface"><Icon name="timeline" className="text-base text-success" /> Snapshot Timeline</h3>
              <p className="mt-1 text-[0.65rem] text-on-surface-variant">Uses persisted position snapshots when available.</p>
            </div>
            <span className="rounded border border-outline-variant/30 bg-surface-lowest px-2 py-1 text-xs text-on-surface-variant">{track.length} events</span>
          </div>
          <div className="space-y-2 p-4">
            {track.slice(-6).reverse().map((point, index) => (
              <div key={`${point.timestamp}-${index}`} className="flex items-center justify-between rounded-lg border border-outline-variant/20 bg-surface-lowest p-3 text-xs">
                <div className="text-on-surface">{point.source ? "Snapshot" : index === 0 ? "Current" : "Estimated"}</div>
                <div className="text-on-surface-variant">{formatDate(point.timestamp)} | {point.speed.toFixed(1)} kn | {coord(point.lat)}, {coord(point.lng)}</div>
              </div>
            ))}
            {track.length === 0 && <div className="rounded-lg border border-dashed border-outline-variant/30 bg-surface-lowest/50 p-6 text-center text-xs text-on-surface-variant">No timeline events yet.</div>}
          </div>
        </section>
      </main>

      <aside className="space-y-6">
        <section className="rounded-xl border border-outline-variant/20 bg-surface-container">
          <div className="border-b border-outline-variant/20 p-4">
            <h3 className="flex items-center gap-2 text-sm font-bold text-on-surface"><Icon name="smart_toy" className="text-base text-success" /> Tracker Agent</h3>
            <p className="mt-1 text-[0.65rem] text-on-surface-variant">Highlights match risks, image coverage, and tracking memory.</p>
          </div>
          <div className="space-y-3 p-4">
            <div className="grid grid-cols-3 gap-2">
              {[["Results", results.length], ["Images", recent.filter((vessel) => vessel.imageUrl).length], ["Watch", watchlist.length]].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-outline-variant/30 bg-surface-lowest p-3">
                  <div className="text-[0.55rem] font-bold uppercase tracking-widest text-on-surface-variant">{label}</div>
                  <div className="mt-1 text-lg font-bold text-on-surface">{value}</div>
                </div>
              ))}
            </div>
            {insights.map((insight) => (
              <div key={insight.title} className={`rounded-lg border p-3 ${insight.tone === "success" ? "border-success/25 bg-success/10" : "border-outline-variant/30 bg-surface-lowest"}`}>
                <div className="text-sm font-bold text-on-surface">{insight.title}</div>
                <p className="mt-1 text-xs text-secondary">{insight.body}</p>
              </div>
            ))}
          </div>
        </section>

        <VesselList title="Watchlist" icon="star" empty="No vessels pinned yet. Select a vessel and click Watch." rows={watchlist.map((item) => recent.find((vessel) => vessel.mmsi === item.mmsi) || ({ id: item.vesselId || item.mmsi, mmsi: item.mmsi, imo: item.imo || undefined, name: item.name, destination: item.note || "", type: "", flag: "", lat: 0, lng: 0, speed: 0, heading: 0, course: 0, eta: "", status: "", timestamp: new Date().toISOString() } as VesselResult))} onSelect={(vessel) => void loadDetails(vessel.id || vessel.mmsi)} onRefresh={(vessel) => void handleRefresh(vessel)} onRemove={(vessel) => void handleRemoveFromWatchlist(vessel)} removeLabel="Remove from watchlist" />
        <VesselList title="Recent Tracked Vessels" icon="list_alt" empty="No vessels tracked yet." rows={recent} selectedId={selected?.id} onSelect={(vessel) => void loadDetails(vessel.id)} onRefresh={(vessel) => void handleRefresh(vessel)} onRemove={requestDeleteRecent} removeLabel="Permanently remove from recent tracking history" onClear={handleClearRecent} clearLabel="Hide recent vessels in this view" />
      </aside>

      {dialogMounted && recentDeleteTarget ? createPortal(
        <DeleteRecentVesselDialog
          vesselName={recentDeleteTarget.name}
          busy={deletingRecentMmsi === recentDeleteTarget.mmsi}
          onCancel={() => setRecentDeleteTarget(null)}
          onConfirm={() => void confirmDeleteRecent()}
        />,
        document.body,
      ) : null}
    </div>
  );
}

/* Module-level so the dialog mounts and unmounts with its own lifecycle,
   letting useDialogA11y trap focus on open and restore it on close. */
function DeleteRecentVesselDialog({
  vesselName, busy, onCancel, onConfirm,
}: {
  vesselName: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useDialogA11y<HTMLDivElement>(onCancel);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-recent-vessel-title"
        className="max-h-[calc(100dvh-2rem)] w-full max-w-[440px] overflow-y-auto rounded-xl border border-outline-variant/30 bg-surface-container shadow-2xl shadow-black/40"
      >
        <div className="flex items-start gap-3 border-b border-outline-variant/20 p-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-error/20 bg-error/10 text-error">
            <Icon name="delete" className="text-xl" />
          </div>
          <div className="min-w-0">
            <h3 id="delete-recent-vessel-title" className="text-sm font-bold text-on-surface">Delete recent vessel?</h3>
            <p className="mt-2 break-words text-xs leading-5 text-secondary">
              Permanently remove <span className="font-bold text-on-surface">{vesselName}</span> from Recent Tracked Vessels. This deletes its saved tracking history from the recent list.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2 p-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-outline-variant/40 px-4 py-2 text-xs font-bold text-on-surface hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-lg bg-error px-4 py-2 text-xs font-bold text-surface-base hover:bg-error disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Deleting..." : "Delete vessel"}
          </button>
        </div>
      </div>
    </div>
  );
}

function VesselList({
  title,
  icon,
  empty,
  rows,
  selectedId,
  onSelect,
  onRefresh,
  onRemove,
  removeLabel,
  onClear,
  clearLabel,
}: {
  title: string;
  icon: string;
  empty: string;
  rows: VesselResult[];
  selectedId?: string;
  onSelect: (vessel: VesselResult) => void;
  onRefresh: (vessel: VesselResult) => void;
  onRemove?: (vessel: VesselResult) => void;
  removeLabel?: string;
  onClear?: () => void;
  clearLabel?: string;
}) {
  return (
    <section className="rounded-xl border border-outline-variant/20 bg-surface-container">
      <div className="flex items-center justify-between gap-3 border-b border-outline-variant/20 p-4">
        <h3 className="flex items-center gap-2 text-sm font-bold text-on-surface"><Icon name={icon} className="text-base text-accent-amber" /> {title}</h3>
        {onClear && rows.length > 0 && (
          <button type="button" onClick={onClear} className="rounded-md px-2 py-1 text-[0.62rem] font-bold uppercase tracking-wide text-on-surface-variant hover:bg-white/5 hover:text-accent-amber" title={clearLabel}>
            Hide
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="m-4 rounded-lg border border-dashed border-outline-variant/30 bg-surface-lowest/50 p-6 text-center text-xs text-on-surface-variant">{empty}</div>
      ) : (
        <div className="max-h-80 divide-y divide-outline-variant/20 overflow-y-auto">
          {rows.map((vessel) => (
            <div key={`${title}-${vessel.id}-${vessel.mmsi}`} className={`p-4 ${selectedId === vessel.id ? "bg-success/10" : "hover:bg-white/[0.02]"}`}>
              <div className="flex gap-3">
                <button type="button" onClick={() => onSelect(vessel)} className="flex min-w-0 flex-1 gap-3 text-left">
                  <VesselThumb vessel={vessel} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-on-surface">{vessel.name}</span>
                    <span className="mt-1 block text-[0.65rem] text-on-surface-variant">IMO {vessel.imo || "-"} | MMSI {vessel.mmsi}</span>
                    <span className="mt-1 flex items-center gap-2 text-[0.65rem] text-on-surface-variant"><span className={`h-2 w-2 rounded-full ${statusTone(vessel.status)}`} /> {vessel.status || "Status unknown"}</span>
                  </span>
                </button>
                <button type="button" onClick={() => onRefresh(vessel)} className="h-8 rounded-md p-2 text-on-surface-variant hover:bg-white/5 hover:text-success" title="Refresh vessel">
                  <Icon name="sync" className="text-base" />
                </button>
                {onRemove && (
                  <button type="button" onClick={() => onRemove(vessel)} className="h-8 rounded-md p-2 text-on-surface-variant hover:bg-white/5 hover:text-error" title={removeLabel}>
                    <Icon name="delete" className="text-base" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
