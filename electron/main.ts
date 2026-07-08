import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, shell, Tray } from "electron";
import path from "node:path";
import { CodexActivityDetector } from "./codexActivityDetector.js";
import { CodexAppServerClient } from "./codexAppServerClient.js";
import { DEFAULT_POLLING_SETTINGS, normalizePollingSettings } from "./pollingSettings.js";
import { RefreshScheduler } from "./refreshScheduler.js";
import type { VisualSize } from "./types.js";
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
let panelExpanded = false;
let barCollapsed = false;
let mousePassthrough = false;
let positionAdjustmentEnabled = false;
let customWindowX: number | null = null;
let dragState: { startMouseX: number; startMouseY: number; startBounds: Electron.Rectangle } | null = null;
const collapsedShapeCache = new Map<string, Electron.Rectangle[]>();

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
      nodeIntegration: false
    }
  });

  mainWindow.setSkipTaskbar(true);
  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setMenu(null);

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  client = new CodexAppServerClient();
  scheduler = new RefreshScheduler(mainWindow, client, new CodexActivityDetector(client));
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

  ipcMain.on("panel:set-expanded", (_event, expanded: boolean) => {
    panelExpanded = expanded;
    if (expanded) {
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
      return customWindowX;
    }

    dragState = null;
    const bounds = mainWindow.getBounds();
    const size = windowSizes[currentVisualSize];
    const display = screen.getDisplayNearestPoint({
      x: bounds.x + Math.round(bounds.width / 2),
      y: bounds.y + Math.round(bounds.height / 2)
    });
    customWindowX = clamp(bounds.x, display.workArea.x, display.workArea.x + display.workArea.width - size.width);
    applyWindowLayout();
    return customWindowX;
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
    setTimeout(() => app.quit(), 150);
    return status;
  });
  ipcMain.on("app:open-external", (_event, url: unknown) => {
    if (typeof url !== "string" || !url.startsWith("https://github.com/Aecenas/CodexBar/releases")) {
      return;
    }

    void shell.openExternal(url);
  });
  ipcMain.on("app:quit", () => {
    app.quit();
  });

  createTray();
  createWindow();

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
  const width = panelExpanded ? Math.ceil(barWidth + expandedRightPadding * size.panelScale) : barWidth;
  const display = getTargetDisplay(barWidth);
  const height = panelExpanded ? getExpandedHeight(size) : barCollapsed ? collapsedPeekHeight : size.collapsedHeight;
  const x =
    positionAdjustmentEnabled && customWindowX !== null
      ? clamp(customWindowX, display.workArea.x, display.workArea.x + display.workArea.width - barWidth)
      : Math.round(display.workArea.x + (display.workArea.width - barWidth) / 2);
  const y = display.workArea.y;
  const bounds = mainWindow.getBounds();

  if (positionAdjustmentEnabled && customWindowX !== null && customWindowX !== x) {
    customWindowX = x;
  }

  if (bounds.width !== width || bounds.height !== height || bounds.x !== x || bounds.y !== y) {
    mainWindow.setBounds({ ...bounds, x, y, width, height }, false);
  }

  applyWindowShape(width, size.collapsedHeight);
}

function getTargetDisplay(width: number): Electron.Display {
  if (!positionAdjustmentEnabled || customWindowX === null) {
    return screen.getPrimaryDisplay();
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

function applyWindowShape(width: number, scaledBarHeight: number): void {
  if (!mainWindow || mainWindow.isDestroyed() || (process.platform !== "win32" && process.platform !== "linux")) {
    return;
  }

  if (barCollapsed && !panelExpanded) {
    mainWindow.setShape(getCollapsedShape(width, scaledBarHeight));
    return;
  }

  mainWindow.setShape([]);
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

function normalizePositioningPayload(payload: unknown): { enabled: boolean; x: number | null } {
  if (!payload || typeof payload !== "object") {
    return { enabled: false, x: null };
  }

  const value = payload as { enabled?: unknown; x?: unknown };
  return {
    enabled: value.enabled === true,
    x: typeof value.x === "number" && Number.isFinite(value.x) ? Math.round(value.x) : null
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
