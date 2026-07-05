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
}

export interface CodexBarBridge {
  onQuotaUpdate(callback: (payload: QuotaUpdatePayload) => void): () => void;
  setPanelExpanded(expanded: boolean): void;
  setVisualSize(visualSize: VisualSize): void;
  getPollingSettings(): Promise<PollingSettings>;
  setPollingSettings(settings: PollingSettings): Promise<PollingSettings>;
}

declare global {
  interface Window {
    codexBar?: CodexBarBridge;
  }
}
