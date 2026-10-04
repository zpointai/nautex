import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  normalizeOptionalHttpsUrl,
  normalizeTrustedOrigin,
} from "../desktop/security.mjs";

const release = process.argv.includes("--release");
const localPrototype = process.argv.includes("--local-prototype");
const standalone = process.argv.includes("--standalone");
const officeHost = process.argv.includes("--office-host");
if (release && localPrototype) throw new Error("A signed desktop release cannot enable developer HTTP mode.");
if ([standalone, localPrototype, officeHost].filter(Boolean).length > 1) {
  throw new Error("Standalone, office-host, and developer-hosted modes are mutually exclusive.");
}

const deploymentMode = standalone ? "standalone" : officeHost ? "office-host" : localPrototype ? "development" : "office-client";
const configuredOrigin = process.env.NAUTEX_DESKTOP_BACKEND_ORIGIN?.trim() || "";
const backendOrigin = standalone || officeHost || (!configuredOrigin && !localPrototype)
  ? ""
  : normalizeTrustedOrigin(configuredOrigin, { allowLocalhostHttp: localPrototype });
const allowLocalhostHttp = standalone || (localPrototype && new URL(backendOrigin).protocol === "http:");
if (localPrototype && !allowLocalhostHttp) {
  throw new Error("Local prototype mode requires an HTTP localhost backend origin.");
}
const updateUrl = normalizeOptionalHttpsUrl(process.env.NAUTEX_DESKTOP_UPDATE_URL, "Update URL");
const crashSubmitUrl = normalizeOptionalHttpsUrl(process.env.NAUTEX_DESKTOP_CRASH_SUBMIT_URL, "Crash reporting URL");
const certificateSha256 = process.env.NAUTEX_DESKTOP_CERTIFICATE_SHA256?.replace(/[^a-fA-F0-9]/g, "").toUpperCase() || "";
if (certificateSha256 && !/^[A-F0-9]{64}$/.test(certificateSha256)) {
  throw new Error("NAUTEX_DESKTOP_CERTIFICATE_SHA256 must be a SHA-256 fingerprint.");
}

if (release) {
  const missing = [
    ["NAUTEX_DESKTOP_UPDATE_URL", updateUrl],
    ["CSC_LINK", process.env.CSC_LINK],
    ["CSC_KEY_PASSWORD", process.env.CSC_KEY_PASSWORD],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`Desktop release configuration is missing: ${missing.join(", ")}.`);
}

const outputDirectory = path.resolve(".desktop-build");
await mkdir(outputDirectory, { recursive: true });
await writeFile(
  path.join(outputDirectory, "runtime-config.json"),
  `${JSON.stringify({ deploymentMode, backendOrigin, certificateSha256, updateUrl, crashSubmitUrl, allowLocalhostHttp }, null, 2)}\n`,
  "utf8",
);
console.log(`Prepared ${deploymentMode} desktop runtime configuration${backendOrigin ? ` for ${backendOrigin}` : ""}.`);
