import { AlertCircle, Check } from "lucide-react";

export type ToastState = {
	id: number;
	tone: "success" | "error";
	title: string;
	detail?: string;
};

export function Toast({ toast }: { toast: ToastState }) {
	const success = toast.tone === "success";
	return (
		<div
			key={toast.id}
			role={success ? "status" : "alert"}
			aria-live={success ? "polite" : "assertive"}
			className="qs-toast pointer-events-none absolute bottom-10 left-1/2 z-50 flex max-w-[min(420px,80vw)] items-center gap-2.5 rounded-full bg-[var(--qs-float)] py-2 pl-2.5 pr-4 shadow-[var(--qs-shadow-float)] backdrop-blur-xl"
			style={{ transform: "translateX(-50%)" }}
		>
			<span
				className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
					success ? "bg-[var(--qs-success)]" : "bg-[var(--qs-danger)]"
				}`}
			>
				{success ? (
					<Check size={12} strokeWidth={3} className="text-white" />
				) : (
					<AlertCircle size={12} strokeWidth={2.5} className="text-white" />
				)}
			</span>
			<span className="min-w-0">
				<span className="text-[12.5px] font-semibold text-[var(--qs-text)]">{toast.title}</span>
				{toast.detail && (
					<span className="ml-2 truncate text-[12px] text-[var(--qs-text-2)]">{toast.detail}</span>
				)}
			</span>
		</div>
	);
}
