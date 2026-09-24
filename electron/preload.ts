import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
	getRegionCaptureSession: () =>
		ipcRenderer.invoke("get-region-capture-session"),
	regionSelectorReady: (sessionId: number) =>
		ipcRenderer.invoke("region-selector-ready", sessionId),
	cancelCaptureSession: (sessionId: number) =>
		ipcRenderer.invoke("cancel-capture-session", sessionId),
	screenshotRegionSelected: (payload: {
		sessionId: number;
		croppedImageBytes: Uint8Array;
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
	getAssetBasePath: () => ipcRenderer.invoke("get-asset-base-path"),
	onCaptureSession: (
		callback: (payload: { sessionId: number; imageBytes: Uint8Array }) => void,
	) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: { sessionId: number; imageBytes: Uint8Array },
		) => callback(payload);
		ipcRenderer.on("capture-session", listener);
		return () => {
			ipcRenderer.removeListener("capture-session", listener);
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
