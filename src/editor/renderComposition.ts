import {
	type BackgroundSpec,
	type GradientPreset,
	isLightBackground,
	parseBackground,
} from "./backgrounds";
import type {
	CompositionLayout,
	CornerRadii,
	StyleSettings,
} from "./composition";
import { resolveWatermarkPlacement } from "./composition";
import type { SourceImage } from "./stitchSource";
import { drawMarginWatermark, drawWatermark } from "./watermark";

export type CompositionSources = {
	/** One capture, or several stitched into a canvas. */
	image: SourceImage;
	/** Decoded wallpaper for `wallpaper:*` backgrounds, when available. */
	wallpaper: HTMLImageElement | null;
};

export type RenderCompositionOptions = {
	layout: CompositionLayout;
	settings: StyleSettings;
	sources: CompositionSources;
	/** Device pixels per layout pixel; shadows and filters ignore the transform. */
	pixelScale: number;
	/** Draws annotations in image coordinates, already clipped to the image. */
	drawOverImage?: (ctx: CanvasRenderingContext2D) => void;
};

const TRAFFIC_LIGHTS = ["#FF5F57", "#FEBC2E", "#28C840"] as const;

// ─── Background ──────────────────────────────────────────────────────────────

function drawGradientPreset(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	preset: GradientPreset,
) {
	const radians = ((preset.angle - 90) * Math.PI) / 180;
	const halfLength =
		(Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians))) / 2;
	const cx = width / 2;
	const cy = height / 2;
	const gradient = ctx.createLinearGradient(
		cx - Math.cos(radians) * halfLength,
		cy - Math.sin(radians) * halfLength,
		cx + Math.cos(radians) * halfLength,
		cy + Math.sin(radians) * halfLength,
	);
	preset.stops.forEach((stop, index) => {
		gradient.addColorStop(index / Math.max(1, preset.stops.length - 1), stop);
	});
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, width, height);

	const diagonal = Math.hypot(width, height);
	for (const blob of preset.blobs) {
		const x = blob.x * width;
		const y = blob.y * height;
		const radius = blob.r * diagonal;
		const radial = ctx.createRadialGradient(x, y, 0, x, y, radius);
		radial.addColorStop(0, blob.color);
		radial.addColorStop(1, blob.color.replace(/[\d.]+\)$/, "0)"));
		ctx.fillStyle = radial;
		ctx.fillRect(0, 0, width, height);
	}
}

let grainTile: HTMLCanvasElement | null = null;

function getGrainTile() {
	if (grainTile) return grainTile;
	const canvas = document.createElement("canvas");
	canvas.width = 128;
	canvas.height = 128;
	const context = canvas.getContext("2d");
	if (context) {
		const pixels = context.createImageData(128, 128);
		let seed = 1337;
		for (let i = 0; i < pixels.data.length; i += 4) {
			seed = (seed * 16807) % 2147483647;
			const value = 96 + (seed % 64);
			pixels.data[i] = value;
			pixels.data[i + 1] = value;
			pixels.data[i + 2] = value;
			pixels.data[i + 3] = 255;
		}
		context.putImageData(pixels, 0, 0);
	}
	grainTile = canvas;
	return canvas;
}

/** A faint film grain hides gradient banding and gives flat colour some depth. */
function drawGrain(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	pixelScale: number,
	strength: number,
) {
	const pattern = ctx.createPattern(getGrainTile(), "repeat");
	if (!pattern) return;
	pattern.setTransform(new DOMMatrix().scale(1 / Math.max(0.25, pixelScale)));
	ctx.save();
	ctx.globalAlpha = strength;
	ctx.globalCompositeOperation = "overlay";
	ctx.fillStyle = pattern;
	ctx.fillRect(0, 0, width, height);
	ctx.restore();
}

function drawImageCover(
	ctx: CanvasRenderingContext2D,
	image: CanvasImageSource & { naturalWidth?: number; width: number; height: number },
	x: number,
	y: number,
	width: number,
	height: number,
) {
	const sourceWidth = image.naturalWidth || image.width;
	const sourceHeight =
		(image as HTMLImageElement).naturalHeight || (image.height as number);
	if (sourceWidth <= 0 || sourceHeight <= 0) return;
	const scale = Math.max(width / sourceWidth, height / sourceHeight);
	const cropWidth = width / scale;
	const cropHeight = height / scale;
	ctx.drawImage(
		image,
		(sourceWidth - cropWidth) / 2,
		(sourceHeight - cropHeight) / 2,
		cropWidth,
		cropHeight,
		x,
		y,
		width,
		height,
	);
}

