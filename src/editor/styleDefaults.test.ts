import { describe, expect, it } from "vitest";
import { DEFAULT_STYLE_SETTINGS, type StyleSettings } from "./composition";
import { builtInStyle, resolveStyleDefaults, sameStyle } from "./styleDefaults";

const custom: StyleSettings = {
	...DEFAULT_STYLE_SETTINGS,
	padding: 88,
	frame: "glass",
	watermark: { ...DEFAULT_STYLE_SETTINGS.watermark, enabled: true, text: "@lank", font: "script" },
};

describe("resolveStyleDefaults", () => {
	it("offers nothing when the built-in style is in use and no default was saved", () => {
		expect(resolveStyleDefaults(DEFAULT_STYLE_SETTINGS, null)).toEqual({
			canSave: false,
			restoreTarget: null,
			restoreTo: null,
		});
	});

	it("resets a customised style to the built-in one when no default was saved", () => {
		const result = resolveStyleDefaults(custom, null);
		expect(result.canSave).toBe(true);
		expect(result.restoreTarget).toBe("default");
		expect(result.restoreTo?.padding).toBe(DEFAULT_STYLE_SETTINGS.padding);
		// The signature text is the user's, not part of the look.
		expect(result.restoreTo?.watermark.text).toBe("@lank");
		expect(result.restoreTo?.watermark.enabled).toBe(false);
	});

	it("resets to the saved default after further changes", () => {
		const changed = { ...custom, radius: 30 };
		const result = resolveStyleDefaults(changed, custom);
		expect(result.canSave).toBe(true);
		expect(result.restoreTarget).toBe("default");
		expect(result.restoreTo && sameStyle(result.restoreTo, custom)).toBe(true);
	});

	it("offers the built-in style once the saved default is in use", () => {
		const result = resolveStyleDefaults(custom, custom);
		expect(result.canSave).toBe(false);
		expect(result.restoreTarget).toBe("builtIn");
		expect(result.restoreTo && sameStyle(result.restoreTo, builtInStyle(custom))).toBe(true);
	});
});

describe("sameStyle", () => {
	it("ignores key order and fills missing fields", () => {
		const { watermark, ...rest } = custom;
		const reordered = { watermark: { ...watermark }, ...rest };
		expect(sameStyle(reordered, custom)).toBe(true);
		const legacy = { ...custom, watermark: { ...custom.watermark } } as Partial<StyleSettings>;
		delete (legacy.watermark as Partial<StyleSettings["watermark"]>).size;
		expect(sameStyle(legacy as StyleSettings, custom)).toBe(true);
	});
});
