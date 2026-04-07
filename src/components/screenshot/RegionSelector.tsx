import { useEffect, useRef, useState } from "react";
import { decodeImageData } from "@/lib/decodeImage";

function drawOverlay(
	canvas: HTMLCanvasElement,
	isSelecting: boolean,
	start: { x: number; y: number },
	current: { x: number; y: number },
) {
	const ctx = canvas.getContext("2d");
	if (!ctx) return;

	ctx.clearRect(0, 0, canvas.width, canvas.height);
	ctx.fillStyle = "rgba(0,0,0,0.4)";
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	if (!isSelecting) return;

	const sx = Math.min(start.x, current.x);
	const sy = Math.min(start.y, current.y);
	const sw = Math.abs(current.x - start.x);
	const sh = Math.abs(current.y - start.y);

	ctx.clearRect(sx, sy, sw, sh);
	ctx.strokeStyle = "#34B27B";
	ctx.lineWidth = Math.max(2, Math.round(canvas.width / 900));
	ctx.strokeRect(sx, sy, sw, sh);

	const handleSize = Math.max(8, Math.round(canvas.width / 180));
	ctx.fillStyle = "#34B27B";
	for (const [hx, hy] of [
		[sx, sy],
		[sx + sw, sy],
		[sx, sy + sh],
		[sx + sw, sy + sh],
	]) {
		ctx.fillRect(
			hx - handleSize / 2,
			hy - handleSize / 2,
			handleSize,
			handleSize,
		);
	}

	if (sw > 80 && sh > 48) {
		const label = `${Math.round(sw)} × ${Math.round(sh)}`;
		ctx.font = `bold ${Math.max(16, Math.round(canvas.width / 90))}px system-ui`;
		const textWidth = ctx.measureText(label).width;
		const labelX = sx + 8;
		const labelY = sy > 44 ? sy - 36 : sy + sh + 8;
		ctx.fillStyle = "rgba(0,0,0,0.82)";
		ctx.fillRect(labelX, labelY, textWidth + 18, 28);
		ctx.fillStyle = "#34B27B";
		ctx.fillText(label, labelX + 9, labelY + 20);
	}
}

