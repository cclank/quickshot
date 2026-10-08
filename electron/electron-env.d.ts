/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
	interface ProcessEnv {
		APP_ROOT: string;
		VITE_PUBLIC: string;
	}
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
			session?: { sessionId: number; imageBytes: Uint8Array; mimeType?: string };
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
			action?: "edit" | "copy" | "save" | "pin";
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
			| { success: true; imageBytes: Uint8Array }
			| { success: false }
		>;
		pinnedScreenshotReady: () => Promise<{ success: boolean }>;
		setPinnedScreenshotClickThrough: (
			enabled: boolean,
		) => Promise<{
			success: boolean;
			recoveryShortcutRegistered?: boolean;
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
