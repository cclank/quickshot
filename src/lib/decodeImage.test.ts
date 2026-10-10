import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeImageData } from "./decodeImage";

describe("capture image loading", () => {
	afterEach(() => vi.unstubAllGlobals());

	function imageFixture(options: { cached?: boolean; error?: boolean } = {}) {
		const image = {
			onload: null as (() => void) | null,
			onerror: null as (() => void) | null,
			complete: false,
			naturalWidth: 3540,
			naturalHeight: 26465,
			decoding: "auto",
			decode: vi.fn(() => new Promise(() => {})),
			set src(_src: string) {
				if (options.cached) this.complete = true;
				else queueMicrotask(() => options.error ? this.onerror?.() : this.onload?.());
			},
		};
		vi.stubGlobal("Image", class { constructor() { return image; } });
		return image;
	}

	it("loads a tall capture without waiting on a stalled decode promise", async () => {
		const image = imageFixture();
		expect(await decodeImageData("blob:long-capture")).toBe(image);
		expect(image.decode).not.toHaveBeenCalled();
		expect(image.onload).toBeNull();
		expect(image.onerror).toBeNull();
	});

	it("accepts an already loaded cached image", async () => {
		const image = imageFixture({ cached: true });
		expect(await decodeImageData("blob:cached-capture")).toBe(image);
	});

	it("reports image failures even when they happen immediately after assigning the source", async () => {
		imageFixture({ error: true });
		await expect(decodeImageData("blob:invalid-capture")).rejects.toThrow("Failed to load image");
	});
});
