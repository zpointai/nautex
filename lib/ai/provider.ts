/**
 * AI Provider Abstraction
 *
 * All model calls go through this layer. Modules should not call vendor APIs
 * directly, which keeps secrets server-side and makes provider swaps contained.
 */

import { observeAI, observeAttempt, observedFetch, type AIObservationOptions } from "./observability";
import { readAISettings, getStoredAIProvider } from "./secret-store";
import { taskTier, evaluatedRfqOptions } from "./routing";
import { AI_PROVIDER_MODELS, getAIConfig, type AIConfig } from "./config";

export interface AIGenerateOptions extends AIObservationOptions {
  /** Explicit server-owned override; omission preserves the existing provider behavior. */
  reasoning?: "disabled" | "low" | "high";
  /** Which model tier to use. Reasoning is reserved for costly escalation paths. */
  tier?: "default" | "fast" | "reasoning";
  /** System instruction / persona */
  systemInstruction?: string;
  /** Temperature. Default 0.4 */
  temperature?: number;
  /** Max output tokens */
  maxTokens?: number;
  /** Response MIME type, for example "application/json" */
  responseMimeType?: string;
}

/** Used by isolated evaluations without changing stored settings or process-wide model mappings. */
export interface AIServiceContext extends AIObservationOptions {
  config?: AIConfig;
  reasoning?: AIGenerateOptions["reasoning"];
}

function reasoningSetting(config: AIConfig, opts: AIGenerateOptions): string {
  if (config.provider === "gemini") return opts.reasoning ?? "provider_default";
  if (!supportsDeepSeekThinking(selectModel(config, opts.tier))) return "provider_default";
  const setting = opts.reasoning ?? (opts.tier === "reasoning" ? "high" : "disabled");
  return setting === "disabled" ? setting : "enabled_" + setting;
}

export interface AIResult<T = string> {
  ok: boolean;
  data: T | null;
  error: string | null;
  model: string;
  provider: string;
}

export function providerFailure(provider: string, status: number) {
  const help = status === 401 || status === 403 ? "Check or replace your API key and account permissions in Settings."
    : status === 402 || status === 429 ? "Check provider billing, credits and quota; retry after the limit resets."
    : status === 404 ? "Choose a model available to your account in Settings."
    : "The provider is unavailable or rejected the request; check its status and retry later.";
  return provider + " HTTP " + status + ": " + help + " Your input is retained.";
}

function selectModel(config: AIConfig, tier: AIGenerateOptions["tier"]): string {
  if (tier === "reasoning") return config.reasoningModel;
  if (tier === "fast") return config.fastModel;
  return config.defaultModel;
}

// V4.1 uses a canonical name without the old version prefix. It still defaults
// to thinking unless explicitly disabled for bounded extraction workflows.
function supportsDeepSeekThinking(model: string) {
  return model === "deepseek-flash" || model.startsWith("deepseek-v4-");
}

/* Gemini API (Google AI Studio) */

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

async function callGemini(
  prompt: string,
  config: AIConfig,
  opts: AIGenerateOptions
): Promise<AIResult> {
  const model = selectModel(config, opts.tier);
  if (opts.reasoning === "disabled") throw new Error("Gemini thinking cannot be disabled by this adapter; select low or high explicitly.");
  const url = `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent`;

  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.4,
      maxOutputTokens: opts.maxTokens ?? 4096,
      ...(opts.reasoning ? { thinkingConfig: { thinkingLevel: opts.reasoning.toUpperCase() } } : {}),
      ...(opts.responseMimeType ? { responseMimeType: opts.responseMimeType } : {}),
    },
  };

  if (opts.systemInstruction) {
    body.systemInstruction = { parts: [{ text: opts.systemInstruction }] };
  }

  const res = await observedFetch("gemini", url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": config.geminiApiKey! },
    body: JSON.stringify(body),
    signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    return { ok: false, data: null, error: providerFailure("Gemini", res.status), model, provider: "gemini" };
  }

  const json = await res.json() as { candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> };
  const candidate = json.candidates?.[0];
  if (candidate?.finishReason && candidate.finishReason !== "STOP") {
    return { ok: false, data: null, error: `Gemini response did not complete (${candidate.finishReason}).`, model, provider: "gemini" };
  }
  const text = candidate?.content?.parts?.filter((part) => !part.thought && typeof part.text === "string").map((part) => part.text).join("").trim() || null;

  return { ok: !!text, data: text, error: text ? null : "Empty response from model", model, provider: "gemini" };
}

/* DeepSeek API (OpenAI-compatible chat completions) */

interface DeepSeekResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
}

async function callDeepSeekOnce(
  prompt: string,
  config: AIConfig,
  opts: AIGenerateOptions
): Promise<AIResult> {
  const model = selectModel(config, opts.tier);
  const baseUrl = config.deepseekBaseUrl.replace(/\/+$/, "");
  const messages: Array<{ role: "system" | "user"; content: string }> = [];

  if (opts.systemInstruction) {
    messages.push({ role: "system", content: opts.systemInstruction });
  }
  messages.push({ role: "user", content: prompt });

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: opts.temperature ?? 0.4,
    max_tokens: opts.maxTokens ?? 4096,
    // V4 defaults to thinking, which can exhaust small extraction budgets.
    ...(supportsDeepSeekThinking(model) ? {
      thinking: { type: reasoningSetting(config, opts) === "disabled" ? "disabled" : "enabled" },
      ...(reasoningSetting(config, opts) !== "disabled" ? { reasoning_effort: opts.reasoning ?? "high" } : {}),
    } : {}),
  };

  if (opts.responseMimeType === "application/json") {
    body.response_format = { type: "json_object" };
  }

  const res = await observedFetch("deepseek", `${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.deepseekApiKey}`,
    },
    body: JSON.stringify(body),
    signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
  });

  const json = await res.json().catch(() => null) as DeepSeekResponse | null;

  if (!res.ok) {
    return { ok: false, data: null, error: providerFailure("DeepSeek", res.status), model, provider: "deepseek" };
  }

  const choice = json?.choices?.[0];
  if (choice?.finish_reason && choice.finish_reason !== "stop") {
    return { ok: false, data: null, error: `DeepSeek response did not complete (${choice.finish_reason}).`, model, provider: "deepseek" };
  }
  const text = typeof choice?.message?.content === "string" ? choice.message.content.trim() || null : null;

  return { ok: !!text, data: text, error: text ? null : "Empty response from model", model, provider: "deepseek" };
}

