const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("recovery", Object.freeze({ submit: value => ipcRenderer.send("nautex:recovery-password", value) }));
