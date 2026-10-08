import { describe, expect, it } from "vitest";
import {
	HISTORY_COALESCE_MS,
	createHistory,
	pushHistory,
	redoHistory,
	undoHistory,
} from "./history";

describe("history", () => {
	it("undoes and redoes in order", () => {
		let history = createHistory(0);
		history = pushHistory(history, 1, { now: 0 });
		history = pushHistory(history, 2, { now: 5_000 });
		history = undoHistory(history);
		expect(history.present).toBe(1);
		history = redoHistory(history);
		expect(history.present).toBe(2);
		expect(undoHistory(undoHistory(undoHistory(history))).present).toBe(0);
	});

	it("coalesces rapid edits that share a key", () => {
		let history = createHistory("a");
		history = pushHistory(history, "b", { coalesceKey: "color", now: 0 });
		history = pushHistory(history, "c", { coalesceKey: "color", now: 100 });
		history = pushHistory(history, "d", {
			coalesceKey: "color",
			now: 100 + HISTORY_COALESCE_MS + 1,
		});
		expect(history.past).toEqual(["a", "c"]);
		expect(undoHistory(history).present).toBe("c");
	});

	it("clears the redo stack on a new edit", () => {
		let history = pushHistory(createHistory(0), 1, { now: 0 });
		history = undoHistory(history);
		history = pushHistory(history, 5, { now: 10_000 });
		expect(history.future).toEqual([]);
		expect(redoHistory(history)).toBe(history);
	});
});
