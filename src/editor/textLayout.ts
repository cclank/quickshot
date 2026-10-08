import type { TextAnnotation, TextBox, TextStyle } from "./types";

export const ANNOTATION_FONT_FAMILY =
	'-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
export const ANNOTATION_FONT_WEIGHT = 600;
export const TEXT_LINE_HEIGHT = 1.3;

export function annotationFont(size: number) {
	return `${ANNOTATION_FONT_WEIGHT} ${size}px ${ANNOTATION_FONT_FAMILY}`;
}

export function getTextPadding(style: TextStyle, size: number) {
	switch (style) {
		case "pill":
			return { padX: size * 0.55, padY: size * 0.26 };
		case "outline":
			return { padX: size * 0.22, padY: size * 0.1 };
		default:
			return { padX: size * 0.14, padY: size * 0.06 };
	}
}

export function splitTextLines(text: string) {
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	return lines.length > 0 ? lines : [""];
}

let measureContext: CanvasRenderingContext2D | null = null;
const measureCache = new Map<string, TextBox>();
const MEASURE_CACHE_LIMIT = 400;

function getMeasureContext() {
	if (!measureContext) {
		const canvas = document.createElement("canvas");
		canvas.width = 1;
		canvas.height = 1;
		measureContext = canvas.getContext("2d");
	}
	return measureContext;
}

export function measureTextAnnotation(annotation: TextAnnotation): TextBox {
	const key = `${annotation.size}|${annotation.style}|${annotation.text}`;
	const cached = measureCache.get(key);
	if (cached) return cached;

	const lines = splitTextLines(annotation.text);
	const lineHeight = annotation.size * TEXT_LINE_HEIGHT;
	const { padX, padY } = getTextPadding(annotation.style, annotation.size);
	const context = getMeasureContext();
	let maxWidth = 0;
	if (context) {
		context.font = annotationFont(annotation.size);
		for (const line of lines) {
			maxWidth = Math.max(maxWidth, context.measureText(line).width);
		}
	} else {
		maxWidth = Math.max(...lines.map((line) => line.length)) * annotation.size * 0.6;
	}
	const box: TextBox = {
		w: Math.max(annotation.size * 0.6, maxWidth) + padX * 2,
		h: lines.length * lineHeight + padY * 2,
		lines,
		lineHeight,
		padX,
		padY,
		ascent: annotation.size * 0.8,
	};
	if (measureCache.size >= MEASURE_CACHE_LIMIT) measureCache.clear();
	measureCache.set(key, box);
	return box;
}
