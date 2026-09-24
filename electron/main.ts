import { execFile, type ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	createScreenshotPathGenerator,
	writePngWithoutOverwrite,
} from "./screenshotFiles";
import { shouldRegisterCaptureShortcut } from "./captureShortcutPolicy";
import { parseOcrHelperOutput } from "./ocrResult";
import {
	MAX_CAPTURE_PNG_BYTES,
	MAX_EXPORT_PNG_BYTES,
	validatePngPayload as validatePngStructure,
} from "./pngPayload";
import {
	MAX_PINNED_SCREENSHOTS,
	canCreatePinnedScreenshot,
	clampPinnedWindowAspectRatio,
	findAvailablePinnedPlacementSlot,
	fitPinnedRasterSize,
	resizePinnedWindowFromWidth,
} from "./pinnedWindowPolicy";
import {
	BrowserWindow,
	app,
	clipboard,
	desktopCapturer,
	dialog,
	globalShortcut,
	ipcMain,
	nativeImage,
	powerMonitor,
	screen,
	session,
	shell,
	systemPreferences,
	Tray,
	Menu,
	type Display,
	type IpcMainInvokeEvent,
	type MenuItemConstructorOptions,
} from "electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(__dirname, "..");
const RENDERER_DIST = path.join(APP_ROOT, "dist");
const execFileAsync = promisify(execFile);
const ALLOWED_DEV_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const CAPTURE_SHORTCUT = "CmdOrCtrl+Shift+X";
const CAPTURE_SHORTCUT_LABEL =
	process.platform === "darwin" ? "⌘⇧X" : "Ctrl+Shift+X";
const ENABLE_CAPTURE_SHORTCUT = shouldRegisterCaptureShortcut(
	app.isPackaged,
	process.env["QUICKSHOT_ENABLE_DEV_SHORTCUT"],
);
const INTERACTIVE_CAPTURE_TIMEOUT_MS = 2 * 60 * 1000;
const PREVIEW_READY_TIMEOUT_MS = 20_000;
const CAPTURE_RESTART_DELAY_MS = 75;
const SHORTCUT_HEALTH_INTERVAL_MS = 60_000;
const INPUT_SOURCE_CHECK_DELAY_MS = 400;
const OCR_TIMEOUT_MS = 45_000;
const MAX_OCR_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_OCR_PROCESS_OUTPUT_BYTES = MAX_OCR_TEXT_BYTES * 6 + 64 * 1024;
const OCR_TIMEOUT_REASON = "ocr-timeout";
const OCR_TEMP_DIRECTORY_PREFIX = "quickshot-ocr-";
const OCR_TEMP_STALE_AGE_MS = 10 * 60 * 1000;
const OCR_TEMP_CLEANUP_LIMIT = 32;
const OCR_TEMP_SCAN_LIMIT = 512;
const PINNED_SCREENSHOT_READY_TIMEOUT_MS = 10_000;
const PINNED_SCREENSHOT_RECOVERY_SHORTCUT = "CmdOrCtrl+Shift+L";
const PINNED_SCREENSHOT_RECOVERY_SHORTCUT_LABEL =
	process.platform === "darwin" ? "⌘⇧L" : "Ctrl+Shift+L";
const DIAGNOSTIC_LOG_MAX_BYTES = 512 * 1024;
const LEGACY_DIAGNOSTIC_LOG_PATTERN = /^quickshot-\d{13}\.log$/;
const LEGACY_DIAGNOSTIC_LOG_CLEANUP_MARKER =
	".legacy-diagnostic-logs-cleaned-v1";
const LEGACY_DIAGNOSTIC_LOG_CLEANUP_BATCH_SIZE = 32;
const SHORTCUT_RETRY_DELAYS_MS = [250, 1_500, 5_000, 30_000];
const INPUT_SOURCE_DISTRIBUTED_NOTIFICATION =
	"com.apple.Carbon.TISNotifySelectedKeyboardInputSourceChanged";

function getValidatedDevServerUrl(rawUrl: string | undefined): string | undefined {
	if (!rawUrl) return undefined;

	const url = new URL(rawUrl);
	const hostname = url.hostname.toLowerCase();
	if (!["http:", "https:"].includes(url.protocol) || !ALLOWED_DEV_HOSTS.has(hostname)) {
		throw new Error(`Refusing to load non-local dev server URL: ${rawUrl}`);
	}

	return url.toString();
}

const VITE_DEV_SERVER_URL = getValidatedDevServerUrl(
	process.env["VITE_DEV_SERVER_URL"],
);
const HAS_SINGLE_INSTANCE_LOCK = app.requestSingleInstanceLock();
if (!HAS_SINGLE_INSTANCE_LOCK) app.quit();

process.env.APP_ROOT = APP_ROOT;
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
	? path.join(APP_ROOT, "public")
	: RENDERER_DIST;

type CapturePhase =
	| "idle"
	| "preparing-region"
	| "selecting-region"
	| "opening-preview";

type CaptureProcessState = {
	child: ChildProcess;
	abortController: AbortController;
	closed: Promise<void>;
	resolveClosed: () => void;
	forceKillTimer: NodeJS.Timeout | null;
	timeoutTimer: NodeJS.Timeout | null;
	terminationReason: string | null;
};

type RegionCaptureSession = {
	sessionId: number;
	imageBuffer: Buffer;
};

type OcrErrorCode =
	| "unsupported-platform"
	| "invalid-image"
	| "busy"
	| "helper-unavailable"
	| "timeout"
	| "recognition-failed";

type ActiveOcrTask = {
	abortController: AbortController;
	child: ChildProcess | null;
	forceKillTimer: NodeJS.Timeout | null;
	temporaryDirectory: string | null;
	terminationReason: string | null;
};

type PinnedScreenshotRecord = {
	id: number;
	window: BrowserWindow;
	pendingImageBuffer: Buffer | null;
	imageDelivered: boolean;
	aspectRatio: number;
	placementSlot: number;
	readyTimer: NodeJS.Timeout | null;
	clickThrough: boolean;
};

let regionSelectorWindow: BrowserWindow | null = null;
let regionSelectorReady = false;
let regionSelectorLoadPromise: Promise<void> | null = null;
let screenshotPreviewWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let screenshotCroppedBuffer: Buffer | null = null;
let pendingRegionCaptureSession: RegionCaptureSession | null = null;
let capturePhase: CapturePhase = "idle";
let nextCaptureSessionId = 0;
let activeCaptureSessionId: number | null = null;
let pendingPreviewSessionId: number | null = null;
let activeCaptureDisplay: Display | null = null;
let activeCaptureProcess: CaptureProcessState | null = null;
let activeOcrTask: ActiveOcrTask | null = null;
let activeCaptureAttempt = 0;
let captureRestartTimer: NodeJS.Timeout | null = null;
let previewReadyTimer: NodeJS.Timeout | null = null;
let shortcutRecoveryTimer: NodeJS.Timeout | null = null;
let shortcutHealthTimer: NodeJS.Timeout | null = null;
let inputSourceCheckTimer: NodeJS.Timeout | null = null;
let inputSourceDistributedSubscriptionId: number | null = null;
let lastInputSourceSignature: string | null = null;
let inputSourceCheckInFlight = false;
let inputSourceCheckPending = false;
let inputSourceReadFailureLogged = false;
let isQuitting = false;
let diagnosticLogPath: string | null = null;
let diagnosticBackupLogPath: string | null = null;
let diagnosticLogBytes = 0;
let diagnosticWriteQueue = Promise.resolve();
let shortcutRetryAttempt = 0;
let lastShortcutTriggerAt = 0;
let nextPinnedScreenshotId = 0;
const pinnedScreenshots = new Map<number, PinnedScreenshotRecord>();
const nextScreenshotPath = createScreenshotPathGenerator();

function clearCaptureRestartTimer() {
	if (captureRestartTimer) {
		clearTimeout(captureRestartTimer);
		captureRestartTimer = null;
	}
}

function clearCaptureProcessTimers(state: CaptureProcessState) {
	if (state.forceKillTimer) {
		clearTimeout(state.forceKillTimer);
		state.forceKillTimer = null;
	}
	if (state.timeoutTimer) {
		clearTimeout(state.timeoutTimer);
		state.timeoutTimer = null;
	}
}

function terminateCaptureProcess(state: CaptureProcessState, reason: string) {
	const { child } = state;
	if (child.exitCode !== null || child.signalCode !== null) return state.closed;
	if (state.terminationReason !== null) return state.closed;
	state.terminationReason = reason;

	writeDiagnostic("interactive-capture-terminate", {
		reason,
		pid: child.pid,
	});
	state.abortController.abort(reason);
	child.kill("SIGTERM");
	if (!state.forceKillTimer) {
		state.forceKillTimer = setTimeout(() => {
			state.forceKillTimer = null;
			if (child.exitCode === null && child.signalCode === null) {
				writeDiagnostic("interactive-capture-force-kill", {
					reason,
					pid: child.pid,
				});
				child.kill("SIGKILL");
			}
		}, 750);
	}
	return state.closed;
}

