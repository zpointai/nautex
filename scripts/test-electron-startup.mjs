import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const packagedExecutable = process.env.NAUTEX_DESKTOP_TEST_EXECUTABLE;
const server = http.createServer((request, response) => {
  response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  if (request.url === "/api/v1/system/health") {
    response.end(JSON.stringify({ ok: true, data: { checks: { database: { ok: true } } } }));
    return;
  }
  if (request.url === "/api/v1/auth/context") {
    response.end(JSON.stringify({ ok: true, data: { userId: "desktop-smoke" } }));
    return;
  }
  response.end(JSON.stringify({ ok: true, data: [] }));
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
const resultDirectory = await mkdtemp(path.join(tmpdir(), "nautex-electron-"));
const resultPath = path.join(resultDirectory, "result.txt");
const child = spawn(packagedExecutable || electronPath, packagedExecutable ? [] : ["desktop", `--nautex-origin=${origin}`], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    NAUTEX_DESKTOP_SMOKE_TEST: "1",
    NAUTEX_DESKTOP_SMOKE_RESULT: resultPath,
    NAUTEX_DESKTOP_USER_DATA: path.join(resultDirectory, "user-data"),
  },
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => { output += chunk.toString(); });
child.stderr.on("data", (chunk) => { output += chunk.toString(); });

const timeout = setTimeout(() => child.kill(), packagedExecutable ? 120_000 : 30_000);
const exitCode = await new Promise((resolve) => child.once("exit", resolve));
clearTimeout(timeout);
server.close();

let result = "";
try {
  result = await readFile(resultPath, "utf8");
} catch {
  // The assertion below reports the process output when startup fails before preload verification.
}
if (path.dirname(path.resolve(resultDirectory)) !== path.resolve(tmpdir()) || !path.basename(resultDirectory).startsWith("nautex-electron-")) {
  throw new Error("Refusing unsafe Electron test-profile cleanup.");
}
await rm(resultDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch((error) => {
  console.error(result || "No smoke-test stage was recorded.");
  console.error(output);
  throw error;
});

if (exitCode !== 0 || !result.includes("NAUTEX_ELECTRON_SMOKE=")) {
  console.error(`Electron exited with code ${exitCode}.`);
  console.error(result || "No smoke-test stage was recorded.");
  console.error(output);
  process.exit(1);
}
const smokeLine = result.split(/\r?\n/).find((line) => line.startsWith("NAUTEX_ELECTRON_SMOKE="));
const smoke = JSON.parse(smokeLine.slice("NAUTEX_ELECTRON_SMOKE=".length));
if (!(smoke.rootContentLength > 0)) throw new Error("Electron renderer mounted no visible application content.");
console.log(result);
console.log("Electron startup smoke test passed.");
