import { ArrowLeft, Check, ShieldCheck } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type MessageKey, t } from "@/lib/i18n";
import { DEFAULT_KEYMAP, bindingLabel, useKeymap } from "@/lib/keymap";
import { IS_MAC } from "@/lib/platform";
import appIcon from "@/assets/app-icon.svg";
import { Switch } from "../editor/ui";
import { Confetti } from "./Confetti";

type Step = "welcome" | "permission" | "done";

type OnboardingState = {
	platform: string;
	permission: string;
	shortcut: string;
	launchAtLogin: boolean;
};

const SPECTRUM = "linear-gradient(90deg, #FF5A7A, #FF9F43, #FFD43B, #38D9A9, #4DABF7, #9775FA)";

/** "⌘⇧X" → ["⌘", "⇧", "X"]; "Ctrl+Shift+X" → ["Ctrl", "Shift", "X"]. */
function shortcutKeys(label: string) {
	return label.includes("+") ? label.split("+") : [...label];
}

function Keycaps({ label, size = "lg" }: { label: string; size?: "lg" | "sm" }) {
	const large = size === "lg";
	return (
		<span className="inline-flex items-center gap-1.5" aria-label={label}>
			{shortcutKeys(label).map((key, index) => (
				<kbd
					key={`${key}-${index}`}
					className={`flex items-center justify-center rounded-[10px] border border-[var(--qs-border-strong)] bg-[var(--qs-panel-raised)] font-sans font-semibold text-[var(--qs-text)] shadow-[0_1px_0_var(--qs-border-strong),0_2px_6px_rgba(0,0,0,0.06)] ${
						large ? "h-12 min-w-12 px-3 text-[20px]" : "h-6 min-w-6 rounded-[6px] px-1.5 text-[12px]"
					}`}
				>
					{key}
				</kbd>
			))}
		</span>
	);
}

/** Small line drawings for the feature cards, in the interface's own colours. */
function FeatureArt({ kind }: { kind: "window" | "area" | "stitch" | "menubar" }) {
	const stroke = "var(--qs-text-3)";
	return (
		<svg width="56" height="40" viewBox="0 0 56 40" fill="none" aria-hidden="true">
			<defs>
				<linearGradient id={`ring-${kind}`} x1="0" y1="0" x2="56" y2="40" gradientUnits="userSpaceOnUse">
					<stop stopColor="#FF5A7A" />
					<stop offset="0.35" stopColor="#FFD43B" />
					<stop offset="0.65" stopColor="#38D9A9" />
					<stop offset="1" stopColor="#9775FA" />
				</linearGradient>
			</defs>
			{kind === "window" && (
				<>
					<rect x="9" y="7" width="38" height="27" rx="4" fill="var(--qs-panel-raised)" stroke={stroke} />
					<circle cx="14" cy="11.5" r="1.3" fill="#FF5F57" />
					<circle cx="18" cy="11.5" r="1.3" fill="#FEBC2E" />
					<circle cx="22" cy="11.5" r="1.3" fill="#28C840" />
					<rect x="6.5" y="4.5" width="43" height="32" rx="6" stroke={`url(#ring-${kind})`} strokeWidth="2.2" />
				</>
			)}
			{kind === "area" && (
				<>
					<rect x="5" y="5" width="46" height="30" rx="4" fill="var(--qs-field)" />
					<rect x="14" y="11" width="26" height="16" stroke={`url(#ring-${kind})`} strokeWidth="2" />
					<path d="M40 27l6 6m0 0v-4m0 4h-4" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
				</>
			)}
			{kind === "stitch" && (
				<>
					<rect x="12" y="3" width="32" height="15" rx="3" fill="var(--qs-panel-raised)" stroke={stroke} />
					<rect x="12" y="22" width="24" height="15" rx="3" fill="var(--qs-panel-raised)" stroke={stroke} />
					<path d="M44 26v8m-4-4h8" stroke={`url(#ring-${kind})`} strokeWidth="2.2" strokeLinecap="round" />
				</>
			)}
			{kind === "menubar" && (
				<>
					<rect x="3" y="8" width="50" height="10" rx="3" fill="var(--qs-field)" />
					<circle cx="38" cy="13" r="1.4" fill={stroke} />
					<circle cx="46" cy="13" r="1.4" fill={stroke} />
					<g stroke={`url(#ring-${kind})`} strokeWidth="1.6" strokeLinecap="round">
						<path d="M25 11v-1.4a1.4 1.4 0 0 1 1.4-1.4H28M32 8.2h1.6A1.4 1.4 0 0 1 35 9.6V11M35 15v1.4a1.4 1.4 0 0 1-1.4 1.4H32M28 17.8h-1.6a1.4 1.4 0 0 1-1.4-1.4V15" />
					</g>
					<circle cx="30" cy="13" r="1.5" fill="var(--qs-text-2)" />
					<rect x="19" y="21" width="26" height="15" rx="3.5" fill="var(--qs-panel-raised)" stroke={stroke} />
					<path d="M23 26h14M23 30.5h10" stroke={stroke} strokeLinecap="round" />
				</>
			)}
		</svg>
	);
}

