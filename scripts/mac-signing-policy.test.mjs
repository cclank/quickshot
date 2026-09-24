import { describe, expect, it, vi } from "vitest";
import { verifyMacUpdateIdentity } from "./mac-signing-policy.mjs";

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
