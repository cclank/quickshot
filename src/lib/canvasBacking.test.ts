import { describe, expect, it } from "vitest";
import { calculateCanvasBackingSize } from "./canvasBacking";

const MAX_DIMENSION = 3072;
const MAX_PIXELS = 6_000_000;

describe("calculateCanvasBackingSize", () => {
	it("preserves normal preview sharpness at device scale", () => {
		expect(
			calculateCanvasBackingSize(800, 450, 2, MAX_DIMENSION, MAX_PIXELS),
		).toEqual({ width: 1600, height: 900 });
	});

	it("supports a 2x preview backing on a 1x display", () => {
		const minimumPreviewPixelRatio = 2;
		expect(
			calculateCanvasBackingSize(
				951,
				552,
				Math.max(minimumPreviewPixelRatio, 1),
				MAX_DIMENSION,
				MAX_PIXELS,
			),
		).toEqual({ width: 1902, height: 1104 });
	});

	it.each([1, 2])(
		"caps a 5K preview at DPR %i without changing its aspect ratio",
		(devicePixelRatio) => {
			const result = calculateCanvasBackingSize(
				5120,
				2880,
				devicePixelRatio,
				MAX_DIMENSION,
				MAX_PIXELS,
			);

			expect(result).not.toBeNull();
			expect(result!.width).toBeLessThanOrEqual(MAX_DIMENSION);
			expect(result!.height).toBeLessThanOrEqual(MAX_DIMENSION);
			expect(result!.width * result!.height).toBeLessThanOrEqual(MAX_PIXELS);
			expect(result!.width / result!.height).toBeCloseTo(16 / 9, 2);
		},
	);

	it("rejects a canvas without a visible layout size", () => {
		expect(
			calculateCanvasBackingSize(0, 450, 2, MAX_DIMENSION, MAX_PIXELS),
		).toBeNull();
	});
});
