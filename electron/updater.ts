import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { once } from "node:events";
import { access, chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import {
	GITHUB_FEED_URL,
	GITHUB_LATEST_URL,
	MAC_INSTALL_SCRIPT,
	UPDATE_CHECK_INTERVAL_MS,
	UPDATE_FEED_URL,
	UPDATE_FIRST_CHECK_DELAY_MS,
	type UpdateRelease,
	type UpdateTarget,
	isAllowedUpdateUrl,
	newestRelease,
	releaseFromFeed,
	releaseFromGitHub,
} from "./updates";

export type UpdateState =
	| { kind: "idle" }
	| { kind: "checking" }
	| { kind: "upToDate" }
	| { kind: "available"; version: string }
	| { kind: "downloading"; version: string; progress: number }
	| { kind: "installing"; version: string }
	| { kind: "failed"; reason: UpdateFailure };

export type UpdateFailure = "network" | "download" | "checksum" | "location" | "install";

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export type UpdaterOptions = {
	currentVersion: string;
	target: UpdateTarget | null;
	/** Electron's net.fetch: the system proxy and certificates apply. */
	fetch: Fetcher;
	tempDirectory: string;
	/** The running .app on macOS, or null elsewhere. */
	bundlePath: string | null;
	/** False in development: a dev build never replaces itself. */
	canInstall: boolean;
	/** Whether automatic checks run; local builds and dev builds skip them. */
	automatic: boolean;
	/** `found` is set when an automatic check has just found this update. */
	onChange: (state: UpdateState, found?: "automatic") => void;
	/** Asked before QuickShot quits to install; false keeps it running. */
	confirmInstall: (version: string) => Promise<boolean>;
	quit: () => void;
	diagnostic: (event: string, details?: Record<string, unknown>) => void;
};

const METADATA_TIMEOUT_MS = 12_000;
const MAX_METADATA_BYTES = 512 * 1024;

/**
 * Checks for updates on launch and every few hours, and on request; a found
 * update waits for the user. Installing downloads the installer, checks its
 * SHA-256, then hands over to a script (macOS) or the installer (Windows)
 * and quits.
 */
export class Updater {
	private state: UpdateState = { kind: "idle" };
	private release: UpdateRelease | null = null;
	private timer: NodeJS.Timeout | null = null;
	private lastProgressAt = 0;

	constructor(private readonly options: UpdaterOptions) {}

	get current(): UpdateState {
		return this.state;
	}

	start() {
		if (!this.options.automatic || !this.options.target) return;
		this.timer = setTimeout(() => {
			void this.check(false);
			this.timer = setInterval(() => void this.check(false), UPDATE_CHECK_INTERVAL_MS);
			this.timer.unref();
		}, UPDATE_FIRST_CHECK_DELAY_MS);
		this.timer.unref();
	}

	stop() {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
	}

	/** Looks for a newer release. Automatic checks stay quiet when they fail. */
	async check(userInitiated: boolean): Promise<UpdateState> {
		const { target } = this.options;
		if (!target || ["checking", "downloading", "installing"].includes(this.state.kind)) return this.state;
		const previous = this.state;
		if (userInitiated) this.set({ kind: "checking" });
		const feeds = await Promise.allSettled([this.fetchJson(UPDATE_FEED_URL), this.fetchJson(GITHUB_FEED_URL)]);
		const candidates = feeds.map((result) => (result.status === "fulfilled" ? releaseFromFeed(result.value, target) : null));
		let answered = feeds.filter((result) => result.status === "fulfilled").length;
		if (!answered) {
			// Neither feed answered: ask GitHub's API, which is rate limited.
			const [github] = await Promise.allSettled([this.fetchJson(GITHUB_LATEST_URL)]);
			if (github.status === "fulfilled") {
				answered = 1;
				candidates.push(releaseFromGitHub(github.value, target));
			}
		}
		const release = newestRelease(candidates, this.options.currentVersion);
		this.options.diagnostic("update-checked", {
			userInitiated,
			sources: answered,
			found: release?.version ?? null,
		});
		if (release) {
			this.release = release;
			this.set({ kind: "available", version: release.version }, userInitiated ? undefined : "automatic");
		} else if (answered) {
			this.release = null;
			this.set(userInitiated ? { kind: "upToDate" } : previous.kind === "available" ? previous : { kind: "idle" });
		} else {
			this.set(userInitiated ? { kind: "failed", reason: "network" } : previous);
		}
		return this.state;
	}

	/** Downloads, verifies and installs the update that was found. */
	async install(): Promise<void> {
		const release = this.release;
		if (!release || this.state.kind !== "available") return;
		const mac = this.options.target?.startsWith("mac");
		if (mac && !(await this.canReplaceBundle())) {
			this.fail("location", this.options.bundlePath ?? "no bundle");
			return;
		}
		if (!(await this.options.confirmInstall(release.version))) return;

		const workspace = await mkdtemp(path.join(this.options.tempDirectory, "quickshot-update-"));
		await chmod(workspace, 0o700);
		const installer = path.join(workspace, mac ? "QuickShot.dmg" : `QuickShot-${release.version}-Setup.exe`);
		this.set({ kind: "downloading", version: release.version, progress: 0 });
		this.options.diagnostic("update-download-started", { version: release.version });
		try {
			const digest = await this.download(release, installer);
			if (digest !== release.sha256) {
				await rm(workspace, { recursive: true, force: true });
				this.fail("checksum", release.version);
				return;
			}
		} catch (error) {
			await rm(workspace, { recursive: true, force: true });
			this.fail("download", error instanceof Error ? error.message : String(error));
			return;
		}
		if (!this.options.canInstall) {
			// A development build stops here, after a real download and check.
			await rm(workspace, { recursive: true, force: true });
			this.fail("install", "development build: downloaded and verified, not installed");
			return;
		}

		this.set({ kind: "installing", version: release.version });
		this.options.diagnostic("update-installing", { version: release.version });
		try {
			if (mac) await this.launchMacInstaller(workspace, installer, release.version);
			else spawn(installer, [], { detached: true, stdio: "ignore", windowsHide: false }).unref();
		} catch (error) {
			await rm(workspace, { recursive: true, force: true });
			this.fail("install", error instanceof Error ? error.message : String(error));
			return;
		}
		// The script waits for this process to end before it touches the app.
		setTimeout(() => this.options.quit(), 300);
	}

	private set(state: UpdateState, found?: "automatic") {
		this.state = state;
		this.options.onChange(state, found);
	}

	private fail(reason: UpdateFailure, detail: string) {
		this.options.diagnostic("update-failed", { reason, detail });
		this.set({ kind: "failed", reason });
	}

	private async fetchJson(url: string): Promise<unknown> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS);
		try {
			const response = await this.options.fetch(url, {
				headers: { Accept: "application/vnd.github+json" },
				cache: "no-store",
				credentials: "omit",
				redirect: "follow",
				signal: controller.signal,
			});
			if (!response.ok || !isAllowedUpdateUrl(response.url || url, "metadata")) throw new Error(`HTTP ${response.status}`);
			const text = await response.text();
			if (text.length > MAX_METADATA_BYTES) throw new Error("metadata too large");
			return JSON.parse(text);
		} finally {
			clearTimeout(timer);
		}
	}

	/** Streams the installer to `file`, reporting progress, and returns its SHA-256. */
	private async download(release: UpdateRelease, file: string): Promise<string> {
		const response = await this.options.fetch(release.url, { cache: "no-store", credentials: "omit", redirect: "follow" });
		if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
		if (!isAllowedUpdateUrl(response.url || release.url, "redirect")) throw new Error("untrusted download host");
		const total = Number(response.headers.get("content-length")) || release.size || 0;
		const hash = createHash("sha256");
		const output = createWriteStream(file, { mode: 0o600 });
		const reader = response.body.getReader();
		let received = 0;
		try {
			// Read the body chunk by chunk; Electron's stream does not always
			// flow through Node's stream adapters.
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				hash.update(value);
				received += value.length;
				if (!output.write(value)) await once(output, "drain");
				const now = Date.now();
				if (total > 0 && now - this.lastProgressAt > 250) {
					this.lastProgressAt = now;
					this.set({ kind: "downloading", version: release.version, progress: Math.min(1, received / total) });
				}
			}
		} finally {
			output.end();
			await once(output, "close");
		}
		if (release.size && received !== release.size) throw new Error(`got ${received} of ${release.size} bytes`);
		this.options.diagnostic("update-downloaded", { bytes: received });
		return hash.digest("hex");
	}

	/** Only an app the user can replace, outside a disk image or App Translocation. */
	private async canReplaceBundle(): Promise<boolean> {
		const bundle = this.options.bundlePath;
		if (!bundle || bundle.startsWith("/Volumes/") || bundle.includes("/AppTranslocation/")) return false;
		try {
			await stat(bundle);
			await access(path.dirname(bundle), fsConstants.W_OK);
			return true;
		} catch {
			return false;
		}
	}

	private async launchMacInstaller(workspace: string, dmg: string, version: string) {
		const bundle = this.options.bundlePath as string;
		const script = path.join(workspace, "install.sh");
		await writeFile(script, MAC_INSTALL_SCRIPT, { mode: 0o700 });
		const backup = `${bundle}.update-${randomUUID().slice(0, 8)}`;
		spawn(
			"/bin/bash",
			[script, dmg, path.join(workspace, "mount"), bundle, workspace, backup, String(process.pid), version],
			{ detached: true, stdio: "ignore" },
		).unref();
	}
}
