export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for a DevTools target matching `predicate` and opens a session on it. */
export async function connect(port, predicate, timeoutMs = 20000) {
	const deadline = Date.now() + timeoutMs;
	let target;
	while (!target) {
		if (Date.now() > deadline) throw new Error("no matching DevTools target");
		try {
			const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
			target = list.find((entry) => entry.type === "page" && predicate(entry));
		} catch {}
		if (!target) await sleep(150);
	}
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		ws.onopen = resolve;
		ws.onerror = reject;
	});
	let nextId = 0;
	const pending = new Map();
	ws.onmessage = (event) => {
		const message = JSON.parse(event.data);
		if (message.id && pending.has(message.id)) {
			const { resolve, reject } = pending.get(message.id);
			pending.delete(message.id);
			if (message.error) reject(new Error(message.error.message));
			else resolve(message.result);
		}
	};
	const send = (method, params = {}) =>
		new Promise((resolve, reject) => {
			const id = ++nextId;
			pending.set(id, { resolve, reject });
			ws.send(JSON.stringify({ id, method, params }));
		});
	const evaluate = async (expression) => {
		const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
		if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
		return result.result.value;
	};
	return { ws, send, evaluate, target };
}
