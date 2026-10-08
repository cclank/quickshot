export function readStoredJson(key: string): unknown {
	try {
		const raw = window.localStorage.getItem(key);
		return raw === null ? undefined : JSON.parse(raw);
	} catch {
		return undefined;
	}
}

export function writeStoredJson(key: string, value: unknown) {
	try {
		window.localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Storage can be unavailable or full; preferences are best-effort.
	}
}

export function readStoredString(key: string): string | null {
	try {
		return window.localStorage.getItem(key);
	} catch {
		return null;
	}
}
