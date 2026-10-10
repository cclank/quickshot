export async function decodeImageData(src: string): Promise<HTMLImageElement> {
	const img = new Image();
	// Chromium can leave decode() pending for very tall images in a hidden
	// editor. Loading supplies the dimensions; painting can decode once shown.
	img.decoding = "async";
	await new Promise<void>((resolve, reject) => {
		const cleanup = () => {
			img.onload = null;
			img.onerror = null;
		};
		const loaded = () => {
			cleanup();
			if (img.naturalWidth > 0 && img.naturalHeight > 0) resolve();
			else reject(new Error("Failed to load image"));
		};
		img.onload = loaded;
		img.onerror = () => {
			cleanup();
			reject(new Error("Failed to load image"));
		};
		// Install listeners first so cached images and early errors cannot be lost.
		img.src = src;
		if (img.complete) loaded();
	});

	return img;
}
