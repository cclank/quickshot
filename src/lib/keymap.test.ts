import { describe, expect, it } from "vitest";
import {
	DEFAULT_KEYMAP,
	bindingConflict,
	bindingFromKeyPress,
	bindingLabel,
	commandFor,
	normalizeBinding,
	normalizeKeymap,
} from "./keymap";

const press = (code: string, held: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
	code,
	metaKey: false,
	ctrlKey: false,
	altKey: false,
	shiftKey: false,
	...held,
});

describe("editor keymap", () => {
	it("normalises bindings", () => {
		expect(normalizeBinding("shift+mod+s")).toBe("Mod+Shift+S");
		expect(normalizeBinding("mod+enter")).toBe("Mod+Enter");
		expect(normalizeBinding("Mod+Hyper+S")).toBeNull();
		expect(normalizeBinding("")).toBeNull();
	});

	it("reads key presses the way each system names the main modifier", () => {
		expect(bindingFromKeyPress(press("KeyS", { metaKey: true, shiftKey: true }), "darwin")).toBe("Mod+Shift+S");
		expect(bindingFromKeyPress(press("KeyS", { ctrlKey: true, shiftKey: true }), "win32")).toBe("Mod+Shift+S");
		expect(bindingFromKeyPress(press("KeyS", { ctrlKey: true }), "darwin")).toBeNull();
		expect(bindingFromKeyPress(press("KeyV"), "darwin")).toBe("V");
		expect(bindingFromKeyPress(press("ShiftLeft", { shiftKey: true }), "darwin")).toBeNull();
	});

	it("labels bindings for each system", () => {
		expect(bindingLabel("Mod+Shift+A", "darwin")).toBe("⌘⇧A");
		expect(bindingLabel("Mod+Enter", "darwin")).toBe("⌘↩");
		expect(bindingLabel("Mod+Shift+A", "win32")).toBe("Ctrl+Shift+A");
	});

	it("keeps reserved keys and refuses one binding for two commands", () => {
		expect(bindingConflict(DEFAULT_KEYMAP, "copy", "Mod+Z")).toEqual({ reason: "reserved" });
		expect(bindingConflict(DEFAULT_KEYMAP, "tool.rect", "A")).toEqual({ reason: "taken", by: "tool.arrow" });
		// The overlay never shares a window with the editor.
		expect(bindingConflict(DEFAULT_KEYMAP, "overlay.scroll", "A")).toBeNull();
		expect(bindingConflict(DEFAULT_KEYMAP, "tool.rect", "B")).toBeNull();
	});

	it("loads stored changes, swaps included, and drops broken ones", () => {
		const keymap = normalizeKeymap({ copy: "Mod+D", duplicate: "Mod+C", "tool.text": "", stitch: "Mod+Z", pin: "nonsense" });
		expect(keymap.copy).toBe("Mod+D");
		expect(keymap.duplicate).toBe("Mod+C");
		expect(keymap["tool.text"]).toBe("");
		expect(keymap.stitch).toBe(DEFAULT_KEYMAP.stitch);
		expect(keymap.pin).toBe(DEFAULT_KEYMAP.pin);
		// A changed binding takes a key from a default, which is left empty.
		expect(normalizeKeymap({ "tool.rect": "A" })["tool.arrow"]).toBe("");
	});

	it("finds the command for a key press in its window", () => {
		const keymap = normalizeKeymap({ quickSave: "Mod+Alt+S" });
		expect(commandFor(keymap, press(navigator.userAgent.includes("Mac") ? "KeyS" : "KeyS", { metaKey: true, ctrlKey: true, altKey: true }), "editor")).toBeNull();
		expect(commandFor(DEFAULT_KEYMAP, press("KeyR"), "editor")).toBe("tool.rect");
		expect(commandFor(DEFAULT_KEYMAP, press("KeyS"), "overlay")).toBe("overlay.scroll");
		expect(commandFor(DEFAULT_KEYMAP, press("KeyS"), "editor")).toBeNull();
	});
});
