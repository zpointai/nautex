/** Optional typed-decision client. Not connected to any application workflow. */
export const TYPESAFE_MODEL = "jev-1.13.0";
export const TYPESAFE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const TYPESAFE_INPUT_USD_PER_MILLION = 0.042; // Published 2026-09-17; not an account quote.
export const MAX_REQUEST_BYTES = 12_000;
export type Question =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] }
  | { type: "noul"; instructions: string };
export type DecisionRequest = { model: string; state: unknown; questions: Record<string, Question> };
export type Answer =
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: "score"; score: number; confidence: number; probabilities: Record<string, number>; legend: Record<string, string> }
  | { type: "noul"; noul: number };
export type DecisionResponse = { model: string; answers: Record<string, Answer>; usage: { input_tokens: number; output_tokens: number } };
export class TypeSafeError extends Error {
  constructor(public readonly code: string, public readonly status?: number) {
    super(`TypeSafe ${code}${status ? ` (HTTP ${status})` : ""}`);
  }
}
const fail = () => { throw new TypeSafeError("INVALID_RESPONSE"); };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}
const probability = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
const sameKeys = (actual: object, expected: string[]) => Object.keys(actual).sort().join("\0") === [...expected].sort().join("\0");
function distribution(value: unknown, keys: string[]) {
  const row = object(value);
  if (!sameKeys(row, keys) || !Object.values(row).every(probability)) return fail();
  const result = row as Record<string, number>;
  if (Math.abs(Object.values(result).reduce((a, b) => a + b, 0) - 1) > 0.005) return fail();
  return result;
}
export function requestBody(request: DecisionRequest): string {
  if (request.model !== TYPESAFE_MODEL || request.state === undefined || request.state === null) throw new TypeSafeError("INVALID_REQUEST");
  const entries = Object.entries(request.questions);
  if (entries.length < 1 || entries.length > 3) throw new TypeSafeError("INVALID_REQUEST");
  for (const [key, q] of entries) {
    if (!/^[a-z][a-z0-9_]{0,40}$/.test(key) || !q.instructions.trim()) throw new TypeSafeError("INVALID_REQUEST");
    if (q.type === "choice" && (Object.keys(q.criteria).length < 2 || Object.keys(q.criteria).length > 20 || !Object.values(q.criteria).every(v => typeof v === "string"))) throw new TypeSafeError("INVALID_REQUEST");
    if (q.type === "score" && (q.criteria.length < 2 || q.criteria.length > 10 || !q.criteria.every(v => typeof v === "string"))) throw new TypeSafeError("INVALID_REQUEST");
    if (!["choice", "score", "noul"].includes(q.type)) throw new TypeSafeError("INVALID_REQUEST");
  }
  const body = JSON.stringify(request);
  if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) throw new TypeSafeError("REQUEST_TOO_LARGE");
  return body;
}
export function validateResponse(value: unknown, request: DecisionRequest): DecisionResponse {
  const root = object(value), answers = object(root.answers), usage = object(root.usage);
  if (root.model !== request.model || !sameKeys(answers, Object.keys(request.questions))) return fail();
  if (![usage.input_tokens, usage.output_tokens].every(v => Number.isSafeInteger(v) && Number(v) >= 0)) return fail();
  const clean: Record<string, Answer> = {};
  for (const [key, q] of Object.entries(request.questions)) {
    const a = object(answers[key]);
    if (a.type !== q.type) return fail();
    if (q.type === "noul") {
      if (!probability(a.noul)) return fail();
      clean[key] = { type: "noul", noul: a.noul };
    } else {
      if (!probability(a.confidence)) return fail();
      const keys = q.type === "choice" ? Object.keys(q.criteria) : q.criteria.map((_, i) => String(i));
      const probabilities = distribution(a.probabilities, keys);
      if (q.type === "choice") {
        if (typeof a.choice !== "string" || !keys.includes(a.choice) || probabilities[a.choice] + 0.005 < Math.max(...Object.values(probabilities))) return fail();
        clean[key] = { type: "choice", choice: a.choice, confidence: a.confidence, probabilities };
      } else {
        const legend = object(a.legend);
        if (!sameKeys(legend, keys) || keys.some(k => legend[k] !== q.criteria[Number(k)])) return fail();
        if (typeof a.score !== "number" || !Number.isFinite(a.score) || a.score < 0 || a.score > keys.length - 1) return fail();
        const weighted = keys.reduce((total, k) => total + Number(k) * probabilities[k], 0);
        if (Math.abs(a.score - weighted) > 0.025) return fail();
        clean[key] = { type: "score", score: a.score, confidence: a.confidence, probabilities, legend: legend as Record<string, string> };
      }
    }
  }
  return { model: String(root.model), answers: clean, usage: { input_tokens: Number(usage.input_tokens), output_tokens: Number(usage.output_tokens) } };
}
export async function evaluateTypeSafe(request: DecisionRequest, options: {
  apiKey: string; signal?: AbortSignal; timeoutMs?: number; fetchImpl?: typeof fetch;
}): Promise<DecisionResponse> {
  if (!options.apiKey || /\s/.test(options.apiKey)) throw new TypeSafeError("KEY_INVALID");
  const body = requestBody(request);
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new TypeSafeError("INVALID_TIMEOUT");
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  if (signal.aborted) throw new TypeSafeError("CANCELLED_OR_TIMEOUT");
  try {
    const response = await (options.fetchImpl ?? fetch)(TYPESAFE_ENDPOINT, {
      method: "POST", redirect: "error", signal,
      headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" }, body,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new TypeSafeError("HTTP_ERROR", response.status);
    }
    const reader = response.body?.getReader();
    if (!reader) return fail();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > 65_536) throw new TypeSafeError("RESPONSE_TOO_LARGE");
        chunks.push(next.value);
      }
    } finally { await reader.cancel().catch(() => undefined); }
    let parsed: unknown;
    try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return fail(); }
    return validateResponse(parsed, request);
  } catch (error) {
    if (error instanceof TypeSafeError) throw error;
    // Transport messages and provider bodies can echo credentials/input. Never expose them.
    throw new TypeSafeError(signal.aborted ? "CANCELLED_OR_TIMEOUT" : "NETWORK_ERROR");
  }
}
