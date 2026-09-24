import { describe, expect, it } from "vitest";
import {
	BACKGROUND_PADDING_STEP,
	DEFAULT_BACKGROUND_PADDING,
	MAX_BACKGROUND_PADDING,
	calculateScreenshotCompositionLayout,
	normalizeBackgroundPadding,
} from "./screenshotComposition";

describe("normalizeBackgroundPadding", () => {
	it("uses a compact default and aligns values to the slider step", () => {
		expect(normalizeBackgroundPadding(Number.NaN)).toBe(
			DEFAULT_BACKGROUND_PADDING,
		);
		expect(normalizeBackgroundPadding(27)).toBe(28);
		expect(normalizeBackgroundPadding(28) % BACKGROUND_PADDING_STEP).toBe(0);
	});

	it("clamps padding to the supported range", () => {
		expect(normalizeBackgroundPadding(-20)).toBe(0);
		expect(normalizeBackgroundPadding(500)).toBe(MAX_BACKGROUND_PADDING);
	});
});

describe("calculateScreenshotCompositionLayout", () => {
	it("includes the same adjustable background margin around a framed image", () => {
		expect(
			calculateScreenshotCompositionLayout(1124, 654, 24, false),
		).toEqual({
			width: 1208,
			height: 776,
			backgroundPadding: 24,
			frameInset: 18,
			topBarHeight: 38,
			frameX: 24,
			frameY: 24,
			frameWidth: 1160,
			frameHeight: 728,
			imageX: 42,
			imageY: 80,
			imageWidth: 1124,
			imageHeight: 654,
		});
	});

	it("can export a borderless screenshot with no surrounding background", () => {
		expect(
			calculateScreenshotCompositionLayout(800, 450, 0, true),
		).toEqual({
			width: 800,
			height: 450,
			backgroundPadding: 0,
			frameInset: 0,
			topBarHeight: 0,
			frameX: 0,
			frameY: 0,
			frameWidth: 800,
			frameHeight: 450,
			imageX: 0,
			imageY: 0,
			imageWidth: 800,
			imageHeight: 450,
		});
	});
});
