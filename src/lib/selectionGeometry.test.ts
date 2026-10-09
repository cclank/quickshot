import { describe, expect, it } from "vitest";
import {
	adjustSelection,
	clampSelectionPoint,
	findWindowAt,
	getClampedSelectionRect,
	selectionCursor,
	selectionHandleAt,
} from "./selectionGeometry";

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

describe("adjusting a selection", () => {
	const rect = { x: 100, y: 100, width: 200, height: 100 };
	const screen = { width: 1000, height: 600 };

	it("finds edges, corners and the inside", () => {
		expect(selectionHandleAt(rect, { x: 200, y: 150 })).toBe("move");
		expect(selectionHandleAt(rect, { x: 103, y: 96 })).toBe("nw");
		expect(selectionHandleAt(rect, { x: 300, y: 203 })).toBe("se");
		expect(selectionHandleAt(rect, { x: 200, y: 105 })).toBe("n");
		expect(selectionHandleAt(rect, { x: 294, y: 150 })).toBe("e");
		expect(selectionHandleAt(rect, { x: 50, y: 150 })).toBeNull();
		expect(selectionHandleAt(rect, { x: 200, y: 220 })).toBeNull();
		expect(selectionCursor("nw")).toBe("nwse-resize");
		expect(selectionCursor("sw")).toBe("nesw-resize");
	});

	it("moves the whole selection but keeps it on screen", () => {
		expect(adjustSelection(rect, "move", { x: 150, y: 150 }, { x: 180, y: 130 }, screen)).toEqual({
			x: 130, y: 80, width: 200, height: 100,
		});
		expect(adjustSelection(rect, "move", { x: 150, y: 150 }, { x: 2000, y: -500 }, screen)).toEqual({
			x: 800, y: 0, width: 200, height: 100,
		});
	});

	it("resizes by the grabbed edges and flips past the opposite one", () => {
		expect(adjustSelection(rect, "se", { x: 300, y: 200 }, { x: 350, y: 260 }, screen)).toEqual({
			x: 100, y: 100, width: 250, height: 160,
		});
		expect(adjustSelection(rect, "n", { x: 200, y: 100 }, { x: 260, y: 40 }, screen)).toEqual({
			x: 100, y: 40, width: 200, height: 160,
		});
		expect(adjustSelection(rect, "w", { x: 100, y: 150 }, { x: 400, y: 150 }, screen)).toEqual({
			x: 300, y: 100, width: 100, height: 100,
		});
		expect(adjustSelection(rect, "e", { x: 300, y: 150 }, { x: 5000, y: 150 }, screen).width).toBe(900);
	});
});
