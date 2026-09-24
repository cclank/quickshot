export const MAX_PINNED_SCREENSHOTS = 3;
export const PINNED_OPACITY_MIN = 0.35;
export const PINNED_OPACITY_MAX = 1;
export const PINNED_RASTER_MAX_EDGE = 3_072;
export const PINNED_RASTER_MAX_PIXELS = 8_000_000;
export const PINNED_WINDOW_MIN_ASPECT_RATIO = 0.5;
export const PINNED_WINDOW_MAX_ASPECT_RATIO = 4;

export type PinnedSize = {
	width: number;
	height: number;
};

type PinnedSizeBounds = {
	maxWidth: number;
	maxHeight: number;
};

type PinnedResizeBounds = PinnedSizeBounds & {
	minWidth: number;
	minHeight: number;
};

function requirePositiveDimension(value: number, label: string): number {
	if (!Number.isFinite(value) || value <= 0) {
		throw new RangeError(`${label} must be a positive number`);
	}
	return value;
}

export function canCreatePinnedScreenshot(activeCount: number): boolean {
	return (
		Number.isSafeInteger(activeCount) &&
		activeCount >= 0 &&
		activeCount < MAX_PINNED_SCREENSHOTS
	);
}

export function findAvailablePinnedPlacementSlot(
	occupiedSlots: Iterable<number>,
): number | null {
	const occupied = new Set(occupiedSlots);
	for (let slot = 0; slot < MAX_PINNED_SCREENSHOTS; slot += 1) {
		if (!occupied.has(slot)) return slot;
	}
	return null;
}

export function clampPinnedOpacity(value: number): number {
	if (!Number.isFinite(value)) return PINNED_OPACITY_MAX;
	return Math.min(
		PINNED_OPACITY_MAX,
		Math.max(PINNED_OPACITY_MIN, value),
	);
}

export function clampPinnedWindowAspectRatio(value: number): number {
	if (!Number.isFinite(value) || value <= 0) {
		return 1;
	}
	return Math.min(
		PINNED_WINDOW_MAX_ASPECT_RATIO,
		Math.max(PINNED_WINDOW_MIN_ASPECT_RATIO, value),
	);
}

export function fitPinnedRasterSize(
	width: number,
	height: number,
): PinnedSize {
	const safeWidth = requirePositiveDimension(width, "width");
	const safeHeight = requirePositiveDimension(height, "height");
	const edgeScale =
		PINNED_RASTER_MAX_EDGE / Math.max(safeWidth, safeHeight);
	const pixelScale = Math.sqrt(
		PINNED_RASTER_MAX_PIXELS / (safeWidth * safeHeight),
	);
	const scale = Math.min(1, edgeScale, pixelScale);

	return {
		width: Math.max(1, Math.floor(safeWidth * scale)),
		height: Math.max(1, Math.floor(safeHeight * scale)),
	};
}

export function fitPinnedWindowSize(
	sourceWidth: number,
	sourceHeight: number,
	{ maxWidth, maxHeight }: PinnedSizeBounds,
): PinnedSize {
	const safeWidth = requirePositiveDimension(sourceWidth, "sourceWidth");
	const safeHeight = requirePositiveDimension(sourceHeight, "sourceHeight");
	const safeMaxWidth = requirePositiveDimension(maxWidth, "maxWidth");
	const safeMaxHeight = requirePositiveDimension(maxHeight, "maxHeight");
	const scale = Math.min(
		1,
		safeMaxWidth / safeWidth,
		safeMaxHeight / safeHeight,
	);

	return {
		width: Math.max(1, Math.round(safeWidth * scale)),
		height: Math.max(1, Math.round(safeHeight * scale)),
	};
}

export function resizePinnedWindowFromWidth(
	requestedWidth: number,
	aspectRatio: number,
	{
		minWidth,
		minHeight,
		maxWidth,
		maxHeight,
	}: PinnedResizeBounds,
): PinnedSize {
	const safeAspectRatio = requirePositiveDimension(
		aspectRatio,
		"aspectRatio",
	);
	const safeMinWidth = requirePositiveDimension(minWidth, "minWidth");
	const safeMinHeight = requirePositiveDimension(minHeight, "minHeight");
	const safeMaxWidth = requirePositiveDimension(maxWidth, "maxWidth");
	const safeMaxHeight = requirePositiveDimension(maxHeight, "maxHeight");
	if (safeMinWidth > safeMaxWidth || safeMinHeight > safeMaxHeight) {
		throw new RangeError("minimum pinned size must fit within maximum bounds");
	}

	const largestAllowedWidth = Math.min(
		safeMaxWidth,
		safeMaxHeight * safeAspectRatio,
	);
	const smallestPreferredWidth = Math.max(
		safeMinWidth,
		safeMinHeight * safeAspectRatio,
	);
	const minimumAllowedWidth = Math.min(
		largestAllowedWidth,
		smallestPreferredWidth,
	);
	const finiteRequestedWidth = Number.isFinite(requestedWidth)
		? requestedWidth
		: minimumAllowedWidth;
	const width = Math.min(
		largestAllowedWidth,
		Math.max(minimumAllowedWidth, finiteRequestedWidth),
	);

	return {
		width: Math.max(1, Math.round(width)),
		height: Math.max(1, Math.round(width / safeAspectRatio)),
	};
}
