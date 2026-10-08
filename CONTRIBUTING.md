# Contributing to QuickShot

Thanks for helping make QuickShot better. This guide covers how the project is organized and what a good change looks like.

## Getting started

```bash
npm install
npm run dev:ui   # interface work against fixtures, no permissions needed
npm run dev      # full Electron app
```

When you run the full app next to an installed copy, give the dev build its own profile so the two never share state or the single-instance lock:

```bash
QUICKSHOT_USER_DATA_DIR=/tmp/quickshot-dev \
QUICKSHOT_ENABLE_DEV_SHORTCUT=0 \
QUICKSHOT_DEV_CAPTURE_FILE="$PWD/path/to/sample.png" \
npm run dev
```

`QUICKSHOT_DEV_CAPTURE_FILE` replaces the screen with a PNG, which lets you exercise the capture overlay and editor without granting Screen Recording permission.

## Where things live

- `src/editor/` holds the editor's pure logic: annotation geometry and hit testing, composition layout, rendering, history, and style presets. Keep it free of React so it stays unit-testable.
- `src/components/editor/` is the editor UI. `Stage.tsx` owns pointer interaction; `Editor.tsx` owns state, shortcuts and export.
- `src/components/screenshot/` contains the selection overlay, the pinned window and the text extraction panel.
- `electron/main.ts` runs capture, windows and IPC. Small, testable policies live in their own modules next to it.

The preview and the exported PNG share one renderer (`renderComposition` and `drawAnnotations`). A visual change should look identical in both.

## Standards

- Run `npm run verify` before opening a pull request. It runs the unit tests, the type check, a production build and the bundle budgets in `scripts/verify-build.mjs`.
- Add or update unit tests for logic in `src/editor/`, `src/lib/` and `electron/*Policy.ts`-style modules.
- Every user-visible string goes through `t()` in `src/lib/i18n.ts` (renderer) or `mt()` in `electron/i18n.ts` (main process), with both Chinese and English text.
- New IPC channels must validate the sender and their payload in the main process and be exposed only through `electron/preload.ts`.
- Screenshots must stay on the device. Do not add network requests.
- For UI changes, include a screenshot or short recording in the pull request, and try the change on macOS and Windows when you can.

## Reporting bugs

Open an issue with steps to reproduce, your OS and QuickShot version, and the relevant lines from the diagnostics log (tray menu → Show Diagnostics). The log records events only, never screenshot pixels.
