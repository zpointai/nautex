import { getAIConfig, isAIConfigured } from "@/lib/ai";
import { testAIConnection } from "@/lib/ai/provider";
import { AI_PROVIDER_MODELS } from "@/lib/ai/config";
import {
  clearAISettings,
  getStoredAIProvider,
  maskSecret,
  normalizeStoredAISettings,
  readAISettings,
  writeAISettings,
} from "@/lib/ai/secret-store";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { fail, logApiError, ok } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";

const PROVIDERS = ["deepseek", "gemini"] as const;
const SUPPORTED_PROVIDERS = new Set([...PROVIDERS, "none"]);

function environmentOverride() {
  return Boolean(process.env.AI_PROVIDER?.trim());
}

function providerEnvironmentKey(provider: string) {
  if (provider === "deepseek") return process.env.DEEPSEEK_API_KEY?.trim() || null;
  if (provider === "gemini") return process.env.GEMINI_API_KEY?.trim() || null;
  return null;
}

function providerStates() {
  const stored = readAISettings();
  return Object.fromEntries(PROVIDERS.map((provider) => {
    const saved = getStoredAIProvider(stored, provider);
    const environmentKey = providerEnvironmentKey(provider);
    return [provider, {
      configured: Boolean(environmentKey || saved?.apiKey),
      storedKeyPreview: maskSecret(saved?.apiKey),
      baseUrl: saved?.baseUrl ?? null,
      updatedAt: saved?.updatedAt ?? stored.updatedAt ?? null,
      managedByEnvironment: Boolean(environmentKey),
    }];
  }));
}

export async function GET(request: Request) {
  const authorization = await authorizeOrganizationRequest(request, PERMISSIONS.ADMIN_USERS);
  if (!authorization.ok) return authorization.response;
  try {
    const stored = normalizeStoredAISettings(readAISettings());
    const config = getAIConfig();
    const activeStored = getStoredAIProvider(stored, config.provider);
    return ok({
      configured: isAIConfigured(),
      activeProvider: config.provider,
      storedProvider: stored.activeProvider ?? null,
      storedKeyPreview: maskSecret(activeStored?.apiKey),
      baseUrl: activeStored?.baseUrl ?? null,
      updatedAt: stored.updatedAt ?? null,
      managedByEnvironment: environmentOverride(),
      providers: providerStates(),
      models: { default: config.defaultModel, fast: config.fastModel, reasoning: config.reasoningModel },
      providerModels: Object.fromEntries(PROVIDERS.map(p => [p, getStoredAIProvider(stored, p)?.models ?? AI_PROVIDER_MODELS[p]])),
    });
  } catch (error) {
    logApiError("GET /api/v1/settings/ai", error);
    return fail("AI_SETTINGS_READ_FAILED", "AI settings could not be read.");
  }
}

