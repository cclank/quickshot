export type CanvasBackingSize = {
	width: number;
	height: number;
};

export function calculateCanvasBackingSize(
	cssWidth: number,
	cssHeight: number,
	devicePixelRatio: number,
	maxDimension: number,
	maxPixels: number,
): CanvasBackingSize | null {
	if (
		cssWidth <= 0 ||
		cssHeight <= 0 ||
		devicePixelRatio <= 0 ||
		maxDimension <= 0 ||
		maxPixels <= 0
	) {
		return null;
	}

	const pixelRatio = Math.max(1, devicePixelRatio);
	const desiredWidth = Math.max(1, Math.round(cssWidth * pixelRatio));
	const desiredHeight = Math.max(1, Math.round(cssHeight * pixelRatio));
	const limitScale = Math.min(
		1,
		maxDimension / desiredWidth,
		maxDimension / desiredHeight,
		Math.sqrt(maxPixels / (desiredWidth * desiredHeight)),
	);

	return {
		width: Math.max(1, Math.floor(desiredWidth * limitScale)),
		height: Math.max(1, Math.floor(desiredHeight * limitScale)),
	};
}
