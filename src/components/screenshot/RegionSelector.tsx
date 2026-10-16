import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { renderStyledCopy } from "@/editor/quickCompose";
import {
	createHistory,
	pushHistory,
	type History,
	redoHistory,
	undoHistory,
} from "@/editor/history";
import {
	createAnnotationId,
	findAnnotationAt,
	getHandleCursor,
	getHandles,
	getVisualBounds,
	hitTestHandle,
	isMeaningfulAnnotation,
	nextCounterValue,
	resizeAnnotation,
	translateAnnotation,
} from "@/editor/annotations";
import {
	createCounterDraft,
	createDraft,
	createTextDraft,
	finalizeDraft,
	grabbableAnnotations,
	handlesActive,
	positionTextDraft,
	replaceAnnotation,
	toolCursor,
	updateDraft,
} from "@/editor/drawing";
import { type AnnotationRenderEnv, drawAnnotations } from "@/editor/renderAnnotations";
import { clipAnnotationsToCrop } from "@/editor/overlayAnnotations";
import {
	DEFAULT_TOOL_STYLE,
	type ToolStyle,
	CAPTURE_TOOL_ORDER,
	normalizeToolStyle,
} from "@/editor/presets";
import { loadTool, loadToolStyle, saveTool, saveToolStyle } from "@/editor/persistence";
import { applyStyleToAnnotation, styleFromAnnotation } from "@/editor/styleMapping";
import { measureTextAnnotation } from "@/editor/textLayout";
import type {
	Annotation,
	AnnotationKind,
	Point,
	TextAnnotation,
	Tool,
} from "@/editor/types";
import { readStoredJson, writeStoredJson } from "@/lib/storage";
import { t } from "@/lib/i18n";
import { bindingLabel, commandFor, useKeymap } from "@/lib/keymap";
import { createFrameObjectUrl } from "@/lib/pngBytes";
import { Check, Copy, X } from "lucide-react";
import { AnnotationSelectionOverlay, AnnotationTextEditor } from "@/components/editor/AnnotationSurface";
import { OverlayToolbar } from "./OverlayToolbar";
import {
	type SelectionPoint as Point2,
	type SelectionHandle,
	type SelectionRect,
	adjustSelection,
	findWindowAt,
	getClampedSelectionRect,
	selectionCursor,
	selectionHandleAt,
} from "@/lib/selectionGeometry";

/**
 * The capture overlay. It shows the frozen screen exactly as it was, with no
 * dimming: hovering outlines the window under the pointer, and a click
 * captures that window straight away. A drag selects an area that can still
 * be moved and resized; once it exists, the toolbar at the bottom annotates it
 * in place, so everyday marks and copies skip the editor. Enter, a
 * double-click or the check button captures it. Esc or a right-click clears
 * the selection, then cancels.
 *
 * In scrolling mode (S, or the tray's Scrolling Capture on macOS) the
 * selection starts a scrolling capture of that area instead.
 */

type Drag = { anchor: Point2; current: Point2; moved: boolean };
/** A selection being moved or resized: what was grabbed, where, and the selection then. */
type Adjust = { handle: SelectionHandle; start: Point2; origin: SelectionRect };
type SelectionTarget = { target: DetectedWindow | null; detectedWindow: boolean; pristine: boolean };

type OverlayState = {
	pointer: Point2 | null;
	/** The window a click would capture, or the whole screen over the desktop. */
	hoverWindow: DetectedWindow | null;
	drag: Drag | null;
	/** An area released after a drag, adjustable until it is captured. */
	selection: SelectionRect | null;
	adjust: Adjust | null;
	submitting: boolean;
};

/** A pointer gesture over the annotation layer. */
type EditGesture =
	| { type: "draw"; pointerId: number; anchor: Point; draft: Annotation }
	| {
			type: "move";
			pointerId: number;
			start: Point;
			original: Annotation;
			moved: boolean;
			editOnClick: boolean;
			coalesceKey?: string;
	  }
	| { type: "resize"; pointerId: number; handle: string; original: Annotation };

/** A soft spectrum, closing back on its first colour so the ring is seamless. */
const SPECTRUM = ["#FF5A7A", "#FF9F43", "#FFD43B", "#38D9A9", "#4DABF7", "#9775FA", "#FF5A7A"];
const OUTLINE = {
	window: { width: 3.5, radius: 12 },
	area: { width: 2.5, radius: 2 },
} as const;
const MIN_SELECTION = 4;
const CLICK_SLOP = 4;
const DECODE_GRACE_MS = 250;
const HANDLE_RADIUS = 4;
const HIT_TOLERANCE_CSS = 6;
const MOVE_THRESHOLD_CSS = 3;
const MAX_ANNOTATION_CANVAS_DIMENSION = 8192;
const TOOL_KEY = "quickshot.overlay-tool.v1";

const IDLE_STATE: OverlayState = {
	pointer: null,
	hoverWindow: null,
	drag: null,
	selection: null,
	adjust: null,
	submitting: false,
};

function screenSize() {
	return { width: window.innerWidth, height: window.innerHeight };
}

function loadOverlayTool(): Tool {
	const stored = readStoredJson(TOOL_KEY);
	return CAPTURE_TOOL_ORDER.includes(stored as Tool) ? (stored as Tool) : "arrow";
}

function saveOverlayTool(tool: Tool) {
	writeStoredJson(TOOL_KEY, tool);
}

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
	return getClampedSelectionRect(drag.anchor, drag.current, screenSize());
}

