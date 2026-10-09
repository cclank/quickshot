import { execFile } from "node:child_process";
import { chmod, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

// Builds the small Swift helpers Electron calls on macOS: Vision text
// recognition, the on-screen window list, and the resident capture agent.
const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, "..");
const helpers = [
	{
		name: "quickshot-ocr",
		sources: [path.join(projectRoot, "native", "quickshot-ocr", "main.swift")],
		outputDirectory: path.join(projectRoot, "build", "ocr"),
		frameworks: ["Vision", "ImageIO"],
	},
	{
		name: "quickshot-window-list",
		sources: [
			path.join(projectRoot, "native", "quickshot-window-list", "main.swift"),
			path.join(projectRoot, "native", "quickshot-window-list", "WindowList.swift"),
		],
		outputDirectory: path.join(projectRoot, "build", "window-list"),
		frameworks: ["CoreGraphics"],
	},
	{
		name: "quickshot-capture-agent",
		sources: [
			path.join(projectRoot, "native", "quickshot-capture-agent", "main.swift"),
			path.join(projectRoot, "native", "quickshot-capture-agent", "ScrollCapture.swift"),
			path.join(projectRoot, "native", "quickshot-capture-agent", "ScrollStitcher.swift"),
			path.join(projectRoot, "native", "quickshot-window-list", "WindowList.swift"),
		],
		outputDirectory: path.join(projectRoot, "build", "capture-agent"),
		frameworks: ["AppKit", "CoreGraphics", "CoreMedia", "CoreVideo", "ImageIO"],
		// ScreenCaptureKit's screenshot API needs macOS 14; weak linking keeps
		// the agent starting on older systems, where it reports "unsupported".
		weakFrameworks: ["ScreenCaptureKit"],
	},
];
const requestedUniversal = process.argv.includes("--universal");
const requestedArchitecture = process.argv
	.find((argument) => argument.startsWith("--arch="))
	?.slice("--arch=".length);

if (process.platform !== "darwin") {
	console.log("Skipping QuickShot native helper builds outside macOS.");
	process.exit(0);
}

function normalizeArchitecture(value) {
	if (value === "arm64" || value === "x64") return value;
	throw new Error(`Unsupported native helper architecture: ${value}`);
}

function swiftTarget(architecture) {
	return architecture === "x64"
		? "x86_64-apple-macos12.0"
		: "arm64-apple-macos12.0";
}

async function compile(helper, architecture, destination) {
	await execFileAsync(
		"xcrun",
		[
			"--sdk",
			"macosx",
			"swiftc",
			...helper.sources,
			"-O",
			"-whole-module-optimization",
			"-target",
			swiftTarget(architecture),
			...helper.frameworks.flatMap((framework) => ["-framework", framework]),
			...(helper.weakFrameworks ?? []).flatMap((framework) => [
				"-Xlinker",
				"-weak_framework",
				"-Xlinker",
				framework,
			]),
			"-o",
			destination,
		],
		{ maxBuffer: 4 * 1024 * 1024 },
	);
}

async function build(helper) {
	const outputPath = path.join(helper.outputDirectory, helper.name);
	await mkdir(helper.outputDirectory, { recursive: true });
	const temporaryPaths = [];
	try {
		if (requestedUniversal) {
			const armPath = path.join(helper.outputDirectory, `.${helper.name}-arm64`);
			const x64Path = path.join(helper.outputDirectory, `.${helper.name}-x64`);
			const universalPath = path.join(helper.outputDirectory, `.${helper.name}-universal`);
			temporaryPaths.push(armPath, x64Path, universalPath);
			await Promise.all([
				compile(helper, "arm64", armPath),
				compile(helper, "x64", x64Path),
			]);
			await execFileAsync(
				"xcrun",
				["lipo", "-create", armPath, x64Path, "-output", universalPath],
				{ maxBuffer: 4 * 1024 * 1024 },
			);
			await rename(universalPath, outputPath);
		} else {
			const architecture = normalizeArchitecture(requestedArchitecture ?? process.arch);
			const temporaryPath = path.join(helper.outputDirectory, `.${helper.name}-${architecture}`);
			temporaryPaths.push(temporaryPath);
			await compile(helper, architecture, temporaryPath);
			await rename(temporaryPath, outputPath);
		}
		await chmod(outputPath, 0o755);
		console.log(`Built ${helper.name}: ${outputPath}`);
	} finally {
		await Promise.all(temporaryPaths.map((temporaryPath) => rm(temporaryPath, { force: true })));
	}
}

for (const helper of helpers) {
	await build(helper);
}
