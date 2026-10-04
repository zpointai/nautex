import { appendFile, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import updaterPackage from "electron-updater";
import {
  app,
  BrowserWindow,
  crashReporter,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  safeStorage,
  session,
  shell,
} from "electron";
import {
  findDeepLink,
  isAllowedExternalUrl,
  isAllowedRendererUrl,
  normalizeOptionalHttpsUrl,
  RENDERER_ORIGIN,
  resolveBackendRequestUrl,
} from "./security.mjs";
import { startManagedLocalRuntime } from "./local-runtime.mjs";
import { ensureWorkspace, selectWorkspace, workspaceArguments } from "./workspace.mjs";
import { restoreUpgradeBackup, verifyUpgradeBackup } from "./restore-upgrade-backup.mjs";
import { exportPortableRecovery, importPortableRecovery } from "./portable-recovery.mjs";
import { requestRecoveryPassword } from "./recovery-password.mjs";
import {
  certificateMatchesEnrollment,
  normalizeCertificateSha256,
  readOfficeEnrollment,
  writeOfficeEnrollment,
} from "./office-enrollment.mjs";
import {
  DESKTOP_DEPLOYMENT_MODES,
  normalizeDeploymentMode,
  validateTopologyConfiguration,
} from "./runtime-topology.mjs";

const { autoUpdater } = updaterPackage;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const releasePackage = JSON.parse(await readFile(path.join(__dirname, 'package.json'), 'utf8'));
const releaseLabel = Number.isSafeInteger(releasePackage.nautexReleaseRevision) && releasePackage.nautexReleaseRevision > 1
  ? ` · Pilot revision ${releasePackage.nautexReleaseRevision}` : '';
app.setName("Nautex AI");
app.setPath("userData", path.join(app.getPath("appData"), "Nautex Community"));
const SESSION_PARTITION = "persist:nautex-community";
const RENDERER_ENTRY = `${RENDERER_ORIGIN}/index.html`;
const isSmokeTest = process.env.NAUTEX_DESKTOP_SMOKE_TEST === "1";
const smokeStartedAt = Date.now();
if (isSmokeTest) app.disableHardwareAcceleration();
const workspace = selectWorkspace({ defaultRoot: app.getPath("userData"), args: process.argv,
  smokeRoot: isSmokeTest ? process.env.NAUTEX_DESKTOP_USER_DATA : "" });
app.setPath("userData", workspace.root);

protocol.registerSchemesAsPrivileged([{
  scheme: "nautex-app",
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
  },
}]);

let mainWindow = null;
let backendOrigin = "";
let pendingDeepLink = findDeepLink(process.argv);
let runtimeConfig = {};
let showingStartupError = false;
let desktopSession = null;
let deploymentMode = DESKTOP_DEPLOYMENT_MODES.OFFICE_CLIENT;
let officeEnrollment = null;
let managedLocalRuntime = null;
let managedShutdownStarted = false;

async function markSmoke(stage, details = {}) {
  if (!isSmokeTest || !process.env.NAUTEX_DESKTOP_SMOKE_RESULT) return;
  await appendFile(
    process.env.NAUTEX_DESKTOP_SMOKE_RESULT,
    `${JSON.stringify({ stage, ...details })}\n`,
    "utf8",
  );
}

void markSmoke("module-loaded");

async function readRuntimeConfig() {
  const configPath = app.isPackaged
    ? path.join(process.resourcesPath, "runtime-config.json")
    : path.join(__dirname, "runtime-config.example.json");
  try {
    return JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") console.error("Unable to read desktop runtime configuration.", error);
    return {};
  }
}

function commandLineValue(prefix) {
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : "";
}

async function writeDiagnostic(event, details = {}) {
  const entry = JSON.stringify({ at: new Date().toISOString(), event, ...details });
  console.info(entry);
  try {
    await appendFile(path.join(app.getPath("logs"), "desktop-main.log"), `${entry}\n`, "utf8");
  } catch {
    // Diagnostics must never interrupt the application.
  }
}

function senderIsTrusted(event) {
  return isAllowedRendererUrl(event.senderFrame?.url || event.sender.getURL(), RENDERER_ORIGIN);
}

