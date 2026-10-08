export type FrameStyle =
	| "none"
	| "classic"
	| "glass"
	| "macos-dark"
	| "macos-light"
	| "browser";

export type AspectRatio = "auto" | "1:1" | "4:3" | "16:9" | "3:4" | "9:16";

export type WatermarkPlacement = "margin" | "image";

/** Curated typefaces that ship with macOS and Windows. */
export type WatermarkFont = "system" | "serif" | "geometric" | "mono" | "script";
export type WatermarkWeight = "light" | "regular" | "bold";

export type WatermarkSettings = {
	enabled: boolean;
	/** In the background margin below the window, or over the capture itself. */
	placement: WatermarkPlacement;
	text: string;
	/** A hex colour, or "auto" to pick light/dark from the pixels underneath. */
	color: string;
	/** 24–80. */
	opacity: number;
	font: WatermarkFont;
	weight: WatermarkWeight;
	/** Percent of the automatic size, 60–200. */
	size: number;
};

export type StyleSettings = {
	/** When false the export is the raw capture plus annotations. */
	beautify: boolean;
	background: string;
	/** Points around the window, 0–160. */
	padding: number;
	/** Corner radius in points, 0–36. */
	radius: number;
	/** Shadow strength, 0–100. */
	shadow: number;
	frame: FrameStyle;
	aspect: AspectRatio;
	watermark: WatermarkSettings;
};

export const PADDING_RANGE = { min: 0, max: 160, step: 4 } as const;
export const RADIUS_RANGE = { min: 0, max: 36, step: 1 } as const;
export const SHADOW_RANGE = { min: 0, max: 100, step: 1 } as const;
export const WATERMARK_OPACITY_RANGE = { min: 24, max: 80 } as const;
export const WATERMARK_SIZE_RANGE = { min: 60, max: 200, step: 5 } as const;
export const WATERMARK_FONTS: WatermarkFont[] = ["system", "serif", "geometric", "mono", "script"];
export const WATERMARK_WEIGHTS: WatermarkWeight[] = ["light", "regular", "bold"];

export const FRAME_STYLES: FrameStyle[] = [
	"none",
	"classic",
	"glass",
	"macos-dark",
	"macos-light",
	"browser",
];

export const ASPECT_RATIOS: AspectRatio[] = [
	"auto",
	"1:1",
	"4:3",
	"16:9",
	"3:4",
	"9:16",
];

export const DEFAULT_STYLE_SETTINGS: StyleSettings = {
	beautify: true,
	background: "gradient:sunset",
	padding: 56,
	radius: 12,
	shadow: 60,
	frame: "classic",
	aspect: "auto",
	watermark: {
		enabled: false,
		placement: "margin",
		text: "",
		color: "auto",
		opacity: 42,
		font: "system",
		weight: "regular",
		size: 100,
	},
};

type FrameMetrics = {
	/** Title bar height in points. */
	titleBar: number;
	/** Gap between the window edge and the image, in points. */
	inset: number;
	/** Whether the image's top corners sit flush under a title bar. */
	flushTop: boolean;
	/** Minimum window corner radius in points. */
	minRadius: number;
};

const FRAME_METRICS: Record<FrameStyle, FrameMetrics> = {
	none: { titleBar: 0, inset: 0, flushTop: false, minRadius: 0 },
	classic: { titleBar: 30, inset: 12, flushTop: false, minRadius: 0 },
	glass: { titleBar: 0, inset: 14, flushTop: false, minRadius: 0 },
	"macos-dark": { titleBar: 28, inset: 0, flushTop: true, minRadius: 10 },
	"macos-light": { titleBar: 28, inset: 0, flushTop: true, minRadius: 10 },
	browser: { titleBar: 40, inset: 0, flushTop: true, minRadius: 10 },
};

export type CornerRadii = [number, number, number, number];

export type CompositionLayout = {
	width: number;
	height: number;
	/** Image pixels per point. */
	unit: number;
	beautify: boolean;
	frame: {
		style: FrameStyle;
		x: number;
		y: number;
		w: number;
		h: number;
		radius: number;
		titleBarHeight: number;
	};
	image: {
		x: number;
		y: number;
		w: number;
		h: number;
		/** Top-left, top-right, bottom-right, bottom-left. */
		radii: CornerRadii;
	};
};

export function clampNumber(value: unknown, min: number, max: number, fallback: number) {
	const number = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(number)) return fallback;
	return Math.min(max, Math.max(min, number));
}

export function parseAspectRatio(aspect: AspectRatio): number | null {
	if (aspect === "auto") return null;
	const [w, h] = aspect.split(":").map(Number);
	return w > 0 && h > 0 ? w / h : null;
}

/**
 * Lays out the exported canvas. Every chrome measurement is expressed in
 * points and scaled by `unit` (the capture's device pixel ratio) so frames look
 * identical on 1x and Retina captures.
 */
