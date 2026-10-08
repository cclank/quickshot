import { contextBridge, ipcRenderer } from "electron";

const languageArgument = process.argv.find((value) =>
	value.startsWith("--quickshot-lang="),
);

contextBridge.exposeInMainWorld("electronAPI", {
	platform: process.platform,
	language: languageArgument?.slice("--quickshot-lang=".length),
	minimizeWindow: () => ipcRenderer.invoke("minimize-window"),
	getPendingPreviewSession: () =>
		ipcRenderer.invoke("get-pending-preview-session"),
	onPreviewSession: (callback: (sessionId: number) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, sessionId: number) => {
			if (Number.isInteger(sessionId)) callback(sessionId);
		};
		ipcRenderer.on("preview-session", listener);
		return () => {
			ipcRenderer.removeListener("preview-session", listener);
		};
	},
	getRegionCaptureSession: () =>
		ipcRenderer.invoke("get-region-capture-session"),
	regionSelectorReady: (sessionId: number) =>
		ipcRenderer.invoke("region-selector-ready", sessionId),
	cancelCaptureSession: (sessionId: number) =>
		ipcRenderer.invoke("cancel-capture-session", sessionId),
	screenshotRegionSelected: (payload: {
		sessionId: number;
		croppedImageBytes?: Uint8Array;
		action?: "edit" | "copy" | "save" | "pin";
		windowId?: number;
		rect?: { x: number; y: number; width: number; height: number };
	}) => ipcRenderer.invoke("screenshot-region-selected", payload),
	getPreviewSession: (sessionId: number) =>
		ipcRenderer.invoke("get-preview-session", sessionId),
	previewSessionReady: (sessionId: number) =>
		ipcRenderer.invoke("preview-session-ready", sessionId),
	saveScreenshotFinal: (pngData: ArrayBuffer) =>
		ipcRenderer.invoke("save-screenshot-final", pngData),
	quickSaveScreenshotFinal: (pngData: ArrayBuffer) =>
		ipcRenderer.invoke("quick-save-screenshot-final", pngData),
	copyToClipboard: (pngData: Uint8Array) =>
		ipcRenderer.invoke("copy-to-clipboard", pngData),
	pinScreenshot: (pngData: ArrayBuffer | Uint8Array) =>
		ipcRenderer.invoke("pin-screenshot", pngData),
	getPinnedScreenshot: () => ipcRenderer.invoke("get-pinned-screenshot"),
	pinnedScreenshotReady: () =>
		ipcRenderer.invoke("pinned-screenshot-ready"),
	setPinnedScreenshotClickThrough: (enabled: boolean) =>
		ipcRenderer.invoke("set-pinned-screenshot-click-through", enabled),
	resizePinnedScreenshot: (requestedWidth: number) =>
		ipcRenderer.invoke("resize-pinned-screenshot", requestedWidth),
	closePinnedScreenshot: () =>
		ipcRenderer.invoke("close-pinned-screenshot"),
	extractText: (pngData: ArrayBuffer | Uint8Array) =>
		ipcRenderer.invoke("extract-text", pngData),
	copyTextToClipboard: (text: string) =>
		ipcRenderer.invoke("copy-text-to-clipboard", text),
	readAssetDataUrl: (relativePath: string) =>
		ipcRenderer.invoke("read-asset-data-url", relativePath),
	onCaptureSession: (
		callback: (payload: { sessionId: number; imageBytes: Uint8Array; mimeType?: string }) => void,
	) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: { sessionId: number; imageBytes: Uint8Array; mimeType?: string },
		) => callback(payload);
		ipcRenderer.on("capture-session", listener);
		return () => {
			ipcRenderer.removeListener("capture-session", listener);
		};
	},
	onboarding: {
		getState: () => ipcRenderer.invoke("onboarding-state"),
		requestPermission: () => ipcRenderer.invoke("onboarding-request-permission"),
		relaunch: () => ipcRenderer.invoke("onboarding-relaunch"),
		setLaunchAtLogin: (enabled: boolean) => ipcRenderer.invoke("onboarding-set-launch-at-login", enabled),
		finish: (options: { capture?: boolean }) => ipcRenderer.invoke("onboarding-finish", options),
		onStep: (callback: (step: string) => void) => {
			const listener = (_event: Electron.IpcRendererEvent, step: string) => callback(step);
			ipcRenderer.on("onboarding-step", listener);
			return () => {
				ipcRenderer.removeListener("onboarding-step", listener);
			};
		},
	},
	permissionHelper: {
		/** Starts a native drag of QuickShot.app, for dropping on the Screen Recording list. */
		startDrag: () => ipcRenderer.send("permission-helper-drag"),
	},
	captureForStitch: () => ipcRenderer.invoke("capture-for-stitch"),
	onStitchPiece: (callback: (payload: { imageBytes: Uint8Array; scaleFactor: number }) => void) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: { imageBytes: Uint8Array; scaleFactor: number },
		) => callback(payload);
		ipcRenderer.on("stitch-piece", listener);
		return () => {
			ipcRenderer.removeListener("stitch-piece", listener);
		};
	},
	getCaptureWindows: (sessionId: number) =>
		ipcRenderer.invoke("get-capture-windows", sessionId),
	onCaptureWindows: (
		callback: (payload: { sessionId: number; windows: unknown[] }) => void,
	) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: { sessionId: number; windows: unknown[] },
		) => callback(payload);
		ipcRenderer.on("capture-windows", listener);
		return () => {
			ipcRenderer.removeListener("capture-windows", listener);
		};
	},
	onPinnedInteractionRestored: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("pinned-interaction-restored", listener);
		return () => {
			ipcRenderer.removeListener("pinned-interaction-restored", listener);
		};
	},
});
