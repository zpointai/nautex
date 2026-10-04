import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

function run(executable, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env: { ...process.env, ...env }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stdout.resume();
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Recovery snapshot failed (${path.basename(executable)}, exit ${code}): ${stderr.trim()}`)));
  });
}

async function filesUnder(root, relative = "") {
  const result = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Recovery snapshot cannot follow linked files or directories.");
    if (entry.isDirectory()) result.push(...await filesUnder(root, name));
    else if (entry.isFile()) result.push(name);
  }
  return result;
}

export async function inspectPendingMigrations({ postgres, credentials, port, migrationsRoot }) {
  const exists = await postgres.queryScalar(credentials, port, credentials.database, "SELECT to_regclass('public._prisma_migrations') IS NOT NULL");
  if (exists !== "t") return { pending: true, applied: [] };
  const rows = JSON.parse(await postgres.queryScalar(credentials, port, credentials.database,
    `SELECT COALESCE(json_agg(row_to_json(m)), '[]'::json) FROM (SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations) m`));
  const names = (await readdir(migrationsRoot, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name);
  const applied = rows.filter(row => row.finished_at && !row.rolled_back_at);
  if (rows.some(row => !row.finished_at && !row.rolled_back_at)) throw new Error("An earlier database migration is incomplete. Restore or repair it before upgrading Nautex.");
  for (const row of applied) {
    if (!names.includes(row.migration_name)) throw new Error("This database contains a newer or unknown migration. Nautex will not downgrade it.");
    const hash = createHash("sha256").update(await readFile(path.join(migrationsRoot, row.migration_name, "migration.sql"))).digest("hex");
    if (hash !== row.checksum) throw new Error(`The installed database migration differs from this release: ${row.migration_name}. Upgrade stopped before changes.`);
  }
  return { pending: names.some(name => !applied.some(row => row.migration_name === name)), applied: applied.map(row => row.migration_name) };
}

export async function createUpgradeBackup({ postgres, credentials, port, profileRoot, targetVersion, appliedMigrations, manual = false }) {
  const directory = path.join(profileRoot, "backups", `${manual ? "manual" : "pre-upgrade"}-${Date.now()}`);
  await mkdir(path.dirname(directory), { recursive: true });
  await mkdir(directory);
  const env = postgres.connectionEnvironment(credentials, port);
  const dump = path.join(directory, "database.dump");
  await run(postgres.executable("pg_dump"), ["--format=custom", "--file", dump, "--dbname", credentials.database], env);
  await run(postgres.executable("pg_restore"), ["--list", dump], env);
  const dataRoot = path.join(profileRoot, "data");
  try {
    if ((await lstat(dataRoot)).isSymbolicLink()) throw new Error("Linked data directories cannot be snapshotted automatically.");
    await filesUnder(dataRoot); // Check links before copying anything outside the database.
    await cp(dataRoot, path.join(directory, "data"), { recursive: true, errorOnExist: true, force: false });
  } catch (error) { if (error.code !== "ENOENT") throw error; else await mkdir(path.join(directory, "data")); }
  await cp(path.join(profileRoot, "runtime", "local-runtime-secret.bin"), path.join(directory, "local-runtime-secret.bin"), { errorOnExist: true, force: false });
  const files = [];
  for (const name of await filesUnder(directory)) {
    const content = await readFile(path.join(directory, name));
    files.push({ path: name.replaceAll(path.sep, "/"), bytes: content.length, sha256: createHash("sha256").update(content).digest("hex") });
  }
  await writeFile(path.join(directory, "manifest.json"), `${JSON.stringify({ formatVersion: 2, purpose: manual ? "manual recovery" : "pre-migration recovery", createdAt: new Date().toISOString(), targetVersion, appliedMigrations, requiresOriginalWindowsAccount: true, requiresOriginalNautexProfile: true, files }, null, 2)}\n`, { flag: "wx" });
  return directory;
}
