import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	MAC_INSTALL_SCRIPT,
	isAllowedUpdateUrl,
	isNewerVersion,
	newestRelease,
	normalizeSha256,
	releaseFromFeed,
	releaseFromGitHub,
	updateTarget,
	versionParts,
} from "./updates";

const SHA = "ff33df8fa87b0d1e9d2b1d7b024709e08e61fb5bc39790c5998c70ce642d3311";

describe("update versions", () => {
	it("compares release versions and ignores anything else", () => {
		expect(versionParts("v1.12.0")).toEqual([1, 12, 0]);
		expect(versionParts("1.3.0-beta.1")).toBeNull();
		expect(isNewerVersion("v1.10.0", "1.9.9")).toBe(true);
		expect(isNewerVersion("v1.2.0", "1.2.0")).toBe(false);
		expect(isNewerVersion("v1.1.9", "1.2.0")).toBe(false);
		expect(isNewerVersion("v2.0.0-rc", "1.2.0")).toBe(false);
	});

	it("knows which installer each build takes", () => {
		expect(updateTarget("darwin", "arm64")).toBe("mac-arm64");
		expect(updateTarget("darwin", "x64")).toBe("mac-x64");
		expect(updateTarget("win32", "x64")).toBe("win-x64");
		expect(updateTarget("win32", "ia32")).toBeNull();
		expect(updateTarget("linux", "x64")).toBeNull();
	});

	it("accepts only well-formed SHA-256 digests", () => {
		expect(normalizeSha256(`sha256:${SHA.toUpperCase()}`)).toBe(SHA);
		expect(normalizeSha256("abc")).toBeNull();
	});
});

describe("update hosts", () => {
	it("allows only HTTPS on QuickShot's hosts", () => {
		expect(isAllowedUpdateUrl("https://dl.lanshuagent.com/quickshot/latest.json", "metadata")).toBe(true);
		expect(isAllowedUpdateUrl("https://api.github.com/repos/cclank/quickshot/releases/latest", "metadata")).toBe(true);
		expect(isAllowedUpdateUrl("http://dl.lanshuagent.com/quickshot/latest.json", "metadata")).toBe(false);
		expect(isAllowedUpdateUrl("https://evil.example/QuickShot.dmg", "download")).toBe(false);
		expect(isAllowedUpdateUrl("https://user:pw@github.com/x.dmg", "download")).toBe(false);
		expect(isAllowedUpdateUrl("https://github.com:8443/x.dmg", "download")).toBe(false);
		// GitHub hands downloads over to its asset host, which is fine only after a redirect.
		expect(isAllowedUpdateUrl("https://release-assets.githubusercontent.com/x", "download")).toBe(false);
		expect(isAllowedUpdateUrl("https://release-assets.githubusercontent.com/x", "redirect")).toBe(true);
	});
});

describe("update sources", () => {
	const feed = {
		tag_name: "v1.3.0",
		assets: {
			"mac-arm64": { url: "https://dl.lanshuagent.com/quickshot/QuickShot-Mac-arm64-1.3.0.dmg", sha256: SHA, size: 1200 },
			"win-x64": { url: "https://dl.lanshuagent.com/quickshot/QuickShot-Win-x64-1.3.0-Setup.exe", sha256: SHA },
		},
	};
	const github = {
		tag_name: "v1.2.1",
		draft: false,
		prerelease: false,
		assets: [
			{
				name: "QuickShot-Mac-arm64-1.2.1.dmg",
				browser_download_url: "https://github.com/cclank/quickshot/releases/download/v1.2.1/QuickShot-Mac-arm64-1.2.1.dmg",
				digest: `sha256:${SHA}`,
				size: 9,
			},
			{
				name: "QuickShot-Mac-x64-1.2.1.dmg",
				browser_download_url: "https://github.com/cclank/quickshot/releases/download/v1.2.1/QuickShot-Mac-x64-1.2.1.dmg",
				digest: null,
			},
		],
	};

	it("reads QuickShot's own feed", () => {
		expect(releaseFromFeed(feed, "mac-arm64")).toEqual({
			version: "1.3.0",
			url: feed.assets["mac-arm64"].url,
			sha256: SHA,
			size: 1200,
		});
		expect(releaseFromFeed(feed, "mac-x64")).toBeNull();
	});

	it("reads GitHub's latest release, skipping assets without a digest", () => {
		expect(releaseFromGitHub(github, "mac-arm64")?.version).toBe("1.2.1");
		expect(releaseFromGitHub(github, "mac-x64")).toBeNull();
		expect(releaseFromGitHub({ ...github, prerelease: true }, "mac-arm64")).toBeNull();
	});

	it("refuses installers from other hosts or of the wrong kind", () => {
		const bad = (url: string) => ({ tag_name: "v1.3.0", assets: { "mac-arm64": { url, sha256: SHA } } });
		expect(releaseFromFeed(bad("https://evil.example/QuickShot-Mac-arm64-1.3.0.dmg"), "mac-arm64")).toBeNull();
		expect(releaseFromFeed(bad("https://dl.lanshuagent.com/quickshot/QuickShot-Win-x64-1.3.0-Setup.exe"), "mac-arm64")).toBeNull();
		expect(releaseFromFeed(bad("https://dl.lanshuagent.com/quickshot/QuickShot-Mac-arm64-1.3.0.zip"), "mac-arm64")).toBeNull();
	});

	it("offers the newest release that is newer than this one", () => {
		const fromFeed = releaseFromFeed(feed, "mac-arm64");
		const fromGitHub = releaseFromGitHub(github, "mac-arm64");
		expect(newestRelease([fromGitHub, fromFeed], "1.2.0")?.version).toBe("1.3.0");
		expect(newestRelease([fromGitHub, null], "1.2.0")?.version).toBe("1.2.1");
		expect(newestRelease([fromGitHub, fromFeed], "1.3.0")).toBeNull();
	});
});

