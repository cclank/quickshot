import { constants } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";
import asar from "@electron/asar";

const MAX_ASAR_BYTES = 20 * 1024 * 1024;
const MAX_OCR_HELPER_BYTES = 1024 * 1024;
const unpackedAppPath = process.argv[2];

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

async function findAsarPath(inputPath) {
	const resolvedInput = path.resolve(inputPath);
	const candidates = resolvedInput.endsWith(".asar")
		? [resolvedInput]
		: [
				path.join(resolvedInput, "resources", "app.asar"),
				path.join(resolvedInput, "Contents", "Resources", "app.asar"),
			];

	for (const candidate of candidates) {
		try {
			await access(candidate);
			return candidate;
		} catch {
			// Try the next supported unpacked application layout.
		}
	}

	throw new Error(
		`Could not find app.asar below ${resolvedInput}. Expected resources/app.asar or Contents/Resources/app.asar.`,
	);
}

async function listMatchingEntries(directory, suffix) {
	return (await readdir(directory))
		.filter((name) => name.endsWith(suffix))
		.sort();
}

function assertExactEntries(actual, expected, description) {
	const sortedExpected = [...expected].sort();
	assert(
		actual.join("\n") === sortedExpected.join("\n"),
		`${description} mismatch. Expected ${sortedExpected.join(", ")}, found ${actual.join(", ") || "(none)"}`,
	);
}

assert(
	typeof unpackedAppPath === "string" && unpackedAppPath.length > 0,
	"Usage: node scripts/verify-package.mjs <unpacked-app-directory-or-app.asar>",
);

const asarPath = await findAsarPath(unpackedAppPath);
const asarBytes = (await stat(asarPath)).size;
assert(
	asarBytes <= MAX_ASAR_BYTES,
	`app.asar ${asarBytes} B exceeds ${MAX_ASAR_BYTES} B`,
);

const entries = asar.listPackage(asarPath);
const entrySet = new Set(entries);
const forbiddenRoots = ["/public", "/node_modules"];

for (const forbiddenRoot of forbiddenRoots) {
	assert(
		!entries.some(
			(entry) =>
				entry === forbiddenRoot || entry.startsWith(`${forbiddenRoot}/`),
		),
		`Packaged application contains forbidden path ${forbiddenRoot}`,
	);
}

const requiredFiles = [
	"/dist/index.html",
	"/dist-electron/main.js",
	"/dist-electron/preload.mjs",
	"/dist/icon.png",
];

for (const requiredFile of requiredFiles) {
	assert(
		entrySet.has(requiredFile),
		`Packaged application is missing ${requiredFile}`,
	);
}

const expectedWallpaperFiles = Array.from(
	{ length: 12 },
	(_, index) => `/dist/wallpapers/wallpaper${index + 1}.jpg`,
);
const expectedThumbnailFiles = Array.from(
	{ length: 12 },
	(_, index) =>
		`/dist/wallpapers/thumbnails/wallpaper${index + 1}.jpg`,
);

for (const expectedFile of [
	...expectedWallpaperFiles,
	...expectedThumbnailFiles,
]) {
	assert(
		entrySet.has(expectedFile),
		`Packaged application is missing ${expectedFile}`,
	);
}

const wallpaperFiles = entries.filter((entry) =>
	/^\/dist\/wallpapers\/wallpaper\d+\.jpg$/.test(entry),
);
const thumbnailFiles = entries.filter((entry) =>
	/^\/dist\/wallpapers\/thumbnails\/wallpaper\d+\.jpg$/.test(entry),
);

assert(
	wallpaperFiles.length === expectedWallpaperFiles.length,
	`Expected 12 packaged wallpaper originals, found ${wallpaperFiles.length}`,
);
assert(
	thumbnailFiles.length === expectedThumbnailFiles.length,
	`Expected 12 packaged wallpaper thumbnails, found ${thumbnailFiles.length}`,
);

const resourcesDirectory = path.dirname(asarPath);
const isMacPackage = path.basename(path.dirname(resourcesDirectory)) === "Contents";
let localeFiles;
let ocrHelper;

if (isMacPackage) {
	const unpackedAppRoot = path.resolve(resourcesDirectory, "..", "..");
	const macLocaleDirectories = [
		resourcesDirectory,
		path.join(
			unpackedAppRoot,
			"Contents",
			"Frameworks",
			"Electron Framework.framework",
			"Versions",
			"A",
			"Resources",
		),
	];
	const expectedMacLocales = ["en.lproj", "zh_CN.lproj", "zh_TW.lproj"];

	for (const localeDirectory of macLocaleDirectories) {
		const locales = await listMatchingEntries(localeDirectory, ".lproj");
		assertExactEntries(locales, expectedMacLocales, `Locales in ${localeDirectory}`);
	}
	localeFiles = expectedMacLocales;

	const ocrHelperPath = path.join(
		resourcesDirectory,
		"ocr",
		"quickshot-ocr",
	);
	await access(ocrHelperPath, constants.X_OK);
	const ocrHelperStat = await stat(ocrHelperPath);
	assert(ocrHelperStat.isFile(), `OCR helper is not a file: ${ocrHelperPath}`);
	assert(ocrHelperStat.size > 0, `OCR helper is empty: ${ocrHelperPath}`);
	assert(
		ocrHelperStat.size <= MAX_OCR_HELPER_BYTES,
		`OCR helper ${ocrHelperStat.size} B exceeds ${MAX_OCR_HELPER_BYTES} B`,
	);
	assert(
		(ocrHelperStat.mode & 0o111) !== 0,
		`OCR helper is not executable: ${ocrHelperPath}`,
	);
	ocrHelper = {
		path: ocrHelperPath,
		bytes: ocrHelperStat.size,
		maxBytes: MAX_OCR_HELPER_BYTES,
	};

	const windowListHelperPath = path.join(
		resourcesDirectory,
		"window-list",
		"quickshot-window-list",
	);
	await access(windowListHelperPath, constants.X_OK);
	const windowListStat = await stat(windowListHelperPath);
	assert(
		windowListStat.isFile() && windowListStat.size > 0 && windowListStat.size <= MAX_OCR_HELPER_BYTES,
		`Window list helper is missing or invalid: ${windowListHelperPath}`,
	);

	const captureAgentPath = path.join(
		resourcesDirectory,
		"capture-agent",
		"quickshot-capture-agent",
	);
	await access(captureAgentPath, constants.X_OK);
	const captureAgentStat = await stat(captureAgentPath);
	assert(
		captureAgentStat.isFile() && captureAgentStat.size > 0 && captureAgentStat.size <= MAX_OCR_HELPER_BYTES,
		`Capture agent is missing or invalid: ${captureAgentPath}`,
	);
} else {
	const unpackedAppRoot = path.resolve(resourcesDirectory, "..");
	const localeDirectory = path.join(unpackedAppRoot, "locales");
	const expectedLocales = ["en-US.pak", "zh-CN.pak", "zh-TW.pak"];
	const locales = await listMatchingEntries(localeDirectory, ".pak");
	assertExactEntries(locales, expectedLocales, `Locales in ${localeDirectory}`);
	localeFiles = locales;
}

console.log(
	JSON.stringify(
		{
			asarPath,
			asarBytes,
			maxAsarBytes: MAX_ASAR_BYTES,
			entries: entries.length,
			wallpapers: wallpaperFiles.length,
			thumbnails: thumbnailFiles.length,
			locales: localeFiles,
			ocrHelper,
		},
		null,
		2,
	),
);
