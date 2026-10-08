import { describe, expect, it } from "vitest";
import {
	DEFAULT_STITCH_SETTINGS,
	computeStitchPlacement,
	normalizeStitchSettings,
	remapAnnotations,
} from "./stitch";
import type { Annotation, TextAnnotation, TextMeasurer } from "./types";

const measure: TextMeasurer = (annotation: TextAnnotation) => ({
	w: annotation.text.length * annotation.size * 0.6,
	h: annotation.size * 1.3,
	lines: [annotation.text],
	lineHeight: annotation.size * 1.3,
	padX: 0,
	padY: 0,
	ascent: annotation.size * 0.8,
});

const pieces = [
	{ id: "a", width: 400, height: 300 },
	{ id: "b", width: 200, height: 100 },
];

function box(id: string, x: number, y: number): Annotation {
	return { id, kind: "rect", x, y, w: 20, h: 20, color: "#FF3B30", width: 4, fill: "none" };
}

describe("computeStitchPlacement", () => {
	it("stacks pieces top to bottom with a gap in points", () => {
		const placement = computeStitchPlacement(pieces, { ...DEFAULT_STITCH_SETTINGS, gap: 8 }, 2);
		expect(placement).toEqual({
			width: 400,
			height: 416,
			rects: {
				a: { x: 0, y: 0, width: 400, height: 300 },
				b: { x: 0, y: 316, width: 200, height: 100 },
			},
		});
	});

	it("centres or end-aligns narrower pieces", () => {
		const centred = computeStitchPlacement(pieces, { ...DEFAULT_STITCH_SETTINGS, align: "center" }, 1);
		expect(centred.rects.b.x).toBe(100);
		const end = computeStitchPlacement(
			pieces,
			{ arrangement: "horizontal", gap: 0, align: "end" },
			1,
		);
		expect(end).toMatchObject({ width: 600, height: 300 });
		expect(end.rects.b).toEqual({ x: 400, y: 200, width: 200, height: 100 });
	});

	it("lays out a compact grid, row by row", () => {
		const grid = computeStitchPlacement(
			[
				{ id: "a", width: 100, height: 50 },
				{ id: "b", width: 60, height: 80 },
				{ id: "c", width: 90, height: 40 },
			],
			{ arrangement: "grid", gap: 10, align: "start" },
			1,
		);
		// Two columns: 100 and 60 wide; two rows: 80 and 40 tall.
		expect(grid.width).toBe(170);
		expect(grid.height).toBe(130);
		expect(grid.rects.b).toEqual({ x: 110, y: 0, width: 60, height: 80 });
		expect(grid.rects.c).toEqual({ x: 0, y: 90, width: 90, height: 40 });
	});

	it("handles a single piece and no pieces", () => {
		expect(computeStitchPlacement([pieces[0]], DEFAULT_STITCH_SETTINGS, 2)).toMatchObject({
			width: 400,
			height: 300,
		});
		expect(computeStitchPlacement([], DEFAULT_STITCH_SETTINGS, 2)).toEqual({ width: 0, height: 0, rects: {} });
	});
});

describe("remapAnnotations", () => {
	const before = computeStitchPlacement(pieces, DEFAULT_STITCH_SETTINGS, 1);

	it("moves annotations with their piece when the order changes", () => {
		const after = computeStitchPlacement([...pieces].reverse(), DEFAULT_STITCH_SETTINGS, 1);
		const [onA, onB] = remapAnnotations([box("1", 10, 10), box("2", 10, 310)], before, after, measure);
		// b now comes first, so a moves down by b's height.
		expect(onA).toMatchObject({ x: 10, y: 110 });
		expect(onB).toMatchObject({ x: 10, y: 10 });
	});

	it("drops annotations whose piece was removed", () => {
		const after = computeStitchPlacement([pieces[0]], DEFAULT_STITCH_SETTINGS, 1);
		const remaining = remapAnnotations([box("1", 10, 10), box("2", 10, 310)], before, after, measure);
		expect(remaining.map((annotation) => annotation.id)).toEqual(["1"]);
	});

	it("keeps unmoved annotations as the same objects", () => {
		const list = [box("1", 10, 10)];
		const after = computeStitchPlacement(pieces, { ...DEFAULT_STITCH_SETTINGS, gap: 20 }, 1);
		expect(remapAnnotations(list, before, after, measure)[0]).toBe(list[0]);
	});
});

describe("normalizeStitchSettings", () => {
	it("falls back to defaults and clamps the gap", () => {
		expect(normalizeStitchSettings({ arrangement: "diagonal", gap: 999, align: "end" })).toEqual({
			arrangement: "vertical",
			gap: 80,
			align: "end",
		});
		expect(normalizeStitchSettings(null)).toEqual(DEFAULT_STITCH_SETTINGS);
	});
});
