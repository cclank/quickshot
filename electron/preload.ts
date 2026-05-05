import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
	regionSelectorReady: (sessionId: number) =>
		ipcRenderer.invoke("region-selector-ready", sessionId),
	cancelCaptureSession: (sessionId: number) =>
		ipcRenderer.invoke("cancel-capture-session", sessionId),
	screenshotRegionSelected: (payload: {
		sessionId: number;
		croppedImageData: string;
	}) => ipcRenderer.invoke("screenshot-region-selected", payload),
	previewSessionReady: (sessionId: number) =>
		ipcRenderer.invoke("preview-session-ready", sessionId),
	saveScreenshotFinal: (pngData: ArrayBuffer) =>
		ipcRenderer.invoke("save-screenshot-final", pngData),
	quickSaveScreenshotFinal: (pngData: ArrayBuffer) =>
		ipcRenderer.invoke("quick-save-screenshot-final", pngData),
	copyToClipboard: (pngData: Uint8Array) =>
		ipcRenderer.invoke("copy-to-clipboard", pngData),
	readAssetDataUrl: (relativePath: string) =>
		ipcRenderer.invoke("read-asset-data-url", relativePath),
	getAssetBasePath: () => ipcRenderer.invoke("get-asset-base-path"),
	onCaptureSession: (
		callback: (payload: { sessionId: number; imageData: string }) => void,
	) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: { sessionId: number; imageData: string },
		) => callback(payload);
		ipcRenderer.on("capture-session", listener);
		return () => {
			ipcRenderer.removeListener("capture-session", listener);
		};
	},
	onPreviewSession: (
		callback: (payload: { sessionId: number; imageData: string }) => void,
	) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: { sessionId: number; imageData: string },
		) => callback(payload);
		ipcRenderer.on("preview-session", listener);
		return () => {
			ipcRenderer.removeListener("preview-session", listener);
		};
	},
});
