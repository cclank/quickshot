/**
 * Global shortcuts as Electron accelerators ("Command+Shift+X"): checking
 * them, showing them ("⌘⇧X", "Ctrl+Shift+X") and turning a key press into
 * one. Shared by the main process and the settings window, so it uses
 * neither Node.js nor the DOM.
 */

export type ShortcutPlatform = "darwin" | "win32" | "linux";

/** The capture shortcut QuickShot starts with. */
export const DEFAULT_CAPTURE_ACCELERATOR = "CommandOrControl+Shift+X";
/** Gives pinned screenshots their mouse back after click-through. */
export const DEFAULT_RESTORE_PINS_ACCELERATOR = "CommandOrControl+Shift+L";

const MODIFIERS = ["CommandOrControl", "Command", "Control", "Alt", "Shift", "Super"] as const;
type Modifier = (typeof MODIFIERS)[number];

const MODIFIER_NAMES: Record<string, Modifier> = {
	commandorcontrol: "CommandOrControl",
	cmdorctrl: "CommandOrControl",
	command: "Command",
	cmd: "Command",
	control: "Control",
	ctrl: "Control",
	alt: "Alt",
	option: "Alt",
	shift: "Shift",
	super: "Super",
	meta: "Super",
};

const NAMED_KEYS = [
	"Space",
	"Tab",
	"Backspace",
	"Delete",
	"Insert",
	"Home",
	"End",
	"PageUp",
	"PageDown",
	"Up",
	"Down",
	"Left",
	"Right",
] as const;

const PUNCTUATION = ["-", "=", "[", "]", "\\", ";", "'", ",", ".", "/", "`"];

/** KeyboardEvent.code → accelerator key, independent of the keyboard layout. */
const CODE_KEYS: Record<string, string> = {
	Space: "Space",
	Tab: "Tab",
	Backspace: "Backspace",
	Delete: "Delete",
	Insert: "Insert",
	Home: "Home",
	End: "End",
	PageUp: "PageUp",
	PageDown: "PageDown",
	ArrowUp: "Up",
	ArrowDown: "Down",
	ArrowLeft: "Left",
	ArrowRight: "Right",
	Minus: "-",
	Equal: "=",
	BracketLeft: "[",
	BracketRight: "]",
	Backslash: "\\",
	Semicolon: ";",
	Quote: "'",
	Comma: ",",
	Period: ".",
	Slash: "/",
	Backquote: "`",
};

function normalizeKey(token: string): string | null {
	if (/^[a-z]$/i.test(token)) return token.toUpperCase();
	if (/^[0-9]$/.test(token)) return token;
	const functionKey = /^f([1-9]|1[0-9]|2[0-4])$/i.exec(token);
	if (functionKey) return `F${functionKey[1]}`;
	const named = NAMED_KEYS.find((key) => key.toLowerCase() === token.toLowerCase());
	if (named) return named;
	return PUNCTUATION.includes(token) ? token : null;
}

/**
 * The canonical form of an accelerator QuickShot accepts as a global
 * shortcut, or null. A shortcut needs ⌘, ⌃ or ⌥ (Ctrl, Alt or Win) unless it
 * is a function key, so it never takes over ordinary typing.
 */
export function normalizeAccelerator(value: unknown): string | null {
	if (typeof value !== "string" || value.length > 64) return null;
	const tokens = value.split("+").map((token) => token.trim());
	if (tokens.some((token) => !token)) return null;
	const key = normalizeKey(tokens[tokens.length - 1]);
	if (!key) return null;
	const modifiers = new Set<Modifier>();
	for (const token of tokens.slice(0, -1)) {
		const modifier = MODIFIER_NAMES[token.toLowerCase()];
		if (!modifier || modifiers.has(modifier)) return null;
		modifiers.add(modifier);
	}
	if (modifiers.has("CommandOrControl") && (modifiers.has("Command") || modifiers.has("Control"))) return null;
	const holdsCommand = [...modifiers].some((modifier) => modifier !== "Shift");
	if (!holdsCommand && !/^F\d+$/.test(key)) return null;
	return [...MODIFIERS.filter((modifier) => modifiers.has(modifier)), key].join("+");
}

const MAC_MODIFIERS: Record<Modifier, string> = {
	CommandOrControl: "⌘",
	Command: "⌘",
	Control: "⌃",
	Alt: "⌥",
	Shift: "⇧",
	Super: "⌘",
};

const MAC_KEYS: Record<string, string> = {
	Up: "↑",
	Down: "↓",
	Left: "←",
	Right: "→",
	Tab: "⇥",
	Backspace: "⌫",
	Delete: "⌦",
	PageUp: "⇞",
	PageDown: "⇟",
	Home: "↖",
	End: "↘",
};

const OTHER_MODIFIERS: Record<Modifier, string> = {
	CommandOrControl: "Ctrl",
	Command: "Win",
	Control: "Ctrl",
	Alt: "Alt",
	Shift: "Shift",
	Super: "Win",
};

/** How a shortcut is shown: "⌘⇧X" on macOS, "Ctrl+Shift+X" elsewhere. */
export function acceleratorLabel(accelerator: string, platform: ShortcutPlatform): string {
	const tokens = accelerator.split("+");
	const key = tokens[tokens.length - 1];
	const modifiers = tokens.slice(0, -1) as Modifier[];
	if (platform === "darwin") {
		return modifiers.map((modifier) => MAC_MODIFIERS[modifier] ?? modifier).join("") + (MAC_KEYS[key] ?? key);
	}
	return [...modifiers.map((modifier) => OTHER_MODIFIERS[modifier] ?? modifier), key].join("+");
}

export type KeyPress = {
	code: string;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
};

/** The key a KeyboardEvent.code stands for, whatever the keyboard layout; null for modifiers and others. */
export function keyFromCode(code: string): string | null {
	if (/^Key[A-Z]$/.test(code)) return code.slice(3);
	if (/^Digit[0-9]$/.test(code)) return code.slice(5);
	if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
	return CODE_KEYS[code] ?? null;
}

/** The modifiers held during a key press, in accelerator terms. */
function heldModifiers(press: KeyPress, platform: ShortcutPlatform): Modifier[] {
	const held: Modifier[] = [];
	if (platform === "darwin") {
		if (press.metaKey) held.push("Command");
		if (press.ctrlKey) held.push("Control");
	} else {
		if (press.ctrlKey) held.push("Control");
		if (press.metaKey) held.push("Super");
	}
	if (press.altKey) held.push("Alt");
	if (press.shiftKey) held.push("Shift");
	return held;
}

/**
 * Turns a key press into a shortcut. `accelerator` is set once a usable key
 * is pressed with the modifiers; until then `held` shows the modifiers so far.
 */
export function acceleratorFromKeyPress(
	press: KeyPress,
	platform: ShortcutPlatform,
): { accelerator: string | null; held: string } {
	const modifiers = heldModifiers(press, platform);
	const held = modifiers.length ? acceleratorLabel(`${modifiers.join("+")}+`, platform).replace(/\+$/, "") : "";
	const key = keyFromCode(press.code);
	if (!key) return { accelerator: null, held };
	return { accelerator: normalizeAccelerator([...modifiers, key].join("+")), held };
}
