import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectPE } from "./pe-inspect.mjs";

const POSTGRES_VERSION = "16.14-2";
const ARCHIVE_NAME = `postgresql-${POSTGRES_VERSION}-windows-x64-binaries.zip`;
const SOURCE_URL = `https://get.enterprisedb.com/postgresql/${ARCHIVE_NAME}`;
const EXPECTED_SHA256 = "8A7F54C1968D5D49BDCD3F66B1291F736C74B8CB6A26E9874771FCC7837DBF38";
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const archivePath = path.resolve(process.env.NAUTEX_POSTGRES_ARCHIVE || path.join(projectRoot, ".desktop-vendor", ARCHIVE_NAME));
const extractRoot = path.join(projectRoot, ".desktop-build", "postgresql-extract");
const outputRoot = path.join(projectRoot, ".desktop-build", "postgresql");
const gnuRoot = process.env.NAUTEX_GNU_RUNTIME;
const replacementNames = ["libiconv-2.dll", "libintl-9.dll"];
if (!gnuRoot || !path.isAbsolute(gnuRoot)) {
  throw new Error("Set NAUTEX_GNU_RUNTIME to the absolute bin directory produced by scripts/build-gnu-runtime.sh. See docs/GNU_RUNTIME_BUILD.md.");
}
for (const target of [extractRoot, outputRoot]) {
  if (path.dirname(path.resolve(target)) !== path.resolve(projectRoot, '.desktop-build')) throw new Error('Unsafe PostgreSQL staging path');
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return hash.digest("hex").toUpperCase();
}

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: projectRoot, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}.`)));
  });
}

try {
  await stat(archivePath);
} catch {
  throw new Error(`PostgreSQL archive is missing at ${archivePath}. Download it from ${SOURCE_URL}.`);
}

const actualSha256 = await sha256(archivePath);
if (actualSha256 !== EXPECTED_SHA256) {
  throw new Error(`PostgreSQL archive checksum mismatch. Expected ${EXPECTED_SHA256}, received ${actualSha256}.`);
}

// Verify the source-built replacement inputs before replacing staging files.
// The final release inventory separately pins the actual distributed hashes.
const replacementChecksums = await readFile(path.join(gnuRoot, "SHA256SUMS.txt"), "utf8");
const replacementHashes = {};
for (const name of replacementNames) {
  const checksumLine = replacementChecksums.split(/\r?\n/).find(line => line.trim().endsWith(` ${name}`) || line.trim().endsWith(` *${name}`));
  const expected = checksumLine?.match(/^([a-fA-F0-9]{64})\s+/)?.[1]?.toUpperCase();
  const actual = await sha256(path.join(gnuRoot, name));
  if (!expected || expected !== actual) throw new Error(`Source-built GNU checksum mismatch: ${name}`);
  const pe = inspectPE(path.join(gnuRoot, name));
  const allowed = new Set(["kernel32.dll", "advapi32.dll", "msvcrt.dll", "libiconv-2.dll"]);
  if (pe?.machine !== "8664" || pe.imports.some(dll => !allowed.has(dll.toLowerCase()))) throw new Error(`Unexpected GNU architecture or dependency: ${name}`);
  replacementHashes[name] = actual;
}

await rm(extractRoot, { recursive: true, force: true });
await rm(outputRoot, { recursive: true, force: true });
await mkdir(extractRoot, { recursive: true });
await run("tar", [
  "-xf", archivePath,
  "-C", extractRoot,
  "pgsql/bin",
  "pgsql/lib",
  "pgsql/share",
  "pgsql/server_license.txt",
  "pgsql/commandlinetools_3rd_party_licenses.txt",
]);

const extracted = path.join(extractRoot, "pgsql");
await mkdir(outputRoot, { recursive: true });
for (const directory of ["bin", "lib", "share"]) {
  await cp(path.join(extracted, directory), path.join(outputRoot, directory), { recursive: true });
}
for (const file of ["server_license.txt", "commandlinetools_3rd_party_licenses.txt"]) {
  await cp(path.join(extracted, file), path.join(outputRoot, file));
}

// The EDB command-line archive places the optional StackBuilder launcher and
// its GUI runtime beside the PostgreSQL server binaries. They are not needed
// by Nautex and would otherwise add an unrelated executable to the installer.
for (const file of [
  "stackbuilder.exe",
  "wxbase32u_net_vc14x_x64.dll",
  "wxbase32u_vc14x_x64.dll",
  "wxmsw32u_core_vc14x_x64.dll",
  "wxmsw32u_html_vc14x_x64.dll",
]) {
  await rm(path.join(outputRoot, "bin", file), { force: true });
}
// Current EDB archives use versioned wxWidgets filenames. No PostgreSQL server,
// client or extension imports them; they belong to the excluded StackBuilder GUI.
for (const file of await readdir(path.join(outputRoot, 'bin'))) {
  if (/^wx(?:base|msw).*\.dll$/i.test(file)) await rm(path.join(outputRoot, 'bin', file));
}

for (const name of replacementNames) await cp(path.join(gnuRoot, name), path.join(outputRoot, "bin", name));
// These optional EDB additions are not used by Nautex. The rebuilt gettext
// uses native Windows threading, so its old winpthreads DLL is also unnecessary.
for (const relative of ["bin/libwinpthread-1.dll", "lib/plugin_debugger.dll", "lib/system_stats.dll"]) {
  await rm(path.join(outputRoot, relative), { force: true });
}
for (const name of await readdir(path.join(outputRoot, "share", "extension"))) {
  if (/^(pldbgapi|system_stats)(?:--|\.)/.test(name)) await rm(path.join(outputRoot, "share", "extension", name));
}
for (const directory of ["bin", "lib"]) for (const name of await readdir(path.join(outputRoot, directory))) {
  if (!/\.(dll|exe)$/i.test(name)) continue;
  const pe = inspectPE(path.join(outputRoot, directory, name));
  if (pe?.imports.some(dll => /^(libwinpthread-1|plugin_debugger|system_stats)\.dll$/i.test(dll))) throw new Error(`Retained PostgreSQL binary imports an excluded component: ${name}`);
}

for (const executable of ["postgres.exe", "initdb.exe", "pg_ctl.exe", "createdb.exe", "psql.exe", "pg_dump.exe", "pg_restore.exe"]) {
  await stat(path.join(outputRoot, "bin", executable));
}

const manifest = {
  formatVersion: 1,
  postgresVersion: POSTGRES_VERSION,
  platform: "win32-x64",
  sourceUrl: SOURCE_URL,
  archiveSha256: EXPECTED_SHA256,
  excludedComponents: ["pgAdmin 4", "StackBuilder", "winpthreads", "plugin_debugger", "system_stats"],
  gnuReplacements: { libiconv: "1.15", gettext: "0.19.8", threads: "windows", sha256: replacementHashes, recipe: "scripts/build-gnu-runtime.sh" },
};
await writeFile(path.join(outputRoot, "nautex-postgres-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await rm(extractRoot, { recursive: true, force: true });

const license = await readFile(path.join(outputRoot, "server_license.txt"), "utf8");
if (!license.trim()) throw new Error("PostgreSQL server license is empty.");
console.log(`Prepared PostgreSQL ${POSTGRES_VERSION} runtime at ${path.relative(projectRoot, outputRoot)}.`);
