"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ItemSearchHistoryRow,
  ItemSearchPriorPurchase,
  ItemSearchResult,
  ItemSearchSort,
  ItemSearchSource,
  ItemSearchSummary,
} from "@/types/procurement";
import { AINotConfiguredBanner } from "@/components/ai-status-badge";
import { JevReviewPanel } from "@/components/jev-review-panel";

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined ${className}`} style={{ fontVariationSettings: "'FILL' 0" }}>
      {name}
    </span>
  );
}

type Tab = "search" | "history";
type SourceFilter = ItemSearchSource | "all";

type SearchMeta = ItemSearchSummary & {
  source: string;
  scope: string[];
};

type SearchHistoryPayload = {
  history: ItemSearchHistoryRow[];
  recentPurchases: ItemSearchPriorPurchase[];
};

const SOURCE_OPTIONS: Array<{ value: SourceFilter; label: string }> = [
  { value: "all", label: "All Sources" },
  { value: "purchase_history", label: "PO History" },
  { value: "agreement", label: "Agreements" },
  { value: "customer_contract", label: "Customer Contracts" },
  { value: "inventory", label: "Inventory" },
  { value: "rfq_history", label: "RFQ History" },
  { value: "supplier_quote", label: "Supplier Quotes" },
  { value: "catalog", label: "Catalogue" },
  { value: "purchase_order", label: "PO Headers" },
];

const SORT_OPTIONS: Array<{ value: ItemSearchSort; label: string }> = [
  { value: "relevance", label: "Relevance" },
  { value: "last_purchase", label: "Last Purchase" },
  { value: "price_asc", label: "Price Low" },
  { value: "price_desc", label: "Price High" },
];

const sourceIcon: Record<ItemSearchSource, string> = {
  catalog: "menu_book",
  inventory: "inventory_2",
  agreement: "handshake",
  customer_contract: "contract",
  purchase_history: "receipt_long",
  rfq_history: "bolt",
  supplier_quote: "request_quote",
  purchase_order: "assignment",
};

const qualityClass: Record<ItemSearchResult["matchQuality"], string> = {
  high: "bg-success/15 text-success border-success/25",
  medium: "bg-warning/15 text-warning border-warning/25",
  low: "bg-error/15 text-error border-error/25",
};

export function ProcurementSearchModule() {
  const [activeTab, setActiveTab] = useState<Tab>("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");
  const [sort, setSort] = useState<ItemSearchSort>("relevance");
  const [supplier, setSupplier] = useState("");
  const [category, setCategory] = useState("");
  const [vessel, setVessel] = useState("");
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<ItemSearchResult[]>([]);
  const [meta, setMeta] = useState<SearchMeta | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<ItemSearchResult | null>(null);
  const [history, setHistory] = useState<ItemSearchHistoryRow[]>([]);
  const [recentPurchases, setRecentPurchases] = useState<ItemSearchPriorPurchase[]>([]);

  const pageSize = 25;
  const canSearch = searchQuery.trim().length >= 2;
  const totalPages = meta ? Math.max(1, Math.ceil(meta.totalCandidates / meta.pageSize)) : 1;

  const loadHistory = useCallback(async () => {
    const res = await fetch("/api/v1/catalog/history?limit=10");
    const payload = await res.json();
    if (payload.data) {
      const data = payload.data as SearchHistoryPayload;
      setHistory(data.history ?? []);
      setRecentPurchases(data.recentPurchases ?? []);
    }
  }, []);

  useEffect(() => {
    loadHistory().catch(() => undefined);
  }, [loadHistory]);

  const performSearch = useCallback(async (nextPage = 1, e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!canSearch) {
      setError("Enter at least 2 characters to search Item Search records.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setSelectedItem(null);
    setPage(nextPage);

    const params = new URLSearchParams({
      q: searchQuery.trim(),
      source,
      sort,
      page: String(nextPage),
      pageSize: String(pageSize),
    });
    if (supplier.trim()) params.set("supplier", supplier.trim());
    if (category.trim()) params.set("category", category.trim());
    if (vessel.trim()) params.set("vessel", vessel.trim());

    try {
      const res = await fetch(`/api/v1/catalog/search?${params.toString()}`);
      const payload = await res.json();
      if (!res.ok || payload.ok === false) throw new Error(payload.error?.message ?? "Search failed.");
      const nextResults = (payload.data ?? []) as ItemSearchResult[];
      setResults(nextResults);
      setMeta(payload.meta ?? null);
      setSelectedItem(nextResults[0] ?? null);
      await loadHistory();
    } catch (err) {
      setResults([]);
      setMeta(null);
      setError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setIsLoading(false);
    }
  }, [canSearch, category, loadHistory, searchQuery, sort, source, supplier, vessel]);

  const resetFilters = useCallback(() => {
    setSource("all");
    setSort("relevance");
    setSupplier("");
    setCategory("");
    setVessel("");
    setPage(1);
  }, []);

  const answerCards = useMemo(() => buildAnswerCards(meta), [meta]);

  return (
    <div className="space-y-5">
      <AINotConfiguredBanner moduleName="Item Search" />

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/30 pb-1">
        <div className="flex gap-5">
          {(["search", "history"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 px-1 text-sm font-semibold transition-all ${
                activeTab === tab ? "text-success border-b-2 border-success" : "text-on-surface-variant hover:text-secondary"
              }`}
            >
              {tab === "search" ? "Operational Search" : "Search Memory"}
            </button>
          ))}
        </div>
        <div className="text-[0.65rem] uppercase tracking-wider text-on-surface-variant">
          Prisma-backed procurement records
        </div>
      </div>

      {activeTab === "search" ? (
        <div className="space-y-4">
          <form onSubmit={(event) => performSearch(1, event)} className="space-y-3">
            <div className="relative">
              <Icon name="manage_search" className="absolute left-4 top-1/2 -translate-y-1/2 text-outline/45 text-xl" />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search description, maker, maker number, IMPA-like code, customer ref, supplier ref, PO/RFQ context..."
                className="w-full h-14 pl-12 pr-32 bg-surface-high/30 border border-outline-variant/10 rounded-xl text-sm text-on-surface placeholder:text-outline/35 focus:outline-none focus:ring-1 focus:ring-primary/25 focus:border-primary/20"
                autoFocus
              />
              <button
                type="submit"
                disabled={isLoading || !canSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 h-9 px-5 rounded-lg bg-success text-on-primary text-xs font-bold hover:opacity-90 disabled:opacity-45"
              >
                {isLoading ? "Searching" : "Search"}
              </button>
            </div>

            <div className="grid grid-cols-12 gap-3">
              <SelectControl className="col-span-12 md:col-span-3" label="Source" value={source} onChange={(value) => setSource(value as SourceFilter)} options={SOURCE_OPTIONS} />
              <SelectControl className="col-span-12 md:col-span-2" label="Sort" value={sort} onChange={(value) => setSort(value as ItemSearchSort)} options={SORT_OPTIONS} />
              <InputControl className="col-span-12 md:col-span-2" label="Supplier" value={supplier} onChange={setSupplier} placeholder="Any" />
              <InputControl className="col-span-12 md:col-span-2" label="Category" value={category} onChange={setCategory} placeholder="Any" />
              <InputControl className="col-span-12 md:col-span-2" label="Vessel / customer" value={vessel} onChange={setVessel} placeholder="Any" />
              <div className="col-span-12 md:col-span-1 flex items-end">
                <button type="button" onClick={resetFilters} className="h-10 w-full rounded-lg border border-outline-variant/10 text-secondary hover:bg-surface-high/30" title="Reset filters">
                  <Icon name="filter_alt_off" className="text-lg" />
                </button>
              </div>
            </div>
          </form>

          {meta && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {answerCards.map((card) => (
                <div key={card.label} className="rounded-lg bg-surface-container border border-outline-variant/20 px-4 py-3">
                  <p className="text-[0.62rem] uppercase tracking-wider text-on-surface-variant">{card.label}</p>
                  <p className={`mt-1 text-sm font-semibold ${card.tone}`}>{card.value}</p>
                </div>
              ))}
            </div>
          )}

          {meta && <SourceCounts meta={meta} />}

          {isLoading && (
            <div className="bg-surface-container rounded-xl p-12 text-center">
              <Icon name="sync" className="animate-spin text-success text-3xl mb-3" />
              <p className="text-sm text-secondary">Searching catalogue, agreements, inventory, PO history, RFQs, and supplier quotes...</p>
            </div>
          )}

          {error && (
            <div className="bg-error-container/20 border border-error/30 rounded-xl p-4 flex items-center gap-3">
              <Icon name="error" className="text-error" />
              <span className="text-sm text-error">{error}</span>
            </div>
          )}

          {!isLoading && !error && results.length > 0 && (
            <div className="grid grid-cols-12 gap-4">
              <div className={selectedItem ? "col-span-12 xl:col-span-7" : "col-span-12"}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-on-surface-variant">
                    {meta?.totalCandidates ?? results.length} candidates across operational sources
                  </p>
                  <Pagination page={page} totalPages={totalPages} disabled={isLoading} onPage={(nextPage) => performSearch(nextPage)} />
                </div>
                <div className="space-y-2">
                  {results.map((item) => (
                    <SearchResultRow key={item.id} item={item} active={selectedItem?.id === item.id} onSelect={() => setSelectedItem(item)} />
                  ))}
                </div>
                <div className="mt-3 flex justify-end">
                  <Pagination page={page} totalPages={totalPages} disabled={isLoading} onPage={(nextPage) => performSearch(nextPage)} />
                </div>
              </div>

              {selectedItem && (
                <div className="col-span-12 xl:col-span-5">
                  <ItemDetailPanel item={selectedItem} onClose={() => setSelectedItem(null)} />
                </div>
              )}
            </div>
          )}

          {!isLoading && !error && results.length === 0 && (
            <div className="bg-surface-container border border-dashed border-outline-variant/30 rounded-xl p-12 text-center">
              <Icon name="manage_search" className="text-on-surface-variant text-4xl mb-3" />
              <p className="text-sm text-secondary">Search Nautex item intelligence across catalogue, agreements, inventory, PO history, RFQs, and supplier quotes.</p>
              <p className="mt-2 text-xs text-on-surface-variant">Try an item description, maker number, IMPA-like code, supplier reference, customer reference, vessel, or PO number.</p>
            </div>
          )}
        </div>
      ) : (
        <ProcurementHistoryPanel
          history={history}
          recentPurchases={recentPurchases}
          onSelectQuery={(query) => {
            setSearchQuery(query);
            setActiveTab("search");
          }}
        />
      )}
    </div>
  );
}

