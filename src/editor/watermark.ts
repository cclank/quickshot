import { type Rgb, isLightColor, rgbToHex, toneOnTone, withAlpha } from "./color";
import { clamp } from "./geometry";
import type {
	CompositionLayout,
	WatermarkFont,
	WatermarkSettings,
	WatermarkWeight,
} from "./composition";

export const AUTO_WATERMARK_COLOR = "auto";
export const WATERMARK_PRESET_COLORS = [
	"#FFFFFF",
	"#D1D5DB",
	"#6B7280",
	"#1F2937",
	"#0F172A",
] as const;

/**
 * Latin faces first, then a Chinese face in the same spirit, so mixed
 * signatures like "@岚叔 Studio" stay consistent. `tracking` is in em.
 */
export const WATERMARK_FONT_STACKS: Record<WatermarkFont, { family: string; tracking: number }> = {
	system: {
		family:
			'"SF Pro Display", -apple-system, "PingFang SC", "Hiragino Sans GB", "Segoe UI", "Microsoft YaHei", system-ui, sans-serif',
		tracking: 0.04,
	},
	serif: {
		family: 'Georgia, "Songti SC", STSong, "Noto Serif CJK SC", SimSun, serif',
		tracking: 0.02,
	},
	geometric: {
		family:
			'"Avenir Next", Futura, "Century Gothic", "PingFang SC", "Hiragino Sans GB", "Segoe UI", "Microsoft YaHei", sans-serif',
		tracking: 0.06,
	},
	mono: {
		family: '"SF Mono", Menlo, Consolas, "PingFang SC", "Microsoft YaHei", monospace',
		tracking: 0,
	},
	script: {
		family: '"Snell Roundhand", "Segoe Script", "Brush Script MT", "Kaiti SC", STKaiti, KaiTi, cursive',
		tracking: 0,
	},
};

function resolveWeight(weight: WatermarkWeight, regular: number) {
	if (weight === "light") return 300;
	if (weight === "bold") return 700;
	return regular;
}

/** Sets the signature's typeface on the context and returns its tracking. */
function applyWatermarkFont(
	ctx: CanvasRenderingContext2D,
	settings: WatermarkSettings,
	fontSize: number,
	regularWeight: number,
) {
	const stack = WATERMARK_FONT_STACKS[settings.font] ?? WATERMARK_FONT_STACKS.system;
	ctx.font = `${resolveWeight(settings.weight, regularWeight)} ${fontSize}px ${stack.family}`;
	(ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing =
		`${(fontSize * stack.tracking).toFixed(2)}px`;
}

function sizeScale(settings: WatermarkSettings) {
	const size = Number.isFinite(settings.size) ? settings.size : 100;
	return clamp(size, 40, 240) / 100;
}

export function getWatermarkMetrics(imageWidth: number, imageHeight: number, unit: number) {
	return {
		fontSize: clamp(Math.round(imageWidth * 0.024), 12 * unit, 26 * unit),
		right: clamp(Math.round(imageWidth * 0.032), 12 * unit, 36 * unit),
		bottom: clamp(Math.round(imageHeight * 0.04), 10 * unit, 30 * unit),
		maxWidth: Math.round(imageWidth * 0.42),
	};
}

function truncateToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
	if (ctx.measureText(text).width <= maxWidth) return text;
	let trimmed = text;
	while (trimmed.length > 1) {
		trimmed = trimmed.slice(0, -1);
		if (ctx.measureText(`${trimmed}…`).width <= maxWidth) return `${trimmed}…`;
	}
	return "…";
}

