import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import {
  findAvailableLoopbackPort,
  generatePostgresCredentials,
  PostgresRuntime,
  postgresConnectionUrl,
} from "../desktop/postgres-runtime.mjs";
import {
  readEncryptedRuntimeSecret,
  writeEncryptedRuntimeSecret,
} from "../desktop/runtime-secret-store.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const testRoot = path.join(projectRoot, ".desktop-build", `postgres-test-${process.pid}`);
const runtime = new PostgresRuntime({
  runtimeRoot: process.env.NAUTEX_POSTGRES_RUNTIME || path.join(projectRoot, ".desktop-build", "postgresql"),
  dataDirectory: path.join(testRoot, "data"),
  logDirectory: path.join(testRoot, "logs"),
});
const credentials = generatePostgresCredentials();
const port = await findAvailableLoopbackPort();

assert.match(credentials.password, /^[A-Za-z0-9_-]{40,}$/);
assert.match(postgresConnectionUrl({ ...credentials, port }), /^postgresql:\/\/nautex_runtime:/);

const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value, "utf8").reverse(),
  decryptString: (value) => Buffer.from(value).reverse().toString("utf8"),
};
const secretPath = path.join(testRoot, "runtime-secret.bin");
await writeEncryptedRuntimeSecret({ safeStorage: fakeSafeStorage, filePath: secretPath, value: credentials });
assert.deepEqual(await readEncryptedRuntimeSecret({ safeStorage: fakeSafeStorage, filePath: secretPath }), credentials);

try {
  const result = await runtime.bootstrap(credentials, port);
  assert.equal(result.initialized, true);
  assert.equal(result.databaseCreated, true);
  assert.equal(await runtime.queryScalar(credentials, port, credentials.database, "SELECT current_database()"), "nautex");
  assert.equal(await runtime.ensureDatabase(credentials, port), false);
  const racedCredentials = { ...credentials, database: "concurrent_creation" };
  const concurrent = await Promise.all([
    runtime.ensureDatabase(racedCredentials, port),
    runtime.ensureDatabase(racedCredentials, port),
  ]);
  assert.equal(concurrent.filter(Boolean).length, 1, "Exactly one concurrent request creates the database");
  assert.equal(await runtime.queryScalar(credentials, port, racedCredentials.database, "SELECT current_database()"), "concurrent_creation");
  const restricted = { username: "restricted_test", database: "creation_must_fail", password: "Synthetic-Restricted-Database-Test-2026" };
  await runtime.queryScalar(credentials, port, credentials.database, `CREATE ROLE ${restricted.username} LOGIN PASSWORD '${restricted.password}'`);
  await assert.rejects(runtime.ensureDatabase(restricted, port), /createdb.exe failed/, "A creation error must remain fatal if the database does not exist");
  await runtime.queryScalar(credentials, port, credentials.database, "CREATE TABLE restart_evidence (value text); INSERT INTO restart_evidence VALUES ('synthetic preserved record')");
  await runtime.stop();
  const ensureDatabase = runtime.ensureDatabase;
  runtime.ensureDatabase = async () => { throw new Error("Injected database setup failure"); };
  await assert.rejects(runtime.bootstrap(credentials, port), /Injected database setup failure/);
  const listening = await new Promise(resolve => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  });
  assert.equal(listening, false, "Failed bootstrap must stop its PostgreSQL server");
  runtime.ensureDatabase = ensureDatabase;
  const reopened = await runtime.bootstrap(credentials, port);
  assert.equal(reopened.initialized, false);
  assert.equal(reopened.databaseCreated, false);
  assert.equal(await runtime.queryScalar(credentials, port, credentials.database, "SELECT value FROM restart_evidence"), "synthetic preserved record");
} finally {
  await runtime.stop().catch(() => undefined);
  const allowedRoot = path.resolve(projectRoot, ".desktop-build") + path.sep;
  assert.ok(path.resolve(testRoot).startsWith(allowedRoot), "Test cleanup must remain inside .desktop-build");
  await rm(testRoot, { recursive: true, force: true });
}

console.log("Embedded PostgreSQL runtime tests passed: fresh/existing database, concurrent creation, creation permission failure, stopped failed bootstrap and preserved-record restart.");
