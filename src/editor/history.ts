export type History<T> = {
	past: T[];
	present: T;
	future: T[];
	lastKey: string | null;
	lastAt: number;
};

export const HISTORY_LIMIT = 200;
export const HISTORY_COALESCE_MS = 700;

export function createHistory<T>(initial: T): History<T> {
	return { past: [], present: initial, future: [], lastKey: null, lastAt: 0 };
}

/**
 * Records `next` as the new present. Consecutive pushes that share a
 * `coalesceKey` within a short window collapse into one undo step, so dragging
 * a slider does not flood the history.
 */
export function pushHistory<T>(
	history: History<T>,
	next: T,
	options: { coalesceKey?: string; now?: number } = {},
): History<T> {
	if (Object.is(next, history.present)) return history;
	const now = options.now ?? Date.now();
	const key = options.coalesceKey ?? null;
	if (
		key !== null &&
		key === history.lastKey &&
		now - history.lastAt <= HISTORY_COALESCE_MS
	) {
		return { ...history, present: next, future: [], lastAt: now };
	}
	const past = [...history.past, history.present];
	if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
	return { past, present: next, future: [], lastKey: key, lastAt: now };
}

export function undoHistory<T>(history: History<T>): History<T> {
	if (history.past.length === 0) return history;
	const past = history.past.slice(0, -1);
	return {
		past,
		present: history.past[history.past.length - 1],
		future: [history.present, ...history.future],
		lastKey: null,
		lastAt: 0,
	};
}

export function redoHistory<T>(history: History<T>): History<T> {
	if (history.future.length === 0) return history;
	const [present, ...future] = history.future;
	return {
		past: [...history.past, history.present],
		present,
		future,
		lastKey: null,
		lastAt: 0,
	};
}
