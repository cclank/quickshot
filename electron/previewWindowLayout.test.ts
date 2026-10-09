import { describe, expect, it } from "vitest";
import {
	PREVIEW_MIN_HEIGHT,
	PREVIEW_MIN_WIDTH,
	PREVIEW_MIN_WIDTH_WINDOWS,
	computePreviewBounds,
	readPngDimensions,
} from "./previewWindowLayout";
import { normalizeAppSettings, resolveLanguage } from "./appSettings";

const workArea = { x: 0, y: 25, width: 1512, height: 944 };

describe("computePreviewBounds", () => {
	it("keeps small captures in a comfortable minimum window", () => {
		const bounds = computePreviewBounds(workArea, 200, 120, 2);
		expect(bounds.width).toBe(PREVIEW_MIN_WIDTH);
		expect(bounds.height).toBe(PREVIEW_MIN_HEIGHT);
		expect(bounds.x).toBe(Math.round((1512 - PREVIEW_MIN_WIDTH) / 2));
	});

	it("uses the wider Windows minimum without leaving the work area", () => {
		expect(computePreviewBounds(workArea, 200, 120, 2, PREVIEW_MIN_WIDTH_WINDOWS).width).toBe(
			PREVIEW_MIN_WIDTH_WINDOWS,
		);
		const laptop = { x: 0, y: 0, width: 1280, height: 720 };
		expect(computePreviewBounds(laptop, 200, 120, 1, PREVIEW_MIN_WIDTH_WINDOWS).width).toBe(1280);
	});

	it("never exceeds 90% of the work area for full-screen captures", () => {
		const bounds = computePreviewBounds(workArea, 3024, 1964, 2);
		expect(bounds.width).toBe(Math.floor(1512 * 0.9));
		expect(bounds.height).toBe(Math.floor(944 * 0.9));
		expect(bounds.y).toBeGreaterThanOrEqual(25);
	});

	it("stays inside small work areas", () => {
		const small = { x: 0, y: 30, width: 1093, height: 574 };
		const bounds = computePreviewBounds(small, 400, 300, 1.25);
		expect(bounds.width).toBeLessThanOrEqual(small.width);
		expect(bounds.height).toBeLessThanOrEqual(small.height);
		expect(bounds.y).toBeGreaterThanOrEqual(small.y);
		expect(bounds.x).toBeGreaterThanOrEqual(small.x);
	});
});

describe("readPngDimensions", () => {
	it("reads the IHDR size", () => {
		const bytes = new Uint8Array(24);
		const view = new DataView(bytes.buffer);
		view.setUint32(16, 1280);
		view.setUint32(20, 720);
		expect(readPngDimensions(bytes)).toEqual({ width: 1280, height: 720 });
		expect(readPngDimensions(new Uint8Array(4))).toBeNull();
	});
});

describe("normalizeAppSettings", () => {
	it("remembers which welcome guide was shown", () => {
		expect(normalizeAppSettings(null).onboardingVersion).toBe(0);
		expect(normalizeAppSettings({ onboardingVersion: 1 }).onboardingVersion).toBe(1);
		expect(normalizeAppSettings({ onboardingVersion: -2 }).onboardingVersion).toBe(0);
		expect(normalizeAppSettings({ onboardingVersion: "1" }).onboardingVersion).toBe(0);
	});

	it("defaults to the window-aware overlay and keeps an explicit choice", () => {
		expect(normalizeAppSettings({ macCaptureMode: "system" }).macCaptureMode).toBe("system");
		expect(normalizeAppSettings({ macCaptureMode: "nope" }).macCaptureMode).toBe("overlay");
		expect(normalizeAppSettings(null).macCaptureMode).toBe("overlay");
	});

	it("keeps valid custom shortcuts and falls back for broken ones", () => {
		expect(normalizeAppSettings(null).shortcuts).toEqual({
			capture: "CommandOrControl+Shift+X",
			scrollCapture: null,
			restorePins: "CommandOrControl+Shift+L",
		});
		expect(
			normalizeAppSettings({ shortcuts: { capture: "cmd+shift+2", scrollCapture: "Control+Alt+S", restorePins: "F9" } })
				.shortcuts,
		).toEqual({ capture: "Command+Shift+2", scrollCapture: "Control+Alt+S", restorePins: "F9" });
		expect(normalizeAppSettings({ shortcuts: { capture: "X", scrollCapture: "Shift+S" } }).shortcuts).toEqual({
			capture: "CommandOrControl+Shift+X",
			scrollCapture: null,
			restorePins: "CommandOrControl+Shift+L",
		});
		// Two jobs cannot share one shortcut; capturing keeps it.
		expect(
			normalizeAppSettings({ shortcuts: { capture: "Command+Shift+2", scrollCapture: "Command+Shift+2" } }).shortcuts
				.scrollCapture,
		).toBeNull();
	});
});

describe("resolveLanguage", () => {
	it("uses Chinese when it is among the preferred languages", () => {
		expect(resolveLanguage("auto", ["en-US", "zh-Hans-US"])).toBe("zh");
		expect(resolveLanguage("auto", ["en-GB", "fr-FR"])).toBe("en");
		expect(resolveLanguage("en", ["zh-CN"])).toBe("en");
	});
});
