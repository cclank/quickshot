import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	BrowserWindow,
	app,
	clipboard,
	desktopCapturer,
	dialog,
	globalShortcut,
	ipcMain,
	nativeImage,
	screen,
	session,
	systemPreferences,
	Tray,
	Menu,
} from "electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(__dirname, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const RENDERER_DIST = path.join(APP_ROOT, "dist");

process.env.APP_ROOT = APP_ROOT;
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
	? path.join(APP_ROOT, "public")
	: RENDERER_DIST;

// Menu bar removed — tray-only app
Menu.setApplicationMenu(null);

// ── Window references ────────────────────────────────────────────────────────

let regionSelectorWindow: BrowserWindow | null = null;
let screenshotPreviewWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// ── Cursor helpers (macOS) ────────────────────────────────────────────────────

let savedCursorPos: { x: number; y: number } | null = null;

function hideCursorForCapture() {
	if (process.platform !== "darwin") return;
	savedCursorPos = screen.getCursorScreenPoint();
	try {
		execSync(
			`osascript -l JavaScript -e 'ObjC.import("CoreGraphics"); $.CGWarpMouseCursorPosition($.CGPointMake(99999, 99999))'`,
			{ timeout: 2000 },
		);
	} catch {}
}

function restoreCursor() {
	if (process.platform !== "darwin" || !savedCursorPos) return;
	try {
		execSync(
			`osascript -l JavaScript -e 'ObjC.import("CoreGraphics"); $.CGWarpMouseCursorPosition($.CGPointMake(${savedCursorPos.x}, ${savedCursorPos.y}))'`,
			{ timeout: 2000 },
		);
	} catch {}
	savedCursorPos = null;
}

// ── Screenshot data ──────────────────────────────────────────────────────────

let screenshotFullData: string | null = null;
let screenshotCroppedData: string | null = null;

// ── Window creators ──────────────────────────────────────────────────────────

function loadWindow(win: BrowserWindow, windowType: string) {
	if (VITE_DEV_SERVER_URL) {
		win.loadURL(`${VITE_DEV_SERVER_URL}?windowType=${windowType}`);
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query: { windowType },
		});
	}
}

function createRegionSelectorWindow(): BrowserWindow {
	const { bounds } = screen.getPrimaryDisplay();
	const win = new BrowserWindow({
		x: bounds.x,
		y: bounds.y,
		width: bounds.width,
		height: bounds.height,
		frame: false,
		transparent: true,
		alwaysOnTop: true,
		resizable: false,
		skipTaskbar: true,
		focusable: true,
		hasShadow: false,
		show: false,
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
		},
	});
	win.setAlwaysOnTop(true, "screen-saver");
	win.setVisibleOnAllWorkspaces(true);
	loadWindow(win, "screenshot-region");
	return win;
}

function createScreenshotPreviewWindow(): BrowserWindow {
	const { workArea } = screen.getPrimaryDisplay();
	const W = 960,
		H = 720;
	const win = new BrowserWindow({
		width: W,
		height: H,
		x: Math.round(workArea.x + (workArea.width - W) / 2),
		y: Math.round(workArea.y + (workArea.height - H) / 2),
		frame: true,
		titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
		title: "QuickShot",
		resizable: true,
		show: false,
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
		},
	});
	loadWindow(win, "screenshot-preview");
	return win;
}

// ── Tray ─────────────────────────────────────────────────────────────────────

function getTrayIcon() {
	return nativeImage
		.createFromPath(path.join(process.env.VITE_PUBLIC || RENDERER_DIST, "icon.png"))
		.resize({ width: 18, height: 18, quality: "best" });
}

function createTray() {
	tray = new Tray(getTrayIcon());
	tray.setToolTip("QuickShot — ⌘+Shift+X");
	tray.setContextMenu(
		Menu.buildFromTemplate([
			{
				label: "Take Screenshot (⌘⇧X)",
				click: () => triggerScreenshot(),
			},
			{ type: "separator" },
			{ label: "Quit", click: () => app.quit() },
		]),
	);
	tray.on("click", () => triggerScreenshot());
}

// ── Screenshot flow ──────────────────────────────────────────────────────────

async function triggerScreenshot() {
	if (regionSelectorWindow && !regionSelectorWindow.isDestroyed()) {
		regionSelectorWindow.focus();
		return;
	}

	// Hide cursor before any capture
	hideCursorForCapture();

	// Pre-capture via desktopCapturer as fallback (no cursor in thumbnails)
	try {
		const display = screen.getPrimaryDisplay();
		const sf = display.scaleFactor || 2;
		const sources = await desktopCapturer.getSources({
			types: ["screen"],
			thumbnailSize: {
				width: display.size.width * sf,
				height: display.size.height * sf,
			},
		});
		if (!sources.length) {
			restoreCursor();
			return;
		}
		screenshotFullData = sources[0].thumbnail.toDataURL();
	} catch {
		restoreCursor();
		return;
	}

	regionSelectorWindow = createRegionSelectorWindow();
	regionSelectorWindow.on("closed", () => {
		regionSelectorWindow = null;
		restoreCursor(); // safety net
	});
}