function configureIpc() {
  ipcMain.handle("nautex:open-external", async (event, value) => {
    if (!senderIsTrusted(event) || !isAllowedExternalUrl(value)) throw new Error("External URL denied.");
    await shell.openExternal(value);
  });

  ipcMain.handle("nautex:open-download", async (event, value) => {
    const downloadUrl = resolveBackendRequestUrl(value, backendOrigin);
    if (!senderIsTrusted(event) || !downloadUrl) throw new Error("Download URL denied.");
    event.sender.downloadURL(downloadUrl);
  });
}

function configureSession(desktopSession) {
  const canWriteClipboard = (webContents, permission) =>
    permission === "clipboard-sanitized-write"
    && isAllowedRendererUrl(webContents?.getURL?.() || "", RENDERER_ORIGIN);
  desktopSession.setPermissionRequestHandler((webContents, permission, callback) => callback(canWriteClipboard(webContents, permission)));
  desktopSession.setPermissionCheckHandler((webContents, permission) => canWriteClipboard(webContents, permission));
  desktopSession.setDevicePermissionHandler(() => false);
  if (officeEnrollment) {
    const trustedHost = new URL(officeEnrollment.backendOrigin).hostname;
    desktopSession.setCertificateVerifyProc((request, callback) => {
      if (request.hostname === trustedHost && certificateMatchesEnrollment(officeEnrollment, request.certificate)) {
        callback(0);
        return;
      }
      callback(-3);
    });
  }
  desktopSession.on("will-download", (_event, item) => {
    const downloadUrl = new URL(item.getURL());
    void writeDiagnostic("download-started", {
      filename: item.getFilename(),
      url: `${downloadUrl.origin}${downloadUrl.pathname}`,
    });
  });
}

async function runWindowsServiceCommand(command) {
  if (process.platform !== "win32") throw new Error("Office-host mode requires Windows.");
  return new Promise((resolve, reject) => {
    const child = spawn("sc.exe", [command, "NautexOfficeHost"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code: code ?? -1, output }));
  });
}

async function ensureOfficeHostServiceStarted() {
  const started = await runWindowsServiceCommand("start");
  if (started.code === 0) return;
  const status = await runWindowsServiceCommand("query");
  if (status.code !== 0 || !status.output.includes("RUNNING")) {
    throw new Error("The Nautex Office Host service is not installed or could not be started. Run the office-host setup tool as administrator.");
  }
}

async function resolveOfficeEnrollment(mode, configuredOrigin, configuredFingerprint) {
  const explicitPath = commandLineValue("--nautex-enrollment=") || process.env.NAUTEX_DESKTOP_ENROLLMENT_PROFILE;
  const storedPath = mode === DESKTOP_DEPLOYMENT_MODES.OFFICE_HOST
    ? path.join(process.env.ProgramData || "C:\\ProgramData", "Nautex", "office-client-profile.json")
    : path.join(app.getPath("userData"), "office-client-profile.json");
  let profilePath = explicitPath || storedPath;
  let profile = null;
  try {
    profile = await readOfficeEnrollment(profilePath);
  } catch (error) {
    if (explicitPath || mode === DESKTOP_DEPLOYMENT_MODES.OFFICE_HOST) throw error;
    if (configuredOrigin) {
      return configuredFingerprint
        ? {
            type: "nautex-office-enrollment",
            formatVersion: 1,
            officeName: "Configured office",
            backendOrigin: configuredOrigin,
            certificateSha256: normalizeCertificateSha256(configuredFingerprint),
          }
        : null;
    }
    if (isSmokeTest) throw new Error("An office enrollment profile is required.");
    const selected = await dialog.showOpenDialog({
      title: "Connect Nautex to your office",
      message: "Select the enrollment profile provided by the Nautex office-host administrator.",
      properties: ["openFile"],
      filters: [{ name: "Nautex office enrollment", extensions: ["json", "nautex-office"] }],
    });
    if (selected.canceled || !selected.filePaths[0]) throw new Error("Office enrollment was cancelled.");
    profilePath = selected.filePaths[0];
    profile = await readOfficeEnrollment(profilePath);
  }
  if (mode === DESKTOP_DEPLOYMENT_MODES.OFFICE_CLIENT && profilePath !== storedPath) {
    await writeOfficeEnrollment(storedPath, profile);
  }
  return profile;
}