export async function PUT(request: Request) {
  const authorization = await authorizeOrganizationRequest(request, PERMISSIONS.ADMIN_USERS);
  if (!authorization.ok) return authorization.response;
  try {
    const body = await readJsonObject(request);
    const provider = typeof body.provider === "string" ? body.provider.trim().toLowerCase() : "";
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
    const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : "save";
    if (environmentOverride()) return fail("AI_PROVIDER_ENVIRONMENT_MANAGED", "Provider selection is managed by the server environment.", 409);

    if (!SUPPORTED_PROVIDERS.has(provider)) {
      return fail("AI_PROVIDER_INVALID", "Provider must be deepseek, gemini, or none.", 400);
    }
    if (provider === "none") {
      const cleared = clearAISettings();
      return ok({ configured: false, activeProvider: "none", updatedAt: cleared.updatedAt, providers: providerStates() });
    }

    const existing = normalizeStoredAISettings(readAISettings());
    const existingProvider = getStoredAIProvider(existing, provider);

    if (action === "activate") {
      if (!providerEnvironmentKey(provider) && !existingProvider?.apiKey) {
        return fail("AI_KEY_REQUIRED", "Connect this provider before making it active.", 400);
      }
      const saved = writeAISettings({ ...existing, activeProvider: provider });
      const config = getAIConfig();
      return ok({ configured: true, activeProvider: config.provider, updatedAt: saved.updatedAt, providers: providerStates() });
    }

    if (action === "disconnect") {
      if (providerEnvironmentKey(provider)) {
        return fail("AI_PROVIDER_ENVIRONMENT_MANAGED", "This provider is configured through the machine environment and cannot be disconnected here.", 409);
      }
      const providers = { ...(existing.providers ?? {}) };
      delete providers[provider];
      const nextActive = existing.activeProvider === provider
        ? "none"
        : existing.activeProvider ?? null;
      const saved = writeAISettings({ activeProvider: nextActive, providers });
      const config = getAIConfig();
      return ok({ configured: config.provider !== "none", activeProvider: config.provider, updatedAt: saved.updatedAt, providers: providerStates() });
    }

    if (action !== "save") return fail("AI_SETTINGS_ACTION_INVALID", "Action must be save, activate, or disconnect.", 400);

    let models = existingProvider?.models;
    if (body.models !== undefined) {
      const values = body.models as Record<string, unknown>;
      if (!values || typeof values !== "object" || !["default", "fast", "reasoning"].every(tier => typeof values[tier] === "string" && new RegExp("^" + provider + "-[a-zA-Z0-9._-]{1,100}$").test(values[tier] as string))) return fail("AI_MODELS_INVALID", "Enter supported model IDs for this provider.", 400);
      models = values as { default: string; fast: string; reasoning: string };
    }
    const effectiveKey = apiKey || existingProvider?.apiKey || "";
    if (!effectiveKey) return fail("AI_KEY_REQUIRED", "An API key is required for this provider.", 400);
    if (effectiveKey.length < 16) return fail("AI_KEY_INVALID", "That API key looks too short to be valid.", 400);

    if (baseUrl) {
      try {
        const parsed = new URL(baseUrl);
        if (parsed.protocol !== "https:") return fail("AI_BASE_URL_INVALID", "The base URL must use HTTPS.", 400);
      } catch {
        return fail("AI_BASE_URL_INVALID", "The base URL is not a valid URL.", 400);
      }
    }

    const saved = writeAISettings({
      activeProvider: provider,
      providers: {
        ...(existing.providers ?? {}),
        [provider]: {
          apiKey: effectiveKey,
          models,
          baseUrl: baseUrl || existingProvider?.baseUrl || null,
          updatedAt: new Date().toISOString(),
        },
      },
    });
    const config = getAIConfig();

    return ok({
      configured: config.provider !== "none",
      activeProvider: config.provider,
      storedProvider: saved.activeProvider ?? null,
      storedKeyPreview: maskSecret(getStoredAIProvider(saved, provider)?.apiKey),
      updatedAt: saved.updatedAt,
      managedByEnvironment: environmentOverride(),
      providers: providerStates(),
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    logApiError("PUT /api/v1/settings/ai", error);
    return fail("AI_SETTINGS_WRITE_FAILED", "AI settings could not be saved.");
  }
}

export async function POST(request: Request) {
  const authorization = await authorizeOrganizationRequest(request, PERMISSIONS.ADMIN_USERS);
  if (!authorization.ok) return authorization.response;
  try {
    const body = await readJsonObject(request, 1024);
    if (body.provider !== "deepseek" && body.provider !== "gemini") return fail("AI_PROVIDER_INVALID", "Choose DeepSeek or Gemini.", 400);
    const started = Date.now();
    const result = await testAIConnection(body.provider);
    if (!result.ok || !result.data) return fail("AI_CONNECTION_FAILED", "The provider did not return a usable response. Check the key, model access, network, and account balance.", 502);
    let valid = false;
    try { valid = JSON.parse(result.data).status === "ok"; } catch { /* Invalid provider output. */ }
    if (!valid) return fail("AI_CONNECTION_FAILED", "The provider returned an unexpected response.", 502);
    return ok({ provider: result.provider, model: result.model, latencyMs: Date.now() - started });
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    return fail("AI_CONNECTION_FAILED", "The connection could not be tested.", 502);
  }
}
