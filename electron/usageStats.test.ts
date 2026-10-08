import { describe, expect, it } from "vitest";
import { normalizeAppSettings } from "./appSettings";
import {
	type UsageFetcher,
	buildUsageHeartbeat,
	isInstallationId,
	majorMinor,
	sendUsageHeartbeat,
	USAGE_STATS_ENDPOINT,
} from "./usageStats";

const id = "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b";

describe("usage heartbeat", () => {
	it("sends exactly the five fields the service accepts", () => {
		const payload = buildUsageHeartbeat({ installationId: id, appVersion: "1.2.0", platform: "darwin", systemVersion: "26.0.1", arch: "arm64" });
		expect(payload).toEqual({ installation_id: id, app_version: "1.2.0", os_name: "macOS", os_version: "26.0", arch: "arm64" });
		expect(Object.keys(payload ?? {})).toHaveLength(5);
	});

	it("maps Windows and lower-cases the installation ID", () => {
		expect(buildUsageHeartbeat({ installationId: id.toUpperCase(), appVersion: "1.2.0", platform: "win32", systemVersion: "10.0.22631", arch: "x64" }))
			.toEqual({ installation_id: id, app_version: "1.2.0", os_name: "Windows", os_version: "10.0", arch: "x64" });
	});

	it("sends nothing the service would reject", () => {
		const base = { installationId: id, appVersion: "1.2.0", platform: "darwin", systemVersion: "26.0", arch: "arm64" };
		for (const change of [{ installationId: "not-an-id" }, { appVersion: "dev" }, { platform: "freebsd" }, { systemVersion: "" }, { arch: "riscv64" }]) {
			expect(buildUsageHeartbeat({ ...base, ...change })).toBeNull();
		}
	});

	it("keeps only the major and minor system version", () => {
		expect(majorMinor("15")).toBe("15.0");
		expect(majorMinor("14.7.1")).toBe("14.7");
		expect(majorMinor("not a version")).toBeNull();
	});

	it("recognises only UUID v4 installation IDs", () => {
		expect(isInstallationId(id)).toBe(true);
		expect(isInstallationId("3f2b8c1e-9a4d-1e6f-8b2a-1c3d5e7f9a0b")).toBe(false);
		expect(isInstallationId(undefined)).toBe(false);
	});

	it("posts JSON once and reports failures as null without throwing", async () => {
		const calls: [string, RequestInit][] = [];
		const ok = (async (url: string, init: RequestInit) => {
			calls.push([url, init]);
			return new Response(null, { status: 204 });
		}) as UsageFetcher;
		const payload = buildUsageHeartbeat({ installationId: id, appVersion: "1.2.0", platform: "darwin", systemVersion: "26.0", arch: "arm64" });
		if (!payload) throw new Error("payload expected");
		expect(await sendUsageHeartbeat(payload, ok)).toBe(204);
		expect(calls).toHaveLength(1);
		expect(calls[0][0]).toBe(USAGE_STATS_ENDPOINT);
		expect(calls[0][1].method).toBe("POST");
		expect(JSON.parse(String(calls[0][1].body))).toEqual(payload);

		const failing = (async () => {
			throw new Error("offline");
		}) as UsageFetcher;
		expect(await sendUsageHeartbeat(payload, failing)).toBeNull();

		const hanging = ((_url: string, init: RequestInit) =>
			new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as UsageFetcher;
		expect(await sendUsageHeartbeat(payload, hanging, USAGE_STATS_ENDPOINT, 10)).toBeNull();
	});
});

describe("usage statistics settings", () => {
	it("is on by default and keeps an explicit opt-out", () => {
		expect(normalizeAppSettings({}).usageStats).toBe(true);
		expect(normalizeAppSettings({ usageStats: false }).usageStats).toBe(false);
		expect(normalizeAppSettings({ usageStats: "no" }).usageStats).toBe(true);
	});

	it("keeps only a valid installation ID", () => {
		expect(normalizeAppSettings({ installationId: id }).installationId).toBe(id);
		expect(normalizeAppSettings({ installationId: "x" }).installationId).toBeNull();
		expect(normalizeAppSettings({}).installationId).toBeNull();
	});
});
