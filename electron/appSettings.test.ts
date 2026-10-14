import { describe, expect, it } from "vitest";
import { DEFAULT_APP_SETTINGS, normalizeAppSettings } from "./appSettings";

describe("normalizeAppSettings", () => {
	it("follows the system Downloads folder by default", () => {
		expect(DEFAULT_APP_SETTINGS.saveDirectory).toBe(null);
		expect(normalizeAppSettings({}).saveDirectory).toBe(null);
	});

	it("keeps a non-empty custom save directory", () => {
		expect(normalizeAppSettings({ saveDirectory: "/tmp/quickshot" }).saveDirectory).toBe("/tmp/quickshot");
	});

	it("rejects empty and non-string save directories", () => {
		for (const saveDirectory of ["", "   ", 42, {}, null]) {
			expect(normalizeAppSettings({ saveDirectory }).saveDirectory).toBe(null);
		}
	});

	it("keeps the overlay double-click copy off by default", () => {
		expect(DEFAULT_APP_SETTINGS.overlayDoubleClickCopy).toBe(false);
		expect(normalizeAppSettings({}).overlayDoubleClickCopy).toBe(false);
	});

	it("keeps an explicit choice and rejects anything else", () => {
		expect(normalizeAppSettings({ overlayDoubleClickCopy: true }).overlayDoubleClickCopy).toBe(true);
		expect(normalizeAppSettings({ overlayDoubleClickCopy: false }).overlayDoubleClickCopy).toBe(false);
		expect(normalizeAppSettings({ overlayDoubleClickCopy: "yes" }).overlayDoubleClickCopy).toBe(false);
	});

	it("starts a capture on tray left-click by default", () => {
		expect(DEFAULT_APP_SETTINGS.trayClickCaptures).toBe(true);
		expect(normalizeAppSettings({}).trayClickCaptures).toBe(true);
	});

	it("keeps an explicit tray-click choice and rejects anything else", () => {
		expect(normalizeAppSettings({ trayClickCaptures: true }).trayClickCaptures).toBe(true);
		expect(normalizeAppSettings({ trayClickCaptures: false }).trayClickCaptures).toBe(false);
		expect(normalizeAppSettings({ trayClickCaptures: "no" }).trayClickCaptures).toBe(true);
	});

	it("applies the style template to quick copies by default", () => {
		expect(DEFAULT_APP_SETTINGS.overlayStyledCopy).toBe(true);
		expect(normalizeAppSettings({}).overlayStyledCopy).toBe(true);
	});

	it("keeps an explicit styled-copy choice and rejects anything else", () => {
		expect(normalizeAppSettings({ overlayStyledCopy: true }).overlayStyledCopy).toBe(true);
		expect(normalizeAppSettings({ overlayStyledCopy: false }).overlayStyledCopy).toBe(false);
		expect(normalizeAppSettings({ overlayStyledCopy: "yes" }).overlayStyledCopy).toBe(true);
	});

	it("falls back to the defaults for a broken settings file", () => {
		expect(normalizeAppSettings(null)).toEqual(DEFAULT_APP_SETTINGS);
		expect(normalizeAppSettings("junk")).toEqual(DEFAULT_APP_SETTINGS);
	});
});
