import { ChevronDown, Copy as DuplicateIcon, Trash2 } from "lucide-react";
import { type CSSProperties, memo, type ReactNode, useEffect, useRef, useState } from "react";
import {
	ANNOTATION_COLORS,
	type SizeIndex,
	type TextSizeIndex,
	type ToolStyle,
} from "@/editor/presets";
import type { AnnotationKind, RedactMode, ShapeFill, TextStyle } from "@/editor/types";
import { t } from "@/lib/i18n";
import { bindingLabel, useKeymap } from "@/lib/keymap";
import {
	BlurIcon,
	FillNoneIcon,
	FillSoftIcon,
	FillSolidIcon,
	PixelateIcon,
	TextOutlineIcon,
	TextPillIcon,
	TextPlainIcon,
} from "./icons";
import { Divider, IconButton, Tooltip } from "./ui";

type ContextBarProps = {
	kind: AnnotationKind;
	style: ToolStyle;
	onChange: (patch: Partial<ToolStyle>) => void;
	hasSelection: boolean;
	onDelete: () => void;
	onDuplicate: () => void;
	/** Inside the title bar, or floating over the canvas when the window is narrow. */
	variant?: "inline" | "floating";
	/** Folds the colour swatches into a single colour menu to save width. */
	compactColors?: boolean;
	/** Renders an invisible copy that only exists to be measured. */
	measureOnly?: boolean;
};

const COLORLESS: AnnotationKind[] = ["redact"];
const SIZED: AnnotationKind[] = [
	"rect",
	"ellipse",
	"arrow",
	"line",
	"pen",
	"highlighter",
	"counter",
	"redact",
];

function Group({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div role="group" aria-label={label} className="flex items-center gap-0.5">
			{children}
		</div>
	);
}

function ChoiceButton({
	label,
	selected,
	onClick,
	children,
}: {
	label: string;
	selected: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			aria-pressed={selected}
			onClick={onClick}
			className={`qs-tip-host flex h-7 min-w-7 items-center justify-center rounded-[7px] px-1 transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--qs-select)] ${
				selected
					? "bg-[var(--qs-active)] text-[var(--qs-text)]"
					: "text-[var(--qs-text-2)] hover:bg-[var(--qs-hover)] hover:text-[var(--qs-text)]"
			}`}
		>
			{children}
			<Tooltip label={label} />
		</button>
	);
}

const CUSTOM_COLOR_GRADIENT =
	"conic-gradient(from 180deg, #ff3b30, #ffcc00, #34c759, #0a84ff, #af52de, #ff3b30)";

function selectedRing(selected: boolean) {
	return selected
		? "0 0 0 2px var(--qs-swatch-gap), 0 0 0 3.5px var(--qs-ring)"
		: "inset 0 0 0 1px var(--qs-border-strong)";
}

/** The preset swatches followed by the system colour picker. */
function ColorChoices({
	color,
	onChange,
	onPicked,
}: {
	color: string;
	onChange: (color: string) => void;
	onPicked?: () => void;
}) {
	const isPresetColor = (ANNOTATION_COLORS as readonly string[]).includes(color.toUpperCase());
	return (
		<>
			{ANNOTATION_COLORS.map((preset) => {
				const selected = color.toUpperCase() === preset;
				return (
					<button
						key={preset}
						type="button"
						aria-label={`${t("style.color")} ${preset}`}
						aria-pressed={selected}
						onClick={() => {
							onChange(preset);
							onPicked?.();
						}}
						className="flex h-7 w-6 items-center justify-center rounded-[7px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--qs-select)]"
					>
						<span
							className="block h-[16px] w-[16px] rounded-full transition-transform duration-100"
							style={{
								background: preset,
								transform: selected ? "scale(1.12)" : undefined,
								boxShadow: selectedRing(selected),
							}}
						/>
					</button>
				);
			})}
			<label className="qs-tip-host relative flex h-7 w-6 cursor-default items-center justify-center rounded-[7px] focus-within:ring-2 focus-within:ring-[var(--qs-select)]">
				<span
					className="block h-[16px] w-[16px] rounded-full"
					style={{
						background: isPresetColor ? CUSTOM_COLOR_GRADIENT : color,
						boxShadow: selectedRing(!isPresetColor),
					}}
				/>
				<input
					type="color"
					value={color}
					onChange={(event) => onChange(event.target.value.toUpperCase())}
					className="absolute inset-0 cursor-default opacity-0"
					aria-label={t("style.customColor")}
				/>
				<Tooltip label={t("style.customColor")} />
			</label>
		</>
	);
}

