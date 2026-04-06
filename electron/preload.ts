import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
	getPrimaryScreenSourceId: () =>
		ipcRenderer.invoke("get-primary-screen-source-id"),
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
