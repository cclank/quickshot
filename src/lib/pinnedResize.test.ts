import { describe, expect, it } from "vitest";
import { resolvePinnedResizeScale } from "./pinnedResize";

describe("resolvePinnedResizeScale", () => {
	it("shrinks from a horizontal-only drag", () => {
		expect(resolvePinnedResizeScale(0.75, 1)).toBe(0.75);
	});

	it("shrinks from a vertical-only drag", () => {
		expect(resolvePinnedResizeScale(1, 0.8)).toBe(0.8);
	});

	it("uses the axis with the stronger resize intent", () => {
		expect(resolvePinnedResizeScale(0.9, 0.6)).toBe(0.6);
		expect(resolvePinnedResizeScale(1.45, 1.1)).toBe(1.45);
	});

	it("smooths conflicting drag directions instead of switching axes", () => {
		expect(resolvePinnedResizeScale(1.2, 0.8)).toBe(1);
		expect(resolvePinnedResizeScale(1.2, 0.795)).toBeCloseTo(0.995);
		expect(resolvePinnedResizeScale(1.2, 0.995)).toBeCloseTo(
			1.195,
			2,
		);
	});

	it("keeps invalid and extreme input safe", () => {
		expect(resolvePinnedResizeScale(Number.NaN, Number.NaN)).toBe(1);
		expect(resolvePinnedResizeScale(-2, 1)).toBe(0.01);
	});
});
