import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	GRADIENT_PRESETS,
	WALLPAPERS,
	parseBackground,
} from "@/editor/backgrounds";
import { duplicateAnnotation, translateAnnotation } from "@/editor/annotations";
import {
	type StyleSettings,
	type WatermarkSettings,
	computeCompositionLayout,
	normalizeStyleSettings,
} from "@/editor/composition";
import {
	type History,
	createHistory,
	pushHistory,
	redoHistory,
	undoHistory,
} from "@/editor/history";
import {
	loadInspectorOpen,
	loadSavedDefaultStyle,
	loadStitchSettings,
	loadStyleSettings,
	loadTool,
	loadToolStyle,
	saveInspectorOpen,
	saveDefaultStyle,
	saveStitchSettings,
	saveStyleSettings,
	saveTool,
	saveToolStyle,
} from "@/editor/persistence";
import {
	DEFAULT_TOOL_STYLE,
	type SizeIndex,
	TOOL_ORDER,
	TOOL_SHORTCUTS,
	type ToolStyle,
} from "@/editor/presets";
import { type AnnotationRenderEnv, drawAnnotations } from "@/editor/renderAnnotations";
import { drawBackground, renderComposition } from "@/editor/renderComposition";
import { applyStyleToAnnotation, styleFromAnnotation } from "@/editor/styleMapping";
import type { Annotation, AnnotationKind, Tool } from "@/editor/types";
import { getAssetPath } from "@/lib/assetPath";
import { resolveStyleDefaults } from "@/editor/styleDefaults";
import { type StitchSettings, remapAnnotations } from "@/editor/stitch";
import {
	type SourceImage,
	type Stitch,
	type StitchPiece,
	fitsStitchLimits,
	renderStitchSource,
	sourceSize,
	stitchPlacement,
} from "@/editor/stitchSource";
import { measureTextAnnotation } from "@/editor/textLayout";
import { calculateCanvasBackingSize } from "@/lib/canvasBacking";
import { decodeImageData } from "@/lib/decodeImage";
import { t } from "@/lib/i18n";
import { SUPPORTS_OCR, isModKey } from "@/lib/platform";
import { createPngBlob } from "@/lib/pngBytes";
import { TextExtractionPanel } from "../screenshot/TextExtractionPanel";
import { ContextBar } from "./ContextBar";
import { Inspector } from "./Inspector";
import { StitchPanel } from "./StitchPanel";
import { type EditingText, STAGE_TOP_MARGIN, Stage } from "./Stage";
import { Toast, type ToastState } from "./Toast";
import { type StyleBarMode, Toolbar } from "./Toolbar";

const MAX_PIN_DIMENSION = 3072;
const MAX_PIN_PIXELS = 6_000_000;
const TOAST_DURATION_MS = 2000;

const noop = () => {};
/** The widest style bar (text with a selection), measured to place the real one. */
const styleBarProbes = {
	full: (
		<ContextBar
			kind="text"
			style={DEFAULT_TOOL_STYLE}
			onChange={noop}
			hasSelection
			onDelete={noop}
			onDuplicate={noop}
			variant="inline"
			measureOnly
		/>
	),
	compact: (
		<ContextBar
			kind="text"
			style={DEFAULT_TOOL_STYLE}
			onChange={noop}
			hasSelection
			onDelete={noop}
			onDuplicate={noop}
			variant="inline"
			compactColors
			measureOnly
		/>
	),
};

const NON_TEXT_INPUT_TYPES = new Set(["range", "color", "checkbox", "radio", "button", "submit"]);

/** True only for fields that take typed text, so sliders keep shortcuts working. */
function isEditableTarget(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) return false;
	if (target instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(target.type);
	return (
		target.isContentEditable ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement
	);
}

function fileName(path?: string) {
	if (!path) return undefined;
	return path.split(/[\\/]/).pop() || path;
}

async function canvasToPng(canvas: HTMLCanvasElement) {
	try {
		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
		return blob ? await blob.arrayBuffer() : null;
	} finally {
		canvas.width = 0;
		canvas.height = 0;
	}
}

function thumbnailFrom(render: (ctx: CanvasRenderingContext2D, size: number) => void) {
	const size = 72;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const context = canvas.getContext("2d");
	if (!context) return "";
	render(context, size);
	const url = canvas.toDataURL("image/png");
	canvas.width = 0;
	return url;
}