function openExternalIfAllowed(value) {
  if (isAllowedExternalUrl(value)) void shell.openExternal(value);
}

function rendererDirectory() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "renderer")
    : path.resolve(".desktop-build/renderer");
}

async function proxyApiRequest(request, desktopSession) {
  const targetUrl = resolveBackendRequestUrl(request.url, backendOrigin);
  if (!targetUrl) return new Response("Not found", { status: 404 });

  const headers = new Headers(request.headers);
  for (const name of ["host", "origin", "cookie", "content-length"]) headers.delete(name);
  for (const name of [...headers.keys()]) {
    if (name.startsWith("sec-fetch-")) headers.delete(name);
  }
  headers.set("x-nautex-desktop", "1");
  headers.set("origin", backendOrigin);

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  try {
    return await desktopSession.fetch(targetUrl, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      duplex: hasBody ? "half" : undefined,
      credentials: "include",
      bypassCustomProtocolHandlers: true,
    });
  } catch (error) {
    await writeDiagnostic("backend-request-failed", { message: error.message, path: new URL(targetUrl).pathname });
    return Response.json(
      { ok: false, error: { code: "BACKEND_UNAVAILABLE", message: "The Nautex backend is unavailable." } },
      { status: 503 },
    );
  }
}

async function serveRendererRequest(request, desktopSession) {
  const url = new URL(request.url);
  if (url.hostname !== "renderer") return new Response("Forbidden", { status: 403 });
  if (url.pathname.startsWith("/api/")) return proxyApiRequest(request, desktopSession);

  const root = path.resolve(rendererDirectory());
  let relativePath;
  try {
    relativePath = decodeURIComponent(url.pathname).replace(/^[/\\]+/, "") || "index.html";
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const filePath = path.resolve(root, relativePath);
  if (filePath !== root && !filePath.toLowerCase().startsWith(`${root.toLowerCase()}${path.sep}`)) {
    return new Response("Forbidden", { status: 403 });
  }
  return net.fetch(pathToFileURL(filePath).toString());
}

async function registerRendererProtocol(desktopSession) {
  await desktopSession.protocol.handle("nautex-app", (request) => serveRendererRequest(request, desktopSession));
}

function secureWebContents(webContents) {
  webContents.on("console-message", (_event, details, legacyMessage, legacyLine, legacySourceId) => {
    const structured = typeof details === "object" && details;
    void writeDiagnostic("renderer-console", {
      level: structured ? details.level : details,
      message: structured ? details.message : String(legacyMessage || ""),
      line: structured ? details.lineNumber : legacyLine,
      sourceId: structured ? details.sourceId : legacySourceId,
    });
  });
  webContents.on("preload-error", (_event, preloadPath, error) => {
    void writeDiagnostic("preload-error", { preloadPath, message: error.message });
  });
  webContents.on("will-navigate", (event, url) => {
    if (isAllowedRendererUrl(url, RENDERER_ORIGIN)) {
      showingStartupError = false;
      return;
    }
    event.preventDefault();
    const downloadUrl = resolveBackendRequestUrl(url, backendOrigin);
    if (downloadUrl) {
      webContents.downloadURL(downloadUrl);
      return;
    }
    openExternalIfAllowed(url);
  });
  webContents.setWindowOpenHandler(({ url }) => {
    const downloadUrl = resolveBackendRequestUrl(url, backendOrigin);
    if (downloadUrl) webContents.downloadURL(downloadUrl);
    else openExternalIfAllowed(url);
    return { action: "deny" };
  });
  webContents.on("will-attach-webview", (event) => event.preventDefault());
  webContents.on("context-menu", (_event, params) => {
    const template = params.isEditable
      ? [
          { role: "undo", enabled: params.editFlags.canUndo },
          { role: "redo", enabled: params.editFlags.canRedo },
          { type: "separator" },
          { role: "cut", enabled: params.editFlags.canCut },
          { role: "copy", enabled: params.editFlags.canCopy },
          { role: "paste", enabled: params.editFlags.canPaste },
          { role: "selectAll", enabled: params.editFlags.canSelectAll },
        ]
      : [
          { role: "copy", enabled: Boolean(params.selectionText) },
          { role: "selectAll" },
        ];
    Menu.buildFromTemplate(template).popup({ window: BrowserWindow.fromWebContents(webContents) ?? undefined });
  });
  webContents.on("render-process-gone", (_event, details) => {
    void writeDiagnostic("renderer-gone", { reason: details.reason, exitCode: details.exitCode });
  });
  webContents.on("unresponsive", () => void writeDiagnostic("renderer-unresponsive"));
}

function deliverDeepLink(value) {
  const deepLink = findDeepLink([value]);
  if (!deepLink) return;
  if (!mainWindow || mainWindow.webContents.isLoading()) {
    pendingDeepLink = deepLink;
    return;
  }
  mainWindow.webContents.send("nautex:deep-link", deepLink);
  mainWindow.show();
  mainWindow.focus();
}

async function createWindow(desktopSession) {
  await markSmoke("create-window");
  const windowIcon = app.isPackaged
    ? path.join(process.resourcesPath, "nautex-icon.png")
    : path.resolve("build/nautex-icon-256.png");

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    show: !isSmokeTest,
    backgroundColor: "#020609",
    icon: windowIcon,
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      additionalArguments: [
        `--nautex-backend-origin=${encodeURIComponent(backendOrigin)}`,
        `--nautex-deployment-mode=${encodeURIComponent(deploymentMode)}`,
        `--nautex-workspace=${workspace.demonstration ? "demonstration" : "operational"}`,
      ],
      partition: SESSION_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: !app.isPackaged,
    },
  });

  secureWebContents(mainWindow.webContents);
  const title = `Nautex ${app.getVersion()}${releaseLabel} — ${workspace.demonstration ? "DEMONSTRATION · Synthetic data" : "Operational workspace"}`;
  mainWindow.setTitle(title);
  mainWindow.on("page-title-updated", event => { event.preventDefault(); mainWindow?.setTitle(title); });
  mainWindow.once("ready-to-show", () => {
    if (!isSmokeTest) mainWindow?.show();
  });
  mainWindow.webContents.once("did-finish-load", async () => {
    await markSmoke("did-finish-load");
    if (pendingDeepLink) {
      mainWindow?.webContents.send("nautex:deep-link", pendingDeepLink);
      pendingDeepLink = null;
    }
    if (isSmokeTest) {
      const result = await mainWindow?.webContents.executeJavaScript(`(async () => {
        const health = await fetch("/api/v1/system/health").then((response) => response.json());
        let localAuthProxyOk = true;
        if (${deploymentMode === DESKTOP_DEPLOYMENT_MODES.STANDALONE}) {
          const bootstrapState = await fetch("/api/v1/auth/bootstrap").then((response) => response.json());
          if (bootstrapState?.data?.required) {
            const setup = await fetch("/api/v1/auth/bootstrap", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ companyName: "Nautex Packaged Smoke", name: "Smoke Administrator", email: "admin@packaged-smoke.test", password: "Packaged-Smoke-Admin-2026" })
            });
            localAuthProxyOk = setup.status === 201;
          }
          const signIn = await fetch("/api/auth/sign-in/email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: "admin@packaged-smoke.test", password: "Packaged-Smoke-Admin-2026" })
          });
          const context = await fetch("/api/v1/auth/context");
          const contextBody = await context.json();
          localAuthProxyOk = localAuthProxyOk && signIn.ok && context.ok && contextBody?.data?.roles?.includes("admin");
        }
        return {
          bridge: Boolean(window.nautexDesktop),
          origin: window.nautexDesktop?.backendOrigin,
          usesApiProxy: window.nautexDesktop?.usesApiProxy,
          apiProxyOk: health?.ok === true,
          localAuthProxyOk,
          rootContentLength: document.getElementById("root")?.innerHTML.length || 0,
          nodeGlobal: typeof process
        };
      })()`);
      const smokeResult = `NAUTEX_ELECTRON_SMOKE=${JSON.stringify(result)}`;
      console.info(smokeResult);
      if (process.env.NAUTEX_DESKTOP_SMOKE_RESULT) {
        await appendFile(process.env.NAUTEX_DESKTOP_SMOKE_RESULT, `${smokeResult}\n`, "utf8");
      }
      const exitCode = result?.bridge && result?.origin === backendOrigin && result?.usesApiProxy === true
        && result?.apiProxyOk && result?.localAuthProxyOk && result?.rootContentLength > 0
        && result?.nodeGlobal === "undefined" ? 0 : 1;
      // Bounded, opt-in measurement in an isolated smoke profile only.
      const idleMs = Math.min(120000, Math.max(0, Number(process.env.NAUTEX_DESKTOP_SMOKE_IDLE_MS) || 0));
      if (idleMs && process.env.NAUTEX_DESKTOP_SMOKE_RESULT) {
        const coldReadyMs = Date.now() - smokeStartedAt;
        app.getAppMetrics();
        await new Promise((resolve) => setTimeout(resolve, idleMs));
        const metrics = app.getAppMetrics().map(({ type, cpu, memory }) => ({ type, cpu, memory }));
        await appendFile(process.env.NAUTEX_DESKTOP_SMOKE_RESULT, `NAUTEX_ELECTRON_METRICS=${JSON.stringify({ coldReadyMs, idleMs, metrics, scope: "Electron processes only; excludes PostgreSQL and backend; fresh synthetic profile including database initialization" })}\n`, "utf8");
      }
      managedShutdownStarted = true;
      await managedLocalRuntime?.stop().catch((error) => markSmoke("local-runtime-stop-failed", {
        message: error.message,
      }));
      managedLocalRuntime = null;
      app.exit(exitCode);
    }
  });
  mainWindow.webContents.on("did-fail-load", async (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || showingStartupError) return;
    await markSmoke("did-fail-load", { errorCode, errorDescription });
    if (isSmokeTest) app.exit(1);
    showingStartupError = true;
    await writeDiagnostic("renderer-load-failed", { errorCode, errorDescription, url: validatedURL });
    await mainWindow?.loadFile(path.join(__dirname, "startup-error.html"), {
      query: { failedUrl: validatedURL },
    });
    mainWindow?.show();
  });
  mainWindow.on("closed", () => { mainWindow = null; });

  try {
    await mainWindow.loadURL(RENDERER_ENTRY);
    showingStartupError = false;
  } catch {
    // did-fail-load renders the visible connection state.
  }
}

