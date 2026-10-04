import { childEnvironment } from "./child-environment.mjs";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { access, appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;

function validateCredentials(credentials) {
  if (!IDENTIFIER.test(credentials?.username || "") || !IDENTIFIER.test(credentials?.database || "")) {
    throw new Error("Invalid PostgreSQL runtime identifier.");
  }
  if (typeof credentials.password !== "string" || credentials.password.length < 32) {
    throw new Error("Invalid PostgreSQL runtime password.");
  }
}

function validatePort(port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid PostgreSQL runtime port.");
}

async function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
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
    // SQL results require drained pipes. pg_ctl launches a long-lived server
    // that inherits pipe handles, so launcher commands must finish on exit.
    child.once(options.waitForOutput ? "close" : "exit", (code) => {
      const result = { code: code ?? -1, stdout: stdout.trim(), stderr: stderr.trim() };
      if (result.code === 0 || options.allowFailure) resolve(result);
      else reject(new Error(`${path.basename(command)} failed with code ${result.code}: ${result.stderr || result.stdout}`));
    });
  });
}

export function generatePostgresCredentials() {
  return {
    username: "nautex_runtime",
    password: randomBytes(32).toString("base64url"),
    database: "nautex",
  };
}

export function postgresConnectionUrl({ username, password, database, port }) {
  validateCredentials({ username, password, database });
  validatePort(port);
  return `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@127.0.0.1:${port}/${database}?schema=public`;
}

export async function findAvailableLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

export class PostgresRuntime {
  constructor({ runtimeRoot, dataDirectory, logDirectory }) {
    this.runtimeRoot = path.resolve(runtimeRoot);
    this.binDirectory = path.join(this.runtimeRoot, "bin");
    this.dataDirectory = path.resolve(dataDirectory);
    this.logDirectory = path.resolve(logDirectory);
  }

  executable(name) {
    return path.join(this.binDirectory, `${name}.exe`);
  }

  async validate() {
    for (const name of ["postgres", "initdb", "pg_ctl", "createdb", "psql", "pg_dump", "pg_restore"]) {
      await access(this.executable(name));
    }
  }

  async isInitialized() {
    try {
      await access(path.join(this.dataDirectory, "PG_VERSION"));
      return true;
    } catch {
      return false;
    }
  }

  async initialize(credentials) {
    if (await this.isInitialized()) return false;
    await mkdir(this.dataDirectory, { recursive: true });
    await mkdir(this.logDirectory, { recursive: true });
    const passwordFile = path.join(this.logDirectory, `.bootstrap-${process.pid}.pwd`);
    await writeFile(passwordFile, `${credentials.password}\n`, { encoding: "utf8", mode: 0o600 });
    try {
      await runCommand(this.executable("initdb"), [
        "-D", this.dataDirectory,
        "-U", credentials.username,
        `--pwfile=${passwordFile}`,
        "--auth-host=scram-sha-256",
        "--auth-local=scram-sha-256",
        "--encoding=UTF8",
        "--locale=C",
        "--no-instructions",
      ]);
      await appendFile(path.join(this.dataDirectory, "postgresql.conf"), [
        "",
        "# Managed by Nautex local runtime",
        "listen_addresses = '127.0.0.1'",
        "password_encryption = 'scram-sha-256'",
        "fsync = on",
        "synchronous_commit = on",
        "full_page_writes = on",
        "",
      ].join("\n"), "utf8");
      return true;
    } finally {
      await rm(passwordFile, { force: true });
    }
  }

  connectionEnvironment(credentials, port) {
    validateCredentials(credentials);
    validatePort(port);
    return {
      PGHOST: "127.0.0.1",
      PGPORT: String(port),
      PGUSER: credentials.username,
      PGPASSWORD: credentials.password,
    };
  }

  async start(port) {
    validatePort(port);
    await mkdir(this.logDirectory, { recursive: true });
    const logFile = path.join(this.logDirectory, "postgres.log");
    await runCommand(this.executable("pg_ctl"), [
      "start", "-D", this.dataDirectory, "-l", logFile, "-w", "-t", "30",
      "-o", `-p ${port} -h 127.0.0.1`,
    ]);
  }

  async ensureDatabase(credentials, port) {
    const env = this.connectionEnvironment(credentials, port);
    const lookupDatabase = () => runCommand(this.executable("psql"), [
      "-d", "postgres", "-tAc", `SELECT 1 FROM pg_database WHERE datname = '${credentials.database}'`,
    ], { env, waitForOutput: true });
    const lookup = await lookupDatabase();
    if (lookup.stdout === "1") return false;
    try {
      await runCommand(this.executable("createdb"), ["--encoding=UTF8", "--template=template0", credentials.database], { env });
    } catch (error) {
      // Creation can finish between lookup and CREATE DATABASE. Accept only a
      // confirmed database through the same authenticated local connection;
      // existing migration-history and backup checks still apply afterward.
      const afterCreation = await lookupDatabase().catch(() => null);
      if (afterCreation?.stdout === "1") return false;
      throw error;
    }
    return true;
  }

  async queryScalar(credentials, port, database, sql) {
    const result = await runCommand(this.executable("psql"), ["-d", database, "-tAc", sql], {
      env: this.connectionEnvironment(credentials, port),
      waitForOutput: true,
    });
    return result.stdout;
  }

  async stop() {
    const status = await runCommand(this.executable("pg_ctl"), ["status", "-D", this.dataDirectory], { allowFailure: true });
    if (status.code !== 0) return false;
    await runCommand(this.executable("pg_ctl"), ["stop", "-D", this.dataDirectory, "-m", "fast", "-w", "-t", "30"]);
    return true;
  }

  async bootstrap(credentials, port) {
    validateCredentials(credentials);
    validatePort(port);
    await this.validate();
    const initialized = await this.initialize(credentials);
    await this.start(port);
    try {
      const databaseCreated = await this.ensureDatabase(credentials, port);
      return {
        initialized,
        databaseCreated,
        connectionUrl: postgresConnectionUrl({ ...credentials, port }),
      };
    } catch (error) {
      // A failed bootstrap has no returned runtime owner to shut it down.
      await this.stop().catch(() => undefined);
      throw error;
    }
  }
}
