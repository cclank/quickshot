import { describe, expect, it } from "vitest";
import { shouldRegisterCaptureShortcut } from "./captureShortcutPolicy";

describe("shouldRegisterCaptureShortcut", () => {
	it("registers the shortcut in packaged builds", () => {
		expect(shouldRegisterCaptureShortcut(true, undefined)).toBe(true);
	});

	it("registers the shortcut in development by default", () => {
		expect(shouldRegisterCaptureShortcut(false, undefined)).toBe(true);
		expect(shouldRegisterCaptureShortcut(false, "1")).toBe(true);
	});

	it("allows explicitly disabling the development shortcut", () => {
		expect(shouldRegisterCaptureShortcut(false, "0")).toBe(false);
		expect(shouldRegisterCaptureShortcut(false, "false")).toBe(false);
		expect(shouldRegisterCaptureShortcut(false, "off")).toBe(false);
		expect(shouldRegisterCaptureShortcut(false, "no")).toBe(false);
	});
});
