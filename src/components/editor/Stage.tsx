import {
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	createAnnotationId,
	findAnnotationAt,
	getAnnotationBounds,
	getHandleCursor,
	getHandles,
	getVisualBounds,
	hitTestHandle,
	isMeaningfulAnnotation,
	nextCounterValue,
	resizeAnnotation,
	translateAnnotation,
} from "@/editor/annotations";
import { contrastColor } from "@/editor/color";
import type { CompositionLayout, StyleSettings } from "@/editor/composition";
import {
	clampPointToRect,
	constrainSquare,
	distance,
	rectFromPoints,
	simplifyPath,
	snapAngle,
} from "@/editor/geometry";
import {
	COUNTER_SIZES,
	HIGHLIGHTER_SIZES,
	REDACT_STRENGTHS,
	STROKE_SIZES,
	TEXT_SIZES,
	type ToolStyle,
} from "@/editor/presets";
import { type AnnotationRenderEnv, drawAnnotations } from "@/editor/renderAnnotations";
import { renderComposition } from "@/editor/renderComposition";
import { type SourceImage, sourceSize } from "@/editor/stitchSource";
import {
	ANNOTATION_FONT_FAMILY,
	ANNOTATION_FONT_WEIGHT,
	measureTextAnnotation,
} from "@/editor/textLayout";
import type {
	Annotation,
	HandleId,
	Point,
	TextAnnotation,
	Tool,
} from "@/editor/types";
import { calculateCanvasBackingSize } from "@/lib/canvasBacking";
import { t } from "@/lib/i18n";

export type EditingText = { annotation: TextAnnotation; isNew: boolean };

type StageProps = {
	image: SourceImage | null;
	unit: number;
	settings: StyleSettings;
	layout: CompositionLayout | null;
	wallpaper: HTMLImageElement | null;
	annotations: Annotation[];
	selectedId: string | null;
	editing: EditingText | null;
	tool: Tool;
	toolStyle: ToolStyle;
	onSelect: (id: string | null) => void;
	onCommit: (next: Annotation[], options?: { coalesceKey?: string }) => void;
	onBeginText: (annotation: TextAnnotation, isNew: boolean) => void;
	onEditingChange: (annotation: TextAnnotation) => void;
	onFinishText: () => void;
	/** Room kept free above the canvas, e.g. for a floating style bar. */
	topMargin?: number;
	children?: ReactNode;
};

type Gesture =
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
	| { type: "resize"; pointerId: number; handle: HandleId; original: Annotation };

const HIT_TOLERANCE_CSS = 6;
const HANDLE_RADIUS_CSS = 4.5;
const MOVE_THRESHOLD_CSS = 3;
/**
 * Drawing tools can pick up existing annotations of their own kind, so boxes
 * stay adjustable with the rectangle tool while an arrow can still start on a
 * box's edge.
 */
const GRAB_TOOLS = new Set<Tool>(["rect", "ellipse", "arrow", "line", "text", "counter"]);

/** Whether the current tool may drag the selected annotation's handles. */
function handlesActive(tool: Tool, selected: Annotation | null): selected is Annotation {
	if (!selected) return false;
	if (tool === "select") return true;
	return tool === selected.kind && selected.kind !== "pen" && selected.kind !== "highlighter";
}

function grabbableAnnotations(
	annotations: Annotation[],
	tool: Tool,
	selectedId: string | null,
) {
	if (tool === "select") return annotations;
	if (!GRAB_TOOLS.has(tool)) return [];
	return annotations.filter((item) => item.kind === tool || item.id === selectedId);
}
const MARGIN = { right: 32, bottom: 40, left: 32 };
/** Above the canvas when the style bar floats over it, and when it does not. */
export const STAGE_TOP_MARGIN = { floating: 64, clear: 28 } as const;
const MAX_BACKING_DIMENSION = 8192;
const MAX_BACKING_PIXELS = 24_000_000;

function toolCursor(tool: Tool) {
	if (tool === "select") return "default";
	if (tool === "text") return "text";
	return "crosshair";
}