// ── IPC handlers ─────────────────────────────────────────────────────────────

function registerIpcHandlers() {
	ipcMain.handle("get-screen-capture", () => {
		return screenshotFullData
			? { success: true, imageData: screenshotFullData }
			: { success: false };
	});

	ipcMain.handle("get-primary-screen-source-id", async () => {
		try {
			const sources = await desktopCapturer.getSources({
				types: ["screen"],
				thumbnailSize: { width: 1, height: 1 },
			});
			return sources.length
				? { success: true, sourceId: sources[0].id }
				: { success: false };
		} catch (err) {
			return { success: false, error: String(err) };
		}
	});

	ipcMain.handle("get-screen-capture-fallback", async (_, sourceId: string) => {
		try {
			const display = screen.getPrimaryDisplay();
			const sf = display.scaleFactor || 2;
			const sources = await desktopCapturer.getSources({
				types: ["screen"],
				thumbnailSize: {
					width: display.size.width * sf,
					height: display.size.height * sf,
				},
			});
			const source = sources.find((s) => s.id === sourceId) ?? sources[0];
			if (!source) return { success: false };
			return { success: true, imageData: source.thumbnail.toDataURL() };
		} catch (err) {
			return { success: false, error: String(err) };
		}
	});

	ipcMain.handle("show-region-selector", () => {
		restoreCursor();
		regionSelectorWindow?.show();
		return { success: true };
	});

	ipcMain.handle("screenshot-region-selected", (_, croppedImageData: string) => {
		screenshotCroppedData = croppedImageData;
		regionSelectorWindow?.close();
		screenshotPreviewWindow = createScreenshotPreviewWindow();
		screenshotPreviewWindow.on("closed", () => {
			screenshotPreviewWindow = null;
		});
		// Ensure preview window is visible and focused after dock.hide()
		screenshotPreviewWindow.once("ready-to-show", () => {
			screenshotPreviewWindow?.show();
			screenshotPreviewWindow?.moveTop();
			screenshotPreviewWindow?.focus();
		});
		return { success: true };
	});

	ipcMain.handle("get-screenshot-data", () => {
		return screenshotCroppedData
			? { success: true, imageData: screenshotCroppedData }
			: { success: false };
	});

	ipcMain.handle("save-screenshot-final", async (_, pngData: ArrayBuffer) => {
		try {
			const now = new Date();
			const stamp = now
				.toISOString()
				.replace(/[:.]/g, "-")
				.replace("T", "_")
				.slice(0, 19);
			const result = await dialog.showSaveDialog({
				title: "Save Screenshot",
				defaultPath: path.join(
					app.getPath("downloads"),
					`quickshot-${stamp}.png`,
				),
				filters: [{ name: "PNG Image", extensions: ["png"] }],
				properties: ["createDirectory", "showOverwriteConfirmation"],
			});
			if (result.canceled || !result.filePath) {
				return { success: false, canceled: true };
			}
			const fs = await import("node:fs/promises");
			await fs.writeFile(result.filePath, Buffer.from(pngData));
			return { success: true, path: result.filePath };
		} catch (err) {
			return { success: false, error: String(err) };
		}
	});

	ipcMain.handle(
		"copy-to-clipboard",
		(_, pngData: ArrayBuffer | Uint8Array) => {
			try {
				const buf = Buffer.from(
					pngData instanceof Uint8Array ? pngData.buffer : pngData,
				);
				clipboard.writeImage(nativeImage.createFromBuffer(buf));
				return { success: true };
			} catch (err) {
				return { success: false, error: String(err) };
			}
		},
	);

	ipcMain.handle("get-asset-base-path", () => {
		try {
			const { pathToFileURL } = require("node:url");
			if (app.isPackaged) {
				const p = path.join(process.resourcesPath, "assets");
				return pathToFileURL(`${p}${path.sep}`).toString();
			}
			const p = path.join(app.getAppPath(), "public");
			return pathToFileURL(`${p}${path.sep}`).toString();
		} catch {
			return null;
		}
	});
}

// ── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
	// Media permissions for screen capture
	session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
		return ["media", "videoCapture", "camera"].includes(permission);
	});
	session.defaultSession.setPermissionRequestHandler(
		(_wc, permission, callback) => {
			callback(["media", "videoCapture", "camera"].includes(permission));
		},
	);

	if (process.platform === "darwin") {
		const status = systemPreferences.getMediaAccessStatus("screen");
		if (status !== "granted") {
			// Screen recording permission prompt handled by OS on first capture
		}
	}

	// Hide dock — must be before any window creation
	if (process.platform === "darwin") {
		app.dock?.hide();
	}

	registerIpcHandlers();
	createTray();

	// Global shortcut
	globalShortcut.register("CmdOrCtrl+Shift+X", () => {
		triggerScreenshot();
	});
});

app.on("will-quit", () => {
	globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
	// Keep running — tray-based app
});

app.on("activate", () => {
	// No-op: screenshots triggered via shortcut or tray
});
