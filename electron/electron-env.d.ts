/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
	interface ProcessEnv {
		APP_ROOT: string;
		VITE_PUBLIC: string;
	}
}

interface Window {
	electronAPI: {
		getRegionCaptureSession: () => Promise<{
			success: boolean;
			session?: { sessionId: number; imageBytes: Uint8Array };
		}>;
		regionSelectorReady: (
			sessionId: number,
		) => Promise<{ success: boolean }>;
		cancelCaptureSession: (
			sessionId: number,
		) => Promise<{ success: boolean }>;
		screenshotRegionSelected: (payload: {
			sessionId: number;
			croppedImageBytes: Uint8Array;
		}) => Promise<{ success: boolean; error?: string }>;
		getPreviewSession: (sessionId: number) => Promise<{
			success: boolean;
			imageBytes?: Uint8Array;
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
		getAssetBasePath: () => Promise<string | null>;
		onCaptureSession: (
			callback: (payload: {
				sessionId: number;
				imageBytes: Uint8Array;
			}) => void,
		) => () => void;
		onPinnedInteractionRestored: (callback: () => void) => () => void;
	};
}