export function computeCompositionLayout(
	imageWidth: number,
	imageHeight: number,
	unit: number,
	settings: StyleSettings,
): CompositionLayout {
	const w = Math.max(1, Math.round(imageWidth));
	const h = Math.max(1, Math.round(imageHeight));
	const u = Number.isFinite(unit) && unit > 0 ? unit : 1;

	if (!settings.beautify) {
		return {
			width: w,
			height: h,
			unit: u,
			beautify: false,
			frame: { style: "none", x: 0, y: 0, w, h, radius: 0, titleBarHeight: 0 },
			image: { x: 0, y: 0, w, h, radii: [0, 0, 0, 0] },
		};
	}

	const metrics = FRAME_METRICS[settings.frame] ?? FRAME_METRICS.none;
	const padding = Math.round(
		clampNumber(settings.padding, PADDING_RANGE.min, PADDING_RANGE.max, 0) * u,
	);
	const imageRadius = Math.round(
		clampNumber(settings.radius, RADIUS_RANGE.min, RADIUS_RANGE.max, 0) * u,
	);
	const inset = Math.round(metrics.inset * u);
	const titleBarHeight = Math.round(metrics.titleBar * u);
	// Concentric corners: the outer radius grows by the inset around the image.
	const frameRadius = Math.max(
		Math.round(metrics.minRadius * u),
		imageRadius + inset,
	);

	const frameW = w + inset * 2;
	const frameH = h + titleBarHeight + inset * 2;
	let width = frameW + padding * 2;
	let height = frameH + padding * 2;

	const ratio = parseAspectRatio(settings.aspect);
	if (ratio !== null) {
		if (width / height < ratio) {
			width = Math.round(height * ratio);
		} else {
			height = Math.round(width / ratio);
		}
	}

	const frameX = Math.round((width - frameW) / 2);
	// Optical centring: the shadow adds weight below the window, so lift it
	// slightly. Skipped when there is no margin or no shadow to balance.
	const lift = Math.round(
		Math.min(((height - frameH) / 2) * 0.2, 14 * u) *
			(clampNumber(settings.shadow, SHADOW_RANGE.min, SHADOW_RANGE.max, 0) / 100),
	);
	const frameY = Math.max(0, Math.round((height - frameH) / 2) - lift);
	const bottomRadius = metrics.flushTop ? frameRadius : imageRadius;
	const topRadius = metrics.flushTop ? 0 : imageRadius;

	return {
		width,
		height,
		unit: u,
		beautify: true,
		frame: {
			style: settings.frame,
			x: frameX,
			y: frameY,
			w: frameW,
			h: frameH,
			radius: settings.frame === "none" ? imageRadius : frameRadius,
			titleBarHeight,
		},
		image: {
			x: frameX + inset,
			y: frameY + titleBarHeight + inset,
			w,
			h,
			radii: [topRadius, topRadius, bottomRadius, bottomRadius],
		},
	};
}

export function normalizeStyleSettings(value: unknown): StyleSettings {
	const input =
		value && typeof value === "object"
			? (value as Partial<Record<keyof StyleSettings, unknown>>)
			: {};
	const watermarkInput =
		input.watermark && typeof input.watermark === "object"
			? (input.watermark as Partial<Record<keyof WatermarkSettings, unknown>>)
			: {};
	const defaults = DEFAULT_STYLE_SETTINGS;
	return {
		beautify:
			typeof input.beautify === "boolean" ? input.beautify : defaults.beautify,
		background:
			typeof input.background === "string" && input.background.length < 80
				? input.background
				: defaults.background,
		padding: Math.round(
			clampNumber(input.padding, PADDING_RANGE.min, PADDING_RANGE.max, defaults.padding),
		),
		radius: Math.round(
			clampNumber(input.radius, RADIUS_RANGE.min, RADIUS_RANGE.max, defaults.radius),
		),
		shadow: Math.round(
			clampNumber(input.shadow, SHADOW_RANGE.min, SHADOW_RANGE.max, defaults.shadow),
		),
		frame: FRAME_STYLES.includes(input.frame as FrameStyle)
			? (input.frame as FrameStyle)
			: defaults.frame,
		aspect: ASPECT_RATIOS.includes(input.aspect as AspectRatio)
			? (input.aspect as AspectRatio)
			: defaults.aspect,
		watermark: {
			enabled:
				typeof watermarkInput.enabled === "boolean"
					? watermarkInput.enabled
					: defaults.watermark.enabled,
			placement:
				watermarkInput.placement === "image" || watermarkInput.placement === "margin"
					? watermarkInput.placement
					: defaults.watermark.placement,
			text:
				typeof watermarkInput.text === "string"
					? watermarkInput.text.slice(0, 80)
					: defaults.watermark.text,
			color:
				typeof watermarkInput.color === "string" &&
				(watermarkInput.color === "auto" ||
					/^#[0-9a-f]{6}$/i.test(watermarkInput.color))
					? watermarkInput.color
					: defaults.watermark.color,
			opacity: Math.round(
				clampNumber(
					watermarkInput.opacity,
					WATERMARK_OPACITY_RANGE.min,
					WATERMARK_OPACITY_RANGE.max,
					defaults.watermark.opacity,
				),
			),
			font: WATERMARK_FONTS.includes(watermarkInput.font as WatermarkFont)
				? (watermarkInput.font as WatermarkFont)
				: defaults.watermark.font,
			weight: WATERMARK_WEIGHTS.includes(watermarkInput.weight as WatermarkWeight)
				? (watermarkInput.weight as WatermarkWeight)
				: defaults.watermark.weight,
			size: Math.round(
				clampNumber(
					watermarkInput.size,
					WATERMARK_SIZE_RANGE.min,
					WATERMARK_SIZE_RANGE.max,
					defaults.watermark.size,
				),
			),
		},
	};
}

/**
 * Margin placement needs a beautified canvas with enough room under the
 * window; otherwise the signature falls back onto the capture.
 */
export function resolveWatermarkPlacement(
	layout: CompositionLayout,
	watermark: WatermarkSettings,
): WatermarkPlacement {
	if (watermark.placement === "image" || !layout.beautify) return "image";
	const bottomMargin = layout.height - (layout.frame.y + layout.frame.h);
	return bottomMargin >= 22 * layout.unit ? "margin" : "image";
}
