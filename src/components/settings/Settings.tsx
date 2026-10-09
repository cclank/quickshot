import { Check } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { type KeyPress, acceleratorFromKeyPress, keyFromCode } from "@/lib/accelerator";
import { type MessageKey, t } from "@/lib/i18n";
import {
	DEFAULT_KEYMAP,
	KEYMAP_COMMANDS,
	type KeymapCommand,
	bindingConflict,
	bindingFromKeyPress,
	bindingLabel,
	saveKeymap,
	useKeymap,
} from "@/lib/keymap";
import { IS_MAC, PLATFORM } from "@/lib/platform";
import { Switch } from "../editor/ui";

type GlobalKind = "capture" | "scrollCapture" | "restorePins";
/** What is being recorded: a global shortcut, or one inside QuickShot's windows. */
type Target = { scope: "global"; kind: GlobalKind } | { scope: "local"; command: KeymapCommand };

const targetId = (target: Target) => (target.scope === "global" ? `g:${target.kind}` : `l:${target.command}`);

const COMMAND_LABELS: Record<KeymapCommand, MessageKey> = {
	"tool.select": "tool.select",
	"tool.rect": "tool.rect",
	"tool.ellipse": "tool.ellipse",
	"tool.arrow": "tool.arrow",
	"tool.line": "tool.line",
	"tool.pen": "tool.pen",
	"tool.highlighter": "tool.highlighter",
	"tool.text": "tool.text",
	"tool.counter": "tool.counter",
	"tool.redact": "tool.redact",
	copy: "action.copyImage",
	copyAndClose: "action.copyAndClose",
	quickSave: "action.quickSave",
	saveAs: "action.saveAs",
	stitch: "action.stitch",
	ocr: "action.ocr",
	pin: "action.pin",
	duplicate: "action.duplicate",
	toggleInspector: "settings.toggleInspector",
	"overlay.scroll": "settings.overlayScroll",
};

const EDITOR_COMMANDS = KEYMAP_COMMANDS.filter((command) => !command.startsWith("overlay."));

/** "⌘⇧X" → ["⌘", "⇧", "X"]; "Ctrl+Shift+X" → ["Ctrl", "Shift", "X"]. */
function keysOf(label: string) {
	if (!IS_MAC) return label.split("+");
	// Multi-letter keys (Space, F12, Esc) stay whole.
	return label.match(/[⌘⌃⌥⇧↩⌫⌦⇥↑↓←→]|[^⌘⌃⌥⇧↩⌫⌦⇥↑↓←→]+/g) ?? [label];
}

function Keycaps({ label }: { label: string }) {
	return (
		<span className="inline-flex items-center gap-1">
			{keysOf(label).map((key, index) => (
				<kbd
					key={`${key}-${index}`}
					className="flex h-6 min-w-6 items-center justify-center rounded-[6px] border border-[var(--qs-border-strong)] bg-[var(--qs-panel-raised)] px-1.5 font-sans text-[12px] font-semibold text-[var(--qs-text)] shadow-[0_1px_0_var(--qs-border-strong)]"
				>
					{key}
				</kbd>
			))}
		</span>
	);
}

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
	return (
		<section className="mt-5">
			<div className="mb-1.5 flex items-center justify-between px-1">
				<h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--qs-text-3)]">{title}</h2>
				{action}
			</div>
			<div className="rounded-[12px] border border-[var(--qs-border)] bg-[var(--qs-panel-raised)] px-4">{children}</div>
		</section>
	);
}

function Row({ label, detail, children }: { label: string; detail?: ReactNode; children: ReactNode }) {
	return (
		<div className="border-b border-[var(--qs-border)] py-2.5 last:border-b-0">
			<div className="flex min-h-8 items-center gap-3">
				<span className="min-w-0 flex-1 text-[13px]">{label}</span>
				{children}
			</div>
			{detail}
		</div>
	);
}

