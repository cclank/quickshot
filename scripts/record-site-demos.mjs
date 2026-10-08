// Records the demo videos on the landing page (site/assets/video) from the
// real capture overlay, editor and pinned window, staged on a made-up desktop
// (test-fixtures/demo). Every click, drag and keystroke is a real input event.
//
// Needs `npm run dev:ui` running, Google Chrome (or CHROME_PATH), ffmpeg with
// libx264, and cwebp.
//
//   node scripts/record-site-demos.mjs [--lang zh,en] [--only capture-window,annotate] [--keep-frames]
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const BASE = process.env.QUICKSHOT_DEMO_BASE || "http://localhost:5188";
const OUT = path.join(root, "site", "assets", "video");
const VIEW = { width: 1440, height: 900, scale: 2 };
const VIDEO = { width: 1920, height: 1200, fps: 30, crf: 22 };
// Headless screencasts come in CSS pixels, so the stage is scaled up to the video size.
const ZOOM = VIDEO.width / VIEW.width;
const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const args = process.argv.slice(2);
const option = (name) => {
	const index = args.indexOf(`--${name}`);
	return index >= 0 ? args[index + 1] : undefined;
};
const LANGS = (option("lang") || "zh,en").split(",");
const ONLY = option("only")?.split(",");
const KEEP_FRAMES = args.includes("--keep-frames");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

// ── DevTools protocol ─────────────────────────────────────────────────────────
async function openPage(port) {
	let target;
	for (let attempt = 0; attempt < 80 && !target; attempt += 1) {
		try {
			const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
			target = list.find((entry) => entry.type === "page");
		} catch {}
		if (!target) await sleep(150);
	}
	if (!target) throw new Error("Chrome did not start");
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		socket.onopen = resolve;
		socket.onerror = reject;
	});
	let next = 0;
	const pending = new Map();
	const handlers = new Map();
	socket.onmessage = (event) => {
		const message = JSON.parse(event.data);
		if (message.id) {
			const callbacks = pending.get(message.id);
			pending.delete(message.id);
			if (message.error) callbacks?.reject(new Error(`${callbacks.method}: ${message.error.message}`));
			else callbacks?.resolve(message.result);
		} else {
			for (const handler of handlers.get(message.method) || []) handler(message.params);
		}
	};
	const send = (method, params = {}) =>
		new Promise((resolve, reject) => {
			const id = ++next;
			pending.set(id, { resolve, reject, method });
			socket.send(JSON.stringify({ id, method, params }));
		});
	return {
		send,
		on(method, handler) {
			if (!handlers.has(method)) handlers.set(method, new Set());
			handlers.get(method).add(handler);
			return () => handlers.get(method).delete(handler);
		},
		async evaluate(expression) {
			const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
			if (result.exceptionDetails) throw new Error(`${expression.slice(0, 80)}: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`);
			return result.result.value;
		},
		close: () => socket.close(),
	};
}

async function navigate(page, url, readyExpression) {
	await page.send("Page.navigate", { url });
	for (let attempt = 0; attempt < 200; attempt += 1) {
		await sleep(50);
		try {
			if (await page.evaluate(readyExpression)) return;
		} catch {}
	}
	throw new Error(`Timed out loading ${url}`);
}

// ── The demo desktop ──────────────────────────────────────────────────────────
async function renderDesktop(page, lang) {
	await navigate(page, `${BASE}/test-fixtures/demo/desktop.html?lang=${lang}`, "typeof window.desktopReady === 'object'");
	await page.evaluate("window.desktopReady");
	await sleep(400);
	const full = await page.send("Page.captureScreenshot", { format: "png" });
	const windowList = await page.evaluate("window.describeWindows()");
	const images = {};
	await page.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
	for (const win of windowList) {
		await page.evaluate(`window.soloWindow(${win.id})`);
		await sleep(120);
		const shot = await page.send("Page.captureScreenshot", {
			format: "png",
			clip: { x: win.x, y: win.y, width: win.width, height: win.height, scale: 1 },
		});
		images[win.id] = shot.data;
	}
	await page.evaluate("window.soloWindow(null)");
	await page.send("Emulation.setDefaultBackgroundColorOverride", {});
	return { desktop: full.data, windowList, images };
}

