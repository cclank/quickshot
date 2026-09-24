import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
	ArrowUpRight,
	Copy,
	Download,
	Grid2X2,
	Pencil,
	Pin,
	Pipette,
	Save,
	ScanText,
	Square,
	Type,
	Undo2,
	X,
	type LucideIcon,
} from "lucide-react";
import { getAssetPath } from "@/lib/assetPath";
import {
	calculateCanvasBackingSize,
	type CanvasBackingSize,
} from "@/lib/canvasBacking";
import { decodeImageData } from "@/lib/decodeImage";
import { createPngBlob } from "@/lib/pngBytes";
import {
	BACKGROUND_PADDING_STEP,
	DEFAULT_BACKGROUND_PADDING,
	MAX_BACKGROUND_PADDING,
	MIN_BACKGROUND_PADDING,
	calculateScreenshotCompositionLayout,
	normalizeBackgroundPadding,
} from "@/lib/screenshotComposition";
import { TextExtractionPanel } from "./TextExtractionPanel";

// ─── Types ───────────────────────────────────────────────────────────────────

type Tool = "pen" | "arrow" | "rect" | "text" | "mosaic";

type DrawOp =
	| { type: "pen"; points: [number, number][]; color: string; width: number }
	| { type: "arrow"; from: [number, number]; to: [number, number]; color: string; width: number }
	| { type: "rect"; x: number; y: number; w: number; h: number; color: string; width: number }
	| { type: "text"; x: number; y: number; text: string; color: string; size: number }
	| { type: "mosaic"; x: number; y: number; w: number; h: number; blockSize: number };

type BgType =
	| { kind: "wallpaper"; value: string }
	| { kind: "gradient"; css: string; stops: [string, string]; angle: number }
	| { kind: "solid"; value: string };

type ChromeStyle = "glass" | "graphite" | "aurora" | "ember" | "borderless";
type ActionType = "copy" | "pin" | "quick-save" | "save";
type ActionToast = {
	id: number;
	action: ActionType;
	tone: "success" | "error";
	title: string;
	detail?: string;
};

type WatermarkPalette = {
	fill: string;
	outline: string;
};

type WallpaperOption = {
	value: string;
	thumbnail: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const WALLPAPER_COUNT = 12;
const WALLPAPERS: WallpaperOption[] = Array.from(
	{ length: WALLPAPER_COUNT },
	(_, i) => ({
		value: `wallpapers/wallpaper${i + 1}.jpg`,
		thumbnail: `wallpapers/thumbnails/wallpaper${i + 1}.jpg`,
	}),
);

const GRADIENTS: BgType[] = [
	{
		kind: "gradient",
		css: "linear-gradient(135deg,#667eea,#764ba2)",
		stops: ["#667eea", "#764ba2"],
		angle: 135,
	},
	{
		kind: "gradient",
		css: "linear-gradient(135deg,#f093fb,#f5576c)",
		stops: ["#f093fb", "#f5576c"],
		angle: 135,
	},
	{
		kind: "gradient",
		css: "linear-gradient(135deg,#4facfe,#00f2fe)",
		stops: ["#4facfe", "#00f2fe"],
		angle: 135,
	},
	{
		kind: "gradient",
		css: "linear-gradient(135deg,#43e97b,#38f9d7)",
		stops: ["#43e97b", "#38f9d7"],
		angle: 135,
	},
	{
		kind: "gradient",
		css: "linear-gradient(135deg,#fa709a,#fee140)",
		stops: ["#fa709a", "#fee140"],
		angle: 135,
	},
	{
		kind: "gradient",
		css: "linear-gradient(135deg,#30cfd0,#330867)",
		stops: ["#30cfd0", "#330867"],
		angle: 135,
	},
	{
		kind: "gradient",
		css: "linear-gradient(135deg,#a18cd1,#fbc2eb)",
		stops: ["#a18cd1", "#fbc2eb"],
		angle: 135,
	},
	{
		kind: "gradient",
		css: "linear-gradient(135deg,#ffecd2,#fcb69f)",
		stops: ["#ffecd2", "#fcb69f"],
		angle: 135,
	},
];

const PRESET_COLORS = ["#FF3B30", "#FF9500", "#FFCC00", "#34C759", "#007AFF", "#FFFFFF", "#000000"];
const BRUSH_SIZES = [2, 4, 8];
const IS_MAC = navigator.userAgent.includes("Mac");
const MIN_PREVIEW_PIXEL_RATIO = 2;
const MAX_PREVIEW_CANVAS_DIMENSION = 3072;
const MAX_PREVIEW_CANVAS_PIXELS = 6_000_000;
const MAX_PINNED_COMPOSITE_DIMENSION = 3072;
const MAX_PINNED_COMPOSITE_PIXELS = 6_000_000;
const CHROME_STYLE_STORAGE_KEY = "quickshot.chrome-style";
const BACKGROUND_PADDING_STORAGE_KEY = "quickshot.background-padding";
const WATERMARK_TEXT_STORAGE_KEY = "quickshot.watermark-text";
const WATERMARK_ENABLED_STORAGE_KEY = "quickshot.watermark-enabled";
const WATERMARK_OPACITY_STORAGE_KEY = "quickshot.watermark-opacity";
const WATERMARK_COLOR_STORAGE_KEY = "quickshot.watermark-color";
const AUTO_WATERMARK_COLOR = "auto";
const MIN_WATERMARK_OPACITY = 24;
const MAX_WATERMARK_OPACITY = 80;
const DEFAULT_WATERMARK_OPACITY = 42;
const DEFAULT_WATERMARK_COLOR = AUTO_WATERMARK_COLOR;
const WATERMARK_PRESET_COLORS = [
	"#FFFFFF",
	"#D1D5DB",
	"#6B7280",
	"#1F2937",
	"#0F172A",
];
const EXPORT_FRAME_RADIUS = 30;
const EXPORT_IMAGE_RADIUS = 24;
const ACTIVE_CANVAS_IDLE_RELEASE_MS = 1600;

const TOOL_OPTIONS: {
	value: Tool;
	label: string;
	icon: LucideIcon;
}[] = [
	{ value: "pen", label: "画笔", icon: Pencil },
	{ value: "arrow", label: "箭头", icon: ArrowUpRight },
	{ value: "rect", label: "矩形", icon: Square },
	{ value: "text", label: "文字", icon: Type },
	{ value: "mosaic", label: "马赛克", icon: Grid2X2 },
];

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return (
		target.isContentEditable ||
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement
	);
}

const CHROME_THEMES: Record<
	ChromeStyle,
	{
		label: string;
		swatch: string;
		appBackground: string;
		gridOpacity: number;
		frameless: boolean;
		surface: React.CSSProperties;
		group: React.CSSProperties;
		shell: React.CSSProperties;
		copyButton: React.CSSProperties;
		primaryButton: React.CSSProperties;
		exportFrameFill: string;
		exportFrameStroke: string;
		exportTopBarFill: string;
		exportGlow: string;
		exportAccent: string;
		exportDecorFill: string;
	}
> = {
	glass: {
		label: "玻璃",
		swatch: "linear-gradient(135deg, #8bc4ff, #6ceabb)",
		appBackground:
			"radial-gradient(circle at top, rgba(108,160,255,0.22), transparent 30%), radial-gradient(circle at 20% 80%, rgba(110,234,191,0.14), transparent 28%), linear-gradient(180deg, #111723 0%, #0a0d14 44%, #090b11 100%)",
		gridOpacity: 0.4,
		frameless: false,
		surface: {
			background: "rgba(10, 14, 22, 0.72)",
			backdropFilter: "blur(28px) saturate(160%)",
			WebkitBackdropFilter: "blur(28px) saturate(160%)",
			boxShadow:
				"0 22px 60px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)",
		},
		group: {
			background: "rgba(255,255,255,0.05)",
			border: "1px solid rgba(255,255,255,0.08)",
			boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
		},
		shell: {
			background: "rgba(7, 10, 16, 0.5)",
			boxShadow:
				"0 38px 100px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.12)",
		},
		copyButton: {
			background: "rgba(255,255,255,0.07)",
			boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)",
		},
		primaryButton: {
			background:
				"linear-gradient(180deg, rgba(47,211,143,1) 0%, rgba(28,170,111,1) 100%)",
			boxShadow:
				"0 14px 28px rgba(31,181,118,0.28), inset 0 1px 0 rgba(255,255,255,0.28)",
		},
		exportFrameFill: "rgba(8, 14, 24, 0.8)",
		exportFrameStroke: "rgba(255,255,255,0.14)",
		exportTopBarFill: "rgba(255,255,255,0.06)",
		exportGlow: "rgba(108, 196, 255, 0.26)",
		exportAccent: "#6CEABB",
		exportDecorFill: "rgba(255,255,255,0.08)",
	},
	graphite: {
		label: "石墨",
		swatch: "linear-gradient(135deg, #9da4b0, #525866)",
		appBackground:
			"radial-gradient(circle at top, rgba(255,255,255,0.1), transparent 24%), linear-gradient(180deg, #1c1f25 0%, #14171c 40%, #0d0f13 100%)",
		gridOpacity: 0.22,
		frameless: false,
		surface: {
			background: "rgba(22, 24, 29, 0.9)",
			backdropFilter: "blur(22px) saturate(120%)",
			WebkitBackdropFilter: "blur(22px) saturate(120%)",
			boxShadow:
				"0 20px 54px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.05)",
		},
		group: {
			background: "rgba(255,255,255,0.035)",
			border: "1px solid rgba(255,255,255,0.06)",
			boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
		},
		shell: {
			background: "rgba(14, 16, 20, 0.82)",
			boxShadow:
				"0 36px 92px rgba(0,0,0,0.46), inset 0 1px 0 rgba(255,255,255,0.08)",
		},
		copyButton: {
			background: "rgba(255,255,255,0.045)",
			boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
		},
		primaryButton: {
			background:
				"linear-gradient(180deg, rgba(124,132,145,1) 0%, rgba(80,86,96,1) 100%)",
			boxShadow:
				"0 14px 28px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.2)",
		},
		exportFrameFill: "rgba(16, 18, 23, 0.92)",
		exportFrameStroke: "rgba(255,255,255,0.1)",
		exportTopBarFill: "rgba(255,255,255,0.04)",
		exportGlow: "rgba(176, 182, 192, 0.18)",
		exportAccent: "#B0B6C0",
		exportDecorFill: "rgba(255,255,255,0.05)",
	},
	aurora: {
		label: "极光",
		swatch: "linear-gradient(135deg, #6ceabb, #7aa2ff 48%, #d796ff)",
		appBackground:
			"radial-gradient(circle at 15% 18%, rgba(108,234,187,0.22), transparent 26%), radial-gradient(circle at 78% 12%, rgba(122,162,255,0.24), transparent 28%), radial-gradient(circle at 52% 85%, rgba(215,150,255,0.18), transparent 26%), linear-gradient(180deg, #0b1220 0%, #080d16 100%)",
		gridOpacity: 0.32,
		frameless: false,
		surface: {
			background: "rgba(10, 16, 28, 0.74)",
			backdropFilter: "blur(30px) saturate(170%)",
			WebkitBackdropFilter: "blur(30px) saturate(170%)",
			boxShadow:
				"0 22px 60px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.08)",
		},
		group: {
			background: "rgba(132,168,255,0.08)",
			border: "1px solid rgba(255,255,255,0.09)",
			boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
		},
		shell: {
			background: "rgba(8, 13, 24, 0.58)",
			boxShadow:
				"0 40px 100px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.11)",
		},
		copyButton: {
			background: "rgba(129,158,255,0.09)",
			boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
		},
		primaryButton: {
			background:
				"linear-gradient(135deg, rgba(80,223,190,1) 0%, rgba(94,153,255,1) 52%, rgba(179,110,255,1) 100%)",
			boxShadow:
				"0 16px 30px rgba(108,160,255,0.22), inset 0 1px 0 rgba(255,255,255,0.28)",
		},
		exportFrameFill: "rgba(7, 12, 24, 0.84)",
		exportFrameStroke: "rgba(255,255,255,0.15)",
		exportTopBarFill: "rgba(133,166,255,0.08)",
		exportGlow: "rgba(122, 162, 255, 0.3)",
		exportAccent: "#8FE8DA",
		exportDecorFill: "rgba(133,166,255,0.12)",
	},
	ember: {
		label: "余烬",
		swatch: "linear-gradient(135deg, #ffb26b, #ff7a7a, #7d4dff)",
		appBackground:
			"radial-gradient(circle at 20% 18%, rgba(255,178,107,0.18), transparent 24%), radial-gradient(circle at 78% 16%, rgba(255,122,122,0.18), transparent 24%), linear-gradient(180deg, #1a1212 0%, #120d10 45%, #0d0910 100%)",
		gridOpacity: 0.24,
		frameless: false,
		surface: {
			background: "rgba(28, 15, 18, 0.8)",
			backdropFilter: "blur(26px) saturate(150%)",
			WebkitBackdropFilter: "blur(26px) saturate(150%)",
			boxShadow:
				"0 22px 60px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.06)",
		},
		group: {
			background: "rgba(255,152,112,0.07)",
			border: "1px solid rgba(255,255,255,0.07)",
			boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
		},
		shell: {
			background: "rgba(22, 10, 12, 0.66)",
			boxShadow:
				"0 40px 100px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.1)",
		},
		copyButton: {
			background: "rgba(255,164,122,0.08)",
			boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
		},
		primaryButton: {
			background:
				"linear-gradient(135deg, rgba(255,176,88,1) 0%, rgba(255,111,111,1) 58%, rgba(166,99,255,1) 100%)",
			boxShadow:
				"0 16px 30px rgba(255,122,122,0.22), inset 0 1px 0 rgba(255,255,255,0.24)",
		},
		exportFrameFill: "rgba(24, 10, 14, 0.88)",
		exportFrameStroke: "rgba(255,255,255,0.12)",
		exportTopBarFill: "rgba(255,180,120,0.08)",
		exportGlow: "rgba(255, 128, 96, 0.28)",
		exportAccent: "#FFB26B",
		exportDecorFill: "rgba(255,176,88,0.12)",
	},
	borderless: {
		label: "无边框",
		swatch: "linear-gradient(135deg, #f4f7fb, #d8e6ff 55%, #dff7ef)",
		appBackground:
			"radial-gradient(circle at top, rgba(255,255,255,0.72), transparent 30%), radial-gradient(circle at 22% 18%, rgba(120,170,255,0.16), transparent 24%), linear-gradient(180deg, #eef3f9 0%, #e7edf5 44%, #dde6f0 100%)",
		gridOpacity: 0.12,
		frameless: true,
		surface: {
			background: "rgba(255,255,255,0.74)",
			backdropFilter: "blur(24px) saturate(140%)",
			WebkitBackdropFilter: "blur(24px) saturate(140%)",
			boxShadow:
				"0 22px 60px rgba(24,42,68,0.1), inset 0 1px 0 rgba(255,255,255,0.72)",
		},
		group: {
			background: "rgba(255,255,255,0.42)",
			border: "1px solid rgba(114,134,168,0.14)",
			boxShadow: "inset 0 1px 0 rgba(255,255,255,0.55)",
		},
		shell: {
			background: "transparent",
			boxShadow: "none",
		},
		copyButton: {
			background: "rgba(255,255,255,0.48)",
			boxShadow: "inset 0 1px 0 rgba(255,255,255,0.65)",
		},
		primaryButton: {
			background:
				"linear-gradient(180deg, rgba(112,189,255,1) 0%, rgba(78,146,255,1) 100%)",
			boxShadow:
				"0 14px 28px rgba(78,146,255,0.24), inset 0 1px 0 rgba(255,255,255,0.34)",
		},
		exportFrameFill: "rgba(255,255,255,0.78)",
		exportFrameStroke: "rgba(160,180,208,0.18)",
		exportTopBarFill: "rgba(255,255,255,0.62)",
		exportGlow: "rgba(122, 176, 255, 0.2)",
		exportAccent: "#6CA8FF",
		exportDecorFill: "rgba(124,156,206,0.18)",
	},
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function drawArrow(
	ctx: CanvasRenderingContext2D,
	from: [number, number],
	to: [number, number],
	color: string,
	width: number,
) {
	const dx = to[0] - from[0];
	const dy = to[1] - from[1];
	const len = Math.sqrt(dx * dx + dy * dy);
	if (len < 2) return;

	ctx.strokeStyle = color;
	ctx.fillStyle = color;
	ctx.lineWidth = width;
	ctx.lineCap = "round";

	ctx.beginPath();
	ctx.moveTo(from[0], from[1]);
	ctx.lineTo(to[0], to[1]);
	ctx.stroke();

	const angle = Math.atan2(dy, dx);
	const headLen = Math.max(12, width * 4);
	ctx.beginPath();
	ctx.moveTo(to[0], to[1]);
	ctx.lineTo(
		to[0] - headLen * Math.cos(angle - Math.PI / 6),
		to[1] - headLen * Math.sin(angle - Math.PI / 6),
	);
	ctx.lineTo(
		to[0] - headLen * Math.cos(angle + Math.PI / 6),
		to[1] - headLen * Math.sin(angle + Math.PI / 6),
	);
	ctx.closePath();
	ctx.fill();
}

