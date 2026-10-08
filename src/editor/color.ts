export type Rgb = { r: number; g: number; b: number };

export function hexToRgb(color: string): Rgb | null {
	const normalized = color.trim().replace("#", "");
	const hex =
		normalized.length === 3
			? normalized
					.split("")
					.map((part) => `${part}${part}`)
					.join("")
			: normalized;
	if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
	const value = Number.parseInt(hex, 16);
	return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

export function rgbToHex({ r, g, b }: Rgb) {
	return `#${[r, g, b]
		.map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
		.join("")
		.toUpperCase()}`;
}

export function relativeLuminance(color: string): number | null {
	const rgb = hexToRgb(color);
	if (!rgb) return null;
	return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
}

export function isLightColor(color: string, threshold = 0.62) {
	const luminance = relativeLuminance(color);
	return luminance === null ? true : luminance >= threshold;
}

/** Readable text colour to place on top of `color`. */
export function contrastColor(color: string) {
	return isLightColor(color, 0.66) ? "#111113" : "#FFFFFF";
}

export function withAlpha(color: string, alpha: number) {
	const clamped = Math.min(1, Math.max(0, alpha));
	const rgb = hexToRgb(color);
	if (rgb) return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamped})`;
	const match = color.match(/rgba?\(([^)]+)\)/i);
	if (!match) return color;
	const [r = "255", g = "255", b = "255"] = match[1]
		.split(",")
		.map((part) => part.trim());
	return `rgba(${r}, ${g}, ${b}, ${clamped})`;
}

/**
 * A darker or lighter shade of the same hue, for type that should sit in a
 * coloured background instead of on top of it.
 */
export function toneOnTone({ r, g, b }: Rgb): Rgb {
	const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
	if (luminance >= 0.5) {
		const keep = 0.4;
		return { r: r * keep, g: g * keep, b: b * keep };
	}
	const lift = 0.74;
	return { r: r + (255 - r) * lift, g: g + (255 - g) * lift, b: b + (255 - b) * lift };
}
