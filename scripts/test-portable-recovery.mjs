import assert from "node:assert/strict";
import { appendFile, cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createTestWorkspace } from "./test-workspace.mjs";
import { startManagedLocalRuntime } from "../desktop/local-runtime.mjs";
import { exportPortableRecovery, importPortableRecovery } from "../desktop/portable-recovery.mjs";
import { restoreUpgradeBackup, verifyUpgradeBackup, assertRecoverySettled } from "../desktop/restore-upgrade-backup.mjs";
import { readEncryptedRuntimeSecret } from "../desktop/runtime-secret-store.mjs";
import { PrismaClient } from "@prisma/client";
import { postgresConnectionUrl } from "../desktop/postgres-runtime.mjs";

const root = await createTestWorkspace("portable-recovery");
const resources = path.resolve(process.env.NAUTEX_RELEASE_RESOURCES || ".desktop-build");
const identity = name => ({ isEncryptionAvailable: () => true, encryptString: text => Buffer.from(`${name}:${Buffer.from(text).toString("base64")}`), decryptString: data => { const text = data.toString(); if (!text.startsWith(`${name}:`)) throw new Error("Wrong secure-storage identity"); return Buffer.from(text.slice(name.length + 1), "base64").toString(); } });
const sourceStorage = identity("synthetic-original-profile"), targetStorage = identity("synthetic-replacement-profile");
const source = path.join(root, "source"), target = path.join(root, "replacement"), portable = path.join(root, "encrypted-copy");
const password = "Synthetic separate recovery password 2026";
const options = (profile, safeStorage) => ({ resourcesRoot: resources, userDataRoot: profile, safeStorage, nodeExecutable: process.execPath, environment: { AI_PROVIDER: "none", DEEPSEEK_API_KEY: "", GEMINI_API_KEY: "" } });
const checks = []; let runtime, db;
async function connect(profile, safeStorage) {
  const secret = await readEncryptedRuntimeSecret({ safeStorage, filePath: path.join(profile, "runtime/local-runtime-secret.bin") });
  const port = Number((await readFile(path.join(profile, "postgres/data/postmaster.pid"), "utf8")).split(/\r?\n/)[3]);
  return new PrismaClient({ datasourceUrl: postgresConnectionUrl({ ...secret.database, port }) });
}
try {
  runtime = await startManagedLocalRuntime(options(source, sourceStorage));
  const user = { companyName: "Portable recovery synthetic", name: "Recovery Administrator", email: "recovery@example.test", password: "Synthetic-Login-Password-2026" };
  const request = async (route, body) => {
    const response = await fetch(`${runtime.backendOrigin}${route}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: runtime.backendOrigin }, body: JSON.stringify(body) });
    assert(response.ok, await response.text());
  };
  await request("/api/v1/auth/bootstrap", user);
  db = await connect(source, sourceStorage);
  const organization = await db.organization.findFirstOrThrow(), owner = await db.user.findFirstOrThrow();
  await db.agentSchedule.create({ data: { organizationId: organization.id, agentId: "classification", action: "normalize_description", params: { description: "Synthetic test" }, intervalMinutes: 60, maxDailyRuns: 1, requestKey: "synthetic-recovery-schedule", createdBy: owner.id, nextRunAt: new Date(Date.now() + 86400000) } });
  await db.mailboxConnection.create({ data: { organizationId: organization.id, clientId: "synthetic", tenantId: "organizations", enabled: true, createdBy: owner.id } });
  await db.$disconnect(); db = null;
  await mkdir(path.join(source, "data/objects"), { recursive: true });
  const document = Buffer.alloc(1024 * 1024, "Synthetic vessel delivery evidence");
  await writeFile(path.join(source, "data/objects/recovery.txt"), document);
  const snapshot = await runtime.backupAndStop(); runtime = null;
  await exportPortableRecovery({ directory: snapshot, destination: portable, password, safeStorage: sourceStorage });
  assert((await readFile(path.join(portable, "portable.json"), "utf8")).includes('"format":"nautex-portable-recovery"'));
  for (const file of await readdir(portable)) {
    const text = (await readFile(path.join(portable, file))).toString();
    assert(!text.includes(user.email) && !text.includes("Synthetic vessel delivery") && !text.includes(password));
  }
  await assert.rejects(exportPortableRecovery({ directory: snapshot, destination: portable, password, safeStorage: sourceStorage }), /exist/i);
  checks.push("Encrypted database, documents, filenames and credentials; existing backup never overwritten");
  await mkdir(target);
  await assert.rejects(importPortableRecovery({ directory: portable, profileRoot: target, password: "Wrong-password-at-least-sixteen", safeStorage: targetStorage }), /incorrect|damaged/);
  assert.deepEqual(await readdir(target), []);
  const damaged = path.join(root, "damaged-copy"); await cp(portable, damaged, { recursive: true });
  await appendFile(path.join(damaged, "0.bin"), Buffer.from([1]));
  await assert.rejects(importPortableRecovery({ directory: damaged, profileRoot: target, password, safeStorage: targetStorage }));
  assert.deepEqual(await readdir(path.join(target, "backups")), []);
  checks.push("Wrong password and damaged ciphertext rejected before active workspace writes; incomplete import removed");
  const imported = await importPortableRecovery({ directory: portable, profileRoot: target, password, safeStorage: targetStorage });
  await verifyUpgradeBackup(imported);
  const secretPath = path.join(imported, "local-runtime-secret.bin");
  await readEncryptedRuntimeSecret({ safeStorage: targetStorage, filePath: secretPath });
  await assert.rejects(readEncryptedRuntimeSecret({ safeStorage: sourceStorage, filePath: secretPath }), /Wrong secure-storage/);
  await writeFile(path.join(target, "recovery-activation.json"), JSON.stringify({ status: "pending" }));
  await assert.rejects(assertRecoverySettled(target), /Interrupted recovery/);
  await assert.rejects(startManagedLocalRuntime(options(target, targetStorage)), /Interrupted recovery/);
  await writeFile(path.join(target, "recovery-activation.json"), "{");
  await assert.rejects(assertRecoverySettled(target), /incomplete/);
  await restoreUpgradeBackup({ directory: imported, profileRoot: target, postgresRoot: path.join(resources, "postgresql"), safeStorage: targetStorage });
  await assertRecoverySettled(target);
  assert.deepEqual(await readFile(path.join(target, "data/objects/recovery.txt")), document);
  runtime = await startManagedLocalRuntime(options(target, targetStorage));
  await request("/api/auth/sign-in/email", { email: user.email, password: user.password });
  db = await connect(target, targetStorage);
  assert.equal((await db.agentSchedule.findFirstOrThrow()).enabled, false);
  assert.equal((await db.mailboxConnection.findFirstOrThrow()).enabled, false);
  await db.$disconnect(); db = null;
  await runtime.stop(); runtime = null;
  checks.push("Database, login and document restored under different secure-storage identity; migrated credentials readable only by replacement identity");
  checks.push("Interrupted or malformed activation blocks startup; verified restore clears the interruption; restored schedules and mailbox monitoring remain paused");
  console.log("PASS portable recovery", checks);
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  await db?.$disconnect();
  await runtime?.stop();
  await writeFile(path.join(root, "checks.json"), JSON.stringify({ passed: !process.exitCode, checks, syntheticOnly: true, secureStorageIdentitiesSimulated: true, cleanMachineQualification: false }, null, 2));
  console.log(`Evidence: ${root}`);
}
