const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function normalizePngBytes(
	value: ArrayBuffer | Uint8Array,
): Uint8Array {
	const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
	if (
		bytes.byteLength < PNG_SIGNATURE.length ||
		!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
	) {
		throw new Error("Invalid PNG image bytes");
	}
	return bytes;
}

export function createPngObjectUrl(
	value: ArrayBuffer | Uint8Array,
): string {
	return URL.createObjectURL(createPngBlob(value));
}

export function createPngBlob(
	value: ArrayBuffer | Uint8Array,
): Blob {
	const bytes = normalizePngBytes(value);
	const blobBytes =
		bytes.buffer instanceof ArrayBuffer
			? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
			: Uint8Array.from(bytes);
	return new Blob([blobBytes], { type: "image/png" });
}
