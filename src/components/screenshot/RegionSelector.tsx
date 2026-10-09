import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { bindingLabel, commandFor, useKeymap } from "@/lib/keymap";
import { createFrameObjectUrl } from "@/lib/pngBytes";
import {
	type SelectionPoint as Point,
	type SelectionRect,
	findWindowAt,
	getClampedSelectionRect,
} from "@/lib/selectionGeometry";

/**
 * The capture overlay. It shows the frozen screen exactly as it was, with no
 * dimming: hovering outlines the window under the pointer, a click captures
 * that window, a drag captures an area, and either goes straight to the
 * editor. Esc or a right-click cancels.
 *
 * In scrolling mode (S, or the tray's Scrolling Capture on macOS) the
 * selection starts a scrolling capture of that area instead.
 */

type Drag = { anchor: Point; current: Point; moved: boolean };

type OverlayState = {
	pointer: Point | null;
	/** The window a click would capture, or the whole screen over the desktop. */
	hoverWindow: DetectedWindow | null;
	drag: Drag | null;
	submitting: boolean;
};

/** A soft spectrum, closing back on its first colour so the ring is seamless. */
const SPECTRUM = ["#FF5A7A", "#FF9F43", "#FFD43B", "#38D9A9", "#4DABF7", "#9775FA", "#FF5A7A"];
const OUTLINE = {
	window: { width: 3.5, radius: 12 },
	area: { width: 2.5, radius: 2 },
} as const;
const MIN_SELECTION = 4;
const CLICK_SLOP = 4;
const DECODE_GRACE_MS = 250;

const IDLE_STATE: OverlayState = { pointer: null, hoverWindow: null, drag: null, submitting: false };

function loadImageElement(image: HTMLImageElement, source: string) {
	let settled = false;
	let rejectPromise: (reason?: unknown) => void = () => {};
	let handleLoad = () => {};
	let handleError = () => {};
	const finish = (callback: () => void) => {
		if (settled) return;
		settled = true;
		image.removeEventListener("load", handleLoad);
		image.removeEventListener("error", handleError);
		callback();
	};
	const promise = new Promise<void>((resolve, reject) => {
		rejectPromise = reject;
		let decodeStarted = false;
		const confirmDecoded = () => {
			if (settled || decodeStarted) return;
			if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
				finish(() => reject(new Error("Failed to decode screenshot image")));
				return;
			}
			decodeStarted = true;
			// decode() waits for a rendered frame; never let a window that is not
			// drawing yet hold the capture up. The pixels are already loaded.
			window.setTimeout(() => finish(resolve), DECODE_GRACE_MS);
			image.decode().then(
				() => finish(resolve),
				() => finish(resolve),
			);
		};
		handleLoad = confirmDecoded;
		handleError = () => finish(() => reject(new Error("Failed to load screenshot image")));
		image.addEventListener("load", handleLoad);
		image.addEventListener("error", handleError);
		image.decoding = "sync";
		image.src = source;
		if (image.complete) queueMicrotask(confirmDecoded);
	});
	return {
		promise,
		cancel: () => finish(() => rejectPromise(new Error("Screenshot image load cancelled"))),
	};
}

function dragRect(drag: Drag): SelectionRect {
	return getClampedSelectionRect(drag.anchor, drag.current, {
		width: window.innerWidth,
		height: window.innerHeight,
	});
}

/**
 * The ring's path: just outside `rect` so it never covers what is captured,
 * pulled back inside wherever that would leave the screen.
 */
function ringPath(context: CanvasRenderingContext2D, rect: SelectionRect, width: number, radius: number) {
	const half = width / 2;
	const left = Math.max(half, rect.x - half);
	const top = Math.max(half, rect.y - half);
	const right = Math.min(window.innerWidth - half, rect.x + rect.width + half);
	const bottom = Math.min(window.innerHeight - half, rect.y + rect.height + half);
	context.beginPath();
	context.roundRect(
		left,
		top,
		Math.max(0, right - left),
		Math.max(0, bottom - top),
		Math.min(radius, (right - left) / 2, (bottom - top) / 2),
	);
}

function spectrum(context: CanvasRenderingContext2D, rect: SelectionRect) {
	// Starting at the lower left puts warm colours along the top edge.
	const gradient = context.createConicGradient(
		(3 * Math.PI) / 4,
		rect.x + rect.width / 2,
		rect.y + rect.height / 2,
	);
	SPECTRUM.forEach((color, index) => gradient.addColorStop(index / (SPECTRUM.length - 1), color));
	return gradient;
}

