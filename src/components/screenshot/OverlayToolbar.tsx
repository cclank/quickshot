import { Check, Copy, Download, Redo2, Undo2, X } from "lucide-react";
import { type CSSProperties, memo } from "react";
import type { AnnotationKind, Tool } from "@/editor/types";
import { TOOL_ORDER, type ToolStyle } from "@/editor/presets";
import { TOOL_ICONS } from "@/components/editor/icons";
import { ContextBar } from "@/components/editor/ContextBar";
import { Divider, IconButton, Tooltip } from "@/components/editor/ui";
import { t } from "@/lib/i18n";
import { type KeymapCommand, bindingLabel, useKeymap } from "@/lib/keymap";

/**
 * The capture overlay's editing bar. It floats over the frozen screenshot at
 * the bottom of the screen, so it carries its own dark palette instead of the
 * editor's theme variables: the ten tools, the current tool's style controls,
 * undo and redo, and the capture actions.
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

export type OverlayToolbarProps = {
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
	onSave: () => void;
	onConfirm: () => void;
};

export const OverlayToolbar = memo(function OverlayToolbar({
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
	onSave,
	onConfirm,
}: OverlayToolbarProps) {
	const keymap = useKeymap();
	const keys = (command: KeymapCommand) =>
		keymap[command] ? bindingLabel(keymap[command]) : undefined;

	return (
		<div
			role="toolbar"
			aria-label={t("overlay.editingBar")}
			className="pointer-events-auto absolute bottom-5 left-1/2 flex max-w-[calc(100vw-32px)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-[14px] border border-white/12 bg-[rgba(16,18,23,0.88)] p-1.5 text-white shadow-[0_16px_44px_rgba(0,0,0,0.46)] backdrop-blur-xl"
			style={DARK_VARS}
			onPointerDown={(event) => event.stopPropagation()}
			onDoubleClick={(event) => event.stopPropagation()}
		>
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

			<div
				role="group"
				aria-label={t("toolbar.tools")}
				className="flex w-max shrink-0 items-center gap-0.5 rounded-[11px] bg-[var(--qs-field)] p-[3px] shadow-[inset_0_0_0_1px_var(--qs-border)]"
			>
				{TOOL_ORDER.map((value) => {
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

			{contextKind && (
				<>
					<Divider />
					<div className="qs-no-drag flex shrink-0 items-center">
						<ContextBar
							kind={contextKind}
							style={style}
							onChange={onStyleChange}
							hasSelection={hasSelection}
							onDelete={onDelete}
							onDuplicate={onDuplicate}
							variant="inline"
						/>
					</div>
				</>
			)}

			<Divider />

			<div className="flex shrink-0 items-center gap-0.5">
				<IconButton
					label={t("region.cancel")}
					shortcut="Esc"
					onClick={onCancel}
					disabled={busy}
				>
					<X size={16} strokeWidth={1.9} />
				</IconButton>
				{!scrollMode && (
					<IconButton
						label={t("region.copy")}
						onClick={onCopy}
						disabled={busy}
					>
						<Copy size={15} strokeWidth={1.9} />
					</IconButton>
				)}
				<IconButton
					label={t("action.quickSave")}
					onClick={onSave}
					disabled={busy}
				>
					<Download size={16} strokeWidth={1.9} />
				</IconButton>
				<button
					type="button"
					onClick={onConfirm}
					disabled={busy}
					title={scrollMode ? t("region.startScroll") : t("region.confirm")}
					className="qs-tip-host ml-1 flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] bg-[var(--qs-primary)] px-3 text-[12.5px] font-semibold text-[var(--qs-primary-text)] transition-[background-color] duration-100 hover:bg-[var(--qs-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--qs-select)] disabled:opacity-40"
				>
					<Check size={15} strokeWidth={2.2} />
					{scrollMode ? t("region.startScroll") : t("region.confirm")}
					<Tooltip label={scrollMode ? t("region.startScroll") : t("region.confirm")} />
				</button>
			</div>
		</div>
	);
});