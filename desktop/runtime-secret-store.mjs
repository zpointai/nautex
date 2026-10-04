import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export async function writeEncryptedRuntimeSecret({ safeStorage, filePath, value }) {
  if (!safeStorage?.isEncryptionAvailable?.()) throw new Error("Windows secure storage is unavailable.");
  const encrypted = await safeStorage.encryptString(JSON.stringify(value));
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, encrypted, { mode: 0o600 });
  await rename(temporaryPath, filePath);
}

export async function readEncryptedRuntimeSecret({ safeStorage, filePath }) {
  if (!safeStorage?.isEncryptionAvailable?.()) throw new Error("Windows secure storage is unavailable.");
  const encrypted = await readFile(filePath);
  return JSON.parse(await safeStorage.decryptString(encrypted));
}