/** Identifies what the overlay shows, so an unchanged ring is not redrawn. */
function overlayKey(canvas: HTMLCanvasElement, state: OverlayState) {
	const target = state.drag?.moved ? dragRect(state.drag) : state.hoverWindow;
	const kind = state.drag?.moved ? "area" : "window";
	return target
		? `${canvas.width}x${canvas.height}:${kind}:${target.x},${target.y},${target.width},${target.height}`
		: `${canvas.width}x${canvas.height}:none`;
}

function drawOverlay(canvas: HTMLCanvasElement, state: OverlayState) {
	const context = canvas.getContext("2d");
	if (!context) return;
	const ratio = canvas.width / Math.max(1, window.innerWidth);
	context.setTransform(1, 0, 0, 1, 0, 0);
	context.clearRect(0, 0, canvas.width, canvas.height);
	context.setTransform(ratio, 0, 0, ratio, 0, 0);

	// The frozen frame is left untouched; only a ring marks the target.
	const ring = (rect: SelectionRect, style: { width: number; radius: number }, glow: boolean) => {
		const gradient = spectrum(context, rect);
		context.save();
		context.strokeStyle = gradient;
		if (glow) {
			ringPath(context, rect, style.width, style.radius);
			context.filter = "blur(7px)";
			context.globalAlpha = 0.55;
			context.lineWidth = style.width + 5;
			context.stroke();
			context.filter = "none";
			context.globalAlpha = 1;
		}
		ringPath(context, rect, style.width, style.radius);
		// A faint shadow keeps the light colours legible on white.
		context.shadowColor = "rgba(0, 0, 0, 0.22)";
		context.shadowBlur = 2;
		context.lineWidth = style.width;
		context.lineJoin = "round";
		context.stroke();
		context.restore();
	};

	if (state.drag?.moved) {
		// No glow while dragging: it would cost a blur on every frame.
		ring(dragRect(state.drag), OUTLINE.area, false);
	} else if (state.hoverWindow) {
		ring(state.hoverWindow, OUTLINE.window, true);
	}
}

