import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
	createScreenshotPathGenerator,
	writePngWithoutOverwrite,
} from "./screenshotFiles";
import { shouldRegisterCaptureShortcut } from "./captureShortcutPolicy";
import { parseOcrHelperOutput } from "./ocrResult";
import {
	type AppSettings,
	DEFAULT_APP_SETTINGS,
	type LanguagePreference,
	type MacCaptureMode,
	ONBOARDING_VERSION,
	readAppSettings,
	resolveLanguage,
	writeAppSettings,
} from "./appSettings";
import { getMainLanguage, mt, setMainLanguage } from "./i18n";
import {
	DEFAULT_CAPTURE_ACCELERATOR,
	DEFAULT_RESTORE_PINS_ACCELERATOR,
	type ShortcutPlatform,
	acceleratorLabel,
	normalizeAccelerator,
} from "../src/lib/accelerator";
import { type AgentEvent, type AgentResponse, CaptureAgent } from "./captureAgent";
import { type BundleStamp, bundleFromExecutable, shouldHandOver } from "./handOver";
import { findOpaqueBounds, getWindowCaptureArguments } from "./windowCapture";
import {
	type Rect as ScrollRect,
	SCROLL_PANEL_SIZE,
	type ScrollProgress,
	parseScrollProgress,
	placeScrollPanel,
	scrollMaxHeight,
	scrollRegionFromSelection,
	scrollRingLayout,
} from "./scrollCapture";
import { buildUsageHeartbeat, isInstallationId, sendUsageHeartbeat, USAGE_STATS_ENDPOINT } from "./usageStats";
import { type UpdateState, Updater } from "./updater";
import { updateTarget } from "./updates";
import {
	PREVIEW_MIN_WIDTH,
	PREVIEW_MIN_WIDTH_WINDOWS,
	computePreviewBounds,
	readPngDimensions,
} from "./previewWindowLayout";
import {
	type ScreenWindow,
	WINDOWS_WINDOW_LIST_SCRIPT,
	getWindowsWindowListArguments,
	normalizeWindowList,
	parseWindowList,
	toDisplayLocalWindows,
} from "./windowList";
import {
	WINDOWS_OCR_NO_LANGUAGE_EXIT_CODE,
	WINDOWS_OCR_SCRIPT,
	WINDOWS_OCR_TOO_LARGE_EXIT_CODE,
	getWindowsOcrArguments,
	getWindowsPowerShellPath,
	normalizeCjkSpacing,
	stripByteOrderMark,
} from "./windowsOcr";
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
	nativeTheme,
	net,
	Notification,
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
const DIAGNOSTIC_LOG_MAX_BYTES = 512 * 1024;
const LEGACY_DIAGNOSTIC_LOG_PATTERN = /^quickshot-\d{13}\.log$/;
const LEGACY_DIAGNOSTIC_LOG_CLEANUP_MARKER =
	".legacy-diagnostic-logs-cleaned-v1";
const LEGACY_DIAGNOSTIC_LOG_CLEANUP_BATCH_SIZE = 32;
const SHORTCUT_RETRY_DELAYS_MS = [250, 1_500, 5_000, 30_000];
const SPARE_PREVIEW_DELAY_MS = 1_200;
/** Matches the editor's --qs-bg token so windows never flash the wrong colour. */
function getPreviewChromeColors() {
	return nativeTheme.shouldUseDarkColors
		? { background: "#202022", symbol: "#D9DADF" }
		: { background: "#F5F5F7", symbol: "#3A3A3C" };
}
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
// Development-only overrides: an isolated profile so a dev build never shares
// state or the single-instance lock with an installed copy, and a fixture image
// that stands in for the screen so the capture flow runs without permissions.
const DEV_CAPTURE_FILE = app.isPackaged
	? undefined
	: process.env["QUICKSHOT_DEV_CAPTURE_FILE"];
/** Development only: stand in another app for System Settings when testing the permission helper. */
const DEV_SETTINGS_BUNDLE = app.isPackaged
	? undefined
	: process.env["QUICKSHOT_DEV_SETTINGS_BUNDLE"];
/**
 * Development only: a tall PNG that a scrolling capture "scrolls" through
 * instead of the screen, so that flow also runs without permissions.
 */
const DEV_SCROLL_FIXTURE = app.isPackaged
	? undefined
	: process.env["QUICKSHOT_DEV_SCROLL_FIXTURE"];
/**
 * Development only: send anonymous usage statistics from a dev build (they are
 * off there by default), optionally to another endpoint such as a local
 * `wrangler dev`.
 */
const DEV_USAGE_STATS = !app.isPackaged && process.env["QUICKSHOT_DEV_USAGE_STATS"] === "1";
/**
 * Development only: pretend to be this version, so update checks find the
 * latest release. A development build never installs an update.
 */
const DEV_UPDATE_VERSION = app.isPackaged ? undefined : process.env["QUICKSHOT_DEV_UPDATE_VERSION"];
/**
 * Builds installed with `npm run install:mac:local` carry this marker. Like
 * Tokei's, they skip automatic update checks: a public release would replace
 * an unreleased fix and the local signing identity.
 */
const LOCAL_BUILD = app.isPackaged && existsSync(path.join(process.resourcesPath, "local-build"));
const USAGE_ENDPOINT = (!app.isPackaged && process.env["QUICKSHOT_DEV_USAGE_STATS_ENDPOINT"]) || USAGE_STATS_ENDPOINT;
if (!app.isPackaged && process.env["QUICKSHOT_USER_DATA_DIR"]) {
	app.setPath("userData", path.resolve(process.env["QUICKSHOT_USER_DATA_DIR"]));
}
if (!app.isPackaged && process.env["QUICKSHOT_DEV_REMOTE_DEBUGGING_PORT"]) {
	app.commandLine.appendSwitch(
		"remote-debugging-port",
		process.env["QUICKSHOT_DEV_REMOTE_DEBUGGING_PORT"],
	);
}
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
	| "scrolling"
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
	mimeType: FrameMimeType;
	/** Opens the overlay in scrolling-capture mode. */
	scroll: boolean;
};

type FrameMimeType = "image/png" | "image/jpeg";

/**
 * A frozen display. With the agent, `imageBuffer` is a full-quality JPEG
 * preview and the lossless frame stays in the agent for cropping.
 */
