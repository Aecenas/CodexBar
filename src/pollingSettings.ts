import type { AppSettings, PollingSettings } from "./types";

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

export const DEFAULT_APP_SETTINGS: AppSettings = {
  ...DEFAULT_POLLING_SETTINGS,
  visualSize: "medium",
  autoCollapse: false
};

export function normalizePollingSettings(settings: Partial<PollingSettings>): PollingSettings {
  return {
    activityCheckSeconds: clampSetting(
      settings.activityCheckSeconds,
      MIN_POLLING_SETTINGS.activityCheckSeconds,
      DEFAULT_POLLING_SETTINGS.activityCheckSeconds
    ),
    busyQuotaSeconds: clampSetting(
      settings.busyQuotaSeconds,
      MIN_POLLING_SETTINGS.busyQuotaSeconds,
      DEFAULT_POLLING_SETTINGS.busyQuotaSeconds
    ),
    idleQuotaSeconds: clampSetting(
      settings.idleQuotaSeconds,
      MIN_POLLING_SETTINGS.idleQuotaSeconds,
      DEFAULT_POLLING_SETTINGS.idleQuotaSeconds
    )
  };
}

export function normalizeAppSettings(settings: Partial<AppSettings>): AppSettings {
  const polling = normalizePollingSettings(settings);
  const visualSize =
    settings.visualSize === "small" || settings.visualSize === "medium" || settings.visualSize === "large"
      ? settings.visualSize
      : DEFAULT_APP_SETTINGS.visualSize;

  return {
    ...polling,
    visualSize,
    autoCollapse: settings.autoCollapse === true
  };
}

function clampSetting(value: unknown, min: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.round(value));
}
