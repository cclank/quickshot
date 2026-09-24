import { useCallback, useEffect, useRef, useState } from "react";
import { createPngObjectUrl } from "@/lib/pngBytes";
import {
	clampCoordinate,
	clampSelectionPoint,
	getClampedSelectionRect,
	type SelectionPoint as Point,
	type SelectionSize as Size,
} from "@/lib/selectionGeometry";

function loadImageElement(image: HTMLImageElement, source: string) {
	let settled = false;
	let decodeStarted = false;
	let rejectPromise: (reason?: unknown) => void = () => {};
	let handleLoad = () => {};
	let handleError = () => {};

	const cleanup = () => {
		image.removeEventListener("load", handleLoad);
		image.removeEventListener("error", handleError);
	};
	const finish = (callback: () => void) => {
		if (settled) return;
		settled = true;
		cleanup();
		callback();
	};
	const promise = new Promise<void>((resolve, reject) => {
		rejectPromise = reject;

		const confirmDecoded = () => {
			if (settled) return;
			if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
				finish(() => reject(new Error("Failed to decode screenshot image")));
				return;
			}
			if (typeof image.decode !== "function") {
				finish(resolve);
				return;
			}
			if (decodeStarted) return;
			decodeStarted = true;
			void image.decode().then(
				() => finish(resolve),
				() => {
					if (image.complete && image.naturalWidth > 0) {
						finish(resolve);
						return;
					}
					finish(() => reject(new Error("Failed to decode screenshot image")));
				},
			);
		};

		handleLoad = () => {
			confirmDecoded();
		};

		handleError = () => {
			finish(() => reject(new Error("Failed to load screenshot image")));
		};

		image.addEventListener("load", handleLoad);
		image.addEventListener("error", handleError);
		image.decoding = "sync";
		image.src = source;
		if (image.complete) {
			queueMicrotask(confirmDecoded);
		}
	});

	return {
		promise,
		cancel: () => {
			finish(() => rejectPromise(new Error("Screenshot image load cancelled")));
		},
	};
}

