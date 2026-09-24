export type SelectionPoint = { x: number; y: number };
export type SelectionSize = { width: number; height: number };
export type SelectionRect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export function clampCoordinate(value: number, maximum: number) {
	if (!Number.isFinite(value) || maximum <= 0) return 0;
	return Math.min(maximum, Math.max(0, Math.round(value)));
}

export function clampSelectionPoint(
	point: SelectionPoint,
	size: SelectionSize,
): SelectionPoint {
	return {
		x: clampCoordinate(point.x, size.width),
		y: clampCoordinate(point.y, size.height),
	};
}

export function getClampedSelectionRect(
	start: SelectionPoint,
	current: SelectionPoint,
	size: SelectionSize,
): SelectionRect {
	const safeStart = clampSelectionPoint(start, size);
	const safeCurrent = clampSelectionPoint(current, size);
	const x = Math.min(safeStart.x, safeCurrent.x);
	const y = Math.min(safeStart.y, safeCurrent.y);
	return {
		x,
		y,
		width: Math.max(
			0,
			Math.min(size.width - x, Math.abs(safeCurrent.x - safeStart.x)),
		),
		height: Math.max(
			0,
			Math.min(size.height - y, Math.abs(safeCurrent.y - safeStart.y)),
		),
	};
}
