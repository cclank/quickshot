import { createAnnotationId } from "./annotations";
import {
	constrainSquare,
	distance,
	rectFromPoints,
	snapAngle,
	simplifyPath,
} from "./geometry";
import {
	COUNTER_SIZES,
	HIGHLIGHTER_SIZES,
	REDACT_STRENGTHS,
	STROKE_SIZES,
	TEXT_SIZES,
	type ToolStyle,
} from "./presets";
import type { Annotation, Point, TextAnnotation, TextBox, Tool } from "./types";

/**
 * The drawing helpers shared by the editor stage and the capture overlay.
 * A draft annotation is written in image pixels, so both surfaces agree on
 * the same geometry regardless of the zoom they render at.
 */

/**
 * Drawing tools can pick up existing annotations of their own kind, so boxes
 * stay adjustable with the rectangle tool while an arrow can still start on a
 * box's edge.
 */
export const GRAB_TOOLS = new Set<Tool>([
	"rect",
	"ellipse",
	"arrow",
	"line",
	"text",
	"counter",
]);

/** Whether the current tool may drag the selected annotation's handles. */
export function handlesActive(tool: Tool, selected: Annotation | null): selected is Annotation {
	if (!selected) return false;
	if (tool === "select") return true;
	return tool === selected.kind && selected.kind !== "pen" && selected.kind !== "highlighter";
}

export function grabbableAnnotations(
	annotations: Annotation[],
	tool: Tool,
	selectedId: string | null,
) {
	if (tool === "select") return annotations;
	if (!GRAB_TOOLS.has(tool)) return [];
	return annotations.filter((item) => item.kind === tool || item.id === selectedId);
}

export function toolCursor(tool: Tool) {
	if (tool === "select") return "default";
	if (tool === "text") return "text";
	return "crosshair";
}

/** The counter badge a fresh annotation of this kind starts from. */
export function createDraft(
	tool: Tool,
	point: Point,
	style: ToolStyle,
	unit: number,
): Annotation | null {
	const id = createAnnotationId();
	const width = STROKE_SIZES[style.strokeSize] * unit;
	switch (tool) {
		case "rect":
		case "ellipse":
			return {
				id,
				kind: tool,
				x: point.x,
				y: point.y,
				w: 0,
				h: 0,
				color: style.color,
				width,
				fill: style.fill,
			};
		case "redact":
			return {
				id,
				kind: "redact",
				x: point.x,
				y: point.y,
				w: 0,
				h: 0,
				mode: style.redactMode,
				strength: REDACT_STRENGTHS[style.redactMode][style.strokeSize] * unit,
			};
		case "arrow":
		case "line":
			return { id, kind: tool, from: point, to: point, color: style.color, width };
		case "pen":
			return { id, kind: "pen", points: [point], color: style.color, width };
		case "highlighter":
			return {
				id,
				kind: "highlighter",
				points: [point],
				color: style.color,
				width: HIGHLIGHTER_SIZES[style.strokeSize] * unit,
			};
		default:
			return null;
	}
}

/** A centred text box whose caret sits where the click landed. */
export function createTextDraft(point: Point, style: ToolStyle, unit: number): TextAnnotation {
	return {
		id: createAnnotationId(),
		kind: "text",
		x: point.x,
		y: point.y,
		text: "",
		color: style.color,
		size: TEXT_SIZES[style.textSize] * unit,
		style: style.textStyle,
	};
}

/** Moves a text draft so the caret sits at `point`, using its measured box. */
export function positionTextDraft(draft: TextAnnotation, point: Point, box: TextBox): TextAnnotation {
	return {
		...draft,
		x: point.x - box.padX,
		y: point.y - box.lineHeight / 2 - box.padY,
	};
}

export function createCounterDraft(
	point: Point,
	value: number,
	style: ToolStyle,
	unit: number,
): Annotation {
	return {
		id: createAnnotationId(),
		kind: "counter",
		x: point.x,
		y: point.y,
		value,
		color: style.color,
		size: COUNTER_SIZES[style.strokeSize] * unit,
	};
}

export function updateDraft(
	draft: Annotation,
	anchor: Point,
	point: Point,
	constrain: boolean,
	minStep: number,
	samples: Point[],
): Annotation {
	switch (draft.kind) {
		case "rect":
		case "ellipse":
		case "redact": {
			const target = constrain ? constrainSquare(anchor, point) : point;
			return { ...draft, ...rectFromPoints(anchor, target) };
		}
		case "arrow":
		case "line":
			return { ...draft, to: constrain ? snapAngle(anchor, point) : point };
		case "pen":
		case "highlighter": {
			if (constrain) {
				return { ...draft, points: [anchor, snapAngle(anchor, point)] };
			}
			const points = draft.points;
			for (const sample of samples) {
				if (distance(points[points.length - 1], sample) >= minStep) points.push(sample);
			}
			return { ...draft, points };
		}
		default:
			return draft;
	}
}

export function finalizeDraft(draft: Annotation, unit: number): Annotation {
	if (draft.kind === "pen" || draft.kind === "highlighter") {
		return { ...draft, points: simplifyPath(draft.points, 0.35 * unit) };
	}
	return draft;
}

export function replaceAnnotation(list: readonly Annotation[], next: Annotation) {
	return list.map((item) => (item.id === next.id ? next : item));
}