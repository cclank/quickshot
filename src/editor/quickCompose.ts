import { getAssetPath } from "@/lib/assetPath";
import { decodeImageData } from "@/lib/decodeImage";
import { parseBackground } from "./backgrounds";
import {
	type StyleSettings,
	computeCompositionLayout,
} from "./composition";
import { loadStyleSettings } from "./persistence";
import { renderComposition } from "./renderComposition";

/**
 * Chromium will not draw a canvas past 32,767 pixels a side or about 268
 * million pixels, so clamp exports the same way the editor does.
 */
const MAX_EXPORT_DIMENSION = 32_000;
const MAX_EXPORT_PIXELS = 120_000_000;

const wallpaperCache = new Map<string, Promise<HTMLImageElement>>();

async function loadWallpaper(background: string): Promise<HTMLImageElement | null> {
	const spec = parseBackground(background);
	if (spec.kind !== "wallpaper") return null;
	let request = wallpaperCache.get(spec.asset.value);
	if (!request) {
		request = getAssetPath(spec.asset.value, { cache: false }).then(decodeImageData);
		request.catch(() => wallpaperCache.delete(spec.asset.value));
		wallpaperCache.set(spec.asset.value, request);
	}
	return request.catch(() => null);
}

/**
 * Renders `image` the way the editor would export it — background, frame,
 * shadow and watermark from the user's saved style — without opening the
 * editor. `unit` is the capture's device pixel ratio, so frame chrome keeps
 * its physical size on Retina captures.
 */
export async function renderStyledCopy(
	image: HTMLCanvasElement,
	unit: number,
): Promise<Uint8Array | null> {
	const settings: StyleSettings = loadStyleSettings();
	const wallpaper = await loadWallpaper(settings.background);
	const layout = computeCompositionLayout(image.width, image.height, unit, settings);
	const scale = Math.min(
		1,
		MAX_EXPORT_DIMENSION / layout.width,
		MAX_EXPORT_DIMENSION / layout.height,
		Math.sqrt(MAX_EXPORT_PIXELS / (layout.width * layout.height)),
	);
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(layout.width * scale));
	canvas.height = Math.max(1, Math.round(layout.height * scale));
	const context = canvas.getContext("2d");
	if (!context) return null;
	context.setTransform(scale, 0, 0, scale, 0, 0);
	renderComposition(context, {
		layout,
		settings,
		sources: { image, wallpaper },
		pixelScale: scale,
	});
	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
	if (!blob) return null;
	return new Uint8Array(await blob.arrayBuffer());
}
