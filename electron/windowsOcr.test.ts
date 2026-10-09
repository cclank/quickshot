import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { parseOcrWordsOutput } from "./ocrResult";
import {
	WINDOWS_OCR_SCRIPT,
	getWindowsOcrArguments,
	getWindowsPowerShellPath,
	normalizeCjkSpacing,
	stripByteOrderMark,
} from "./windowsOcr";

describe("windows OCR helpers", () => {
	it("passes the image path as a script argument", () => {
		expect(getWindowsOcrArguments("C:\\t\\ocr.ps1", "C:\\Users\\O'Brien\\a.png")).toEqual([
			"-NoProfile",
			"-NonInteractive",
			"-ExecutionPolicy",
			"Bypass",
			"-File",
			"C:\\t\\ocr.ps1",
			"-ImagePath",
			"C:\\Users\\O'Brien\\a.png",
		]);
	});

	it("asks for words with -Words", () => {
		expect(getWindowsOcrArguments("C:\\t\\ocr.ps1", "C:\\t\\a.png", true).slice(-3)).toEqual([
			"-ImagePath",
			"C:\\t\\a.png",
			"-Words",
		]);
		expect(WINDOWS_OCR_SCRIPT).toContain("[switch]$Words");
	});

	it("keeps PowerShell escapes intact inside the script", () => {
		expect(WINDOWS_OCR_SCRIPT.startsWith("param(")).toBe(true);
		expect(WINDOWS_OCR_SCRIPT).toContain("IAsyncOperation`1");
		expect(WINDOWS_OCR_SCRIPT).toContain('-join "`n"');
		expect(WINDOWS_OCR_SCRIPT).toContain("exit 6");
		expect(WINDOWS_OCR_SCRIPT).toContain("exit 7");
		// ASCII only, so Windows PowerShell 5.1 reads the BOM-less file correctly.
		expect(/^[\x00-\x7f]*$/.test(WINDOWS_OCR_SCRIPT)).toBe(true);
	});

	it("resolves Windows PowerShell by absolute path", () => {
		expect(getWindowsPowerShellPath("D:\\Win\\")).toBe(
			"D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
		);
		expect(getWindowsPowerShellPath("relative")).toBe(
			"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
		);
	});

	it("removes spaces Windows OCR inserts between CJK characters", () => {
		expect(normalizeCjkSpacing("总 收 入 Revenue 12 %")).toBe("总收入 Revenue 12 %");
		expect(normalizeCjkSpacing("待 处 理 ： 12 条")).toBe("待处理： 12 条");
		expect(normalizeCjkSpacing("Hello World")).toBe("Hello World");
	});

	it("strips a leading byte order mark", () => {
		expect(stripByteOrderMark("\ufeff{}")).toBe("{}");
		expect(stripByteOrderMark("{}")).toBe("{}");
	});

	// Runs the real script on Windows (in CI), on text drawn with System.Drawing.
	it.runIf(process.platform === "win32")(
		"reads words and their boxes with Windows OCR",
		async () => {
			const run = promisify(execFile);
			const powershell = getWindowsPowerShellPath();
			const folder = await mkdtemp(path.join(os.tmpdir(), "quickshot-ocr-test-"));
			try {
				const image = path.join(folder, "words.png");
				const draw = path.join(folder, "draw.ps1");
				await writeFile(
					draw,
					[
						"param([string]$Out)",
						"Add-Type -AssemblyName System.Drawing",
						"$bitmap = New-Object System.Drawing.Bitmap 1200, 160",
						"$graphics = [System.Drawing.Graphics]::FromImage($bitmap)",
						"$graphics.Clear([System.Drawing.Color]::White)",
						"$font = New-Object System.Drawing.Font 'Consolas', 30",
						"$graphics.DrawString('alex@devbox ~ % cd C:\\Users\\alex', $font, [System.Drawing.Brushes]::Black, 20, 50)",
						"$bitmap.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)",
					].join("\r\n"),
				);
				await run(powershell, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", draw, "-Out", image]);
				const script = path.join(folder, "ocr.ps1");
				await writeFile(script, WINDOWS_OCR_SCRIPT);
				let stdout: string;
				try {
					({ stdout } = await run(powershell, getWindowsOcrArguments(script, image, true), { encoding: "utf8" }));
				} catch (error) {
					// A runner without an OCR language can only check that the script starts.
					if ((error as { code?: number }).code === 6) return;
					throw error;
				}
				const result = parseOcrWordsOutput(stripByteOrderMark(stdout.trim()), 1024 * 1024);
				expect(result).toMatchObject({ width: 1200, height: 160 });
				const words = result.lines.flat();
				expect(words.map((word) => word.text).join(" ")).toContain("alex@devbox");
				for (const word of words) {
					expect(word.x).toBeGreaterThanOrEqual(0);
					expect(word.x + word.w).toBeLessThanOrEqual(1200);
					expect(word.y).toBeGreaterThan(20);
					expect(word.y + word.h).toBeLessThan(140);
				}
			} finally {
				await rm(folder, { recursive: true, force: true });
			}
		},
		60_000,
	);
});