function configureCrashReporting() {
  if (workspace.demonstration) return;
  let submitURL = "";
  try {
    submitURL = normalizeOptionalHttpsUrl(
      runtimeConfig.crashSubmitUrl,
      "Crash reporting URL",
    );
  } catch (error) {
    void writeDiagnostic("crash-config-rejected", { message: error.message });
  }
  crashReporter.start({
    companyName: "Nautex",
    productName: "Nautex",
    submitURL,
    uploadToServer: Boolean(submitURL),
    compress: true,
  });
}

function configureUpdates() {
  if (!app.isPackaged || isSmokeTest || workspace.demonstration) return;
  let updateUrl = "";
  try {
    updateUrl = normalizeOptionalHttpsUrl(
      runtimeConfig.updateUrl,
      "Update URL",
    );
  } catch (error) {
    void writeDiagnostic("update-config-rejected", { message: error.message });
    return;
  }
  if (!updateUrl) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.setFeedURL({ provider: "generic", url: updateUrl });
  autoUpdater.on("error", (error) => void writeDiagnostic("update-error", { message: error.message }));
  autoUpdater.on("update-available", async (info) => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Nautex update available",
      message: `Nautex ${info.version} is available.`,
      detail: "Download the signed update now? You can continue working while it downloads.",
      buttons: ["Download", "Later"],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response === 0) await autoUpdater.downloadUpdate();
  });
  autoUpdater.on("update-downloaded", async (info) => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Nautex update ready",
      message: `Nautex ${info.version} is ready to install.`,
      detail: "Restart Nautex now to complete the update.",
      buttons: ["Restart and install", "Later"],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response === 0) autoUpdater.quitAndInstall(false, true);
  });
  setTimeout(() => void autoUpdater.checkForUpdates().catch((error) => {
    void writeDiagnostic("update-check-failed", { message: error.message });
  }), 15_000);
}

