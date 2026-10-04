import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));

export function requestRecoveryPassword({ BrowserWindow, ipcMain, parent, exporting }) {
  return new Promise((resolve, reject) => {
    const window = new BrowserWindow({ parent: parent ?? undefined, modal: Boolean(parent), width: 640, height: 520, resizable: false, show: false, autoHideMenuBar: true, title: "Nautex recovery password", webPreferences: { preload: path.join(root, "recovery-preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false } });
    let answer = null;
    const submit = (event, value) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return;
      if (typeof value === "string" && value.length >= 16 && value.length <= 256) answer = value;
      else if (value !== null) return;
      window.close();
    };
    ipcMain.on("nautex:recovery-password", submit);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", event => event.preventDefault());
    window.on("closed", () => { ipcMain.removeListener("nautex:recovery-password", submit); resolve(answer); });
    window.once("ready-to-show", () => window.show());
    window.loadFile(path.join(root, "recovery-password.html"), { query: { mode: exporting ? "export" : "restore" } }).catch(error => { window.close(); reject(error); });
  });
}
