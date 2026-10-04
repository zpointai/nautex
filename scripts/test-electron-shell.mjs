import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  findDeepLink,
  isAllowedExternalUrl,
  isAllowedRendererUrl,
  normalizeOptionalHttpsUrl,
  normalizeTrustedOrigin,
  parseDeepLink,
  RENDERER_ORIGIN,
  resolveBackendRequestUrl,
} from "../desktop/security.mjs";

assert.equal(normalizeTrustedOrigin("https://erp.nautex.example"), "https://erp.nautex.example");
assert.equal(
  normalizeTrustedOrigin("http://localhost:3000", { allowLocalhostHttp: true }),
  "http://localhost:3000",
);
assert.throws(() => normalizeTrustedOrigin("http://erp.nautex.example"), /HTTPS/);
assert.throws(() => normalizeTrustedOrigin("https://erp.nautex.example/path"), /origin/);
assert.throws(() => normalizeTrustedOrigin("https://user:pass@erp.nautex.example"), /origin/);

assert.equal(isAllowedRendererUrl("https://erp.nautex.example/purchase-orders", "https://erp.nautex.example"), true);
assert.equal(isAllowedRendererUrl("https://evil.example", "https://erp.nautex.example"), false);
assert.equal(isAllowedRendererUrl("nautex-app://renderer/index.html", RENDERER_ORIGIN), true);
assert.equal(isAllowedRendererUrl("nautex-app://other/index.html", RENDERER_ORIGIN), false);
assert.equal(
  resolveBackendRequestUrl("nautex-app://renderer/api/v1/system/health?full=1", "https://erp.nautex.example"),
  "https://erp.nautex.example/api/v1/system/health?full=1",
);
assert.equal(resolveBackendRequestUrl("nautex-app://renderer/assets/app.js", "https://erp.nautex.example"), null);
assert.equal(resolveBackendRequestUrl("https://evil.example/api/v1/data", "https://erp.nautex.example"), null);
assert.equal(isAllowedExternalUrl("https://supplier.example"), true);
assert.equal(isAllowedExternalUrl("http://supplier.example"), false);
assert.equal(normalizeOptionalHttpsUrl("https://updates.nautex.example/windows", "Update URL"), "https://updates.nautex.example/windows");
assert.throws(() => normalizeOptionalHttpsUrl("http://updates.nautex.example", "Update URL"), /HTTPS/);

assert.equal(parseDeepLink("nautex://open/purchaseOrders/po-123"), "nautex://open/purchaseOrders/po-123");
assert.equal(parseDeepLink("nautex://open/unknown/record"), null);
assert.equal(parseDeepLink("nautex://delete/purchaseOrders/po-123"), null);
assert.equal(findDeepLink(["--flag", "nautex://open/inventory/item%201"]), "nautex://open/inventory/item%201");

const mainSource = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
const preloadSource = await readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8");
const builderConfig = await readFile(new URL("../electron-builder.yml", import.meta.url), "utf8");
const startupErrorPage = await readFile(new URL("../desktop/startup-error.html", import.meta.url), "utf8");
const rendererEntry = await readFile(new URL("../desktop-renderer/index.html", import.meta.url), "utf8");

for (const policy of [
  "nodeIntegration: false",
  "contextIsolation: true",
  "sandbox: true",
  "webSecurity: true",
  "allowRunningInsecureContent: false",
  "webviewTag: false",
  "setPermissionRequestHandler",
  "setPermissionCheckHandler",
  "setWindowOpenHandler",
]) {
  assert.ok(mainSource.includes(policy), `Missing Electron policy: ${policy}`);
}
assert.ok(preloadSource.includes("contextBridge.exposeInMainWorld"));
assert.ok(!preloadSource.includes("exec(") && !preloadSource.includes("spawn("));
assert.ok(builderConfig.includes("target: nsis"));
assert.ok(builderConfig.includes("requestedExecutionLevel: asInvoker"));
assert.ok(builderConfig.includes("azureSignOptions:"));
assert.ok(builderConfig.includes("publisherName:"));
assert.ok(builderConfig.includes("deleteAppDataOnUninstall: false"));
assert.ok(builderConfig.includes("from: .desktop-build/renderer"));
assert.ok(builderConfig.includes("from: .desktop-build/backend"));
assert.ok(builderConfig.includes("from: .desktop-build/postgresql"));
assert.ok(builderConfig.includes("from: .desktop-build/prisma-runtime"));
assert.ok(builderConfig.includes("icon: build/nautex.ico"));
assert.ok(builderConfig.includes("output: releases"));
assert.ok(mainSource.includes("protocol.registerSchemesAsPrivileged"));
assert.ok(mainSource.includes("desktopSession.protocol.handle"));
assert.ok(mainSource.includes("desktopSession.fetch"));
assert.ok(mainSource.includes('headers.set("origin", backendOrigin)'));
assert.ok(mainSource.includes("renderer-load-failed"));
assert.ok(!mainSource.includes("mainWindow.loadURL(backendOrigin)"));
assert.ok(mainSource.includes("startManagedLocalRuntime"));
assert.ok(mainSource.includes("setCertificateVerifyProc"));
assert.ok(mainSource.includes('permission === "clipboard-sanitized-write"'));
assert.ok(mainSource.includes('webContents.on("context-menu"'));
assert.ok(mainSource.includes("Menu.buildFromTemplate"));
assert.ok(mainSource.includes("certificateMatchesEnrollment"));
assert.ok(mainSource.includes("ensureOfficeHostServiceStarted"));
assert.ok(!mainSource.includes("Office-host service mode is not enabled"));
assert.ok(preloadSource.includes("usesApiProxy: true"));
assert.ok(preloadSource.includes("deploymentMode"));
assert.ok(startupErrorPage.includes("Retry startup"));
assert.ok(rendererEntry.includes("Nautex AI ERP"));

console.log("Electron shell policy tests passed.");
