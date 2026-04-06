import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
	getScreenCapture: () => ipcRenderer.invoke("get-screen-capture"),
	getPrimaryScreenSourceId: () =>
		ipcRenderer.invoke("get-primary-screen-source-id"),
	getScreenCaptureFallback: (sourceId: string) =>
		ipcRenderer.invoke("get-screen-capture-fallback", sourceId),
	showRegionSelector: () => ipcRenderer.invoke("show-region-selector"),
	screenshotRegionSelected: (croppedImageData: string) =>
		ipcRenderer.invoke("screenshot-region-selected", croppedImageData),
	getScreenshotData: () => ipcRenderer.invoke("get-screenshot-data"),
	saveScreenshotFinal: (pngData: ArrayBuffer) =>
		ipcRenderer.invoke("save-screenshot-final", pngData),
	copyToClipboard: (pngData: Uint8Array) =>
		ipcRenderer.invoke("copy-to-clipboard", pngData),
	getAssetBasePath: () => ipcRenderer.invoke("get-asset-base-path"),
});
