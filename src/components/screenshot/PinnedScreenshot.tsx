import {
	MousePointer2,
	Pin,
	Scaling,
	SunMedium,
	X,
} from "lucide-react";
import {
	type CSSProperties,
	type FocusEvent,
	type PointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { createPngObjectUrl } from "@/lib/pngBytes";
import { t } from "@/lib/i18n";
import { resolvePinnedResizeScale } from "@/lib/pinnedResize";

const MIN_OPACITY_PERCENT = 35;
const INTRO_CONTROLS_DURATION_MS = 2_200;
const IS_MAC = navigator.userAgent.includes("Mac");
const RECOVERY_SHORTCUT_TEXT = IS_MAC
	? "Command Shift L"
	: "Control Shift L";
const RECOVERY_SHORTCUT_HINT = IS_MAC ? "⌘⇧L" : "Ctrl+Shift+L";

type ResizeGesture = {
	startScreenX: number;
	startScreenY: number;
	startWidth: number;
	startHeight: number;
};

export function PinnedScreenshot() {
	const [imageSrc, setImageSrc] = useState("");
	const [opacityPercent, setOpacityPercent] = useState(100);
	const [clickThrough, setClickThrough] = useState(false);
	const [introControlsVisible, setIntroControlsVisible] = useState(true);
	const [hovered, setHovered] = useState(false);
	const [focusWithin, setFocusWithin] = useState(false);
	const [liveMessage, setLiveMessage] = useState(
		t("pin.intro"),
	);
	const readySentRef = useRef(false);
	const resizeGestureRef = useRef<ResizeGesture | null>(null);
	const resizeFrameRef = useRef<number | null>(null);
	const pendingResizeWidthRef = useRef<number | null>(null);

	const closeWindow = useCallback(() => {
		void window.electronAPI.closePinnedScreenshot();
	}, []);

	useEffect(() => {
		let cancelled = false;
		let objectUrl = "";

		void window.electronAPI.getPinnedScreenshot().then((result) => {
			if (cancelled) return;
			if (!result.success) {
				closeWindow();
				return;
			}
			try {
				objectUrl = createPngObjectUrl(result.imageBytes);
				setImageSrc(objectUrl);
			} catch {
				closeWindow();
			}
		});

		return () => {
			cancelled = true;
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	}, [closeWindow]);

	useEffect(() => {
		const timer = window.setTimeout(() => {
			setIntroControlsVisible(false);
		}, INTRO_CONTROLS_DURATION_MS);
		return () => window.clearTimeout(timer);
	}, []);

	useEffect(() => {
		const unsubscribe = window.electronAPI.onPinnedInteractionRestored(() => {
			setClickThrough(false);
			setIntroControlsVisible(true);
			setLiveMessage(t("pin.restored"));
		});
		return unsubscribe;
	}, []);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (
				event.key === "Escape" ||
				((event.metaKey || event.ctrlKey) &&
					event.key.toLowerCase() === "w")
			) {
				event.preventDefault();
				closeWindow();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [closeWindow]);

	useEffect(
		() => () => {
			if (resizeFrameRef.current !== null) {
				window.cancelAnimationFrame(resizeFrameRef.current);
			}
		},
		[],
	);

	const handleImageLoad = useCallback(() => {
		if (readySentRef.current) return;
		readySentRef.current = true;
		void window.electronAPI.pinnedScreenshotReady().then((result) => {
			if (!result.success) closeWindow();
		});
	}, [closeWindow]);

	const handleImageError = useCallback(() => {
		closeWindow();
	}, [closeWindow]);

	const handleFocus = useCallback(() => {
		setFocusWithin(true);
	}, []);

	const handleBlur = useCallback((event: FocusEvent<HTMLElement>) => {
		if (!event.currentTarget.contains(event.relatedTarget)) {
			setFocusWithin(false);
		}
	}, []);

	const handleClickThroughToggle = useCallback(async () => {
		const nextClickThrough = !clickThrough;
		const result =
			await window.electronAPI.setPinnedScreenshotClickThrough(
				nextClickThrough,
			);
		if (!result.success) {
			setLiveMessage(t("pin.toggleFailed"));
			return;
		}
		setClickThrough(nextClickThrough);
		setIntroControlsVisible(false);
		setHovered(false);
		setLiveMessage(
			nextClickThrough
				? result.recoveryShortcutRegistered
					? t("pin.clickThroughOnShortcut", { shortcut: RECOVERY_SHORTCUT_TEXT })
					: t("pin.clickThroughOn")
				: t("pin.clickThroughOff"),
		);
	}, [clickThrough]);

	const flushResize = useCallback(() => {
		resizeFrameRef.current = null;
		const requestedWidth = pendingResizeWidthRef.current;
		pendingResizeWidthRef.current = null;
		if (requestedWidth === null) return;
		void window.electronAPI.resizePinnedScreenshot(requestedWidth);
	}, []);

	const handleResizeStart = useCallback(
		(event: PointerEvent<HTMLButtonElement>) => {
			event.preventDefault();
			event.stopPropagation();
			event.currentTarget.setPointerCapture(event.pointerId);
			resizeGestureRef.current = {
				startScreenX: event.screenX,
				startScreenY: event.screenY,
				startWidth: window.innerWidth,
				startHeight: window.innerHeight,
			};
		},
		[],
	);

	const handleResizeMove = useCallback(
		(event: PointerEvent<HTMLButtonElement>) => {
			const gesture = resizeGestureRef.current;
			if (!gesture) return;
			event.preventDefault();
			const widthScale =
				(gesture.startWidth + event.screenX - gesture.startScreenX) /
				gesture.startWidth;
			const heightScale =
				(gesture.startHeight + event.screenY - gesture.startScreenY) /
				gesture.startHeight;
			const scale = resolvePinnedResizeScale(widthScale, heightScale);
			pendingResizeWidthRef.current = Math.round(
				gesture.startWidth * scale,
			);
			if (resizeFrameRef.current === null) {
				resizeFrameRef.current = window.requestAnimationFrame(
					flushResize,
				);
			}
		},
		[flushResize],
	);

	const handleResizeEnd = useCallback(
		(event: PointerEvent<HTMLButtonElement>) => {
			if (!resizeGestureRef.current) return;
			event.preventDefault();
			resizeGestureRef.current = null;
			if (event.currentTarget.hasPointerCapture(event.pointerId)) {
				event.currentTarget.releasePointerCapture(event.pointerId);
			}
			if (
				pendingResizeWidthRef.current !== null &&
				resizeFrameRef.current === null
			) {
				resizeFrameRef.current = window.requestAnimationFrame(
					flushResize,
				);
			}
		},
		[flushResize],
	);

	const controlsVisible =
		!clickThrough && (introControlsVisible || hovered || focusWithin);

	return (
		<main
			aria-label={t("pin.label")}
			className="group relative h-screen w-screen overflow-hidden p-1.5 text-white select-none"
			style={{ WebkitAppRegion: "drag" } as CSSProperties}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			onFocusCapture={handleFocus}
			onBlurCapture={handleBlur}
		>
			{imageSrc && (
				<img
					src={imageSrc}
					alt={t("pin.label")}
					draggable={false}
					onLoad={handleImageLoad}
					onError={handleImageError}
					className="pointer-events-none h-full w-full rounded-[16px] object-contain shadow-[0_18px_46px_rgba(0,0,0,0.36)]"
					style={{ opacity: opacityPercent / 100 }}
				/>
			)}

			<div
				className="pointer-events-none absolute inset-1.5 rounded-[16px] border border-white/14"
				aria-hidden="true"
			/>

			<div
				role="toolbar"
				aria-label={t("pin.controls")}
				className={`absolute right-3 top-3 flex items-center gap-1 rounded-[13px] border border-white/12 bg-[rgba(10,14,22,0.84)] p-1 shadow-[0_12px_32px_rgba(0,0,0,0.3)] backdrop-blur-xl transition-[opacity,transform] duration-150 ease-out focus-within:opacity-100 motion-reduce:transition-none ${
					controlsVisible
						? "translate-y-0 opacity-100"
						: "pointer-events-none -translate-y-1 opacity-0"
				}`}
				style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
			>
				<Pin
					size={14}
					strokeWidth={1.8}
					className="ml-1 text-white/72"
					aria-hidden="true"
				/>
				<label
					className="flex h-8 items-center gap-1 px-1"
					title={t("pin.opacity", { value: opacityPercent })}
				>
					<SunMedium
						size={13}
						strokeWidth={1.8}
						className="text-white/62"
						aria-hidden="true"
					/>
					<input
						type="range"
						min={MIN_OPACITY_PERCENT}
						max={100}
						value={opacityPercent}
						onChange={(event) =>
							setOpacityPercent(Number(event.target.value))
						}
						className="h-1 w-14 cursor-pointer accent-white"
						aria-label={t("pin.opacityLabel")}
						aria-valuetext={`${opacityPercent}%`}
					/>
				</label>
				<button
					type="button"
					onClick={() => void handleClickThroughToggle()}
					className="flex h-8 w-8 items-center justify-center rounded-[9px] text-white/72 transition-colors hover:bg-white/12 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
					aria-label={t("pin.clickThroughAria", { shortcut: RECOVERY_SHORTCUT_TEXT })}
					aria-pressed={clickThrough}
					title={t("pin.clickThroughTitle", { shortcut: RECOVERY_SHORTCUT_HINT })}
				>
					<MousePointer2
						size={14}
						strokeWidth={1.8}
						aria-hidden="true"
					/>
				</button>
				<button
					type="button"
					onClick={closeWindow}
					className="flex h-8 w-8 items-center justify-center rounded-[9px] text-white/72 transition-colors hover:bg-white/12 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
					aria-label={t("pin.close")}
					title={t("action.close")}
				>
					<X size={14} strokeWidth={1.8} aria-hidden="true" />
				</button>
			</div>

			<button
				type="button"
				aria-label={t("pin.resize")}
				title={t("pin.resizeTitle")}
				onPointerDown={handleResizeStart}
				onPointerMove={handleResizeMove}
				onPointerUp={handleResizeEnd}
				onPointerCancel={handleResizeEnd}
				onLostPointerCapture={handleResizeEnd}
				className={`absolute bottom-1.5 right-1.5 flex h-8 w-8 touch-none items-end justify-end rounded-tl-xl p-1 text-white/68 transition-opacity duration-150 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70 motion-reduce:transition-none ${
					controlsVisible
						? "cursor-nwse-resize opacity-100"
						: "pointer-events-none opacity-0"
				}`}
				style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
			>
				<Scaling size={14} strokeWidth={1.8} aria-hidden="true" />
			</button>

			<p className="sr-only" aria-live="polite">
				{liveMessage}
			</p>
		</main>
	);
}
