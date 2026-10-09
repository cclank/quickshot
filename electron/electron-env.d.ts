/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
	interface ProcessEnv {
		APP_ROOT: string;
		VITE_PUBLIC: string;
	}
}

/** A scrolling capture's state, as the main process reports it to its panel. */
interface ScrollCaptureProgress {
	status: "waiting" | "capturing" | "behind" | "lost" | "full" | "finishing" | "error";
	/** Pixels the image would have if finished now. */
	height: number;
	width: number;
	/** One screen of the area, in pixels. */
	frameHeight?: number;
	preview: number;
	/** The latest preview JPEG, sent only when it changed. */
	previewBytes?: Uint8Array;
}

/** What the settings window shows. */
interface SettingsState {
	platform: "darwin" | "win32" | "linux";
	shortcuts: {
		capture: { accelerator: string; label: string; isDefault: boolean };
		scrollCapture: { accelerator: string; label: string } | null;
		/** Gives pinned screenshots their mouse back after click-through. */
		restorePins: { accelerator: string; label: string; isDefault: boolean };
		/** Scrolling capture needs macOS 14. */
		scrollAvailable: boolean;
		defaultCaptureLabel: string;
		/** False in a development build started without global shortcuts. */
		enabled: boolean;
	};
	language: "auto" | "zh" | "en";
	macCaptureMode: "overlay" | "system";
	launchAtLogin: boolean;
	launchAtLoginAvailable: boolean;
	update: {
		version: string;
		state:
			| { kind: "idle" | "checking" | "upToDate" }
			| { kind: "available" | "installing"; version: string }
			| { kind: "downloading"; version: string; progress: number }
			| { kind: "failed"; reason: "network" | "download" | "checksum" | "location" | "install" };
		/** Updates exist for macOS (both chips) and 64-bit Windows. */
		supported: boolean;
		/** Built and installed on this Mac: no automatic checks. */
		localBuild: boolean;
	};
}

/** A key the main process passes on while a shortcut is being recorded. */
interface SettingsKeyPress {
	type: "keyDown" | "keyUp";
	code: string;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
}

/** A window under the capture overlay, in the overlay's CSS pixels. */
interface DetectedWindow {
	/** macOS window number, used to capture just this window. */
	id?: number;
	x: number;
	y: number;
	width: number;
	height: number;
	app: string;
	title: string;
}

