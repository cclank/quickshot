import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const identifier = "com.quickshot.app";
const launchServices = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
const listScript = path.join(import.meta.dirname, "list-mac-app-registrations.swift");

export async function listQuickShotRegistrations(run = exec) {
	const { stdout } = await run("/usr/bin/swift", [listScript, identifier]);
	const result = JSON.parse(stdout);
	if (!Array.isArray(result.registered) || result.registered.some((entry) => typeof entry !== "string" || !path.isAbsolute(entry))) {
		throw new Error("Invalid QuickShot application registration response");
	}
	return result;
}

export async function registerOnlyInstalledQuickShot(target, run = exec) {
	const { stdout } = await run("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIdentifier", path.join(target, "Contents/Info.plist")]);
	if (stdout.trim() !== identifier) throw new Error("Unexpected installed application identifier");
	const before = await listQuickShotRegistrations(run);
	const removedRegistrations = [...new Set(before.registered)].filter((entry) => entry !== target);
	for (const appPath of removedRegistrations) {
		await run(launchServices, ["-u", appPath]);
	}
	await run(launchServices, ["-f", target]);
	const after = await listQuickShotRegistrations(run);
	if (after.preferred !== target || after.registered.some((entry) => entry !== target) || !after.registered.includes(target)) {
		throw new Error(`QuickShot registration is still ambiguous: ${JSON.stringify(after)}`);
	}
	return { target, removedRegistrations, ...after };
}
