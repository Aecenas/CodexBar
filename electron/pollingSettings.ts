import type { PollingSettings } from "./types.js";

export const DEFAULT_POLLING_SETTINGS: PollingSettings = {
  activityCheckSeconds: 10,
  busyQuotaSeconds: 30,
  idleQuotaSeconds: 30 * 60
};

export const MIN_POLLING_SETTINGS: PollingSettings = {
  activityCheckSeconds: 5,
  busyQuotaSeconds: 15,
  idleQuotaSeconds: 5 * 60
};

export const MAX_POLLING_SETTINGS: PollingSettings = {
  activityCheckSeconds: 2_100_000,
  busyQuotaSeconds: 2_100_000,
  idleQuotaSeconds: 35_000 * 60
};

export function normalizePollingSettings(settings: Partial<PollingSettings>): PollingSettings {
  return {
    activityCheckSeconds: clampSetting(
      settings.activityCheckSeconds,
      MIN_POLLING_SETTINGS.activityCheckSeconds,
      MAX_POLLING_SETTINGS.activityCheckSeconds,
      DEFAULT_POLLING_SETTINGS.activityCheckSeconds
    ),
    busyQuotaSeconds: clampSetting(
      settings.busyQuotaSeconds,
      MIN_POLLING_SETTINGS.busyQuotaSeconds,
      MAX_POLLING_SETTINGS.busyQuotaSeconds,
      DEFAULT_POLLING_SETTINGS.busyQuotaSeconds
    ),
    idleQuotaSeconds: clampSetting(
      settings.idleQuotaSeconds,
      MIN_POLLING_SETTINGS.idleQuotaSeconds,
      MAX_POLLING_SETTINGS.idleQuotaSeconds,
      DEFAULT_POLLING_SETTINGS.idleQuotaSeconds
    )
  };
}

function clampSetting(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}
