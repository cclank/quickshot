import type { AgentEvent } from "./captureAgent";

/**
 * Pure helpers for the scrolling capture (macOS). The agent streams the
 * selected area and stitches it; the main process places a small panel and a
 * ring around the area and hands the result to the editor.
 */

export type Rect = { x: number; y: number; width: number; height: number };

/** The tallest image a scrolling capture produces, so the editor stays inside Chromium's canvas limits. */
export const SCROLL_MAX_HEIGHT = 30_000;
const SCROLL_MAX_PIXELS = 100_000_000;
/** Smallest area worth scrolling, in pixels. */
const SCROLL_MIN_SIZE = { width: 48, height: 64 };
export const SCROLL_PANEL_SIZE = { width: 260, height: 420 };
export const SCROLL_PANEL_COMPACT_SIZE = { width: 220, height: 300 };
/** How far the ring's window reaches beyond the area, in points. */
export const SCROLL_RING_OUTSET = 6;
const EDGE_MARGIN = 8;

export type ScrollStatus =
	| "waiting"
	| "capturing"
	| "behind"
	| "lost"
	| "full"
	| "finishing"
	| "error";

export type ScrollProgress = {
	status: ScrollStatus;
	/** Pixels the image would have if finished now. */
	height: number;
	width: number;
	/** Changes whenever the agent rewrote the preview image. */
	preview: number;
};

const AGENT_STATUSES = new Set<ScrollStatus>(["waiting", "capturing", "behind", "lost", "full", "error"]);

export function scrollMaxHeight(width: number) {
	return Math.max(1, Math.min(SCROLL_MAX_HEIGHT, Math.floor(SCROLL_MAX_PIXELS / Math.max(1, width))));
}

/**
 * Turns the overlay's selection (frozen-frame pixels) into what the agent
 * needs: the area in points relative to the display, the same area in global
 * points, and the size of each frame in pixels. Null for anything malformed
 * or too small to scroll.
 */
export function scrollRegionFromSelection(
	rect: unknown,
	frame: { width: number; height: number },
	displayBounds: Rect,
): { points: Rect; global: Rect; pixels: { width: number; height: number } } | null {
	if (!rect || typeof rect !== "object") return null;
	const { x, y, width, height } = rect as Record<string, unknown>;
	if (
		![x, y, width, height].every((value) => Number.isInteger(value)) ||
		frame.width <= 0 ||
		frame.height <= 0 ||
		displayBounds.width <= 0 ||
		displayBounds.height <= 0
	) {
		return null;
	}
	const pixels = { x: x as number, y: y as number, width: width as number, height: height as number };
	if (
		pixels.x < 0 ||
		pixels.y < 0 ||
		pixels.width < SCROLL_MIN_SIZE.width ||
		pixels.height < SCROLL_MIN_SIZE.height ||
		pixels.x + pixels.width > frame.width ||
		pixels.y + pixels.height > frame.height
	) {
		return null;
	}
	const scaleX = frame.width / displayBounds.width;
	const scaleY = frame.height / displayBounds.height;
	const points = {
		x: pixels.x / scaleX,
		y: pixels.y / scaleY,
		width: pixels.width / scaleX,
		height: pixels.height / scaleY,
	};
	return {
		points,
		global: { ...points, x: displayBounds.x + points.x, y: displayBounds.y + points.y },
		pixels: { width: pixels.width, height: pixels.height },
	};
}

function clamp(value: number, low: number, high: number) {
	return Math.min(Math.max(value, low), Math.max(low, high));
}

/**
 * Where the panel goes: beside the area when there is room, else below or
 * above it. When all sides are occupied, use the screen edge with the least
 * overlap instead of placing the whole panel inside the selection.
 */
export function placeScrollPanel(
	area: Rect,
	workArea: Rect,
	size: { width: number; height: number } = SCROLL_PANEL_SIZE,
	gap = 14,
): { x: number; y: number } {
	const left = workArea.x + EDGE_MARGIN;
	const top = workArea.y + EDGE_MARGIN;
	const right = workArea.x + workArea.width - EDGE_MARGIN;
	const bottom = workArea.y + workArea.height - EDGE_MARGIN;
	const besideY = clamp(area.y, top, bottom - size.height);
	const alignedX = clamp(area.x + area.width - size.width, left, right - size.width);
	let position: { x: number; y: number };
	if (area.x + area.width + gap + size.width <= right) {
		position = { x: area.x + area.width + gap, y: besideY };
	} else if (area.x - gap - size.width >= left) {
		position = { x: area.x - gap - size.width, y: besideY };
	} else if (area.y + area.height + gap + size.height <= bottom) {
		position = { x: alignedX, y: area.y + area.height + gap };
	} else if (area.y - gap - size.height >= top) {
		position = { x: alignedX, y: area.y - gap - size.height };
	} else {
		const candidates = [
			{ x: right - size.width, y: bottom - size.height },
			{ x: right - size.width, y: top },
			{ x: left, y: bottom - size.height },
			{ x: left, y: top },
		];
		position = candidates.reduce((best, candidate) =>
			panelOverlap(candidate, size, area) < panelOverlap(best, size, area) ? candidate : best,
		);
	}
	return clampScrollPanelPosition(position, size, workArea);
}