/** The area the overlay outlines as a selection: one being drawn, or one released. */
function selectedArea(state: OverlayState) {
	return state.drag?.moved ? dragRect(state.drag) : state.selection;
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
	const area = selectedArea(state);
	const target = area ?? state.hoverWindow;
	const kind = state.drag?.moved ? "area" : area ? `selection${state.adjust ? "-adjusting" : ""}` : "window";
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
	} else if (state.selection) {
		const rect = state.selection;
		ring(rect, OUTLINE.area, !state.adjust);
		// Handles at the corners, and mid-edge where there is room for them.
		const xs = [rect.x, rect.x + rect.width / 2, rect.x + rect.width];
		const ys = [rect.y, rect.y + rect.height / 2, rect.y + rect.height];
		context.save();
		context.fillStyle = "#fff";
		context.strokeStyle = "rgba(0, 0, 0, 0.35)";
		context.lineWidth = 1;
		context.shadowColor = "rgba(0, 0, 0, 0.25)";
		context.shadowBlur = 3;
		for (const [column, x] of xs.entries()) {
			for (const [row, y] of ys.entries()) {
				if (column === 1 && row === 1) continue;
				if ((column === 1 && rect.width < 40) || (row === 1 && rect.height < 40)) continue;
				context.beginPath();
				context.arc(x, y, HANDLE_RADIUS, 0, Math.PI * 2);
				context.fill();
				context.stroke();
			}
		}
		context.restore();
	} else if (state.hoverWindow) {
		ring(state.hoverWindow, OUTLINE.window, true);
	}
}

async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
	if (!blob) return null;
	return new Uint8Array(await blob.arrayBuffer());
}

async function imageBytesToCanvas(bytes: Uint8Array): Promise<HTMLCanvasElement | null> {
	const image = new Image();
	const objectUrl = createFrameObjectUrl(bytes, "image/png");
	const loading = loadImageElement(image, objectUrl);
	try {
		await loading.promise;
	} catch {
		return null;
	} finally {
		loading.cancel();
		URL.revokeObjectURL(objectUrl);
	}
	if (image.naturalWidth <= 0 || image.naturalHeight <= 0) return null;
	const canvas = document.createElement("canvas");
	canvas.width = image.naturalWidth;
	canvas.height = image.naturalHeight;
	const context = canvas.getContext("2d");
	if (!context) return null;
	context.drawImage(image, 0, 0);
	return canvas;
}

/**
 * The selected pixels with the overlay's marks already painted in, in frozen
 * frame pixels. Copy, save and pin all hand out this composed image.
 */
