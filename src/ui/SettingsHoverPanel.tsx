import { useEffect, useState } from "react";
import type { AppSettings, UpdateStatus, VisualSize } from "../types";
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_POLLING_SETTINGS,
  MIN_POLLING_SETTINGS,
  normalizeAppSettings
} from "../pollingSettings";

interface SettingsHoverPanelProps {
  settings: AppSettings;
  updateStatus: UpdateStatus;
  onChange: (settings: AppSettings) => void;
  onUpgrade: () => Promise<UpdateStatus>;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

type IntervalSettingKey = "activityCheckSeconds" | "busyQuotaSeconds" | "idleQuotaSeconds";

const SETTINGS_ROWS: Array<{
  key: IntervalSettingKey;
  label: string;
  description: string;
  unit: string;
  displayDivisor: number;
}> = [
  {
    key: "activityCheckSeconds",
    label: "状态检查",
    description: "检查 Codex app 是否有线程正在活跃的时间间隔。",
    unit: "秒",
    displayDivisor: 1
  },
  {
    key: "busyQuotaSeconds",
    label: "活跃时轮询间隔",
    description: "有活跃线程时，读取 Codex 额度数据的时间间隔。",
    unit: "秒",
    displayDivisor: 1
  },
  {
    key: "idleQuotaSeconds",
    label: "空闲时轮询间隔",
    description: "没有活跃线程时，读取 Codex 额度数据的时间间隔。",
    unit: "分钟",
    displayDivisor: 60
  }
];

const VISUAL_SIZE_OPTIONS: Array<{ value: VisualSize; label: string }> = [
  { value: "small", label: "小" },
  { value: "medium", label: "中" },
  { value: "large", label: "大" }
];

export function SettingsHoverPanel({
  settings,
  updateStatus,
  onChange,
  onUpgrade,
  onPointerEnter,
  onPointerLeave
}: SettingsHoverPanelProps) {
  const [draftValues, setDraftValues] = useState<Record<IntervalSettingKey, string>>(() =>
    createDraftValues(settings)
  );
  const [upgradeHint, setUpgradeHint] = useState<string | null>(null);

  useEffect(() => {
    setDraftValues(createDraftValues(settings));
  }, [settings.activityCheckSeconds, settings.busyQuotaSeconds, settings.idleQuotaSeconds]);

  useEffect(() => {
    if (upgradeHint === null) {
      return undefined;
    }

    const timer = window.setTimeout(() => setUpgradeHint(null), 2_000);
    return () => window.clearTimeout(timer);
  }, [upgradeHint]);

  function updateDraftValue(key: IntervalSettingKey, value: string): void {
    if (!/^\d*$/.test(value)) {
      return;
    }

    setDraftValues((current) => ({
      ...current,
      [key]: value
    }));
  }

  function commitInterval(key: IntervalSettingKey, draftValue: string, displayDivisor: number): void {
    const displayValue = Number(draftValue);
    const min = MIN_POLLING_SETTINGS[key] / displayDivisor;
    const nextValue =
      Number.isFinite(displayValue) && displayValue >= min
        ? Math.round(displayValue * displayDivisor)
        : DEFAULT_POLLING_SETTINGS[key];

    const next = normalizeAppSettings({
      ...settings,
      [key]: nextValue
    });

    setDraftValues((current) => ({
      ...current,
      [key]: formatNumber(next[key] / displayDivisor)
    }));
    onChange(next);
  }

  function updateVisualSize(visualSize: VisualSize): void {
    onChange(normalizeAppSettings({ ...settings, visualSize }));
  }

  function updateAutoCollapse(autoCollapse: boolean): void {
    onChange(normalizeAppSettings({ ...settings, autoCollapse }));
  }

  function updateAutoUpdateCheck(autoUpdateCheck: boolean): void {
    onChange(normalizeAppSettings({ ...settings, autoUpdateCheck }));
  }

  async function handleUpgradeClick(): Promise<void> {
    const next = await onUpgrade();

    if (next.error) {
      setUpgradeHint("升级失败");
      return;
    }

    if (next.downloading || next.updateAvailable) {
      return;
    }

    setUpgradeHint("已是最新");
  }

  return (
    <aside
      className="settings-panel"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
      aria-label="CodexBar settings"
    >
      <div className="settings-panel-header">
        <span>运行设置</span>
        <button type="button" onClick={() => onChange(DEFAULT_APP_SETTINGS)}>
          恢复默认
        </button>
      </div>
      <div className="settings-panel-list">
        {SETTINGS_ROWS.map((row) => {
          const min = MIN_POLLING_SETTINGS[row.key] / row.displayDivisor;
          const defaultValue = DEFAULT_POLLING_SETTINGS[row.key] / row.displayDivisor;

          return (
            <label className="settings-row" key={row.key}>
              <span className="settings-row-text">
                <span className="settings-row-title">
                  <strong>{row.label}</strong>
                  <span className="settings-info" tabIndex={0} aria-label={row.description}>
                    i
                    <span className="settings-tooltip">{row.description}</span>
                  </span>
                </span>
                <small>
                  默认 {formatNumber(defaultValue)}
                  {row.unit} / 下限 {formatNumber(min)}
                  {row.unit}
                </small>
              </span>
              <span className="settings-row-control">
                <input
                  type="text"
                  inputMode="numeric"
                  value={draftValues[row.key]}
                  onChange={(event) => updateDraftValue(row.key, event.target.value)}
                  onBlur={(event) => commitInterval(row.key, event.target.value.trim(), row.displayDivisor)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur();
                    }
                  }}
                />
                <em>{row.unit}</em>
              </span>
            </label>
          );
        })}
      </div>
      <div className="settings-separator" />
      <div className="settings-extra-list">
        <div className="settings-extra-row">
          <span className="settings-row-title">
            <strong>视觉大小</strong>
            <span className="settings-info" tabIndex={0} aria-label="调整 CodexBar 在桌面顶部的整体显示大小。">
              i
              <span className="settings-tooltip">调整 CodexBar 在桌面顶部的整体显示大小。</span>
            </span>
          </span>
          <span className="settings-segmented" role="group" aria-label="视觉大小">
            {VISUAL_SIZE_OPTIONS.map((option) => (
              <button
                type="button"
                key={option.value}
                className={settings.visualSize === option.value ? "active" : ""}
                onClick={() => updateVisualSize(option.value)}
              >
                {option.label}
              </button>
            ))}
          </span>
        </div>
        <label className="settings-extra-row">
          <span className="settings-row-title">
            <strong>自动收缩</strong>
            <span className="settings-info" tabIndex={0} aria-label="空闲时收进屏幕顶部，只保留一条提示边；鼠标指向后完整展开，离开后约8秒收回。">
              i
              <span className="settings-tooltip">
                空闲时收进屏幕顶部，只保留一条提示边；鼠标指向后完整展开，离开后约8秒收回。
              </span>
            </span>
          </span>
          <input
            className="settings-toggle"
            type="checkbox"
            checked={settings.autoCollapse}
            onChange={(event) => updateAutoCollapse(event.target.checked)}
          />
        </label>
      </div>
      <div className="settings-separator settings-update-separator" />
      <div className="settings-update-row">
        <span className="settings-update-copy">
          <span className="settings-row-title">
            <strong>版本</strong>
            {updateStatus.updateAvailable ? <span className="settings-update-dot" aria-hidden="true" /> : null}
          </span>
          <small>{getUpdateSummary(updateStatus)}</small>
        </span>
        <button
          className="settings-upgrade-button"
          type="button"
          onClick={() => void handleUpgradeClick()}
          disabled={updateStatus.checking || updateStatus.downloading}
        >
          {updateStatus.downloading ? "下载中" : updateStatus.checking ? "检查中" : "升级"}
        </button>
        <small className="settings-upgrade-hint">{getUpgradeHint(updateStatus, upgradeHint)}</small>
      </div>
      <label className="settings-extra-row settings-update-auto-row">
        <span className="settings-row-title">
          <strong>自动检查</strong>
          <span className="settings-info" tabIndex={0} aria-label="每 24 小时检查一次 GitHub Release 是否有新版本。">
            i
            <span className="settings-tooltip">每 24 小时检查一次 GitHub Release 是否有新版本。</span>
          </span>
        </span>
        <input
          className="settings-toggle"
          type="checkbox"
          checked={settings.autoUpdateCheck}
          onChange={(event) => updateAutoUpdateCheck(event.target.checked)}
        />
      </label>
    </aside>
  );
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
}

function createDraftValues(settings: AppSettings): Record<IntervalSettingKey, string> {
  return {
    activityCheckSeconds: formatNumber(settings.activityCheckSeconds),
    busyQuotaSeconds: formatNumber(settings.busyQuotaSeconds),
    idleQuotaSeconds: formatNumber(settings.idleQuotaSeconds / 60)
  };
}

function getUpdateSummary(updateStatus: UpdateStatus): string {
  if (updateStatus.updateAvailable && updateStatus.latestVersion) {
    return `当前 v${updateStatus.currentVersion} / 最新 v${updateStatus.latestVersion}`;
  }

  if (updateStatus.error) {
    return "检查失败，可手动重试";
  }

  if (updateStatus.lastCheckedAt !== null) {
    return `当前 v${updateStatus.currentVersion} / 已是最新`;
  }

  return `当前 v${updateStatus.currentVersion} / 24小时自动检查`;
}

function getUpgradeHint(updateStatus: UpdateStatus, upgradeHint: string | null): string {
  if (updateStatus.downloading) {
    return updateStatus.downloadProgress === null ? "下载中" : `${updateStatus.downloadProgress}%`;
  }

  if (updateStatus.checking) {
    return "比较版本";
  }

  return upgradeHint ?? "";
}
