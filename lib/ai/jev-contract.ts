export type JevKind = "inventory" | "catalog" | "supplier";
export type JevAdvice = { id: string; status: "completed" | "blocked" | "failed" | "stale"; message: string;
  decision?: "potential_match" | "not_match" | "insufficient"; confidence?: number; model: string; sourceHash: string;
  sourceCheckedAt: string; inputTokens?: number; outputTokens?: number; estimatedUsd?: number; advisoryOnly: true };
export type JevStatus = { configured: boolean; enabled: boolean; dailyLimit: number; usedToday: number; model: string; revision: number;
  recent?: { id: string; kind: string; status: string; createdAt: string; providerAttempted: boolean; inputTokens: number | null; outputTokens: number | null; durationMs: number | null }[] };
