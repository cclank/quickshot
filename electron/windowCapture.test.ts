import { describe, expect, it } from "vitest";
import { findOpaqueBounds, getWindowCaptureArguments } from "./windowCapture";

function bitmap(width: number, height: number, opaque: (x: number, y: number) => number) {
	const data = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) data[(y * width + x) * 4 + 3] = opaque(x, y);
	}
	return data;
}

describe("findOpaqueBounds", () => {
	it("trims a transparent frame around the window", () => {
		const data = bitmap(20, 12, (x, y) => (x >= 3 && x < 17 && y >= 2 && y < 10 ? 255 : 0));
		expect(findOpaqueBounds(data, 20, 12)).toEqual({ x: 3, y: 2, width: 14, height: 8 });
	});

	it("keeps rounded corners inside the bounds", () => {
		// Only the edges' midpoints are opaque, as with a heavily rounded window.
		const data = bitmap(10, 10, (x, y) => ((x === 0 && y === 5) || (x === 9 && y === 4) || (y === 0 && x === 5) || (y === 9 && x === 5) ? 255 : 0));
		expect(findOpaqueBounds(data, 10, 10)).toEqual({ x: 0, y: 0, width: 10, height: 10 });
	});

	it("ignores faint residue below the threshold", () => {
		const data = bitmap(8, 8, (x, y) => (x === 0 ? 5 : x >= 2 && x < 6 && y >= 2 && y < 6 ? 200 : 0));
		expect(findOpaqueBounds(data, 8, 8)).toEqual({ x: 2, y: 2, width: 4, height: 4 });
	});

	it("returns null for a fully transparent or malformed bitmap", () => {
		expect(findOpaqueBounds(bitmap(4, 4, () => 0), 4, 4)).toBeNull();
		expect(findOpaqueBounds(new Uint8Array(3), 4, 4)).toBeNull();
	});
});

describe("getWindowCaptureArguments", () => {
	it("captures one window without its shadow and silently", () => {
		expect(getWindowCaptureArguments(4821, "/tmp/w.png")).toEqual([
			"-l",
			"4821",
			"-o",
			"-x",
			"-t",
			"png",
			"/tmp/w.png",
		]);
	});
});
