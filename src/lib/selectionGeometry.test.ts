import { describe, expect, it } from "vitest";
import { clampSelectionPoint, findWindowAt, getClampedSelectionRect } from "./selectionGeometry";

const SOURCE_SIZE = { width: 1920, height: 1080 };

describe("selection geometry", () => {
	it("clamps pointer capture coordinates to the source image", () => {
		expect(
			clampSelectionPoint({ x: -500, y: 9_999 }, SOURCE_SIZE),
		).toEqual({ x: 0, y: 1080 });
	});

	it("keeps reverse drags inside the source bounds", () => {
		expect(
			getClampedSelectionRect(
				{ x: 2_500, y: 1_500 },
				{ x: -200, y: -100 },
				SOURCE_SIZE,
			),
		).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
	});

	it("returns finite zero-area geometry for invalid coordinates", () => {
		expect(
			getClampedSelectionRect(
				{ x: Number.NaN, y: Number.POSITIVE_INFINITY },
				{ x: 100, y: 50 },
				SOURCE_SIZE,
			),
		).toEqual({ x: 0, y: 0, width: 100, height: 50 });
	});

	it("picks the front-most window under the pointer", () => {
		const windows = [
			{ x: 100, y: 100, width: 200, height: 150, id: "front" },
			{ x: 0, y: 0, width: 1920, height: 1080, id: "back" },
		];
		expect(findWindowAt(windows, { x: 150, y: 120 })?.id).toBe("front");
		expect(findWindowAt(windows, { x: 10, y: 10 })?.id).toBe("back");
		expect(findWindowAt(windows, { x: 5000, y: 10 })).toBeNull();
	});
});
