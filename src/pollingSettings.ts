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

export const MAX_POLLING_SETTINGS: PollingSettings = {
  activityCheckSeconds: 2_100_000,
  busyQuotaSeconds: 2_100_000,
  idleQuotaSeconds: 35_000 * 60
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  ...DEFAULT_POLLING_SETTINGS,
  visualSize: "medium",
  autoCollapse: false,
  autoUpdateCheck: true,
  positionAdjustment: false,
  openAtLogin: false,
  downloadProxyPrefix: "",
  barX: null,
  barDisplayId: null
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

export function normalizeAppSettings(settings: Partial<AppSettings>): AppSettings {
  const polling = normalizePollingSettings(settings);
  const visualSize =
    settings.visualSize === "small" || settings.visualSize === "medium" || settings.visualSize === "large"
      ? settings.visualSize
      : DEFAULT_APP_SETTINGS.visualSize;

  return {
    ...polling,
    visualSize,
    autoCollapse: settings.autoCollapse === true,
    autoUpdateCheck: settings.autoUpdateCheck !== false,
    positionAdjustment: settings.positionAdjustment === true,
    openAtLogin: settings.openAtLogin === true,
    downloadProxyPrefix: normalizeDownloadProxyPrefix(settings.downloadProxyPrefix),
    barX: typeof settings.barX === "number" && Number.isFinite(settings.barX) ? Math.round(settings.barX) : null,
    barDisplayId:
      typeof settings.barDisplayId === "number" && Number.isFinite(settings.barDisplayId)
        ? Math.round(settings.barDisplayId)
        : null
  };
}

function normalizeDownloadProxyPrefix(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") {
      return "";
    }

    return url.toString();
  } catch {
    return "";
  }
}

function clampSetting(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}
