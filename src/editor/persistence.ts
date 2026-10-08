import { readStoredJson, readStoredString, writeStoredJson } from "@/lib/storage";
import {
	DEFAULT_STYLE_SETTINGS,
	type StyleSettings,
	normalizeStyleSettings,
} from "./composition";
import { type ToolStyle, TOOL_ORDER, normalizeToolStyle } from "./presets";
import { type StitchSettings, normalizeStitchSettings } from "./stitch";
import type { Tool } from "./types";

const STYLE_KEY = "quickshot.style.v2";
const DEFAULT_STYLE_KEY = "quickshot.style-default.v1";
const STITCH_KEY = "quickshot.stitch.v1";
const TOOL_STYLE_KEY = "quickshot.tool-style.v1";
const TOOL_KEY = "quickshot.tool.v1";
const INSPECTOR_KEY = "quickshot.inspector-open.v1";

/** Carries the signature settings over from the first editor generation. */
function readLegacyStyle(): Partial<StyleSettings> {
	const legacyChrome = readStoredString("quickshot.chrome-style");
	const legacyOpacity = Number(readStoredString("quickshot.watermark-opacity"));
	return {
		frame: legacyChrome === "borderless" ? "none" : DEFAULT_STYLE_SETTINGS.frame,
		watermark: {
			...DEFAULT_STYLE_SETTINGS.watermark,
			enabled: readStoredString("quickshot.watermark-enabled") === "1",
			placement: DEFAULT_STYLE_SETTINGS.watermark.placement,
			text: readStoredString("quickshot.watermark-text") ?? "",
			color: readStoredString("quickshot.watermark-color") ?? "auto",
			opacity: Number.isFinite(legacyOpacity) && legacyOpacity > 0
				? legacyOpacity
				: DEFAULT_STYLE_SETTINGS.watermark.opacity,
		},
	};
}

export function loadStyleSettings(): StyleSettings {
	const stored = readStoredJson(STYLE_KEY);
	if (stored && typeof stored === "object") return normalizeStyleSettings(stored);
	return normalizeStyleSettings({ ...DEFAULT_STYLE_SETTINGS, ...readLegacyStyle() });
}

export function saveStyleSettings(settings: StyleSettings) {
	writeStoredJson(STYLE_KEY, settings);
}

/** The style the user chose with "Set as Default", if any. */
export function loadSavedDefaultStyle(): StyleSettings | null {
	const stored = readStoredJson(DEFAULT_STYLE_KEY);
	return stored && typeof stored === "object" ? normalizeStyleSettings(stored) : null;
}

export function saveDefaultStyle(settings: StyleSettings) {
	writeStoredJson(DEFAULT_STYLE_KEY, settings);
}

/** The last stitch arrangement, gap and alignment. */
export function loadStitchSettings(): StitchSettings {
	return normalizeStitchSettings(readStoredJson(STITCH_KEY));
}

export function saveStitchSettings(settings: StitchSettings) {
	writeStoredJson(STITCH_KEY, settings);
}

export function loadToolStyle(): ToolStyle {
	return normalizeToolStyle(readStoredJson(TOOL_STYLE_KEY));
}

export function saveToolStyle(style: ToolStyle) {
	writeStoredJson(TOOL_STYLE_KEY, style);
}

export function loadTool(): Tool {
	const stored = readStoredJson(TOOL_KEY);
	return TOOL_ORDER.includes(stored as Tool) ? (stored as Tool) : "arrow";
}

export function saveTool(tool: Tool) {
	writeStoredJson(TOOL_KEY, tool);
}

export function loadInspectorOpen(): boolean {
	const stored = readStoredJson(INSPECTOR_KEY);
	return typeof stored === "boolean" ? stored : true;
}

export function saveInspectorOpen(open: boolean) {
	writeStoredJson(INSPECTOR_KEY, open);
}
