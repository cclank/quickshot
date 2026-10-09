const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const PNG_IHDR_CHUNK_TYPE = Buffer.from("IHDR", "ascii");
const PNG_IHDR_DATA_LENGTH = 13;
const PNG_IHDR_END_OFFSET =
	PNG_SIGNATURE.byteLength +
	4 +
	PNG_IHDR_CHUNK_TYPE.byteLength +
	PNG_IHDR_DATA_LENGTH +
	4;

// Long scrolling captures reach 30,000 pixels; Chromium's canvases stop
// at 32,767 a side, and the editor exports at most 120 million pixels.
export const MAX_PNG_DIMENSION = 32_000;
export const MAX_PNG_PIXELS = 120_000_000;
export const MAX_CAPTURE_PNG_BYTES = 160 * 1024 * 1024;
export const MAX_EXPORT_PNG_BYTES = 192 * 1024 * 1024;

export interface PngDimensions {
	width: number;
	height: number;
}

export interface ValidatedPngPayload {
	buffer: Buffer;
	dimensions: PngDimensions;
}

function toExactBuffer(value: Uint8Array | ArrayBuffer): Buffer {
	if (value instanceof Uint8Array) {
		return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
	}
	if (value instanceof ArrayBuffer) {
		return Buffer.from(value);
	}
	throw new TypeError("PNG payload must be a Uint8Array or ArrayBuffer");
}

export function validatePngPayload(
	value: Uint8Array | ArrayBuffer,
	maxBytes: number,
): ValidatedPngPayload {
	if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
		throw new RangeError("PNG payload byte limit must be a positive integer");
	}

	const buffer = toExactBuffer(value);
	if (buffer.byteLength > maxBytes) {
		throw new RangeError("PNG payload exceeds the byte limit");
	}
	if (buffer.byteLength < PNG_IHDR_END_OFFSET) {
		throw new Error("PNG payload is too short to contain an IHDR chunk");
	}
	if (!buffer.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE)) {
		throw new Error("Invalid PNG signature");
	}

	const ihdrLength = buffer.readUInt32BE(PNG_SIGNATURE.byteLength);
	if (ihdrLength !== PNG_IHDR_DATA_LENGTH) {
		throw new Error("PNG first chunk must be an IHDR chunk with length 13");
	}

	const ihdrTypeOffset = PNG_SIGNATURE.byteLength + 4;
	if (
		!buffer
			.subarray(
				ihdrTypeOffset,
				ihdrTypeOffset + PNG_IHDR_CHUNK_TYPE.byteLength,
			)
			.equals(PNG_IHDR_CHUNK_TYPE)
	) {
		throw new Error("PNG first chunk must be IHDR");
	}

	const width = buffer.readUInt32BE(ihdrTypeOffset + 4);
	const height = buffer.readUInt32BE(ihdrTypeOffset + 8);
	if (width === 0 || height === 0) {
		throw new RangeError("PNG dimensions must be greater than zero");
	}
	if (width > MAX_PNG_DIMENSION || height > MAX_PNG_DIMENSION) {
		throw new RangeError(
			`PNG dimensions must not exceed ${MAX_PNG_DIMENSION} pixels per side`,
		);
	}
	if (width * height > MAX_PNG_PIXELS) {
		throw new RangeError(
			`PNG pixel count must not exceed ${MAX_PNG_PIXELS}`,
		);
	}

	return {
		buffer,
		dimensions: { width, height },
	};
}
