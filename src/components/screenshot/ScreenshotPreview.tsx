import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Copy, Download, Save } from "lucide-react";
import { getAssetPath } from "@/lib/assetPath";
import { decodeImageData } from "@/lib/decodeImage";

// ─── Types ───────────────────────────────────────────────────────────────────

type Tool = "pen" | "arrow" | "rect" | "text" | "mosaic";

type DrawOp =
	| { type: "pen"; points: [number, number][]; color: string; width: number }
	| { type: "arrow"; from: [number, number]; to: [number, number]; color: string; width: number }
	| { type: "rect"; x: number; y: number; w: number; h: number; color: string; width: number }
	| { type: "text"; x: number; y: number; text: string; color: string; size: number }
	| { type: "mosaic"; cells: [number, number][]; blockSize: number };

type BgType =
	| { kind: "wallpaper"; value: string }
	| { kind: "gradient"; css: string; stops: [string, string]; angle: number }
	| { kind: "solid"; value: string };

type ChromeStyle = "glass" | "graphite" | "aurora" | "ember" | "borderless";
type ActionType = "copy" | "quick-save" | "save";
type ActionToast = {
	id: number;
	action: ActionType;
	tone: "success" | "error";
	title: string;
	detail?: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const WALLPAPER_COUNT = 18;
const WALLPAPERS = Array.from(
	{ length: WALLPAPER_COUNT },
	(_, i) => `wallpapers/wallpaper${i + 1}.jpg`,
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
const PADDING = 48; // background padding around screenshot in export
const IS_MAC = navigator.userAgent.includes("Mac");
const CHROME_STYLE_STORAGE_KEY = "quickshot.chrome-style";
const EXPORT_OUTER_PADDING = PADDING + 12;
const EXPORT_FRAME_INSET = 18;
const EXPORT_TOP_BAR_HEIGHT = 38;
const EXPORT_FRAME_RADIUS = 30;
const EXPORT_IMAGE_RADIUS = 24;
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
	cells: [number, number][],
	blockSize: number,
	srcImg: HTMLImageElement,
	scale: number,
) {
	const tmp = document.createElement("canvas");
	tmp.width = srcImg.naturalWidth;
	tmp.height = srcImg.naturalHeight;
	const tc = tmp.getContext("2d");
	if (!tc) return;
	tc.drawImage(srcImg, 0, 0);

	const tile = Math.max(8, Math.round(blockSize));
	const brushR = Math.round(20 / scale);

	for (const [cx, cy] of cells) {
		const imgX = Math.round(cx / scale);
		const imgY = Math.round(cy / scale);

		for (let bx = imgX - brushR; bx < imgX + brushR; bx += tile) {
			for (let by = imgY - brushR; by < imgY + brushR; by += tile) {
				const sx = Math.max(0, bx);
				const sy = Math.max(0, by);
				const sw = Math.min(tile, srcImg.naturalWidth - sx);
				const sh = Math.min(tile, srcImg.naturalHeight - sy);
				if (sw <= 0 || sh <= 0) continue;
				const px = tc.getImageData(sx + Math.floor(sw / 2), sy + Math.floor(sh / 2), 1, 1).data;
				ctx.fillStyle = `rgb(${px[0]},${px[1]},${px[2]})`;
				ctx.fillRect(sx * scale, sy * scale, sw * scale, sh * scale);
			}
		}
	}
}

function drawOp(
	ctx: CanvasRenderingContext2D,
	op: DrawOp,
	srcImg: HTMLImageElement,
	scale: number,
) {
	switch (op.type) {
		case "pen":
			if (op.points.length < 2) return;
			ctx.strokeStyle = op.color;
			ctx.lineWidth = op.width;
			ctx.lineCap = "round";
			ctx.lineJoin = "round";
			ctx.beginPath();
			ctx.moveTo(op.points[0][0], op.points[0][1]);
			for (let i = 1; i < op.points.length; i++) ctx.lineTo(op.points[i][0], op.points[i][1]);
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
			ctx.shadowBlur = 0;
			break;
		case "mosaic":
			applyMosaic(ctx, op.cells, op.blockSize, srcImg, scale);
			break;
	}
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

function drawNoiseOverlay(
	ctx: CanvasRenderingContext2D,
	w: number,
	h: number,
	opacity: number,
) {
	const noiseCanvas = document.createElement("canvas");
	noiseCanvas.width = 120;
	noiseCanvas.height = 120;
	const noiseCtx = noiseCanvas.getContext("2d");
	if (!noiseCtx) return;
	const imageData = noiseCtx.createImageData(noiseCanvas.width, noiseCanvas.height);
	for (let i = 0; i < imageData.data.length; i += 4) {
		const value = Math.random() * 255;
		imageData.data[i] = value;
		imageData.data[i + 1] = value;
		imageData.data[i + 2] = value;
		imageData.data[i + 3] = Math.random() > 0.82 ? 42 : 0;
	}
	noiseCtx.putImageData(imageData, 0, 0);
	const pattern = ctx.createPattern(noiseCanvas, "repeat");
	if (!pattern) return;
	ctx.save();
	ctx.globalAlpha = opacity;
	ctx.fillStyle = pattern;
	ctx.fillRect(0, 0, w, h);
	ctx.restore();
}

function getFileName(path?: string) {
	if (!path) return undefined;
	return path.split(/[\\/]/).pop() || path;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ScreenshotPreview() {
	const [screenshotSrc, setScreenshotSrc] = useState<string>("");
	const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
	const [chromeStyle, setChromeStyle] = useState<ChromeStyle>(() => {
		if (typeof window === "undefined") return "glass";
		const stored = window.localStorage.getItem(CHROME_STYLE_STORAGE_KEY);
		if (stored && stored in CHROME_THEMES) {
			return stored as ChromeStyle;
		}
		return "glass";
	});
	const [tool, setTool] = useState<Tool>("pen");
	const [color, setColor] = useState("#FF3B30");
	const [brushSize, setBrushSize] = useState(1); // index into BRUSH_SIZES
	const [bg, setBg] = useState<BgType>({ kind: "wallpaper", value: WALLPAPERS[0] });
	const [bgSrc, setBgSrc] = useState<string>("");
	const [ops, setOps] = useState<DrawOp[]>([]);
	const [pendingOp, setPendingOp] = useState<DrawOp | null>(null);
	const [isDrawing, setIsDrawing] = useState(false);
	const [textInput, setTextInput] = useState<{ x: number; y: number; value: string } | null>(null);
	const [actionToast, setActionToast] = useState<ActionToast | null>(null);
	const [viewportSize, setViewportSize] = useState({
		w: window.innerWidth,
		h: window.innerHeight,
	});

	const canvasRef = useRef<HTMLCanvasElement>(null);
	const imgRef = useRef<HTMLImageElement>(null);
	const toastTimerRef = useRef<number | null>(null);
	const chromeTheme = CHROME_THEMES[chromeStyle];
	const isBorderless = chromeTheme.frameless;
	const previewChromeTheme = isBorderless ? CHROME_THEMES.glass : chromeTheme;
	const stageChromeTheme = chromeTheme;
	const previewIsBorderless = stageChromeTheme.frameless;

	useEffect(() => {
		const handlePreviewSession = async (payload: {
			sessionId: number;
			imageData: string;
		}) => {
			const image = await decodeImageData(payload.imageData);

			flushSync(() => {
				setScreenshotSrc(payload.imageData);
				setNaturalSize({ w: image.naturalWidth, h: image.naturalHeight });
			});

			await window.electronAPI.previewSessionReady(payload.sessionId);
		};

		return window.electronAPI.onPreviewSession(handlePreviewSession);
	}, []);

	useEffect(() => {
		window.localStorage.setItem(CHROME_STYLE_STORAGE_KEY, chromeStyle);
	}, [chromeStyle]);

	useEffect(
		() => () => {
			if (toastTimerRef.current) {
				window.clearTimeout(toastTimerRef.current);
			}
		},
		[],
	);

	// Load wallpaper bg
	useEffect(() => {
		if (bg.kind === "wallpaper") {
			getAssetPath(bg.value).then(setBgSrc);
		} else {
			setBgSrc("");
		}
	}, [bg]);

	// Keyboard shortcuts
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				window.close();
				return;
			}
			if ((e.metaKey || e.ctrlKey) && e.key === "z") {
				e.preventDefault();
				setOps((prev) => prev.slice(0, -1));
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	useEffect(() => {
		const handleResize = () => {
			setViewportSize({ w: window.innerWidth, h: window.innerHeight });
		};
		window.addEventListener("resize", handleResize);
		return () => window.removeEventListener("resize", handleResize);
	}, []);

	// Redraw annotation canvas
	const redraw = useCallback(() => {
		const canvas = canvasRef.current;
		const img = imgRef.current;
		if (!canvas || !img || !img.complete || img.naturalWidth === 0) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		ctx.clearRect(0, 0, canvas.width, canvas.height);
		const scale = canvas.width / img.naturalWidth;
		const allOps = pendingOp ? [...ops, pendingOp] : ops;
		for (const op of allOps) drawOp(ctx, op, img, scale);
	}, [ops, pendingOp]);

	useEffect(() => {
		redraw();
	}, [redraw]);

	const getCanvasCoords = (e: React.MouseEvent): [number, number] => {
		const canvas = canvasRef.current!;
		const rect = canvas.getBoundingClientRect();
		return [
			((e.clientX - rect.left) * canvas.width) / rect.width,
			((e.clientY - rect.top) * canvas.height) / rect.height,
		];
	};

	const handlePointerDown = (e: React.MouseEvent) => {
		if (textInput) return;
		e.preventDefault();
		const pos = getCanvasCoords(e);
		setIsDrawing(true);

		switch (tool) {
			case "pen":
				setPendingOp({ type: "pen", points: [pos], color, width: BRUSH_SIZES[brushSize] });
				break;
			case "arrow":
				setPendingOp({ type: "arrow", from: pos, to: pos, color, width: BRUSH_SIZES[brushSize] });
				break;
			case "rect":
				setPendingOp({
					type: "rect",
					x: pos[0],
					y: pos[1],
					w: 0,
					h: 0,
					color,
					width: BRUSH_SIZES[brushSize],
				});
				break;
			case "text":
				setIsDrawing(false);
				setTextInput({ x: pos[0], y: pos[1], value: "" });
				break;
			case "mosaic":
				setPendingOp({ type: "mosaic", cells: [pos], blockSize: 14 });
				break;
		}
	};

	const handlePointerMove = (e: React.MouseEvent) => {
		if (!isDrawing || !pendingOp) return;
		const pos = getCanvasCoords(e);
		switch (pendingOp.type) {
			case "pen":
				setPendingOp({ ...pendingOp, points: [...pendingOp.points, pos] });
				break;
			case "arrow":
				setPendingOp({ ...pendingOp, to: pos });
				break;
			case "rect":
				setPendingOp({ ...pendingOp, w: pos[0] - pendingOp.x, h: pos[1] - pendingOp.y });
				break;
			case "mosaic":
				setPendingOp({ ...pendingOp, cells: [...pendingOp.cells, pos] });
				break;
		}
	};

	const handlePointerUp = () => {
		if (pendingOp) {
			setOps((prev) => [...prev, pendingOp]);
			setPendingOp(null);
		}
		setIsDrawing(false);
	};

	const commitText = () => {
		if (!textInput || !textInput.value.trim()) {
			setTextInput(null);
			return;
		}
		setOps((prev) => [
			...prev,
			{ type: "text", x: textInput.x, y: textInput.y, text: textInput.value, color, size: 20 },
		]);
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
		if (!canvas || !textInput) return {};
		const rect = canvas.getBoundingClientRect();
		const dispX = (textInput.x * rect.width) / canvas.width;
		const dispY = (textInput.y * rect.height) / canvas.height;
		return { left: dispX, top: dispY - 12 };
	};

	// Composite export
	const getCompositeBuffer = async (): Promise<ArrayBuffer | null> => {
		const img = imgRef.current;
		const annoCanvas = canvasRef.current;
		if (!img || !img.complete || img.naturalWidth === 0) return null;

		const outerPadding = isBorderless ? 20 : EXPORT_OUTER_PADDING;
		const frameInset = isBorderless ? 0 : EXPORT_FRAME_INSET;
		const topBarHeight = isBorderless ? 0 : EXPORT_TOP_BAR_HEIGHT;
		const frameRadius = EXPORT_FRAME_RADIUS;
		const imageRadius = EXPORT_IMAGE_RADIUS;
		const frameW = img.naturalWidth + frameInset * 2;
		const frameH = topBarHeight + img.naturalHeight + frameInset * 2;
		const frameX = outerPadding;
		const frameY = outerPadding;
		const imageX = frameX + frameInset;
		const imageY = frameY + topBarHeight + frameInset;
		const W = frameW + outerPadding * 2;
		const H = frameH + outerPadding * 2;

		const exportCanvas = document.createElement("canvas");
		exportCanvas.width = W;
		exportCanvas.height = H;
		const ctx = exportCanvas.getContext("2d")!;

		// Background
		if (bg.kind === "wallpaper" && bgSrc) {
			const bgImg = new Image();
			bgImg.src = bgSrc;
			await new Promise<void>((r) => {
				bgImg.onload = () => r();
				bgImg.onerror = () => r();
			});
			ctx.drawImage(bgImg, 0, 0, W, H);
		} else if (bg.kind === "gradient") {
			drawGradient(ctx, W, H, bg.stops, bg.angle);
		} else {
			ctx.fillStyle = (bg as { kind: "solid"; value: string }).value;
			ctx.fillRect(0, 0, W, H);
		}

		if (isBorderless) {
			ctx.drawImage(img, imageX, imageY);
			if (annoCanvas) {
				ctx.drawImage(annoCanvas, imageX, imageY);
			}

			const blob = await new Promise<Blob | null>((r) => exportCanvas.toBlob(r, "image/png"));
			if (!blob) return null;
			return blob.arrayBuffer();
		}

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
		if (annoCanvas) {
			ctx.drawImage(annoCanvas, imageX, imageY);
		}
		const imageGloss = ctx.createLinearGradient(imageX, imageY, imageX + img.naturalWidth, imageY + img.naturalHeight);
		imageGloss.addColorStop(0, isBorderless ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.09)");
		imageGloss.addColorStop(0.22, isBorderless ? "rgba(255,255,255,0.012)" : "rgba(255,255,255,0.025)");
		imageGloss.addColorStop(0.52, "rgba(255,255,255,0)");
		imageGloss.addColorStop(1, isBorderless ? "rgba(0,0,0,0.03)" : "rgba(0,0,0,0.06)");
		ctx.fillStyle = imageGloss;
		ctx.fillRect(imageX, imageY, img.naturalWidth, img.naturalHeight);
		ctx.restore();

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

		drawNoiseOverlay(ctx, W, H, isBorderless ? 0.008 : 0.014);

		const blob = await new Promise<Blob | null>((r) => exportCanvas.toBlob(r, "image/png"));
		if (!blob) return null;
		return blob.arrayBuffer();
	};

	const handleCopy = async () => {
		const buf = await getCompositeBuffer();
		if (!buf) return;
		const result = await window.electronAPI.copyToClipboard(new Uint8Array(buf));
		if (result.success) {
			showActionToast("copy", "success", "已复制到剪贴板", "可以直接粘贴分享");
			return;
		}
		showActionToast("copy", "error", "复制失败", result.error || "请重试");
	};

	const handleSave = async () => {
		const buf = await getCompositeBuffer();
		if (!buf) return;
		const result = await window.electronAPI.saveScreenshotFinal(buf);
		if (result.success) {
			showActionToast("save", "success", "已保存 PNG", getFileName(result.path));
			return;
		}
		if (!result.canceled) {
			showActionToast("save", "error", "保存失败", result.error || "请重试");
		}
	};

	const handleQuickSave = async () => {
		const buf = await getCompositeBuffer();
		if (!buf) return;
		const result = await window.electronAPI.quickSaveScreenshotFinal(buf);
		if (result.success) {
			showActionToast("quick-save", "success", "已保存到下载目录", getFileName(result.path));
			return;
		}
		showActionToast("quick-save", "error", "快速保存失败", result.error || "请重试");
	};

	// Background CSS style for preview
	const bgStyle: React.CSSProperties =
		bg.kind === "wallpaper"
			? { backgroundImage: `url(${bgSrc})`, backgroundSize: "cover", backgroundPosition: "center" }
			: bg.kind === "gradient"
				? { background: (bg as { kind: "gradient"; css: string }).css }
				: { backgroundColor: (bg as { kind: "solid"; value: string }).value };
	const stageImageWidth = naturalSize.w || 800;
	const stageImageHeight = naturalSize.h || 600;
	const previewStageInset = previewIsBorderless ? 0 : EXPORT_FRAME_INSET;
	const previewTopBarHeight = previewIsBorderless ? 0 : EXPORT_TOP_BAR_HEIGHT;
	const previewStageWidth = stageImageWidth + previewStageInset * 2;
	const previewStageHeight =
		stageImageHeight + previewTopBarHeight + previewStageInset * 2;
	const previewAvailableWidth = Math.max(420, viewportSize.w - 104);
	const previewAvailableHeight = Math.max(320, viewportSize.h - 176);
	const previewStageScale = Math.min(
		1,
		previewAvailableWidth / previewStageWidth,
		previewAvailableHeight / previewStageHeight,
	);

	const toolBtn = (t: Tool, label: string, icon: string) => (
		<button
			key={t}
			onClick={() => setTool(t)}
			title={label}
			className={`flex items-center justify-center w-9 h-9 rounded-xl text-[15px] transition-all ${
				tool === t
					? "bg-white/14 text-white ring-1 ring-white/10 shadow-[0_8px_20px_rgba(25,181,122,0.28)]"
					: "text-white/55 hover:bg-white/8 hover:text-white"
			}`}
		>
			{icon}
		</button>
	);

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
				className={`relative z-10 mx-3 mt-3 flex shrink-0 items-center gap-3 rounded-[22px] border border-white/10 ${IS_MAC ? "pl-[88px] pr-3" : "px-3"} py-2.5`}
				style={{ ...previewChromeTheme.surface, WebkitAppRegion: "drag" } as React.CSSProperties}
			>
				<div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
				<div
					className="min-w-0 flex flex-1 items-center gap-3 overflow-x-auto pr-1"
					style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
				>
				<div
					className="hidden shrink-0 rounded-full border border-white/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.28em] text-white/38 lg:block"
					style={previewChromeTheme.group}
				>
					Markup Studio
				</div>
				<div
					className="flex shrink-0 items-center gap-1 rounded-2xl px-1.5 py-1"
					style={previewChromeTheme.group}
				>
					{toolBtn("pen", "画笔", "✎")}
					{toolBtn("arrow", "箭头", "➜")}
					{toolBtn("rect", "矩形", "▭")}
					{toolBtn("text", "文字", "T")}
					{toolBtn("mosaic", "马赛克", "◼︎")}
				</div>

				<div
					className="flex shrink-0 items-center gap-2 rounded-2xl px-3 py-2"
					style={previewChromeTheme.group}
				>
					<span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/42">Ink</span>
					<div className="flex items-center gap-1.5">
						{PRESET_COLORS.map((c) => (
							<button
								key={c}
								onClick={() => setColor(c)}
								style={{
									background: c,
									boxShadow:
										color === c
											? "0 0 0 2px rgba(255,255,255,0.88), 0 6px 18px rgba(255,255,255,0.12)"
											: "inset 0 1px 0 rgba(255,255,255,0.45)",
								}}
								className="h-5 w-5 rounded-full transition-transform hover:scale-105"
							/>
						))}
						<input
							type="color"
							value={color}
							onChange={(e) => setColor(e.target.value)}
							className="h-6 w-6 cursor-pointer rounded-full border border-white/15 bg-transparent"
							title="自定义颜色"
						/>
					</div>
				</div>

				<div
					className="flex shrink-0 items-center gap-2 rounded-2xl px-3 py-2"
					style={previewChromeTheme.group}
				>
					<span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/42">Weight</span>
					<div className="flex items-center gap-1">
						{BRUSH_SIZES.map((s, i) => (
							<button
								key={s}
								onClick={() => setBrushSize(i)}
								className={`flex h-9 w-9 items-center justify-center rounded-xl transition-all ${
									brushSize === i ? "bg-white/12 ring-1 ring-white/10" : "hover:bg-white/8"
								}`}
							>
								<div className="rounded-full bg-white" style={{ width: s + 4, height: s + 4, opacity: brushSize === i ? 1 : 0.82 }} />
							</button>
						))}
					</div>
				</div>

				<button
					onClick={() => setOps((prev) => prev.slice(0, -1))}
					disabled={ops.length === 0}
					className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-white/65 transition-all hover:bg-white/8 hover:text-white disabled:opacity-30"
					title="撤销 (⌘Z)"
					style={previewChromeTheme.group}
				>
					↩
				</button>

				<div className="hidden shrink-0 items-center gap-2 rounded-2xl px-3 py-2 text-[11px] text-white/55 xl:flex" style={previewChromeTheme.group}>
					<span className="font-semibold tracking-[0.18em] uppercase text-white/38">Canvas</span>
					<span>{naturalSize.w > 0 ? `${naturalSize.w} × ${naturalSize.h}` : "Preparing"}</span>
				</div>
				</div>

				<div className="flex shrink-0 items-center gap-2" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
					<button
						onClick={handleCopy}
						className={`flex h-10 w-10 items-center justify-center rounded-2xl border text-white/86 transition-all ${
							actionToast?.action === "copy" && actionToast.tone === "success"
								? "scale-[1.03] border-white/26 shadow-[0_10px_30px_rgba(255,255,255,0.08)]"
								: "border-white/12 hover:bg-white/12"
						}`}
						style={previewChromeTheme.copyButton}
						title="复制到剪贴板"
					>
						<Copy size={16} strokeWidth={2} />
					</button>
					<button
						onClick={handleQuickSave}
						className={`flex h-10 w-10 items-center justify-center rounded-2xl text-white transition-all ${
							actionToast?.action === "quick-save" && actionToast.tone === "success"
								? "scale-[1.04] shadow-[0_18px_34px_rgba(31,181,118,0.32)]"
								: "hover:scale-[1.01]"
						}`}
						style={previewChromeTheme.primaryButton}
						title="快速保存到下载目录"
					>
						<Download size={16} strokeWidth={2} />
					</button>
					<button
						onClick={handleSave}
						className={`flex h-10 w-10 items-center justify-center rounded-2xl border text-white/86 transition-all ${
							actionToast?.action === "save" && actionToast.tone === "success"
								? "scale-[1.03] border-white/26 shadow-[0_10px_30px_rgba(255,255,255,0.08)]"
								: "border-white/12 hover:bg-white/12"
						}`}
						style={previewChromeTheme.copyButton}
						title="保存 PNG"
					>
						<Save size={16} strokeWidth={2} />
					</button>
					{!IS_MAC && (
						<button
							onClick={() => window.close()}
							className="flex h-10 w-10 items-center justify-center rounded-2xl text-white/50 transition-all hover:bg-white/10 hover:text-white"
							title="关闭"
							style={previewChromeTheme.group}
						>
							✕
						</button>
					)}
				</div>
			</div>

			{/* ── Main canvas area ───────────────────────────────────── */}
			<div
				className="relative z-10 flex-1 overflow-auto px-3 pb-3 pt-2 sm:px-4 sm:pb-4 sm:pt-3"
				style={bgStyle}
			>
				<div
					className="pointer-events-none absolute inset-0"
					style={{
						background:
							"radial-gradient(circle at 50% 26%, rgba(255,255,255,0.14), transparent 34%), linear-gradient(180deg, rgba(255,255,255,0.04), transparent 28%)",
					}}
				/>
				<div className="relative flex min-h-full items-center justify-center">
					{screenshotSrc && (
						<div className="relative flex flex-col items-center">
							{!previewIsBorderless && (
								<>
									<div
										className="pointer-events-none absolute left-1/2 top-6 h-24 w-[72%] -translate-x-1/2 rounded-full blur-3xl"
										style={{
											background: `radial-gradient(circle, ${stageChromeTheme.exportGlow}, rgba(255,255,255,0))`,
											opacity: 0.85,
										}}
									/>
									<div
										className="pointer-events-none absolute left-1/2 top-[calc(100%-18px)] h-16 w-[68%] -translate-x-1/2 rounded-full blur-2xl"
										style={{
											background:
												"radial-gradient(circle, rgba(0,0,0,0.18), rgba(0,0,0,0))",
										}}
									/>
								</>
							)}
							<div
								className="relative m-2 flex-shrink-0 sm:m-3"
								style={{
									width: previewStageWidth * previewStageScale,
									height: previewStageHeight * previewStageScale,
								}}
							>
								{!previewIsBorderless && (
									<div
										className="pointer-events-none absolute left-0 top-0 rounded-[34px]"
										style={{
											width: previewStageWidth * previewStageScale,
											height: previewStageHeight * previewStageScale,
											transform: `translateY(${18 * previewStageScale}px) rotate(-0.5deg)`,
											transformOrigin: "center center",
											background: "rgba(255,255,255,0.028)",
											boxShadow: "0 16px 36px rgba(0,0,0,0.1)",
										}}
									/>
								)}
								<div
									className={`absolute left-0 top-0 overflow-hidden ${previewIsBorderless ? "" : "border"}`}
									style={{
										width: previewStageWidth,
										height: previewStageHeight,
										transform: `scale(${previewStageScale})`,
										transformOrigin: "top left",
										borderRadius: previewIsBorderless ? 0 : EXPORT_FRAME_RADIUS,
										background: previewIsBorderless ? "transparent" : stageChromeTheme.exportFrameFill,
										borderColor: stageChromeTheme.exportFrameStroke,
										boxShadow: previewIsBorderless
											? "none"
											: "inset 0 1px 0 rgba(255,255,255,0.12), 0 1px 0 rgba(255,255,255,0.04)",
									}}
								>
									{!previewIsBorderless && (
										<>
											<div
												className="pointer-events-none absolute inset-x-0 top-0"
												style={{
													height: EXPORT_TOP_BAR_HEIGHT,
													background: stageChromeTheme.exportTopBarFill,
												}}
											/>
											<div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
											<div
												className="pointer-events-none absolute right-0 top-0 w-[180px]"
												style={{
													height: EXPORT_TOP_BAR_HEIGHT,
													background: `linear-gradient(90deg, rgba(255,255,255,0), ${stageChromeTheme.exportAccent}16, rgba(255,255,255,0))`,
												}}
											/>
											<div className="pointer-events-none absolute left-[24px] top-[13px] flex items-center gap-[8px]">
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
												className="pointer-events-none absolute right-0 w-[26%]"
												style={{
													top: EXPORT_TOP_BAR_HEIGHT,
													bottom: 0,
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
												borderRadius: previewIsBorderless ? 0 : EXPORT_IMAGE_RADIUS,
												boxShadow: previewIsBorderless
													? "none"
													: "0 16px 28px rgba(0,0,0,0.28)",
												border: previewIsBorderless
													? "none"
													: "1px solid rgba(255,255,255,0.12)",
											}}
										>
											<img
												ref={imgRef}
												src={screenshotSrc}
												style={{
													display: "block",
													width: stageImageWidth,
													height: stageImageHeight,
													borderRadius: previewIsBorderless ? 0 : EXPORT_IMAGE_RADIUS,
													userSelect: "none",
													imageRendering: "-webkit-optimize-contrast" as React.CSSProperties["imageRendering"],
												}}
												draggable={false}
												onLoad={() => {
													const img = imgRef.current;
													if (img) setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
												}}
											/>
											<div
												className="pointer-events-none absolute inset-0"
												style={{
													background: previewIsBorderless
														? "none"
														: "linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.025) 22%, rgba(255,255,255,0) 50%, rgba(0,0,0,0.06))",
												}}
											/>
											<canvas
												ref={canvasRef}
												width={naturalSize.w || 800}
												height={naturalSize.h || 600}
												style={{
													position: "absolute",
													inset: 0,
													width: "100%",
													height: "100%",
													borderRadius: previewIsBorderless ? 0 : EXPORT_IMAGE_RADIUS,
													cursor: tool === "text" ? "text" : "crosshair",
												}}
												onMouseDown={handlePointerDown}
												onMouseMove={handlePointerMove}
												onMouseUp={handlePointerUp}
											/>
											{textInput && (
												<input
													autoFocus
													value={textInput.value}
													onChange={(e) => setTextInput({ ...textInput, value: e.target.value })}
													onKeyDown={(e) => {
														if (e.key === "Enter") commitText();
														if (e.key === "Escape") setTextInput(null);
													}}
													onBlur={commitText}
													style={{
														position: "absolute",
														...getTextInputStyle(),
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
												/>
											)}
										</div>
									</div>
								</div>
							</div>
						</div>
					)}
				</div>
			</div>

			{/* ── Background strip ──────────────────────────────────── */}
			<div className="relative z-10 px-4 pb-4">
				<div
					className="flex items-center gap-3 overflow-x-auto rounded-[24px] border border-white/10 px-4 py-3"
					style={previewChromeTheme.surface}
				>
					<div className="flex items-center gap-2 pr-1">
						<div className="flex h-8 w-8 items-center justify-center rounded-2xl bg-white/7 text-white/72">
							✦
						</div>
						<div>
							<div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/38">Backdrop</div>
							<div className="text-xs text-white/62">导出背景</div>
						</div>
					</div>
					<div className="h-8 w-px shrink-0 bg-white/8" />
					<div className="flex items-center gap-2 flex-shrink-0">
						<span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/38">Styles</span>
						<div className="flex gap-1.5">
							{(Object.entries(CHROME_THEMES) as [ChromeStyle, (typeof CHROME_THEMES)[ChromeStyle]][]).map(
								([value, theme]) => (
									<button
										key={value}
										onClick={() => setChromeStyle(value)}
										className={`rounded-2xl px-3 py-2 text-[11px] font-medium transition-all ${
											chromeStyle === value
												? "text-white scale-[1.03]"
												: "text-white/65 hover:text-white"
										}`}
										style={{
											background: theme.swatch,
											border:
												chromeStyle === value
													? "1px solid rgba(255,255,255,0.55)"
													: "1px solid rgba(255,255,255,0.12)",
											boxShadow:
												chromeStyle === value
													? "0 12px 24px rgba(0,0,0,0.22)"
													: "inset 0 1px 0 rgba(255,255,255,0.14)",
										}}
									>
										{theme.label}
									</button>
								),
							)}
						</div>
					</div>
					<div className="h-8 w-px shrink-0 bg-white/8" />
					<div className="flex items-center gap-2 flex-shrink-0">
						<span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/38">Wallpapers</span>
						<div className="flex gap-1.5">
					{WALLPAPERS.slice(0, 12).map((wp) => (
						<button
							key={wp}
							onClick={() => setBg({ kind: "wallpaper", value: wp })}
							className={`h-9 w-14 rounded-2xl overflow-hidden border transition-all ${
								bg.kind === "wallpaper" && bg.value === wp
									? "border-white/60 scale-[1.04]"
									: "border-white/10 hover:border-white/28"
							}`}
							style={{
								backgroundImage: `url(/${wp})`,
								backgroundSize: "cover",
								backgroundPosition: "center",
								boxShadow:
									bg.kind === "wallpaper" && bg.value === wp
										? "0 10px 24px rgba(0,0,0,0.24)"
										: undefined,
							}}
						/>
					))}
						</div>
					</div>
					<div className="h-8 w-px shrink-0 bg-white/8" />
					<div className="flex items-center gap-2 flex-shrink-0">
						<span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/38">Gradients</span>
						<div className="flex gap-1.5">
					{GRADIENTS.map((g, i) => {
						const isSelected =
							bg.kind === "gradient" && (bg as { css: string }).css === (g as { css: string }).css;
						return (
							<button
								key={i}
								onClick={() => setBg(g)}
								className={`h-9 w-14 rounded-2xl border transition-all ${
									isSelected
										? "border-white/60 scale-[1.04]"
										: "border-white/10 hover:border-white/28"
								}`}
								style={{
									background: (g as { css: string }).css,
									boxShadow: isSelected
										? "0 10px 24px rgba(0,0,0,0.24)"
										: undefined,
								}}
							/>
						);
					})}
						</div>
					</div>
					<div className="h-8 w-px shrink-0 bg-white/8" />
					<div className="flex items-center gap-2 flex-shrink-0">
						<span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/38">Tones</span>
						<div className="flex gap-1.5">
					{["#1a1a2e", "#0d0d0d", "#f5f5f0", "#1e293b", "#312e81"].map((c) => {
						const isSelected = bg.kind === "solid" && (bg as { value: string }).value === c;
						return (
							<button
								key={c}
								onClick={() => setBg({ kind: "solid", value: c })}
								className={`h-9 w-14 rounded-2xl border transition-all ${
									isSelected
										? "border-white/60 scale-[1.04]"
										: "border-white/12 hover:border-white/28"
								}`}
								style={{
									background: c,
									boxShadow: isSelected
										? "0 10px 24px rgba(0,0,0,0.24)"
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
