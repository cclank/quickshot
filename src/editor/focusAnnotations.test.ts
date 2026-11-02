import { describe, expect, it } from "vitest";
import { resizeAnnotation, translateAnnotation } from "./annotations";
import { createDraft, updateDraft } from "./drawing";
import { DEFAULT_TOOL_STYLE } from "./presets";
import type { MagnifierAnnotation, TextMeasurer } from "./types";

const measure: TextMeasurer = () => ({ w: 0, h: 0, lines: [], lineHeight: 0, padX: 0, padY: 0, ascent: 0 });

describe("focus annotations", () => {
	it("creates a magnifier with a fixed source point and movable display", () => {
		const draft = createDraft("magnifier", { x: 10, y: 20 }, DEFAULT_TOOL_STYLE, 1);
		expect(draft?.kind).toBe("magnifier");
		const drawn = updateDraft(draft!, { x: 10, y: 20 }, { x: 110, y: 80 }, false, 1, []);
		expect(drawn).toMatchObject({ x: 10, y: 20, w: 100, h: 60, sourceX: 60, sourceY: 50, zoom: 2 });
		const moved = translateAnnotation(drawn, 40, 30) as MagnifierAnnotation;
		expect(moved).toMatchObject({ x: 50, y: 50, sourceX: 100, sourceY: 80 });
	});

	it("resizes spotlight bounds without changing its style", () => {
		const draft = createDraft("spotlight", { x: 0, y: 0 }, DEFAULT_TOOL_STYLE, 1)!;
		const drawn = updateDraft(draft, { x: 0, y: 0 }, { x: 100, y: 60 }, false, 1, []);
		const resized = resizeAnnotation(drawn, "se", { x: 140, y: 90 }, { keepAspect: false, measure });
		expect(resized).toMatchObject({ kind: "spotlight", w: 140, h: 90, shape: "ellipse", opacity: 0.5 });
	});
});