/** One swatch showing the current colour; the full palette opens beneath it. */
function ColorMenu({ color, onChange }: { color: string; onChange: (color: string) => void }) {
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const handlePointerDown = (event: PointerEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			// Close the palette without also deselecting or closing the editor.
			event.stopPropagation();
			setOpen(false);
		};
		window.addEventListener("pointerdown", handlePointerDown, true);
		window.addEventListener("keydown", handleKeyDown, true);
		return () => {
			window.removeEventListener("pointerdown", handlePointerDown, true);
			window.removeEventListener("keydown", handleKeyDown, true);
		};
	}, [open]);

	return (
		<div ref={rootRef} className="relative flex items-center">
			<button
				type="button"
				aria-label={t("style.color")}
				aria-haspopup="true"
				aria-expanded={open}
				onClick={() => setOpen((value) => !value)}
				className={`qs-tip-host flex h-7 items-center gap-1 rounded-[7px] pl-1.5 pr-1 transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--qs-select)] ${
					open ? "bg-[var(--qs-active)]" : "hover:bg-[var(--qs-hover)]"
				}`}
			>
				<span
					className="block h-[16px] w-[16px] rounded-full"
					style={{ background: color, boxShadow: "inset 0 0 0 1px var(--qs-border-strong)" }}
				/>
				<ChevronDown size={12} strokeWidth={2} className="text-[var(--qs-text-3)]" />
				{!open && <Tooltip label={t("style.color")} />}
			</button>
			{open && (
				<div
					role="group"
					aria-label={t("style.color")}
					className="absolute left-1/2 top-[calc(100%+8px)] z-40 flex w-max -translate-x-1/2 items-center rounded-[12px] bg-[var(--qs-float)] p-1.5 shadow-[var(--qs-shadow-float)] backdrop-blur-xl"
					style={{ "--qs-swatch-gap": "var(--qs-panel-raised)" } as CSSProperties}
				>
					<ColorChoices color={color} onChange={onChange} onPicked={() => setOpen(false)} />
				</div>
			)}
		</div>
	);
}

