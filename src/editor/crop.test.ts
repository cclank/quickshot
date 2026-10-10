import { describe, expect, it } from "vitest";
import { combineCrops, cropAnnotations, normalizeCrop } from "./crop";
import { createHistory, pushHistory, redoHistory, undoHistory } from "./history";
import type { Annotation, TextMeasurer } from "./types";

const measure: TextMeasurer = (mark) => ({ w: mark.text.length * mark.size, h: mark.size,
	lines: [mark.text], lineHeight: mark.size, padX: 0, padY: 0, ascent: mark.size });

describe("image crops", () => {
	it("clips to integer source pixels and rejects empty or invalid selections", () => {
		expect(normalizeCrop({ x: -20.4, y: 10.3, w: 160.6, h: 400 }, { width: 120, height: 90 }))
			.toEqual({ x: 0, y: 10, w: 120, h: 80 });
		for (const rect of [{ x: 120, y: 0, w: 20, h: 20 }, { x: 0, y: 0, w: 0, h: 20 }, { x: NaN, y: 0, w: 20, h: 20 }]) {
			expect(normalizeCrop(rect, { width: 120, height: 90 })).toBeNull();
		}
	});

	it("moves partial marks and redactions with the crop and drops fully outside marks", () => {
		const marks: Annotation[] = [
			{ id: "mask", kind: "redact", x: 80, y: 60, w: 80, h: 40, mode: "pixelate", strength: 12 },
			{ id: "arrow", kind: "arrow", from: { x: 130, y: 90 }, to: { x: 200, y: 130 }, color: "#FF0000", width: 4 },
			{ id: "stroke", kind: "pen", points: [{ x: 140, y: 100 }, { x: 180, y: 140 }], color: "#FF0000", width: 4 },
			{ id: "outside", kind: "text", x: 700, y: 400, size: 20, text: "outside", color: "#FF0000", style: "plain" },
		];
		const next = cropAnnotations(marks, { x: 100, y: 50, w: 220, h: 200 }, measure);
		expect(next.map((mark) => mark.id)).toEqual(["mask", "arrow", "stroke"]);
		expect(next[0]).toMatchObject({ x: -20, y: 10, w: 80, h: 40, strength: 12 });
		expect(next[1]).toMatchObject({ from: { x: 30, y: 40 }, to: { x: 100, y: 80 } });
		expect(next[2]).toMatchObject({ points: [{ x: 40, y: 50 }, { x: 80, y: 90 }] });
		expect(marks[0]).toMatchObject({ x: 80, y: 60 });
	});

	it("composes repeated crops and restores crop bounds and marks together on undo/redo", () => {
		const initial = { crop: null as ReturnType<typeof combineCrops> | null, annotations: [] as Annotation[] };
		const first = { ...initial, crop: combineCrops(null, { x: 100, y: 200, w: 800, h: 600 }) };
		const second = { ...initial, crop: combineCrops(first.crop, { x: 40, y: 60, w: 300, h: 200 }) };
		expect(second.crop).toEqual({ x: 140, y: 260, w: 300, h: 200 });
		const history = pushHistory(pushHistory(createHistory(initial), first), second);
		const oneBack = undoHistory(history);
		expect(oneBack.present).toBe(first);
		expect(undoHistory(oneBack).present).toBe(initial);
		expect(redoHistory(oneBack).present).toBe(second);
	});
});