function buildAnswerCards(meta: SearchMeta | null) {
  const lastPrice = meta?.bestLastPrice;
  return [
    {
      label: "Ordered Before",
      value: meta?.hasPurchaseHistory ? "Yes" : "No evidence",
      tone: meta?.hasPurchaseHistory ? "text-success" : "text-on-surface-variant",
    },
    {
      label: "Agreement",
      value: meta?.hasAgreementCoverage ? "Covered" : "No match",
      tone: meta?.hasAgreementCoverage ? "text-success" : "text-on-surface-variant",
    },
    {
      label: "Inventory",
      value: meta?.hasInventoryCoverage ? "Available" : "No stock match",
      tone: meta?.hasInventoryCoverage ? "text-success" : "text-on-surface-variant",
    },
    {
      label: "Last Price",
      value: lastPrice ? `${lastPrice.currency} ${lastPrice.unitPrice.toFixed(2)}` : "No PO price",
      tone: lastPrice ? "text-on-surface" : "text-on-surface-variant",
    },
  ];
}

function SelectControl({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label className={`space-y-1 ${className || ""}`}>
      <span className="text-[0.62rem] font-bold uppercase tracking-wider text-on-surface-variant">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full h-10 bg-surface-container border border-outline-variant/10 rounded-lg px-3 text-xs text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/20"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function InputControl({
  label,
  value,
  onChange,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <label className={`space-y-1 ${className || ""}`}>
      <span className="text-[0.62rem] font-bold uppercase tracking-wider text-on-surface-variant">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full h-10 bg-surface-container border border-outline-variant/10 rounded-lg px-3 text-xs text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:ring-1 focus:ring-primary/20"
      />
    </label>
  );
}

