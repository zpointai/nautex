/**
 * Runtime AI provider settings.
 *
 * The packaged desktop application never receives the project's .env file, so
 * AI keys supplied at development time are absent there and every AI feature
 * falls back to stub mode. This store lets an administrator supply the key from
 * inside the application instead.
 *
 * Design constraints that shaped this:
 *
 *  - `getAIConfig()` and `isAIConfigured()` are synchronous and called from a
 *    dozen routes, so the settings must be readable without awaiting. That
 *    rules out a database lookup and makes a small local file the natural fit.
 *  - The value is a live credential, so it is encrypted at rest rather than
 *    stored as plain JSON. The file is also requested owner-only, though on
 *    Windows that mode is not enforced; there the protection is the encryption
 *    plus the per-user ACL on the application data directory.
 *  - Environment variables keep precedence, so an existing .env or a deployment
 *    that injects configuration is never silently overridden by stored state.
 *
 * The encryption key is derived from BETTER_AUTH_SECRET, which on the desktop
 * build is generated per machine and held in the DPAPI-backed secret store.
 * This protects the key at rest; it is not a defence against an attacker who
 * already has both the file and the application's own secret.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getNautexDataRoot } from "@/lib/storage/local-object-storage";

export interface StoredAIProviderSettings {
  models?: { default: string; fast: string; reasoning: string };
  apiKey?: string | null;
  baseUrl?: string | null;
  updatedAt?: string;
}

export interface StoredAISettings {
  activeProvider?: string | null;
  providers?: Record<string, StoredAIProviderSettings>;
  // Legacy single-provider fields are read during the in-place migration.
  provider?: string | null;
  apiKey?: string | null;
  baseUrl?: string | null;
  updatedAt?: string;
}

const FILE_NAME = "ai-settings.enc";
const SCRYPT_SALT = "nautex-ai-settings-v1";
const ALGORITHM = "aes-256-gcm";

function settingsPath() {
  return path.join(getNautexDataRoot(), FILE_NAME);
}

function encryptionKey() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("A secure workspace secret is required before storing API keys.");
  return scryptSync(secret, SCRYPT_SALT, 32);
}

/* Cached so the synchronous config path does not hit the filesystem on every
   request. Invalidated by mtime, so an external edit is still picked up. */
let cache: { filePath: string; secretHash: string; mtimeMs: number; value: StoredAISettings } | null = null;

export function normalizeStoredAISettings(settings: StoredAISettings): StoredAISettings {
  const providers = { ...(settings.providers ?? {}) };
  const legacyProvider = settings.provider?.trim().toLowerCase();
  if (legacyProvider && legacyProvider !== "none" && settings.apiKey && !providers[legacyProvider]?.apiKey) {
    providers[legacyProvider] = {
      apiKey: settings.apiKey,
      baseUrl: settings.baseUrl ?? null,
      updatedAt: settings.updatedAt,
    };
  }
  return {
    activeProvider: settings.activeProvider ?? settings.provider ?? null,
    providers,
    updatedAt: settings.updatedAt,
  };
}

export function getStoredAIProvider(settings: StoredAISettings, provider: string) {
  return normalizeStoredAISettings(settings).providers?.[provider] ?? null;
}

export function readAISettings(): StoredAISettings {
  let filePath: string;
  try {
    filePath = settingsPath();
  } catch {
    return {}; // NAUTEX_DATA_DIR not configured (e.g. plain `next dev`).
  }

  try {
    if (!existsSync(/* turbopackIgnore: true */ filePath)) {
      cache = null;
      return {};
    }
    const { mtimeMs } = statSync(/* turbopackIgnore: true */ filePath);
    const secretHash = createHash("sha256").update(process.env.BETTER_AUTH_SECRET || "development").digest("hex");
    if (cache && cache.filePath === filePath && cache.secretHash === secretHash && cache.mtimeMs === mtimeMs) return cache.value;

    const payload = readFileSync(/* turbopackIgnore: true */ filePath);
    // layout: [12-byte iv][16-byte auth tag][ciphertext]
    const iv = payload.subarray(0, 12);
    const tag = payload.subarray(12, 28);
    const ciphertext = payload.subarray(28);
    const decipher = createDecipheriv(ALGORITHM, encryptionKey(), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const value = normalizeStoredAISettings(JSON.parse(plaintext) as StoredAISettings);
    cache = { filePath, secretHash, mtimeMs, value };
    return value;
  } catch {
    // A corrupt or undecryptable file must not take the application down; the
    // effect is simply that AI stays unconfigured until it is set again.
    cache = null;
    return {};
  }
}

export function writeAISettings(settings: StoredAISettings) {
  const filePath = settingsPath();
  mkdirSync(path.dirname(filePath), { recursive: true });

  const body: StoredAISettings = { ...normalizeStoredAISettings(settings), updatedAt: new Date().toISOString() };
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(body), "utf8"), cipher.final()]);
  const payload = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);

  // Write to a sibling file first so a crash cannot leave a truncated secret.
  const temporaryPath = `${filePath}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(temporaryPath, payload, { mode: 0o600 });
  renameSync(temporaryPath, filePath);
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // Not all filesystems honour mode changes; the initial write already set it.
  }
  cache = null;
  return body;
}

export function clearAISettings() {
  return writeAISettings({ activeProvider: "none", providers: {} });
}

/** Never return the stored key itself — only enough to confirm which one it is. */
export function maskSecret(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length <= 8) return "•".repeat(trimmed.length);
  return `${trimmed.slice(0, 4)}${"•".repeat(Math.max(4, trimmed.length - 8))}${trimmed.slice(-4)}`;
}
