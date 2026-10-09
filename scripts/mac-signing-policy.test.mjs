import { describe, expect, it, vi } from "vitest";
import {
	RELEASE_REQUIREMENT,
	isStableRequirement,
	verifyMacReauthorizedChange,
	verifyMacSigningMigration,
	verifyMacUpdateIdentity,
	verifyReleaseSignature,
} from "./mac-signing-policy.mjs";

const source = "/build/QuickShot.app";
const target = "/Applications/QuickShot.app";

describe("macOS in-place update signing identity", () => {
	it.each(["stdout", "stderr"])("reads the installed requirement from %s", async (stream) => {
		const requirement = 'identifier "com.quickshot.app" and anchor apple generic';
		const run = vi.fn()
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ [stream]: `Executable=${target}\n# designated => ${requirement}\n` })
			.mockResolvedValueOnce({});
		await expect(verifyMacUpdateIdentity(source, target, run)).resolves.toBe(requirement);
		expect(run).toHaveBeenLastCalledWith("codesign", [
			"--verify", "--deep", "--strict", `-R=${requirement}`, source,
		]);
	});

	it("also verifies an ad-hoc requirement instead of skipping it", async () => {
		const requirement = 'cdhash H"0123456789abcdef0123456789abcdef01234567"';
		const run = vi.fn()
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ stderr: `# designated => ${requirement}` })
			.mockResolvedValueOnce({});
		await expect(verifyMacUpdateIdentity(source, target, run)).resolves.toBe(requirement);
		expect(run.mock.calls[2][1]).toContain(`-R=${requirement}`);
	});

	it("rejects an identity change even when the app name is unchanged", async () => {
		const run = vi.fn()
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ stderr: '# designated => cdhash H"old"' })
			.mockRejectedValueOnce(new Error("failed to satisfy code requirement(s)"));
		await expect(verifyMacUpdateIdentity(source, target, run)).rejects.toThrow("停止替换");
	});

	it("fails closed when no installed requirement can be read", async () => {
		const run = vi.fn()
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ stdout: "", stderr: "Executable=/Applications/QuickShot.app" });
		await expect(verifyMacUpdateIdentity(source, target, run)).rejects.toThrow("无法读取");
		expect(run).toHaveBeenCalledTimes(2);
	});

	it("does not trust an invalid installed signature", async () => {
		const run = vi.fn().mockRejectedValueOnce(new Error("invalid signature"));
		await expect(verifyMacUpdateIdentity(source, target, run)).rejects.toThrow("invalid signature");
		expect(run).toHaveBeenCalledTimes(1);
	});
});

describe("one-time migration to a stable signing identity", () => {
	const adHoc = 'cdhash H"0123456789abcdef0123456789abcdef01234567"';
	const stable = 'identifier "com.quickshot.app" and certificate leaf = H"89abcdef0123456789abcdef0123456789abcdef"';

	it("recognizes certificate-bound requirements as stable", () => {
		expect(isStableRequirement(stable)).toBe(true);
		expect(isStableRequirement('identifier "x" and anchor apple generic')).toBe(true);
		expect(isStableRequirement(adHoc)).toBe(false);
	});

	it("allows moving an ad-hoc install to a certificate-signed build", async () => {
		const run = vi.fn()
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ stderr: `# designated => ${adHoc}` })
			.mockResolvedValueOnce({ stderr: `# designated => ${stable}` })
			.mockResolvedValueOnce({});
		await expect(verifyMacSigningMigration(source, target, run)).resolves.toEqual({
			from: adHoc,
			to: stable,
		});
		expect(run).toHaveBeenLastCalledWith("codesign", [
			"--verify", "--deep", "--strict", `-R=${stable}`, source,
		]);
	});

	it("refuses to migrate to another ad-hoc build", async () => {
		const run = vi.fn()
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ stderr: `# designated => ${adHoc}` })
			.mockResolvedValueOnce({ stderr: '# designated => cdhash H"fedcba"' });
		await expect(verifyMacSigningMigration(source, target, run)).rejects.toThrow("没有使用固定签名");
	});

	it("refuses to migrate away from an already stable install", async () => {
		const run = vi.fn()
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ stderr: `# designated => ${stable}` });
		await expect(verifyMacSigningMigration(source, target, run)).rejects.toThrow("已使用固定签名");
	});
});

describe("user-accepted re-authorization", () => {
	it("records both requirements and still validates the new build", async () => {
		const run = vi.fn()
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ stderr: '# designated => cdhash H"old"' })
			.mockResolvedValueOnce({ stderr: '# designated => cdhash H"new"' })
			.mockResolvedValueOnce({});
		await expect(verifyMacReauthorizedChange(source, target, run)).resolves.toEqual({
			from: 'cdhash H"old"',
			to: 'cdhash H"new"',
			acceptedReauthorization: true,
		});
		expect(run).toHaveBeenLastCalledWith("codesign", [
			"--verify", "--deep", "--strict", '-R=cdhash H"new"', source,
		]);
	});

	it("stops when a requirement cannot be read", async () => {
		const run = vi.fn()
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ stderr: "" })
			.mockResolvedValueOnce({ stderr: '# designated => cdhash H"new"' });
		await expect(verifyMacReauthorizedChange(source, target, run)).rejects.toThrow("无法读取");
	});
});

describe("release signature", () => {
	const app = "/release/mac-arm64/QuickShot.app";

	it("accepts a build signed with the release certificate", async () => {
		const run = vi.fn()
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ stderr: `# designated => ${RELEASE_REQUIREMENT}` });
		await expect(verifyReleaseSignature(app, run)).resolves.toBe(RELEASE_REQUIREMENT);
		expect(run).toHaveBeenNthCalledWith(1, "codesign", [
			"--verify", "--deep", "--strict", `-R=${RELEASE_REQUIREMENT}`, app,
		]);
	});

	it("rejects an ad hoc build", async () => {
		const run = vi.fn().mockRejectedValueOnce(new Error("failed to satisfy code requirement(s)"));
		await expect(verifyReleaseSignature(app, run)).rejects.toThrow("failed to satisfy");
	});

	it("rejects a build that would require something else next time", async () => {
		const run = vi.fn()
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ stderr: `# designated => ${RELEASE_REQUIREMENT} or anchor apple` });
		await expect(verifyReleaseSignature(app, run)).rejects.toThrow("instead of the release certificate");
	});
});
