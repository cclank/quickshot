export type Platform = "darwin" | "win32" | "linux";

function detectPlatform(): Platform {
	const reported =
		typeof window !== "undefined" ? window.electronAPI?.platform : undefined;
	if (reported === "darwin" || reported === "win32" || reported === "linux") {
		return reported;
	}
	const agent = typeof navigator !== "undefined" ? navigator.userAgent : "";
	if (agent.includes("Mac")) return "darwin";
	if (agent.includes("Windows")) return "win32";
	return "linux";
}

export const PLATFORM = detectPlatform();
export const IS_MAC = PLATFORM === "darwin";
export const IS_WINDOWS = PLATFORM === "win32";
/** Text extraction uses Vision on macOS and Windows.Media.Ocr on Windows. */
export const SUPPORTS_OCR = IS_MAC || IS_WINDOWS;
export const MOD_KEY_LABEL = IS_MAC ? "⌘" : "Ctrl";
export const SHIFT_KEY_LABEL = IS_MAC ? "⇧" : "Shift";

/** Formats a shortcut like `mod+shift+c` for tooltips. */
export function formatShortcut(shortcut: string) {
	const parts = shortcut.split("+").map((part) => {
		switch (part) {
			case "mod":
				return MOD_KEY_LABEL;
			case "shift":
				return SHIFT_KEY_LABEL;
			case "alt":
				return IS_MAC ? "⌥" : "Alt";
			case "enter":
				return IS_MAC ? "↩" : "Enter";
			case "esc":
				return "Esc";
			default:
				return part.toUpperCase();
		}
	});
	return IS_MAC ? parts.join("") : parts.join("+");
}

export function isModKey(event: { metaKey: boolean; ctrlKey: boolean }) {
	return IS_MAC ? event.metaKey : event.ctrlKey;
}