interface Window {
	electronAPI: {
		platform?: "darwin" | "win32" | "linux";
		language?: string;
		minimizeWindow?: () => Promise<void>;
		getPendingPreviewSession?: () => Promise<
			{ success: true; sessionId: number } | { success: false }
		>;
		onPreviewSession?: (callback: (sessionId: number) => void) => () => void;
		getRegionCaptureSession: () => Promise<{
			success: boolean;
			session?: {
				sessionId: number;
				imageBytes: Uint8Array;
				mimeType?: string;
				/** Opens in scrolling-capture mode. */
				scroll?: boolean;
				/** Whether S may switch to scrolling capture (macOS 14+). */
				scrollAvailable?: boolean;
			};
		}>;
		regionSelectorReady: (
			sessionId: number,
		) => Promise<{ success: boolean }>;
		cancelCaptureSession: (
			sessionId: number,
		) => Promise<{ success: boolean }>;
		screenshotRegionSelected: (payload: {
			sessionId: number;
			/** The selected area, encoded by the overlay. */
			croppedImageBytes?: Uint8Array;
			/** "scroll" starts a scrolling capture of `rect`. */
			action?: "edit" | "copy" | "save" | "pin" | "scroll";
			/** A clicked window, captured on its own by the main process. */
			windowId?: number;
			/** The selection in frozen-frame pixels; the main process crops it. */
			rect?: { x: number; y: number; width: number; height: number };
		}) => Promise<{ success: boolean; error?: string }>;
		getPreviewSession: (sessionId: number) => Promise<{
			success: boolean;
			imageBytes?: Uint8Array;
			scaleFactor?: number;
		}>;
		previewSessionReady: (
			sessionId: number,
		) => Promise<{ success: boolean }>;
		saveScreenshotFinal: (
			pngData: ArrayBuffer,
		) => Promise<{
			success: boolean;
			path?: string;
			canceled?: boolean;
			error?: string;
		}>;
		quickSaveScreenshotFinal: (
			pngData: ArrayBuffer,
		) => Promise<{
			success: boolean;
			path?: string;
			error?: string;
		}>;
		copyToClipboard: (
			pngData: Uint8Array,
		) => Promise<{ success: boolean; error?: string }>;
		pinScreenshot: (
			pngData: ArrayBuffer | Uint8Array,
		) => Promise<
			| { success: true }
			| {
					success: false;
					code:
						| "untrusted-sender"
						| "limit-reached"
						| "create-failed";
					error: string;
			  }
		>;
		getPinnedScreenshot: () => Promise<
			| { success: true; imageBytes: Uint8Array; recoveryShortcut?: string }
			| { success: false }
		>;
		pinnedScreenshotReady: () => Promise<{ success: boolean }>;
		setPinnedScreenshotClickThrough: (
			enabled: boolean,
		) => Promise<{
			success: boolean;
			recoveryShortcutRegistered?: boolean;
			/** How the restore shortcut is shown, e.g. "⌘⇧L". */
			recoveryShortcut?: string;
		}>;
		resizePinnedScreenshot: (
			requestedWidth: number,
		) => Promise<{
			success: boolean;
			width?: number;
			height?: number;
		}>;
		closePinnedScreenshot: () => Promise<{ success: boolean }>;
		extractText: (
			pngData: ArrayBuffer | Uint8Array,
		) => Promise<
			| {
					success: true;
					text: string;
					lineCount: number;
			  }
			| {
					success: false;
					code:
						| "unsupported-platform"
						| "invalid-image"
						| "busy"
						| "helper-unavailable"
						| "timeout"
						| "recognition-failed";
					error: string;
			  }
		>;
		copyTextToClipboard: (
			text: string,
		) => Promise<{ success: boolean; error?: string }>;
		readAssetDataUrl: (relativePath: string) => Promise<string | null>;
		onCaptureSession: (
			callback: (payload: {
				sessionId: number;
				imageBytes: Uint8Array;
				/** "image/jpeg" for the macOS agent's preview, otherwise PNG. */
				mimeType?: string;
				scroll?: boolean;
				scrollAvailable?: boolean;
			}) => void,
		) => () => void;
		onPinnedInteractionRestored: (callback: () => void) => () => void;
		getCaptureWindows?: (sessionId: number) => Promise<
			{ success: true; windows: DetectedWindow[] } | { success: false }
		>;
		/** The welcome guide window. */
		onboarding?: {
			getState: () => Promise<{
				platform: "darwin" | "win32" | "linux";
				/** macOS Screen Recording: "granted", "denied", "not-determined", … */
				permission: string;
				shortcut: string;
				launchAtLogin: boolean;
			} | null>;
			requestPermission: () => Promise<{ success: boolean; permission?: string }>;
			relaunch: () => Promise<{ success: boolean }>;
			setLaunchAtLogin: (enabled: boolean) => Promise<{ success: boolean; launchAtLogin?: boolean }>;
			finish: (options: { capture?: boolean }) => Promise<{ success: boolean }>;
			onStep: (callback: (step: string) => void) => () => void;
		};
		/** The settings window. */
		settings?: {
			getState: () => Promise<SettingsState | null>;
			setShortcut: (
				kind: "capture" | "scrollCapture" | "restorePins",
				value: string | null,
			) => Promise<{ success: boolean; error?: string; state?: SettingsState }>;
			setRecording: (recording: boolean) => Promise<{ success: boolean }>;
			setLanguage: (language: "auto" | "zh" | "en") => Promise<{ success: boolean; state?: SettingsState }>;
			setCaptureMode: (mode: "overlay" | "system") => Promise<{ success: boolean; state?: SettingsState }>;
			setLaunchAtLogin: (enabled: boolean) => Promise<{ success: boolean; state?: SettingsState }>;
			checkUpdate: () => Promise<{ success: boolean; state?: SettingsState }>;
			installUpdate: () => Promise<{ success: boolean }>;
			onChanged: (callback: (state: SettingsState) => void) => () => void;
			/** Keys pressed while recording, which the main process holds back from the page. */
			onKey?: (callback: (press: SettingsKeyPress) => void) => () => void;
		};
		/** The panel beside a scrolling capture. */
		scrollCapture?: {
			getState: () => Promise<
				{ success: true; progress: ScrollCaptureProgress; previewBytes?: Uint8Array } | { success: false }
			>;
			finish: () => Promise<{ success: boolean }>;
			cancel: () => Promise<{ success: boolean }>;
			onProgress: (callback: (progress: ScrollCaptureProgress) => void) => () => void;
		};
		/** The strip shown under System Settings while Screen Recording is off. */
		permissionHelper?: { startDrag: () => void };
		/** Hides the editor, takes another capture and sends it back as a stitch piece. */
		captureForStitch?: () => Promise<{ success: boolean; error?: string }>;
		onStitchPiece?: (
			callback: (payload: { imageBytes: Uint8Array; scaleFactor: number }) => void,
		) => () => void;
		onCaptureWindows?: (
			callback: (payload: { sessionId: number; windows: DetectedWindow[] }) => void,
		) => () => void;
	};
}
