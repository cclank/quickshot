import {
	type StitchPlacement,
	type StitchSettings,
	type StitchSize,
	computeStitchPlacement,
} from "./stitch";

/** What the editor draws: a single capture, or several stitched into a canvas. */
export type SourceImage = HTMLImageElement | HTMLCanvasElement;

export function sourceSize(source: SourceImage) {
	return source instanceof HTMLImageElement
		? { width: source.naturalWidth, height: source.naturalHeight }
		: { width: source.width, height: source.height };
}

export type StitchPiece = {
	id: string;
	image: SourceImage;
	/** Converts the piece's pixels to the stitched image's, e.g. 2 for a 1x capture in a 2x stitch. */
	scale: number;
};

export type Stitch = { pieces: StitchPiece[]; settings: StitchSettings };

/** Chromium refuses canvases past these, so stitching stops short of them. */
export const MAX_STITCH_SIDE = 32_000;
export const MAX_STITCH_PIXELS = 120_000_000;

export function stitchSizes(stitch: Stitch): StitchSize[] {
	return stitch.pieces.map((piece) => ({
		id: piece.id,
		width: Math.max(1, Math.round(sourceSize(piece.image).width * piece.scale)),
		height: Math.max(1, Math.round(sourceSize(piece.image).height * piece.scale)),
	}));
}

export function stitchPlacement(stitch: Stitch, unit: number): StitchPlacement {
	return computeStitchPlacement(stitchSizes(stitch), stitch.settings, unit);
}

export function fitsStitchLimits(placement: StitchPlacement) {
	return (
		placement.width <= MAX_STITCH_SIDE &&
		placement.height <= MAX_STITCH_SIDE &&
		placement.width * placement.height <= MAX_STITCH_PIXELS
	);
}

/**
 * The image the editor works on. A single capture is used as is; several are
 * drawn into a new canvas (a new object each time, so caches keyed by the
 * source never serve a stale picture).
 */
export function renderStitchSource(stitch: Stitch, unit: number): SourceImage | null {
	const [first] = stitch.pieces;
	if (!first) return null;
	if (stitch.pieces.length === 1 && first.scale === 1) return first.image;
	const placement = stitchPlacement(stitch, unit);
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, placement.width);
	canvas.height = Math.max(1, placement.height);
	const context = canvas.getContext("2d");
	if (!context) return first.image;
	context.imageSmoothingQuality = "high";
	for (const piece of stitch.pieces) {
		const rect = placement.rects[piece.id];
		if (rect) context.drawImage(piece.image, rect.x, rect.y, rect.width, rect.height);
	}
	return canvas;
}