function createDraft(tool: Tool, point: Point, style: ToolStyle, unit: number): Annotation | null {
	const id = createAnnotationId();
	const width = STROKE_SIZES[style.strokeSize] * unit;
	switch (tool) {
		case "rect":
		case "ellipse":
			return { id, kind: tool, x: point.x, y: point.y, w: 0, h: 0, color: style.color, width, fill: style.fill };
		case "redact":
			return {
				id,
				kind: "redact",
				x: point.x,
				y: point.y,
				w: 0,
				h: 0,
				mode: style.redactMode,
				strength: REDACT_STRENGTHS[style.redactMode][style.strokeSize] * unit,
			};
		case "arrow":
		case "line":
			return { id, kind: tool, from: point, to: point, color: style.color, width };
		case "pen":
			return { id, kind: "pen", points: [point], color: style.color, width };
		case "highlighter":
			return {
				id,
				kind: "highlighter",
				points: [point],
				color: style.color,
				width: HIGHLIGHTER_SIZES[style.strokeSize] * unit,
			};
		default:
			return null;
	}
}

function updateDraft(
	draft: Annotation,
	anchor: Point,
	point: Point,
	constrain: boolean,
	minStep: number,
	samples: Point[],
): Annotation {
	switch (draft.kind) {
		case "rect":
		case "ellipse":
		case "redact": {
			const target = constrain ? constrainSquare(anchor, point) : point;
			return { ...draft, ...rectFromPoints(anchor, target) };
		}
		case "arrow":
		case "line":
			return { ...draft, to: constrain ? snapAngle(anchor, point) : point };
		case "pen":
		case "highlighter": {
			if (constrain) {
				return { ...draft, points: [anchor, snapAngle(anchor, point)] };
			}
			const points = draft.points;
			for (const sample of samples) {
				if (distance(points[points.length - 1], sample) >= minStep) points.push(sample);
			}
			return { ...draft, points };
		}
		default:
			return draft;
	}
}

function finalizeDraft(draft: Annotation, unit: number): Annotation {
	if (draft.kind === "pen" || draft.kind === "highlighter") {
		return { ...draft, points: simplifyPath(draft.points, 0.35 * unit) };
	}
	return draft;
}

function replaceAnnotation(list: readonly Annotation[], next: Annotation) {
	return list.map((item) => (item.id === next.id ? next : item));
}

