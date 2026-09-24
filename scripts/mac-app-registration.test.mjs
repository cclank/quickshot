import { describe, expect, it, vi } from "vitest";
import { registerOnlyInstalledQuickShot } from "./mac-app-registration.mjs";

const target = "/Users/example/Applications/QuickShot.app";
const old = "/Applications/QuickShot.app.old";

function mockRegistration(before, after) {
	let listings = 0;
	return vi.fn(async (command) => {
		if (command.endsWith("PlistBuddy")) return { stdout: "com.quickshot.app\n" };
		if (command === "/usr/bin/swift") return { stdout: JSON.stringify(listings++ === 0 ? before : after) };
		return { stdout: "" };
	});
}

describe("QuickShot application registration", () => {
	it("unregisters duplicate bundles without removing the installed registration", async () => {
		const run = mockRegistration({ preferred: old, registered: [old, target, old] }, { preferred: target, registered: [target] });
		const result = await registerOnlyInstalledQuickShot(target, run);
		expect(result.removedRegistrations).toEqual([old]);
		expect(run.mock.calls.filter(([, args]) => args[0] === "-u").map(([, args]) => args[1])).toEqual([old]);
	});

	it("verifies the target identifier before changing any registrations", async () => {
		const run = vi.fn().mockResolvedValue({ stdout: "com.example.other" });
		await expect(registerOnlyInstalledQuickShot(target, run)).rejects.toThrow("Unexpected installed");
		expect(run).toHaveBeenCalledTimes(1);
	});

	it("rejects unresolved duplicate registrations", async () => {
		const state = { preferred: target, registered: [target, old] };
		await expect(registerOnlyInstalledQuickShot(target, mockRegistration(state, state))).rejects.toThrow("still ambiguous");
	});

	it("rejects malformed paths before unregistering anything", async () => {
		const run = mockRegistration({ registered: ["relative.app"] }, {});
		await expect(registerOnlyInstalledQuickShot(target, run)).rejects.toThrow("Invalid QuickShot");
		expect(run.mock.calls.some(([, args]) => args[0] === "-u")).toBe(false);
	});
});
