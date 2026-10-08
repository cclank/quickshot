interface AssetEnvironment {
	documentUrl: string;
	publicBaseUrl: string;
	readAssetDataUrl?: (relativePath: string) => Promise<string | null>;
}

const MAX_CACHED_ASSETS = 24;

function assetKey(relativePath: string): string {
	if (/^(?:[\\/]|[a-z][a-z\d+.-]*:)/i.test(relativePath)) {
		throw new Error("Bundled assets require a relative path");
	}
	const segments = relativePath.split(/[\\/]+/).filter((segment) => segment.length > 0);
	if (
		segments.length === 0 ||
		segments.some((segment) => segment === "." || segment === ".." || /[\u0000-\u001f]/.test(segment))
	) {
		throw new Error("Invalid bundled asset path");
	}
	return segments.join("/");
}

/** Resolve public assets in browser fixtures and through the packaged app's IPC. */
export function createAssetResolver(environment: AssetEnvironment) {
	const documentUrl = new URL(environment.documentUrl);
	const browserBase = documentUrl.protocol === "http:" || documentUrl.protocol === "https:"
		? new URL(environment.publicBaseUrl, documentUrl)
		: null;
	const requests = new Map<string, Promise<string>>();

	return async (relativePath: string, { cache = true }: { cache?: boolean } = {}): Promise<string> => {
		const key = assetKey(relativePath);
		if (browserBase) {
			const encoded = key.split("/").map(encodeURIComponent).join("/");
			return new URL(encoded, browserBase).href;
		}
		const reader = environment.readAssetDataUrl;
		if (!reader) throw new Error("Bundled asset bridge is unavailable");

		const existing = cache ? requests.get(key) : undefined;
		if (existing) {
			// Touch the entry so unused thumbnails are evicted before recent ones.
			requests.delete(key);
			requests.set(key, existing);
			return existing;
		}

		const request = Promise.resolve()
			.then(() => reader(key))
			.then((dataUrl) => {
				if (!dataUrl?.startsWith("data:image/")) {
					throw new Error(`Bundled image could not be read: ${key}`);
				}
				return dataUrl;
			})
			.catch((error: unknown) => {
				// A failed read must remain retryable, including IPC transport failures.
				if (requests.get(key) === request) requests.delete(key);
				throw error;
			});
		if (cache) {
			requests.set(key, request);
			if (requests.size > MAX_CACHED_ASSETS) {
				requests.delete(requests.keys().next().value!);
			}
		}
		return request;
	};
}

export const getAssetPath = createAssetResolver({
	documentUrl: typeof window === "undefined" ? "about:blank" : window.location.href,
	publicBaseUrl: import.meta.env.BASE_URL,
	readAssetDataUrl: typeof window === "undefined" ? undefined : window.electronAPI?.readAssetDataUrl,
});
