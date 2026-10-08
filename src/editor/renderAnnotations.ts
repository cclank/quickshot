import { getArrowHeadLength } from "./annotations";
import { contrastColor, withAlpha } from "./color";
import { normalizeRect } from "./geometry";
import {
	ANNOTATION_FONT_FAMILY,
	annotationFont,
	measureTextAnnotation,
} from "./textLayout";
import type {
	Annotation,
	ArrowAnnotation,
	CounterAnnotation,
	EllipseAnnotation,
	Point,
	RectAnnotation,
	RedactAnnotation,
	TextAnnotation,
} from "./types";

export type AnnotationRenderEnv = {
	source: CanvasImageSource;
	sourceWidth: number;
	sourceHeight: number;
	/** Device pixels per image pixel. Shadows and filters ignore the canvas transform. */
	pixelScale: number;
	scratch: () => HTMLCanvasElement;
};

function applySoftShadow(
	ctx: CanvasRenderingContext2D,
	env: AnnotationRenderEnv,
	strokeWidth: number,
	alpha = 0.32,
) {
	const size = Math.max(1, strokeWidth);
	ctx.shadowColor = `rgba(0, 0, 0, ${alpha})`;
	ctx.shadowBlur = Math.max(1, size * 1.1) * env.pixelScale;
	ctx.shadowOffsetX = 0;
	ctx.shadowOffsetY = Math.max(0.5, size * 0.28) * env.pixelScale;
}

function clearShadow(ctx: CanvasRenderingContext2D) {
	ctx.shadowColor = "transparent";
	ctx.shadowBlur = 0;
	ctx.shadowOffsetY = 0;
}

function shapeCornerRadius(width: number, w: number, h: number) {
	return Math.max(0, Math.min(width * 1.4 + 1, w / 2, h / 2));
}

function drawBox(
	ctx: CanvasRenderingContext2D,
	annotation: RectAnnotation | EllipseAnnotation,
	env: AnnotationRenderEnv,
) {
	const rect = normalizeRect(annotation);
	ctx.beginPath();
	if (annotation.kind === "rect") {
		ctx.roundRect(
			rect.x,
			rect.y,
			rect.w,
			rect.h,
			shapeCornerRadius(annotation.width, rect.w, rect.h),
		);
	} else {
		ctx.ellipse(
			rect.x + rect.w / 2,
			rect.y + rect.h / 2,
			rect.w / 2,
			rect.h / 2,
			0,
			0,
			Math.PI * 2,
		);
	}

	if (annotation.fill === "solid") {
		applySoftShadow(ctx, env, annotation.width, 0.26);
		ctx.fillStyle = annotation.color;
		ctx.fill();
		return;
	}
	if (annotation.fill === "soft") {
		ctx.fillStyle = withAlpha(annotation.color, 0.18);
		ctx.fill();
	}
	applySoftShadow(ctx, env, annotation.width);
	ctx.lineWidth = annotation.width;
	ctx.lineJoin = "round";
	ctx.strokeStyle = annotation.color;
	ctx.stroke();
}

function drawArrow(
	ctx: CanvasRenderingContext2D,
	annotation: ArrowAnnotation,
	env: AnnotationRenderEnv,
) {
	const { from, to, width } = annotation;
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const length = Math.hypot(dx, dy);
	if (length < 0.5) return;
	const ux = dx / length;
	const uy = dy / length;
	const nx = -uy;
	const ny = ux;
	const headLength = getArrowHeadLength(width, length);
	const headHalf = headLength * 0.46;
	const notchDistance = headLength * 0.74;
	const tailHalf = Math.max(0.5, width * 0.3);
	const neckHalf = Math.max(tailHalf, width * 0.56);
	const at = (distanceFromTip: number, offset: number): Point => ({
		x: to.x - ux * distanceFromTip + nx * offset,
		y: to.y - uy * distanceFromTip + ny * offset,
	});
	const neckLeft = at(notchDistance, neckHalf);
	const wingLeft = at(headLength, headHalf);
	const wingRight = at(headLength, -headHalf);
	const neckRight = at(notchDistance, -neckHalf);

	ctx.beginPath();
	ctx.moveTo(from.x + nx * tailHalf, from.y + ny * tailHalf);
	ctx.lineTo(neckLeft.x, neckLeft.y);
	ctx.lineTo(wingLeft.x, wingLeft.y);
	ctx.lineTo(to.x, to.y);
	ctx.lineTo(wingRight.x, wingRight.y);
	ctx.lineTo(neckRight.x, neckRight.y);
	ctx.lineTo(from.x - nx * tailHalf, from.y - ny * tailHalf);
	ctx.arc(
		from.x,
		from.y,
		tailHalf,
		Math.atan2(-ny, -nx),
		Math.atan2(ny, nx),
		true,
	);
	ctx.closePath();
	applySoftShadow(ctx, env, width);
	ctx.fillStyle = annotation.color;
	ctx.fill();
	// A thin stroke of the same colour softens the arrowhead's corners.
	clearShadow(ctx);
	ctx.lineJoin = "round";
	ctx.lineWidth = Math.max(0.5, width * 0.28);
	ctx.strokeStyle = annotation.color;
	ctx.stroke();
}

