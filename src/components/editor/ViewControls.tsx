import { Hand, Minus, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { MAX_ZOOM, MIN_ZOOM } from "@/editor/viewport";
import { t } from "@/lib/i18n";
import { bindingLabel, useKeymap } from "@/lib/keymap";
import { Divider, IconButton, Tooltip } from "./ui";

export function ViewControls({ zoom, fitting, handMode, onZoom, onZoomIn, onZoomOut, onActualSize, onFit, onHand, width, height }: {
	zoom: number; fitting: boolean; handMode: boolean;
	onZoom: (zoom: number) => void; onZoomIn: () => void; onZoomOut: () => void;
	onActualSize: () => void; onFit: () => void; onHand: () => void; width: number; height: number;
}) {
	const keymap = useKeymap();
	const percent = Math.round(zoom * 1000) / 10;
	const [input, setInput] = useState(String(percent));
	useEffect(() => setInput(String(percent)), [percent]);
	const apply = () => {
		const value = Number(input.replace("%", "").trim());
		if (Number.isFinite(value) && value > 0) {
			const bounded = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value / 100));
			setInput(String(Math.round(bounded * 1000) / 10));
			onZoom(bounded);
		}
		else setInput(String(percent));
	};
	const textButton = "qs-tip-host relative rounded-[7px] px-2 py-1.5 text-[11px] hover:bg-[var(--qs-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--qs-select)]";
	return (
		<div data-stage-controls className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-1.5">
			<span className="text-[10px] tabular-nums text-[var(--qs-text-3)]">{width} × {height}</span>
			<div role="toolbar" aria-label={t("stage.viewControls")} title={t("stage.viewHint")}
				className="flex items-center rounded-[11px] border border-[var(--qs-border)] bg-[var(--qs-bg)] p-1 shadow-sm">
				<IconButton label={t("stage.zoomOut")} shortcut={bindingLabel(keymap.zoomOut)} tipSide="top" size="sm" onClick={onZoomOut} disabled={zoom <= MIN_ZOOM}>
					<Minus size={14} />
				</IconButton>
				<div className="flex items-center text-[11px] tabular-nums">
					<input data-quickshot-zoom aria-label={t("stage.zoom", { value: percent })} inputMode="decimal" value={input}
						onChange={(event) => setInput(event.target.value)} onFocus={(event) => event.target.select()} onBlur={apply}
						onKeyDown={(event) => {
							if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); }
							if (event.key === "Escape") { event.stopPropagation(); setInput(String(percent)); }
						}}
						className="w-12 rounded px-1 py-1.5 text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--qs-select)]" />
					<span className="mr-1 text-[var(--qs-text-3)]">%</span>
				</div>
				<IconButton label={t("stage.zoomIn")} shortcut={bindingLabel(keymap.zoomIn)} tipSide="top" size="sm" onClick={onZoomIn} disabled={zoom >= MAX_ZOOM}>
					<Plus size={14} />
				</IconButton>
				<Divider />
				<button type="button" aria-label={t("stage.actualSize")} onClick={onActualSize} className={textButton}>
					100%<Tooltip label={t("stage.actualSize")} shortcut={bindingLabel(keymap.zoomActual)} side="top" />
				</button>
				<button type="button" onClick={onFit} aria-pressed={fitting} className={`${textButton} whitespace-nowrap ${fitting ? "bg-[var(--qs-active)]" : ""}`}>
					{t("stage.fit")}<Tooltip label={t("stage.fit")} shortcut={bindingLabel(keymap.zoomFit)} side="top" />
				</button>
				<Divider />
				<IconButton label={t("stage.pan")} shortcut="Space" tipSide="top" size="sm" active={handMode} aria-pressed={handMode} onClick={onHand}>
					<Hand size={14} />
				</IconButton>
			</div>
		</div>
	);
}
