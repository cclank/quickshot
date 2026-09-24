export const DEFAULT_BACKGROUND_PADDING = 24;
export const MIN_BACKGROUND_PADDING = 0;
export const MAX_BACKGROUND_PADDING = 96;
export const BACKGROUND_PADDING_STEP = 4;
export const EXPORT_FRAME_INSET = 18;
export const EXPORT_TOP_BAR_HEIGHT = 38;

export type ScreenshotCompositionLayout = {
	width: number;
	height: number;
	backgroundPadding: number;
	frameInset: number;
	topBarHeight: number;
	frameX: number;
	frameY: number;
	frameWidth: number;
	frameHeight: number;
	imageX: number;
	imageY: number;
	imageWidth: number;
	imageHeight: number;
};

export function normalizeBackgroundPadding(value: number): number {
	if (!Number.isFinite(value)) return DEFAULT_BACKGROUND_PADDING;
	const clamped = Math.min(
		MAX_BACKGROUND_PADDING,
		Math.max(MIN_BACKGROUND_PADDING, value),
	);
	return Math.round(clamped / BACKGROUND_PADDING_STEP) * BACKGROUND_PADDING_STEP;
}

export function calculateScreenshotCompositionLayout(
	imageWidth: number,
	imageHeight: number,
	backgroundPadding: number,
	isBorderless: boolean,
): ScreenshotCompositionLayout {
	const safeImageWidth = Math.max(1, Math.round(imageWidth));
	const safeImageHeight = Math.max(1, Math.round(imageHeight));
	const safeBackgroundPadding = normalizeBackgroundPadding(backgroundPadding);
	const frameInset = isBorderless ? 0 : EXPORT_FRAME_INSET;
	const topBarHeight = isBorderless ? 0 : EXPORT_TOP_BAR_HEIGHT;
	const frameWidth = safeImageWidth + frameInset * 2;
	const frameHeight = safeImageHeight + topBarHeight + frameInset * 2;
	const frameX = safeBackgroundPadding;
	const frameY = safeBackgroundPadding;

	return {
		width: frameWidth + safeBackgroundPadding * 2,
		height: frameHeight + safeBackgroundPadding * 2,
		backgroundPadding: safeBackgroundPadding,
		frameInset,
		topBarHeight,
		frameX,
		frameY,
		frameWidth,
		frameHeight,
		imageX: frameX + frameInset,
		imageY: frameY + topBarHeight + frameInset,
		imageWidth: safeImageWidth,
		imageHeight: safeImageHeight,
	};
}