function terminateActiveCaptureProcess(reason: string): Promise<void> {
	const state = activeCaptureProcess;
	if (!state) return Promise.resolve();
	return terminateCaptureProcess(state, reason);
}

function forceTerminateActiveCaptureProcess(reason: string) {
	const state = activeCaptureProcess;
	if (!state) return;
	const { child } = state;
	clearCaptureProcessTimers(state);
	if (child.exitCode !== null || child.signalCode !== null) return;
	if (state.terminationReason === null) state.terminationReason = reason;
	writeDiagnostic("interactive-capture-force-kill", {
		reason,
		pid: child.pid,
	});
	child.kill("SIGKILL");
}

function terminateOcrTask(
	task: ActiveOcrTask,
	reason: string,
	force = false,
) {
	if (task.terminationReason === null) {
		task.terminationReason = reason;
		task.abortController.abort(reason);
	}

	const child = task.child;
	if (!child || child.exitCode !== null || child.signalCode !== null) return;
	try {
		child.kill(force ? "SIGKILL" : "SIGTERM");
	} catch {
		return;
	}
	if (force || task.forceKillTimer) return;

	task.forceKillTimer = setTimeout(() => {
		task.forceKillTimer = null;
		if (child.exitCode === null && child.signalCode === null) {
			try {
				child.kill("SIGKILL");
			} catch {
				// The helper may have exited between the state check and kill.
			}
		}
	}, 750);
	task.forceKillTimer.unref();
}

function abortActiveOcr(reason: string, force = false) {
	const task = activeOcrTask;
	if (task) terminateOcrTask(task, reason, force);
}

function removeActiveOcrTemporaryDirectory() {
	const temporaryDirectory = activeOcrTask?.temporaryDirectory;
	if (!temporaryDirectory) return;
	activeOcrTask!.temporaryDirectory = null;
	try {
		rmSync(temporaryDirectory, { force: true, recursive: true });
	} catch {
		writeDiagnostic("ocr-temp-cleanup-failed");
	}
}

