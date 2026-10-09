import { describe, expect, it } from "vitest";
import { parseOcrHelperOutput, parseOcrWordsOutput } from "./ocrResult";

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

describe("OCR helper words output", () => {
	const word = (text: string, line: number, x = 0) => ({ text, line, x, y: line * 30, w: 40, h: 20 });

	it("groups words into lines in order", () => {
		const stdout = JSON.stringify({
			width: 200,
			height: 100,
			words: [word("alex@box", 0), word("~", 0, 50), word("/Users/alex", 1), word("", 1, 60)],
		});
		expect(parseOcrWordsOutput(stdout, 1024)).toEqual({
			width: 200,
			height: 100,
			lines: [
				[{ text: "alex@box", x: 0, y: 0, w: 40, h: 20 }, { text: "~", x: 50, y: 0, w: 40, h: 20 }],
				[{ text: "/Users/alex", x: 0, y: 30, w: 40, h: 20 }],
			],
		});
	});

	it("accepts the single word and no words Windows PowerShell writes", () => {
		const single = JSON.stringify({ width: 10, height: 10, words: word("alex", 0) });
		expect(parseOcrWordsOutput(single, 1024).lines).toHaveLength(1);
		const none = JSON.stringify({ width: 10, height: 10, words: null });
		expect(parseOcrWordsOutput(none, 1024).lines).toEqual([]);
	});

	it("rejects invalid sizes, words and oversized text", () => {
		expect(() => parseOcrWordsOutput(JSON.stringify({ width: 0, height: 10, words: [] }), 1024)).toThrow("image size");
		expect(() =>
			parseOcrWordsOutput(JSON.stringify({ width: 10, height: 10, words: [{ ...word("a", 0), x: "1" }] }), 1024),
		).toThrow("invalid word");
		expect(() =>
			parseOcrWordsOutput(JSON.stringify({ width: 10, height: 10, words: [word("a".repeat(20), 0)] }), 10),
		).toThrow("byte limit");
	});
});