async function startApplication() {
  await ensureWorkspace(workspace);
  await app.whenReady();
  await markSmoke("app-ready");
  app.setAppLogsPath();
  runtimeConfig = await readRuntimeConfig();
  await markSmoke("runtime-config-loaded", { deploymentMode: runtimeConfig.deploymentMode });

  if (process.platform === "win32") {
    app.setAppUserModelId("org.oasisai.nautex.community");
    // Community builds do not replace the private Nautex protocol registration.
  }
  await markSmoke("platform-registration-complete");
  const secureStorageAvailable = safeStorage.isEncryptionAvailable();
  await markSmoke("secure-storage-checked", { available: secureStorageAvailable });
  if (!secureStorageAvailable) {
    const message = "Windows secure storage is unavailable; Nautex cannot protect persistent session material.";
    if (app.isPackaged) {
      if (!isSmokeTest) dialog.showErrorBox("Nautex secure storage unavailable", message);
      app.exit(1);
      return;
    }
    await writeDiagnostic("secure-storage-unavailable");
  }

  let configuredOrigin = "";
  const configuredMode = DESKTOP_DEPLOYMENT_MODES.STANDALONE;
  try {
    deploymentMode = normalizeDeploymentMode(configuredMode);
    if (!configuredOrigin && !app.isPackaged && deploymentMode === DESKTOP_DEPLOYMENT_MODES.DEVELOPMENT) configuredOrigin = "http://localhost:3000";
    if (deploymentMode === DESKTOP_DEPLOYMENT_MODES.OFFICE_CLIENT
      || deploymentMode === DESKTOP_DEPLOYMENT_MODES.OFFICE_HOST) {
      officeEnrollment = await resolveOfficeEnrollment(
        deploymentMode,
        configuredOrigin,
        process.env.NAUTEX_DESKTOP_CERTIFICATE_SHA256 || runtimeConfig.certificateSha256,
      );
      if (officeEnrollment) configuredOrigin = officeEnrollment.backendOrigin;
    }
    const topology = validateTopologyConfiguration(
      { mode: deploymentMode, backendOrigin: configuredOrigin },
      { allowDevelopment: !app.isPackaged || isSmokeTest || runtimeConfig.allowLocalhostHttp === true },
    );
    if (deploymentMode === DESKTOP_DEPLOYMENT_MODES.STANDALONE) {
      const resourcesRoot = app.isPackaged
        ? path.join(process.resourcesPath, "local-runtime")
        : path.resolve(".desktop-build");
      managedLocalRuntime = await startManagedLocalRuntime({
        resourcesRoot,
        userDataRoot: app.getPath("userData"),
        safeStorage,
        nodeExecutable: process.execPath,
        electronNode: true,
        demonstration: workspace.demonstration,
        onDiagnostic: async (event, details) => {
          await Promise.all([writeDiagnostic(event, details), markSmoke(event, details)]);
        },
      });
      backendOrigin = managedLocalRuntime.backendOrigin;
    } else if (deploymentMode === DESKTOP_DEPLOYMENT_MODES.OFFICE_HOST) {
      await ensureOfficeHostServiceStarted();
      backendOrigin = topology.backendOrigin;
    } else {
      backendOrigin = topology.backendOrigin;
    }
  } catch (error) {
    await markSmoke("configuration-error", { message: error.message });
    await managedLocalRuntime?.stop().catch(() => undefined);
    managedLocalRuntime = null;
    if (!isSmokeTest) {
      const response = await dialog.showMessageBox({ type: "error", title: "Nautex startup stopped", message: error.message, buttons: ["Close", "Restore a recovery snapshot…"], defaultId: 0, cancelId: 0 });
      if (response.response === 1) await restoreFromMenu();
    }
    app.exit(1);
    return;
  }

  configureCrashReporting();
  desktopSession = session.fromPartition(SESSION_PARTITION);
  configureSession(desktopSession);
  await registerRendererProtocol(desktopSession);
  configureIpc();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "Workspace", submenu: [
      { label: workspace.demonstration ? "Demonstration — synthetic data" : "Operational workspace", enabled: false },
      { label: "Open recovery snapshots", click: () => shell.openPath(path.join(workspace.root, "backups")) },
      { label: "Back up workspace and close…", enabled: deploymentMode === DESKTOP_DEPLOYMENT_MODES.STANDALONE, click: backupFromMenu },
      { label: "Create portable recovery copy…", enabled: deploymentMode === DESKTOP_DEPLOYMENT_MODES.STANDALONE, click: () => backupFromMenu(true) },
      { label: "Restore a recovery snapshot…", click: restoreFromMenu },
      { label: "Restore portable recovery copy…", enabled: deploymentMode === DESKTOP_DEPLOYMENT_MODES.STANDALONE, click: () => restoreFromMenu(true) },
      { type: "separator" }, { role: "quit" },
    ] },
    { role: "editMenu" }, { role: "viewMenu" },
    { label: "Help", submenu: [
      { label: "About / Legal", click: () => dialog.showMessageBox(mainWindow, { title: "Nautex AI", message: `Nautex AI ${releasePackage.version}`, detail: "Copyright 2026 Zlatin Gorov. OASIS AI project. AGPL-3.0-only. No warranty. Commercial use is permitted under the licence. Exact corresponding source and third-party notices are included in Help → Corresponding source and licences." }) },
      { label: "Corresponding source and licences", click: () => shell.openPath(path.join(process.resourcesPath, "legal")) },
    ] },
  ]));
  await createWindow(desktopSession);
  configureUpdates();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && desktopSession) void createWindow(desktopSession);
  });
}

