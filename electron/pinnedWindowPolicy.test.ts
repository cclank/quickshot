import { describe, expect, it } from "vitest";
import {
	MAX_PINNED_SCREENSHOTS,
	PINNED_OPACITY_MAX,
	PINNED_OPACITY_MIN,
	PINNED_RASTER_MAX_EDGE,
	PINNED_RASTER_MAX_PIXELS,
	PINNED_WINDOW_MAX_ASPECT_RATIO,
	PINNED_WINDOW_MIN_ASPECT_RATIO,
	canCreatePinnedScreenshot,
	clampPinnedOpacity,
	clampPinnedWindowAspectRatio,
	findAvailablePinnedPlacementSlot,
	fitPinnedRasterSize,
	fitPinnedWindowSize,
	resizePinnedWindowFromWidth,
} from "./pinnedWindowPolicy";

describe("pinned window policy", () => {
	it("admits screenshots until the pinned-window limit", () => {
		expect(canCreatePinnedScreenshot(0)).toBe(true);
		expect(canCreatePinnedScreenshot(MAX_PINNED_SCREENSHOTS - 1)).toBe(true);
		expect(canCreatePinnedScreenshot(MAX_PINNED_SCREENSHOTS)).toBe(false);
		expect(canCreatePinnedScreenshot(-1)).toBe(false);
	});

	it("reuses the first open placement slot without overlapping a survivor", () => {
		expect(findAvailablePinnedPlacementSlot([])).toBe(0);
		expect(findAvailablePinnedPlacementSlot([0, 2])).toBe(1);
		expect(findAvailablePinnedPlacementSlot([2])).toBe(0);
		expect(findAvailablePinnedPlacementSlot([0, 1, 2])).toBeNull();
	});

	it("clamps opacity to the supported range", () => {
		expect(clampPinnedOpacity(0)).toBe(PINNED_OPACITY_MIN);
		expect(clampPinnedOpacity(0.72)).toBe(0.72);
		expect(clampPinnedOpacity(2)).toBe(PINNED_OPACITY_MAX);
		expect(clampPinnedOpacity(Number.NaN)).toBe(PINNED_OPACITY_MAX);
	});

	it("keeps extreme screenshot ratios inside an operable window range", () => {
		expect(clampPinnedWindowAspectRatio(0.02)).toBe(
			PINNED_WINDOW_MIN_ASPECT_RATIO,
		);
		expect(clampPinnedWindowAspectRatio(16 / 9)).toBeCloseTo(16 / 9);
		expect(clampPinnedWindowAspectRatio(20)).toBe(
			PINNED_WINDOW_MAX_ASPECT_RATIO,
		);
		expect(clampPinnedWindowAspectRatio(Number.NaN)).toBe(1);
	});

	it("downscales large raster images without changing their ratio", () => {
		const result = fitPinnedRasterSize(6_144, 3_456);

		expect(result.width).toBeLessThanOrEqual(PINNED_RASTER_MAX_EDGE);
		expect(result.height).toBeLessThanOrEqual(PINNED_RASTER_MAX_EDGE);
		expect(result.width * result.height).toBeLessThanOrEqual(
			PINNED_RASTER_MAX_PIXELS,
		);
		expect(result.width / result.height).toBeCloseTo(16 / 9, 2);
	});

	it("does not upscale small raster images", () => {
		expect(fitPinnedRasterSize(640, 480)).toEqual({
			width: 640,
			height: 480,
		});
	});

	it("never crosses the raster pixel budget after integer rounding", () => {
		const result = fitPinnedRasterSize(2_808, 2_854);

		expect(result.width * result.height).toBeLessThanOrEqual(
			PINNED_RASTER_MAX_PIXELS,
		);
	});

	it("fits the initial window inside its display bounds", () => {
		expect(
			fitPinnedWindowSize(1_920, 1_080, {
				maxWidth: 520,
				maxHeight: 420,
			}),
		).toEqual({ width: 520, height: 293 });
	});

	it("keeps manual resizing proportional and bounded", () => {
		expect(
			resizePinnedWindowFromWidth(900, 16 / 9, {
				minWidth: 180,
				minHeight: 120,
				maxWidth: 720,
				maxHeight: 540,
			}),
		).toEqual({ width: 720, height: 405 });
		expect(
			resizePinnedWindowFromWidth(20, 16 / 9, {
				minWidth: 180,
				minHeight: 120,
				maxWidth: 720,
				maxHeight: 540,
			}),
		).toEqual({ width: 213, height: 120 });
	});

	it("gives tiny and extreme screenshots an operable initial size", () => {
		expect(
			resizePinnedWindowFromWidth(
				40,
				clampPinnedWindowAspectRatio(1),
				{
					minWidth: 200,
					minHeight: 120,
					maxWidth: 520,
					maxHeight: 420,
				},
			),
		).toEqual({ width: 200, height: 200 });
		expect(
			resizePinnedWindowFromWidth(
				2_000,
				clampPinnedWindowAspectRatio(20),
				{
					minWidth: 200,
					minHeight: 120,
					maxWidth: 520,
					maxHeight: 420,
				},
			),
		).toEqual({ width: 520, height: 130 });
	});
});
