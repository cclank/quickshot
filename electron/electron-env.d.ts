/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
	interface ProcessEnv {
		APP_ROOT: string;
		VITE_PUBLIC: string;
	}
}

interface Window {
	electronAPI: {
		regionSelectorReady: (
			sessionId: number,
		) => Promise<{ success: boolean }>;
		cancelCaptureSession: (
			sessionId: number,
		) => Promise<{ success: boolean }>;
		screenshotRegionSelected: (payload: {
			sessionId: number;
			croppedImageData: string;
		}) => Promise<{ success: boolean; error?: string }>;
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
		getAssetBasePath: () => Promise<string | null>;
		onCaptureSession: (
			callback: (payload: { sessionId: number; imageData: string }) => void,
		) => () => void;
		onPreviewSession: (
			callback: (payload: { sessionId: number; imageData: string }) => void,
		) => () => void;
	};
}