let recoveryBusy = false;
async function backupFromMenu(portable = false) {
  portable = portable === true; // Electron's click callback supplies a MenuItem.
  if (recoveryBusy || !managedLocalRuntime) return;
  recoveryBusy = true;
  let started = false;
  try {
    let password, portableDestination;
    if (portable) {
      password = await requestRecoveryPassword({ BrowserWindow, ipcMain, parent: mainWindow, exporting: true });
      if (!password) return;
      const selected = await dialog.showOpenDialog({ title: "Choose a protected destination for the encrypted recovery copy", properties: ["openDirectory", "createDirectory"] });
      if (selected.canceled || !selected.filePaths[0]) return;
      portableDestination = path.join(selected.filePaths[0], `Nautex-Recovery-${Date.now()}`);
    }
    const confirm = await dialog.showMessageBox({ type: "question", title: "Back up Nautex", message: "Back up this workspace and close Nautex?", detail: portable ? "Save your work first. Nautex will verify a local snapshot and create an encrypted portable copy at your chosen destination. Keep the recovery password separately; losing it makes the portable copy unusable. Nautex will close when finished." : "Save your work first. Nautex will pause database writes, verify a snapshot of the database and stored documents, then close. Copy the complete snapshot folder to your protected backup drive afterwards. Recovery requires this Windows account and the original Nautex profile's secure-storage state. Do not delete that profile; this snapshot alone is not recovery from a lost PC or profile.", buttons: ["Cancel", "Back up and close"], defaultId: 0, cancelId: 0 });
    if (confirm.response !== 1) return;
    started = true; mainWindow?.hide();
    const directory = await managedLocalRuntime.backupAndStop();
    managedLocalRuntime = null;
    if (portable) {
      await exportPortableRecovery({ directory, destination: portableDestination, password, safeStorage });
      await writeFile(path.join(workspace.root, "backups", "portable-recovery-status.json"), JSON.stringify({ version: 1, verifiedAt: new Date().toISOString() }));
    }
    password = undefined;
    await dialog.showMessageBox({ type: "info", title: "Backup verified", message: portable ? "Encrypted portable recovery copy created from the verified snapshot." : "The workspace backup passed its integrity checks.", detail: `${portableDestination || directory}\n\nNautex will now close. Reopen it to continue work.` });
  } catch (error) {
    await dialog.showMessageBox({ type: "error", title: "Backup not completed", message: "No successful backup is being reported.", detail: `${error.message}\nYour existing workspace was not replaced. Reopen Nautex and retry after resolving the error.` });
  } finally {
    recoveryBusy = false;
    if (started) app.quit();
  }
}

