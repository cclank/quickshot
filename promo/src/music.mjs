// Arranges the "City Nights" Apple Loops (97 BPM, G minor) into the promo
// soundtrack and writes timing.json, so the picture can follow the same beat
// clock. Usage: node music.mjs <loops dir> <out dir>
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [loopsDir, outDir] = process.argv.slice(2);
const RATE = 48000;

function readWav(file) {
	const buf = readFileSync(file);
	let offset = 12;
	let channels = 2;
	while (offset < buf.length) {
		const id = buf.toString("ascii", offset, offset + 4);
		const size = buf.readUInt32LE(offset + 4);
		if (id === "fmt ") channels = buf.readUInt16LE(offset + 10);
		if (id === "data") {
			const data = new Float32Array(buf.buffer.slice(buf.byteOffset + offset + 8, buf.byteOffset + offset + 8 + size));
			const frames = data.length / channels;
			const left = new Float32Array(frames);
			const right = new Float32Array(frames);
			for (let i = 0; i < frames; i++) {
				left[i] = data[i * channels];
				right[i] = data[i * channels + (channels > 1 ? 1 : 0)];
			}
			return [left, right];
		}
		offset += 8 + size + (size % 2);
	}
	throw new Error(`No data in ${file}`);
}

function writeWav(file, [left, right]) {
	const frames = left.length;
	const header = Buffer.alloc(44);
	header.write("RIFF", 0);
	header.writeUInt32LE(36 + frames * 8, 4);
	header.write("WAVEfmt ", 8);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(3, 20); // IEEE float
	header.writeUInt16LE(2, 22);
	header.writeUInt32LE(RATE, 24);
	header.writeUInt32LE(RATE * 8, 28);
	header.writeUInt16LE(8, 32);
	header.writeUInt16LE(32, 34);
	header.write("data", 36);
	header.writeUInt32LE(frames * 8, 40);
	const data = new Float32Array(frames * 2);
	for (let i = 0; i < frames; i++) {
		data[i * 2] = left[i];
		data[i * 2 + 1] = right[i];
	}
	writeFileSync(file, Buffer.concat([header, Buffer.from(data.buffer)]));
}

const names = ["Electric_Piano", "Strings", "Beat", "Bass", "Trumpet_Lead", "Violin_Lead", "Brass_01", "Brass_02"];
const loops = Object.fromEntries(names.map((name) => [name, readWav(path.join(loopsDir, `City_Nights_${name}.wav`))]));
const LOOP = Math.min(...names.map((name) => loops[name][0].length));
const BAR = LOOP / 4;
const BEAT = LOOP / 16;

// Gain in dB per 4-bar block; missing = silent.
const db = (value) => 10 ** (value / 20);
const blocks = [
	{ name: "intro", Electric_Piano: 0, Strings: -3 },
	{ name: "capture", Electric_Piano: 0, Strings: -5, Beat: -1, Bass: 0 },
	{ name: "annotate", Electric_Piano: 0, Strings: -7, Beat: -1, Bass: 0, Trumpet_Lead: -1 },
	{ name: "beautify", Electric_Piano: 0, Strings: -7, Beat: -1, Bass: 0, Violin_Lead: -2 },
	{ name: "signature", Electric_Piano: 0, Strings: -7, Beat: -1, Bass: 0, Brass_01: -1, Brass_02: -5 },
	{ name: "stitch", Electric_Piano: 0, Strings: -4, Beat: -1, Bass: 0, Trumpet_Lead: -1, Brass_01: -4 },
	{ name: "breakdown", Electric_Piano: 0, Strings: -2, Bass: -3, Violin_Lead: -3 },
	{ name: "finale", Electric_Piano: 0, Strings: -3, Beat: -1, Bass: 0, Trumpet_Lead: -1, Brass_01: -3, Brass_02: -6 },
];
const TAIL_BARS = 2.5;
const total = Math.round(blocks.length * LOOP + TAIL_BARS * BAR);
const mix = [new Float32Array(total), new Float32Array(total)];

const RAMP = Math.round(0.012 * RATE);
for (const name of names) {
	const [l, r] = loops[name];
	const gainAt = (block) => (blocks[block] && blocks[block][name] !== undefined ? db(blocks[block][name]) : 0);
	for (let b = 0; b < blocks.length; b++) {
		const g = gainAt(b);
		const prev = gainAt(b - 1);
		if (g === 0 && prev === 0) continue;
		const start = b * LOOP;
		for (let i = 0; i < LOOP; i++) {
			let gain = g;
			// Short crossfade from the previous block's level, avoiding clicks.
			if (i < RAMP) gain = prev + (g - prev) * (i / RAMP);
			// The intro swells in: piano over one bar, strings over two.
			if (b === 0) {
				const swell = name === "Strings" ? 2 * BAR : BAR;
				gain *= Math.min(1, (i / swell) ** 1.6);
			}
			mix[0][start + i] += l[i] * gain;
			mix[1][start + i] += r[i] * gain;
		}
	}
}

// Ending: the downbeat of the next cycle rings out under a long fade.
const endStart = blocks.length * LOOP;
const endParts = { Electric_Piano: 0, Strings: -1, Bass: -2, Brass_01: -4 };
const endLength = total - endStart;
for (const [name, gainDb] of Object.entries(endParts)) {
	const [l, r] = loops[name];
	for (let i = 0; i < endLength; i++) {
		const fade = i < BEAT * 1.5 ? 1 : Math.exp(-((i - BEAT * 1.5) / RATE) * 1.6);
		const gain = db(gainDb) * fade * (i < RAMP ? i / RAMP : 1);
		const src = i % LOOP;
		mix[0][endStart + i] += l[src] * gain;
		mix[1][endStart + i] += r[src] * gain;
	}
}
for (let i = total - Math.round(0.05 * RATE); i < total; i++) {
	const k = (total - i) / (0.05 * RATE);
	mix[0][i] *= k;
	mix[1][i] *= k;
}

writeWav(path.join(outDir, "music-raw.wav"), mix);
const timing = {
	rate: RATE,
	bpm: (60 * RATE) / BEAT,
	beat: BEAT / RATE,
	bar: BAR / RATE,
	block: LOOP / RATE,
	blocks: blocks.map((b) => b.name),
	duration: total / RATE,
};
writeFileSync(path.join(outDir, "timing.json"), JSON.stringify(timing, null, 2));
console.log(timing);
