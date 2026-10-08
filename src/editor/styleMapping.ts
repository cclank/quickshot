import {
	COUNTER_SIZES,
	HIGHLIGHTER_SIZES,
	REDACT_STRENGTHS,
	STROKE_SIZES,
	type SizeIndex,
	TEXT_SIZES,
	type TextSizeIndex,
	type ToolStyle,
} from "./presets";
import type { Annotation } from "./types";

function nearestIndex(values: readonly number[], target: number) {
	let best = 0;
	for (let index = 1; index < values.length; index += 1) {
		if (Math.abs(values[index] - target) < Math.abs(values[best] - target)) best = index;
	}
	return best;
}

/** Reads the toolbar state that corresponds to an existing annotation. */
export function styleFromAnnotation(
	annotation: Annotation,
	fallback: ToolStyle,
	unit: number,
): ToolStyle {
	const style: ToolStyle = { ...fallback };
	if ("color" in annotation) style.color = annotation.color;
	switch (annotation.kind) {
		case "rect":
		case "ellipse":
			style.fill = annotation.fill;
			style.strokeSize = nearestIndex(STROKE_SIZES, annotation.width / unit) as SizeIndex;
			break;
		case "arrow":
		case "line":
		case "pen":
			style.strokeSize = nearestIndex(STROKE_SIZES, annotation.width / unit) as SizeIndex;
			break;
		case "highlighter":
			style.strokeSize = nearestIndex(HIGHLIGHTER_SIZES, annotation.width / unit) as SizeIndex;
			break;
		case "counter":
			style.strokeSize = nearestIndex(COUNTER_SIZES, annotation.size / unit) as SizeIndex;
			break;
		case "text":
			style.textSize = nearestIndex(TEXT_SIZES, annotation.size / unit) as TextSizeIndex;
			style.textStyle = annotation.style;
			break;
		case "redact":
			style.redactMode = annotation.mode;
			style.strokeSize = nearestIndex(
				REDACT_STRENGTHS[annotation.mode],
				annotation.strength / unit,
			) as SizeIndex;
			break;
	}
	return style;
}

/** Applies a toolbar change to an annotation, ignoring properties it does not have. */
export function applyStyleToAnnotation(
	annotation: Annotation,
	patch: Partial<ToolStyle>,
	current: ToolStyle,
	unit: number,
): Annotation {
	const next = { ...annotation } as Annotation;
	if (patch.color && "color" in next) next.color = patch.color;
	const size = patch.strokeSize;
	switch (next.kind) {
		case "rect":
		case "ellipse":
			if (patch.fill) next.fill = patch.fill;
			if (size !== undefined) next.width = STROKE_SIZES[size] * unit;
			break;
		case "arrow":
		case "line":
		case "pen":
			if (size !== undefined) next.width = STROKE_SIZES[size] * unit;
			break;
		case "highlighter":
			if (size !== undefined) next.width = HIGHLIGHTER_SIZES[size] * unit;
			break;
		case "counter":
			if (size !== undefined) next.size = COUNTER_SIZES[size] * unit;
			break;
		case "text":
			if (patch.textSize !== undefined) next.size = TEXT_SIZES[patch.textSize] * unit;
			if (patch.textStyle) next.style = patch.textStyle;
			break;
		case "redact": {
			const mode = patch.redactMode ?? next.mode;
			const strengthIndex = size ?? current.strokeSize;
			if (patch.redactMode || size !== undefined) {
				next.mode = mode;
				next.strength = REDACT_STRENGTHS[mode][strengthIndex] * unit;
			}
			break;
		}
	}
	return next;
}