// ── Input, with a drawn pointer ───────────────────────────────────────────────
function createDriver(page) {
	const state = { x: 720, y: 780, kind: "arrow", buttons: 0 };
	const drawCursor = () => page.evaluate(`demo.cursor(${state.x.toFixed(1)}, ${state.y.toFixed(1)}, "${state.kind}")`);
	const mouse = (type, extra = {}) =>
		page.send("Input.dispatchMouseEvent", {
			type,
			x: state.x * ZOOM,
			y: state.y * ZOOM,
			button: type === "mouseMoved" && !state.buttons ? "none" : "left",
			buttons: state.buttons,
			clickCount: 1,
			...extra,
		});
	const driver = {
		state,
		async place(x, y, kind) {
			Object.assign(state, { x, y });
			if (kind) state.kind = kind;
			await drawCursor();
			await mouse("mouseMoved");
		},
		async kind(kind) {
			state.kind = kind;
			await drawCursor();
		},
		/** Eased pointer travel with a slight arc, like a hand on a trackpad. */
		async move(x, y, ms = 650, kind) {
			if (kind) state.kind = kind;
			const from = { x: state.x, y: state.y };
			const distance = Math.hypot(x - from.x, y - from.y);
			const bend = Math.min(60, distance * 0.12) * (x >= from.x ? 1 : -1);
			const start = Date.now();
			for (;;) {
				const t = Math.min(1, (Date.now() - start) / ms);
				const e = ease(t);
				const arc = Math.sin(Math.PI * e) * bend;
				const nx = -(y - from.y) / (distance || 1);
				const ny = (x - from.x) / (distance || 1);
				state.x = from.x + (x - from.x) * e + nx * arc * 0.25;
				state.y = from.y + (y - from.y) * e + ny * arc * 0.25;
				await drawCursor();
				await mouse("mouseMoved");
				if (t >= 1) break;
				await sleep(8);
			}
		},
		async down() {
			state.buttons = 1;
			await page.evaluate(`demo.press(true); demo.ripple(${state.x}, ${state.y})`);
			await mouse("mousePressed");
		},
		async up() {
			state.buttons = 0;
			await mouse("mouseReleased");
			await page.evaluate("demo.press(false)");
		},
		async click(x, y, ms = 550, kind) {
			if (x !== undefined) await driver.move(x, y, ms, kind);
			await sleep(140);
			await driver.down();
			await sleep(90);
			await driver.up();
		},
		async drag(x, y, ms = 700) {
			await driver.down();
			await sleep(160);
			await driver.move(x, y, ms);
			await sleep(160);
			await driver.up();
		},
		async key(key, { code, modifiers = 0, keyCode } = {}) {
			const base = { key, code: code || (key.length === 1 ? `Key${key.toUpperCase()}` : key), modifiers, windowsVirtualKeyCode: keyCode ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : key === "Escape" ? 27 : 0) };
			await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
			await sleep(60);
			await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
		},
		async type(text, perChar = 85) {
			for (const char of text) {
				await page.send("Input.insertText", { text: char });
				await sleep(perChar + Math.random() * 40);
			}
		},
		async wheel(deltaY, steps = 6) {
			for (let i = 0; i < steps; i += 1) {
				await page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: state.x * ZOOM, y: state.y * ZOOM, deltaX: 0, deltaY: deltaY / steps });
				await sleep(28);
			}
		},
	};
	return driver;
}

const META = 4;
const SHIFT = 8;

// ── Scenes ────────────────────────────────────────────────────────────────────
const DESK = {
	dash: { x: 470, y: 400 },
	memo: { x: 1075, y: 560 },
	music: { x: 1150, y: 205 },
	empty: { x: 560, y: 760 },
};

function baseStyle(overrides = {}) {
	return {
		beautify: true,
		background: "gradient:sunset",
		padding: 64,
		radius: 14,
		shadow: 70,
		frame: "none",
		aspect: "auto",
		watermark: { enabled: true, placement: "margin", text: "QuickShot", color: "auto", opacity: 52, font: "script", weight: "regular", size: 120 },
		...overrides,
	};
}

