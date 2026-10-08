import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { isInstallationId } from "./usageStats";

export type MacCaptureMode = "system" | "overlay";
export type LanguagePreference = "auto" | "zh" | "en";
export type Language = "zh" | "en";

export type AppSettings = {
	/** macOS only: the system crosshair, or QuickShot's frozen-screen overlay. */
	macCaptureMode: MacCaptureMode;
	language: LanguagePreference;
	/** The welcome guide version last shown; 0 before the first launch. */
	onboardingVersion: number;
	/** Anonymous launch statistics (see usageStats.ts); on unless turned off. */
	usageStats: boolean;
	/** Random UUID v4 created on the first report; identifies an installation, not a person. */
	installationId: string | null;
};

/** Raise to show the welcome guide again after a release that changes it. */
export const ONBOARDING_VERSION = 1;

export const DEFAULT_APP_SETTINGS: AppSettings = {
	// The overlay recognises windows under the pointer; the system crosshair
	// stays available from the tray menu.
	macCaptureMode: "overlay",
	language: "auto",
	onboardingVersion: 0,
	usageStats: true,
	installationId: null,
};

/**
 * "auto" picks Chinese whenever it appears among the system's preferred
 * languages, since the app started life with a Chinese interface.
 */
export function resolveLanguage(
	preference: LanguagePreference,
	preferredLanguages: readonly string[],
): Language {
	if (preference !== "auto") return preference;
	return preferredLanguages.some((item) => item.toLowerCase().startsWith("zh"))
		? "zh"
		: "en";
}

export function normalizeAppSettings(value: unknown): AppSettings {
	const input =
		value && typeof value === "object" ? (value as Record<string, unknown>) : {};
	return {
		macCaptureMode:
			input.macCaptureMode === "overlay" || input.macCaptureMode === "system"
				? input.macCaptureMode
				: DEFAULT_APP_SETTINGS.macCaptureMode,
		language:
			input.language === "zh" || input.language === "en" || input.language === "auto"
				? input.language
				: DEFAULT_APP_SETTINGS.language,
		onboardingVersion:
			typeof input.onboardingVersion === "number" &&
			Number.isInteger(input.onboardingVersion) &&
			input.onboardingVersion >= 0
				? input.onboardingVersion
				: DEFAULT_APP_SETTINGS.onboardingVersion,
		usageStats: typeof input.usageStats === "boolean" ? input.usageStats : DEFAULT_APP_SETTINGS.usageStats,
		installationId: isInstallationId(input.installationId)
			? input.installationId.toLowerCase()
			: DEFAULT_APP_SETTINGS.installationId,
	};
}

export async function readAppSettings(directory: string): Promise<AppSettings> {
	try {
		const raw = await readFile(path.join(directory, "settings.json"), "utf8");
		return normalizeAppSettings(JSON.parse(raw));
	} catch {
		return { ...DEFAULT_APP_SETTINGS };
	}
}

export async function writeAppSettings(directory: string, settings: AppSettings) {
	const target = path.join(directory, "settings.json");
	const temporary = `${target}.${process.pid}.tmp`;
	await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
	await rename(temporary, target);
}
