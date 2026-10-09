import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";

// electron-builder's mac.sign hook. electron-builder signs only with
// identities macOS trusts, so it passes over QuickShot's self-signed release
// certificate (imported from CSC_LINK) and would fall back to an ad hoc
// signature, whose designated requirement changes with every build. This
// signs with the imported certificate anyway, exactly as electron-builder
// would sign with a trusted one: releases then keep one requirement, and
// macOS keeps the Screen Recording grant across updates.

const exec = promisify(execFile);
const { sign } = createRequire(import.meta.url)("app-builder-lib/out/codeSign/macCodeSign");

/** The SHA-1 of the one code signing identity in `security find-identity` output. */
export function identityFromFindIdentity(output) {
	const hashes = new Set([...output.matchAll(/^\s*\d+\)\s+([0-9A-F]{40})\s/gm)].map((match) => match[1]));
	if (hashes.size !== 1) {
		throw new Error(`Expected one code signing identity in the imported certificate, found ${hashes.size}`);
	}
	return [...hashes][0];
}

export default async function signQuickShot(options) {
	let identity = options.identity;
	if (!identity && options.keychain) {
		const { stdout } = await exec("security", ["find-identity", "-p", "codesigning", options.keychain]);
		identity = identityFromFindIdentity(stdout);
	}
	// Without a certificate, sign ad hoc, as electron-builder does by default.
	await sign({ ...options, identity: identity || "-" });
}
