import { describe, expect, it } from "vitest";
import { smartRedactions } from "./smartRedact";
import type { Annotation } from "./types";

const region = { x: 10, y: 20, w: 60, h: 30 };

describe("smart redactions", () => {
	it("covers each region with the chosen mode", () => {
		const [redaction] = smartRedactions([region], [], "blur", 20);
		expect(redaction).toMatchObject({ kind: "redact", ...region, mode: "blur", strength: 20 });
		expect(redaction.id).toBeTruthy();
	});

	it("scales the strength with tall text", () => {
		expect(smartRedactions([{ ...region, h: 120 }], [], "pixelate", 12)[0].strength).toBe(36);
	});

	it("skips regions an earlier redaction already covers, drawn in any direction", () => {
		const existing: Annotation[] = [
			{ id: "a", kind: "redact", x: 75, y: 55, w: -70, h: -40, mode: "pixelate", strength: 10 },
			{ id: "b", kind: "rect", x: 0, y: 0, w: 500, h: 500, color: "#000", width: 2, fill: "solid" },
		];
		const elsewhere = { x: 200, y: 20, w: 60, h: 30 };
		expect(smartRedactions([region, elsewhere], existing, "pixelate", 10).map(({ x }) => x)).toEqual([200]);
	});

	it("still covers a region a redaction only partly hides", () => {
		const existing: Annotation[] = [{ id: "a", kind: "redact", x: 10, y: 20, w: 30, h: 30, mode: "pixelate", strength: 10 }];
		expect(smartRedactions([region], existing, "pixelate", 10)).toHaveLength(1);
	});
});
