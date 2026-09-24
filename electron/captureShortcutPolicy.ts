export function shouldRegisterCaptureShortcut(
	isPackaged: boolean,
	developmentOverride: string | undefined,
): boolean {
	if (isPackaged) return true;
	if (!developmentOverride) return true;

	return !["0", "false", "off", "no"].includes(
		developmentOverride.trim().toLowerCase(),
	);
}
