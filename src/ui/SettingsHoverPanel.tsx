import { useEffect, useState } from "react";
import type { AppSettings, VisualSize } from "../types";
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_POLLING_SETTINGS,
  MIN_POLLING_SETTINGS,
  normalizeAppSettings
} from "../pollingSettings";

interface SettingsHoverPanelProps {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
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
  onChange,
  onPointerEnter,
  onPointerLeave
}: SettingsHoverPanelProps) {
  const [draftValues, setDraftValues] = useState<Record<IntervalSettingKey, string>>(() =>
    createDraftValues(settings)
  );

  useEffect(() => {
    setDraftValues(createDraftValues(settings));
  }, [settings.activityCheckSeconds, settings.busyQuotaSeconds, settings.idleQuotaSeconds]);

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
