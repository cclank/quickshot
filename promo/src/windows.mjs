import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { connect, sleep } from "./cdp.mjs";
const port = 9733;
const b = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${port}`, "--user-data-dir=/tmp/qs-promo-win", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
try {
	const page = await connect(port, () => true);
	await page.send("Page.enable");
	await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
	await page.send("Page.navigate", { url: "http://localhost:5188/test-fixtures/demo/desktop.html?lang=zh" });
	await sleep(1500);
	await page.evaluate("window.desktopReady");
	const full = await page.send("Page.captureScreenshot", { format: "png" });
	writeFileSync(process.argv[2] + "/desktop.png", Buffer.from(full.data, "base64"));
	const wins = await page.evaluate("window.describeWindows()");
	await page.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
	const names = { 101: "dash", 102: "memo", 103: "music" };
	for (const w of wins) {
		await page.evaluate(`window.soloWindow(${w.id})`);
		await sleep(150);
		const s = await page.send("Page.captureScreenshot", { format: "png", clip: { x: w.x, y: w.y, width: w.width, height: w.height, scale: 1 } });
		writeFileSync(`${process.argv[2]}/${names[w.id]}.png`, Buffer.from(s.data, "base64"));
	}
	console.log(wins);
} finally { b.kill(); }
process.exit(0);
