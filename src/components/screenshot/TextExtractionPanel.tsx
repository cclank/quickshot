import {
	AlertCircle,
	Check,
	Copy,
	FileText,
	LoaderCircle,
	RefreshCw,
	ScanText,
	X,
} from "lucide-react";
import {
	type CSSProperties,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { t } from "@/lib/i18n";

const surface: CSSProperties = { background: "var(--qs-panel)" };
const group: CSSProperties = {
	background: "var(--qs-field)",
	boxShadow: "inset 0 0 0 1px var(--qs-border)",
};
const primaryButton: CSSProperties = {
	background: "var(--qs-primary)",
	color: "var(--qs-primary-text)",
	boxShadow: "0 1px 2px rgba(0,0,0,0.16)",
};
const accent = "var(--qs-accent)";

export type TextExtractionResult = {
	text: string;
	lineCount: number;
};

export type TextExtractionPanelProps = {
	open: boolean;
	onClose: () => void;
	onExtract: () => Promise<TextExtractionResult>;
	onCopyText: (text: string) => Promise<void>;
};

type ExtractionStatus =
	| "idle"
	| "loading"
	| "success"
	| "empty"
	| "error";
type CopyStatus = "idle" | "copying" | "success" | "error";

function errorMessage(error: unknown, fallback: string) {
	if (error instanceof Error && error.message.trim()) {
		return error.message;
	}

	return fallback;
}

export function TextExtractionPanel({
	open,
	onClose,
	onExtract,
	onCopyText,
}: TextExtractionPanelProps) {
	const [status, setStatus] = useState<ExtractionStatus>("idle");
	const [draftText, setDraftText] = useState("");
	const [lineCount, setLineCount] = useState(0);
	const [extractError, setExtractError] = useState("");
	const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");

	const hasStartedRef = useRef(false);
	const extractRequestIdRef = useRef(0);
	const copyRequestIdRef = useRef(0);
	const closeButtonRef = useRef<HTMLButtonElement>(null);
	const resultTextAreaRef = useRef<HTMLTextAreaElement>(null);
	const focusResultOnSuccessRef = useRef(false);
	const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);

	const clearCopyResetTimer = useCallback(() => {
		if (copyResetTimerRef.current !== null) {
			clearTimeout(copyResetTimerRef.current);
			copyResetTimerRef.current = null;
		}
	}, []);

	const runExtraction = useCallback(async () => {
		const requestId = ++extractRequestIdRef.current;
		copyRequestIdRef.current += 1;
		clearCopyResetTimer();
		setStatus("loading");
		setExtractError("");
		setCopyStatus("idle");

		try {
			const result = await onExtract();
			if (requestId !== extractRequestIdRef.current) {
				return;
			}

			const text = typeof result.text === "string" ? result.text : "";
			const fallbackLineCount =
				text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length;
			const nextLineCount =
				Number.isSafeInteger(result.lineCount) && result.lineCount >= 0
					? result.lineCount
					: fallbackLineCount;

			setDraftText(text);
			setLineCount(nextLineCount);
			setStatus(text.trim().length > 0 ? "success" : "empty");
		} catch (error) {
			if (requestId !== extractRequestIdRef.current) {
				return;
			}

			setExtractError(errorMessage(error, t("ocr.failedFallback")));
			setStatus("error");
		}
	}, [clearCopyResetTimer, onExtract]);

	useEffect(() => {
		if (!open || hasStartedRef.current) {
			return;
		}

		hasStartedRef.current = true;
		void runExtraction();
	}, [open, runExtraction]);

	useEffect(() => {
		if (!open) return;
		focusResultOnSuccessRef.current = true;
		const frame = window.requestAnimationFrame(() => {
			closeButtonRef.current?.focus();
		});
		return () => window.cancelAnimationFrame(frame);
	}, [open]);

	useEffect(() => {
		if (status !== "success" || !focusResultOnSuccessRef.current) return;
		focusResultOnSuccessRef.current = false;
		const frame = window.requestAnimationFrame(() => {
			if (document.activeElement === closeButtonRef.current) {
				resultTextAreaRef.current?.focus();
			}
		});
		return () => window.cancelAnimationFrame(frame);
	}, [status]);

	useEffect(
		() => () => {
			extractRequestIdRef.current += 1;
			copyRequestIdRef.current += 1;
			clearCopyResetTimer();
		},
		[clearCopyResetTimer],
	);

	const handleCopy = useCallback(async () => {
		if (draftText.length === 0 || copyStatus === "copying") {
			return;
		}

		const requestId = ++copyRequestIdRef.current;
		clearCopyResetTimer();
		setCopyStatus("copying");

		try {
			await onCopyText(draftText);
			if (requestId !== copyRequestIdRef.current) {
				return;
			}

			setCopyStatus("success");
			copyResetTimerRef.current = setTimeout(() => {
				if (requestId === copyRequestIdRef.current) {
					setCopyStatus("idle");
				}
				copyResetTimerRef.current = null;
			}, 1800);
		} catch {
			if (requestId === copyRequestIdRef.current) {
				setCopyStatus("error");
			}
		}
	}, [
		clearCopyResetTimer,
		copyStatus,
		draftText,
		onCopyText,
	]);

	const handleTextChange = useCallback(
		(event: React.ChangeEvent<HTMLTextAreaElement>) => {
			const nextText = event.target.value;
			copyRequestIdRef.current += 1;
			clearCopyResetTimer();
			setDraftText(nextText);
			setLineCount(
				nextText.length === 0
					? 0
					: nextText.split(/\r\n|\r|\n/).length,
			);
			setCopyStatus("idle");
		},
		[clearCopyResetTimer],
	);

	if (!open) {
		return null;
	}

	const copyLabel =
		copyStatus === "copying"
			? t("ocr.copying")
			: copyStatus === "success"
				? t("ocr.copied")
				: copyStatus === "error"
					? t("ocr.copyRetry")
					: t("ocr.copy");

	return (
		<aside
			id="text-extraction-panel"
			data-quickshot-text-panel
			aria-labelledby="text-extraction-title"
			aria-describedby="text-extraction-description"
			aria-busy={status === "loading" || copyStatus === "copying"}
			className="relative z-20 flex min-w-[250px] shrink-0 flex-col overflow-hidden border-l border-[var(--qs-border)] text-[var(--qs-text)]"
			style={
				{
					...surface,
					width: "clamp(260px, 28vw, 320px)",
					WebkitAppRegion: "no-drag",
				} as CSSProperties
			}
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.stopPropagation();
					onClose();
				}
			}}
		>
			<header className="flex shrink-0 items-start gap-3 border-b border-[var(--qs-border)] px-4 py-3.5">
				<div
					className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
					style={{ ...group, color: accent }}
				>
					<ScanText size={18} aria-hidden="true" />
				</div>
				<div className="min-w-0 flex-1">
					<h2
						id="text-extraction-title"
						className="text-sm font-semibold tracking-[0.02em]"
					>
						{t("ocr.title")}
					</h2>
					<p
						id="text-extraction-description"
						className="mt-1 text-[11px] leading-5 text-[var(--qs-text-3)]"
					>
						{t("ocr.description")}
					</p>
				</div>
				<button
					ref={closeButtonRef}
					type="button"
					onClick={onClose}
					className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[var(--qs-text-2)] transition-colors hover:text-[var(--qs-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--qs-select)]"
					style={group}
					aria-label={t("ocr.close")}
					title={t("action.close")}
				>
					<X size={15} aria-hidden="true" />
				</button>
			</header>

			<div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
				{status === "idle" && (
					<div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
						<FileText
							size={30}
							className="text-[var(--qs-text-3)]"
							aria-hidden="true"
						/>
						<div>
							<p className="text-sm font-medium">{t("ocr.ready")}</p>
							<p className="mt-1 text-xs text-[var(--qs-text-3)]">
								{t("ocr.local")}
							</p>
						</div>
						<button
							type="button"
							onClick={() => void runExtraction()}
							className="rounded-xl px-4 py-2 text-xs font-semibold transition-[filter,box-shadow] duration-150 ease-out hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--qs-select)] motion-reduce:transition-none"
							style={primaryButton}
						>
							{t("ocr.start")}
						</button>
					</div>
				)}

				{status === "loading" && (
					<div
						role="status"
						aria-live="polite"
						className="flex flex-1 flex-col items-center justify-center gap-3 text-center"
					>
						<LoaderCircle
							size={28}
							className="animate-spin"
							style={{ color: accent }}
							aria-hidden="true"
						/>
						<div>
							<p className="text-sm font-medium">{t("ocr.loading")}</p>
							<p className="mt-1 text-xs text-[var(--qs-text-3)]">
								{t("ocr.loadingDetail")}
							</p>
						</div>
					</div>
				)}

				{status === "success" && (
					<>
						<div className="mb-2 flex shrink-0 items-center justify-between gap-3">
							<label
								htmlFor="text-extraction-result"
								className="text-xs font-semibold text-[var(--qs-text-2)]"
							>
								{t("ocr.result")}
							</label>
							<span className="text-[11px] text-[var(--qs-text-3)]">
								{t("ocr.lines", { count: lineCount })}
							</span>
						</div>
						<textarea
							ref={resultTextAreaRef}
							id="text-extraction-result"
							value={draftText}
							onChange={handleTextChange}
							spellCheck={false}
							className="min-h-[140px] flex-1 resize-none rounded-2xl p-3 text-[13px] leading-6 text-[var(--qs-text)] outline-none select-text placeholder:text-[var(--qs-text-3)] focus:ring-1 focus:ring-[var(--qs-border-strong)]"
							style={{
								...group,
								caretColor: accent,
								userSelect: "text",
							}}
						/>
						<div className="mt-3 flex shrink-0 items-center gap-2">
							<button
								type="button"
								onClick={() => void runExtraction()}
								className="flex h-10 items-center justify-center gap-2 rounded-xl px-3 text-xs font-medium text-[var(--qs-text-2)] transition-colors hover:text-[var(--qs-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--qs-select)]"
								style={group}
								title={t("ocr.again")}
							>
								<RefreshCw size={14} aria-hidden="true" />
								{t("ocr.again")}
							</button>
							<button
								type="button"
								onClick={() => void handleCopy()}
								disabled={draftText.length === 0 || copyStatus === "copying"}
								className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-xs font-semibold transition-[filter,box-shadow] duration-150 ease-out hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--qs-select)] motion-reduce:transition-none"
								style={primaryButton}
							>
								{copyStatus === "copying" ? (
									<LoaderCircle
										size={14}
										className="animate-spin"
										aria-hidden="true"
									/>
								) : copyStatus === "success" ? (
									<Check size={14} aria-hidden="true" />
								) : (
									<Copy size={14} aria-hidden="true" />
								)}
								{copyLabel}
							</button>
						</div>
					</>
				)}

				{status === "empty" && (
					<div
						role="status"
						aria-live="polite"
						className="flex flex-1 flex-col items-center justify-center gap-4 text-center"
					>
						<FileText
							size={30}
							className="text-[var(--qs-text-3)]"
							aria-hidden="true"
						/>
						<div>
							<p className="text-sm font-medium">
								{t("ocr.empty")}
							</p>
							<p className="mt-1 max-w-[250px] text-xs leading-5 text-[var(--qs-text-3)]">
								{t("ocr.emptyDetail")}
							</p>
						</div>
						<button
							type="button"
							onClick={() => void runExtraction()}
							className="flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-[filter,box-shadow] duration-150 ease-out hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--qs-select)] motion-reduce:transition-none"
							style={primaryButton}
						>
							<RefreshCw size={14} aria-hidden="true" />
							{t("ocr.again")}
						</button>
					</div>
				)}

				{status === "error" && (
					<div
						role="alert"
						aria-live="assertive"
						className="flex flex-1 flex-col items-center justify-center gap-4 text-center"
					>
						<AlertCircle
							size={30}
							className="text-red-300"
							aria-hidden="true"
						/>
						<div>
							<p className="text-sm font-medium">{t("ocr.failed")}</p>
							<p className="mt-1 max-w-[270px] text-xs leading-5 text-[var(--qs-text-3)]">
								{extractError}
							</p>
							{draftText.trim().length > 0 && (
								<p className="mt-2 text-[11px] text-[var(--qs-text-3)]">
									{t("ocr.keptDraft")}
								</p>
							)}
						</div>
						<div className="flex flex-wrap items-center justify-center gap-2">
							{draftText.trim().length > 0 && (
								<button
									type="button"
									onClick={() => setStatus("success")}
									className="rounded-xl px-4 py-2 text-xs font-medium text-[var(--qs-text-2)] transition-colors hover:text-[var(--qs-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--qs-select)]"
									style={group}
								>
									{t("ocr.backToDraft")}
								</button>
							)}
							<button
								type="button"
								onClick={() => void runExtraction()}
								className="flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-[filter,box-shadow] duration-150 ease-out hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--qs-select)] motion-reduce:transition-none"
								style={primaryButton}
							>
								<RefreshCw size={14} aria-hidden="true" />
								{t("ocr.retry")}
							</button>
						</div>
					</div>
				)}
			</div>

			<div className="sr-only" aria-live="polite" aria-atomic="true">
				{copyStatus === "success"
					? t("ocr.copiedLive")
					: copyStatus === "error"
						? t("ocr.copyFailedLive")
						: ""}
			</div>
		</aside>
	);
}