export function RegionSelector() {
	const sourceCanvasRef = useRef<HTMLCanvasElement>(null);
	const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
	const activeSessionIdRef = useRef<number | null>(null);
	const isSelectingRef = useRef(false);
	const startRef = useRef({ x: 0, y: 0 });
	const currentRef = useRef({ x: 0, y: 0 });
	const [imageReady, setImageReady] = useState(false);
	const [isSelecting, setIsSelecting] = useState(false);

	useEffect(() => {
		const handleCaptureSession = async (payload: {
			sessionId: number;
			imageData: string;
		}) => {
			activeSessionIdRef.current = payload.sessionId;
			isSelectingRef.current = false;
			setIsSelecting(false);
			startRef.current = { x: 0, y: 0 };
			currentRef.current = { x: 0, y: 0 };
			setImageReady(false);

			const image = await decodeImageData(payload.imageData);
			if (activeSessionIdRef.current !== payload.sessionId) {
				return;
			}

			const sourceCanvas = sourceCanvasRef.current;
			const overlayCanvas = overlayCanvasRef.current;
			if (!sourceCanvas || !overlayCanvas) return;

			sourceCanvas.width = image.naturalWidth;
			sourceCanvas.height = image.naturalHeight;
			overlayCanvas.width = image.naturalWidth;
			overlayCanvas.height = image.naturalHeight;

			const sourceContext = sourceCanvas.getContext("2d");
			if (!sourceContext) return;
			sourceContext.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
			sourceContext.drawImage(image, 0, 0);
			drawOverlay(overlayCanvas, false, startRef.current, currentRef.current);

			setImageReady(true);
			await window.electronAPI.regionSelectorReady(payload.sessionId);
		};

		return window.electronAPI.onCaptureSession(handleCaptureSession);
	}, []);

	useEffect(() => {
		const overlayCanvas = overlayCanvasRef.current;
		if (!overlayCanvas || !imageReady) return;
		drawOverlay(
			overlayCanvas,
			isSelectingRef.current,
			startRef.current,
			currentRef.current,
		);
	}, [imageReady]);

	const getCanvasPoint = (e: React.MouseEvent): [number, number] => {
		const canvas = overlayCanvasRef.current!;
		const rect = canvas.getBoundingClientRect();
		return [
			Math.round(((e.clientX - rect.left) * canvas.width) / rect.width),
			Math.round(((e.clientY - rect.top) * canvas.height) / rect.height),
		];
	};

	const redrawCurrentOverlay = () => {
		const overlayCanvas = overlayCanvasRef.current;
		if (!overlayCanvas || !imageReady) return;
		drawOverlay(
			overlayCanvas,
			isSelectingRef.current,
			startRef.current,
			currentRef.current,
		);
	};

	const handleMouseDown = (e: React.MouseEvent) => {
		if (!imageReady) return;
		const [x, y] = getCanvasPoint(e);
		isSelectingRef.current = true;
		setIsSelecting(true);
		startRef.current = { x, y };
		currentRef.current = { x, y };
		redrawCurrentOverlay();
	};

	const handleMouseMove = (e: React.MouseEvent) => {
		if (!imageReady || !isSelectingRef.current) return;
		const [x, y] = getCanvasPoint(e);
		currentRef.current = { x, y };
		redrawCurrentOverlay();
	};

	const handleMouseUp = async (e: React.MouseEvent) => {
		if (!imageReady || !isSelectingRef.current) return;
		isSelectingRef.current = false;
		setIsSelecting(false);

		const [x, y] = getCanvasPoint(e);
		currentRef.current = { x, y };
		redrawCurrentOverlay();

		const sx = Math.min(startRef.current.x, currentRef.current.x);
		const sy = Math.min(startRef.current.y, currentRef.current.y);
		const sw = Math.abs(currentRef.current.x - startRef.current.x);
		const sh = Math.abs(currentRef.current.y - startRef.current.y);
		if (sw < 10 || sh < 10) {
			return;
		}

		const sourceCanvas = sourceCanvasRef.current;
		const sessionId = activeSessionIdRef.current;
		if (!sourceCanvas || sessionId === null) return;

		const cropCanvas = document.createElement("canvas");
		cropCanvas.width = sw;
		cropCanvas.height = sh;
		const cropContext = cropCanvas.getContext("2d");
		if (!cropContext) return;
		cropContext.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

		await window.electronAPI.screenshotRegionSelected({
			sessionId,
			croppedImageData: cropCanvas.toDataURL("image/png"),
		});
	};

	const handleCancel = async () => {
		const sessionId = activeSessionIdRef.current;
		if (sessionId === null) return;
		await window.electronAPI.cancelCaptureSession(sessionId);
	};

	return (
		<div
			className="fixed inset-0"
			style={{
				cursor: imageReady ? "crosshair" : "wait",
				background: "rgba(0,0,0,0.4)",
			}}
			onMouseDown={handleMouseDown}
			onMouseMove={handleMouseMove}
			onMouseUp={handleMouseUp}
			onDoubleClick={(e) => e.preventDefault()}
		>
			<canvas
				ref={sourceCanvasRef}
				className="absolute inset-0 w-full h-full"
				style={{ userSelect: "none", pointerEvents: "none" }}
			/>
			<canvas
				ref={overlayCanvasRef}
				className="absolute inset-0 w-full h-full"
				style={{ pointerEvents: "none" }}
			/>
			{imageReady && !isSelecting && (
				<div
					className="absolute top-5 left-1/2 -translate-x-1/2 px-5 py-2 rounded-full text-sm text-white flex items-center gap-3"
					style={{
						background: "rgba(0,0,0,0.75)",
						pointerEvents: "auto",
						backdropFilter: "blur(8px)",
						userSelect: "none",
						whiteSpace: "nowrap",
					}}
				>
					<span>拖拽选择截图区域</span>
					<button
						type="button"
						onClick={handleCancel}
						className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 transition-colors"
					>
						取消
					</button>
				</div>
			)}
		</div>
	);
}