export function Stage({
	image,
	unit,
	settings,
	layout,
	wallpaper,
	annotations,
	selectedId,
	editing,
	tool,
	toolStyle,
	onSelect,
	onCommit,
	onBeginText,
	onEditingChange,
	onFinishText,
	topMargin = STAGE_TOP_MARGIN.floating,
	children,
}: StageProps) {
	const viewportRef = useRef<HTMLDivElement>(null);
	const stageRef = useRef<HTMLDivElement>(null);
	const compositionCanvasRef = useRef<HTMLCanvasElement>(null);
	const annotationCanvasRef = useRef<HTMLCanvasElement>(null);
	const scratchCanvasRef = useRef<HTMLCanvasElement | null>(null);
	const gestureRef = useRef<Gesture | null>(null);
	const liveRef = useRef<Annotation | null>(null);
	const liveFrameRef = useRef<number | null>(null);
	const stageRectRef = useRef<DOMRect | null>(null);
	const [viewport, setViewport] = useState({ w: 0, h: 0 });
	const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1);
	const [live, setLive] = useState<Annotation | null>(null);
	const [hoverId, setHoverId] = useState<string | null>(null);
	const [cursor, setCursor] = useState(toolCursor(tool));

	useLayoutEffect(() => {
		const element = viewportRef.current;
		if (!element) return;
		const measure = () =>
			setViewport((current) => {
				const next = { w: element.clientWidth, h: element.clientHeight };
				return current.w === next.w && current.h === next.h ? current : next;
			});
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		let query: MediaQueryList | null = null;
		const update = () => {
			setDpr(window.devicePixelRatio || 1);
			query?.removeEventListener("change", update);
			query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
			query.addEventListener("change", update);
		};
		update();
		return () => query?.removeEventListener("change", update);
	}, []);

	useEffect(() => {
		setCursor(toolCursor(tool));
	}, [tool]);

	useEffect(
		() => () => {
			if (liveFrameRef.current !== null) cancelAnimationFrame(liveFrameRef.current);
			for (const canvas of [
				compositionCanvasRef.current,
				annotationCanvasRef.current,
				scratchCanvasRef.current,
			]) {
				if (canvas) {
					canvas.width = 0;
					canvas.height = 0;
				}
			}
		},
		[],
	);

	const scale = useMemo(() => {
		if (!layout || viewport.w <= 0 || viewport.h <= 0) return 0;
		const availableWidth = Math.max(1, viewport.w - MARGIN.left - MARGIN.right);
		const availableHeight = Math.max(1, viewport.h - topMargin - MARGIN.bottom);
		// Never enlarge past the capture's physical size; small shots stay crisp.
		return Math.min(
			availableWidth / layout.width,
			availableHeight / layout.height,
			1 / layout.unit,
		);
	}, [layout, topMargin, viewport.h, viewport.w]);

	const getScratch = useCallback(() => {
		if (!scratchCanvasRef.current) {
			const canvas = document.createElement("canvas");
			canvas.width = 1;
			canvas.height = 1;
			scratchCanvasRef.current = canvas;
		}
		return scratchCanvasRef.current;
	}, []);

	// ── Composition layer: background, window, capture and signature ─────────
	useEffect(() => {
		const canvas = compositionCanvasRef.current;
		if (!canvas || !image || !layout || scale <= 0) return;
		const backing = calculateCanvasBackingSize(
			layout.width * scale,
			layout.height * scale,
			dpr,
			MAX_BACKING_DIMENSION,
			MAX_BACKING_PIXELS,
		);
		if (!backing) return;
		const frame = requestAnimationFrame(() => {
			if (canvas.width !== backing.width) canvas.width = backing.width;
			if (canvas.height !== backing.height) canvas.height = backing.height;
			const context = canvas.getContext("2d");
			if (!context) return;
			context.setTransform(1, 0, 0, 1, 0, 0);
			context.clearRect(0, 0, canvas.width, canvas.height);
			const pixelScale = backing.width / layout.width;
			context.setTransform(pixelScale, 0, 0, backing.height / layout.height, 0, 0);
			renderComposition(context, {
				layout,
				settings,
				sources: { image, wallpaper },
				pixelScale,
			});
		});
		return () => cancelAnimationFrame(frame);
	}, [dpr, image, layout, scale, settings, wallpaper]);

	// ── Annotation layer ──────────────────────────────────────────────────────
	const renderList = useMemo(() => {
		if (!live) return annotations;
		const index = annotations.findIndex((item) => item.id === live.id);
		if (index === -1) return [...annotations, live];
		const next = annotations.slice();
		next[index] = live;
		return next;
	}, [annotations, live]);

	const editingId = editing && !editing.isNew ? editing.annotation.id : null;

	useLayoutEffect(() => {
		const canvas = annotationCanvasRef.current;
		if (!canvas || !image || !layout || scale <= 0) return;
		const backing = calculateCanvasBackingSize(
			layout.image.w * scale,
			layout.image.h * scale,
			dpr,
			MAX_BACKING_DIMENSION,
			MAX_BACKING_PIXELS,
		);
		if (!backing) return;
		if (canvas.width !== backing.width) canvas.width = backing.width;
		if (canvas.height !== backing.height) canvas.height = backing.height;
		const context = canvas.getContext("2d");
		if (!context) return;
		context.setTransform(1, 0, 0, 1, 0, 0);
		context.clearRect(0, 0, canvas.width, canvas.height);
		if (renderList.length === 0) return;
		const pixelScale = backing.width / layout.image.w;
		context.setTransform(pixelScale, 0, 0, backing.height / layout.image.h, 0, 0);
		context.save();
		context.beginPath();
		context.roundRect(0, 0, layout.image.w, layout.image.h, layout.image.radii);
		context.clip();
		const env: AnnotationRenderEnv = {
			source: image,
			sourceWidth: sourceSize(image).width,
			sourceHeight: sourceSize(image).height,
			pixelScale,
			scratch: getScratch,
		};
		drawAnnotations(context, renderList, env, editingId);
		context.restore();
	}, [dpr, editingId, getScratch, image, layout, renderList, scale]);

	// ── Pointer interaction ───────────────────────────────────────────────────
	const toImagePoint = useCallback(
		(clientX: number, clientY: number, refresh = false): Point => {
			if (refresh || !stageRectRef.current) {
				stageRectRef.current = stageRef.current?.getBoundingClientRect() ?? null;
			}
			const rect = stageRectRef.current;
			if (!rect || !layout || scale <= 0) return { x: 0, y: 0 };
			return {
				x: (clientX - rect.left) / scale - layout.image.x,
				y: (clientY - rect.top) / scale - layout.image.y,
			};
		},
		[layout, scale],
	);

	const scheduleLive = useCallback((next: Annotation | null) => {
		liveRef.current = next;
		if (liveFrameRef.current !== null) return;
		liveFrameRef.current = requestAnimationFrame(() => {
			liveFrameRef.current = null;
			setLive(liveRef.current);
		});
	}, []);

	const resetLive = useCallback(() => {
		if (liveFrameRef.current !== null) {
			cancelAnimationFrame(liveFrameRef.current);
			liveFrameRef.current = null;
		}
		liveRef.current = null;
		setLive(null);
	}, []);

	const selected = useMemo(
		() => annotations.find((item) => item.id === selectedId) ?? null,
		[annotations, selectedId],
	);

	// The stage moves whenever the layout or viewport changes; drop the cached rect.
	useLayoutEffect(() => {
		stageRectRef.current = null;
	}, [layout, scale, viewport]);

	const imageBounds = useMemo(
		() => (layout ? { x: 0, y: 0, w: layout.image.w, h: layout.image.h } : null),
		[layout],
	);

	const updateHover = useCallback(
		(point: Point) => {
			if (!layout || scale <= 0) return;
			const tolerance = HIT_TOLERANCE_CSS / scale;
			if (handlesActive(tool, selected)) {
				const handle = hitTestHandle(
					getHandles(selected, measureTextAnnotation),
					point,
					(HANDLE_RADIUS_CSS + 3) / scale,
				);
				if (handle) {
					setHoverId(null);
					setCursor(getHandleCursor(handle));
					return;
				}
			}
			const candidates = grabbableAnnotations(annotations, tool, selectedId);
			if (candidates.length > 0) {
				const hit = findAnnotationAt(candidates, point, tolerance, measureTextAnnotation, {
					includeInside: tool === "select",
				});
				if (hit) {
					setHoverId(hit.annotation.id);
					setCursor(tool === "text" && hit.annotation.kind === "text" ? "text" : "move");
					return;
				}
			}
			setHoverId(null);
			setCursor(toolCursor(tool));
		},
		[annotations, layout, scale, selected, selectedId, tool],
	);

	const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (!layout || !image || !imageBounds || scale <= 0) return;
		if (event.button !== 0) return;
		const point = toImagePoint(event.clientX, event.clientY, true);
		if (editing) {
			onFinishText();
			return;
		}
		const capture = () => event.currentTarget.setPointerCapture(event.pointerId);

		if (handlesActive(tool, selected)) {
			const handle = hitTestHandle(
				getHandles(selected, measureTextAnnotation),
				point,
				(HANDLE_RADIUS_CSS + 3) / scale,
			);
			if (handle) {
				capture();
				gestureRef.current = { type: "resize", pointerId: event.pointerId, handle, original: selected };
				return;
			}
		}

		const candidates = grabbableAnnotations(annotations, tool, selectedId);
		if (candidates.length > 0) {
			const hit = findAnnotationAt(
				candidates,
				point,
				HIT_TOLERANCE_CSS / scale,
				measureTextAnnotation,
				{ includeInside: tool === "select" },
			);
			if (hit) {
				capture();
				onSelect(hit.annotation.id);
				gestureRef.current = {
					type: "move",
					pointerId: event.pointerId,
					start: point,
					original: hit.annotation,
					moved: false,
					editOnClick:
						hit.annotation.kind === "text" &&
						(tool === "text" || hit.annotation.id === selectedId),
				};
				return;
			}
		}

		onSelect(null);
		if (tool === "select") return;
		const origin = clampPointToRect(point, imageBounds);

		if (tool === "text") {
			const size = TEXT_SIZES[toolStyle.textSize] * unit;
			const draft: TextAnnotation = {
				id: createAnnotationId(),
				kind: "text",
				x: 0,
				y: 0,
				text: "",
				color: toolStyle.color,
				size,
				style: toolStyle.textStyle,
			};
			const box = measureTextAnnotation(draft);
			onBeginText(
				{ ...draft, x: origin.x - box.padX, y: origin.y - box.lineHeight / 2 - box.padY },
				true,
			);
			event.preventDefault();
			return;
		}

		if (tool === "counter") {
			const counter: Annotation = {
				id: createAnnotationId(),
				kind: "counter",
				x: origin.x,
				y: origin.y,
				value: nextCounterValue(annotations),
				color: toolStyle.color,
				size: COUNTER_SIZES[toolStyle.strokeSize] * unit,
			};
			const coalesceKey = `place:${counter.id}`;
			onCommit([...annotations, counter], { coalesceKey });
			onSelect(counter.id);
			capture();
			gestureRef.current = {
				type: "move",
				pointerId: event.pointerId,
				start: point,
				original: counter,
				moved: false,
				editOnClick: false,
				coalesceKey,
			};
			return;
		}

		const draft = createDraft(tool, origin, toolStyle, unit);
		if (!draft) return;
		capture();
		gestureRef.current = { type: "draw", pointerId: event.pointerId, anchor: origin, draft };
		scheduleLive(draft);
	};

	const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		const gesture = gestureRef.current;
		const point = toImagePoint(event.clientX, event.clientY);
		if (!gesture) {
			if (!editing) updateHover(point);
			return;
		}
		if (event.pointerId !== gesture.pointerId || !imageBounds) return;

		switch (gesture.type) {
			case "draw": {
				const coalesced = event.nativeEvent.getCoalescedEvents?.() ?? [];
				const samples = (coalesced.length > 0 ? coalesced : [event.nativeEvent]).map((sample) =>
					clampPointToRect(toImagePoint(sample.clientX, sample.clientY), imageBounds),
				);
				gesture.draft = updateDraft(
					gesture.draft,
					gesture.anchor,
					clampPointToRect(point, imageBounds),
					event.shiftKey,
					1 / Math.max(scale, 0.01),
					samples,
				);
				scheduleLive(gesture.draft);
				break;
			}
			case "move": {
				const dx = point.x - gesture.start.x;
				const dy = point.y - gesture.start.y;
				if (!gesture.moved && Math.hypot(dx, dy) * scale < MOVE_THRESHOLD_CSS) return;
				gesture.moved = true;
				let offsetX = dx;
				let offsetY = dy;
				if (event.shiftKey) {
					if (Math.abs(dx) > Math.abs(dy)) offsetY = 0;
					else offsetX = 0;
				}
				scheduleLive(translateAnnotation(gesture.original, offsetX, offsetY));
				break;
			}
			case "resize":
				scheduleLive(
					resizeAnnotation(gesture.original, gesture.handle, point, {
						keepAspect: event.shiftKey,
						measure: measureTextAnnotation,
					}),
				);
				break;
		}
	};

	const finishGesture = (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
		const gesture = gestureRef.current;
		if (!gesture || event.pointerId !== gesture.pointerId) return;
		gestureRef.current = null;
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		const latest = liveRef.current;
		resetLive();
		if (cancelled) return;

		switch (gesture.type) {
			case "draw": {
				const finished = finalizeDraft(latest ?? gesture.draft, unit);
				if (isMeaningfulAnnotation(finished)) {
					onCommit([...annotations, finished]);
					onSelect(finished.id);
				}
				break;
			}
			case "move":
				if (gesture.moved && latest) {
					onCommit(replaceAnnotation(annotations, latest), { coalesceKey: gesture.coalesceKey });
				} else if (!gesture.moved && gesture.editOnClick && gesture.original.kind === "text") {
					onBeginText(gesture.original, false);
				}
				break;
			case "resize":
				if (latest && latest !== gesture.original) {
					onCommit(replaceAnnotation(annotations, latest));
				}
				break;
		}
		updateHover(toImagePoint(event.clientX, event.clientY));
	};

	const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
		if (!layout || scale <= 0 || editing) return;
		const point = toImagePoint(event.clientX, event.clientY, true);
		const hit = findAnnotationAt(annotations, point, HIT_TOLERANCE_CSS / scale, measureTextAnnotation);
		if (hit?.annotation.kind === "text") {
			onSelect(hit.annotation.id);
			onBeginText(hit.annotation, false);
		}
	};

	// ── Overlay geometry (CSS pixels relative to the stage) ───────────────────
	const toCss = useCallback(
		(point: Point) =>
			layout
				? {
						x: (layout.image.x + point.x) * scale,
						y: (layout.image.y + point.y) * scale,
					}
				: point,
		[layout, scale],
	);

	const shownSelection = live && live.id === selectedId ? live : selected;
	const hovered =
		hoverId && hoverId !== selectedId
			? annotations.find((item) => item.id === hoverId) ?? null
			: null;

	const stageWidth = layout ? layout.width * scale : 0;
	const stageHeight = layout ? layout.height * scale : 0;
	const transparent = settings.beautify && settings.background === "transparent";

	return (
		<div
			ref={viewportRef}
			data-quickshot-viewport
			className="qs-stage-bg relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden"
			onPointerDown={(event) => {
				// Clicking the empty workspace around the canvas clears the selection.
				if (event.target === event.currentTarget && !editing) onSelect(null);
				if (event.target === event.currentTarget && editing) onFinishText();
			}}
		>
			{children}
			{!layout || scale <= 0 ? (
				<div className="text-[12px] text-[var(--qs-text-3)]">{t("stage.loading")}</div>
			) : (
				<div
					ref={stageRef}
					data-quickshot-composition
					data-source-width={image ? sourceSize(image).width : 0}
					data-source-height={image ? sourceSize(image).height : 0}
					className={`relative shrink-0 ${transparent ? "qs-checker" : ""}`}
					style={{
						width: stageWidth,
						height: stageHeight,
						marginTop: topMargin - MARGIN.bottom,
						cursor,
						touchAction: "none",
					}}
					onPointerDown={handlePointerDown}
					onPointerMove={handlePointerMove}
					onPointerUp={(event) => finishGesture(event, false)}
					onPointerCancel={(event) => finishGesture(event, true)}
					onLostPointerCapture={(event) => finishGesture(event, false)}
					onPointerLeave={() => {
						if (!gestureRef.current) setHoverId(null);
					}}
					onDoubleClick={handleDoubleClick}
					onContextMenu={(event) => event.preventDefault()}
				>
					<canvas
						ref={compositionCanvasRef}
						data-quickshot-composition-canvas
						className="pointer-events-none absolute inset-0 h-full w-full"
					/>
					<canvas
						ref={annotationCanvasRef}
						className="pointer-events-none absolute"
						style={{
							left: layout.image.x * scale,
							top: layout.image.y * scale,
							width: layout.image.w * scale,
							height: layout.image.h * scale,
						}}
					/>
					<SelectionOverlay
						width={stageWidth}
						height={stageHeight}
						selected={editing ? null : shownSelection}
						hovered={gestureRef.current || editing ? null : hovered}
						toCss={toCss}
						scale={scale}
					/>
					{editing && layout && (
						<TextEditor
							key={editing.annotation.id}
							annotation={editing.annotation}
							left={(layout.image.x + editing.annotation.x) * scale}
							top={(layout.image.y + editing.annotation.y) * scale}
							scale={scale}
							onChange={(text) => onEditingChange({ ...editing.annotation, text })}
							onFinish={onFinishText}
						/>
					)}
				</div>
			)}
			{layout && scale > 0 && (
				<div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] tabular-nums text-[var(--qs-text-3)]">
					{layout.image.w} × {layout.image.h} · {t("stage.zoom", { value: Math.round(scale * layout.unit * 100) })}
				</div>
			)}
		</div>
	);
}