function drawOverlay(
	canvas: HTMLCanvasElement,
	isSelecting: boolean,
	start: Point,
	current: Point,
	sourceSize: Size,
) {
	const ctx = canvas.getContext("2d");
	if (!ctx) return;

	ctx.clearRect(0, 0, canvas.width, canvas.height);
	ctx.fillStyle = "rgba(0,0,0,0.4)";
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	if (
		!isSelecting ||
		sourceSize.width <= 0 ||
		sourceSize.height <= 0
	) {
		return;
	}

	const safeStart = clampSelectionPoint(start, sourceSize);
	const safeCurrent = clampSelectionPoint(current, sourceSize);
	const sourceX = Math.min(safeStart.x, safeCurrent.x);
	const sourceY = Math.min(safeStart.y, safeCurrent.y);
	const sourceWidth = Math.abs(safeCurrent.x - safeStart.x);
	const sourceHeight = Math.abs(safeCurrent.y - safeStart.y);
	const scaleX = canvas.width / sourceSize.width;
	const scaleY = canvas.height / sourceSize.height;
	const sx = sourceX * scaleX;
	const sy = sourceY * scaleY;
	const sw = sourceWidth * scaleX;
	const sh = sourceHeight * scaleY;

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
		const label = `${sourceWidth} × ${sourceHeight}`;
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

function releaseCanvas(canvas: HTMLCanvasElement | null) {
	if (!canvas) return;
	canvas.width = 0;
	canvas.height = 0;
}

async function canvasToPngBytes(canvas: HTMLCanvasElement) {
	let blob: Blob | null;
	try {
		blob = await new Promise<Blob | null>((resolve) => {
			canvas.toBlob(resolve, "image/png");
		});
	} finally {
		releaseCanvas(canvas);
	}
	if (!blob) {
		throw new Error("Failed to encode selected screenshot region");
	}
	return new Uint8Array(await blob.arrayBuffer());
}

export function RegionSelector() {
	const sourceImageRef = useRef<HTMLImageElement>(null);
	const sourceObjectUrlRef = useRef<string | null>(null);
	const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
	const activeSessionIdRef = useRef<number | null>(null);
	const loadingSessionIdRef = useRef<number | null>(null);
	const latestSessionIdRef = useRef(0);
	const cancelImageLoadRef = useRef<(() => void) | null>(null);
	const sourceSizeRef = useRef<Size>({ width: 0, height: 0 });
	const isSelectingRef = useRef(false);
	const startRef = useRef({ x: 0, y: 0 });
	const currentRef = useRef({ x: 0, y: 0 });
	const overlayFrameRef = useRef<number | null>(null);
	const overlayBoundsRef = useRef<{
		left: number;
		top: number;
		width: number;
		height: number;
	} | null>(null);
	const [imageReady, setImageReady] = useState(false);
	const [isSelecting, setIsSelecting] = useState(false);
	const updateOverlayBounds = useCallback(() => {
		const canvas = overlayCanvasRef.current;
		if (!canvas) return null;
		const rect = canvas.getBoundingClientRect();
		const bounds = {
			left: rect.left,
			top: rect.top,
			width: rect.width,
			height: rect.height,
		};
		overlayBoundsRef.current = bounds;
		return bounds;
	}, []);
	const clearRegionSession = useCallback((clearActiveSession = true) => {
		if (overlayFrameRef.current !== null) {
			window.cancelAnimationFrame(overlayFrameRef.current);
			overlayFrameRef.current = null;
		}
		isSelectingRef.current = false;
		if (clearActiveSession) activeSessionIdRef.current = null;
		setIsSelecting(false);
		setImageReady(false);
		cancelImageLoadRef.current?.();
		cancelImageLoadRef.current = null;
		sourceImageRef.current?.removeAttribute("src");
		if (sourceObjectUrlRef.current) {
			URL.revokeObjectURL(sourceObjectUrlRef.current);
			sourceObjectUrlRef.current = null;
		}
		sourceSizeRef.current = { width: 0, height: 0 };
		overlayBoundsRef.current = null;
		releaseCanvas(overlayCanvasRef.current);
	}, []);

	useEffect(() => {
		let disposed = false;
		const handleCaptureSession = async (payload: {
			sessionId: number;
			imageBytes: Uint8Array;
		}) => {
			if (
				disposed ||
				payload.sessionId <= latestSessionIdRef.current ||
				activeSessionIdRef.current === payload.sessionId ||
				loadingSessionIdRef.current === payload.sessionId
			) {
				return;
			}
			latestSessionIdRef.current = payload.sessionId;
			loadingSessionIdRef.current = payload.sessionId;
			clearRegionSession(false);
			activeSessionIdRef.current = payload.sessionId;
			startRef.current = { x: 0, y: 0 };
			currentRef.current = { x: 0, y: 0 };
			let imageLoadCancel: (() => void) | null = null;

			try {
				const image = sourceImageRef.current;
				if (!image) {
					throw new Error("Region selector image is unavailable");
				}
				const sourceObjectUrl = createPngObjectUrl(payload.imageBytes);
				sourceObjectUrlRef.current = sourceObjectUrl;
				const imageLoad = loadImageElement(image, sourceObjectUrl);
				imageLoadCancel = imageLoad.cancel;
				cancelImageLoadRef.current = imageLoad.cancel;
				await imageLoad.promise;
				if (cancelImageLoadRef.current === imageLoad.cancel) {
					cancelImageLoadRef.current = null;
				}
				if (disposed || activeSessionIdRef.current !== payload.sessionId) {
					return;
				}

				const overlayCanvas = overlayCanvasRef.current;
				if (!overlayCanvas) {
					throw new Error("Region selector overlay is unavailable");
				}
				if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
					throw new Error("Region selector image has invalid dimensions");
				}
				sourceSizeRef.current = {
					width: image.naturalWidth,
					height: image.naturalHeight,
				};
				const overlayBounds = updateOverlayBounds();
				overlayCanvas.width = Math.max(
					1,
					Math.round(overlayBounds?.width || window.innerWidth),
				);
				overlayCanvas.height = Math.max(
					1,
					Math.round(overlayBounds?.height || window.innerHeight),
				);

				drawOverlay(
					overlayCanvas,
					false,
					startRef.current,
					currentRef.current,
					sourceSizeRef.current,
				);

				setImageReady(true);
				const result =
					await window.electronAPI.regionSelectorReady(payload.sessionId);
				if (!result.success && activeSessionIdRef.current === payload.sessionId) {
					clearRegionSession();
				}
			} catch (error) {
				if (disposed || activeSessionIdRef.current !== payload.sessionId) {
					return;
				}
				console.error("QuickShot region selector failed to load", error);
				clearRegionSession();
				await window.electronAPI
					.cancelCaptureSession(payload.sessionId)
					.catch((cancelError) => {
						console.error(
							"QuickShot region session cancellation failed",
							cancelError,
						);
					});
			} finally {
				if (
					imageLoadCancel &&
					cancelImageLoadRef.current === imageLoadCancel
				) {
					cancelImageLoadRef.current = null;
					imageLoadCancel();
				}
				if (loadingSessionIdRef.current === payload.sessionId) {
					loadingSessionIdRef.current = null;
				}
			}
		};

		const unsubscribe = window.electronAPI.onCaptureSession(handleCaptureSession);
		void window.electronAPI
			.getRegionCaptureSession()
			.then((result) => {
				if (!disposed && result.success && result.session) {
					void handleCaptureSession(result.session);
				}
			})
			.catch((error) => {
				console.error("QuickShot region session request failed", error);
			});

		return () => {
			disposed = true;
			unsubscribe();
			if (overlayFrameRef.current !== null) {
				window.cancelAnimationFrame(overlayFrameRef.current);
				overlayFrameRef.current = null;
			}
			activeSessionIdRef.current = null;
			isSelectingRef.current = false;
			cancelImageLoadRef.current?.();
			cancelImageLoadRef.current = null;
			sourceImageRef.current?.removeAttribute("src");
			if (sourceObjectUrlRef.current) {
				URL.revokeObjectURL(sourceObjectUrlRef.current);
				sourceObjectUrlRef.current = null;
			}
			sourceSizeRef.current = { width: 0, height: 0 };
			overlayBoundsRef.current = null;
			releaseCanvas(overlayCanvasRef.current);
		};
	}, [clearRegionSession, updateOverlayBounds]);

	useEffect(() => {
		const handleVisibilityChange = () => {
			if (document.visibilityState === "hidden") {
				const sessionId = activeSessionIdRef.current;
				clearRegionSession();
				if (sessionId !== null) {
					void window.electronAPI.cancelCaptureSession(sessionId).catch(() => {});
				}
			}
		};
		document.addEventListener("visibilitychange", handleVisibilityChange);
		return () => {
			document.removeEventListener("visibilitychange", handleVisibilityChange);
		};
	}, [clearRegionSession]);

	useEffect(() => {
		if (!imageReady) return;
		const resizeAndRedrawOverlay = () => {
			const overlayCanvas = overlayCanvasRef.current;
			if (!overlayCanvas) return;
			const overlayBounds = updateOverlayBounds();
			const width = Math.max(
				1,
				Math.round(overlayBounds?.width || window.innerWidth),
			);
			const height = Math.max(
				1,
				Math.round(overlayBounds?.height || window.innerHeight),
			);
			if (overlayCanvas.width !== width) overlayCanvas.width = width;
			if (overlayCanvas.height !== height) overlayCanvas.height = height;
			drawOverlay(
				overlayCanvas,
				isSelectingRef.current,
				startRef.current,
				currentRef.current,
				sourceSizeRef.current,
			);
		};
		const handleResize = () => {
			if (overlayFrameRef.current !== null) return;
			overlayFrameRef.current = window.requestAnimationFrame(() => {
				overlayFrameRef.current = null;
				resizeAndRedrawOverlay();
			});
		};
		resizeAndRedrawOverlay();
		window.addEventListener("resize", handleResize);
		return () => {
			window.removeEventListener("resize", handleResize);
			if (overlayFrameRef.current !== null) {
				window.cancelAnimationFrame(overlayFrameRef.current);
				overlayFrameRef.current = null;
			}
		};
	}, [imageReady, updateOverlayBounds]);

	const getCanvasPoint = (
		e: React.PointerEvent<HTMLDivElement>,
		refreshBounds = false,
	): [number, number] => {
		const canvas = overlayCanvasRef.current;
		const sourceSize = sourceSizeRef.current;
		if (
			!canvas ||
			sourceSize.width <= 0 ||
			sourceSize.height <= 0
		) {
			return [0, 0];
		}
		const bounds =
			(refreshBounds ? updateOverlayBounds() : null) ??
			overlayBoundsRef.current ??
			updateOverlayBounds();
		if (!bounds || bounds.width <= 0 || bounds.height <= 0) return [0, 0];
		return [
			clampCoordinate(
				((e.clientX - bounds.left) * sourceSize.width) / bounds.width,
				sourceSize.width,
			),
			clampCoordinate(
				((e.clientY - bounds.top) * sourceSize.height) / bounds.height,
				sourceSize.height,
			),
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
			sourceSizeRef.current,
		);
	};

	const scheduleOverlayRedraw = () => {
		if (overlayFrameRef.current !== null) return;
		overlayFrameRef.current = window.requestAnimationFrame(() => {
			overlayFrameRef.current = null;
			redrawCurrentOverlay();
		});
	};

	const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
		if (!imageReady) return;
		e.currentTarget.setPointerCapture(e.pointerId);
		const [x, y] = getCanvasPoint(e, true);
		isSelectingRef.current = true;
		setIsSelecting(true);
		startRef.current = { x, y };
		currentRef.current = { x, y };
		redrawCurrentOverlay();
	};

	const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
		if (!imageReady || !isSelectingRef.current) return;
		const [x, y] = getCanvasPoint(e);
		currentRef.current = { x, y };
		scheduleOverlayRedraw();
	};

	const handlePointerUp = async (e: React.PointerEvent<HTMLDivElement>) => {
		const wasSelecting = imageReady && isSelectingRef.current;
		isSelectingRef.current = false;
		setIsSelecting(false);
		if (e.currentTarget.hasPointerCapture(e.pointerId)) {
			e.currentTarget.releasePointerCapture(e.pointerId);
		}
		if (!wasSelecting) return;

		const [x, y] = getCanvasPoint(e);
		currentRef.current = { x, y };
		if (overlayFrameRef.current !== null) {
			window.cancelAnimationFrame(overlayFrameRef.current);
			overlayFrameRef.current = null;
		}
		redrawCurrentOverlay();

		const sourceImage = sourceImageRef.current;
		const sessionId = activeSessionIdRef.current;
		if (
			!sourceImage ||
			sessionId === null ||
			sourceImage.naturalWidth <= 0 ||
			sourceImage.naturalHeight <= 0
		) {
			return;
		}
		const sourceSize = {
			width: sourceImage.naturalWidth,
			height: sourceImage.naturalHeight,
		};
		const start = clampSelectionPoint(startRef.current, sourceSize);
		const current = clampSelectionPoint(currentRef.current, sourceSize);
		startRef.current = start;
		currentRef.current = current;
		const selectionRect = getClampedSelectionRect(start, current, sourceSize);
		const { x: sx, y: sy, width: sw, height: sh } = selectionRect;
		if (sw < 10 || sh < 10) {
			return;
		}

		setImageReady(false);

		const cropCanvas = document.createElement("canvas");
		cropCanvas.width = sw;
		cropCanvas.height = sh;
		const cropContext = cropCanvas.getContext("2d");
		if (!cropContext) {
			releaseCanvas(cropCanvas);
			setImageReady(true);
			return;
		}
		cropContext.drawImage(sourceImage, sx, sy, sw, sh, 0, 0, sw, sh);

		try {
			const croppedImageBytes = await canvasToPngBytes(cropCanvas);
			if (activeSessionIdRef.current !== sessionId) return;
			const result = await window.electronAPI.screenshotRegionSelected({
				sessionId,
				croppedImageBytes,
			});
			if (result.success && activeSessionIdRef.current === sessionId) {
				clearRegionSession();
				return;
			}
			if (activeSessionIdRef.current === sessionId) setImageReady(true);
		} catch (error) {
			releaseCanvas(cropCanvas);
			console.error("QuickShot selected region encoding failed", error);
			if (activeSessionIdRef.current === sessionId) setImageReady(true);
		}
	};

	const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
		const wasSelecting = isSelectingRef.current;
		isSelectingRef.current = false;
		setIsSelecting(false);
		if (e.currentTarget.hasPointerCapture(e.pointerId)) {
			e.currentTarget.releasePointerCapture(e.pointerId);
		}
		if (overlayFrameRef.current !== null) {
			window.cancelAnimationFrame(overlayFrameRef.current);
			overlayFrameRef.current = null;
		}
		if (wasSelecting) redrawCurrentOverlay();
	};

	const handleCancel = async () => {
		const sessionId = activeSessionIdRef.current;
		if (sessionId === null) return;
		try {
			const result = await window.electronAPI.cancelCaptureSession(sessionId);
			if (result.success && activeSessionIdRef.current === sessionId) {
				clearRegionSession();
			}
		} catch (error) {
			console.error("QuickShot region session cancellation failed", error);
		}
	};

	return (
		<div
			className="fixed inset-0"
			style={{
				cursor: imageReady ? "crosshair" : "wait",
				background: "rgba(0,0,0,0.4)",
				touchAction: "none",
			}}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerUp}
			onPointerCancel={handlePointerCancel}
			onLostPointerCapture={handlePointerCancel}
			onDoubleClick={(e) => e.preventDefault()}
		>
			<img
				ref={sourceImageRef}
				alt=""
				aria-hidden="true"
				draggable={false}
				className="absolute inset-0 w-full h-full"
				style={{
					userSelect: "none",
					pointerEvents: "none",
					objectFit: "fill",
				}}
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
						onPointerDown={(event) => event.stopPropagation()}
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
