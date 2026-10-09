import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import {
	DEFAULT_CAPTURE_ACCELERATOR,
	DEFAULT_RESTORE_PINS_ACCELERATOR,
	normalizeAccelerator,
} from "../src/lib/accelerator";
import { isInstallationId } from "./usageStats";

export type MacCaptureMode = "system" | "overlay";
export type LanguagePreference = "auto" | "zh" | "en";
export type Language = "zh" | "en";

/** Global shortcuts as Electron accelerators; scrolling capture has none until set. */
export type ShortcutSettings = {
	capture: string;
	scrollCapture: string | null;
	/** Only registered while a pinned screenshot lets clicks through. */
	restorePins: string;
};

export type AppSettings = {
	/** macOS only: the system crosshair, or QuickShot's frozen-screen overlay. */
	macCaptureMode: MacCaptureMode;
	language: LanguagePreference;
	/** The welcome guide version last shown; 0 before the first launch. */
	onboardingVersion: number;
	/** Anonymous launch statistics (see usageStats.ts); off only when set to false in settings.json. */
	usageStats: boolean;
	/** When true, double-clicking a released selection only copies it; by default it opens the editor. */
	overlayDoubleClickCopy: boolean;
	/** Random UUID v4 created on the first report; identifies an installation, not a person. */
	installationId: string | null;
	shortcuts: ShortcutSettings;
	/** The update version already announced with a notification. */
	updateNotifiedVersion: string | null;
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
	// Most captures are pasted straight away; the editor stays an explicit choice.
	overlayDoubleClickCopy: false,
	installationId: null,
	shortcuts: {
		capture: DEFAULT_CAPTURE_ACCELERATOR,
		scrollCapture: null,
		restorePins: DEFAULT_RESTORE_PINS_ACCELERATOR,
	},
	updateNotifiedVersion: null,
};

export function normalizeShortcuts(value: unknown): ShortcutSettings {
	const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
	const capture = normalizeAccelerator(input.capture) ?? DEFAULT_CAPTURE_ACCELERATOR;
	const scrollCapture = normalizeAccelerator(input.scrollCapture);
	let restorePins = normalizeAccelerator(input.restorePins) ?? DEFAULT_RESTORE_PINS_ACCELERATOR;
	if (restorePins === capture || restorePins === scrollCapture) restorePins = DEFAULT_RESTORE_PINS_ACCELERATOR;
	return { capture, scrollCapture: scrollCapture === capture ? null : scrollCapture, restorePins };
}

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
		overlayDoubleClickCopy:
			typeof input.overlayDoubleClickCopy === "boolean"
				? input.overlayDoubleClickCopy
				: DEFAULT_APP_SETTINGS.overlayDoubleClickCopy,
		installationId: isInstallationId(input.installationId)
			? input.installationId.toLowerCase()
			: DEFAULT_APP_SETTINGS.installationId,
		shortcuts: normalizeShortcuts(input.shortcuts),
		updateNotifiedVersion:
			typeof input.updateNotifiedVersion === "string" && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(input.updateNotifiedVersion)
				? input.updateNotifiedVersion
				: null,
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