function mergeEditing(annotations: Annotation[], editing: EditingText | null) {
	if (!editing || !editing.annotation.text.trim()) return annotations;
	if (editing.isNew) return [...annotations, editing.annotation];
	return annotations.map((item) => (item.id === editing.annotation.id ? editing.annotation : item));
}

/** Everything undo covers: the marks and how the captures are stitched. */
type EditorDoc = { annotations: Annotation[]; stitch: Stitch };

function createDoc(pieces: StitchPiece[] = []): EditorDoc {
	return { annotations: [], stitch: { pieces, settings: loadStitchSettings() } };
}

let pieceCounter = 0;
function createPieceId() {
	pieceCounter += 1;
	return `piece-${Date.now().toString(36)}-${pieceCounter}`;
}

async function sourceToPngBlob(source: SourceImage, fallback: Blob | null) {
	if (source instanceof HTMLImageElement) return fallback;
	return new Promise<Blob | null>((resolve) => source.toBlob(resolve, "image/png"));
}

export function Editor() {
	const [unit, setUnit] = useState(1);
	const [settings, setSettings] = useState<StyleSettings>(loadStyleSettings);
	const [savedDefault, setSavedDefault] = useState<StyleSettings | null>(loadSavedDefaultStyle);
	const [toolStyle, setToolStyle] = useState<ToolStyle>(loadToolStyle);
	const [tool, setToolState] = useState<Tool>(loadTool);
	const [inspectorOpen, setInspectorOpen] = useState(loadInspectorOpen);
	const [history, setHistory] = useState<History<EditorDoc>>(() => createHistory(createDoc()));
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [editing, setEditing] = useState<EditingText | null>(null);
	const [ocrOpen, setOcrOpen] = useState(false);
	const [toast, setToast] = useState<ToastState | null>(null);
	const [wallpaper, setWallpaper] = useState<HTMLImageElement | null>(null);
	const [wallpaperThumbs, setWallpaperThumbs] = useState<Record<string, string>>({});

	const doc = history.present;
	const annotations = doc.annotations;
	const stitch = doc.stitch;
	const docRef = useRef(doc);
	docRef.current = doc;
	/** One capture as is, or several stitched into a canvas. */
	const image = useMemo(() => renderStitchSource(stitch, unit), [stitch, unit]);
	const imageSize = useMemo(() => (image ? sourceSize(image) : null), [image]);
	const sessionIdRef = useRef<number | null>(null);
	const sourceBlobRef = useRef<Blob | null>(null);
	const editingRef = useRef<EditingText | null>(null);
	editingRef.current = editing;
	const annotationsRef = useRef(annotations);
	annotationsRef.current = annotations;
	const exportBusyRef = useRef(false);
	const toastTimerRef = useRef<number | null>(null);
	const wallpaperCacheRef = useRef(new Map<string, Promise<HTMLImageElement>>());
	const wallpaperRequestRef = useRef<Promise<HTMLImageElement | null>>(Promise.resolve(null));
	const exportScratchRef = useRef<HTMLCanvasElement | null>(null);

	// ── Session ───────────────────────────────────────────────────────────────
	useEffect(() => {
		let cancelled = false;
		const load = async (sessionId: number) => {
			if (sessionIdRef.current === sessionId) return;
			sessionIdRef.current = sessionId;
			try {
				const payload = await window.electronAPI.getPreviewSession(sessionId);
				if (cancelled) return;
				if (!payload.success || !payload.imageBytes) {
					window.close();
					return;
				}
				const blob = createPngBlob(payload.imageBytes);
				const url = URL.createObjectURL(blob);
				const decoded = await decodeImageData(url);
				if (cancelled) return;
				sourceBlobRef.current = blob;
				// A warm window may have loaded long before this capture; pick up
				// preferences changed in other editor windows since then.
				setSettings(loadStyleSettings());
				setSavedDefault(loadSavedDefaultStyle());
				setToolStyle(loadToolStyle());
				setToolState(loadTool());
				setInspectorOpen(loadInspectorOpen());
				const scaleFactor = Number(payload.scaleFactor);
				setUnit(Number.isFinite(scaleFactor) ? Math.min(4, Math.max(1, scaleFactor)) : 1);
				setHistory(createHistory(createDoc([{ id: createPieceId(), image: decoded, scale: 1 }])));
			} catch (error) {
				console.error("QuickShot editor failed to load the capture", error);
				if (!cancelled) window.close();
			}
		};

		const querySession = Number(new URLSearchParams(window.location.search).get("sessionId"));
		if (Number.isInteger(querySession) && querySession > 0) void load(querySession);
		const unsubscribe = window.electronAPI.onPreviewSession?.((sessionId) => void load(sessionId));
		window.electronAPI
			.getPendingPreviewSession?.()
			?.then((result) => {
				if (!cancelled && result.success) void load(result.sessionId);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
			unsubscribe?.();
		};
	}, []);

	// Reveal the window once the first composed frame has been painted. Only
	// once per session: stitching changes the image, but the window is open.
	const readySessionRef = useRef<number | null>(null);
	useEffect(() => {
		if (!image) return;
		const sessionId = sessionIdRef.current;
		if (sessionId === null || readySessionRef.current === sessionId) return;
		let sent = false;
		const signal = () => {
			if (sent) return;
			sent = true;
			readySessionRef.current = sessionId;
			void window.electronAPI
				.previewSessionReady(sessionId)
				.then((result) => {
					if (!result.success) window.close();
				})
				.catch(() => window.close());
		};
		let second = 0;
		const first = requestAnimationFrame(() => {
			second = requestAnimationFrame(signal);
		});
		// Hidden windows may not run animation frames, so never wait on them alone.
		const fallback = window.setTimeout(signal, 160);
		return () => {
			cancelAnimationFrame(first);
			cancelAnimationFrame(second);
			window.clearTimeout(fallback);
		};
	}, [image]);

	// ── Preferences ───────────────────────────────────────────────────────────
	useEffect(() => saveStyleSettings(settings), [settings]);
	useEffect(() => saveToolStyle(toolStyle), [toolStyle]);
	useEffect(() => saveTool(tool), [tool]);
	useEffect(() => saveInspectorOpen(inspectorOpen), [inspectorOpen]);

	useEffect(
		() => () => {
			if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
		},
		[],
	);

	// ── Backgrounds ───────────────────────────────────────────────────────────
	useEffect(() => {
		let cancelled = false;
		void Promise.allSettled(
			WALLPAPERS.map(async (item) => [item.value, await getAssetPath(item.thumbnail)] as const),
		).then((results) => {
			const entries = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
			if (!cancelled) setWallpaperThumbs(Object.fromEntries(entries));
		});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		const spec = parseBackground(settings.background);
		if (spec.kind !== "wallpaper") {
			wallpaperRequestRef.current = Promise.resolve(null);
			setWallpaper(null);
			return;
		}
		let cancelled = false;
		const cache = wallpaperCacheRef.current;
		let promise = cache.get(spec.asset.value);
		if (!promise) {
			promise = getAssetPath(spec.asset.value, { cache: false }).then(decodeImageData);
			promise.catch(() => cache.delete(spec.asset.value));
			cache.set(spec.asset.value, promise);
		}
		const request = promise.catch(() => null);
		wallpaperRequestRef.current = request;
		void request.then((decoded) => {
			if (!cancelled) setWallpaper(decoded);
		});
		return () => {
			cancelled = true;
		};
	}, [settings.background]);

	const gradientThumbs = useMemo(
		() =>
			Object.fromEntries(
				GRADIENT_PRESETS.map((preset) => [
					preset.id,
					thumbnailFrom((ctx, size) =>
						drawBackground(ctx, { kind: "gradient", preset }, size, size, {}, 1),
					),
				]),
			),
		[],
	);

	const blurThumb = useMemo(
		() =>
			image
				? thumbnailFrom((ctx, size) => drawBackground(ctx, { kind: "blur" }, size, size, { image }, 1))
				: "",
		[image],
	);

	const layout = useMemo(
		() =>
			imageSize ? computeCompositionLayout(imageSize.width, imageSize.height, unit, settings) : null,
		[imageSize, settings, unit],
	);

	// ── Annotation state ──────────────────────────────────────────────────────
	const commit = useCallback((next: Annotation[], options?: { coalesceKey?: string }) => {
		setHistory((current) =>
			next === current.present.annotations
				? current
				: pushHistory(current, { ...current.present, annotations: next }, options),
		);
	}, []);

	useEffect(() => {
		if (selectedId && !annotations.some((item) => item.id === selectedId)) setSelectedId(null);
	}, [annotations, selectedId]);

	const finishText = useCallback(() => {
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
			commit([...list, annotation]);
		} else {
			const previous = list.find((item) => item.id === annotation.id);
			if (previous !== annotation) {
				commit(list.map((item) => (item.id === annotation.id ? annotation : item)));
			}
		}
		setSelectedId(annotation.id);
	}, [commit]);

	const beginText = useCallback(
		(annotation: Annotation, isNew: boolean) => {
			if (annotation.kind !== "text") return;
			finishText();
			setSelectedId(isNew ? null : annotation.id);
			setEditing({ annotation, isNew });
		},
		[finishText],
	);

	const setTool = useCallback(
		(next: Tool) => {
			finishText();
			setToolState(next);
			if (next !== "select") setSelectedId(null);
		},
		[finishText],
	);

	const selected = useMemo(
		() => annotations.find((item) => item.id === selectedId) ?? null,
		[annotations, selectedId],
	);

	const contextKind: AnnotationKind | null = editing
		? "text"
		: selected?.kind ?? (tool !== "select" ? tool : null);

	const [styleBarMode, setStyleBarMode] = useState<StyleBarMode>("full");

	const effectiveStyle = useMemo(() => {
		if (editing) return styleFromAnnotation(editing.annotation, toolStyle, unit);
		if (selected) return styleFromAnnotation(selected, toolStyle, unit);
		return toolStyle;
	}, [editing, selected, toolStyle, unit]);

	const applyStyle = useCallback(
		(patch: Partial<ToolStyle>) => {
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
		[commit, effectiveStyle, selected, unit],
	);

	const deleteSelected = useCallback(() => {
		if (!selectedId) return;
		commit(annotationsRef.current.filter((item) => item.id !== selectedId));
		setSelectedId(null);
	}, [commit, selectedId]);

	const duplicateSelected = useCallback(() => {
		if (!selected) return;
		const copy = duplicateAnnotation(selected, 16 * unit, annotationsRef.current);
		commit([...annotationsRef.current, copy]);
		setSelectedId(copy.id);
	}, [commit, selected, unit]);

	const undo = useCallback(() => {
		finishText();
		setHistory(undoHistory);
	}, [finishText]);

	const redo = useCallback(() => {
		finishText();
		setHistory(redoHistory);
	}, [finishText]);

	// ── Settings ──────────────────────────────────────────────────────────────
	const updateSettings = useCallback((patch: Partial<StyleSettings>) => {
		setSettings((current) => normalizeStyleSettings({ ...current, ...patch }));
	}, []);

	const updateWatermark = useCallback((patch: Partial<WatermarkSettings>) => {
		setSettings((current) =>
			normalizeStyleSettings({ ...current, watermark: { ...current.watermark, ...patch } }),
		);
	}, []);

	// ── Export ────────────────────────────────────────────────────────────────
	const showToast = useCallback((tone: ToastState["tone"], title: string, detail?: string) => {
		if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
		setToast({ id: Date.now(), tone, title, detail });
		toastTimerRef.current = window.setTimeout(() => {
			setToast(null);
			toastTimerRef.current = null;
		}, TOAST_DURATION_MS);
	}, []);

	// ── Default style ─────────────────────────────────────────────────────────
	const styleDefaults = useMemo(
		() => resolveStyleDefaults(settings, savedDefault),
		[settings, savedDefault],
	);

	const saveAsDefaultStyle = useCallback(() => {
		saveDefaultStyle(settings);
		setSavedDefault(settings);
		showToast("success", t("toast.defaultSaved"), t("toast.defaultSavedDetail"));
	}, [settings, showToast]);

	const restoreDefaultStyle = useCallback(() => {
		const { restoreTo, restoreTarget } = styleDefaults;
		if (!restoreTo) return;
		setSettings(restoreTo);
		showToast(
			"success",
			restoreTarget === "builtIn" ? t("toast.builtInRestored") : t("toast.defaultRestored"),
		);
	}, [showToast, styleDefaults]);

	const renderPng = useCallback(
		async (purpose: "export" | "pin") => {
			if (!image || !layout) return null;
			const list = mergeEditing(annotationsRef.current, editingRef.current);
			finishText();
			const wallpaperImage = await wallpaperRequestRef.current;
			let scale = 1;
			if (purpose === "pin") {
				const backing = calculateCanvasBackingSize(
					layout.width,
					layout.height,
					1,
					MAX_PIN_DIMENSION,
					MAX_PIN_PIXELS,
				);
				if (backing) scale = backing.width / layout.width;
			}
			const canvas = document.createElement("canvas");
			canvas.width = Math.max(1, Math.round(layout.width * scale));
			canvas.height = Math.max(1, Math.round(layout.height * scale));
			const context = canvas.getContext("2d");
			if (!context) return null;
			context.setTransform(scale, 0, 0, scale, 0, 0);
			if (!exportScratchRef.current) exportScratchRef.current = document.createElement("canvas");
			const scratch = exportScratchRef.current;
			const { width: sourceWidth, height: sourceHeight } = sourceSize(image);
			const env: AnnotationRenderEnv = {
				source: image,
				sourceWidth,
				sourceHeight,
				pixelScale: scale,
				scratch: () => scratch,
			};
			renderComposition(context, {
				layout,
				settings,
				sources: { image, wallpaper: wallpaperImage },
				pixelScale: scale,
				drawOverImage: (ctx) => drawAnnotations(ctx, list, env),
			});
			try {
				return await canvasToPng(canvas);
			} finally {
				scratch.width = 1;
				scratch.height = 1;
			}
		},
		[finishText, image, layout, settings],
	);

	const runExport = useCallback(
		async (task: () => Promise<void>) => {
			if (exportBusyRef.current || !image) return;
			exportBusyRef.current = true;
			try {
				await task();
			} catch (error) {
				showToast("error", t("toast.renderFailed"), error instanceof Error ? error.message : undefined);
			} finally {
				exportBusyRef.current = false;
			}
		},
		[image, showToast],
	);

	const copyImage = useCallback(
		(closeAfter = false) =>
			runExport(async () => {
				const png = await renderPng("export");
				if (!png) {
					showToast("error", t("toast.copyFailed"), t("toast.renderFailed"));
					return;
				}
				const result = await window.electronAPI.copyToClipboard(new Uint8Array(png));
				if (!result.success) {
					showToast("error", t("toast.copyFailed"), result.error || t("toast.retry"));
					return;
				}
				if (closeAfter) {
					window.close();
					return;
				}
				showToast("success", t("toast.copied"), t("toast.copiedDetail"));
			}),
		[renderPng, runExport, showToast],
	);

	const quickSave = useCallback(
		() =>
			runExport(async () => {
				const png = await renderPng("export");
				if (!png) {
					showToast("error", t("toast.saveFailed"), t("toast.renderFailed"));
					return;
				}
				const result = await window.electronAPI.quickSaveScreenshotFinal(png);
				if (result.success) showToast("success", t("toast.saved"), fileName(result.path));
				else showToast("error", t("toast.saveFailed"), result.error || t("toast.retry"));
			}),
		[renderPng, runExport, showToast],
	);

	const saveAs = useCallback(
		() =>
			runExport(async () => {
				const png = await renderPng("export");
				if (!png) {
					showToast("error", t("toast.saveFailed"), t("toast.renderFailed"));
					return;
				}
				const result = await window.electronAPI.saveScreenshotFinal(png);
				if (result.success) showToast("success", t("toast.saved"), fileName(result.path));
				else if (!result.canceled) showToast("error", t("toast.saveFailed"), result.error || t("toast.retry"));
			}),
		[renderPng, runExport, showToast],
	);

	const pin = useCallback(
		() =>
			runExport(async () => {
				const png = await renderPng("pin");
				if (!png) {
					showToast("error", t("toast.pinFailed"), t("toast.renderFailed"));
					return;
				}
				const result = await window.electronAPI.pinScreenshot(new Uint8Array(png));
				if (result.success) showToast("success", t("toast.pinned"), t("toast.pinnedDetail"));
				else showToast("error", t("toast.pinFailed"), result.error);
			}),
		[renderPng, runExport, showToast],
	);

	const extractText = useCallback(async () => {
		const blob = image ? await sourceToPngBlob(image, sourceBlobRef.current) : null;
		if (!blob) throw new Error(t("ocr.notReady"));
		const result = await window.electronAPI.extractText(await blob.arrayBuffer());
		if (!result.success) throw new Error(result.error);
		return { text: result.text, lineCount: result.lineCount };
	}, [image]);

	const copyText = useCallback(async (text: string) => {
		const result = await window.electronAPI.copyTextToClipboard(text);
		if (!result.success) throw new Error(result.error || t("ocr.copyFailedLive"));
	}, []);

	const toggleOcr = useCallback(() => setOcrOpen((open) => !open), []);
	const closeOcr = useCallback(() => setOcrOpen(false), []);
	const toggleInspector = useCallback(() => setInspectorOpen((open) => !open), []);

	// ── Stitching ─────────────────────────────────────────────────────────────
	/** Applies a new stitch, moving each annotation along with its capture. */
	const commitStitch = useCallback(
		(next: Stitch, options?: { coalesceKey?: string }) => {
			const current = docRef.current;
			const before = stitchPlacement(current.stitch, unit);
			const after = stitchPlacement(next, unit);
			if (!fitsStitchLimits(after)) {
				showToast("error", t("stitch.tooLarge"), t("stitch.tooLargeDetail"));
				return false;
			}
			const remapped = remapAnnotations(current.annotations, before, after, measureTextAnnotation);
			const nextDoc = { annotations: remapped, stitch: next };
			docRef.current = nextDoc;
			setHistory((history) => pushHistory(history, nextDoc, options));
			saveStitchSettings(next.settings);
			return true;
		},
		[showToast, unit],
	);

	/** Appends a capture; `pieceUnit` is its scale factor, so mixed displays match. */
	const addPiece = useCallback(
		(pieceImage: HTMLImageElement, pieceUnit: number) => {
			finishText();
			const current = docRef.current.stitch;
			const scale = pieceUnit > 0 ? unit / pieceUnit : 1;
			if (commitStitch({ ...current, pieces: [...current.pieces, { id: createPieceId(), image: pieceImage, scale }] })) {
				setSelectedId(null);
				// The stitch controls live in the style panel.
				setInspectorOpen(true);
			}
		},
		[commitStitch, finishText, unit],
	);

	const movePiece = useCallback(
		(id: string, delta: -1 | 1) => {
			const current = docRef.current.stitch;
			const index = current.pieces.findIndex((piece) => piece.id === id);
			const target = index + delta;
			if (index < 0 || target < 0 || target >= current.pieces.length) return;
			const pieces = [...current.pieces];
			[pieces[index], pieces[target]] = [pieces[target], pieces[index]];
			commitStitch({ ...current, pieces });
		},
		[commitStitch],
	);

	const removePiece = useCallback(
		(id: string) => {
			const current = docRef.current.stitch;
			if (current.pieces.length <= 1) return;
			finishText();
			setSelectedId(null);
			commitStitch({ ...current, pieces: current.pieces.filter((piece) => piece.id !== id) });
		},
		[commitStitch, finishText],
	);

	const updateStitchSettings = useCallback(
		(patch: Partial<StitchSettings>) => {
			const current = docRef.current.stitch;
			commitStitch(
				{ ...current, settings: { ...current.settings, ...patch } },
				{ coalesceKey: "gap" in patch ? "stitch-gap" : undefined },
			);
		},
		[commitStitch],
	);

	/** Hides the editor, takes one more capture, and appends it here. */
	const captureForStitch = useCallback(async () => {
		finishText();
		const result = await window.electronAPI.captureForStitch?.();
		if (result && !result.success) showToast("error", t("stitch.failed"), t("toast.retry"));
	}, [finishText, showToast]);

	useEffect(() => {
		const unsubscribe = window.electronAPI.onStitchPiece?.((payload) => {
			void (async () => {
				try {
					const url = URL.createObjectURL(createPngBlob(payload.imageBytes));
					const decoded = await decodeImageData(url);
					const scaleFactor = Number(payload.scaleFactor);
					addPiece(decoded, Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : unit);
				} catch (error) {
					console.error("QuickShot could not add the capture", error);
					showToast("error", t("stitch.failed"), t("toast.retry"));
				}
			})();
		});
		return () => unsubscribe?.();
	}, [addPiece, showToast, unit]);

	// Images pasted or dropped onto the editor are stitched in too.
	useEffect(() => {
		if (!image) return;
		const addFiles = async (files: File[]) => {
			for (const file of files) {
				const url = URL.createObjectURL(file);
				try {
					addPiece(await decodeImageData(url), unit);
				} catch {
					URL.revokeObjectURL(url);
				}
			}
		};
		const imageFiles = (list: FileList | undefined | null) =>
			[...(list ?? [])].filter((file) => file.type.startsWith("image/"));
		const handlePaste = (event: ClipboardEvent) => {
			if (isEditableTarget(event.target) || editingRef.current) return;
			const files = imageFiles(event.clipboardData?.files);
			if (files.length === 0) return;
			event.preventDefault();
			void addFiles(files);
		};
		const handleDragOver = (event: DragEvent) => {
			if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
		};
		const handleDrop = (event: DragEvent) => {
			event.preventDefault();
			const files = imageFiles(event.dataTransfer?.files);
			if (files.length > 0) void addFiles(files);
		};
		window.addEventListener("paste", handlePaste);
		window.addEventListener("dragover", handleDragOver);
		window.addEventListener("drop", handleDrop);
		return () => {
			window.removeEventListener("paste", handlePaste);
			window.removeEventListener("dragover", handleDragOver);
			window.removeEventListener("drop", handleDrop);
		};
	}, [addPiece, image, unit]);

	// ── Keyboard ──────────────────────────────────────────────────────────────
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.isComposing) return;
			const mod = isModKey(event);
			const key = event.key.toLowerCase();

			if (event.key === "Escape") {
				if (isEditableTarget(event.target)) {
					(event.target as HTMLElement).blur();
					return;
				}
				event.preventDefault();
				if (ocrOpen) setOcrOpen(false);
				else if (selectedId) setSelectedId(null);
				else window.close();
				return;
			}
			if (isEditableTarget(event.target)) return;

			if (mod) {
				if (key === "z") {
					event.preventDefault();
					if (event.shiftKey) redo();
					else undo();
				} else if (key === "y") {
					event.preventDefault();
					redo();
				} else if (key === "c" && !event.shiftKey) {
					if (window.getSelection()?.toString()) return;
					event.preventDefault();
					void copyImage();
				} else if (event.key === "Enter") {
					event.preventDefault();
					void copyImage(true);
				} else if (key === "s") {
					event.preventDefault();
					void (event.shiftKey ? saveAs() : quickSave());
				} else if (key === "p" && event.shiftKey) {
					event.preventDefault();
					void pin();
				} else if (key === "t" && event.shiftKey && SUPPORTS_OCR) {
					event.preventDefault();
					toggleOcr();
				} else if (key === "a" && event.shiftKey) {
					event.preventDefault();
					void captureForStitch();
				} else if (key === "d") {
					event.preventDefault();
					duplicateSelected();
				} else if (key === ".") {
					event.preventDefault();
					toggleInspector();
				} else if (key === "w") {
					event.preventDefault();
					window.close();
				}
				return;
			}
			if (event.altKey) return;

			if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
				event.preventDefault();
				deleteSelected();
				return;
			}
			if (event.key.startsWith("Arrow") && selected) {
				event.preventDefault();
				const step = (event.shiftKey ? 10 : 1) * unit;
				const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
				const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
				const moved = translateAnnotation(selected, dx, dy);
				commit(
					annotationsRef.current.map((item) => (item.id === moved.id ? moved : item)),
					{ coalesceKey: `nudge:${moved.id}` },
				);
				return;
			}
			if (event.key === "Enter" && selected?.kind === "text") {
				event.preventDefault();
				beginText(selected, false);
				return;
			}
			if (event.key === "[" || event.key === "]") {
				const delta = event.key === "]" ? 1 : -1;
				const next = Math.min(2, Math.max(0, effectiveStyle.strokeSize + delta)) as SizeIndex;
				applyStyle({ strokeSize: next });
				return;
			}
			const shortcutTool = TOOL_ORDER.find(
				(candidate) => `Key${TOOL_SHORTCUTS[candidate]}` === event.code,
			);
			if (shortcutTool && !event.shiftKey) {
				event.preventDefault();
				setTool(shortcutTool);
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [
		applyStyle,
		beginText,
		captureForStitch,
		commit,
		copyImage,
		deleteSelected,
		duplicateSelected,
		effectiveStyle.strokeSize,
		ocrOpen,
		pin,
		quickSave,
		redo,
		saveAs,
		selected,
		selectedId,
		setTool,
		toggleInspector,
		toggleOcr,
		undo,
		unit,
	]);

	const outputSize = layout ? { w: layout.width, h: layout.height } : { w: 0, h: 0 };
	const stitchPieceViews = useMemo(
		() => stitch.pieces.map((piece) => ({ id: piece.id, src: piece.image.src })),
		[stitch.pieces],
	);
	const styleBarFloats = styleBarMode === "floating";
	const contextBar =
		image && contextKind ? (
			<ContextBar
				kind={contextKind}
				style={effectiveStyle}
				onChange={applyStyle}
				hasSelection={Boolean(selected) && !editing}
				onDelete={deleteSelected}
				onDuplicate={duplicateSelected}
				variant={styleBarFloats ? "floating" : "inline"}
				compactColors={styleBarMode === "compact"}
			/>
		) : null;

	return (
		<div className="relative flex h-screen flex-col overflow-hidden bg-[var(--qs-bg)] text-[var(--qs-text)] select-none">
			<Toolbar
				tool={tool}
				onToolChange={setTool}
				canUndo={history.past.length > 0}
				canRedo={history.future.length > 0}
				onUndo={undo}
				onRedo={redo}
				ready={Boolean(image)}
				onCopy={() => void copyImage()}
				onQuickSave={() => void quickSave()}
				onSaveAs={() => void saveAs()}
				onPin={() => void pin()}
				ocrOpen={ocrOpen}
				onToggleOcr={toggleOcr}
				inspectorOpen={inspectorOpen}
				onToggleInspector={toggleInspector}
				onStitch={() => void captureForStitch()}
				styleBar={styleBarFloats ? null : contextBar}
				styleBarProbes={styleBarProbes}
				onStyleBarModeChange={setStyleBarMode}
			/>
			<div className="flex min-h-0 flex-1">
				<Stage
					image={image}
					unit={unit}
					settings={settings}
					layout={layout}
					wallpaper={wallpaper}
					annotations={annotations}
					selectedId={selectedId}
					editing={editing}
					tool={tool}
					toolStyle={toolStyle}
					onSelect={setSelectedId}
					onCommit={commit}
					onBeginText={beginText}
					onEditingChange={(annotation) =>
						setEditing((current) => (current ? { ...current, annotation } : current))
					}
					onFinishText={finishText}
					topMargin={styleBarFloats ? STAGE_TOP_MARGIN.floating : STAGE_TOP_MARGIN.clear}
				>
					{styleBarFloats && contextBar}
				</Stage>
				<TextExtractionPanel
					open={ocrOpen}
					onClose={closeOcr}
					onExtract={extractText}
					onCopyText={copyText}
				/>
				{inspectorOpen && (
					<Inspector
						settings={settings}
						onChange={updateSettings}
						onWatermarkChange={updateWatermark}
						outputSize={outputSize}
						gradientThumbs={gradientThumbs}
						wallpaperThumbs={wallpaperThumbs}
						blurThumb={blurThumb}
						canSaveDefault={styleDefaults.canSave}
						restoreTarget={styleDefaults.restoreTarget}
						onSaveDefault={saveAsDefaultStyle}
						onRestoreDefault={restoreDefaultStyle}
						stitchSection={
							stitch.pieces.length > 1 ? (
								<StitchPanel
									pieces={stitchPieceViews}
									settings={stitch.settings}
									onSettingsChange={updateStitchSettings}
									onMove={movePiece}
									onRemove={removePiece}
									onAdd={() => void captureForStitch()}
								/>
							) : null
						}
					/>
				)}
			</div>
			{toast && <Toast toast={toast} />}
		</div>
	);
}
