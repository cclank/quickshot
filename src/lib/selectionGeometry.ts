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

/** The front-most window under the point; `windows` is ordered front to back. */
export function findWindowAt<T extends { x: number; y: number; width: number; height: number }>(
	windows: readonly T[],
	point: SelectionPoint,
): T | null {
	for (const window of windows) {
		if (
			point.x >= window.x &&
			point.x < window.x + window.width &&
			point.y >= window.y &&
			point.y < window.y + window.height
		) {
			return window;
		}
	}
	return null;
}

/** Where a pointer can grab a selection: an edge, a corner, or inside to move it. */
export type SelectionHandle = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se" | "move";

/** The part of `rect` at `point`, within `hit` points of an edge, or null outside it. */
export function selectionHandleAt(
	rect: SelectionRect,
	point: SelectionPoint,
	hit = 8,
): SelectionHandle | null {
	const right = rect.x + rect.width;
	const bottom = rect.y + rect.height;
	if (point.x < rect.x - hit || point.x > right + hit || point.y < rect.y - hit || point.y > bottom + hit) {
		return null;
	}
	const vertical = Math.abs(point.y - rect.y) <= hit ? "n" : Math.abs(point.y - bottom) <= hit ? "s" : "";
	const horizontal = Math.abs(point.x - rect.x) <= hit ? "w" : Math.abs(point.x - right) <= hit ? "e" : "";
	if (vertical || horizontal) return `${vertical}${horizontal}` as SelectionHandle;
	return point.x > rect.x && point.x < right && point.y > rect.y && point.y < bottom ? "move" : null;
}

/**
 * `origin` after grabbing `handle` at `start` and dragging to `point`: moved
 * whole and kept on screen, or resized by the grabbed edges, flipping over
 * when an edge is dragged past the opposite one.
 */
export function adjustSelection(
	origin: SelectionRect,
	handle: SelectionHandle,
	start: SelectionPoint,
	point: SelectionPoint,
	size: SelectionSize,
): SelectionRect {
	const dx = point.x - start.x;
	const dy = point.y - start.y;
	if (handle === "move") {
		return {
			...origin,
			x: Math.min(Math.max(0, Math.round(origin.x + dx)), Math.max(0, size.width - origin.width)),
			y: Math.min(Math.max(0, Math.round(origin.y + dy)), Math.max(0, size.height - origin.height)),
		};
	}
	const left = origin.x + (handle.includes("w") ? dx : 0);
	const right = origin.x + origin.width + (handle.includes("e") ? dx : 0);
	const top = origin.y + (handle.includes("n") ? dy : 0);
	const bottom = origin.y + origin.height + (handle.includes("s") ? dy : 0);
	return getClampedSelectionRect({ x: left, y: top }, { x: right, y: bottom }, size);
}

/** The cursor for a part of a selection. */
export function selectionCursor(handle: SelectionHandle) {
	if (handle === "move") return "move";
	if (handle === "n" || handle === "s") return "ns-resize";
	if (handle === "e" || handle === "w") return "ew-resize";
	return handle === "nw" || handle === "se" ? "nwse-resize" : "nesw-resize";
}
