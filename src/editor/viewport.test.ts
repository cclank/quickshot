import { describe, expect, it } from "vitest";
import { clampPan, clampZoom, panAfterZoom, visibleStageRect } from "./viewport";

describe("editor viewport", () => {
	it("centres fitting axes and lets large content reach both edges", () => {
		expect(clampPan({ x: 500, y: -20000 }, { w: 800, h: 30000 }, { w: 1000, h: 600 }))
			.toEqual({ x: 0, y: -14700 });
		expect(clampPan({ x: 20000, y: 20000 }, { w: 1600, h: 30000 }, { w: 1000, h: 600 }))
			.toEqual({ x: 300, y: 14700 });
	});

	it("keeps the source point under a zoom anchor fixed", () => {
		const pan = { x: 20, y: -60 };
		const anchor = { x: 100, y: 70 };
		const next = panAfterZoom(pan, anchor, 2.5);
		expect((anchor.x - next.x) / 2.5).toBe(anchor.x - pan.x);
		expect((anchor.y - next.y) / 2.5).toBe(anchor.y - pan.y);
	});

	it("renders only a viewport-sized slice of a full-height scrolling capture", () => {
		expect(visibleStageRect({ x: -200, y: -14300 }, { w: 1200, h: 30000 }, { w: 900, h: 700 }))
			.toEqual({ x: 200, y: 14300, w: 900, h: 700 });
		expect(visibleStageRect({ x: 100, y: 80 }, { w: 600, h: 400 }, { w: 900, h: 700 }))
			.toEqual({ x: 0, y: 0, w: 600, h: 400 });
	});

	it("bounds manual zoom without limiting automatic fit", () => {
		expect(clampZoom(0)).toBe(0.01);
		expect(clampZoom(100)).toBe(8);
		expect(clampZoom(NaN)).toBe(1);
	});
});
