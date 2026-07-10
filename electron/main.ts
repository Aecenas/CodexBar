import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CodexActivityDetector } from "./codexActivityDetector.js";
import { CodexAppServerClient } from "./codexAppServerClient.js";
import { DEFAULT_POLLING_SETTINGS, normalizePollingSettings } from "./pollingSettings.js";
import { RefreshScheduler } from "./refreshScheduler.js";
import type { BarPosition, PanelLayout, PanelMode, VisualSize } from "./types.js";
import { checkForUpdate, downloadAndInstallUpdate } from "./updateService.js";

let mainWindow: BrowserWindow | null = null;
let scheduler: RefreshScheduler | null = null;
let client: CodexAppServerClient | null = null;
let tray: Tray | null = null;

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

const windowSizes: Record<
  VisualSize,
  { width: number; collapsedHeight: number; panelTop: number; panelScale: number }
> = {
  small: { width: 576, collapsedHeight: 67, panelTop: 75, panelScale: 0.86 },
  medium: { width: 672, collapsedHeight: 78, panelTop: 86, panelScale: 1 },
  large: { width: 768, collapsedHeight: 89, panelTop: 97, panelScale: 1.14 }
};

const settingsPanelHeight = 500;
const expandedWindowPadding = 32;
const expandedRightPadding = 230;
const collapsedPeekHeight = 10;
const transparentAlphaThreshold = 12;

let currentVisualSize: VisualSize = "medium";
let panelLayout: PanelLayout = { mode: "none" };
let barCollapsed = false;
let mousePassthrough = false;
let positionAdjustmentEnabled = false;
let customWindowX: number | null = null;
let customDisplayId: number | null = null;
let dragState: { startMouseX: number; startMouseY: number; startBounds: Electron.Rectangle } | null = null;
const collapsedShapeCache = new Map<string, Electron.Rectangle[]>();
const quotaPanelWidth = 386;
const quotaPanelHeight = 176;
const settingsPanelLeft = 154;
const quotaPanelLeft: Record<"fiveHour" | "week", number> = { fiveHour: 150, week: 250 };

