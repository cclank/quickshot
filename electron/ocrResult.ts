import type { OcrWord } from "./sensitiveText";

export interface OcrHelperResult {
	text: string;
	lineCount: number;
}

export function parseOcrHelperOutput(
	stdout: string,
	maxTextBytes: number,
): OcrHelperResult {
	if (!Number.isSafeInteger(maxTextBytes) || maxTextBytes <= 0) {
		throw new RangeError("OCR text byte limit must be a positive integer");
	}

	let value: unknown;
	try {
		value = JSON.parse(stdout);
	} catch {
		throw new Error("OCR helper returned invalid JSON");
	}

	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("OCR helper returned an invalid result");
	}

	const { text, lineCount } = value as Record<string, unknown>;
	if (typeof text !== "string") {
		throw new Error("OCR helper result is missing text");
	}
	if (!Number.isSafeInteger(lineCount) || Number(lineCount) < 0) {
		throw new Error("OCR helper result has an invalid line count");
	}
	if (Buffer.byteLength(text, "utf8") > maxTextBytes) {
		throw new RangeError("OCR helper text exceeds the byte limit");
	}

	return {
		text,
		lineCount: Number(lineCount),
	};
}

export interface OcrWordsResult {
	width: number;
	height: number;
	/** Recognized lines, each a list of words with their boxes in image pixels. */
	lines: OcrWord[][];
}

const MAX_OCR_WORDS = 200_000;

/** Parses `quickshot-ocr --words`: {width, height, words: [{text, line, x, y, w, h}]}. */
export function parseOcrWordsOutput(stdout: string, maxTextBytes: number): OcrWordsResult {
	let value: unknown;
	try {
		value = JSON.parse(stdout);
	} catch {
		throw new Error("OCR helper returned invalid JSON");
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("OCR helper returned an invalid result");
	}
	const { width, height, words } = value as Record<string, unknown>;
	if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || Number(width) <= 0 || Number(height) <= 0) {
		throw new Error("OCR helper result has an invalid image size");
	}
	// Windows PowerShell writes a single word as an object.
	const list = Array.isArray(words) ? words : words && typeof words === "object" ? [words] : words == null ? [] : null;
	if (!list || list.length > MAX_OCR_WORDS) {
		throw new Error("OCR helper result has invalid words");
	}

	const lines = new Map<number, OcrWord[]>();
	let textBytes = 0;
	for (const item of list) {
		const { text, line, x, y, w, h } = (item ?? {}) as Record<string, unknown>;
		if (
			typeof text !== "string" ||
			!Number.isSafeInteger(line) ||
			Number(line) < 0 ||
			![x, y, w, h].every((n) => typeof n === "number" && Number.isFinite(n)) ||
			Number(w) < 0 ||
			Number(h) < 0
		) {
			throw new Error("OCR helper result has an invalid word");
		}
		textBytes += Buffer.byteLength(text, "utf8");
		if (textBytes > maxTextBytes) throw new RangeError("OCR helper text exceeds the byte limit");
		if (!text) continue;
		const words = lines.get(Number(line)) ?? [];
		words.push({ text, x: Number(x), y: Number(y), w: Number(w), h: Number(h) });
		lines.set(Number(line), words);
	}
	return {
		width: Number(width),
		height: Number(height),
		lines: [...lines.entries()].sort(([a], [b]) => a - b).map(([, words]) => words),
	};
}
