import { useSyncExternalStore } from "react";

/**
 * Editor preferences set in Settings. Like the keymap, they live in
 * localStorage, so open editors follow a change straight away.
 */

const COPY_CLOSES_KEY = "quickshot.copy-closes.v1";
const listeners = new Set<() => void>();

/** Whether copying the image also closes the editor; on unless turned off. */
export function getCopyCloses() {
	try {
		return window.localStorage.getItem(COPY_CLOSES_KEY) !== "0";
	} catch {
		return true;
	}
}

export function setCopyCloses(enabled: boolean) {
	try {
		window.localStorage.setItem(COPY_CLOSES_KEY, enabled ? "1" : "0");
	} catch {}
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	// Other windows' changes arrive as storage events.
	const onStorage = (event: StorageEvent) => {
		if (event.key === COPY_CLOSES_KEY || event.key === null) listener();
	};
	window.addEventListener("storage", onStorage);
	return () => {
		listeners.delete(listener);
		window.removeEventListener("storage", onStorage);
	};
}

export function useCopyCloses() {
	return useSyncExternalStore(subscribe, getCopyCloses, getCopyCloses);
}
