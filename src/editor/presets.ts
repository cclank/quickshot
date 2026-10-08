import type { RedactMode, ShapeFill, TextStyle, Tool } from "./types";

export const ANNOTATION_COLORS = [
	"#FF3B30",
	"#FF9500",
	"#FFCC00",
	"#34C759",
	"#0A84FF",
	"#AF52DE",
	"#FFFFFF",
	"#1C1C1E",
] as const;

/** Sizes are in points; they are multiplied by the capture's pixel ratio. */
export const STROKE_SIZES = [2, 4, 7] as const;
export const HIGHLIGHTER_SIZES = [10, 16, 24] as const;
export const COUNTER_SIZES = [10, 13, 17] as const;
export const TEXT_SIZES = [14, 20, 28, 40] as const;
export const REDACT_STRENGTHS: Record<RedactMode, readonly number[]> = {
	pixelate: [6, 10, 16],
	blur: [5, 10, 18],
};

export type SizeIndex = 0 | 1 | 2;
export type TextSizeIndex = 0 | 1 | 2 | 3;

export type ToolStyle = {
	color: string;
	strokeSize: SizeIndex;
	fill: ShapeFill;
	textSize: TextSizeIndex;
	textStyle: TextStyle;
	redactMode: RedactMode;
};

export const DEFAULT_TOOL_STYLE: ToolStyle = {
	color: ANNOTATION_COLORS[0],
	strokeSize: 1,
	fill: "none",
	textSize: 1,
	textStyle: "plain",
	redactMode: "pixelate",
};

export const TOOL_ORDER: Tool[] = [
	"select",
	"rect",
	"ellipse",
	"arrow",
	"line",
	"pen",
	"highlighter",
	"text",
	"counter",
	"redact",
];

export const TOOL_SHORTCUTS: Record<Tool, string> = {
	select: "V",
	rect: "R",
	ellipse: "O",
	arrow: "A",
	line: "L",
	pen: "P",
	highlighter: "H",
	text: "T",
	counter: "N",
	redact: "M",
};

export function normalizeToolStyle(value: unknown): ToolStyle {
	const input =
		value && typeof value === "object"
			? (value as Partial<Record<keyof ToolStyle, unknown>>)
			: {};
	const pick = <T>(candidate: unknown, allowed: readonly T[], fallback: T) =>
		allowed.includes(candidate as T) ? (candidate as T) : fallback;
	return {
		color:
			typeof input.color === "string" && /^#[0-9a-f]{6}$/i.test(input.color)
				? input.color
				: DEFAULT_TOOL_STYLE.color,
		strokeSize: pick(input.strokeSize, [0, 1, 2] as const, DEFAULT_TOOL_STYLE.strokeSize),
		fill: pick(input.fill, ["none", "soft", "solid"] as const, DEFAULT_TOOL_STYLE.fill),
		textSize: pick(input.textSize, [0, 1, 2, 3] as const, DEFAULT_TOOL_STYLE.textSize),
		textStyle: pick(
			input.textStyle,
			["plain", "pill", "outline"] as const,
			DEFAULT_TOOL_STYLE.textStyle,
		),
		redactMode: pick(
			input.redactMode,
			["pixelate", "blur"] as const,
			DEFAULT_TOOL_STYLE.redactMode,
		),
	};
}
