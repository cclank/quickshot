import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

// Builds and runs the scrolling-capture stitcher's checks
// (native/quickshot-capture-agent/tests) on macOS.
const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, "..");
const agentSources = path.join(projectRoot, "native", "quickshot-capture-agent");
const outputDirectory = path.join(projectRoot, "build", "tests");
const executable = path.join(outputDirectory, "scroll-stitcher-tests");

if (process.platform !== "darwin") {
	console.log("Skipping the scroll stitcher checks outside macOS.");
	process.exit(0);
}

await mkdir(outputDirectory, { recursive: true });
await execFileAsync(
	"xcrun",
	[
		"--sdk",
		"macosx",
		"swiftc",
		path.join(agentSources, "ScrollStitcher.swift"),
		path.join(agentSources, "tests", "main.swift"),
		"-O",
		"-o",
		executable,
	],
	{ maxBuffer: 4 * 1024 * 1024 },
);
try {
	const { stdout } = await execFileAsync(executable, [], { maxBuffer: 4 * 1024 * 1024 });
	process.stdout.write(stdout);
} catch (error) {
	process.stdout.write(error.stdout ?? "");
	process.exitCode = 1;
}
