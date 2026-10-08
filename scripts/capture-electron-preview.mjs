import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const options = Object.fromEntries(
	process.argv.slice(2).map((argument) => {
		const separator = argument.indexOf("=");
		return separator === -1
			? [argument.replace(/^--/, ""), "true"]
			: [
					argument.slice(0, separator).replace(/^--/, ""),
					argument.slice(separator + 1),
				];
	}),
);

const url = options.url;
const getOutputOption = (name) => {
	const value = options[name];
	return typeof value === "string" && value !== "true" && value.trim()
		? value
		: undefined;
};
const output = getOutputOption("output");
const compositionOutput = getOutputOption("composition-output");
const exportOutput = getOutputOption("export-output");
const width = Number(options.width || 1080);
const height = Number(options.height || 720);
const deviceScaleFactor = Number(options["device-scale-factor"] || 1);
const nextDeviceScaleFactor = Number(options["next-device-scale-factor"] || 0);
const chromePath =
	process.env.CHROME_PATH ||
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

if (
	!url ||
	(!output && !compositionOutput && !exportOutput) ||
	!Number.isFinite(width) ||
	!Number.isFinite(height) ||
	!Number.isFinite(deviceScaleFactor) || deviceScaleFactor <= 0 ||
	!Number.isFinite(nextDeviceScaleFactor) || nextDeviceScaleFactor < 0
) {
	throw new Error(
		"Usage: node scripts/capture-electron-preview.mjs --url=<fixture-url> [--output=<viewport.png>] [--composition-output=<composition.png>] [--export-output=<export.png>] [--width=1080 --height=720]",
	);
}

const profileDirectory = await mkdtemp(
	path.join(os.tmpdir(), "quickshot-preview-chrome-"),
);
const port = 9_300 + (process.pid % 500);
const browser = spawn(
	chromePath,
	[
		"--headless=new",
		"--hide-scrollbars",
		"--disable-background-networking",
		"--disable-renderer-backgrounding",
		"--disable-background-timer-throttling",
		"--disable-backgrounding-occluded-windows",
		"--disable-component-update",
		"--disable-sync",
		"--no-first-run",
		"--force-device-scale-factor=1",
		`--remote-debugging-port=${port}`,
		`--user-data-dir=${profileDirectory}`,
		"about:blank",
	],
	{ stdio: "ignore" },
);
const browserClosed = new Promise((resolve) => {
	browser.once("exit", resolve);
});

const delay = (milliseconds) =>
	new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchJson(endpoint, init) {
	const deadline = Date.now() + 10_000;
	let lastError;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(endpoint, init);
			if (response.ok) return response.json();
			lastError = new Error(`${response.status} ${response.statusText}`);
		} catch (error) {
			lastError = error;
		}
		await delay(80);
	}
	throw lastError || new Error(`Timed out opening ${endpoint}`);
}

function connectToPage(webSocketUrl) {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(webSocketUrl);
		const pending = new Map();
		let nextID = 1;
		socket.addEventListener("open", () => {
			resolve({
				close: () => socket.close(),
				send(method, params = {}) {
					const id = nextID++;
					return new Promise((commandResolve, commandReject) => {
						const timer = setTimeout(() => {
							pending.delete(id);
							commandReject(new Error(`Timed out waiting for ${method}`));
						}, 30_000);
						pending.set(id, { resolve: commandResolve, reject: commandReject, timer });
						socket.send(JSON.stringify({ id, method, params }));
					});
				},
			});
		});
		socket.addEventListener("message", (event) => {
			const message = JSON.parse(event.data);
			if (!message.id || !pending.has(message.id)) return;
			const command = pending.get(message.id);
			pending.delete(message.id);
			clearTimeout(command.timer);
			if (message.error) {
				command.reject(new Error(message.error.message));
			} else {
				command.resolve(message.result);
			}
		});
		socket.addEventListener("error", () => {
			reject(new Error("Chrome DevTools WebSocket failed"));
		});
	});
}

