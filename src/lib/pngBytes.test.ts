import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createPngBlob,
	createPngObjectUrl,
	normalizePngBytes,
} from "./pngBytes";

const VALID_PNG_PREFIX = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);

describe("PNG byte transport", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("accepts a PNG signature without converting it to base64", () => {
		expect(normalizePngBytes(VALID_PNG_PREFIX)).toBe(VALID_PNG_PREFIX);
	});

	it("rejects malformed image bytes", () => {
		expect(() => normalizePngBytes(new Uint8Array([1, 2, 3]))).toThrow(
			"Invalid PNG image bytes",
		);
	});

	it("creates and revokes a blob URL", () => {
		const createObjectUrl = vi
			.spyOn(URL, "createObjectURL")
			.mockReturnValue("blob:quickshot-test");
		const revokeObjectUrl = vi
			.spyOn(URL, "revokeObjectURL")
			.mockImplementation(() => {});

		const objectUrl = createPngObjectUrl(VALID_PNG_PREFIX);
		expect(objectUrl).toBe("blob:quickshot-test");
		expect(createObjectUrl).toHaveBeenCalledOnce();

		URL.revokeObjectURL(objectUrl);
		expect(revokeObjectUrl).toHaveBeenCalledOnce();
		expect(revokeObjectUrl).toHaveBeenCalledWith(objectUrl);
	});

	it("limits the blob to the provided Uint8Array view", async () => {
		const prefixBytes = [0xaa, 0xbb];
		const suffixBytes = [0xcc, 0xdd];
		const backing = new Uint8Array([
			...prefixBytes,
			...VALID_PNG_PREFIX,
			...suffixBytes,
		]);
		const view = backing.subarray(
			prefixBytes.length,
			prefixBytes.length + VALID_PNG_PREFIX.byteLength,
		);
		expect(view.byteOffset).toBeGreaterThan(0);
		expect(view.buffer.byteLength).toBeGreaterThan(view.byteLength);

		const blob = createPngBlob(view);
		expect(blob.size).toBe(view.byteLength);
		expect(blob.type).toBe("image/png");
		expect(
			new Uint8Array(await blob.arrayBuffer()),
		).toEqual(new Uint8Array(view));
	});
});
