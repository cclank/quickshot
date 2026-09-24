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