/** A stand-in QuickShot.app holding `version`, signed ad hoc like a public build. */
function fakeApp(folder: string, version: string) {
	const app = path.join(folder, "QuickShot.app");
	mkdirSync(path.join(app, "Contents", "MacOS"), { recursive: true });
	writeFileSync(
		path.join(app, "Contents", "Info.plist"),
		`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.quickshot.app</string>
<key>CFBundleExecutable</key><string>QuickShot</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
</dict></plist>`,
	);
	const executable = path.join(app, "Contents", "MacOS", "QuickShot");
	writeFileSync(executable, "#!/bin/sh\nexit 0\n");
	chmodSync(executable, 0o755);
	execFileSync("codesign", ["--force", "--sign", "-", app]);
	return app;
}

function installerRun(dmgVersion: string, expectedVersion: string) {
	const root = mkdtempSync(path.join(os.tmpdir(), "quickshot-update-test-"));
	const stage = path.join(root, "stage");
	mkdirSync(stage);
	fakeApp(stage, dmgVersion);
	const dmg = path.join(root, "work", "QuickShot.dmg");
	mkdirSync(path.dirname(dmg));
	execFileSync("hdiutil", ["create", "-quiet", "-srcfolder", stage, "-volname", "QuickShot", "-format", "UDZO", dmg]);
	const applications = path.join(root, "Applications");
	mkdirSync(applications);
	const app = fakeApp(applications, "1.0.0");
	const script = path.join(root, "work", "install.sh");
	writeFileSync(script, MAC_INSTALL_SCRIPT, { mode: 0o700 });
	// A finished process stands in for QuickShot having quit.
	const gone = spawnSync("/usr/bin/true").pid ?? 999_999;
	const result = spawnSync(
		"/bin/bash",
		[script, dmg, path.join(root, "work", "mount"), app, path.join(root, "work"), `${app}.backup`, String(gone), expectedVersion],
		{ env: { ...process.env, QUICKSHOT_UPDATE_OPEN: "/usr/bin/true" }, encoding: "utf8", timeout: 60_000 },
	);
	const installed = readFileSync(path.join(app, "Contents", "Info.plist"), "utf8").match(
		/CFBundleShortVersionString<\/key><string>([^<]+)/,
	)?.[1];
	const leftovers = { work: existsSync(path.join(root, "work")), backup: existsSync(`${app}.backup`) };
	rmSync(root, { recursive: true, force: true });
	return { status: result.status, installed, leftovers };
}

describe.skipIf(process.platform !== "darwin")("macOS update installer", () => {
	it("replaces the app with the one in the DMG and cleans up", () => {
		expect(installerRun("1.3.0", "1.3.0")).toEqual({
			status: 0,
			installed: "1.3.0",
			leftovers: { work: false, backup: false },
		});
	}, 90_000);

	it("puts the old app back when the DMG holds another version", () => {
		expect(installerRun("1.2.9", "1.3.0")).toEqual({
			status: 1,
			installed: "1.0.0",
			leftovers: { work: false, backup: false },
		});
	}, 90_000);
});
