// Stereo hall impulse response: pre-delay, exponential decay, darkening tail.
import { writeFileSync } from "node:fs";
const RATE = 48000, LEN = Math.round(2.6 * RATE), PRE = Math.round(0.022 * RATE);
const ch = [new Float32Array(LEN), new Float32Array(LEN)];
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
for (const c of ch) {
	let lp = 0;
	for (let i = PRE; i < LEN; i++) {
		const t = (i - PRE) / RATE;
		const k = Math.min(0.92, 0.35 + t * 0.4); // the tail gets darker
		lp = lp * k + rand() * (1 - k);
		c[i] = lp * Math.exp(-t * 2.65) * (t < 0.01 ? t / 0.01 : 1);
	}
}
const frames = LEN, h = Buffer.alloc(44);
h.write("RIFF", 0); h.writeUInt32LE(36 + frames * 8, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16);
h.writeUInt16LE(3, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 8, 28);
h.writeUInt16LE(8, 32); h.writeUInt16LE(32, 34); h.write("data", 36); h.writeUInt32LE(frames * 8, 40);
const d = new Float32Array(frames * 2);
for (let i = 0; i < frames; i++) { d[2 * i] = ch[0][i]; d[2 * i + 1] = ch[1][i]; }
writeFileSync(process.argv[2], Buffer.concat([h, Buffer.from(d.buffer)]));
