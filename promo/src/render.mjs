// node render.mjs frames <outDir> <fps> [from] [to]   |   node render.mjs stills <outDir> t1,t2,...
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { connect, sleep } from "./cdp.mjs";
const [mode, out, arg, from = "0", to = "85.36"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const port = 9744 + Math.floor(Math.random() * 100);
const b = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/qs-promo-render-${port}`, "--hide-scrollbars", "--force-color-profile=srgb", "--disable-renderer-backgrounding", "about:blank"], { stdio: "ignore" });
try {
	const page = await connect(port, () => true);
	await page.send("Page.enable");
	await page.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
	await page.send("Page.navigate", { url: "http://127.0.0.1:4401/promo.html" });
	for (let i = 0; i < 100; i++) { await sleep(100); try { if (await page.evaluate("typeof window.ready === 'object'")) break; } catch {} }
	await page.evaluate("window.ready");
	const shoot = async (t, file) => {
		await page.evaluate(`window.render(${t})`);
		const { data } = await page.send("Page.captureScreenshot", { format: "jpeg", quality: 94, optimizeForSpeed: true });
		writeFileSync(file, Buffer.from(data, "base64"));
	};
	if (mode === "stills") {
		for (const t of arg.split(",").map(Number)) await shoot(t, `${out}/t${t.toFixed(2).padStart(6, "0")}.jpg`);
	} else {
		const fps = Number(arg), f0 = Math.round(Number(from) * fps), f1 = Math.round(Number(to) * fps);
		const start = Date.now();
		for (let f = f0; f < f1; f++) {
			await shoot(f / fps, `${out}/${String(f).padStart(6, "0")}.jpg`);
			if (f % 300 === 0) console.log(`frame ${f}/${f1} ${((Date.now() - start) / 1000).toFixed(0)}s`);
		}
		console.log(`done ${f1 - f0} frames in ${((Date.now() - start) / 1000).toFixed(0)}s`);
	}
} finally { b.kill(); }
process.exit(0);
