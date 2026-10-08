import {
	boundsOfPoints,
	clamp,
	distance,
	distanceToEllipseOutline,
	distanceToPolyline,
	distanceToRectOutline,
	distanceToSegment,
	expandRect,
	isInsideEllipse,
	normalizeRect,
	rectContains,
	rectFromPoints,
	snapAngle,
} from "./geometry";
import type {
	Annotation,
	Handle,
	HandleId,
	Point,
	Rect,
	TextAnnotation,
	TextMeasurer,
} from "./types";

let annotationSequence = 0;

export function createAnnotationId() {
	annotationSequence += 1;
	return `a${Date.now().toString(36)}${annotationSequence.toString(36)}`;
}

export function getArrowHeadLength(width: number, length: number) {
	return Math.min(length * 0.62, width * 3.6 + 12);
}

/** Geometric bounds, without stroke thickness. */
export function getAnnotationBounds(
	annotation: Annotation,
	measure: TextMeasurer,
): Rect {
	switch (annotation.kind) {
		case "rect":
		case "ellipse":
		case "redact":
			return normalizeRect(annotation);
		case "arrow":
		case "line":
			return rectFromPoints(annotation.from, annotation.to);
		case "pen":
		case "highlighter":
			return boundsOfPoints(annotation.points);
		case "text": {
			const box = measure(annotation);
			return { x: annotation.x, y: annotation.y, w: box.w, h: box.h };
		}
		case "counter":
			return {
				x: annotation.x - annotation.size,
				y: annotation.y - annotation.size,
				w: annotation.size * 2,
				h: annotation.size * 2,
			};
	}
}

/** Bounds including stroke thickness, used for hover and selection outlines. */
export function getVisualBounds(
	annotation: Annotation,
	measure: TextMeasurer,
): Rect {
	const bounds = getAnnotationBounds(annotation, measure);
	switch (annotation.kind) {
		case "rect":
		case "ellipse":
		case "line":
		case "pen":
		case "highlighter":
			return expandRect(bounds, annotation.width / 2);
		case "arrow":
			return expandRect(
				bounds,
				getArrowHeadLength(
					annotation.width,
					distance(annotation.from, annotation.to),
				) * 0.5,
			);
		default:
			return bounds;
	}
}

function boxHandles(rect: Rect): Handle[] {
	const { x, y, w, h } = rect;
	return [
		{ id: "nw", x, y },
		{ id: "n", x: x + w / 2, y },
		{ id: "ne", x: x + w, y },
		{ id: "e", x: x + w, y: y + h / 2 },
		{ id: "se", x: x + w, y: y + h },
		{ id: "s", x: x + w / 2, y: y + h },
		{ id: "sw", x, y: y + h },
		{ id: "w", x, y: y + h / 2 },
	];
}

export function getHandles(
	annotation: Annotation,
	measure: TextMeasurer,
): Handle[] {
	switch (annotation.kind) {
		case "rect":
		case "ellipse":
		case "redact":
			return boxHandles(normalizeRect(annotation));
		case "arrow":
		case "line":
			return [
				{ id: "start", x: annotation.from.x, y: annotation.from.y },
				{ id: "end", x: annotation.to.x, y: annotation.to.y },
			];
		case "pen":
		case "highlighter": {
			const bounds = boundsOfPoints(annotation.points);
			if (bounds.w < 1 && bounds.h < 1) return [];
			return boxHandles(bounds);
		}
		case "text": {
			const bounds = getAnnotationBounds(annotation, measure);
			return boxHandles(bounds).filter((handle) =>
				["nw", "ne", "se", "sw"].includes(handle.id),
			);
		}
		case "counter":
			return [];
	}
}

/**
 * "stroke" and "body" are strong hits. "inside" is a weak hit on the empty
 * interior of an outline-only shape; it only wins when nothing else is hit.
 */
export type HitPart = "stroke" | "body" | "inside";

