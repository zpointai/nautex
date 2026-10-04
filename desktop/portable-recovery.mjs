import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { readEncryptedRuntimeSecret, writeEncryptedRuntimeSecret } from "./runtime-secret-store.mjs";
import { verifyUpgradeBackup } from "./restore-upgrade-backup.mjs";

const derive = promisify(scrypt);
const FORMAT = "nautex-portable-recovery";
const aad = name => Buffer.from(`${FORMAT}:1:${name}`);
function bytes(value, length) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error("Invalid recovery metadata.");
  const result = Buffer.from(value, "base64");
  if (result.length !== length || result.toString("base64") !== value) throw new Error("Invalid recovery metadata.");
  return result;
}
async function keyFor(password, salt) {
  if (typeof password !== "string" || password.length < 16 || password.length > 256) throw new Error("Use a recovery password of 16–256 characters. Keep it separately from the backup.");
  return derive(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}
async function plainFile(file, maximum = Infinity) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximum) throw new Error("Invalid or oversized recovery file.");
}
async function plainDirectory(directory) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Linked recovery directories are not supported.");
}
function cipherFor(key, name) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(name));
  return { cipher, iv: iv.toString("base64") };
}
function decipherFor(key, name, metadata) {
  const decipher = createDecipheriv("aes-256-gcm", key, bytes(metadata.iv, 12));
  decipher.setAAD(aad(name)); decipher.setAuthTag(bytes(metadata.tag, 16));
  return decipher;
}

// The source is a verified, quiesced local snapshot. Only ciphertext leaves it.
export async function exportPortableRecovery({ directory, destination, password, safeStorage }) {
  await plainDirectory(directory);
  const manifest = await verifyUpgradeBackup(directory);
  const relative = path.relative(path.resolve(directory), path.resolve(destination));
  if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) throw new Error("Choose a destination outside the source snapshot.");
  const salt = randomBytes(16), key = await keyFor(password, salt);
  let created = false;
  try {
    await mkdir(destination); created = true; // Never overwrite an existing backup.
    const entries = [];
    for (const [index, file] of manifest.files.entries()) {
      const id = `${index}.bin`, source = path.join(directory, file.path);
      await plainFile(source);
      const encrypted = cipherFor(key, id);
      let secret;
      try {
        if (file.path === "local-runtime-secret.bin") secret = Buffer.from(JSON.stringify(await readEncryptedRuntimeSecret({ safeStorage, filePath: source })));
        await pipeline(secret ? Readable.from([secret]) : createReadStream(source), encrypted.cipher, createWriteStream(path.join(destination, id), { flags: "wx", mode: 0o600 }));
        entries.push({ ...file, ...(secret ? { bytes: secret.length, sha256: createHash("sha256").update(secret).digest("hex") } : {}), id, iv: encrypted.iv, tag: encrypted.cipher.getAuthTag().toString("base64") });
      } finally { secret?.fill(0); }
    }
    const encrypted = cipherFor(key, "manifest");
    const payload = Buffer.from(JSON.stringify({ ...manifest, files: entries }));
    const content = Buffer.concat([encrypted.cipher.update(payload), encrypted.cipher.final()]);
    payload.fill(0);
    await writeFile(path.join(destination, "portable.json"), JSON.stringify({ format: FORMAT, version: 1, kdf: "scrypt-32768-8-1", salt: salt.toString("base64"), iv: encrypted.iv, tag: encrypted.cipher.getAuthTag().toString("base64"), data: content.toString("base64") }), { flag: "wx", mode: 0o600 });
    return destination;
  } catch (error) {
    // Only this invocation's newly created destination may be removed.
    if (created) await rm(destination, { recursive: true, force: true });
    throw error;
  } finally { key.fill(0); }
}

