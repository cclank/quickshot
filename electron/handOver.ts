import path from "node:path";

/** Identifies a packaged build: app.asar only changes when the app is rebuilt. */
export type BundleStamp = { ino: number; mtimeMs: number };

/** "/Applications/QuickShot.app/Contents/MacOS/QuickShot" → "/Applications/QuickShot.app". */
export function bundleFromExecutable(executable: string | undefined): string | null {
	if (!executable || !path.isAbsolute(executable)) return null;
	const marker = ".app/Contents/MacOS/";
	const index = executable.indexOf(marker);
	return index < 0 ? null : executable.slice(0, index + ".app".length);
}

/**
 * Whether the running QuickShot should quit so the one just opened can run:
 * the same bundle was replaced on disk since launch (an update dragged over
 * it), or a copy elsewhere is a newer build. An older copy never takes over.
 */
export function shouldHandOver(
	own: { bundle: string; launchStamp: BundleStamp },
	other: { bundle: string; stamp: BundleStamp | null },
): boolean {
	if (!other.stamp) return false;
	if (other.bundle === own.bundle) {
		return other.stamp.ino !== own.launchStamp.ino || other.stamp.mtimeMs !== own.launchStamp.mtimeMs;
	}
	return other.stamp.mtimeMs > own.launchStamp.mtimeMs;
}
