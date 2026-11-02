import { describe, expect, it } from "vitest";
import { sanitizeAnnotations } from "./annotationPayload";

describe("sanitizeAnnotations", () => {
	it("accepts focus annotations with bounded settings", () => {
		const result = sanitizeAnnotations([
			{ id: "mag", kind: "magnifier", x: 1, y: 2, w: 80, h: 60, sourceX: 40, sourceY: 30, zoom: 2, color: "#ff3b30", width: 4 },
			{ id: "spot", kind: "spotlight", x: 5, y: 6, w: 90, h: 70, shape: "ellipse", opacity: 0.5 },
		]);
		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({ kind: "magnifier", zoom: 2, color: "#FF3B30" });
		expect(result[1]).toMatchObject({ kind: "spotlight", shape: "ellipse", opacity: 0.5 });
	});

	it("keeps a well-formed rectangle and uppercases its colour", () => {
		const [mark] = sanitizeAnnotations([
			{ id: "a1", kind: "rect", x: 1, y: 2, w: 30, h: 40, color: "#ff3b30", width: 4, fill: "none" },
		]);
		expect(mark).toEqual({
			id: "a1",
			kind: "rect",
			x: 1,
			y: 2,
			w: 30,
			h: 40,
			color: "#FF3B30",
			width: 4,
			fill: "none",
		});
	});

	it("drops marks with an unknown kind or a bad id", () => {
		expect(sanitizeAnnotations([{ id: "a1", kind: "wat" }])).toEqual([]);
		expect(sanitizeAnnotations([{ id: "bad id!", kind: "rect", x: 0, y: 0, w: 1, h: 1, color: "#000000", width: 1, fill: "none" }])).toEqual([]);
	});

	it("clamps out-of-range coordinates and sizes", () => {
		const [mark] = sanitizeAnnotations([
			{ id: "a1", kind: "arrow", from: { x: 9e9, y: -9e9 }, to: { x: 0, y: 0 }, color: "#0a84ff", width: 9e9 },
		]);
		expect(mark).toMatchObject({ from: { x: 200_000, y: -200_000 }, width: 10_000 });
	});

	it("rejects malformed payloads and non-arrays", () => {
		expect(sanitizeAnnotations("nope")).toEqual([]);
		expect(sanitizeAnnotations(null)).toEqual([]);
		expect(sanitizeAnnotations([null, 3, "x"])).toEqual([]);
	});

	it("keeps every point of a pen and rejects a bad one", () => {
		const [mark] = sanitizeAnnotations([
			{ id: "p1", kind: "pen", points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], color: "#ffffff", width: 2 },
		]);
		expect(mark).toMatchObject({ kind: "pen", points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] });
		expect(
			sanitizeAnnotations([{ id: "p2", kind: "pen", points: [{ x: 0, y: 0 }, { x: "5", y: 5 }], color: "#ffffff", width: 2 }]),
		).toEqual([]);
	});

	it("drops duplicate ids and enforces the count limit", () => {
		const many = Array.from({ length: 250 }, (_, index) => ({
			id: `a${index}`,
			kind: "ellipse",
			x: 0,
			y: 0,
			w: 5,
			h: 5,
			color: "#34c759",
			width: 2,
			fill: "soft",
		}));
		expect(sanitizeAnnotations(many)).toHaveLength(200);
		const [first, second] = sanitizeAnnotations([
			{ id: "dup", kind: "ellipse", x: 0, y: 0, w: 5, h: 5, color: "#34c759", width: 2, fill: "soft" },
			{ id: "dup", kind: "ellipse", x: 1, y: 1, w: 5, h: 5, color: "#34c759", width: 2, fill: "soft" },
		]);
		expect(first).toBeDefined();
		expect(second).toBeUndefined();
	});

	it("keeps text marks with their style and truncates long text", () => {
		const [mark] = sanitizeAnnotations([
			{ id: "t1", kind: "text", x: 3, y: 4, text: "hi", color: "#ffcc00", size: 20, style: "pill" },
		]);
		expect(mark).toMatchObject({ kind: "text", text: "hi", style: "pill", size: 20 });
		const long = "x".repeat(5000);
		const [truncated] = sanitizeAnnotations([
			{ id: "t2", kind: "text", x: 0, y: 0, text: long, color: "#ffcc00", size: 20, style: "plain" },
		]);
		expect((truncated as { text: string }).text).toHaveLength(4000);
	});
});
