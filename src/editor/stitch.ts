import { getAnnotationBounds, translateAnnotation } from "./annotations";
import type { Annotation, TextMeasurer } from "./types";

/**
 * Stitching joins several captures into one image. Pieces are laid out in
 * order, top to bottom, left to right, or in a grid. Annotations belong to
 * the piece under them, so they move with it when the layout changes.
 */

export type StitchArrangement = "vertical" | "horizontal" | "grid";
export type StitchAlign = "start" | "center" | "end";

export type StitchSettings = {
	arrangement: StitchArrangement;
	/** Space between pieces, in points. */
	gap: number;
	/** Cross-axis alignment of pieces narrower than their row or column. */
	align: StitchAlign;
};

export const STITCH_ARRANGEMENTS: StitchArrangement[] = ["vertical", "horizontal", "grid"];
export const STITCH_ALIGNMENTS: StitchAlign[] = ["start", "center", "end"];
export const STITCH_GAP_RANGE = { min: 0, max: 80, step: 2 } as const;
export const DEFAULT_STITCH_SETTINGS: StitchSettings = {
	arrangement: "vertical",
	gap: 0,
	align: "start",
};

/** A piece's size in the stitched image's pixels. */
export type StitchSize = { id: string; width: number; height: number };
export type StitchRect = { x: number; y: number; width: number; height: number };

export type StitchPlacement = {
	width: number;
	height: number;
	/** Where each piece goes, by piece id. */
	rects: Record<string, StitchRect>;
};

function offset(space: number, size: number, align: StitchAlign) {
	if (align === "center") return Math.round((space - size) / 2);
	if (align === "end") return space - size;
	return 0;
}

export function gridColumns(count: number) {
	return Math.max(1, Math.ceil(Math.sqrt(count)));
}

/** Positions the pieces; `unit` converts the gap from points to pixels. */
export function computeStitchPlacement(
	pieces: readonly StitchSize[],
	settings: StitchSettings,
	unit: number,
): StitchPlacement {
	const gap = Math.max(0, Math.round(settings.gap * unit));
	const rects: Record<string, StitchRect> = {};
	if (pieces.length === 0) return { width: 0, height: 0, rects };

	if (settings.arrangement === "vertical") {
		const width = Math.max(...pieces.map((piece) => piece.width));
		let y = 0;
		for (const piece of pieces) {
			rects[piece.id] = { x: offset(width, piece.width, settings.align), y, width: piece.width, height: piece.height };
			y += piece.height + gap;
		}
		return { width, height: y - gap, rects };
	}

	if (settings.arrangement === "horizontal") {
		const height = Math.max(...pieces.map((piece) => piece.height));
		let x = 0;
		for (const piece of pieces) {
			rects[piece.id] = { x, y: offset(height, piece.height, settings.align), width: piece.width, height: piece.height };
			x += piece.width + gap;
		}
		return { width: x - gap, height, rects };
	}

	// Grid: row-major, each column as wide as its widest piece and each row as
	// tall as its tallest, so mixed sizes stay compact.
	const columns = gridColumns(pieces.length);
	const rows = Math.ceil(pieces.length / columns);
	const columnWidths = Array.from({ length: columns }, () => 0);
	const rowHeights = Array.from({ length: rows }, () => 0);
	pieces.forEach((piece, index) => {
		const column = index % columns;
		const row = Math.floor(index / columns);
		columnWidths[column] = Math.max(columnWidths[column], piece.width);
		rowHeights[row] = Math.max(rowHeights[row], piece.height);
	});
	const columnX = columnWidths.map((_, column) =>
		columnWidths.slice(0, column).reduce((sum, width) => sum + width + gap, 0),
	);
	const rowY = rowHeights.map((_, row) =>
		rowHeights.slice(0, row).reduce((sum, height) => sum + height + gap, 0),
	);
	pieces.forEach((piece, index) => {
		const column = index % columns;
		const row = Math.floor(index / columns);
		rects[piece.id] = {
			x: columnX[column] + offset(columnWidths[column], piece.width, settings.align),
			y: rowY[row] + offset(rowHeights[row], piece.height, settings.align),
			width: piece.width,
			height: piece.height,
		};
	});
	return {
		width: columnWidths.reduce((sum, width) => sum + width, 0) + gap * (columns - 1),
		height: rowHeights.reduce((sum, height) => sum + height, 0) + gap * (rows - 1),
		rects,
	};
}

function distanceToRect(x: number, y: number, rect: StitchRect) {
	const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.width));
	const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.height));
	return Math.hypot(dx, dy);
}

/** The piece an annotation belongs to: the one under its centre, or the nearest. */
export function pieceForAnnotation(
	annotation: Annotation,
	placement: StitchPlacement,
	measure: TextMeasurer,
): string | null {
	const bounds = getAnnotationBounds(annotation, measure);
	const x = bounds.x + bounds.w / 2;
	const y = bounds.y + bounds.h / 2;
	let best: string | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const [id, rect] of Object.entries(placement.rects)) {
		const distance = distanceToRect(x, y, rect);
		if (distance < bestDistance) {
			best = id;
			bestDistance = distance;
		}
	}
	return best;
}

/**
 * Moves each annotation by as much as its piece moved between two
 * placements. Annotations on pieces that are gone are dropped.
 */
export function remapAnnotations(
	annotations: readonly Annotation[],
	before: StitchPlacement,
	after: StitchPlacement,
	measure: TextMeasurer,
): Annotation[] {
	const result: Annotation[] = [];
	for (const annotation of annotations) {
		const id = pieceForAnnotation(annotation, before, measure);
		const from = id ? before.rects[id] : undefined;
		const to = id ? after.rects[id] : undefined;
		if (!from) {
			result.push(annotation);
			continue;
		}
		if (!to) continue;
		const dx = to.x - from.x;
		const dy = to.y - from.y;
		result.push(dx === 0 && dy === 0 ? annotation : translateAnnotation(annotation, dx, dy));
	}
	return result;
}

export function normalizeStitchSettings(value: unknown): StitchSettings {
	const input = value && typeof value === "object" ? (value as Partial<Record<keyof StitchSettings, unknown>>) : {};
	const gap = Number(input.gap);
	return {
		arrangement: STITCH_ARRANGEMENTS.includes(input.arrangement as StitchArrangement)
			? (input.arrangement as StitchArrangement)
			: DEFAULT_STITCH_SETTINGS.arrangement,
		gap: Number.isFinite(gap)
			? Math.min(STITCH_GAP_RANGE.max, Math.max(STITCH_GAP_RANGE.min, Math.round(gap)))
			: DEFAULT_STITCH_SETTINGS.gap,
		align: STITCH_ALIGNMENTS.includes(input.align as StitchAlign)
			? (input.align as StitchAlign)
			: DEFAULT_STITCH_SETTINGS.align,
	};
}
