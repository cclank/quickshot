import { describe, expect, it } from "vitest";
import { bundleFromExecutable, shouldHandOver } from "./handOver";

const own = { bundle: "/Applications/QuickShot.app", launchStamp: { ino: 10, mtimeMs: 1_000 } };

describe("bundleFromExecutable", () => {
	it("finds the .app bundle of an executable", () => {
		expect(bundleFromExecutable("/Applications/QuickShot.app/Contents/MacOS/QuickShot")).toBe(
			"/Applications/QuickShot.app",
		);
		expect(bundleFromExecutable("/usr/bin/node")).toBeNull();
		expect(bundleFromExecutable("QuickShot.app/Contents/MacOS/QuickShot")).toBeNull();
		expect(bundleFromExecutable(undefined)).toBeNull();
	});
});

describe("shouldHandOver", () => {
	it("keeps running when the same, unchanged app is opened again", () => {
		expect(shouldHandOver(own, { bundle: own.bundle, stamp: { ino: 10, mtimeMs: 1_000 } })).toBe(false);
	});

	it("gives way when the app was replaced on disk since launch", () => {
		expect(shouldHandOver(own, { bundle: own.bundle, stamp: { ino: 11, mtimeMs: 2_000 } })).toBe(true);
	});

	it("gives way to a newer copy elsewhere but not to an older one", () => {
		const elsewhere = "/Users/me/Applications/QuickShot.app";
		expect(shouldHandOver(own, { bundle: elsewhere, stamp: { ino: 99, mtimeMs: 5_000 } })).toBe(true);
		expect(shouldHandOver(own, { bundle: elsewhere, stamp: { ino: 99, mtimeMs: 500 } })).toBe(false);
		expect(shouldHandOver(own, { bundle: elsewhere, stamp: null })).toBe(false);
	});
});
