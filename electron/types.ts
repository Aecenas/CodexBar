export type ActivityState = "busy" | "idle" | "unknown";

export type QuotaStatus = "loading" | "ready" | "stale" | "error";

export interface RateLimitWindow {
  usedPercent: number;
  remainingPercent: number;
  resetsAt: number | null;
  windowDurationMins: number | null;
}

export interface RateLimitSnapshot {
  limitId: string;
  planType: string | null;
  fiveHour: RateLimitWindow;
  week: RateLimitWindow | null;
  resetCredits: number | null;
  fetchedAt: number;
}

export interface QuotaUpdatePayload {
  fiveHourRemaining: number | null;
  weekRemaining: number | null;
  fiveHourResetAt: number | null;
  weekResetAt: number | null;
  fiveHourTokensUsed: number | null;
  weekTokensUsed: number | null;
  status: QuotaStatus;
  activity: ActivityState;
  fetchedAt: number | null;
  error?: string;
}

export interface UpdateDownloadProgress {
  receivedBytes: number;
  totalBytes: number | null;
  percent: number | null;
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

export interface PollingSettings {
  activityCheckSeconds: number;
  busyQuotaSeconds: number;
  idleQuotaSeconds: number;
}

export type VisualSize = "small" | "medium" | "large";

export type PanelMode = "none" | "fiveHour" | "week" | "settings" | "context";

export interface PanelLayout {
  mode: PanelMode;
  contextRect?: { x: number; y: number; width: number; height: number };
}

export interface BarPosition {
  x: number;
  displayId: number;
}

export interface ActivityDiagnostics {
  sessionsDir: string;
  lastProbeAt: number | null;
  lastSource: string;
  lastNewestSessionWriteAt: number | null;
  lastSessionActivityAt: number | null;
}

export interface TokenUsageDiagnostics {
  sessionsDir: string;
  cachedFiles: number;
  cachedBuckets: number;
  lastReadAt: number | null;
}

export interface AppDiagnostics {
  activity: ActivityState;
  quotaStatus: QuotaStatus;
  lastQuotaReadAt: number | null;
  lastQuotaError: string | null;
  lastQuotaFetchedAt: number | null;
  activityDetector: ActivityDiagnostics;
  tokenUsage: TokenUsageDiagnostics;
}
