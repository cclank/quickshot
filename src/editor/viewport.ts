import type { Point, Rect } from "./types";

export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 8;

export function clampZoom(zoom: number) {
	return Number.isFinite(zoom) ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) : 1;
}

/** A fitting image stays centred; a larger one can be moved to either edge. */
export function clampPan(pan: Point, content: { w: number; h: number }, available: { w: number; h: number }): Point {
	const x = Math.max(0, (content.w - available.w) / 2);
	const y = Math.max(0, (content.h - available.h) / 2);
	return { x: Math.min(x, Math.max(-x, pan.x)), y: Math.min(y, Math.max(-y, pan.y)) };
}

/** Keep the same image point under the cursor. Anchor is relative to view centre. */
export function panAfterZoom(pan: Point, anchor: Point, ratio: number): Point {
	return { x: anchor.x - (anchor.x - pan.x) * ratio, y: anchor.y - (anchor.y - pan.y) * ratio };
}

/** Canvas backing covers only visible CSS pixels, even for a 30,000px image. */
export function visibleStageRect(origin: Point, content: { w: number; h: number }, viewport: { w: number; h: number }): Rect {
	const x = Math.max(0, -origin.x);
	const y = Math.max(0, -origin.y);
	return {
		x,
		y,
		w: Math.max(0, Math.min(content.w, viewport.w - origin.x) - x),
		h: Math.max(0, Math.min(content.h, viewport.h - origin.y) - y),
	};
}