type CapturedFrame = {
	buffer: Buffer;
	mimeType: FrameMimeType;
	width: number;
	height: number;
	heldByAgent: boolean;
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
let screenshotCroppedScaleFactor = 1;
let sparePreviewWindow: BrowserWindow | null = null;
let sparePreviewTimer: NodeJS.Timeout | null = null;
let appSettings: AppSettings = { ...DEFAULT_APP_SETTINGS };
let pendingRegionCaptureSession: RegionCaptureSession | null = null;
/** The frozen screen of the current overlay session, for cropping in the main process. */
let regionFrozenFrame: { sessionId: number; frame: CapturedFrame } | null = null;
/** The overlay stays up until the editor is on screen, so nothing flashes between them. */
let overlayAwaitingEditor = false;
/** An editor waiting, hidden, for one more capture to stitch onto its own. */
let stitchTarget: BrowserWindow | null = null;
let captureWindows: { sessionId: number; windows: ScreenWindow[] } | null = null;
let windowListScriptPath: Promise<string> | null = null;
let capturePhase: CapturePhase = "idle";
let nextCaptureSessionId = 0;
let activeCaptureSessionId: number | null = null;
let pendingPreviewSessionId: number | null = null;
let activeCaptureDisplay: Display | null = null;
let activeCaptureProcess: CaptureProcessState | null = null;
let activeOcrTask: ActiveOcrTask | null = null;
let activeCaptureAttempt = 0;
let captureRestartTimer: NodeJS.Timeout | null = null;
let captureStartedAt = 0;
/** The step an overlay capture is on, logged if it stalls. */
let overlayCaptureStep = "idle";
let overlayCaptureWatchdog: NodeJS.Timeout | null = null;
const OVERLAY_CAPTURE_TIMEOUT_MS = 6_000;
/** Recovers when the overlay never reports ready, so the next press works. */
let regionReadyWatchdog: NodeJS.Timeout | null = null;
const REGION_READY_TIMEOUT_MS = 3_000;
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

/**
 * For PNGs QuickShot just captured itself: checks the signature and header
 * without decoding the whole image, which the overlay does anyway.
 */
function acceptCapturedPng(pngData: unknown): Buffer {
	const buffer = normalizePngPayload(pngData, MAX_CAPTURE_PNG_BYTES);
	if (!readPngDimensions(buffer)) throw new Error("PNG header is invalid");
	return buffer;
}

/** For the agent's JPEG previews: checks the signature and size only. */
function acceptCapturedJpeg(bytes: Buffer): Buffer {
	if (bytes.length < 4 || bytes.length > MAX_CAPTURE_PNG_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
		throw new Error("JPEG preview is invalid");
	}
	return bytes;
}

function getCaptureAgentPath(): string {
	return app.isPackaged
		? path.join(process.resourcesPath, "capture-agent", "quickshot-capture-agent")
		: path.join(APP_ROOT, "build", "capture-agent", "quickshot-capture-agent");
}

/**
 * The resident ScreenCaptureKit helper on macOS. Captures and window lists go
 * through it first and fall back to one-off processes when it is unavailable.
 */
const captureAgent =
	process.platform === "darwin" && !DEV_CAPTURE_FILE
		? new CaptureAgent(getCaptureAgentPath(), (event, details) => writeDiagnostic(event, details))
		: null;

/**
 * Scrolling captures stream through the agent. A development scroll fixture
 * starts one even when the screen itself is a fixture.
 */
const scrollAgent =
	captureAgent ??
	(process.platform === "darwin" && DEV_SCROLL_FIXTURE
		? new CaptureAgent(getCaptureAgentPath(), (event, details) => writeDiagnostic(event, details))
		: null);
scrollAgent?.onEvent((event) => handleScrollAgentEvent(event));

function temporaryCapturePath(prefix: string, extension: "png" | "jpg" = "png") {
	return path.join(
		app.getPath("temp"),
		`${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`,
	);
}

/** Asks the agent to write a capture to a temporary PNG and reads it back. */
async function captureWithAgent(
	command: Record<string, unknown>,
	timeoutMs: number,
	format: "png" | "jpg" = "png",
): Promise<{ buffer: Buffer; ms: number; response: AgentResponse } | null> {
	if (!captureAgent) return null;
	const filePath = temporaryCapturePath("quickshot-agent", format);
	const startedAt = Date.now();
	try {
		const response = await captureAgent.request({ ...command, path: filePath }, timeoutMs);
		if (!response?.ok) {
			if (response) writeDiagnostic("capture-agent-failed", { cmd: command.cmd, error: response.error });
			return null;
		}
		const fs = await import("node:fs/promises");
		const bytes = await fs.readFile(filePath);
		return {
			buffer: format === "jpg" ? acceptCapturedJpeg(bytes) : acceptCapturedPng(bytes),
			ms: Date.now() - startedAt,
			response,
		};
	} catch (error) {
		writeDiagnostic("capture-agent-failed", { cmd: command.cmd, error: serializeError(error) });
		return null;
	} finally {
		try {
			const fs = await import("node:fs/promises");
			await fs.unlink(filePath);
		} catch {}
	}
}

/**
 * Starts the agent and, when Screen Recording is already allowed, lets it
 * prepare ScreenCaptureKit so the first capture is as quick as later ones.
 */
function warmCaptureAgent(reason: string) {
	if (!captureAgent) return;
	void captureAgent.request({ cmd: "warm" }, 5_000).then((response) => {
		writeDiagnostic("capture-agent-warm", {
			reason,
			ok: response?.ok ?? false,
			ms: response?.ms,
			error: response?.error,
		});
	});
}

function getWindowListHelperPath(): string {
	return app.isPackaged
		? path.join(process.resourcesPath, "window-list", "quickshot-window-list")
		: path.join(APP_ROOT, "build", "window-list", "quickshot-window-list");
}

function ensureWindowListScript(): Promise<string> {
	windowListScriptPath ??= (async () => {
		const fs = await import("node:fs/promises");
		const directory = path.join(app.getPath("userData"), "helpers");
		await fs.mkdir(directory, { recursive: true });
		const scriptPath = path.join(directory, "window-list-v1.ps1");
		await fs.writeFile(scriptPath, WINDOWS_WINDOW_LIST_SCRIPT, { mode: 0o600 });
		return scriptPath;
	})().catch((error) => {
		windowListScriptPath = null;
		throw error;
	});
	return windowListScriptPath;
}

/**
 * Lists the windows visible on `display`, front to back, in the overlay's
 * coordinate space. Failures only disable window snapping.
 */
/** A window's macOS window number (CGWindowID), or null. */
function windowNumber(win: BrowserWindow | null): number | null {
	if (!win || win.isDestroyed()) return null;
	const match = /^window:(\d+):/.exec(win.getMediaSourceId());
	return match ? Number(match[1]) : null;
}

/**
 * QuickShot's own windows (the editor, pins, settings) can be captured like
 * any other. Only the bubble under the menu bar icon is left out; the overlay
 * is never on screen yet when the list is taken.
 */
function excludedCaptureWindows(): number[] {
	return [windowNumber(trayHintWindow)].filter((id): id is number => id !== null);
}

async function listScreenWindows(display: Display): Promise<ScreenWindow[]> {
	const startedAt = Date.now();
	try {
		if (process.platform === "darwin") {
			const excluded = excludedCaptureWindows();
			const response = await captureAgent?.request({ cmd: "windows", exclude: -1, excludeWindows: excluded }, 800);
			let listed: ScreenWindow[];
			if (response?.ok) {
				listed = normalizeWindowList(response.windows);
			} else {
				const { stdout } = await execFileAsync(
					getWindowListHelperPath(),
					["-1", ...excluded.map(String)],
					{ encoding: "utf8", timeout: 1_500, maxBuffer: 1024 * 1024 },
				);
				listed = parseWindowList(stdout);
			}
			const windows = toDisplayLocalWindows(listed, display.bounds);
			writeDiagnostic("window-list", {
				count: windows.length,
				ms: Date.now() - startedAt,
				via: response?.ok ? "agent" : "helper",
			});
			return windows;
		}
		if (process.platform === "win32") {
			const scriptPath = await ensureWindowListScript();
			const { stdout } = await execFileAsync(
				getWindowsPowerShellPath(),
				getWindowsWindowListArguments(
					scriptPath,
					process.pid,
					path.join(path.dirname(scriptPath), "window-list-v1.dll"),
				),
				{ encoding: "utf8", timeout: 6_000, maxBuffer: 1024 * 1024, windowsHide: true },
			);
			// The helper reports physical pixels; the overlay works in DIPs.
			const windows = parseWindowList(stdout).map((window) => {
				const dip = screen.screenToDipRect(null, {
					x: window.x,
					y: window.y,
					width: window.width,
					height: window.height,
				});
				return { ...window, ...dip };
			});
			const local = toDisplayLocalWindows(windows, display.bounds);
			writeDiagnostic("window-list", { count: local.length, ms: Date.now() - startedAt });
			return local;
		}
	} catch (error) {
		writeDiagnostic("window-list-failed", { error: serializeError(error) });
	}
	return [];
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
	windowsScriptPath: string | null,
): Promise<string> {
	if (task.abortController.signal.aborted) {
		return Promise.reject(new Error("OCR task was cancelled"));
	}

	const command = windowsScriptPath
		? {
				file: getWindowsPowerShellPath(),
				args: getWindowsOcrArguments(windowsScriptPath, imagePath),
			}
		: { file: getOcrHelperPath(), args: [imagePath] };

	return new Promise((resolve, reject) => {
		let child: ChildProcess;
		try {
			child = execFile(
				command.file,
				command.args,
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

function isOcrSupported() {
	return process.platform === "darwin" || process.platform === "win32";
}

async function extractTextFromPng(pngBuffer: Buffer) {
	if (!isOcrSupported()) {
		return ocrFailure("unsupported-platform", mt("ocr.unsupported"));
	}
	if (activeOcrTask) {
		return ocrFailure("busy", mt("ocr.busy"));
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
		let imagePath = path.join(temporaryDirectory, "capture.png");
		await fs.writeFile(imagePath, pngBuffer, { flag: "wx", mode: 0o600 });
		let windowsScriptPath: string | null = null;
		if (process.platform === "win32") {
			// WinRT's StorageFile rejects 8.3 short paths, which TEMP can contain.
			imagePath = await fs.realpath(imagePath);
			windowsScriptPath = path.join(path.dirname(imagePath), "ocr.ps1");
			await fs.writeFile(windowsScriptPath, WINDOWS_OCR_SCRIPT, {
				flag: "wx",
				mode: 0o600,
			});
		}

		const stdout = await executeOcrHelper(task, imagePath, windowsScriptPath);
		const result = parseOcrHelperOutput(
			stripByteOrderMark(stdout.trim()),
			MAX_OCR_TEXT_BYTES,
		);
		return {
			success: true as const,
			text:
				process.platform === "win32"
					? normalizeCjkSpacing(result.text)
					: result.text,
			lineCount: result.lineCount,
		};
	} catch (error) {
		let code: OcrErrorCode = "recognition-failed";
		let message = mt("ocr.failed");
		const errorCode = (error as NodeJS.ErrnoException)?.code as
			| string
			| number
			| undefined;
		if (task.terminationReason === OCR_TIMEOUT_REASON) {
			code = "timeout";
			message = mt("ocr.timeout");
		} else if (task.abortController.signal.aborted) {
			return ocrFailure("recognition-failed", mt("ocr.cancelled"));
		} else if (errorCode === "ENOENT" || errorCode === "EACCES") {
			code = "helper-unavailable";
			message = mt("ocr.helperMissing");
		} else if (errorCode === WINDOWS_OCR_NO_LANGUAGE_EXIT_CODE) {
			code = "helper-unavailable";
			message = mt("ocr.noLanguage");
		} else if (errorCode === WINDOWS_OCR_TOO_LARGE_EXIT_CODE) {
			message = mt("ocr.tooLarge");
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
		mimeType: sessionData.mimeType,
		scroll: sessionData.scroll,
		scrollAvailable: isScrollCaptureAvailable(),
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
	const accelerator = appSettings.shortcuts.restorePins;
	if (registeredRestoreShortcut && registeredRestoreShortcut !== accelerator) {
		globalShortcut.unregister(registeredRestoreShortcut);
		registeredRestoreShortcut = null;
	}
	if (globalShortcut.isRegistered(accelerator)) {
		return true;
	}

	const registered = globalShortcut.register(
		accelerator,
		() => restorePinnedScreenshotInteraction("shortcut"),
	);
	if (registered) {
		registeredRestoreShortcut = accelerator;
	} else {
		writeDiagnostic("pinned-recovery-shortcut-registration-failed");
	}
	return registered;
}

function releasePinnedScreenshotRecoveryShortcutIfIdle() {
	const hasClickThroughPin = [...pinnedScreenshots.values()].some(
		(record) => record.clickThrough,
	);
	if (!hasClickThroughPin && registeredRestoreShortcut) {
		globalShortcut.unregister(registeredRestoreShortcut);
		registeredRestoreShortcut = null;
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
			additionalArguments: [`--quickshot-lang=${getMainLanguage()}`],
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
		backgroundColor: "#00000000",
		alwaysOnTop: true,
		resizable: false,
		movable: false,
		minimizable: false,
		maximizable: false,
		fullscreenable: false,
		// Cover the macOS menu bar and keep square corners over the frozen frame.
		enableLargerThanScreen: true,
		roundedCorners: false,
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
			// The overlay prepares each capture while hidden. Throttled, a hidden
			// window stops producing frames and the image decode never finishes.
			backgroundThrottling: false,
			additionalArguments: [`--quickshot-lang=${getMainLanguage()}`],
		},
	});
	const selectorWindow = regionSelectorWindow;

	installWindowGuards(selectorWindow);
	selectorWindow.setAlwaysOnTop(true, "screen-saver");
	selectorWindow.setVisibleOnAllWorkspaces(true, {
		visibleOnFullScreen: true,
		skipTransformProcessType: true,
	});
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

function getPlatformTitleBarOptions(): Electron.BrowserWindowConstructorOptions {
	switch (process.platform) {
		case "darwin":
			return {
				titleBarStyle: "hiddenInset",
				trafficLightPosition: { x: 18, y: 18 },
			};
		case "win32":
			// Native caption buttons drawn over the editor's own toolbar.
			return {
				titleBarStyle: "hidden",
				titleBarOverlay: {
					color: getPreviewChromeColors().background,
					symbolColor: getPreviewChromeColors().symbol,
					height: 52,
				},
			};
		default:
			return { frame: false };
	}
}

function getPreferredPreviewMinWidth() {
	return process.platform === "win32" ? PREVIEW_MIN_WIDTH_WINDOWS : PREVIEW_MIN_WIDTH;
}

function getPreviewMinimumSize(workArea: Electron.Rectangle) {
	// Windows reserves room in the toolbar for the native caption buttons.
	const width = process.platform === "win32" ? 960 : 880;
	return {
		width: Math.min(width, workArea.width),
		height: Math.min(560, workArea.height),
	};
}

function createPreviewWindow(display: Display | null): BrowserWindow {
	const { workArea } = display ?? screen.getPrimaryDisplay();
	const bounds = computePreviewBounds(workArea, 0, 0, 1, getPreferredPreviewMinWidth());
	const minimum = getPreviewMinimumSize(workArea);
	const win = new BrowserWindow({
		...bounds,
		minWidth: minimum.width,
		minHeight: minimum.height,
		...getPlatformTitleBarOptions(),
		title: "QuickShot",
		backgroundColor: getPreviewChromeColors().background,
		resizable: true,
		show: false,
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
			webSecurity: true,
			allowRunningInsecureContent: false,
			webviewTag: false,
			// The warm spare lives hidden; keep it responsive when it is adopted.
			backgroundThrottling: false,
			additionalArguments: [`--quickshot-lang=${getMainLanguage()}`],
		},
	});
	installWindowGuards(win);
	return win;
}

function syncPreviewChromeWithTheme() {
	const colors = getPreviewChromeColors();
	for (const win of [screenshotPreviewWindow, sparePreviewWindow]) {
		if (!win || win.isDestroyed()) continue;
		win.setBackgroundColor(colors.background);
		if (process.platform === "win32") {
			win.setTitleBarOverlay({ color: colors.background, symbolColor: colors.symbol });
		}
	}
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
		await execFileAsync(
			"/usr/sbin/screencapture",
			["-x", "-t", "png", "-R", getDisplayCaptureBounds(display), filePath],
			{ timeout: 4_000 },
		);
		const fs = await import("node:fs/promises");
		return acceptCapturedPng(await fs.readFile(filePath));
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

/**
 * Captures one window by its CGWindowID: the window's own pixels even where
 * other windows (or the overlay) cover it, with transparent rounded corners
 * and no shadow, trimmed to its visible bounds.
 */
async function captureMacWindowImage(windowId: number): Promise<Buffer | null> {
	const filePath = temporaryCapturePath("quickshot-window");
	const startedAt = Date.now();
	try {
		const agentCapture = await captureWithAgent({ cmd: "window", window: windowId }, 2_000);
		if (agentCapture) {
			// The agent has already trimmed the transparent frame.
			writeDiagnostic("window-capture", { via: "agent", ms: Date.now() - startedAt });
			return agentCapture.buffer;
		}
		await execFileAsync("/usr/sbin/screencapture", getWindowCaptureArguments(windowId, filePath), {
			timeout: 5000,
		});
		const fs = await import("node:fs/promises");
		const buffer = validateCapturePngPayload(await fs.readFile(filePath));
		const image = nativeImage.createFromBuffer(buffer);
		const size = image.getSize();
		const bounds = findOpaqueBounds(image.toBitmap(), size.width, size.height);
		if (!bounds) throw new Error("window image is empty");
		const trimmed =
			bounds.width === size.width && bounds.height === size.height
				? buffer
				: image.crop(bounds).toPNG();
		writeDiagnostic("window-capture", {
			via: "screencapture",
			ms: Date.now() - startedAt,
			width: bounds.width,
			height: bounds.height,
			trimmed: trimmed !== buffer,
		});
		return trimmed;
	} catch (error) {
		// Windows that closed when the overlay took focus (menu bar popovers,
		// for example) fall back to the frozen frame.
		writeDiagnostic("window-capture-failed", { error: serializeError(error) });
		return null;
	} finally {
		try {
			const fs = await import("node:fs/promises");
			await fs.unlink(filePath);
		} catch {}
	}
}

/** Set when the last system selection ended in an error rather than Esc. */
let interactiveCaptureErrored = false;

async function captureInteractiveSelectionWithScreencapture(
	captureAttempt: number,
): Promise<Buffer | null> {
	interactiveCaptureErrored = false;
	if (DEV_CAPTURE_FILE) return readDevCaptureFixture();
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
				["-i", "-o", "-x", "-t", "png", filePath],
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
			// Esc leaves no file behind; a non-zero exit means screencapture
			// itself failed, usually because Screen Recording is not allowed.
			interactiveCaptureErrored =
				error instanceof Error && error.message.startsWith("Screenshot process exited");
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

async function readDevCaptureFixture(): Promise<Buffer | null> {
	if (!DEV_CAPTURE_FILE) return null;
	const fs = await import("node:fs/promises");
	return validateCapturePngPayload(await fs.readFile(DEV_CAPTURE_FILE));
}

const SCREEN_RECORDING_SETTINGS_URL =
	"x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
const PERMISSION_PROMPT_INTERVAL_MS = 15_000;
let lastPermissionPromptAt = 0;

/**
 * A capture that fails silently looks like a broken shortcut. When macOS has
 * not granted Screen Recording, say so and offer to open the right pane.
 */
function explainMissingScreenRecordingPermission() {
	if (process.platform !== "darwin" || DEV_CAPTURE_FILE) return;
	const status = systemPreferences.getMediaAccessStatus("screen");
	writeDiagnostic("screen-recording-status", { status });
	if (status === "granted") return;
	const now = Date.now();
	if (now - lastPermissionPromptAt < PERMISSION_PROMPT_INTERVAL_MS) return;
	lastPermissionPromptAt = now;
	openOnboarding("permission", "capture-without-permission");
}

function pngFrame(buffer: Buffer | null): CapturedFrame | null {
	const size = buffer ? readPngDimensions(buffer) : null;
	return buffer && size ? { buffer, mimeType: "image/png", ...size, heldByAgent: false } : null;
}

async function captureDisplayImage(display: Display): Promise<CapturedFrame | null> {
	if (DEV_CAPTURE_FILE) return pngFrame(await readDevCaptureFixture());
	if (process.platform === "darwin") {
		const agentCapture = await captureWithAgent({ cmd: "display", display: display.id }, 1_500, "jpg");
		if (agentCapture) {
			// Only a full-resolution frame of this display will do for the overlay.
			const width = Number(agentCapture.response.width);
			const height = Number(agentCapture.response.height);
			const expectedWidth = Math.round(display.bounds.width * display.scaleFactor);
			const expectedHeight = Math.round(display.bounds.height * display.scaleFactor);
			if (Math.abs(width - expectedWidth) <= 2 && Math.abs(height - expectedHeight) <= 2) {
				writeDiagnostic("display-capture", {
					via: "agent",
					ms: agentCapture.ms,
					captureMs: agentCapture.response.captureMs,
					encodeMs: agentCapture.response.encodeMs,
				});
				return { buffer: agentCapture.buffer, mimeType: "image/jpeg", width, height, heldByAgent: true };
			}
			writeDiagnostic("capture-agent-size-mismatch", {
				size: { width, height },
				expected: { width: expectedWidth, height: expectedHeight },
			});
		}
		const startedAt = Date.now();
		const nativeCapture = pngFrame(await captureDisplayWithScreencapture(display));
		if (nativeCapture) {
			writeDiagnostic("display-capture", { via: "screencapture", ms: Date.now() - startedAt });
			return nativeCapture;
		}
	}

	return pngFrame(await captureDisplayWithDesktopCapturer(display));
}

function clearPreviewReadyTimer() {
	if (previewReadyTimer) {
		clearTimeout(previewReadyTimer);
		previewReadyTimer = null;
	}
}

function clearSparePreviewTimer() {
	if (sparePreviewTimer) {
		clearTimeout(sparePreviewTimer);
		sparePreviewTimer = null;
	}
}

/**
 * Keeps one hidden, fully loaded editor around so the next capture opens
 * instantly instead of waiting for a renderer to boot.
 */
function scheduleSparePreviewWindow(delayMs = SPARE_PREVIEW_DELAY_MS) {
	if (isQuitting || sparePreviewTimer) return;
	if (sparePreviewWindow && !sparePreviewWindow.isDestroyed()) return;
	sparePreviewTimer = setTimeout(() => {
		sparePreviewTimer = null;
		if (isQuitting || (sparePreviewWindow && !sparePreviewWindow.isDestroyed())) {
			return;
		}
		let win: BrowserWindow;
		try {
			win = createPreviewWindow(null);
		} catch (error) {
			writeDiagnostic("spare-preview-create-failed", {
				error: serializeError(error),
			});
			return;
		}
		sparePreviewWindow = win;
		const discard = (reason: string) => {
			if (sparePreviewWindow !== win) return;
			sparePreviewWindow = null;
			writeDiagnostic("spare-preview-discarded", { reason });
			if (!win.isDestroyed()) win.destroy();
		};
		win.webContents.on("render-process-gone", () => discard("render-process-gone"));
		win.webContents.on("did-fail-load", (_event, _code, _description, _url, isMainFrame) => {
			if (isMainFrame) discard("load-failed");
		});
		win.on("closed", () => {
			if (sparePreviewWindow === win) sparePreviewWindow = null;
		});
		loadWindow(win, "screenshot-preview");
	}, delayMs);
	sparePreviewTimer.unref();
}

function takeSparePreviewWindow(): BrowserWindow | null {
	const win = sparePreviewWindow;
	if (
		!win ||
		win.isDestroyed() ||
		win.webContents.isLoadingMainFrame() ||
		!win.webContents.getURL()
	) {
		return null;
	}
	sparePreviewWindow = null;
	return win;
}

function destroySparePreviewWindow() {
	clearSparePreviewTimer();
	const win = sparePreviewWindow;
	sparePreviewWindow = null;
	if (win && !win.isDestroyed()) win.destroy();
}

function openPreviewForImage(imageBuffer: Buffer): boolean {
	if (!isValidCapturePngPayload(imageBuffer)) {
		writeDiagnostic("preview-image-rejected");
		return false;
	}

	const sessionId = nextCaptureSessionId + 1;
	const display = activeCaptureDisplay ?? getCaptureDisplay();
	const scaleFactor = display.scaleFactor || 1;
	const warmWindow = takeSparePreviewWindow();
	let previewWindow: BrowserWindow;
	try {
		previewWindow = warmWindow ?? createPreviewWindow(display);
	} catch (error) {
		writeDiagnostic("preview-create-failed", {
			sessionId,
			error: serializeError(error),
		});
		return false;
	}
	const imageSize = readPngDimensions(imageBuffer);
	const minimum = getPreviewMinimumSize(display.workArea);
	previewWindow.setMinimumSize(minimum.width, minimum.height);
	if (imageSize) {
		previewWindow.setBounds(
			computePreviewBounds(
				display.workArea,
				imageSize.width,
				imageSize.height,
				scaleFactor,
				getPreferredPreviewMinWidth(),
			),
		);
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
			releaseOverlayForEditor();
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
	screenshotCroppedScaleFactor = scaleFactor;
	capturePhase = "opening-preview";
	pendingPreviewSessionId = sessionId;
	const replacedEditor = screenshotPreviewWindow;
	screenshotPreviewWindow = previewWindow;
	// The editor stays open during a capture, so it can be captured too; the
	// new one takes its place now.
	if (replacedEditor && replacedEditor !== previewWindow && !replacedEditor.isDestroyed()) replacedEditor.close();
	clearPreviewReadyTimer();
	previewReadyTimer = setTimeout(() => {
		if (pendingPreviewSessionId === sessionId && !previewWindow.isDestroyed()) {
			writeDiagnostic("preview-ready-timeout", { sessionId });
			previewWindow.destroy();
		}
	}, PREVIEW_READY_TIMEOUT_MS);
	if (warmWindow) {
		warmWindow.webContents.send("preview-session", sessionId);
	} else {
		loadWindow(previewWindow, "screenshot-preview", {
			sessionId: String(sessionId),
		});
	}
	writeDiagnostic("preview-created", { sessionId, warm: Boolean(warmWindow) });
	return true;
}

function refreshTrayMenu() {
	if (!tray) return;

	const pinnedCount = pinnedScreenshots.size;
	const hasClickThroughPin = [...pinnedScreenshots.values()].some(
		(record) => record.clickThrough,
	);
	const updateItems = updateTrayItems();
	const template: MenuItemConstructorOptions[] = [
		...(updateItems.length ? [...updateItems, { type: "separator" as const }] : []),
		{
			label: mt("tray.capture"),
			accelerator: captureShortcut(),
			registerAccelerator: false,
			click: () => requestCaptureFromUser("tray-menu"),
		},
		...(isScrollCaptureAvailable()
			? [
					{
						label: mt("tray.scrollCapture"),
						accelerator: appSettings.shortcuts.scrollCapture ?? undefined,
						registerAccelerator: false,
						click: () => requestCaptureFromUser("tray-scroll", { scroll: true }),
					},
				]
			: []),
		{ type: "separator" },
	];

	if (process.platform === "darwin") {
		const modeItem = (mode: MacCaptureMode, label: string) => ({
			label,
			type: "radio" as const,
			checked: appSettings.macCaptureMode === mode,
			click: () => void setMacCaptureMode(mode),
		});
		template.push({
			label: mt("tray.captureMode"),
			submenu: [
				modeItem("system", mt("tray.captureMode.system")),
				modeItem("overlay", mt("tray.captureMode.overlay")),
			],
		});
	}

	const languageItem = (value: LanguagePreference, label: string) => ({
		label,
		type: "radio" as const,
		checked: appSettings.language === value,
		click: () => void setLanguagePreference(value),
	});
	template.push({
		label: mt("tray.language"),
		submenu: [
			languageItem("auto", mt("tray.language.auto")),
			languageItem("zh", "简体中文"),
			languageItem("en", "English"),
		],
	});

	if (app.isPackaged && process.platform !== "linux") {
		template.push({
			label: mt("tray.launchAtLogin"),
			type: "checkbox",
			checked: app.getLoginItemSettings().openAtLogin,
			click: (item) => {
				app.setLoginItemSettings({ openAtLogin: item.checked });
				refreshTrayMenu();
			},
		});
	}

	if (pinnedCount > 0) {
		template.push(
			{ type: "separator" },
			{
				label: mt("tray.pinned", {
					count: pinnedCount,
					max: MAX_PINNED_SCREENSHOTS,
				}),
				enabled: false,
			},
			{
				label: mt("tray.restorePinned", {
					shortcut: shortcutLabel(appSettings.shortcuts.restorePins),
				}),
				enabled: hasClickThroughPin,
				click: () => restorePinnedScreenshotInteraction("tray-menu"),
			},
			{
				label: mt("tray.closePinned"),
				click: closeAllPinnedScreenshots,
			},
		);
	}

	template.push(
		{ type: "separator" },
		{
			label: mt("tray.settings"),
			click: () => openSettings("tray-menu"),
		},
		...(updateTarget(process.platform, process.arch)
			? [
					{
						label: mt("tray.checkUpdates"),
						click: () => {
							openSettings("tray-check-updates");
							void updater?.check(true);
						},
					},
				]
			: []),
		{
			label: mt("tray.guide"),
			click: () => openOnboarding("welcome", "tray-menu"),
		},
		{
			label: mt("tray.repairShortcut"),
			click: () => scheduleShortcutRecovery("tray-repair", 0, true),
		},
		{
			label: mt("tray.diagnostics"),
			enabled: Boolean(diagnosticLogPath),
			click: () => {
				if (diagnosticLogPath) shell.showItemInFolder(diagnosticLogPath);
			},
		},
		{ type: "separator" },
		{ label: mt("tray.quit"), click: () => app.quit() },
	);
	tray.setContextMenu(Menu.buildFromTemplate(template));
	notifySettingsWindow();
}

function usesOverlaySelection() {
	return (
		process.platform !== "darwin" || appSettings.macCaptureMode === "overlay"
	);
}

function applyLanguagePreference() {
	setMainLanguage(
		resolveLanguage(appSettings.language, app.getPreferredSystemLanguages()),
	);
}

async function persistAppSettings() {
	try {
		await writeAppSettings(app.getPath("userData"), appSettings);
	} catch (error) {
		writeDiagnostic("settings-write-failed", { error: serializeError(error) });
	}
}

async function setLanguagePreference(language: LanguagePreference) {
	if (appSettings.language === language) return;
	appSettings = { ...appSettings, language };
	applyLanguagePreference();
	refreshTrayMenu();
	writeDiagnostic("language-changed", { language, resolved: getMainLanguage() });
	await persistAppSettings();
	// Idle windows were created with the previous language; rebuild them.
	destroySparePreviewWindow();
	scheduleSparePreviewWindow();
	if (capturePhase === "idle" && regionSelectorWindow && !regionSelectorWindow.isDestroyed()) {
		const staleSelector = regionSelectorWindow;
		regionSelectorWindow = null;
		regionSelectorReady = false;
		regionSelectorLoadPromise = null;
		staleSelector.destroy();
		if (usesOverlaySelection()) void ensureRegionSelector();
	}
}

/**
 * One anonymous report per launch, a little after startup so it never competes
 * with the first capture. Failures are dropped: no retries, no queue.
 */
async function reportLaunchUsage() {
	if (!appSettings.usageStats || (!app.isPackaged && !DEV_USAGE_STATS)) return;
	let installationId = appSettings.installationId;
	if (!isInstallationId(installationId)) {
		installationId = randomUUID();
		appSettings = { ...appSettings, installationId };
		await persistAppSettings();
	}
	const payload = buildUsageHeartbeat({
		installationId,
		appVersion: app.getVersion(),
		platform: process.platform,
		systemVersion: process.getSystemVersion(),
		arch: process.arch,
	});
	if (!payload) {
		writeDiagnostic("usage-stats-skipped");
		return;
	}
	const status = await sendUsageHeartbeat(payload, net.fetch, USAGE_ENDPOINT);
	// The installation ID stays out of the diagnostics log.
	writeDiagnostic("usage-stats-sent", { status });
}

async function setMacCaptureMode(mode: MacCaptureMode) {
	if (appSettings.macCaptureMode === mode) return;
	appSettings = { ...appSettings, macCaptureMode: mode };
	refreshTrayMenu();
	writeDiagnostic("capture-mode-changed", { mode });
	await persistAppSettings();
	if (usesOverlaySelection()) {
		void ensureRegionSelector();
	}
}

/**
 * macOS remembers a hidden menu bar item in the app's own defaults (the
 * "Allow in the Menu Bar" switch in System Settings, or ⌘-dragging the item
 * away). The menu bar is QuickShot's only visible presence, so it always asks
 * to be shown; the item reads these keys when it is created.
 */
const MENU_BAR_VISIBILITY_KEYS = ["NSStatusItem VisibleCC Item-0", "NSStatusItem Visible Item-0"];

function allowMenuBarItem() {
	if (process.platform !== "darwin") return;
	for (const key of MENU_BAR_VISIBILITY_KEYS) {
		if (systemPreferences.getUserDefault(key, "boolean") !== true) {
			systemPreferences.setUserDefault(key, "boolean", true);
		}
	}
}

function createTray() {
	allowMenuBarItem();
	const publicDirectory = process.env.VITE_PUBLIC || RENDERER_DIST;
	let icon: Electron.NativeImage;
	if (process.platform === "darwin") {
		// A monochrome template (with its @2x sibling) that macOS tints to
		// match the menu bar, like the system's own items.
		icon = nativeImage.createFromPath(path.join(publicDirectory, "trayTemplate.png"));
		icon.setTemplateImage(true);
	} else {
		icon = nativeImage
			.createFromPath(path.join(publicDirectory, "icon.png"))
			.resize({ width: 16, height: 16, quality: "best" });
	}

	tray = new Tray(icon);
	tray.setToolTip(`QuickShot · ${shortcutLabel(captureShortcut())}`);
	refreshTrayMenu();
	tray.on("click", () => requestCaptureFromUser("tray"));
	// The menu bar hides items that do not fit; record where ours ended up.
	setTimeout(() => {
		if (tray && !tray.isDestroyed()) writeDiagnostic("tray-bounds", { ...tray.getBounds() });
	}, 1_500);
}

const TRAY_HINT_SIZE = { width: 340, height: 84 };
const TRAY_HINT_DURATION_MS = 3_200;
let trayHintWindow: BrowserWindow | null = null;

function escapeHtml(text: string) {
	return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

/**
 * QuickShot has no window or Dock icon, so opening it shows a small bubble
 * under its menu bar icon for a few seconds. It never takes focus or clicks.
 */
function showTrayHint(reason: string) {
	if (!tray || tray.isDestroyed()) return;
	if (trayHintWindow && !trayHintWindow.isDestroyed()) trayHintWindow.destroy();

	const bounds = tray.getBounds();
	// macOS gives a hidden menu bar item no height. Ask for it to be shown and
	// rebuild it once; only if it is still hidden, say where the switch is.
	if (process.platform === "darwin" && bounds.height === 0) {
		if (reason.endsWith(":retry")) {
			explainHiddenMenuBarIcon(reason);
			return;
		}
		writeDiagnostic("tray-reshown", { reason });
		tray.destroy();
		tray = null;
		createTray();
		setTimeout(() => showTrayHint(`${reason}:retry`), 800);
		return;
	}
	const known = bounds.width > 0 && bounds.height > 0;
	const display = known ? screen.getDisplayMatching(bounds) : screen.getPrimaryDisplay();
	const area = display.workArea;
	const anchorX = known ? bounds.x + bounds.width / 2 : area.x + area.width - 40;
	const x = Math.round(
		Math.min(
			Math.max(area.x + 8, anchorX - TRAY_HINT_SIZE.width / 2),
			area.x + area.width - TRAY_HINT_SIZE.width - 8,
		),
	);
	const y = Math.round(known ? bounds.y + bounds.height + 2 : area.y + 4);
	const arrowLeft = Math.round(anchorX - x);

	const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden;-webkit-user-select:none;cursor:default;
font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI","Microsoft YaHei",sans-serif}
.arrow{position:absolute;top:2px;left:${arrowLeft - 7}px;width:14px;height:8px;background:rgba(30,30,32,.94);
clip-path:polygon(50% 0,100% 100%,0 100%)}
.bubble{position:absolute;top:10px;left:50%;transform:translateX(-50%);max-width:${TRAY_HINT_SIZE.width - 16}px;
box-sizing:border-box;padding:9px 14px 10px;border-radius:12px;background:rgba(30,30,32,.94);color:#fff;
box-shadow:0 10px 28px rgba(0,0,0,.3);border:.5px solid rgba(255,255,255,.12);text-align:center;white-space:nowrap}
.title{font-size:13px;font-weight:600;letter-spacing:.01em}
.detail{margin-top:3px;font-size:11.5px;color:rgba(255,255,255,.68)}
kbd{font:inherit;color:#fff;background:rgba(255,255,255,.14);border-radius:4px;padding:0 4px}
</style></head><body><div class="arrow"></div><div class="bubble"><div class="title">${escapeHtml(
		mt("trayHint.title"),
	)}</div><div class="detail">${escapeHtml(mt("trayHint.detail")).replace(
		"{shortcut}",
		`<kbd>${escapeHtml(shortcutLabel(captureShortcut()))}</kbd>`,
	)}</div></div></body></html>`;

	const hint = new BrowserWindow({
		x,
		y,
		...TRAY_HINT_SIZE,
		frame: false,
		transparent: true,
		backgroundColor: "#00000000",
		resizable: false,
		movable: false,
		minimizable: false,
		maximizable: false,
		fullscreenable: false,
		focusable: false,
		skipTaskbar: true,
		hasShadow: false,
		show: false,
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
			javascript: false,
		},
	});
	trayHintWindow = hint;
	installWindowGuards(hint);
	hint.setIgnoreMouseEvents(true);
	hint.setAlwaysOnTop(true, "pop-up-menu");
	hint.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
	void hint
		.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
		.then(() => {
			if (hint.isDestroyed()) return;
			hint.showInactive();
			writeDiagnostic("tray-hint", { reason, bounds });
			setTimeout(() => {
				if (!hint.isDestroyed()) hint.destroy();
			}, TRAY_HINT_DURATION_MS);
		})
		.catch(() => {
			if (!hint.isDestroyed()) hint.destroy();
		});
	hint.on("closed", () => {
		if (trayHintWindow === hint) trayHintWindow = null;
	});
}

// ── Updates ─────────────────────────────────────────────────────────────────

let updater: Updater | null = null;
let lastTrayUpdateKey = "";

function updateTrayKey(state: UpdateState) {
	return state.kind === "downloading" ? `downloading:${Math.floor(state.progress * 20)}` : state.kind;
}

function handleUpdateState(state: UpdateState, found?: "automatic") {
	// Download progress would rebuild the menu many times a second.
	const key = updateTrayKey(state);
	if (key !== lastTrayUpdateKey) {
		lastTrayUpdateKey = key;
		refreshTrayMenu();
	} else {
		notifySettingsWindow();
	}
	// Only a check nobody asked for announces itself; a manual one shows in Settings.
	if (found === "automatic" && state.kind === "available" && appSettings.updateNotifiedVersion !== state.version) {
		appSettings = { ...appSettings, updateNotifiedVersion: state.version };
		void persistAppSettings();
		if (Notification.isSupported()) {
			const notice = new Notification({
				title: mt("update.notifyTitle", { version: state.version }),
				body: mt("update.notifyBody"),
				silent: true,
			});
			notice.on("click", () => void updater?.install());
			notice.show();
		}
	}
}

/** Asked only when quitting would close something the user has open. */
async function confirmUpdateInstall(version: string): Promise<boolean> {
	const editorOpen = Boolean(screenshotPreviewWindow && !screenshotPreviewWindow.isDestroyed());
	if (!editorOpen && pinnedScreenshots.size === 0 && capturePhase === "idle") return true;
	if (process.platform === "darwin") app.focus({ steal: true });
	const { response } = await dialog.showMessageBox({
		type: "question",
		buttons: [mt("update.install"), mt("update.later")],
		defaultId: 0,
		cancelId: 1,
		message: mt("update.confirmTitle", { version }),
		detail: mt("update.confirmDetail"),
	});
	return response === 0;
}

function createUpdater() {
	updater = new Updater({
		currentVersion: DEV_UPDATE_VERSION ?? app.getVersion(),
		target: updateTarget(process.platform, process.arch),
		fetch: (url, init) => net.fetch(url, init),
		tempDirectory: app.getPath("temp"),
		bundlePath: process.platform === "darwin" ? bundleFromExecutable(process.execPath) : null,
		canInstall: app.isPackaged,
		automatic: (app.isPackaged && !LOCAL_BUILD) || Boolean(DEV_UPDATE_VERSION),
		onChange: handleUpdateState,
		confirmInstall: confirmUpdateInstall,
		quit: () => app.quit(),
		diagnostic: (event, details) => writeDiagnostic(event, details),
	});
	updater.start();
}

/** Tray items for updates: an available or running update, then the manual check. */
function updateTrayItems(): MenuItemConstructorOptions[] {
	const state = updater?.current;
	if (!state) return [];
	if (state.kind === "available") {
		return [{ label: mt("tray.updateAvailable", { version: state.version }), click: () => void updater?.install() }];
	}
	if (state.kind === "downloading") {
		return [{ label: mt("tray.updateDownloading", { percent: Math.round(state.progress * 100) }), enabled: false }];
	}
	if (state.kind === "installing") return [{ label: mt("tray.updateInstalling"), enabled: false }];
	return [];
}

// ── Settings window ────────────────────────────────────────────────────────

let settingsWindow: BrowserWindow | null = null;

function settingsState() {
	const { capture, scrollCapture } = appSettings.shortcuts;
	return {
		platform: process.platform,
		shortcuts: {
			capture: { accelerator: capture, label: shortcutLabel(capture), isDefault: sameShortcut(capture, DEFAULT_CAPTURE_ACCELERATOR) },
			scrollCapture: scrollCapture ? { accelerator: scrollCapture, label: shortcutLabel(scrollCapture) } : null,
			restorePins: {
				accelerator: appSettings.shortcuts.restorePins,
				label: shortcutLabel(appSettings.shortcuts.restorePins),
				isDefault: sameShortcut(appSettings.shortcuts.restorePins, DEFAULT_RESTORE_PINS_ACCELERATOR),
			},
			scrollAvailable: isScrollCaptureAvailable(),
			defaultCaptureLabel: shortcutLabel(DEFAULT_CAPTURE_ACCELERATOR),
			enabled: ENABLE_CAPTURE_SHORTCUT,
		},
		language: appSettings.language,
		macCaptureMode: appSettings.macCaptureMode,
		launchAtLogin: app.getLoginItemSettings().openAtLogin,
		launchAtLoginAvailable: app.isPackaged && process.platform !== "linux",
		update: {
			version: app.getVersion(),
			state: updater?.current ?? { kind: "idle" as const },
			supported: Boolean(updateTarget(process.platform, process.arch)),
			localBuild: LOCAL_BUILD,
		},
	};
}

function notifySettingsWindow() {
	if (settingsWindow && !settingsWindow.isDestroyed()) {
		settingsWindow.webContents.send("settings-changed", settingsState());
	}
}

function openSettings(reason: string) {
	writeDiagnostic("settings-opened", { reason });
	const existing = settingsWindow;
	if (existing && !existing.isDestroyed()) {
		existing.show();
		if (process.platform === "darwin") app.focus({ steal: true });
		existing.focus();
		return;
	}
	const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
	const size = { width: 580, height: 660 };
	const win = new BrowserWindow({
		...size,
		x: Math.round(workArea.x + (workArea.width - size.width) / 2),
		y: Math.round(workArea.y + (workArea.height - size.height) / 2),
		resizable: false,
		maximizable: false,
		minimizable: false,
		fullscreenable: false,
		show: false,
		title: mt("settings.title"),
		titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
		autoHideMenuBar: true,
		backgroundColor: nativeTheme.shouldUseDarkColors ? "#1C1C1E" : "#FAFAFB",
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
			webSecurity: true,
			allowRunningInsecureContent: false,
			webviewTag: false,
			additionalArguments: [`--quickshot-lang=${getMainLanguage()}`],
		},
	});
	settingsWindow = win;
	installWindowGuards(win);
	loadWindow(win, "settings");
	win.once("ready-to-show", () => {
		if (win.isDestroyed()) return;
		win.show();
		if (process.platform === "darwin") app.focus({ steal: true });
		win.focus();
	});
	// While a shortcut is being recorded, every key goes to the recorder:
	// nothing reaches the Edit menu or the page itself.
	win.webContents.on("before-input-event", (event, input) => {
		if (!shortcutsSuspended || (input.type !== "keyDown" && input.type !== "keyUp")) return;
		event.preventDefault();
		win.webContents.send("settings-key", {
			type: input.type,
			code: input.code,
			metaKey: input.meta,
			ctrlKey: input.control,
			altKey: input.alt,
			shiftKey: input.shift,
		});
	});
	// Recording a shortcut never outlives the window, nor its focus.
	win.on("blur", () => setShortcutsSuspended(false));
	win.on("closed", () => {
		if (settingsWindow === win) settingsWindow = null;
		setShortcutsSuspended(false);
	});
}

type OnboardingStep = "welcome" | "permission" | "done";
const ONBOARDING_STEPS: OnboardingStep[] = ["welcome", "permission", "done"];
const ONBOARDING_RELAUNCH_ARGUMENT = "--quickshot-onboarding=";
let onboardingWindow: BrowserWindow | null = null;

function getScreenPermissionStatus() {
	return process.platform === "darwin" ? systemPreferences.getMediaAccessStatus("screen") : "granted";
}

async function markOnboardingSeen() {
	if (appSettings.onboardingVersion >= ONBOARDING_VERSION) return;
	appSettings = { ...appSettings, onboardingVersion: ONBOARDING_VERSION };
	await persistAppSettings();
}

/**
 * The welcome guide: the shortcut, Screen Recording on macOS, and launch at
 * login. Shown on first launch, from the menu, and when a capture finds no
 * permission (opened straight at that step).
 */
function openOnboarding(step: OnboardingStep, reason: string) {
	writeDiagnostic("onboarding-opened", { step, reason });
	const existing = onboardingWindow;
	if (existing && !existing.isDestroyed()) {
		existing.webContents.send("onboarding-step", step);
		existing.show();
		if (process.platform === "darwin") app.focus({ steal: true });
		existing.focus();
		return;
	}
	const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
	const size = { width: 760, height: 540 };
	const win = new BrowserWindow({
		...size,
		x: Math.round(workArea.x + (workArea.width - size.width) / 2),
		y: Math.round(workArea.y + (workArea.height - size.height) / 2),
		resizable: false,
		maximizable: false,
		fullscreenable: false,
		show: false,
		title: "QuickShot",
		titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
		autoHideMenuBar: true,
		backgroundColor: nativeTheme.shouldUseDarkColors ? "#1C1C1E" : "#FAFAFB",
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
			webSecurity: true,
			allowRunningInsecureContent: false,
			webviewTag: false,
			additionalArguments: [`--quickshot-lang=${getMainLanguage()}`],
		},
	});
	onboardingWindow = win;
	installWindowGuards(win);
	loadWindow(win, "onboarding", { step });
	win.once("ready-to-show", () => {
		if (win.isDestroyed()) return;
		win.show();
		if (process.platform === "darwin") app.focus({ steal: true });
		win.focus();
	});
	win.on("closed", () => {
		if (onboardingWindow === win) onboardingWindow = null;
		void markOnboardingSeen();
	});
}

const PERMISSION_HELPER_SIZE = { width: 400, height: 96 };
const PERMISSION_HELPER_GAP = 10;
let permissionHelperWindow: BrowserWindow | null = null;
let permissionHelperTimer: NodeJS.Timeout | null = null;
/** The guide steps aside while the helper is up, so dragging never raises it over Settings. */
let onboardingHiddenForHelper = false;
/** Remembers across the macOS "Quit & Reopen" that Screen Recording was just being allowed. */
const PERMISSION_PENDING_MARKER = "permission-pending";

/** The .app bundle macOS lists under Screen Recording. */
function appBundlePath() {
	return path.resolve(app.getPath("exe"), "..", "..", "..");
}

function closePermissionHelper() {
	if (permissionHelperTimer) {
		clearInterval(permissionHelperTimer);
		permissionHelperTimer = null;
	}
	const helper = permissionHelperWindow;
	permissionHelperWindow = null;
	if (helper && !helper.isDestroyed()) helper.destroy();
	if (onboardingHiddenForHelper) {
		onboardingHiddenForHelper = false;
		const guide = onboardingWindow;
		if (guide && !guide.isDestroyed() && !isQuitting) {
			guide.show();
			if (process.platform === "darwin") app.focus({ steal: true });
			guide.focus();
		}
	}
}

function permissionMarkerPath() {
	return path.join(app.getPath("userData"), PERMISSION_PENDING_MARKER);
}

/**
 * After macOS relaunches QuickShot for Screen Recording, say it worked by
 * opening the guide's last step once. Returns whether it did.
 */
function celebratePermissionIfPending(): boolean {
	const marker = permissionMarkerPath();
	try {
		statSync(marker);
	} catch {
		return false;
	}
	rmSync(marker, { force: true });
	if (getScreenPermissionStatus() !== "granted") return false;
	openOnboarding("done", "permission-granted");
	return true;
}

/**
 * A strip that sits under System Settings with a draggable QuickShot icon:
 * dropping it on the Screen Recording list adds and enables the app. It
 * follows the Settings window, never takes focus, and goes away once access
 * is granted or Settings has been closed for a while.
 */
function showPermissionHelper() {
	if (process.platform !== "darwin" || !captureAgent) return;
	onboardingHiddenForHelper = false;
	closePermissionHelper();
	const helper = new BrowserWindow({
		...PERMISSION_HELPER_SIZE,
		frame: false,
		transparent: true,
		backgroundColor: "#00000000",
		resizable: false,
		movable: false,
		minimizable: false,
		maximizable: false,
		fullscreenable: false,
		focusable: false,
		skipTaskbar: true,
		hasShadow: false,
		show: false,
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
			webSecurity: true,
			allowRunningInsecureContent: false,
			webviewTag: false,
			additionalArguments: [`--quickshot-lang=${getMainLanguage()}`],
		},
	});
	permissionHelperWindow = helper;
	installWindowGuards(helper);
	helper.setAlwaysOnTop(true, "floating");
	helper.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
	loadWindow(helper, "permission-helper");
	writeDiagnostic("permission-helper-shown");

	const startedAt = Date.now();
	let lastSeenAt = Date.now();
	let busy = false;
	permissionHelperTimer = setInterval(() => {
		if (busy || helper.isDestroyed()) return;
		if (getScreenPermissionStatus() === "granted") {
			writeDiagnostic("permission-helper-granted", { ms: Date.now() - startedAt });
			closePermissionHelper();
			return;
		}
		busy = true;
		void captureAgent
			?.request({ cmd: "app-window", bundle: DEV_SETTINGS_BUNDLE ?? "com.apple.systempreferences" }, 800)
			.then((frame) => {
				if (helper.isDestroyed()) return;
				if (!frame?.ok) {
					if (helper.isVisible()) helper.hide();
					// Settings closed (or never opened): give up after a while.
					if (Date.now() - lastSeenAt > 20_000) closePermissionHelper();
					return;
				}
				lastSeenAt = Date.now();
				const bounds = {
					x: Number(frame.x),
					y: Number(frame.y),
					width: Number(frame.width),
					height: Number(frame.height),
				};
				const { workArea } = screen.getDisplayMatching(bounds);
				const x = Math.round(
					Math.min(
						Math.max(workArea.x + 8, bounds.x + (bounds.width - PERMISSION_HELPER_SIZE.width) / 2),
						workArea.x + workArea.width - PERMISSION_HELPER_SIZE.width - 8,
					),
				);
				let y = Math.round(bounds.y + bounds.height + PERMISSION_HELPER_GAP);
				// No room below: tuck it inside the window's bottom edge instead.
				if (y + PERMISSION_HELPER_SIZE.height > workArea.y + workArea.height) {
					y = Math.round(bounds.y + bounds.height - PERMISSION_HELPER_SIZE.height - 16);
				}
				const current = helper.getBounds();
				if (current.x !== x || current.y !== y) helper.setPosition(x, y);
				if (!helper.isVisible()) helper.showInactive();
			})
			.finally(() => {
				busy = false;
			});
	}, 300);
}

function relaunchIntoOnboarding(step: OnboardingStep) {
	const args = process.argv
		.slice(1)
		.filter((argument) => !argument.startsWith(ONBOARDING_RELAUNCH_ARGUMENT));
	app.relaunch({ args: [...args, `${ONBOARDING_RELAUNCH_ARGUMENT}${step}`] });
	app.quit();
}

const MENU_BAR_SETTINGS_URL = "x-apple.systempreferences:com.apple.ControlCenter-Settings.extension";

/** Says QuickShot is running and how to bring its hidden menu bar icon back. */
function explainHiddenMenuBarIcon(reason: string) {
	writeDiagnostic("tray-hidden", { reason });
	app.focus({ steal: true });
	void dialog
		.showMessageBox({
			type: "info",
			message: mt("menuBarHidden.title"),
			detail: mt("menuBarHidden.detail", { shortcut: shortcutLabel(captureShortcut()) }),
			buttons: [mt("menuBarHidden.openSettings"), mt("menuBarHidden.ok")],
			defaultId: 0,
			cancelId: 1,
		})
		.then(({ response }) => {
			if (response === 0) void shell.openExternal(MENU_BAR_SETTINGS_URL);
		})
		.catch(() => {});
}

function buildDefaultScreenshotPath() {
	return nextScreenshotPath(app.getPath("downloads"));
}

async function writeQuickSaveScreenshot(pngBuffer: Buffer): Promise<string> {
	return writePngWithoutOverwrite(pngBuffer, buildDefaultScreenshotPath);
}

async function triggerScreenshot(source = "unknown", options: CaptureOptions = {}) {
	clearCaptureRestartTimer();
	if (capturePhase !== "idle") {
		writeDiagnostic("capture-restarted-while-busy", {
			source,
			phase: capturePhase,
		});
		// A restart during a stitch capture keeps stitching into the same editor.
		cancelActiveCapture(!stitchTarget, false, Boolean(stitchTarget));
		captureRestartTimer = setTimeout(() => {
			captureRestartTimer = null;
			void triggerScreenshot(`${source}:restart`, options);
		}, CAPTURE_RESTART_DELAY_MS);
		return;
	}

	// Without Screen Recording, any capture call makes macOS show its own
	// prompt on top of everything. Go straight to the guide instead.
	if (process.platform === "darwin" && !DEV_CAPTURE_FILE && getScreenPermissionStatus() !== "granted") {
		writeDiagnostic("capture-needs-permission", { source });
		restoreStitchTarget();
		openOnboarding("permission", "capture-without-permission");
		return;
	}

	const captureAttempt = ++activeCaptureAttempt;
	// Scrolling always selects with QuickShot's overlay, whatever the setting.
	const scroll = Boolean(options.scroll) && isScrollCaptureAvailable();
	capturePhase = "preparing-region";
	captureStartedAt = Date.now();
	writeDiagnostic("capture-started", { source, captureAttempt, scroll });
	screenshotCroppedBuffer = null;
	pendingRegionCaptureSession = null;

	try {
		if (!usesOverlaySelection() && !scroll) {
			const imageBuffer =
				await captureInteractiveSelectionWithScreencapture(captureAttempt);
			if (captureAttempt !== activeCaptureAttempt) return;
			if (!imageBuffer) {
				capturePhase = "idle";
				writeDiagnostic("capture-ended-without-image", {
					source,
				});
				if (interactiveCaptureErrored) explainMissingScreenRecordingPermission();
				restoreStitchTarget();
				return;
			}

			activeCaptureDisplay = getCaptureDisplay();
			if (deliverStitchPiece(imageBuffer)) return;
			if (!openPreviewForImage(imageBuffer)) {
				cancelActiveCapture();
			}
			return;
		}

		activeCaptureDisplay = getCaptureDisplay();
		captureWindows = null;
		armOverlayCaptureWatchdog(captureAttempt);
		// Runs alongside the screen capture so window snapping adds no delay.
		const windowsPromise = listScreenWindows(activeCaptureDisplay);
		overlayCaptureStep = "overlay-window";
		await ensureRegionSelector();
		if (captureAttempt !== activeCaptureAttempt) return;
		if (!regionSelectorWindow || !regionSelectorReady) {
			capturePhase = "idle";
			restoreStitchTarget();
			return;
		}

		syncRegionSelectorBounds(activeCaptureDisplay);

		overlayCaptureStep = "display-capture";
		const frame = await captureDisplayImage(activeCaptureDisplay);
		if (captureAttempt !== activeCaptureAttempt) return;
		overlayCaptureStep = "overlay-ready";
		if (!frame) {
			capturePhase = "idle";
			explainMissingScreenRecordingPermission();
			restoreStitchTarget();
			return;
		}

		const sessionId = ++nextCaptureSessionId;
		activeCaptureSessionId = sessionId;
		pendingRegionCaptureSession = {
			sessionId,
			imageBuffer: frame.buffer,
			mimeType: frame.mimeType,
			scroll,
		};
		regionFrozenFrame = { sessionId, frame };
		regionSelectorWindow.webContents.send(
			"capture-session",
			toIpcRegionCaptureSession(pendingRegionCaptureSession),
		);
		clearRegionReadyWatchdog();
		regionReadyWatchdog = setTimeout(() => {
			regionReadyWatchdog = null;
			if (activeCaptureSessionId !== sessionId || capturePhase !== "preparing-region") return;
			writeDiagnostic("region-selector-timeout", { sessionId });
			cancelActiveCapture(false, false);
			// Replace the overlay window; whatever stalled it should not stall the next capture.
			const staleWindow = regionSelectorWindow;
			regionSelectorWindow = null;
			regionSelectorReady = false;
			regionSelectorLoadPromise = null;
			if (staleWindow && !staleWindow.isDestroyed()) staleWindow.destroy();
			void ensureRegionSelector();
		}, REGION_READY_TIMEOUT_MS);
		void windowsPromise.then((windows) => {
			// Sent even when empty: the overlay then knows a click means the whole screen.
			if (activeCaptureSessionId !== sessionId) return;
			captureWindows = { sessionId, windows };
			if (regionSelectorWindow && !regionSelectorWindow.isDestroyed()) {
				regionSelectorWindow.webContents.send("capture-windows", captureWindows);
			}
		});
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
		explainMissingScreenRecordingPermission();
		restoreStitchTarget();
		return;
	}
}

/**
 * Last line of defence: a capture stuck preparing for several seconds is
 * abandoned, so the next shortcut press starts cleanly instead of restarting
 * into the same stall.
 */
function armOverlayCaptureWatchdog(captureAttempt: number) {
	clearOverlayCaptureWatchdog();
	overlayCaptureWatchdog = setTimeout(() => {
		overlayCaptureWatchdog = null;
		if (captureAttempt !== activeCaptureAttempt || capturePhase !== "preparing-region") return;
		writeDiagnostic("capture-stalled", { step: overlayCaptureStep });
		cancelActiveCapture(false, false);
	}, OVERLAY_CAPTURE_TIMEOUT_MS);
}

function clearOverlayCaptureWatchdog() {
	if (overlayCaptureWatchdog) {
		clearTimeout(overlayCaptureWatchdog);
		overlayCaptureWatchdog = null;
	}
}

function clearRegionReadyWatchdog() {
	if (regionReadyWatchdog) {
		clearTimeout(regionReadyWatchdog);
		regionReadyWatchdog = null;
	}
}

/** Brings back the editor that was hidden for a stitch capture, unchanged. */
function restoreStitchTarget() {
	const target = stitchTarget;
	stitchTarget = null;
	if (target && !target.isDestroyed()) presentPreviewWindow(target);
}

/**
 * Sends a finished capture to the editor that asked for it, instead of
 * opening a new editor. Returns false when no stitch is pending.
 */
function deliverStitchPiece(imageBuffer: Buffer): boolean {
	const target = stitchTarget;
	if (!target) return false;
	stitchTarget = null;
	if (target.isDestroyed()) return false;
	const display = activeCaptureDisplay ?? getCaptureDisplay();
	target.webContents.send("stitch-piece", {
		imageBytes: toIpcPngBytes(imageBuffer),
		scaleFactor: display.scaleFactor || 1,
	});
	clearRegionReadyWatchdog();
	clearOverlayCaptureWatchdog();
	overlayCaptureStep = "idle";
	activeCaptureSessionId = null;
	activeCaptureDisplay = null;
	pendingRegionCaptureSession = null;
	screenshotCroppedBuffer = null;
	capturePhase = "idle";
	presentPreviewWindow(target);
	releaseFrozenFrame();
	hideRegionSelector();
	writeDiagnostic("stitch-piece-delivered", { bytes: imageBuffer.length });
	return true;
}

/** Hides a window and waits until it is really off screen, so a capture misses it. */
function hideWindowForCapture(win: BrowserWindow) {
	if (win.isDestroyed() || !win.isVisible()) return Promise.resolve();
	return new Promise<void>((resolve) => {
		const done = () => setTimeout(resolve, 60);
		const timer = setTimeout(done, 300);
		win.once("hide", () => {
			clearTimeout(timer);
			done();
		});
		win.hide();
	});
}

/** Takes the overlay down once the editor it handed over to is showing (or failed). */
function releaseOverlayForEditor() {
	if (!overlayAwaitingEditor) return;
	overlayAwaitingEditor = false;
	releaseFrozenFrame();
	hideRegionSelector();
}

/** Lets the agent drop the lossless frame it keeps for the overlay. */
function releaseFrozenFrame() {
	if (regionFrozenFrame?.frame.heldByAgent) void captureAgent?.request({ cmd: "release" }, 1_000);
	regionFrozenFrame = null;
}

/**
 * Crops the overlay session's frozen screen; `rect` is in frame pixels. The
 * agent crops its lossless copy; otherwise the frame itself is a PNG.
 */
async function cropFrozenFrame(sessionId: number, rect: unknown): Promise<Buffer | null> {
	const held = regionFrozenFrame;
	if (!held || held.sessionId !== sessionId || !rect || typeof rect !== "object") return null;
	const { frame } = held;
	const { x, y, width, height } = rect as Record<string, unknown>;
	if (
		![x, y, width, height].every((value) => Number.isInteger(value)) ||
		(x as number) < 0 ||
		(y as number) < 0 ||
		(width as number) < 1 ||
		(height as number) < 1 ||
		(x as number) + (width as number) > frame.width ||
		(y as number) + (height as number) > frame.height
	) {
		return null;
	}
	const bounds = { x: x as number, y: y as number, width: width as number, height: height as number };
	if (frame.heldByAgent) {
		const cropped = await captureWithAgent({ cmd: "crop", rect: bounds }, 2_000);
		if (cropped) return cropped.buffer;
		// The agent restarted and lost its copy; the full-quality preview will do.
		writeDiagnostic("frame-crop-from-preview");
	}
	const image = nativeImage.createFromBuffer(frame.buffer);
	const cropped = image.crop(bounds);
	return cropped.isEmpty() ? null : cropped.toPNG();
}

// ── Scrolling capture (macOS) ──────────────────────────────────────────────
// After the overlay selects an area, QuickShot steps aside, the agent streams
// the area while the user scrolls and stitches it, and a small panel beside
// it shows the progress. Done (↩) opens the long image in the editor; Esc
// cancels.

type CaptureOptions = { scroll?: boolean };

type ScrollSession = {
	area: ScrollRect;
	/** One screen of the area, in pixels. */
	frameHeight: number;
	ring: BrowserWindow | null;
	panel: BrowserWindow | null;
	previewPath: string;
	progress: ScrollProgress;
	/** The latest preview JPEG, for a panel that asks after it was sent. */
	preview: Buffer | null;
	finishing: boolean;
	startedAt: number;
	timer: NodeJS.Timeout | null;
};

const SCROLL_START_TIMEOUT_MS = 5_000;
const SCROLL_FINISH_TIMEOUT_MS = 30_000;
/** A forgotten scrolling capture finishes on its own instead of recording for ever. */
const SCROLL_CAPTURE_LIMIT_MS = 10 * 60 * 1000;
const SCROLL_ERROR_DISPLAY_MS = 2_400;
const SCROLL_SHORTCUTS = ["Escape", "Return"];

let scrollSession: ScrollSession | null = null;

/** The command-line flags that start a capture: --capture-region, --capture-scroll. */
function launchCaptureOptions(argv: readonly string[]): CaptureOptions | null {
	if (argv.includes("--capture-scroll")) return { scroll: true };
	if (argv.includes("--capture-region")) return {};
	return null;
}

/** The agent streams with ScreenCaptureKit APIs from macOS 14. */
function isScrollCaptureAvailable() {
	if (!scrollAgent) return false;
	if (DEV_SCROLL_FIXTURE) return true;
	return Number.parseInt(process.getSystemVersion().split(".")[0] ?? "", 10) >= 14;
}

async function startScrollCapture(sessionId: number, rect: unknown): Promise<boolean> {
	const held = regionFrozenFrame;
	const display = activeCaptureDisplay;
	if (!scrollAgent || !isScrollCaptureAvailable() || scrollSession || !held || held.sessionId !== sessionId || !display) {
		return false;
	}
	const region = scrollRegionFromSelection(rect, held.frame, display.bounds);
	if (!region) return false;
	const previewPath = temporaryCapturePath("quickshot-scroll-preview", "jpg");
	const response = await scrollAgent.request(
		{
			cmd: "scroll-start",
			display: display.id,
			rect: region.points,
			size: region.pixels,
			exclude: process.pid,
			maxHeight: scrollMaxHeight(region.pixels.width),
			preview: previewPath,
			...(DEV_SCROLL_FIXTURE ? { fixture: DEV_SCROLL_FIXTURE } : {}),
		},
		SCROLL_START_TIMEOUT_MS,
	);
	if (sessionId !== activeCaptureSessionId || capturePhase !== "selecting-region" || scrollSession) {
		if (response?.ok) void scrollAgent.request({ cmd: "scroll-cancel" }, 2_000);
		return false;
	}
	if (!response?.ok) {
		writeDiagnostic("scroll-capture-start-failed", { error: response?.error ?? "no response" });
		return false;
	}

	// The overlay's session ends here, so its late cancel cannot stop this one.
	activeCaptureSessionId = ++nextCaptureSessionId;
	capturePhase = "scrolling";
	releaseFrozenFrame();
	hideRegionSelector();
	const session: ScrollSession = {
		area: region.global,
		frameHeight: region.pixels.height,
		ring: null,
		panel: null,
		previewPath,
		progress: { status: "waiting", height: region.pixels.height, width: region.pixels.width, preview: 0 },
		preview: null,
		finishing: false,
		startedAt: Date.now(),
		timer: null,
	};
	scrollSession = session;
	yieldForegroundForScroll();
	session.ring = createScrollRing(region.global, display);
	session.panel = createScrollPanel(region.global, display);
	session.timer = setTimeout(() => void finishScrollCapture("time-limit"), SCROLL_CAPTURE_LIMIT_MS);
	// Like the capture shortcut, a development build left without shortcuts
	// keeps its hands off the keyboard; the panel's buttons still work.
	for (const key of ENABLE_CAPTURE_SHORTCUT ? SCROLL_SHORTCUTS : []) {
		try {
			globalShortcut.register(key, () =>
				key === "Escape" ? cancelScrollCapture("escape") : void finishScrollCapture("return"),
			);
		} catch {}
	}
	writeDiagnostic("scroll-capture-started", { ...region.pixels, ms: Date.now() - captureStartedAt });
	return true;
}

/**
 * Hands the foreground back to the app being scrolled, so it looks active
 * and takes the keyboard. Hiding QuickShot hides every window, so the pins
 * and the editor that were showing come straight back without taking focus.
 */
function yieldForegroundForScroll() {
	if (process.platform !== "darwin") return;
	const showing = [...[...pinnedScreenshots.values()].map((record) => record.window), screenshotPreviewWindow]
		.filter((win): win is BrowserWindow => Boolean(win && !win.isDestroyed() && win.isVisible()));
	app.hide();
	for (const win of showing) win.showInactive();
}

/** A slowly turning spectrum around the area; it ignores the mouse and is never captured. */
function createScrollRing(area: ScrollRect, display: Display) {
	const layout = scrollRingLayout(area, display.bounds);
	const { ring } = layout;
	const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@property --turn{syntax:'<angle>';inherits:false;initial-value:0deg}
html,body{margin:0;height:100%;background:transparent;overflow:hidden}
.shade{position:absolute;left:${ring.x}px;top:${ring.y}px;width:${ring.width}px;height:${ring.height}px;
filter:drop-shadow(0 0 1.5px rgba(0,0,0,.35))}
.ring{width:100%;height:100%;box-sizing:border-box;padding:3px;border-radius:9px;
background:conic-gradient(from var(--turn),#FF5A7A,#FF9F43,#FFD43B,#38D9A9,#4DABF7,#9775FA,#FF5A7A);
-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
-webkit-mask-composite:xor;mask-composite:exclude;animation:turn 6s linear infinite}
@keyframes turn{to{--turn:360deg}}
@media (prefers-reduced-motion:reduce){.ring{animation:none}}
</style></head><body><div class="shade"><div class="ring"></div></div></body></html>`;
	const win = new BrowserWindow({
		...layout.window,
		frame: false,
		transparent: true,
		backgroundColor: "#00000000",
		resizable: false,
		movable: false,
		minimizable: false,
		maximizable: false,
		fullscreenable: false,
		focusable: false,
		skipTaskbar: true,
		hasShadow: false,
		enableLargerThanScreen: true,
		roundedCorners: false,
		show: false,
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
			javascript: false,
		},
	});
	installWindowGuards(win);
	win.setIgnoreMouseEvents(true);
	win.setAlwaysOnTop(true, "floating");
	win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
	void win
		.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
		.then(() => {
			if (!win.isDestroyed() && scrollSession?.ring === win) win.showInactive();
		})
		.catch(() => {});
	return win;
}

/** Progress, preview, Done and Cancel. A panel: clicking it never activates QuickShot. */
function createScrollPanel(area: ScrollRect, display: Display) {
	const panel = new BrowserWindow({
		...placeScrollPanel(area, display.workArea),
		...SCROLL_PANEL_SIZE,
		type: "panel",
		// The panel never becomes key, so every click is a first click.
		acceptFirstMouse: true,
		frame: false,
		transparent: true,
		backgroundColor: "#00000000",
		resizable: false,
		minimizable: false,
		maximizable: false,
		fullscreenable: false,
		focusable: false,
		skipTaskbar: true,
		hasShadow: false,
		show: false,
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
			webSecurity: true,
			allowRunningInsecureContent: false,
			webviewTag: false,
			backgroundThrottling: false,
			additionalArguments: [`--quickshot-lang=${getMainLanguage()}`],
		},
	});
	installWindowGuards(panel);
	panel.setAlwaysOnTop(true, "floating", 1);
	panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
	loadWindow(panel, "scroll-capture");
	panel.once("ready-to-show", () => {
		if (!panel.isDestroyed() && scrollSession?.panel === panel) panel.showInactive();
	});
	panel.webContents.on("render-process-gone", () => {
		if (scrollSession?.panel === panel) cancelScrollCapture("panel-gone");
	});
	return panel;
}

function sendScrollProgress(session: ScrollSession, withPreview: boolean) {
	const panel = session.panel;
	if (!panel || panel.isDestroyed()) return;
	panel.webContents.send("scroll-capture-progress", {
		...session.progress,
		frameHeight: session.frameHeight,
		...(withPreview && session.preview ? { previewBytes: toIpcPngBytes(session.preview) } : {}),
	});
}

function handleScrollAgentEvent(event: AgentEvent) {
	const session = scrollSession;
	if (!session) return;
	if (event.event === "stopped") {
		if (!session.finishing) failScrollCapture(session, "agent-stopped");
		return;
	}
	const progress = parseScrollProgress(event);
	if (!progress || session.finishing) return;
	if (progress.status === "error") {
		failScrollCapture(session, "stream-error");
		return;
	}
	const previewChanged = progress.preview !== session.progress.preview;
	session.progress = progress;
	if (!previewChanged) {
		sendScrollProgress(session, false);
		return;
	}
	void import("node:fs/promises")
		.then((fs) => fs.readFile(session.previewPath))
		.then((bytes) => {
			// A newer preview is on its way; it carries this progress too.
			if (scrollSession !== session || session.progress.preview !== progress.preview) return;
			session.preview = acceptCapturedJpeg(bytes);
			sendScrollProgress(session, true);
		})
		.catch(() => sendScrollProgress(session, false));
}

/** Says so in the panel for a moment, then ends the capture. */
function failScrollCapture(session: ScrollSession, reason: string) {
	if (scrollSession !== session || session.progress.status === "error") return;
	writeDiagnostic("scroll-capture-failed", { reason });
	session.finishing = true;
	session.progress = { ...session.progress, status: "error" };
	sendScrollProgress(session, false);
	setTimeout(() => {
		if (scrollSession === session) cancelActiveCapture(false, false);
	}, SCROLL_ERROR_DISPLAY_MS);
}

async function finishScrollCapture(reason: string) {
	const session = scrollSession;
	if (!session || session.finishing || !scrollAgent) return;
	session.finishing = true;
	session.progress = { ...session.progress, status: "finishing" };
	sendScrollProgress(session, false);
	const fs = await import("node:fs/promises");
	const filePath = temporaryCapturePath("quickshot-scroll", "png");
	let image: Buffer | null = null;
	let stats: unknown;
	try {
		const response = await scrollAgent.request({ cmd: "scroll-finish", path: filePath }, SCROLL_FINISH_TIMEOUT_MS);
		stats = response?.stats;
		if (response?.ok) {
			image = acceptCapturedPng(await fs.readFile(filePath));
		} else {
			writeDiagnostic("scroll-capture-finish-failed", { error: response?.error ?? "no response" });
		}
	} catch (error) {
		writeDiagnostic("scroll-capture-finish-failed", { error: serializeError(error) });
	} finally {
		await fs.unlink(filePath).catch(() => {});
	}
	if (scrollSession !== session) return;
	if (!image) {
		session.finishing = false;
		failScrollCapture(session, "finish-failed");
		return;
	}
	endScrollSession(session);
	writeDiagnostic("scroll-capture-finished", {
		reason,
		...readPngDimensions(image),
		ms: Date.now() - session.startedAt,
		// How the stitching went, in numbers only: frames, losses and why.
		stats,
	});
	if (deliverStitchPiece(image)) return;
	if (!openPreviewForImage(image)) cancelActiveCapture();
}

function cancelScrollCapture(reason: string) {
	stopScrollSession(reason);
	cancelActiveCapture(false, false);
}

/** Ends a scrolling capture without keeping anything. */
function stopScrollSession(reason: string) {
	const session = scrollSession;
	if (!session) return;
	const ms = Date.now() - session.startedAt;
	void scrollAgent
		?.request({ cmd: "scroll-cancel" }, 2_000)
		.then((response) => writeDiagnostic("scroll-capture-cancelled", { reason, ms, stats: response?.stats }));
	endScrollSession(session);
}

function endScrollSession(session: ScrollSession) {
	if (scrollSession !== session) return;
	scrollSession = null;
	if (session.timer) clearTimeout(session.timer);
	for (const key of SCROLL_SHORTCUTS) {
		try {
			globalShortcut.unregister(key);
		} catch {}
	}
	for (const win of [session.panel, session.ring]) {
		if (win && !win.isDestroyed()) win.destroy();
	}
	void import("node:fs/promises").then((fs) =>
		Promise.all(
			[session.previewPath, `${session.previewPath}.part.jpg`].map((file) => fs.unlink(file).catch(() => {})),
		),
	);
}

function hideRegionSelector() {
	if (regionSelectorWindow?.isVisible()) {
		regionSelectorWindow.hide();
	}
	try {
		globalShortcut.unregister("Escape");
	} catch {}
}

/**
 * After the overlay closes without opening the editor, hand the foreground
 * back to the app the user was in, so a quick copy can be pasted right away.
 * Hiding QuickShot also hides pinned screenshots, so it stays put while any
 * pin or editor window is open.
 */
function yieldForegroundAfterOverlay() {
	if (process.platform !== "darwin") return;
	const editorOpen = Boolean(screenshotPreviewWindow && !screenshotPreviewWindow.isDestroyed());
	if (editorOpen || pinnedScreenshots.size > 0) return;
	app.hide();
}

function cancelActiveCapture(closePreview = false, restoreForeground = true, keepStitch = false) {
	const previousPhase = capturePhase;
	stopScrollSession("capture-cancelled");
	clearCaptureRestartTimer();
	clearRegionReadyWatchdog();
	clearOverlayCaptureWatchdog();
	overlayCaptureStep = "idle";
	releaseFrozenFrame();
	overlayAwaitingEditor = false;
	activeCaptureAttempt += 1;
	void terminateActiveCaptureProcess("capture-cancelled");
	hideRegionSelector();
	activeCaptureSessionId = null;
	pendingPreviewSessionId = null;
	activeCaptureDisplay = null;
	screenshotCroppedBuffer = null;
	pendingRegionCaptureSession = null;
	captureWindows = null;
	capturePhase = "idle";
	clearPreviewReadyTimer();
	if (closePreview && screenshotPreviewWindow && !screenshotPreviewWindow.isDestroyed()) {
		screenshotPreviewWindow.close();
	}
	writeDiagnostic("capture-cancelled", { previousPhase, closePreview });
	if (stitchTarget && !keepStitch) {
		restoreStitchTarget();
		return;
	}
	if (restoreForeground && previousPhase === "selecting-region") {
		yieldForegroundAfterOverlay();
	}
}

/** The global capture shortcut, as set in settings. */
function captureShortcut() {
	return appSettings.shortcuts.capture;
}

function shortcutLabel(accelerator: string) {
	return acceleratorLabel(accelerator, process.platform as ShortcutPlatform);
}

/** Whether two accelerators press the same keys here, e.g. CmdOrCtrl and Command on a Mac. */
function sameShortcut(first: string, second: string) {
	return shortcutLabel(first) === shortcutLabel(second);
}

/** What is registered right now, so a changed setting can replace it. */
let registeredCaptureShortcut: string | null = null;
let registeredScrollShortcut: string | null = null;
let registeredRestoreShortcut: string | null = null;
/** While the settings window records a shortcut, QuickShot's own stay out of its way. */
let shortcutsSuspended = false;

function registerCaptureShortcut(
	force = false,
	reason = "unspecified",
): boolean {
	if (!ENABLE_CAPTURE_SHORTCUT || shortcutsSuspended) return false;
	registerScrollShortcut(force);
	const accelerator = captureShortcut();
	if (registeredCaptureShortcut && registeredCaptureShortcut !== accelerator) {
		globalShortcut.unregister(registeredCaptureShortcut);
		registeredCaptureShortcut = null;
	}
	const wasRegistered = globalShortcut.isRegistered(accelerator);
	if (force && globalShortcut.isRegistered(accelerator)) {
		globalShortcut.unregister(accelerator);
	}
	if (globalShortcut.isRegistered(accelerator)) {
		shortcutRetryAttempt = 0;
		return true;
	}

	const registered = globalShortcut.register(accelerator, () => {
		lastShortcutTriggerAt = Date.now();
		writeDiagnostic("shortcut-triggered", {
			phase: capturePhase,
		});
		requestCaptureFromUser("shortcut");
	});
	if (registered) {
		registeredCaptureShortcut = accelerator;
		shortcutRetryAttempt = 0;
		writeDiagnostic("shortcut-registered", {
			reason,
			force,
			wasRegistered,
			custom: accelerator !== DEFAULT_CAPTURE_ACCELERATOR,
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
			? `QuickShot · ${shortcutLabel(accelerator)}`
			: mt("tray.tooltipShortcutFailed"),
	);
	return registered;
}

/** The optional shortcut that starts a scrolling capture straight away. */
function registerScrollShortcut(force = false): boolean {
	const accelerator = isScrollCaptureAvailable() ? appSettings.shortcuts.scrollCapture : null;
	if (registeredScrollShortcut && registeredScrollShortcut !== accelerator) {
		globalShortcut.unregister(registeredScrollShortcut);
		registeredScrollShortcut = null;
	}
	if (!accelerator) return false;
	if (force && globalShortcut.isRegistered(accelerator)) globalShortcut.unregister(accelerator);
	if (globalShortcut.isRegistered(accelerator)) return true;
	const registered = globalShortcut.register(accelerator, () => {
		writeDiagnostic("scroll-shortcut-triggered", { phase: capturePhase });
		requestCaptureFromUser("shortcut-scroll", { scroll: true });
	});
	if (registered) registeredScrollShortcut = accelerator;
	else writeDiagnostic("scroll-shortcut-registration-failed");
	return registered;
}

function setShortcutsSuspended(suspended: boolean) {
	if (shortcutsSuspended === suspended) return;
	shortcutsSuspended = suspended;
	if (suspended) {
		for (const accelerator of [registeredCaptureShortcut, registeredScrollShortcut, registeredRestoreShortcut]) {
			if (accelerator) globalShortcut.unregister(accelerator);
		}
		registeredCaptureShortcut = null;
		registeredScrollShortcut = null;
		registeredRestoreShortcut = null;
	} else {
		registerCaptureShortcut(true, "settings-recorded");
		ensurePinnedScreenshotRecoveryShortcut();
	}
}

/** Whether another app or the system already holds `accelerator`. */
function shortcutIsTaken(accelerator: string) {
	if (!ENABLE_CAPTURE_SHORTCUT || globalShortcut.isRegistered(accelerator)) return false;
	const registered = globalShortcut.register(accelerator, () => {});
	if (registered) globalShortcut.unregister(accelerator);
	return !registered;
}

/**
 * Changes a global shortcut from the settings window. `value` null resets
 * the capture shortcut and clears the scrolling one.
 */
type GlobalShortcutKind = "capture" | "scrollCapture" | "restorePins";

async function setShortcut(
	kind: GlobalShortcutKind,
	value: unknown,
): Promise<{ success: true } | { success: false; error: string }> {
	let accelerator: string | null = null;
	if (value === null) {
		accelerator =
			kind === "capture" ? DEFAULT_CAPTURE_ACCELERATOR : kind === "restorePins" ? DEFAULT_RESTORE_PINS_ACCELERATOR : null;
	} else {
		accelerator = normalizeAccelerator(value);
		if (!accelerator) return { success: false, error: mt("shortcut.invalid") };
	}
	if (accelerator) {
		const others = (["capture", "scrollCapture", "restorePins"] as const)
			.filter((other) => other !== kind)
			.map((other) => appSettings.shortcuts[other]);
		if (others.some((other) => other && sameShortcut(accelerator as string, other))) {
			return { success: false, error: mt("shortcut.duplicate") };
		}
		const current = { capture: registeredCaptureShortcut, scrollCapture: registeredScrollShortcut, restorePins: registeredRestoreShortcut }[kind];
		if (!(current && sameShortcut(current, accelerator)) && shortcutIsTaken(accelerator)) {
			return { success: false, error: mt("shortcut.taken") };
		}
	}
	appSettings = { ...appSettings, shortcuts: { ...appSettings.shortcuts, [kind]: accelerator } };
	writeDiagnostic("shortcut-changed", { kind, set: Boolean(accelerator) });
	if (!shortcutsSuspended) {
		registerCaptureShortcut(true, "settings");
		if (kind === "restorePins") ensurePinnedScreenshotRecoveryShortcut();
	}
	refreshTrayMenu();
	await persistAppSettings();
	return { success: true };
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

function requestCaptureFromUser(source = "unknown", options: CaptureOptions = {}) {
	if (ENABLE_CAPTURE_SHORTCUT && source.startsWith("tray")) {
		registerCaptureShortcut(true, `${source}-repair`);
	} else if (
		ENABLE_CAPTURE_SHORTCUT &&
		!globalShortcut.isRegistered(captureShortcut())
	) {
		registerCaptureShortcut(false, `${source}-missing`);
	}
	writeDiagnostic("capture-requested", {
		source,
		phase: capturePhase,
		shortcutRegistered: globalShortcut.isRegistered(captureShortcut()),
		scroll: Boolean(options.scroll),
	});
	void triggerScreenshot(source, options);
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

		// The overlay takes keyboard focus so Enter, arrows and shortcuts work.
		// QuickShot is an accessory app, so it has to be activated explicitly.
		clearRegionReadyWatchdog();
		clearOverlayCaptureWatchdog();
		overlayCaptureStep = "idle";
		regionSelectorWindow.show();
		if (process.platform === "darwin") app.focus({ steal: true });
		regionSelectorWindow.focus();
		if (!globalShortcut.isRegistered("Escape")) {
			globalShortcut.register("Escape", cancelActiveCapture);
		}
		capturePhase = "selecting-region";
		pendingRegionCaptureSession = null;
		writeDiagnostic("region-selector-shown", { sessionId, ms: Date.now() - captureStartedAt });
		return { success: true };
	});

	ipcMain.handle("settings-state", (event) => {
		if (!isTrustedWindowSender(event, settingsWindow)) return null;
		return settingsState();
	});

	ipcMain.handle("settings-set-shortcut", async (event, kind: unknown, value: unknown) => {
		if (
			!isTrustedWindowSender(event, settingsWindow) ||
			(kind !== "capture" && kind !== "scrollCapture" && kind !== "restorePins")
		) {
			return { success: false };
		}
		const result = await setShortcut(kind, value);
		return { ...result, state: settingsState() };
	});

	ipcMain.handle("settings-recording", (event, recording: unknown) => {
		if (!isTrustedWindowSender(event, settingsWindow) || typeof recording !== "boolean") return { success: false };
		setShortcutsSuspended(recording);
		return { success: true };
	});

	ipcMain.handle("settings-set-language", async (event, language: unknown) => {
		const win = settingsWindow;
		if (!win || !isTrustedWindowSender(event, win) || (language !== "auto" && language !== "zh" && language !== "en")) {
			return { success: false };
		}
		const before = getMainLanguage();
		await setLanguagePreference(language);
		// The window was built in the previous language; open it afresh.
		if (getMainLanguage() !== before) {
			setTimeout(() => {
				if (!win.isDestroyed()) win.close();
				openSettings("language-changed");
			}, 50);
		}
		return { success: true, state: settingsState() };
	});

	ipcMain.handle("settings-set-capture-mode", async (event, mode: unknown) => {
		if (!isTrustedWindowSender(event, settingsWindow) || (mode !== "overlay" && mode !== "system")) {
			return { success: false };
		}
		await setMacCaptureMode(mode);
		return { success: true, state: settingsState() };
	});

	ipcMain.handle("settings-check-update", async (event) => {
		if (!isTrustedWindowSender(event, settingsWindow) || !updater) return { success: false };
		await updater.check(true);
		return { success: true, state: settingsState() };
	});

	ipcMain.handle("settings-install-update", (event) => {
		if (!isTrustedWindowSender(event, settingsWindow) || !updater) return { success: false };
		void updater.install();
		return { success: true };
	});

	ipcMain.handle("settings-set-launch-at-login", (event, enabled: unknown) => {
		if (!isTrustedWindowSender(event, settingsWindow) || typeof enabled !== "boolean") return { success: false };
		app.setLoginItemSettings({ openAtLogin: enabled });
		refreshTrayMenu();
		return { success: true, state: settingsState() };
	});

	ipcMain.handle("onboarding-state", (event) => {
		if (!isTrustedWindowSender(event, onboardingWindow)) return null;
		return {
			platform: process.platform,
			permission: getScreenPermissionStatus(),
			shortcut: shortcutLabel(captureShortcut()),
			launchAtLogin: app.getLoginItemSettings().openAtLogin,
		};
	});

	ipcMain.handle("onboarding-request-permission", async (event) => {
		const guide = onboardingWindow;
		if (!guide || !isTrustedWindowSender(event, guide)) return { success: false };
		// Open the Screen Recording pane and put a draggable QuickShot right
		// under it; dropping it on the list is all it takes. The guide hides
		// meanwhile so nothing of QuickShot's covers Settings during the drag.
		if (!DEV_SETTINGS_BUNDLE) void shell.openExternal(SCREEN_RECORDING_SETTINGS_URL);
		showPermissionHelper();
		onboardingHiddenForHelper = true;
		guide.hide();
		const fs = await import("node:fs/promises");
		await fs.writeFile(permissionMarkerPath(), new Date().toISOString()).catch(() => {});
		return { success: true, permission: getScreenPermissionStatus() };
	});

	ipcMain.on("permission-helper-drag", (event) => {
		const helper = permissionHelperWindow;
		if (!helper || helper.isDestroyed() || event.sender !== helper.webContents) return;
		const icon = nativeImage
			.createFromPath(path.join(process.env.VITE_PUBLIC || RENDERER_DIST, "icon.png"))
			.resize({ width: 64, height: 64, quality: "best" });
		writeDiagnostic("permission-helper-drag", { bundle: appBundlePath() });
		event.sender.startDrag({ file: appBundlePath(), icon });
	});

	ipcMain.handle("onboarding-relaunch", (event) => {
		if (!isTrustedWindowSender(event, onboardingWindow)) return { success: false };
		writeDiagnostic("onboarding-relaunch");
		// Screen Recording only takes effect in a new process.
		setTimeout(() => relaunchIntoOnboarding("done"), 50);
		return { success: true };
	});

	ipcMain.handle("onboarding-set-launch-at-login", (event, enabled: unknown) => {
		if (!isTrustedWindowSender(event, onboardingWindow) || typeof enabled !== "boolean") {
			return { success: false };
		}
		app.setLoginItemSettings({ openAtLogin: enabled });
		refreshTrayMenu();
		return { success: true, launchAtLogin: app.getLoginItemSettings().openAtLogin };
	});

	ipcMain.handle("onboarding-finish", async (event, options: unknown) => {
		const win = onboardingWindow;
		if (!win || !isTrustedWindowSender(event, win)) return { success: false };
		const capture = Boolean(options && typeof options === "object" && (options as { capture?: unknown }).capture);
		await markOnboardingSeen();
		win.close();
		if (capture) setTimeout(() => requestCaptureFromUser("onboarding"), 350);
		return { success: true };
	});

	ipcMain.handle("capture-for-stitch", async (event) => {
		const editor = screenshotPreviewWindow;
		if (!editor || editor.isDestroyed() || !isTrustedWindowSender(event, editor)) {
			return { success: false, error: "no editor" };
		}
		if (capturePhase !== "idle" || stitchTarget) return { success: false, error: "busy" };
		stitchTarget = editor;
		writeDiagnostic("stitch-capture-requested");
		// The editor must not end up in its own capture.
		await hideWindowForCapture(editor);
		if (stitchTarget !== editor) return { success: false, error: "cancelled" };
		void triggerScreenshot("stitch");
		return { success: true };
	});

	ipcMain.handle("get-capture-windows", (event, sessionId: number) => {
		if (
			!isTrustedWindowSender(event, regionSelectorWindow) ||
			!Number.isInteger(sessionId) ||
			captureWindows?.sessionId !== sessionId
		) {
			return { success: false as const };
		}
		return { success: true as const, windows: captureWindows.windows };
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
		async (
			event,
			payload: {
				sessionId: number;
				croppedImageBytes?: Uint8Array;
				action?: "edit" | "copy" | "save" | "pin" | "scroll";
				windowId?: number;
				/** With `windowId`: the window in frozen-frame pixels, cropped if the window capture fails. */
				rect?: { x: number; y: number; width: number; height: number };
			},
		) => {
			if (
				!isTrustedWindowSender(event, regionSelectorWindow) ||
				!payload ||
				!Number.isInteger(payload.sessionId) ||
				payload.sessionId !== activeCaptureSessionId
			) {
				return { success: false, error: "stale capture session" };
			}

			let croppedImageBuffer: Buffer | null = null;
			if (payload.croppedImageBytes !== undefined) {
				try {
					croppedImageBuffer = validateCapturePngPayload(payload.croppedImageBytes);
				} catch {
					return { success: false, error: "invalid image data" };
				}
			}

			const action = payload.action ?? "edit";
			if (!["edit", "copy", "save", "pin", "scroll"].includes(action)) {
				return { success: false, error: "unknown action" };
			}
			if (action === "scroll") {
				return (await startScrollCapture(payload.sessionId, payload.rect))
					? { success: true }
					: { success: false, error: "scroll capture unavailable" };
			}

			// A click on a window captures that window itself instead of the
			// frozen pixels under it. Only ids this session listed are accepted.
			const windowId = payload.windowId;
			if (
				process.platform === "darwin" &&
				!DEV_CAPTURE_FILE &&
				typeof windowId === "number" &&
				captureWindows?.sessionId === payload.sessionId &&
				captureWindows.windows.some((window) => window.id === windowId)
			) {
				const windowImage = await captureMacWindowImage(windowId);
				if (payload.sessionId !== activeCaptureSessionId) {
					return { success: false, error: "stale capture session" };
				}
				if (windowImage) croppedImageBuffer = windowImage;
			}
			croppedImageBuffer ??= await cropFrozenFrame(payload.sessionId, payload.rect);
			if (payload.sessionId !== activeCaptureSessionId) {
				return { success: false, error: "stale capture session" };
			}
			if (!croppedImageBuffer) {
				return { success: false, error: "invalid image data" };
			}
			if (action === "edit") {
				if (deliverStitchPiece(croppedImageBuffer)) return { success: true };
				if (!openPreviewForImage(croppedImageBuffer)) {
					return { success: false, error: "preview unavailable" };
				}
				overlayAwaitingEditor = true;
				return { success: true };
			}

			// Quick actions finish straight from the overlay, skipping the editor.
			// The overlay stays up if the action fails, so nothing is lost.
			if (action === "pin" && !canCreatePinnedScreenshot(pinnedScreenshots.size)) {
				return { success: false, error: "pin-limit" };
			}
			writeDiagnostic("region-quick-action", { action });
			try {
				if (action === "copy") {
					clipboard.writeImage(nativeImage.createFromBuffer(croppedImageBuffer));
				} else if (action === "save") {
					await writeQuickSaveScreenshot(croppedImageBuffer);
				} else if (action === "pin" && !createPinnedScreenshotWindow(croppedImageBuffer)) {
					return { success: false, error: "pin-limit" };
				}
				if (payload.sessionId === activeCaptureSessionId) cancelActiveCapture(false);
				return { success: true };
			} catch (error) {
				writeDiagnostic("region-quick-action-failed", {
					action,
					error: serializeError(error),
				});
				return { success: false, error: "quick action failed" };
			}
		},
	);

	ipcMain.handle("get-scroll-capture-state", (event) => {
		const session = scrollSession;
		if (!session || !isTrustedWindowSender(event, session.panel)) return { success: false };
		return {
			success: true,
			progress: { ...session.progress, frameHeight: session.frameHeight },
			...(session.preview ? { previewBytes: toIpcPngBytes(session.preview) } : {}),
		};
	});

	ipcMain.handle("finish-scroll-capture", (event) => {
		const session = scrollSession;
		if (!session || !isTrustedWindowSender(event, session.panel)) return { success: false };
		void finishScrollCapture("panel");
		return { success: true };
	});

	ipcMain.handle("cancel-scroll-capture", (event) => {
		const session = scrollSession;
		if (!session || !isTrustedWindowSender(event, session.panel)) return { success: false };
		cancelScrollCapture("panel");
		return { success: true };
	});

	// A warm editor may subscribe after the session event was sent; it asks here.
	ipcMain.handle("get-pending-preview-session", (event) => {
		if (
			!isTrustedWindowSender(event, screenshotPreviewWindow) ||
			capturePhase !== "opening-preview" ||
			pendingPreviewSessionId === null
		) {
			return { success: false as const };
		}
		return { success: true as const, sessionId: pendingPreviewSessionId };
	});

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
			scaleFactor: screenshotCroppedScaleFactor,
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
		releaseOverlayForEditor();
		clearPreviewReadyTimer();
		pendingPreviewSessionId = null;
		activeCaptureSessionId = null;
		activeCaptureDisplay = null;
		screenshotCroppedBuffer = null;
		capturePhase = "idle";
		writeDiagnostic("preview-ready", { sessionId });
		scheduleSparePreviewWindow();
		return { success: true };
	});

	ipcMain.handle("save-screenshot-final", async (event, pngData: ArrayBuffer) => {
		try {
			if (!isTrustedWindowSender(event, screenshotPreviewWindow)) {
				return { success: false, error: "untrusted sender" };
			}
			const pngBuffer = normalizePngPayload(pngData, MAX_EXPORT_PNG_BYTES);
			const parent = screenshotPreviewWindow;
			const options: Electron.SaveDialogOptions = {
				title: mt("dialog.saveTitle"),
				defaultPath: buildDefaultScreenshotPath(),
				filters: [{ name: mt("dialog.pngFilter"), extensions: ["png"] }],
				properties: ["createDirectory", "showOverwriteConfirmation"],
			};
			const result =
				parent && !parent.isDestroyed()
					? await dialog.showSaveDialog(parent, options)
					: await dialog.showSaveDialog(options);
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
					error: mt("pin.untrusted"),
				};
			}
			if (!canCreatePinnedScreenshot(pinnedScreenshots.size)) {
				return {
					success: false as const,
					code: "limit-reached" as const,
					error: mt("pin.limit", { max: MAX_PINNED_SCREENSHOTS }),
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
						error: mt("pin.limit", { max: MAX_PINNED_SCREENSHOTS }),
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
					error: mt("pin.failed"),
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
			recoveryShortcut: shortcutLabel(appSettings.shortcuts.restorePins),
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
				recoveryShortcutRegistered: globalShortcut.isRegistered(appSettings.shortcuts.restorePins),
				recoveryShortcut: shortcutLabel(appSettings.shortcuts.restorePins),
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
				return ocrFailure("invalid-image", mt("ocr.unreadable"));
			}
			if (!isOcrSupported()) {
				return ocrFailure("unsupported-platform", mt("ocr.unsupported"));
			}
			if (activeOcrTask) {
				return ocrFailure("busy", mt("ocr.busy"));
			}

			let pngBuffer: Buffer;
			try {
				pngBuffer = validateCapturePngPayload(pngData);
			} catch {
				return ocrFailure("invalid-image", mt("ocr.invalidImage"));
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
				return { success: false, error: mt("text.invalid") };
			}
			clipboard.writeText(text);
			return { success: true };
		} catch {
			return { success: false, error: mt("text.copyFailed") };
		}
	});

	ipcMain.handle("minimize-window", (event) => {
		if (!isTrustedSender(event)) return;
		BrowserWindow.fromWebContents(event.sender)?.minimize();
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
	if (process.platform === "win32") {
		app.setAppUserModelId("com.quickshot.app");
	}
	appSettings = await readAppSettings(app.getPath("userData"));
	applyLanguagePreference();

	// macOS routes Cmd+C/V/X/A/Z in text fields through the Edit menu.
	Menu.setApplicationMenu(
		Menu.buildFromTemplate(
			process.platform === "darwin" ? [{ role: "editMenu" }] : [],
		),
	);

	session.defaultSession.setPermissionCheckHandler(() => false);
	session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

	registerIpcHandlers();
	createTray();
	nativeTheme.on("updated", syncPreviewChromeWithTheme);
	// First launch (or a relaunch for Screen Recording) opens the guide;
	// otherwise, when opened by hand rather than at login, point at the icon.
	const relaunchStep = process.argv
		.find((argument) => argument.startsWith(ONBOARDING_RELAUNCH_ARGUMENT))
		?.slice(ONBOARDING_RELAUNCH_ARGUMENT.length) as OnboardingStep | undefined;
	const openedAtLogin =
		process.platform === "darwin" &&
		(app.getLoginItemSettings().wasOpenedAtLogin || os.uptime() < 120);
	if (relaunchStep && ONBOARDING_STEPS.includes(relaunchStep)) {
		rmSync(permissionMarkerPath(), { force: true });
		openOnboarding(relaunchStep, "relaunch");
	} else if (process.platform === "darwin" && celebratePermissionIfPending()) {
		// Opened at the guide's last step.
	} else if (appSettings.onboardingVersion < ONBOARDING_VERSION && !launchCaptureOptions(process.argv)) {
		openOnboarding("welcome", "first-launch");
	} else if (!openedAtLogin && !launchCaptureOptions(process.argv)) {
		setTimeout(() => showTrayHint("launch"), 1_200);
	}

	if (usesOverlaySelection()) {
		await ensureRegionSelector();
	}
	scheduleSparePreviewWindow(2_500);
	warmCaptureAgent("app-ready");
	createUpdater();
	setTimeout(() => void reportLaunchUsage(), 15_000);

	if (ENABLE_CAPTURE_SHORTCUT) {
		registerCaptureShortcut(false, "app-ready");
	} else {
		writeDiagnostic("capture-shortcut-disabled");
	}

	const recoverAfterWake = (reason: string) => {
		writeDiagnostic("power-recovery", { reason, phase: capturePhase });
		scheduleShortcutRecovery(reason, 250, true);
		warmCaptureAgent(reason);
		if (pinnedScreenshots.size > 0) {
			ensurePinnedScreenshotRecoveryShortcut();
		}
	};
	const cancelForInactivity = (reason: string) => {
		writeDiagnostic("power-inactive", { reason, phase: capturePhase });
		restorePinnedScreenshotInteraction(reason);
		if (capturePhase !== "idle" || activeCaptureProcess) {
			cancelActiveCapture(true, false);
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
			const registered = shortcutsSuspended || globalShortcut.isRegistered(captureShortcut());
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
	const launchCapture = launchCaptureOptions(process.argv);
	if (launchCapture) requestCaptureFromUser("launch-command", launchCapture);
	else if (process.argv.includes("--settings")) openSettings("launch-command");
});

function readBundleStamp(bundle: string): BundleStamp | null {
	try {
		const stats = statSync(path.join(bundle, "Contents", "Resources", "app.asar"));
		return { ino: stats.ino, mtimeMs: stats.mtimeMs };
	} catch {
		return null;
	}
}

/** The bundle this process was launched from, and how its build looked then. */
const OWN_BUNDLE =
	app.isPackaged && process.platform === "darwin" ? bundleFromExecutable(process.execPath) : null;
const OWN_LAUNCH_STAMP = OWN_BUNDLE ? readBundleStamp(OWN_BUNDLE) : null;

/** Quits so a newer QuickShot that was just opened can take over. */
function handOverTo(bundle: string) {
	writeDiagnostic("hand-over", { from: OWN_BUNDLE, to: bundle });
	// The new copy waits for this one to release the single-instance lock.
	spawn("/bin/sh", ["-c", 'sleep 1.2; /usr/bin/open -n "$0"', bundle], {
		detached: true,
		stdio: "ignore",
	}).unref();
	app.quit();
}

app.on("second-instance", (_event, commandLine) => {
	writeDiagnostic("second-instance", { commandLine });
	const otherBundle = bundleFromExecutable(commandLine[0]);
	if (
		OWN_BUNDLE &&
		OWN_LAUNCH_STAMP &&
		otherBundle &&
		shouldHandOver(
			{ bundle: OWN_BUNDLE, launchStamp: OWN_LAUNCH_STAMP },
			{ bundle: otherBundle, stamp: readBundleStamp(otherBundle) },
		)
	) {
		handOverTo(otherBundle);
		return;
	}
	scheduleShortcutRecovery("second-instance", 0, true);
	const launchCapture = launchCaptureOptions(commandLine);
	if (launchCapture) {
		requestCaptureFromUser("launch-command", launchCapture);
		return;
	}
	if (commandLine.includes("--settings")) {
		openSettings("launch-command");
		return;
	}
	if (screenshotPreviewWindow && !screenshotPreviewWindow.isDestroyed()) {
		presentPreviewWindow(screenshotPreviewWindow);
		return;
	}
	showTrayHint("second-instance");
});
app.on("will-quit", () => {
	isQuitting = true;
	closePermissionHelper();
	captureAgent?.stop();
	if (scrollAgent !== captureAgent) scrollAgent?.stop();
	forceTerminateActiveCaptureProcess("app-will-quit");
	abortActiveOcr("app-will-quit", true);
	closeAllPinnedScreenshots();
	destroySparePreviewWindow();
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
	// Opening QuickShot again from Finder, Launchpad or Spotlight.
	if (capturePhase === "idle") showTrayHint("reopen");
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
