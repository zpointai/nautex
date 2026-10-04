import { childEnvironment } from "./child-environment.mjs";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { access, appendFile, cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createUpgradeBackup, inspectPendingMigrations } from "./upgrade-backup.mjs";
import { assertRecoverySettled } from "./restore-upgrade-backup.mjs";
import { verifyUpgradeBackup } from "./restore-upgrade-backup.mjs";
import {
  findAvailableLoopbackPort,
  generatePostgresCredentials,
  PostgresRuntime,
} from "./postgres-runtime.mjs";
import {
  readEncryptedRuntimeSecret,
  writeEncryptedRuntimeSecret,
} from "./runtime-secret-store.mjs";

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function runProcess(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: { ...childEnvironment(), ...options.env },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      else reject(new Error(`${path.basename(executable)} exited with code ${code}: ${stderr.trim() || stdout.trim()}`));
    });
  });
}

export async function preparePrismaCliRuntime({ sourceRoot, runtimeRoot, onDiagnostic }) {
  const sourcePackages = path.join(sourceRoot, "packages");
  const sourceManifest = path.join(sourceRoot, "nautex-prisma-runtime-manifest.json");
  const manifestText = await readFile(sourceManifest, "utf8");
  const manifest = JSON.parse(manifestText);
  const targetRoot = path.join(runtimeRoot, "prisma-cli");
  const targetPackages = path.join(targetRoot, "node_modules");
  const targetManifest = path.join(targetRoot, "nautex-prisma-runtime-manifest.json");
  const entrypoint = path.join(targetPackages, "prisma", "build", "index.js");

  try {
    const installedManifest = JSON.parse(await readFile(targetManifest, "utf8"));
    await access(entrypoint);
    await access(path.join(targetPackages, "c12", "package.json"));
    if (installedManifest.prismaVersion === manifest.prismaVersion
      && manifest.dependencySha256
      && installedManifest.dependencySha256 === manifest.dependencySha256) {
      await onDiagnostic("local-prisma-runtime-ready", { reused: true, prismaVersion: manifest.prismaVersion });
      return { entrypoint, packageRoot: targetPackages };
    }
  } catch {
    // Missing or stale runtime is replaced atomically below.
  }

  const temporaryRoot = `${targetRoot}.${process.pid}.tmp`;
  await rm(temporaryRoot, { recursive: true, force: true });
  await mkdir(temporaryRoot, { recursive: true });
  try {
    await cp(sourcePackages, path.join(temporaryRoot, "node_modules"), { recursive: true });
    await writeFile(path.join(temporaryRoot, "nautex-prisma-runtime-manifest.json"), manifestText, "utf8");
    await rm(targetRoot, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
    // Windows scanners can briefly lock a freshly copied dependency tree.
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(temporaryRoot, targetRoot);
        break;
      } catch (error) {
        if (process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(error.code) || attempt >= 6) throw error;
        await new Promise((resolve) => setTimeout(resolve, Math.min(100 * 2 ** attempt, 800)));
      }
    }
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  await onDiagnostic("local-prisma-runtime-ready", { reused: false, prismaVersion: manifest.prismaVersion });
  return { entrypoint, packageRoot: targetPackages };
}