const blurredImageCache = new WeakMap<SourceImage, Map<string, HTMLCanvasElement>>();

/** A heavily blurred, saturated copy of the screenshot, computed at thumbnail size. */
function getBlurredCover(image: SourceImage, width: number, height: number) {
	const aspect = Math.round((width / height) * 20) / 20;
	const key = String(aspect);
	let cache = blurredImageCache.get(image);
	if (!cache) {
		cache = new Map();
		blurredImageCache.set(image, cache);
	}
	const cached = cache.get(key);
	if (cached) return cached;

	const longest = 72;
	const smallWidth = aspect >= 1 ? longest : Math.max(8, Math.round(longest * aspect));
	const smallHeight = aspect >= 1 ? Math.max(8, Math.round(longest / aspect)) : longest;
	const canvas = document.createElement("canvas");
	canvas.width = smallWidth;
	canvas.height = smallHeight;
	const context = canvas.getContext("2d");
	if (context) {
		const overscan = 10;
		context.filter = "blur(5px) saturate(1.6) brightness(0.92)";
		drawImageCover(
			context,
			image,
			-overscan,
			-overscan,
			smallWidth + overscan * 2,
			smallHeight + overscan * 2,
		);
	}
	cache.set(key, canvas);
	return canvas;
}

export function drawBackground(
	ctx: CanvasRenderingContext2D,
	spec: BackgroundSpec,
	width: number,
	height: number,
	sources: Partial<CompositionSources>,
	pixelScale: number,
) {
	switch (spec.kind) {
		case "transparent":
			return;
		case "solid":
			ctx.fillStyle = spec.color;
			ctx.fillRect(0, 0, width, height);
			drawGrain(ctx, width, height, pixelScale, 0.025);
			return;
		case "gradient":
			drawGradientPreset(ctx, width, height, spec.preset);
			drawGrain(ctx, width, height, pixelScale, 0.05);
			return;
		case "wallpaper":
			if (sources.wallpaper) {
				ctx.save();
				ctx.imageSmoothingQuality = "high";
				drawImageCover(ctx, sources.wallpaper, 0, 0, width, height);
				ctx.restore();
			} else {
				ctx.fillStyle = "#101318";
				ctx.fillRect(0, 0, width, height);
			}
			return;
		case "blur": {
			if (!sources.image) {
				ctx.fillStyle = "#3a3b40";
				ctx.fillRect(0, 0, width, height);
				return;
			}
			ctx.save();
			ctx.imageSmoothingEnabled = true;
			ctx.imageSmoothingQuality = "high";
			ctx.drawImage(getBlurredCover(sources.image, width, height), 0, 0, width, height);
			ctx.restore();
			drawGrain(ctx, width, height, pixelScale, 0.05);
			return;
		}
	}
}

// ─── Shapes ──────────────────────────────────────────────────────────────────

function roundedPath(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	radii: number | CornerRadii,
) {
	ctx.beginPath();
	ctx.roundRect(x, y, w, h, radii);
}

const SHADOW_OFFSET = 50_000;

/** Paints only the shadow of a rounded rectangle, leaving its interior untouched. */
function drawShadowOnly(
	ctx: CanvasRenderingContext2D,
	rect: { x: number; y: number; w: number; h: number; radius: number },
	color: string,
	blur: number,
	offsetY: number,
	pixelScale: number,
) {
	ctx.save();
	ctx.shadowColor = color;
	ctx.shadowBlur = blur * pixelScale;
	ctx.shadowOffsetX = SHADOW_OFFSET * pixelScale;
	ctx.shadowOffsetY = offsetY * pixelScale;
	ctx.fillStyle = "#000";
	roundedPath(ctx, rect.x - SHADOW_OFFSET, rect.y, rect.w, rect.h, rect.radius);
	ctx.fill();
	ctx.restore();
}

