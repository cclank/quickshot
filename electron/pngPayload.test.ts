import { describe, expect, it } from "vitest";
import {
	MAX_CAPTURE_PNG_BYTES,
	MAX_EXPORT_PNG_BYTES,
	MAX_PNG_DIMENSION,
	MAX_PNG_PIXELS,
	validatePngPayload,
} from "./pngPayload";

const PNG_HEADER_BYTES = 33;

function createPngHeader(width: number, height: number): Buffer {
	const buffer = Buffer.alloc(PNG_HEADER_BYTES);
	buffer.set(
		[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
		0,
	);
	buffer.writeUInt32BE(13, 8);
	buffer.write("IHDR", 12, "ascii");
	buffer.writeUInt32BE(width, 16);
	buffer.writeUInt32BE(height, 20);
	buffer.set([8, 6, 0, 0, 0], 24);
	return buffer;
}

describe("validatePngPayload", () => {
	it("accepts a structurally valid minimal PNG header", () => {
		const input = createPngHeader(1, 1);

		const result = validatePngPayload(input, input.byteLength);

		expect(result.buffer).toEqual(input);
		expect(result.dimensions).toEqual({ width: 1, height: 1 });
	});

	it("accepts a 6K image within the pixel limit", () => {
		const input = createPngHeader(6144, 3456);
		const arrayBuffer = Uint8Array.from(input).buffer;

		const result = validatePngPayload(arrayBuffer, MAX_CAPTURE_PNG_BYTES);

		expect(result.dimensions).toEqual({ width: 6144, height: 3456 });
	});

	it("keeps capture and export limits above high-entropy 6K payloads", () => {
		expect(MAX_CAPTURE_PNG_BYTES).toBeGreaterThan(62_933_908);
		expect(MAX_EXPORT_PNG_BYTES).toBeGreaterThan(68_789_048);
	});

	it("rejects payloads above the caller-provided byte limit", () => {
		const input = createPngHeader(1, 1);

		expect(() => validatePngPayload(input, input.byteLength - 1)).toThrow(
			"exceeds the byte limit",
		);
	});

	it("rejects dimensions above the per-side limit", () => {
		const input = createPngHeader(MAX_PNG_DIMENSION + 1, 1);

		expect(() => validatePngPayload(input, input.byteLength)).toThrow(
			`must not exceed ${MAX_PNG_DIMENSION}`,
		);
	});

	it("rejects images above the total pixel limit", () => {
		const width = 10_000;
		const height = Math.floor(MAX_PNG_PIXELS / width) + 1;
		const input = createPngHeader(width, height);

		expect(() => validatePngPayload(input, input.byteLength)).toThrow(
			`must not exceed ${MAX_PNG_PIXELS}`,
		);
	});

	it("preserves the exact range of a Uint8Array view", () => {
		const header = createPngHeader(320, 240);
		const backing = Buffer.alloc(header.byteLength + 11, 0xff);
		header.copy(backing, 7);
		const view = backing.subarray(7, 7 + header.byteLength);

		const result = validatePngPayload(view, view.byteLength);

		expect(result.buffer.byteOffset).toBe(view.byteOffset);
		expect(result.buffer.byteLength).toBe(view.byteLength);
		expect(result.buffer).toEqual(header);
		expect(result.dimensions).toEqual({ width: 320, height: 240 });
	});

	it("rejects a bad PNG signature", () => {
		const input = createPngHeader(1, 1);
		input[0] = 0;

		expect(() => validatePngPayload(input, input.byteLength)).toThrow(
			"Invalid PNG signature",
		);
	});

	it.each([
		{
			name: "wrong IHDR length",
			change: (input: Buffer) => input.writeUInt32BE(12, 8),
			message: "length 13",
		},
		{
			name: "wrong first chunk type",
			change: (input: Buffer) => input.write("IDAT", 12, "ascii"),
			message: "must be IHDR",
		},
	])("rejects $name", ({ change, message }) => {
		const input = createPngHeader(1, 1);
		change(input);

		expect(() => validatePngPayload(input, input.byteLength)).toThrow(message);
	});
});
