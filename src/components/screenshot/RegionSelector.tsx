import { useEffect, useRef, useState } from "react";

export function RegionSelector() {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const imgRef = useRef<HTMLImageElement>(null);
	const [screenSrc, setScreenSrc] = useState<string>("");
	const isSelectingRef = useRef(false);
	const startRef = useRef({ x: 0, y: 0 });
	const currentRef = useRef({ x: 0, y: 0 });
	const [, setTick] = useState(0);

	useEffect(() => {
		const captureHighRes = async (): Promise<string | null> => {
			try {
				const result = await window.electronAPI.getPrimaryScreenSourceId();
				if (!result.success || !result.sourceId) return null;

				const stream = await navigator.mediaDevices.getUserMedia({
					audio: false,
					video: {
						// @ts-expect-error Electron-specific mandatory constraints
						mandatory: {
							chromeMediaSource: "desktop",
							chromeMediaSourceId: result.sourceId,
							maxWidth: 3840,
							maxHeight: 2160,
						},
					},
				});

				const video = document.createElement("video");
				video.srcObject = stream;
				await new Promise<void>((r) => {
					video.onloadedmetadata = () => r();
				});
				await video.play();

				const c = document.createElement("canvas");
				c.width = video.videoWidth;
				c.height = video.videoHeight;
				c.getContext("2d")?.drawImage(video, 0, 0);
				stream.getTracks().forEach((t) => t.stop());

				if (c.width < 2) return null; // sanity check
				return c.toDataURL("image/png");
			} catch {
				return null;
			}
		};

		const captureFallback = async (): Promise<string | null> => {
			try {
				const r = await window.electronAPI.getScreenCapture();
				return r.success && r.imageData ? r.imageData : null;
			} catch {
				return null;
			}
		};

		const init = async () => {
			// Try getUserMedia first (native resolution), fallback to desktopCapturer thumbnail
			let data = await captureHighRes();
			if (!data) data = await captureFallback();
			if (!data) {
				window.close();
				return;
			}
			setScreenSrc(data);
			await window.electronAPI.showRegionSelector();
		};
		init();

		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") window.close();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	// Draw overlay
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		canvas.width = window.innerWidth;
		canvas.height = window.innerHeight;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.fillStyle = "rgba(0,0,0,0.4)";
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		if (isSelectingRef.current) {
			const sx = Math.min(startRef.current.x, currentRef.current.x);
			const sy = Math.min(startRef.current.y, currentRef.current.y);
			const sw = Math.abs(currentRef.current.x - startRef.current.x);
			const sh = Math.abs(currentRef.current.y - startRef.current.y);

			ctx.clearRect(sx, sy, sw, sh);
			ctx.strokeStyle = "#34B27B";
			ctx.lineWidth = 2;
			ctx.strokeRect(sx, sy, sw, sh);

			const hs = 7;
			ctx.fillStyle = "#34B27B";
			for (const [hx, hy] of [
				[sx, sy],
				[sx + sw, sy],
				[sx, sy + sh],
				[sx + sw, sy + sh],
			]) {
				ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
			}

			if (sw > 50 && sh > 30) {
				const label = `${Math.round(sw)} × ${Math.round(sh)}`;
				ctx.font = "bold 12px system-ui";
				const tw = ctx.measureText(label).width;
				const lx = sx + 4;
				const ly = sy > 28 ? sy - 26 : sy + sh + 4;
				ctx.fillStyle = "rgba(0,0,0,0.8)";
				ctx.beginPath();
				ctx.rect(lx, ly, tw + 10, 20);
				ctx.fill();
				ctx.fillStyle = "#34B27B";
				ctx.fillText(label, lx + 5, ly + 14);
			}
		}
	});

	const handleMouseDown = (e: React.MouseEvent) => {
		isSelectingRef.current = true;
		startRef.current = { x: e.clientX, y: e.clientY };
		currentRef.current = { x: e.clientX, y: e.clientY };
		setTick((n) => n + 1);
	};

	const handleMouseMove = (e: React.MouseEvent) => {
		if (!isSelectingRef.current) return;
		currentRef.current = { x: e.clientX, y: e.clientY };
		setTick((n) => n + 1);
	};

	const handleMouseUp = async (e: React.MouseEvent) => {
		if (!isSelectingRef.current) return;
		isSelectingRef.current = false;

		const cssX = Math.min(startRef.current.x, e.clientX);
		const cssY = Math.min(startRef.current.y, e.clientY);
		const cssW = Math.abs(e.clientX - startRef.current.x);
		const cssH = Math.abs(e.clientY - startRef.current.y);

		if (cssW < 10 || cssH < 10) {
			setTick((n) => n + 1);
			return;
		}

		const img = imgRef.current;
		if (!img || !img.complete || img.clientWidth === 0) return;

		const scaleX = img.naturalWidth / img.clientWidth;
		const scaleY = img.naturalHeight / img.clientHeight;
		const rx = Math.round(cssX * scaleX);
		const ry = Math.round(cssY * scaleY);
		const rw = Math.round(cssW * scaleX);
		const rh = Math.round(cssH * scaleY);

		const cropCanvas = document.createElement("canvas");
		cropCanvas.width = rw;
		cropCanvas.height = rh;
		cropCanvas.getContext("2d")?.drawImage(img, rx, ry, rw, rh, 0, 0, rw, rh);

		await window.electronAPI.screenshotRegionSelected(
			cropCanvas.toDataURL("image/png"),
		);
	};

	return (
		<div
			className="fixed inset-0"
			style={{ cursor: "crosshair", background: "transparent" }}
			onMouseDown={handleMouseDown}
			onMouseMove={handleMouseMove}
			onMouseUp={handleMouseUp}
		>
			{screenSrc && (
				<img
					ref={imgRef}
					src={screenSrc}
					className="absolute inset-0 w-full h-full"
					style={{
						objectFit: "fill",
						userSelect: "none",
						pointerEvents: "none",
					}}
					draggable={false}
				/>
			)}
			<canvas
				ref={canvasRef}
				className="absolute inset-0"
				style={{ pointerEvents: "none" }}
			/>
			{screenSrc && !isSelectingRef.current && (
				<div
					className="absolute top-5 left-1/2 -translate-x-1/2 px-5 py-2 rounded-full text-sm text-white"
					style={{
						background: "rgba(0,0,0,0.75)",
						pointerEvents: "none",
						backdropFilter: "blur(8px)",
						userSelect: "none",
						whiteSpace: "nowrap",
					}}
				>
					拖拽选择截图区域 · Esc 取消
				</div>
			)}
		</div>
	);
}
