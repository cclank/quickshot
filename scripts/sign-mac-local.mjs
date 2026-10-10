import { execFile } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { isStableRequirement, readDesignatedRequirement } from "./mac-signing-policy.mjs";

// Signs a locally built QuickShot.app with a stable identity from the login
// keychain, so macOS keeps the Screen Recording grant across updates.
const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const identity = process.env["QUICKSHOT_MAC_SIGNING_IDENTITY"] || "QuickShot Local Signing";
const app = path.resolve(process.argv[2] || path.join(root, "release", version, "mac-arm64", "QuickShot.app"));

if (process.platform !== "darwin") throw new Error("Local signing is only available on macOS");
await access(path.join(app, "Contents", "Info.plist"));

const { stdout: identities } = await exec("security", ["find-identity", "-p", "codesigning"]);
if (!identities.includes(`"${identity}"`)) {
	throw new Error(
		`Signing identity "${identity}" was not found in the keychain. Create it in Keychain Access (Certificate Assistant → Create a Certificate, type Code Signing) or set QUICKSHOT_MAC_SIGNING_IDENTITY.`,
	);
}

// Marks the bundle as a local build, which skips automatic update checks: a
// public release must not replace unreleased fixes or this signing identity.
await writeFile(path.join(app, "Contents", "Resources", "local-build"), "Built and signed on this Mac.\n");

const { stdout: bundleId } = await exec("plutil", [
	"-extract",
	"CFBundleIdentifier",
	"raw",
	"-o",
	"-",
	"--",
	path.join(app, "Contents", "Info.plist"),
]);
const { stdout: certificateInfo } = await exec("security", ["find-certificate", "-c", identity, "-Z"]);
const certificateHash = certificateInfo
	.match(/^SHA-1 hash:\s*([0-9A-Fa-f]{40})$/m)?.[1]
	?.toUpperCase();
if (!certificateHash) {
	throw new Error(`Could not read the SHA-1 of the "${identity}" certificate from the keychain.`);
}

// For a self-signed chain codesign derives a root-form requirement
// (`certificate root = …`), which the signing policy rejects. Pin the leaf
// certificate explicitly so the requirement is stable across builds.
const requirementArgument = `=designated => identifier "${bundleId.trim()}" and certificate leaf = H"${certificateHash}"`;

const sign = (target, extra = []) =>
	exec("codesign", ["--force", "--timestamp=none", ...extra, "--sign", identity, target]);

// Code outside the standard nested locations is sealed as a resource, so sign
// the helpers first: OCR, the window list, and the capture agent. The main
// bundle is signed without --deep: deep signing would stamp the explicit
// requirement onto every helper as well.
for (const helper of [
	["ocr", "quickshot-ocr"],
	["window-list", "quickshot-window-list"],
	["capture-agent", "quickshot-capture-agent"],
]) {
	const helperPath = path.join(app, "Contents", "Resources", ...helper);
	if (await access(helperPath).then(() => true, () => false)) await sign(helperPath);
}
await sign(app, ["--requirements", requirementArgument]);
await exec("codesign", ["--verify", "--deep", "--strict", app]);

const requirement = await readDesignatedRequirement(app);
if (!requirement || !isStableRequirement(requirement)) {
	throw new Error(`Signed app does not carry a stable requirement: ${requirement}`);
}
console.log(JSON.stringify({ app, identity, requirement }, null, 2));
