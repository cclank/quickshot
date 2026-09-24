import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createScreenshotPathGenerator,
	writePngWithoutOverwrite,
} from "./screenshotFiles";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) =>
			rm(directory, { recursive: true, force: true }),
		),
	);
});

describe("quick-save filenames", () => {
	it("adds a sequence when multiple saves share the same millisecond", () => {
		const nextPath = createScreenshotPathGenerator(
			() => Date.UTC(2026, 6, 23, 12, 34, 56, 789),
		);
		expect(path.basename(nextPath("/tmp"))).toBe(
			"quickshot-2026-07-23_12-34-56-789-000.png",
		);
		expect(path.basename(nextPath("/tmp"))).toBe(
			"quickshot-2026-07-23_12-34-56-789-001.png",
		);
	});

	it("uses exclusive creation and retries without overwriting", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "quickshot-save-"));
		temporaryDirectories.push(directory);
		const existingPath = path.join(directory, "existing.png");
		const nextPath = path.join(directory, "next.png");
		await writeFile(existingPath, new Uint8Array([9]));
		const candidates = [existingPath, nextPath];

		const writtenPath = await writePngWithoutOverwrite(
			new Uint8Array([1, 2, 3]),
			() => candidates.shift() ?? nextPath,
		);

		expect(writtenPath).toBe(nextPath);
		expect(new Uint8Array(await readFile(existingPath))).toEqual(
			new Uint8Array([9]),
		);
		expect(new Uint8Array(await readFile(nextPath))).toEqual(
			new Uint8Array([1, 2, 3]),
		);
	});
});