async function evaluate(expression) {
	const evaluation = await page.send("Runtime.evaluate", {
		expression,
		returnByValue: true,
		awaitPromise: true,
	});
	if (evaluation.exceptionDetails) {
		throw new Error(
			evaluation.exceptionDetails.exception?.description ||
				evaluation.exceptionDetails.text ||
				"Page evaluation failed",
		);
	}
	return evaluation.result?.value;
}

async function writePageScreenshot(filePath, clip) {
	const screenshot = await page.send("Page.captureScreenshot", {
		format: "png",
		fromSurface: true,
		captureBeyondViewport: Boolean(clip),
		...(clip ? { clip: { ...clip, scale: 1 } } : {}),
	});
	const resolvedPath = path.resolve(filePath);
	await mkdir(path.dirname(resolvedPath), { recursive: true });
	await writeFile(resolvedPath, Buffer.from(screenshot.data, "base64"));
	console.log(resolvedPath);
}

async function getCompositionClip() {
	const clip = await evaluate(`(() => {
		const composition = document.querySelector('[data-quickshot-composition]');
		if (!composition) return null;
		const rect = composition.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return null;
		return {
			x: rect.left + window.scrollX,
			y: rect.top + window.scrollY,
			width: rect.width,
			height: rect.height,
		};
	})()`);
	if (!clip) {
		throw new Error("QuickShot composition boundary was not found");
	}
	return clip;
}

async function captureQuickSaveExport(filePath) {
	const initialCallCount =
		(await evaluate(
			"window.__quickshotPreviewFixture?.quickSaveCallCount || 0",
		)) || 0;
	const clicked = await evaluate(`(() => {
		const button = document.querySelector(
			'button[data-quickshot-action="quick-save"]',
		);
		if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
		button.click();
		return true;
	})()`);
	if (!clicked) {
		throw new Error("Quick save button was not available");
	}

	const exportDeadline = Date.now() + 30_000;
	let metadata;
	while (Date.now() < exportDeadline) {
		metadata = await evaluate(`(() => {
			const fixture = window.__quickshotPreviewFixture;
			if (
				!fixture ||
				fixture.quickSaveCallCount <= ${JSON.stringify(initialCallCount)} ||
				!(fixture.lastQuickSaveBytes instanceof Uint8Array)
			) return null;
			return {
				byteLength: fixture.lastQuickSaveByteLength,
				width: fixture.lastQuickSaveWidth,
				height: fixture.lastQuickSaveHeight,
			};
		})()`);
		if (metadata) break;
		await delay(80);
	}
	if (
		!metadata ||
		!Number.isSafeInteger(metadata.byteLength) ||
		metadata.byteLength <= 0 ||
		!Number.isSafeInteger(metadata.width) ||
		metadata.width <= 0 ||
		!Number.isSafeInteger(metadata.height) ||
		metadata.height <= 0
	) {
		throw new Error("Quick save fixture did not receive a valid PNG in time");
	}

	const chunkSize = 256 * 1024;
	const chunks = [];
	for (let offset = 0; offset < metadata.byteLength; offset += chunkSize) {
		const end = Math.min(metadata.byteLength, offset + chunkSize);
		const base64 = await evaluate(`(() => {
			const bytes = window.__quickshotPreviewFixture.lastQuickSaveBytes;
			const chunk = bytes.subarray(${offset}, ${end});
			let binary = "";
			for (let index = 0; index < chunk.length; index += 1) {
				binary += String.fromCharCode(chunk[index]);
			}
			return btoa(binary);
		})()`);
		chunks.push(Buffer.from(base64, "base64"));
	}
	const png = Buffer.concat(chunks);
	if (png.byteLength !== metadata.byteLength) {
		throw new Error(
			`Quick save PNG length mismatch: expected ${metadata.byteLength}, received ${png.byteLength}`,
		);
	}

	const resolvedPath = path.resolve(filePath);
	await mkdir(path.dirname(resolvedPath), { recursive: true });
	await writeFile(resolvedPath, png);
	console.log(
		`${resolvedPath} (${metadata.width}x${metadata.height}, ${metadata.byteLength} bytes)`,
	);
}

