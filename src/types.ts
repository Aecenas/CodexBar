export type ActivityState = "busy" | "idle" | "unknown";
export type QuotaStatus = "loading" | "ready" | "stale" | "error";

export interface QuotaUpdatePayload {
  fiveHourRemaining: number | null;
  weekRemaining: number | null;
  fiveHourResetAt: number | null;
  weekResetAt: number | null;
  status: QuotaStatus;
  activity: ActivityState;
  fetchedAt: number | null;
  error?: string;
}

export interface QuotaHistoryPoint {
  at: number;
  fiveHourRemaining: number | null;
  weekRemaining: number | null;
}

export interface PollingSettings {
  activityCheckSeconds: number;
  busyQuotaSeconds: number;
  idleQuotaSeconds: number;
}

export type VisualSize = "small" | "medium" | "large";

export interface AppSettings extends PollingSettings {
  visualSize: VisualSize;
  autoCollapse: boolean;
  autoUpdateCheck: boolean;
  positionAdjustment: boolean;
  barX: number | null;
}

export interface UpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string;
  updateAvailable: boolean;
  checking: boolean;
  downloading: boolean;
  downloadProgress: number | null;
  lastCheckedAt: number | null;
  error: string | null;
}

export interface UpdateDownloadProgress {
  receivedBytes: number;
  totalBytes: number | null;
  percent: number | null;
}

export interface CodexBarBridge {
  onQuotaUpdate(callback: (payload: QuotaUpdatePayload) => void): () => void;
  setPanelExpanded(expanded: boolean): void;
  setBarCollapsed(collapsed: boolean): void;
  setMousePassthrough(passthrough: boolean): void;
  setBarPositioning(enabled: boolean, x: number | null): void;
  startBarDrag(screenX: number, screenY: number): void;
  moveBarDrag(screenX: number, screenY: number): void;
  endBarDrag(): Promise<number | null>;
  setVisualSize(visualSize: VisualSize): void;
  getPollingSettings(): Promise<PollingSettings>;
  setPollingSettings(settings: PollingSettings): Promise<PollingSettings>;
  checkForUpdates(): Promise<UpdateStatus>;
  downloadAndInstallUpdate(): Promise<UpdateStatus>;
  onUpdateDownloadProgress(callback: (progress: UpdateDownloadProgress) => void): () => void;
  openExternal(url: string): void;
}

declare global {
  interface Window {
    codexBar?: CodexBarBridge;
  }
}