function scenes(lang) {
	const L = (zh, en) => (lang === "zh" ? zh : en);
	const hud = (page, keys, label, ms) => page.evaluate(`demo.hud(${JSON.stringify(keys)}, ${JSON.stringify(label)}, ${ms ?? 1300})`);

	async function openWindowCapture(page, d, point = DESK.dash) {
		await page.evaluate("demo.trigger()");
		await d.place(point.x, point.y, "cross");
		await sleep(200);
		const shown = page.evaluate("demo.editorShown()");
		await d.click();
		await shown;
		await d.kind("arrow");
		await sleep(900);
	}
	async function shortcutCapture(page, d) {
		await hud(page, ["⌘", "⇧", "X"], L("截图", "Capture"));
		await sleep(280);
		await page.evaluate("demo.trigger()");
		await d.kind("cross");
	}
	/** Maps a point of the sample dashboard (1200 × 750) into the captured Northwind window. */
	async function dashboardMapper(page) {
		const r = await page.evaluate("demo.editorRect('[data-quickshot-composition] canvas', 1)");
		return (x, y) => ({ x: r.x + ((x * 0.65) / 780) * r.width, y: r.y + ((30 + y * 0.65) / 517.5) * r.height });
	}
	async function editorPoint(page, expression) {
		const r = await page.evaluate(expression);
		if (!r) throw new Error(`Not found: ${expression}`);
		return { x: r.x + r.width / 2, y: r.y + r.height / 2, rect: r };
	}
	const button = (page, text, scope) => editorPoint(page, `demo.editorButton(${JSON.stringify(text)}, ${JSON.stringify(scope ?? null)})`);
	const labelled = (page, label) => editorPoint(page, `demo.editorRect(${JSON.stringify(`[aria-label="${label}"]`)})`);
	const inGroup = (label) => `[role=radiogroup][aria-label="${label}"]`;
	async function slide(page, d, label, from, to, min, max, ms = 700) {
		const { rect } = await editorPoint(page, `demo.editorRect(${JSON.stringify(`input[type=range][aria-label="${label}"]`)})`);
		const at = (value) => rect.x + 8 + ((value - min) / (max - min)) * (rect.width - 16);
		await d.move(at(from), rect.y + rect.height / 2, 500, "arrow");
		await d.drag(at(to), rect.y + rect.height / 2, ms);
	}

	async function annotateDashboard(page, d, { quick = false } = {}) {
		const S = await dashboardMapper(page);
		const tool = async (key, label) => {
			await hud(page, [key.toUpperCase()], label, 1000);
			await d.key(key);
			await sleep(quick ? 150 : 260);
		};
		await tool("r", L("矩形", "Rectangle"));
		let p = S(874, 102);
		await d.move(p.x, p.y, 600, "cross");
		p = S(1176, 246);
		await d.drag(p.x, p.y, 650);
		await sleep(250);
		await tool("a", L("箭头", "Arrow"));
		p = S(705, 330);
		await d.move(p.x, p.y, 500);
		p = S(866, 252);
		await d.drag(p.x, p.y, 520);
		await sleep(250);
		await tool("t", L("文字", "Text"));
		p = lang === "zh" ? S(486, 300) : S(510, 300);
		await d.click(p.x, p.y, 500);
		await sleep(250);
		await d.type(L("转化率创新高", "Record high"), quick ? 70 : 95);
		await sleep(250);
		await d.key("Escape");
		await sleep(300);
		if (quick) {
			// Deselect, so the finished image is shown without handles.
			await d.key("Escape");
			return;
		}
		await tool("n", L("序号", "Step"));
		for (const [x, y] of [[262, 104], [262, 254], [262, 606]]) {
			p = S(x, y);
			await d.click(p.x, p.y, 450);
			await sleep(200);
		}
		await tool("h", L("荧光笔", "Highlighter"));
		p = S(284, 210);
		await d.move(p.x, p.y, 550);
		p = S(436, 210);
		await d.drag(p.x, p.y, 520);
		await sleep(250);
		await tool("m", L("打码", "Blur"));
		p = S(474, 662);
		await d.move(p.x, p.y, 550);
		p = S(596, 722);
		await d.drag(p.x, p.y, 600);
		await sleep(300);
		await d.key("Escape");
	}

	return {
		"capture-window": {
			style: baseStyle(),
			async play(page, d) {
				await d.place(DESK.empty.x, DESK.empty.y, "arrow");
				await sleep(900);
				await shortcutCapture(page, d);
				await sleep(400);
				await d.move(DESK.music.x, DESK.music.y, 850);
				await sleep(850);
				await d.move(DESK.memo.x, DESK.memo.y, 700);
				await sleep(850);
				await d.move(DESK.dash.x, DESK.dash.y, 900);
				await sleep(1000);
				const shown = page.evaluate("demo.editorShown()");
				await d.click();
				await shown;
				await d.kind("arrow");
				await sleep(400);
				await d.move(DESK.dash.x + 120, DESK.dash.y + 260, 900);
				await sleep(2200);
			},
		},
		"capture-area": {
			style: baseStyle({ frame: "classic" }),
			async play(page, d) {
				await d.place(1180, 780, "arrow");
				await sleep(900);
				await shortcutCapture(page, d);
				await sleep(400);
				await d.move(250, 182, 1000);
				await sleep(500);
				const shown = page.evaluate("demo.editorShown()");
				await d.drag(804, 418, 1400);
				await shown;
				await d.kind("arrow");
				await sleep(400);
				await d.move(900, 650, 900);
				await sleep(2200);
			},
		},
		annotate: {
			style: baseStyle(),
			async prepare(page, d) {
				await openWindowCapture(page, d);
				await d.place(980, 690, "arrow");
			},
			async play(page, d) {
				await sleep(700);
				await annotateDashboard(page, d);
				await d.move(1010, 700, 700, "arrow");
				await sleep(2200);
			},
		},
		beautify: {
			style: baseStyle({ frame: "classic", background: "gradient:peach", padding: 48, radius: 10, watermark: { ...baseStyle().watermark, enabled: false } }),
			async prepare(page, d) {
				// The dashboard without its title bar, as a clean area capture.
				await page.evaluate("demo.openCapture(101, 30)");
				await d.place(760, 640, "arrow");
				await sleep(900);
			},
			async play(page, d) {
				await sleep(700);
				for (const id of ["ocean", "grape", "sunset"]) {
					const p = await labelled(page, `${L("渐变", "Gradients")} ${id}`);
					await d.click(p.x, p.y, 650, "arrow");
					await sleep(750);
				}
				await slide(page, d, L("边距", "Padding"), 48, 88, 0, 160, 800);
				await sleep(500);
				await slide(page, d, L("圆角", "Corners"), 10, 20, 0, 36, 600);
				await sleep(500);
				const inspector = await editorPoint(page, "demo.editorRect('[data-quickshot-inspector]')");
				await d.move(inspector.x, inspector.y + 120, 500);
				await d.wheel(420, 10);
				await sleep(600);
				for (const frame of [L("玻璃", "Glass"), L("深色", "Dark")]) {
					const p = await button(page, frame);
					await d.click(p.x, p.y, 600);
					await sleep(900);
				}
				await d.wheel(300, 8);
				await sleep(500);
				const signature = await editorPoint(page, `demo.editorRect('[role=switch][aria-label="${L("签名", "Signature")}"]')`);
				await d.click(signature.x, signature.y, 600);
				await sleep(1000);
				const save = await editorPoint(page, "demo.editorRect('[data-quickshot-action=save-default]')");
				await d.click(save.x, save.y, 650);
				await sleep(2400);
			},
		},
		signature: {
			style: baseStyle({ background: "gradient:grape", frame: "classic", padding: 72, watermark: { ...baseStyle().watermark, enabled: false, text: "", font: "system", weight: "regular", size: 100, opacity: 52 } }),
			async prepare(page, d) {
				await page.evaluate("demo.openCapture(101, 30)");
				await d.place(760, 640, "arrow");
				await sleep(900);
			},
			async play(page, d) {
				await sleep(600);
				const inspector = await editorPoint(page, "demo.editorRect('[data-quickshot-inspector]')");
				await d.move(inspector.x, inspector.y, 700, "arrow");
				await d.wheel(1800, 16);
				await sleep(500);
				const field = await editorPoint(page, `demo.editorRect('input[type=text][aria-label="${L("签名", "Signature")}"]')`);
				await d.click(field.x, field.y, 600);
				await sleep(250);
				await d.type(L("@北风设计 Studio", "@Northwind Studio"), 95);
				await sleep(700);
				for (const font of L(["衬线", "几何", "等宽", "手写"], ["Serif", "Geometric", "Mono", "Script"])) {
					const p = await button(page, font, inGroup(L("字体", "Font")));
					await d.click(p.x, p.y, 520);
					await sleep(750);
				}
				const bold = await button(page, L("粗", "Bold"), inGroup(L("字重", "Weight")));
				await d.click(bold.x, bold.y, 600);
				await sleep(700);
				await slide(page, d, L("字号", "Size"), 100, 150, 60, 200, 700);
				await sleep(600);
				const inside = await button(page, L("截图内", "On image"), inGroup(L("位置", "Position")));
				await d.click(inside.x, inside.y, 600);
				await sleep(1100);
				const margin = await button(page, L("背景边距", "Margin"), inGroup(L("位置", "Position")));
				await d.click(margin.x, margin.y, 500);
				await sleep(800);
				await slide(page, d, L("不透明度", "Opacity"), 52, 78, 24, 80, 600);
				await sleep(2200);
			},
		},
		personalize: {
			style: { ...baseStyle({ frame: "classic", padding: 56, radius: 12, shadow: 60 }), watermark: { ...baseStyle().watermark, enabled: false, text: "", font: "system", size: 100, opacity: 42 } },
			async prepare(page, d) {
				await page.evaluate("demo.openCapture(101, 30)");
				await d.place(760, 640, "arrow");
				await sleep(900);
			},
			async play(page, d) {
				await sleep(600);
				let p = await labelled(page, `${L("渐变", "Gradients")} aurora`);
				await d.click(p.x, p.y, 700, "arrow");
				await sleep(700);
				await slide(page, d, L("边距", "Padding"), 56, 96, 0, 160, 700);
				await sleep(400);
				const inspector = await editorPoint(page, "demo.editorRect('[data-quickshot-inspector]')");
				await d.move(inspector.x, inspector.y + 100, 500);
				await d.wheel(520, 10);
				await sleep(400);
				p = await button(page, L("玻璃", "Glass"), inGroup(L("窗口", "Window")));
				await d.click(p.x, p.y, 550);
				await sleep(700);
				await d.wheel(1200, 12);
				await sleep(400);
				const field = await editorPoint(page, `demo.editorRect('input[type=text][aria-label="${L("签名", "Signature")}"]')`);
				await d.click(field.x, field.y, 550);
				await d.type(L("@北风设计", "@northwind"), 90);
				await sleep(500);
				await page.evaluate("demo.blurEditor()");
				const save = await editorPoint(page, "demo.editorRect('[data-quickshot-action=save-default]')");
				await d.click(save.x, save.y, 650);
				await sleep(1800);
				// A passing experiment, then back to the saved default in one click.
				await d.move(inspector.x, inspector.y + 100, 600);
				await d.wheel(-2400, 14);
				await sleep(400);
				p = await labelled(page, `${L("渐变", "Gradients")} ember`);
				await d.click(p.x, p.y, 550);
				await sleep(900);
				const reset = await editorPoint(page, "demo.editorRect('[data-quickshot-action=restore-default]')");
				await d.click(reset.x, reset.y, 700);
				await sleep(1500);
				// A new capture starts in the same style.
				await page.evaluate("demo.blurEditor()");
				await d.key("Escape");
				await sleep(250);
				if (await page.evaluate("demo.editorOpen()")) await d.key("Escape");
				await sleep(700);
				await shortcutCapture(page, d);
				await sleep(300);
				await d.move(DESK.memo.x, DESK.memo.y, 900);
				await sleep(700);
				const shown = page.evaluate("demo.editorShown()");
				await d.click();
				await shown;
				await d.kind("arrow");
				await sleep(2600);
			},
		},
		stitch: {
			// No shadow: it would show through the gaps between captures of different sizes.
			style: baseStyle({ shadow: 0 }),
			stitch: { arrangement: "vertical", align: "center", gap: 16 },
			async prepare(page, d) {
				await openWindowCapture(page, d);
				await d.place(980, 690, "arrow");
			},
			async play(page, d) {
				await sleep(800);
				for (const target of [DESK.memo, DESK.music]) {
					await hud(page, ["⌘", "⇧", "A"], L("再截一张", "Add a capture"));
					await d.key("A", { code: "KeyA", modifiers: META | SHIFT });
					await sleep(500);
					await d.move(target.x, target.y, 900, "cross");
					await sleep(700);
					await d.click();
					await sleep(300);
					await d.kind("arrow");
					await sleep(1300);
				}
				for (const label of [L("横向", "Horizontal"), L("网格", "Grid")]) {
					const p = await button(page, label);
					await d.click(p.x, p.y, 700, "arrow");
					await sleep(1300);
				}
				await slide(page, d, L("间距", "Spacing"), 16, 36, 0, 80, 700);
				await sleep(2200);
			},
		},
		"pin-ocr": {
			style: baseStyle(),
			async prepare(page, d) {
				await openWindowCapture(page, d);
				await d.place(980, 690, "arrow");
			},
			async play(page, d) {
				await sleep(800);
				const ocr = await labelled(page, L("提取文字", "Extract text"));
				await d.click(ocr.x, ocr.y, 800, "arrow");
				await sleep(2600);
				const close = await labelled(page, L("关闭文字提取", "Close text extraction"));
				await d.click(close.x, close.y, 700);
				await sleep(600);
				await hud(page, ["⌘", "⇧", "P"], L("贴到桌面", "Pin to screen"));
				await d.key("P", { code: "KeyP", modifiers: META | SHIFT });
				await sleep(1400);
				await d.key("Escape");
				await sleep(250);
				await d.key("Escape");
				await sleep(900);
				await d.move(1180, 230, 1000, "arrow");
				await sleep(2600);
			},
		},
		overview: {
			style: baseStyle(),
			async play(page, d) {
				await d.place(DESK.empty.x, DESK.empty.y, "arrow");
				await sleep(800);
				await shortcutCapture(page, d);
				await sleep(350);
				await d.move(DESK.music.x, DESK.music.y, 750);
				await sleep(600);
				await d.move(DESK.memo.x, DESK.memo.y, 650);
				await sleep(600);
				await d.move(DESK.dash.x, DESK.dash.y, 800);
				await sleep(700);
				const shown = page.evaluate("demo.editorShown()");
				await d.click();
				await shown;
				await d.kind("arrow");
				await sleep(900);
				await annotateDashboard(page, d, { quick: true });
				const swatch = await labelled(page, `${L("渐变", "Gradients")} ocean`);
				await d.click(swatch.x, swatch.y, 800, "arrow");
				await sleep(900);
				await hud(page, ["⌘", "C"], L("复制", "Copy"));
				await d.key("c", { modifiers: META });
				await sleep(2600);
			},
		},
	};
}