function SelectionOverlay({
	width,
	height,
	selected,
	hovered,
	toCss,
	scale,
}: {
	width: number;
	height: number;
	selected: Annotation | null;
	hovered: Annotation | null;
	toCss: (point: Point) => Point;
	scale: number;
}) {
	const outline = (annotation: Annotation, key: string, emphasis: boolean) => {
		if (annotation.kind === "arrow" || annotation.kind === "line") {
			const from = toCss(annotation.from);
			const to = toCss(annotation.to);
			return (
				<line
					key={key}
					x1={from.x}
					y1={from.y}
					x2={to.x}
					y2={to.y}
					stroke="var(--qs-select)"
					strokeOpacity={emphasis ? 0.9 : 0.55}
					strokeWidth={1}
					strokeDasharray={emphasis ? undefined : "3 3"}
				/>
			);
		}
		if (annotation.kind === "counter") {
			const center = toCss(annotation);
			return (
				<circle
					key={key}
					cx={center.x}
					cy={center.y}
					r={annotation.size * scale + 3}
					fill="none"
					stroke="var(--qs-select)"
					strokeOpacity={emphasis ? 0.95 : 0.6}
					strokeWidth={1.25}
				/>
			);
		}
		const bounds =
			annotation.kind === "text" || annotation.kind === "redact"
				? getAnnotationBounds(annotation, measureTextAnnotation)
				: getVisualBounds(annotation, measureTextAnnotation);
		const topLeft = toCss({ x: bounds.x, y: bounds.y });
		return (
			<rect
				key={key}
				x={topLeft.x - 0.5}
				y={topLeft.y - 0.5}
				width={bounds.w * scale + 1}
				height={bounds.h * scale + 1}
				fill="none"
				stroke="var(--qs-select)"
				strokeOpacity={emphasis ? 0.9 : 0.55}
				strokeWidth={1}
				strokeDasharray={emphasis ? undefined : "3 3"}
				rx={annotation.kind === "text" ? 3 : 0}
			/>
		);
	};

	return (
		<svg
			className="pointer-events-none absolute left-0 top-0 overflow-visible"
			width={width}
			height={height}
			aria-hidden="true"
		>
			{hovered && outline(hovered, `hover-${hovered.id}`, false)}
			{selected && (
				<g>
					{outline(selected, `sel-${selected.id}`, true)}
					{getHandles(selected, measureTextAnnotation).map((handle) => {
						const point = toCss(handle);
						return (
							<circle
								key={handle.id}
								cx={point.x}
								cy={point.y}
								r={HANDLE_RADIUS_CSS}
								fill="#fff"
								stroke="var(--qs-select)"
								strokeWidth={1.5}
								style={{ filter: "drop-shadow(0 1px 1.5px rgba(0,0,0,0.35))" }}
							/>
						);
					})}
				</g>
			)}
		</svg>
	);
}

