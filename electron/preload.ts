import { contextBridge, ipcRenderer } from "electron";
import type {
  AppDiagnostics,
  BarPosition,
  PanelLayout,
  PollingSettings,
  QuotaUpdatePayload,
  UpdateDownloadProgress,
  UpdateStatus,
  VisualSize
} from "./types.js";

contextBridge.exposeInMainWorld("codexBar", {
  onQuotaUpdate(callback: (payload: QuotaUpdatePayload) => void) {
    const listener = (_event: Electron.IpcRendererEvent, payload: QuotaUpdatePayload) => callback(payload);
    ipcRenderer.on("quota:update", listener);
    return () => ipcRenderer.off("quota:update", listener);
  },
  setPanelLayout(layout: PanelLayout) {
    ipcRenderer.send("panel:set-layout", layout);
  },
  setBarCollapsed(collapsed: boolean) {
    ipcRenderer.send("bar:set-collapsed", collapsed);
  },
  setMousePassthrough(passthrough: boolean) {
    ipcRenderer.send("bar:set-mouse-passthrough", passthrough);
  },
  setBarPositioning(enabled: boolean, x: number | null, displayId: number | null) {
    ipcRenderer.send("bar:set-positioning", { enabled, x, displayId });
  },
  startBarDrag(screenX: number, screenY: number) {
    ipcRenderer.send("bar:drag-start", { screenX, screenY });
  },
  moveBarDrag(screenX: number, screenY: number) {
    ipcRenderer.send("bar:drag-move", { screenX, screenY });
  },
  endBarDrag() {
    return ipcRenderer.invoke("bar:drag-end") as Promise<BarPosition | null>;
  },
  quitApp() {
    ipcRenderer.send("app:quit");
  },
  setVisualSize(visualSize: VisualSize) {
    ipcRenderer.send("panel:set-visual-size", visualSize);
  },
  getOpenAtLogin() {
    return ipcRenderer.invoke("app:get-open-at-login") as Promise<boolean>;
  },
  setOpenAtLogin(openAtLogin: boolean) {
    return ipcRenderer.invoke("app:set-open-at-login", openAtLogin) as Promise<boolean>;
  },
  getDiagnostics() {
    return ipcRenderer.invoke("app:get-diagnostics") as Promise<AppDiagnostics | null>;
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
  downloadAndInstallUpdate(downloadProxyPrefix?: string) {
    return ipcRenderer.invoke("updates:download-and-install", downloadProxyPrefix) as Promise<UpdateStatus>;
  },
  onUpdateDownloadProgress(callback: (progress: UpdateDownloadProgress) => void) {
    const listener = (_event: Electron.IpcRendererEvent, progress: UpdateDownloadProgress) => callback(progress);
    ipcRenderer.on("updates:download-progress", listener);
    return () => ipcRenderer.off("updates:download-progress", listener);
  }
});
