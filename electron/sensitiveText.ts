/**
 * Smart redaction: finds what a screenshot should not share in the text
 * recognized on it (this computer's user and host names, home folders, email
 * and IP addresses, keys and tokens) and returns the image regions to cover.
 * Recognition gives each word a box; a match inside a word gets its share of
 * the word's width, which is exact for the monospaced text of terminals.
 */

export type OcrWord = { text: string; x: number; y: number; w: number; h: number };
export type SensitiveKind = "user" | "host" | "email" | "ip" | "secret";
export type SensitiveRegion = { kind: SensitiveKind; x: number; y: number; w: number; h: number };
/** Names that identify this computer and the person using it. */
export type MachineIdentity = { users: readonly string[]; hosts: readonly string[] };

type Match = { start: number; end: number; kind: SensitiveKind; toWordEnd?: boolean };

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿＀-￯]/u;
const WIDE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿！-｠￠-￦]/u;
const ALNUM = /[\p{L}\p{N}]/u;

/** Characters recognition confuses in names: l, I, 1 and |; o, O, 0 and ø. */
const CONFUSABLE: Record<string, string> = {
	I: "l",
	"|": "l",
	"1": "l",
	"!": "l",
	O: "o",
	"0": "o",
	ø: "o",
	Ø: "o",
};

/** Folds case and confusable characters, one code unit for one, so indices still line up. */
export function foldForMatching(text: string) {
	let folded = "";
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		const lower = (CONFUSABLE[char] ?? char).toLowerCase();
		folded += lower.length === 1 ? lower : char;
	}
	return folded;
}

// ── Patterns ─────────────────────────────────────────────────────────────────

