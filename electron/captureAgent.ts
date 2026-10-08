import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";

export type AgentResponse = {
	id: number;
	ok: boolean;
	error?: string;
	[key: string]: unknown;
};

type Pending = {
	resolve: (response: AgentResponse | null) => void;
	timer: ReturnType<typeof setTimeout>;
};

type Diagnostic = (event: string, details?: Record<string, unknown>) => void;

/** Parses one line of agent output; anything malformed is ignored. */
export function parseAgentLine(line: string): AgentResponse | null {
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch {
		return null;
	}
	if (!value || typeof value !== "object") return null;
	const { id, ok } = value as Record<string, unknown>;
	if (typeof id !== "number" || !Number.isInteger(id) || typeof ok !== "boolean") return null;
	return value as AgentResponse;
}

/** Splits streamed output into complete lines, keeping a partial tail. */
export function splitLines(buffer: string, chunk: string): { lines: string[]; rest: string } {
	const parts = (buffer + chunk).split("\n");
	const rest = parts.pop() ?? "";
	return { lines: parts.filter((line) => line.trim().length > 0), rest };
}

/**
 * Talks to the resident macOS capture helper (native/quickshot-capture-agent)
 * over newline-delimited JSON. Every request resolves to null on failure or
 * timeout, so callers can fall back to /usr/sbin/screencapture. A helper that
 * times out is restarted, and one that keeps crashing is left alone for a
 * minute.
 */
export class CaptureAgent {
	private child: ChildProcessWithoutNullStreams | null = null;
	private nextId = 0;
	private readonly pending = new Map<number, Pending>();
	private buffer = "";
	private crashes = 0;
	private pausedUntil = 0;

	constructor(
		private readonly executable: string,
		private readonly diagnostic: Diagnostic,
		private readonly spawnProcess: typeof spawn = spawn,
	) {}

	start(): boolean {
		if (this.child) return true;
		if (Date.now() < this.pausedUntil) return false;
		let child: ChildProcessWithoutNullStreams;
		try {
			child = this.spawnProcess(this.executable, [], { stdio: ["pipe", "pipe", "pipe"] });
		} catch (error) {
			this.noteCrash("spawn-failed", error);
			return false;
		}
		this.child = child;
		this.buffer = "";
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => this.handleOutput(chunk));
		child.stderr.resume();
		child.stdin.on("error", () => {});
		child.once("error", (error) => {
			if (this.child === child) this.handleExit(child, "error", error);
		});
		child.once("exit", (code, signal) => {
			if (this.child === child) this.handleExit(child, "exit", { code, signal });
		});
		return true;
	}

	stop() {
		const child = this.child;
		this.child = null;
		this.failPending();
		if (child) {
			child.stdin.end();
			child.kill();
		}
	}

	request(command: Record<string, unknown>, timeoutMs: number): Promise<AgentResponse | null> {
		if (!this.start() || !this.child) return Promise.resolve(null);
		const child = this.child;
		const id = ++this.nextId;
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				if (!this.pending.delete(id)) return;
				this.diagnostic("capture-agent-timeout", { cmd: command.cmd, timeoutMs });
				resolve(null);
				// A stuck helper would stall every later capture; start afresh.
				if (this.child === child) this.stop();
			}, timeoutMs);
			this.pending.set(id, { resolve, timer });
			child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
		});
	}

	private handleOutput(chunk: string) {
		const { lines, rest } = splitLines(this.buffer, chunk);
		this.buffer = rest;
		for (const line of lines) {
			const response = parseAgentLine(line);
			if (!response) continue;
			const entry = this.pending.get(response.id);
			if (!entry) continue;
			this.pending.delete(response.id);
			clearTimeout(entry.timer);
			this.crashes = 0;
			entry.resolve(response);
		}
	}

	private handleExit(child: ChildProcessWithoutNullStreams, reason: string, details: unknown) {
		if (this.child !== child) return;
		this.child = null;
		this.failPending();
		this.noteCrash(reason, details);
	}

	private noteCrash(reason: string, details: unknown) {
		this.crashes += 1;
		this.diagnostic("capture-agent-stopped", {
			reason,
			details: details instanceof Error ? details.message : details,
			crashes: this.crashes,
		});
		if (this.crashes >= 3) {
			this.crashes = 0;
			this.pausedUntil = Date.now() + 60_000;
		}
	}

	private failPending() {
		for (const [id, entry] of this.pending) {
			clearTimeout(entry.timer);
			entry.resolve(null);
			this.pending.delete(id);
		}
	}
}