function applyMosaic(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	blockSize: number,
	srcImg: HTMLImageElement,
	pixelCanvas: HTMLCanvasElement,
) {
	const tile = Math.max(8, Math.round(blockSize));
	const rectX = w >= 0 ? x : x + w;
	const rectY = h >= 0 ? y : y + h;
	const rectW = Math.abs(w);
	const rectH = Math.abs(h);
	const minPreviewSize = tile * 2;
	const previewX = rectW < 2 ? rectX - minPreviewSize / 2 : rectX;
	const previewY = rectH < 2 ? rectY - minPreviewSize / 2 : rectY;
	const previewW = rectW < 2 ? minPreviewSize : rectW;
	const previewH = rectH < 2 ? minPreviewSize : rectH;

	const imgX = Math.max(0, Math.floor(previewX));
	const imgY = Math.max(0, Math.floor(previewY));
	const imgRight = Math.min(
		srcImg.naturalWidth,
		Math.ceil(previewX + previewW),
	);
	const imgBottom = Math.min(
		srcImg.naturalHeight,
		Math.ceil(previewY + previewH),
	);
	const sourceWidth = imgRight - imgX;
	const sourceHeight = imgBottom - imgY;
	if (sourceWidth <= 0 || sourceHeight <= 0) return;

	const columns = Math.max(1, Math.ceil(sourceWidth / tile));
	const rows = Math.max(1, Math.ceil(sourceHeight / tile));
	if (pixelCanvas.width < columns || pixelCanvas.height < rows) {
		const nextPowerOfTwo = (value: number) =>
			2 ** Math.ceil(Math.log2(Math.max(1, value)));
		pixelCanvas.width = Math.max(
			pixelCanvas.width,
			nextPowerOfTwo(columns),
		);
		pixelCanvas.height = Math.max(
			pixelCanvas.height,
			nextPowerOfTwo(rows),
		);
	}
	const pixelContext = pixelCanvas.getContext("2d");
	if (!pixelContext) return;

	pixelContext.clearRect(0, 0, columns, rows);
	pixelContext.imageSmoothingEnabled = false;
	const fullColumns = Math.floor(sourceWidth / tile);
	const fullRows = Math.floor(sourceHeight / tile);
	const partialWidth = sourceWidth - fullColumns * tile;
	const partialHeight = sourceHeight - fullRows * tile;

	if (fullColumns > 0 && fullRows > 0) {
		pixelContext.drawImage(
			srcImg,
			imgX,
			imgY,
			fullColumns * tile,
			fullRows * tile,
			0,
			0,
			fullColumns,
			fullRows,
		);
	}
	if (partialWidth > 0 && fullRows > 0) {
		pixelContext.drawImage(
			srcImg,
			imgX + fullColumns * tile,
			imgY,
			partialWidth,
			fullRows * tile,
			fullColumns,
			0,
			1,
			fullRows,
		);
	}
	if (partialHeight > 0 && fullColumns > 0) {
		pixelContext.drawImage(
			srcImg,
			imgX,
			imgY + fullRows * tile,
			fullColumns * tile,
			partialHeight,
			0,
			fullRows,
			fullColumns,
			1,
		);
	}
	if (partialWidth > 0 && partialHeight > 0) {
		pixelContext.drawImage(
			srcImg,
			imgX + fullColumns * tile,
			imgY + fullRows * tile,
			partialWidth,
			partialHeight,
			fullColumns,
			fullRows,
			1,
			1,
		);
	}

	ctx.save();
	ctx.beginPath();
	ctx.rect(imgX, imgY, sourceWidth, sourceHeight);
	ctx.clip();
	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(
		pixelCanvas,
		0,
		0,
		columns,
		rows,
		imgX,
		imgY,
		columns * tile,
		rows * tile,
	);
	ctx.restore();
}

function drawOp(
	ctx: CanvasRenderingContext2D,
	op: DrawOp,
	srcImg: HTMLImageElement,
	getMosaicCanvas: () => HTMLCanvasElement,
) {
	ctx.save();
	try {
		switch (op.type) {
			case "pen":
				if (op.points.length < 2) return;
				ctx.strokeStyle = op.color;
				ctx.lineWidth = op.width;
				ctx.lineCap = "round";
				ctx.lineJoin = "round";
				ctx.beginPath();
				ctx.moveTo(op.points[0][0], op.points[0][1]);
				for (let i = 1; i < op.points.length; i++) {
					ctx.lineTo(op.points[i][0], op.points[i][1]);
				}
				ctx.stroke();
				break;
			case "arrow":
				drawArrow(ctx, op.from, op.to, op.color, op.width);
				break;
			case "rect":
				ctx.strokeStyle = op.color;
				ctx.lineWidth = op.width;
				ctx.beginPath();
				ctx.strokeRect(op.x, op.y, op.w, op.h);
				break;
			case "text":
				ctx.font = `bold ${op.size}px system-ui`;
				ctx.fillStyle = op.color;
				ctx.shadowColor = "rgba(0,0,0,0.5)";
				ctx.shadowBlur = 3;
				ctx.fillText(op.text, op.x, op.y);
				break;
			case "mosaic":
				applyMosaic(
					ctx,
					op.x,
					op.y,
					op.w,
					op.h,
					op.blockSize,
					srcImg,
					getMosaicCanvas(),
				);
				break;
		}
	} finally {
		ctx.restore();
	}
}

function cloneDrawOp(op: DrawOp): DrawOp {
	if (op.type === "pen") {
		return { ...op, points: op.points.map(([x, y]) => [x, y]) };
	}
	return { ...op };
}

function isMeaningfulDrawOp(op: DrawOp) {
	switch (op.type) {
		case "pen":
			return op.points.some(([x, y], index) => {
				if (index === 0) return false;
				const [previousX, previousY] = op.points[index - 1];
				return Math.hypot(x - previousX, y - previousY) >= 1;
			});
		case "arrow":
			return Math.hypot(op.to[0] - op.from[0], op.to[1] - op.from[1]) >= 1;
		case "rect":
		case "mosaic":
			return Math.abs(op.w) >= 1 && Math.abs(op.h) >= 1;
		case "text":
			return op.text.trim().length > 0;
	}
}

function drawPenSegment(
	ctx: CanvasRenderingContext2D,
	points: [number, number][],
	startIndex: number,
	color: string,
	width: number,
) {
	if (points.length < 2) return;
	const safeStartIndex = Math.max(1, startIndex);
	if (safeStartIndex >= points.length) return;
	ctx.save();
	ctx.strokeStyle = color;
	ctx.lineWidth = width;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	ctx.beginPath();
	ctx.moveTo(points[safeStartIndex - 1][0], points[safeStartIndex - 1][1]);
	for (let index = safeStartIndex; index < points.length; index += 1) {
		ctx.lineTo(points[index][0], points[index][1]);
	}
	ctx.stroke();
	ctx.restore();
}

function getPreviewCanvasBackingSize(
	canvas: HTMLCanvasElement,
): CanvasBackingSize | null {
	const rect = canvas.getBoundingClientRect();
	return calculateCanvasBackingSize(
		rect.width,
		rect.height,
		window.devicePixelRatio || 1,
		MAX_PREVIEW_CANVAS_DIMENSION,
		MAX_PREVIEW_CANVAS_PIXELS,
	);
}

function resetAnnotationCanvas(
	canvas: HTMLCanvasElement,
	img: HTMLImageElement,
	backingSize?: CanvasBackingSize,
) {
	if (!img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0) {
		return null;
	}
	const nextSize = backingSize ?? getPreviewCanvasBackingSize(canvas);
	if (!nextSize) return null;

	if (
		canvas.width !== nextSize.width ||
		canvas.height !== nextSize.height
	) {
		canvas.width = nextSize.width;
		canvas.height = nextSize.height;
	}
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;

	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	ctx.setTransform(
		canvas.width / img.naturalWidth,
		0,
		0,
		canvas.height / img.naturalHeight,
		0,
		0,
	);
	return ctx;
}

function releaseCanvas(canvas: HTMLCanvasElement | null) {
	if (!canvas || (canvas.width === 0 && canvas.height === 0)) return;
	canvas.width = 0;
	canvas.height = 0;
}

function drawGradient(
	ctx: CanvasRenderingContext2D,
	w: number,
	h: number,
	stops: [string, string],
	angle: number,
) {
	const rad = ((angle - 90) * Math.PI) / 180;
	const len = Math.sqrt(w * w + h * h) / 2;
	const cx = w / 2,
		cy = h / 2;
	const grad = ctx.createLinearGradient(
		cx - Math.cos(rad) * len,
		cy - Math.sin(rad) * len,
		cx + Math.cos(rad) * len,
		cy + Math.sin(rad) * len,
	);
	grad.addColorStop(0, stops[0]);
	grad.addColorStop(1, stops[1]);
	ctx.fillStyle = grad;
	ctx.fillRect(0, 0, w, h);
}

function drawImageCover(
	ctx: CanvasRenderingContext2D,
	image: HTMLImageElement,
	targetWidth: number,
	targetHeight: number,
) {
	const sourceWidth = image.naturalWidth || image.width;
	const sourceHeight = image.naturalHeight || image.height;
	if (sourceWidth <= 0 || sourceHeight <= 0) return;
	const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
	const cropWidth = targetWidth / scale;
	const cropHeight = targetHeight / scale;
	const cropX = (sourceWidth - cropWidth) / 2;
	const cropY = (sourceHeight - cropHeight) / 2;
	ctx.drawImage(
		image,
		cropX,
		cropY,
		cropWidth,
		cropHeight,
		0,
		0,
		targetWidth,
		targetHeight,
	);
}

async function canvasToPngBuffer(canvas: HTMLCanvasElement) {
	let blob: Blob | null;
	try {
		blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, "image/png"),
		);
	} finally {
		canvas.width = 0;
		canvas.height = 0;
	}
	if (!blob) return null;
	return blob.arrayBuffer();
}

function fillRoundedRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
	fillStyle: string,
) {
	ctx.save();
	ctx.fillStyle = fillStyle;
	ctx.beginPath();
	ctx.roundRect(x, y, w, h, r);
	ctx.fill();
	ctx.restore();
}

function strokeRoundedRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
	strokeStyle: string,
	lineWidth: number,
) {
	ctx.save();
	ctx.strokeStyle = strokeStyle;
	ctx.lineWidth = lineWidth;
	ctx.beginPath();
	ctx.roundRect(x, y, w, h, r);
	ctx.stroke();
	ctx.restore();
}

function drawRotatedPanel(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
	rotation: number,
	fillStyle: string,
	shadowColor: string,
) {
	ctx.save();
	ctx.translate(x + w / 2, y + h / 2);
	ctx.rotate(rotation);
	ctx.shadowColor = shadowColor;
	ctx.shadowBlur = 34;
	ctx.shadowOffsetY = 18;
	ctx.fillStyle = fillStyle;
	ctx.beginPath();
	ctx.roundRect(-w / 2, -h / 2, w, h, r);
	ctx.fill();
	ctx.restore();
}

function getFileName(path?: string) {
	if (!path) return undefined;
	return path.split(/[\\/]/).pop() || path;
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function normalizeWatermarkOpacity(value: number) {
	const rounded = Math.round(value);
	return Number.isFinite(rounded)
		? clamp(rounded, MIN_WATERMARK_OPACITY, MAX_WATERMARK_OPACITY)
		: DEFAULT_WATERMARK_OPACITY;
}

function ensureWatermarkReadableOpacity(value: number) {
	return Math.max(normalizeWatermarkOpacity(value), DEFAULT_WATERMARK_OPACITY);
}

function hexToRgb(color: string) {
	const normalized = color.trim().replace("#", "");
	const hex =
		normalized.length === 3
			? normalized
					.split("")
					.map((part) => `${part}${part}`)
					.join("")
			: normalized;
	if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
		return null;
	}
	const value = Number.parseInt(hex, 16);
	return {
		r: (value >> 16) & 255,
		g: (value >> 8) & 255,
		b: value & 255,
	};
}