function panelOverlap(position: { x: number; y: number }, size: { width: number; height: number }, area: Rect) {
	const overlap = intersect({ ...position, ...size }, area);
	return overlap.width * overlap.height;
}

/** Prefer a full preview outside the capture, including on an adjacent display.
 * If there is no free space, a smaller panel covers less of the selection. */
export function scrollPanelLayout(area: Rect, workAreas: readonly Rect[]): Rect {
	const areas = workAreas.length ? workAreas : [area];
	let best: Rect | null = null;
	let bestOverlap = Infinity;
	for (const preferred of [SCROLL_PANEL_SIZE, SCROLL_PANEL_COMPACT_SIZE]) {
		for (const workArea of areas) {
			const size = {
				width: Math.max(1, Math.min(preferred.width, workArea.width - EDGE_MARGIN * 2)),
				height: Math.max(1, Math.min(preferred.height, workArea.height - EDGE_MARGIN * 2)),
			};
			const position = placeScrollPanel(area, workArea, size);
			const overlap = panelOverlap(position, size, area);
			const bounds = { ...position, ...size };
			if (overlap === 0) return bounds;
			if (overlap < bestOverlap) {
				best = bounds;
				bestOverlap = overlap;
			}
		}
	}
	return best!;
}

/** Keep a dragged panel's title and buttons on the destination display. */
export function clampScrollPanelPosition(position: { x: number; y: number }, size: { width: number; height: number }, workArea: Rect) {
	return {
		x: Math.round(clamp(position.x, workArea.x + EDGE_MARGIN, workArea.x + Math.max(EDGE_MARGIN, workArea.width - size.width - EDGE_MARGIN))),
		y: Math.round(clamp(position.y, workArea.y + EDGE_MARGIN, workArea.y + Math.max(EDGE_MARGIN, workArea.height - size.height - EDGE_MARGIN))),
	};
}

function intersect(a: Rect, b: Rect): Rect {
	const x = Math.max(a.x, b.x);
	const y = Math.max(a.y, b.y);
	return {
		x,
		y,
		width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
		height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
	};
}

/**
 * The ring's window and, inside it, the box the ring is drawn on: just
 * outside the area, pulled inside wherever the area meets the display edge.
 * The ring never shows up in the capture; the agent leaves QuickShot out.
 */
export function scrollRingLayout(area: Rect, display: Rect, outset = SCROLL_RING_OUTSET) {
	const grown = { x: area.x - outset, y: area.y - outset, width: area.width + outset * 2, height: area.height + outset * 2 };
	const outer = intersect(grown, display);
	const window = {
		x: Math.floor(outer.x),
		y: Math.floor(outer.y),
		width: Math.max(1, Math.ceil(outer.x + outer.width) - Math.floor(outer.x)),
		height: Math.max(1, Math.ceil(outer.y + outer.height) - Math.floor(outer.y)),
	};
	const ringOutset = Math.max(0, outset - 2);
	const ring = intersect(
		{
			x: area.x - ringOutset,
			y: area.y - ringOutset,
			width: area.width + ringOutset * 2,
			height: area.height + ringOutset * 2,
		},
		window,
	);
	return {
		window,
		ring: {
			x: Math.round(ring.x - window.x),
			y: Math.round(ring.y - window.y),
			width: Math.round(ring.width),
			height: Math.round(ring.height),
		},
	};
}

/** Reads an agent {"event":"scroll"} line; null for anything else. */
export function parseScrollProgress(event: AgentEvent): ScrollProgress | null {
	if (event.event !== "scroll") return null;
	const { status, height, width, preview } = event;
	if (typeof status !== "string" || !AGENT_STATUSES.has(status as ScrollStatus)) return null;
	if (![height, width, preview].every((value) => Number.isInteger(value) && (value as number) >= 0)) return null;
	return {
		status: status as ScrollStatus,
		height: height as number,
		width: width as number,
		preview: preview as number,
	};
}
