import { describe, expect, it } from "vitest";
import { normalizeStylePresets } from "./persistence";

describe("normalizeStylePresets", () => {
	it("keeps valid named presets and normalizes their styles", () => {
		const result = normalizeStylePresets([
			{ id: "tutorial", name: "  Product   tutorial  ", settings: { padding: 999, beautify: false } },
		]);
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("Product tutorial");
		expect(result[0].settings.padding).toBe(160);
		expect(result[0].settings.beautify).toBe(false);
	});

	it("rejects invalid and duplicate records", () => {
		const settings = { beautify: true };
		expect(normalizeStylePresets([
			{ id: "same", name: "One", settings },
			{ id: "same", name: "Two", settings },
			{ id: "bad id", name: "Bad", settings },
			{ id: "empty", name: "   ", settings },
		])).toHaveLength(1);
	});
});