// ── Recording ─────────────────────────────────────────────────────────────────
async function record(page, frameDir) {
	await rm(frameDir, { recursive: true, force: true });
	await mkdir(frameDir, { recursive: true });
	const frames = [];
	const writes = [];
	const off = page.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
		const file = path.join(frameDir, `f${String(frames.length).padStart(5, "0")}.jpg`);
		frames.push({ file, ts: metadata.timestamp });
		writes.push(writeFile(file, Buffer.from(data, "base64")));
		page.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
	});
	await page.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: VIDEO.width, maxHeight: VIDEO.height, everyNthFrame: 1 });
	return {
		async stop() {
			const end = Date.now() / 1000;
			await page.send("Page.stopScreencast");
			off();
			await Promise.all(writes);
			return { frames, end };
		},
	};
}

async function encode({ frames, end }, frameDir, output) {
	if (frames.length < 2) throw new Error("No frames were recorded");
	const lines = [];
	for (let i = 0; i < frames.length; i += 1) {
		const until = i + 1 < frames.length ? frames[i + 1].ts : end;
		lines.push(`file '${frames[i].file}'`, `duration ${Math.max(0.001, until - frames[i].ts).toFixed(4)}`);
	}
	lines.push(`file '${frames.at(-1).file}'`);
	const list = path.join(frameDir, "frames.txt");
	await writeFile(list, `${lines.join("\n")}\n`);
	await execFileAsync("ffmpeg", [
		"-v", "error", "-y",
		"-f", "concat", "-safe", "0", "-i", list,
		"-vf", `fps=${VIDEO.fps},scale=${VIDEO.width}:${VIDEO.height}:flags=lanczos,format=yuv420p`,
		"-c:v", "libx264", "-preset", "slow", "-crf", String(VIDEO.crf), "-profile:v", "high",
		"-movflags", "+faststart", "-an", output,
	]);
	const poster = output.replace(/\.mp4$/, ".webp");
	const posterPng = path.join(frameDir, "poster.png");
	await execFileAsync("ffmpeg", ["-v", "error", "-y", "-i", output, "-frames:v", "1", posterPng]);
	await execFileAsync("cwebp", ["-quiet", "-q", "82", posterPng, "-o", poster]);
	const seconds = end - frames[0].ts;
	return { seconds, frames: frames.length, bytes: (await stat(output)).size };
}