function isLightColor(color: string) {
	const rgb = hexToRgb(color);
	if (!rgb) return true;
	const luminance =
		(0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
	return luminance >= 0.62;
}

function withAlpha(color: string, alpha: number) {
	const clampedAlpha = clamp(alpha, 0, 1);
	const rgb = hexToRgb(color);
	if (rgb) {
		return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clampedAlpha})`;
	}

	const match = color.match(/rgba?\(([^)]+)\)/i);
	if (!match) {
		return color;
	}

	const [r = "255", g = "255", b = "255"] = match[1]
		.split(",")
		.map((part) => part.trim());
	return `rgba(${r}, ${g}, ${b}, ${clampedAlpha})`;
}

function getWatermarkOutlineColor(color: string) {
	return isLightColor(color) ? "rgba(0,0,0,0.46)" : "rgba(255,255,255,0.52)";
}

function getWatermarkMetrics(imageWidth: number, imageHeight: number) {
	return {
		fontSize: clamp(Math.round(imageWidth * 0.024), 16, 30),
		right: clamp(Math.round(imageWidth * 0.032), 18, 42),
		bottom: clamp(Math.round(imageHeight * 0.04), 18, 36),
		maxWidth: Math.round(imageWidth * 0.42),
	};
}

function getWatermarkFont(size: number) {
	return `600 ${size}px "SF Pro Display", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif`;
}

function getWatermarkPalette(
	requestedColor: string,
	backgroundLuminance: number | null,
): WatermarkPalette {
	const fill =
		requestedColor === AUTO_WATERMARK_COLOR
			? backgroundLuminance !== null && backgroundLuminance >= 0.58
				? "#111827"
				: "#F8FAFC"
			: requestedColor;
	return {
		fill,
		outline: getWatermarkOutlineColor(fill),
	};
}

function truncateTextToWidth(
	ctx: CanvasRenderingContext2D,
	text: string,
	maxWidth: number,
) {
	if (ctx.measureText(text).width <= maxWidth) {
		return text;
	}

	const ellipsis = "…";
	let trimmed = text;
	while (trimmed.length > 1) {
		trimmed = trimmed.slice(0, -1);
		if (ctx.measureText(`${trimmed}${ellipsis}`).width <= maxWidth) {
			return `${trimmed}${ellipsis}`;
		}
	}

	return ellipsis;
}

function getWatermarkLayout(
	ctx: CanvasRenderingContext2D,
	text: string,
	imageX: number,
	imageY: number,
	imageWidth: number,
	imageHeight: number,
) {
	const metrics = getWatermarkMetrics(imageWidth, imageHeight);
	ctx.save();
	ctx.font = getWatermarkFont(metrics.fontSize);
	const textToDraw = truncateTextToWidth(ctx, text.trim(), metrics.maxWidth);
	const measured = ctx.measureText(textToDraw);
	ctx.restore();

	const ascent = Math.max(
		metrics.fontSize * 0.78,
		measured.actualBoundingBoxAscent || 0,
	);
	const descent = Math.max(
		metrics.fontSize * 0.2,
		measured.actualBoundingBoxDescent || 0,
	);
	const textWidth = Math.min(measured.width, metrics.maxWidth);
	const anchorX = imageX + imageWidth - metrics.right;
	const anchorY = imageY + imageHeight - metrics.bottom;
	const sampleInsetX = clamp(Math.round(metrics.fontSize * 0.35), 6, 12);
	const sampleInsetY = clamp(Math.round(metrics.fontSize * 0.24), 4, 8);
	const boxWidth = Math.ceil(textWidth) + sampleInsetX * 2;
	const boxHeight = Math.ceil(ascent + descent) + sampleInsetY * 2;
	const boxX = anchorX - boxWidth;
	const boxY = anchorY - ascent - sampleInsetY;
	return {
		metrics,
		text: textToDraw,
		anchorX,
		anchorY,
		boxX,
		boxY,
		boxWidth,
		boxHeight,
	};
}

function getAverageLuminance(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	height: number,
) {
	const safeX = Math.max(0, Math.floor(x));
	const safeY = Math.max(0, Math.floor(y));
	const safeWidth = Math.max(
		1,
		Math.min(Math.ceil(width), ctx.canvas.width - safeX),
	);
	const safeHeight = Math.max(
		1,
		Math.min(Math.ceil(height), ctx.canvas.height - safeY),
	);
	try {
		const data = ctx.getImageData(safeX, safeY, safeWidth, safeHeight).data;
		let total = 0;
		let count = 0;
		for (let i = 0; i < data.length; i += 16) {
			const alpha = data[i + 3] / 255;
			if (alpha <= 0) continue;
			total +=
				((0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) /
					255) *
				alpha;
			count += 1;
		}
		return count > 0 ? total / count : null;
	} catch {
		return null;
	}
}

function samplePreviewWatermarkLuminance(
	img: HTMLImageElement,
	annoCanvas: HTMLCanvasElement | null,
	text: string,
) {
	if (!img.complete || img.naturalWidth === 0) return null;
	const measureCanvas = document.createElement("canvas");
	measureCanvas.width = 1;
	measureCanvas.height = 1;
	const measureContext = measureCanvas.getContext("2d");
	if (!measureContext) return null;
	const layout = getWatermarkLayout(
		measureContext,
		text,
		0,
		0,
		img.naturalWidth,
		img.naturalHeight,
	);
	const sourceX = Math.max(0, Math.floor(layout.boxX));
	const sourceY = Math.max(0, Math.floor(layout.boxY));
	const sourceWidth = Math.max(
		1,
		Math.min(Math.ceil(layout.boxWidth), img.naturalWidth - sourceX),
	);
	const sourceHeight = Math.max(
		1,
		Math.min(Math.ceil(layout.boxHeight), img.naturalHeight - sourceY),
	);
	const sampleScale = Math.min(1, 320 / sourceWidth, 96 / sourceHeight);
	const sampleCanvas = document.createElement("canvas");
	sampleCanvas.width = Math.max(1, Math.ceil(sourceWidth * sampleScale));
	sampleCanvas.height = Math.max(1, Math.ceil(sourceHeight * sampleScale));
	const sampleCtx = sampleCanvas.getContext("2d");
	if (!sampleCtx) return null;
	sampleCtx.drawImage(
		img,
		sourceX,
		sourceY,
		sourceWidth,
		sourceHeight,
		0,
		0,
		sampleCanvas.width,
		sampleCanvas.height,
	);
	if (annoCanvas) {
		const annotationScaleX = annoCanvas.width / img.naturalWidth;
		const annotationScaleY = annoCanvas.height / img.naturalHeight;
		if (annotationScaleX > 0 && annotationScaleY > 0) {
			sampleCtx.drawImage(
				annoCanvas,
				sourceX * annotationScaleX,
				sourceY * annotationScaleY,
				sourceWidth * annotationScaleX,
				sourceHeight * annotationScaleY,
				0,
				0,
				sampleCanvas.width,
				sampleCanvas.height,
			);
		}
	}
	return getAverageLuminance(
		sampleCtx,
		0,
		0,
		sampleCanvas.width,
		sampleCanvas.height,
	);
}

function getWatermarkAlphaSet(opacity: number) {
	const text = normalizeWatermarkOpacity(opacity) / 100;
	return {
		text,
		stroke: clamp(text * 0.82, 0, 0.7),
	};
}

function getTextOpFromInput(
	textInput: { x: number; y: number; value: string },
	color: string,
): DrawOp | null {
	if (!textInput.value.trim()) return null;
	return {
		type: "text",
		x: textInput.x,
		y: textInput.y,
		text: textInput.value,
		color,
		size: 20,
	};
}

function AnnotationTextInput({
	style,
	color,
	onDraftChange,
	onCommit,
	onCancel,
}: {
	style: React.CSSProperties;
	color: string;
	onDraftChange: (value: string) => void;
	onCommit: (value: string) => void;
	onCancel: () => void;
}) {
	const [draft, setDraft] = useState("");
	const finishedRef = useRef(false);

	const commit = () => {
		if (finishedRef.current) return;
		finishedRef.current = true;
		onCommit(draft);
	};

	return (
		<input
			autoFocus
			value={draft}
			onChange={(event) => {
				const nextValue = event.target.value;
				setDraft(nextValue);
				onDraftChange(nextValue);
			}}
			onKeyDown={(event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					commit();
				}
				if (event.key === "Escape") {
					event.preventDefault();
					event.stopPropagation();
					finishedRef.current = true;
					onCancel();
				}
			}}
			onBlur={commit}
			style={{
				position: "absolute",
				...style,
				background: "rgba(7,10,16,0.18)",
				border: "none",
				borderBottom: `2px solid ${color}`,
				outline: "none",
				color,
				fontSize: 20,
				fontWeight: "bold",
				minWidth: 60,
				fontFamily: "system-ui",
				backdropFilter: "blur(8px)",
			}}
			aria-label="输入标注文字"
		/>
	);
}

function drawWatermarkSignature(
	ctx: CanvasRenderingContext2D,
	text: string,
	imageX: number,
	imageY: number,
	imageWidth: number,
	imageHeight: number,
	opacity: number,
	fillColor: string,
) {
	const content = text.trim();
	if (!content) return;

	const layout = getWatermarkLayout(
		ctx,
		content,
		imageX,
		imageY,
		imageWidth,
		imageHeight,
	);
	const backgroundLuminance = getAverageLuminance(
		ctx,
		layout.boxX,
		layout.boxY,
		layout.boxWidth,
		layout.boxHeight,
	);
	const palette = getWatermarkPalette(fillColor, backgroundLuminance);
	const alphaSet = getWatermarkAlphaSet(opacity);

	ctx.save();
	ctx.font = getWatermarkFont(layout.metrics.fontSize);
	ctx.textAlign = "right";
	ctx.textBaseline = "bottom";
	ctx.globalAlpha = alphaSet.text;
	ctx.fillStyle = palette.fill;
	ctx.strokeStyle = withAlpha(palette.outline, alphaSet.stroke);
	ctx.lineWidth = clamp(layout.metrics.fontSize * 0.08, 0.9, 1.8);
	ctx.lineJoin = "round";
	ctx.miterLimit = 2;
	ctx.strokeText(
		layout.text,
		layout.anchorX,
		layout.anchorY,
		layout.metrics.maxWidth,
	);
	ctx.fillText(
		layout.text,
		layout.anchorX,
		layout.anchorY,
		layout.metrics.maxWidth,
	);
	ctx.restore();
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ScreenshotPreview() {
	const [screenshotSrc, setScreenshotSrc] = useState<string>("");
	const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
	const [imageLoaded, setImageLoaded] = useState(false);
	const [compositionPreviewReady, setCompositionPreviewReady] = useState(false);
	const [previewDevicePixelRatio, setPreviewDevicePixelRatio] = useState(
		() => window.devicePixelRatio || 1,
	);
	const [chromeStyle, setChromeStyle] = useState<ChromeStyle>(() => {
		if (typeof window === "undefined") return "glass";
		const stored = window.localStorage.getItem(CHROME_STYLE_STORAGE_KEY);
		if (stored && stored in CHROME_THEMES) {
			return stored as ChromeStyle;
		}
		return "glass";
	});
	const [watermarkText, setWatermarkText] = useState(() => {
		if (typeof window === "undefined") return "";
		return window.localStorage.getItem(WATERMARK_TEXT_STORAGE_KEY) || "";
	});
	const [watermarkEnabled, setWatermarkEnabled] = useState(() => {
		if (typeof window === "undefined") return false;
		return window.localStorage.getItem(WATERMARK_ENABLED_STORAGE_KEY) === "1";
	});
	const [watermarkOpacity, setWatermarkOpacity] = useState(() => {
		if (typeof window === "undefined") return DEFAULT_WATERMARK_OPACITY;
		const storedValue = window.localStorage.getItem(WATERMARK_OPACITY_STORAGE_KEY);
		if (storedValue === null) return DEFAULT_WATERMARK_OPACITY;
		const stored = Number(storedValue);
		return Number.isFinite(stored)
			? normalizeWatermarkOpacity(stored)
			: DEFAULT_WATERMARK_OPACITY;
	});
	const [watermarkColor, setWatermarkColor] = useState(() => {
		if (typeof window === "undefined") return DEFAULT_WATERMARK_COLOR;
		return (
			window.localStorage.getItem(WATERMARK_COLOR_STORAGE_KEY) ||
			DEFAULT_WATERMARK_COLOR
		);
	});
	const [previewWatermarkPalette, setPreviewWatermarkPalette] =
		useState<WatermarkPalette>(() =>
			getWatermarkPalette(DEFAULT_WATERMARK_COLOR, null),
		);
	const [tool, setTool] = useState<Tool>("pen");
	const [color, setColor] = useState("#FF3B30");
	const [brushSize, setBrushSize] = useState(1); // index into BRUSH_SIZES
	const [bg, setBg] = useState<BgType>(GRADIENTS[4]);
	const [backgroundPadding, setBackgroundPadding] = useState(() => {
		if (typeof window === "undefined") return DEFAULT_BACKGROUND_PADDING;
		const storedValue = window.localStorage.getItem(
			BACKGROUND_PADDING_STORAGE_KEY,
		);
		if (storedValue === null || storedValue.trim() === "") {
			return DEFAULT_BACKGROUND_PADDING;
		}
		return normalizeBackgroundPadding(Number(storedValue));
	});
	const [bgSrc, setBgSrc] = useState<string>("");
	const [wallpaperThumbnailSrcs, setWallpaperThumbnailSrcs] = useState<
		Record<string, string>
	>({});
	const [ops, setOps] = useState<DrawOp[]>([]);
	const [textInput, setTextInput] = useState<{ x: number; y: number; value: string } | null>(null);
	const [actionToast, setActionToast] = useState<ActionToast | null>(null);
	const [textPanelOpen, setTextPanelOpen] = useState(false);
	const [previewViewportSize, setPreviewViewportSize] = useState({
		w: Math.max(1, window.innerWidth - 32),
		h: Math.max(1, window.innerHeight - 136),
	});

	const canvasRef = useRef<HTMLCanvasElement>(null);
	const activeCanvasRef = useRef<HTMLCanvasElement>(null);
	const compositionCanvasRef = useRef<HTMLCanvasElement>(null);
	const imgRef = useRef<HTMLImageElement>(null);
	const previewViewportRef = useRef<HTMLDivElement>(null);
	const toastTimerRef = useRef<number | null>(null);
	const pendingOpRef = useRef<DrawOp | null>(null);
	const isDrawingRef = useRef(false);
	const annotationFrameRef = useRef<number | null>(null);
	const resizeFrameRef = useRef<number | null>(null);
	const activeCanvasReleaseTimerRef = useRef<number | null>(null);
	const renderedPenPointCountRef = useRef(0);
	const committedRenderStateRef = useRef({
		opCount: 0,
		source: "",
		naturalWidth: 0,
		naturalHeight: 0,
	});
	const canvasCoordinateSpaceRef = useRef<{
		left: number;
		top: number;
		width: number;
		height: number;
		naturalWidth: number;
		naturalHeight: number;
	} | null>(null);
	const mosaicCanvasRef = useRef<HTMLCanvasElement | null>(null);
	const screenshotObjectUrlRef = useRef<string | null>(null);
	const screenshotBlobRef = useRef<Blob | null>(null);
	const textPanelTriggerRef = useRef<HTMLButtonElement>(null);
	const textInputDraftRef = useRef("");
	const previewSessionIdRef = useRef<number | null>(null);
	const previewReadySentRef = useRef(false);
	const wallpaperImageCacheRef = useRef<{
		src: string;
		promise: Promise<HTMLImageElement>;
	} | null>(null);
	const wallpaperAssetRequestRef = useRef<{
		value: string;
		promise: Promise<string>;
	} | null>(null);
	const exportInProgressRef = useRef(false);
	const compositionRenderRequestRef = useRef(0);
	const chromeTheme = CHROME_THEMES[chromeStyle];
	const isBorderless = chromeTheme.frameless;
	const previewChromeTheme = isBorderless ? CHROME_THEMES.glass : chromeTheme;
	const stageChromeTheme = chromeTheme;
	const previewIsBorderless = stageChromeTheme.frameless;
	const watermarkContent = watermarkText.trim();
	const showWatermark = watermarkEnabled && watermarkContent.length > 0;
	const watermarkAlphaSet = getWatermarkAlphaSet(watermarkOpacity);
	const getMosaicCanvas = useCallback(() => {
		if (!mosaicCanvasRef.current) {
			const canvas = document.createElement("canvas");
			canvas.width = 1;
			canvas.height = 1;
			mosaicCanvasRef.current = canvas;
		}
		return mosaicCanvasRef.current;
	}, []);

	useEffect(() => {
		let cancelled = false;
		let pendingObjectUrl: string | null = null;
		const searchParams = new URLSearchParams(window.location.search);
		const sessionId = Number(searchParams.get("sessionId"));

		const loadPreviewSession = async () => {
			if (!Number.isInteger(sessionId)) {
				window.close();
				return;
			}

			try {
				const payload = await window.electronAPI.getPreviewSession(sessionId);
				if (!payload.success || !payload.imageBytes || cancelled) {
					if (!cancelled) window.close();
					return;
				}

				const screenshotBlob = createPngBlob(payload.imageBytes);
				pendingObjectUrl = URL.createObjectURL(screenshotBlob);
				if (cancelled) return;
				if (screenshotObjectUrlRef.current) {
					URL.revokeObjectURL(screenshotObjectUrlRef.current);
				}
				screenshotObjectUrlRef.current = pendingObjectUrl;
				screenshotBlobRef.current = screenshotBlob;
				pendingObjectUrl = null;
				previewSessionIdRef.current = sessionId;
				previewReadySentRef.current = false;
				setImageLoaded(false);
				setNaturalSize({ w: 0, h: 0 });
				setScreenshotSrc(screenshotObjectUrlRef.current);
			} catch (error) {
				console.error("QuickShot preview failed to load", error);
				if (!cancelled) window.close();
			}
		};

		void loadPreviewSession();
		return () => {
			cancelled = true;
			previewSessionIdRef.current = null;
			previewReadySentRef.current = false;
			screenshotBlobRef.current = null;
			if (pendingObjectUrl) {
				URL.revokeObjectURL(pendingObjectUrl);
				pendingObjectUrl = null;
			}
			if (screenshotObjectUrlRef.current) {
				URL.revokeObjectURL(screenshotObjectUrlRef.current);
				screenshotObjectUrlRef.current = null;
			}
		};
	}, []);

	const handleScreenshotImageLoad = async () => {
		const image = imgRef.current;
		const objectUrl = screenshotObjectUrlRef.current;
		const sessionId = previewSessionIdRef.current;
		if (
			!image ||
			!objectUrl ||
			sessionId === null ||
			image.naturalWidth <= 0 ||
			image.naturalHeight <= 0
		) {
			window.close();
			return;
		}

		try {
			if (typeof image.decode === "function") {
				await image.decode();
			}
		} catch (error) {
			if (!image.complete || image.naturalWidth <= 0) {
				console.error("QuickShot preview image decode failed", error);
				window.close();
				return;
			}
		}

		if (
			imgRef.current !== image ||
			screenshotObjectUrlRef.current !== objectUrl ||
			previewSessionIdRef.current !== sessionId
		) {
			return;
		}

		setNaturalSize({
			w: image.naturalWidth,
			h: image.naturalHeight,
		});
		setImageLoaded(true);
		if (previewReadySentRef.current) return;
		previewReadySentRef.current = true;

		try {
			const result = await window.electronAPI.previewSessionReady(sessionId);
			if (!result.success) window.close();
		} catch (error) {
			console.error("QuickShot preview readiness failed", error);
			window.close();
		}
	};

	const handleScreenshotImageError = () => {
		if (
			!screenshotObjectUrlRef.current ||
			previewSessionIdRef.current === null
		) {
			return;
		}
		previewReadySentRef.current = true;
		console.error("QuickShot preview image failed to render");
		window.close();
	};

	useEffect(() => {
		window.localStorage.setItem(CHROME_STYLE_STORAGE_KEY, chromeStyle);
	}, [chromeStyle]);

	useEffect(() => {
		window.localStorage.setItem(
			BACKGROUND_PADDING_STORAGE_KEY,
			String(normalizeBackgroundPadding(backgroundPadding)),
		);
	}, [backgroundPadding]);

	useEffect(() => {
		window.localStorage.setItem(WATERMARK_TEXT_STORAGE_KEY, watermarkText);
	}, [watermarkText]);

	useEffect(() => {
		window.localStorage.setItem(
			WATERMARK_ENABLED_STORAGE_KEY,
			watermarkEnabled ? "1" : "0",
		);
	}, [watermarkEnabled]);

	useEffect(() => {
		window.localStorage.setItem(
			WATERMARK_OPACITY_STORAGE_KEY,
			String(normalizeWatermarkOpacity(watermarkOpacity)),
		);
	}, [watermarkOpacity]);

	useEffect(() => {
		window.localStorage.setItem(WATERMARK_COLOR_STORAGE_KEY, watermarkColor);
	}, [watermarkColor]);

	useEffect(() => {
		if (!showWatermark) {
			setPreviewWatermarkPalette(getWatermarkPalette(watermarkColor, null));
			return;
		}

		if (watermarkColor !== AUTO_WATERMARK_COLOR) {
			setPreviewWatermarkPalette(getWatermarkPalette(watermarkColor, null));
			return;
		}

		const img = imgRef.current;
		if (!imageLoaded || !img || !img.complete || img.naturalWidth === 0) {
			setPreviewWatermarkPalette(getWatermarkPalette(watermarkColor, null));
			return;
		}

		const timer = window.setTimeout(() => {
			const backgroundLuminance = samplePreviewWatermarkLuminance(
				img,
				canvasRef.current,
				watermarkContent,
			);
			setPreviewWatermarkPalette(
				getWatermarkPalette(watermarkColor, backgroundLuminance),
			);
		}, 120);
		return () => window.clearTimeout(timer);
	}, [
		imageLoaded,
		naturalSize.h,
		naturalSize.w,
		ops,
		showWatermark,
		screenshotSrc,
		watermarkColor,
		watermarkContent,
	]);

	useEffect(
		() => () => {
			if (toastTimerRef.current) {
				window.clearTimeout(toastTimerRef.current);
			}
			if (annotationFrameRef.current !== null) {
				window.cancelAnimationFrame(annotationFrameRef.current);
			}
			if (resizeFrameRef.current !== null) {
				window.cancelAnimationFrame(resizeFrameRef.current);
			}
			if (activeCanvasReleaseTimerRef.current !== null) {
				window.clearTimeout(activeCanvasReleaseTimerRef.current);
			}
			releaseCanvas(canvasRef.current);
			releaseCanvas(activeCanvasRef.current);
			releaseCanvas(compositionCanvasRef.current);
			releaseCanvas(mosaicCanvasRef.current);
			mosaicCanvasRef.current = null;
			canvasCoordinateSpaceRef.current = null;
		},
		[],
	);

	useEffect(() => {
		let cancelled = false;
		void Promise.all(
			WALLPAPERS.map(async (wallpaper) => {
				const src = await getAssetPath(wallpaper.thumbnail);
				return [wallpaper.value, src] as const;
			}),
		).then((entries) => {
			if (!cancelled) {
				setWallpaperThumbnailSrcs(Object.fromEntries(entries));
			}
		});
		return () => {
			cancelled = true;
		};
	}, []);

	const handleExtractText = useCallback(async () => {
		const screenshotBlob = screenshotBlobRef.current;
		if (!screenshotBlob) {
			throw new Error("原始截图尚未准备好");
		}

		const result = await window.electronAPI.extractText(
			await screenshotBlob.arrayBuffer(),
		);
		if (!result.success) {
			throw new Error(result.error);
		}
		return {
			text: result.text,
			lineCount: result.lineCount,
		};
	}, []);

	const handleCopyText = useCallback(async (text: string) => {
		const result = await window.electronAPI.copyTextToClipboard(text);
		if (!result.success) {
			throw new Error(result.error || "复制文本失败，请重试");
		}
	}, []);

	const handleCloseTextPanel = useCallback(() => {
		setTextPanelOpen(false);
		window.requestAnimationFrame(() => {
			textPanelTriggerRef.current?.focus();
		});
	}, []);

	// Load wallpaper bg
	useEffect(() => {
		let cancelled = false;
		wallpaperImageCacheRef.current = null;
		if (bg.kind === "wallpaper") {
			setBgSrc("");
			const request = {
				value: bg.value,
				promise: getAssetPath(bg.value, { cache: false }),
			};
			wallpaperAssetRequestRef.current = request;
			void request.promise.then((src) => {
				if (!cancelled) setBgSrc(src);
			});
		} else {
			wallpaperAssetRequestRef.current = null;
			setBgSrc("");
		}
		return () => {
			cancelled = true;
		};
	}, [bg]);

	// Moving between displays can change pixel density without changing CSS size.
	useEffect(() => {
		let resolutionQuery: MediaQueryList | null = null;
		const updatePixelRatio = () => {
			const pixelRatio = window.devicePixelRatio || 1;
			setPreviewDevicePixelRatio(pixelRatio);
			resolutionQuery?.removeEventListener("change", updatePixelRatio);
			resolutionQuery = window.matchMedia(`(resolution: ${pixelRatio}dppx)`);
			resolutionQuery.addEventListener("change", updatePixelRatio);
		};
		updatePixelRatio();
		window.addEventListener("resize", updatePixelRatio);
		return () => {
			resolutionQuery?.removeEventListener("change", updatePixelRatio);
			window.removeEventListener("resize", updatePixelRatio);
		};
	}, []);

	useLayoutEffect(() => {
		const viewport = previewViewportRef.current;
		if (!viewport) return;

		const measureViewport = () => {
			const styles = window.getComputedStyle(viewport);
			const width = Math.max(
				1,
				viewport.clientWidth -
					Number.parseFloat(styles.paddingLeft || "0") -
					Number.parseFloat(styles.paddingRight || "0"),
			);
			const height = Math.max(
				1,
				viewport.clientHeight -
					Number.parseFloat(styles.paddingTop || "0") -
					Number.parseFloat(styles.paddingBottom || "0"),
			);
			setPreviewViewportSize((current) =>
				Math.abs(current.w - width) < 0.5 &&
				Math.abs(current.h - height) < 0.5
					? current
					: { w: width, h: height },
			);
			canvasCoordinateSpaceRef.current = null;
		};
		const scheduleMeasurement = () => {
			if (resizeFrameRef.current !== null) return;
			resizeFrameRef.current = window.requestAnimationFrame(() => {
				resizeFrameRef.current = null;
				measureViewport();
			});
		};

		measureViewport();
		const observer = new ResizeObserver(scheduleMeasurement);
		observer.observe(viewport);
		return () => {
			observer.disconnect();
			if (resizeFrameRef.current !== null) {
				window.cancelAnimationFrame(resizeFrameRef.current);
				resizeFrameRef.current = null;
			}
		};
	}, []);

	const redrawActiveAnnotation = useCallback(() => {
		const canvas = activeCanvasRef.current;
		const img = imgRef.current;
		if (!canvas || !img || !img.complete || img.naturalWidth === 0) return;
		const committedCanvas = canvasRef.current;
		const backingSize =
			committedCanvas &&
			committedCanvas.width > 0 &&
			committedCanvas.height > 0
				? {
						width: committedCanvas.width,
						height: committedCanvas.height,
					}
				: undefined;
		const ctx = resetAnnotationCanvas(canvas, img, backingSize);
		if (!ctx) return;

		const pendingOp = pendingOpRef.current;
		if (!pendingOp) return;
		drawOp(ctx, pendingOp, img, getMosaicCanvas);
		if (pendingOp.type === "pen") {
			renderedPenPointCountRef.current = pendingOp.points.length;
		}
	}, [getMosaicCanvas]);

	const clearActiveAnnotationCanvas = useCallback((releaseAfterIdle = true) => {
		if (activeCanvasReleaseTimerRef.current !== null) {
			window.clearTimeout(activeCanvasReleaseTimerRef.current);
			activeCanvasReleaseTimerRef.current = null;
		}
		const canvas = activeCanvasRef.current;
		if (canvas?.width && canvas.height) {
			const context = canvas.getContext("2d");
			context?.setTransform(1, 0, 0, 1, 0, 0);
			context?.clearRect(0, 0, canvas.width, canvas.height);
		}
		if (!releaseAfterIdle) return;
		activeCanvasReleaseTimerRef.current = window.setTimeout(() => {
			activeCanvasReleaseTimerRef.current = null;
			if (!isDrawingRef.current && !pendingOpRef.current) {
				releaseCanvas(activeCanvasRef.current);
			}
		}, ACTIVE_CANVAS_IDLE_RELEASE_MS);
	}, []);

	const syncCommittedAnnotations = useCallback((forceReplay = false) => {
		const canvas = canvasRef.current;
		const img = imgRef.current;
		if (!canvas || !img || !img.complete || img.naturalWidth === 0) return;
		const backingSize = getPreviewCanvasBackingSize(canvas);
		if (!backingSize) return;

		const renderState = committedRenderStateRef.current;
		const sourceChanged =
			renderState.source !== screenshotSrc ||
			renderState.naturalWidth !== img.naturalWidth ||
			renderState.naturalHeight !== img.naturalHeight;
		const canvasResized =
			canvas.width !== backingSize.width ||
			canvas.height !== backingSize.height;
		const historyRewound = renderState.opCount > ops.length;
		const replayAll =
			forceReplay || sourceChanged || canvasResized || historyRewound;

		let committedContext: CanvasRenderingContext2D | null;
		let startIndex: number;
		if (replayAll) {
			committedContext = resetAnnotationCanvas(canvas, img, backingSize);
			startIndex = 0;
		} else {
			committedContext = canvas.getContext("2d");
			if (committedContext) {
				committedContext.setTransform(
					canvas.width / img.naturalWidth,
					0,
					0,
					canvas.height / img.naturalHeight,
					0,
					0,
				);
			}
			startIndex = renderState.opCount;
		}
		if (!committedContext) return;

		for (let index = startIndex; index < ops.length; index += 1) {
			drawOp(committedContext, ops[index], img, getMosaicCanvas);
		}

		committedRenderStateRef.current = {
			opCount: ops.length,
			source: screenshotSrc,
			naturalWidth: img.naturalWidth,
			naturalHeight: img.naturalHeight,
		};
	}, [getMosaicCanvas, ops, screenshotSrc]);

	useLayoutEffect(() => {
		syncCommittedAnnotations();
		if (pendingOpRef.current && isDrawingRef.current) {
			redrawActiveAnnotation();
		} else {
			clearActiveAnnotationCanvas();
		}
		}, [
			backgroundPadding,
			chromeStyle,
			clearActiveAnnotationCanvas,
		imageLoaded,
		naturalSize.h,
		naturalSize.w,
		previewDevicePixelRatio,
		previewViewportSize.h,
		previewViewportSize.w,
		redrawActiveAnnotation,
		screenshotSrc,
		syncCommittedAnnotations,
	]);

	const drawPendingAnnotationFrame = useCallback(() => {
		annotationFrameRef.current = null;
		const pendingOp = pendingOpRef.current;
		if (!pendingOp) return;

		if (pendingOp.type !== "pen") {
			redrawActiveAnnotation();
			return;
		}

		const canvas = activeCanvasRef.current;
		const ctx = canvas?.getContext("2d");
		if (!canvas || !ctx) return;
		drawPenSegment(
			ctx,
			pendingOp.points,
			renderedPenPointCountRef.current,
			pendingOp.color,
			pendingOp.width,
		);
		renderedPenPointCountRef.current = pendingOp.points.length;
	}, [redrawActiveAnnotation]);

	const schedulePendingAnnotationFrame = useCallback(() => {
		if (annotationFrameRef.current !== null) return;
		annotationFrameRef.current = window.requestAnimationFrame(
			drawPendingAnnotationFrame,
		);
	}, [drawPendingAnnotationFrame]);

	const refreshCanvasCoordinateSpace = () => {
		const canvas = canvasRef.current;
		const img = imgRef.current;
		if (!canvas) return null;
		const rect = canvas.getBoundingClientRect();
		const coordinateSpace = {
			left: rect.left,
			top: rect.top,
			width: rect.width,
			height: rect.height,
			naturalWidth: img?.naturalWidth || naturalSize.w,
			naturalHeight: img?.naturalHeight || naturalSize.h,
		};
		canvasCoordinateSpaceRef.current = coordinateSpace;
		return coordinateSpace;
	};

	const getCanvasCoords = (
		e: React.PointerEvent<HTMLCanvasElement>,
		refreshCoordinateSpace = false,
	): [number, number] => {
		const coordinateSpace =
			(refreshCoordinateSpace ? refreshCanvasCoordinateSpace() : null) ??
			canvasCoordinateSpaceRef.current ??
			refreshCanvasCoordinateSpace();
		if (
			!coordinateSpace ||
			coordinateSpace.width <= 0 ||
			coordinateSpace.height <= 0
		) {
			return [0, 0];
		}
		return [
			((e.clientX - coordinateSpace.left) * coordinateSpace.naturalWidth) /
				coordinateSpace.width,
			((e.clientY - coordinateSpace.top) * coordinateSpace.naturalHeight) /
				coordinateSpace.height,
		];
	};

	const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
		if (textInput) return;
		e.preventDefault();
		const pos = getCanvasCoords(e, true);
		if (tool === "text") {
			textInputDraftRef.current = "";
			setTextInput({ x: pos[0], y: pos[1], value: "" });
			return;
		}
		const committedCanvas = canvasRef.current;
		const activeCanvas = activeCanvasRef.current;
		const img = imgRef.current;
		if (
			!committedCanvas ||
			!activeCanvas ||
			!img ||
			committedCanvas.width <= 0 ||
			committedCanvas.height <= 0
			) {
				return;
			}
			clearActiveAnnotationCanvas(false);
			if (
				!resetAnnotationCanvas(activeCanvas, img, {
					width: committedCanvas.width,
				height: committedCanvas.height,
			})
			) {
				return;
			}
			e.currentTarget.setPointerCapture(e.pointerId);
			isDrawingRef.current = true;

		switch (tool) {
			case "pen":
				pendingOpRef.current = {
					type: "pen",
					points: [pos],
					color,
					width: BRUSH_SIZES[brushSize],
				};
				renderedPenPointCountRef.current = 1;
				break;
			case "arrow":
				pendingOpRef.current = {
					type: "arrow",
					from: pos,
					to: pos,
					color,
					width: BRUSH_SIZES[brushSize],
				};
				break;
			case "rect":
				pendingOpRef.current = {
					type: "rect",
					x: pos[0],
					y: pos[1],
					w: 0,
					h: 0,
					color,
					width: BRUSH_SIZES[brushSize],
				};
				break;
			case "mosaic":
				pendingOpRef.current = {
					type: "mosaic",
					x: pos[0],
					y: pos[1],
					w: 0,
					h: 0,
					blockSize: 14,
				};
				break;
		}
		if (pendingOpRef.current) {
			schedulePendingAnnotationFrame();
		}
	};

	const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
		const pendingOp = pendingOpRef.current;
		if (!isDrawingRef.current || !pendingOp) return;
		const pos = getCanvasCoords(e);
		switch (pendingOp.type) {
			case "pen":
				pendingOp.points.push(pos);
				break;
			case "arrow":
				pendingOp.to = pos;
				break;
			case "rect":
				pendingOp.w = pos[0] - pendingOp.x;
				pendingOp.h = pos[1] - pendingOp.y;
				break;
			case "mosaic":
				pendingOp.w = pos[0] - pendingOp.x;
				pendingOp.h = pos[1] - pendingOp.y;
				break;
		}
		schedulePendingAnnotationFrame();
	};

	const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
		const wasDrawing = isDrawingRef.current;
		isDrawingRef.current = false;
		if (e.currentTarget.hasPointerCapture(e.pointerId)) {
			e.currentTarget.releasePointerCapture(e.pointerId);
		}
		if (!wasDrawing) return;
		if (annotationFrameRef.current !== null) {
			window.cancelAnimationFrame(annotationFrameRef.current);
			annotationFrameRef.current = null;
		}
		const pendingOp = pendingOpRef.current;
		pendingOpRef.current = null;
		clearActiveAnnotationCanvas();
		if (pendingOp && isMeaningfulDrawOp(pendingOp)) {
			setOps((prev) => [...prev, cloneDrawOp(pendingOp)]);
		}
	};

	const handlePointerCancel = (
		e: React.PointerEvent<HTMLCanvasElement>,
	) => {
		const wasDrawing = isDrawingRef.current;
		isDrawingRef.current = false;
		if (e.currentTarget.hasPointerCapture(e.pointerId)) {
			e.currentTarget.releasePointerCapture(e.pointerId);
		}
		if (!wasDrawing) return;
		if (annotationFrameRef.current !== null) {
			window.cancelAnimationFrame(annotationFrameRef.current);
			annotationFrameRef.current = null;
		}
		pendingOpRef.current = null;
		clearActiveAnnotationCanvas();
	};

	const commitText = (draft = textInputDraftRef.current) => {
		if (!textInput) {
			setTextInput(null);
			return;
		}
		const textOp = getTextOpFromInput({ ...textInput, value: draft }, color);
		if (!textOp) {
			setTextInput(null);
			return;
		}
		setOps((prev) => [...prev, textOp]);
		textInputDraftRef.current = "";
		setTextInput(null);
	};

	const showActionToast = useCallback(
		(
			action: ActionType,
			tone: "success" | "error",
			title: string,
			detail?: string,
		) => {
			if (toastTimerRef.current) {
				window.clearTimeout(toastTimerRef.current);
			}
			setActionToast({ id: Date.now(), action, tone, title, detail });
			toastTimerRef.current = window.setTimeout(() => {
				setActionToast(null);
				toastTimerRef.current = null;
			}, 2200);
		},
		[],
	);

	// Text input display position
	const getTextInputStyle = (): React.CSSProperties => {
		const canvas = canvasRef.current;
		const img = imgRef.current;
		if (!canvas || !textInput) return {};
		const rect = canvas.getBoundingClientRect();
		const sourceWidth = img?.naturalWidth || naturalSize.w;
		const sourceHeight = img?.naturalHeight || naturalSize.h;
		if (sourceWidth <= 0 || sourceHeight <= 0) return {};
		const dispX = (textInput.x * rect.width) / sourceWidth;
		const dispY = (textInput.y * rect.height) / sourceHeight;
		return { left: dispX, top: dispY - 12 };
	};

	const getExportRenderOps = () => {
		const renderOps = ops.map(cloneDrawOp);
		const pendingOp = pendingOpRef.current;
		if (pendingOp) {
			renderOps.push(cloneDrawOp(pendingOp));
		}
		if (textInput) {
			const textOp = getTextOpFromInput(
				{ ...textInput, value: textInputDraftRef.current },
				color,
			);
			if (textOp) renderOps.push(textOp);
		}
		return renderOps;
	};

	const drawExportAnnotations = (
		ctx: CanvasRenderingContext2D,
		img: HTMLImageElement,
		renderOps: DrawOp[],
		imageX: number,
		imageY: number,
	) => {
		if (renderOps.length === 0) return;
		ctx.save();
		ctx.translate(imageX, imageY);
		ctx.beginPath();
		ctx.rect(0, 0, img.naturalWidth, img.naturalHeight);
		ctx.clip();
		for (const op of renderOps) {
			drawOp(ctx, op, img, getMosaicCanvas);
		}
		ctx.restore();
	};

	const getWallpaperImage = async (src: string) => {
		const cached = wallpaperImageCacheRef.current;
		if (cached?.src === src) return cached.promise;

		let entry: { src: string; promise: Promise<HTMLImageElement> };
		const promise = decodeImageData(src).catch((error) => {
			if (wallpaperImageCacheRef.current === entry) {
				wallpaperImageCacheRef.current = null;
			}
			throw error;
		});
		entry = { src, promise };
		wallpaperImageCacheRef.current = entry;
		return promise;
	};

	// Preview and export share the same renderer. Export stays at the screenshot's
	// natural pixel size; preview is supersampled for crisp text on 1x displays.
	const renderCompositeToCanvas = async (
		exportCanvas: HTMLCanvasElement,
		renderOps: DrawOp[],
		purpose: "export" | "pin" | "preview" = "export",
		previewScale = 1,
	): Promise<boolean> => {
		const img = imgRef.current;
		if (!img || !img.complete || img.naturalWidth === 0) return false;

		const composition = calculateScreenshotCompositionLayout(
			img.naturalWidth,
			img.naturalHeight,
			backgroundPadding,
			isBorderless,
		);
		const frameInset = composition.frameInset;
		const topBarHeight = composition.topBarHeight;
		const frameRadius = EXPORT_FRAME_RADIUS;
		const imageRadius = EXPORT_IMAGE_RADIUS;
		const frameW = composition.frameWidth;
		const frameH = composition.frameHeight;
		const frameX = composition.frameX;
		const frameY = composition.frameY;
		const imageX = composition.imageX;
		const imageY = composition.imageY;
		const W = composition.width;
		const H = composition.height;

		const backingSize =
			purpose === "pin"
				? calculateCanvasBackingSize(
						W,
						H,
						1,
						MAX_PINNED_COMPOSITE_DIMENSION,
						MAX_PINNED_COMPOSITE_PIXELS,
					)
				: purpose === "preview"
					? calculateCanvasBackingSize(
							W * previewScale,
							H * previewScale,
							Math.max(
								MIN_PREVIEW_PIXEL_RATIO,
								previewDevicePixelRatio,
							),
							Math.min(MAX_PREVIEW_CANVAS_DIMENSION, Math.max(W, H)),
							Math.min(MAX_PREVIEW_CANVAS_PIXELS, W * H),
						)
					: { width: W, height: H };
		if (!backingSize) return false;
		exportCanvas.width = backingSize.width;
		exportCanvas.height = backingSize.height;
		const ctx = exportCanvas.getContext("2d")!;
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = "high";
		ctx.setTransform(
			backingSize.width / W,
			0,
			0,
			backingSize.height / H,
			0,
			0,
		);

		// Background
		if (bg.kind === "wallpaper") {
			try {
				const request = wallpaperAssetRequestRef.current;
				const wallpaperSrc =
					request?.value === bg.value
						? await request.promise
						: await getAssetPath(bg.value, { cache: false });
				const bgImg = await getWallpaperImage(wallpaperSrc);
				drawImageCover(ctx, bgImg, W, H);
			} catch {
				ctx.fillStyle = "#0f172a";
				ctx.fillRect(0, 0, W, H);
			}
		} else if (bg.kind === "gradient") {
			drawGradient(ctx, W, H, bg.stops, bg.angle);
		} else {
			ctx.fillStyle = (bg as { kind: "solid"; value: string }).value;
			ctx.fillRect(0, 0, W, H);
		}

		if (isBorderless) {
			ctx.drawImage(img, imageX, imageY);
			drawExportAnnotations(ctx, img, renderOps, imageX, imageY);
			if (showWatermark) {
				drawWatermarkSignature(
					ctx,
					watermarkContent,
					imageX,
					imageY,
					img.naturalWidth,
					img.naturalHeight,
					watermarkOpacity,
					watermarkColor,
				);
			}

			return true;
		}

		// Keep atmosphere effects behind the captured pixels. Tinting the image
		// itself lowers text contrast and makes an otherwise lossless PNG look soft.
		ctx.save();
		const vignette = ctx.createRadialGradient(
			W / 2,
			H / 2,
			Math.min(W, H) * 0.14,
			W / 2,
			H / 2,
			Math.max(W, H) * 0.7,
		);
		vignette.addColorStop(0, "rgba(0,0,0,0)");
		vignette.addColorStop(1, "rgba(4,6,12,0.1)");
		ctx.fillStyle = vignette;
		ctx.fillRect(0, 0, W, H);
		ctx.restore();

		ctx.save();
		const stageLight = ctx.createRadialGradient(
			frameX + frameW * 0.5,
			frameY + frameH * 0.3,
			0,
			frameX + frameW * 0.5,
			frameY + frameH * 0.3,
			Math.max(frameW, frameH) * 0.88,
		);
		stageLight.addColorStop(0, "rgba(255,255,255,0.12)");
		stageLight.addColorStop(0.42, "rgba(255,255,255,0.035)");
		stageLight.addColorStop(1, "rgba(255,255,255,0)");
		ctx.fillStyle = stageLight;
		ctx.fillRect(0, 0, W, H);
		ctx.restore();

		ctx.save();
		const glow = ctx.createRadialGradient(
			frameX + frameW * 0.2,
			frameY + frameH * 0.08,
			0,
			frameX + frameW * 0.2,
			frameY + frameH * 0.08,
			Math.max(frameW, frameH) * 0.8,
		);
		glow.addColorStop(0, chromeTheme.exportGlow);
		glow.addColorStop(1, "rgba(0,0,0,0)");
		ctx.fillStyle = glow;
		ctx.fillRect(0, 0, W, H);
		ctx.restore();

		if (!isBorderless) {
			drawRotatedPanel(
				ctx,
				frameX + 8,
				frameY + 18,
				frameW - 16,
				frameH - 12,
				frameRadius + 2,
				-0.008,
				"rgba(255,255,255,0.028)",
				"rgba(0,0,0,0.1)",
			);

			ctx.save();
			const floorShadow = ctx.createRadialGradient(
				frameX + frameW / 2,
				frameY + frameH + 18,
				frameW * 0.1,
				frameX + frameW / 2,
				frameY + frameH + 18,
				frameW * 0.44,
			);
			floorShadow.addColorStop(0, "rgba(0,0,0,0.16)");
			floorShadow.addColorStop(1, "rgba(0,0,0,0)");
			ctx.fillStyle = floorShadow;
			ctx.fillRect(frameX - 30, frameY + frameH - 6, frameW + 60, 86);
			ctx.restore();

			ctx.save();
			ctx.shadowColor = "rgba(0,0,0,0.28)";
			ctx.shadowBlur = 44;
			ctx.shadowOffsetY = 14;
			fillRoundedRect(ctx, frameX, frameY, frameW, frameH, frameRadius, chromeTheme.exportFrameFill);
			ctx.restore();

			fillRoundedRect(ctx, frameX + 1, frameY + 1, frameW - 2, topBarHeight, frameRadius - 1, chromeTheme.exportTopBarFill);
			strokeRoundedRect(
				ctx,
				frameX,
				frameY,
				frameW,
				frameH,
				frameRadius,
				chromeTheme.exportFrameStroke,
				1.5,
			);

			ctx.save();
			ctx.fillStyle = "rgba(255,255,255,0.18)";
			ctx.fillRect(frameX + 24, frameY + 1, frameW - 48, 1);
			ctx.restore();

			ctx.save();
			const headerGloss = ctx.createLinearGradient(frameX, frameY, frameX, frameY + topBarHeight);
			headerGloss.addColorStop(0, "rgba(255,255,255,0.12)");
			headerGloss.addColorStop(0.7, "rgba(255,255,255,0)");
			ctx.fillStyle = headerGloss;
			ctx.beginPath();
			ctx.roundRect(frameX + 1, frameY + 1, frameW - 2, topBarHeight, frameRadius - 1);
			ctx.fill();
			ctx.restore();

			const dotY = frameY + topBarHeight / 2 + 0.5;
			const dotStartX = frameX + 26;
			const dotGap = 20;
			["#FF5F57", "#FFBD2E", "#28C840"].forEach((dot, index) => {
				ctx.save();
				ctx.fillStyle = dot;
				ctx.beginPath();
				ctx.arc(dotStartX + index * dotGap, dotY, 5.5, 0, Math.PI * 2);
				ctx.fill();
				ctx.restore();
			});

			const decorY = frameY + (topBarHeight - 16) / 2;
			const decorStartX = frameX + frameW - 88;
			for (let i = 0; i < 3; i += 1) {
				const width = i === 1 ? 24 : 12;
				const height = i === 1 ? 16 : 10;
				const x = decorStartX + i * 18;
				const y = decorY + (16 - height) / 2;
				fillRoundedRect(ctx, x, y, width, height, height / 2, chromeTheme.exportDecorFill);
			}

			ctx.save();
			const accentGlow = ctx.createLinearGradient(
				frameX + frameW - 170,
				frameY,
				frameX + frameW - 36,
				frameY + topBarHeight,
			);
			accentGlow.addColorStop(0, "rgba(255,255,255,0)");
			accentGlow.addColorStop(0.52, `${chromeTheme.exportAccent}16`);
			accentGlow.addColorStop(1, "rgba(255,255,255,0)");
			ctx.fillStyle = accentGlow;
			ctx.fillRect(frameX + frameW - 180, frameY + 4, 150, topBarHeight - 8);
			ctx.restore();

			ctx.save();
			const sideLight = ctx.createLinearGradient(
				frameX + frameW * 0.72,
				frameY + topBarHeight,
				frameX + frameW,
				frameY + frameH,
			);
			sideLight.addColorStop(0, "rgba(255,255,255,0)");
			sideLight.addColorStop(0.55, "rgba(255,255,255,0.03)");
			sideLight.addColorStop(1, "rgba(255,255,255,0.08)");
			ctx.fillStyle = sideLight;
			ctx.beginPath();
			ctx.roundRect(frameX + 1, frameY + 1, frameW - 2, frameH - 2, frameRadius - 1);
			ctx.fill();
			ctx.restore();
		}

		ctx.save();
		ctx.shadowColor = isBorderless ? "rgba(28,48,84,0.22)" : "rgba(0,0,0,0.32)";
		ctx.shadowBlur = isBorderless ? 36 : 26;
		ctx.shadowOffsetY = isBorderless ? 18 : 10;
		fillRoundedRect(
			ctx,
			imageX,
			imageY,
			img.naturalWidth,
			img.naturalHeight,
			imageRadius,
			"rgba(0,0,0,0.12)",
		);
		ctx.restore();

		ctx.save();
		ctx.beginPath();
		ctx.roundRect(imageX, imageY, img.naturalWidth, img.naturalHeight, imageRadius);
		ctx.clip();
		ctx.drawImage(img, imageX, imageY);
		drawExportAnnotations(ctx, img, renderOps, imageX, imageY);
		ctx.restore();

		if (showWatermark) {
			drawWatermarkSignature(
				ctx,
				watermarkContent,
				imageX,
				imageY,
				img.naturalWidth,
				img.naturalHeight,
				watermarkOpacity,
				watermarkColor,
			);
		}

		if (!isBorderless) {
			strokeRoundedRect(
				ctx,
				imageX,
				imageY,
				img.naturalWidth,
				img.naturalHeight,
				imageRadius,
				"rgba(255,255,255,0.12)",
				1,
			);

			ctx.save();
			ctx.beginPath();
			ctx.roundRect(imageX + 2, imageY + 2, img.naturalWidth - 4, img.naturalHeight - 4, imageRadius - 2);
			ctx.strokeStyle = "rgba(255,255,255,0.05)";
			ctx.lineWidth = 1;
			ctx.stroke();
			ctx.restore();
		}

		return true;
	};

	const getCompositeBuffer = async (
		purpose: "export" | "pin" = "export",
	): Promise<ArrayBuffer | null> => {
		const exportCanvas = document.createElement("canvas");
		const rendered = await renderCompositeToCanvas(
			exportCanvas,
			getExportRenderOps(),
			purpose,
		);
		if (!rendered) return null;
		return canvasToPngBuffer(exportCanvas);
	};

	const handleCopy = async () => {
		if (exportInProgressRef.current) return;
		exportInProgressRef.current = true;
		try {
			const buf = await getCompositeBuffer();
			if (!buf) {
				showActionToast("copy", "error", "复制失败", "导出图像生成失败");
				return;
			}
			const result = await window.electronAPI.copyToClipboard(new Uint8Array(buf));
			if (result.success) {
				showActionToast("copy", "success", "已复制到剪贴板", "可以直接粘贴分享");
				return;
			}
			showActionToast("copy", "error", "复制失败", result.error || "请重试");
		} catch (error) {
			showActionToast(
				"copy",
				"error",
				"复制失败",
					error instanceof Error ? error.message : "导出图像生成失败",
			);
		} finally {
			exportInProgressRef.current = false;
		}
	};

	const handlePin = async () => {
		if (exportInProgressRef.current) return;
		exportInProgressRef.current = true;
		try {
			const buf = await getCompositeBuffer("pin");
			if (!buf) {
				showActionToast(
					"pin",
					"error",
					"置顶失败",
					"导出图像生成失败",
				);
				return;
			}
			const result = await window.electronAPI.pinScreenshot(
				new Uint8Array(buf),
			);
			if (result.success) {
				showActionToast(
					"pin",
					"success",
					"已悬浮置顶",
					"可拖动、缩放和调节透明度",
				);
				return;
			}
			showActionToast("pin", "error", "置顶失败", result.error);
		} catch (error) {
			showActionToast(
				"pin",
				"error",
				"置顶失败",
				error instanceof Error ? error.message : "悬浮截图创建失败",
			);
		} finally {
			exportInProgressRef.current = false;
		}
	};

	const handleSave = async () => {
		if (exportInProgressRef.current) return;
		exportInProgressRef.current = true;
		try {
			const buf = await getCompositeBuffer();
			if (!buf) {
				showActionToast("save", "error", "保存失败", "导出图像生成失败");
				return;
			}
			const result = await window.electronAPI.saveScreenshotFinal(buf);
			if (result.success) {
				showActionToast("save", "success", "已保存 PNG", getFileName(result.path));
				return;
			}
			if (!result.canceled) {
				showActionToast("save", "error", "保存失败", result.error || "请重试");
			}
		} catch (error) {
			showActionToast(
				"save",
				"error",
				"保存失败",
					error instanceof Error ? error.message : "导出图像生成失败",
			);
		} finally {
			exportInProgressRef.current = false;
		}
	};

	const handleQuickSave = async () => {
		if (exportInProgressRef.current) return;
		exportInProgressRef.current = true;
		try {
			const buf = await getCompositeBuffer();
			if (!buf) {
				showActionToast("quick-save", "error", "快速保存失败", "导出图像生成失败");
				return;
			}
			const result = await window.electronAPI.quickSaveScreenshotFinal(buf);
			if (result.success) {
				showActionToast("quick-save", "success", "已保存到下载目录", getFileName(result.path));
				return;
			}
			showActionToast("quick-save", "error", "快速保存失败", result.error || "请重试");
		} catch (error) {
			showActionToast(
				"quick-save",
				"error",
				"快速保存失败",
					error instanceof Error ? error.message : "导出图像生成失败",
			);
		} finally {
			exportInProgressRef.current = false;
		}
	};

	// Keyboard shortcuts
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				if (textPanelOpen) {
					event.preventDefault();
					handleCloseTextPanel();
					return;
				}
				window.close();
				return;
			}
			if (isEditableKeyboardTarget(event.target)) return;
			if (
				(event.metaKey || event.ctrlKey) &&
				event.shiftKey &&
				event.key.toLowerCase() === "t"
			) {
				event.preventDefault();
				if (IS_MAC && imageLoaded) setTextPanelOpen(true);
				return;
			}
			if (
				(event.metaKey || event.ctrlKey) &&
				event.shiftKey &&
				event.key.toLowerCase() === "p"
			) {
				event.preventDefault();
				if (imageLoaded) void handlePin();
				return;
			}
			if (
				(event.metaKey || event.ctrlKey) &&
				event.key.toLowerCase() === "z"
			) {
				event.preventDefault();
				setOps((prev) => prev.slice(0, -1));
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [
		handleCloseTextPanel,
		handlePin,
		imageLoaded,
		textPanelOpen,
	]);

	// Background CSS style for preview
	const bgStyle: React.CSSProperties =
		bg.kind === "wallpaper"
			? { backgroundImage: `url(${bgSrc})`, backgroundSize: "cover", backgroundPosition: "center" }
			: bg.kind === "gradient"
				? { background: (bg as { kind: "gradient"; css: string }).css }
				: { backgroundColor: (bg as { kind: "solid"; value: string }).value };
	const stageImageWidth = naturalSize.w || 800;
	const stageImageHeight = naturalSize.h || 600;
	const watermarkMetrics = getWatermarkMetrics(stageImageWidth, stageImageHeight);
	const previewComposition = calculateScreenshotCompositionLayout(
		stageImageWidth,
		stageImageHeight,
		backgroundPadding,
		previewIsBorderless,
	);
	const previewStageInset = previewComposition.frameInset;
	const previewTopBarHeight = previewComposition.topBarHeight;
	const previewStageWidth = previewComposition.frameWidth;
	const previewStageHeight = previewComposition.frameHeight;
	const previewAvailableWidth = Math.max(1, previewViewportSize.w - 24);
	const previewAvailableHeight = Math.max(1, previewViewportSize.h - 24);
	const previewStageScale = Math.min(
		1,
		previewAvailableWidth / previewComposition.width,
		previewAvailableHeight / previewComposition.height,
	);

	useEffect(() => {
		if (!imageLoaded || !screenshotSrc) {
			setCompositionPreviewReady(false);
			return;
		}

		const visibleCanvas = compositionCanvasRef.current;
		if (!visibleCanvas) return;
		const requestId = ++compositionRenderRequestRef.current;
		let cancelled = false;
		const renderCanvas = document.createElement("canvas");

		const renderPreview = async () => {
			try {
				const rendered = await renderCompositeToCanvas(
					renderCanvas,
					ops.map(cloneDrawOp),
					"preview",
					previewStageScale,
				);
				if (
					!rendered ||
					cancelled ||
					requestId !== compositionRenderRequestRef.current
				) {
					return;
				}

				visibleCanvas.width = renderCanvas.width;
				visibleCanvas.height = renderCanvas.height;
				const context = visibleCanvas.getContext("2d");
				if (context) {
					context.imageSmoothingEnabled = true;
					context.imageSmoothingQuality = "high";
					context.drawImage(renderCanvas, 0, 0);
				}
				setCompositionPreviewReady(Boolean(context));
			} catch {
				if (
					!cancelled &&
					requestId === compositionRenderRequestRef.current
				) {
					setCompositionPreviewReady(false);
				}
			} finally {
				releaseCanvas(renderCanvas);
			}
		};

		const frameId = window.requestAnimationFrame(() => void renderPreview());
		return () => {
			cancelled = true;
			window.cancelAnimationFrame(frameId);
		};
	}, [
		backgroundPadding,
		bg,
		bgSrc,
		chromeStyle,
		imageLoaded,
		ops,
		previewDevicePixelRatio,
		previewStageScale,
		screenshotSrc,
		showWatermark,
		watermarkColor,
		watermarkContent,
		watermarkOpacity,
	]);

	const showInkControls = tool !== "mosaic";
	const showWeightControls =
		tool === "pen" || tool === "arrow" || tool === "rect";

	return (
		<div
			className="relative flex h-screen flex-col overflow-hidden text-white select-none"
			style={{ background: previewChromeTheme.appBackground }}
		>
			<div
				className="pointer-events-none absolute inset-0"
				style={{
					opacity: previewChromeTheme.gridOpacity,
					backgroundImage:
						"linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
					backgroundSize: "26px 26px",
					maskImage: "linear-gradient(180deg, rgba(255,255,255,0.48), transparent 78%)",
				}}
			/>
			{actionToast && (
				<div className="pointer-events-none absolute right-5 top-[76px] z-20">
					<div
						key={actionToast.id}
						className="min-w-[220px] rounded-[22px] border px-4 py-3 shadow-[0_24px_60px_rgba(0,0,0,0.34)]"
						style={{
							...(actionToast.tone === "error"
								? {
										background: "rgba(44, 12, 16, 0.86)",
										borderColor: "rgba(255,120,120,0.24)",
										boxShadow: "0 24px 60px rgba(0,0,0,0.34), 0 0 0 1px rgba(255,120,120,0.08)",
									}
								: previewChromeTheme.surface),
							backdropFilter: "blur(20px) saturate(160%)",
							WebkitBackdropFilter: "blur(20px) saturate(160%)",
						}}
					>
						<div className="flex items-start gap-3">
							<div
								className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full"
								style={{
									background:
										actionToast.tone === "error"
											? "#FF6B6B"
											: previewChromeTheme.exportAccent,
									boxShadow:
										actionToast.tone === "error"
											? "0 0 16px rgba(255,107,107,0.55)"
											: `0 0 18px ${previewChromeTheme.exportGlow}`,
								}}
							/>
							<div className="min-w-0">
								<div className="text-sm font-semibold tracking-[0.02em] text-white">
									{actionToast.title}
								</div>
								{actionToast.detail && (
									<div className="mt-1 truncate text-xs text-white/68">
										{actionToast.detail}
									</div>
								)}
							</div>
						</div>
					</div>
				</div>
			)}
			{/* ── Toolbar ───────────────────────────────────────────── */}
			<div
				data-quickshot-toolbar
				className={`relative z-10 mx-2.5 mt-2.5 flex shrink-0 items-center gap-2 rounded-[18px] border border-white/10 ${IS_MAC ? "pl-[88px] pr-2" : "px-2"} py-1.5`}
				style={{ ...previewChromeTheme.surface, WebkitAppRegion: "drag" } as React.CSSProperties}
			>
				<div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
				<div
					className="min-w-0 flex flex-1 items-center gap-2 overflow-x-auto overscroll-x-contain scroll-smooth pr-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
					style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
				>
					<div
						className="flex shrink-0 items-center gap-0.5 rounded-xl p-0.5"
						style={previewChromeTheme.group}
						role="group"
						aria-label="标注工具"
					>
						{TOOL_OPTIONS.map(({ value, label, icon: Icon }) => (
							<button
								type="button"
								key={value}
								onClick={() => setTool(value)}
								title={label}
								aria-label={label}
								aria-pressed={tool === value}
								className={`flex h-9 w-9 items-center justify-center rounded-[10px] transition-[background-color,color,box-shadow] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/55 motion-reduce:transition-none ${
									tool === value
										? "bg-white/14 text-white ring-1 ring-inset ring-white/16 shadow-[0_5px_14px_rgba(25,181,122,0.2)]"
										: "text-white/58 hover:bg-white/8 hover:text-white"
								}`}
							>
								<Icon size={15} strokeWidth={1.75} />
							</button>
						))}
					</div>

					{showInkControls && (
						<div
							className="flex shrink-0 items-center gap-0.5 rounded-xl p-0.5"
							style={previewChromeTheme.group}
							role="group"
							aria-label="标注颜色"
						>
							{PRESET_COLORS.map((presetColor, index) => (
								<button
									type="button"
									key={presetColor}
									onClick={() => setColor(presetColor)}
									title={`标注颜色 ${presetColor}`}
									aria-label={`标注颜色 ${presetColor}`}
									aria-pressed={color === presetColor}
									className={`flex h-8 w-8 items-center justify-center rounded-[9px] transition-[background-color,box-shadow] duration-150 ease-out hover:bg-white/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/55 motion-reduce:transition-none ${
										index >= 5 ? "max-[860px]:hidden" : ""
									}`}
								>
									<span
										className="h-4 w-4 rounded-full border border-white/20"
										style={{
											background: presetColor,
											boxShadow:
												color === presetColor
													? "0 0 0 2px rgba(255,255,255,0.88)"
													: "inset 0 1px 0 rgba(255,255,255,0.45)",
										}}
									/>
								</button>
							))}
							<label
								className="relative flex h-8 w-8 cursor-pointer items-center justify-center rounded-[9px] text-white/58 transition-[background-color,color] duration-150 ease-out hover:bg-white/8 hover:text-white focus-within:ring-2 focus-within:ring-white/55 motion-reduce:transition-none"
								title="自定义颜色"
							>
								<Pipette size={14} strokeWidth={1.75} aria-hidden="true" />
								<span
									className="absolute bottom-1 h-1 w-3 rounded-full"
									style={{ background: color }}
								/>
								<input
									type="color"
									value={color}
									onChange={(e) => setColor(e.target.value)}
									className="absolute inset-0 cursor-pointer opacity-0"
									aria-label="自定义标注颜色"
								/>
							</label>
						</div>
					)}

					{showWeightControls && (
						<div
							className="flex shrink-0 items-center gap-0.5 rounded-xl p-0.5"
							style={previewChromeTheme.group}
							role="group"
							aria-label="标注粗细"
						>
						{BRUSH_SIZES.map((s, i) => (
							<button
								type="button"
								key={s}
								onClick={() => setBrushSize(i)}
								title={`线宽 ${s}px`}
								aria-label={`线宽 ${s}px`}
								aria-pressed={brushSize === i}
								className={`flex h-8 w-8 items-center justify-center rounded-[9px] transition-[background-color,box-shadow] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/55 motion-reduce:transition-none ${
									brushSize === i
										? "bg-white/12 ring-1 ring-inset ring-white/14"
										: "hover:bg-white/8"
								}`}
							>
								<div className="rounded-full bg-white" style={{ width: s + 4, height: s + 4, opacity: brushSize === i ? 1 : 0.82 }} />
							</button>
						))}
						</div>
					)}

					<button
						type="button"
						onClick={() => setOps((prev) => prev.slice(0, -1))}
						disabled={ops.length === 0}
						className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white/65 transition-[background-color,color,opacity] duration-150 ease-out hover:bg-white/8 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/55 disabled:opacity-30 motion-reduce:transition-none"
						title={IS_MAC ? "撤销 (⌘Z)" : "撤销 (Ctrl+Z)"}
						aria-label="撤销"
						style={previewChromeTheme.group}
					>
						<Undo2 size={15} strokeWidth={1.75} />
					</button>
				</div>

				<div className="flex shrink-0 items-center gap-1.5" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
					{IS_MAC && (
						<button
							ref={textPanelTriggerRef}
							type="button"
							onClick={() => {
								if (textPanelOpen) {
									handleCloseTextPanel();
								} else {
									setTextPanelOpen(true);
								}
							}}
							disabled={!imageLoaded}
							className={`flex h-9 w-9 items-center justify-center rounded-xl border text-white/86 transition-[background-color,border-color,box-shadow,opacity] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/55 disabled:cursor-not-allowed disabled:opacity-35 motion-reduce:transition-none ${
								textPanelOpen
									? "border-white/28 ring-1 ring-inset ring-white/16 shadow-[0_6px_18px_rgba(255,255,255,0.07)]"
									: "border-white/12 hover:bg-white/12"
							}`}
							style={previewChromeTheme.copyButton}
							title="提取文字 (⌘⇧T)"
							aria-label="提取文字"
							aria-expanded={textPanelOpen}
							aria-controls="text-extraction-panel"
						>
							<ScanText size={15} strokeWidth={1.8} />
						</button>
					)}
					<button
						type="button"
						onClick={() => void handlePin()}
						disabled={!imageLoaded}
						className={`flex h-9 w-9 items-center justify-center rounded-xl border text-white/86 transition-[background-color,border-color,box-shadow,opacity] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/55 disabled:cursor-not-allowed disabled:opacity-35 motion-reduce:transition-none ${
							actionToast?.action === "pin" &&
							actionToast.tone === "success"
								? "border-white/28 ring-1 ring-inset ring-white/16 shadow-[0_6px_18px_rgba(255,255,255,0.07)]"
								: "border-white/12 hover:bg-white/12"
						}`}
						style={previewChromeTheme.copyButton}
						title={
							IS_MAC
								? "悬浮置顶 (⌘⇧P)"
								: "悬浮置顶 (Ctrl+Shift+P)"
						}
						aria-label="悬浮置顶"
					>
						<Pin size={15} strokeWidth={1.8} />
					</button>
					<button
						type="button"
						onClick={handleCopy}
						className={`flex h-9 w-9 items-center justify-center rounded-xl border text-white/86 transition-[background-color,border-color,box-shadow] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/55 motion-reduce:transition-none ${
							actionToast?.action === "copy" && actionToast.tone === "success"
								? "border-white/28 ring-1 ring-inset ring-white/16 shadow-[0_6px_18px_rgba(255,255,255,0.07)]"
								: "border-white/12 hover:bg-white/12"
						}`}
						style={previewChromeTheme.copyButton}
						title="复制到剪贴板"
						aria-label="复制到剪贴板"
					>
						<Copy size={15} strokeWidth={1.8} />
					</button>
					<button
						type="button"
						onClick={handleQuickSave}
						className={`flex h-9 w-9 items-center justify-center rounded-xl text-white transition-[filter,box-shadow] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 motion-reduce:transition-none ${
							actionToast?.action === "quick-save" && actionToast.tone === "success"
								? "shadow-[0_10px_24px_rgba(31,181,118,0.3)] brightness-110"
								: "hover:brightness-110"
						}`}
						style={previewChromeTheme.primaryButton}
						title="快速保存到下载目录"
						aria-label="快速保存到下载目录"
					>
						<Download size={15} strokeWidth={1.8} />
					</button>
					<button
						type="button"
						onClick={handleSave}
						className={`flex h-9 w-9 items-center justify-center rounded-xl border text-white/86 transition-[background-color,border-color,box-shadow] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/55 motion-reduce:transition-none ${
							actionToast?.action === "save" && actionToast.tone === "success"
								? "border-white/28 ring-1 ring-inset ring-white/16 shadow-[0_6px_18px_rgba(255,255,255,0.07)]"
								: "border-white/12 hover:bg-white/12"
						}`}
						style={previewChromeTheme.copyButton}
						title="保存 PNG"
						aria-label="保存 PNG"
					>
						<Save size={15} strokeWidth={1.8} />
					</button>
					{!IS_MAC && (
						<button
							type="button"
							onClick={() => window.close()}
							className="flex h-9 w-9 items-center justify-center rounded-xl text-white/50 transition-[background-color,color] duration-150 ease-out hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/55 motion-reduce:transition-none"
							title="关闭"
							aria-label="关闭"
							style={previewChromeTheme.group}
						>
							<X size={15} strokeWidth={1.8} />
						</button>
					)}
				</div>
			</div>

			<div
				data-quickshot-workspace
				className="relative z-10 flex min-h-0 flex-1 overflow-hidden"
			>
				{/* ── Main canvas area ───────────────────────────────── */}
				<div
					ref={previewViewportRef}
					data-quickshot-viewport
					className="relative min-h-0 min-w-0 flex-1 overflow-auto px-2.5 pb-2 pt-1.5 sm:px-3 sm:pb-2.5 sm:pt-2"
					style={{
						background:
							"radial-gradient(circle at 50% 24%, rgba(255,255,255,0.055), transparent 42%), rgba(4,7,12,0.34)",
					}}
				>
					<div
						className="pointer-events-none absolute inset-0"
						style={{
							background:
								"linear-gradient(rgba(255,255,255,0.018) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px)",
							backgroundSize: "20px 20px",
						}}
					/>
				<div className="relative flex min-h-full items-center justify-center">
					{screenshotSrc && (
						<div
							data-quickshot-composition
							className="relative m-2 flex-shrink-0 overflow-hidden sm:m-3"
							style={{
								width: previewComposition.width * previewStageScale,
								height: previewComposition.height * previewStageScale,
							}}
						>
							<div
								className="absolute left-0 top-0 overflow-hidden"
								style={{
									...bgStyle,
									width: previewComposition.width,
									height: previewComposition.height,
									transform: `scale(${previewStageScale})`,
									transformOrigin: "top left",
								}}
							>
							{!previewIsBorderless && (
								<>
									<div
										className="pointer-events-none absolute inset-0"
										style={{
											background: `radial-gradient(circle ${Math.max(previewStageWidth, previewStageHeight) * 0.88}px at ${previewComposition.frameX + previewStageWidth * 0.5}px ${previewComposition.frameY + previewStageHeight * 0.3}px, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.035) 42%, rgba(255,255,255,0) 100%)`,
										}}
									/>
									<div
										className="pointer-events-none absolute inset-0"
										style={{
											background: `radial-gradient(circle ${Math.max(previewStageWidth, previewStageHeight) * 0.8}px at ${previewComposition.frameX + previewStageWidth * 0.2}px ${previewComposition.frameY + previewStageHeight * 0.08}px, ${stageChromeTheme.exportGlow} 0%, rgba(0,0,0,0) 100%)`,
										}}
									/>
									<div
										className="pointer-events-none absolute"
										style={{
											left: previewComposition.frameX - 30,
											top: previewComposition.frameY + previewStageHeight - 6,
											width: previewStageWidth + 60,
											height: 86,
											background: `radial-gradient(circle ${previewStageWidth * 0.44}px at 50% 24px, rgba(0,0,0,0.16) 0%, rgba(0,0,0,0.16) 22.7%, rgba(0,0,0,0) 100%)`,
										}}
									/>
								</>
							)}
							<div
								className="absolute flex-shrink-0"
								style={{
									left: previewComposition.frameX,
									top: previewComposition.frameY,
									width: previewStageWidth,
									height: previewStageHeight,
								}}
							>
								{!previewIsBorderless && (
									<div
										className="pointer-events-none absolute rounded-[32px]"
										style={{
											left: 8,
											top: 18,
											width: previewStageWidth - 16,
											height: previewStageHeight - 12,
											transform: "rotate(-0.458deg)",
											transformOrigin: "center center",
											background: "rgba(255,255,255,0.028)",
											boxShadow: "0 18px 34px rgba(0,0,0,0.1)",
										}}
									/>
								)}
								<div
									className="absolute left-0 top-0 overflow-hidden"
									style={{
										width: previewStageWidth,
										height: previewStageHeight,
										boxSizing: "border-box",
										borderRadius: previewIsBorderless ? 0 : EXPORT_FRAME_RADIUS,
										background: previewIsBorderless ? "transparent" : stageChromeTheme.exportFrameFill,
										boxShadow: previewIsBorderless
											? "none"
											: "0 14px 44px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.12)",
									}}
								>
									{!previewIsBorderless && (
										<>
											<div
												className="pointer-events-none absolute"
												style={{
													left: 1,
													top: 1,
													width: previewStageWidth - 2,
													height: previewTopBarHeight,
													borderRadius: EXPORT_FRAME_RADIUS - 1,
													background: stageChromeTheme.exportTopBarFill,
												}}
											/>
											<div
												className="pointer-events-none absolute"
												style={{
													left: 1,
													top: 1,
													width: previewStageWidth - 2,
													height: previewTopBarHeight,
													borderRadius: EXPORT_FRAME_RADIUS - 1,
													background:
														"linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0) 70%)",
												}}
											/>
											<div className="pointer-events-none absolute left-6 right-6 top-px h-px bg-white/20" />
											<div
												className="pointer-events-none absolute right-[30px] top-1 w-[150px]"
												style={{
													height: previewTopBarHeight - 8,
													background: `linear-gradient(90deg, rgba(255,255,255,0), ${stageChromeTheme.exportAccent}16, rgba(255,255,255,0))`,
												}}
											/>
											<div className="pointer-events-none absolute left-[20.5px] top-[13px] flex items-center gap-[9px]">
												<div className="h-[11px] w-[11px] rounded-full bg-[#FF5F57]" />
												<div className="h-[11px] w-[11px] rounded-full bg-[#FFBD2E]" />
												<div className="h-[11px] w-[11px] rounded-full bg-[#28C840]" />
											</div>
											<div className="pointer-events-none absolute right-[22px] top-[11px] flex items-center gap-[8px]">
												<div
													className="h-[10px] w-[12px] rounded-full"
													style={{ background: stageChromeTheme.exportDecorFill }}
												/>
												<div
													className="h-[16px] w-[24px] rounded-full"
													style={{ background: stageChromeTheme.exportDecorFill }}
												/>
												<div
													className="h-[10px] w-[12px] rounded-full"
													style={{ background: stageChromeTheme.exportDecorFill }}
												/>
											</div>
											<div
												className="pointer-events-none absolute inset-[1px]"
												style={{
													borderRadius: EXPORT_FRAME_RADIUS - 1,
													background:
														"linear-gradient(135deg, rgba(255,255,255,0), rgba(255,255,255,0.03) 55%, rgba(255,255,255,0.08))",
												}}
											/>
										</>
									)}
									<div
										className="relative"
										style={{
											padding: previewStageInset,
											paddingTop: previewTopBarHeight + previewStageInset,
										}}
									>
										<div
											className="relative overflow-hidden"
											style={{
												width: stageImageWidth,
												height: stageImageHeight,
												borderRadius: previewIsBorderless ? 0 : EXPORT_IMAGE_RADIUS,
												boxShadow: previewIsBorderless
													? "none"
													: "0 10px 26px rgba(0,0,0,0.32)",
											}}
										>
											<img
												ref={imgRef}
												src={screenshotSrc || undefined}
												style={{
													display: "block",
													width: stageImageWidth,
													height: stageImageHeight,
													borderRadius: previewIsBorderless ? 0 : EXPORT_IMAGE_RADIUS,
													userSelect: "none",
													imageRendering: "auto",
												}}
												draggable={false}
												onLoad={() => void handleScreenshotImageLoad()}
												onError={handleScreenshotImageError}
											/>
										{!previewIsBorderless && (
											<div
												className="pointer-events-none absolute inset-0"
												style={{
													borderRadius: EXPORT_IMAGE_RADIUS,
													boxShadow:
														"inset 0 0 0 1px rgba(255,255,255,0.12), inset 0 0 0 2px rgba(255,255,255,0.05)",
												}}
											/>
										)}
										<canvas
											ref={canvasRef}
												width={0}
												height={0}
											style={{
												position: "absolute",
												inset: 0,
												width: "100%",
													height: "100%",
													borderRadius: previewIsBorderless ? 0 : EXPORT_IMAGE_RADIUS,
													pointerEvents: "none",
												}}
											/>
										<canvas
											ref={activeCanvasRef}
												width={0}
												height={0}
												style={{
												position: "absolute",
												inset: 0,
												zIndex: 6,
													width: "100%",
													height: "100%",
													borderRadius: previewIsBorderless ? 0 : EXPORT_IMAGE_RADIUS,
													cursor: tool === "text" ? "text" : "crosshair",
													touchAction: "none",
												}}
												onPointerDown={handlePointerDown}
												onPointerMove={handlePointerMove}
												onPointerUp={handlePointerUp}
												onPointerCancel={handlePointerCancel}
												onLostPointerCapture={handlePointerCancel}
											/>
											{textInput && (
											<AnnotationTextInput
												style={{ ...getTextInputStyle(), zIndex: 7 }}
													color={color}
													onDraftChange={(value) => {
														textInputDraftRef.current = value;
													}}
													onCommit={commitText}
													onCancel={() => {
														textInputDraftRef.current = "";
														setTextInput(null);
													}}
												/>
											)}
											{showWatermark && (
												<div
													className="pointer-events-none absolute select-none overflow-hidden text-ellipsis whitespace-nowrap"
													style={{
														zIndex: 2,
														right: watermarkMetrics.right,
														bottom: watermarkMetrics.bottom,
														maxWidth: watermarkMetrics.maxWidth,
														color: withAlpha(
															previewWatermarkPalette.fill,
															watermarkAlphaSet.text,
														),
														fontSize: watermarkMetrics.fontSize,
														fontWeight: 600,
														lineHeight: 1,
														letterSpacing: "0.01em",
														textAlign: "right",
														fontFamily:
															'"SF Pro Display", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif',
														WebkitTextStroke: `0.72px ${withAlpha(
															previewWatermarkPalette.outline,
															watermarkAlphaSet.stroke,
														)}`,
													}}
													title={watermarkContent}
												>
													{watermarkContent}
												</div>
											)}
										</div>
									</div>
									{!previewIsBorderless && (
										<div
											className="pointer-events-none absolute inset-0"
											style={{
												boxSizing: "border-box",
												borderRadius: EXPORT_FRAME_RADIUS,
												border: `1.5px solid ${stageChromeTheme.exportFrameStroke}`,
											}}
										/>
									)}
								</div>
							</div>
								<canvas
									ref={compositionCanvasRef}
									data-quickshot-composition-canvas
									className="pointer-events-none absolute left-0 top-0"
									style={{
										zIndex: 5,
										width: previewComposition.width,
										height: previewComposition.height,
										imageRendering: "auto",
										opacity: compositionPreviewReady ? 1 : 0,
									}}
								/>
								</div>
						</div>
					)}
				</div>
			</div>

				<TextExtractionPanel
					open={textPanelOpen}
					onClose={handleCloseTextPanel}
					onExtract={handleExtractText}
					onCopyText={handleCopyText}
					surface={previewChromeTheme.surface}
					group={previewChromeTheme.group}
					primaryButton={previewChromeTheme.primaryButton}
					accent={previewChromeTheme.exportAccent}
				/>
			</div>

			{/* ── Background strip ──────────────────────────────────── */}
			<div
				data-quickshot-dock
				className="relative z-10 px-2.5 pb-2.5"
			>
				<div
					className="flex items-center gap-2 overflow-x-auto overscroll-x-contain scroll-smooth rounded-[18px] border border-white/10 px-2.5 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
					style={previewChromeTheme.surface}
				>
					<div className="flex flex-shrink-0 items-center gap-1.5">
						<span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/52">Styles</span>
						<div className="flex gap-1" role="radiogroup" aria-label="界面风格">
							{(Object.entries(CHROME_THEMES) as [ChromeStyle, (typeof CHROME_THEMES)[ChromeStyle]][]).map(
								([value, theme]) => (
									<button
										type="button"
										key={value}
										onClick={() => setChromeStyle(value)}
										role="radio"
										aria-checked={chromeStyle === value}
										className={`h-9 rounded-xl px-2.5 text-[11px] font-medium transition-[color,border-color,box-shadow,filter] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/55 motion-reduce:transition-none ${
											chromeStyle === value
												? "text-white brightness-110"
												: "text-white/68 hover:text-white hover:brightness-105"
										}`}
										style={{
											background: theme.swatch,
											border:
												chromeStyle === value
													? "1px solid rgba(255,255,255,0.55)"
													: "1px solid rgba(255,255,255,0.12)",
											boxShadow:
												chromeStyle === value
													? "0 0 0 1px rgba(255,255,255,0.12)"
													: "inset 0 1px 0 rgba(255,255,255,0.14)",
										}}
									>
										{theme.label}
									</button>
								),
							)}
						</div>
						</div>
						<div className="h-6 w-px shrink-0 bg-white/8" />
						<div
							data-quickshot-padding-control
							className="flex flex-shrink-0 items-center gap-1.5"
							title={`成品尺寸 ${previewComposition.width} × ${previewComposition.height}`}
						>
							<span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/52">
								边距
							</span>
							<div
								className="flex h-9 items-center gap-2 rounded-xl px-2.5"
								style={previewChromeTheme.group}
								onDoubleClick={() =>
									setBackgroundPadding(DEFAULT_BACKGROUND_PADDING)
								}
							>
								<input
									type="range"
									min={MIN_BACKGROUND_PADDING}
									max={MAX_BACKGROUND_PADDING}
									step={BACKGROUND_PADDING_STEP}
									value={backgroundPadding}
									onChange={(event) =>
										setBackgroundPadding(
											normalizeBackgroundPadding(Number(event.target.value)),
										)
									}
									className="w-20 accent-white/80"
									aria-label="截图外部背景边距"
									aria-valuetext={`${backgroundPadding} 像素`}
								/>
								<span className="w-9 text-right text-[10px] tabular-nums text-white/62">
									{backgroundPadding}px
								</span>
							</div>
						</div>
						<div className="h-6 w-px shrink-0 bg-white/8" />
						<div className="flex flex-shrink-0 items-center gap-1.5">
						<span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/52">Signature</span>
						<button
							type="button"
							onClick={() => {
								setWatermarkEnabled((prev) => {
									const nextEnabled = !prev;
									if (nextEnabled) {
										setWatermarkOpacity((prevOpacity) =>
											ensureWatermarkReadableOpacity(prevOpacity),
										);
									}
									return nextEnabled;
								});
							}}
							aria-pressed={watermarkEnabled}
							className={`h-9 rounded-xl px-2.5 text-[11px] font-medium transition-[color,border-color,box-shadow] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/55 motion-reduce:transition-none ${
								watermarkEnabled
									? "text-white shadow-[0_5px_14px_rgba(0,0,0,0.16)]"
									: "text-white/62 hover:text-white"
							}`}
							style={{
								...(watermarkEnabled
									? previewChromeTheme.primaryButton
									: previewChromeTheme.group),
								border: "1px solid rgba(255,255,255,0.12)",
							}}
						>
							{watermarkEnabled ? "已开启" : "已关闭"}
						</button>
						<div
							className="flex h-9 items-center gap-2 rounded-xl px-2"
							style={previewChromeTheme.group}
						>
							<input
								type="text"
								value={watermarkText}
								onChange={(e) => {
									const nextValue = e.target.value;
									const hasContent = nextValue.trim().length > 0;
									setWatermarkText(nextValue);
									setWatermarkEnabled(hasContent);
									if (hasContent) {
										setWatermarkOpacity((prev) =>
											ensureWatermarkReadableOpacity(prev),
										);
									}
								}}
								placeholder="输入右下角签名"
								aria-label="右下角签名文字"
								className="h-7 w-[clamp(116px,15vw,180px)] bg-transparent text-xs text-white outline-none placeholder:text-white/32"
							/>
							<div className="flex items-center gap-1.5">
								<button
									type="button"
									onClick={() => setWatermarkColor(AUTO_WATERMARK_COLOR)}
									aria-label="签名颜色自动"
									aria-pressed={watermarkColor === AUTO_WATERMARK_COLOR}
									className={`h-7 rounded-lg px-2 text-[10px] font-semibold uppercase tracking-[0.12em] transition-[color,border-color,box-shadow] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/55 motion-reduce:transition-none ${
										watermarkColor === AUTO_WATERMARK_COLOR
											? "text-white"
											: "text-white/56 hover:text-white"
									}`}
									style={{
										background:
											watermarkColor === AUTO_WATERMARK_COLOR
												? "linear-gradient(135deg, rgba(255,255,255,0.26), rgba(255,255,255,0.1))"
												: "rgba(255,255,255,0.08)",
										border:
											watermarkColor === AUTO_WATERMARK_COLOR
												? "1px solid rgba(255,255,255,0.36)"
												: "1px solid rgba(255,255,255,0.14)",
										boxShadow:
											watermarkColor === AUTO_WATERMARK_COLOR
												? "0 8px 18px rgba(0,0,0,0.16)"
												: "none",
									}}
									title="根据画面自动调节水印明暗"
								>
									Auto
								</button>
								{WATERMARK_PRESET_COLORS.map((presetColor) => (
									<button
										type="button"
										key={presetColor}
										onClick={() => setWatermarkColor(presetColor)}
										className="flex h-8 w-8 items-center justify-center rounded-lg transition-[background-color] duration-150 ease-out hover:bg-white/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/55 max-[1100px]:hidden motion-reduce:transition-none"
										title={presetColor}
										aria-label={`签名颜色 ${presetColor}`}
										aria-pressed={watermarkColor === presetColor}
									>
										<span
											className="h-3.5 w-3.5 rounded-full border"
											style={{
												background: presetColor,
												borderColor:
													watermarkColor === presetColor
														? "rgba(255,255,255,0.92)"
														: "rgba(255,255,255,0.22)",
												boxShadow:
													watermarkColor === presetColor
														? "0 0 0 2px rgba(255,255,255,0.18)"
														: "inset 0 1px 0 rgba(255,255,255,0.28)",
											}}
										/>
									</button>
								))}
								<label
									className="relative flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-white/58 transition-[background-color,color] duration-150 ease-out hover:bg-white/8 hover:text-white focus-within:ring-2 focus-within:ring-white/55 motion-reduce:transition-none"
									title="自定义签名颜色"
								>
									<Pipette size={13} strokeWidth={1.75} aria-hidden="true" />
									<span
										className="absolute bottom-1 h-1 w-3 rounded-full"
										style={{
											background:
												watermarkColor === AUTO_WATERMARK_COLOR
													? "#FFFFFF"
													: watermarkColor,
										}}
									/>
									<input
										type="color"
										value={
											watermarkColor === AUTO_WATERMARK_COLOR
												? "#FFFFFF"
												: watermarkColor
										}
										onChange={(e) => setWatermarkColor(e.target.value)}
										className="absolute inset-0 cursor-pointer opacity-0"
										aria-label="自定义签名颜色"
									/>
								</label>
							</div>
							<div className="flex items-center gap-2">
								<span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/48 max-[1200px]:hidden">
									Opacity
								</span>
								<input
									type="range"
									min={MIN_WATERMARK_OPACITY}
									max={MAX_WATERMARK_OPACITY}
									value={watermarkOpacity}
									onChange={(e) =>
										setWatermarkOpacity(normalizeWatermarkOpacity(Number(e.target.value)))
									}
									className="w-20 accent-white/80"
									aria-label="签名透明度"
								/>
								<span className="w-8 text-right text-[10px] text-white/62">
									{watermarkOpacity}%
								</span>
							</div>
						</div>
					</div>
					<div className="h-6 w-px shrink-0 bg-white/8" />
					<div className="flex flex-shrink-0 items-center gap-1.5">
						<span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/52">Gradients</span>
						<div className="flex gap-1" role="radiogroup" aria-label="渐变背景">
					{GRADIENTS.map((g, i) => {
						const isSelected =
							bg.kind === "gradient" && (bg as { css: string }).css === (g as { css: string }).css;
						return (
							<button
								type="button"
								key={i}
								onClick={() => setBg(g)}
								role="radio"
								aria-checked={isSelected}
								aria-label={`渐变背景 ${i + 1}`}
								className={`h-8 w-11 rounded-xl border transition-[border-color,box-shadow,filter] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/55 motion-reduce:transition-none ${
									isSelected
										? "border-white/65 brightness-110"
										: "border-white/10 hover:border-white/32 hover:brightness-105"
								}`}
								style={{
									background: (g as { css: string }).css,
									boxShadow: isSelected
										? "0 0 0 1px rgba(255,255,255,0.12)"
										: undefined,
								}}
							/>
						);
					})}
						</div>
					</div>
					<div className="h-6 w-px shrink-0 bg-white/8" />
					<div className="flex flex-shrink-0 items-center gap-1.5">
						<span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/52">Tones</span>
						<div className="flex gap-1" role="radiogroup" aria-label="纯色背景">
					{["#1a1a2e", "#0d0d0d", "#f5f5f0", "#1e293b", "#312e81"].map((c) => {
						const isSelected = bg.kind === "solid" && (bg as { value: string }).value === c;
						return (
							<button
								type="button"
								key={c}
								onClick={() => setBg({ kind: "solid", value: c })}
								role="radio"
								aria-checked={isSelected}
								aria-label={`纯色背景 ${c}`}
								className={`h-8 w-11 rounded-xl border transition-[border-color,box-shadow,filter] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/55 motion-reduce:transition-none ${
									isSelected
										? "border-white/65 brightness-110"
										: "border-white/12 hover:border-white/32 hover:brightness-105"
								}`}
								style={{
									background: c,
									boxShadow: isSelected
										? "0 0 0 1px rgba(255,255,255,0.12)"
										: undefined,
								}}
							/>
						);
					})}
						</div>
					</div>
					<div className="h-6 w-px shrink-0 bg-white/8" />
					<div className="flex flex-shrink-0 items-center gap-1.5">
						<span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/52">Wallpapers</span>
						<div className="flex gap-1" role="radiogroup" aria-label="壁纸背景">
					{WALLPAPERS.map((wallpaper) => {
						const thumbnailSrc = wallpaperThumbnailSrcs[wallpaper.value];
						const isSelected =
							bg.kind === "wallpaper" && bg.value === wallpaper.value;
						return (
							<button
								type="button"
								key={wallpaper.value}
								onClick={() =>
									setBg({ kind: "wallpaper", value: wallpaper.value })
								}
								role="radio"
								aria-checked={isSelected}
								aria-label={`壁纸 ${wallpaper.value.match(/\d+/)?.[0] ?? ""}`}
								className={`h-8 w-11 overflow-hidden rounded-xl border transition-[border-color,box-shadow,filter] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/55 motion-reduce:transition-none ${
									isSelected
										? "border-white/65 brightness-110"
										: "border-white/10 hover:border-white/32 hover:brightness-105"
								}`}
								style={{
									backgroundColor: "rgba(255,255,255,0.06)",
									backgroundImage: thumbnailSrc
										? `url("${thumbnailSrc}")`
										: undefined,
									backgroundSize: "cover",
									backgroundPosition: "center",
									boxShadow: isSelected
										? "0 0 0 1px rgba(255,255,255,0.12)"
										: undefined,
								}}
							/>
						);
					})}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
