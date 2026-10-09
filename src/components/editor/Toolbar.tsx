import {
	Copy,
	Download,
	FolderDown,
	ImagePlus,
	Minus,
	PanelRightClose,
	PanelRightOpen,
	Pin,
	Redo2,
	ScanText,
	Undo2,
	X,
} from "lucide-react";
import { memo, type ReactNode, useLayoutEffect, useRef } from "react";
import { TOOL_ORDER } from "@/editor/presets";
import type { Tool } from "@/editor/types";
import { t } from "@/lib/i18n";
import { type KeymapCommand, bindingLabel, useKeymap } from "@/lib/keymap";
import { IS_MAC, IS_WINDOWS, PLATFORM, SUPPORTS_OCR, formatShortcut } from "@/lib/platform";
import { TOOL_ICONS } from "./icons";
import { Divider, IconButton, Tooltip } from "./ui";

type ToolbarProps = {
	tool: Tool;
	onToolChange: (tool: Tool) => void;
	canUndo: boolean;
	canRedo: boolean;
	onUndo: () => void;
	onRedo: () => void;
	ready: boolean;
	onCopy: () => void;
	onQuickSave: () => void;
	onSaveAs: () => void;
	onPin: () => void;
	ocrOpen: boolean;
	onToggleOcr: () => void;
	inspectorOpen: boolean;
	onToggleInspector: () => void;
	/** Takes another capture and stitches it onto this one. */
	onStitch: () => void;
	/** The current tool's style controls, shown next to the tools when they fit. */
	styleBar: ReactNode;
	/** Invisible copies of the widest style bar, full and with folded colours. */
	styleBarProbes: { full: ReactNode; compact: ReactNode };
	onStyleBarModeChange: (mode: StyleBarMode) => void;
};

/**
 * Where the style controls go: in the title bar with every swatch, in the
 * title bar with the colours folded into a menu, or floating over the canvas.
 */
export type StyleBarMode = "full" | "compact" | "floating";

/** Tailwind gap-2 between the title bar groups. */
const GROUP_GAP = 8;

