import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from "electron";
import path from "node:path";
import { CodexActivityDetector } from "./codexActivityDetector.js";
import { CodexAppServerClient } from "./codexAppServerClient.js";
import { DEFAULT_POLLING_SETTINGS, normalizePollingSettings } from "./pollingSettings.js";
import { RefreshScheduler } from "./refreshScheduler.js";
import type { VisualSize } from "./types.js";

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

const settingsPanelHeight = 270;
const expandedWindowPadding = 32;

let currentVisualSize: VisualSize = "medium";
let panelExpanded = false;

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
    applyWindowLayout();
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

  const display = screen.getPrimaryDisplay();
  const size = windowSizes[currentVisualSize];
  const width = size.width;
  const height = panelExpanded ? getExpandedHeight(size) : size.collapsedHeight;
  const x = Math.round(display.workArea.x + (display.workArea.width - width) / 2);
  const y = display.workArea.y;
  const bounds = mainWindow.getBounds();

  if (bounds.width !== width || bounds.height !== height || bounds.x !== x || bounds.y !== y) {
    mainWindow.setBounds({ ...bounds, x, y, width, height }, false);
  }
}

function getExpandedHeight(size: { panelTop: number; panelScale: number }): number {
  return Math.ceil(size.panelTop + settingsPanelHeight * size.panelScale + expandedWindowPadding);
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
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "退出软件",
        click: () => app.quit()
      }
    ])
  );
}

function getAssetPath(fileName: string): string {
  return path.join(__dirname, "../assets", fileName);
}