async function main() {
	try {
		await fetch(`${BASE}/test-fixtures/demo/stage.html`);
	} catch {
		throw new Error(`Start the UI dev server first (npm run dev:ui), expected at ${BASE}`);
	}
	await mkdir(OUT, { recursive: true });
	const work = await mkdtemp(path.join(os.tmpdir(), "quickshot-demos-"));
	const port = 9300 + Math.floor(Math.random() * 500);
	const browser = spawn(chrome, [
		"--headless=new",
		`--remote-debugging-port=${port}`,
		`--user-data-dir=${path.join(work, "profile")}`,
		"--hide-scrollbars",
		"--disable-background-timer-throttling",
		"--disable-renderer-backgrounding",
		"--force-color-profile=srgb",
		`--window-size=${VIEW.width},${VIEW.height}`,
		"about:blank",
	], { stdio: "ignore" });
	try {
		const page = await openPage(port);
		await page.send("Page.enable");
		await page.send("Runtime.enable");
		await page.send("Emulation.setDeviceMetricsOverride", { width: VIEW.width, height: VIEW.height, deviceScaleFactor: VIEW.scale, mobile: false });
		await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }, { name: "prefers-reduced-motion", value: "no-preference" }] });
		const metrics = (width, height, deviceScaleFactor) =>
			page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor, mobile: false });
		for (const lang of LANGS) {
			await metrics(VIEW.width, VIEW.height, VIEW.scale);
			const assets = await renderDesktop(page, lang);
			await metrics(VIDEO.width, VIDEO.height, 1);
			const all = scenes(lang);
			for (const [name, scene] of Object.entries(all)) {
				if (ONLY && !ONLY.includes(name)) continue;
				await navigate(page, `${BASE}/test-fixtures/demo/stage.html?lang=${lang}&zoom=${ZOOM}`, "typeof window.demo === 'object'");
				await page.evaluate(`(() => {
					for (const key of Object.keys(localStorage)) if (key.startsWith("quickshot.")) localStorage.removeItem(key);
					localStorage.setItem("quickshot.style.v2", ${JSON.stringify(JSON.stringify(scene.style))});
					localStorage.setItem("quickshot.stitch.v1", ${JSON.stringify(JSON.stringify(scene.stitch || { arrangement: "vertical", align: "center", gap: 0 }))});
				})()`);
				await page.evaluate(`demo.load(${JSON.stringify(assets)})`);
				const driver = createDriver(page);
				await driver.place(DESK.empty.x, DESK.empty.y, "arrow");
				if (scene.prepare) await scene.prepare(page, driver);
				await sleep(400);
				const frameDir = path.join(work, `${name}-${lang}`);
				const recording = await record(page, frameDir);
				await sleep(150);
				await scene.play(page, driver);
				const result = await encode(await recording.stop(), frameDir, path.join(OUT, `${name}-${lang}.mp4`));
				console.log(`${name}-${lang}.mp4  ${result.seconds.toFixed(1)}s  ${result.frames} frames  ${(result.bytes / 1024).toFixed(0)} KB`);
				if (!KEEP_FRAMES) await rm(frameDir, { recursive: true, force: true });
			}
		}
		page.close();
	} finally {
		const exited = new Promise((resolve) => browser.once("exit", resolve));
		browser.kill();
		await Promise.race([exited, sleep(3000)]);
		if (KEEP_FRAMES) console.log(`Frames kept in ${work}`);
		else await rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
