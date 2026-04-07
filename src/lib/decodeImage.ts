export async function decodeImageData(src: string): Promise<HTMLImageElement> {
	const img = new Image();
	img.decoding = "sync";
	img.src = src;

	if (img.complete && img.naturalWidth > 0) {
		return img;
	}

	if (typeof img.decode === "function") {
		try {
			await img.decode();
			return img;
		} catch {
			// fall through to load event
		}
	}

	await new Promise<void>((resolve, reject) => {
		img.onload = () => resolve();
		img.onerror = () => reject(new Error("Failed to decode image"));
	});

	return img;
}
