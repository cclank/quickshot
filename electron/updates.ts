/**
 * Update checks, after Tokei's: a feed on QuickShot's own download host and
 * the same feed attached to GitHub's latest release, with GitHub's API only
 * when neither answers. The newest complete release wins. Everything here is pure, so it can be tested; the
 * main process does the fetching, downloading and installing.
 */

export const UPDATE_FEED_URL = "https://dl.lanshuagent.com/quickshot/latest.json";
/** The same feed, attached to every GitHub release; downloads are not rate limited. */
export const GITHUB_FEED_URL = "https://github.com/cclank/quickshot/releases/latest/download/latest.json";
/** GitHub's API allows 60 requests an hour per address, so it comes last. */
export const GITHUB_LATEST_URL = "https://api.github.com/repos/cclank/quickshot/releases/latest";
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** The first automatic check waits a little after launch. */
export const UPDATE_FIRST_CHECK_DELAY_MS = 60 * 1000;

/** Which installer a build takes. */
export type UpdateTarget = "mac-arm64" | "mac-x64" | "win-x64";

export type UpdateRelease = {
	version: string;
	url: string;
	sha256: string;
	size?: number;
};

const METADATA_HOSTS = new Set(["dl.lanshuagent.com", "github.com", "api.github.com"]);
const DOWNLOAD_HOSTS = new Set(["dl.lanshuagent.com", "github.com"]);
/** Where GitHub sends release downloads. */
const DOWNLOAD_REDIRECT_HOSTS = new Set(["objects.githubusercontent.com", "release-assets.githubusercontent.com"]);

const ASSET_NAMES: Record<UpdateTarget, RegExp> = {
	"mac-arm64": /^QuickShot-Mac-arm64-\d+\.\d+\.\d+\.dmg$/,
	"mac-x64": /^QuickShot-Mac-x64-\d+\.\d+\.\d+\.dmg$/,
	"win-x64": /^QuickShot-Win-x64-\d+\.\d+\.\d+-Setup\.exe$/,
};

export function updateTarget(platform: string, arch: string): UpdateTarget | null {
	if (platform === "darwin" && (arch === "arm64" || arch === "x64")) return `mac-${arch}`;
	if (platform === "win32" && arch === "x64") return "win-x64";
	return null;
}

/** "v1.2.3" → [1, 2, 3]. Pre-releases and anything else → null, so they are never offered. */
export function versionParts(raw: unknown): number[] | null {
	if (typeof raw !== "string") return null;
	const match = /^v?(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/.exec(raw.trim());
	return match ? match.slice(1).map(Number) : null;
}

export function isNewerVersion(remote: string, local: string): boolean {
	const theirs = versionParts(remote);
	const ours = versionParts(local);
	if (!theirs || !ours) return false;
	for (let index = 0; index < 3; index += 1) {
		if (theirs[index] !== ours[index]) return theirs[index] > ours[index];
	}
	return false;
}

export function normalizeSha256(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const digest = raw.trim().toLowerCase().replace(/^sha256:/, "");
	return /^[0-9a-f]{64}$/.test(digest) ? digest : null;
}

/**
 * HTTPS on an allow-listed host, with no credentials, odd port or fragment.
 * "download" is where an installer may come from; "redirect" also admits the
 * hosts GitHub hands downloads over to.
 */
export function isAllowedUpdateUrl(raw: unknown, kind: "metadata" | "download" | "redirect"): boolean {
	if (typeof raw !== "string") return false;
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return false;
	}
	const hosts =
		kind === "metadata"
			? METADATA_HOSTS
			: kind === "download"
				? DOWNLOAD_HOSTS
				: new Set([...DOWNLOAD_HOSTS, ...DOWNLOAD_REDIRECT_HOSTS]);
	return (
		url.protocol === "https:" &&
		hosts.has(url.hostname.toLowerCase()) &&
		!url.username &&
		!url.password &&
		!url.hash &&
		(url.port === "" || url.port === "443")
	);
}

function installerMatches(url: string, target: UpdateTarget) {
	const name = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
	return ASSET_NAMES[target].test(name);
}

function release(version: string, url: unknown, digest: unknown, size: unknown, target: UpdateTarget): UpdateRelease | null {
	const sha256 = normalizeSha256(digest);
	if (!versionParts(version) || !sha256 || !isAllowedUpdateUrl(url, "download")) return null;
	if (!installerMatches(url as string, target)) return null;
	return {
		version: version.replace(/^v/, ""),
		url: url as string,
		sha256,
		...(Number.isSafeInteger(size) && (size as number) > 0 ? { size: size as number } : {}),
	};
}

/**
 * QuickShot's own feed:
 * {"tag_name":"v1.3.0","assets":{"mac-arm64":{"url":…,"sha256":…,"size":…},…}}
 */
export function releaseFromFeed(json: unknown, target: UpdateTarget): UpdateRelease | null {
	if (!json || typeof json !== "object") return null;
	const { tag_name: tag, assets } = json as Record<string, unknown>;
	if (typeof tag !== "string" || !assets || typeof assets !== "object") return null;
	const asset = (assets as Record<string, unknown>)[target];
	if (!asset || typeof asset !== "object") return null;
	const { url, sha256, size } = asset as Record<string, unknown>;
	return release(tag, url, sha256, size, target);
}

