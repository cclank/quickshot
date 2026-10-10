import { getVisualBounds, translateAnnotation } from "./annotations";
import { sourceSize, type SourceImage } from "./stitchSource";
import type { Annotation, Rect, TextMeasurer } from "./types";

/** Crop bounds always describe whole source pixels, independent of the view. */
export function normalizeCrop(rect: Rect, size: { width: number; height: number }): Rect | null {
	if (![rect.x, rect.y, rect.w, rect.h, size.width, size.height].every(Number.isFinite)) return null;
	if (rect.w <= 0 || rect.h <= 0 || size.width <= 0 || size.height <= 0) return null;
	const left = Math.max(0, Math.min(size.width, Math.round(rect.x)));
	const top = Math.max(0, Math.min(size.height, Math.round(rect.y)));
	const right = Math.max(0, Math.min(size.width, Math.round(rect.x + rect.w)));
	const bottom = Math.max(0, Math.min(size.height, Math.round(rect.y + rect.h)));
	return right > left && bottom > top ? { x: left, y: top, w: right - left, h: bottom - top } : null;
}

export function combineCrops(previous: Rect | null, next: Rect): Rect {
	return { ...next, x: (previous?.x ?? 0) + next.x, y: (previous?.y ?? 0) + next.y };
}

export function rectsOverlap(a: Rect, b: Rect) {
	return a.x + a.w >= b.x && a.y + a.h >= b.y && a.x <= b.x + b.w && a.y <= b.y + b.h;
}

/** Keep partial marks intact; the image clip trims them at the new edges. */
export function cropAnnotations(annotations: readonly Annotation[], crop: Rect, measure: TextMeasurer) {
	return annotations
		.filter((annotation) => rectsOverlap(getVisualBounds(annotation, measure), crop))
		.map((annotation) => translateAnnotation(annotation, -crop.x, -crop.y));
}

/** History retains only bounds and the original source, never a canvas per crop. */
export function renderCroppedSource(source: SourceImage | null, crop: Rect | null): SourceImage | null {
	if (!source || !crop) return source;
	const rect = normalizeCrop(crop, sourceSize(source));
	if (!rect) return source;
	const canvas = document.createElement("canvas");
	canvas.width = rect.w;
	canvas.height = rect.h;
	const context = canvas.getContext("2d");
	if (!context) return source;
	context.drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
	return canvas;
}
