import { useSyncExternalStore } from "react";
import { type KeyPress, type ShortcutPlatform, keyFromCode } from "./accelerator";
import { PLATFORM } from "./platform";

/**
 * Shortcuts inside QuickShot's own windows: the editor's tools and commands,
 * and the overlay's switch to scrolling capture. A binding is "Mod+Shift+S"
 * style, where Mod is ⌘ on macOS and Ctrl elsewhere. Every window shares one
 * keymap through localStorage, so a change in Settings reaches open editors.
 */

export const KEYMAP_COMMANDS = [
	"tool.select",
	"tool.rect",
	"tool.ellipse",
	"tool.arrow",
	"tool.line",
	"tool.pen",
	"tool.highlighter",
	"tool.text",
	"tool.counter",
	"tool.redact",
	"copy",
	"copyAndClose",
	"quickSave",
	"saveAs",
	"stitch",
	"ocr",
	"smartRedact",
	"crop",
	"zoomIn",
	"zoomOut",
	"zoomActual",
	"zoomFit",
	"pin",
	"duplicate",
	"toggleInspector",
	"overlay.scroll",
] as const;

export type KeymapCommand = (typeof KEYMAP_COMMANDS)[number];
export type Keymap = Record<KeymapCommand, string>;

export const DEFAULT_KEYMAP: Keymap = {
	"tool.select": "V",
	"tool.rect": "R",
	"tool.ellipse": "O",
	"tool.arrow": "A",
	"tool.line": "L",
	"tool.pen": "P",
	"tool.highlighter": "H",
	"tool.text": "T",
	"tool.counter": "N",
	"tool.redact": "M",
	copy: "Mod+C",
	copyAndClose: "Mod+Enter",
	quickSave: "Mod+S",
	saveAs: "Mod+Shift+S",
	stitch: "Mod+Shift+A",
	ocr: "Mod+Shift+T",
	smartRedact: "Mod+Shift+M",
	crop: "C",
	zoomIn: "Mod+=",
	zoomOut: "Mod+-",
	zoomActual: "Mod+0",
	zoomFit: "Mod+9",
	pin: "Mod+Shift+P",
	duplicate: "Mod+D",
	toggleInspector: "Mod+.",
	"overlay.scroll": "S",
};

/** Keys that keep their meaning: undo, redo, close, paste, select all, editing and nudging. */
const RESERVED = new Set([
	"Mod+Z",
	"Mod+Shift+Z",
	"Mod+Y",
	"Mod+W",
	"Mod+V",
	"Mod+A",
	"Mod+Q",
	"Escape",
	"Enter",
	"Backspace",
	"Delete",
	"Tab",
	"Up",
	"Down",
	"Left",
	"Right",
	"Shift+Up",
	"Shift+Down",
	"Shift+Left",
	"Shift+Right",
	"[",
	"]",
]);

const MODIFIER_ORDER = ["Mod", "Alt", "Shift"] as const;

function normalizeKey(token: string): string | null {
	if (/^[a-z]$/i.test(token)) return token.toUpperCase();
	if (/^[0-9]$/.test(token)) return token;
	const functionKey = /^f([1-9]|1[0-9]|2[0-4])$/i.exec(token);
	if (functionKey) return `F${functionKey[1]}`;
	const named = ["Enter", "Space", "Tab", "Backspace", "Delete", "Escape", "Up", "Down", "Left", "Right"].find(
		(key) => key.toLowerCase() === token.toLowerCase(),
	);
	if (named) return named;
	return ["-", "=", "[", "]", "\\", ";", "'", ",", ".", "/", "`"].includes(token) ? token : null;
}

/** The canonical form of a binding ("Mod+Shift+S"), or null. */
export function normalizeBinding(value: unknown): string | null {
	if (typeof value !== "string" || value.length > 40) return null;
	const tokens = value.split("+").map((token) => token.trim());
	if (tokens.some((token) => !token)) return null;
	const key = normalizeKey(tokens[tokens.length - 1]);
	if (!key) return null;
	const modifiers = new Set<string>();
	for (const token of tokens.slice(0, -1)) {
		const modifier = MODIFIER_ORDER.find((name) => name.toLowerCase() === token.toLowerCase());
		if (!modifier || modifiers.has(modifier)) return null;
		modifiers.add(modifier);
	}
	return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), key].join("+");
}

/** The binding a key press makes, or null while only modifiers are down. */
export function bindingFromKeyPress(press: KeyPress, platform: ShortcutPlatform = PLATFORM): string | null {
	const mac = platform === "darwin";
	// The other platform key (⌃ on a Mac, Win elsewhere) is not part of bindings.
	if (mac ? press.ctrlKey : press.metaKey) return null;
	const code = press.code === "NumpadEnter" ? "Enter" : press.code;
	const key = code === "Enter" || code === "Escape" ? code : keyFromCode(code);
	if (!key) return null;
	const parts = [(mac ? press.metaKey : press.ctrlKey) ? "Mod" : null, press.altKey ? "Alt" : null, press.shiftKey ? "Shift" : null];
	return normalizeBinding([...parts.filter(Boolean), key].join("+"));
}