function tracePath(ctx: CanvasRenderingContext2D, points: Point[]) {
	ctx.beginPath();
	ctx.moveTo(points[0].x, points[0].y);
	if (points.length === 1) {
		ctx.lineTo(points[0].x + 0.01, points[0].y);
		return;
	}
	if (points.length === 2) {
		ctx.lineTo(points[1].x, points[1].y);
		return;
	}
	for (let index = 1; index < points.length - 1; index += 1) {
		const current = points[index];
		const next = points[index + 1];
		ctx.quadraticCurveTo(
			current.x,
			current.y,
			(current.x + next.x) / 2,
			(current.y + next.y) / 2,
		);
	}
	const last = points[points.length - 1];
	ctx.lineTo(last.x, last.y);
}

function drawText(
	ctx: CanvasRenderingContext2D,
	annotation: TextAnnotation,
	env: AnnotationRenderEnv,
) {
	const box = measureTextAnnotation(annotation);
	ctx.font = annotationFont(annotation.size);
	ctx.textAlign = "left";
	ctx.textBaseline = "middle";
	const textColor =
		annotation.style === "pill"
			? contrastColor(annotation.color)
			: annotation.color;

	if (annotation.style === "pill") {
		ctx.beginPath();
		ctx.roundRect(
			annotation.x,
			annotation.y,
			box.w,
			box.h,
			Math.min(box.h / 2, annotation.size * 0.5),
		);
		applySoftShadow(ctx, env, annotation.size * 0.12, 0.26);
		ctx.fillStyle = annotation.color;
		ctx.fill();
		clearShadow(ctx);
	}

	box.lines.forEach((line, index) => {
		const x = annotation.x + box.padX;
		const y = annotation.y + box.padY + box.lineHeight * (index + 0.5);
		if (annotation.style === "outline") {
			ctx.lineJoin = "round";
			ctx.miterLimit = 2;
			ctx.lineWidth = annotation.size * 0.2;
			ctx.strokeStyle = contrastColor(annotation.color);
			ctx.strokeText(line, x, y);
		} else if (annotation.style === "plain") {
			ctx.shadowColor = "rgba(0, 0, 0, 0.38)";
			ctx.shadowBlur = annotation.size * 0.16 * env.pixelScale;
			ctx.shadowOffsetY = annotation.size * 0.04 * env.pixelScale;
		}
		ctx.fillStyle = textColor;
		ctx.fillText(line, x, y);
		clearShadow(ctx);
	});
}

function drawCounter(
	ctx: CanvasRenderingContext2D,
	annotation: CounterAnnotation,
	env: AnnotationRenderEnv,
) {
	const radius = annotation.size;
	ctx.beginPath();
	ctx.arc(annotation.x, annotation.y, radius, 0, Math.PI * 2);
	applySoftShadow(ctx, env, radius * 0.22, 0.3);
	ctx.fillStyle = annotation.color;
	ctx.fill();
	clearShadow(ctx);
	ctx.lineWidth = Math.max(1, radius * 0.13);
	ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
	ctx.stroke();

	const label = String(annotation.value);
	const fontSize = radius * (label.length > 2 ? 0.82 : label.length > 1 ? 0.98 : 1.14);
	ctx.font = `700 ${fontSize}px ${ANNOTATION_FONT_FAMILY}`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillStyle = contrastColor(annotation.color);
	ctx.fillText(label, annotation.x, annotation.y + radius * 0.05);
}

function sourceRegion(annotation: RedactAnnotation, env: AnnotationRenderEnv) {
	const rect = normalizeRect(annotation);
	const x = Math.max(0, Math.floor(rect.x));
	const y = Math.max(0, Math.floor(rect.y));
	const right = Math.min(env.sourceWidth, Math.ceil(rect.x + rect.w));
	const bottom = Math.min(env.sourceHeight, Math.ceil(rect.y + rect.h));
	return { x, y, w: right - x, h: bottom - y };
}

function drawPixelate(
	ctx: CanvasRenderingContext2D,
	annotation: RedactAnnotation,
	env: AnnotationRenderEnv,
) {
	const region = sourceRegion(annotation, env);
	if (region.w <= 0 || region.h <= 0) return;
	const tile = Math.max(2, Math.round(annotation.strength));
	const columns = Math.max(1, Math.ceil(region.w / tile));
	const rows = Math.max(1, Math.ceil(region.h / tile));
	const scratch = env.scratch();
	if (scratch.width < columns || scratch.height < rows) {
		scratch.width = Math.max(scratch.width, columns);
		scratch.height = Math.max(scratch.height, rows);
	}
	const scratchContext = scratch.getContext("2d");
	if (!scratchContext) return;
	scratchContext.clearRect(0, 0, columns, rows);
	scratchContext.imageSmoothingEnabled = true;
	scratchContext.imageSmoothingQuality = "medium";
	scratchContext.drawImage(
		env.source,
		region.x,
		region.y,
		columns * tile,
		rows * tile,
		0,
		0,
		columns,
		rows,
	);
	ctx.save();
	ctx.beginPath();
	ctx.rect(region.x, region.y, region.w, region.h);
	ctx.clip();
	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(
		scratch,
		0,
		0,
		columns,
		rows,
		region.x,
		region.y,
		columns * tile,
		rows * tile,
	);
	ctx.restore();
}

