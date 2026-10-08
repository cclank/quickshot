import { describe, expect, it, vi } from "vitest";
import { createAssetResolver } from "./assetPath";

const IMAGE = "data:image/jpeg;base64,dGVzdA==";
const desktop = (readAssetDataUrl?: (path: string) => Promise<string | null>) => createAssetResolver({
	documentUrl: "file:///Applications/QuickShot.app/Contents/Resources/app.asar/dist/index.html",
	publicBaseUrl: "./",
	readAssetDataUrl,
});

describe("bundled asset resolution", () => {
	it("resolves browser fixtures from the public base, not the fixture directory", async () => {
		const reader = vi.fn();
		const resolve = createAssetResolver({
			documentUrl: "http://localhost:5188/test-fixtures/screenshot-preview.html?sessionId=1",
			publicBaseUrl: "/quickshot/",
			readAssetDataUrl: reader,
		});
		expect(await resolve("wallpapers/蓝 色 #1.jpg")).toBe(
			"http://localhost:5188/quickshot/wallpapers/%E8%93%9D%20%E8%89%B2%20%231.jpg",
		);
		expect(reader).not.toHaveBeenCalled();
	});

	it("supports a relative base when previewing the production renderer over HTTPS", async () => {
		const resolve = createAssetResolver({ documentUrl: "https://example.com/tools/index.html", publicBaseUrl: "./" });
		expect(await resolve("wallpapers/image.jpg")).toBe("https://example.com/tools/wallpapers/image.jpg");
	});

	it("coalesces concurrent reads of the same canonical path", async () => {
		const reader = vi.fn().mockResolvedValue(IMAGE);
		const resolve = desktop(reader);
		expect(await Promise.all([
			resolve("wallpapers\\thumbnails\\image.jpg"),
			resolve("wallpapers//thumbnails/image.jpg"),
		])).toEqual([IMAGE, IMAGE]);
		await resolve("wallpapers/thumbnails/image.jpg");
		expect(reader).toHaveBeenCalledExactlyOnceWith("wallpapers/thumbnails/image.jpg");
	});

	it.each(["missing file", "IPC rejection"])("retries after a failed read: %s", async (failure) => {
		const reader = vi.fn();
		if (failure === "missing file") reader.mockResolvedValueOnce(null);
		else reader.mockRejectedValueOnce(new Error("IPC disconnected"));
		reader.mockResolvedValueOnce(IMAGE);
		const resolve = desktop(reader);
		await expect(resolve("wallpapers/image.jpg")).rejects.toThrow();
		expect(await resolve("wallpapers/image.jpg")).toBe(IMAGE);
		expect(reader).toHaveBeenCalledTimes(2);
	});

	it("does not invent a file URL when the asset bridge is unavailable", async () => {
		await expect(desktop()("wallpapers/image.jpg")).rejects.toThrow("bridge is unavailable");
	});

	it("bypasses retention for full size images without replacing a cached thumbnail", async () => {
		const freshImage = "data:image/jpeg;base64,ZnJlc2g=";
		const reader = vi.fn().mockResolvedValueOnce(IMAGE).mockResolvedValue(freshImage);
		const resolve = desktop(reader);
		await resolve("wallpapers/image.jpg");
		expect(await resolve("wallpapers/image.jpg", { cache: false })).toBe(freshImage);
		expect(await resolve("wallpapers/image.jpg", { cache: false })).toBe(freshImage);
		expect(await resolve("wallpapers/image.jpg")).toBe(IMAGE);
		expect(reader).toHaveBeenCalledTimes(3);
	});

	it("bounds retained reads and keeps recently used entries", async () => {
		const reader = vi.fn().mockResolvedValue(IMAGE);
		const resolve = desktop(reader);
		for (let index = 0; index < 24; index += 1) await resolve(`wallpapers/${index}.jpg`);
		await resolve("wallpapers/0.jpg");
		await resolve("wallpapers/24.jpg");
		await resolve("wallpapers/0.jpg");
		expect(reader).toHaveBeenCalledTimes(25);
		await resolve("wallpapers/1.jpg");
		expect(reader).toHaveBeenCalledTimes(26);
	});

	it.each(["", "../image.jpg", "wallpapers/../image.jpg", "wallpapers/./image.jpg", "/image.jpg", "\\image.jpg", "C:\\image.jpg", "https://example.com/image.jpg", "wallpapers/\0image.jpg"])(
		"rejects a path outside the relative asset contract: %j", async (path) => {
			const reader = vi.fn().mockResolvedValue(IMAGE);
			await expect(desktop(reader)(path)).rejects.toThrow();
			expect(reader).not.toHaveBeenCalled();
		},
	);
});