function TextEditor({
	annotation,
	left,
	top,
	scale,
	onChange,
	onFinish,
}: {
	annotation: TextAnnotation;
	left: number;
	top: number;
	scale: number;
	onChange: (text: string) => void;
	onFinish: () => void;
}) {
	const ref = useRef<HTMLTextAreaElement>(null);
	const box = measureTextAnnotation(annotation);
	const pill = annotation.style === "pill";
	const textColor = pill ? contrastColor(annotation.color) : annotation.color;

	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		element.focus({ preventScroll: true });
		const end = element.value.length;
		element.setSelectionRange(end, end);
	}, []);

	return (
		<textarea
			ref={ref}
			value={annotation.text}
			spellCheck={false}
			autoCorrect="off"
			autoCapitalize="off"
			rows={1}
			wrap="off"
			aria-label={t("tool.text")}
			onChange={(event) => onChange(event.target.value)}
			onPointerDown={(event) => event.stopPropagation()}
			onDoubleClick={(event) => event.stopPropagation()}
			onKeyDown={(event) => {
				event.stopPropagation();
				const composing = event.nativeEvent.isComposing || event.keyCode === 229;
				if (composing) return;
				if ((event.key === "Enter" && !event.shiftKey) || event.key === "Escape") {
					event.preventDefault();
					onFinish();
				}
			}}
			onBlur={onFinish}
			className="absolute z-10 m-0 resize-none overflow-hidden border-0 outline-none"
			style={{
				left,
				top,
				// Leave room for the caret and the next glyph so the field never scrolls.
				width: box.w * scale + Math.max(12, annotation.size * scale * 0.9),
				height: box.h * scale,
				padding: `${box.padY * scale}px ${box.padX * scale}px`,
				font: `${ANNOTATION_FONT_WEIGHT} ${annotation.size * scale}px ${ANNOTATION_FONT_FAMILY}`,
				lineHeight: `${box.lineHeight * scale}px`,
				color: textColor,
				caretColor: textColor,
				whiteSpace: "pre",
				background: pill ? annotation.color : "transparent",
				borderRadius: pill ? Math.min(box.h / 2, annotation.size * 0.5) * scale : 3,
				boxShadow:
					"0 0 0 1px var(--qs-select), 0 0 0 4px color-mix(in srgb, var(--qs-select) 18%, transparent)",
				textShadow:
					annotation.style === "plain"
						? `0 ${annotation.size * 0.04 * scale}px ${annotation.size * 0.16 * scale}px rgba(0,0,0,0.38)`
						: annotation.style === "outline"
							? `0 0 ${Math.max(1, annotation.size * 0.1 * scale)}px ${contrastColor(annotation.color)}`
							: undefined,
			}}
		/>
	);
}
