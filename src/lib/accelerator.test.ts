import { describe, expect, it } from "vitest";
import {
	DEFAULT_CAPTURE_ACCELERATOR,
	acceleratorFromKeyPress,
	acceleratorLabel,
	normalizeAccelerator,
} from "./accelerator";

const press = (code: string, held: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
	code,
	metaKey: false,
	ctrlKey: false,
	altKey: false,
	shiftKey: false,
	...held,
});

describe("shortcut accelerators", () => {
	it("puts accepted shortcuts in one canonical form", () => {
		expect(normalizeAccelerator("shift+cmd+x")).toBe("Command+Shift+X");
		expect(normalizeAccelerator("CmdOrCtrl+Shift+X")).toBe(DEFAULT_CAPTURE_ACCELERATOR);
		expect(normalizeAccelerator("Option+Control+4")).toBe("Control+Alt+4");
		expect(normalizeAccelerator("F8")).toBe("F8");
		expect(normalizeAccelerator("Shift+F12")).toBe("Shift+F12");
		expect(normalizeAccelerator("Command+-")).toBe("Command+-");
	});

	it("refuses shortcuts that would take over typing or that are malformed", () => {
		for (const value of ["X", "Shift+X", "Command+", "Command+Command+X", "Hyper+X", "CmdOrCtrl+Cmd+X", "Command+Return", "Command+Escape", 42, null]) {
			expect(normalizeAccelerator(value)).toBeNull();
		}
	});

	it("shows shortcuts the way each system does", () => {
		expect(acceleratorLabel(DEFAULT_CAPTURE_ACCELERATOR, "darwin")).toBe("⌘⇧X");
		expect(acceleratorLabel(DEFAULT_CAPTURE_ACCELERATOR, "win32")).toBe("Ctrl+Shift+X");
		expect(acceleratorLabel("Control+Alt+Up", "darwin")).toBe("⌃⌥↑");
		expect(acceleratorLabel("Control+Alt+Shift+S", "win32")).toBe("Ctrl+Alt+Shift+S");
	});

	it("turns a key press into a shortcut", () => {
		expect(acceleratorFromKeyPress(press("KeyS", { metaKey: true, shiftKey: true }), "darwin")).toEqual({
			accelerator: "Command+Shift+S",
			held: "⌘⇧",
		});
		expect(acceleratorFromKeyPress(press("Digit2", { ctrlKey: true, altKey: true }), "win32").accelerator).toBe(
			"Control+Alt+2",
		);
		// Only modifiers so far: nothing to save yet.
		expect(acceleratorFromKeyPress(press("ShiftLeft", { metaKey: true, shiftKey: true }), "darwin")).toEqual({
			accelerator: null,
			held: "⌘⇧",
		});
		// A plain letter would hijack typing.
		expect(acceleratorFromKeyPress(press("KeyA"), "darwin").accelerator).toBeNull();
		expect(acceleratorFromKeyPress(press("F5"), "win32").accelerator).toBe("F5");
	});
});
