import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
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
	shell,
	systemPreferences,
	Tray,
	Menu,
	type Display,
} from "electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(__dirname, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const RENDERER_DIST = path.join(APP_ROOT, "dist");
const execFileAsync = promisify(execFile);

process.env.APP_ROOT = APP_ROOT;
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
	? path.join(APP_ROOT, "public")
	: RENDERER_DIST;

type CapturePhase =
	| "idle"
	| "preparing-region"
	| "selecting-region"
	| "opening-preview";

let regionSelectorWindow: BrowserWindow | null = null;
let regionSelectorReady = false;
let regionSelectorLoadPromise: Promise<void> | null = null;
let screenshotPreviewWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let screenshotCroppedData: string | null = null;
let capturePhase: CapturePhase = "idle";
let nextCaptureSessionId = 0;
let activeCaptureSessionId: number | null = null;
let pendingPreviewSessionId: number | null = null;
let activeCaptureDisplay: Display | null = null;

function loadWindow(
	win: BrowserWindow,
	windowType: string,
	query: Record<string, string> = {},
) {
	if (VITE_DEV_SERVER_URL) {
		const url = new URL(VITE_DEV_SERVER_URL);
		url.searchParams.set("windowType", windowType);
		for (const [key, value] of Object.entries(query)) {
			url.searchParams.set(key, value);
		}
		win.loadURL(url.toString());
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query: { windowType, ...query },
		});
	}
}

function waitForWindowLoad(win: BrowserWindow): Promise<void> {
	const { webContents } = win;
	if (!webContents.isLoadingMainFrame() && webContents.getURL()) {
		return Promise.resolve();
	}

	return new Promise((resolve) => {
		const cleanup = () => {
			webContents.removeListener("did-finish-load", handleLoad);
		};
		const handleLoad = () => {
			cleanup();
			resolve();
		};

		webContents.once("did-finish-load", handleLoad);
	});
}

function syncRegionSelectorBounds(display = activeCaptureDisplay) {
	if (!regionSelectorWindow || regionSelectorWindow.isDestroyed()) return;
	const { bounds } = display ?? screen.getPrimaryDisplay();
	regionSelectorWindow.setBounds(bounds);
}

