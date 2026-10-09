import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, "..");
const helperPath = process.argv[2]
	? path.resolve(process.argv[2])
	: path.join(projectRoot, "build", "ocr", "quickshot-ocr");

if (process.platform !== "darwin") {
	console.log("Skipping QuickShot OCR helper smoke test outside macOS.");
	process.exit(0);
}

const temporaryDirectory = await mkdtemp(
	path.join(os.tmpdir(), "quickshot-ocr-smoke-"),
);
const samplePng = path.join(temporaryDirectory, "sample.png");

try {
	await execFileAsync(
		"sips",
		[
			"-s",
			"format",
			"png",
			path.join(projectRoot, "test-fixtures", "ocr-sample.svg"),
			"--out",
			samplePng,
		],
		{ maxBuffer: 1024 * 1024 },
	);
	const { stdout } = await execFileAsync(
		helperPath,
		[samplePng],
		{ encoding: "utf8", maxBuffer: 1024 * 1024 },
	);
	const result = JSON.parse(stdout);
	const expectedText = "QuickShot OCR 2026\n本地文本提取测试";
	if (result.text !== expectedText || result.lineCount !== 2) {
		throw new Error(
			`Unexpected OCR result: ${JSON.stringify(result)}`,
		);
	}
	console.log(
		JSON.stringify(
			{
				text: result.text,
				lineCount: result.lineCount,
			},
			null,
			2,
		),
	);

	// Smart redaction reads every word with its box.
	const { stdout: wordsOutput } = await execFileAsync(
		helperPath,
		["--words", path.join(projectRoot, "test-fixtures", "terminal.png")],
		{ encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
	);
	const words = JSON.parse(wordsOutput);
	// Recognition sometimes joins the prompt's "~" to it, so match the start.
	const prompts = words.words.filter((word) => word.text.startsWith("alex@Alexs-MacBook-Pro"));
	const first = prompts.sort((a, b) => a.y - b.y)[0];
	if (
		words.width !== 1520 ||
		words.height !== 760 ||
		prompts.length < 9 ||
		Math.abs(first.x - 22) > 8 ||
		Math.abs(first.y - 57) > 8 ||
		first.w < 300
	) {
		throw new Error(`Unexpected OCR words: ${JSON.stringify({ prompts: prompts.length, first })}`);
	}
	console.log(JSON.stringify({ words: words.words.length, prompts: prompts.length, first }));
} finally {
	await rm(temporaryDirectory, { force: true, recursive: true });
}
