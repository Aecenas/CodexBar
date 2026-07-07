import { useEffect, useRef, useState } from "react";
import type { AppSettings, PollingSettings, QuotaHistoryPoint, QuotaUpdatePayload, UpdateStatus } from "../types";
import { DEFAULT_APP_SETTINGS, DEFAULT_POLLING_SETTINGS, normalizeAppSettings, normalizePollingSettings } from "../pollingSettings";
import {
  initialUpdateStatus,
  normalizeStoredUpdateStatus,
  UPDATE_CHECK_INTERVAL_MS
} from "../updateChecker";
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
const UPDATE_STATUS_STORAGE_KEY = "codexbar:updateStatus:v1";
const HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function App() {
  const [quota, setQuota] = useState<QuotaUpdatePayload>(initialPayload);
  const [history, setHistory] = useState<QuotaHistoryPoint[]>(() => readHistory());
  const [appSettings, setAppSettingsState] = useState<AppSettings>(() => readAppSettings());
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>(() => readUpdateStatus());
  const launchUpdateCheckStarted = useRef(false);

  useEffect(() => {
    return window.codexBar?.onQuotaUpdate((payload) => {
      setQuota(payload);
      setHistory((current) => updateHistory(current, payload));
    });
  }, []);

  useEffect(() => {
    return window.codexBar?.onUpdateDownloadProgress((progress) => {
      setUpdateStatus((current) => ({
        ...current,
        checking: false,
        downloading: true,
        downloadProgress: progress.percent,
        error: null
      }));
    });
  }, []);

  useEffect(() => {
    const pollingSettings = pickPollingSettings(appSettings);
    void window.codexBar?.setPollingSettings(pollingSettings);
    window.codexBar?.setVisualSize(appSettings.visualSize);
    window.codexBar?.setBarPositioning(appSettings.positionAdjustment, appSettings.barX);
  }, [appSettings]);

  useEffect(() => {
    if (launchUpdateCheckStarted.current) {
      return;
    }

    launchUpdateCheckStarted.current = true;
    void checkForUpdates();
  }, []);

  useEffect(() => {
    if (!appSettings.autoUpdateCheck) {
      return undefined;
    }

    const elapsed = updateStatus.lastCheckedAt === null ? UPDATE_CHECK_INTERVAL_MS : Date.now() - updateStatus.lastCheckedAt;
    const delay = Math.max(0, UPDATE_CHECK_INTERVAL_MS - elapsed);
    const timer = window.setTimeout(() => {
      void checkForUpdates();
    }, delay);

    return () => window.clearTimeout(timer);
  }, [appSettings.autoUpdateCheck, updateStatus.lastCheckedAt]);

  function setAppSettings(settings: AppSettings): void {
    const normalized = normalizeAppSettings(settings);
    setAppSettingsState(normalized);
    writeAppSettings(normalized);
  }

  async function checkForUpdates(): Promise<UpdateStatus> {
    setUpdateStatus((current) => ({ ...current, checking: true, error: null }));

    try {
      const next = await window.codexBar?.checkForUpdates();
      if (!next) {
        throw new Error("更新检查接口不可用。");
      }
      setUpdateStatus(next);
      writeUpdateStatus(next);
      return next;
    } catch (error) {
      const next: UpdateStatus = {
        ...initialUpdateStatus,
        latestVersion: updateStatus.latestVersion,
        releaseUrl: updateStatus.releaseUrl,
        updateAvailable: false,
        checking: false,
        downloading: false,
        downloadProgress: null,
        lastCheckedAt: Date.now(),
        error: error instanceof Error ? error.message : "检查更新失败"
      };
      setUpdateStatus(next);
      writeUpdateStatus(next);
      return next;
    }
  }

  async function upgradeApp(): Promise<UpdateStatus> {
    setUpdateStatus((current) => ({
      ...current,
      checking: true,
      downloading: false,
      downloadProgress: null,
      error: null
    }));

    try {
      const checked = await window.codexBar?.checkForUpdates();
      if (!checked) {
        throw new Error("更新检查接口不可用。");
      }

      setUpdateStatus(checked);
      writeUpdateStatus(checked);

      if (!checked.updateAvailable) {
        return checked;
      }

      const downloading: UpdateStatus = {
        ...checked,
        checking: false,
        downloading: true,
        downloadProgress: 0,
        error: null
      };
      setUpdateStatus(downloading);

      const installed = await window.codexBar?.downloadAndInstallUpdate();
      if (!installed) {
        throw new Error("下载安装接口不可用。");
      }

      const next = {
        ...installed,
        currentVersion: installed.latestVersion ?? installed.currentVersion,
        updateAvailable: false,
        checking: false,
        downloading: false,
        downloadProgress: 100
      };
      setUpdateStatus(next);
      writeUpdateStatus(next);
      return next;
    } catch (error) {
      const next: UpdateStatus = {
        ...initialUpdateStatus,
        latestVersion: updateStatus.latestVersion,
        releaseUrl: updateStatus.releaseUrl,
        updateAvailable: false,
        checking: false,
        downloading: false,
        downloadProgress: null,
        lastCheckedAt: Date.now(),
        error: error instanceof Error ? error.message : "升级失败"
      };
      setUpdateStatus(next);
      writeUpdateStatus(next);
      return next;
    }
  }

  return (
    <CodexBar
      quota={quota}
      history={history}
      appSettings={appSettings}
      updateStatus={updateStatus}
      onAppSettingsChange={setAppSettings}
      onCheckForUpdates={checkForUpdates}
      onUpgrade={upgradeApp}
    />
  );
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

function readUpdateStatus(): UpdateStatus {
  try {
    const raw = window.localStorage.getItem(UPDATE_STATUS_STORAGE_KEY);
    if (!raw) {
      return initialUpdateStatus;
    }

    return normalizeStoredUpdateStatus(JSON.parse(raw) as Partial<UpdateStatus>);
  } catch {
    return initialUpdateStatus;
  }
}

function writeUpdateStatus(status: UpdateStatus): void {
  try {
    const stored: UpdateStatus = {
      ...status,
      checking: false,
      downloading: false,
      downloadProgress: null
    };
    window.localStorage.setItem(UPDATE_STATUS_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Update checks are advisory; the app should continue if storage is unavailable.
  }
}

function pickPollingSettings(settings: AppSettings): PollingSettings {
  return normalizePollingSettings({
    activityCheckSeconds: settings.activityCheckSeconds,
    busyQuotaSeconds: settings.busyQuotaSeconds,
    idleQuotaSeconds: settings.idleQuotaSeconds
  });
}