function drawWindowShadow(
	ctx: CanvasRenderingContext2D,
	layout: CompositionLayout,
	strength: number,
	pixelScale: number,
) {
	if (strength <= 0) return;
	const k = strength / 100;
	const u = layout.unit;
	const { frame } = layout;
	const rect = { x: frame.x, y: frame.y, w: frame.w, h: frame.h, radius: frame.radius };
	// Three layers approximate a contact shadow, a key-light shadow and ambient falloff.
	drawShadowOnly(ctx, rect, `rgba(0,0,0,${0.22 * k})`, 3 * u, 1 * u, pixelScale);
	drawShadowOnly(ctx, rect, `rgba(0,0,0,${0.2 * k})`, 18 * u, 8 * u, pixelScale);
	drawShadowOnly(ctx, rect, `rgba(0,0,0,${0.32 * k})`, 64 * u, 30 * u, pixelScale);
}

function drawTrafficLights(
	ctx: CanvasRenderingContext2D,
	startX: number,
	centerY: number,
	unit: number,
) {
	const radius = 6 * unit;
	const gap = 20 * unit;
	TRAFFIC_LIGHTS.forEach((color, index) => {
		ctx.beginPath();
		ctx.arc(startX + index * gap, centerY, radius, 0, Math.PI * 2);
		ctx.fillStyle = color;
		ctx.fill();
		ctx.lineWidth = 0.75 * unit;
		ctx.strokeStyle = "rgba(0,0,0,0.14)";
		ctx.stroke();
	});
}

function strokeHairline(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	radius: number | CornerRadii,
	color: string | CanvasGradient,
	unit: number,
) {
	const inset = 0.5 * unit;
	const radii = Array.isArray(radius)
		? (radius.map((value) => Math.max(0, value - inset)) as CornerRadii)
		: Math.max(0, radius - inset);
	ctx.save();
	ctx.lineWidth = unit;
	ctx.strokeStyle = color;
	roundedPath(ctx, x + inset, y + inset, w - inset * 2, h - inset * 2, radii);
	ctx.stroke();
	ctx.restore();
}

// ─── Frames ──────────────────────────────────────────────────────────────────

function drawClassicFrame(ctx: CanvasRenderingContext2D, layout: CompositionLayout) {
	const { frame, unit: u } = layout;
	ctx.save();
	roundedPath(ctx, frame.x, frame.y, frame.w, frame.h, frame.radius);
	const body = ctx.createLinearGradient(0, frame.y, 0, frame.y + frame.h);
	body.addColorStop(0, "rgba(30, 32, 39, 0.9)");
	body.addColorStop(1, "rgba(16, 17, 22, 0.92)");
	ctx.fillStyle = body;
	ctx.fill();
	ctx.clip();
	const gloss = ctx.createLinearGradient(0, frame.y, 0, frame.y + frame.titleBarHeight * 1.4);
	gloss.addColorStop(0, "rgba(255,255,255,0.09)");
	gloss.addColorStop(1, "rgba(255,255,255,0)");
	ctx.fillStyle = gloss;
	ctx.fillRect(frame.x, frame.y, frame.w, frame.titleBarHeight * 1.4);
	ctx.restore();

	// Centre the lights in the band above the image and align them with its edge.
	const inset = layout.image.x - frame.x;
	drawTrafficLights(
		ctx,
		layout.image.x + 10 * u,
		frame.y + (frame.titleBarHeight + inset) / 2,
		u,
	);

	const edge = ctx.createLinearGradient(0, frame.y, 0, frame.y + frame.h);
	edge.addColorStop(0, "rgba(255,255,255,0.22)");
	edge.addColorStop(0.3, "rgba(255,255,255,0.09)");
	edge.addColorStop(1, "rgba(255,255,255,0.07)");
	strokeHairline(ctx, frame.x, frame.y, frame.w, frame.h, frame.radius, edge, u);
}

