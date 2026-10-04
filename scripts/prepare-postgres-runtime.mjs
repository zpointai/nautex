import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const POSTGRES_VERSION = "16.14-2";
const ARCHIVE_NAME = `postgresql-${POSTGRES_VERSION}-windows-x64-binaries.zip`;
const SOURCE_URL = `https://get.enterprisedb.com/postgresql/${ARCHIVE_NAME}`;
const EXPECTED_SHA256 = "8A7F54C1968D5D49BDCD3F66B1291F736C74B8CB6A26E9874771FCC7837DBF38";
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const archivePath = path.resolve(process.env.NAUTEX_POSTGRES_ARCHIVE || path.join(projectRoot, ".desktop-vendor", ARCHIVE_NAME));
const extractRoot = path.join(projectRoot, ".desktop-build", "postgresql-extract");
const outputRoot = path.join(projectRoot, ".desktop-build", "postgresql");
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

for (const executable of ["postgres.exe", "initdb.exe", "pg_ctl.exe", "createdb.exe", "psql.exe", "pg_dump.exe", "pg_restore.exe"]) {
  await stat(path.join(outputRoot, "bin", executable));
}

const manifest = {
  formatVersion: 1,
  postgresVersion: POSTGRES_VERSION,
  platform: "win32-x64",
  sourceUrl: SOURCE_URL,
  archiveSha256: EXPECTED_SHA256,
  excludedComponents: ["pgAdmin 4", "StackBuilder"],
};
await writeFile(path.join(outputRoot, "nautex-postgres-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await rm(extractRoot, { recursive: true, force: true });

const license = await readFile(path.join(outputRoot, "server_license.txt"), "utf8");
if (!license.trim()) throw new Error("PostgreSQL server license is empty.");
console.log(`Prepared PostgreSQL ${POSTGRES_VERSION} runtime at ${path.relative(projectRoot, outputRoot)}.`);
