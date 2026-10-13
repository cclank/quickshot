import { getVisualBounds, translateAnnotation } from "./annotations";
import { rectsOverlap } from "./crop";
import type { Annotation, Rect, TextMeasurer } from "./types";

/**
 * The capture overlay works in the frozen frame's own pixels, while the editor
 * measures its image from the crop's top-left corner. These helpers convert
 * between the two, so a mark drawn over a selection lands in the same place
 * once the selection is captured.
 */

/** The crop rectangle in frozen-frame pixels, rounded to whole pixels. */
export function selectionCropRect(
	selection: { x: number; y: number; width: number; height: number },
	unit: number,
): Rect {
	return {
		x: Math.max(0, Math.round(selection.x * unit)),
		y: Math.max(0, Math.round(selection.y * unit)),
		w: Math.max(0, Math.round(selection.width * unit)),
		h: Math.max(0, Math.round(selection.height * unit)),
	};
}

/** Keeps the marks that touch the crop and moves them to the crop's origin. */
export function clipAnnotationsToCrop(
	annotations: readonly Annotation[],
	crop: Rect,
	measure: TextMeasurer,
): Annotation[] {
	return annotations
		.filter((annotation) => rectsOverlap(getVisualBounds(annotation, measure), crop))
		.map((annotation) => translateAnnotation(annotation, -crop.x, -crop.y));
}

/** Moves every mark back onto the frozen frame, for the full-screen overlay. */
export function offsetAnnotations(
	annotations: readonly Annotation[],
	dx: number,
	dy: number,
): Annotation[] {
	return annotations.map((annotation) => translateAnnotation(annotation, dx, dy));
}

/**
 * The ratio an overlay canvas draws image pixels at: `1 / unit`, so a mark
 * stored in image pixels appears at its true point size on screen.
 */
export function overlayPixelScale(unit: number) {
	return 1 / Math.max(1e-6, unit);
}