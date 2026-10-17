import { Copy, Download, Redo2, ScanText, Undo2, X } from "lucide-react";
import { type CSSProperties, memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AnnotationKind, Tool } from "@/editor/types";
import { CAPTURE_TOOL_ORDER, type ToolStyle } from "@/editor/presets";
import { TOOL_ICONS } from "@/components/editor/icons";
import { ContextBar } from "@/components/editor/ContextBar";
import { Divider, IconButton, Tooltip } from "@/components/editor/ui";
import { t } from "@/lib/i18n";
import { type KeymapCommand, bindingLabel, useKeymap } from "@/lib/keymap";
import { SUPPORTS_OCR } from "@/lib/platform";
import { getFloatingToolbarPosition, type SelectionRect } from "@/lib/selectionGeometry";

/**
 * The capture overlay's editing bar. It floats over the frozen screenshot at
 * beside the current selection, so it carries its own dark palette instead of the
 * editor's theme variables. The primary row stays stable while the selected
 * tool's style controls occupy a separate, optional row beneath it.
 */

const DARK_VARS = {
	"--qs-bg": "rgba(20, 22, 27, 0.92)",
	"--qs-panel": "rgba(20, 22, 27, 0.92)",
	"--qs-panel-raised": "rgba(255, 255, 255, 0.14)",
	"--qs-float": "rgba(20, 22, 27, 0.94)",
	"--qs-field": "rgba(255, 255, 255, 0.08)",
	"--qs-field-solid": "rgba(44, 47, 54, 0.96)",
	"--qs-hover": "rgba(255, 255, 255, 0.12)",
	"--qs-active": "rgba(255, 255, 255, 0.18)",
	"--qs-border": "rgba(255, 255, 255, 0.1)",
	"--qs-border-strong": "rgba(255, 255, 255, 0.16)",
	"--qs-text": "rgba(255, 255, 255, 0.94)",
	"--qs-text-2": "rgba(255, 255, 255, 0.72)",
	"--qs-text-3": "rgba(255, 255, 255, 0.5)",
	"--qs-select": "#4dabf7",
	"--qs-ring": "rgba(255, 255, 255, 0.9)",
	"--qs-primary": "rgba(255, 255, 255, 0.92)",
	"--qs-primary-text": "#16181d",
	"--qs-primary-hover": "#ffffff",
	"--qs-danger": "#ff6b6b",
	"--qs-shadow-float": "0 12px 34px rgba(0, 0, 0, 0.42), 0 0 0 0.5px rgba(255, 255, 255, 0.1)",
} as CSSProperties;

const EditIcon = TOOL_ICONS.select;

export type OverlayToolbarProps = {
	selection: SelectionRect;
	tool: Tool;
	onToolChange: (tool: Tool) => void;
	style: ToolStyle;
	onStyleChange: (patch: Partial<ToolStyle>) => void;
	/** The annotation kind whose style controls to show, or null for none. */
	contextKind: AnnotationKind | null;
	hasSelection: boolean;
	onDelete: () => void;
	onDuplicate: () => void;
	canUndo: boolean;
	canRedo: boolean;
	onUndo: () => void;
	onRedo: () => void;
	busy: boolean;
	scrollMode: boolean;
	onCancel: () => void;
	onCopy: () => void;
	onOcr: () => void;
	onSave: () => void;
	onConfirm: () => void;
};

