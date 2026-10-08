import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { memo } from "react";
import {
	STITCH_GAP_RANGE,
	type StitchAlign,
	type StitchArrangement,
	type StitchSettings,
} from "@/editor/stitch";
import { t } from "@/lib/i18n";
import { formatShortcut } from "@/lib/platform";
import { IconButton, Section, Segmented, Slider } from "./ui";

type StitchPanelProps = {
	pieces: { id: string; src: string }[];
	settings: StitchSettings;
	onSettingsChange: (patch: Partial<StitchSettings>) => void;
	onMove: (id: string, delta: -1 | 1) => void;
	onRemove: (id: string) => void;
	onAdd: () => void;
};

const ALIGN_LABELS: Record<StitchArrangement, Record<StitchAlign, Parameters<typeof t>[0]>> = {
	vertical: { start: "stitch.align.left", center: "stitch.align.center", end: "stitch.align.right" },
	grid: { start: "stitch.align.left", center: "stitch.align.center", end: "stitch.align.right" },
	horizontal: { start: "stitch.align.top", center: "stitch.align.center", end: "stitch.align.bottom" },
};

/** Arranges the captures of a stitch: layout, spacing, alignment and order. */
export const StitchPanel = memo(function StitchPanel({
	pieces,
	settings,
	onSettingsChange,
	onMove,
	onRemove,
	onAdd,
}: StitchPanelProps) {
	const vertical = settings.arrangement !== "horizontal";
	return (
		<Section
			title={t("stitch.title")}
			action={<span className="text-[11px] tabular-nums text-[var(--qs-text-3)]">{pieces.length}</span>}
		>
			<Segmented
				label={t("stitch.arrangement")}
				value={settings.arrangement}
				onChange={(arrangement) => onSettingsChange({ arrangement })}
				options={(["vertical", "horizontal", "grid"] as StitchArrangement[]).map((arrangement) => ({
					value: arrangement,
					label: t(`stitch.arrangement.${arrangement}`),
				}))}
			/>
			<div className="mt-2">
				<Segmented
					label={t("stitch.align")}
					value={settings.align}
					onChange={(align) => onSettingsChange({ align })}
					options={(["start", "center", "end"] as StitchAlign[]).map((align) => ({
						value: align,
						label: t(ALIGN_LABELS[settings.arrangement][align]),
					}))}
				/>
			</div>
			<div className="mt-3">
				<Slider
					label={t("stitch.gap")}
					value={settings.gap}
					min={STITCH_GAP_RANGE.min}
					max={STITCH_GAP_RANGE.max}
					step={STITCH_GAP_RANGE.step}
					onChange={(gap) => onSettingsChange({ gap })}
					onReset={() => onSettingsChange({ gap: 0 })}
				/>
			</div>

			<ol className="mt-3 flex flex-col gap-1">
				{pieces.map((piece, index) => (
					<li
						key={piece.id}
						className="group flex h-11 items-center gap-2 rounded-[8px] bg-[var(--qs-field)] pl-1.5 pr-1"
					>
						<span className="flex h-8 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[5px] bg-[var(--qs-panel-raised)] shadow-[inset_0_0_0_0.5px_var(--qs-border-strong)]">
							<img src={piece.src} alt="" className="max-h-full max-w-full object-contain" draggable={false} />
						</span>
						<span className="min-w-0 flex-1 truncate text-[12px] text-[var(--qs-text-2)]">
							{t("stitch.piece", { n: index + 1 })}
						</span>
						<span className="flex items-center opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
							<IconButton
								size="sm"
								tipSide="top"
								label={t("stitch.moveEarlier")}
								disabled={index === 0}
								onClick={() => onMove(piece.id, -1)}
							>
								{vertical ? (
									<ChevronUp size={14} strokeWidth={1.9} />
								) : (
									<ChevronUp size={14} strokeWidth={1.9} className="-rotate-90" />
								)}
							</IconButton>
							<IconButton
								size="sm"
								tipSide="top"
								label={t("stitch.moveLater")}
								disabled={index === pieces.length - 1}
								onClick={() => onMove(piece.id, 1)}
							>
								{vertical ? (
									<ChevronDown size={14} strokeWidth={1.9} />
								) : (
									<ChevronDown size={14} strokeWidth={1.9} className="-rotate-90" />
								)}
							</IconButton>
							<IconButton
								size="sm"
								tipSide="top"
								label={t("stitch.remove")}
								onClick={() => onRemove(piece.id)}
								className="hover:!text-[var(--qs-danger)]"
							>
								<X size={14} strokeWidth={1.9} />
							</IconButton>
						</span>
					</li>
				))}
			</ol>

			<button
				type="button"
				onClick={onAdd}
				className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-[8px] border border-dashed border-[var(--qs-border-strong)] text-[12px] font-medium text-[var(--qs-text-2)] transition-colors hover:bg-[var(--qs-hover)] hover:text-[var(--qs-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--qs-select)]"
			>
				<Plus size={14} strokeWidth={2} />
				{t("stitch.add")}
				<span className="text-[11px] text-[var(--qs-text-3)]">{formatShortcut("mod+shift+a")}</span>
			</button>
			<p className="mt-1.5 text-center text-[11px] text-[var(--qs-text-3)]">{t("stitch.addHint")}</p>
		</Section>
	);
});
