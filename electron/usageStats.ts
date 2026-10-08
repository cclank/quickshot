/**
 * Anonymous usage statistics: one small report per launch, so we can tell how
 * many installations are in use. It carries a random installation ID, the app
 * version, the OS name and major.minor version, and the CPU architecture —
 * never screenshots, text, file names or anything about the user. It is on by
 * default, can be switched off from the tray menu, and development builds
 * never send it.
 */
export const USAGE_STATS_ENDPOINT = "https://quickshot-ops.lanshuagent.com/v1/heartbeat";
export const USAGE_STATS_TIMEOUT_MS = 8_000;

export type UsageHeartbeat = {
	installation_id: string;
	app_version: string;
	os_name: "macOS" | "Windows" | "Linux";
	os_version: string;
	arch: "arm64" | "x64" | "ia32";
};

const INSTALLATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APP_VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[a-zA-Z0-9.-]{1,24})?$/;

export function isInstallationId(value: unknown): value is string {
	return typeof value === "string" && INSTALLATION_ID.test(value);
}

export function usageOsName(platform: string): UsageHeartbeat["os_name"] | null {
	if (platform === "darwin") return "macOS";
	if (platform === "win32") return "Windows";
	if (platform === "linux") return "Linux";
	return null;
}

/** "26.0.1" → "26.0", "10.0.22631" → "10.0", "15" → "15.0". */
export function majorMinor(version: string): string | null {
	const match = /^(\d{1,4})(?:\.(\d{1,4}))?/.exec(version.trim());
	return match ? `${match[1]}.${match[2] ?? "0"}` : null;
}

export function usageArch(arch: string): UsageHeartbeat["arch"] | null {
	return arch === "arm64" || arch === "x64" || arch === "ia32" ? arch : null;
}

/** The report for this launch, or null when anything would fail the server's checks. */
export function buildUsageHeartbeat(input: {
	installationId: string;
	appVersion: string;
	platform: string;
	systemVersion: string;
	arch: string;
}): UsageHeartbeat | null {
	const os_name = usageOsName(input.platform);
	const os_version = majorMinor(input.systemVersion);
	const arch = usageArch(input.arch);
	if (!isInstallationId(input.installationId) || !APP_VERSION.test(input.appVersion) || !os_name || !os_version || !arch) {
		return null;
	}
	return { installation_id: input.installationId.toLowerCase(), app_version: input.appVersion, os_name, os_version, arch };
}

/** What the report needs from a fetch: Electron's net.fetch or the global fetch. */
export type UsageFetcher = (url: string, init: RequestInit) => Promise<{ status: number }>;

/** Sends one report and resolves to the HTTP status, or null on failure. Never retries or throws. */
export async function sendUsageHeartbeat(
	payload: UsageHeartbeat,
	fetcher: UsageFetcher,
	endpoint = USAGE_STATS_ENDPOINT,
	timeoutMs = USAGE_STATS_TIMEOUT_MS,
): Promise<number | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetcher(endpoint, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
			signal: controller.signal,
			credentials: "omit",
			cache: "no-store",
		});
		return response.status;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}
