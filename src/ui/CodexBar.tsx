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
  onCheckForUpdates: () => Promise<UpdateStatus>;
  onUpgrade: () => Promise<UpdateStatus>;
}

type ActivePanel = "fiveHour" | "week" | "settings" | null;
type ContextMenuPosition = { x: number; y: number } | null;

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
  onCheckForUpdates,
  onUpgrade
}: CodexBarProps) {
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuPosition>(null);
  const [autoRevealed, setAutoRevealed] = useState(() => !appSettings.autoCollapse);
  const hideTimer = useRef<number | null>(null);
  const collapseTimer = useRef<number | null>(null);
  const collapseImmediatelyAfterPanelClose = useRef(false);
  const barAlphaContext = useRef<CanvasRenderingContext2D | null>(null);
  const mousePassthrough = useRef(false);
  const dragPointerId = useRef<number | null>(null);
  const stateLabel = quota.status === "ready" ? "Online" : quota.status === "loading" ? "Loading" : "Stale";
  const contextMenuOpen = contextMenu !== null;
  const collapsed = appSettings.autoCollapse && !autoRevealed && activePanel === null && !contextMenuOpen;

  useEffect(() => {
    window.codexBar?.setPanelExpanded(activePanel !== null || contextMenuOpen);
  }, [activePanel, contextMenuOpen]);

  useEffect(() => {
    window.codexBar?.setBarCollapsed(collapsed);
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

    if (activePanel !== null || contextMenuOpen) {
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
  }, [activePanel, appSettings.autoCollapse, contextMenuOpen]);

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
    setContextMenu(null);
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
    if (!appSettings.autoCollapse || activePanel !== null || contextMenuOpen) {
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

  function updateMousePassthrough(event: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>): boolean {
    const context = barAlphaContext.current;
    if (!context) {
      setMousePassthrough(false);
      return false;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const scale = BAR_SCALES[appSettings.visualSize];
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const sourceX = Math.floor(x / scale);
    const sourceY = Math.floor(y / scale);

    if (sourceX < 0 || sourceX >= BAR_SOURCE_WIDTH || sourceY < 0 || sourceY >= BAR_SOURCE_HEIGHT) {
      setMousePassthrough(false);
      return false;
    }

    const alpha = context.getImageData(sourceX, sourceY, 1, 1).data[3];
    const passthrough = alpha <= TRANSPARENT_ALPHA_THRESHOLD;
    setMousePassthrough(passthrough);
    return passthrough;
  }

  function handlePointerEnter(event: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>): void {
    const passthrough = updateMousePassthrough(event);
    if (!passthrough) {
      revealForPointer();
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>): void {
    if (dragPointerId.current !== null) {
      window.codexBar?.moveBarDrag(event.screenX, event.screenY);
      return;
    }

    const passthrough = updateMousePassthrough(event);
    if (collapsed && !passthrough) {
      revealForPointer();
    }
  }

  function handlePointerLeave(): void {
    if (dragPointerId.current !== null) {
      return;
    }

    setMousePassthrough(false);
    scheduleAutoCollapse();
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>): void {
    if (contextMenuOpen && !isContextMenuTarget(event.target)) {
      setContextMenu(null);
      return;
    }

    if (!appSettings.positionAdjustment || collapsed || event.button !== 0 || isInteractiveTarget(event.target)) {
      return;
    }

    const passthrough = updateMousePassthrough(event);
    if (passthrough) {
      return;
    }

    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    clearCollapseTimer();
    setActivePanel(null);
    setMousePassthrough(false);
    dragPointerId.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    window.codexBar?.startBarDrag(event.screenX, event.screenY);
    event.preventDefault();
  }

  function handleContextMenu(event: ReactMouseEvent<HTMLElement>): void {
    if (collapsed || isInteractiveTarget(event.target)) {
      return;
    }

    const passthrough = updateMousePassthrough(event);
    if (passthrough) {
      setContextMenu(null);
      return;
    }

    event.preventDefault();
    clearCollapseTimer();
    setAutoRevealed(true);
    setMousePassthrough(false);
    setActivePanel(null);
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 96;
    setContextMenu({
      x: Math.max(4, Math.min(event.clientX - rect.left + 8, rect.width - menuWidth - 4)),
      y: Math.max(4, event.clientY - rect.top + 8)
    });
  }

  async function finishPointerDrag(event: ReactPointerEvent<HTMLElement>): Promise<void> {
    if (dragPointerId.current !== event.pointerId) {
      return;
    }

    dragPointerId.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const nextX = await window.codexBar?.endBarDrag();
    if (typeof nextX === "number" && Number.isFinite(nextX)) {
      onAppSettingsChange({
        ...appSettings,
        barX: nextX
      });
    }
  }

  return (
    <main
      className={`shell size-${appSettings.visualSize} ${appSettings.autoCollapse ? "auto-collapse" : ""} ${
        collapsed ? "is-collapsed" : ""
      }`}
      aria-label="Codex usage status"
      onPointerEnter={handlePointerEnter}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onPointerUp={(event) => void finishPointerDrag(event)}
      onPointerCancel={(event) => void finishPointerDrag(event)}
      onPointerLeave={handlePointerLeave}
      onMouseEnter={handlePointerEnter}
      onMouseMove={handlePointerMove}
      onMouseLeave={handlePointerLeave}
      onContextMenu={handleContextMenu}
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
          tokensUsed={quota.fiveHourTokensUsed}
          history={history}
          onPointerEnter={keepPanelOpen}
          onPointerLeave={scheduleHidePanel}
        />
      ) : null}
      {activePanel === "week" ? (
        <QuotaHoverPanel
          kind="week"
          resetAt={quota.weekResetAt}
          tokensUsed={quota.weekTokensUsed}
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
          onCheckForUpdates={onCheckForUpdates}
          onUpgrade={onUpgrade}
          onPointerEnter={keepPanelOpen}
          onPointerLeave={scheduleHidePanel}
        />
      ) : null}
      {contextMenu ? (
        <div
          className="bar-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button type="button" onClick={() => window.codexBar?.quitApp()}>
            退出软件
          </button>
        </div>
      ) : null}
    </main>
  );
}

function isInteractiveTarget(target: EventTarget): boolean {
  return (
    target instanceof Element &&
    target.closest(".quota-panel, .settings-panel, .bar-context-menu, button, input, textarea, select, a") !== null
  );
}

function isContextMenuTarget(target: EventTarget): boolean {
  return target instanceof Element && target.closest(".bar-context-menu") !== null;
}
