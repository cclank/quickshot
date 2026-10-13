import { describe, expect, it } from "vitest";
import {
	clipAnnotationsToCrop,
	offsetAnnotations,
	overlayPixelScale,
	selectionCropRect,
} from "./overlayAnnotations";
import type { Annotation, TextMeasurer } from "./types";

const measure: TextMeasurer = (mark) => ({
	w: mark.text.length * mark.size,
	h: mark.size,
	lines: [mark.text],
	lineHeight: mark.size,
	padX: 0,
	padY: 0,
	ascent: mark.size,
});

describe("overlay annotations", () => {
	it("measures the crop in whole frozen-frame pixels", () => {
		expect(selectionCropRect({ x: 12.4, y: 8.6, width: 100.2, height: 40.7 }, 2)).toEqual({
			x: 25,
			y: 17,
			w: 200,
			h: 81,
		});
	});

	it("moves marks onto the crop and drops the ones outside it", () => {
		const marks: Annotation[] = [
			{ id: "box", kind: "rect", x: 100, y: 100, w: 60, h: 40, color: "#FF0000", width: 4, fill: "none" },
			{ id: "far", kind: "rect", x: 900, y: 900, w: 20, h: 20, color: "#FF0000", width: 4, fill: "soft" },
		];
		const moved = clipAnnotationsToCrop(marks, { x: 80, y: 70, w: 200, h: 200 }, measure);
		expect(moved.map((mark) => mark.id)).toEqual(["box"]);
		expect(moved[0]).toMatchObject({ x: 20, y: 30, w: 60, h: 40 });
	});

	it("offsets marks without mutating the originals", () => {
		const marks: Annotation[] = [
			{ id: "line", kind: "line", from: { x: 1, y: 2 }, to: { x: 3, y: 4 }, color: "#FF0000", width: 2 },
		];
		const shifted = offsetAnnotations(marks, 10, -5);
		expect(shifted[0]).toMatchObject({ from: { x: 11, y: -3 }, to: { x: 13, y: -1 } });
		expect(marks[0]).toMatchObject({ from: { x: 1, y: 2 } });
	});

	it("scales image pixels to the overlay's CSS pixels", () => {
		expect(overlayPixelScale(2)).toBeCloseTo(0.5);
		expect(overlayPixelScale(1)).toBe(1);
	});
});