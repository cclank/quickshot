import { useCallback, useEffect, useRef, useState } from "react";
import { getAssetPath } from "@/lib/assetPath";

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

// ─── Component ───────────────────────────────────────────────────────────────

export function ScreenshotPreview() {
	const [screenshotSrc, setScreenshotSrc] = useState<string>("");
	const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
	const [tool, setTool] = useState<Tool>("pen");
	const [color, setColor] = useState("#FF3B30");
	const [brushSize, setBrushSize] = useState(1); // index into BRUSH_SIZES
	const [bg, setBg] = useState<BgType>({ kind: "wallpaper", value: WALLPAPERS[0] });
	const [bgSrc, setBgSrc] = useState<string>("");
	const [ops, setOps] = useState<DrawOp[]>([]);
	const [pendingOp, setPendingOp] = useState<DrawOp | null>(null);
	const [isDrawing, setIsDrawing] = useState(false);
	const [textInput, setTextInput] = useState<{ x: number; y: number; value: string } | null>(null);
	const [saved, setSaved] = useState(false);
	const [copied, setCopied] = useState(false);

	const canvasRef = useRef<HTMLCanvasElement>(null);
	const imgRef = useRef<HTMLImageElement>(null);

	// Load pre-cropped screenshot
	useEffect(() => {
		window.electronAPI.getScreenshotData().then((result) => {
			if (result.success && result.imageData) {
				setScreenshotSrc(result.imageData);
			}
		});
	}, []);

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

		const W = img.naturalWidth + PADDING * 2;
		const H = img.naturalHeight + PADDING * 2;

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

		// Shadow + screenshot with rounded corners
		const rx = 12;
		ctx.save();
		ctx.shadowColor = "rgba(0,0,0,0.45)";
		ctx.shadowBlur = 40;
		ctx.shadowOffsetY = 12;
		ctx.beginPath();
		ctx.roundRect(PADDING, PADDING, img.naturalWidth, img.naturalHeight, rx);
		ctx.clip();
		ctx.drawImage(img, PADDING, PADDING);
		if (annoCanvas) {
			ctx.shadowColor = "transparent";
			ctx.shadowBlur = 0;
			ctx.drawImage(annoCanvas, PADDING, PADDING);
		}
		ctx.restore();

		const blob = await new Promise<Blob | null>((r) => exportCanvas.toBlob(r, "image/png"));
		if (!blob) return null;
		return blob.arrayBuffer();
	};

	const handleCopy = async () => {
		const buf = await getCompositeBuffer();
		if (!buf) return;
		await window.electronAPI.copyToClipboard(new Uint8Array(buf));
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	const handleSave = async () => {
		const buf = await getCompositeBuffer();
		if (!buf) return;
		const result = await window.electronAPI.saveScreenshotFinal(buf);
		if (result.success) {
			setSaved(true);
			setTimeout(() => setSaved(false), 2000);
		}
	};

	// Background CSS style for preview
	const bgStyle: React.CSSProperties =
		bg.kind === "wallpaper"
			? { backgroundImage: `url(${bgSrc})`, backgroundSize: "cover", backgroundPosition: "center" }
			: bg.kind === "gradient"
				? { background: (bg as { kind: "gradient"; css: string }).css }
				: { backgroundColor: (bg as { kind: "solid"; value: string }).value };

	const toolBtn = (t: Tool, label: string, icon: string) => (
		<button
			key={t}
			onClick={() => setTool(t)}
			title={label}
			className={`flex items-center justify-center w-8 h-8 rounded-md text-base transition-all ${
				tool === t ? "bg-[#34B27B] text-white" : "text-white/60 hover:text-white hover:bg-white/10"
			}`}
		>
			{icon}
		</button>
	);

	return (
		<div className="flex flex-col h-screen bg-[#111118] text-white select-none overflow-hidden">
			{/* ── Toolbar ───────────────────────────────────────────── */}
			<div className="flex items-center gap-2 pl-[76px] pr-3 py-1.5 bg-[#0a0a10] border-b border-white/[0.08] flex-shrink-0">
				{/* Annotation tools */}
				<div className="flex items-center gap-0.5 pr-2 border-r border-white/10">
					{toolBtn("pen", "画笔", "✏️")}
					{toolBtn("arrow", "箭头", "➤")}
					{toolBtn("rect", "矩形", "⬜")}
					{toolBtn("text", "文字", "T")}
					{toolBtn("mosaic", "马赛克", "⬛")}
				</div>

				{/* Color palette */}
				<div className="flex items-center gap-1 pr-2 border-r border-white/10">
					{PRESET_COLORS.map((c) => (
						<button
							key={c}
							onClick={() => setColor(c)}
							style={{ background: c }}
							className={`w-5 h-5 rounded-full border-2 transition-transform ${
								color === c ? "border-white scale-110" : "border-transparent hover:scale-105"
							}`}
						/>
					))}
					<input
						type="color"
						value={color}
						onChange={(e) => setColor(e.target.value)}
						className="w-5 h-5 rounded cursor-pointer border border-white/20 bg-transparent"
						title="自定义颜色"
					/>
				</div>

				{/* Brush size */}
				<div className="flex items-center gap-1 pr-2 border-r border-white/10">
					{BRUSH_SIZES.map((s, i) => (
						<button
							key={s}
							onClick={() => setBrushSize(i)}
							className={`flex items-center justify-center w-7 h-7 rounded transition-all ${
								brushSize === i ? "bg-white/15" : "hover:bg-white/10"
							}`}
						>
							<div className="rounded-full bg-white" style={{ width: s + 4, height: s + 4 }} />
						</button>
					))}
				</div>

				{/* Undo */}
				<button
					onClick={() => setOps((prev) => prev.slice(0, -1))}
					disabled={ops.length === 0}
					className="flex items-center justify-center w-8 h-8 rounded-md text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-30 transition-all"
					title="撤销 (⌘Z)"
				>
					↩
				</button>

				<div className="flex-1" />

				{/* Copy & Save */}
				<button
					onClick={handleCopy}
					className="px-3 py-1.5 rounded-md text-xs font-medium bg-white/10 hover:bg-white/15 transition-all"
					title="复制到剪贴板"
				>
					{copied ? "✓ 已复制" : "复制"}
				</button>
				<button
					onClick={handleSave}
					className="px-3 py-1.5 rounded-md text-xs font-medium bg-[#34B27B] hover:bg-[#34B27B]/80 transition-all"
					title="保存 PNG"
				>
					{saved ? "✓ 已保存" : "保存"}
				</button>
				<button
					onClick={() => window.close()}
					className="flex items-center justify-center w-7 h-7 rounded-md text-white/50 hover:text-white hover:bg-white/10 transition-all"
					title="关闭"
				>
					✕
				</button>
			</div>

			{/* ── Main canvas area ───────────────────────────────────── */}
			<div
				className="flex-1 flex items-center justify-center overflow-auto relative"
				style={bgStyle}
			>
				{screenshotSrc && (
					<div
						className="relative m-12 flex-shrink-0"
						style={{
							boxShadow: "0 24px 64px rgba(0,0,0,0.55)",
							borderRadius: 12,
						}}
					>
						<img
							ref={imgRef}
							src={screenshotSrc}
							style={{
								display: "block",
								borderRadius: 12,
								maxWidth: "calc(100vw - 200px)",
								maxHeight: "calc(100vh - 180px)",
								userSelect: "none",
								imageRendering: "-webkit-optimize-contrast" as React.CSSProperties["imageRendering"],
							}}
							draggable={false}
							onLoad={() => {
								const img = imgRef.current;
								if (img) setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
							}}
						/>
						{/* Annotation canvas */}
						<canvas
							ref={canvasRef}
							width={naturalSize.w || 800}
							height={naturalSize.h || 600}
							style={{
								position: "absolute",
								inset: 0,
								width: "100%",
								height: "100%",
								borderRadius: 12,
								cursor: tool === "text" ? "text" : "crosshair",
							}}
							onMouseDown={handlePointerDown}
							onMouseMove={handlePointerMove}
							onMouseUp={handlePointerUp}
						/>
						{/* Text input overlay */}
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
									background: "transparent",
									border: "none",
									borderBottom: `2px solid ${color}`,
									outline: "none",
									color,
									fontSize: 20,
									fontWeight: "bold",
									minWidth: 60,
									fontFamily: "system-ui",
								}}
							/>
						)}
					</div>
				)}
			</div>

			{/* ── Background strip ──────────────────────────────────── */}
			<div className="flex items-center gap-2 px-3 py-2 bg-[#0a0a10] border-t border-white/[0.08] overflow-x-auto flex-shrink-0">
				<span className="text-white/30 text-xs flex-shrink-0">背景</span>
				<div className="flex gap-1.5 flex-shrink-0">
					{WALLPAPERS.slice(0, 12).map((wp) => (
						<button
							key={wp}
							onClick={() => setBg({ kind: "wallpaper", value: wp })}
							className={`w-10 h-7 rounded overflow-hidden flex-shrink-0 border-2 transition-all ${
								bg.kind === "wallpaper" && bg.value === wp
									? "border-[#34B27B] scale-105"
									: "border-transparent hover:border-white/30"
							}`}
							style={{
								backgroundImage: `url(/${wp})`,
								backgroundSize: "cover",
								backgroundPosition: "center",
							}}
						/>
					))}
				</div>
				<div className="w-px h-5 bg-white/10 flex-shrink-0" />
				<div className="flex gap-1.5 flex-shrink-0">
					{GRADIENTS.map((g, i) => {
						const isSelected =
							bg.kind === "gradient" && (bg as { css: string }).css === (g as { css: string }).css;
						return (
							<button
								key={i}
								onClick={() => setBg(g)}
								className={`w-10 h-7 rounded overflow-hidden flex-shrink-0 border-2 transition-all ${
									isSelected
										? "border-[#34B27B] scale-105"
										: "border-transparent hover:border-white/30"
								}`}
								style={{ background: (g as { css: string }).css }}
							/>
						);
					})}
				</div>
				<div className="w-px h-5 bg-white/10 flex-shrink-0" />
				{/* Solid colors */}
				<div className="flex gap-1.5 flex-shrink-0">
					{["#1a1a2e", "#0d0d0d", "#f5f5f0", "#1e293b", "#312e81"].map((c) => {
						const isSelected = bg.kind === "solid" && (bg as { value: string }).value === c;
						return (
							<button
								key={c}
								onClick={() => setBg({ kind: "solid", value: c })}
								className={`w-10 h-7 rounded flex-shrink-0 border-2 transition-all ${
									isSelected
										? "border-[#34B27B] scale-105"
										: "border-white/20 hover:border-white/40"
								}`}
								style={{ background: c }}
							/>
						);
					})}
				</div>
			</div>
		</div>
	);
}
