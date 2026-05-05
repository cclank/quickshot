<p align="center">
  <img src="public/icon.svg" width="96" height="96" alt="QuickShot app icon" />
</p>

<h1 align="center">QuickShot</h1>

<p align="center">
  A lightweight desktop screenshot studio for clean captures, fast annotations, polished backgrounds, and one-click sharing.
</p>

<p align="center">
  <img alt="Electron" src="https://img.shields.io/badge/Electron-39-47848F?style=for-the-badge&logo=electron&logoColor=white" />
  <img alt="React" src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=0B1020" />
  <img alt="Vite" src="https://img.shields.io/badge/Vite-5-646CFF?style=for-the-badge&logo=vite&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img alt="Tailwind CSS" src="https://img.shields.io/badge/Tailwind_CSS-3-38BDF8?style=for-the-badge&logo=tailwindcss&logoColor=white" />
</p>

<p align="center">
  <img alt="Platform" src="https://img.shields.io/badge/macOS-ready-111827?style=flat-square&logo=apple&logoColor=white" />
  <img alt="Package" src="https://img.shields.io/badge/package-DMG-0EA5E9?style=flat-square" />
  <img alt="Privacy" src="https://img.shields.io/badge/privacy-local_first-22C55E?style=flat-square" />
  <img alt="Repository" src="https://img.shields.io/badge/repository-private-6B7280?style=flat-square" />
</p>

## Overview

QuickShot is a tray-based screenshot app focused on the workflow after capture. It opens instantly from a global shortcut, lets you mark up the selected area, applies presentation-ready frames or backgrounds, then exports the final PNG to the clipboard or Downloads folder.

The app is built as a local desktop tool. Screenshots are processed inside the app process and there is no remote upload path in the current codebase.

## Features

| Area | Capability |
| --- | --- |
| Capture | Global shortcut, tray entry, native macOS region capture |
| Markup | Pen, arrow, rectangle, text, mosaic, undo |
| Styling | Wallpaper backgrounds, gradients, solid colors, multiple chrome styles |
| Signature | Optional bottom-right watermark with opacity and color controls |
| Export | Copy to clipboard, quick save to Downloads, save as PNG |
| Desktop | macOS accessory app, tray menu, packaged DMG output |
| Safety | Context isolation, disabled Node integration, allowlisted IPC bridge |

## Quick Start

```bash
git clone git@github.com:cclank/quickshot.git
cd quickshot
npm install
npm run dev
```

Use the tray icon or press:

```text
Cmd + Shift + X
```

## Build

Create a production build:

```bash
npm run build
```

Create a macOS DMG:

```bash
npm run build:mac
```

The packaged app is written to:

```text
release/1.0.0/
```

Expected DMG name on Apple Silicon:

```text
QuickShot-Mac-arm64-1.0.0.dmg
```

## macOS Permissions

QuickShot needs Screen Recording permission to capture the screen.

After launching the packaged app, grant permission in:

```text
System Settings > Privacy & Security > Screen Recording
```

Fully quit and reopen the app after changing this permission.

## Project Structure

```text
quickshot/
|-- electron/
|   |-- main.ts              Electron main process, tray, capture, IPC, save flow
|   `-- preload.ts           Safe renderer bridge
|-- src/
|   |-- App.tsx              Window routing by windowType
|   |-- components/
|   |   `-- screenshot/
|   |       |-- RegionSelector.tsx
|   |       `-- ScreenshotPreview.tsx
|   `-- lib/
|       |-- assetPath.ts
|       `-- decodeImage.ts
|-- public/
|   |-- icon.svg
|   |-- icon.png
|   `-- wallpapers/
|-- icons/
|   `-- icon.icns
|-- electron-builder.json5
|-- vite.config.ts
`-- package.json
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite and Electron development environment |
| `npm run build` | Type-check and build renderer, main process, and preload script |
| `npm run build:mac` | Build the app and package a macOS DMG |
| `npm run build:win` | Build a Windows installer |
| `npm run build:linux` | Build a Linux AppImage |

## Security Model

QuickShot keeps the renderer process constrained:

| Control | Current setup |
| --- | --- |
| Node integration | Disabled |
| Context isolation | Enabled |
| Renderer access | Exposed through `electron/preload.ts` only |
| File access | Asset reads are restricted to the app `dist` and `public` roots |
| External URLs | Only used to open macOS Screen Recording settings |
| Data handling | Screenshot export stays local through clipboard or local PNG files |

Recommended before public distribution:

1. Add Apple Developer signing and notarization.
2. Review Electron permission handlers and keep only required permissions.
3. Run `npm audit` before each release.
4. Add automated release builds with a locked Node.js version.

## Packaging Notes

macOS packaging is configured in `electron-builder.json5`:

```json5
{
  "mac": {
    "target": ["dmg"],
    "icon": "icons/icon.icns",
    "artifactName": "${productName}-Mac-${arch}-${version}.${ext}",
    "extendInfo": {
      "LSUIElement": true
    }
  }
}
```

`LSUIElement` keeps QuickShot as an accessory-style tray app.

## Roadmap

- Signed and notarized macOS releases
- Release workflow for GitHub Actions
- Keyboard shortcuts for all editor tools
- Configurable default export directory
- Screenshot gallery and recent exports
- Additional export presets for social sharing

## License

This repository is currently private. Add a license before public distribution.
