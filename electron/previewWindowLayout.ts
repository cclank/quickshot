export type WorkArea = { x: number; y: number; width: number; height: number };

/**
 * Wide enough for the tools and the style controls to share the title bar
 * (with the colours folded into a menu). Windows also reserves room for the
 * caption buttons.
 */
export const PREVIEW_MIN_WIDTH = 1220;
export const PREVIEW_MIN_WIDTH_WINDOWS = 1360;
export const PREVIEW_MIN_HEIGHT = 640;
/** Inspector, gutters and canvas margins around the composed screenshot. */
const CHROME_WIDTH = 272 + 180;
const CHROME_HEIGHT = 52 + 190;

/**
 * Sizes the editor so the capture appears near its physical size, then
 * clamps it to the display and centres it on the work area.
 */
export function computePreviewBounds(
	workArea: WorkArea,
	imageWidth: number,
	imageHeight: number,
	scaleFactor: number,
	preferredMinWidth: number = PREVIEW_MIN_WIDTH,
) {
	const factor = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
	// Small displays win over the preferred minimum: never exceed the work area.
	const minWidth = Math.min(preferredMinWidth, workArea.width);
	const minHeight = Math.min(PREVIEW_MIN_HEIGHT, workArea.height);
	const maxWidth = Math.max(minWidth, Math.floor(workArea.width * 0.9));
	const maxHeight = Math.max(minHeight, Math.floor(workArea.height * 0.9));
	const width = Math.min(
		maxWidth,
		Math.max(minWidth, Math.round((imageWidth / factor) * 1.14 + CHROME_WIDTH)),
	);
	const height = Math.min(
		maxHeight,
		Math.max(minHeight, Math.round((imageHeight / factor) * 1.14 + CHROME_HEIGHT)),
	);
	return {
		x: workArea.x + Math.max(0, Math.round((workArea.width - width) / 2)),
		y: workArea.y + Math.max(0, Math.round((workArea.height - height) / 2)),
		width,
		height,
	};
}

/** Reads the dimensions from a PNG's IHDR chunk without decoding it. */
export function readPngDimensions(buffer: Uint8Array) {
	if (buffer.byteLength < 24) return null;
	const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
	const width = view.getUint32(16, false);
	const height = view.getUint32(20, false);
	return width > 0 && height > 0 ? { width, height } : null;
}
