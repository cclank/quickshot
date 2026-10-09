import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const projectRoot = path.resolve(import.meta.dirname, "..");
const distRoot = path.join(projectRoot, "dist");
const electronDistRoot = path.join(projectRoot, "dist-electron");

// Budgets leave headroom over the current build so regressions stand out.
const limits = {
	rendererBytes: 360_000,
	rendererGzipBytes: 112_000,
	mainBytes: 140_000,
	preloadBytes: 5_000,
	cssBytes: 42_000,
	distBytes: 19_000_000,
	thumbnailBytes: 160_000,
};

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

async function getSize(filePath) {
	return (await stat(filePath)).size;
}

async function getDirectorySize(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const sizes = await Promise.all(
		entries.map((entry) => {
			const entryPath = path.join(directory, entry.name);
			return entry.isDirectory()
				? getDirectorySize(entryPath)
				: getSize(entryPath);
		}),
	);
	return sizes.reduce((total, size) => total + size, 0);
}

async function listJpegs(directory) {
	return (await readdir(directory))
		.filter((name) => /^wallpaper\d+\.jpg$/.test(name))
		.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

await Promise.all([
	access(path.join(distRoot, "index.html")),
	access(path.join(electronDistRoot, "main.js")),
	access(path.join(electronDistRoot, "preload.mjs")),
]);

const builtIndexHtml = await readFile(
	path.join(distRoot, "index.html"),
	"utf8",
);
assert(
	builtIndexHtml.includes("img-src 'self' data: blob: file:"),
	"Built CSP must allow Blob-backed screenshot previews",
);
assert(
	builtIndexHtml.includes("connect-src 'self'"),
	"Built CSP must restrict connections to the application origin",
);
assert(
	!builtIndexHtml.includes("localhost") &&
		!builtIndexHtml.includes("127.0.0.1"),
	"Production CSP must not allow development server connections",
);

const assetNames = await readdir(path.join(distRoot, "assets"));
const rendererBundles = assetNames.filter(
	(name) => /^index-[\w-]+\.js$/.test(name),
);
assert(
	rendererBundles.length === 1,
	`Expected one renderer bundle, found ${rendererBundles.length}`,
);

const javascriptFiles = assetNames.filter((name) => name.endsWith(".js"));
const cssFiles = assetNames.filter((name) => name.endsWith(".css"));
const mainPath = path.join(electronDistRoot, "main.js");
const preloadPath = path.join(electronDistRoot, "preload.mjs");
const javascriptBuffers = await Promise.all(
	javascriptFiles.map((name) =>
		readFile(path.join(distRoot, "assets", name)),
	),
);
const rendererBytes = javascriptBuffers.reduce(
	(total, buffer) => total + buffer.byteLength,
	0,
);
const rendererGzipBytes = javascriptBuffers.reduce(
	(total, buffer) => total + gzipSync(buffer).byteLength,
	0,
);
const cssBytes = (
	await Promise.all(
		cssFiles.map((name) => getSize(path.join(distRoot, "assets", name))),
	)
).reduce((total, size) => total + size, 0);
const distBytes = await getDirectorySize(distRoot);
const mainBytes = await getSize(mainPath);
const preloadBytes = await getSize(preloadPath);

assert(
	rendererBytes <= limits.rendererBytes,
	`Renderer bundle ${rendererBytes} B exceeds ${limits.rendererBytes} B`,
);
assert(
	rendererGzipBytes <= limits.rendererGzipBytes,
	`Renderer gzip ${rendererGzipBytes} B exceeds ${limits.rendererGzipBytes} B`,
);
assert(
	mainBytes <= limits.mainBytes,
	`Main bundle ${mainBytes} B exceeds ${limits.mainBytes} B`,
);
assert(
	preloadBytes <= limits.preloadBytes,
	`Preload bundle ${preloadBytes} B exceeds ${limits.preloadBytes} B`,
);
assert(
	cssBytes <= limits.cssBytes,
	`Renderer CSS ${cssBytes} B exceeds ${limits.cssBytes} B`,
);
assert(
	distBytes <= limits.distBytes,
	`Built dist ${distBytes} B exceeds ${limits.distBytes} B`,
);

const publicThumbnails = await listJpegs(
	path.join(projectRoot, "public", "wallpapers", "thumbnails"),
);
const builtThumbnails = await listJpegs(
	path.join(distRoot, "wallpapers", "thumbnails"),
);
const builtWallpapers = await listJpegs(path.join(distRoot, "wallpapers"));

assert(publicThumbnails.length === 12, "Expected 12 source wallpaper thumbnails");
assert(builtThumbnails.length === 12, "Expected 12 built wallpaper thumbnails");
assert(builtWallpapers.length === 12, "Expected 12 built wallpaper originals");
assert(
	publicThumbnails.join("\n") === builtThumbnails.join("\n"),
	"Built wallpaper thumbnails do not match source thumbnails",
);

for (const name of publicThumbnails) {
	const [sourceBuffer, builtBuffer] = await Promise.all([
		readFile(path.join(projectRoot, "public", "wallpapers", "thumbnails", name)),
		readFile(path.join(distRoot, "wallpapers", "thumbnails", name)),
	]);
	assert(
		sourceBuffer.equals(builtBuffer),
		`Built wallpaper thumbnail ${name} differs from its source file`,
	);
}

const thumbnailSizes = await Promise.all(
	builtThumbnails.map((name) =>
		getSize(path.join(distRoot, "wallpapers", "thumbnails", name)),
	),
);
const thumbnailBytes = thumbnailSizes.reduce((total, size) => total + size, 0);
assert(
	thumbnailBytes <= limits.thumbnailBytes,
	`Wallpaper thumbnails ${thumbnailBytes} B exceed ${limits.thumbnailBytes} B`,
);

console.log(
	JSON.stringify(
		{
			renderer: {
				file: rendererBundles[0],
				chunks: javascriptFiles.length,
				bytes: rendererBytes,
				gzipBytes: rendererGzipBytes,
			},
			cssBytes,
			distBytes,
			mainBytes,
			preloadBytes,
			wallpapers: builtWallpapers.length,
			thumbnails: {
				count: builtThumbnails.length,
				bytes: thumbnailBytes,
			},
		},
		null,
		2,
	),
);