export const Toolbar = memo(function Toolbar({
	tool,
	onToolChange,
	canUndo,
	canRedo,
	onUndo,
	onRedo,
	ready,
	onCopy,
	onQuickSave,
	onSaveAs,
	onPin,
	ocrOpen,
	onToggleOcr,
	inspectorOpen,
	onToggleInspector,
	onStitch,
	styleBar,
	styleBarProbes,
	onStyleBarModeChange,
}: ToolbarProps) {
	const keymap = useKeymap();
	const keys = (command: KeymapCommand) => (keymap[command] ? bindingLabel(keymap[command]) : undefined);
	const headerRef = useRef<HTMLElement>(null);
	const leadingRef = useRef<HTMLDivElement>(null);
	const toolsRef = useRef<HTMLDivElement>(null);
	const trailingRef = useRef<HTMLDivElement>(null);
	const fullProbeRef = useRef<HTMLDivElement>(null);
	const compactProbeRef = useRef<HTMLDivElement>(null);
	const onModeChangeRef = useRef(onStyleBarModeChange);
	onModeChangeRef.current = onStyleBarModeChange;

	// The decision uses the widest style bar (text with a selection) so the
	// controls stay put when switching tools, and depends only on the window width.
	useLayoutEffect(() => {
		const elements = [
			headerRef.current,
			leadingRef.current,
			toolsRef.current,
			trailingRef.current,
			fullProbeRef.current,
			compactProbeRef.current,
		];
		if (elements.some((element) => !element)) return;
		const [header, leading, tools, trailing, fullProbe, compactProbe] = elements as HTMLElement[];
		const update = () => {
			const computed = getComputedStyle(header);
			const content =
				header.clientWidth -
				(Number.parseFloat(computed.paddingLeft) || 0) -
				(Number.parseFloat(computed.paddingRight) || 0);
			const available =
				content - leading.offsetWidth - tools.offsetWidth - trailing.offsetWidth - GROUP_GAP * 3;
			onModeChangeRef.current(
				available >= fullProbe.offsetWidth
					? "full"
					: available >= compactProbe.offsetWidth
						? "compact"
						: "floating",
			);
		};
		update();
		const observer = new ResizeObserver(update);
		for (const element of elements) observer.observe(element as Element);
		return () => observer.disconnect();
	}, []);

	return (
		<header
			ref={headerRef}
			data-quickshot-toolbar
			className="qs-drag relative z-30 flex h-[52px] shrink-0 items-center gap-2 border-b border-[var(--qs-border)] bg-[var(--qs-bg)] px-3"
			style={{
				// Window Controls Overlay reports the space left of the caption buttons.
				paddingRight: IS_WINDOWS
					? "calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, calc(100vw - 140px)) + 12px)"
					: undefined,
			}}
		>
			<div ref={leadingRef} className="flex w-max shrink-0 items-center gap-0.5">
				{IS_MAC && <div className="w-[70px] shrink-0" aria-hidden="true" />}
				<IconButton
					label={t("action.undo")}
					shortcut={formatShortcut("mod+z")}
					onClick={onUndo}
					disabled={!canUndo}
				>
					<Undo2 size={16} strokeWidth={1.75} />
				</IconButton>
				<IconButton
					label={t("action.redo")}
					shortcut={formatShortcut("mod+shift+z")}
					onClick={onRedo}
					disabled={!canRedo}
				>
					<Redo2 size={16} strokeWidth={1.75} />
				</IconButton>
			</div>

			<div
				ref={toolsRef}
				role="toolbar"
				aria-label={t("toolbar.tools")}
				className="qs-no-drag flex w-max shrink-0 items-center gap-0.5 rounded-[11px] bg-[var(--qs-field)] p-[3px] shadow-[inset_0_0_0_1px_var(--qs-border)]"
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

			{styleBar}

			<div
				aria-hidden="true"
				className="pointer-events-none invisible absolute left-0 top-0 flex flex-col"
			>
				<div ref={fullProbeRef} className="w-max">
					{styleBarProbes.full}
				</div>
				<div ref={compactProbeRef} className="w-max">
					{styleBarProbes.compact}
				</div>
			</div>

			<div ref={trailingRef} className="ml-auto flex w-max shrink-0 items-center gap-0.5">
				<IconButton
					data-quickshot-action="stitch"
					label={t("action.stitch")}
					shortcut={keys("stitch")}
					onClick={onStitch}
					disabled={!ready}
				>
					<ImagePlus size={16} strokeWidth={1.75} />
				</IconButton>
				{SUPPORTS_OCR && (
					<IconButton
						label={t("action.ocr")}
						shortcut={keys("ocr")}
						active={ocrOpen}
						aria-expanded={ocrOpen}
						aria-controls="text-extraction-panel"
						onClick={onToggleOcr}
						disabled={!ready}
					>
						<ScanText size={16} strokeWidth={1.75} />
					</IconButton>
				)}
				<IconButton
					label={t("action.pin")}
					shortcut={keys("pin")}
					onClick={onPin}
					disabled={!ready}
				>
					<Pin size={16} strokeWidth={1.75} />
				</IconButton>
				<Divider />
				<IconButton
					label={t("action.saveAs")}
					shortcut={keys("saveAs")}
					onClick={onSaveAs}
					disabled={!ready}
				>
					<FolderDown size={16} strokeWidth={1.75} />
				</IconButton>
				<IconButton
					data-quickshot-action="quick-save"
					label={t("action.quickSave")}
					shortcut={keys("quickSave")}
					onClick={onQuickSave}
					disabled={!ready}
				>
					<Download size={16} strokeWidth={1.75} />
				</IconButton>
				<button
					type="button"
					onClick={onCopy}
					disabled={!ready}
					className="qs-tip-host qs-no-drag ml-1.5 flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] bg-[var(--qs-primary)] px-3 text-[12.5px] font-semibold text-[var(--qs-primary-text)] shadow-[0_1px_2px_rgba(0,0,0,0.16)] transition-[background-color,box-shadow] duration-100 hover:bg-[var(--qs-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--qs-select)] disabled:opacity-40"
				>
					<Copy size={15} strokeWidth={2} />
					{t("action.copy")}
					<Tooltip label={t("action.copyImage")} shortcut={keys("copy")} />
				</button>
				<Divider />
				<IconButton
					label={inspectorOpen ? t("action.inspectorHide") : t("action.inspectorShow")}
					shortcut={keys("toggleInspector")}
					active={inspectorOpen}
					onClick={onToggleInspector}
				>
					{inspectorOpen ? (
						<PanelRightClose size={16} strokeWidth={1.75} />
					) : (
						<PanelRightOpen size={16} strokeWidth={1.75} />
					)}
				</IconButton>
				{PLATFORM === "linux" && (
					<>
						<IconButton label={t("action.minimize")} onClick={() => window.electronAPI?.minimizeWindow?.()}>
							<Minus size={16} strokeWidth={1.75} />
						</IconButton>
						<IconButton label={t("action.close")} onClick={() => window.close()}>
							<X size={16} strokeWidth={1.75} />
						</IconButton>
					</>
				)}
			</div>
		</header>
	);
});