/** GitHub's latest-release answer, whose assets carry a "sha256:…" digest. */
export function releaseFromGitHub(json: unknown, target: UpdateTarget): UpdateRelease | null {
	if (!json || typeof json !== "object") return null;
	const { tag_name: tag, assets, draft, prerelease } = json as Record<string, unknown>;
	if (typeof tag !== "string" || draft === true || prerelease === true || !Array.isArray(assets)) return null;
	const asset = assets.find(
		(item) => item && typeof item === "object" && ASSET_NAMES[target].test(String((item as Record<string, unknown>).name)),
	) as Record<string, unknown> | undefined;
	if (!asset) return null;
	return release(tag, asset.browser_download_url, asset.digest, asset.size, target);
}

/** The newest release newer than `current`, if any. */
export function newestRelease(releases: (UpdateRelease | null)[], current: string): UpdateRelease | null {
	let best: UpdateRelease | null = null;
	for (const candidate of releases) {
		if (!candidate || !isNewerVersion(candidate.version, current)) continue;
		if (!best || isNewerVersion(candidate.version, best.version)) best = candidate;
	}
	return best;
}

/**
 * Replaces the app on macOS once QuickShot has quit, and opens the new one.
 * Arguments: DMG, mount point, app path, work folder, backup path, the PID to
 * wait for, and the version the DMG must hold. Any failure puts the old app
 * back and opens it again. QUICKSHOT_UPDATE_OPEN replaces `open` in tests.
 */
export const MAC_INSTALL_SCRIPT = String.raw`#!/bin/bash
set -u

if [ "$#" -ne 7 ]; then
    exit 2
fi

DMG_PATH="$1"
MOUNT_DIR="$2"
APP_PATH="$3"
WORK_DIR="$4"
BACKUP_PATH="$5"
OLD_PID="$6"
EXPECTED_VERSION="$7"
OPEN_APP="/usr/bin/open"
if [ -n "$(/usr/bin/printenv QUICKSHOT_UPDATE_OPEN)" ]; then
    OPEN_APP="$(/usr/bin/printenv QUICKSHOT_UPDATE_OPEN)"
fi
MOUNTED=0
OLD_MOVED=0

cleanup() {
    if [ "$MOUNTED" -eq 1 ]; then
        /usr/bin/hdiutil detach "$MOUNT_DIR" -quiet >/dev/null 2>&1 || true
        MOUNTED=0
    fi
    /bin/rm -rf "$WORK_DIR"
}

restore() {
    if [ "$OLD_MOVED" -eq 1 ]; then
        /bin/rm -rf "$APP_PATH"
        /bin/mv "$BACKUP_PATH" "$APP_PATH" >/dev/null 2>&1 || true
        OLD_MOVED=0
    fi
}

validate_app() {
    local candidate="$1"
    local plist="$candidate/Contents/Info.plist"
    [ -f "$plist" ] || return 1
    [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist" 2>/dev/null)" = "com.quickshot.app" ] || return 1
    [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$plist" 2>/dev/null)" = "QuickShot" ] || return 1
    [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist" 2>/dev/null)" = "$EXPECTED_VERSION" ] || return 1
    [ -x "$candidate/Contents/MacOS/QuickShot" ] || return 1
    /usr/bin/codesign --verify --deep --strict "$candidate" >/dev/null 2>&1 || return 1
}

fail() {
    restore
    cleanup
    "$OPEN_APP" -n "$APP_PATH" >/dev/null 2>&1 || true
    exit 1
}

trap fail HUP INT TERM

# Wait for QuickShot to quit, at most 20 seconds.
for _ in $(/usr/bin/seq 1 100); do
    /bin/kill -0 "$OLD_PID" >/dev/null 2>&1 || break
    /bin/sleep 0.2
done
/bin/kill -0 "$OLD_PID" >/dev/null 2>&1 && fail

[ -f "$DMG_PATH" ] || fail
[ -d "$APP_PATH" ] || fail
/bin/mkdir -p "$MOUNT_DIR" || fail
/usr/bin/hdiutil attach "$DMG_PATH" -nobrowse -quiet -readonly -mountpoint "$MOUNT_DIR" || fail
MOUNTED=1
validate_app "$MOUNT_DIR/QuickShot.app" || fail
[ ! -e "$BACKUP_PATH" ] || /bin/rm -rf "$BACKUP_PATH" || fail
/bin/mv "$APP_PATH" "$BACKUP_PATH" || fail
OLD_MOVED=1
/usr/bin/ditto "$MOUNT_DIR/QuickShot.app" "$APP_PATH" || fail
/usr/bin/xattr -cr "$APP_PATH" >/dev/null 2>&1 || true
validate_app "$APP_PATH" || fail
if ! /usr/bin/hdiutil detach "$MOUNT_DIR" -quiet >/dev/null 2>&1; then
    /bin/sleep 1
    /usr/bin/hdiutil detach "$MOUNT_DIR" -quiet -force >/dev/null 2>&1 || fail
fi
MOUNTED=0
"$OPEN_APP" -n "$APP_PATH" >/dev/null 2>&1 || fail
/bin/rm -rf "$BACKUP_PATH" || fail
OLD_MOVED=0
cleanup
exit 0
`;
