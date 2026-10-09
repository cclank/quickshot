import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export async function readDesignatedRequirement(app, run = exec) {
	const { stdout = "", stderr = "" } = await run("codesign", ["-d", "-r-", app]);
	return `${stdout}\n${stderr}`.match(/^(?:#\s*)?designated => (.+)$/m)?.[1]?.trim() ?? null;
}

// The certificate QuickShot for macOS is signed with, on this Mac
// (scripts/sign-mac-local.mjs) and for releases (CSC_LINK, scripts/mac-sign.mjs).
// Users grant Screen Recording to this requirement: changing the certificate
// makes macOS ask every one of them again.
export const RELEASE_REQUIREMENT =
	'identifier "com.quickshot.app" and certificate leaf = H"04da0be632515e04ce46fe9be3f36a8ee76597c6"';

/** Fails unless `app` is validly signed with the release certificate. */
export async function verifyReleaseSignature(app, run = exec) {
	await run("codesign", ["--verify", "--deep", "--strict", `-R=${RELEASE_REQUIREMENT}`, app]);
	const requirement = await readDesignatedRequirement(app, run);
	if (requirement !== RELEASE_REQUIREMENT) {
		throw new Error(`${app} requires ${requirement ?? "nothing"} instead of the release certificate`);
	}
	return requirement;
}

/** A requirement bound to a certificate survives rebuilds; a cdhash one does not. */
export function isStableRequirement(requirement) {
	return /certificate leaf\s*=\s*H"[0-9a-f]+"/i.test(requirement) || /\banchor apple\b/.test(requirement);
}

// Check identity continuity before stopping or moving the user's installed app.
// A matching bundle name/version alone does not preserve the signing requirement.
export async function verifyMacUpdateIdentity(source, target, run = exec) {
	await run("codesign", ["--verify", "--deep", "--strict", target]);
	const requirement = await readDesignatedRequirement(target, run);
	if (!requirement) {
		throw new Error("无法读取已安装 QuickShot 的签名身份；应用保持原样。");
	}
	try {
		await run("codesign", ["--verify", "--deep", "--strict", `-R=${requirement}`, source]);
	} catch (cause) {
		throw new Error(
			"停止替换：新包与已安装 QuickShot 的签名身份不兼容，继续安装可能要求重新授权。请先确认固定签名的迁移方案；应用及现有权限保持原样。",
			{ cause },
		);
	}
	return requirement;
}

/**
 * The one-time, explicitly requested move from an ad-hoc install (whose
 * requirement is bound to one build's cdhash) to a stable signing identity.
 * Screen Recording must be granted again once; later updates then pass
 * verifyMacUpdateIdentity unchanged.
 */
export async function verifyMacSigningMigration(source, target, run = exec) {
	await run("codesign", ["--verify", "--deep", "--strict", target]);
	const installed = await readDesignatedRequirement(target, run);
	if (!installed) {
		throw new Error("无法读取已安装 QuickShot 的签名身份；应用保持原样。");
	}
	if (isStableRequirement(installed)) {
		throw new Error("已安装的 QuickShot 已使用固定签名，请用常规安装，不需要迁移。");
	}
	const next = await readDesignatedRequirement(source, run);
	if (!next || !isStableRequirement(next)) {
		throw new Error("新包没有使用固定签名身份，迁移已停止；应用保持原样。");
	}
	await run("codesign", ["--verify", "--deep", "--strict", `-R=${next}`, source]);
	return { from: installed, to: next };
}

/**
 * Used only when the user has explicitly accepted granting Screen Recording
 * again. Both apps must still carry valid, readable signatures.
 */
export async function verifyMacReauthorizedChange(source, target, run = exec) {
	await run("codesign", ["--verify", "--deep", "--strict", target]);
	const installed = await readDesignatedRequirement(target, run);
	const next = await readDesignatedRequirement(source, run);
	if (!installed || !next) {
		throw new Error("无法读取签名身份；应用保持原样。");
	}
	await run("codesign", ["--verify", "--deep", "--strict", `-R=${next}`, source]);
	return { from: installed, to: next, acceptedReauthorization: true };
}
