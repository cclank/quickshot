/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
	interface ProcessEnv {
		APP_ROOT: string;
		VITE_PUBLIC: string;
	}
}

interface Window {
	electronAPI: {
		getScreenCapture: () => Promise<{ success: boolean; imageData?: string }>;
		getPrimaryScreenSourceId: () => Promise<{
			success: boolean;
			sourceId?: string;
			error?: string;
		}>;
		getScreenCaptureFallback: (sourceId: string) => Promise<{
			success: boolean;
			imageData?: string;
			error?: string;
		}>;
		showRegionSelector: () => Promise<{ success: boolean }>;
		screenshotRegionSelected: (
			croppedImageData: string,
		) => Promise<{ success: boolean; error?: string }>;
		getScreenshotData: () => Promise<{
			success: boolean;
			imageData?: string;
		}>;
		saveScreenshotFinal: (
			pngData: ArrayBuffer,
		) => Promise<{
			success: boolean;
			path?: string;
			canceled?: boolean;
			error?: string;
		}>;
		copyToClipboard: (
			pngData: Uint8Array,
		) => Promise<{ success: boolean; error?: string }>;
		getAssetBasePath: () => Promise<string | null>;
	};
}
