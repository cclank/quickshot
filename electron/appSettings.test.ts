import { describe, expect, it } from "vitest";
import { DEFAULT_APP_SETTINGS, normalizeAppSettings } from "./appSettings";

describe("normalizeAppSettings", () => {
	it("keeps the overlay double-click copy off by default", () => {
		expect(DEFAULT_APP_SETTINGS.overlayDoubleClickCopy).toBe(false);
		expect(normalizeAppSettings({}).overlayDoubleClickCopy).toBe(false);
	});

	it("keeps an explicit choice and rejects anything else", () => {
		expect(normalizeAppSettings({ overlayDoubleClickCopy: true }).overlayDoubleClickCopy).toBe(true);
		expect(normalizeAppSettings({ overlayDoubleClickCopy: false }).overlayDoubleClickCopy).toBe(false);
		expect(normalizeAppSettings({ overlayDoubleClickCopy: "yes" }).overlayDoubleClickCopy).toBe(false);
	});

	it("falls back to the defaults for a broken settings file", () => {
		expect(normalizeAppSettings(null)).toEqual(DEFAULT_APP_SETTINGS);
		expect(normalizeAppSettings("junk")).toEqual(DEFAULT_APP_SETTINGS);
	});
});