async function callDeepSeek(
  prompt: string,
  config: AIConfig,
  opts: AIGenerateOptions
): Promise<AIResult> {
  const first = await observeAttempt(()=>callDeepSeekOnce(prompt, config, opts), {provider:"deepseek",model:selectModel(config,opts.tier),reasoning:reasoningSetting(config,opts),json:opts.responseMimeType === "application/json"});
  if (first.ok || opts.responseMimeType !== "application/json" || first.error !== "Empty response from model") {
    return first;
  }

  // DeepSeek JSON mode can occasionally return empty content; retry once.
  return observeAttempt(()=>callDeepSeekOnce(prompt, config, opts), {provider:"deepseek",model:selectModel(config,opts.tier),reasoning:reasoningSetting(config,opts),json:true});
}

/**
 * Generate text completion from the configured AI provider.
 *
 * Returns a result object and does not throw. Callers check `result.ok`.
 */
async function generateRaw(
  prompt: string,
  opts: AIGenerateOptions = {},
  config: AIConfig = getAIConfig(),
): Promise<AIResult> {

  if (config.provider === "none") {
    return {
      ok: false,
      data: null,
      error: "AI provider not configured. Connect a provider in Settings or configure the server environment.",
      model: "none",
      provider: "none",
    };
  }

  try {
    if (config.provider === "deepseek") {
      return await callDeepSeek(prompt, config, opts);
    }

    if (config.provider === "gemini") {
      return await observeAttempt(()=>callGemini(prompt, config, opts), {provider:"gemini",model:selectModel(config,opts.tier),reasoning:reasoningSetting(config,opts),json:opts.responseMimeType === "application/json"});
    }

    if (config.provider === "vertex") {
      return {
        ok: false,
        data: null,
        error: "Vertex AI provider not yet implemented. Use DEEPSEEK_API_KEY or GEMINI_API_KEY for now.",
        model: config.defaultModel,
        provider: "vertex",
      };
    }

    return { ok: false, data: null, error: "Unknown provider", model: "none", provider: "unknown" };
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError") ? "AI request timed out or was cancelled. Your input is retained; retry when ready." : "AI request failed. Check your connection and selected model in Settings; retry with your retained input.",
      model: selectModel(config, opts.tier),
      provider: config.provider,
    };
  }
}

export async function generateText(prompt:string,opts:AIGenerateOptions={},config:AIConfig=getAIConfig()):Promise<AIResult> {
  const routed=evaluatedRfqOptions(config,{...opts,tier:taskTier(opts.workflow,opts.tier)});
  return observeAI(routed,false,()=>generateRaw(prompt,routed,config));
}

/**
 * Generate and parse JSON from the AI provider.
 */
export async function generateJSON<T = unknown>(
  prompt: string,
  opts: Omit<AIGenerateOptions, "responseMimeType"> & { validate?: (value: unknown) => boolean } = {},
  config: AIConfig = getAIConfig(),
): Promise<AIResult<T>> {
  const routed=evaluatedRfqOptions(config,{...opts,tier:taskTier(opts.workflow,opts.tier)});
  return observeAI(routed,true,async()=>{
  const result = await generateRaw(prompt, {
    ...routed,
    responseMimeType: "application/json",
  }, config);

  if (!result.ok || !result.data) {
    return { ...result, data: null } as AIResult<T>;
  }

  try {
    let raw = result.data.trim();
    if (raw.startsWith("```")) {
      raw = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    const parsed = JSON.parse(raw) as T;
    if (opts.validate && !opts.validate(parsed)) {
      return { ok: false, data: null, error: "AI response did not match the required schema.", model: result.model, provider: result.provider };
    }
    return { ok: true, data: parsed, error: null, model: result.model, provider: result.provider };
  } catch {
    return { ok: false, data: null, error: "Failed to parse AI JSON response", model: result.model, provider: result.provider };
  }
  });
}

/** Synthetic connection check; does not switch the active provider or send business data. */
export async function testAIConnection(provider: "deepseek" | "gemini", tier: "fast" | "default" | "reasoning" = "fast") {
  const active = getAIConfig();
  const key = provider === "deepseek" ? active.deepseekApiKey : active.geminiApiKey;
  if (!key) return { ok: false, data: null, error: "This provider has no configured key.", model: "none", provider };
  const models = getStoredAIProvider(readAISettings(), provider)?.models ?? AI_PROVIDER_MODELS[provider];
  const config = active.provider === provider ? active : { ...active, provider, defaultModel: models.default, fastModel: models.fast, reasoningModel: models.reasoning };
  return generateText('Return only the JSON object {"status":"ok"}.', { workflow:"connection_test",promptVersion:"connection-1",schemaVersion:"connection-1",tier, responseMimeType: "application/json", maxTokens: tier === "reasoning" ? 2048 : 256, temperature: 0 }, config);
}