const MAC_LABELS: Record<string, string> = {
	Mod: "⌘",
	Alt: "⌥",
	Shift: "⇧",
	Enter: "↩",
	Escape: "Esc",
	Backspace: "⌫",
	Delete: "⌦",
	Tab: "⇥",
	Up: "↑",
	Down: "↓",
	Left: "←",
	Right: "→",
};

/** How a binding is shown: "⌘⇧S" on macOS, "Ctrl+Shift+S" elsewhere. */
export function bindingLabel(binding: string, platform: ShortcutPlatform = PLATFORM): string {
	const tokens = binding.split("+");
	if (platform === "darwin") return tokens.map((token) => MAC_LABELS[token] ?? token).join("");
	return tokens.map((token) => (token === "Mod" ? "Ctrl" : token)).join("+");
}

/** Why a binding cannot be used for `command`: a reserved key, or another command's. */
export function bindingConflict(
	keymap: Keymap,
	command: KeymapCommand,
	binding: string,
): { reason: "reserved" } | { reason: "taken"; by: KeymapCommand } | null {
	if (!binding) return null;
	if (RESERVED.has(binding)) return { reason: "reserved" };
	// The overlay and the editor never share a window, so only like with like clashes.
	const overlay = command.startsWith("overlay.");
	const by = KEYMAP_COMMANDS.find(
		(other) => other !== command && other.startsWith("overlay.") === overlay && keymap[other] === binding,
	);
	return by ? { reason: "taken", by } : null;
}

/**
 * The keymap from stored changes: "" leaves a command without a shortcut.
 * When two commands end up with one binding, a changed one beats a default
 * (which is then left empty), and of two changed ones the first keeps it.
 */
export function normalizeKeymap(value: unknown): Keymap {
	const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
	const keymap = { ...DEFAULT_KEYMAP };
	const changed = new Set<KeymapCommand>();
	for (const command of KEYMAP_COMMANDS) {
		if (input[command] === "") {
			keymap[command] = "";
			changed.add(command);
			continue;
		}
		const binding = normalizeBinding(input[command]);
		if (binding && !RESERVED.has(binding)) {
			keymap[command] = binding;
			changed.add(command);
		}
	}
	for (const command of KEYMAP_COMMANDS) {
		const clash = bindingConflict(keymap, command, keymap[command]);
		if (clash?.reason !== "taken") continue;
		if (!changed.has(command)) keymap[command] = "";
		else keymap[clash.by] = "";
	}
	return keymap;
}

/** The command a key press triggers, if any. */
export function commandFor(keymap: Keymap, press: KeyPress, scope: "editor" | "overlay"): KeymapCommand | null {
	const binding = bindingFromKeyPress(press);
	if (!binding) return null;
	return (
		KEYMAP_COMMANDS.find(
			(command) => command.startsWith("overlay.") === (scope === "overlay") && keymap[command] === binding,
		) ?? null
	);
}

// ── The shared store ─────────────────────────────────────────────────────────

const STORAGE_KEY = "quickshot.keymap.v1";
let current: Keymap | null = null;
const listeners = new Set<() => void>();

function read(): Keymap {
	try {
		return normalizeKeymap(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}"));
	} catch {
		return { ...DEFAULT_KEYMAP };
	}
}

export function getKeymap(): Keymap {
	current ??= read();
	return current;
}

export function saveKeymap(keymap: Keymap) {
	current = normalizeKeymap(keymap);
	const custom = Object.fromEntries(KEYMAP_COMMANDS.filter((command) => current?.[command] !== DEFAULT_KEYMAP[command]).map((command) => [command, current?.[command]]));
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(custom));
	} catch {}
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	// Other windows' changes arrive as storage events.
	const onStorage = (event: StorageEvent) => {
		if (event.key !== STORAGE_KEY && event.key !== null) return;
		current = read();
		listener();
	};
	window.addEventListener("storage", onStorage);
	return () => {
		listeners.delete(listener);
		window.removeEventListener("storage", onStorage);
	};
}

/** The keymap, kept current across windows. */
export function useKeymap(): Keymap {
	return useSyncExternalStore(subscribe, getKeymap, getKeymap);
}

/** A binding's label for tooltips, or "" when the command has none. */
export function useBindingLabel(command: KeymapCommand): string {
	const binding = useKeymap()[command];
	return binding ? bindingLabel(binding) : "";
}