function createWindow(): void {
  const display = screen.getPrimaryDisplay();
  const initialSize = windowSizes[currentVisualSize];
  const x = Math.round(display.workArea.x + (display.workArea.width - initialSize.width) / 2);
  const y = display.workArea.y;

  mainWindow = new BrowserWindow({
    width: initialSize.width,
    height: initialSize.collapsedHeight,
    x,
    y,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    icon: getAssetPath("app-icon.ico"),
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.setSkipTaskbar(true);
  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setMenu(null);

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  const productionEntry = path.join(__dirname, "../dist/index.html");
  const allowedRendererLocation = devServerUrl ? new URL(devServerUrl).origin : pathToFileURL(productionEntry).href;
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = devServerUrl
      ? new URL(url).origin === allowedRendererLocation
      : url === allowedRendererLocation || url.startsWith(`${allowedRendererLocation}#`);
    if (!allowed) {
      event.preventDefault();
    }
  });
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(productionEntry);
  }

  client = new CodexAppServerClient();
  scheduler = new RefreshScheduler(mainWindow, client, new CodexActivityDetector());
  mainWindow.webContents.once("did-finish-load", () => {
    scheduler?.start();
    mainWindow?.show();
    mainWindow?.moveTop();
  });

  mainWindow.on("closed", () => {
    scheduler?.stop();
    client?.dispose();
    scheduler = null;
    client = null;
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  app.setName("CodexBar");
  app.setAppUserModelId("com.aecenas.codexbar");

  ipcMain.on("panel:set-layout", (_event, payload: unknown) => {
    panelLayout = normalizePanelLayout(payload);
    if (panelLayout.mode !== "none") {
      barCollapsed = false;
    }
    applyWindowLayout();
  });

  ipcMain.on("bar:set-collapsed", (_event, collapsed: boolean) => {
    barCollapsed = collapsed;
    applyWindowLayout();
  });

  ipcMain.on("bar:set-mouse-passthrough", (_event, passthrough: boolean) => {
    setMousePassthrough(passthrough);
  });

  ipcMain.on("bar:set-positioning", (_event, payload: unknown) => {
    const next = normalizePositioningPayload(payload);
    positionAdjustmentEnabled = next.enabled;
    customWindowX = next.enabled ? next.x : null;
    customDisplayId = next.enabled ? next.displayId : null;
    applyWindowLayout();
  });

  ipcMain.on("bar:drag-start", (_event, payload: unknown) => {
    if (!mainWindow || mainWindow.isDestroyed() || !positionAdjustmentEnabled || barCollapsed) {
      return;
    }

    const point = normalizeScreenPoint(payload);
    if (!point) {
      return;
    }

    setMousePassthrough(false);
    panelLayout = { mode: "none" };
    applyWindowLayout();
    dragState = {
      startMouseX: point.screenX,
      startMouseY: point.screenY,
      startBounds: mainWindow.getBounds()
    };
  });

  ipcMain.on("bar:drag-move", (_event, payload: unknown) => {
    if (!mainWindow || mainWindow.isDestroyed() || !dragState) {
      return;
    }

    const point = normalizeScreenPoint(payload);
    if (!point) {
      return;
    }

    const x = Math.round(dragState.startBounds.x + point.screenX - dragState.startMouseX);
    const y = Math.round(dragState.startBounds.y + point.screenY - dragState.startMouseY);
    mainWindow.setBounds({ ...mainWindow.getBounds(), x, y }, false);
  });

  ipcMain.handle("bar:drag-end", () => {
    if (!mainWindow || mainWindow.isDestroyed() || !dragState) {
      dragState = null;
      return customWindowX === null || customDisplayId === null
        ? null
        : ({ x: customWindowX, displayId: customDisplayId } satisfies BarPosition);
    }

    dragState = null;
    const bounds = mainWindow.getBounds();
    const size = windowSizes[currentVisualSize];
    const display = screen.getDisplayNearestPoint({
      x: bounds.x + Math.round(bounds.width / 2),
      y: bounds.y + Math.round(bounds.height / 2)
    });
    customWindowX = clamp(bounds.x, display.workArea.x, display.workArea.x + display.workArea.width - size.width);
    customDisplayId = display.id;
    applyWindowLayout();
    return { x: customWindowX, displayId: customDisplayId } satisfies BarPosition;
  });

  ipcMain.on("panel:set-visual-size", (_event, visualSize: VisualSize) => {
    if (visualSize !== "small" && visualSize !== "medium" && visualSize !== "large") {
      return;
    }

    currentVisualSize = visualSize;
    applyWindowLayout();
  });

  ipcMain.handle("polling:get-settings", () => scheduler?.getPollingSettings() ?? DEFAULT_POLLING_SETTINGS);
  ipcMain.handle("polling:set-settings", (_event, settings: unknown) =>
    scheduler?.updatePollingSettings(normalizePollingSettings(settings ?? {})) ?? DEFAULT_POLLING_SETTINGS
  );
  ipcMain.handle("app:get-open-at-login", () => getOpenAtLogin());
  ipcMain.handle("app:set-open-at-login", (_event, openAtLogin: unknown) => {
    setOpenAtLogin(openAtLogin === true);
    return getOpenAtLogin();
  });
  ipcMain.handle("app:get-diagnostics", () => scheduler?.getDiagnostics() ?? null);
  ipcMain.handle("updates:check", () => checkForUpdate());
  ipcMain.handle("updates:download-and-install", async (event, downloadProxyPrefix: unknown) => {
    const status = await downloadAndInstallUpdate(
      event.sender,
      typeof downloadProxyPrefix === "string" ? downloadProxyPrefix : ""
    );
    if (status.updateAvailable && status.downloadProgress === 100) {
      setTimeout(() => app.quit(), 150);
    }
    return status;
  });
  ipcMain.on("app:quit", () => {
    app.quit();
  });

  createTray();
  createWindow();

  screen.on("display-added", applyWindowLayout);
  screen.on("display-removed", applyWindowLayout);
  screen.on("display-metrics-changed", applyWindowLayout);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  scheduler?.stop();
  client?.dispose();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  tray?.destroy();
  tray = null;
});

function applyWindowLayout(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const size = windowSizes[currentVisualSize];
  const barWidth = size.width;
  const requestedWindowSize = getWindowSize(size);
  const display = getTargetDisplay(barWidth);
  const width = Math.min(requestedWindowSize.width, display.workArea.width);
  const height = Math.min(requestedWindowSize.height, display.workArea.height);
  const desiredBarX =
    barWidth > display.workArea.width
      ? display.workArea.x
      : positionAdjustmentEnabled && customWindowX !== null
        ? clamp(customWindowX, display.workArea.x, display.workArea.x + display.workArea.width - barWidth)
        : Math.round(display.workArea.x + (display.workArea.width - barWidth) / 2);
  const maxWindowX = display.workArea.x + display.workArea.width - width;
  const x = width > display.workArea.width ? display.workArea.x : clamp(desiredBarX, display.workArea.x, maxWindowX);
  const y = display.workArea.y;
  const bounds = mainWindow.getBounds();

  if (positionAdjustmentEnabled && customWindowX !== null && customWindowX !== desiredBarX) {
    customWindowX = desiredBarX;
    customDisplayId = display.id;
  }

  if (bounds.width !== width || bounds.height !== height || bounds.x !== x || bounds.y !== y) {
    mainWindow.setBounds({ ...bounds, x, y, width, height }, false);
  }

  applyWindowShape(width, height, size);
}

