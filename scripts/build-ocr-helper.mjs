import { execFile } from "node:child_process";
import { chmod, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(
	projectRoot,
	"native",
	"quickshot-ocr",
	"main.swift",
);
const outputDirectory = path.join(projectRoot, "build", "ocr");
const outputPath = path.join(outputDirectory, "quickshot-ocr");
const requestedUniversal = process.argv.includes("--universal");
const requestedArchitecture = process.argv
	.find((argument) => argument.startsWith("--arch="))
	?.slice("--arch=".length);

if (process.platform !== "darwin") {
	console.log("Skipping QuickShot OCR helper build outside macOS.");
	process.exit(0);
}

function normalizeArchitecture(value) {
	if (value === "arm64" || value === "x64") return value;
	throw new Error(`Unsupported OCR helper architecture: ${value}`);
}

function swiftTarget(architecture) {
	return architecture === "x64"
		? "x86_64-apple-macos12.0"
		: "arm64-apple-macos12.0";
}

async function compile(architecture, destination) {
	await execFileAsync(
		"xcrun",
		[
			"--sdk",
			"macosx",
			"swiftc",
			sourcePath,
			"-O",
			"-whole-module-optimization",
			"-target",
			swiftTarget(architecture),
			"-framework",
			"Vision",
			"-framework",
			"ImageIO",
			"-o",
			destination,
		],
		{ maxBuffer: 4 * 1024 * 1024 },
	);
}

await mkdir(outputDirectory, { recursive: true });
const temporaryPaths = [];

try {
	if (requestedUniversal) {
		const armPath = path.join(outputDirectory, ".quickshot-ocr-arm64");
		const x64Path = path.join(outputDirectory, ".quickshot-ocr-x64");
		const universalPath = path.join(
			outputDirectory,
			".quickshot-ocr-universal",
		);
		temporaryPaths.push(armPath, x64Path, universalPath);
		await Promise.all([
			compile("arm64", armPath),
			compile("x64", x64Path),
		]);
		await execFileAsync(
			"xcrun",
			["lipo", "-create", armPath, x64Path, "-output", universalPath],
			{ maxBuffer: 4 * 1024 * 1024 },
		);
		await rename(universalPath, outputPath);
	} else {
		const architecture = normalizeArchitecture(
			requestedArchitecture ?? process.arch,
		);
		const temporaryPath = path.join(
			outputDirectory,
			`.quickshot-ocr-${architecture}`,
		);
		temporaryPaths.push(temporaryPath);
		await compile(architecture, temporaryPath);
		await rename(temporaryPath, outputPath);
	}

	await chmod(outputPath, 0o755);
	console.log(`Built QuickShot OCR helper: ${outputPath}`);
} finally {
	await Promise.all(
		temporaryPaths.map((temporaryPath) =>
			rm(temporaryPath, { force: true }),
		),
	);
}
