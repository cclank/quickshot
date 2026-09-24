import { writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_MAX_FILENAME_ATTEMPTS = 1_000;

export function createScreenshotPathGenerator(now = Date.now) {
	let lastEpochMs = -1;
	let sequence = 0;

	return (directory: string) => {
		const currentEpochMs = now();
		const filenameEpochMs = Math.max(currentEpochMs, lastEpochMs);
		if (filenameEpochMs === lastEpochMs) {
			sequence += 1;
		} else {
			lastEpochMs = filenameEpochMs;
			sequence = 0;
		}

		const stamp = new Date(filenameEpochMs)
			.toISOString()
			.replace(/[:.]/g, "-")
			.replace("T", "_")
			.replace("Z", "");
		const suffix = String(sequence).padStart(3, "0");
		return path.join(directory, `quickshot-${stamp}-${suffix}.png`);
	};
}

export async function writePngWithoutOverwrite(
	pngBytes: Uint8Array,
	nextPath: () => string,
	maxAttempts = DEFAULT_MAX_FILENAME_ATTEMPTS,
): Promise<string> {
	for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
		const filePath = nextPath();
		try {
			await writeFile(filePath, pngBytes, { flag: "wx" });
			return filePath;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
			throw error;
		}
	}

	throw new Error("Could not allocate a unique screenshot filename");
}
