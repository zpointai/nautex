/**
 * AI Provider Configuration
 *
 * Centralizes AI-related configuration and provider selection. Secrets come
 * from environment variables when present, otherwise from the encrypted
 * settings an administrator saved in the application — the packaged desktop
 * build has no .env, so that fallback is what keeps AI usable there.
 */

import { getStoredAIProvider, readAISettings, type StoredAISettings } from "@/lib/ai/secret-store";

export type AIProvider = "deepseek" | "gemini" | "vertex" | "none";

export interface AIConfig {
  provider: AIProvider;
  /** DeepSeek API key */
  deepseekApiKey: string | null;
  /** DeepSeek OpenAI-compatible API base URL */
  deepseekBaseUrl: string;
  /** Google AI Studio Gemini API key */
  geminiApiKey: string | null;
  /** Default model for standard completions */
  defaultModel: string;
  /** Model for fast / low-latency tasks */
  fastModel: string;
  /** Model for deeper reasoning or escalation tasks */
  reasoningModel: string;
  /** Vertex AI project & location (optional) */
  vertexProject: string | null;
  vertexLocation: string | null;
}

export interface AIModelTiers {
  default: string;
  fast: string;
  reasoning: string;
}

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEEPSEEK_DEFAULT_MODEL = "deepseek-flash";
const DEEPSEEK_REASONING_MODEL = "deepseek-v4-pro";

const GEMINI_DEFAULT_MODEL = "gemini-3.1-pro-preview";
const GEMINI_FAST_MODEL = "gemini-3-flash-preview";

export const AI_PROVIDER_MODELS: Record<"deepseek" | "gemini", AIModelTiers> = {
  deepseek: {
    default: DEEPSEEK_DEFAULT_MODEL,
    fast: DEEPSEEK_DEFAULT_MODEL,
    reasoning: DEEPSEEK_REASONING_MODEL,
  },
  gemini: {
    default: GEMINI_DEFAULT_MODEL,
    fast: GEMINI_FAST_MODEL,
    reasoning: GEMINI_DEFAULT_MODEL,
  },
};

function hasUsableKey(value: string | null): boolean {
  return !!(value && value !== "PLACEHOLDER_API_KEY" && value.length > 10);
}

function normalizeProvider(value: string | null | undefined): AIProvider | null {
  const requested = value?.toLowerCase();
  if (requested === "deepseek" || requested === "gemini" || requested === "vertex" || requested === "none") {
    return requested;
  }
  return null;
}

/**
 * Environment first, then settings supplied inside the application.
 *
 * The packaged desktop build receives no .env, so without the stored fallback
 * every AI feature there runs in stub mode. Keeping the environment ahead of it
 * means a development .env or an injected deployment configuration is never
 * silently overridden by state saved on the machine.
 */
function getRequestedProvider(stored: StoredAISettings): AIProvider | null {
  return normalizeProvider(process.env.AI_PROVIDER) ?? normalizeProvider(stored.activeProvider ?? stored.provider);
}

function normalizeProviderModel(provider: AIProvider, value: string | undefined): string | null {
  if (!value) return null;

  if (provider === "deepseek") {
    if (["deepseek-chat", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"].includes(value)) return DEEPSEEK_DEFAULT_MODEL;
    if (value === "deepseek-reasoner") return DEEPSEEK_REASONING_MODEL;
    if (value.startsWith("deepseek-")) return value;
    return null;
  }

  if (provider === "gemini" && value.startsWith("gemini-")) return value;
  if (provider === "vertex") return value;
  return null;
}

function getProviderModelOverride(provider: AIProvider, genericValue: string | undefined, providerValue: string | undefined): string | null {
  const normalizedProviderValue = normalizeProviderModel(provider, providerValue);
  if (normalizedProviderValue) return normalizedProviderValue;

  const normalizedGenericValue = normalizeProviderModel(provider, genericValue);
  if (normalizedGenericValue) return normalizedGenericValue;

  if (!genericValue) return null;
  if (provider === "gemini" && genericValue.startsWith("gemini-")) return genericValue;
  if (provider === "vertex") return genericValue;
  return null;
}

export function getAIConfig(): AIConfig {
  const stored = readAISettings();
  const storedKeyFor = (provider: AIProvider) => getStoredAIProvider(stored, provider)?.apiKey?.trim() || null;

  const deepseekKey = process.env.DEEPSEEK_API_KEY || storedKeyFor("deepseek");
  const geminiKey = process.env.GEMINI_API_KEY || storedKeyFor("gemini");
  const vertexProject = process.env.VERTEX_PROJECT || null;
  const vertexLocation = process.env.VERTEX_LOCATION || null;

  const requestedProvider = getRequestedProvider(stored);
  const hasDeepSeekKey = hasUsableKey(deepseekKey);
  const hasGeminiKey = hasUsableKey(geminiKey);
  const hasVertexConfig = !!(vertexProject && vertexLocation);

  let provider: AIProvider = "none";
  if (requestedProvider === "none") {
    provider = "none";
  } else if (requestedProvider === "deepseek" && hasDeepSeekKey) {
    provider = "deepseek";
  } else if (requestedProvider === "gemini" && hasGeminiKey) {
    provider = "gemini";
  } else if (requestedProvider === "vertex" && hasVertexConfig) {
    provider = "vertex";
  } else if (!requestedProvider) {
    if (hasDeepSeekKey) {
      provider = "deepseek";
    } else if (hasGeminiKey) {
      provider = "gemini";
    }
  }

  const isDeepSeek = provider === "deepseek";

  return {
    provider,
    deepseekApiKey: deepseekKey,
    deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || getStoredAIProvider(stored, "deepseek")?.baseUrl?.trim() || DEEPSEEK_BASE_URL,
    geminiApiKey: geminiKey,
    defaultModel:
      getProviderModelOverride(provider, process.env.AI_DEFAULT_MODEL, isDeepSeek ? process.env.DEEPSEEK_DEFAULT_MODEL : undefined) ||
      getStoredAIProvider(stored, provider)?.models?.default ||
      (isDeepSeek ? DEEPSEEK_DEFAULT_MODEL : GEMINI_DEFAULT_MODEL),
    fastModel:
      getProviderModelOverride(provider, process.env.AI_FAST_MODEL, isDeepSeek ? process.env.DEEPSEEK_FAST_MODEL : undefined) ||
      getStoredAIProvider(stored, provider)?.models?.fast ||
      (isDeepSeek ? DEEPSEEK_DEFAULT_MODEL : GEMINI_FAST_MODEL),
    reasoningModel:
      getProviderModelOverride(provider, process.env.AI_REASONING_MODEL, isDeepSeek ? process.env.DEEPSEEK_REASONING_MODEL : undefined) ||
      getStoredAIProvider(stored, provider)?.models?.reasoning ||
      (isDeepSeek ? DEEPSEEK_REASONING_MODEL : GEMINI_DEFAULT_MODEL),
    vertexProject,
    vertexLocation,
  };
}

/** Quick check: is any AI provider configured? */
export function isAIConfigured(config: AIConfig = getAIConfig()): boolean {
  const provider = config.provider;
  return provider === "deepseek" || provider === "gemini";
}
