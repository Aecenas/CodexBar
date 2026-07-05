# Development Notes

## Architecture

CodexBar has two main parts:

- `electron/`: the Electron main process, tray integration, Codex activity checks, quota polling scheduler, and IPC bridge.
- `src/`: the React renderer for the transparent desktop bar, metric rendering, hover panels, and settings UI.

The renderer does not use live text for the quota percentage digits. It renders image assets from `src/assets/digits/` so the dynamic values match the original visual design.

## Polling Model

Polling settings are stored in local storage and sent to the Electron scheduler through the preload bridge.

Default values:

- activity check: 10 seconds;
- busy quota polling: 30 seconds;
- idle quota polling: 30 minutes.

Minimum values:

- activity check: 5 seconds;
- busy quota polling: 15 seconds;
- idle quota polling: 5 minutes.

## Tray Shell

The Electron window uses `skipTaskbar: true`, so it does not appear as a normal taskbar app. A persistent `Tray` instance owns the system tray entry. The context menu intentionally contains only `退出软件`.

## Packaging

`electron-builder` is configured in `package.json`.

```powershell
npm run dist
```

This runs the normal build and then creates a Windows NSIS installer in `release/`. The installer uses `assets/app-icon.ico`, creates desktop/start-menu shortcuts, and keeps release artifacts out of git through `.gitignore`.

## Generated And Intermediate Files

The repository should keep only source assets needed to rebuild the app. Build output and installer output are ignored:

- `dist/`
- `dist-electron/`
- `release/`
- `node_modules/`

Intermediate background cutout previews and source digit extraction folders are not required once their processed assets have been copied into `src/assets/`.
