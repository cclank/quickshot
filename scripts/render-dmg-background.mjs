// Renders installer/dmg-background.html into the DMG window background:
// a 1x and a 2x PNG, combined into one HiDPI TIFF for electron-builder.
// Needs Google Chrome (or CHROME_PATH) and macOS's tiffutil.
import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const source = path.join(root, "installer", "dmg-background.html");
const output = path.join(root, "installer");
const size = { width: 660, height: 440 };
const chrome =
	process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9400 + Math.floor(Math.random() * 400);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pageSocket() {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		try {
			const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
			const page = targets.find((target) => target.type === "page");
			if (page) return page.webSocketDebuggerUrl;
		} catch {}
		await sleep(150);
	}
	throw new Error("Chrome did not start");
}

function session(url) {
	const socket = new WebSocket(url);
	let next = 0;
	const pending = new Map();
	socket.onmessage = (event) => {
		const message = JSON.parse(event.data);
		pending.get(message.id)?.(message);
		pending.delete(message.id);
	};
	const opened = new Promise((resolve, reject) => {
		socket.onopen = resolve;
		socket.onerror = reject;
	});
	return {
		opened,
		close: () => socket.close(),
		send: (method, params = {}) =>
			new Promise((resolve, reject) => {
				const id = ++next;
				pending.set(id, (message) => (message.error ? reject(new Error(message.error.message)) : resolve(message.result)));
				socket.send(JSON.stringify({ id, method, params }));
			}),
	};
}

const profile = await mkdtemp(path.join(os.tmpdir(), "quickshot-dmg-"));
const browser = spawn(
	chrome,
	["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--hide-scrollbars", "about:blank"],
	{ stdio: "ignore" },
);
try {
	const page = session(await pageSocket());
	await page.opened;
	await page.send("Page.enable");
	for (const scale of [1, 2]) {
		await page.send("Emulation.setDeviceMetricsOverride", { ...size, deviceScaleFactor: scale, mobile: false });
		await page.send("Page.navigate", { url: pathToFileURL(source).href });
		await sleep(800);
		const shot = await page.send("Page.captureScreenshot", {
			format: "png",
			clip: { x: 0, y: 0, ...size, scale: 1 },
		});
		const file = path.join(output, scale === 1 ? "dmg-background.png" : "dmg-background@2x.png");
		await writeFile(file, Buffer.from(shot.data, "base64"));
		console.log(`Rendered ${path.relative(root, file)}`);
	}
	page.close();
} finally {
	const exited = new Promise((resolve) => browser.once("exit", resolve));
	browser.kill();
	await Promise.race([exited, sleep(3000)]);
	await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}

await execFileAsync("tiffutil", [
	"-cathidpicheck",
	path.join(output, "dmg-background.png"),
	path.join(output, "dmg-background@2x.png"),
	"-out",
	path.join(output, "dmg-background.tiff"),
]);
console.log("Combined installer/dmg-background.tiff");