export function RegionSelector() {
	const sourceImageRef = useRef<HTMLImageElement>(null);
	const sourceObjectUrlRef = useRef<string | null>(null);
	const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
	const activeSessionIdRef = useRef<number | null>(null);
	const loadingSessionIdRef = useRef<number | null>(null);
	const latestSessionIdRef = useRef(0);
	const cancelImageLoadRef = useRef<(() => void) | null>(null);
	const frameRef = useRef<number | null>(null);
	const drawnKeyRef = useRef("");
	const stateRef = useRef<OverlayState>({ ...IDLE_STATE });
	const windowsRef = useRef<DetectedWindow[]>([]);
	/** False until the window list for this capture has arrived (or failed). */
	const windowsReadyRef = useRef(false);
	const [imageReady, setImageReady] = useState(false);
	const [view, setView] = useState<OverlayState>(IDLE_STATE);
	const [notice, setNotice] = useState<string | null>(null);
	const noticeTimerRef = useRef<number | null>(null);
	const keymap = useKeymap();
	const keymapRef = useRef(keymap);
	keymapRef.current = keymap;
	const scrollAvailableRef = useRef(false);
	const scrollModeRef = useRef(false);
	const [scrollMode, setScrollModeState] = useState(false);
	const setScrollMode = useCallback((enabled: boolean) => {
		scrollModeRef.current = enabled;
		setScrollModeState(enabled);
	}, []);

	useEffect(
		() => () => {
			if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
		},
		[],
	);

	const scheduleRender = useCallback(() => {
		if (frameRef.current !== null) return;
		frameRef.current = requestAnimationFrame(() => {
			frameRef.current = null;
			const canvas = overlayCanvasRef.current;
			if (canvas) {
				const key = overlayKey(canvas, stateRef.current);
				if (key !== drawnKeyRef.current) {
					drawnKeyRef.current = key;
					drawOverlay(canvas, stateRef.current);
				}
			}
			setView({ ...stateRef.current });
		});
	}, []);

	/**
	 * The front-most window at `point`, or the whole screen over the desktop.
	 * Nothing until the window list is known, so the outline does not jump to
	 * the screen edge while it loads.
	 */
	const hoverTargetAt = useCallback((point: Point): DetectedWindow | null => {
		const target = findWindowAt(windowsRef.current, point);
		if (target || !windowsReadyRef.current) return target;
		return {
			x: 0,
			y: 0,
			width: window.innerWidth,
			height: window.innerHeight,
			app: t("region.fullScreen"),
			title: "",
		};
	}, []);

	const applyWindows = useCallback(
		(windows: DetectedWindow[]) => {
			windowsRef.current = windows;
			windowsReadyRef.current = true;
			const state = stateRef.current;
			if (state.pointer && !state.drag) {
				state.hoverWindow = hoverTargetAt(state.pointer);
				scheduleRender();
			}
		},
		[hoverTargetAt, scheduleRender],
	);

	const clearRegionSession = useCallback((clearActiveSession = true) => {
		if (frameRef.current !== null) {
			cancelAnimationFrame(frameRef.current);
			frameRef.current = null;
		}
		stateRef.current = { ...IDLE_STATE };
		setView(stateRef.current);
		scrollAvailableRef.current = false;
		scrollModeRef.current = false;
		setScrollModeState(false);
		if (clearActiveSession) activeSessionIdRef.current = null;
		windowsRef.current = [];
		windowsReadyRef.current = false;
		setImageReady(false);
		cancelImageLoadRef.current?.();
		cancelImageLoadRef.current = null;
		sourceImageRef.current?.removeAttribute("src");
		if (sourceObjectUrlRef.current) {
			URL.revokeObjectURL(sourceObjectUrlRef.current);
			sourceObjectUrlRef.current = null;
		}
		const canvas = overlayCanvasRef.current;
		if (canvas) {
			canvas.width = 0;
			canvas.height = 0;
		}
		drawnKeyRef.current = "";
	}, []);

	const sizeOverlayCanvas = useCallback(() => {
		const canvas = overlayCanvasRef.current;
		if (!canvas) return;
		const ratio = window.devicePixelRatio || 1;
		const width = Math.max(1, Math.round(window.innerWidth * ratio));
		const height = Math.max(1, Math.round(window.innerHeight * ratio));
		if (canvas.width !== width) canvas.width = width;
		if (canvas.height !== height) canvas.height = height;
	}, []);

	// ── Session delivery ──────────────────────────────────────────────────────
	useEffect(() => {
		let disposed = false;
		const handleCaptureSession = async (payload: {
			sessionId: number;
			imageBytes: Uint8Array;
			mimeType?: string;
			scroll?: boolean;
			scrollAvailable?: boolean;
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
			scrollAvailableRef.current = Boolean(payload.scrollAvailable);
			setScrollMode(Boolean(payload.scroll && payload.scrollAvailable));
			let imageLoadCancel: (() => void) | null = null;

			try {
				const image = sourceImageRef.current;
				if (!image) throw new Error("Region selector image is unavailable");
				const sourceObjectUrl = createFrameObjectUrl(payload.imageBytes, payload.mimeType);
				sourceObjectUrlRef.current = sourceObjectUrl;
				const imageLoad = loadImageElement(image, sourceObjectUrl);
				imageLoadCancel = imageLoad.cancel;
				cancelImageLoadRef.current = imageLoad.cancel;
				await imageLoad.promise;
				if (cancelImageLoadRef.current === imageLoad.cancel) cancelImageLoadRef.current = null;
				if (disposed || activeSessionIdRef.current !== payload.sessionId) return;
				sizeOverlayCanvas();
				setImageReady(true);
				const result = await window.electronAPI.regionSelectorReady(payload.sessionId);
				void window.electronAPI.getCaptureWindows?.(payload.sessionId).then((response) => {
					if (response.success && activeSessionIdRef.current === payload.sessionId) {
						applyWindows(response.windows);
					}
				});
				if (!result.success && activeSessionIdRef.current === payload.sessionId) {
					clearRegionSession();
				}
			} catch (error) {
				if (disposed || activeSessionIdRef.current !== payload.sessionId) return;
				console.error("QuickShot region selector failed to load", error);
				clearRegionSession();
				await window.electronAPI.cancelCaptureSession(payload.sessionId).catch(() => {});
			} finally {
				if (imageLoadCancel && cancelImageLoadRef.current === imageLoadCancel) {
					cancelImageLoadRef.current = null;
					imageLoadCancel();
				}
				if (loadingSessionIdRef.current === payload.sessionId) {
					loadingSessionIdRef.current = null;
				}
			}
		};

		const unsubscribe = window.electronAPI.onCaptureSession(handleCaptureSession);
		const unsubscribeWindows = window.electronAPI.onCaptureWindows?.((payload) => {
			if (payload.sessionId === activeSessionIdRef.current) applyWindows(payload.windows);
		});
		void window.electronAPI
			.getRegionCaptureSession()
			.then((result) => {
				if (!disposed && result.success && result.session) void handleCaptureSession(result.session);
			})
			.catch((error) => console.error("QuickShot region session request failed", error));

		return () => {
			disposed = true;
			unsubscribe();
			unsubscribeWindows?.();
			clearRegionSession();
		};
	}, [applyWindows, clearRegionSession, setScrollMode, sizeOverlayCanvas]);

	const cancel = useCallback(async () => {
		const sessionId = activeSessionIdRef.current;
		if (sessionId === null) return;
		try {
			const result = await window.electronAPI.cancelCaptureSession(sessionId);
			if (result.success && activeSessionIdRef.current === sessionId) clearRegionSession();
		} catch (error) {
			console.error("QuickShot region session cancellation failed", error);
		}
	}, [clearRegionSession]);

	useEffect(() => {
		// Safety net: end the session if the overlay really went away, but ignore
		// the brief visibility changes that happen while windows swap focus.
		let timer = 0;
		const handleVisibilityChange = () => {
			window.clearTimeout(timer);
			if (document.visibilityState !== "hidden") return;
			timer = window.setTimeout(() => {
				if (document.visibilityState !== "hidden") return;
				const sessionId = activeSessionIdRef.current;
				clearRegionSession();
				if (sessionId !== null) void window.electronAPI.cancelCaptureSession(sessionId).catch(() => {});
			}, 400);
		};
		document.addEventListener("visibilitychange", handleVisibilityChange);
		return () => {
			window.clearTimeout(timer);
			document.removeEventListener("visibilitychange", handleVisibilityChange);
		};
	}, [clearRegionSession]);

	useLayoutEffect(() => {
		if (!imageReady) return;
		const handleResize = () => {
			sizeOverlayCanvas();
			scheduleRender();
		};
		handleResize();
		window.addEventListener("resize", handleResize);
		return () => window.removeEventListener("resize", handleResize);
	}, [imageReady, scheduleRender, sizeOverlayCanvas]);

	useEffect(() => {
		if (!imageReady) return;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				void cancel();
				return;
			}
			// S (or whatever Settings says) switches between a regular and a scrolling capture.
			if (
				!event.repeat &&
				scrollAvailableRef.current &&
				!stateRef.current.submitting &&
				commandFor(keymapRef.current, event, "overlay") === "overlay.scroll"
			) {
				event.preventDefault();
				setScrollMode(!scrollModeRef.current);
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [cancel, imageReady, setScrollMode]);

	// ── Completion ────────────────────────────────────────────────────────────
	/**
	 * Opens the editor with `rect` (CSS pixels). The main process does the
	 * cropping from the lossless frame, or captures a clicked window on its own.
	 * In scrolling mode it starts a scrolling capture of `rect` instead.
	 */
	const submit = useCallback(
		async (rect: SelectionRect, target: DetectedWindow | null) => {
			const state = stateRef.current;
			const image = sourceImageRef.current;
			const sessionId = activeSessionIdRef.current;
			if (!image || sessionId === null || state.submitting) return;
			const scaleX = image.naturalWidth / window.innerWidth;
			const scaleY = image.naturalHeight / window.innerHeight;
			const x = Math.max(0, Math.round(rect.x * scaleX));
			const y = Math.max(0, Math.round(rect.y * scaleY));
			const pixels = {
				x,
				y,
				width: Math.min(image.naturalWidth - x, Math.round(rect.width * scaleX)),
				height: Math.min(image.naturalHeight - y, Math.round(rect.height * scaleY)),
			};
			if (pixels.width < MIN_SELECTION || pixels.height < MIN_SELECTION) return;
			const scroll = scrollModeRef.current;
			state.submitting = true;
			scheduleRender();

			try {
				const result = await window.electronAPI.screenshotRegionSelected({
					sessionId,
					action: scroll ? "scroll" : "edit",
					rect: pixels,
					windowId: scroll ? undefined : target?.id,
				});
				if (activeSessionIdRef.current !== sessionId || result.success) return;
				if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
				setNotice(t("region.actionFailed"));
				noticeTimerRef.current = window.setTimeout(() => setNotice(null), 2400);
			} catch (error) {
				console.error("QuickShot could not hand the selection to the editor", error);
			}
			state.submitting = false;
			state.drag = null;
			scheduleRender();
		},
		[scheduleRender],
	);

	// ── Pointer ───────────────────────────────────────────────────────────────
	const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		if (!imageReady || stateRef.current.submitting) return;
		if (event.button === 2) {
			void cancel();
			return;
		}
		if (event.button !== 0) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		const point = { x: event.clientX, y: event.clientY };
		stateRef.current.drag = { anchor: point, current: point, moved: false };
		stateRef.current.pointer = point;
		scheduleRender();
	};

	const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		if (!imageReady) return;
		const state = stateRef.current;
		const point = { x: event.clientX, y: event.clientY };
		state.pointer = point;
		if (state.submitting) return;
		const drag = state.drag;
		if (drag) {
			drag.current = point;
			if (!drag.moved && Math.hypot(point.x - drag.anchor.x, point.y - drag.anchor.y) >= CLICK_SLOP) {
				drag.moved = true;
				state.hoverWindow = null;
			}
		} else {
			state.hoverWindow = hoverTargetAt(point);
		}
		scheduleRender();
	};

	const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		const state = stateRef.current;
		const drag = state.drag;
		if (!drag || state.submitting) return;
		if (drag.moved) {
			const rect = dragRect(drag);
			if (rect.width >= MIN_SELECTION && rect.height >= MIN_SELECTION) {
				void submit(rect, null);
				return;
			}
			state.drag = null;
			scheduleRender();
			return;
		}
		// A click captures the window under the pointer, or the whole screen.
		const target = findWindowAt(windowsRef.current, drag.anchor);
		void submit(target ?? { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }, target);
	};

	// ── Render ────────────────────────────────────────────────────────────────
	const image = sourceImageRef.current;
	const pixelScale = image && image.naturalWidth > 0 ? image.naturalWidth / window.innerWidth : 1;
	const dragging = view.drag?.moved ? dragRect(view.drag) : null;
	const hovered = view.drag?.moved ? null : view.hoverWindow;
	const labelTarget = dragging ?? hovered;
	const labelPosition = labelTarget
		? {
				left: Math.min(Math.max(6, labelTarget.x + 4), window.innerWidth - 220),
				top: labelTarget.y > 40 ? labelTarget.y - 34 : labelTarget.y + 10,
			}
		: null;

	return (
		<div
			className="fixed inset-0 select-none overflow-hidden"
			style={{
				cursor: !imageReady ? "wait" : view.submitting ? "progress" : "crosshair",
				background: imageReady ? "transparent" : "rgba(0,0,0,0.001)",
				touchAction: "none",
			}}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerUp}
			onPointerCancel={handlePointerUp}
			onContextMenu={(event) => event.preventDefault()}
		>
			<img
				ref={sourceImageRef}
				alt=""
				aria-hidden="true"
				draggable={false}
				className="pointer-events-none absolute inset-0 h-full w-full"
				style={{ objectFit: "fill" }}
			/>
			<canvas ref={overlayCanvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />

			{labelTarget && labelPosition && !view.submitting && (
				<div
					className="pointer-events-none absolute flex max-w-[60%] items-center gap-2 rounded-[7px] border border-white/10 bg-[rgba(24,24,27,0.82)] px-2 py-1 text-[11.5px] font-medium text-white shadow-[0_6px_18px_rgba(0,0,0,0.28)] backdrop-blur-md"
					style={labelPosition}
				>
					{!dragging && hovered?.app && <span className="truncate font-semibold">{hovered.app}</span>}
					<span className="shrink-0 tabular-nums text-white/70">
						{Math.round(labelTarget.width * pixelScale)} × {Math.round(labelTarget.height * pixelScale)}
					</span>
				</div>
			)}

			{scrollMode && imageReady && !view.submitting && (
				<div
					role="status"
					className="pointer-events-none absolute left-1/2 top-6 flex -translate-x-1/2 items-center gap-3 rounded-full border border-white/10 bg-[rgba(30,30,32,0.92)] py-2 pl-3 pr-2 text-[12.5px] text-white shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur-xl"
				>
					<span
						aria-hidden="true"
						className="h-2.5 w-2.5 shrink-0 rounded-full"
						style={{ background: `conic-gradient(${SPECTRUM.join(", ")})` }}
					/>
					<span className="font-semibold">{t("region.scrollTitle")}</span>
					<span className="text-white/70">{t("region.scrollHint")}</span>
					{keymap["overlay.scroll"] && (
						<span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11.5px] text-white/70">
							{t("region.scrollToggle", { key: bindingLabel(keymap["overlay.scroll"]) })}
						</span>
					)}
				</div>
			)}

			{notice && (
				<div
					role="alert"
					className={`pointer-events-none absolute left-1/2 ${scrollMode ? "top-[72px]" : "top-6"} -translate-x-1/2 rounded-full bg-[rgba(30,30,32,0.92)] px-4 py-2 text-[12.5px] font-medium text-white shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur-xl`}
				>
					{notice}
				</div>
			)}
		</div>
	);
}
