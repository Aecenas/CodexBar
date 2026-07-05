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
  week: RateLimitWindow;
  resetCredits: number | null;
  fetchedAt: number;
}

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

export interface PollingSettings {
  activityCheckSeconds: number;
  busyQuotaSeconds: number;
  idleQuotaSeconds: number;
}

export type VisualSize = "small" | "medium" | "large";
