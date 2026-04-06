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

export async function getAssetPath(relativePath: string): Promise<string> {
	const encodedRelativePath = encodeRelativeAssetPath(relativePath);

	try {
		if (typeof window !== "undefined") {
			if (
				window.location?.protocol?.startsWith("http")
			) {
				return `/${encodedRelativePath}`;
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
}

export default getAssetPath;
