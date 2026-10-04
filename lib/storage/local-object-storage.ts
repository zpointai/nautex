import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type LocalDeleteResult =
  | { disposition: "deleted" }
  | { disposition: "retained"; archiveKey: string };

function defaultDataRoot() {
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Nautex");
  }
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Nautex");
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "nautex");
}

export function getNautexDataRoot() {
  const configured = process.env.NAUTEX_DATA_DIR?.trim();
  if (!configured) return path.resolve(defaultDataRoot());
  if (!path.isAbsolute(configured)) throw new Error("NAUTEX_DATA_DIR must be an absolute path.");
  return path.resolve(configured);
}

export function getLocalStorageRoot() {
  const configured = process.env.LOCAL_STORAGE_DIR?.trim();
  if (!configured) return path.join(getNautexDataRoot(), "storage");
  return path.isAbsolute(configured)
    ? path.resolve(configured)
    : path.resolve(getNautexDataRoot(), configured);
}

export function getBackupRoot() {
  const configured = process.env.NAUTEX_BACKUP_DIR?.trim();
  if (!configured) return path.join(getNautexDataRoot(), "backups");
  if (!path.isAbsolute(configured)) throw new Error("NAUTEX_BACKUP_DIR must be an absolute path.");
  return path.resolve(configured);
}

export function sanitizeFileName(name: string) {
  const base = path.basename(name || "document");
  const safe = base.replace(/[^a-zA-Z0-9._ -]/g, "_").replace(/\s+/g, " ").trim();
  return safe.slice(0, 160) || "document";
}

export function normalizeStorageKey(storageKey: string) {
  if (!storageKey || storageKey.includes("\0")) throw new Error("Storage key is required.");
  const normalized = storageKey.replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalized.split("/");
  if (!normalized || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Invalid storage key.");
  }
  return segments.join("/");
}

export function resolveLocalStorageKey(storageKey: string) {
  const root = path.resolve(getLocalStorageRoot());
  const resolved = path.resolve(root, normalizeStorageKey(storageKey));
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("Invalid local storage key.");
  return resolved;
}

export async function putLocalObject(storageKey: string, data: Buffer) {
  const target = resolveLocalStorageKey(storageKey);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data, { flag: "wx" });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function getLocalObject(storageKey: string) {
  return readFile(resolveLocalStorageKey(storageKey));
}

export async function deleteLocalObject(storageKey: string, options: { permanent?: boolean } = {}): Promise<LocalDeleteResult> {
  const source = resolveLocalStorageKey(storageKey);
  if (options.permanent || process.env.NAUTEX_STORAGE_DELETE_MODE?.trim().toLowerCase() === "permanent") {
    await rm(source, { force: true });
    return { disposition: "deleted" };
  }

  const date = new Date().toISOString().slice(0, 10);
  const archiveKey = `.trash/${date}/${randomUUID()}-${sanitizeFileName(path.basename(storageKey))}`;
  const target = resolveLocalStorageKey(archiveKey);
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await rename(source, target);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code !== "ENOENT") throw error;
  }
  return { disposition: "retained", archiveKey };
}
