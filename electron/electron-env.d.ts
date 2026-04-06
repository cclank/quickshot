/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
	interface ProcessEnv {
		APP_ROOT: string;
		VITE_PUBLIC: string;
	}
}

interface Window {
	electronAPI: {
		getPrimaryScreenSourceId: () => Promise<{
			success: boolean;
			sourceId?: string;
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
