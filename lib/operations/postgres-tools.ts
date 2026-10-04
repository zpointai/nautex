import { createReadStream, openSync, closeSync } from "node:fs";
import { spawn } from "node:child_process";

interface DatabaseConnection {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

function connection(): DatabaseConnection {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is required.");
  const url = new URL(value);
  return {
    host: url.hostname,
    port: url.port || "5432",
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
  };
}

function run(command: string, args: string[], options: { env?: NodeJS.ProcessEnv; stdoutFile?: string; stdinFile?: string; quiet?: boolean } = {}) {
  return new Promise<void>((resolve, reject) => {
    const outputFd = options.stdoutFile ? openSync(options.stdoutFile, "w") : null;
    const child = spawn(command, args, {
      env: options.env ?? process.env,
      windowsHide: true,
      stdio: [options.stdinFile ? "pipe" : "ignore", outputFd ?? (options.quiet ? "ignore" : "inherit"), "inherit"],
    });
    if (options.stdinFile && child.stdin) {
      child.stdin.on("error", () => undefined);
      createReadStream(options.stdinFile).pipe(child.stdin);
    }
    child.once("error", (error) => {
      if (outputFd != null) closeSync(outputFd);
      reject(error);
    });
    child.once("exit", (code) => {
      if (outputFd != null) closeSync(outputFd);
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code ?? "unknown"}.`));
    });
  });
}

function pgEnvironment(database: DatabaseConnection) {
  return { ...process.env, PGPASSWORD: database.password };
}

function isMissingExecutable(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export async function createPostgresBackup(targetFile: string) {
  const database = connection();
  try {
    await run("pg_dump", [
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      `--host=${database.host}`,
      `--port=${database.port}`,
      `--username=${database.user}`,
      `--file=${targetFile}`,
      database.database,
    ], { env: pgEnvironment(database) });
  } catch (error) {
    if (!isMissingExecutable(error)) throw error;
    await run("docker", [
      "exec", "nautex-db", "pg_dump",
      "--format=custom", "--no-owner", "--no-privileges",
      `--username=${database.user}`, database.database,
    ], { stdoutFile: targetFile });
  }
}

export async function restorePostgresBackup(sourceFile: string) {
  const database = connection();
  const restoreArgs = ["--clean", "--if-exists", "--no-owner", "--no-privileges"];
  try {
    await run("pg_restore", [
      ...restoreArgs,
      `--host=${database.host}`,
      `--port=${database.port}`,
      `--username=${database.user}`,
      `--dbname=${database.database}`,
      sourceFile,
    ], { env: pgEnvironment(database) });
  } catch (error) {
    if (!isMissingExecutable(error)) throw error;
    await run("docker", [
      "exec", "-i", "nautex-db", "pg_restore",
      ...restoreArgs,
      `--username=${database.user}`,
      `--dbname=${database.database}`,
    ], { stdinFile: sourceFile });
  }
}

export async function verifyPostgresBackup(sourceFile: string) {
  try {
    await run("pg_restore", ["--list", sourceFile], { quiet: true });
  } catch (error) {
    if (!isMissingExecutable(error)) throw error;
    await run("docker", ["exec", "-i", "nautex-db", "pg_restore", "--list"], { stdinFile: sourceFile, quiet: true });
  }
}