let page;
try {
	await fetchJson(`http://127.0.0.1:${port}/json/version`);
	const target = await fetchJson(
		`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`,
		{ method: "PUT" },
	);
	page = await connectToPage(target.webSocketDebuggerUrl);
	await page.send("Page.enable");
	await page.send("Page.bringToFront");
	await page.send("Runtime.enable");
	await page.send("Emulation.setDeviceMetricsOverride", {
		width,
		height,
		deviceScaleFactor,
		mobile: false,
	});
	await page.send("Page.navigate", { url });

	const readyDeadline = Date.now() + 15_000;
	let ready = false;
	while (Date.now() < readyDeadline) {
		const evaluation = await page.send("Runtime.evaluate", {
			expression: `(() => {
				const composition = document.querySelector('[data-quickshot-composition]');
				const canvas = document.querySelector(
					'[data-quickshot-composition-canvas]',
				);
				return document.documentElement.dataset.previewFixtureReady === 'true'
					&& Number(composition?.dataset.sourceWidth || 0) > 0
					&& Boolean(canvas && canvas.width > 0 && canvas.height > 0);
			})()`,
			returnByValue: true,
		});
		ready = evaluation.result?.value === true;
		if (ready) break;
		await delay(80);
	}
	if (!ready) throw new Error("Preview fixture did not become ready");
	if (nextDeviceScaleFactor > 0) {
		const before = await evaluate(`(() => {
			const canvas = document.querySelector('[data-quickshot-composition-canvas]');
			return { dpr: window.devicePixelRatio, width: canvas.width, height: canvas.height };
		})()`);
		await page.send("Emulation.setDeviceMetricsOverride", {
			width, height, deviceScaleFactor: nextDeviceScaleFactor, mobile: false,
		});
		await evaluate("new Promise(resolve => setTimeout(resolve, 500))");
		const after = await evaluate(`(() => {
			const canvas = document.querySelector('[data-quickshot-composition-canvas]');
			return { dpr: window.devicePixelRatio, width: canvas.width, height: canvas.height };
		})()`);
		console.log(JSON.stringify({ densityTransition: { before, after } }));
	}
	if (options["print-metadata"] === "true") {
		const metadata = await evaluate(`(() => {
			const composition = document.querySelector('[data-quickshot-composition]');
			const canvas = document.querySelector('[data-quickshot-composition-canvas]');
			const rect = composition?.getBoundingClientRect();
			return {
				devicePixelRatio: window.devicePixelRatio,
				sourceWidth: Number(composition?.dataset.sourceWidth || 0),
				sourceHeight: Number(composition?.dataset.sourceHeight || 0),
				previewWidth: rect?.width || 0,
				previewHeight: rect?.height || 0,
				canvasWidth: canvas instanceof HTMLCanvasElement ? canvas.width : 0,
				canvasHeight: canvas instanceof HTMLCanvasElement ? canvas.height : 0,
			};
		})()`);
		console.log(JSON.stringify(metadata));
	}

	await page.send("Runtime.evaluate", {
		expression:
			"new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
		awaitPromise: true,
	});
	if (output) {
		await writePageScreenshot(output);
	}
	if (compositionOutput) {
		await writePageScreenshot(compositionOutput, await getCompositionClip());
	}
	if (exportOutput) {
		await captureQuickSaveExport(exportOutput);
	}
} finally {
	page?.close();
	if (browser.exitCode === null && browser.signalCode === null) {
		browser.kill("SIGTERM");
		await Promise.race([browserClosed, delay(3_000)]);
	}
	await rm(profileDirectory, {
		recursive: true,
		force: true,
		maxRetries: 5,
		retryDelay: 100,
	});
}
