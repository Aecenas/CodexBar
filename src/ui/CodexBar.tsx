import { useEffect, useRef, useState } from "react";
import type { AppSettings, QuotaHistoryPoint, QuotaUpdatePayload } from "../types";
import boltOverlay from "../assets/bolt-overlay.png";
import { MetricGroup } from "./MetricGroup";
import { QuotaHoverPanel } from "./QuotaHoverPanel";
import { SettingsHoverPanel } from "./SettingsHoverPanel";

interface CodexBarProps {
  quota: QuotaUpdatePayload;
  history: QuotaHistoryPoint[];
  appSettings: AppSettings;
  onAppSettingsChange: (settings: AppSettings) => void;
}

type ActivePanel = "fiveHour" | "week" | "settings" | null;

export function CodexBar({ quota, history, appSettings, onAppSettingsChange }: CodexBarProps) {
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [autoRevealed, setAutoRevealed] = useState(() => !appSettings.autoCollapse);
  const hideTimer = useRef<number | null>(null);
  const collapseTimer = useRef<number | null>(null);
  const collapseImmediatelyAfterPanelClose = useRef(false);
  const stateLabel = quota.status === "ready" ? "Online" : quota.status === "loading" ? "Loading" : "Stale";
  const collapsed = appSettings.autoCollapse && !autoRevealed && activePanel === null;

  useEffect(() => {
    window.codexBar?.setPanelExpanded(activePanel !== null);
  }, [activePanel]);

  useEffect(() => {
    window.codexBar?.setVisualSize(appSettings.visualSize);
  }, [appSettings.visualSize]);

  useEffect(() => {
    if (!appSettings.autoCollapse) {
      clearCollapseTimer();
      setAutoRevealed(true);
      return;
    }

    if (activePanel !== null) {
      setAutoRevealed(true);
      clearCollapseTimer();
      return;
    }

    if (collapseImmediatelyAfterPanelClose.current) {
      collapseImmediatelyAfterPanelClose.current = false;
      clearCollapseTimer();
      setAutoRevealed(false);
      return;
    }

    scheduleAutoCollapse();
  }, [activePanel, appSettings.autoCollapse]);

  useEffect(() => {
    return () => {
      if (hideTimer.current !== null) {
        window.clearTimeout(hideTimer.current);
      }
      clearCollapseTimer();
      window.codexBar?.setPanelExpanded(false);
    };
  }, []);

  function showPanel(panel: Exclude<ActivePanel, null>): void {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    clearCollapseTimer();
    setAutoRevealed(true);
    setActivePanel(panel);
  }

  function keepPanelOpen(): void {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    clearCollapseTimer();
    setAutoRevealed(true);
  }

  function scheduleHidePanel(): void {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
    }
    hideTimer.current = window.setTimeout(() => setActivePanel(null), 120);
  }

  function revealForPointer(): void {
    clearCollapseTimer();
    setAutoRevealed(true);
  }

  function scheduleAutoCollapse(): void {
    if (!appSettings.autoCollapse || activePanel !== null) {
      return;
    }

    clearCollapseTimer();
    collapseTimer.current = window.setTimeout(() => setAutoRevealed(false), 8_000);
  }

  function clearCollapseTimer(): void {
    if (collapseTimer.current !== null) {
      window.clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
  }

  function handleAppSettingsChange(settings: AppSettings): void {
    if (!appSettings.autoCollapse && settings.autoCollapse) {
      collapseImmediatelyAfterPanelClose.current = true;
    }

    onAppSettingsChange(settings);
  }

  return (
    <main
      className={`shell size-${appSettings.visualSize} ${appSettings.autoCollapse ? "auto-collapse" : ""} ${
        collapsed ? "is-collapsed" : ""
      }`}
      aria-label="Codex usage status"
      onPointerEnter={revealForPointer}
      onPointerLeave={scheduleAutoCollapse}
      onMouseEnter={revealForPointer}
      onMouseLeave={scheduleAutoCollapse}
    >
      <section className="bar" aria-live="polite">
        <div className="metric-slot metric-five">
          <MetricGroup label="5h" value={quota.fiveHourRemaining} resetAt={quota.fiveHourResetAt} />
        </div>
        <div className="metric-slot metric-week">
          <MetricGroup label="1w" value={quota.weekRemaining} resetAt={quota.weekResetAt} />
        </div>
        <img
          aria-hidden="true"
          className={`activity-bolt ${quota.activity}`}
          src={boltOverlay}
          alt=""
          draggable={false}
        />
        <div
          className="metric-hover-zone metric-hover-codex"
          onPointerEnter={() => showPanel("settings")}
          onPointerLeave={scheduleHidePanel}
          onMouseEnter={() => showPanel("settings")}
          onMouseLeave={scheduleHidePanel}
          aria-hidden="true"
        />
        <div
          className="metric-hover-zone metric-hover-five"
          onPointerEnter={() => showPanel("fiveHour")}
          onPointerLeave={scheduleHidePanel}
          onMouseEnter={() => showPanel("fiveHour")}
          onMouseLeave={scheduleHidePanel}
          aria-hidden="true"
        />
        <div
          className="metric-hover-zone metric-hover-week"
          onPointerEnter={() => showPanel("week")}
          onPointerLeave={scheduleHidePanel}
          onMouseEnter={() => showPanel("week")}
          onMouseLeave={scheduleHidePanel}
          aria-hidden="true"
        />
        <span className={`connection-dot ${quota.status}`} title={stateLabel} />
      </section>
      {activePanel === "fiveHour" ? (
        <QuotaHoverPanel
          kind="fiveHour"
          resetAt={quota.fiveHourResetAt}
          history={history}
          onPointerEnter={keepPanelOpen}
          onPointerLeave={scheduleHidePanel}
        />
      ) : null}
      {activePanel === "week" ? (
        <QuotaHoverPanel
          kind="week"
          resetAt={quota.weekResetAt}
          history={history}
          onPointerEnter={keepPanelOpen}
          onPointerLeave={scheduleHidePanel}
        />
      ) : null}
      {activePanel === "settings" ? (
        <SettingsHoverPanel
          settings={appSettings}
          onChange={handleAppSettingsChange}
          onPointerEnter={keepPanelOpen}
          onPointerLeave={scheduleHidePanel}
        />
      ) : null}
    </main>
  );
}
