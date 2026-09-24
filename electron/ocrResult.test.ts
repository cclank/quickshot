import { describe, expect, it } from "vitest";
import { parseOcrHelperOutput } from "./ocrResult";

describe("OCR helper output", () => {
	it("accepts local Chinese and English text", () => {
		expect(
			parseOcrHelperOutput(
				JSON.stringify({
					text: "QuickShot OCR 2026\n本地文本提取测试",
					lineCount: 2,
				}),
				1024,
			),
		).toEqual({
			text: "QuickShot OCR 2026\n本地文本提取测试",
			lineCount: 2,
		});
	});

	it("rejects malformed JSON and invalid result fields", () => {
		expect(() => parseOcrHelperOutput("{", 1024)).toThrow(
			"invalid JSON",
		);
		expect(() =>
			parseOcrHelperOutput(
				JSON.stringify({ text: 42, lineCount: 1 }),
				1024,
			),
		).toThrow("missing text");
		expect(() =>
			parseOcrHelperOutput(
				JSON.stringify({ text: "hello", lineCount: -1 }),
				1024,
			),
		).toThrow("invalid line count");
	});

	it("enforces the UTF-8 text byte limit", () => {
		expect(() =>
			parseOcrHelperOutput(
				JSON.stringify({ text: "中文", lineCount: 1 }),
				5,
			),
		).toThrow("byte limit");
	});

	it("rejects an invalid byte limit", () => {
		expect(() =>
			parseOcrHelperOutput(
				JSON.stringify({ text: "", lineCount: 0 }),
				0,
			),
		).toThrow("positive integer");
	});
});
