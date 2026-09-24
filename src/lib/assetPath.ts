function encodeRelativeAssetPath(relativePath: string): string {
	return relativePath
		.replace(/^\/+/, "")
		.split("/")
		.filter(Boolean)
		.map((part) => encodeURIComponent(part))
		.join("/");
}

function ensureTrailingSlash(value: string): string {
	return value.endsWith("/") ? value : `${value}/`;
}

const assetPathCache = new Map<string, Promise<string>>();

export async function getAssetPath(
	relativePath: string,
	options: { cache?: boolean } = {},
): Promise<string> {
	const encodedRelativePath = encodeRelativeAssetPath(relativePath);
	const shouldCache = options.cache !== false;
	const cachedPath = shouldCache ? assetPathCache.get(relativePath) : undefined;
	if (cachedPath) {
		return cachedPath;
	}

	const pathPromise = (async () => {
		try {
			if (typeof window !== "undefined") {
				if (
					window.location?.protocol?.startsWith("http")
				) {
					return `/${encodedRelativePath}`;
				}

				if (
					window.electronAPI &&
					typeof window.electronAPI.readAssetDataUrl === "function"
				) {
					const dataUrl = await window.electronAPI.readAssetDataUrl(relativePath);
					if (dataUrl) {
						return dataUrl;
					}
				}

				if (
					window.electronAPI &&
					typeof window.electronAPI.getAssetBasePath === "function"
				) {
					const base = await window.electronAPI.getAssetBasePath();
					if (base) {
						return new URL(
							encodedRelativePath,
							ensureTrailingSlash(base),
						).toString();
					}
				}
			}
		} catch {
			// ignore
		}

		return `/${encodedRelativePath}`;
	})();

	if (shouldCache) {
		assetPathCache.set(relativePath, pathPromise);
	}
	return pathPromise;
}

export default getAssetPath;
