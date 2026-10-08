import {
	Circle,
	Grid2X2,
	Highlighter,
	MousePointer2,
	MoveUpRight,
	PenLine,
	Slash,
	Square,
	Type,
	type LucideProps,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import type { Tool } from "@/editor/types";

type SvgProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: SvgProps) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.5}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			{...rest}
		>
			{children}
		</svg>
	);
}

export function CounterIcon(props: SvgProps) {
	return (
		<Svg {...props}>
			<circle cx="8" cy="8" r="6.25" />
			<path d="M7.1 6.2 8.4 5.3v5.4" />
		</Svg>
	);
}

export function FillNoneIcon(props: SvgProps) {
	return (
		<Svg {...props}>
			<rect x="2.75" y="3.75" width="10.5" height="8.5" rx="2" />
		</Svg>
	);
}

export function FillSoftIcon(props: SvgProps) {
	return (
		<Svg {...props}>
			<rect x="2.75" y="3.75" width="10.5" height="8.5" rx="2" fill="currentColor" fillOpacity={0.28} />
		</Svg>
	);
}

export function FillSolidIcon(props: SvgProps) {
	return (
		<Svg {...props}>
			<rect x="2.75" y="3.75" width="10.5" height="8.5" rx="2" fill="currentColor" />
		</Svg>
	);
}

export function TextPlainIcon(props: SvgProps) {
	return (
		<Svg {...props}>
			<path d="M4 4.5h8M8 4.5v7.5" />
		</Svg>
	);
}

export function TextPillIcon(props: SvgProps) {
	return (
		<Svg {...props} strokeWidth={1.4}>
			<rect x="1.5" y="3" width="13" height="10" rx="3" fill="currentColor" fillOpacity={0.9} stroke="none" />
			<path d="M5.5 6h5M8 6v4.5" stroke="var(--qs-bg)" />
		</Svg>
	);
}

export function TextOutlineIcon(props: SvgProps) {
	return (
		<Svg {...props}>
			<path d="M4 4.5h8M8 4.5v7.5" strokeWidth={3.2} strokeOpacity={0.35} />
			<path d="M4 4.5h8M8 4.5v7.5" />
		</Svg>
	);
}

export function PixelateIcon(props: SvgProps) {
	return (
		<Svg {...props} stroke="none">
			<rect x="2" y="2" width="4" height="4" rx="0.6" fill="currentColor" />
			<rect x="10" y="2" width="4" height="4" rx="0.6" fill="currentColor" fillOpacity={0.45} />
			<rect x="6" y="6" width="4" height="4" rx="0.6" fill="currentColor" fillOpacity={0.7} />
			<rect x="2" y="10" width="4" height="4" rx="0.6" fill="currentColor" fillOpacity={0.45} />
			<rect x="10" y="10" width="4" height="4" rx="0.6" fill="currentColor" />
		</Svg>
	);
}

export function BlurIcon(props: SvgProps) {
	return (
		<Svg {...props}>
			<circle cx="8" cy="8" r="5.5" strokeOpacity={0.35} />
			<circle cx="8" cy="8" r="3.2" strokeOpacity={0.7} />
			<circle cx="8" cy="8" r="1" fill="currentColor" />
		</Svg>
	);
}

type IconComponent = ComponentType<LucideProps> | ComponentType<SvgProps>;

export const TOOL_ICONS: Record<Tool, IconComponent> = {
	select: MousePointer2,
	rect: Square,
	ellipse: Circle,
	arrow: MoveUpRight,
	line: Slash,
	pen: PenLine,
	highlighter: Highlighter,
	text: Type,
	counter: CounterIcon,
	redact: Grid2X2,
};