function FeatureCard({
	art,
	title,
	detail,
}: {
	art: "window" | "area" | "stitch" | "menubar";
	title: string;
	detail: ReactNode;
}) {
	return (
		<div className="flex items-center gap-3 rounded-[12px] bg-[var(--qs-field)] p-3 shadow-[inset_0_0_0_1px_var(--qs-border)]">
			<span className="flex h-12 w-16 shrink-0 items-center justify-center rounded-[9px] bg-[var(--qs-panel)]">
				<FeatureArt kind={art} />
			</span>
			<span className="min-w-0">
				<span className="block text-[13px] font-semibold text-[var(--qs-text)]">{title}</span>
				<span className="mt-0.5 block text-[11.5px] leading-[1.45] text-[var(--qs-text-2)]">{detail}</span>
			</span>
		</div>
	);
}

function Button({
	children,
	onClick,
	primary = false,
	disabled = false,
}: {
	children: ReactNode;
	onClick: () => void;
	primary?: boolean;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={`qs-no-drag flex h-9 items-center gap-1.5 rounded-[10px] px-4 text-[13px] font-semibold transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--qs-select)] disabled:opacity-50 ${
				primary
					? "bg-[var(--qs-primary)] text-[var(--qs-primary-text)] shadow-[0_1px_2px_rgba(0,0,0,0.16)] hover:bg-[var(--qs-primary-hover)]"
					: "text-[var(--qs-text-2)] hover:bg-[var(--qs-hover)] hover:text-[var(--qs-text)]"
			}`}
		>
			{children}
		</button>
	);
}

function stepsFor(platform: string): Step[] {
	return platform === "darwin" ? ["welcome", "permission", "done"] : ["welcome", "done"];
}

