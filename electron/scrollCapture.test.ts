import { describe, expect, it } from "vitest";
import {
	SCROLL_MAX_HEIGHT,
	SCROLL_PANEL_SIZE,
	parseScrollProgress,
	placeScrollPanel,
	scrollMaxHeight,
	scrollRegionFromSelection,
	scrollRingLayout,
} from "./scrollCapture";

const display = { x: 0, y: 0, width: 1512, height: 982 };
const retina = { width: 3024, height: 1964 };

describe("scrolling capture area", () => {
	it("converts the overlay's pixels to display and global points", () => {
		expect(scrollRegionFromSelection({ x: 200, y: 300, width: 1001, height: 1200 }, retina, display)).toEqual({
			points: { x: 100, y: 150, width: 500.5, height: 600 },
			global: { x: 100, y: 150, width: 500.5, height: 600 },
			pixels: { width: 1001, height: 1200 },
		});
		const second = { x: 1512, y: -200, width: 1920, height: 1080 };
		expect(
			scrollRegionFromSelection({ x: 0, y: 0, width: 800, height: 600 }, { width: 1920, height: 1080 }, second)?.global,
		).toEqual({ x: 1512, y: -200, width: 800, height: 600 });
	});

	it("rejects malformed, outside and tiny selections", () => {
		for (const rect of [
			null,
			{ x: 0, y: 0, width: 100.5, height: 400 },
			{ x: -1, y: 0, width: 100, height: 400 },
			{ x: 3000, y: 0, width: 100, height: 400 },
			{ x: 0, y: 0, width: 20, height: 400 },
			{ x: 0, y: 0, width: 400, height: 30 },
		]) {
			expect(scrollRegionFromSelection(rect, retina, display)).toBeNull();
		}
	});

	it("keeps the image within the editor's canvas limits", () => {
		expect(scrollMaxHeight(1600)).toBe(SCROLL_MAX_HEIGHT);
		expect(scrollMaxHeight(10_000)).toBe(10_000);
	});
});

describe("scrolling capture panel", () => {
	const workArea = { x: 0, y: 33, width: 1512, height: 949 };

	it("sits to the right of the area when there is room, else to the left", () => {
		expect(placeScrollPanel({ x: 200, y: 100, width: 600, height: 700 }, workArea)).toEqual({ x: 814, y: 100 });
		expect(placeScrollPanel({ x: 700, y: 100, width: 700, height: 700 }, workArea)).toEqual({
			x: 700 - 14 - SCROLL_PANEL_SIZE.width,
			y: 100,
		});
	});

	it("goes below or above a wide area", () => {
		expect(placeScrollPanel({ x: 100, y: 60, width: 1300, height: 400 }, workArea)).toEqual({
			x: 1400 - SCROLL_PANEL_SIZE.width,
			y: 474,
		});
		expect(placeScrollPanel({ x: 100, y: 560, width: 1300, height: 400 }, workArea)).toEqual({
			x: 1400 - SCROLL_PANEL_SIZE.width,
			y: 560 - 14 - SCROLL_PANEL_SIZE.height,
		});
	});

	it("tucks into the corner of an area that fills the screen", () => {
		expect(placeScrollPanel({ x: 0, y: 0, width: 1512, height: 982 }, workArea)).toEqual({
			x: 1504 - 16 - SCROLL_PANEL_SIZE.width,
			y: 974 - 16 - SCROLL_PANEL_SIZE.height,
		});
	});

	it("stays on screen next to an area near the top", () => {
		expect(placeScrollPanel({ x: 100, y: 0, width: 500, height: 300 }, workArea).y).toBe(41);
	});
});

describe("scrolling capture ring", () => {
	it("draws just outside the area", () => {
		expect(scrollRingLayout({ x: 100, y: 150, width: 500.5, height: 600 }, display)).toEqual({
			window: { x: 94, y: 144, width: 513, height: 612 },
			ring: { x: 2, y: 2, width: 509, height: 608 },
		});
	});

	it("moves inside where the area meets the display edge", () => {
		expect(scrollRingLayout({ x: 0, y: 0, width: 1512, height: 982 }, display)).toEqual({
			window: { x: 0, y: 0, width: 1512, height: 982 },
			ring: { x: 0, y: 0, width: 1512, height: 982 },
		});
	});
});

describe("scrolling capture progress", () => {
	it("reads the agent's scroll events", () => {
		expect(parseScrollProgress({ event: "scroll", status: "capturing", height: 4210, width: 1600, preview: 3 })).toEqual({
			status: "capturing",
			height: 4210,
			width: 1600,
			preview: 3,
		});
		expect(parseScrollProgress({ event: "stopped" })).toBeNull();
		expect(parseScrollProgress({ event: "scroll", status: "finishing", height: 1, width: 1, preview: 0 })).toBeNull();
		expect(parseScrollProgress({ event: "scroll", status: "lost", height: -1, width: 1, preview: 0 })).toBeNull();
	});
});