async function restoreFromMenu(portable = false) {
  portable = portable === true;
  if (recoveryBusy) return;
  recoveryBusy = true;
  try {
  const selected = await dialog.showOpenDialog({ title: "Select a trusted Nautex recovery snapshot", properties: ["openDirectory"], defaultPath: path.join(workspace.root, "backups") });
  if (selected.canceled || !selected.filePaths[0]) return;
  try {
    let directory = selected.filePaths[0];
    if (portable) {
      const password = await requestRecoveryPassword({ BrowserWindow, ipcMain, parent: mainWindow, exporting: false });
      if (!password) return;
      directory = await importPortableRecovery({ directory, profileRoot: workspace.root, password, safeStorage });
    }
    const manifest = await verifyUpgradeBackup(directory);
    const confirm = await dialog.showMessageBox({ type: "warning", title: "Restore Nautex data", message: "Restore this recovery snapshot and close Nautex?", detail: `Snapshot created ${manifest.createdAt}. Target: ${workspace.demonstration ? "demonstration" : "operational"} workspace. Save current work first. Current database and documents will be preserved in a recovery folder. ${portable ? "The portable copy passed authentication and was re-encrypted for this Windows profile." : "Use the original Windows account and Nautex profile with its secure-storage state."} Use the release matching the snapshot when recovering an earlier version.`, buttons: ["Cancel", "Restore and close"], defaultId: 0, cancelId: 0 });
    if (confirm.response !== 1) return;
    mainWindow?.hide();
    await managedLocalRuntime?.stop(); managedLocalRuntime = null;
    const resources = app.isPackaged ? path.join(process.resourcesPath, "local-runtime") : path.resolve(".desktop-build");
    await restoreUpgradeBackup({ directory, profileRoot: workspace.root, postgresRoot: path.join(resources, "postgresql"), safeStorage });
    await dialog.showMessageBox({ type: "info", title: "Recovery complete", message: "Database and documents restored. Nautex will now close.", detail: "For a rollback, install the release matching this snapshot before reopening Nautex. Reopening a newer release applies its migrations again." });
    app.quit();
  } catch (error) {
    dialog.showErrorBox("Nautex recovery stopped", error.message);
    // A stopped runtime must never leave an apparently working window behind.
    if (!managedLocalRuntime) app.quit(); else mainWindow?.show();
  }
  } finally { recoveryBusy = false; }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    const deepLink = findDeepLink(commandLine);
    if (deepLink) deliverDeepLink(deepLink);
    mainWindow?.restore();
    mainWindow?.focus();
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    deliverDeepLink(url);
  });
  void startApplication().catch(async (error) => {
    console.error("Nautex desktop startup failed.", error);
    await markSmoke("startup-failed", { message: error.message });
    if (error.code === "RECOVERY_INTERRUPTED" && app.isReady() && !isSmokeTest) {
      const answer = await dialog.showMessageBox({ type: "warning", title: "Finish workspace recovery", message: error.message, detail: "Choose a verified snapshot or encrypted portable recovery copy. Nautex will preserve the interrupted workspace before restoring.", buttons: ["Close", "Restore local snapshot", "Restore portable copy"], defaultId: 0, cancelId: 0 });
      if (answer.response > 0) await restoreFromMenu(answer.response === 2);
      app.quit();
      return;
    }
    if (app.isReady() && !isSmokeTest) dialog.showErrorBox("Nautex startup failed", error.message);
    await managedLocalRuntime?.stop().catch(() => undefined);
    managedLocalRuntime = null;
    app.exit(1);
  });
}

app.on("before-quit", (event) => {
  if (!managedLocalRuntime || managedShutdownStarted) return;
  event.preventDefault();
  managedShutdownStarted = true;
  void managedLocalRuntime.stop()
    .catch((error) => writeDiagnostic("local-runtime-stop-failed", { message: error.message }))
    .finally(() => {
      managedLocalRuntime = null;
      app.quit();
    });
});
app.on("window-all-closed", () => app.quit());
app.on("child-process-gone", (_event, details) => {
  void writeDiagnostic("child-process-gone", { type: details.type, reason: details.reason, exitCode: details.exitCode });
});
