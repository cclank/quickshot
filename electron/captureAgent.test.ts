import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { type AgentEvent, CaptureAgent, parseAgentEvent, parseAgentLine, splitLines } from "./captureAgent";

// A stand-in for the Swift agent: echoes requests, ignores "slow", dies on "crash".
const FAKE_AGENT = `
const readline = require("node:readline");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
	const request = JSON.parse(line);
	if (request.cmd === "slow") return;
	if (request.cmd === "crash") process.exit(3);
	if (request.cmd === "tick") process.stdout.write(JSON.stringify({ event: "scroll", status: "capturing", height: 900 }) + "\\n");
	process.stdout.write(JSON.stringify({ id: request.id, ok: true, echo: request.cmd }) + "\\n");
});
`;

const fakeSpawn = (() =>
	spawn(process.execPath, ["-e", FAKE_AGENT], { stdio: ["pipe", "pipe", "pipe"] })) as unknown as typeof spawn;

const agents: CaptureAgent[] = [];
function createAgent(events: string[] = []) {
	const agent = new CaptureAgent("fake", (event) => events.push(event), fakeSpawn);
	agents.push(agent);
	return agent;
}

afterEach(() => {
	for (const agent of agents.splice(0)) agent.stop();
});

describe("agent protocol parsing", () => {
	it("accepts responses with an integer id and ok flag only", () => {
		expect(parseAgentLine('{"id":3,"ok":true,"ms":12}')).toEqual({ id: 3, ok: true, ms: 12 });
		expect(parseAgentLine('{"id":"3","ok":true}')).toBeNull();
		expect(parseAgentLine('{"id":3}')).toBeNull();
		expect(parseAgentLine("not json")).toBeNull();
	});

	it("tells the agent's own events apart from responses", () => {
		expect(parseAgentEvent('{"event":"scroll","status":"lost","height":1200}')).toEqual({
			event: "scroll",
			status: "lost",
			height: 1200,
		});
		expect(parseAgentEvent('{"id":3,"ok":true}')).toBeNull();
		expect(parseAgentEvent('{"id":3,"event":"scroll"}')).toBeNull();
		expect(parseAgentEvent('{"event":""}')).toBeNull();
		expect(parseAgentEvent("[1]")).toBeNull();
	});

	it("keeps a partial line until the rest arrives", () => {
		const first = splitLines("", '{"id":1,"ok":true}\n{"id":2,');
		expect(first).toEqual({ lines: ['{"id":1,"ok":true}'], rest: '{"id":2,' });
		expect(splitLines(first.rest, '"ok":false}\n')).toEqual({ lines: ['{"id":2,"ok":false}'], rest: "" });
	});
});

describe("CaptureAgent", () => {
	it("matches responses to requests", async () => {
		const agent = createAgent();
		const [a, b] = await Promise.all([
			agent.request({ cmd: "windows" }, 5000),
			agent.request({ cmd: "display" }, 5000),
		]);
		expect(a).toMatchObject({ ok: true, echo: "windows" });
		expect(b).toMatchObject({ ok: true, echo: "display" });
	});

	it("gives up on a stuck request and restarts the helper", async () => {
		const events: string[] = [];
		const agent = createAgent(events);
		expect(await agent.request({ cmd: "slow" }, 150)).toBeNull();
		expect(events).toContain("capture-agent-timeout");
		expect(await agent.request({ cmd: "windows" }, 5000)).toMatchObject({ ok: true });
	});

	it("resolves pending requests when the helper exits", async () => {
		const events: string[] = [];
		const agent = createAgent(events);
		expect(await agent.request({ cmd: "crash" }, 5000)).toBeNull();
		expect(events).toContain("capture-agent-stopped");
		expect(await agent.request({ cmd: "windows" }, 5000)).toMatchObject({ ok: true });
	});

	it("passes on the agent's events and says when it stops", async () => {
		const agent = createAgent();
		const received: AgentEvent[] = [];
		agent.onEvent((event) => received.push(event));
		expect(await agent.request({ cmd: "tick" }, 5000)).toMatchObject({ ok: true });
		expect(received).toEqual([{ event: "scroll", status: "capturing", height: 900 }]);
		expect(await agent.request({ cmd: "crash" }, 5000)).toBeNull();
		expect(received.at(-1)).toEqual({ event: "stopped" });
	});
});