/** user@host at the start of a line, after an optional "(venv) " and a few symbols. */
const AT_SIGN = /(?<![\w.@-])([A-Za-z_][\w.-]{0,31})@([A-Za-z][\w-]*(?:\.[\w-]+)*)/g;
const PROMPT_PREFIX = /^(?:\([^()]*\)\s*)*[^\p{L}\p{N}]{0,4}$/u;
const HOME_FOLDER = /(?:\/(?:Users|home)\/|\b[A-Za-z]:\\Users\\)([^/\\\s:"'<>|]+)/gi;
const SHARED_FOLDERS = new Set(["shared", "public", "default", "guest", "all users", "default user"]);
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const IPV4 =
	/(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?!\d|\.\d)/g;
/** IPv6 and MAC addresses; validated below so times like 14:02:11 stay. */
const COLON_HEX = /(?<![\w:])[0-9A-Fa-f:]*:[0-9A-Fa-f:]*:[0-9A-Fa-f:]*(?:%[\w.]+)?(?![\w:])/g;
const KEY_PREFIXES = new RegExp(
	[
		"sk-(?:proj-|ant-|or-)?[A-Za-z0-9_-]{16,}",
		"gh[pousr]_[A-Za-z0-9]{20,}",
		"github_pat_[A-Za-z0-9_]{20,}",
		"glpat-[A-Za-z0-9_-]{16,}",
		"(?:AKIA|ASIA)[0-9A-Z]{16}",
		"AIza[0-9A-Za-z_-]{30,}",
		"xox[abposr]-[A-Za-z0-9-]{10,}",
		"(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}",
		"npm_[A-Za-z0-9]{30,}",
		"hf_[A-Za-z0-9]{30,}",
		"eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}",
	]
		.map((pattern) => `(?<![A-Za-z0-9_-])${pattern}`)
		.join("|"),
	"g",
);
/** NAME_KEY=value, password: value, --token value, Bearer value; the value is the last group. */
const SECRET_VALUES = [
	/(?<![A-Za-z0-9])[A-Za-z0-9_.-]*(?:key|token|secret|passw(?:or)?d|pwd|credential)s?["']?\s*[:=]\s*["']?([^\s"',;]{6,})/gi,
	/(?<![\w-])--?(?:api[-_]?key|token|password|passwd|secret|auth)(?:=|\s+)["']?([^\s"']{6,})/gi,
	/\bBearer\s+([A-Za-z0-9._~+/-]{16,}=*)/g,
];
/** Values that only name a secret: $VAR, ${VAR}, <your-key>, process.env.X, ****. */
const PLACEHOLDER = /^(?:[$<{%]|process\.env|os\.environ|[*x•.]+$|\d+$|true$|false$|null$|none$|undefined$)/i;

function* matchesOf(pattern: RegExp, text: string) {
	pattern.lastIndex = 0;
	for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
		yield match;
		if (match[0].length === 0) pattern.lastIndex += 1;
	}
}

/** Where the last capture group starts; every pattern above ends with it. */
function lastGroupStart(match: RegExpExecArray, group = match[match.length - 1]) {
	return match.index + match[0].length - group.length;
}

function isColonHexAddress(candidate: string) {
	const address = candidate.replace(/%.*$/, "");
	const groups = address.split(":");
	if (groups.some((group) => group.length > 4)) return false;
	if (address.includes("::")) {
		return !address.includes(":::") && address.replace(/:/g, "").length >= 5;
	}
	return groups.length >= 6 && groups.every((group) => group.length > 0);
}

function findTerm(folded: string, original: string, term: string, kind: SensitiveKind, matches: Match[]) {
	for (let start = folded.indexOf(term); start >= 0; start = folded.indexOf(term, start + 1)) {
		const end = start + term.length;
		if (ALNUM.test(original[start - 1] ?? "") || ALNUM.test(original[end] ?? "")) continue;
		matches.push({ start, end, kind });
	}
}

type Terms = { users: string[]; standaloneUsers: string[]; hosts: string[] };

function prepareTerms(identity: MachineIdentity): Terms {
	const unique = (values: readonly string[], minimum: number) => [
		...new Set(
			values
				.map((value) => foldForMatching(value.trim().replace(/\s+/g, " ")))
				.filter((value) => value.length >= minimum),
		),
	];
	const users = unique(identity.users, 1);
	return {
		users,
		// A short name like "li" would match all over; it counts only in a prompt or a path.
		standaloneUsers: users.filter((user) => user.length >= 3),
		hosts: unique(identity.hosts, 3).filter((host) => host !== "localhost"),
	};
}

/** Every sensitive range in one line of text. */
export function findSensitiveRanges(text: string, identity: MachineIdentity): Match[] {
	return findRanges(text, prepareTerms(identity));
}

function findRanges(text: string, terms: Terms): Match[] {
	const matches: Match[] = [];
	const folded = foldForMatching(text);

	for (const match of matchesOf(KEY_PREFIXES, text)) {
		matches.push({ start: match.index, end: match.index + match[0].length, kind: "secret", toWordEnd: true });
	}
	for (const pattern of SECRET_VALUES) {
		for (const match of matchesOf(pattern, text)) {
			const value = match[match.length - 1];
			if (PLACEHOLDER.test(value) || !/[A-Za-z]/.test(value)) continue;
			const start = lastGroupStart(match, value);
			matches.push({ start, end: start + value.length, kind: "secret", toWordEnd: true });
		}
	}

	for (const match of matchesOf(EMAIL, text)) {
		if (/^git@/i.test(match[0])) continue;
		matches.push({ start: match.index, end: match.index + match[0].length, kind: "email" });
	}

	for (const match of matchesOf(AT_SIGN, text)) {
		const [, user, host] = match;
		if (user.toLowerCase() === "git") continue;
		const atStart = PROMPT_PREFIX.test(text.slice(0, match.index));
		if (!atStart && !terms.users.includes(foldForMatching(user))) continue;
		const hostStart = match.index + user.length + 1;
		matches.push({ start: match.index, end: match.index + user.length, kind: "user" });
		matches.push({ start: hostStart, end: hostStart + host.length, kind: "host" });
	}

	for (const match of matchesOf(HOME_FOLDER, text)) {
		const name = match[1];
		if (SHARED_FOLDERS.has(name.toLowerCase())) continue;
		const start = lastGroupStart(match, name);
		matches.push({ start, end: start + name.length, kind: "user" });
	}

	for (const user of terms.standaloneUsers) findTerm(folded, text, user, "user", matches);
	for (const host of terms.hosts) findTerm(folded, text, host, "host", matches);

	for (const match of matchesOf(IPV4, text)) {
		if (/^(?:0|127|255)\./.test(match[0])) continue;
		matches.push({ start: match.index, end: match.index + match[0].length, kind: "ip" });
	}
	for (const match of matchesOf(COLON_HEX, text)) {
		if (!isColonHexAddress(match[0])) continue;
		matches.push({ start: match.index, end: match.index + match[0].length, kind: "ip" });
	}
	return matches;
}

// ── From text ranges to image regions ────────────────────────────────────────

/** A line's words joined as recognition reads them; CJK characters are not spaced apart. */
export function lineText(words: readonly OcrWord[]) {
	let text = "";
	const starts: number[] = [];
	words.forEach((word, index) => {
		if (index > 0 && !(CJK.test(text[text.length - 1] ?? "") && CJK.test(word.text[0] ?? ""))) text += " ";
		starts.push(text.length);
		text += word.text;
	});
	return { text, starts };
}

/** Running display width of a word, counting wide characters twice. */
function columns(text: string) {
	const result = [0];
	for (let index = 0; index < text.length; index += 1) {
		result.push(result[index] + (WIDE.test(text[index]) ? 2 : 1));
	}
	return result;
}

type Box = { kind: SensitiveKind; x0: number; y0: number; x1: number; y1: number };

function boxFor(match: Match, words: readonly OcrWord[], starts: readonly number[]): Box | null {
	const box: Box = { kind: match.kind, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
	for (const [index, word] of words.entries()) {
		const wordStart = starts[index];
		const wordEnd = wordStart + word.text.length;
		const start = Math.max(match.start, wordStart);
		let end = Math.min(match.end, wordEnd);
		if (start >= end) continue;
		// Keys run to the end of their word, past characters recognition got wrong.
		if (match.toWordEnd) end = wordEnd;
		const widths = columns(word.text);
		const unit = word.w / widths[widths.length - 1];
		box.x0 = Math.min(box.x0, word.x + widths[start - wordStart] * unit);
		box.x1 = Math.max(box.x1, word.x + widths[end - wordStart] * unit);
		box.y0 = Math.min(box.y0, word.y);
		box.y1 = Math.max(box.y1, word.y + word.h);
	}
	return box.x1 > box.x0 ? box : null;
}

/** Joins boxes on a line that overlap, so each place is covered once. */
function mergeBoxes(boxes: Box[]) {
	const sorted = [...boxes].sort((a, b) => a.x0 - b.x0);
	const merged: Box[] = [];
	for (const box of sorted) {
		const last = merged[merged.length - 1];
		if (last && box.x0 < last.x1) {
			last.x1 = Math.max(last.x1, box.x1);
			last.y0 = Math.min(last.y0, box.y0);
			last.y1 = Math.max(last.y1, box.y1);
		} else {
			merged.push({ ...box });
		}
	}
	return merged;
}

export type SensitiveRegions = { regions: SensitiveRegion[]; kinds: SensitiveKind[] };

/**
 * The regions to redact in an image of `size`, from its recognized lines.
 * Each region is padded a little, so the edges of letters are covered too.
 */
export function findSensitiveRegions(
	lines: readonly (readonly OcrWord[])[],
	identity: MachineIdentity,
	size: { width: number; height: number },
): SensitiveRegions {
	const terms = prepareTerms(identity);
	const regions: SensitiveRegion[] = [];
	const kinds = new Set<SensitiveKind>();
	for (const words of lines) {
		const { text, starts } = lineText(words);
		const boxes = findRanges(text, terms)
			.map((match) => boxFor(match, words, starts))
			.filter((box): box is Box => box !== null);
		for (const box of mergeBoxes(boxes)) {
			const height = box.y1 - box.y0;
			const padX = Math.max(2, height * 0.12);
			const padY = Math.max(1, height * 0.1);
			const x = Math.max(0, Math.floor(box.x0 - padX));
			const y = Math.max(0, Math.floor(box.y0 - padY));
			const right = Math.min(size.width, Math.ceil(box.x1 + padX));
			const bottom = Math.min(size.height, Math.ceil(box.y1 + padY));
			if (right - x < 1 || bottom - y < 1) continue;
			regions.push({ kind: box.kind, x, y, w: right - x, h: bottom - y });
			kinds.add(box.kind);
		}
	}
	return { regions, kinds: [...kinds] };
}
