import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import asar from "@electron/asar";
import { verifyMacUpdateIdentity } from "./mac-signing-policy.mjs";
import { registerOnlyInstalledQuickShot } from "./mac-app-registration.mjs";

const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const projectManifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const arguments_ = process.argv.slice(2);
const checkOnly = arguments_.includes("--check");
const sourceArguments = arguments_.filter((argument) => argument !== "--check");
if (sourceArguments.length > 1 || sourceArguments.some((argument) => argument.startsWith("--"))) {
	throw new Error("Usage: node scripts/install-electron-mac.mjs [built-QuickShot.app] [--check]");
}
const source = path.resolve(sourceArguments[0] || path.join(root, "release", projectManifest.version, "mac-arm64", "QuickShot.app"));
const target = path.join(os.homedir(), "Applications", "QuickShot.app");
const identifier = "com.quickshot.app";
const launchServices = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
const executableSuffix = "/Contents/MacOS/QuickShot";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const plist = async (appPath, key) =>
	(await exec("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, path.join(appPath, "Contents/Info.plist")])).stdout.trim();
const exists = (file) => access(file).then(() => true, () => false);

if (process.platform !== "darwin" || source === target) {
	throw new Error("Usage: node scripts/install-electron-mac.mjs <built-QuickShot.app>");
}
if (await plist(source, "CFBundleIdentifier") !== identifier) {
	throw new Error("Unexpected application identifier");
}
await access(path.join(source, "Contents/Frameworks/Electron Framework.framework"));
await exec("codesign", ["--verify", "--deep", "--strict", source]);
await exec(process.execPath, [path.join(root, "scripts/verify-package.mjs"), source]);

const archive = path.join(source, "Contents/Resources/app.asar");
const manifest = JSON.parse(asar.extractFile(archive, "package.json").toString());
if (manifest.version !== projectManifest.version || await plist(source, "CFBundleShortVersionString") !== manifest.version) {
	throw new Error("Built app version does not match the project");
}
const rendererEntry = asar.listPackage(archive).find((entry) => /^\/dist\/assets\/index-.*\.js$/.test(entry));
if (!rendererEntry) throw new Error("Packaged renderer was not found");
const checkedFiles = ["dist/index.html", "dist-electron/main.js", "dist-electron/preload.mjs", rendererEntry.slice(1)];
const hashes = {};
for (const file of checkedFiles) {
	const bundled = asar.extractFile(archive, file);
	const built = await readFile(path.join(root, file));
	if (!bundled.equals(built)) throw new Error(`Stale package: ${file} differs from the latest build`);
	hashes[file] = sha256(bundled);
}
const archiveHash = sha256(await readFile(archive));
let signingRequirement = null;
if (await exists(target)) {
	if (await plist(target, "CFBundleIdentifier") !== identifier) {
		throw new Error("The existing QuickShot.app has an unexpected application identifier; it was left intact");
	}
	signingRequirement = await verifyMacUpdateIdentity(source, target);
}
if (checkOnly) {
	console.log(JSON.stringify({ source, target, signingRequirement, archiveSha256: archiveHash, checkOnly }, null, 2));
	process.exit(0);
}

async function runningQuickShots() {
	const { stdout } = await exec("ps", ["-axo", "pid=,command="]);
	const matches = [];
	for (const line of stdout.split("\n")) {
		const match = line.trim().match(/^(\d+)\s+(.+?\/Contents\/MacOS\/QuickShot)(?:\s|$)/);
		if (!match) continue;
		const appPath = match[2].slice(0, -executableSuffix.length);
		try {
			if (await plist(appPath, "CFBundleIdentifier") === identifier) {
				matches.push({ pid: Number(match[1]), appPath });
			}
		} catch { /* A process may exit while it is being inspected. */ }
	}
	return matches;
}

const previousProcesses = await runningQuickShots();
const appsDirectory = path.dirname(target);
await mkdir(appsDirectory, { recursive: true });
const stageDirectory = await mkdtemp(path.join(appsDirectory, ".quickshot-stage-"));
const stagedApp = path.join(stageDirectory, "QuickShot.app");
await exec("ditto", [source, stagedApp]);
await exec("codesign", ["--verify", "--deep", "--strict", stagedApp]);
if (sha256(await readFile(path.join(stagedApp, "Contents/Resources/app.asar"))) !== archiveHash) {
	throw new Error("Staged archive does not match the verified build");
}

for (const { pid } of previousProcesses) {
	try { process.kill(pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
}
const stopDeadline = Date.now() + 10_000;
while ((await runningQuickShots()).length > 0) {
	if (Date.now() >= stopDeadline) throw new Error("QuickShot did not exit; the installed app was left intact");
	await delay(150);
}

let backup = null;
let installed = false;
try {
	if (await exists(target)) {
		const backupRoot = path.join(os.homedir(), "Library", "Application Support", "quickshot", "app-backups.noindex");
		await mkdir(backupRoot, { recursive: true });
		const backupDirectory = await mkdtemp(path.join(backupRoot, "previous-"));
		backup = path.join(backupDirectory, "QuickShot.app");
		await rename(target, backup);
	}
	await rename(stagedApp, target);
	installed = true;
	await exec("codesign", ["--verify", "--deep", "--strict", target]);
	for (const previousApp of new Set([...previousProcesses.map(({ appPath }) => appPath), backup])) {
		if (previousApp && previousApp !== target) {
			await exec(launchServices, ["-u", previousApp]).catch(() => {});
		}
	}
	const registration = await registerOnlyInstalledQuickShot(target);
	await exec("open", ["-n", target]);
	let current;
	const launchDeadline = Date.now() + 15_000;
	do {
		await delay(250);
		current = await runningQuickShots();
		if (current.length === 1 && current[0].appPath === target) break;
	} while (Date.now() < launchDeadline);
	if (current.length !== 1 || current[0].appPath !== target) {
		throw new Error("The verified app did not become the sole running QuickShot");
	}
	const receipt = {
		installedAt: new Date().toISOString(),
		version: manifest.version,
		target,
		pid: current[0].pid,
		archiveSha256: archiveHash,
		hashes,
		signingRequirement,
		registration,
		backup,
		previousProcesses,
	};
	const receiptPath = path.join(root, "release", "last-local-install.json");
	await mkdir(path.dirname(receiptPath), { recursive: true });
	await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
	console.log(JSON.stringify({ ...receipt, receiptPath }, null, 2));
} catch (error) {
	if (installed) {
		for (const processInfo of await runningQuickShots()) {
			if (processInfo.appPath === target) {
				try { process.kill(processInfo.pid, "SIGTERM"); } catch { /* Already exited. */ }
			}
		}
		await rename(target, path.join(stageDirectory, "QuickShot-failed.app"));
	}
	if (backup) {
		await rename(backup, target);
		await exec("open", ["-n", target]);
	}
	throw error;
}