async function cleanupStaleOcrTemporaryDirectories() {
	const fs = await import("node:fs/promises");
	const temporaryRoot = app.getPath("temp");
	const directory = await fs.opendir(temporaryRoot);
	let scannedEntries = 0;
	let removedDirectories = 0;

	for await (const entry of directory) {
		scannedEntries += 1;
		if (scannedEntries > OCR_TEMP_SCAN_LIMIT) break;
		if (
			!entry.isDirectory() ||
			!entry.name.startsWith(OCR_TEMP_DIRECTORY_PREFIX)
		) {
			continue;
		}

		const candidate = path.join(temporaryRoot, entry.name);
		try {
			const metadata = await fs.lstat(candidate);
			if (
				!metadata.isDirectory() ||
				Date.now() - metadata.mtimeMs < OCR_TEMP_STALE_AGE_MS
			) {
				continue;
			}
			if (removedDirectories >= OCR_TEMP_CLEANUP_LIMIT) break;
			await fs.rm(candidate, { force: true, recursive: true });
			removedDirectories += 1;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
}

function serializeError(error: unknown): string {
	return error instanceof Error
		? `${error.name}: ${error.message}`
		: String(error);
}

function writeDiagnostic(
	event: string,
	details: Record<string, unknown> = {},
) {
	const entry = JSON.stringify({
		time: new Date().toISOString(),
		event,
		...details,
	});
	console.info(`[quickshot] ${entry}`);
	if (!diagnosticLogPath) return;
	const line = `${entry}\n`;
	const lineBytes = Buffer.byteLength(line, "utf8");

	diagnosticWriteQueue = diagnosticWriteQueue
		.then(async () => {
			const fs = await import("node:fs/promises");
			if (
				diagnosticBackupLogPath &&
				diagnosticLogBytes + lineBytes > DIAGNOSTIC_LOG_MAX_BYTES
			) {
				await fs.rm(diagnosticBackupLogPath, { force: true });
				try {
					await fs.rename(diagnosticLogPath!, diagnosticBackupLogPath);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				}
				diagnosticLogBytes = 0;
			}
			await fs.appendFile(diagnosticLogPath!, line, "utf8");
			diagnosticLogBytes += lineBytes;
		})
		.catch((error) => {
			console.warn("QuickShot could not write diagnostics", error);
		});
}

type LegacyDiagnosticLogCleanupResult = {
	deletedFiles: number;
	deletedBytes: number;
	pendingFiles: boolean;
	skippedEntries: number;
};

async function cleanupLegacyDiagnosticLogs(
	logDirectory: string,
): Promise<LegacyDiagnosticLogCleanupResult | null> {
	// Older builds created one timestamped log per run. Remove only that exact
	// legacy shape in bounded batches; current and rotated logs never match it.
	const fs = await import("node:fs/promises");
	const cleanupMarkerPath = path.join(
		logDirectory,
		LEGACY_DIAGNOSTIC_LOG_CLEANUP_MARKER,
	);

	try {
		await fs.access(cleanupMarkerPath);
		return null;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}

	let deletedFiles = 0;
	let deletedBytes = 0;
	let pendingFiles = false;
	let skippedEntries = 0;
	const directory = await fs.opendir(logDirectory);

	for await (const entry of directory) {
		if (!LEGACY_DIAGNOSTIC_LOG_PATTERN.test(entry.name)) continue;
		if (deletedFiles >= LEGACY_DIAGNOSTIC_LOG_CLEANUP_BATCH_SIZE) {
			pendingFiles = true;
			break;
		}

		const legacyLogPath = path.join(logDirectory, entry.name);
		try {
			const metadata = await fs.lstat(legacyLogPath);
			if (!metadata.isFile()) {
				skippedEntries += 1;
				continue;
			}
			await fs.rm(legacyLogPath);
			deletedFiles += 1;
			deletedBytes += metadata.size;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw error;
		}
	}

	if (!pendingFiles) {
		try {
			await fs.writeFile(
				cleanupMarkerPath,
				`${new Date().toISOString()}\n`,
				{ flag: "wx" },
			);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
	}

	return {
		deletedFiles,
		deletedBytes,
		pendingFiles,
		skippedEntries,
	};
}

async function initializeDiagnostics() {
	try {
		const fs = await import("node:fs/promises");
		const logDirectory = path.join(app.getPath("userData"), "logs");
		await fs.mkdir(logDirectory, { recursive: true });
		let legacyCleanupResult: LegacyDiagnosticLogCleanupResult | null = null;
		try {
			legacyCleanupResult = await cleanupLegacyDiagnosticLogs(logDirectory);
		} catch (error) {
			console.warn("QuickShot could not clean up legacy diagnostics", error);
		}
		const nextLogPath = path.join(logDirectory, "quickshot.log");
		const nextBackupLogPath = path.join(logDirectory, "quickshot.previous.log");
		try {
			const metadata = await fs.stat(nextLogPath);
			if (metadata.size > DIAGNOSTIC_LOG_MAX_BYTES) {
				await fs.rm(nextBackupLogPath, { force: true });
				await fs.rename(nextLogPath, nextBackupLogPath);
			} else {
				diagnosticLogBytes = metadata.size;
			}
		} catch {
			// The log is created by the first diagnostic entry.
		}
		diagnosticLogPath = nextLogPath;
		diagnosticBackupLogPath = nextBackupLogPath;
		writeDiagnostic("app-ready", {
			pid: process.pid,
			version: app.getVersion(),
			electron: process.versions.electron,
			platform: process.platform,
			arch: process.arch,
		});
		if (
			legacyCleanupResult &&
			(legacyCleanupResult.deletedFiles > 0 ||
				legacyCleanupResult.pendingFiles ||
				legacyCleanupResult.skippedEntries > 0)
		) {
			writeDiagnostic("legacy-diagnostic-logs-cleaned", legacyCleanupResult);
		}
	} catch (error) {
		console.warn("QuickShot diagnostics could not be initialized", error);
	}
}

function normalizeAssetRelativePath(relativePath: string): string {
	return relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

function getAssetRootCandidates(): string[] {
	const appPath = app.getAppPath();
	return [path.join(appPath, "dist"), path.join(appPath, "public")];
}

function isWithinRoot(root: string, target: string): boolean {
	const normalizedRoot = path.resolve(root);
	const normalizedTarget = path.resolve(target);
	return (
		normalizedTarget === normalizedRoot ||
		normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`)
	);
}

async function resolveExistingAssetPath(relativePath: string): Promise<string> {
	const fs = await import("node:fs/promises");
	const sanitizedPath = normalizeAssetRelativePath(relativePath);
	if (!sanitizedPath || sanitizedPath.includes("..")) {
		throw new Error("Invalid asset path");
	}

	for (const root of getAssetRootCandidates()) {
		const candidate = path.resolve(root, sanitizedPath);
		if (!isWithinRoot(root, candidate)) {
			continue;
		}
		try {
			await fs.access(candidate);
			return candidate;
		} catch {
			// keep trying
		}
	}

	throw new Error(`Asset not found: ${sanitizedPath}`);
}

function getAssetMimeType(filePath: string): string {
	switch (path.extname(filePath).toLowerCase()) {
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".png":
			return "image/png";
		case ".webp":
			return "image/webp";
		case ".svg":
			return "image/svg+xml";
		default:
			return "application/octet-stream";
	}
}

function isAllowedRendererUrl(rawUrl: string): boolean {
	if (!rawUrl) return false;

	try {
		const url = new URL(rawUrl);
		if (VITE_DEV_SERVER_URL) {
			const devUrl = new URL(VITE_DEV_SERVER_URL);
			return url.origin === devUrl.origin;
		}

		return (
			url.protocol === "file:" &&
			isWithinRoot(RENDERER_DIST, fileURLToPath(url))
		);
	} catch {
		return false;
	}
}

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
	return Boolean(
		event.senderFrame && isAllowedRendererUrl(event.senderFrame.url),
	);
}

function isTrustedWindowSender(
	event: IpcMainInvokeEvent,
	win: BrowserWindow | null,
): boolean {
	return Boolean(
		win &&
			!win.isDestroyed() &&
			event.sender === win.webContents &&
			isTrustedSender(event),
	);
}

function installWindowGuards(win: BrowserWindow) {
	win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	win.webContents.on("will-navigate", (event, url) => {
		if (!isAllowedRendererUrl(url)) {
			event.preventDefault();
		}
	});
}

function normalizePngPayload(pngData: unknown, maxBytes: number): Buffer {
	if (
		!(pngData instanceof Uint8Array) &&
		!(pngData instanceof ArrayBuffer)
	) {
		throw new Error("Invalid PNG payload");
	}

	return validatePngStructure(pngData, maxBytes).buffer;
}

function validateCapturePngPayload(pngData: unknown): Buffer {
	const buffer = normalizePngPayload(pngData, MAX_CAPTURE_PNG_BYTES);
	if (nativeImage.createFromBuffer(buffer).isEmpty()) {
		throw new Error("PNG payload could not be decoded");
	}
	return buffer;
}

function getOcrHelperPath(): string {
	return app.isPackaged
		? path.join(process.resourcesPath, "ocr", "quickshot-ocr")
		: path.join(APP_ROOT, "build", "ocr", "quickshot-ocr");
}

function ocrFailure(code: OcrErrorCode, error: string) {
	return { success: false as const, code, error };
}

function executeOcrHelper(
	task: ActiveOcrTask,
	imagePath: string,
): Promise<string> {
	if (task.abortController.signal.aborted) {
		return Promise.reject(new Error("OCR task was cancelled"));
	}

	return new Promise((resolve, reject) => {
		let child: ChildProcess;
		try {
			child = execFile(
				getOcrHelperPath(),
				[imagePath],
				{
					encoding: "utf8",
					maxBuffer: MAX_OCR_PROCESS_OUTPUT_BYTES,
					windowsHide: true,
				},
				(error, stdout) => {
					if (error) {
						reject(error);
						return;
					}
					resolve(String(stdout));
				},
			);
		} catch (error) {
			reject(error);
			return;
		}

		task.child = child;
		child.once("close", () => {
			if (task.child === child) task.child = null;
			if (task.forceKillTimer) {
				clearTimeout(task.forceKillTimer);
				task.forceKillTimer = null;
			}
		});
	});
}

async function extractTextFromPng(pngBuffer: Buffer) {
	if (process.platform !== "darwin") {
		return ocrFailure(
			"unsupported-platform",
			"文本提取目前仅支持 macOS",
		);
	}
	if (activeOcrTask) {
		return ocrFailure("busy", "正在提取文字，请稍候");
	}

	const task: ActiveOcrTask = {
		abortController: new AbortController(),
		child: null,
		forceKillTimer: null,
		temporaryDirectory: null,
		terminationReason: null,
	};
	activeOcrTask = task;
	let temporaryDirectory: string | null = null;
	const timeout = setTimeout(() => {
		terminateOcrTask(task, OCR_TIMEOUT_REASON);
	}, OCR_TIMEOUT_MS);
	timeout.unref();

	try {
		const fs = await import("node:fs/promises");
		temporaryDirectory = await fs.mkdtemp(
			path.join(app.getPath("temp"), OCR_TEMP_DIRECTORY_PREFIX),
		);
		task.temporaryDirectory = temporaryDirectory;
		const imagePath = path.join(temporaryDirectory, "capture.png");
		await fs.writeFile(imagePath, pngBuffer, { flag: "wx", mode: 0o600 });

		const stdout = await executeOcrHelper(task, imagePath);
		const result = parseOcrHelperOutput(stdout, MAX_OCR_TEXT_BYTES);
		return {
			success: true as const,
			text: result.text,
			lineCount: result.lineCount,
		};
	} catch (error) {
		let code: OcrErrorCode = "recognition-failed";
		let message = "没有成功提取文字，请重试";
		const errorCode = (error as NodeJS.ErrnoException)?.code;
		if (task.terminationReason === OCR_TIMEOUT_REASON) {
			code = "timeout";
			message = "文字提取超时，请缩小截图范围后重试";
		} else if (task.abortController.signal.aborted) {
			return ocrFailure("recognition-failed", "文字提取已取消");
		} else if (errorCode === "ENOENT" || errorCode === "EACCES") {
			code = "helper-unavailable";
			message = "文本提取组件不可用，请重新安装 QuickShot";
		}
		writeDiagnostic("ocr-failed", { code });
		return ocrFailure(code, message);
	} finally {
		clearTimeout(timeout);
		if (temporaryDirectory) {
			try {
				const fs = await import("node:fs/promises");
				await fs.rm(temporaryDirectory, { force: true, recursive: true });
			} catch {
				writeDiagnostic("ocr-temp-cleanup-failed");
			}
		}
		if (activeOcrTask === task) {
			activeOcrTask = null;
		}
	}
}

function isValidCapturePngPayload(pngData: unknown): boolean {
	try {
		normalizePngPayload(pngData, MAX_CAPTURE_PNG_BYTES);
		return true;
	} catch {
		return false;
	}
}

function toIpcPngBytes(buffer: Buffer): Uint8Array {
	if (
		buffer.byteOffset === 0 &&
		buffer.byteLength === buffer.buffer.byteLength
	) {
		return new Uint8Array(buffer.buffer);
	}
	return Uint8Array.from(buffer);
}

function toIpcRegionCaptureSession(sessionData: RegionCaptureSession) {
	return {
		sessionId: sessionData.sessionId,
		imageBytes: toIpcPngBytes(sessionData.imageBuffer),
	};
}

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
		void win.loadURL(url.toString()).catch((error) => {
			console.warn(`QuickShot failed to load ${windowType}`, error);
		});
	} else {
		void win
			.loadFile(path.join(RENDERER_DIST, "index.html"), {
				query: { windowType, ...query },
			})
			.catch((error) => {
				console.warn(`QuickShot failed to load ${windowType}`, error);
			});
	}
}

function waitForWindowLoad(win: BrowserWindow): Promise<void> {
	const { webContents } = win;
	if (!webContents.isLoadingMainFrame() && webContents.getURL()) {
		return Promise.resolve();
	}

	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error("Window load timed out"));
		}, PREVIEW_READY_TIMEOUT_MS);
		const cleanup = () => {
			clearTimeout(timeout);
			webContents.removeListener("did-finish-load", handleLoad);
			webContents.removeListener("did-fail-load", handleLoadFailure);
			win.removeListener("closed", handleClosed);
		};
		const handleLoad = () => {
			cleanup();
			resolve();
		};
		const handleLoadFailure = (
			_event: Electron.Event,
			_errorCode: number,
			errorDescription: string,
			_url: string,
			isMainFrame: boolean,
		) => {
			if (!isMainFrame) return;
			cleanup();
			reject(new Error(errorDescription));
		};
		const handleClosed = () => {
			cleanup();
			reject(new Error("Window closed before loading"));
		};

		webContents.once("did-finish-load", handleLoad);
		webContents.on("did-fail-load", handleLoadFailure);
		win.once("closed", handleClosed);
	});
}

function getPinnedScreenshotForEvent(
	event: IpcMainInvokeEvent,
): PinnedScreenshotRecord | null {
	if (!isTrustedSender(event)) return null;
	for (const record of pinnedScreenshots.values()) {
		if (
			!record.window.isDestroyed() &&
			event.sender === record.window.webContents
		) {
			return record;
		}
	}
	return null;
}

function clearPinnedScreenshotReadyTimer(record: PinnedScreenshotRecord) {
	if (record.readyTimer) {
		clearTimeout(record.readyTimer);
		record.readyTimer = null;
	}
}

function ensurePinnedScreenshotRecoveryShortcut(): boolean {
	const hasClickThroughPin = [...pinnedScreenshots.values()].some(
		(record) => record.clickThrough,
	);
	if (!hasClickThroughPin) return false;
	if (globalShortcut.isRegistered(PINNED_SCREENSHOT_RECOVERY_SHORTCUT)) {
		return true;
	}

	const registered = globalShortcut.register(
		PINNED_SCREENSHOT_RECOVERY_SHORTCUT,
		() => restorePinnedScreenshotInteraction("shortcut"),
	);
	if (!registered) {
		writeDiagnostic("pinned-recovery-shortcut-registration-failed");
	}
	return registered;
}

function releasePinnedScreenshotRecoveryShortcutIfIdle() {
	const hasClickThroughPin = [...pinnedScreenshots.values()].some(
		(record) => record.clickThrough,
	);
	if (
		!hasClickThroughPin &&
		globalShortcut.isRegistered(PINNED_SCREENSHOT_RECOVERY_SHORTCUT)
	) {
		globalShortcut.unregister(PINNED_SCREENSHOT_RECOVERY_SHORTCUT);
	}
}

function removePinnedScreenshot(
	record: PinnedScreenshotRecord,
	reason: string,
	destroyWindow: boolean,
) {
	if (pinnedScreenshots.get(record.id) !== record) return;

	clearPinnedScreenshotReadyTimer(record);
	record.pendingImageBuffer = null;
	pinnedScreenshots.delete(record.id);
	if (destroyWindow && !record.window.isDestroyed()) {
		record.window.destroy();
	}
	releasePinnedScreenshotRecoveryShortcutIfIdle();
	refreshTrayMenu();
	writeDiagnostic("pinned-screenshot-removed", {
		id: record.id,
		reason,
		count: pinnedScreenshots.size,
	});
}

function restorePinnedScreenshotInteraction(reason: string) {
	let restoredCount = 0;
	for (const record of pinnedScreenshots.values()) {
		if (!record.clickThrough || record.window.isDestroyed()) continue;
		record.window.setIgnoreMouseEvents(false);
		record.window.setFocusable(true);
		record.clickThrough = false;
		restoredCount += 1;
		record.window.webContents.send("pinned-interaction-restored");
	}
	if (restoredCount > 0) {
		releasePinnedScreenshotRecoveryShortcutIfIdle();
		writeDiagnostic("pinned-interaction-restored", {
			reason,
			count: restoredCount,
		});
		refreshTrayMenu();
	}
}

function closeAllPinnedScreenshots() {
	for (const record of [...pinnedScreenshots.values()]) {
		removePinnedScreenshot(record, "close-all", true);
	}
}

function createPinnedScreenshotWindow(
	pngBuffer: Buffer,
): PinnedScreenshotRecord | null {
	if (!canCreatePinnedScreenshot(pinnedScreenshots.size)) return null;

	const decodedImage = nativeImage.createFromBuffer(pngBuffer);
	if (decodedImage.isEmpty()) {
		throw new Error("Pinned screenshot could not be decoded");
	}
	const sourceSize = decodedImage.getSize();
	const rasterSize = fitPinnedRasterSize(sourceSize.width, sourceSize.height);
	const pinnedImage =
		rasterSize.width === sourceSize.width &&
		rasterSize.height === sourceSize.height
			? decodedImage
			: decodedImage.resize({
					width: rasterSize.width,
					height: rasterSize.height,
					quality: "best",
				});
	const pinnedPngBuffer = pinnedImage.toPNG();
	validatePngStructure(pinnedPngBuffer, MAX_EXPORT_PNG_BYTES);

	const previewBounds =
		screenshotPreviewWindow && !screenshotPreviewWindow.isDestroyed()
			? screenshotPreviewWindow.getBounds()
			: undefined;
	const display = previewBounds
		? screen.getDisplayMatching(previewBounds)
		: screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
	const { workArea } = display;
	const maximumWindowSize = {
		maxWidth: Math.max(
			240,
			Math.min(520, Math.floor(workArea.width * 0.46)),
		),
		maxHeight: Math.max(
			180,
			Math.min(420, Math.floor(workArea.height * 0.52)),
		),
	};
	const windowAspectRatio = clampPinnedWindowAspectRatio(
		rasterSize.width / rasterSize.height,
	);
	const initialSize = resizePinnedWindowFromWidth(
		rasterSize.width,
		windowAspectRatio,
		{
			minWidth: 200,
			minHeight: 120,
			...maximumWindowSize,
		},
	);
	const placementSlot = findAvailablePinnedPlacementSlot(
		[...pinnedScreenshots.values()].map((record) => record.placementSlot),
	);
	if (placementSlot === null) return null;
	const offset = placementSlot * 24;
	const rightInset = 24 + offset;
	const topInset = 24 + offset;
	const x = Math.max(
		workArea.x,
		workArea.x + workArea.width - initialSize.width - rightInset,
	);
	const y = Math.min(
		workArea.y + workArea.height - initialSize.height,
		workArea.y + topInset,
	);

	const pinWindow = new BrowserWindow({
		x,
		y,
		width: initialSize.width,
		height: initialSize.height,
		minWidth: Math.min(200, initialSize.width),
		minHeight: Math.min(120, initialSize.height),
		frame: false,
		transparent: true,
		backgroundColor: "#00000000",
		resizable: true,
		movable: true,
		minimizable: false,
		maximizable: false,
		fullscreenable: false,
		skipTaskbar: true,
		focusable: true,
		acceptFirstMouse: true,
		hasShadow: true,
		show: false,
		title: "QuickShot Pin",
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
			webSecurity: true,
			allowRunningInsecureContent: false,
			webviewTag: false,
		},
	});
	installWindowGuards(pinWindow);
	pinWindow.setAlwaysOnTop(true, "floating");
	pinWindow.setVisibleOnAllWorkspaces(true, {
		visibleOnFullScreen: true,
		skipTransformProcessType: true,
	});
	pinWindow.setAspectRatio(windowAspectRatio);

	const id = ++nextPinnedScreenshotId;
	const record: PinnedScreenshotRecord = {
		id,
		window: pinWindow,
		pendingImageBuffer: pinnedPngBuffer,
		imageDelivered: false,
		aspectRatio: windowAspectRatio,
		placementSlot,
		readyTimer: null,
		clickThrough: false,
	};
	pinnedScreenshots.set(id, record);
	record.readyTimer = setTimeout(() => {
		removePinnedScreenshot(record, "ready-timeout", true);
	}, PINNED_SCREENSHOT_READY_TIMEOUT_MS);
	record.readyTimer.unref();

	pinWindow.on("closed", () => {
		removePinnedScreenshot(record, "closed", false);
	});
	pinWindow.webContents.on(
		"did-fail-load",
		(_event, code, description, _url, isMainFrame) => {
			if (!isMainFrame) return;
			writeDiagnostic("pinned-screenshot-load-failed", {
				id,
				code,
				description,
			});
			removePinnedScreenshot(record, "load-failed", true);
		},
	);
	pinWindow.webContents.on("render-process-gone", () => {
		removePinnedScreenshot(record, "render-process-gone", true);
	});
	pinWindow.on("unresponsive", () => {
		removePinnedScreenshot(record, "unresponsive", true);
	});

	loadWindow(pinWindow, "screenshot-pin");
	refreshTrayMenu();
	writeDiagnostic("pinned-screenshot-created", {
		id,
		width: initialSize.width,
		height: initialSize.height,
		rasterWidth: rasterSize.width,
		rasterHeight: rasterSize.height,
		placementSlot,
		count: pinnedScreenshots.size,
	});
	return record;
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
		if (regionSelectorReady) return;

		const staleWindow = regionSelectorWindow;
		regionSelectorWindow = null;
		regionSelectorLoadPromise = null;
		if (!staleWindow.isDestroyed()) staleWindow.destroy();
		writeDiagnostic("region-selector-rebuilding");
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
			webSecurity: true,
			allowRunningInsecureContent: false,
			webviewTag: false,
		},
	});
	const selectorWindow = regionSelectorWindow;

	installWindowGuards(selectorWindow);
	selectorWindow.setAlwaysOnTop(true, "screen-saver");
	selectorWindow.setVisibleOnAllWorkspaces(true);
	loadWindow(selectorWindow, "screenshot-region");

	regionSelectorReady = false;
	regionSelectorLoadPromise = waitForWindowLoad(selectorWindow)
		.then(() => {
			regionSelectorReady = true;
		})
		.catch((error) => {
			regionSelectorReady = false;
			console.warn("QuickShot region selector failed to load", error);
		});
	selectorWindow.webContents.on("did-start-loading", () => {
		if (regionSelectorWindow !== selectorWindow) return;
		if (regionSelectorReady && capturePhase !== "idle") {
			writeDiagnostic("region-selector-reloaded-during-capture", {
				phase: capturePhase,
			});
			cancelActiveCapture(false);
		}
		regionSelectorReady = false;
		regionSelectorLoadPromise = waitForWindowLoad(selectorWindow)
			.then(() => {
				regionSelectorReady = true;
			})
				.catch((error) => {
					regionSelectorReady = false;
					console.warn("QuickShot region selector failed to reload", error);
				});
	});

	const discardSelectorWindow = (reason: string) => {
		if (regionSelectorWindow !== selectorWindow) return;
		writeDiagnostic("region-selector-discarded", { reason });
		if (capturePhase !== "idle") cancelActiveCapture(false);
		regionSelectorWindow = null;
		regionSelectorReady = false;
		regionSelectorLoadPromise = null;
		if (!selectorWindow.isDestroyed()) selectorWindow.destroy();
	};
	selectorWindow.webContents.on("render-process-gone", () => {
		discardSelectorWindow("render-process-gone");
	});
	selectorWindow.on("unresponsive", () => {
		discardSelectorWindow("unresponsive");
	});
	selectorWindow.on("closed", () => {
		if (regionSelectorWindow === selectorWindow) {
			regionSelectorWindow = null;
			regionSelectorReady = false;
			regionSelectorLoadPromise = null;
		}
	});

	await regionSelectorLoadPromise;
}

function createPreviewWindow(display: Display | null): BrowserWindow {
	const isMac = process.platform === "darwin";
	const { workArea } = display ?? screen.getPrimaryDisplay();
	const W = 960,
		H = 720;
	const win = new BrowserWindow({
		width: W,
		height: H,
		minWidth: 640,
		minHeight: 480,
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
			webSecurity: true,
			allowRunningInsecureContent: false,
			webviewTag: false,
		},
	});
	installWindowGuards(win);
	return win;
}

function presentPreviewWindow(win: BrowserWindow) {
	if (win.isDestroyed()) return;

	win.show();
	if (process.platform === "darwin") {
		// QuickShot is an accessory app, so BrowserWindow.focus() alone can leave
		// a newly-created preview behind the app the user captured.
		app.focus({ steal: true });
		win.moveTop();
	}
	win.focus();
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
): Promise<Buffer | null> {
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
		return validateCapturePngPayload(buffer);
	} catch (error) {
		writeDiagnostic("display-capture-failed", {
			error: serializeError(error),
		});
		return null;
	} finally {
		try {
			const fs = await import("node:fs/promises");
			await fs.unlink(filePath);
		} catch {}
	}
}

async function captureInteractiveSelectionWithScreencapture(
	captureAttempt: number,
): Promise<Buffer | null> {
	const filePath = path.join(
		app.getPath("temp"),
		`quickshot-selection-${Date.now()}-${Math.random().toString(36).slice(2)}.png`,
	);

	const previousProcess = activeCaptureProcess;
	if (previousProcess) {
		writeDiagnostic("interactive-capture-waiting-for-previous", {
			pid: previousProcess.child.pid,
		});
		await previousProcess.closed;
		if (
			captureAttempt !== activeCaptureAttempt ||
			capturePhase !== "preparing-region"
		) {
			return null;
		}
	}

	const abortController = new AbortController();

	try {
		await new Promise<void>((resolve, reject) => {
			const child = execFile(
				"/usr/sbin/screencapture",
				["-i", "-s", "-x", "-t", "png", filePath],
				{
					signal: abortController.signal,
					killSignal: "SIGTERM",
				},
			);
			let executionError: Error | null = null;
			let resolveClosed!: () => void;
			const closed = new Promise<void>((resolveProcessClosed) => {
				resolveClosed = resolveProcessClosed;
			});
			const state: CaptureProcessState = {
				child,
				abortController,
				closed,
				resolveClosed,
				forceKillTimer: null,
				timeoutTimer: null,
				terminationReason: null,
			};
			activeCaptureProcess = state;
			state.timeoutTimer = setTimeout(() => {
				void terminateCaptureProcess(state, "capture-timeout");
			}, INTERACTIVE_CAPTURE_TIMEOUT_MS);
			writeDiagnostic("interactive-capture-process-started", {
				pid: child.pid,
			});
			let settled = false;
			const finish = (
				code: number | null,
				signal: NodeJS.Signals | null,
			) => {
				if (settled) return;
				settled = true;
				clearCaptureProcessTimers(state);
				if (activeCaptureProcess === state) activeCaptureProcess = null;
				state.resolveClosed();
				writeDiagnostic("interactive-capture-process-closed", {
					pid: child.pid,
					code,
					signal,
					terminationReason: state.terminationReason,
				});
				if (executionError) {
					reject(executionError);
				} else if (code === 0) {
					resolve();
				} else {
					reject(
						new Error(
							`Screenshot process exited with code ${String(code)} and signal ${String(signal)}`,
						),
					);
				}
			};
			child.once("error", (error) => {
				executionError = error;
				if (child.pid === undefined) finish(null, null);
			});
			child.once("close", finish);
		});
		const fs = await import("node:fs/promises");
		const buffer = await fs.readFile(filePath);
		return validateCapturePngPayload(buffer);
	} catch (error) {
		if (!abortController.signal.aborted) {
			writeDiagnostic("interactive-capture-failed", {
				error: serializeError(error),
			});
		} else {
			writeDiagnostic("interactive-capture-aborted", {
				reason:
					typeof abortController.signal.reason === "string"
						? abortController.signal.reason
						: serializeError(abortController.signal.reason),
			});
		}
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
): Promise<Buffer | null> {
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
	return normalizePngPayload(
		matchingSource.thumbnail.toPNG(),
		MAX_CAPTURE_PNG_BYTES,
	);
}

async function captureDisplayImage(display: Display): Promise<Buffer | null> {
	if (process.platform === "darwin") {
		const nativeCapture = await captureDisplayWithScreencapture(display);
		if (nativeCapture) {
			return nativeCapture;
		}
	}

	return captureDisplayWithDesktopCapturer(display);
}

function clearPreviewReadyTimer() {
	if (previewReadyTimer) {
		clearTimeout(previewReadyTimer);
		previewReadyTimer = null;
	}
}

function openPreviewForImage(imageBuffer: Buffer): boolean {
	if (!isValidCapturePngPayload(imageBuffer)) {
		writeDiagnostic("preview-image-rejected");
		return false;
	}

	const sessionId = nextCaptureSessionId + 1;
	let previewWindow: BrowserWindow;
	try {
		previewWindow = createPreviewWindow(activeCaptureDisplay);
	} catch (error) {
		writeDiagnostic("preview-create-failed", {
			sessionId,
			error: serializeError(error),
		});
		return false;
	}

	previewWindow.on("closed", () => {
		if (screenshotPreviewWindow === previewWindow) {
			abortActiveOcr("preview-closed");
			clearPreviewReadyTimer();
			screenshotPreviewWindow = null;
			screenshotCroppedBuffer = null;
		}
		if (pendingPreviewSessionId === sessionId) {
			pendingPreviewSessionId = null;
			activeCaptureSessionId = null;
			activeCaptureDisplay = null;
			capturePhase = "idle";
		}
	});
	previewWindow.webContents.on("did-fail-load", (_event, _code, _description, _url, isMainFrame) => {
		if (isMainFrame && !previewWindow.isDestroyed()) {
			writeDiagnostic("preview-load-failed", {
				sessionId,
				code: _code,
				description: _description,
			});
			previewWindow.destroy();
		}
	});
	previewWindow.webContents.on("render-process-gone", () => {
		writeDiagnostic("preview-render-process-gone", { sessionId });
		if (!previewWindow.isDestroyed()) previewWindow.destroy();
	});
	previewWindow.on("unresponsive", () => {
		writeDiagnostic("preview-unresponsive", { sessionId });
		if (!previewWindow.isDestroyed()) previewWindow.destroy();
	});

	nextCaptureSessionId = sessionId;
	pendingRegionCaptureSession = null;
	activeCaptureSessionId = sessionId;
	screenshotCroppedBuffer = imageBuffer;
	capturePhase = "opening-preview";
	pendingPreviewSessionId = sessionId;
	screenshotPreviewWindow = previewWindow;
	clearPreviewReadyTimer();
	previewReadyTimer = setTimeout(() => {
		if (pendingPreviewSessionId === sessionId && !previewWindow.isDestroyed()) {
			writeDiagnostic("preview-ready-timeout", { sessionId });
			previewWindow.destroy();
		}
	}, PREVIEW_READY_TIMEOUT_MS);
	loadWindow(previewWindow, "screenshot-preview", {
		sessionId: String(sessionId),
	});
	writeDiagnostic("preview-created", { sessionId });
	return true;
}

function refreshTrayMenu() {
	if (!tray) return;

	const pinnedCount = pinnedScreenshots.size;
	const hasClickThroughPin = [...pinnedScreenshots.values()].some(
		(record) => record.clickThrough,
	);
	const template: MenuItemConstructorOptions[] = [
		{
			label: `Take Screenshot (${CAPTURE_SHORTCUT_LABEL})`,
			click: () => requestCaptureFromUser("tray-menu"),
		},
		{
			label: "Repair Shortcut",
			click: () => scheduleShortcutRecovery("tray-repair", 0, true),
		},
		{
			label: "Show Diagnostics",
			enabled: Boolean(diagnosticLogPath),
			click: () => {
				if (diagnosticLogPath) shell.showItemInFolder(diagnosticLogPath);
			},
		},
	];

	if (pinnedCount > 0) {
		template.push(
			{ type: "separator" },
			{
				label: `Pinned Screenshots (${pinnedCount}/${MAX_PINNED_SCREENSHOTS})`,
				enabled: false,
			},
			{
				label: `Restore Pinned Interaction (${PINNED_SCREENSHOT_RECOVERY_SHORTCUT_LABEL})`,
				enabled: hasClickThroughPin,
				click: () => restorePinnedScreenshotInteraction("tray-menu"),
			},
			{
				label: "Close All Pinned Screenshots",
				click: closeAllPinnedScreenshots,
			},
		);
	}

	template.push(
		{ type: "separator" },
		{ label: "Quit", click: () => app.quit() },
	);
	tray.setContextMenu(Menu.buildFromTemplate(template));
}

function createTray() {
	const icon = nativeImage
		.createFromPath(
			path.join(process.env.VITE_PUBLIC || RENDERER_DIST, "icon.png"),
		)
		.resize({ width: 18, height: 18, quality: "best" });

	tray = new Tray(icon);
	tray.setToolTip(`QuickShot · ${CAPTURE_SHORTCUT_LABEL}`);
	refreshTrayMenu();
	tray.on("click", () => requestCaptureFromUser("tray"));
}

function buildDefaultScreenshotPath() {
	return nextScreenshotPath(app.getPath("downloads"));
}

async function writeQuickSaveScreenshot(pngBuffer: Buffer): Promise<string> {
	return writePngWithoutOverwrite(pngBuffer, buildDefaultScreenshotPath);
}

async function triggerScreenshot(source = "unknown") {
	clearCaptureRestartTimer();
	if (capturePhase !== "idle") {
		writeDiagnostic("capture-restarted-while-busy", {
			source,
			phase: capturePhase,
		});
		cancelActiveCapture(true);
		captureRestartTimer = setTimeout(() => {
			captureRestartTimer = null;
			void triggerScreenshot(`${source}:restart`);
		}, CAPTURE_RESTART_DELAY_MS);
		return;
	}

	const captureAttempt = ++activeCaptureAttempt;
	capturePhase = "preparing-region";
	writeDiagnostic("capture-started", { source, captureAttempt });
	screenshotCroppedBuffer = null;
	pendingRegionCaptureSession = null;
	screenshotPreviewWindow?.close();

	try {
		if (process.platform === "darwin") {
			const imageBuffer =
				await captureInteractiveSelectionWithScreencapture(captureAttempt);
			if (captureAttempt !== activeCaptureAttempt) return;
			if (!imageBuffer) {
				capturePhase = "idle";
				writeDiagnostic("capture-ended-without-image", {
					source,
				});
				return;
			}

			activeCaptureDisplay = getCaptureDisplay();
			if (!openPreviewForImage(imageBuffer)) {
				cancelActiveCapture();
			}
			return;
		}

		activeCaptureDisplay = getCaptureDisplay();
		await ensureRegionSelector();
		if (captureAttempt !== activeCaptureAttempt) return;
		if (!regionSelectorWindow || !regionSelectorReady) {
			capturePhase = "idle";
			return;
		}

		syncRegionSelectorBounds(activeCaptureDisplay);

		const imageBuffer = await captureDisplayImage(activeCaptureDisplay);
		if (captureAttempt !== activeCaptureAttempt) return;
		if (!imageBuffer) {
			capturePhase = "idle";
			return;
		}

		const sessionId = ++nextCaptureSessionId;
		activeCaptureSessionId = sessionId;
		pendingRegionCaptureSession = {
			sessionId,
			imageBuffer,
		};
		regionSelectorWindow.webContents.send(
			"capture-session",
			toIpcRegionCaptureSession(pendingRegionCaptureSession),
		);
	} catch (error) {
		if (captureAttempt !== activeCaptureAttempt) return;
		writeDiagnostic("capture-failed", {
			source,
			error: serializeError(error),
		});
		activeCaptureSessionId = null;
		activeCaptureDisplay = null;
		pendingRegionCaptureSession = null;
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

function cancelActiveCapture(closePreview = false) {
	const previousPhase = capturePhase;
	clearCaptureRestartTimer();
	activeCaptureAttempt += 1;
	void terminateActiveCaptureProcess("capture-cancelled");
	hideRegionSelector();
	activeCaptureSessionId = null;
	pendingPreviewSessionId = null;
	activeCaptureDisplay = null;
	screenshotCroppedBuffer = null;
	pendingRegionCaptureSession = null;
	capturePhase = "idle";
	clearPreviewReadyTimer();
	if (closePreview && screenshotPreviewWindow && !screenshotPreviewWindow.isDestroyed()) {
		screenshotPreviewWindow.close();
	}
	writeDiagnostic("capture-cancelled", { previousPhase, closePreview });
}

function registerCaptureShortcut(
	force = false,
	reason = "unspecified",
): boolean {
	const wasRegistered = globalShortcut.isRegistered(CAPTURE_SHORTCUT);
	if (force && globalShortcut.isRegistered(CAPTURE_SHORTCUT)) {
		globalShortcut.unregister(CAPTURE_SHORTCUT);
	}
	if (globalShortcut.isRegistered(CAPTURE_SHORTCUT)) {
		shortcutRetryAttempt = 0;
		return true;
	}

	const registered = globalShortcut.register(CAPTURE_SHORTCUT, () => {
		lastShortcutTriggerAt = Date.now();
		writeDiagnostic("shortcut-triggered", {
			phase: capturePhase,
		});
		requestCaptureFromUser("shortcut");
	});
	if (registered) {
		shortcutRetryAttempt = 0;
		writeDiagnostic("shortcut-registered", {
			reason,
			force,
			wasRegistered,
		});
	} else {
		const retryDelay =
			SHORTCUT_RETRY_DELAYS_MS[
				Math.min(shortcutRetryAttempt, SHORTCUT_RETRY_DELAYS_MS.length - 1)
			];
		shortcutRetryAttempt += 1;
		scheduleShortcutRecovery(`retry:${reason}`, retryDelay, true);
		if (shortcutRetryAttempt === 1) {
			writeDiagnostic("shortcut-registration-failed", {
				reason,
				force,
				wasRegistered,
				retryDelay,
			});
		}
	}
	tray?.setToolTip(
		registered
			? `QuickShot · ${CAPTURE_SHORTCUT_LABEL}`
			: "QuickShot · 快捷键注册失败，请用托盘点击截图",
	);
	return registered;
}

function scheduleShortcutRecovery(
	reason: string,
	delayMs = 250,
	force = true,
) {
	if (isQuitting) return;
	if (shortcutRecoveryTimer) clearTimeout(shortcutRecoveryTimer);
	shortcutRecoveryTimer = setTimeout(() => {
		shortcutRecoveryTimer = null;
		if (capturePhase !== "idle") {
			scheduleShortcutRecovery(`${reason}:busy`, 1_000, force);
			return;
		}
		registerCaptureShortcut(force, reason);
	}, delayMs);
}

async function readSelectedInputSourceSignature(): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync(
			"/usr/bin/defaults",
			[
				"read",
				"com.apple.HIToolbox",
				"AppleSelectedInputSources",
			],
			{
				encoding: "utf8",
				timeout: 1_500,
				maxBuffer: 256 * 1024,
			},
		);
		inputSourceReadFailureLogged = false;
		return stdout.trim() || null;
	} catch (error) {
		if (!isQuitting && !inputSourceReadFailureLogged) {
			inputSourceReadFailureLogged = true;
			writeDiagnostic("input-source-read-failed", {
				error: serializeError(error),
			});
		}
		return null;
	}
}

function scheduleInputSourceRecovery(reason: string) {
	if (isQuitting) return;
	if (inputSourceCheckTimer) clearTimeout(inputSourceCheckTimer);
	inputSourceCheckTimer = setTimeout(() => {
		inputSourceCheckTimer = null;
		if (inputSourceCheckInFlight) {
			inputSourceCheckPending = true;
			return;
		}
		inputSourceCheckInFlight = true;
		void readSelectedInputSourceSignature()
			.then((signature) => {
				if (isQuitting || !signature) return;
				if (lastInputSourceSignature === null) {
					lastInputSourceSignature = signature;
					return;
				}
				if (signature === lastInputSourceSignature) return;
				lastInputSourceSignature = signature;
				scheduleShortcutRecovery(reason, 100, true);
			})
			.finally(() => {
				inputSourceCheckInFlight = false;
				if (inputSourceCheckPending && !isQuitting) {
					inputSourceCheckPending = false;
					scheduleInputSourceRecovery(reason);
				}
			});
	}, INPUT_SOURCE_CHECK_DELAY_MS);
}

function requestCaptureFromUser(source = "unknown") {
	if (ENABLE_CAPTURE_SHORTCUT && source.startsWith("tray")) {
		registerCaptureShortcut(true, `${source}-repair`);
	} else if (
		ENABLE_CAPTURE_SHORTCUT &&
		!globalShortcut.isRegistered(CAPTURE_SHORTCUT)
	) {
		registerCaptureShortcut(false, `${source}-missing`);
	}
	writeDiagnostic("capture-requested", {
		source,
		phase: capturePhase,
		shortcutRegistered: globalShortcut.isRegistered(CAPTURE_SHORTCUT),
	});
	void triggerScreenshot(source);
}

function registerIpcHandlers() {
	ipcMain.handle("get-region-capture-session", (event) => {
		if (
			!isTrustedWindowSender(event, regionSelectorWindow) ||
			capturePhase !== "preparing-region" ||
			!pendingRegionCaptureSession ||
			pendingRegionCaptureSession.sessionId !== activeCaptureSessionId ||
			!isValidCapturePngPayload(pendingRegionCaptureSession.imageBuffer)
		) {
			return { success: false };
		}

		return {
			success: true,
			session: toIpcRegionCaptureSession(pendingRegionCaptureSession),
		};
	});

	ipcMain.handle("region-selector-ready", (event, sessionId: number) => {
		if (
			!isTrustedWindowSender(event, regionSelectorWindow) ||
			!regionSelectorWindow ||
			!Number.isInteger(sessionId) ||
			sessionId !== activeCaptureSessionId ||
			pendingRegionCaptureSession?.sessionId !== sessionId ||
			capturePhase !== "preparing-region"
		) {
			return { success: false };
		}

		regionSelectorWindow.showInactive();
		if (!globalShortcut.isRegistered("Escape")) {
			globalShortcut.register("Escape", cancelActiveCapture);
		}
		capturePhase = "selecting-region";
		pendingRegionCaptureSession = null;
		return { success: true };
	});

	ipcMain.handle("cancel-capture-session", (event, sessionId: number) => {
		if (
			!isTrustedWindowSender(event, regionSelectorWindow) ||
			!Number.isInteger(sessionId) ||
			sessionId !== activeCaptureSessionId
		) {
			return { success: false };
		}

		cancelActiveCapture();
		return { success: true };
	});

	ipcMain.handle(
		"screenshot-region-selected",
		(
			event,
			payload: { sessionId: number; croppedImageBytes: Uint8Array },
		) => {
			if (
				!isTrustedWindowSender(event, regionSelectorWindow) ||
				!payload ||
				!Number.isInteger(payload.sessionId) ||
				payload.sessionId !== activeCaptureSessionId
			) {
				return { success: false, error: "stale capture session" };
			}

			let croppedImageBuffer: Buffer;
			try {
				croppedImageBuffer = validateCapturePngPayload(
					payload.croppedImageBytes,
				);
			} catch {
				return { success: false, error: "invalid image data" };
			}

			if (!openPreviewForImage(croppedImageBuffer)) {
				return { success: false, error: "preview unavailable" };
			}
			hideRegionSelector();
			return { success: true };
		},
	);

	ipcMain.handle("get-preview-session", (event, sessionId: number) => {
		if (
			!isTrustedWindowSender(event, screenshotPreviewWindow) ||
			!Number.isInteger(sessionId) ||
			sessionId !== pendingPreviewSessionId ||
			capturePhase !== "opening-preview" ||
			!screenshotCroppedBuffer ||
			!isValidCapturePngPayload(screenshotCroppedBuffer)
		) {
			return { success: false };
		}

		return {
			success: true,
			imageBytes: toIpcPngBytes(screenshotCroppedBuffer),
		};
	});

	ipcMain.handle("preview-session-ready", (event, sessionId: number) => {
		if (
			!isTrustedWindowSender(event, screenshotPreviewWindow) ||
			!screenshotPreviewWindow ||
			!Number.isInteger(sessionId) ||
			sessionId !== pendingPreviewSessionId ||
			capturePhase !== "opening-preview"
		) {
			return { success: false };
		}

		presentPreviewWindow(screenshotPreviewWindow);
		clearPreviewReadyTimer();
		pendingPreviewSessionId = null;
		activeCaptureSessionId = null;
		activeCaptureDisplay = null;
		screenshotCroppedBuffer = null;
		capturePhase = "idle";
		writeDiagnostic("preview-ready", { sessionId });
		return { success: true };
	});

	ipcMain.handle("save-screenshot-final", async (event, pngData: ArrayBuffer) => {
		try {
			if (!isTrustedWindowSender(event, screenshotPreviewWindow)) {
				return { success: false, error: "untrusted sender" };
			}
			const pngBuffer = normalizePngPayload(pngData, MAX_EXPORT_PNG_BYTES);
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
			await fs.writeFile(result.filePath, pngBuffer);
			return { success: true, path: result.filePath };
		} catch (err) {
			return { success: false, error: String(err) };
		}
	});

	ipcMain.handle("quick-save-screenshot-final", async (event, pngData: ArrayBuffer) => {
		try {
			if (!isTrustedWindowSender(event, screenshotPreviewWindow)) {
				return { success: false, error: "untrusted sender" };
			}
			const pngBuffer = normalizePngPayload(pngData, MAX_EXPORT_PNG_BYTES);
			const filePath = await writeQuickSaveScreenshot(pngBuffer);
			return { success: true, path: filePath };
		} catch (err) {
			return { success: false, error: String(err) };
		}
	});

	ipcMain.handle(
		"copy-to-clipboard",
		(event, pngData: ArrayBuffer | Uint8Array) => {
			try {
				if (!isTrustedWindowSender(event, screenshotPreviewWindow)) {
					return { success: false, error: "untrusted sender" };
				}
				const buf = normalizePngPayload(pngData, MAX_EXPORT_PNG_BYTES);
				clipboard.writeImage(nativeImage.createFromBuffer(buf));
				return { success: true };
			} catch (err) {
				return { success: false, error: String(err) };
			}
		},
	);

	ipcMain.handle(
		"pin-screenshot",
		(event, pngData: ArrayBuffer | Uint8Array) => {
			if (!isTrustedWindowSender(event, screenshotPreviewWindow)) {
				return {
					success: false as const,
					code: "untrusted-sender" as const,
					error: "无法固定当前截图",
				};
			}
			if (!canCreatePinnedScreenshot(pinnedScreenshots.size)) {
				return {
					success: false as const,
					code: "limit-reached" as const,
					error: `最多同时固定 ${MAX_PINNED_SCREENSHOTS} 张截图`,
				};
			}

			try {
				const pngBuffer = normalizePngPayload(
					pngData,
					MAX_EXPORT_PNG_BYTES,
				);
				const record = createPinnedScreenshotWindow(pngBuffer);
				if (!record) {
					return {
						success: false as const,
						code: "limit-reached" as const,
						error: `最多同时固定 ${MAX_PINNED_SCREENSHOTS} 张截图`,
					};
				}
				return { success: true as const };
			} catch (error) {
				writeDiagnostic("pinned-screenshot-create-failed", {
					error: serializeError(error),
				});
				return {
					success: false as const,
					code: "create-failed" as const,
					error: "悬浮截图创建失败，请重试",
				};
			}
		},
	);

	ipcMain.handle("get-pinned-screenshot", (event) => {
		const record = getPinnedScreenshotForEvent(event);
		if (!record?.pendingImageBuffer) {
			return { success: false as const };
		}

		const imageBytes = toIpcPngBytes(record.pendingImageBuffer);
		record.pendingImageBuffer = null;
		record.imageDelivered = true;
		return {
			success: true as const,
			imageBytes,
		};
	});

	ipcMain.handle("pinned-screenshot-ready", (event) => {
		const record = getPinnedScreenshotForEvent(event);
		if (
			!record ||
			record.window.isDestroyed() ||
			!record.imageDelivered
		) {
			return { success: false as const };
		}

		clearPinnedScreenshotReadyTimer(record);
		record.pendingImageBuffer = null;
		record.window.showInactive();
		writeDiagnostic("pinned-screenshot-ready", { id: record.id });
		return { success: true as const };
	});

	ipcMain.handle(
		"set-pinned-screenshot-click-through",
		(event, enabled: boolean) => {
			const record = getPinnedScreenshotForEvent(event);
			if (
				!record ||
				record.window.isDestroyed() ||
				typeof enabled !== "boolean"
			) {
				return { success: false as const };
			}

			if (enabled) {
				record.clickThrough = true;
				ensurePinnedScreenshotRecoveryShortcut();
			} else {
				record.clickThrough = false;
				releasePinnedScreenshotRecoveryShortcutIfIdle();
			}
			record.window.setIgnoreMouseEvents(enabled, {
				forward: enabled,
			});
			record.window.setFocusable(!enabled);
			refreshTrayMenu();
			writeDiagnostic("pinned-click-through-changed", {
				id: record.id,
				enabled,
			});
			return {
				success: true as const,
				recoveryShortcutRegistered: globalShortcut.isRegistered(
					PINNED_SCREENSHOT_RECOVERY_SHORTCUT,
				),
			};
		},
	);

	ipcMain.handle(
		"resize-pinned-screenshot",
		(event, requestedWidth: number) => {
			const record = getPinnedScreenshotForEvent(event);
			if (
				!record ||
				record.window.isDestroyed() ||
				!Number.isFinite(requestedWidth)
			) {
				return { success: false as const };
			}

			const currentBounds = record.window.getBounds();
			const display = screen.getDisplayMatching(currentBounds);
			const { workArea } = display;
			const nextSize = resizePinnedWindowFromWidth(
				requestedWidth,
				record.aspectRatio,
				{
					minWidth: 200,
					minHeight: 120,
					maxWidth: Math.max(240, Math.floor(workArea.width * 0.8)),
					maxHeight: Math.max(180, Math.floor(workArea.height * 0.8)),
				},
			);
			const x = Math.min(
				Math.max(currentBounds.x, workArea.x),
				workArea.x + workArea.width - nextSize.width,
			);
			const y = Math.min(
				Math.max(currentBounds.y, workArea.y),
				workArea.y + workArea.height - nextSize.height,
			);
			record.window.setBounds(
				{
					x,
					y,
					width: nextSize.width,
					height: nextSize.height,
				},
				false,
			);
			return {
				success: true as const,
				width: nextSize.width,
				height: nextSize.height,
			};
		},
	);

	ipcMain.handle("close-pinned-screenshot", (event) => {
		const record = getPinnedScreenshotForEvent(event);
		if (!record) return { success: false as const };
		removePinnedScreenshot(record, "renderer-close", true);
		return { success: true as const };
	});

	ipcMain.handle(
		"extract-text",
		async (event, pngData: ArrayBuffer | Uint8Array) => {
			if (!isTrustedWindowSender(event, screenshotPreviewWindow)) {
				return ocrFailure("invalid-image", "无法读取当前截图");
			}
			if (process.platform !== "darwin") {
				return ocrFailure(
					"unsupported-platform",
					"文本提取目前仅支持 macOS",
				);
			}
			if (activeOcrTask) {
				return ocrFailure("busy", "正在提取文字，请稍候");
			}

			let pngBuffer: Buffer;
			try {
				pngBuffer = validateCapturePngPayload(pngData);
			} catch {
				return ocrFailure("invalid-image", "截图数据无效，请重新截图");
			}
			return extractTextFromPng(pngBuffer);
		},
	);

	ipcMain.handle("copy-text-to-clipboard", (event, text: string) => {
		try {
			if (
				!isTrustedWindowSender(event, screenshotPreviewWindow) ||
				typeof text !== "string" ||
				Buffer.byteLength(text, "utf8") > MAX_OCR_TEXT_BYTES
			) {
				return { success: false, error: "无效的文本内容" };
			}
			clipboard.writeText(text);
			return { success: true };
		} catch {
			return { success: false, error: "复制文本失败，请重试" };
		}
	});

	ipcMain.handle("read-asset-data-url", async (event, relativePath: string) => {
		try {
			if (!isTrustedSender(event) || typeof relativePath !== "string") {
				return null;
			}
			const fs = await import("node:fs/promises");
			const assetPath = await resolveExistingAssetPath(relativePath);
			const fileBuffer = await fs.readFile(assetPath);
			return `data:${getAssetMimeType(assetPath)};base64,${fileBuffer.toString("base64")}`;
		} catch {
			return null;
		}
	});

	ipcMain.handle("get-asset-base-path", (event) => {
		try {
			if (!isTrustedSender(event)) {
				return null;
			}
			const p = path.join(app.getAppPath(), "dist");
			return pathToFileURL(`${p}${path.sep}`).toString();
		} catch {
			return null;
		}
	});
}

app.whenReady().then(async () => {
	if (!HAS_SINGLE_INSTANCE_LOCK) return;
	await initializeDiagnostics();
	try {
		await cleanupStaleOcrTemporaryDirectories();
	} catch {
		writeDiagnostic("ocr-temp-cleanup-failed");
	}

	if (process.platform === "darwin") {
		app.setActivationPolicy("accessory");
	}

	Menu.setApplicationMenu(Menu.buildFromTemplate([]));

	session.defaultSession.setPermissionCheckHandler(() => false);
	session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

	registerIpcHandlers();
	createTray();

	if (process.platform !== "darwin") {
		await ensureRegionSelector();
	}

	if (ENABLE_CAPTURE_SHORTCUT) {
		registerCaptureShortcut(false, "app-ready");
	} else {
		writeDiagnostic("capture-shortcut-disabled");
	}

	const recoverAfterWake = (reason: string) => {
		writeDiagnostic("power-recovery", { reason, phase: capturePhase });
		scheduleShortcutRecovery(reason, 250, true);
		if (pinnedScreenshots.size > 0) {
			ensurePinnedScreenshotRecoveryShortcut();
		}
	};
	const cancelForInactivity = (reason: string) => {
		writeDiagnostic("power-inactive", { reason, phase: capturePhase });
		restorePinnedScreenshotInteraction(reason);
		if (capturePhase !== "idle" || activeCaptureProcess) {
			cancelActiveCapture(true);
		}
	};
	powerMonitor.on("suspend", () => cancelForInactivity("power-suspend"));
	powerMonitor.on("lock-screen", () => cancelForInactivity("screen-lock"));
	powerMonitor.on("user-did-resign-active", () =>
		cancelForInactivity("user-resigned-active"),
	);
	powerMonitor.on("resume", () => recoverAfterWake("power-resume"));
	powerMonitor.on("unlock-screen", () => recoverAfterWake("screen-unlock"));
	powerMonitor.on("user-did-become-active", () =>
		recoverAfterWake("user-became-active"),
	);

	if (process.platform === "darwin") {
		lastInputSourceSignature = await readSelectedInputSourceSignature();
		inputSourceDistributedSubscriptionId =
			systemPreferences.subscribeNotification(
				INPUT_SOURCE_DISTRIBUTED_NOTIFICATION,
				() => scheduleInputSourceRecovery("input-source-distributed"),
			);
		writeDiagnostic("input-source-watchers-ready", {
			distributedSubscriptionId: inputSourceDistributedSubscriptionId,
		});
	}

	if (ENABLE_CAPTURE_SHORTCUT) {
		shortcutHealthTimer = setInterval(() => {
			const registered = globalShortcut.isRegistered(CAPTURE_SHORTCUT);
			if (!registered) {
				writeDiagnostic("shortcut-health-missing", {
					phase: capturePhase,
					lastShortcutTriggerAt,
				});
				scheduleShortcutRecovery("health-check-missing", 0, false);
			}
		}, SHORTCUT_HEALTH_INTERVAL_MS);
		shortcutHealthTimer.unref();
	}
	if (process.argv.includes("--capture-region")) {
		requestCaptureFromUser("launch-command");
	}
});

app.on("second-instance", (_event, commandLine) => {
	writeDiagnostic("second-instance", { commandLine });
	scheduleShortcutRecovery("second-instance", 0, true);
	if (commandLine.includes("--capture-region")) {
		requestCaptureFromUser("launch-command");
		return;
	}
	if (screenshotPreviewWindow && !screenshotPreviewWindow.isDestroyed()) {
		presentPreviewWindow(screenshotPreviewWindow);
	}
});
app.on("will-quit", () => {
	isQuitting = true;
	forceTerminateActiveCaptureProcess("app-will-quit");
	abortActiveOcr("app-will-quit", true);
	closeAllPinnedScreenshots();
	removeActiveOcrTemporaryDirectory();
	clearCaptureRestartTimer();
	if (shortcutRecoveryTimer) clearTimeout(shortcutRecoveryTimer);
	if (shortcutHealthTimer) clearInterval(shortcutHealthTimer);
	if (inputSourceCheckTimer) clearTimeout(inputSourceCheckTimer);
	if (inputSourceDistributedSubscriptionId !== null) {
		systemPreferences.unsubscribeNotification(
			inputSourceDistributedSubscriptionId,
		);
	}
	clearPreviewReadyTimer();
	writeDiagnostic("app-will-quit", { phase: capturePhase });
	globalShortcut.unregisterAll();
});
app.on("window-all-closed", () => {
	/* tray app */
});
app.on("activate", () => {
	scheduleShortcutRecovery("app-activate", 0, true);
});

process.on("uncaughtExceptionMonitor", (error, origin) => {
	writeDiagnostic("uncaught-exception", {
		origin,
		error: serializeError(error),
	});
});
process.on("unhandledRejection", (reason) => {
	writeDiagnostic("unhandled-rejection", {
		error: serializeError(reason),
	});
});