function Segmented<T extends string>({
	value,
	options,
	onChange,
}: {
	value: T;
	options: { value: T; label: string }[];
	onChange: (value: T) => void;
}) {
	return (
		<div className="flex rounded-[8px] bg-[var(--qs-field)] p-0.5" role="radiogroup">
			{options.map((option) => (
				<button
					key={option.value}
					type="button"
					role="radio"
					aria-checked={value === option.value}
					onClick={() => onChange(option.value)}
					className={`h-7 rounded-[6px] px-3 text-[12px] font-medium transition-colors ${
						value === option.value
							? "bg-[var(--qs-panel-raised)] text-[var(--qs-text)] shadow-[0_1px_2px_rgba(0,0,0,0.12)]"
							: "text-[var(--qs-text-2)] hover:text-[var(--qs-text)]"
					}`}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}

function TextButton({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onClick}
			className="h-7 shrink-0 rounded-[6px] px-2 text-[12px] font-medium text-[var(--qs-accent)] hover:bg-[var(--qs-hover)] disabled:pointer-events-none disabled:opacity-35"
		>
			{label}
		</button>
	);
}

const FAILURES: Record<"network" | "download" | "checksum" | "location" | "install", MessageKey> = {
	network: "settings.updateFailed.network",
	download: "settings.updateFailed.download",
	checksum: "settings.updateFailed.checksum",
	location: "settings.updateFailed.location",
	install: "settings.updateFailed.install",
};

/** The version, the update status and the one action that fits it. */
function UpdateRow({
	update,
	api,
}: {
	update: SettingsState["update"];
	api: NonNullable<Window["electronAPI"]["settings"]>;
}) {
	const { state } = update;
	let status: string;
	let tone = "text-[var(--qs-text-3)]";
	if (state.kind === "checking") status = t("settings.updateChecking");
	else if (state.kind === "upToDate") status = t("settings.upToDate");
	else if (state.kind === "available") {
		status = t("settings.updateAvailable", { version: state.version });
		tone = "text-[var(--qs-accent)]";
	} else if (state.kind === "downloading")
		status = t("settings.updateDownloading", { percent: Math.round(state.progress * 100) });
	else if (state.kind === "installing") status = t("settings.updateInstalling");
	else if (state.kind === "failed") {
		status = t(FAILURES[state.reason]);
		tone = "text-[var(--qs-danger)]";
	} else status = update.localBuild ? t("settings.localBuild") : t("settings.autoUpdates");
	const busy = state.kind === "checking" || state.kind === "downloading" || state.kind === "installing";

	return (
		<Row
			label={t("settings.version", { version: update.version })}
			detail={
				<>
					<p className={`mt-1 text-[11.5px] ${tone}`}>{status}</p>
					{state.kind === "downloading" && (
						<div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--qs-field)]">
							<div
								className="h-full rounded-full bg-[var(--qs-accent)] transition-[width] duration-300"
								style={{ width: `${Math.round(state.progress * 100)}%` }}
							/>
						</div>
					)}
				</>
			}
		>
			{state.kind === "available" ? (
				<button
					type="button"
					onClick={() => void api.installUpdate()}
					className="h-8 rounded-[8px] bg-[var(--qs-primary)] px-3.5 text-[12px] font-semibold text-[var(--qs-primary-text)] hover:bg-[var(--qs-primary-hover)]"
				>
					{t("settings.updateNow")}
				</button>
			) : (
				<button
					type="button"
					disabled={busy}
					onClick={() => void api.checkUpdate()}
					className="h-8 rounded-[8px] border border-[var(--qs-border)] bg-[var(--qs-field)] px-3.5 text-[12px] font-medium text-[var(--qs-text)] hover:border-[var(--qs-border-strong)] disabled:opacity-45"
				>
					{t("settings.checkUpdates")}
				</button>
			)}
		</Row>
	);
}

/**
 * QuickShot's settings: every shortcut, recorded by pressing it, and the
 * choices that also live in the menu bar menu.
 */
export function Settings() {
	const api = window.electronAPI.settings;
	const keymap = useKeymap();
	const [state, setState] = useState<SettingsState | null>(null);
	const [recording, setRecording] = useState<Target | null>(null);
	const [held, setHeld] = useState("");
	const [errors, setErrors] = useState<Record<string, string | undefined>>({});
	const [saved, setSaved] = useState<string | null>(null);
	const recordingRef = useRef<Target | null>(null);
	const keymapRef = useRef(keymap);
	keymapRef.current = keymap;
	const savedTimerRef = useRef<number | null>(null);

	useEffect(() => {
		if (!api) return;
		void api.getState().then((next) => next && setState(next));
		return api.onChanged(setState);
	}, [api]);

	const flashSaved = useCallback((id: string) => {
		setErrors((current) => ({ ...current, [id]: undefined }));
		setSaved(id);
		if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current);
		savedTimerRef.current = window.setTimeout(() => setSaved(null), 1600);
	}, []);

	const stopRecording = useCallback(() => {
		if (recordingRef.current === null) return;
		recordingRef.current = null;
		setRecording(null);
		setHeld("");
		void api?.setRecording(false);
	}, [api]);

	const startRecording = (target: Target) => {
		recordingRef.current = target;
		setRecording(target);
		setHeld("");
		setErrors((current) => ({ ...current, [targetId(target)]: undefined }));
		void api?.setRecording(true);
	};

	const applyGlobal = useCallback(
		async (kind: GlobalKind, value: string | null) => {
			const result = await api?.setShortcut(kind, value);
			if (!result) return;
			if (result.state) setState(result.state);
			if (result.success) flashSaved(`g:${kind}`);
			else if (result.error) setErrors((current) => ({ ...current, [`g:${kind}`]: result.error }));
		},
		[api, flashSaved],
	);

	const applyLocal = useCallback(
		(command: KeymapCommand, binding: string): boolean => {
			const conflict = bindingConflict(keymapRef.current, command, binding);
			if (conflict) {
				setErrors((current) => ({
					...current,
					[`l:${command}`]:
						conflict.reason === "reserved"
							? t("settings.keyReserved")
							: t("settings.keyTaken", { name: t(COMMAND_LABELS[conflict.by]) }),
				}));
				return false;
			}
			saveKeymap({ ...keymapRef.current, [command]: binding });
			flashSaved(`l:${command}`);
			return true;
		},
		[flashSaved],
	);

	const handlePress = useCallback(
		(press: KeyPress & { type: "keyDown" | "keyUp" }) => {
			const target = recordingRef.current;
			if (!target) return;
			const global = acceleratorFromKeyPress(press, PLATFORM);
			setHeld(global.held);
			if (press.type !== "keyDown") return;
			if (press.code === "Escape" && !press.metaKey && !press.ctrlKey && !press.altKey && !press.shiftKey) {
				stopRecording();
				return;
			}
			if (target.scope === "global") {
				if (global.accelerator) {
					void applyGlobal(target.kind, global.accelerator).then(stopRecording);
				} else if (keyFromCode(press.code)) {
					// A key without ⌘/⌃/⌥ would take over typing in every app.
					setErrors((current) => ({ ...current, [targetId(target)]: t("settings.needsModifier") }));
				}
				return;
			}
			const binding = bindingFromKeyPress(press, PLATFORM);
			if (!binding) return;
			if (applyLocal(target.command, binding)) stopRecording();
		},
		[applyGlobal, applyLocal, stopRecording],
	);

	// Keys come from the main process, which holds them back from the menus;
	// without it (the UI fixture), from the page.
	useEffect(() => {
		if (api?.onKey) return api.onKey(handlePress);
		const listener = (event: KeyboardEvent) => {
			if (!recordingRef.current) return;
			event.preventDefault();
			handlePress({
				type: event.type === "keydown" ? "keyDown" : "keyUp",
				code: event.code,
				metaKey: event.metaKey,
				ctrlKey: event.ctrlKey,
				altKey: event.altKey,
				shiftKey: event.shiftKey,
			});
		};
		window.addEventListener("keydown", listener);
		window.addEventListener("keyup", listener);
		return () => {
			window.removeEventListener("keydown", listener);
			window.removeEventListener("keyup", listener);
		};
	}, [api, handlePress]);

	useEffect(() => {
		window.addEventListener("blur", stopRecording);
		return () => window.removeEventListener("blur", stopRecording);
	}, [stopRecording]);

	if (!state) return <div className="h-screen bg-[var(--qs-panel)]" />;
	const { shortcuts } = state;

	const field = (target: Target, label: string | null) => {
		const id = targetId(target);
		const active = recording !== null && targetId(recording) === id;
		return (
			<button
				type="button"
				onClick={() => (active ? stopRecording() : startRecording(target))}
				title={active ? undefined : t("settings.change")}
				className={`flex h-8 min-w-[132px] shrink-0 items-center justify-center rounded-[8px] border px-2.5 text-[12px] transition-colors ${
					active
						? "border-[var(--qs-accent)] bg-[var(--qs-panel)] text-[var(--qs-accent)] ring-2 ring-[var(--qs-ring)]"
						: "border-[var(--qs-border)] bg-[var(--qs-field)] text-[var(--qs-text-2)] hover:border-[var(--qs-border-strong)]"
				}`}
			>
				{active ? (
					held ? <Keycaps label={held} /> : t("settings.recording")
				) : saved === id ? (
					<span className="flex items-center gap-1.5 text-[var(--qs-success)]">
						<Check size={13} strokeWidth={2.4} />
						{label && <Keycaps label={label} />}
					</span>
				) : label ? (
					<Keycaps label={label} />
				) : (
					t("settings.notSet")
				)}
			</button>
		);
	};

	const errorLine = (id: string) =>
		errors[id] ? <p className="mt-1.5 text-right text-[11.5px] text-[var(--qs-danger)]">{errors[id]}</p> : null;

	const localRow = (command: KeymapCommand) => {
		const binding = keymap[command];
		const changed = binding !== DEFAULT_KEYMAP[command];
		return (
			<Row key={command} label={t(COMMAND_LABELS[command])} detail={errorLine(`l:${command}`)}>
				<TextButton
					label={t("settings.reset")}
					disabled={!changed}
					onClick={() => {
						if (applyLocal(command, DEFAULT_KEYMAP[command])) return;
						// The default went to another command meanwhile; leave this one empty.
						saveKeymap({ ...keymapRef.current, [command]: "" });
						setErrors((current) => ({ ...current, [`l:${command}`]: undefined }));
					}}
				/>
				{field({ scope: "local", command }, binding ? bindingLabel(binding) : null)}
			</Row>
		);
	};

	const editorChanged = EDITOR_COMMANDS.some((command) => keymap[command] !== DEFAULT_KEYMAP[command]);

	return (
		<div className="flex h-screen flex-col bg-[var(--qs-panel)] text-[var(--qs-text)] select-none">
			{/* Room for the traffic lights, and a handle to move the window. */}
			<div className="qs-drag h-11 shrink-0" />
			<main className="min-h-0 flex-1 overflow-y-auto px-7 pb-8">
				<h1 className="text-[20px] font-semibold tracking-[-0.01em]">{t("settings.title")}</h1>

				{state.update.supported && api && (
					<Card title={t("settings.about")}>
						<UpdateRow update={state.update} api={api} />
					</Card>
				)}

				<p className="mt-5 px-1 text-[11.5px] leading-[1.5] text-[var(--qs-text-3)]">
					{t(IS_MAC ? "settings.hintMac" : "settings.hintOther")}
				</p>
				<Card title={t("settings.globalShortcuts")}>
					<Row label={t("settings.capture")} detail={errorLine("g:capture")}>
						<TextButton
							label={t("settings.reset")}
							disabled={shortcuts.capture.isDefault}
							onClick={() => void applyGlobal("capture", null)}
						/>
						{field({ scope: "global", kind: "capture" }, shortcuts.capture.label)}
					</Row>
					{shortcuts.scrollAvailable && (
						<Row label={t("settings.scrollCapture")} detail={errorLine("g:scrollCapture")}>
							<TextButton
								label={t("settings.clear")}
								disabled={!shortcuts.scrollCapture}
								onClick={() => void applyGlobal("scrollCapture", null)}
							/>
							{field({ scope: "global", kind: "scrollCapture" }, shortcuts.scrollCapture?.label ?? null)}
						</Row>
					)}
					<Row
						label={t("settings.restorePins")}
						detail={
							<>
								<p className="mt-1 text-[11.5px] text-[var(--qs-text-3)]">{t("settings.restorePinsHint")}</p>
								{errorLine("g:restorePins")}
							</>
						}
					>
						<TextButton
							label={t("settings.reset")}
							disabled={shortcuts.restorePins.isDefault}
							onClick={() => void applyGlobal("restorePins", null)}
						/>
						{field({ scope: "global", kind: "restorePins" }, shortcuts.restorePins.label)}
					</Row>
				</Card>
				{!shortcuts.enabled && (
					<p className="mt-2 px-1 text-[11.5px] text-[var(--qs-text-3)]">{t("settings.shortcutsOff")}</p>
				)}

				<Card title={t("settings.selectionShortcuts")}>{localRow("overlay.scroll")}</Card>

				<Card
					title={t("settings.editorShortcuts")}
					action={
						<TextButton
							label={t("settings.resetAll")}
							disabled={!editorChanged}
							onClick={() =>
								saveKeymap({
									...DEFAULT_KEYMAP,
									"overlay.scroll": keymapRef.current["overlay.scroll"],
								})
							}
						/>
					}
				>
					{EDITOR_COMMANDS.map(localRow)}
				</Card>
				<p className="mt-2 px-1 text-[11.5px] leading-[1.5] text-[var(--qs-text-3)]">{t("settings.fixedKeys")}</p>

				<Card title={t("settings.general")}>
					<Row label={t("settings.language")}>
						<Segmented
							value={state.language}
							options={[
								{ value: "auto", label: t("settings.language.auto") },
								{ value: "zh", label: "简体中文" },
								{ value: "en", label: "English" },
							]}
							onChange={(language) => void api?.setLanguage(language).then((result) => result.state && setState(result.state))}
						/>
					</Row>
					{IS_MAC && (
						<Row
							label={t("settings.selection")}
							detail={
								<p className="mt-1 text-[11.5px] text-[var(--qs-text-3)]">
									{t(
										state.macCaptureMode === "overlay"
											? "settings.selection.overlayHint"
											: "settings.selection.systemHint",
									)}
								</p>
							}
						>
							<Segmented
								value={state.macCaptureMode}
								options={[
									{ value: "overlay", label: t("settings.selection.overlay") },
									{ value: "system", label: t("settings.selection.system") },
								]}
								onChange={(mode) => void api?.setCaptureMode(mode).then((result) => result.state && setState(result.state))}
							/>
						</Row>
					)}
					{state.launchAtLoginAvailable && (
						<Row label={t("settings.launchAtLogin")}>
							<Switch
								checked={state.launchAtLogin}
								label={t("settings.launchAtLogin")}
								onChange={(enabled) =>
									void api?.setLaunchAtLogin(enabled).then((result) => result.state && setState(result.state))
								}
							/>
						</Row>
					)}
				</Card>
			</main>
		</div>
	);
}