export const OverlayToolbar = memo(function OverlayToolbar({
	selection,
	tool,
	onToolChange,
	style,
	onStyleChange,
	contextKind,
	hasSelection,
	onDelete,
	onDuplicate,
	canUndo,
	canRedo,
	onUndo,
	onRedo,
	busy,
	scrollMode,
	onCancel,
	onCopy,
	onOcr,
	onSave,
	onConfirm,
}: OverlayToolbarProps) {
	const keymap = useKeymap();
	const toolbarRef = useRef<HTMLDivElement>(null);
	const [layout, setLayout] = useState(() => ({
		toolbar: { width: Math.min(920, Math.max(0, window.innerWidth - 32)), height: 52 },
		viewport: { width: window.innerWidth, height: window.innerHeight },
	}));
	useLayoutEffect(() => {
		const toolbar = toolbarRef.current;
		if (!toolbar) return;
		const update = () => {
			const rect = toolbar.getBoundingClientRect();
			const next = {
				toolbar: { width: rect.width, height: rect.height },
				viewport: { width: window.innerWidth, height: window.innerHeight },
			};
			setLayout((current) =>
				current.toolbar.width === next.toolbar.width &&
				current.toolbar.height === next.toolbar.height &&
				current.viewport.width === next.viewport.width &&
				current.viewport.height === next.viewport.height
					? current
					: next,
			);
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(toolbar);
		window.addEventListener("resize", update);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", update);
		};
	}, []);
	const position = useMemo(
		() => getFloatingToolbarPosition(selection, layout.toolbar, layout.viewport),
		[layout, selection],
	);
	const keys = (command: KeymapCommand) =>
		keymap[command] ? bindingLabel(keymap[command]) : undefined;

	return (
		<div
			ref={toolbarRef}
			role="toolbar"
			aria-label={t("overlay.editingBar")}
			data-placement={position.placement}
			data-quickshot-overlay-toolbar="true"
			className="pointer-events-auto absolute grid max-w-[calc(100vw-32px)] -translate-x-1/2 justify-center gap-1 rounded-[14px] border border-white/12 bg-[rgba(16,18,23,0.88)] p-1.5 text-white shadow-[0_16px_44px_rgba(0,0,0,0.46)] backdrop-blur-xl"
			style={{ ...DARK_VARS, left: position.left, top: position.top }}
			onPointerDown={(event) => event.stopPropagation()}
			onDoubleClick={(event) => event.stopPropagation()}
		>
			<div className="flex w-max shrink-0 items-center gap-0.5">
				<IconButton
					label={t("region.cancel")}
					shortcut="Esc"
					onClick={onCancel}
					disabled={busy}
				>
					<X size={16} strokeWidth={1.9} />
				</IconButton>
				<Divider />

				<div
					role="group"
					aria-label={t("toolbar.tools")}
					className="flex w-max shrink-0 items-center gap-0.5 rounded-[11px] bg-[var(--qs-field)] p-[3px] shadow-[inset_0_0_0_1px_var(--qs-border)]"
				>
					{CAPTURE_TOOL_ORDER.map((value) => {
						const Icon = TOOL_ICONS[value];
						return (
							<IconButton
								key={value}
								label={t(`tool.${value}`)}
								shortcut={keys(`tool.${value}` as KeymapCommand)}
								active={tool === value}
								aria-pressed={tool === value}
								onClick={() => onToolChange(value)}
							>
								<Icon size={16} strokeWidth={1.75} />
							</IconButton>
						);
					})}
				</div>

				<Divider />

				<div className="flex shrink-0 items-center gap-0.5">
					<IconButton
						label={t("action.undo")}
						shortcut={bindingLabel("Mod+Z")}
						onClick={onUndo}
						disabled={!canUndo}
					>
						<Undo2 size={16} strokeWidth={1.75} />
					</IconButton>
					<IconButton
						label={t("action.redo")}
						shortcut={bindingLabel("Mod+Shift+Z")}
						onClick={onRedo}
						disabled={!canRedo}
					>
						<Redo2 size={16} strokeWidth={1.75} />
					</IconButton>
				</div>

				<Divider />

				<div className="flex shrink-0 items-center gap-0.5">
					<button
						type="button"
						onClick={onConfirm}
						disabled={busy}
						className={`qs-tip-host flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] px-2.5 text-[12.5px] font-semibold transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--qs-select)] disabled:opacity-40 ${
							scrollMode
								? "bg-[var(--qs-primary)] text-[var(--qs-primary-text)] hover:bg-[var(--qs-primary-hover)]"
								: "text-[var(--qs-text-2)] hover:bg-[var(--qs-hover)] hover:text-[var(--qs-text)]"
						}`}
					>
						<EditIcon size={15} strokeWidth={1.9} />
						<span>{scrollMode ? t("region.startScroll") : t("region.confirm")}</span>
						<Tooltip
							label={scrollMode ? t("region.startScroll") : t("region.confirmHint")}
							shortcut="Enter"
						/>
					</button>
					{SUPPORTS_OCR && !scrollMode && (
						<IconButton
							label={t("action.ocr")}
							onClick={onOcr}
							disabled={busy}
						>
							<ScanText size={16} strokeWidth={1.75} />
						</IconButton>
					)}
					<IconButton
						label={t("action.quickSave")}
						shortcut={keys("quickSave")}
						onClick={onSave}
						disabled={busy}
					>
						<Download size={16} strokeWidth={1.9} />
					</IconButton>
					{!scrollMode && (
						<button
							type="button"
							onClick={onCopy}
							disabled={busy}
							className="qs-tip-host ml-1 flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] bg-[var(--qs-primary)] px-3 text-[12.5px] font-semibold text-[var(--qs-primary-text)] transition-[background-color] duration-100 hover:bg-[var(--qs-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--qs-select)] disabled:opacity-40"
						>
							<Copy size={15} strokeWidth={1.9} />
							<span>{t("region.copy")}</span>
							<Tooltip label={t("region.copy")} shortcut={keys("copy")} />
						</button>
					)}
				</div>
			</div>

			{contextKind && (
				<div className="qs-no-drag flex max-w-full shrink-0 items-center">
					<ContextBar
						kind={contextKind}
						style={style}
						onChange={onStyleChange}
						hasSelection={hasSelection}
						onDelete={onDelete}
						onDuplicate={onDuplicate}
						variant="inline"
						compactColors
					/>
				</div>
			)}
		</div>
	);
});
