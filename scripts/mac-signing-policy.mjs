import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

// Check identity continuity before stopping or moving the user's installed app.
// A matching bundle name/version alone does not preserve the signing requirement.
export async function verifyMacUpdateIdentity(source, target, run = exec) {
	await run("codesign", ["--verify", "--deep", "--strict", target]);
	const { stdout = "", stderr = "" } = await run("codesign", ["-d", "-r-", target]);
	const requirement = `${stdout}\n${stderr}`
		.match(/^(?:#\s*)?designated => (.+)$/m)?.[1]?.trim();
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
