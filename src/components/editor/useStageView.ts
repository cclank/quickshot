import { type PointerEvent as ReactPointerEvent, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clampPan, clampZoom, panAfterZoom, visibleStageRect } from "@/editor/viewport";
import type { CompositionLayout } from "@/editor/composition";
import type { Point } from "@/editor/types";
import type { SourceImage } from "@/editor/stitchSource";
import { commandFor, useKeymap } from "@/lib/keymap";

export const VIEW_MARGIN = { left: 32, right: 32, bottom: 84 };
const INTERACTIVE = "button,input,textarea,select,[contenteditable=true],[data-stage-controls]";

export function useStageView({ image, layout, viewport, unit, topMargin, viewportRef, busy }: {
	image: SourceImage | null;
	layout: CompositionLayout | null;
	viewport: { w: number; h: number };
	unit: number;
	topMargin: number;
	viewportRef: RefObject<HTMLDivElement>;
	busy: () => boolean;
}) {
	const [view, setView] = useState<{ zoom: number | null; pan: Point }>({ zoom: null, pan: { x: 0, y: 0 } });
	const [handMode, setHandMode] = useState(false);
	const [spaceHeld, setSpaceHeld] = useState(false);
	const [dragging, setDragging] = useState(false);
	const panGesture = useRef<{ pointerId: number; start: Point; pan: Point } | null>(null);
	const keymap = useKeymap();
	const available = useMemo(() => ({
		w: Math.max(1, viewport.w - VIEW_MARGIN.left - VIEW_MARGIN.right),
		h: Math.max(1, viewport.h - topMargin - VIEW_MARGIN.bottom),
	}), [topMargin, viewport.w, viewport.h]);
	const fitScale = layout && viewport.w > 0 && viewport.h > 0
		? Math.min(available.w / layout.width, available.h / layout.height, 1 / unit) : 0;
	const scale = view.zoom === null ? fitScale : view.zoom / unit;
	const content = useMemo(() => ({ w: (layout?.width ?? 0) * scale, h: (layout?.height ?? 0) * scale }), [layout, scale]);
	const pan = useMemo(() => clampPan(view.pan, content, available), [view.pan, content, available]);
	const centre = { x: VIEW_MARGIN.left + available.w / 2, y: topMargin + available.h / 2 };
	const origin = { x: centre.x - content.w / 2 + pan.x, y: centre.y - content.h / 2 + pan.y };
	const visible = useMemo(() => visibleStageRect(origin, content, viewport), [origin.x, origin.y, content, viewport]);

	const fit = useCallback(() => setView({ zoom: null, pan: { x: 0, y: 0 } }), []);
	const stopPanning = useCallback(() => setHandMode(false), []);
	useEffect(() => {
		fit();
		setHandMode(false);
		setSpaceHeld(false);
		panGesture.current = null;
		setDragging(false);
	}, [fit, image]);

	const setZoom = useCallback((zoom: number, anchor?: Point) => {
		if (!layout || scale <= 0) return;
		const next = clampZoom(zoom);
		const ratio = next / unit / scale;
		setView({ zoom: next, pan: clampPan(panAfterZoom(pan, anchor ?? { x: 0, y: 0 }, ratio),
			{ w: content.w * ratio, h: content.h * ratio }, available) });
	}, [available, content, layout, pan, scale, unit]);
	const zoomIn = useCallback(() => setZoom(scale * unit * 1.25), [scale, setZoom, unit]);
	const zoomOut = useCallback(() => setZoom(scale * unit / 1.25), [scale, setZoom, unit]);
	const actualSize = useCallback(() => setZoom(1), [setZoom]);

	useEffect(() => {
		const element = viewportRef.current;
		if (!element) return;
		const wheel = (event: WheelEvent) => {
			if ((event.target as Element)?.closest(INTERACTIVE) || !layout) return;
			event.preventDefault();
			if (busy() || panGesture.current) return;
			const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? available.h : 1;
			if (event.ctrlKey || event.metaKey) {
				const bounds = element.getBoundingClientRect();
				setZoom(scale * unit * Math.exp(-Math.max(-300, Math.min(300, event.deltaY * factor)) * 0.005),
					{ x: event.clientX - bounds.left - centre.x, y: event.clientY - bounds.top - centre.y });
			} else {
				const dx = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
				const dy = event.shiftKey && !event.deltaX ? 0 : event.deltaY;
				setView({ zoom: view.zoom, pan: clampPan({ x: pan.x - dx * factor, y: pan.y - dy * factor }, content, available) });
			}
		};
		element.addEventListener("wheel", wheel, { passive: false });
		return () => element.removeEventListener("wheel", wheel);
	}, [available, busy, centre.x, centre.y, content, layout, pan, scale, setZoom, unit, view.zoom, viewportRef]);

	useEffect(() => {
		const down = (event: KeyboardEvent) => {
			if (event.code !== "Space" || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
			if ((event.target as Element)?.closest("input,textarea,select,[contenteditable=true]")) return;
			if (commandFor(keymap, event, "editor")) return;
			event.preventDefault();
			setSpaceHeld(true);
		};
		const up = (event: KeyboardEvent) => { if (event.code === "Space") setSpaceHeld(false); };
		const blur = () => { setSpaceHeld(false); panGesture.current = null; setDragging(false); };
		window.addEventListener("keydown", down);
		window.addEventListener("keyup", up);
		window.addEventListener("blur", blur);
		return () => {
			window.removeEventListener("keydown", down);
			window.removeEventListener("keyup", up);
			window.removeEventListener("blur", blur);
		};
	}, [keymap]);

	const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (!layout || busy() || (event.target as Element).closest(INTERACTIVE)) return;
		if (event.button !== 1 && !(event.button === 0 && (handMode || spaceHeld))) return;
		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.setPointerCapture(event.pointerId);
		panGesture.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, pan };
		setDragging(true);
	};
	const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
		const gesture = panGesture.current;
		if (!gesture || gesture.pointerId !== event.pointerId) return;
		event.stopPropagation();
		setView({ zoom: view.zoom, pan: clampPan({ x: gesture.pan.x + event.clientX - gesture.start.x,
			y: gesture.pan.y + event.clientY - gesture.start.y }, content, available) });
	};
	const finishPan = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (panGesture.current?.pointerId !== event.pointerId) return;
		event.stopPropagation();
		panGesture.current = null;
		setDragging(false);
		if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
	};
	return { scale, zoom: scale * unit, fitting: view.zoom === null, origin, visible, fit, setZoom, zoomIn, zoomOut, stopPanning,
		actualSize, handMode, toggleHand: () => setHandMode((hand) => !hand), panCursor: dragging ? "grabbing" : handMode || spaceHeld ? "grab" : null,
		startPan, movePan, finishPan };
}
