import { contextBridge, ipcRenderer } from "electron";
import type { PollingSettings, QuotaUpdatePayload, UpdateDownloadProgress, UpdateStatus, VisualSize } from "./types.js";

contextBridge.exposeInMainWorld("codexBar", {
  onQuotaUpdate(callback: (payload: QuotaUpdatePayload) => void) {
    const listener = (_event: Electron.IpcRendererEvent, payload: QuotaUpdatePayload) => callback(payload);
    ipcRenderer.on("quota:update", listener);
    return () => ipcRenderer.off("quota:update", listener);
  },
  setPanelExpanded(expanded: boolean) {
    ipcRenderer.send("panel:set-expanded", expanded);
  },
  setBarCollapsed(collapsed: boolean) {
    ipcRenderer.send("bar:set-collapsed", collapsed);
  },
  setMousePassthrough(passthrough: boolean) {
    ipcRenderer.send("bar:set-mouse-passthrough", passthrough);
  },
  setVisualSize(visualSize: VisualSize) {
    ipcRenderer.send("panel:set-visual-size", visualSize);
  },
  getPollingSettings() {
    return ipcRenderer.invoke("polling:get-settings") as Promise<PollingSettings>;
  },
  setPollingSettings(settings: PollingSettings) {
    return ipcRenderer.invoke("polling:set-settings", settings) as Promise<PollingSettings>;
  },
  checkForUpdates() {
    return ipcRenderer.invoke("updates:check") as Promise<UpdateStatus>;
  },
  downloadAndInstallUpdate() {
    return ipcRenderer.invoke("updates:download-and-install") as Promise<UpdateStatus>;
  },
  onUpdateDownloadProgress(callback: (progress: UpdateDownloadProgress) => void) {
    const listener = (_event: Electron.IpcRendererEvent, progress: UpdateDownloadProgress) => callback(progress);
    ipcRenderer.on("updates:download-progress", listener);
    return () => ipcRenderer.off("updates:download-progress", listener);
  },
  openExternal(url: string) {
    ipcRenderer.send("app:open-external", url);
  }
});