async function ensureRegionSelector() {
	if (regionSelectorWindow && !regionSelectorWindow.isDestroyed()) {
		syncRegionSelectorBounds();
		if (regionSelectorReady) return;
		if (regionSelectorLoadPromise) {
			await regionSelectorLoadPromise;
		}
		return;
	}

	const initialDisplay = activeCaptureDisplay ?? screen.getPrimaryDisplay();
	const { bounds } = initialDisplay;
	regionSelectorWindow = new BrowserWindow({
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

	regionSelectorWindow.setAlwaysOnTop(true, "screen-saver");
	regionSelectorWindow.setVisibleOnAllWorkspaces(true);
	loadWindow(regionSelectorWindow, "screenshot-region");

	regionSelectorReady = false;
	regionSelectorLoadPromise = waitForWindowLoad(regionSelectorWindow).then(() => {
		regionSelectorReady = true;
	});
	regionSelectorWindow.webContents.on("did-start-loading", () => {
		regionSelectorReady = false;
		regionSelectorLoadPromise = waitForWindowLoad(regionSelectorWindow!).then(() => {
			regionSelectorReady = true;
		});
	});

	regionSelectorWindow.on("closed", () => {
		regionSelectorWindow = null;
		regionSelectorReady = false;
		regionSelectorLoadPromise = null;
	});

	await regionSelectorLoadPromise;
}

function createPreviewWindow(
	sessionId: number,
	display: Display | null,
): BrowserWindow {
	const isMac = process.platform === "darwin";
	const { workArea } = display ?? screen.getPrimaryDisplay();
	const W = 960,
		H = 720;
	const win = new BrowserWindow({
		width: W,
		height: H,
		x: Math.round(workArea.x + (workArea.width - W) / 2),
		y: Math.round(workArea.y + (workArea.height - H) / 2),
		frame: isMac,
		titleBarStyle: isMac ? "hiddenInset" : "default",
		title: "QuickShot",
		resizable: true,
		show: false,
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
		},
	});
	loadWindow(win, "screenshot-preview", { sessionId: String(sessionId) });
	return win;
}

function getCaptureDisplay(): Display {
	const cursorPoint = screen.getCursorScreenPoint();
	return screen.getDisplayNearestPoint(cursorPoint);
}

function getDisplayCaptureBounds(display: Display): string {
	const { x, y, width, height } = display.bounds;
	return `${x},${y},${width},${height}`;
}

async function captureDisplayWithScreencapture(
	display: Display,
): Promise<string | null> {
	const filePath = path.join(
		app.getPath("temp"),
		`quickshot-capture-${Date.now()}-${Math.random().toString(36).slice(2)}.png`,
	);

	try {
		await execFileAsync("/usr/sbin/screencapture", [
			"-x",
			"-t",
			"png",
			"-R",
			getDisplayCaptureBounds(display),
			filePath,
		]);
		const fs = await import("node:fs/promises");
		const buffer = await fs.readFile(filePath);
		return `data:image/png;base64,${buffer.toString("base64")}`;
	} catch {
		return null;
	} finally {
		try {
			const fs = await import("node:fs/promises");
			await fs.unlink(filePath);
		} catch {}
	}
}

async function captureInteractiveSelectionWithScreencapture(): Promise<string | null> {
	const filePath = path.join(
		app.getPath("temp"),
		`quickshot-selection-${Date.now()}-${Math.random().toString(36).slice(2)}.png`,
	);

	try {
		await execFileAsync("/usr/sbin/screencapture", [
			"-i",
			"-s",
			"-x",
			"-t",
			"png",
			filePath,
		]);
		const fs = await import("node:fs/promises");
		const buffer = await fs.readFile(filePath);
		return `data:image/png;base64,${buffer.toString("base64")}`;
	} catch {
		return null;
	} finally {
		try {
			const fs = await import("node:fs/promises");
			await fs.unlink(filePath);
		} catch {}
	}
}

async function captureDisplayWithDesktopCapturer(
	display: Display,
): Promise<string | null> {
	const sf = display.scaleFactor || 2;
	const sources = await desktopCapturer.getSources({
		types: ["screen"],
		thumbnailSize: {
			width: display.size.width * sf,
			height: display.size.height * sf,
		},
	});
	if (!sources.length) {
		return null;
	}

	const matchingSource =
		sources.find((source) => source.display_id === String(display.id)) ??
		sources[0];
	return matchingSource.thumbnail.toDataURL();
}

async function captureDisplayImage(display: Display): Promise<string | null> {
	if (process.platform === "darwin") {
		const nativeCapture = await captureDisplayWithScreencapture(display);
		if (nativeCapture) {
			return nativeCapture;
		}
	}

	return captureDisplayWithDesktopCapturer(display);
}

function openPreviewForImage(imageData: string) {
	const sessionId = ++nextCaptureSessionId;
	activeCaptureSessionId = sessionId;
	screenshotCroppedData = imageData;
	capturePhase = "opening-preview";
	pendingPreviewSessionId = sessionId;

	screenshotPreviewWindow = createPreviewWindow(sessionId, activeCaptureDisplay);
	const previewWindow = screenshotPreviewWindow;
	previewWindow.on("closed", () => {
		if (screenshotPreviewWindow === previewWindow) {
			screenshotPreviewWindow = null;
		}
		if (pendingPreviewSessionId === sessionId) {
			pendingPreviewSessionId = null;
			activeCaptureSessionId = null;
			activeCaptureDisplay = null;
			capturePhase = "idle";
		}
	});
	previewWindow.webContents.once("did-finish-load", () => {
		if (previewWindow.isDestroyed()) return;
		previewWindow.webContents.send("preview-session", {
			sessionId,
			imageData,
		});
	});
}

function createTray() {
	const icon = nativeImage
		.createFromPath(
			path.join(process.env.VITE_PUBLIC || RENDERER_DIST, "icon.png"),
		)
		.resize({ width: 18, height: 18, quality: "best" });

	tray = new Tray(icon);
	tray.setToolTip("QuickShot · ⌘+Shift+X");
	tray.setContextMenu(
		Menu.buildFromTemplate([
			{ label: "Take Screenshot (⌘⇧X)", click: () => triggerScreenshot() },
			{ type: "separator" },
			{ label: "Quit", click: () => app.quit() },
		]),
	);
	tray.on("click", () => triggerScreenshot());
}

function showScreenCapturePermissionDialog() {
	dialog
		.showMessageBox({
			type: "warning",
			title: "QuickShot",
			message: "需要「屏幕录制」权限才能截图",
			detail:
				"请在 系统设置 → 隐私与安全性 → 屏幕录制 中允许此应用，然后完全退出并重新打开。",
			buttons: ["打开设置", "取消"],
			defaultId: 0,
		})
		.then((r) => {
			if (r.response === 0) {
				shell.openExternal(
					"x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
				);
			}
		});
}

function buildDefaultScreenshotPath() {
	const stamp = new Date()
		.toISOString()
		.replace(/[:.]/g, "-")
		.replace("T", "_")
		.slice(0, 19);
	return path.join(app.getPath("downloads"), `quickshot-${stamp}.png`);
}

async function triggerScreenshot() {
	if (capturePhase !== "idle") return;

	if (process.platform === "darwin") {
		const screenStatus = systemPreferences.getMediaAccessStatus("screen");
		if (screenStatus !== "granted") {
			showScreenCapturePermissionDialog();
			return;
		}
	}

	capturePhase = "preparing-region";
	screenshotCroppedData = null;
	screenshotPreviewWindow?.close();

	try {
		if (process.platform === "darwin") {
			const imageData = await captureInteractiveSelectionWithScreencapture();
			if (!imageData) {
				capturePhase = "idle";
				return;
			}

			activeCaptureDisplay = getCaptureDisplay();
			openPreviewForImage(imageData);
			return;
		}

		activeCaptureDisplay = getCaptureDisplay();
		await ensureRegionSelector();
		if (!regionSelectorWindow || !regionSelectorReady) {
			capturePhase = "idle";
			return;
		}

		syncRegionSelectorBounds(activeCaptureDisplay);

		const imageData = await captureDisplayImage(activeCaptureDisplay);
		if (!imageData) {
			capturePhase = "idle";
			return;
		}

		const sessionId = ++nextCaptureSessionId;
		activeCaptureSessionId = sessionId;
		regionSelectorWindow.webContents.send("capture-session", {
			sessionId,
			imageData,
		});
	} catch {
		activeCaptureSessionId = null;
		activeCaptureDisplay = null;
		capturePhase = "idle";
		return;
	}
}

function hideRegionSelector() {
	if (regionSelectorWindow?.isVisible()) {
		regionSelectorWindow.hide();
	}
	try {
		globalShortcut.unregister("Escape");
	} catch {}
}

function cancelActiveCapture() {
	hideRegionSelector();
	activeCaptureSessionId = null;
	pendingPreviewSessionId = null;
	activeCaptureDisplay = null;
	capturePhase = "idle";
}

function registerIpcHandlers() {
	ipcMain.handle("region-selector-ready", (_, sessionId: number) => {
		if (
			!regionSelectorWindow ||
			sessionId !== activeCaptureSessionId ||
			capturePhase !== "preparing-region"
		) {
			return { success: false };
		}

		regionSelectorWindow.showInactive();
		if (!globalShortcut.isRegistered("Escape")) {
			globalShortcut.register("Escape", cancelActiveCapture);
		}
		capturePhase = "selecting-region";
		return { success: true };
	});

	ipcMain.handle("cancel-capture-session", (_, sessionId: number) => {
		if (sessionId !== activeCaptureSessionId) {
			return { success: false };
		}

		cancelActiveCapture();
		return { success: true };
	});

	ipcMain.handle(
		"screenshot-region-selected",
		(
			_,
			payload: { sessionId: number; croppedImageData: string },
		) => {
			if (payload.sessionId !== activeCaptureSessionId) {
				return { success: false, error: "stale capture session" };
			}

			const { sessionId, croppedImageData } = payload;
			hideRegionSelector();
			openPreviewForImage(croppedImageData);
			return { success: true };
		},
	);

	ipcMain.handle("preview-session-ready", (_, sessionId: number) => {
		if (
			!screenshotPreviewWindow ||
			sessionId !== pendingPreviewSessionId ||
			capturePhase !== "opening-preview"
		) {
			return { success: false };
		}

		screenshotPreviewWindow.show();
		screenshotPreviewWindow.focus();
		pendingPreviewSessionId = null;
		activeCaptureSessionId = null;
		activeCaptureDisplay = null;
		capturePhase = "idle";
		return { success: true };
	});

	ipcMain.handle("save-screenshot-final", async (_, pngData: ArrayBuffer) => {
		try {
			const result = await dialog.showSaveDialog({
				title: "Save Screenshot",
				defaultPath: buildDefaultScreenshotPath(),
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

	ipcMain.handle("quick-save-screenshot-final", async (_, pngData: ArrayBuffer) => {
		try {
			const filePath = buildDefaultScreenshotPath();
			const fs = await import("node:fs/promises");
			await fs.writeFile(filePath, Buffer.from(pngData));
			return { success: true, path: filePath };
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

app.whenReady().then(async () => {
	if (process.platform === "darwin") {
		app.setActivationPolicy("accessory");
	}

	Menu.setApplicationMenu(Menu.buildFromTemplate([]));

	session.defaultSession.setPermissionCheckHandler((_wc, perm) =>
		["media", "videoCapture", "camera"].includes(perm),
	);
	session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) =>
		cb(["media", "videoCapture", "camera"].includes(perm)),
	);

	registerIpcHandlers();
	createTray();

	if (process.platform !== "darwin") {
		await ensureRegionSelector();
	}

	const shortcutRegistered = globalShortcut.register("CmdOrCtrl+Shift+X", () =>
		triggerScreenshot(),
	);
	if (!shortcutRegistered) {
		tray?.setToolTip("QuickShot · 快捷键注册失败，请用托盘点击截图");
	}
});

app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => {
	/* tray app */
});
app.on("activate", () => {
	/* no-op */
});
