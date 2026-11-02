import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(root, "docs");
const markdownFiles = [
	...readdirSync(root).filter((name) => name.endsWith(".md")).map((name) => join(root, name)),
	...readdirSync(docs).filter((name) => name.endsWith(".md")).map((name) => join(docs, name)),
];

describe("local documentation links", () => {
	it("points to existing files", () => {
		const broken = [];
		for (const file of markdownFiles) {
			const content = readFileSync(file, "utf8");
			for (const match of content.matchAll(/\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+["'][^)]*["'])?\)/g)) {
			const href = match[1].replace(/^<|>$/g, "");
			if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(href)) continue;
			const path = decodeURIComponent(href.split(/[?#]/, 1)[0]);
			if (path && !existsSync(resolve(dirname(file), path))) {
				broken.push(`${file.slice(root.length + 1)}: ${href}`);
			}
		}
		}
		expect(broken).toEqual([]);
	});
});
