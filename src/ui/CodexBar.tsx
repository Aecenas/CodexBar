import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { AppSettings, QuotaHistoryPoint, QuotaUpdatePayload, UpdateStatus } from "../types";
import backgroundUrl from "../assets/background.png";
import boltOverlay from "../assets/bolt-overlay.png";
import { MetricGroup } from "./MetricGroup";
import { QuotaHoverPanel } from "./QuotaHoverPanel";
import { SettingsHoverPanel } from "./SettingsHoverPanel";

interface CodexBarProps {
  quota: QuotaUpdatePayload;
  history: QuotaHistoryPoint[];
  appSettings: AppSettings;
  updateStatus: UpdateStatus;
  onAppSettingsChange: (settings: AppSettings) => void;
  onUpgrade: () => Promise<UpdateStatus>;
}

type ActivePanel = "fiveHour" | "week" | "settings" | null;

const BAR_SOURCE_WIDTH = 960;
const BAR_SOURCE_HEIGHT = 111;
const BAR_SCALES: Record<AppSettings["visualSize"], number> = {
  small: 0.6,
  medium: 0.7,
  large: 0.8
};
const TRANSPARENT_ALPHA_THRESHOLD = 12;

export function CodexBar({
  quota,
  history,
  appSettings,
  updateStatus,
  onAppSettingsChange,
  onUpgrade
}: CodexBarProps) {
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [autoRevealed, setAutoRevealed] = useState(() => !appSettings.autoCollapse);
  const hideTimer = useRef<number | null>(null);
  const collapseTimer = useRef<number | null>(null);
  const collapseImmediatelyAfterPanelClose = useRef(false);
  const barAlphaContext = useRef<CanvasRenderingContext2D | null>(null);
  const mousePassthrough = useRef(false);
  const stateLabel = quota.status === "ready" ? "Online" : quota.status === "loading" ? "Loading" : "Stale";
  const collapsed = appSettings.autoCollapse && !autoRevealed && activePanel === null;

  useEffect(() => {
    window.codexBar?.setPanelExpanded(activePanel !== null);
  }, [activePanel]);

  useEffect(() => {
    window.codexBar?.setBarCollapsed(collapsed);
    if (collapsed) {
      setMousePassthrough(false);
    }
  }, [collapsed]);

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
    let cancelled = false;
    const image = new Image();

    image.onload = () => {
      if (cancelled) {
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = BAR_SOURCE_WIDTH;
      canvas.height = BAR_SOURCE_HEIGHT;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        return;
      }

      context.drawImage(image, 0, 0, BAR_SOURCE_WIDTH, BAR_SOURCE_HEIGHT);
      barAlphaContext.current = context;
    };
    image.src = backgroundUrl;

    return () => {
      cancelled = true;
      barAlphaContext.current = null;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (hideTimer.current !== null) {
        window.clearTimeout(hideTimer.current);
      }
      clearCollapseTimer();
      window.codexBar?.setPanelExpanded(false);
      window.codexBar?.setBarCollapsed(false);
      setMousePassthrough(false);
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

  function setMousePassthrough(passthrough: boolean): void {
    if (mousePassthrough.current === passthrough) {
      return;
    }

    mousePassthrough.current = passthrough;
    window.codexBar?.setMousePassthrough(passthrough);
  }

  function updateMousePassthrough(event: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>): void {
    if (collapsed) {
      setMousePassthrough(false);
      return;
    }

    const context = barAlphaContext.current;
    if (!context) {
      setMousePassthrough(false);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const scale = BAR_SCALES[appSettings.visualSize];
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const sourceX = Math.floor(x / scale);
    const sourceY = Math.floor(y / scale);

    if (sourceX < 0 || sourceX >= BAR_SOURCE_WIDTH || sourceY < 0 || sourceY >= BAR_SOURCE_HEIGHT) {
      setMousePassthrough(false);
      return;
    }

    const alpha = context.getImageData(sourceX, sourceY, 1, 1).data[3];
    setMousePassthrough(alpha <= TRANSPARENT_ALPHA_THRESHOLD);
  }

  function handlePointerLeave(): void {
    setMousePassthrough(false);
    scheduleAutoCollapse();
  }

  return (
    <main
      className={`shell size-${appSettings.visualSize} ${appSettings.autoCollapse ? "auto-collapse" : ""} ${
        collapsed ? "is-collapsed" : ""
      }`}
      aria-label="Codex usage status"
      onPointerEnter={revealForPointer}
      onPointerMove={updateMousePassthrough}
      onPointerLeave={handlePointerLeave}
      onMouseEnter={revealForPointer}
      onMouseMove={updateMousePassthrough}
      onMouseLeave={handlePointerLeave}
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
        {updateStatus.updateAvailable ? <span className="codex-update-dot" aria-hidden="true" /> : null}
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
          updateStatus={updateStatus}
          onChange={handleAppSettingsChange}
          onUpgrade={onUpgrade}
          onPointerEnter={keepPanelOpen}
          onPointerLeave={scheduleHidePanel}
        />
      ) : null}
    </main>
  );
}
