import {
	type ButtonHTMLAttributes,
	type CSSProperties,
	type ReactNode,
	forwardRef,
} from "react";

export function Tooltip({
	label,
	shortcut,
	side = "bottom",
}: {
	label: string;
	shortcut?: string;
	side?: "top" | "bottom";
}) {
	return (
		<span className="qs-tip" data-side={side} aria-hidden="true">
			{label}
			{shortcut && <span className="qs-kbd">{shortcut}</span>}
		</span>
	);
}

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
	label: string;
	shortcut?: string;
	active?: boolean;
	tipSide?: "top" | "bottom";
	size?: "sm" | "md";
	children: ReactNode;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
	function IconButton(
		{
			label,
			shortcut,
			active = false,
			tipSide = "bottom",
			size = "md",
			className = "",
			children,
			...rest
		},
		ref,
	) {
		const dimension = size === "sm" ? "h-7 w-7 rounded-[7px]" : "h-8 w-8 rounded-[9px]";
		return (
			<button
				ref={ref}
				type="button"
				aria-label={label}
				aria-pressed={rest["aria-pressed"] ?? (active || undefined)}
				className={`qs-tip-host qs-no-drag flex shrink-0 items-center justify-center ${dimension} transition-[background-color,color,box-shadow] duration-100 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--qs-select)] disabled:opacity-30 ${
					active
						? "bg-[var(--qs-active)] text-[var(--qs-text)]"
						: "text-[var(--qs-text-2)] hover:bg-[var(--qs-hover)] hover:text-[var(--qs-text)]"
				} ${className}`}
				{...rest}
			>
				{children}
				<Tooltip label={label} shortcut={shortcut} side={tipSide} />
			</button>
		);
	},
);

export function Divider({ vertical = true }: { vertical?: boolean }) {
	return vertical ? (
		<span className="mx-1 h-5 w-px shrink-0 bg-[var(--qs-border-strong)]" aria-hidden="true" />
	) : (
		<span className="my-1 h-px w-full bg-[var(--qs-border)]" aria-hidden="true" />
	);
}

export function Segmented<T extends string | number>({
	value,
	options,
	onChange,
	label,
	className = "",
}: {
	value: T;
	options: { value: T; label: string; icon?: ReactNode; shortcut?: string }[];
	onChange: (value: T) => void;
	label: string;
	className?: string;
}) {
	return (
		<div
			role="radiogroup"
			aria-label={label}
			className={`flex rounded-[9px] bg-[var(--qs-field)] p-[3px] ${className}`}
		>
			{options.map((option) => {
				const selected = option.value === value;
				return (
					<button
						key={String(option.value)}
						type="button"
						role="radio"
						aria-checked={selected}
						aria-label={option.icon ? option.label : undefined}
						onClick={() => onChange(option.value)}
						className={`qs-tip-host flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[7px] px-1 text-[12px] font-medium transition-[background-color,color,box-shadow] duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--qs-select)] ${
							selected
								? "bg-[var(--qs-panel-raised)] text-[var(--qs-text)] shadow-[0_1px_2px_rgba(0,0,0,0.12),0_0_0_0.5px_var(--qs-border-strong)]"
								: "text-[var(--qs-text-2)] hover:text-[var(--qs-text)]"
						}`}
					>
						{option.icon ?? option.label}
						{option.icon && <Tooltip label={option.label} shortcut={option.shortcut} />}
					</button>
				);
			})}
		</div>
	);
}

export function Slider({
	label,
	value,
	min,
	max,
	step = 1,
	onChange,
	format = (next) => String(next),
	onReset,
}: {
	label: string;
	value: number;
	min: number;
	max: number;
	step?: number;
	onChange: (value: number) => void;
	format?: (value: number) => string;
	onReset?: () => void;
}) {
	const fill = ((value - min) / Math.max(1, max - min)) * 100;
	return (
		<label className="block" onDoubleClick={onReset}>
			<span className="mb-1 flex items-center justify-between text-[12px]">
				<span className="text-[var(--qs-text-2)]">{label}</span>
				<span className="tabular-nums text-[var(--qs-text-3)]">{format(value)}</span>
			</span>
			<input
				type="range"
				className="qs-range"
				min={min}
				max={max}
				step={step}
				value={value}
				aria-label={label}
				aria-valuetext={format(value)}
				onChange={(event) => onChange(Number(event.target.value))}
				style={{ "--qs-fill": `${fill}%` } as CSSProperties}
			/>
		</label>
	);
}

export function Switch({
	checked,
	onChange,
	label,
}: {
	checked: boolean;
	onChange: (checked: boolean) => void;
	label: string;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			onClick={() => onChange(!checked)}
			className={`relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--qs-select)] ${
				checked ? "bg-[var(--qs-accent)]" : "bg-[var(--qs-switch-off)]"
			}`}
		>
			<span
				className={`absolute left-0 top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.4)] transition-transform duration-150 ${
					checked ? "translate-x-[14px]" : "translate-x-[2px]"
				}`}
			/>
		</button>
	);
}

export function Section({
	title,
	action,
	children,
}: {
	title: string;
	action?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className="border-b border-[var(--qs-border)] px-4 py-3.5 last:border-b-0">
			<header className="mb-2.5 flex h-5 items-center justify-between">
				<h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--qs-text-3)]">
					{title}
				</h3>
				{action}
			</header>
			{children}
		</section>
	);
}

export function Swatch({
	selected,
	label,
	style,
	onClick,
	className = "",
	children,
}: {
	selected: boolean;
	label: string;
	style?: CSSProperties;
	onClick: () => void;
	className?: string;
	children?: ReactNode;
}) {
	return (
		<button
			type="button"
			role="radio"
			aria-checked={selected}
			aria-label={label}
			title={label}
			onClick={onClick}
			className={`relative overflow-hidden rounded-[8px] bg-cover bg-center transition-[box-shadow,transform] duration-100 focus-visible:outline-none ${
				selected
					? "shadow-[0_0_0_2px_var(--qs-panel),0_0_0_3.5px_var(--qs-ring)]"
					: "shadow-[inset_0_0_0_1px_var(--qs-border)] hover:shadow-[0_0_0_2px_var(--qs-panel),0_0_0_3.5px_var(--qs-border-strong)] focus-visible:shadow-[0_0_0_2px_var(--qs-panel),0_0_0_3.5px_var(--qs-select)]"
			} ${className}`}
			style={style}
		>
			{children}
		</button>
	);
}