/** Average luminance of the canvas pixels under a user-space rectangle. */
function sampleLuminance(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	height: number,
) {
	const transform = ctx.getTransform();
	const left = Math.max(0, Math.floor(transform.a * x + transform.e));
	const top = Math.max(0, Math.floor(transform.d * y + transform.f));
	const w = Math.max(1, Math.min(Math.ceil(transform.a * width), ctx.canvas.width - left));
	const h = Math.max(1, Math.min(Math.ceil(transform.d * height), ctx.canvas.height - top));
	try {
		const data = ctx.getImageData(left, top, w, h).data;
		let total = 0;
		let count = 0;
		const step = Math.max(4, Math.floor(data.length / 4 / 4000) * 4);
		for (let i = 0; i < data.length; i += step) {
			const alpha = data[i + 3] / 255;
			if (alpha <= 0) continue;
			total += ((0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255) * alpha;
			count += 1;
		}
		return count > 0 ? total / count : null;
	} catch {
		return null;
	}
}

/** Alpha-weighted average colour of the canvas under a user-space rectangle. */
function sampleAverageColor(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	height: number,
): Rgb | null {
	const transform = ctx.getTransform();
	const left = Math.max(0, Math.floor(transform.a * x + transform.e));
	const top = Math.max(0, Math.floor(transform.d * y + transform.f));
	const w = Math.max(1, Math.min(Math.ceil(transform.a * width), ctx.canvas.width - left));
	const h = Math.max(1, Math.min(Math.ceil(transform.d * height), ctx.canvas.height - top));
	try {
		const data = ctx.getImageData(left, top, w, h).data;
		let r = 0;
		let g = 0;
		let b = 0;
		let weight = 0;
		const step = Math.max(4, Math.floor(data.length / 4 / 4000) * 4);
		for (let i = 0; i < data.length; i += step) {
			const alpha = data[i + 3] / 255;
			if (alpha <= 0) continue;
			r += data[i] * alpha;
			g += data[i + 1] * alpha;
			b += data[i + 2] * alpha;
			weight += alpha;
		}
		return weight > 0 ? { r: r / weight, g: g / weight, b: b / weight } : null;
	} catch {
		return null;
	}
}

export function resolveWatermarkFill(requested: string, luminance: number | null) {
	if (requested !== AUTO_WATERMARK_COLOR) return requested;
	return luminance !== null && luminance >= 0.58 ? "#111827" : "#F8FAFC";
}

export function drawWatermark(
	ctx: CanvasRenderingContext2D,
	settings: WatermarkSettings,
	image: { x: number; y: number; w: number; h: number },
	unit: number,
) {
	const content = settings.text.trim();
	if (!settings.enabled || !content) return;
	const baseMetrics = getWatermarkMetrics(image.w, image.h, unit);
	const metrics = { ...baseMetrics, fontSize: baseMetrics.fontSize * sizeScale(settings) };

	ctx.save();
	applyWatermarkFont(ctx, settings, metrics.fontSize, 600);
	const text = truncateToWidth(ctx, content, metrics.maxWidth);
	const measured = ctx.measureText(text);
	const ascent = Math.max(metrics.fontSize * 0.78, measured.actualBoundingBoxAscent || 0);
	const descent = Math.max(metrics.fontSize * 0.2, measured.actualBoundingBoxDescent || 0);
	const anchorX = image.x + image.w - metrics.right;
	const anchorY = image.y + image.h - metrics.bottom;
	const insetX = clamp(metrics.fontSize * 0.35, 6, 12);
	const insetY = clamp(metrics.fontSize * 0.24, 4, 8);
	const boxWidth = Math.min(measured.width, metrics.maxWidth) + insetX * 2;
	const boxHeight = ascent + descent + insetY * 2;
	const luminance =
		settings.color === AUTO_WATERMARK_COLOR
			? sampleLuminance(ctx, anchorX - boxWidth, anchorY - ascent - insetY, boxWidth, boxHeight)
			: null;
	const fill = resolveWatermarkFill(settings.color, luminance);
	const outline = isLightColor(fill) ? "rgba(0,0,0,0.46)" : "rgba(255,255,255,0.52)";
	const alpha = clamp(settings.opacity, 24, 80) / 100;

	ctx.textAlign = "right";
	ctx.textBaseline = "bottom";
	ctx.globalAlpha = alpha;
	ctx.fillStyle = fill;
	ctx.strokeStyle = withAlpha(outline, clamp(alpha * 0.82, 0, 0.7));
	ctx.lineWidth = clamp(metrics.fontSize * 0.08, 0.9, 1.8 * unit);
	ctx.lineJoin = "round";
	ctx.miterLimit = 2;
	ctx.strokeText(text, anchorX, anchorY, metrics.maxWidth);
	ctx.fillText(text, anchorX, anchorY, metrics.maxWidth);
	ctx.restore();
}

/**
 * Signs the composition in the background margin, right-aligned with the
 * window and centred in the space beneath it, like a caption.
 */
export function drawMarginWatermark(
	ctx: CanvasRenderingContext2D,
	settings: WatermarkSettings,
	layout: CompositionLayout,
) {
	const content = settings.text.trim();
	if (!settings.enabled || !content) return;
	const { frame, unit } = layout;
	const bottom = frame.y + frame.h;
	const margin = layout.height - bottom;
	const scale = sizeScale(settings);
	// Hang just below the window like a caption instead of floating mid-margin.
	const gap = clamp(margin * 0.24, 9 * unit, 18 * unit);
	// Scale with the window so small captures get a small caption, and never
	// let a larger size run off the bottom of the canvas.
	const fontSize = Math.max(
		1,
		Math.min(
			clamp(Math.round(frame.w * 0.028), 11 * unit, 14 * unit) * scale,
			margin * 0.34 * scale,
			(margin - gap) * 0.82,
		),
	);

	ctx.save();
	applyWatermarkFont(ctx, settings, fontSize, 500);
	const text = truncateToWidth(ctx, content, frame.w * 0.6);
	const width = ctx.measureText(text).width;
	const right = frame.x + frame.w;
	const centerY = bottom + gap + fontSize / 2;
	if (settings.color === AUTO_WATERMARK_COLOR) {
		const background = sampleAverageColor(ctx, right - width, centerY - fontSize / 2, width, fontSize);
		ctx.fillStyle = background ? rgbToHex(toneOnTone(background)) : "#FFFFFF";
		ctx.globalAlpha = clamp(settings.opacity / 100 + 0.33, 0.55, 0.92);
	} else {
		ctx.fillStyle = settings.color;
		ctx.globalAlpha = clamp(settings.opacity + 18, 40, 95) / 100;
	}
	ctx.textAlign = "right";
	ctx.textBaseline = "middle";
	ctx.fillText(text, right, centerY);
	ctx.restore();
}
