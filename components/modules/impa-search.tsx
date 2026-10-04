"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IMPACatalogueSummary, IMPAItemDetail, IMPAProduct } from "@/types/procurement";
import { inferIMPACategory } from "@/types/procurement";

const PAGE_SIZE = 60;

type ApiResponse<T> = {
  ok: boolean;
  data: T;
  meta?: Record<string, unknown>;
  error?: { message?: string };
};

type SearchPayload = {
  results: IMPAProduct[];
  summary: {
    totalCandidates: number;
    totalReturned: number;
    topMatchQuality: IMPAProduct["matchQuality"] | null;
    exactCodeMatch: boolean;
  };
};

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined ${className}`} style={{ fontVariationSettings: "'FILL' 0" }}>
      {name}
    </span>
  );
}

function numberText(value: number | null | undefined) {
  return Number(value || 0).toLocaleString();
}

function currencyText(value: number | null | undefined, currency = "EUR") {
  if (value == null) return "No price";
  return `${currency} ${Math.round(value * 100) / 100}`;
}

function dateText(value: string | null | undefined) {
  if (!value) return "Unknown date";
  return new Date(value).toLocaleDateString();
}

function updateItem(items: IMPAProduct[], updated: IMPAProduct) {
  return items.map((item) => (item.impaCode === updated.impaCode ? updated : item));
}

export function IMPASearchModule() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [catalogueItems, setCatalogueItems] = useState<IMPAProduct[]>([]);
  const [searchResults, setSearchResults] = useState<IMPAProduct[]>([]);
  const [activeItem, setActiveItem] = useState<IMPAProduct | null>(null);
  const [detail, setDetail] = useState<IMPAItemDetail | null>(null);
  const [summary, setSummary] = useState<IMPACatalogueSummary | null>(null);
  const [recentHistory, setRecentHistory] = useState<IMPAProduct[]>([]);
  const [isLoadingPage, setIsLoadingPage] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [totalItems, setTotalItems] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [lastSearchSummary, setLastSearchSummary] = useState<SearchPayload["summary"] | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const loadSummary = useCallback(async () => {
    const res = await fetch("/api/v1/impa/catalogue?summary=true");
    const payload = (await res.json()) as ApiResponse<IMPACatalogueSummary>;
    if (!res.ok || payload.ok === false) throw new Error(payload.error?.message || "Failed to load IMPA catalogue summary.");
    if (payload.data) setSummary(payload.data);
  }, []);

  useEffect(() => { void loadSummary().catch(() => undefined); }, [loadSummary]);

  const loadCataloguePage = useCallback(async (offset = 0, reset = false) => {
    setIsLoadingPage(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (selectedCategory !== "All") params.set("category", selectedCategory);
      const res = await fetch(`/api/v1/impa/catalogue?${params.toString()}`);
      const payload = (await res.json()) as ApiResponse<IMPAProduct[]>;
      if (!res.ok || payload.ok === false) throw new Error(payload.error?.message || "Failed to load IMPA catalogue.");

      setCatalogueItems((prev) => (reset ? payload.data : [...prev, ...payload.data]));
      setTotalItems(Number(payload.meta?.total || payload.data.length));
      setHasMore(Boolean(payload.meta?.hasMore));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load IMPA catalogue.");
    } finally {
      setIsLoadingPage(false);
    }
  }, [selectedCategory]);

  useEffect(() => {
    setCatalogueItems([]);
    setActiveItem(null);
    setDetail(null);
    setSearchResults([]);
    setLastSearchSummary(null);
    void loadCataloguePage(0, true);
  }, [loadCataloguePage]);

  const importCatalogue = useCallback(async (file: File) => {
    setIsImporting(true);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("includeDeleted", "false");
      const res = await fetch("/api/v1/impa/import", { method: "POST", body: form });
      const payload = await res.json();
      if (!res.ok || payload.ok === false) throw new Error(payload.error?.message || "IMPA catalogue import failed.");
      setSelectedCategory("All");
      setSearchResults([]);
      setLastSearchSummary(null);
      await Promise.all([loadSummary(), loadCataloguePage(0, true)]);
      const imported = Number(payload.data?.importedCount || 0);
      const skipped = Number(payload.data?.skippedCount || 0);
      const errors = Number(payload.data?.errorCount || 0);
      setNotice(
        `Catalogue ready: ${imported.toLocaleString()} active IMPA records imported from ${file.name}; ${skipped.toLocaleString()} non-standard, deleted, or incomplete rows skipped${errors ? `; ${errors.toLocaleString()} errors require review` : ""}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "IMPA catalogue import failed.");
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
      setIsImporting(false);
    }
  }, [loadCataloguePage, loadSummary]);

  const selectItem = useCallback(async (item: IMPAProduct) => {
    setActiveItem(item);
    setDetail(null);
    setRecentHistory((prev) => [item, ...prev.filter((row) => row.impaCode !== item.impaCode)].slice(0, 8));
    setIsLoadingDetail(true);
    setError(null);

    try {
      const res = await fetch(`/api/v1/impa/items/${encodeURIComponent(item.id)}`);
      const payload = (await res.json()) as ApiResponse<IMPAItemDetail>;
      if (!res.ok || payload.ok === false) throw new Error(payload.error?.message || "Failed to load item context.");
      setDetail(payload.data);
      setActiveItem(payload.data.item);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load item context.");
    } finally {
      setIsLoadingDetail(false);
    }
  }, []);

  const handleSearch = useCallback(async (event?: React.FormEvent) => {
    if (event) event.preventDefault();
    const q = searchQuery.trim();
    if (q.length < 2) return;

    setIsSearching(true);
    setError(null);
    setNotice(null);
    setActiveItem(null);
    setDetail(null);

    try {
      const res = await fetch(`/api/v1/impa/search?q=${encodeURIComponent(q)}&limit=30`);
      const payload = (await res.json()) as ApiResponse<SearchPayload>;
      if (!res.ok || payload.ok === false) throw new Error(payload.error?.message || "Search failed.");

      setSearchResults(payload.data.results);
      setLastSearchSummary(payload.data.summary);
      if (payload.data.results[0]) {
        await selectItem(payload.data.results[0]);
      }
      if (payload.data.results.length === 0) {
        setNotice(`No IMPA catalogue matches for "${q}".`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, selectItem]);

  const handleToggleFavorite = useCallback(async (item: IMPAProduct) => {
    const updated = { ...item, isFavorite: !item.isFavorite };
    setCatalogueItems((prev) => updateItem(prev, updated));
    setSearchResults((prev) => updateItem(prev, updated));
    setRecentHistory((prev) => updateItem(prev, updated));
    setActiveItem((prev) => (prev?.impaCode === item.impaCode ? updated : prev));
    setDetail((prev) => (prev?.item.impaCode === item.impaCode ? { ...prev, item: updated } : prev));

    try {
      await fetch("/api/v1/impa/favourite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ impaCode: item.impaCode, isFavorite: updated.isFavorite }),
      });
    } catch {
      setNotice("Favourite update could not be persisted.");
    }
  }, []);

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setSearchResults([]);
    setLastSearchSummary(null);
    setNotice(null);
    setActiveItem(null);
    setDetail(null);
  }, []);

  const copyReference = useCallback(async (item: IMPAProduct) => {
    const text = [item.impaCode, item.itemName, item.unit ? `Unit: ${item.unit}` : null, item.category].filter(Boolean).join(" | ");
    await navigator.clipboard?.writeText(text).catch(() => undefined);
    setNotice(`Copied ${item.impaCode} reference.`);
  }, []);

  const openModule = useCallback((moduleKey: string, item: IMPAProduct, label: string) => {
    const detail = {
      id: item.impaCode,
      moduleKey,
      title: item.impaCode,
      label,
      subtitle: item.itemName,
      icon: moduleKey === "procurementSearch" ? "manage_search" : moduleKey === "inventory" ? "inventory_2" : moduleKey === "contracts" ? "handshake" : moduleKey === "suppliers" ? "storefront" : "bolt",
    };
    window.history.replaceState(null, "", `#${moduleKey}:${encodeURIComponent(item.impaCode)}`);
    window.dispatchEvent(new CustomEvent("nautex:record-context", { detail }));
  }, []);

  const categories = useMemo(() => summary?.sections ?? [], [summary]);
  const favorites = useMemo(() => {
    const byCode = new Map<string, IMPAProduct>();
    for (const item of [...catalogueItems, ...searchResults, ...recentHistory]) {
      if (item.isFavorite) byCode.set(item.impaCode, item);
    }
    return [...byCode.values()].slice(0, 8);
  }, [catalogueItems, recentHistory, searchResults]);
  const visibleItems = searchResults.length > 0 ? searchResults : catalogueItems;
  const activeDisplay = detail?.item ?? activeItem;

  return (
    <div className="space-y-4 max-w-none">
      <div className="rounded-xl border border-outline-variant/20 bg-surface-container px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-success/10">
            <Icon name="menu_book" className="text-lg text-success" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-on-surface">IMPA Catalogue</p>
            <p className="mt-0.5 text-[0.65rem] text-on-surface-variant">
              Local Postgres reference layer for IMPA code lookup, section browsing, and procurement context.
            </p>
            {summary?.latestImport && (
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[0.58rem] text-outline">
                <span className="font-medium text-success">Licensed catalogue loaded</span>
                <span>{summary.latestImport.fileName || "IMPA dataset"}</span>
                <span>{numberText(summary.latestImport.importedCount)} records</span>
                <span>Updated {dateText(summary.latestImport.createdAt)}</span>
                {summary.latestImport.errorCount > 0 && <span className="text-warning">{numberText(summary.latestImport.errorCount)} import errors</span>}
              </p>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 text-right">
            <MiniMetric label="Active items" value={summary?.total ?? totalItems} />
            <MiniMetric label="Sections" value={categories.length} />
            <MiniMetric label="Favourites" value={summary?.favorites ?? favorites.length} />
          </div>
          <input
            ref={importInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void importCatalogue(file);
            }}
          />
          <button
            type="button"
            disabled={isImporting}
            onClick={() => importInputRef.current?.click()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-success/25 bg-success/10 px-3 text-xs font-semibold text-success hover:bg-success/15 disabled:opacity-50"
          >
            <Icon name={isImporting ? "sync" : "upload_file"} className={`text-base ${isImporting ? "animate-spin" : ""}`} />
            {isImporting ? "Importing" : "Import catalogue"}
          </button>
        </div>
      </div>

      {notice && (
        <div className="rounded-lg border border-success/20 bg-success/10 px-4 py-2 text-xs text-success">{notice}</div>
      )}
      {isImporting && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/8 px-4 py-2 text-xs text-primary">
          <Icon name="sync" className="animate-spin text-base" />
          Validating and importing the local catalogue. Keep Nautex open; a full master file can take about one minute.
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-error/30 bg-error-container/20 px-4 py-2 text-xs text-error">{error}</div>
      )}

      <div className="flex gap-4 h-[calc(100vh-220px)] min-h-[620px]">
        <aside className="w-72 shrink-0 overflow-hidden rounded-xl border border-outline-variant/20 bg-surface-lowest">
          <div className="border-b border-outline-variant/20 p-4">
            <p className="text-[0.6rem] font-bold uppercase tracking-wider text-on-surface-variant">Browse Sections</p>
            <button
              type="button"
              onClick={() => setSelectedCategory("All")}
              className={`mt-3 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs ${selectedCategory === "All" ? "bg-success/10 text-success" : "text-secondary hover:bg-surface-container"}`}
            >
              <span>All IMPA sections</span>
              <span>{numberText(summary?.total)}</span>
            </button>
          </div>

          <div className="h-[calc(100%-78px)] overflow-y-auto p-2">
            {favorites.length > 0 && (
              <div className="mb-3">
                <div className="mb-1 flex items-center gap-1 px-2 text-[0.6rem] font-bold uppercase tracking-wider text-warning">
                  <Icon name="star" className="text-xs" /> Favourites
                </div>
                <div className="space-y-1">
                  {favorites.map((item) => (
                    <button key={item.impaCode} type="button" onClick={() => void selectItem(item)} className="w-full rounded-lg px-3 py-2 text-left text-xs text-secondary hover:bg-surface-container">
                      <span className="font-mono text-success">{item.impaCode}</span>
                      <span className="ml-2 line-clamp-1">{item.itemName}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1">
              {categories.map((cat) => (
                <button
                  key={cat.name}
                  type="button"
                  onClick={() => setSelectedCategory(cat.name)}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs transition-colors ${selectedCategory === cat.name ? "bg-success/10 text-success" : "text-on-surface-variant hover:bg-surface-container hover:text-secondary"}`}
                >
                  <span className="min-w-0">
                    <span className="mr-2 font-mono text-[0.65rem]">{cat.section || cat.name.slice(0, 2)}</span>
                    <span className="line-clamp-1">{cat.name.replace(/^\d+\s-\s/, "")}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-surface-container px-1.5 py-0.5 text-[0.6rem]">{cat.count}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <form onSubmit={handleSearch} className="mb-3 shrink-0">
            <div className="relative">
              <Icon name="search" className="absolute left-4 top-1/2 -translate-y-1/2 text-lg text-outline/40" />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search IMPA code, description, unit, or category..."
                className="w-full rounded-xl border border-outline-variant/8 bg-surface-high/30 p-4 pl-12 pr-40 text-sm text-on-surface placeholder:text-outline/35 outline-none transition-all focus:border-primary/15 focus:bg-surface-high/50 focus:ring-1 focus:ring-primary/20"
              />
              <div className="absolute right-3 top-1/2 flex -translate-y-1/2 gap-2">
                {searchResults.length > 0 && (
                  <button type="button" onClick={clearSearch} className="rounded-lg bg-surface-high px-3 py-2 text-xs font-semibold text-secondary hover:bg-surface-highest">
                    Reset
                  </button>
                )}
                <button type="submit" disabled={searchQuery.trim().length < 2 || isSearching} className="rounded-lg bg-success px-4 py-2 text-xs font-semibold text-on-primary hover:opacity-90 disabled:opacity-50">
                  {isSearching ? "Searching..." : "Search"}
                </button>
              </div>
            </div>
          </form>

          <div className="grid min-h-0 flex-1 grid-cols-12 gap-4 overflow-hidden">
            <section className={activeDisplay ? "col-span-12 overflow-hidden xl:col-span-7" : "col-span-12 overflow-hidden"}>
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-on-surface">
                    {searchResults.length > 0 ? "Ranked IMPA Matches" : selectedCategory === "All" ? "Catalogue Items" : selectedCategory}
                  </h3>
                  <p className="mt-0.5 text-[0.65rem] text-on-surface-variant">
                    {searchResults.length > 0 && lastSearchSummary
                      ? `${lastSearchSummary.totalReturned} shown from ${lastSearchSummary.totalCandidates} candidates`
                      : `${numberText(visibleItems.length)} shown from ${numberText(totalItems || summary?.total)} records`}
                  </p>
                </div>
                {selectedCategory !== "All" && searchResults.length === 0 && (
                  <button type="button" onClick={() => setSelectedCategory("All")} className="rounded-lg bg-surface-high px-3 py-2 text-xs font-semibold text-secondary hover:bg-surface-highest">
                    Reset section
                  </button>
                )}
              </div>

              <div className="h-[calc(100%-48px)] overflow-y-auto pr-1">
                {isLoadingPage && visibleItems.length === 0 ? (
                  <LoadingState label="Loading catalogue records..." />
                ) : visibleItems.length === 0 ? (
                  <EmptyState onImport={() => importInputRef.current?.click()} importing={isImporting} />
                ) : (
                  <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
                    {visibleItems.map((item) => (
                      <IMPACard
                        key={`${item.id}-${item.matchScore ?? "browse"}`}
                        item={item}
                        active={activeDisplay?.impaCode === item.impaCode}
                        onSelect={() => void selectItem(item)}
                        onToggleFavorite={handleToggleFavorite}
                      />
                    ))}
                  </div>
                )}

                {searchResults.length === 0 && hasMore && (
                  <div className="py-4 text-center">
                    <button
                      type="button"
                      onClick={() => void loadCataloguePage(catalogueItems.length, false)}
                      disabled={isLoadingPage}
                      className="rounded-lg border border-outline-variant/30 bg-surface-container px-4 py-2 text-xs font-semibold text-secondary hover:border-success/40 disabled:opacity-50"
                    >
                      {isLoadingPage ? "Loading..." : "Load more"}
                    </button>
                  </div>
                )}
              </div>
            </section>

            {activeDisplay && (
              <aside className="col-span-12 min-h-0 overflow-hidden xl:col-span-5">
                <IMPAItemPanel
                  item={activeDisplay}
                  detail={detail}
                  loading={isLoadingDetail}
                  onClose={() => { setActiveItem(null); setDetail(null); }}
                  onCopy={() => void copyReference(activeDisplay)}
                  onToggleFavorite={() => void handleToggleFavorite(activeDisplay)}
                  onOpenModule={openModule}
                />
              </aside>
            )}
          </div>
        </main>
      </div>

      {recentHistory.length > 0 && (
        <section className="rounded-xl border border-outline-variant/20 bg-surface-container p-4">
          <div className="mb-3 flex items-center gap-2">
            <Icon name="history" className="text-base text-success" />
            <h3 className="text-sm font-bold text-on-surface">Recently viewed</h3>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {recentHistory.map((item) => (
              <button key={item.impaCode} type="button" onClick={() => void selectItem(item)} className="rounded-lg bg-surface-lowest px-3 py-2 text-left hover:bg-surface-container">
                <p className="font-mono text-xs text-success">{item.impaCode}</p>
                <p className="mt-1 line-clamp-1 text-[0.65rem] text-secondary">{item.itemName}</p>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div className="rounded-lg bg-surface-lowest px-3 py-2">
      <p className="text-[0.55rem] font-bold uppercase tracking-wider text-on-surface-variant">{label}</p>
      <p className="mt-0.5 font-mono text-sm font-bold text-on-surface">{numberText(value)}</p>
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <Icon name="sync" className="mb-3 animate-spin text-3xl text-success" />
      <p className="text-sm text-on-surface-variant">{label}</p>
    </div>
  );
}

function EmptyState({ onImport, importing }: { onImport: () => void; importing: boolean }) {
  return (
    <div className="rounded-xl border border-outline-variant/20 bg-surface-container p-8 text-center">
      <Icon name="search_off" className="mb-3 text-3xl text-on-surface-variant" />
      <p className="text-sm font-semibold text-on-surface">No catalogue imported</p>
      <a className="mt-2 text-xs text-primary underline" href="/templates/catalogue.csv" download>Download empty CSV template</a>
      <p className="mt-1 text-xs text-on-surface-variant">IMPA content is not included. Import only catalogue data you are authorised to use; nothing is downloaded automatically.</p>
      <button type="button" onClick={onImport} disabled={importing} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-success px-4 py-2 text-xs font-semibold text-on-primary disabled:opacity-50">
        <Icon name="upload_file" className="text-base" /> {importing ? "Importing..." : "Choose catalogue file"}
      </button>
    </div>
  );
}

function IMPACard({
  item,
  active,
  onSelect,
  onToggleFavorite,
}: {
  item: IMPAProduct;
  active: boolean;
  onSelect: () => void;
  onToggleFavorite: (item: IMPAProduct) => void;
}) {
  return (
    <div
      className={`rounded-xl border bg-surface-container p-4 text-left transition-all ${active ? "border-success/40" : "border-outline-variant/20 hover:border-success/25 hover:bg-surface-high"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
          <span className="inline-flex items-center gap-1 rounded bg-surface-lowest px-2 py-0.5 font-mono text-xs font-bold text-success">
            <Icon name="tag" className="text-xs" /> {item.impaCode}
          </span>
          <h4 className="mt-2 line-clamp-2 text-sm font-bold leading-snug text-on-surface">{item.itemName}</h4>
        </button>
        <button
          type="button"
          onClick={() => onToggleFavorite(item)}
          className={`shrink-0 rounded-full p-1.5 ${item.isFavorite ? "bg-warning/10 text-warning" : "text-on-surface-variant hover:bg-surface-high"}`}
        >
          <Icon name="star" className="text-lg" />
        </button>
      </div>

      <button type="button" onClick={onSelect} className="mt-3 block w-full text-left">
        <div className="grid grid-cols-3 gap-2">
          <InfoChip label="Unit" value={item.unit || "N/A"} />
          <InfoChip label="HS" value={item.hsCode || "N/A"} />
          <InfoChip label="COO" value={item.countryOrigin || "N/A"} />
        </div>

        <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-on-surface-variant">{item.specifications}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-surface-lowest px-2 py-1 text-[0.6rem] font-bold uppercase text-on-surface-variant">
            {item.category || inferIMPACategory(item.impaCode)}
          </span>
          {item.matchReasons?.map((reason) => (
            <span key={reason} className="rounded-full bg-success/10 px-2 py-1 text-[0.6rem] font-bold text-success">{reason}</span>
          ))}
        </div>
      </button>
    </div>
  );
}

function InfoChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-lowest px-2 py-1">
      <p className="text-[0.52rem] font-bold uppercase tracking-wider text-on-surface-variant">{label}</p>
      <p className="mt-0.5 truncate text-[0.65rem] font-semibold text-secondary">{value}</p>
    </div>
  );
}

function IMPAItemPanel({
  item,
  detail,
  loading,
  onClose,
  onCopy,
  onToggleFavorite,
  onOpenModule,
}: {
  item: IMPAProduct;
  detail: IMPAItemDetail | null;
  loading: boolean;
  onClose: () => void;
  onCopy: () => void;
  onToggleFavorite: () => void;
  onOpenModule: (moduleKey: string, item: IMPAProduct, label: string) => void;
}) {
  const context = detail?.context;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-outline-variant/20 bg-surface-container">
      <div className="shrink-0 border-b border-outline-variant/20 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="inline-flex rounded bg-surface-lowest px-2 py-0.5 font-mono text-xs font-bold text-success">{item.impaCode}</span>
            <h3 className="mt-2 text-lg font-bold leading-tight text-on-surface">{item.itemName}</h3>
            <p className="mt-1 text-xs text-on-surface-variant">{item.category || inferIMPACategory(item.impaCode)}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-on-surface-variant hover:bg-surface-high hover:text-on-surface">
            <Icon name="close" className="text-lg" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <InfoChip label="Unit" value={item.unit || "N/A"} />
          <InfoChip label="HS code" value={item.hsCode || "N/A"} />
          <InfoChip label="Origin" value={item.countryOrigin || "N/A"} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <ActionButton icon="content_copy" label="Copy ref" onClick={onCopy} />
          <ActionButton icon="star" label={item.isFavorite ? "Unwatch" : "Watch"} onClick={onToggleFavorite} />
          <ActionButton icon="manage_search" label="Item Search" onClick={() => onOpenModule("procurementSearch", item, "Search procurement intelligence")} />
          <ActionButton icon="bolt" label="Use in RFQ" onClick={() => onOpenModule("rfqAutomation", item, "Use as RFQ reference")} />
          <ActionButton icon="inventory_2" label="Inventory" onClick={() => onOpenModule("inventory", item, "Check inventory")} />
          <ActionButton icon="handshake" label="Agreements" onClick={() => onOpenModule("contracts", item, "Check agreements")} />
          <ActionButton icon="storefront" label="Suppliers" onClick={() => onOpenModule("suppliers", item, "Search suppliers")} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {loading ? (
          <LoadingState label="Loading procurement context..." />
        ) : (
          <div className="space-y-4">
            <ContextBlock title="Catalogue Context" icon="info">
              <p className="text-xs leading-relaxed text-secondary">{item.specifications}</p>
              {item.normalizedDescription && (
                <p className="mt-2 rounded-lg bg-surface-lowest p-2 text-[0.65rem] leading-relaxed text-on-surface-variant">{item.normalizedDescription}</p>
              )}
            </ContextBlock>

            <ContextBlock title="Inventory" icon="inventory_2" count={context?.inventory.length}>
              {context?.inventory.length ? context.inventory.map((row) => (
                <ContextRow key={row.id} title={`${row.available} ${row.uom} available`} meta={`${row.warehouse}${row.locationBin ? ` / ${row.locationBin}` : ""}`} detail={row.description} tone={row.stockStatus === "critical" ? "danger" : row.stockStatus === "reorder" ? "warn" : "ok"} />
              )) : <EmptyContext label="No linked inventory found." />}
            </ContextBlock>

            <ContextBlock title="Agreements" icon="handshake" count={context?.agreements.length}>
              {context?.agreements.length ? context.agreements.map((row) => (
                <ContextRow key={row.id} title={`${row.supplierName} - ${currencyText(row.unitPrice, row.currency)}`} meta={`${row.status}${row.leadTimeDays ? ` / ${row.leadTimeDays} days` : ""}`} detail={row.description} tone={row.status === "Active" ? "ok" : "neutral"} />
              )) : <EmptyContext label="No agreement item evidence found." />}
            </ContextBlock>

            <ContextBlock title="Purchase History" icon="receipt_long" count={context?.purchaseHistory.length}>
              {context?.purchaseHistory.length ? context.purchaseHistory.map((row) => (
                <ContextRow key={row.id} title={`${row.poNumber} - ${row.supplierName}`} meta={`${dateText(row.lastPurchaseDate)} / ${currencyText(row.unitPrice, row.currency)}`} detail={`${row.quantity} ${row.unit} for ${row.vessel}${row.port ? ` / ${row.port}` : ""}`} tone="neutral" />
              )) : <EmptyContext label="No purchase order history found." />}
            </ContextBlock>

            <ContextBlock title="RFQ History" icon="bolt" count={context?.rfqHistory.length}>
              {context?.rfqHistory.length ? context.rfqHistory.map((row) => (
                <ContextRow key={row.id} title={`${row.vessel} / ${row.status}`} meta={`${row.quotedSupplier || "No quote"} / ${currencyText(row.quotedPrice, row.currency || "EUR")}`} detail={`${row.quantity} ${row.unit} - ${row.description}`} tone="neutral" />
              )) : <EmptyContext label="No RFQ line history found." />}
            </ContextBlock>

            <ContextBlock title="Supplier Signals" icon="storefront" count={context?.supplierNames.length}>
              {context?.supplierNames.length ? (
                <div className="flex flex-wrap gap-2">
                  {context.supplierNames.map((name) => <span key={name} className="rounded-full bg-surface-lowest px-2 py-1 text-[0.65rem] font-semibold text-secondary">{name}</span>)}
                </div>
              ) : <EmptyContext label="No supplier evidence found." />}
            </ContextBlock>
          </div>
        )}
      </div>
    </div>
  );
}

function ActionButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center justify-center gap-1.5 rounded-lg bg-surface-lowest px-2 py-2 text-[0.65rem] font-bold text-secondary hover:bg-surface-low hover:text-success">
      <Icon name={icon} className="text-sm" /> {label}
    </button>
  );
}

function ContextBlock({ title, icon, count, children }: { title: string; icon: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-outline-variant/20 bg-surface-lowest p-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name={icon} className="text-base text-success" />
          <h4 className="text-xs font-bold text-on-surface">{title}</h4>
        </div>
        {count !== undefined && <span className="rounded-full bg-surface-container px-2 py-0.5 text-[0.6rem] font-bold text-on-surface-variant">{count}</span>}
      </div>
      {children}
    </section>
  );
}

function ContextRow({ title, meta, detail, tone }: { title: string; meta: string; detail: string; tone: "ok" | "warn" | "danger" | "neutral" }) {
  const toneClass = {
    ok: "text-success",
    warn: "text-accent-amber",
    danger: "text-error",
    neutral: "text-secondary",
  }[tone];
  return (
    <div className="mb-2 last:mb-0 rounded-lg bg-surface-container p-3">
      <div className="flex items-start justify-between gap-3">
        <p className={`text-xs font-bold ${toneClass}`}>{title}</p>
        <p className="shrink-0 text-[0.6rem] text-on-surface-variant">{meta}</p>
      </div>
      <p className="mt-1 line-clamp-2 text-[0.65rem] leading-relaxed text-on-surface-variant">{detail}</p>
    </div>
  );
}

function EmptyContext({ label }: { label: string }) {
  return <p className="rounded-lg bg-surface-container p-3 text-xs text-on-surface-variant">{label}</p>;
}
