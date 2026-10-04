import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, lstat, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { PostgresRuntime, findAvailableLoopbackPort } from "./postgres-runtime.mjs";
import { readEncryptedRuntimeSecret } from "./runtime-secret-store.mjs";

// Windows scanners may briefly retain file handles after PostgreSQL has stopped.
// Retry only sharing/permission-style errors, with a bounded total wait; never delete
// a destination or suppress a persistent failure. The same rule protects rollback.
export async function renameForRecovery(from, to, { move = rename, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const delays = [50, 100, 200, 400, 800, 1600, 2000];
  for (let attempt = 0; ; attempt++) {
    try { await move(from, to); return; }
    catch (error) {
      if (!["EPERM", "EACCES", "EBUSY"].includes(error.code) || attempt >= delays.length) throw error;
      await wait(delays[attempt]);
    }
  }
}

export async function verifyUpgradeBackup(directory) {
  if ((await lstat(directory)).isSymbolicLink()) throw new Error("Recovery snapshots cannot use a linked root.");
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
  if (manifest.formatVersion !== 2 || !Array.isArray(manifest.files) || !Array.isArray(manifest.appliedMigrations)) throw new Error("Choose a Nautex recovery snapshot.");
  const seen = new Set();
  for (const file of manifest.files) {
    const name = file.path;
    if (typeof name !== "string" || seen.has(name) || !/^(database\.dump|local-runtime-secret\.bin|data\/.+)$/.test(name) || name.split(/[\\/]/).some(part => part === ".." || part === "." || part === "") || name.includes("\\") || name.includes(":")) throw new Error("Invalid recovery snapshot path.");
    seen.add(name);
    let cursor = directory;
    for (const part of name.split("/")) { cursor = path.join(cursor, part); if ((await lstat(cursor)).isSymbolicLink()) throw new Error("Recovery snapshots cannot contain linked paths."); }
    const content = await readFile(path.join(directory, name));
    if (content.length !== file.bytes || createHash("sha256").update(content).digest("hex") !== file.sha256) throw new Error(`Recovery snapshot integrity check failed: ${name}`);
  }
  if (!seen.has("database.dump") || !seen.has("local-runtime-secret.bin")) throw new Error("Recovery snapshot is incomplete.");
  return manifest;
}

export async function assertRecoverySettled(profileRoot) {
  try {
    const journal = JSON.parse(await readFile(path.join(profileRoot, "recovery-activation.json"), "utf8"));
    if (!["complete", "rolled_back"].includes(journal.status)) throw Object.assign(new Error("Interrupted recovery detected. Restore the verified snapshot again before opening this workspace. Preserved recovery folders have not been deleted."), { code: "RECOVERY_INTERRUPTED" });
  } catch (error) {
    if (error.code === "ENOENT") return;
    if (error instanceof SyntaxError) throw Object.assign(new Error("Recovery status is incomplete. Restore a verified snapshot before opening this workspace."), { code: "RECOVERY_INTERRUPTED" });
    throw error;
  }
}

// The caller must stop the managed backend and PostgreSQL before calling this.
// Restore into a fresh cluster first; current data is preserved by renaming it,
// and is never recursively deleted. Original Windows account/profile storage decrypts keys.
export async function restoreUpgradeBackup({ directory, profileRoot, postgresRoot, safeStorage }) {
  const manifest = await verifyUpgradeBackup(directory);
  const currentPid = path.join(profileRoot, "postgres", "data", "postmaster.pid");
  try { await lstat(currentPid); throw new Error("Close the current Nautex database before restoring."); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const secret = await readEncryptedRuntimeSecret({ safeStorage, filePath: path.join(directory, "local-runtime-secret.bin") });
  const token = `${Date.now()}`;
  const staging = path.join(profileRoot, `recovery-staging-${token}`);
  const preserved = path.join(profileRoot, `recovery-preserved-${token}`);
  await mkdir(staging);
  const pg = new PostgresRuntime({ runtimeRoot: postgresRoot, dataDirectory: path.join(staging, "postgres", "data"), logDirectory: path.join(staging, "logs") });
  try {
    const port = await findAvailableLoopbackPort();
    await pg.bootstrap(secret.database, port);
    await new Promise((resolve, reject) => {
      const child = spawn(pg.executable("pg_restore"), ["--exit-on-error", "--no-owner", "--dbname", secret.database.database, path.join(directory, "database.dump")], { env: { ...process.env, ...pg.connectionEnvironment(secret.database, port) }, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
      let stderr = ""; child.stderr.on("data", chunk => { stderr += chunk; });
      child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Database restore failed (${code}): ${stderr.trim()}`)));
    });
    const actual = JSON.parse(await pg.queryScalar(secret.database, port, secret.database.database, `SELECT COALESCE(json_agg(migration_name ORDER BY migration_name),'[]'::json) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`));
    if (JSON.stringify(actual) !== JSON.stringify([...manifest.appliedMigrations].sort())) throw new Error("Restored migration history does not match the snapshot.");
    // Recovery creates a copy of automation state; require explicit human resumption.
    await pg.queryScalar(secret.database, port, secret.database.database, `DO $$ BEGIN
      IF to_regclass('public.agent_schedules') IS NOT NULL THEN
        UPDATE agent_schedules SET enabled=false, revision=revision+1, lease_until=NULL, active_key=NULL, occurrence_at=NULL, attempts=0, last_error='Paused after recovery. Review inputs and resume explicitly.';
      END IF;
      IF to_regclass('public.mailbox_connections') IS NOT NULL THEN
        UPDATE mailbox_connections SET enabled=false, revision=revision+1;
      END IF;
    END $$;`);
  } finally { await pg.stop(); }
  await mkdir(path.join(staging, "data"));
  // Copy only verified manifest entries, so unlisted files cannot be restored.
  for (const file of manifest.files.filter(file => file.path.startsWith("data/"))) {
    const destination = path.join(staging, file.path);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(directory, file.path), destination, { force: false, errorOnExist: true });
  }
  await cp(path.join(directory, "local-runtime-secret.bin"), path.join(staging, "local-runtime-secret.bin"));
  await mkdir(preserved);
  await mkdir(path.join(profileRoot, "runtime"), { recursive: true });
  const moves = [
    { current: path.join(profileRoot, "postgres"), staged: path.join(staging, "postgres"), old: path.join(preserved, "postgres") },
    { current: path.join(profileRoot, "data"), staged: path.join(staging, "data"), old: path.join(preserved, "data") },
    { current: path.join(profileRoot, "runtime", "local-runtime-secret.bin"), staged: path.join(staging, "local-runtime-secret.bin"), old: path.join(preserved, "local-runtime-secret.bin") },
  ];
  const journalPath = path.join(profileRoot, "recovery-activation.json");
  try { await cp(journalPath, path.join(preserved, "previous-activation.json"), { errorOnExist: true, force: false }); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const journal = async status => writeFile(journalPath, JSON.stringify({ status, preserved, staging, sourceBackup: directory, updatedAt: new Date().toISOString() }));
  await journal("pending");
  try {
    for (const move of moves) {
      try { await renameForRecovery(move.current, move.old); move.preserved = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
      await renameForRecovery(move.staged, move.current); move.activated = true;
    }
  } catch (error) {
    for (const move of [...moves].reverse()) {
      if (move.activated) await renameForRecovery(move.current, move.staged);
      if (move.preserved) await renameForRecovery(move.old, move.current);
    }
    await journal("rolled_back");
    throw error;
  }
  await writeFile(path.join(preserved, "recovery.json"), JSON.stringify({ restoredAt: new Date().toISOString(), sourceBackup: directory, targetVersionOfOriginalUpgrade: manifest.targetVersion }, null, 2));
  await journal("complete");
  return { preserved, appliedMigrations: manifest.appliedMigrations };
}