function drawBlurredBackdrop(
	ctx: CanvasRenderingContext2D,
	spec: BackgroundSpec,
	layout: CompositionLayout,
	sources: CompositionSources,
) {
	const scale = 0.08;
	const smallWidth = Math.max(8, Math.round(layout.width * scale));
	const smallHeight = Math.max(8, Math.round(layout.height * scale));
	const canvas = document.createElement("canvas");
	canvas.width = smallWidth;
	canvas.height = smallHeight;
	const context = canvas.getContext("2d");
	if (!context) return;
	context.setTransform(smallWidth / layout.width, 0, 0, smallHeight / layout.height, 0, 0);
	drawBackground(context, spec, layout.width, layout.height, sources, scale);

	const blurred = document.createElement("canvas");
	blurred.width = smallWidth;
	blurred.height = smallHeight;
	const blurredContext = blurred.getContext("2d");
	if (!blurredContext) return;
	blurredContext.filter = `blur(${Math.max(2, 3 * layout.unit)}px) saturate(1.25)`;
	blurredContext.drawImage(canvas, 0, 0);

	ctx.save();
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = "high";
	ctx.drawImage(blurred, 0, 0, layout.width, layout.height);
	ctx.restore();
	canvas.width = 0;
	blurred.width = 0;
}

function drawGlassFrame(
	ctx: CanvasRenderingContext2D,
	layout: CompositionLayout,
	spec: BackgroundSpec,
	sources: CompositionSources,
) {
	const { frame, unit: u } = layout;
	const light = isLightBackground(spec);
	ctx.save();
	roundedPath(ctx, frame.x, frame.y, frame.w, frame.h, frame.radius);
	ctx.clip();
	if (spec.kind !== "transparent") {
		drawBlurredBackdrop(ctx, spec, layout, sources);
	}
	ctx.fillStyle = light ? "rgba(255,255,255,0.34)" : "rgba(255,255,255,0.14)";
	ctx.fillRect(frame.x, frame.y, frame.w, frame.h);
	const sheen = ctx.createLinearGradient(frame.x, frame.y, frame.x + frame.w, frame.y + frame.h);
	sheen.addColorStop(0, "rgba(255,255,255,0.16)");
	sheen.addColorStop(0.5, "rgba(255,255,255,0.02)");
	sheen.addColorStop(1, "rgba(255,255,255,0.08)");
	ctx.fillStyle = sheen;
	ctx.fillRect(frame.x, frame.y, frame.w, frame.h);
	ctx.restore();

	const edge = ctx.createLinearGradient(0, frame.y, 0, frame.y + frame.h);
	edge.addColorStop(0, "rgba(255,255,255,0.62)");
	edge.addColorStop(0.5, "rgba(255,255,255,0.22)");
	edge.addColorStop(1, "rgba(255,255,255,0.34)");
	strokeHairline(ctx, frame.x, frame.y, frame.w, frame.h, frame.radius, edge, 1.2 * u);
}

type WindowPalette = {
	body: string;
	barTop: string;
	barBottom: string;
	separator: string;
	border: string;
	control: string;
	field: string;
};

const DARK_WINDOW: WindowPalette = {
	body: "#1E1F24",
	barTop: "#35363C",
	barBottom: "#2A2B30",
	separator: "rgba(0,0,0,0.55)",
	border: "rgba(255,255,255,0.16)",
	control: "rgba(255,255,255,0.4)",
	field: "rgba(255,255,255,0.08)",
};

const LIGHT_WINDOW: WindowPalette = {
	body: "#FFFFFF",
	barTop: "#F1F1F3",
	barBottom: "#E6E6E9",
	separator: "rgba(0,0,0,0.12)",
	border: "rgba(0,0,0,0.16)",
	control: "rgba(0,0,0,0.38)",
	field: "rgba(0,0,0,0.06)",
};

