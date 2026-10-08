import { describe, expect, it } from "vitest";
import {
	DEFAULT_STYLE_SETTINGS,
	type StyleSettings,
	computeCompositionLayout,
	normalizeStyleSettings,
	resolveWatermarkPlacement,
} from "./composition";

const settings = (overrides: Partial<StyleSettings>): StyleSettings => ({
	...DEFAULT_STYLE_SETTINGS,
	...overrides,
});

describe("computeCompositionLayout", () => {
	it("returns the raw image when beautify is off", () => {
		const layout = computeCompositionLayout(800, 600, 2, settings({ beautify: false }));
		expect(layout).toMatchObject({ width: 800, height: 600, image: { x: 0, y: 0 } });
	});

	it("scales chrome by the capture pixel ratio", () => {
		const oneX = computeCompositionLayout(400, 300, 1, settings({ frame: "classic", padding: 40 }));
		const twoX = computeCompositionLayout(800, 600, 2, settings({ frame: "classic", padding: 40 }));
		expect(twoX.width).toBe(oneX.width * 2);
		expect(twoX.height).toBe(oneX.height * 2);
		expect(twoX.frame.titleBarHeight).toBe(oneX.frame.titleBarHeight * 2);
	});

	it("uses concentric corners around an inset image", () => {
		const layout = computeCompositionLayout(400, 300, 1, settings({ frame: "classic", radius: 10 }));
		const inset = layout.image.x - layout.frame.x;
		expect(layout.frame.radius).toBe(10 + inset);
		expect(layout.image.radii).toEqual([10, 10, 10, 10]);
	});

	it("keeps the image flush under a window title bar", () => {
		const layout = computeCompositionLayout(
			400,
			300,
			1,
			settings({ frame: "macos-dark", radius: 4 }),
		);
		expect(layout.image.x).toBe(layout.frame.x);
		expect(layout.image.y).toBe(layout.frame.y + layout.frame.titleBarHeight);
		expect(layout.image.radii[0]).toBe(0);
		expect(layout.image.radii[2]).toBe(layout.frame.radius);
	});

	it("expands the canvas to reach the aspect ratio and centres the window", () => {
		const layout = computeCompositionLayout(
			400,
			400,
			1,
			settings({ frame: "none", padding: 0, aspect: "16:9" }),
		);
		expect(layout.width / layout.height).toBeCloseTo(16 / 9, 2);
		expect(layout.height).toBe(400);
		expect(layout.frame.x).toBe(Math.round((layout.width - 400) / 2));
	});
});

describe("normalizeStyleSettings", () => {
	it("clamps values and falls back for unknown input", () => {
		const normalized = normalizeStyleSettings({
			padding: 999,
			frame: "unknown",
			watermark: { opacity: 5, color: "red" },
		});
		expect(normalized.padding).toBe(160);
		expect(normalized.frame).toBe(DEFAULT_STYLE_SETTINGS.frame);
		expect(normalized.watermark.opacity).toBe(24);
		expect(normalized.watermark.color).toBe("auto");
	});
});

describe("optical centring and signature placement", () => {
	it("lifts the window a little when a shadow sits below it", () => {
		const flat = computeCompositionLayout(800, 600, 2, settings({ padding: 56, shadow: 0 }));
		const lifted = computeCompositionLayout(800, 600, 2, settings({ padding: 56, shadow: 100 }));
		const flatBottom = flat.height - (flat.frame.y + flat.frame.h);
		const liftedBottom = lifted.height - (lifted.frame.y + lifted.frame.h);
		expect(flat.frame.y).toBe(flatBottom);
		expect(lifted.frame.y).toBeLessThan(flat.frame.y);
		expect(liftedBottom).toBeGreaterThan(lifted.frame.y);
	});

	it("signs in the margin only when there is room for it", () => {
		const watermark = { ...DEFAULT_STYLE_SETTINGS.watermark, enabled: true, text: "@me" };
		const roomy = computeCompositionLayout(800, 600, 2, settings({ padding: 56 }));
		const tight = computeCompositionLayout(800, 600, 2, settings({ padding: 4 }));
		const raw = computeCompositionLayout(800, 600, 2, settings({ beautify: false }));
		expect(resolveWatermarkPlacement(roomy, watermark)).toBe("margin");
		expect(resolveWatermarkPlacement(tight, watermark)).toBe("image");
		expect(resolveWatermarkPlacement(raw, watermark)).toBe("image");
		expect(resolveWatermarkPlacement(roomy, { ...watermark, placement: "image" })).toBe("image");
	});
});
