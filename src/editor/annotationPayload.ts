import type {
	Annotation,
	RedactMode,
	ShapeFill,
	TextStyle,
} from "./types";

/**
 * The capture overlay sends the marks it drew so the editor can keep editing
 * them. Renderer input is untrusted, so every field is checked here and every
 * number clamped to a sane range before the marks reach the editor.
 */

const MAX_ANNOTATIONS = 200;
const MAX_POINTS = 4_000;
const COORD_LIMIT = 200_000;
const SIZE_LIMIT = 10_000;
const TEXT_LIMIT = 4_000;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const TOOL_KINDS = new Set([
	"rect",
	"ellipse",
	"arrow",
	"line",
	"pen",
	"highlighter",
	"text",
	"counter",
	"redact",
]);

function bounded(value: unknown, limit: number): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) return null;
	return Math.max(-limit, Math.min(limit, value));
}

function parsePoint(value: unknown): { x: number; y: number } | null {
	if (!value || typeof value !== "object") return null;
	const { x, y } = value as { x?: unknown; y?: unknown };
	const bx = bounded(x, COORD_LIMIT);
	const by = bounded(y, COORD_LIMIT);
	return bx === null || by === null ? null : { x: bx, y: by };
}

function parseColor(value: unknown): string | null {
	return typeof value === "string" && COLOR_PATTERN.test(value) ? value.toUpperCase() : null;
}

function parseEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
	return typeof value === "string" && (allowed as readonly string[]).includes(value)
		? (value as T)
		: null;
}

const FILLS: readonly ShapeFill[] = ["none", "soft", "solid"];
const TEXT_STYLES: readonly TextStyle[] = ["plain", "pill", "outline"];
const REDACT_MODES: readonly RedactMode[] = ["pixelate", "blur"];

function parseAnnotation(value: unknown): Annotation | null {
	if (!value || typeof value !== "object") return null;
	const record = value as Record<string, unknown>;
	const id =
		typeof record.id === "string" && ID_PATTERN.test(record.id) ? record.id : null;
	if (!id) return null;
	const kind = parseEnum(record.kind, [...TOOL_KINDS]);
	if (!kind) return null;

	switch (kind) {
		case "rect":
		case "ellipse": {
			const stroke = parseColor(record.color);
			const width = bounded(record.width, SIZE_LIMIT);
			const x = bounded(record.x, COORD_LIMIT);
			const y = bounded(record.y, COORD_LIMIT);
			const w = bounded(record.w, COORD_LIMIT);
			const h = bounded(record.h, COORD_LIMIT);
			const fill = parseEnum(record.fill, FILLS);
			if (!stroke || width === null || x === null || y === null || w === null || h === null || !fill) return null;
			return { id, kind, x, y, w, h, color: stroke, width, fill };
		}
		case "arrow":
		case "line": {
			const stroke = parseColor(record.color);
			const width = bounded(record.width, SIZE_LIMIT);
			const from = parsePoint(record.from);
			const to = parsePoint(record.to);
			if (!stroke || width === null || !from || !to) return null;
			return { id, kind, from, to, color: stroke, width };
		}
		case "pen":
		case "highlighter": {
			const stroke = parseColor(record.color);
			const width = bounded(record.width, SIZE_LIMIT);
			if (!stroke || width === null || !Array.isArray(record.points)) return null;
			const points: { x: number; y: number }[] = [];
			for (const item of record.points.slice(0, MAX_POINTS)) {
				const parsed = parsePoint(item);
				if (!parsed) return null;
				points.push(parsed);
			}
			if (points.length === 0) return null;
			return { id, kind, points, color: stroke, width };
		}
		case "text": {
			const stroke = parseColor(record.color);
			const size = bounded(record.size, SIZE_LIMIT);
			const x = bounded(record.x, COORD_LIMIT);
			const y = bounded(record.y, COORD_LIMIT);
			const style = parseEnum(record.style, TEXT_STYLES);
			const text =
				typeof record.text === "string" ? record.text.slice(0, TEXT_LIMIT) : null;
			if (!stroke || size === null || x === null || y === null || !style || text === null) return null;
			return { id, kind: "text", x, y, text, color: stroke, size, style };
		}
		case "counter": {
			const stroke = parseColor(record.color);
			const size = bounded(record.size, SIZE_LIMIT);
			const x = bounded(record.x, COORD_LIMIT);
			const y = bounded(record.y, COORD_LIMIT);
			const value = bounded(record.value, 10_000);
			if (!stroke || size === null || x === null || y === null || value === null) return null;
			return { id, kind: "counter", x, y, value: Math.max(1, Math.round(value)), color: stroke, size };
		}
		case "redact": {
			const x = bounded(record.x, COORD_LIMIT);
			const y = bounded(record.y, COORD_LIMIT);
			const w = bounded(record.w, COORD_LIMIT);
			const h = bounded(record.h, COORD_LIMIT);
			const mode = parseEnum(record.mode, REDACT_MODES);
			const strength = bounded(record.strength, SIZE_LIMIT);
			if (x === null || y === null || w === null || h === null || !mode || strength === null) return null;
			return { id, kind: "redact", x, y, w, h, mode, strength };
		}
		default:
			return null;
	}
}

/** The valid marks from an untrusted payload, or an empty list. */
export function sanitizeAnnotations(value: unknown): Annotation[] {
	if (!Array.isArray(value)) return [];
	const parsed: Annotation[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		if (parsed.length >= MAX_ANNOTATIONS) break;
		const annotation = parseAnnotation(item);
		if (!annotation || seen.has(annotation.id)) continue;
		seen.add(annotation.id);
		parsed.push(annotation);
	}
	return parsed;
}