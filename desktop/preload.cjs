const { contextBridge, ipcRenderer } = require("electron");

const backendOriginArgument = process.argv.find((value) => value.startsWith("--nautex-backend-origin="));
const backendOrigin = backendOriginArgument
  ? decodeURIComponent(backendOriginArgument.slice("--nautex-backend-origin=".length))
  : "";
const deploymentModeArgument = process.argv.find((value) => value.startsWith("--nautex-deployment-mode="));
const deploymentMode = deploymentModeArgument
  ? decodeURIComponent(deploymentModeArgument.slice("--nautex-deployment-mode=".length))
  : "office-client";

contextBridge.exposeInMainWorld("nautexDesktop", Object.freeze({
  backendOrigin,
  deploymentMode,
  workspace: process.argv.includes("--nautex-workspace=demonstration") ? "demonstration" : "operational",
  usesApiProxy: true,
  platform: "win32",
  openExternal: (url) => ipcRenderer.invoke("nautex:open-external", url),
  openDownload: (url) => ipcRenderer.invoke("nautex:open-download", url),
  onDeepLink: (listener) => {
    if (typeof listener !== "function") return () => undefined;
    const handler = (_event, url) => listener(url);
    ipcRenderer.on("nautex:deep-link", handler);
    return () => ipcRenderer.removeListener("nautex:deep-link", handler);
  },
}));
