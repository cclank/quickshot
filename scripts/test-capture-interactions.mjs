import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Real renderer events against fixtures; never launches Electron or captures the screen.
const profile = await mkdtemp(path.join(os.tmpdir(), "quickshot-interactions-"));
const port = 9400 + process.pid % 500;
const base = "http://127.0.0.1:5190";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--config", "vite.ui.config.ts", "--host", "127.0.0.1", "--port", "5190"], { stdio: "pipe" });
const chrome = spawn(process.env.CHROME_PATH || (process.platform === "darwin"
	? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome"), [
	"--headless=new", "--no-first-run", "--disable-background-networking",
	`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore" });
let socket;
let id = 0;
const pending = new Map();
const errors = [];
let serverReady = false;
let serverOutput = "";
server.on("error", (error) => errors.push(error));
chrome.on("error", (error) => errors.push(error));
server.stderr.on("data", (chunk) => errors.push(String(chunk)));
server.stdout.on("data", (chunk) => {
	// CI forces ANSI colour codes inside Vite's printed URL; chunks can split it.
	serverOutput += String(chunk);
	if (serverOutput.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").includes(base)) serverReady = true;
});

async function until(check, label) {
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		try { if (await check()) return; } catch { /* Wait for startup or rendering. */ }
		await delay(60);
	}
	throw new Error(`Timed out: ${label}\n${serverOutput}\n${errors.join("\n")}`);
}

function send(method, params = {}) {
	return new Promise((resolve, reject) => {
		const requestId = ++id;
		const timer = setTimeout(() => {
			pending.delete(requestId);
			reject(new Error(`CDP timeout: ${method}`));
		}, 20_000);
		pending.set(requestId, { resolve, reject, timer });
		socket.send(JSON.stringify({ id: requestId, method, params }));
	});
}

async function evaluate(expression) {
	const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
	if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
	return result.result.value;
}

async function mouse(type, x, y, pressed = false) {
	await send("Input.dispatchMouseEvent", {
		type, x, y, button: type === "mouseMoved" ? "none" : "left",
		buttons: pressed ? 1 : 0, clickCount: type === "mouseMoved" ? 0 : 1,
	});
	await delay(40);
}

async function key(value) {
	await send("Input.dispatchKeyEvent", { type: "keyDown", key: value, code: `Key${value.toUpperCase()}` });
	await send("Input.dispatchKeyEvent", { type: "keyUp", key: value, code: `Key${value.toUpperCase()}` });
	await delay(80);
}

async function drag(x, y, endX, endY) {
	await mouse("mouseMoved", x, y);
	await mouse("mousePressed", x, y, true);
	await mouse("mouseMoved", endX, endY, true);
	await mouse("mouseReleased", endX, endY);
}

const overlayTool = () => evaluate("document.querySelector('[data-quickshot-tool]')?.dataset.quickshotTool");
const editorTool = () => evaluate("document.querySelector('header button[aria-pressed=true]')?.getAttribute('aria-label')");

try {
	await until(() => serverReady && server.exitCode === null, "fixture server");
	await until(async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).ok, "Chrome");
	const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(base)}`, { method: "PUT" })).json();
	socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
	socket.onmessage = ({ data }) => {
		const message = JSON.parse(data);
		const request = pending.get(message.id);
		if (!request) return;
		clearTimeout(request.timer);
		pending.delete(message.id);
		if (message.error) request.reject(new Error(message.error.message));
		else request.resolve(message.result);
	};
	await send("Page.enable");
	await send("Page.bringToFront");
	await send("Runtime.enable");
	await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
	await send("Page.addScriptToEvaluateOnNewDocument", { source: `
		localStorage.setItem('quickshot.overlay-tool.v1', JSON.stringify('redact'));
		localStorage.setItem('quickshot.tool.v1', JSON.stringify('counter'));
	` });
	await send("Page.navigate", { url: `${base}/test-fixtures/region-selector.html?windowType=screenshot-region&lang=en` });
	await until(() => evaluate("window.__quickshotRegionFixture?.readySessionId === 1"), "overlay ready");
	assert.equal(await overlayTool(), "select", "cold overlay ignores the stored tool");
	await drag(150, 150, 650, 450);
	for (const tool of ["v", "m", "n"]) {
		await key(tool);
		for (const [x, y, cursor] of [
			[400, 150, "ns-resize"], [400, 450, "ns-resize"],
			[150, 300, "ew-resize"], [650, 300, "ew-resize"],
			[150, 150, "nwse-resize"], [650, 450, "nwse-resize"],
			[650, 150, "nesw-resize"], [150, 450, "nesw-resize"],
		]) {
			await mouse("mouseMoved", x, y);
			assert.equal(await evaluate("document.querySelector('[data-quickshot-tool]').style.cursor"), cursor, `${tool}: ${x},${y}`);
		}
	}
	await mouse("mouseMoved", 400, 300);
	assert.equal(await evaluate("document.querySelector('[data-quickshot-tool]').style.cursor"), "crosshair", "interior retains the drawing cursor");
	await mouse("mousePressed", 650, 300, true);
	await mouse("mouseMoved", 700, 300, true);
	assert.equal(await evaluate("document.querySelector('[data-quickshot-tool]').style.cursor"), "ew-resize", "resize cursor stays active during drag");
	await mouse("mouseReleased", 700, 300);
	assert.equal(await evaluate("document.querySelector('[data-quickshot-annotations]').dataset.quickshotAnnotations"), "0", "resizing does not draw a counter");
	await drag(350, 300, 351, 301);
	assert.equal(await evaluate("document.querySelector('[data-quickshot-annotations]').dataset.quickshotAnnotations"), "1", "counter still works inside");
	const screenshotPath = process.argv.find((argument) => argument.startsWith("--screenshot="))?.slice("--screenshot=".length);
	if (screenshotPath) {
		const screenshot = await send("Page.captureScreenshot", { format: "png" });
		await mkdir(path.dirname(path.resolve(screenshotPath)), { recursive: true });
		await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
	}
	await key("Enter");
	await until(() => evaluate("document.documentElement.dataset.lastAction === 'edit'"), "overlay submit");
	assert.deepEqual(await evaluate("JSON.parse(document.documentElement.dataset.lastRect)"), { x: 150, y: 150, width: 550, height: 300 }, "submission uses resized geometry");
	for (const [sessionId, tool] of [[2, "m"], [3, "n"]]) {
		await key(tool);
		await evaluate(`window.__quickshotRegionFixture.startSession(${sessionId})`);
		await until(() => evaluate(`window.__quickshotRegionFixture.readySessionId === ${sessionId}`), "warm overlay session");
		assert.equal(await overlayTool(), "select");
		assert.equal(await evaluate("document.querySelector('[data-quickshot-annotations]').dataset.quickshotAnnotations"), "0");
	}
	console.log("PASS overlay: stored/warm tool reset, 24 hover checks, resize and annotation interaction");

	await send("Page.navigate", { url: `${base}/test-fixtures/screenshot-preview.html?windowType=screenshot-preview&sessionId=1&persist=1&lang=en` });
	await until(() => evaluate("window.__quickshotPreviewFixture?.readySessionId === 1"), "editor ready");
	await key("v");
	const selectLabel = await editorTool();
	assert.ok(selectLabel?.includes("Select"), `selection button: ${selectLabel}`);
	// Reload with the legacy drawing-tool keys still present to test cold startup.
	await send("Page.reload");
	await until(() => evaluate("window.__quickshotPreviewFixture?.readySessionId === 1"), "reloaded editor ready");
	assert.equal(await editorTool(), selectLabel, "cold editor ignores stored tool");
	for (const [sessionId, tool] of [[2, "m"], [3, "n"]]) {
		await key(tool);
		assert.notEqual(await editorTool(), selectLabel, "tool changed before next capture");
		await evaluate(`window.__quickshotPreviewFixture.startSession(${sessionId})`);
		await until(() => evaluate(`window.__quickshotPreviewFixture.readySessionId === ${sessionId}`), "warm editor session");
		assert.equal(await editorTool(), selectLabel, "warm editor resets to selection");
	}
	await key("t");
	const center = await evaluate(`(() => {
		const rect = document.querySelector('[data-quickshot-composition]').getBoundingClientRect();
		return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
	})()`);
	await mouse("mousePressed", center.x, center.y, true);
	await mouse("mouseReleased", center.x, center.y);
	await until(() => evaluate("Boolean(document.querySelector('textarea'))"), "text editing");
	await send("Input.insertText", { text: "Previous capture draft" });
	await evaluate("window.__quickshotPreviewFixture.startSession(4)");
	await until(() => evaluate("window.__quickshotPreviewFixture.readySessionId === 4"), "editor session after text draft");
	assert.equal(await editorTool(), selectLabel, "text tool also resets");
	assert.equal(await evaluate("Boolean(document.querySelector('textarea'))"), false, "old text draft is discarded");
	assert.deepEqual(await evaluate("[localStorage.getItem('quickshot.tool.v1'), localStorage.getItem('quickshot.overlay-tool.v1')].map(JSON.parse)"), ["counter", "redact"], "active tools no longer write preferences");
	console.log("PASS editor: stored/warm tool reset, text draft cleanup; legacy keys ignored and untouched");
} finally {
	socket?.close();
	for (const request of pending.values()) clearTimeout(request.timer);
	for (const child of [chrome, server]) {
		if (child.exitCode === null && child.signalCode === null) {
			const closed = new Promise((resolve) => child.once("exit", resolve));
			child.kill("SIGTERM");
			await Promise.race([closed, delay(3000)]);
		}
	}
	await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