// Authenticate every entry before returning a local snapshot; active data is never touched.
export async function importPortableRecovery({ directory, profileRoot, password, safeStorage }) {
  await plainDirectory(directory); await plainDirectory(profileRoot);
  await plainFile(path.join(directory, "portable.json"), 16 * 1024 * 1024);
  const header = JSON.parse(await readFile(path.join(directory, "portable.json"), "utf8"));
  if (header.format !== FORMAT || header.version !== 1 || header.kdf !== "scrypt-32768-8-1" || typeof header.data !== "string") throw new Error("Choose a supported Nautex portable recovery copy.");
  const key = await keyFor(password, bytes(header.salt, 16));
  let imported;
  try {
    let manifest;
    try {
      const decipher = decipherFor(key, "manifest", header);
      manifest = JSON.parse(Buffer.concat([decipher.update(Buffer.from(header.data, "base64")), decipher.final()]).toString("utf8"));
    } catch { throw new Error("The recovery password is incorrect or the backup is damaged."); }
    if (manifest.formatVersion !== 2 || !Array.isArray(manifest.files) || manifest.files.length > 100000 || !Array.isArray(manifest.appliedMigrations)) throw new Error("Invalid portable recovery manifest.");
    const seen = new Set();
    for (const [index, file] of manifest.files.entries()) {
      if (typeof file.path !== "string" || !/^(database\.dump|local-runtime-secret\.bin|data\/.+)$/.test(file.path) || file.path.split("/").some(part => !part || part === "." || part === "..") || /[\\:]/.test(file.path) || seen.has(file.path) || file.id !== `${index}.bin` || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("Invalid portable recovery entry.");
      seen.add(file.path);
      await plainFile(path.join(directory, file.id));
      bytes(file.iv, 12); bytes(file.tag, 16);
    }
    if (!seen.has("database.dump") || !seen.has("local-runtime-secret.bin")) throw new Error("Portable recovery copy is incomplete.");
    const parent = path.join(profileRoot, "backups");
    await mkdir(parent, { recursive: true }); await plainDirectory(parent);
    imported = path.join(parent, `portable-import-${Date.now()}-${randomBytes(6).toString("hex")}`);
    await mkdir(imported);
    const localFiles = [];
    for (const file of manifest.files) {
      const destination = path.join(imported, file.path);
      const decipher = decipherFor(key, file.id, file);
      await mkdir(path.dirname(destination), { recursive: true });
      if (file.path === "local-runtime-secret.bin") {
        await plainFile(path.join(directory, file.id), 1024 * 1024);
        const secret = Buffer.concat([decipher.update(await readFile(path.join(directory, file.id))), decipher.final()]);
        try {
          if (secret.length !== file.bytes || createHash("sha256").update(secret).digest("hex") !== file.sha256) throw new Error("Recovery credential integrity check failed.");
          const value = JSON.parse(secret.toString("utf8"));
          if (!value.database || typeof value.database.database !== "string" || typeof value.database.password !== "string") throw new Error("Invalid recovery credentials.");
          await writeEncryptedRuntimeSecret({ safeStorage, filePath: destination, value });
          const localSecret = await readFile(destination);
          localFiles.push({ path: file.path, bytes: localSecret.length, sha256: createHash("sha256").update(localSecret).digest("hex") });
        } finally { secret.fill(0); }
      } else {
        const hash = createHash("sha256"); let size = 0;
        const verify = new Transform({ transform(chunk, _encoding, callback) { size += chunk.length; hash.update(chunk); callback(size > file.bytes ? new Error("Recovery size mismatch.") : null, chunk); } });
        await pipeline(createReadStream(path.join(directory, file.id)), decipher, verify, createWriteStream(destination, { flags: "wx", mode: 0o600 }));
        if (size !== file.bytes || hash.digest("hex") !== file.sha256) throw new Error("Recovery file integrity check failed.");
        localFiles.push({ path: file.path, bytes: file.bytes, sha256: file.sha256 });
      }
    }
    await writeFile(path.join(imported, "manifest.json"), JSON.stringify({ ...manifest, purpose: "imported portable recovery", requiresOriginalWindowsAccount: true, requiresOriginalNautexProfile: true, files: localFiles }), { flag: "wx" });
    await verifyUpgradeBackup(imported);
    return imported;
  } catch (error) {
    if (imported) await rm(imported, { recursive: true, force: true });
    throw error;
  } finally { key.fill(0); }
}
