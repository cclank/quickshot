import { CornerDownLeft, GripVertical } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LANGUAGE, t } from "@/lib/i18n";
import { createFrameObjectUrl } from "@/lib/pngBytes";

const SPECTRUM = "conic-gradient(#FF5A7A, #FF9F43, #FFD43B, #38D9A9, #4DABF7, #9775FA, #FF5A7A)";
/** A lost overlap during a fast flick usually recovers by itself; only a lasting one is worth a word. */
const LOST_GRACE_MS = 600;

type Progress = Omit<ScrollCaptureProgress, "previewBytes">;

const STATUS_TEXT: Record<Progress["status"], Parameters<typeof t>[0]> = {
	waiting: "scroll.waiting",
	capturing: "scroll.capturing",
	behind: "scroll.behind",
	lost: "scroll.lost",
	full: "scroll.full",
	finishing: "scroll.finishing",
	error: "scroll.error",
};

/**
 * Sits beside an area while it is captured by scrolling: the stitched image
 * so far, its length, a hint, and Done / Cancel (↩ / Esc work anywhere). The
 * window never takes focus, so the page being scrolled keeps it.
 */
export function ScrollCapturePanel() {
	const [progress, setProgress] = useState<Progress | null>(null);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const [previewTall, setPreviewTall] = useState(false);
	const [lostShown, setLostShown] = useState(false);
	const previewUrlRef = useRef<string | null>(null);
	const previewBoxRef = useRef<HTMLDivElement>(null);
	const dragPointerRef = useRef<number | null>(null);

	const applyPreview = useCallback((bytes: Uint8Array | undefined) => {
		if (!bytes) return;
		try {
			const url = createFrameObjectUrl(bytes, "image/jpeg");
			if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
			previewUrlRef.current = url;
			setPreviewUrl(url);
		} catch (error) {
			console.error("QuickShot scroll preview is unreadable", error);
		}
	}, []);

	useEffect(() => {
		const api = window.electronAPI.scrollCapture;
		if (!api) return;
		let disposed = false;
		const unsubscribe = api.onProgress((next) => {
			const { previewBytes, ...rest } = next;
			setProgress(rest);
			applyPreview(previewBytes);
		});
		void api.getState().then((state) => {
			if (disposed || !state.success) return;
			setProgress((current) => current ?? state.progress);
			applyPreview(state.previewBytes);
		});
		return () => {
			disposed = true;
			unsubscribe();
			if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
		};
	}, [applyPreview]);

	const status = progress?.status ?? "waiting";
	useEffect(() => {
		if (status !== "lost") {
			setLostShown(false);
			return;
		}
		const timer = window.setTimeout(() => setLostShown(true), LOST_GRACE_MS);
		return () => window.clearTimeout(timer);
	}, [status]);

	const busy = status === "finishing" || status === "error";
	const shownStatus = status === "lost" && !lostShown ? "capturing" : status;
	const height = progress?.height ?? 0;
	const frameHeight = progress?.frameHeight ?? 0;
	const screens = frameHeight > 0 ? height / frameHeight : 0;
	const live = status === "waiting" || status === "capturing" || status === "behind" || status === "lost";

	return (
		<div className="flex h-screen select-none p-2 text-white">
			<div className="flex min-h-0 w-full flex-col rounded-[18px] border border-white/10 bg-[rgba(28,28,30,0.94)] p-3.5 shadow-[0_12px_32px_rgba(0,0,0,0.35)] backdrop-blur-xl">
				<div
					className="qs-no-drag flex cursor-grab touch-none items-center gap-1.5 active:cursor-grabbing"
					title={t("scroll.dragHint")}
					onPointerDown={(event) => {
						if (event.button !== 0 || !window.electronAPI.scrollCapture?.movePanel) return;
						event.preventDefault();
						dragPointerRef.current = event.pointerId;
						event.currentTarget.setPointerCapture(event.pointerId);
						void window.electronAPI.scrollCapture.movePanel("start", event.screenX, event.screenY);
					}}
					onPointerMove={(event) => {
						if (dragPointerRef.current !== event.pointerId) return;
						void window.electronAPI.scrollCapture?.movePanel?.("move", event.screenX, event.screenY);
					}}
					onPointerUp={(event) => {
						if (dragPointerRef.current !== event.pointerId) return;
						dragPointerRef.current = null;
						event.currentTarget.releasePointerCapture(event.pointerId);
						void window.electronAPI.scrollCapture?.movePanel?.("end", event.screenX, event.screenY);
					}}
					onPointerCancel={(event) => {
						dragPointerRef.current = null;
						void window.electronAPI.scrollCapture?.movePanel?.("end", event.screenX, event.screenY);
					}}
				>
					<GripVertical size={12} className="shrink-0 text-white/40" aria-hidden="true" />
					<span
						aria-hidden="true"
						className={`h-2.5 w-2.5 shrink-0 rounded-full ${live ? "animate-pulse" : ""}`}
						style={{ background: SPECTRUM }}
					/>
					<span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{t("scroll.title")}</span>
					<span className="shrink-0 text-[12px] tabular-nums text-white/80">
						{height > 0 ? `${height.toLocaleString(LANGUAGE === "zh" ? "zh-CN" : "en-US")} px` : ""}
					</span>
				</div>
				<div className="mt-0.5 flex h-4 justify-between text-[10px] tabular-nums text-white/45">
					<span>{t("scroll.dragHint")}</span>
					<span>{screens >= 1.05 ? t("scroll.screens", { count: screens.toFixed(1) }) : ""}</span>
				</div>

				<div
					ref={previewBoxRef}
					className="relative mt-2 min-h-0 flex-1 overflow-hidden rounded-[10px] border border-white/10 bg-black/30"
				>
					{previewUrl ? (
						<>
							<img
								src={previewUrl}
								alt=""
								draggable={false}
								className="absolute left-0 w-full"
								style={previewTall ? { bottom: 0 } : { top: 0 }}
								onLoad={(event) => {
									const box = previewBoxRef.current;
									const image = event.currentTarget;
									if (!box || image.naturalWidth <= 0) return;
									setPreviewTall((image.naturalHeight / image.naturalWidth) * box.clientWidth > box.clientHeight);
								}}
							/>
							{previewTall && (
								<div className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-[rgba(28,28,30,0.6)] to-transparent" />
							)}
						</>
					) : (
						<div className="flex h-full items-center justify-center px-4 text-center text-[11.5px] text-white/45">
							{t("scroll.previewEmpty")}
						</div>
					)}
				</div>

				<p
					role="status"
					className={`mt-2.5 min-h-[34px] text-[11.5px] leading-[1.45] ${
						shownStatus === "lost"
							? "text-[#FFD43B]"
							: shownStatus === "error"
								? "text-[#FF8FA3]"
								: shownStatus === "full"
									? "text-[#63E6BE]"
									: "text-white/65"
					}`}
				>
					{t(STATUS_TEXT[shownStatus])}
				</p>

				<div className="mt-2 flex gap-2">
					<button
						type="button"
						disabled={status === "finishing"}
						onClick={() => void window.electronAPI.scrollCapture?.cancel()}
						className="flex h-[34px] flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-white/10 text-[12.5px] font-medium text-white/85 transition-colors hover:bg-white/15 disabled:opacity-40"
					>
						{t("scroll.cancel")}
						<kbd className="font-sans text-[11px] text-white/45">esc</kbd>
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={() => void window.electronAPI.scrollCapture?.finish()}
						className="flex h-[34px] flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-white text-[12.5px] font-semibold text-[#1c1c1e] transition-colors hover:bg-white/90 disabled:opacity-40"
					>
						{t("scroll.done")}
						<CornerDownLeft size={13} strokeWidth={2.2} className="text-black/45" aria-label="Return" />
					</button>
				</div>
			</div>
		</div>
	);
}