function bakeAnnotatedCrop(
	image: HTMLImageElement,
	crop: { x: number; y: number; w: number; h: number },
	annotations: readonly Annotation[],
): HTMLCanvasElement | null {
	if (crop.w <= 0 || crop.h <= 0) return null;
	const canvas = document.createElement("canvas");
	canvas.width = crop.w;
	canvas.height = crop.h;
	const context = canvas.getContext("2d");
	if (!context) return null;
	context.drawImage(image, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
	if (annotations.length > 0) {
		const scratch = document.createElement("canvas");
		const env: AnnotationRenderEnv = {
			source: image,
			sourceWidth: image.naturalWidth,
			sourceHeight: image.naturalHeight,
			pixelScale: 1,
			scratch: () => scratch,
		};
		context.save();
		context.translate(-crop.x, -crop.y);
		drawAnnotations(context, annotations, env);
		context.restore();
		scratch.width = 0;
		scratch.height = 0;
	}
	return canvas;
}

export function RegionSelector() {
	const sourceImageRef = useRef<HTMLImageElement>(null);
	const sourceObjectUrlRef = useRef<string | null>(null);
	const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
	const annotationCanvasRef = useRef<HTMLCanvasElement>(null);
	const annotationScratchRef = useRef<HTMLCanvasElement | null>(null);
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
	/** The session's double-click behaviour: copy the selection, or open the editor. */
	const doubleClickCopyRef = useRef(false);
	const detectedWindowClickCopyRef = useRef(false);
	const styledCopyRef = useRef(false);
	const selectionTargetRef = useRef<SelectionTarget | null>(null);
	const [scrollMode, setScrollModeState] = useState(false);
	const setScrollMode = useCallback((enabled: boolean) => {
		scrollModeRef.current = enabled;
		setScrollModeState(enabled);
	}, []);

	// ── Annotation editing ────────────────────────────────────────────────────
	const [tool, setToolState] = useState<Tool>(loadOverlayTool);
	const [toolStyle, setToolStyle] = useState<ToolStyle>(loadToolStyle);
	const [history, setHistory] = useState<History<Annotation[]>>(() => createHistory<Annotation[]>([]));
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [editing, setEditing] = useState<{ annotation: TextAnnotation; isNew: boolean } | null>(null);
	const [live, setLive] = useState<Annotation | null>(null);
	const annotations = history.present;
	const annotationsRef = useRef(annotations);
	annotationsRef.current = annotations;
	const editingRef = useRef(editing);
	editingRef.current = editing;
	const liveRef = useRef<Annotation | null>(null);
	const editGestureRef = useRef<EditGesture | null>(null);
	const [hoverId, setHoverId] = useState<string | null>(null);

	useEffect(() => saveToolStyle(toolStyle), [toolStyle]);
	useEffect(() => saveOverlayTool(tool), [tool]);

	useEffect(
		() => () => {
			if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
		},
		[],
	);

	const setTool = useCallback((next: Tool) => {
		finishEditingRef.current?.();
		setToolState(next);
		if (next !== "select") setSelectedId(null);
	}, []);

	const commit = useCallback((next: Annotation[], options?: { coalesceKey?: string }) => {
		if (selectionTargetRef.current) selectionTargetRef.current.pristine = false;
		setHistory((current) => {
			const present = current.present;
			if (next === present) return current;
			if (
				next.length === present.length &&
				next.every((item, index) => item === present[index])
			) {
				return current;
			}
			return pushHistory(current, next, options);
		});
	}, []);

	const finishEditing = useCallback(() => {
		const current = editingRef.current;
		if (!current) return;
		editingRef.current = null;
		setEditing(null);
		const list = annotationsRef.current;
		const { annotation, isNew } = current;
		if (!annotation.text.trim()) {
			if (!isNew) commit(list.filter((item) => item.id !== annotation.id));
			setSelectedId(null);
			return;
		}
		if (isNew) {
			annotationsRef.current = [...list, annotation];
			commit([...list, annotation]);
		} else {
			const previous = list.find((item) => item.id === annotation.id);
			if (previous !== annotation) {
				const next = list.map((item) => (item.id === annotation.id ? annotation : item));
				annotationsRef.current = next;
				commit(next);
			}
		}
		setSelectedId(annotation.id);
	}, [commit]);
	const finishEditingRef = useRef(finishEditing);
	finishEditingRef.current = finishEditing;

	const beginText = useCallback(
		(annotation: Annotation, isNew: boolean) => {
			if (annotation.kind !== "text") return;
			finishEditing();
			setSelectedId(isNew ? null : annotation.id);
			setEditing({ annotation, isNew });
		},
		[finishEditing],
	);

	const clearAnnotations = useCallback(() => {
		finishEditingRef.current?.();
		setSelectedId(null);
		setHoverId(null);
		editGestureRef.current = null;
		liveRef.current = null;
		setLive(null);
		setHistory((current) => (current.present.length === 0 ? current : createHistory<Annotation[]>([])));
	}, []);

	const selected = useMemo(
		() => annotations.find((item) => item.id === selectedId) ?? null,
		[annotations, selectedId],
	);

	const contextKind: AnnotationKind | null = editing
		? "text"
		: selected?.kind ?? (tool !== "select" ? tool : null);

	const effectiveStyle = useMemo(() => {
		const image = sourceImageRef.current;
		const unit = image?.naturalWidth ? image.naturalWidth / window.innerWidth : 1;
		if (editing) return styleFromAnnotation(editing.annotation, toolStyle, unit);
		if (selected) return styleFromAnnotation(selected, toolStyle, unit);
		return toolStyle;
	}, [editing, selected, toolStyle]);

	const applyStyle = useCallback(
		(patch: Partial<ToolStyle>) => {
			const image = sourceImageRef.current;
			const unit = image?.naturalWidth ? image.naturalWidth / window.innerWidth : 1;
			setToolStyle((current) => ({ ...current, ...patch }));
			const current = editingRef.current;
			if (current) {
				const annotation = applyStyleToAnnotation(current.annotation, patch, effectiveStyle, unit);
				if (annotation.kind === "text") setEditing({ ...current, annotation });
				return;
			}
			if (!selected) return;
			const next = applyStyleToAnnotation(selected, patch, effectiveStyle, unit);
			commit(
				annotationsRef.current.map((item) => (item.id === next.id ? next : item)),
				{ coalesceKey: `style:${next.id}` },
			);
		},
		[commit, effectiveStyle, selected],
	);

	const deleteSelected = useCallback(() => {
		if (!selectedId) return;
		commit(annotationsRef.current.filter((item) => item.id !== selectedId));
		setSelectedId(null);
	}, [commit, selectedId]);

	const duplicateSelected = useCallback(() => {
		if (!selected) return;
		const copy = {
			...translateAnnotation(selected, 16, 16),
			id: createAnnotationId(),
			...(selected.kind === "counter" ? { value: nextCounterValue(annotationsRef.current) } : {}),
		} as Annotation;
		commit([...annotationsRef.current, copy]);
		setSelectedId(copy.id);
	}, [commit, selected]);

	const undo = useCallback(() => {
		finishEditing();
		setHistory(undoHistory);
	}, [finishEditing]);

	const redo = useCallback(() => {
		finishEditing();
		setHistory(redoHistory);
	}, [finishEditing]);

	// The current annotation list, including a text box still being typed.
	const liveAnnotations = useMemo(() => {
		if (!editing || editing.isNew || !editing.annotation.text.trim()) return annotations;
		return annotations.map((item) =>
			item.id === editing.annotation.id ? editing.annotation : item,
		);
	}, [annotations, editing]);

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
	const hoverTargetAt = useCallback((point: Point2): DetectedWindow | null => {
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
			if (state.pointer && !state.drag && !state.selection) {
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
		doubleClickCopyRef.current = false;
		detectedWindowClickCopyRef.current = false;
		selectionTargetRef.current = null;
		styledCopyRef.current = false;
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
		const annotationCanvas = annotationCanvasRef.current;
		if (annotationCanvas) {
			annotationCanvas.width = 0;
			annotationCanvas.height = 0;
		}
		drawnKeyRef.current = "";
		editGestureRef.current = null;
		liveRef.current = null;
		setLive(null);
		setSelectedId(null);
		setEditing(null);
		setHoverId(null);
		setHistory(createHistory<Annotation[]>([]));
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
			doubleClickCopy?: boolean;
			detectedWindowClickCopy?: boolean;
			styledCopy?: boolean;
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
			doubleClickCopyRef.current = Boolean(payload.doubleClickCopy);
			detectedWindowClickCopyRef.current = Boolean(payload.detectedWindowClickCopy);
			styledCopyRef.current = Boolean(payload.styledCopy);
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

	// ── Completion ────────────────────────────────────────────────────────────
	/**
	 * Hands `rect` (CSS pixels) to the main process: "edit" opens the editor —
	 * in scrolling mode it starts a scrolling capture instead — and "copy",
	 * "save" or "pin" finish straight from the overlay. Marks drawn over the
	 * selection are baked into the pixels for copy, save and pin, and passed
	 * along for the editor to keep editing.
	 */
	const submit = useCallback(
		async (rect: SelectionRect, target: DetectedWindow | null, intent: "edit" | "copy" | "save" | "pin" = "edit") => {
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
			const scroll = intent === "copy" || intent === "save" || intent === "pin" ? false : scrollModeRef.current;
			const pendingText = editingRef.current;
			const list = pendingText
				? pendingText.isNew
					? [...annotationsRef.current, pendingText.annotation]
					: annotationsRef.current.map((item) => item.id === pendingText.annotation.id ? pendingText.annotation : item)
				: annotationsRef.current;
			// `pixels` is already in frozen-frame pixels, so it is the crop itself.
			const crop = { x: pixels.x, y: pixels.y, w: pixels.width, h: pixels.height };
			state.submitting = true;
			scheduleRender();

			try {
				let croppedImageBytes: Uint8Array | undefined;
				let composedImageBytes: Uint8Array | undefined;
				let annotationsPayload: Annotation[] | undefined;
				let actionWindowId = target?.id;

				if ((intent === "copy" || intent === "save") && target?.id && list.length === 0) {
					const cleanWindow = await window.electronAPI.captureDetectedWindow?.(sessionId, target.id);
					if (cleanWindow?.success) {
						const cleanCanvas = await imageBytesToCanvas(cleanWindow.imageBytes);
						if (cleanCanvas) {
							croppedImageBytes = (await canvasToPngBytes(cleanCanvas)) ?? undefined;
							if (styledCopyRef.current) {
								try {
									composedImageBytes = (await renderStyledCopy(cleanCanvas, Math.min(4, Math.max(1, cleanCanvas.width / Math.max(1, rect.width))))) ?? undefined;
								} catch (error) {
									console.error("QuickShot could not render the styled window copy", error);
								}
							}
							cleanCanvas.width = 0;
							cleanCanvas.height = 0;
							actionWindowId = undefined;
						}
					}
				}

				if (intent === "edit") {
					// The editor receives the raw crop plus the marks, so they stay editable.
					if (!target?.id && list.length > 0) {
						annotationsPayload = clipAnnotationsToCrop(list, crop, measureTextAnnotation);
					}
				} else if (!croppedImageBytes && (!target?.id || list.length > 0)) {
					const baked = bakeAnnotatedCrop(image, crop, list);
					if (baked) {
						croppedImageBytes = (await canvasToPngBytes(baked)) ?? undefined;
						if ((intent === "copy" || intent === "save") && styledCopyRef.current && !target?.id) {
							try {
								composedImageBytes = (await renderStyledCopy(baked, Math.min(4, Math.max(1, scaleX)))) ?? undefined;
							} catch (error) {
								console.error("QuickShot could not render the styled copy", error);
							}
						}
						baked.width = 0;
						baked.height = 0;
					}
				}

				const result = await window.electronAPI.screenshotRegionSelected({
					sessionId,
					action: intent === "edit" ? (scroll ? "scroll" : "edit") : intent,
					rect: pixels,
					windowId: scroll ? undefined : actionWindowId,
					croppedImageBytes,
					composedImageBytes,
					annotations: annotationsPayload,
				});
				if (activeSessionIdRef.current !== sessionId || result.success) return;
				if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
				setNotice(t("region.actionFailed"));
				noticeTimerRef.current = window.setTimeout(() => setNotice(null), 2400);
			} catch (error) {
				console.error("QuickShot could not hand the selection to the editor", error);
			}
			// The selection stays, so the user can try again or change it.
			state.submitting = false;
			scheduleRender();
		},
		[scheduleRender],
	);

	/** Opens the selection in the editor, carrying the marks along. */
	const confirmSelection = useCallback(() => {
		finishEditing();
		const selection = stateRef.current.selection;
		if (selection) {
			const origin = selectionTargetRef.current;
			// Once marks or bounds change, keep the frozen pixels and editable marks
			// together instead of replacing them with a fresh window capture.
			void submit(selection, origin?.pristine ? origin.target : null);
		}
	}, [finishEditing, submit]);

	/** Copies the selection straight to the clipboard, marks included. */
	const copySelection = useCallback(() => {
		finishEditing();
		const selection = stateRef.current.selection;
		if (selection) {
			const origin = selectionTargetRef.current;
			void submit(selection, origin?.pristine ? origin.target : null, "copy");
		}
	}, [finishEditing, submit]);

	/** Saves the selection straight to Downloads, marks included. */
	const saveSelection = useCallback(() => {
		finishEditing();
		const selection = stateRef.current.selection;
		if (selection) {
			const origin = selectionTargetRef.current;
			void submit(selection, origin?.pristine ? origin.target : null, "save");
		}
	}, [finishEditing, submit]);

	/** Drops the selection and its marks, back to choosing a window or drawing an area. */
	const clearSelection = useCallback(() => {
		finishEditingRef.current?.();
		clearAnnotations();
		const state = stateRef.current;
		state.selection = null;
		selectionTargetRef.current = null;
		state.adjust = null;
		state.hoverWindow = state.pointer ? hoverTargetAt(state.pointer) : null;
		scheduleRender();
	}, [clearAnnotations, hoverTargetAt, scheduleRender]);

	useEffect(() => {
		if (!imageReady) return;
		const handleKeyDown = (event: KeyboardEvent) => {
			const state = stateRef.current;
			if (event.key === "Escape") {
				event.preventDefault();
				if (editingRef.current) {
					finishEditingRef.current?.();
					return;
				}
				if (state.selection && !state.submitting) clearSelection();
				else void cancel();
				return;
			}
			if (state.submitting) return;
			const mod = event.metaKey || event.ctrlKey;
			if (mod && !event.altKey && event.key.toLowerCase() === "z") {
				event.preventDefault();
				if (event.shiftKey) redo();
				else undo();
				return;
			}
			if (!editingRef.current) {
				const command = commandFor(keymapRef.current, event, "editor");
				if (command?.startsWith("tool.")) {
					const next = command.slice("tool.".length) as Tool;
					if (CAPTURE_TOOL_ORDER.includes(next)) {
						event.preventDefault();
						setTool(next);
						return;
					}
				}
			}
			if (event.key === "Enter" && state.selection) {
				event.preventDefault();
				confirmSelection();
				return;
			}
			if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
				event.preventDefault();
				deleteSelected();
				return;
			}
			// Arrow keys nudge the selection, or the selected mark.
			const step = event.shiftKey ? 10 : 1;
			const nudge = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[
				event.key
			];
			if (nudge && state.selection && !state.adjust && !editingRef.current) {
				event.preventDefault();
				const selected = annotationsRef.current.find((item) => item.id === selectedId);
				if (selected) {
					const moved = translateAnnotation(selected, nudge[0], nudge[1]);
					commit(
						annotationsRef.current.map((item) => (item.id === moved.id ? moved : item)),
						{ coalesceKey: `nudge:${moved.id}` },
					);
					return;
				}
				const start = { x: 0, y: 0 };
				state.selection = adjustSelection(state.selection, "move", start, { x: nudge[0], y: nudge[1] }, screenSize());
				if (selectionTargetRef.current) selectionTargetRef.current.pristine = false;
				scheduleRender();
				return;
			}
			// S (or whatever Settings says) switches between a regular and a scrolling capture.
			if (
				!event.repeat &&
				scrollAvailableRef.current &&
				commandFor(keymapRef.current, event, "overlay") === "overlay.scroll"
			) {
				event.preventDefault();
				setScrollMode(!scrollModeRef.current);
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [cancel, clearSelection, commit, confirmSelection, deleteSelected, imageReady, redo, scheduleRender, setScrollMode, setTool, selectedId, undo]);

	// ── Pointer ───────────────────────────────────────────────────────────────
	const toImagePoint = useCallback((clientX: number, clientY: number): Point => {
		const image = sourceImageRef.current;
		const unit = image && image.naturalWidth > 0 ? image.naturalWidth / window.innerWidth : 1;
		return { x: clientX * unit, y: clientY * unit };
	}, []);

	const hitTolerance = useCallback(() => {
		const image = sourceImageRef.current;
		const unit = image && image.naturalWidth > 0 ? image.naturalWidth / window.innerWidth : 1;
		return HIT_TOLERANCE_CSS * unit;
	}, []);

	const updateHover = useCallback(
		(point: Point) => {
			const tolerance = hitTolerance();
			if (handlesActive(tool, selected)) {
				const handle = hitTestHandle(getHandles(selected, measureTextAnnotation), point, 7);
				if (handle) {
					setHoverId(null);
					return;
				}
			}
			const candidates = grabbableAnnotations(annotationsRef.current, tool, selectedId);
			if (candidates.length > 0) {
				const hit = findAnnotationAt(candidates, point, tolerance, measureTextAnnotation, {
					includeInside: tool === "select",
				});
				if (hit) {
					setHoverId(hit.annotation.id);
					return;
				}
			}
			setHoverId(null);
		},
		[hitTolerance, selected, selectedId, tool],
	);

	const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		const state = stateRef.current;
		if (!imageReady || state.submitting) return;
		if (event.button === 2) {
			if (state.selection) clearSelection();
			else void cancel();
			return;
		}
		if (event.button !== 0) return;
		const point = { x: event.clientX, y: event.clientY };
		state.pointer = point;

		if (editingRef.current) {
			finishEditingRef.current?.();
			return;
		}

		// A drawing tool keeps the selection's edges draggable; elsewhere on the
		// selection it draws, and outside it starts a fresh selection.
		const handle = state.selection ? selectionHandleAt(state.selection, point) : null;
		const wantsSelectionAdjust =
			state.selection && handle && handle !== "move";
		if (wantsSelectionAdjust && handle) {
			event.currentTarget.setPointerCapture(event.pointerId);
			state.adjust = { handle, start: point, origin: state.selection! };
			scheduleRender();
			return;
		}

		const insideSelection = state.selection ? selectionHandleAt(state.selection, point) !== null : false;
		if (!state.selection || tool === "select" || !insideSelection) {
			if (state.selection && tool !== "select" && !insideSelection) {
				// Drawing outside the selection begins a new area, dropping old marks.
				clearAnnotations();
			}
			if (!state.selection || tool !== "select") {
				event.currentTarget.setPointerCapture(event.pointerId);
				state.drag = { anchor: point, current: point, moved: false };
				scheduleRender();
				return;
			}
		}

		// Editing inside the selection.
		const imagePoint = toImagePoint(event.clientX, event.clientY);
		const tolerance = hitTolerance();
		if (handlesActive(tool, selected)) {
			const grabbed = hitTestHandle(getHandles(selected, measureTextAnnotation), imagePoint, 7);
			if (grabbed) {
				event.currentTarget.setPointerCapture(event.pointerId);
				editGestureRef.current = { type: "resize", pointerId: event.pointerId, handle: grabbed, original: selected };
				return;
			}
		}
		const candidates = grabbableAnnotations(annotationsRef.current, tool, selectedId);
		if (candidates.length > 0) {
			const hit = findAnnotationAt(candidates, imagePoint, tolerance, measureTextAnnotation, {
				includeInside: tool === "select",
			});
			if (hit) {
				event.currentTarget.setPointerCapture(event.pointerId);
				setSelectedId(hit.annotation.id);
				editGestureRef.current = {
					type: "move",
					pointerId: event.pointerId,
					start: imagePoint,
					original: hit.annotation,
					moved: false,
					editOnClick:
						hit.annotation.kind === "text" &&
						(tool === "text" || hit.annotation.id === selectedId),
				};
				return;
			}
		}

		setSelectedId(null);
		if (tool === "select") {
			if (state.selection && insideSelection) {
				event.currentTarget.setPointerCapture(event.pointerId);
				state.adjust = { handle: "move", start: point, origin: state.selection };
			} else {
				event.currentTarget.setPointerCapture(event.pointerId);
				state.drag = { anchor: point, current: point, moved: false };
			}
			scheduleRender();
			return;
		}
		const selection = state.selection;
		const image = sourceImageRef.current;
		const unit = image?.naturalWidth ? image.naturalWidth / window.innerWidth : 1;
		const bounds = selection
			? {
					x: selection.x * unit,
					y: selection.y * unit,
					w: selection.width * unit,
					h: selection.height * unit,
				}
			: null;
		const origin = bounds
			? { x: Math.min(Math.max(imagePoint.x, bounds.x), bounds.x + bounds.w), y: Math.min(Math.max(imagePoint.y, bounds.y), bounds.y + bounds.h) }
			: imagePoint;

		if (tool === "text") {
			const draft = createTextDraft(origin, toolStyle, unit);
			beginText(positionTextDraft(draft, origin, measureTextAnnotation(draft)), true);
			event.preventDefault();
			return;
		}
		if (tool === "counter") {
			const counter = createCounterDraft(origin, nextCounterValue(annotationsRef.current), toolStyle, unit);
			commit([...annotationsRef.current, counter], { coalesceKey: `place:${counter.id}` });
			setSelectedId(counter.id);
			event.currentTarget.setPointerCapture(event.pointerId);
			editGestureRef.current = {
				type: "move",
				pointerId: event.pointerId,
				start: imagePoint,
				original: counter,
				moved: false,
				editOnClick: false,
				coalesceKey: `place:${counter.id}`,
			};
			return;
		}
		const draft = createDraft(tool, origin, toolStyle, unit);
		if (!draft) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		editGestureRef.current = { type: "draw", pointerId: event.pointerId, anchor: origin, draft };
		liveRef.current = draft;
		setLive(draft);
	};

	const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		if (!imageReady) return;
		const state = stateRef.current;
		const point = { x: event.clientX, y: event.clientY };
		state.pointer = point;
		if (state.submitting) return;

		if (editGestureRef.current) {
			const gesture = editGestureRef.current;
			if (event.pointerId !== gesture.pointerId) return;
			const imagePoint = toImagePoint(event.clientX, event.clientY);
			const unit = (() => {
				const image = sourceImageRef.current;
				return image && image.naturalWidth > 0 ? image.naturalWidth / window.innerWidth : 1;
			})();
			const selection = state.selection;
			const bounds = selection
				? {
						x: selection.x * unit,
						y: selection.y * unit,
						w: selection.width * unit,
						h: selection.height * unit,
					}
				: null;
			const clamp = (p: Point): Point =>
				bounds
					? {
							x: Math.min(Math.max(p.x, bounds.x), bounds.x + bounds.w),
							y: Math.min(Math.max(p.y, bounds.y), bounds.y + bounds.h),
						}
					: p;
			switch (gesture.type) {
				case "draw": {
					const coalesced = event.nativeEvent.getCoalescedEvents?.() ?? [];
					const samples = (coalesced.length > 0 ? coalesced : [event.nativeEvent]).map((sample) =>
						clamp(toImagePoint(sample.clientX, sample.clientY)),
					);
					gesture.draft = updateDraft(
						gesture.draft,
						gesture.anchor,
						clamp(imagePoint),
						event.shiftKey,
						unit,
						samples,
					);
					liveRef.current = gesture.draft;
					setLive(gesture.draft);
					break;
				}
				case "move": {
					const dx = imagePoint.x - gesture.start.x;
					const dy = imagePoint.y - gesture.start.y;
					if (!gesture.moved && Math.hypot(dx, dy) < MOVE_THRESHOLD_CSS) return;
					gesture.moved = true;
					let offsetX = dx;
					let offsetY = dy;
					if (event.shiftKey) {
						if (Math.abs(dx) > Math.abs(dy)) offsetY = 0;
						else offsetX = 0;
					}
					liveRef.current = translateAnnotation(gesture.original, offsetX, offsetY);
					setLive(liveRef.current);
					break;
				}
				case "resize":
					liveRef.current = resizeAnnotation(gesture.original, gesture.handle as never, imagePoint, {
						keepAspect: event.shiftKey,
						measure: measureTextAnnotation,
					});
					setLive(liveRef.current);
					break;
			}
			return;
		}

		const drag = state.drag;
		if (state.adjust) {
			const { origin, handle, start } = state.adjust;
			const next = adjustSelection(origin, handle, start, point, screenSize());
			if (selectionTargetRef.current && (
				next.x !== origin.x || next.y !== origin.y ||
				next.width !== origin.width || next.height !== origin.height
			)) selectionTargetRef.current.pristine = false;
			state.selection = next;
		} else if (drag) {
			drag.current = point;
			if (!drag.moved && Math.hypot(point.x - drag.anchor.x, point.y - drag.anchor.y) >= CLICK_SLOP) {
				drag.moved = true;
				state.hoverWindow = null;
				state.selection = null;
				selectionTargetRef.current = null;
			}
		} else if (!state.selection) {
			state.hoverWindow = hoverTargetAt(point);
		} else if (tool !== "select") {
			updateHover(toImagePoint(event.clientX, event.clientY));
		}
		scheduleRender();
	};

	const finishEditGesture = (event: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
		const gesture = editGestureRef.current;
		if (!gesture || event.pointerId !== gesture.pointerId) return;
		editGestureRef.current = null;
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		const latest = liveRef.current;
		liveRef.current = null;
		setLive(null);
		if (cancelled) return;
		const image = sourceImageRef.current;
		const unit = image && image.naturalWidth > 0 ? image.naturalWidth / window.innerWidth : 1;
		switch (gesture.type) {
			case "draw": {
				const finished = finalizeDraft(latest ?? gesture.draft, unit);
				if (isMeaningfulAnnotation(finished)) {
					commit([...annotationsRef.current, finished]);
					setSelectedId(finished.id);
				}
				break;
			}
			case "move":
				if (gesture.moved && latest) {
					commit(replaceAnnotation(annotationsRef.current, latest), { coalesceKey: gesture.coalesceKey });
				} else if (!gesture.moved && gesture.editOnClick && gesture.original.kind === "text") {
					beginText(gesture.original, false);
				}
				break;
			case "resize":
				if (latest && latest !== gesture.original) {
					commit(replaceAnnotation(annotationsRef.current, latest));
				}
				break;
		}
	};

	const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
		if (editGestureRef.current) {
			finishEditGesture(event, false);
			return;
		}
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		const state = stateRef.current;
		if (state.adjust) {
			state.adjust = null;
			scheduleRender();
			return;
		}
		const drag = state.drag;
		if (!drag || state.submitting) return;
		state.drag = null;
		if (drag.moved) {
			// The area stays selected, to adjust and annotate before it is captured.
			const rect = dragRect(drag);
			if (rect.width >= MIN_SELECTION && rect.height >= MIN_SELECTION) state.selection = rect;
			scheduleRender();
			return;
		}
		// A click outside a selection leaves it alone.
		if (state.selection) {
			scheduleRender();
			return;
		}
		// A click captures the window under the pointer, or the whole screen.
		const target = findWindowAt(windowsRef.current, drag.anchor);
		if (target && detectedWindowClickCopyRef.current && !scrollModeRef.current) {
			state.selection = { x: target.x, y: target.y, width: target.width, height: target.height };
			state.hoverWindow = null;
			selectionTargetRef.current = { target, detectedWindow: true, pristine: true };
			// Keep the same neutral selection tool used by the existing area flow;
			// the shared double-click setting decides whether the next double-click
			// copies or opens the editor.
			setToolState("select");
			scheduleRender();
			return;
		}
		void submit(target ?? { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }, target);
	};

	const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
		const state = stateRef.current;
		if (state.submitting) return;
		const selection = state.selection;
		if (!selection) return;
		if (selectionHandleAt(selection, { x: event.clientX, y: event.clientY }) !== "move") return;
		const imagePoint = toImagePoint(event.clientX, event.clientY);
		if (findAnnotationAt(annotationsRef.current, imagePoint, hitTolerance(), measureTextAnnotation)) return;
		// Most captures are pasted straight away, so the setting lets a
		// double-click skip the editor; by default it opens QuickShot.
		if (doubleClickCopyRef.current && !scrollModeRef.current) copySelection();
		else confirmSelection();
	};

	// ── Annotation layer ──────────────────────────────────────────────────────
	const getScratch = useCallback(() => {
		if (!annotationScratchRef.current) {
			const canvas = document.createElement("canvas");
			canvas.width = 1;
			canvas.height = 1;
			annotationScratchRef.current = canvas;
		}
		return annotationScratchRef.current;
	}, []);

	const renderList = useMemo(() => {
		const base = liveAnnotations;
		if (!live) return base;
		const index = base.findIndex((item) => item.id === live.id);
		if (index === -1) return [...base, live];
		const next = base.slice();
		next[index] = live;
		return next;
	}, [live, liveAnnotations]);

	const selectionKey = view.selection
		? `${view.selection.x},${view.selection.y},${view.selection.width},${view.selection.height}`
		: "none";

	useLayoutEffect(() => {
		const canvas = annotationCanvasRef.current;
		const image = sourceImageRef.current;
		if (!canvas || !image || !imageReady) return;
		const selection = stateRef.current.selection;
		const ratio = window.devicePixelRatio || 1;
		const unit = image.naturalWidth > 0 ? image.naturalWidth / window.innerWidth : 1;
		const width = Math.min(MAX_ANNOTATION_CANVAS_DIMENSION, Math.max(1, Math.round(window.innerWidth * ratio)));
		const height = Math.min(MAX_ANNOTATION_CANVAS_DIMENSION, Math.max(1, Math.round(window.innerHeight * ratio)));
		if (canvas.width !== width) canvas.width = width;
		if (canvas.height !== height) canvas.height = height;
		const context = canvas.getContext("2d");
		if (!context) return;
		context.setTransform(1, 0, 0, 1, 0, 0);
		context.clearRect(0, 0, canvas.width, canvas.height);
		if (!selection || renderList.length === 0) return;
		// Frozen frame pixels to device pixels: the surface draws image-space marks.
		const scale = ratio / unit;
		context.setTransform(scale, 0, 0, scale, 0, 0);
		const crop = {
			x: selection.x * unit,
			y: selection.y * unit,
			w: selection.width * unit,
			h: selection.height * unit,
		};
		context.save();
		context.beginPath();
		context.rect(crop.x, crop.y, crop.w, crop.h);
		context.clip();
		const env: AnnotationRenderEnv = {
			source: image,
			sourceWidth: image.naturalWidth,
			sourceHeight: image.naturalHeight,
			pixelScale: scale,
			scratch: getScratch,
		};
		const editingId = editing && !editing.isNew ? editing.annotation.id : null;
		drawAnnotations(context, renderList, env, editingId);
		context.restore();
	}, [editing, getScratch, imageReady, renderList, selectionKey, view.selection]);

	// ── Render ────────────────────────────────────────────────────────────────
	const image = sourceImageRef.current;
	const pixelScale = image && image.naturalWidth > 0 ? image.naturalWidth / window.innerWidth : 1;
	const dragging = selectedArea(view);
	const hovered = dragging ? null : view.hoverWindow;
	const labelTarget = dragging ?? hovered;
	const selection = view.drag?.moved ? null : view.selection;
	const cursor = !imageReady
		? "wait"
		: view.submitting
			? "progress"
			: tool !== "select" && selection
				? toolCursor(tool)
				: "crosshair";
	const labelPosition = labelTarget
		? {
				left: Math.min(Math.max(6, labelTarget.x + 4), window.innerWidth - 220),
				top: labelTarget.y > 40 ? labelTarget.y - 34 : labelTarget.y + 10,
			}
		: null;
	const editingId = editing && !editing.isNew ? editing.annotation.id : null;
	const hoveredAnnotation =
		hoverId && hoverId !== selectedId
			? renderList.find((item) => item.id === hoverId) ?? null
			: null;
	const shownAnnotation = live && live.id === selectedId ? live : selected;

	return (
		<div
			className="fixed inset-0 select-none overflow-hidden"
			data-quickshot-annotations={annotations.length}
			data-quickshot-tool={tool}
			data-quickshot-selection-origin={selectionTargetRef.current?.detectedWindow ? "window" : selection ? "area" : "none"}
			data-quickshot-pristine={selectionTargetRef.current?.pristine ?? false}
			style={{
				cursor,
				background: imageReady ? "transparent" : "rgba(0,0,0,0.001)",
				touchAction: "none",
			}}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerUp}
			onPointerCancel={(event) => {
				if (editGestureRef.current) finishEditGesture(event, true);
				else handlePointerUp(event);
			}}
			onDoubleClick={handleDoubleClick}
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
			<canvas
				ref={annotationCanvasRef}
				className="pointer-events-none absolute inset-0 h-full w-full"
			/>

			{selection && (
				<AnnotationSelectionOverlay
					className="pointer-events-none absolute left-0 top-0 overflow-hidden"
					width={window.innerWidth}
					height={window.innerHeight}
					selected={editing ? null : shownAnnotation}
					hovered={editGestureRef.current ? null : hoveredAnnotation}
					toCss={(point) => ({ x: point.x / pixelScale, y: point.y / pixelScale })}
					scale={1 / pixelScale}
				/>
			)}

			{editing && selection && (
				<AnnotationTextEditor
					key={editing.annotation.id}
					annotation={editing.annotation}
					left={editing.annotation.x / pixelScale}
					top={editing.annotation.y / pixelScale}
					scale={1 / pixelScale}
					onChange={(text) =>
						setEditing((current) => (current ? { ...current, annotation: { ...current.annotation, text } } : current))
					}
					onFinish={() => finishEditingRef.current?.()}
				/>
			)}

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

			{selection && !view.submitting && !view.adjust && (
				<OverlayToolbar
					selection={selection}
					tool={tool}
					onToolChange={setTool}
					style={effectiveStyle}
					onStyleChange={applyStyle}
					contextKind={contextKind}
					hasSelection={Boolean(shownAnnotation) && !editing}
					onDelete={deleteSelected}
					onDuplicate={duplicateSelected}
					canUndo={history.past.length > 0}
					canRedo={history.future.length > 0}
					onUndo={undo}
					onRedo={redo}
					busy={view.submitting}
					scrollMode={scrollMode}
					onCancel={() => void cancel()}
					onCopy={copySelection}
					onSave={saveSelection}
					onConfirm={confirmSelection}
				/>
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
