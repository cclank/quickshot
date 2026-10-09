import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { buildUpdateFeed, feedJson } from "./write-update-feed.mjs";

// Mirrors a published GitHub release to dl.lanshuagent.com, where QuickShot
// looks for updates first (it is quicker to reach than GitHub for many):
//   WRANGLER=~/code/tokei/node_modules/.bin/wrangler node scripts/publish-update-feed.mjs v1.3.0 [--dry-run]
// Downloads the release's installers, checks them against GitHub's digests,
// uploads them and latest.json to the R2 bucket, then reads everything back.

const exec = promisify(execFile);
const REPO = "cclank/quickshot";
const BUCKET_PATH = "lanshu/quickshot";
const BASE_URL = "https://dl.lanshuagent.com/quickshot";

const [tag, flag] = process.argv.slice(2);
const dryRun = flag === "--dry-run";
if (!/^v\d+\.\d+\.\d+$/.test(tag ?? "")) {
	console.error("Usage: node scripts/publish-update-feed.mjs <vX.Y.Z> [--dry-run]");
	process.exit(2);
}
const wrangler = process.env.WRANGLER || "wrangler";

const run = async (command, args, options = {}) =>
	(await exec(command, args, { maxBuffer: 16 * 1024 * 1024, ...options })).stdout;

const release = JSON.parse(await run("gh", ["api", `repos/${REPO}/releases/tags/${tag}`]));
if (release.draft) throw new Error(`${tag} is still a draft; publish it on GitHub first.`);
const digests = new Map(release.assets.map((asset) => [asset.name, String(asset.digest ?? "").replace(/^sha256:/, "")]));

const folder = await mkdtemp(path.join(os.tmpdir(), "quickshot-feed-"));
try {
	console.log(`==> Downloading ${tag} from GitHub`);
	await run("gh", ["release", "download", tag, "--repo", REPO, "--dir", folder, "--pattern", "*.dmg", "--pattern", "*-Setup.exe"]);
	const feed = await buildUpdateFeed(folder, tag, BASE_URL);
	for (const { file, sha256 } of Object.values(feed.assets)) {
		const name = path.basename(file);
		if (digests.get(name) !== sha256) throw new Error(`${name} does not match GitHub's digest`);
	}
	const latest = path.join(folder, "latest.json");
	await writeFile(latest, feedJson(feed));
	console.log(feedJson(feed));
	if (dryRun) {
		console.log("Dry run: nothing uploaded.");
	} else {
		await upload(feed, latest);
	}
} finally {
	await rm(folder, { recursive: true, force: true });
}

async function upload(feed, latest) {
	console.log("==> Uploading to R2");
	for (const { file } of Object.values(feed.assets)) {
		const name = path.basename(file);
		await run(wrangler, ["r2", "object", "put", `${BUCKET_PATH}/${name}`, `--file=${file}`, "--content-type=application/octet-stream", "--remote"]);
		console.log(`    ${name}`);
	}
	// The feed goes last, so it never points at an installer that is not there yet.
	await run(wrangler, [
		"r2", "object", "put", `${BUCKET_PATH}/latest.json`, `--file=${latest}`,
		"--content-type=application/json", "--cache-control=no-cache", "--remote",
	]);

	console.log("==> Checking what is served");
	const served = JSON.parse(await run("curl", ["-sf", `${BASE_URL}/latest.json?ts=${Date.now()}`]));
	if (served.tag_name !== feed.tag_name) throw new Error(`latest.json says ${served.tag_name}`);
	for (const [target, asset] of Object.entries(feed.assets)) {
		if (served.assets?.[target]?.sha256 !== asset.sha256) throw new Error(`latest.json has another checksum for ${target}`);
		const servedHash = (await run("/bin/sh", ["-c", `curl -sf "$0" | shasum -a 256`, asset.url])).split(" ")[0];
		if (servedHash !== asset.sha256) throw new Error(`${asset.url} serves different bytes`);
	}
	console.log(`✅ ${tag} is on dl.lanshuagent.com and matches GitHub`);
}