function SourceCounts({ meta }: { meta: SearchMeta }) {
  const entries = SOURCE_OPTIONS
    .filter((option) => option.value !== "all")
    .map((option) => ({ ...option, count: meta.sourceCounts[option.value as ItemSearchSource] ?? 0 }))
    .filter((option) => option.count > 0);

  if (entries.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {entries.map((entry) => (
        <span key={entry.value} className="inline-flex items-center gap-1 rounded-full border border-outline-variant/20 bg-surface-container px-3 py-1 text-[0.65rem] text-secondary">
          <Icon name={sourceIcon[entry.value as ItemSearchSource]} className="text-sm text-success" />
          {entry.label}: {entry.count}
        </span>
      ))}
    </div>
  );
}

function SearchResultRow({ item, active, onSelect }: { item: ItemSearchResult; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded-xl border p-4 transition-colors ${
        active ? "bg-surface-high border-success/25" : "bg-surface-container border-outline-variant/12 hover:bg-surface-high"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-lowest border border-outline-variant/20 px-2 py-1 text-[0.62rem] uppercase tracking-wider text-secondary">
              <Icon name={sourceIcon[item.source]} className="text-sm text-success" />
              {item.sourceLabel}
            </span>
            <span className={`rounded-full border px-2 py-1 text-[0.62rem] uppercase tracking-wider ${qualityClass[item.matchQuality]}`}>
              {item.matchQuality} {item.matchScore}
            </span>
            <span className="font-mono text-xs font-semibold text-success">{item.itemNumber}</span>
          </div>
          <h3 className="mt-2 text-sm font-semibold text-on-surface truncate">{item.description}</h3>
          <p className="mt-1 text-xs text-on-surface-variant truncate">
            {[item.supplierName, item.manufacturer, item.vessel, item.port].filter(Boolean).join(" | ") || "No supplier or vessel context"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-on-surface">{formatMoney(item.unitPrice, item.currency)}</p>
          <p className="text-[0.65rem] text-on-surface-variant">{item.poNumber || item.rfqId || item.agreementStatus || item.warehouse || "--"}</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-[0.68rem]">
        <MiniFact label="Stock" value={item.stockAvailable != null ? `${item.stockAvailable} ${item.unit || ""}` : "--"} />
        <MiniFact label="Agreement" value={item.agreementStatus || "--"} />
        <MiniFact label="PO" value={item.poNumber || "--"} />
        <MiniFact label="RFQ" value={item.rfqId || "--"} />
      </div>
    </button>
  );
}

function ItemDetailPanel({ item, onClose }: { item: ItemSearchResult; onClose: () => void }) {
  return (
    <div className="bg-surface-container rounded-xl border border-outline-variant/12 p-5 sticky top-4">
      <div className="flex justify-between items-start gap-3 mb-4">
        <div>
          <p className="text-[0.62rem] uppercase tracking-wider text-on-surface-variant">{item.sourceLabel}</p>
          <h3 className="mt-1 text-base font-bold text-on-surface">{item.itemNumber}</h3>
        </div>
        <button onClick={onClose} className="p-1 text-on-surface-variant hover:text-on-surface" title="Close details">
          <Icon name="close" className="text-lg" />
        </button>
      </div>

      <div className="space-y-4">
        {(item.source === "inventory" || item.source === "catalog") && <JevReviewPanel key={item.id} kind={item.source} recordId={item.id.slice(item.id.indexOf(":") + 1)} />}
        <Detail label="Description" value={item.description} />
        <div className="grid grid-cols-2 gap-4">
          <Detail label="Supplier" value={item.supplierName} />
          <Detail label="Manufacturer" value={item.manufacturer} />
          <Detail label="Maker / supplier no." value={item.makerNumber || item.supplierReference} mono />
          <Detail label="Customer ref." value={item.customerReference} mono />
          <Detail label="IMPA-like code" value={item.impaCode} mono />
          <Detail label="HS / COO" value={[item.hsCode, item.countryOfOrigin].filter(Boolean).join(" / ") || null} mono />
          <Detail label="Unit / qty" value={[item.quantity, item.unit].filter((value) => value != null && value !== "").join(" ") || item.unit} />
          <Detail label="Price" value={formatMoney(item.unitPrice, item.currency)} />
          <Detail label="Lead time" value={item.leadTimeDays != null ? `${item.leadTimeDays} days` : null} />
          <Detail label="Inventory" value={item.stockAvailable != null ? `${item.stockAvailable} available / ${item.stockOnHand} on hand` : null} />
          <Detail label="Warehouse" value={item.warehouse} />
          <Detail label="Vessel / port" value={[item.vessel, item.port].filter(Boolean).join(" / ") || null} />
          <Detail label="PO" value={item.poNumber} mono />
          <Detail label="RFQ" value={item.rfqId} mono />
          <Detail label="Agreement" value={formatAgreement(item)} />
          <Detail label="Last activity" value={formatDate(item.lastPurchaseDate)} />
        </div>

        <div>
          <p className="text-[0.6rem] font-bold uppercase tracking-wider text-on-surface-variant mb-2">Match evidence</p>
          <div className="flex flex-wrap gap-2">
            {item.matchReasons.map((reason) => (
              <span key={reason} className="rounded-full border border-outline-variant/20 bg-surface-lowest px-2 py-1 text-[0.65rem] text-secondary">
                {reason}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProcurementHistoryPanel({
  history,
  recentPurchases,
  onSelectQuery,
}: {
  history: ItemSearchHistoryRow[];
  recentPurchases: ItemSearchPriorPurchase[];
  onSelectQuery: (query: string) => void;
}) {
  return (
    <div className="grid grid-cols-12 gap-6">
      <div className="col-span-12 lg:col-span-5 bg-surface-container rounded-xl p-5">
        <h3 className="text-sm font-bold text-on-surface mb-3 flex items-center gap-2">
          <Icon name="history" className="text-success text-lg" /> Search Memory
        </h3>
        {history.length === 0 ? (
          <p className="text-xs text-on-surface-variant">No searches recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {history.map((row) => (
              <button key={row.id} onClick={() => onSelectQuery(row.query)} className="w-full text-left rounded-lg bg-surface-lowest px-3 py-2 hover:bg-surface-container">
                <p className="text-xs text-on-surface">{row.query}</p>
                <p className="text-[0.6rem] text-on-surface-variant">{row.resultCount} candidates | {formatDate(row.createdAt)}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="col-span-12 lg:col-span-7 bg-surface-container rounded-xl p-5">
        <h3 className="text-sm font-bold text-on-surface mb-3 flex items-center gap-2">
          <Icon name="receipt_long" className="text-success text-lg" /> Recent PO Line Evidence
        </h3>
        {recentPurchases.length === 0 ? (
          <p className="text-xs text-on-surface-variant">No prior purchase lines available.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-surface-container text-secondary uppercase text-[0.55rem] font-bold tracking-wider">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2">Supplier</th>
                  <th className="px-3 py-2">PO</th>
                  <th className="px-3 py-2">Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/10">
                {recentPurchases.map((item) => (
                  <tr key={item.id} className="hover:bg-surface-highest">
                    <td className="px-3 py-2">
                      <p className="text-on-surface truncate max-w-[260px]">{item.description}</p>
                      <p className="text-[0.6rem] text-on-surface-variant">{item.quantity} {item.unit} | {item.vessel}</p>
                    </td>
                    <td className="px-3 py-2 text-secondary">{item.supplierName}</td>
                    <td className="px-3 py-2 text-success font-mono">{item.poNumber}</td>
                    <td className="px-3 py-2 text-secondary">{formatMoney(item.unitPrice, item.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Pagination({ page, totalPages, disabled, onPage }: { page: number; totalPages: number; disabled: boolean; onPage: (page: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={disabled || page <= 1}
        onClick={() => onPage(page - 1)}
        className="h-8 w-8 rounded-lg border border-outline-variant/20 text-secondary disabled:opacity-35 hover:bg-surface-container"
        title="Previous page"
      >
        <Icon name="chevron_left" className="text-lg" />
      </button>
      <span className="text-[0.68rem] text-on-surface-variant">Page {page} / {totalPages}</span>
      <button
        type="button"
        disabled={disabled || page >= totalPages}
        onClick={() => onPage(page + 1)}
        className="h-8 w-8 rounded-lg border border-outline-variant/20 text-secondary disabled:opacity-35 hover:bg-surface-container"
        title="Next page"
      >
        <Icon name="chevron_right" className="text-lg" />
      </button>
    </div>
  );
}

function MiniFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-lowest border border-outline-variant/10 px-2 py-1.5">
      <p className="uppercase tracking-wider text-on-surface-variant">{label}</p>
      <p className="mt-0.5 text-on-surface truncate">{value}</p>
    </div>
  );
}

function Detail({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div>
      <p className="text-[0.6rem] font-bold uppercase tracking-wider text-on-surface-variant mb-1">{label}</p>
      <p className={`${mono ? "font-mono" : ""} text-sm text-on-surface break-words`}>{value || "--"}</p>
    </div>
  );
}

function formatMoney(value: number | null | undefined, currency: string | null | undefined) {
  if (value == null) return "--";
  return `${currency || "EUR"} ${value.toFixed(2)}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleDateString();
}

function formatAgreement(item: ItemSearchResult) {
  if (!item.agreementStatus) return null;
  const validTo = formatDate(item.agreementValidTo);
  return validTo === "--" ? item.agreementStatus : `${item.agreementStatus} until ${validTo}`;
}
