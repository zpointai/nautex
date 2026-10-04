"use client";

import { useEffect, useState } from "react";

interface AIStatus {
  configured: boolean;
  provider: string;
  defaultModel: string;
  fastModel: string;
  reasoningModel: string;
  hasPrivateKey: boolean;
  hasVertexConfig: boolean;
}

const CACHE_TTL = 60_000; // 1 minute

let cachedStatus: { data: AIStatus; ts: number } | null = null;

export function useAIStatus() {
  const initialStatus = cachedStatus?.data ?? null;
  const [status, setStatus] = useState<AIStatus | null>(initialStatus);
  const [loading, setLoading] = useState(!initialStatus);

  useEffect(() => {
    const refresh = () => {
    setLoading(true);

    fetch("/api/v1/ai/status")
      .then((r) => r.json())
      .then((data: AIStatus) => {
        cachedStatus = { data, ts: Date.now() };
        setStatus(data);
      })
      .catch(() => {
        setStatus({ configured: false, provider: "none", defaultModel: "", fastModel: "", reasoningModel: "", hasPrivateKey: false, hasVertexConfig: false });
      })
      .finally(() => setLoading(false));
    };
    if (!cachedStatus || Date.now() - cachedStatus.ts >= CACHE_TTL) refresh();
    window.addEventListener("nautex-ai-settings-changed", refresh);
    return () => window.removeEventListener("nautex-ai-settings-changed", refresh);
  }, []);

  return { status, loading, configured: status?.configured ?? false };
}

/**
 * Compact badge showing server-side AI status without exposing backend vendor details.
 */
export function AIStatusBadge({ className = "" }: { className?: string }) {
  const { status, loading } = useAIStatus();

  if (loading) return null;

  const configured = status?.configured ?? false;

  return (
    <span className={`inline-flex items-center gap-1.5 text-[0.6rem] font-medium px-2 py-0.5 rounded-full ${
      configured
        ? "bg-success/8 text-success"
        : "bg-surface-highest/30 text-outline"
    } ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${configured ? "bg-success" : "bg-outline/40"}`} />
      {configured ? "AI active" : "AI not connected"}
    </span>
  );
}

/**
 * Banner shown inside AI-powered modules when server-side AI is not configured.
 */
export function AINotConfiguredBanner({ moduleName }: { moduleName: string }) {
  const { configured, loading } = useAIStatus();

  if (loading || configured) return null;

  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-surface-highest/15 border border-outline-variant/8 mb-4">
      <span className="material-symbols-outlined text-base text-outline mt-0.5" style={{ fontVariationSettings: "'FILL' 0, 'wght' 300, 'opsz' 20" }}>
        info
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-on-surface-variant mb-0.5">
          AI assistance is not connected for {moduleName}
        </p>
        <p className="text-[0.65rem] text-outline leading-relaxed">
          Local features remain available. <button type="button" className="text-primary underline" onClick={() => window.dispatchEvent(new Event("nautex-open-provider-settings"))}>Connect provider</button>
        </p>
      </div>
    </div>
  );
}
