import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { startManagedLocalRuntime } from "./local-runtime.mjs";
import { startOfficeHostGateway } from "./office-host-gateway.mjs";
import { normalizeTrustedOrigin } from "./security.mjs";
import {
  createWindowsMachineSecretStorage,
  readWindowsMachineProtectedString,
} from "./windows-machine-secret.mjs";

function argumentValue(prefix) {
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : "";
}

function validateConfig(value) {
  if (!value || typeof value !== "object") throw new Error("Office host service configuration is invalid.");
  const resourcesRoot = path.resolve(String(value.resourcesRoot || ""));
  const dataRoot = path.resolve(String(value.dataRoot || ""));
  const certificatePath = path.resolve(String(value.certificatePath || ""));
  const certificatePasswordPath = path.resolve(String(value.certificatePasswordPath || ""));
  const publicOrigin = normalizeTrustedOrigin(value.publicOrigin);
  const port = Number(value.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || Number(new URL(publicOrigin).port || 443) !== port) {
    throw new Error("Office host TLS port is invalid.");
  }
  return { resourcesRoot, dataRoot, certificatePath, certificatePasswordPath, publicOrigin, port };
}

const configArgument = argumentValue("--config=");
if (!configArgument) throw new Error("Office host service requires --config=<path>.");
const configPath = path.resolve(configArgument);
const config = validateConfig(JSON.parse(await readFile(configPath, "utf8")));
const logPath = path.join(config.dataRoot, "logs", "office-host-service.log");
await mkdir(path.dirname(logPath), { recursive: true });

async function diagnostic(event, details = {}) {
  const entry = `${JSON.stringify({ at: new Date().toISOString(), event, ...details })}\n`;
  await appendFile(logPath, entry, "utf8").catch(() => undefined);
}

let runtime;
let gateway;
let stopping = false;

async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  await gateway?.stop().catch((error) => diagnostic("office-gateway-stop-failed", { message: error.message }));
  await runtime?.stop().catch((error) => diagnostic("office-runtime-stop-failed", { message: error.message }));
  process.exitCode = exitCode;
}

try {
  const certificatePassword = await readWindowsMachineProtectedString(config.certificatePasswordPath);
  runtime = await startManagedLocalRuntime({
    resourcesRoot: config.resourcesRoot,
    userDataRoot: config.dataRoot,
    safeStorage: createWindowsMachineSecretStorage(),
    nodeExecutable: process.execPath,
    electronNode: process.env.ELECTRON_RUN_AS_NODE === "1",
    publicOrigin: config.publicOrigin,
    onDiagnostic: diagnostic,
  });
  gateway = await startOfficeHostGateway({
    backendOrigin: runtime.backendOrigin,
    publicOrigin: config.publicOrigin,
    port: config.port,
    certificate: {
      pfx: await readFile(config.certificatePath),
      passphrase: certificatePassword,
      minVersion: "TLSv1.2",
    },
    onDiagnostic: diagnostic,
  });
  await diagnostic("office-host-service-ready", { publicOrigin: config.publicOrigin });
} catch (error) {
  await diagnostic("office-host-service-failed", { message: error.message });
  await stop(1);
  throw error;
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
process.once("uncaughtException", async (error) => {
  await diagnostic("office-host-uncaught-exception", { message: error.message });
  await stop(1);
});
process.once("unhandledRejection", async (error) => {
  await diagnostic("office-host-unhandled-rejection", { message: error instanceof Error ? error.message : String(error) });
  await stop(1);
});
