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

export type TextExtractionResult = {
	text: string;
	lineCount: number;
};

export type TextExtractionPanelProps = {
	open: boolean;
	onClose: () => void;
	onExtract: () => Promise<TextExtractionResult>;
	onCopyText: (text: string) => Promise<void>;
	surface: CSSProperties;
	group: CSSProperties;
	primaryButton: CSSProperties;
	accent: string;
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
	surface,
	group,
	primaryButton,
	accent,
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

			setExtractError(errorMessage(error, "文字提取失败，请稍后重试。"));
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
			? "复制中…"
			: copyStatus === "success"
				? "已复制"
				: copyStatus === "error"
					? "重试复制"
					: "复制文字";

	return (
		<aside
			id="text-extraction-panel"
			data-quickshot-text-panel
			aria-labelledby="text-extraction-title"
			aria-describedby="text-extraction-description"
			aria-busy={status === "loading" || copyStatus === "copying"}
			className="relative z-20 my-2 mr-2.5 flex min-w-[250px] shrink-0 flex-col overflow-hidden rounded-[22px] border border-white/10 text-white"
			style={
				{
					...surface,
					width: "clamp(250px, 34vw, 340px)",
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
			<header className="flex shrink-0 items-start gap-3 border-b border-white/10 px-4 py-4">
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
						文本提取
					</h2>
					<p
						id="text-extraction-description"
						className="mt-1 text-[11px] leading-5 text-white/52"
					>
						识别原始截图，不含标注、背景和签名
					</p>
				</div>
				<button
					ref={closeButtonRef}
					type="button"
					onClick={onClose}
					className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white/58 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
					style={group}
					aria-label="关闭文本提取"
					title="关闭"
				>
					<X size={15} aria-hidden="true" />
				</button>
			</header>

			<div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
				{status === "idle" && (
					<div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
						<FileText
							size={30}
							className="text-white/42"
							aria-hidden="true"
						/>
						<div>
							<p className="text-sm font-medium">准备提取文字</p>
							<p className="mt-1 text-xs text-white/48">
								识别在本机完成
							</p>
						</div>
						<button
							type="button"
							onClick={() => void runExtraction()}
							className="rounded-xl px-4 py-2 text-xs font-semibold text-white transition-[filter,box-shadow] duration-150 ease-out hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 motion-reduce:transition-none"
							style={primaryButton}
						>
							开始提取
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
							<p className="text-sm font-medium">正在识别文字…</p>
							<p className="mt-1 text-xs text-white/48">
								较大的截图可能需要几秒
							</p>
						</div>
					</div>
				)}

				{status === "success" && (
					<>
						<div className="mb-2 flex shrink-0 items-center justify-between gap-3">
							<label
								htmlFor="text-extraction-result"
								className="text-xs font-semibold text-white/78"
							>
								识别结果
							</label>
							<span className="text-[11px] text-white/42">
								{lineCount} 行 · 可编辑
							</span>
						</div>
						<textarea
							ref={resultTextAreaRef}
							id="text-extraction-result"
							value={draftText}
							onChange={handleTextChange}
							spellCheck={false}
							className="min-h-[140px] flex-1 resize-none rounded-2xl p-3 text-[13px] leading-6 text-white outline-none select-text placeholder:text-white/30 focus:ring-1 focus:ring-white/25"
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
								className="flex h-10 items-center justify-center gap-2 rounded-xl px-3 text-xs font-medium text-white/72 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
								style={group}
								title="重新识别原始截图"
							>
								<RefreshCw size={14} aria-hidden="true" />
								重新提取
							</button>
							<button
								type="button"
								onClick={() => void handleCopy()}
								disabled={draftText.length === 0 || copyStatus === "copying"}
								className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-xs font-semibold text-white transition-[filter,box-shadow] duration-150 ease-out hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 motion-reduce:transition-none"
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
							className="text-white/38"
							aria-hidden="true"
						/>
						<div>
							<p className="text-sm font-medium">
								没有识别到文字
							</p>
							<p className="mt-1 max-w-[250px] text-xs leading-5 text-white/48">
								可以尝试包含更清晰、更大字号文字的截图
							</p>
						</div>
						<button
							type="button"
							onClick={() => void runExtraction()}
							className="flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold text-white transition-[filter,box-shadow] duration-150 ease-out hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 motion-reduce:transition-none"
							style={primaryButton}
						>
							<RefreshCw size={14} aria-hidden="true" />
							重新提取
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
							<p className="text-sm font-medium">文字提取失败</p>
							<p className="mt-1 max-w-[270px] text-xs leading-5 text-white/52">
								{extractError}
							</p>
							{draftText.trim().length > 0 && (
								<p className="mt-2 text-[11px] text-white/42">
									上次编辑的结果已保留
								</p>
							)}
						</div>
						<div className="flex flex-wrap items-center justify-center gap-2">
							{draftText.trim().length > 0 && (
								<button
									type="button"
									onClick={() => setStatus("success")}
									className="rounded-xl px-4 py-2 text-xs font-medium text-white/72 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
									style={group}
								>
									返回上次结果
								</button>
							)}
							<button
								type="button"
								onClick={() => void runExtraction()}
								className="flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold text-white transition-[filter,box-shadow] duration-150 ease-out hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 motion-reduce:transition-none"
								style={primaryButton}
							>
								<RefreshCw size={14} aria-hidden="true" />
								重试
							</button>
						</div>
					</div>
				)}
			</div>

			<div className="sr-only" aria-live="polite" aria-atomic="true">
				{copyStatus === "success"
					? "文字已复制到剪贴板"
					: copyStatus === "error"
						? "复制失败，请重试"
						: ""}
			</div>
		</aside>
	);
}