export function Onboarding() {
	const api = window.electronAPI.onboarding;
	const keymap = useKeymap();
	const [state, setState] = useState<OnboardingState | null>(null);
	const [step, setStep] = useState<Step>(() => {
		const requested = new URLSearchParams(window.location.search).get("step");
		return requested === "permission" || requested === "done" ? requested : "welcome";
	});
	const [requested, setRequested] = useState(false);
	/** Permission granted while this process runs only works after a relaunch. */
	const grantedAtStartRef = useRef<boolean | null>(null);

	const refresh = useCallback(async () => {
		const next = await api?.getState();
		if (!next) return;
		if (grantedAtStartRef.current === null) grantedAtStartRef.current = next.permission === "granted";
		setState(next);
	}, [api]);

	useEffect(() => {
		void refresh();
		return api?.onStep((next) => {
			if (next === "welcome" || next === "permission" || next === "done") setStep(next);
		});
	}, [api, refresh]);

	// Follow the Screen Recording switch while its step is open.
	useEffect(() => {
		if (step !== "permission") return;
		const timer = window.setInterval(() => void refresh(), 1000);
		return () => window.clearInterval(timer);
	}, [refresh, step]);

	const platform = state?.platform ?? (IS_MAC ? "darwin" : "win32");
	const steps = useMemo(() => stepsFor(platform), [platform]);
	const index = Math.max(0, steps.indexOf(step));
	const shortcut = state?.shortcut ?? (IS_MAC ? "⌘⇧X" : "Ctrl+Shift+X");
	const granted = state?.permission === "granted";
	const needsRelaunch = granted && grantedAtStartRef.current === false;

	const go = (delta: 1 | -1) => setStep(steps[Math.min(steps.length - 1, Math.max(0, index + delta))]);
	const finish = (capture: boolean) => void api?.finish({ capture });

	return (
		<div className="flex h-screen flex-col bg-[var(--qs-panel)] text-[var(--qs-text)] select-none">
			{/* Room for the traffic lights, and a handle to move the window. */}
			<div className="qs-drag h-11 shrink-0" />

			<main className="flex min-h-0 flex-1 flex-col items-center px-14">
				{step === "welcome" && (
					<>
						<img src={appIcon} alt="" className="h-16 w-16 drop-shadow-[0_6px_14px_rgba(0,0,0,0.18)]" draggable={false} />
						<h1 className="mt-3 text-[24px] font-semibold tracking-[-0.01em]">{t("onboarding.welcome.title")}</h1>
						<p className="mt-1 text-[13px] text-[var(--qs-text-2)]">{t("onboarding.welcome.subtitle")}</p>
						<div className="mt-5 flex flex-col items-center gap-2">
							<Keycaps label={shortcut} />
							<span className="text-[12px] text-[var(--qs-text-3)]">{t("onboarding.welcome.shortcut")}</span>
						</div>
						<div className="mt-6 grid w-full grid-cols-2 gap-2.5">
							<FeatureCard art="window" title={t("onboarding.feature.window")} detail={t("onboarding.feature.windowDetail")} />
							<FeatureCard art="area" title={t("onboarding.feature.area")} detail={t("onboarding.feature.areaDetail")} />
							<FeatureCard
								art="stitch"
								title={t("onboarding.feature.stitch")}
								detail={t("onboarding.feature.stitchDetail", { shortcut: bindingLabel(keymap.stitch || DEFAULT_KEYMAP.stitch) })}
							/>
							<FeatureCard art="menubar" title={t(IS_MAC ? "onboarding.feature.menubar" : "onboarding.feature.tray")} detail={t("onboarding.feature.menubarDetail")} />
						</div>
					</>
				)}

				{step === "permission" && (
					<>
						<div className="relative mt-1 flex h-[88px] w-[300px] items-center gap-3 rounded-[16px] bg-[var(--qs-panel-raised)] px-5 shadow-[0_10px_30px_rgba(0,0,0,0.08),inset_0_0_0_1px_var(--qs-border)]">
							<img src={appIcon} alt="" className="h-10 w-10" draggable={false} />
							<span className="flex-1">
								<span className="block text-[13px] font-semibold">QuickShot</span>
								<span className="block text-[11px] text-[var(--qs-text-3)]">{t("onboarding.permission.rowCaption")}</span>
							</span>
							{/* A picture of the switch to turn on, mirroring System Settings. */}
							<span
								className={`relative h-[22px] w-[38px] rounded-full transition-colors duration-300 ${granted ? "bg-[#34C759]" : "bg-[var(--qs-switch-off)]"}`}
							>
								<span
									className={`absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.35)] transition-transform duration-300 ${granted ? "translate-x-[18px]" : "translate-x-[2px]"}`}
								/>
							</span>
							<span className="pointer-events-none absolute inset-x-6 -bottom-px h-[2px] rounded-full opacity-80" style={{ background: SPECTRUM }} />
						</div>
						<h1 className="mt-6 text-[22px] font-semibold tracking-[-0.01em]">{t("onboarding.permission.title")}</h1>
						<p className="mt-1.5 max-w-[560px] text-balance text-center text-[13px] leading-[1.55] text-[var(--qs-text-2)]">
							{t("onboarding.permission.detail")}
						</p>
						<span
							className={`mt-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold ${
								granted ? "bg-[rgba(52,199,89,0.14)] text-[#1F9D45]" : "bg-[rgba(255,159,67,0.16)] text-[#C26A12]"
							}`}
						>
							{granted ? <ShieldCheck size={14} strokeWidth={2.2} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
							{granted
								? needsRelaunch
									? t("onboarding.permission.grantedRelaunch")
									: t("onboarding.permission.granted")
								: t("onboarding.permission.notGranted")}
						</span>
						{!granted && (
							<ol className="mt-5 w-full max-w-[470px] space-y-2">
								{(["onboarding.permission.step1", "onboarding.permission.step2", "onboarding.permission.step3"] as MessageKey[]).map(
									(key, position) => (
										<li key={key} className="flex items-start gap-3 text-[12.5px] leading-[1.5] text-[var(--qs-text-2)]">
											<span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--qs-field)] text-[11px] font-semibold text-[var(--qs-text)] shadow-[inset_0_0_0_1px_var(--qs-border)]">
												{position + 1}
											</span>
											{t(key)}
										</li>
									),
								)}
							</ol>
						)}
						{!granted && requested && (
							<p className="mt-3 text-[11.5px] text-[var(--qs-text-3)]">{t("onboarding.permission.waiting")}</p>
						)}
					</>
				)}

				{step === "done" && (
					<>
						<Confetti />
						<span className="relative mt-2 flex h-16 w-16 animate-in zoom-in-50 fade-in items-center justify-center rounded-full duration-500">
							<span className="absolute inset-0 rounded-full p-[2.5px]" style={{ background: `conic-gradient(from 200deg, #FF5A7A, #FF9F43, #FFD43B, #38D9A9, #4DABF7, #9775FA, #FF5A7A)` }}>
								<span className="block h-full w-full rounded-full bg-[var(--qs-panel)]" />
							</span>
							<Check size={28} strokeWidth={2.4} className="relative" />
						</span>
						<h1 className="mt-4 text-[24px] font-semibold tracking-[-0.01em]">{t("onboarding.done.title")}</h1>
						<p className="mt-1 text-[13px] text-[var(--qs-text-2)]">{t("onboarding.done.subtitle")}</p>
						<div className="mt-3 flex items-center gap-2 text-[13px] text-[var(--qs-text-2)]">
							<Keycaps label={shortcut} size="sm" />
							<span>{t("onboarding.done.shortcut")}</span>
						</div>
						<ul className="mt-6 w-full max-w-[480px] divide-y divide-[var(--qs-border)] overflow-hidden rounded-[12px] bg-[var(--qs-field)] shadow-[inset_0_0_0_1px_var(--qs-border)]">
							{[
								t("onboarding.done.tip1", {
									copy: bindingLabel(keymap.copy || DEFAULT_KEYMAP.copy),
									save: bindingLabel(keymap.quickSave || DEFAULT_KEYMAP.quickSave),
									copyClose: bindingLabel(keymap.copyAndClose || DEFAULT_KEYMAP.copyAndClose),
								}),
								t("onboarding.done.tip2"),
								t(IS_MAC ? "onboarding.done.tip3" : "onboarding.done.tip3Tray"),
							].map((tip) => (
								<li key={tip} className="px-4 py-2.5 text-[12.5px] leading-[1.5] text-[var(--qs-text-2)]">
									{tip}
								</li>
							))}
							<li className="flex items-center justify-between px-4 py-2.5">
								<span className="text-[12.5px] text-[var(--qs-text)]">{t("onboarding.done.launchAtLogin")}</span>
								<Switch
									checked={Boolean(state?.launchAtLogin)}
									label={t("onboarding.done.launchAtLogin")}
									onChange={(enabled) => {
										void api?.setLaunchAtLogin(enabled).then((result) => {
											if (result.success) setState((current) => (current ? { ...current, launchAtLogin: Boolean(result.launchAtLogin) } : current));
										});
									}}
								/>
							</li>
						</ul>
					</>
				)}
			</main>

			<footer className="flex h-16 shrink-0 items-center justify-between border-t border-[var(--qs-border)] px-6">
				<div className="flex items-center gap-1.5" aria-label={t("onboarding.progress", { current: index + 1, total: steps.length })}>
					{steps.map((item) => (
						<span
							key={item}
							className="h-1.5 rounded-full transition-all duration-200"
							style={{
								width: item === step ? 18 : 6,
								background: item === step ? SPECTRUM : "var(--qs-border-strong)",
							}}
						/>
					))}
				</div>
				<div className="flex items-center gap-2">
					{index > 0 && (
						<Button onClick={() => go(-1)}>
							<ArrowLeft size={14} strokeWidth={2} />
							{t("onboarding.back")}
						</Button>
					)}
					{step === "welcome" && (
						<Button primary onClick={() => go(1)}>
							{t("onboarding.continue")}
						</Button>
					)}
					{step === "permission" &&
						(granted ? (
							needsRelaunch ? (
								<Button primary onClick={() => void api?.relaunch()}>
									{t("onboarding.permission.relaunch")}
								</Button>
							) : (
								<Button primary onClick={() => go(1)}>
									{t("onboarding.continue")}
								</Button>
							)
						) : (
							<>
								<Button onClick={() => go(1)}>{t("onboarding.later")}</Button>
								<Button
									primary
									onClick={() => {
										setRequested(true);
										void api?.requestPermission().then(() => refresh());
									}}
								>
									{t("onboarding.permission.open")}
								</Button>
							</>
						))}
					{step === "done" && (
						<>
							<Button onClick={() => finish(false)}>{t("onboarding.done.close")}</Button>
							<Button primary onClick={() => finish(true)}>
								{t("onboarding.done.capture")}
							</Button>
						</>
					)}
				</div>
			</footer>
		</div>
	);
}