function drawBlur(
	ctx: CanvasRenderingContext2D,
	annotation: RedactAnnotation,
	env: AnnotationRenderEnv,
) {
	const region = sourceRegion(annotation, env);
	if (region.w <= 0 || region.h <= 0) return;
	const radius = Math.max(2, annotation.strength);
	// Blur is low-frequency, so it is computed on a downscaled copy and
	// stretched back. That keeps large regions interactive while dragging.
	const downscale = Math.max(1, radius / 3);
	const margin = radius * 2;
	const sx = Math.max(0, region.x - margin);
	const sy = Math.max(0, region.y - margin);
	const sw = Math.min(env.sourceWidth, region.x + region.w + margin) - sx;
	const sh = Math.min(env.sourceHeight, region.y + region.h + margin) - sy;
	const smallWidth = Math.max(1, Math.ceil(sw / downscale));
	const smallHeight = Math.max(1, Math.ceil(sh / downscale));
	const scratch = env.scratch();
	if (scratch.width < smallWidth || scratch.height < smallHeight) {
		scratch.width = Math.max(scratch.width, smallWidth);
		scratch.height = Math.max(scratch.height, smallHeight);
	}
	const scratchContext = scratch.getContext("2d");
	if (!scratchContext) return;
	scratchContext.save();
	scratchContext.clearRect(0, 0, scratch.width, scratch.height);
	scratchContext.filter = `blur(${radius / downscale}px)`;
	scratchContext.drawImage(env.source, sx, sy, sw, sh, 0, 0, smallWidth, smallHeight);
	scratchContext.restore();

	ctx.save();
	ctx.beginPath();
	ctx.rect(region.x, region.y, region.w, region.h);
	ctx.clip();
	// Paint the original first so edge pixels blend against real content.
	ctx.drawImage(env.source, region.x, region.y, region.w, region.h, region.x, region.y, region.w, region.h);
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = "high";
	ctx.drawImage(scratch, 0, 0, smallWidth, smallHeight, sx, sy, sw, sh);
	ctx.restore();
}

export function drawAnnotation(
	ctx: CanvasRenderingContext2D,
	annotation: Annotation,
	env: AnnotationRenderEnv,
) {
	ctx.save();
	try {
		switch (annotation.kind) {
			case "rect":
			case "ellipse":
				drawBox(ctx, annotation, env);
				break;
			case "arrow":
				drawArrow(ctx, annotation, env);
				break;
			case "line":
				ctx.beginPath();
				ctx.moveTo(annotation.from.x, annotation.from.y);
				ctx.lineTo(annotation.to.x, annotation.to.y);
				applySoftShadow(ctx, env, annotation.width);
				ctx.lineCap = "round";
				ctx.lineWidth = annotation.width;
				ctx.strokeStyle = annotation.color;
				ctx.stroke();
				break;
			case "pen":
				if (annotation.points.length === 0) break;
				tracePath(ctx, annotation.points);
				applySoftShadow(ctx, env, annotation.width, 0.26);
				ctx.lineCap = "round";
				ctx.lineJoin = "round";
				ctx.lineWidth = annotation.width;
				ctx.strokeStyle = annotation.color;
				ctx.stroke();
				break;
			case "highlighter":
				if (annotation.points.length === 0) break;
				tracePath(ctx, annotation.points);
				ctx.globalAlpha = 0.42;
				ctx.lineCap = "round";
				ctx.lineJoin = "round";
				ctx.lineWidth = annotation.width;
				ctx.strokeStyle = annotation.color;
				ctx.stroke();
				break;
			case "text":
				drawText(ctx, annotation, env);
				break;
			case "counter":
				drawCounter(ctx, annotation, env);
				break;
			case "redact":
				if (annotation.mode === "blur") drawBlur(ctx, annotation, env);
				else drawPixelate(ctx, annotation, env);
				break;
		}
	} finally {
		ctx.restore();
	}
}

export function drawAnnotations(
	ctx: CanvasRenderingContext2D,
	annotations: readonly Annotation[],
	env: AnnotationRenderEnv,
	skipId?: string | null,
) {
	for (const annotation of annotations) {
		if (annotation.id === skipId) continue;
		drawAnnotation(ctx, annotation, env);
	}
}