function getTargetDisplay(width: number): Electron.Display {
  if (!positionAdjustmentEnabled || customWindowX === null) {
    return screen.getPrimaryDisplay();
  }

  if (customDisplayId !== null) {
    const savedDisplay = screen.getAllDisplays().find((display) => display.id === customDisplayId);
    if (savedDisplay) {
      return savedDisplay;
    }
  }

  return screen.getDisplayNearestPoint({
    x: customWindowX + Math.round(width / 2),
    y: screen.getPrimaryDisplay().workArea.y
  });
}

function setMousePassthrough(passthrough: boolean): void {
  if (!mainWindow || mainWindow.isDestroyed() || mousePassthrough === passthrough) {
    return;
  }

  mousePassthrough = passthrough;
  mainWindow.setIgnoreMouseEvents(passthrough, { forward: true });
}

function applyWindowShape(
  width: number,
  height: number,
  size: { width: number; collapsedHeight: number; panelTop: number; panelScale: number }
): void {
  if (!mainWindow || mainWindow.isDestroyed() || (process.platform !== "win32" && process.platform !== "linux")) {
    return;
  }

  if (barCollapsed && panelLayout.mode === "none") {
    mainWindow.setShape(getCollapsedShape(size.width, size.collapsedHeight));
    return;
  }

  if (panelLayout.mode === "none") {
    mainWindow.setShape([]);
    return;
  }

  const shape: Electron.Rectangle[] = [{ x: 0, y: 0, width: size.width, height: size.collapsedHeight }];
  if (panelLayout.mode === "context" && panelLayout.contextRect) {
    shape.push(clampRectangle(panelLayout.contextRect, width, height));
  } else if (panelLayout.mode === "fiveHour" || panelLayout.mode === "week") {
    shape.push(
      clampRectangle(
        {
          x: quotaPanelLeft[panelLayout.mode],
          y: size.panelTop,
          width: Math.ceil(quotaPanelWidth * size.panelScale),
          height: Math.ceil(quotaPanelHeight * size.panelScale)
        },
        width,
        height
      )
    );
  } else if (panelLayout.mode === "settings") {
    shape.push(
      clampRectangle(
        {
          x: settingsPanelLeft,
          y: size.panelTop,
          width: width - settingsPanelLeft,
          height: height - size.panelTop
        },
        width,
        height
      )
    );
  }

  mainWindow.setShape(shape.filter((rectangle) => rectangle.width > 0 && rectangle.height > 0));
}

function getWindowSize(size: { width: number; collapsedHeight: number; panelTop: number; panelScale: number }): {
  width: number;
  height: number;
} {
  if (barCollapsed && panelLayout.mode === "none") {
    return { width: size.width, height: collapsedPeekHeight };
  }

  if (panelLayout.mode === "settings") {
    return {
      width: Math.ceil(size.width + expandedRightPadding * size.panelScale),
      height: getExpandedHeight(size)
    };
  }

  if (panelLayout.mode === "fiveHour" || panelLayout.mode === "week") {
    return {
      width: size.width,
      height: Math.ceil(size.panelTop + quotaPanelHeight * size.panelScale + expandedWindowPadding)
    };
  }

  if (panelLayout.mode === "context" && panelLayout.contextRect) {
    return {
      width: size.width,
      height: Math.max(size.collapsedHeight, Math.ceil(panelLayout.contextRect.y + panelLayout.contextRect.height + 4))
    };
  }

  return { width: size.width, height: size.collapsedHeight };
}

function clampRectangle(rectangle: Electron.Rectangle, width: number, height: number): Electron.Rectangle {
  const x = clamp(rectangle.x, 0, width);
  const y = clamp(rectangle.y, 0, height);
  return {
    x,
    y,
    width: Math.max(0, Math.min(Math.round(rectangle.width), width - x)),
    height: Math.max(0, Math.min(Math.round(rectangle.height), height - y))
  };
}

