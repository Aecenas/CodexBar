# CodexBar

CodexBar is a Windows tray utility that shows Codex quota status as a compact desktop bar. It uses a transparent, always-on-top Electron window for the visual bar and keeps the app itself out of the taskbar.

## Features

- 5-hour and weekly Codex quota display.
- Texture-matched PNG digits instead of CSS text for the quota numbers.
- Rolling digit animation when quota values change.
- Busy-state lightning effect when an active Codex thread is detected.
- Hover panels for the 5-hour and weekly windows, including reset countdowns and quota history curves.
- Hover settings panel on the `Codex` label with polling interval, visual size, and auto-collapse controls.
- GitHub Release update check with red-dot notification when a newer version is available.
- Tray-only app shell: no taskbar button, no normal app window entry, and a compact right-click tray menu for startup toggle and exit.

## Requirements

- Windows 10 or newer.
- Node.js 20 or newer.
- npm.
- Codex desktop/app data available on the local machine.

## Development

Install dependencies:

```powershell
npm install
```

Run in development mode:

```powershell
npm run dev
```

Build the renderer and Electron main process:

```powershell
npm run build
```

Create a Windows installer:

```powershell
npm run dist
```

The generated installer is written to `release/`.

## Tray Behavior

CodexBar is designed to stay quiet:

- launching the executable does not create a taskbar button;
- the desktop bar remains the primary UI surface;
- the tray icon uses the same gold-and-emerald visual language as the bar;
- right-clicking the tray icon shows `开机启动` / `开机启动√` and `退出软件`.

## Settings

Hover over the `Codex` text in the bar to open runtime settings.

- `状态检查`: how often CodexBar checks whether a Codex thread is active.
- `活跃时轮询间隔`: quota polling interval while a thread is active.
- `空闲时轮询间隔`: quota polling interval while no thread is active.
- `视觉大小`: small, medium, or large bar and panel scale.
- `自动收缩`: when enabled, the bar retracts into the top edge and expands on hover.
- `自动检查`: checks GitHub Releases once every 24 hours. When a newer version exists, CodexBar shows a red dot near `Codex` and in the settings panel. The `升级` button compares versions first; if you are already current, it shows a short inline hint, and if a newer version exists it downloads the installer and launches it automatically.

Invalid interval input is accepted while typing and validated only when the input loses focus. Invalid values fall back to the default for that setting.

## Assets

Runtime image assets live in:

- `src/assets/background.png`
- `src/assets/digits/`
- `src/assets/bolt-overlay.png`
- `assets/app-icon.png`
- `assets/app-icon.ico`
- `assets/tray-icon.png`

The Windows executable, shortcuts, and tray icon all use the generated CodexBar app icon.

## Release

Version `v0.3.1` tightens update-badge rules: the red dot only appears after a fresh GitHub version comparison, checks run on launch and when reopening the Codex settings panel, and collapsed transparent pixels can click through.

Public builds are currently unsigned, so Windows may show an unknown-publisher warning during installation.

## License

MIT
