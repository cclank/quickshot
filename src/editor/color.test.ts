import { describe, expect, it } from "vitest";
import { relativeLuminance, rgbToHex, toneOnTone } from "./color";

describe("toneOnTone", () => {
	it("darkens light backgrounds while keeping their hue", () => {
		const shade = toneOnTone({ r: 254, g: 200, b: 80 });
		expect(relativeLuminance(rgbToHex(shade))).toBeLessThan(0.35);
		expect(shade.r).toBeGreaterThan(shade.g);
		expect(shade.g).toBeGreaterThan(shade.b);
	});

	it("lightens dark backgrounds", () => {
		const tint = toneOnTone({ r: 20, g: 30, b: 60 });
		expect(relativeLuminance(rgbToHex(tint))).toBeGreaterThan(0.7);
		expect(tint.b).toBeGreaterThan(tint.r);
	});
});
