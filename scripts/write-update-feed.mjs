import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

// Writes the update feed QuickShot checks (see electron/updates.ts) for the
// installers in a folder:
//   node scripts/write-update-feed.mjs <installers-folder> <tag> <base-url> <latest.json>
// CI attaches it to each GitHub release (base URL: the release's download
// folder); scripts/publish-update-feed.mjs mirrors it to dl.lanshuagent.com.

const PATTERNS = {
	"mac-arm64": /^QuickShot-Mac-arm64-(\d+\.\d+\.\d+)\.dmg$/,
	"mac-x64": /^QuickShot-Mac-x64-(\d+\.\d+\.\d+)\.dmg$/,
	"win-x64": /^QuickShot-Win-x64-(\d+\.\d+\.\d+)-Setup\.exe$/,
};

export async function sha256(file) {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(file)) hash.update(chunk);
	return hash.digest("hex");
}

async function filesIn(folder) {
	const entries = await readdir(folder, { withFileTypes: true, recursive: true });
	return entries.filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath ?? entry.path, entry.name));
}

export async function buildUpdateFeed(folder, tag, baseUrl) {
	const version = tag.replace(/^v/, "");
	if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Not a release tag: ${tag}`);
	const base = baseUrl.replace(/\/+$/, "");
	const assets = {};
	for (const file of await filesIn(folder)) {
		const name = path.basename(file);
		for (const [target, pattern] of Object.entries(PATTERNS)) {
			const match = pattern.exec(name);
			if (!match) continue;
			if (match[1] !== version) throw new Error(`${name} does not belong to ${tag}`);
			if (assets[target]) throw new Error(`Two installers for ${target}`);
			assets[target] = {
				url: `${base}/${encodeURIComponent(name)}`,
				sha256: await sha256(file),
				size: (await stat(file)).size,
				file,
			};
		}
	}
	const missing = Object.keys(PATTERNS).filter((target) => !assets[target]);
	if (missing.length) throw new Error(`Missing installers: ${missing.join(", ")}`);
	return { tag_name: `v${version}`, assets };
}

/** The feed as published: no local paths. */
export function feedJson(feed) {
	const assets = Object.fromEntries(
		Object.entries(feed.assets).map(([target, { url, sha256, size }]) => [target, { url, sha256, size }]),
	);
	return `${JSON.stringify({ tag_name: feed.tag_name, assets }, null, 2)}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const [folder, tag, baseUrl, output] = process.argv.slice(2);
	if (!folder || !tag || !baseUrl || !output) {
		console.error("Usage: node scripts/write-update-feed.mjs <installers-folder> <tag> <base-url> <latest.json>");
		process.exit(2);
	}
	const feed = await buildUpdateFeed(folder, tag, baseUrl);
	await writeFile(output, feedJson(feed));
	console.log(`Wrote ${output} for ${feed.tag_name}: ${Object.keys(feed.assets).join(", ")}`);
}