export function hitTestAnnotation(
	annotation: Annotation,
	point: Point,
	tolerance: number,
	measure: TextMeasurer,
): HitPart | null {
	switch (annotation.kind) {
		case "rect": {
			const rect = normalizeRect(annotation);
			if (
				distanceToRectOutline(point, rect) <=
				tolerance + annotation.width / 2
			) {
				return "stroke";
			}
			if (!rectContains(rect, point)) return null;
			return annotation.fill === "none" ? "inside" : "body";
		}
		case "ellipse": {
			const rect = normalizeRect(annotation);
			if (
				distanceToEllipseOutline(point, rect) <=
				tolerance + annotation.width / 2
			) {
				return "stroke";
			}
			if (!isInsideEllipse(point, rect)) return null;
			return annotation.fill === "none" ? "inside" : "body";
		}
		case "redact":
			return rectContains(normalizeRect(annotation), point, tolerance)
				? "body"
				: null;
		case "arrow": {
			const reach = tolerance + annotation.width / 2;
			if (distanceToSegment(point, annotation.from, annotation.to) <= reach) {
				return "stroke";
			}
			const headLength = getArrowHeadLength(
				annotation.width,
				distance(annotation.from, annotation.to),
			);
			return distance(point, annotation.to) <= headLength * 0.6 + tolerance
				? "stroke"
				: null;
		}
		case "line":
			return distanceToSegment(point, annotation.from, annotation.to) <=
				tolerance + annotation.width / 2
				? "stroke"
				: null;
		case "pen":
		case "highlighter":
			return distanceToPolyline(point, annotation.points) <=
				tolerance + annotation.width / 2
				? "stroke"
				: null;
		case "text":
			return rectContains(
				getAnnotationBounds(annotation, measure),
				point,
				tolerance,
			)
				? "body"
				: null;
		case "counter":
			return distance(point, annotation) <= annotation.size + tolerance
				? "body"
				: null;
	}
}

export type AnnotationHit = {
	annotation: Annotation;
	part: HitPart;
};

export function findAnnotationAt(
	annotations: readonly Annotation[],
	point: Point,
	tolerance: number,
	measure: TextMeasurer,
	options: { includeInside?: boolean } = {},
): AnnotationHit | null {
	let weakHit: AnnotationHit | null = null;
	let weakArea = Number.POSITIVE_INFINITY;
	for (let index = annotations.length - 1; index >= 0; index -= 1) {
		const annotation = annotations[index];
		const part = hitTestAnnotation(annotation, point, tolerance, measure);
		if (!part) continue;
		if (part !== "inside") return { annotation, part };
		if (!options.includeInside) continue;
		// Prefer the smallest enclosing outline so nested shapes stay reachable.
		const bounds = getAnnotationBounds(annotation, measure);
		const area = bounds.w * bounds.h;
		if (area < weakArea) {
			weakArea = area;
			weakHit = { annotation, part };
		}
	}
	return weakHit;
}

export function hitTestHandle(
	handles: readonly Handle[],
	point: Point,
	tolerance: number,
): HandleId | null {
	let best: HandleId | null = null;
	let bestDistance = tolerance;
	for (const handle of handles) {
		const d = distance(point, handle);
		if (d <= bestDistance) {
			best = handle.id;
			bestDistance = d;
		}
	}
	return best;
}

export function translateAnnotation(
	annotation: Annotation,
	dx: number,
	dy: number,
): Annotation {
	switch (annotation.kind) {
		case "rect":
		case "ellipse":
		case "redact":
		case "text":
		case "counter":
			return { ...annotation, x: annotation.x + dx, y: annotation.y + dy };
		case "arrow":
		case "line":
			return {
				...annotation,
				from: { x: annotation.from.x + dx, y: annotation.from.y + dy },
				to: { x: annotation.to.x + dx, y: annotation.to.y + dy },
			};
		case "pen":
		case "highlighter":
			return {
				...annotation,
				points: annotation.points.map((point) => ({
					x: point.x + dx,
					y: point.y + dy,
				})),
			};
	}
}

const HANDLE_EDGES: Record<
	Exclude<HandleId, "start" | "end">,
	{ left?: true; right?: true; top?: true; bottom?: true }
> = {
	nw: { left: true, top: true },
	n: { top: true },
	ne: { right: true, top: true },
	e: { right: true },
	se: { right: true, bottom: true },
	s: { bottom: true },
	sw: { left: true, bottom: true },
	w: { left: true },
};

export function resizeRect(
	rect: Rect,
	handle: Exclude<HandleId, "start" | "end">,
	point: Point,
	keepAspect: boolean,
): Rect {
	const edges = HANDLE_EDGES[handle];
	let left = rect.x;
	let top = rect.y;
	let right = rect.x + rect.w;
	let bottom = rect.y + rect.h;
	if (edges.left) left = point.x;
	if (edges.right) right = point.x;
	if (edges.top) top = point.y;
	if (edges.bottom) bottom = point.y;

	const isCorner =
		(edges.left || edges.right) && (edges.top || edges.bottom);
	if (keepAspect && isCorner && rect.w > 0 && rect.h > 0) {
		const aspect = rect.w / rect.h;
		const anchorX = edges.left ? right : left;
		const anchorY = edges.top ? bottom : top;
		let width = (edges.left ? left : right) - anchorX;
		let height = (edges.top ? top : bottom) - anchorY;
		if (Math.abs(width) / aspect > Math.abs(height)) {
			height = (Math.sign(height) || 1) * (Math.abs(width) / aspect);
		} else {
			width = (Math.sign(width) || 1) * Math.abs(height) * aspect;
		}
		if (edges.left) left = anchorX + width;
		else right = anchorX + width;
		if (edges.top) top = anchorY + height;
		else bottom = anchorY + height;
	}

	return normalizeRect({ x: left, y: top, w: right - left, h: bottom - top });
}

