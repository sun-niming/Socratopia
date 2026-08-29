"use strict";

// electron/preload.ts
var import_electron = require("electron");
if (process.env.SOCRATOPIA_CI_HEADER_SECRET) {
  import_electron.contextBridge.exposeInMainWorld(
    "__SOCRATOPIA_CI_HEADER_SECRET",
    process.env.SOCRATOPIA_CI_HEADER_SECRET
  );
}
import_electron.contextBridge.exposeInMainWorld("electronAPI", {
  getApiKey: (provider) => import_electron.ipcRenderer.invoke("store:getApiKey", provider),
  setApiKey: (provider, key) => import_electron.ipcRenderer.invoke("store:setApiKey", provider, key),
  // P1-6.4: session token via safeStorage
  getSessionToken: () => import_electron.ipcRenderer.invoke("store:getSessionToken"),
  setSessionToken: (token) => import_electron.ipcRenderer.invoke("store:setSessionToken", token),
  getVersion: () => import_electron.ipcRenderer.invoke("app:getVersion"),
  getPlatform: () => process.platform,
  getAdaptiveCapability: () => import_electron.ipcRenderer.invoke("adaptive:getCapability"),
  // Generic account API callers share the same short-lived desktop
  // capability; no account/profile selector is accepted over IPC.
  getCapability: () => import_electron.ipcRenderer.invoke("adaptive:getCapability"),
  isPackaged: () => import_electron.ipcRenderer.invoke("app:isPackaged"),
  toggleMaximize: () => import_electron.ipcRenderer.send("window:toggleMaximize"),
  exportPdf: (html, defaultFilename, targetPath) => import_electron.ipcRenderer.invoke("pdf:export", html, defaultFilename, targetPath),
  // F3 (v103 audit): shell:openPath bridge removed — was unused (zero renderer
  // callers across v2/src) and provided an arbitrary-file-open primitive that
  // would be exploitable if DevTools or any code-injection path opened up.
  // Reach for openSocratopia() below for the constrained "open user data file"
  // use case (which has its own path validation in main.ts).
  openSocratopia: (path) => import_electron.ipcRenderer.invoke("shell:openSocratopia", path),
  getDeviceId: () => import_electron.ipcRenderer.invoke("device:getId"),
  getDeviceInfo: () => import_electron.ipcRenderer.invoke("device:getInfo"),
  // Auto-update (disabled for local deployment)
  checkForUpdate: () => Promise.resolve({ ok: false, error: "Auto-update disabled" }),
  downloadUpdate: () => Promise.resolve({ ok: false, error: "Auto-update disabled" }),
  cancelUpdate: () => Promise.resolve({ ok: true }),
  installUpdate: () => Promise.resolve({ ok: false, error: "Auto-update disabled" }),
  getLastUpdateStatus: () => Promise.resolve(null),
  onUpdateStatus: () => () => {}
});
