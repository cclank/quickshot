import type { Bounds } from "./windowList";

/** `screencapture` arguments for one window, without its drop shadow. */
export function getWindowCaptureArguments(windowId: number, filePath: string) {
	return ["-l", String(windowId), "-o", "-x", "-t", "png", filePath];
}

/**
 * The smallest rectangle holding every pixel more opaque than `threshold`, in a
 * 4-byte-per-pixel bitmap with alpha last (BGRA or RGBA). Some apps draw their
 * window inside a larger transparent frame; trimming it leaves just the window.
 * Returns null when every pixel is transparent.
 */
export function findOpaqueBounds(
	bitmap: Uint8Array,
	width: number,
	height: number,
	threshold = 8,
): Bounds | null {
	if (width <= 0 || height <= 0 || bitmap.length < width * height * 4) return null;
	const opaque = (x: number, y: number) => bitmap[(y * width + x) * 4 + 3] > threshold;
	const rowHasPixel = (y: number) => {
		for (let x = 0; x < width; x += 1) if (opaque(x, y)) return true;
		return false;
	};
	let top = 0;
	while (top < height && !rowHasPixel(top)) top += 1;
	if (top === height) return null;
	let bottom = height - 1;
	while (bottom > top && !rowHasPixel(bottom)) bottom -= 1;
	const columnHasPixel = (x: number) => {
		for (let y = top; y <= bottom; y += 1) if (opaque(x, y)) return true;
		return false;
	};
	let left = 0;
	while (left < width && !columnHasPixel(left)) left += 1;
	let right = width - 1;
	while (right > left && !columnHasPixel(right)) right -= 1;
	return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}
