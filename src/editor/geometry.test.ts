import { describe, expect, it } from "vitest";
import {
	constrainSquare,
	distanceToEllipseOutline,
	distanceToSegment,
	simplifyPath,
	snapAngle,
} from "./geometry";

describe("geometry", () => {
	it("measures distance to a segment, clamping to its ends", () => {
		expect(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
		expect(distanceToSegment({ x: 13, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
	});

	it("approximates the distance to an ellipse outline", () => {
		const rect = { x: 0, y: 0, w: 200, h: 100 };
		expect(distanceToEllipseOutline({ x: 200, y: 50 }, rect)).toBeCloseTo(0);
		expect(distanceToEllipseOutline({ x: 190, y: 50 }, rect)).toBeCloseTo(10);
	});

	it("snaps angles to 45 degree steps", () => {
		const snapped = snapAngle({ x: 0, y: 0 }, { x: 100, y: 8 });
		expect(snapped.y).toBeCloseTo(0);
		expect(snapped.x).toBeCloseTo(Math.hypot(100, 8));
	});

	it("constrains rectangles to squares in the drag direction", () => {
		expect(constrainSquare({ x: 10, y: 10 }, { x: -30, y: 20 })).toEqual({ x: -30, y: 50 });
	});

	it("simplifies straight runs while keeping corners", () => {
		const points = [
			{ x: 0, y: 0 },
			{ x: 5, y: 0.1 },
			{ x: 10, y: 0 },
			{ x: 10, y: 10 },
		];
		expect(simplifyPath(points, 0.5)).toEqual([
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 10, y: 10 },
		]);
	});
});
