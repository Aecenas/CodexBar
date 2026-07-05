import { useEffect, useState } from "react";
import type { AppSettings, PollingSettings, QuotaHistoryPoint, QuotaUpdatePayload } from "../types";
import { DEFAULT_APP_SETTINGS, DEFAULT_POLLING_SETTINGS, normalizeAppSettings, normalizePollingSettings } from "../pollingSettings";
import { CodexBar } from "./CodexBar";

const initialPayload: QuotaUpdatePayload = {
  fiveHourRemaining: null,
  weekRemaining: null,
  fiveHourResetAt: null,
  weekResetAt: null,
  status: "loading",
  activity: "unknown",
  fetchedAt: null
};

const HISTORY_STORAGE_KEY = "codexbar:quotaHistory:v1";
const APP_SETTINGS_STORAGE_KEY = "codexbar:appSettings:v1";
const POLLING_SETTINGS_STORAGE_KEY = "codexbar:pollingSettings:v1";
const HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function App() {
  const [quota, setQuota] = useState<QuotaUpdatePayload>(initialPayload);
  const [history, setHistory] = useState<QuotaHistoryPoint[]>(() => readHistory());
  const [appSettings, setAppSettingsState] = useState<AppSettings>(() => readAppSettings());

  useEffect(() => {
    return window.codexBar?.onQuotaUpdate((payload) => {
      setQuota(payload);
      setHistory((current) => updateHistory(current, payload));
    });
  }, []);

  useEffect(() => {
    const pollingSettings = pickPollingSettings(appSettings);
    void window.codexBar?.setPollingSettings(pollingSettings);
    window.codexBar?.setVisualSize(appSettings.visualSize);
  }, [appSettings]);

  function setAppSettings(settings: AppSettings): void {
    const normalized = normalizeAppSettings(settings);
    setAppSettingsState(normalized);
    writeAppSettings(normalized);
  }

  return <CodexBar quota={quota} history={history} appSettings={appSettings} onAppSettingsChange={setAppSettings} />;
}

function readHistory(): QuotaHistoryPoint[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as QuotaHistoryPoint[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isHistoryPoint).filter((point) => Date.now() - point.at <= HISTORY_RETENTION_MS);
  } catch {
    return [];
  }
}

function updateHistory(current: QuotaHistoryPoint[], payload: QuotaUpdatePayload): QuotaHistoryPoint[] {
  if (payload.fiveHourRemaining === null && payload.weekRemaining === null) {
    return current;
  }

  const point: QuotaHistoryPoint = {
    at: payload.fetchedAt ?? Date.now(),
    fiveHourRemaining: payload.fiveHourRemaining,
    weekRemaining: payload.weekRemaining
  };
  const next = [...current, point]
    .filter((entry) => point.at - entry.at <= HISTORY_RETENTION_MS)
    .slice(-1200);

  try {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // History is only used for the hover graph; quota display should continue if storage is unavailable.
  }

  return next;
}

function isHistoryPoint(value: QuotaHistoryPoint): value is QuotaHistoryPoint {
  return (
    typeof value?.at === "number" &&
    Number.isFinite(value.at) &&
    (typeof value.fiveHourRemaining === "number" || value.fiveHourRemaining === null) &&
    (typeof value.weekRemaining === "number" || value.weekRemaining === null)
  );
}

function readPollingSettings(): PollingSettings {
  try {
    const raw = window.localStorage.getItem(POLLING_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_POLLING_SETTINGS;
    }

    return normalizePollingSettings(JSON.parse(raw) as Partial<PollingSettings>);
  } catch {
    return DEFAULT_POLLING_SETTINGS;
  }
}

function writePollingSettings(settings: PollingSettings): void {
  try {
    window.localStorage.setItem(POLLING_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // The scheduler still receives settings for the current run when storage is unavailable.
  }
}

function readAppSettings(): AppSettings {
  try {
    const raw = window.localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
    if (raw) {
      return normalizeAppSettings(JSON.parse(raw) as Partial<AppSettings>);
    }

    return {
      ...DEFAULT_APP_SETTINGS,
      ...readPollingSettings()
    };
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

function writeAppSettings(settings: AppSettings): void {
  try {
    window.localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    writePollingSettings(pickPollingSettings(settings));
  } catch {
    // Settings still apply for the current run when storage is unavailable.
  }
}

function pickPollingSettings(settings: AppSettings): PollingSettings {
  return normalizePollingSettings({
    activityCheckSeconds: settings.activityCheckSeconds,
    busyQuotaSeconds: settings.busyQuotaSeconds,
    idleQuotaSeconds: settings.idleQuotaSeconds
  });
}
