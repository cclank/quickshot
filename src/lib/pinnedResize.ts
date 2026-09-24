export function resolvePinnedResizeScale(
	widthScale: number,
	heightScale: number,
): number {
	const safeWidthScale = Number.isFinite(widthScale) ? widthScale : 1;
	const safeHeightScale = Number.isFinite(heightScale) ? heightScale : 1;
	const widthChange = safeWidthScale - 1;
	const heightChange = safeHeightScale - 1;
	const oppositeDirections = widthChange * heightChange < 0;
	const totalChange = Math.abs(widthChange) + Math.abs(heightChange);
	const projectedChange =
		totalChange > 0
			? (widthChange * Math.abs(widthChange) +
					heightChange * Math.abs(heightChange)) /
				totalChange
			: 0;
	const resolvedScale = oppositeDirections
		? 1 + projectedChange
		: Math.abs(widthChange) >= Math.abs(heightChange)
			? safeWidthScale
			: safeHeightScale;
	return Math.max(0.01, resolvedScale);
}