function mapPointBetweenRects(point: Point, from: Rect, to: Rect): Point {
	return {
		x: from.w > 0 ? to.x + ((point.x - from.x) / from.w) * to.w : point.x + (to.x - from.x),
		y: from.h > 0 ? to.y + ((point.y - from.y) / from.h) * to.h : point.y + (to.y - from.y),
	};
}

export function resizeAnnotation(
	original: Annotation,
	handle: HandleId,
	point: Point,
	options: { keepAspect: boolean; measure: TextMeasurer },
): Annotation {
	switch (original.kind) {
		case "rect":
		case "ellipse":
		case "redact": {
			if (handle === "start" || handle === "end") return original;
			const next = resizeRect(
				normalizeRect(original),
				handle,
				point,
				options.keepAspect,
			);
			return { ...original, ...next };
		}
		case "arrow":
		case "line": {
			if (handle === "start") {
				return {
					...original,
					from: options.keepAspect ? snapAngle(original.to, point) : point,
				};
			}
			if (handle === "end") {
				return {
					...original,
					to: options.keepAspect ? snapAngle(original.from, point) : point,
				};
			}
			return original;
		}
		case "pen":
		case "highlighter": {
			if (handle === "start" || handle === "end") return original;
			const bounds = boundsOfPoints(original.points);
			const next = resizeRect(bounds, handle, point, options.keepAspect);
			return {
				...original,
				points: original.points.map((p) => mapPointBetweenRects(p, bounds, next)),
			};
		}
		case "text":
			return resizeText(original, handle, point, options.measure);
		case "counter":
			return original;
	}
}

function resizeText(
	original: TextAnnotation,
	handle: HandleId,
	point: Point,
	measure: TextMeasurer,
): TextAnnotation {
	if (!["nw", "ne", "se", "sw"].includes(handle)) return original;
	const box = measure(original);
	if (box.w <= 0 || box.h <= 0) return original;
	const anchor = {
		x: handle === "nw" || handle === "sw" ? original.x + box.w : original.x,
		y: handle === "nw" || handle === "ne" ? original.y + box.h : original.y,
	};
	const scaleX = Math.abs(point.x - anchor.x) / box.w;
	const scaleY = Math.abs(point.y - anchor.y) / box.h;
	const scale = clamp(Math.max(scaleX, scaleY), 6 / original.size, 12);
	const size = Math.max(6, Math.round(original.size * scale * 10) / 10);
	const actualScale = size / original.size;
	const width = box.w * actualScale;
	const height = box.h * actualScale;
	return {
		...original,
		size,
		x: handle === "nw" || handle === "sw" ? anchor.x - width : anchor.x,
		y: handle === "nw" || handle === "ne" ? anchor.y - height : anchor.y,
	};
}

export function isMeaningfulAnnotation(annotation: Annotation): boolean {
	switch (annotation.kind) {
		case "rect":
		case "ellipse":
		case "redact":
			return Math.abs(annotation.w) >= 3 && Math.abs(annotation.h) >= 3;
		case "arrow":
		case "line":
			return distance(annotation.from, annotation.to) >= 4;
		case "pen":
		case "highlighter": {
			const bounds = boundsOfPoints(annotation.points);
			return annotation.points.length >= 2 && (bounds.w >= 2 || bounds.h >= 2);
		}
		case "text":
			return annotation.text.trim().length > 0;
		case "counter":
			return true;
	}
}

export function nextCounterValue(annotations: readonly Annotation[]) {
	let max = 0;
	for (const annotation of annotations) {
		if (annotation.kind === "counter" && annotation.value > max) {
			max = annotation.value;
		}
	}
	return max + 1;
}

export function duplicateAnnotation(
	annotation: Annotation,
	offset: number,
	annotations: readonly Annotation[],
): Annotation {
	const moved = translateAnnotation(annotation, offset, offset);
	return {
		...moved,
		id: createAnnotationId(),
		...(moved.kind === "counter" ? { value: nextCounterValue(annotations) } : {}),
	} as Annotation;
}

/** Cursor to show when hovering a handle. */
export function getHandleCursor(handle: HandleId): string {
	switch (handle) {
		case "nw":
		case "se":
			return "nwse-resize";
		case "ne":
		case "sw":
			return "nesw-resize";
		case "n":
		case "s":
			return "ns-resize";
		case "e":
		case "w":
			return "ew-resize";
		default:
			return "move";
	}
}
