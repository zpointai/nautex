"use client";

import { useCallback, useEffect, useState } from "react";
import { AINotConfiguredBanner, AIStatusBadge } from "@/components/ai-status-badge";

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined ${className}`} style={{ fontVariationSettings: "'FILL' 0" }}>
      {name}
    </span>
  );
}

type Tool = "text" | "verify" | "image";
type Tab = "finder" | "history";

interface ClassificationResult {
  id: string;
  query: string;
  eu: { code: string; confidence: number; confidenceLevel: string; description: string; rationale: string; logic: string };
  us: { code: string; confidence: number; confidenceLevel: string; description: string; rationale: string; logic: string };
  datasetMatches?: Array<{ id: string; code: string; system: string; description: string; source: string }>;
}

interface VerificationResult {
  id: string;
  query: { code: string; description: string };
  isValid: boolean;
  assessment: string;
  providedCodeDescription: string;
  suggestedCode: string | null;
  suggestedCodeDescription: string | null;
}

export function HSCodeFinderModule() {
  const [activeTool, setActiveTool] = useState<Tool>("text");
  const [activeTab, setActiveTab] = useState<Tab>("finder");
  const [textQuery, setTextQuery] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [verifyDescription, setVerifyDescription] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [result, setResult] = useState<{ type: "classification"; data: ClassificationResult } | { type: "verification"; data: VerificationResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ historyId?: string; type: string; data: ClassificationResult | VerificationResult; favorite?: boolean }>>([]);

  const loadHistory = useCallback(async () => {
    const res = await fetch("/api/v1/hs-code/history?limit=20");
    const payload = await res.json();
    if (payload.data) {
      setHistory(payload.data.map((record: { id: string; type: string; result: ClassificationResult | VerificationResult; favorite: boolean }) => ({
        historyId: record.id,
        type: record.type,
        data: record.result,
        favorite: record.favorite,
      })));
    }
  }, []);

  useEffect(() => {
    loadHistory().catch(() => undefined);
  }, [loadHistory]);

  const handleClassify = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      let body: Record<string, unknown>;
      if (activeTool === "text") {
        if (!textQuery.trim()) { setError("Enter a product description."); setIsLoading(false); return; }
        body = { type: "text", description: textQuery.trim() };
      } else if (activeTool === "verify") {
        if (!verifyCode.trim() || !verifyDescription.trim()) { setError("Enter both HS code and description."); setIsLoading(false); return; }
        body = { type: "verify", code: verifyCode.trim(), itemDescription: verifyDescription.trim() };
      } else {
        setError("Image classification requires AI backend integration."); setIsLoading(false); return;
      }

      const res = await fetch("/api/v1/hs-code/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Classification failed.");

      setResult(payload.data);
      setHistory((prev) => [{ ...payload.data, favorite: false }, ...prev].slice(0, 20));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setIsLoading(false);
    }
  }, [activeTool, textQuery, verifyCode, verifyDescription]);

  const toggleFavorite = useCallback(async (historyId?: string, favorite?: boolean) => {
    if (!historyId) return;
    try {
    const response = await fetch("/api/v1/hs-code/history", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: historyId, favorite: !favorite }),
    });
    if (!response.ok) throw new Error("Could not save the favorite. Please try again.");
    setHistory((prev) => prev.map((item) => item.historyId === historyId ? { ...item, favorite: !favorite } : item));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save the favorite.");
    }
  }, []);

  const handleDatasetImport = useCallback(async (file: File | null) => {
    if (!file) return;
    setIsImporting(true);
    setError(null);
    setImportNotice(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("source", "uploaded_dataset");
      const res = await fetch("/api/v1/hs-code/import", { method: "POST", body: form });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error?.message ?? payload.error ?? "Import failed.");
      setImportNotice(`Imported ${payload.data.importedCount.toLocaleString()} HS rows. Skipped ${payload.data.skippedCount.toLocaleString()}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setIsImporting(false);
    }
  }, []);

  const tools: Array<{ key: Tool; icon: string; label: string }> = [
    { key: "text", icon: "description", label: "Text" },
    { key: "verify", icon: "verified", label: "Verify" },
  ];

  return (
    <div className="space-y-6">
      <AINotConfiguredBanner moduleName="HS Code Finder" />
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-container border border-outline-variant/20 px-4 py-3">
        <Icon name="dataset" className="text-base text-success" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-on-surface">HS dataset lookup is enabled</p>
          <p className="text-[0.65rem] text-on-surface-variant mt-0.5">Upload a licensed CSV/XLSX dataset with code and description columns. Nautex checks the dataset before falling back to AI.</p>
        </div>
        <label className="cursor-pointer rounded-lg bg-success px-3 py-2 text-[0.65rem] font-bold text-on-primary hover:opacity-90">
          {isImporting ? "Importing..." : "Import HS Dataset"}
          <input type="file" accept=".csv,.xlsx,.xls" className="hidden" disabled={isImporting} onChange={(event) => void handleDatasetImport(event.target.files?.[0] ?? null)} />
        </label>
      </div>
      {importNotice && <div className="rounded-lg border border-success/20 bg-success/10 px-4 py-2 text-xs text-success">{importNotice}</div>}
      {/* Tabs */}
      <div className="flex gap-6 border-b border-outline-variant/30 pb-1">
        {(["finder", "history"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`pb-3 px-1 text-sm font-semibold transition-all ${
              activeTab === tab
                ? "text-success border-b-2 border-success"
                : "text-on-surface-variant hover:text-secondary"
            }`}
          >
            {tab === "finder" ? "Finder" : "History"}
          </button>
        ))}
      </div>

      {activeTab === "finder" && (
        <div className="grid grid-cols-12 gap-6">
          {/* Left: Tool selector + input */}
          <div className="col-span-4 space-y-4">
            <div className="bg-surface-container rounded-xl p-5">
              {/* Tool Tabs */}
              <div className="flex gap-1 bg-surface-lowest p-1 rounded-lg mb-4">
                {tools.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setActiveTool(t.key)}
                    className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-md text-[0.65rem] font-bold transition-all ${
                      activeTool === t.key ? "bg-success text-on-primary" : "text-on-surface-variant hover:bg-surface-high"
                    }`}
                  >
                    <Icon name={t.icon} className="text-lg" />
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Text Input */}
              {activeTool === "text" && (
                <div className="space-y-3">
                  <textarea
                    value={textQuery}
                    onChange={(e) => setTextQuery(e.target.value)}
                    placeholder="Describe the product in detail (e.g., 'Twist drill bit, 5mm, HSS-G for metal')"
                    rows={4}
                    className="w-full p-3 bg-surface-lowest rounded-lg text-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-1 focus:ring-success resize-none"
                  />
                  <button
                    onClick={handleClassify}
                    disabled={!textQuery.trim() || isLoading}
                    className="w-full bg-success text-on-primary py-2.5 rounded-lg text-sm font-semibold hover:opacity-90 transition-all disabled:opacity-50"
                  >
                    {isLoading ? "Classifying..." : "Classify Product"}
                  </button>
                </div>
              )}

              {/* Verify Input */}
              {activeTool === "verify" && (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={verifyCode}
                    onChange={(e) => setVerifyCode(e.target.value)}
                    placeholder="Enter HS Code to verify..."
                    className="w-full p-3 bg-surface-lowest rounded-lg text-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-1 focus:ring-success"
                  />
                  <textarea
                    value={verifyDescription}
                    onChange={(e) => setVerifyDescription(e.target.value)}
                    placeholder="Describe the product for context..."
                    rows={3}
                    className="w-full p-3 bg-surface-lowest rounded-lg text-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-1 focus:ring-success resize-none"
                  />
                  <button
                    onClick={handleClassify}
                    disabled={!verifyCode.trim() || !verifyDescription.trim() || isLoading}
                    className="w-full bg-success text-on-primary py-2.5 rounded-lg text-sm font-semibold hover:opacity-90 transition-all disabled:opacity-50"
                  >
                    {isLoading ? "Verifying..." : "Verify Code"}
                  </button>
                </div>
              )}

              {/* Image Upload */}
              {activeTool === "image" && (
                <div className="p-6 border-2 border-dashed border-outline-variant/50 rounded-xl text-center">
                  <Icon name="cloud_upload" className="text-on-surface-variant text-4xl mb-2" />
                  <p className="text-sm text-on-surface-variant">Image classification is not available in this version.</p>
                  <p className="text-[0.65rem] text-on-surface-variant mt-1">Use Text to describe the product, or Verify to check an existing code.</p>
                </div>
              )}
            </div>

            {/* Recent History Sidebar */}
            {history.length > 0 && (
              <div className="bg-surface-container rounded-xl p-5">
                <h4 className="text-xs font-bold text-secondary mb-3 flex items-center gap-2">
                  <Icon name="history" className="text-sm" /> Recent Activity
                </h4>
                <div className="space-y-2">
                  {history.slice(0, 5).map((h, idx) => (
                    <button
                      key={idx}
                      onClick={() => setResult(h as typeof result)}
                      className="w-full bg-surface-container p-3 rounded-lg text-left hover:bg-surface-high transition-colors"
                    >
                      <p className="text-xs font-semibold text-secondary truncate">
                        {h.type === "classification"
                          ? (h.data as ClassificationResult).query
                          : `Verify: ${(h.data as VerificationResult).query.code}`}
                      </p>
                      {h.type === "classification" && (
                        <div className="flex justify-between mt-1 text-[0.6rem] text-on-surface-variant">
                          <span>EU: {(h.data as ClassificationResult).eu.code || "More details needed"}</span>
                          <span>US: {(h.data as ClassificationResult).us.code || "More details needed"}</span>
                        </div>
                      )}
                      {h.favorite && <p className="text-[0.55rem] text-warning mt-1">Favorite</p>}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: Results */}
          <div className="col-span-8">
            {isLoading && (
              <div className="bg-surface-container rounded-xl p-12 text-center">
                <Icon name="sync" className="animate-spin text-success text-3xl mb-3" />
                <p className="text-sm text-secondary">Classifying product...</p>
              </div>
            )}

            {error && (
              <div className="bg-error-container/20 border border-error/30 rounded-xl p-4 flex items-center gap-3">
                <Icon name="error" className="text-error" />
                <span className="text-sm text-error">{error}</span>
              </div>
            )}

            {!isLoading && !error && result?.type === "classification" && (
              <ClassificationCard data={result.data} />
            )}

            {!isLoading && !error && result?.type === "verification" && (
              <VerificationCard data={result.data} />
            )}

            {!isLoading && !error && !result && (
              <div className="bg-surface-container rounded-xl p-12 text-center border border-dashed border-outline-variant/30">
                <Icon name="travel_explore" className="text-on-surface-variant text-4xl mb-3" />
                <p className="text-sm text-on-surface-variant">Your classification results will appear here.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "history" && (
        <div>
          {history.length === 0 ? (
            <div className="bg-surface-container rounded-xl p-12 text-center border border-dashed border-outline-variant/30">
              <p className="text-sm text-on-surface-variant">No classification history yet.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {history.map((h, idx) =>
                h.type === "classification" ? (
                  <ClassificationCard key={idx} data={h.data as ClassificationResult} historyId={h.historyId} favorite={h.favorite} onToggleFavorite={toggleFavorite} />
                ) : (
                  <VerificationCard key={idx} data={h.data as VerificationResult} historyId={h.historyId} favorite={h.favorite} onToggleFavorite={toggleFavorite} />
                )
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ClassificationCard({
  data,
  historyId,
  favorite,
  onToggleFavorite,
}: {
  data: ClassificationResult;
  historyId?: string;
  favorite?: boolean;
  onToggleFavorite?: (historyId?: string, favorite?: boolean) => void;
}) {
  return (
    <div className="bg-surface-container rounded-xl p-6 space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon name="auto_awesome" className="text-success text-lg" />
        <h3 className="text-sm font-bold">Jurisdictional Classification</h3>
        <span className="text-[0.65rem] text-on-surface-variant ml-2">Query: &quot;{data.query}&quot;</span>
        {historyId && (
          <button
            onClick={() => onToggleFavorite?.(historyId, favorite)}
            className={`ml-auto text-[0.65rem] font-bold ${favorite ? "text-warning" : "text-on-surface-variant hover:text-warning"}`}
          >
            {favorite ? "Favorited" : "Favorite"}
          </button>
        )}
      </div>

      {data.datasetMatches && <div className="space-y-2 text-xs text-on-surface-variant">
        <p className="font-semibold text-on-surface">Dataset candidates — product applicability requires review</p>
        {data.datasetMatches.map((match) => <p key={match.id}><span className="font-mono text-on-surface">{match.code}</span> ({match.system}) · {match.description} · Source: {match.source}</p>)}
      </div>}
      {!data.datasetMatches && <p className="text-sm text-on-surface-variant">AI suggestions require qualified review against the current tariff schedule. Missing product properties must be confirmed before using a code.</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(["eu", "us"] as const).map((jurisdiction) => {
          const d = data[jurisdiction];
          const label = jurisdiction === "eu" ? "European Union (TARIC)" : "United States (HTSUS)";
          return (
            <div key={jurisdiction} className="bg-surface-container rounded-lg p-5 space-y-3">
              <h4 className="font-semibold text-sm text-on-surface">{label}</h4>
              <div className="bg-surface-lowest p-3 rounded-md">
                <p className="text-[0.6rem] text-success font-bold tracking-wider uppercase">
                  {data.datasetMatches ? "Dataset candidate" : d.code ? "Suggested code" : "Clarification required"}
                </p>
                <p className="text-xl font-mono font-bold text-on-surface mt-1">{d.code || (data.datasetMatches ? "No match" : "More product details needed")}</p>
              </div>
              <div className="text-xs space-y-2">
                <p className="text-secondary">
                  <span className="font-semibold">Confidence:</span>{" "}
                  <span className={`${d.code ? "text-on-surface" : "text-warning"} font-bold`}>{d.code ? `${d.confidenceLevel}${!data.datasetMatches ? ` (${d.confidence}%)` : ''}` : "Not classified"}</span>
                </p>
                <p className="text-on-surface-variant italic">{d.rationale}</p>
                <div>
                  <p className="font-semibold text-secondary mb-1">Description:</p>
                  <p className="text-on-surface-variant">{d.description}</p>
                </div>
                {d.logic && (
                  <div>
                    <p className="font-semibold text-secondary mb-1">Classification Logic:</p>
                    <p className="text-[0.65rem] text-on-surface-variant font-mono bg-surface-lowest p-2 rounded whitespace-pre-wrap">
                      {d.logic}
                    </p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VerificationCard({
  data,
  historyId,
  favorite,
  onToggleFavorite,
}: {
  data: VerificationResult;
  historyId?: string;
  favorite?: boolean;
  onToggleFavorite?: (historyId?: string, favorite?: boolean) => void;
}) {
  const isCorrect = data.isValid;
  return (
    <div className="bg-surface-container rounded-xl p-6 space-y-4">
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-2">
          <Icon name="verified" className="text-success text-lg" />
          <h3 className="text-sm font-bold">HS Code Verification</h3>
        </div>
        <span
          className={`px-3 py-1 rounded-full text-[0.65rem] font-bold ${
            isCorrect
              ? "bg-success-dim/10 text-success-dim border border-success-dim/30"
              : "bg-error/10 text-error border border-error/30"
          }`}
        >
          {isCorrect ? "AI suggests a match — review required" : "Not verified — review required"}
        </span>
        {historyId && (
          <button
            onClick={() => onToggleFavorite?.(historyId, favorite)}
            className={`text-[0.65rem] font-bold ${favorite ? "text-warning" : "text-on-surface-variant hover:text-warning"}`}
          >
            {favorite ? "Favorited" : "Favorite"}
          </button>
        )}
      </div>

      <div className="bg-surface-container rounded-lg p-5 space-y-3">
        <p className="text-xs text-secondary">
          Code <span className="font-mono bg-surface-lowest px-2 py-0.5 rounded text-on-surface">{data.query.code}</span>{" "}
          for: <span className="italic">&quot;{data.query.description}&quot;</span>
        </p>
        <div>
          <p className="text-xs font-semibold text-secondary">Assessment:</p>
          <p className="text-xs text-on-surface-variant whitespace-pre-wrap mt-1">{data.assessment}</p>
        </div>
        {!isCorrect && data.suggestedCode && (
          <div className="pt-3 border-t border-outline-variant/30">
            <p className="text-xs font-semibold text-secondary">Suggested Code:</p>
            <p className="text-xl font-mono font-bold text-success mt-1">{data.suggestedCode}</p>
            {data.suggestedCodeDescription && (
              <p className="text-xs text-on-surface-variant mt-1">{data.suggestedCodeDescription}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
