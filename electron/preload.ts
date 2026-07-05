import { contextBridge, ipcRenderer } from "electron";
import type { PollingSettings, QuotaUpdatePayload, VisualSize } from "./types.js";

contextBridge.exposeInMainWorld("codexBar", {
  onQuotaUpdate(callback: (payload: QuotaUpdatePayload) => void) {
    const listener = (_event: Electron.IpcRendererEvent, payload: QuotaUpdatePayload) => callback(payload);
    ipcRenderer.on("quota:update", listener);
    return () => ipcRenderer.off("quota:update", listener);
  },
  setPanelExpanded(expanded: boolean) {
    ipcRenderer.send("panel:set-expanded", expanded);
  },
  setVisualSize(visualSize: VisualSize) {
    ipcRenderer.send("panel:set-visual-size", visualSize);
  },
  getPollingSettings() {
    return ipcRenderer.invoke("polling:get-settings") as Promise<PollingSettings>;
  },
  setPollingSettings(settings: PollingSettings) {
    return ipcRenderer.invoke("polling:set-settings", settings) as Promise<PollingSettings>;
  }
});
