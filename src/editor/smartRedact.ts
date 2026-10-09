import { createAnnotationId } from "./annotations";
import type { Annotation, Rect, RedactAnnotation, RedactMode } from "./types";

/** How much of a region an existing redaction must cover for it to count as done. */
const COVERED_SHARE = 0.8;

function normalized({ x, y, w, h }: Rect): Rect {
	return { x: Math.min(x, x + w), y: Math.min(y, y + h), w: Math.abs(w), h: Math.abs(h) };
}

function overlapArea(a: Rect, b: Rect) {
	const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
	const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
	return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Redactions for the regions smart redaction found, skipping any that are
 * already covered, so running it twice adds nothing. Pixel blocks or blur
 * scale with the text, so even large text is unreadable.
 */
export function smartRedactions(
	regions: readonly Rect[],
	existing: readonly Annotation[],
	mode: RedactMode,
	strength: number,
): RedactAnnotation[] {
	const covers = existing
		.filter((annotation): annotation is RedactAnnotation => annotation.kind === "redact")
		.map(normalized);
	return regions
		.filter((region) => {
			const area = region.w * region.h;
			return area > 0 && !covers.some((cover) => overlapArea(cover, region) >= area * COVERED_SHARE);
		})
		.map((region) => ({
			id: createAnnotationId(),
			kind: "redact",
			x: region.x,
			y: region.y,
			w: region.w,
			h: region.h,
			mode,
			strength: Math.max(strength, Math.round(region.h * 0.3)),
		}));
}
