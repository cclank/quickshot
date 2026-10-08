import { describe, expect, it } from "vitest";
import {
	WINDOWS_WINDOW_LIST_SCRIPT,
	getWindowsWindowListArguments,
	parseWindowList,
	toDisplayLocalWindows,
} from "./windowList";

describe("parseWindowList", () => {
	it("keeps well-formed entries and drops the rest", () => {
		const windows = parseWindowList(
			'\uFEFF[{"x":10,"y":20,"width":300,"height":200,"app":"Notes","title":"Todo"},' +
				'{"x":"bad","y":0,"width":10,"height":10},{"x":0,"y":0,"width":0,"height":5},null]',
		);
		expect(windows).toEqual([
			{ x: 10, y: 20, width: 300, height: 200, app: "Notes", title: "Todo" },
		]);
	});

	it("keeps a valid window id for single-window capture", () => {
		const [withId, badId] = parseWindowList(
			'[{"id":4821,"x":0,"y":0,"width":50,"height":50,"app":"A","title":""},' +
				'{"id":-3,"x":0,"y":0,"width":50,"height":50,"app":"B","title":""}]',
		);
		expect(withId.id).toBe(4821);
		expect(badId).not.toHaveProperty("id");
	});

	it("treats invalid output as no windows", () => {
		expect(parseWindowList("not json")).toEqual([]);
		expect(parseWindowList('{"x":1}')).toEqual([]);
		expect(parseWindowList("")).toEqual([]);
	});
});

describe("toDisplayLocalWindows", () => {
	const display = { x: 1440, y: 0, width: 1920, height: 1080 };

	it("converts to display-local coordinates and clips to the display", () => {
		expect(
			toDisplayLocalWindows(
				[
					{ x: 1400, y: -10, width: 400, height: 300, app: "A", title: "" },
					{ x: 100, y: 100, width: 300, height: 300, app: "Other display", title: "" },
				],
				display,
			),
		).toEqual([{ x: 0, y: 0, width: 360, height: 290, app: "A", title: "" }]);
	});

	it("keeps the front-to-back order", () => {
		const local = toDisplayLocalWindows(
			[
				{ x: 1500, y: 100, width: 200, height: 200, app: "front", title: "" },
				{ x: 1440, y: 0, width: 1920, height: 1080, app: "back", title: "" },
			],
			display,
		);
		expect(local.map((window) => window.app)).toEqual(["front", "back"]);
	});
});

describe("Windows window enumeration script", () => {
	it("is plain ASCII with a closed here-string", () => {
		expect(/^[\x00-\x7f]*$/.test(WINDOWS_WINDOW_LIST_SCRIPT)).toBe(true);
		expect(WINDOWS_WINDOW_LIST_SCRIPT).toMatch(/^\$source = @'$/m);
		expect(WINDOWS_WINDOW_LIST_SCRIPT).toMatch(/^'@$/m);
		expect(WINDOWS_WINDOW_LIST_SCRIPT).toContain('json.Append("{\\"x\\":")');
	});

	it("passes the process id and cache path as arguments", () => {
		expect(getWindowsWindowListArguments("C:\\t\\list.ps1", 42, "C:\\t\\list.dll").slice(-6)).toEqual([
			"-File",
			"C:\\t\\list.ps1",
			"-ExcludePid",
			"42",
			"-CachePath",
			"C:\\t\\list.dll",
		]);
	});
});
