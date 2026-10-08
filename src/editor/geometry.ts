import type { Point, Rect } from "./types";

export function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

export function rectFromPoints(a: Point, b: Point): Rect {
	return {
		x: Math.min(a.x, b.x),
		y: Math.min(a.y, b.y),
		w: Math.abs(b.x - a.x),
		h: Math.abs(b.y - a.y),
	};
}

export function normalizeRect(rect: Rect): Rect {
	return {
		x: rect.w < 0 ? rect.x + rect.w : rect.x,
		y: rect.h < 0 ? rect.y + rect.h : rect.y,
		w: Math.abs(rect.w),
		h: Math.abs(rect.h),
	};
}

export function expandRect(rect: Rect, amount: number): Rect {
	return {
		x: rect.x - amount,
		y: rect.y - amount,
		w: rect.w + amount * 2,
		h: rect.h + amount * 2,
	};
}

export function rectContains(rect: Rect, point: Point, padding = 0) {
	return (
		point.x >= rect.x - padding &&
		point.x <= rect.x + rect.w + padding &&
		point.y >= rect.y - padding &&
		point.y <= rect.y + rect.h + padding
	);
}

export function boundsOfPoints(points: Point[]): Rect {
	if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
	let minX = points[0].x;
	let minY = points[0].y;
	let maxX = minX;
	let maxY = minY;
	for (const point of points) {
		if (point.x < minX) minX = point.x;
		if (point.y < minY) minY = point.y;
		if (point.x > maxX) maxX = point.x;
		if (point.y > maxY) maxY = point.y;
	}
	return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function distance(a: Point, b: Point) {
	return Math.hypot(b.x - a.x, b.y - a.y);
}

export function distanceToSegment(point: Point, a: Point, b: Point) {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const lengthSquared = dx * dx + dy * dy;
	if (lengthSquared === 0) return distance(point, a);
	const t = clamp(
		((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared,
		0,
		1,
	);
	return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

export function distanceToPolyline(point: Point, points: Point[]) {
	if (points.length === 0) return Number.POSITIVE_INFINITY;
	if (points.length === 1) return distance(point, points[0]);
	let best = Number.POSITIVE_INFINITY;
	for (let index = 1; index < points.length; index += 1) {
		best = Math.min(
			best,
			distanceToSegment(point, points[index - 1], points[index]),
		);
	}
	return best;
}

/** Signed-free distance from a point to the outline of an axis-aligned ellipse, approximated. */
export function distanceToEllipseOutline(point: Point, rect: Rect) {
	const rx = rect.w / 2;
	const ry = rect.h / 2;
	if (rx <= 0 || ry <= 0) {
		return distanceToSegment(
			point,
			{ x: rect.x, y: rect.y },
			{ x: rect.x + rect.w, y: rect.y + rect.h },
		);
	}
	const cx = rect.x + rx;
	const cy = rect.y + ry;
	const dx = point.x - cx;
	const dy = point.y - cy;
	const normalized = Math.hypot(dx / rx, dy / ry);
	if (normalized === 0) return Math.min(rx, ry);
	// Scale the radial offset back into pixels using the local radius along the ray.
	const localRadius = Math.hypot(dx, dy) / normalized;
	return Math.abs(normalized - 1) * localRadius;
}

export function isInsideEllipse(point: Point, rect: Rect) {
	const rx = rect.w / 2;
	const ry = rect.h / 2;
	if (rx <= 0 || ry <= 0) return false;
	const dx = (point.x - (rect.x + rx)) / rx;
	const dy = (point.y - (rect.y + ry)) / ry;
	return dx * dx + dy * dy <= 1;
}

export function distanceToRectOutline(point: Point, rect: Rect) {
	const corners: Point[] = [
		{ x: rect.x, y: rect.y },
		{ x: rect.x + rect.w, y: rect.y },
		{ x: rect.x + rect.w, y: rect.y + rect.h },
		{ x: rect.x, y: rect.y + rect.h },
	];
	let best = Number.POSITIVE_INFINITY;
	for (let index = 0; index < 4; index += 1) {
		best = Math.min(
			best,
			distanceToSegment(point, corners[index], corners[(index + 1) % 4]),
		);
	}
	return best;
}

/** Snaps the segment direction to the nearest multiple of `step` radians. */
export function snapAngle(from: Point, to: Point, step = Math.PI / 4): Point {
	const length = distance(from, to);
	if (length === 0) return { ...to };
	const angle = Math.round(Math.atan2(to.y - from.y, to.x - from.x) / step) * step;
	return {
		x: from.x + Math.cos(angle) * length,
		y: from.y + Math.sin(angle) * length,
	};
}

/** Forces the rectangle spanned by `anchor` and `point` to be square. */
export function constrainSquare(anchor: Point, point: Point): Point {
	const dx = point.x - anchor.x;
	const dy = point.y - anchor.y;
	const size = Math.max(Math.abs(dx), Math.abs(dy));
	return {
		x: anchor.x + (dx < 0 ? -size : size),
		y: anchor.y + (dy < 0 ? -size : size),
	};
}

/** Ramer–Douglas–Peucker simplification. Keeps the first and last points. */
export function simplifyPath(points: Point[], epsilon: number): Point[] {
	if (points.length <= 2 || epsilon <= 0) return points.slice();
	const keep = new Uint8Array(points.length);
	keep[0] = 1;
	keep[points.length - 1] = 1;
	const stack: [number, number][] = [[0, points.length - 1]];
	while (stack.length > 0) {
		const [start, end] = stack.pop()!;
		let maxDistance = 0;
		let maxIndex = -1;
		for (let index = start + 1; index < end; index += 1) {
			const d = distanceToSegment(points[index], points[start], points[end]);
			if (d > maxDistance) {
				maxDistance = d;
				maxIndex = index;
			}
		}
		if (maxIndex !== -1 && maxDistance > epsilon) {
			keep[maxIndex] = 1;
			stack.push([start, maxIndex], [maxIndex, end]);
		}
	}
	return points.filter((_, index) => keep[index] === 1);
}

export function clampPointToRect(point: Point, rect: Rect): Point {
	return {
		x: clamp(point.x, rect.x, rect.x + rect.w),
		y: clamp(point.y, rect.y, rect.y + rect.h),
	};
}
