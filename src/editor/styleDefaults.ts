import { DEFAULT_STYLE_SETTINGS, type StyleSettings, normalizeStyleSettings } from "./composition";

export type StyleDefaults = {
	/** False when the current style already is the default. */
	canSave: boolean;
	/** What the reset button returns to, or null when there is nothing to reset. */
	restoreTarget: "default" | "builtIn" | null;
	restoreTo: StyleSettings | null;
};

export function sameStyle(a: StyleSettings, b: StyleSettings) {
	return JSON.stringify(normalizeStyleSettings(a)) === JSON.stringify(normalizeStyleSettings(b));
}

/** QuickShot's own style, keeping the signature text the user typed. */
export function builtInStyle(current: StyleSettings): StyleSettings {
	return normalizeStyleSettings({
		...DEFAULT_STYLE_SETTINGS,
		watermark: { ...DEFAULT_STYLE_SETTINGS.watermark, text: current.watermark.text },
	});
}

/**
 * The saved default (or the built-in style when none was saved) is where
 * "reset" goes; once the style already matches a saved default, reset offers
 * the built-in style instead.
 */
export function resolveStyleDefaults(
	current: StyleSettings,
	saved: StyleSettings | null,
): StyleDefaults {
	const builtIn = builtInStyle(current);
	const anchor = saved ?? builtIn;
	if (!sameStyle(current, anchor)) {
		return { canSave: true, restoreTarget: "default", restoreTo: normalizeStyleSettings(anchor) };
	}
	if (saved && !sameStyle(current, builtIn)) {
		return { canSave: false, restoreTarget: "builtIn", restoreTo: builtIn };
	}
	return { canSave: false, restoreTarget: null, restoreTo: null };
}
