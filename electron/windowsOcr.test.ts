import { describe, expect, it } from "vitest";
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
});