function getCollapsedShape(width: number, scaledBarHeight: number): Electron.Rectangle[] {
  const cacheKey = `${width}x${scaledBarHeight}`;
  const cached = collapsedShapeCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const scaledBar = nativeImage.createFromPath(getAssetPath("background.png")).resize({
    width,
    height: scaledBarHeight,
    quality: "best"
  });
  const bitmap = scaledBar.toBitmap();
  const bytesPerPixel = 4;
  const shape: Electron.Rectangle[] = [];
  const lastRunByKey = new Map<string, Electron.Rectangle>();
  const sampleTop = Math.max(0, scaledBarHeight - collapsedPeekHeight);

  for (let y = 0; y < collapsedPeekHeight; y += 1) {
    const sampleY = sampleTop + y;
    let runStart: number | null = null;

    for (let x = 0; x <= width; x += 1) {
      const alpha =
        x < width && sampleY < scaledBarHeight
          ? bitmap[(sampleY * width + x) * bytesPerPixel + 3]
          : 0;
      const opaque = alpha > transparentAlphaThreshold;

      if (opaque && runStart === null) {
        runStart = x;
      }

      if ((!opaque || x === width) && runStart !== null) {
        mergeShapeRun(shape, lastRunByKey, runStart, x - runStart, y);
        runStart = null;
      }
    }
  }

  const next = shape.length > 0 ? shape : [{ x: 0, y: 0, width, height: collapsedPeekHeight }];
  collapsedShapeCache.set(cacheKey, next);
  return next;
}

function mergeShapeRun(
  shape: Electron.Rectangle[],
  lastRunByKey: Map<string, Electron.Rectangle>,
  x: number,
  width: number,
  y: number
): void {
  if (width <= 0) {
    return;
  }

  const key = `${x}:${width}`;
  const previous = lastRunByKey.get(key);
  if (previous && previous.y + previous.height === y) {
    previous.height += 1;
    return;
  }

  const next = { x, y, width, height: 1 };
  shape.push(next);
  lastRunByKey.set(key, next);
}

function getExpandedHeight(size: { panelTop: number; panelScale: number }): number {
  return Math.ceil(size.panelTop + settingsPanelHeight * size.panelScale + expandedWindowPadding);
}

function normalizePanelLayout(payload: unknown): PanelLayout {
  if (!payload || typeof payload !== "object") {
    return { mode: "none" };
  }

  const value = payload as { mode?: unknown; contextRect?: unknown };
  const modes: PanelMode[] = ["none", "fiveHour", "week", "settings", "context"];
  const mode = modes.includes(value.mode as PanelMode) ? (value.mode as PanelMode) : "none";
  if (mode !== "context") {
    return { mode };
  }

  if (!value.contextRect || typeof value.contextRect !== "object") {
    return { mode: "none" };
  }

  const rectangle = value.contextRect as Record<string, unknown>;
  if (![rectangle.x, rectangle.y, rectangle.width, rectangle.height].every((part) => typeof part === "number" && Number.isFinite(part))) {
    return { mode: "none" };
  }

  return {
    mode,
    contextRect: {
      x: Math.max(0, Math.round(rectangle.x as number)),
      y: Math.max(0, Math.round(rectangle.y as number)),
      width: Math.max(1, Math.round(rectangle.width as number)),
      height: Math.max(1, Math.round(rectangle.height as number))
    }
  };
}

function normalizePositioningPayload(payload: unknown): { enabled: boolean; x: number | null; displayId: number | null } {
  if (!payload || typeof payload !== "object") {
    return { enabled: false, x: null, displayId: null };
  }

  const value = payload as { enabled?: unknown; x?: unknown; displayId?: unknown };
  return {
    enabled: value.enabled === true,
    x: typeof value.x === "number" && Number.isFinite(value.x) ? Math.round(value.x) : null,
    displayId:
      typeof value.displayId === "number" && Number.isFinite(value.displayId) ? Math.round(value.displayId) : null
  };
}

function normalizeScreenPoint(payload: unknown): { screenX: number; screenY: number } | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const value = payload as { screenX?: unknown; screenY?: unknown };
  if (typeof value.screenX !== "number" || !Number.isFinite(value.screenX)) {
    return null;
  }

  if (typeof value.screenY !== "number" || !Number.isFinite(value.screenY)) {
    return null;
  }

  return {
    screenX: value.screenX,
    screenY: value.screenY
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function createTray(): void {
  if (tray) {
    return;
  }

  const trayIcon = nativeImage.createFromPath(getAssetPath("tray-icon.png")).resize({
    width: 16,
    height: 16,
    quality: "best"
  });

  tray = new Tray(trayIcon);
  tray.setToolTip("CodexBar");
  updateTrayMenu();
}

function updateTrayMenu(): void {
  if (!tray) {
    return;
  }

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "退出软件",
        click: () => app.quit()
      }
    ])
  );
}

function getOpenAtLogin(): boolean {
  return app.getLoginItemSettings(getLoginItemOptions(false)).openAtLogin;
}

function setOpenAtLogin(openAtLogin: boolean): void {
  app.setLoginItemSettings(getLoginItemOptions(openAtLogin));
}

function getLoginItemOptions(openAtLogin: boolean): Electron.Settings {
  if (process.defaultApp) {
    return {
      openAtLogin,
      path: process.execPath,
      args: [app.getAppPath()]
    };
  }

  return { openAtLogin };
}

function getAssetPath(fileName: string): string {
  return path.join(__dirname, "../assets", fileName);
}
