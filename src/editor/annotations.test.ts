import { describe, expect, it } from "vitest";
import {
	findAnnotationAt,
	getHandles,
	hitTestHandle,
	isMeaningfulAnnotation,
	nextCounterValue,
	resizeAnnotation,
	resizeRect,
	translateAnnotation,
} from "./annotations";
import type { Annotation, TextAnnotation, TextMeasurer } from "./types";

const measure: TextMeasurer = (annotation: TextAnnotation) => {
	const lines = annotation.text.split("\n");
	const lineHeight = annotation.size * 1.3;
	return {
		w: Math.max(...lines.map((line) => line.length)) * annotation.size * 0.6,
		h: lines.length * lineHeight,
		lines,
		lineHeight,
		padX: 0,
		padY: 0,
		ascent: annotation.size * 0.8,
	};
};

const outlineRect: Annotation = {
	id: "outline",
	kind: "rect",
	x: 0,
	y: 0,
	w: 400,
	h: 300,
	color: "#FF3B30",
	width: 4,
	fill: "none",
};

const innerArrow: Annotation = {
	id: "arrow",
	kind: "arrow",
	from: { x: 100, y: 100 },
	to: { x: 200, y: 100 },
	color: "#FF3B30",
	width: 4,
};

describe("findAnnotationAt", () => {
	it("hits an outline shape on its stroke", () => {
		expect(
			findAnnotationAt([outlineRect], { x: 1, y: 150 }, 4, measure)?.annotation.id,
		).toBe("outline");
	});

	it("ignores the empty interior unless asked", () => {
		expect(findAnnotationAt([outlineRect], { x: 200, y: 200 }, 4, measure)).toBeNull();
		expect(
			findAnnotationAt([outlineRect], { x: 200, y: 200 }, 4, measure, {
				includeInside: true,
			})?.part,
		).toBe("inside");
	});

	it("prefers strong hits on nested shapes over the enclosing outline", () => {
		const hit = findAnnotationAt(
			[innerArrow, outlineRect],
			{ x: 150, y: 101 },
			4,
			measure,
			{ includeInside: true },
		);
		expect(hit?.annotation.id).toBe("arrow");
		expect(hit?.part).toBe("stroke");
	});

	it("prefers the smallest enclosing outline for weak hits", () => {
		const small: Annotation = { ...outlineRect, id: "small", x: 50, y: 50, w: 100, h: 100 };
		const hit = findAnnotationAt([small, outlineRect], { x: 100, y: 100 }, 2, measure, {
			includeInside: true,
		});
		expect(hit?.annotation.id).toBe("small");
	});

	it("treats filled shapes, text and counters as solid bodies", () => {
		const text: Annotation = {
			id: "text",
			kind: "text",
			x: 10,
			y: 10,
			text: "hello",
			color: "#fff",
			size: 20,
			style: "plain",
		};
		const counter: Annotation = {
			id: "counter",
			kind: "counter",
			x: 300,
			y: 300,
			value: 1,
			color: "#fff",
			size: 12,
		};
		expect(findAnnotationAt([text], { x: 30, y: 20 }, 2, measure)?.part).toBe("body");
		expect(findAnnotationAt([counter], { x: 305, y: 305 }, 2, measure)?.part).toBe("body");
	});
});

describe("resizeRect", () => {
	it("moves only the dragged edges and normalizes flips", () => {
		expect(resizeRect({ x: 10, y: 10, w: 100, h: 50 }, "se", { x: 60, y: 40 }, false)).toEqual({
			x: 10,
			y: 10,
			w: 50,
			h: 30,
		});
		expect(resizeRect({ x: 10, y: 10, w: 100, h: 50 }, "e", { x: 0, y: 999 }, false)).toEqual({
			x: 0,
			y: 10,
			w: 10,
			h: 50,
		});
	});

	it("keeps the aspect ratio from the opposite corner", () => {
		const next = resizeRect({ x: 0, y: 0, w: 200, h: 100 }, "se", { x: 400, y: 120 }, true);
		expect(next).toEqual({ x: 0, y: 0, w: 400, h: 200 });
		const fromTopLeft = resizeRect({ x: 0, y: 0, w: 200, h: 100 }, "nw", { x: 100, y: 90 }, true);
		expect(fromTopLeft.x + fromTopLeft.w).toBe(200);
		expect(fromTopLeft.y + fromTopLeft.h).toBe(100);
		expect(fromTopLeft.w / fromTopLeft.h).toBeCloseTo(2);
	});
});

describe("resizeAnnotation", () => {
	it("drags arrow endpoints and snaps with the modifier", () => {
		const moved = resizeAnnotation(innerArrow, "end", { x: 300, y: 104 }, {
			keepAspect: true,
			measure,
		});
		expect(moved.kind === "arrow" && moved.to.y).toBeCloseTo(100);
	});

	it("scales text from the opposite corner", () => {
		const text: TextAnnotation = {
			id: "t",
			kind: "text",
			x: 0,
			y: 0,
			text: "abcd",
			color: "#fff",
			size: 20,
			style: "plain",
		};
		const box = measure(text);
		const next = resizeAnnotation(text, "se", { x: box.w * 2, y: box.h * 2 }, {
			keepAspect: false,
			measure,
		}) as TextAnnotation;
		expect(next.size).toBe(40);
		expect(next.x).toBe(0);
		const fromTopLeft = resizeAnnotation(text, "nw", { x: box.w / 2, y: box.h / 2 }, {
			keepAspect: false,
			measure,
		}) as TextAnnotation;
		expect(fromTopLeft.size).toBe(10);
		expect(fromTopLeft.x + measure(fromTopLeft).w).toBeCloseTo(box.w);
	});

	it("scales freehand strokes into the new bounds", () => {
		const pen: Annotation = {
			id: "pen",
			kind: "pen",
			points: [
				{ x: 0, y: 0 },
				{ x: 100, y: 50 },
			],
			color: "#fff",
			width: 2,
		};
		const next = resizeAnnotation(pen, "se", { x: 200, y: 100 }, {
			keepAspect: false,
			measure,
		});
		expect(next.kind === "pen" && next.points[1]).toEqual({ x: 200, y: 100 });
	});
});

describe("handles and helpers", () => {
	it("exposes eight handles for boxes and two for segments", () => {
		expect(getHandles(outlineRect, measure)).toHaveLength(8);
		expect(getHandles(innerArrow, measure).map((handle) => handle.id)).toEqual([
			"start",
			"end",
		]);
		expect(hitTestHandle(getHandles(outlineRect, measure), { x: 398, y: 302 }, 6)).toBe("se");
	});

	it("translates every kind of geometry", () => {
		expect(translateAnnotation(innerArrow, 5, -5)).toMatchObject({
			from: { x: 105, y: 95 },
			to: { x: 205, y: 95 },
		});
	});

	it("drops accidental clicks and numbers counters sequentially", () => {
		expect(isMeaningfulAnnotation({ ...outlineRect, w: 1, h: 1 })).toBe(false);
		expect(isMeaningfulAnnotation(innerArrow)).toBe(true);
		expect(
			nextCounterValue([
				{ id: "1", kind: "counter", x: 0, y: 0, value: 3, color: "#fff", size: 10 },
				outlineRect,
			]),
		).toBe(4);
	});
});