async function waitForBackend(origin, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "No response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/v1/system/health`, { signal: AbortSignal.timeout(2_000) });
      const body = await response.json();
      if (response.ok && body?.ok === true) return body;
      lastError = `Health returned ${response.status}.`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Nautex local backend did not become healthy: ${lastError}`);
}

async function stopChild(child, timeoutMs = 10_000) {
  const exited = () => !child || child.exitCode !== null || child.signalCode !== null;
  if (exited()) return;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
  if (!exited()) {
    child.kill("SIGKILL");
    await Promise.race([
      new Promise(resolve => child.once("exit", resolve)),
      new Promise(resolve => setTimeout(resolve, timeoutMs)),
    ]);
    if (!exited()) throw new Error("The backend did not stop; no recovery snapshot can be taken while writes remain possible.");
  }
}

export async function startManagedLocalRuntime({
  resourcesRoot,
  userDataRoot,
  safeStorage,
  nodeExecutable,
  electronNode = false,
  environment = {},
  demonstration = false,
  publicOrigin = "",
  onDiagnostic = async () => undefined,
}) {
  const backendRoot = path.join(resourcesRoot, "backend");
  const backendPackages = path.join(backendRoot, "packages");
  const postgresRoot = path.join(resourcesRoot, "postgresql");
  const prismaRoot = path.join(resourcesRoot, "prisma-runtime");
  const runtimeRoot = path.join(userDataRoot, "runtime");
  const logRoot = path.join(userDataRoot, "logs");
  const secretPath = path.join(runtimeRoot, "local-runtime-secret.bin");
  await assertRecoverySettled(userDataRoot);
  await mkdir(runtimeRoot, { recursive: true });
  await mkdir(logRoot, { recursive: true });

  for (const required of [
    path.join(backendRoot, "server.js"),
    path.join(backendPackages, "next", "package.json"),
    path.join(postgresRoot, "bin", "postgres.exe"),
    path.join(prismaRoot, "packages", "prisma", "build", "index.js"),
    path.join(prismaRoot, "packages", "c12", "package.json"),
    path.join(prismaRoot, "nautex-prisma-runtime-manifest.json"),
  ]) {
    if (!await exists(required)) throw new Error(`Nautex local runtime resource is missing: ${required}`);
  }

  let secret;
  await onDiagnostic("local-secret-loading", { exists: await exists(secretPath) });
  if (await exists(secretPath)) {
    secret = await readEncryptedRuntimeSecret({ safeStorage, filePath: secretPath });
  } else {
    secret = {
      database: generatePostgresCredentials(),
      authSecret: randomBytes(48).toString("base64url"),
    };
    await writeEncryptedRuntimeSecret({ safeStorage, filePath: secretPath, value: secret });
  }
  await onDiagnostic("local-secret-ready");

  const prismaRuntime = await preparePrismaCliRuntime({
    sourceRoot: prismaRoot,
    runtimeRoot,
    onDiagnostic,
  });

  const postgres = new PostgresRuntime({
    runtimeRoot: postgresRoot,
    dataDirectory: path.join(userDataRoot, "postgres", "data"),
    logDirectory: path.join(logRoot, "postgres"),
  });
  const postgresPort = await findAvailableLoopbackPort();
  const database = await postgres.bootstrap(secret.database, postgresPort);
  await onDiagnostic("local-postgres-ready", { initialized: database.initialized, databaseCreated: database.databaseCreated });

  const nodeEnvironment = electronNode ? { ELECTRON_RUN_AS_NODE: "1" } : {};
  const schemaPath = path.join(backendRoot, "prisma", "schema.prisma");
  const prismaCli = prismaRuntime.entrypoint;
  const prismaWorkingRoot = path.dirname(prismaRuntime.packageRoot);
  try {
    if (!database.databaseCreated) {
      const migrations = await inspectPendingMigrations({ postgres, credentials: secret.database, port: postgresPort, migrationsRoot: path.join(backendRoot, "prisma", "migrations") });
      if (migrations.pending) {
        const manifest = JSON.parse(await readFile(path.join(backendRoot, "nautex-backend-manifest.json"), "utf8"));
        const directory = await createUpgradeBackup({ postgres, credentials: secret.database, port: postgresPort, profileRoot: userDataRoot, targetVersion: manifest.applicationVersion, appliedMigrations: migrations.applied });
        await onDiagnostic("local-upgrade-backup-complete", { directory });
      }
    }
    await runProcess(nodeExecutable, [prismaCli, "migrate", "deploy", "--schema", schemaPath], {
      cwd: prismaWorkingRoot,
      env: {
        ...nodeEnvironment,
        DATABASE_URL: database.connectionUrl,
        NODE_PATH: prismaRuntime.packageRoot,
      },
    });
    await onDiagnostic("local-migrations-complete");

    const demoMarker = path.join(runtimeRoot, "demonstration-seeded-v1.json");
    if (demonstration && !await exists(demoMarker)) {
      const userCount = await postgres.queryScalar(secret.database, postgresPort, secret.database.database, 'SELECT count(*) FROM users');
      const operationalCount = await postgres.queryScalar(secret.database, postgresPort, secret.database.database, `SELECT count(*) FROM organizations WHERE data_mode <> 'Demo'`);
      if (userCount !== "0" || operationalCount !== "0") throw new Error("Demonstration setup requires an empty demonstration database. Existing records were preserved.");
      await runProcess(nodeExecutable, [path.join(backendRoot, "demo-seed.cjs")], { cwd: backendRoot, env: { ...nodeEnvironment, DATABASE_URL: database.connectionUrl, NODE_PATH: backendPackages, NAUTEX_DEMO_WORKSPACE: "1" } });
      await writeFile(demoMarker, '{"formatVersion":1,"synthetic":true}\n', { flag: "wx" });
      await onDiagnostic("local-demonstration-seeded");
    }

    const backendPort = await findAvailableLoopbackPort();
    const backendOrigin = `http://127.0.0.1:${backendPort}`;
    const authOrigin = publicOrigin || backendOrigin;
    const backendLog = path.join(logRoot, "backend.log");
    const backend = spawn(nodeExecutable, [path.join(backendRoot, "server.js")], {
      cwd: backendRoot,
      windowsHide: true,
      env: {
        ...childEnvironment(),
        ...environment,
        ...nodeEnvironment,
        // Explicit empty defaults prevent dependency dotenv loaders from
        // discovering AI credentials in a build-machine checkout. Real machine
        // environment overrides remain authoritative; otherwise Settings owns AI.
        AI_PROVIDER: demonstration ? "none" : "",
        DEEPSEEK_API_KEY: "",
        GEMINI_API_KEY: "",
        VERTEX_PROJECT: "",
        VERTEX_LOCATION: "",
        GOOGLE_MAPS_API_KEY: "",
        TYPESAFE_API_KEY: "",
        DEEPSEEK_BASE_URL: "",
        DEEPSEEK_DEFAULT_MODEL: "", DEEPSEEK_FAST_MODEL: "", DEEPSEEK_REASONING_MODEL: "",
        AI_DEFAULT_MODEL: "", AI_FAST_MODEL: "", AI_REASONING_MODEL: "",
        NAUTEX_AI_TASK_ROUTING_ENABLED: "false",
        NODE_ENV: "production",
        HOSTNAME: "127.0.0.1",
        PORT: String(backendPort),
        DATABASE_URL: database.connectionUrl,
        BETTER_AUTH_URL: authOrigin,
        NAUTEX_AUTH_TRUSTED_ORIGINS: authOrigin,
        BETTER_AUTH_SECRET: secret.authSecret,
        NAUTEX_AUTH_MODE: "local",
        NAUTEX_DATA_MODE: demonstration ? "demo" : "operational",
        NAUTEX_DEMO_WORKSPACE: demonstration ? "1" : "0",
        NAUTEX_DATA_DIR: path.join(userDataRoot, "data"),
        LOCAL_STORAGE_DIR: "objects",
        NAUTEX_BACKUP_DIR: path.join(userDataRoot, "backups"),
        NAUTEX_STORAGE_PROVIDER: "local",
        NAUTEX_STORAGE_DELETE_MODE: "retain",
        NAUTEX_AGENT_SCHEDULER: "1",
        NODE_PATH: backendPackages,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    backend.stdout.on("data", (chunk) => void appendFile(backendLog, chunk).catch(() => undefined));
    backend.stderr.on("data", (chunk) => void appendFile(backendLog, chunk).catch(() => undefined));
    backend.once("error", (error) => void onDiagnostic("local-backend-error", { message: error.message }));

    try {
      await waitForBackend(backendOrigin);
    } catch (error) {
      await stopChild(backend);
      throw error;
    }
    await onDiagnostic("local-backend-ready", { origin: backendOrigin });

    let stopped = false;
    return {
      backendOrigin,
      async backupAndStop() {
        if (stopped) throw new Error("The local workspace has already stopped.");
        stopped = true;
        // Quiesce all application writes before dumping the database and files.
        try {
          await stopChild(backend);
          const migrations = await inspectPendingMigrations({ postgres, credentials: secret.database, port: postgresPort, migrationsRoot: path.join(backendRoot, "prisma", "migrations") });
          const manifest = JSON.parse(await readFile(path.join(backendRoot, "nautex-backend-manifest.json"), "utf8"));
          const directory = await createUpgradeBackup({ postgres, credentials: secret.database, port: postgresPort, profileRoot: userDataRoot, targetVersion: manifest.applicationVersion, appliedMigrations: migrations.applied, manual: true });
          await verifyUpgradeBackup(directory);
          await writeFile(path.join(userDataRoot, "backups", "backup-status.json"), JSON.stringify({ version: 1, verifiedAt: new Date().toISOString() }));
          await onDiagnostic("local-manual-backup-complete", { directory });
          return directory;
        } finally { await postgres.stop(); }
      },
      async stop() {
        if (stopped) return;
        stopped = true;
        await stopChild(backend);
        await postgres.stop();
        await onDiagnostic("local-runtime-stopped");
      },
    };
  } catch (error) {
    await postgres.stop().catch(() => undefined);
    throw error;
  }
}