export const ContextBar = memo(function ContextBar({
	kind,
	style,
	onChange,
	hasSelection,
	onDelete,
	onDuplicate,
	variant = "floating",
	compactColors = false,
	measureOnly = false,
}: ContextBarProps) {
	const duplicateKeys = useKeymap().duplicate;
	const showColor = !COLORLESS.includes(kind);
	const showSize = SIZED.includes(kind);
	const sizeLabels = [t("style.size.s"), t("style.size.m"), t("style.size.l")];
	const inline = variant === "inline";

	return (
		<div
			data-quickshot-context-bar={measureOnly ? undefined : variant}
			aria-hidden={measureOnly || undefined}
			className={
				inline
					? "qs-no-drag flex h-[38px] w-max shrink-0 items-center gap-1 rounded-[11px] bg-[var(--qs-field)] px-1 shadow-[inset_0_0_0_1px_var(--qs-border)]"
					: "qs-context-bar absolute left-1/2 top-3 z-20 flex h-10 -translate-x-1/2 items-center gap-1 rounded-[12px] bg-[var(--qs-float)] px-1.5 shadow-[var(--qs-shadow-float)] backdrop-blur-xl"
			}
			style={
				{
					"--qs-swatch-gap": inline ? "var(--qs-field-solid)" : "var(--qs-panel-raised)",
				} as CSSProperties
			}
			onPointerDown={(event) => event.stopPropagation()}
			onMouseDown={(event) => {
				// Keep focus in an active text field so restyling doesn't end the edit.
				if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
			}}
		>
			{showColor &&
				(compactColors ? (
					<ColorMenu color={style.color} onChange={(color) => onChange({ color })} />
				) : (
					<Group label={t("style.color")}>
						<ColorChoices color={style.color} onChange={(color) => onChange({ color })} />
					</Group>
				))}

			{kind === "redact" && (
				<Group label={t("style.redactMode")}>
					{(
						[
							["pixelate", t("style.redact.pixelate"), <PixelateIcon key="p" />],
							["blur", t("style.redact.blur"), <BlurIcon key="b" />],
						] as [RedactMode, string, ReactNode][]
					).map(([mode, label, icon]) => (
						<ChoiceButton
							key={mode}
							label={label}
							selected={style.redactMode === mode}
							onClick={() => onChange({ redactMode: mode })}
						>
							{icon}
						</ChoiceButton>
					))}
				</Group>
			)}

			{showSize && (
				<>
					{(showColor || kind === "redact") && <Divider />}
					<Group label={kind === "redact" ? t("style.strength") : t("style.size")}>
						{([0, 1, 2] as SizeIndex[]).map((index) => (
							<ChoiceButton
								key={index}
								label={sizeLabels[index]}
								selected={style.strokeSize === index}
								onClick={() => onChange({ strokeSize: index })}
							>
								<span
									className="block rounded-full bg-current"
									style={{ width: 4 + index * 3, height: 4 + index * 3 }}
								/>
							</ChoiceButton>
						))}
					</Group>
				</>
			)}

			{(kind === "rect" || kind === "ellipse") && (
				<>
					<Divider />
					<Group label={t("style.fill")}>
						{(
							[
								["none", t("style.fill.none"), <FillNoneIcon key="n" />],
								["soft", t("style.fill.soft"), <FillSoftIcon key="s" />],
								["solid", t("style.fill.solid"), <FillSolidIcon key="f" />],
							] as [ShapeFill, string, ReactNode][]
						).map(([fill, label, icon]) => (
							<ChoiceButton
								key={fill}
								label={label}
								selected={style.fill === fill}
								onClick={() => onChange({ fill })}
							>
								{icon}
							</ChoiceButton>
						))}
					</Group>
				</>
			)}

			{kind === "text" && (
				<>
					<Divider />
					<Group label={t("style.textSize")}>
						{([0, 1, 2, 3] as TextSizeIndex[]).map((index) => (
							<ChoiceButton
								key={index}
								label={`${t("style.textSize")} ${["S", "M", "L", "XL"][index]}`}
								selected={style.textSize === index}
								onClick={() => onChange({ textSize: index })}
							>
								<span className="font-semibold leading-none" style={{ fontSize: 10 + index * 2 }}>
									A
								</span>
							</ChoiceButton>
						))}
					</Group>
					<Divider />
					<Group label={t("style.textStyle")}>
						{(
							[
								["plain", t("style.text.plain"), <TextPlainIcon key="p" />],
								["pill", t("style.text.pill"), <TextPillIcon key="b" />],
								["outline", t("style.text.outline"), <TextOutlineIcon key="o" />],
							] as [TextStyle, string, ReactNode][]
						).map(([value, label, icon]) => (
							<ChoiceButton
								key={value}
								label={label}
								selected={style.textStyle === value}
								onClick={() => onChange({ textStyle: value })}
							>
								{icon}
							</ChoiceButton>
						))}
					</Group>
				</>
			)}

			{hasSelection && (
				<>
					<Divider />
					<IconButton
						size="sm"
						label={t("action.duplicate")}
						shortcut={duplicateKeys ? bindingLabel(duplicateKeys) : undefined}
						onClick={onDuplicate}
					>
						<DuplicateIcon size={14} strokeWidth={1.75} />
					</IconButton>
					<IconButton
						size="sm"
						label={t("action.delete")}
						shortcut="⌫"
						onClick={onDelete}
						className="hover:!text-[var(--qs-danger)]"
					>
						<Trash2 size={14} strokeWidth={1.75} />
					</IconButton>
				</>
			)}
		</div>
	);
});