function drawWindowFrame(
	ctx: CanvasRenderingContext2D,
	layout: CompositionLayout,
	palette: WindowPalette,
	withAddressBar: boolean,
) {
	const { frame, unit: u } = layout;
	const bar = frame.titleBarHeight;
	ctx.save();
	roundedPath(ctx, frame.x, frame.y, frame.w, frame.h, frame.radius);
	ctx.fillStyle = palette.body;
	ctx.fill();
	ctx.clip();
	const barGradient = ctx.createLinearGradient(0, frame.y, 0, frame.y + bar);
	barGradient.addColorStop(0, palette.barTop);
	barGradient.addColorStop(1, palette.barBottom);
	ctx.fillStyle = barGradient;
	ctx.fillRect(frame.x, frame.y, frame.w, bar);
	ctx.fillStyle = palette.separator;
	ctx.fillRect(frame.x, frame.y + bar - u, frame.w, u);
	ctx.restore();

	const lightsX = frame.x + 19 * u;
	drawTrafficLights(ctx, lightsX, frame.y + bar / 2, u);

	if (withAddressBar) {
		const centerY = frame.y + bar / 2;
		// Back and forward chevrons.
		ctx.save();
		ctx.strokeStyle = palette.control;
		ctx.lineWidth = 1.6 * u;
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		const chevronX = lightsX + 64 * u;
		for (const [x, direction] of [
			[chevronX, -1],
			[chevronX + 22 * u, 1],
		] as const) {
			ctx.beginPath();
			ctx.moveTo(x - direction * 3 * u, centerY - 5 * u);
			ctx.lineTo(x + direction * 3 * u, centerY);
			ctx.lineTo(x - direction * 3 * u, centerY + 5 * u);
			ctx.stroke();
		}
		ctx.restore();

		const available = frame.w - 2 * (chevronX + 40 * u - frame.x);
		const fieldWidth = Math.min(380 * u, frame.w * 0.36, available);
		if (fieldWidth > 80 * u) {
			const fieldHeight = 24 * u;
			const fieldX = frame.x + (frame.w - fieldWidth) / 2;
			const fieldY = centerY - fieldHeight / 2;
			roundedPath(ctx, fieldX, fieldY, fieldWidth, fieldHeight, 7 * u);
			ctx.fillStyle = palette.field;
			ctx.fill();
			// Padlock glyph.
			const lockX = fieldX + 12 * u;
			ctx.save();
			ctx.fillStyle = palette.control;
			ctx.strokeStyle = palette.control;
			ctx.lineWidth = 1.3 * u;
			roundedPath(ctx, lockX, centerY - 1 * u, 8 * u, 6.5 * u, 1.5 * u);
			ctx.fill();
			ctx.beginPath();
			ctx.arc(lockX + 4 * u, centerY - 1 * u, 2.6 * u, Math.PI, 0);
			ctx.stroke();
			ctx.restore();
		}
	}

	strokeHairline(ctx, frame.x, frame.y, frame.w, frame.h, frame.radius, palette.border, u);
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export function renderComposition(
	ctx: CanvasRenderingContext2D,
	options: RenderCompositionOptions,
) {
	const { layout, settings, sources, pixelScale } = options;
	const { image } = layout;
	const spec = parseBackground(settings.background);

	ctx.save();
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = "high";

	if (layout.beautify) {
		drawBackground(ctx, spec, layout.width, layout.height, sources, pixelScale);
		drawWindowShadow(ctx, layout, settings.shadow, pixelScale);
		switch (layout.frame.style) {
			case "classic":
				drawClassicFrame(ctx, layout);
				break;
			case "glass":
				drawGlassFrame(ctx, layout, spec, sources);
				break;
			case "macos-dark":
				drawWindowFrame(ctx, layout, DARK_WINDOW, false);
				break;
			case "macos-light":
				drawWindowFrame(ctx, layout, LIGHT_WINDOW, false);
				break;
			case "browser":
				drawWindowFrame(ctx, layout, DARK_WINDOW, true);
				break;
			case "none":
				break;
		}
	}

	ctx.save();
	roundedPath(ctx, image.x, image.y, image.w, image.h, image.radii);
	ctx.clip();
	ctx.drawImage(sources.image, image.x, image.y, image.w, image.h);
	const watermarkInMargin = resolveWatermarkPlacement(layout, settings.watermark) === "margin";
	if (!watermarkInMargin) drawWatermark(ctx, settings.watermark, image, layout.unit);
	if (options.drawOverImage) {
		ctx.translate(image.x, image.y);
		options.drawOverImage(ctx);
	}
	ctx.restore();

	if (
		layout.beautify &&
		(layout.frame.style === "classic" || layout.frame.style === "glass")
	) {
		strokeHairline(
			ctx,
			image.x,
			image.y,
			image.w,
			image.h,
			image.radii,
			"rgba(255,255,255,0.1)",
			layout.unit,
		);
	}
	if (watermarkInMargin) drawMarginWatermark(ctx, settings.watermark, layout);
	ctx.restore();
}
