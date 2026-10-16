import { contrastColor } from "@/editor/color";
import { getAnnotationBounds, getHandles, getVisualBounds } from "@/editor/annotations";
import {
	ANNOTATION_FONT_FAMILY,
	ANNOTATION_FONT_WEIGHT,
	measureTextAnnotation,
} from "@/editor/textLayout";
import type { Annotation, Point, TextAnnotation } from "@/editor/types";
import { t } from "@/lib/i18n";
import { useEffect, useRef } from "react";

export const ANNOTATION_HANDLE_RADIUS_CSS = 4.5;

/**
 * Selection and hover outlines drawn over a canvas, in the surface's CSS
 * pixels. `toCss` maps an image-space point into that surface, so the editor
 * stage and the capture overlay share one implementation.
 */
export function AnnotationSelectionOverlay({
	className,
	width,
	height,
	selected,
	hovered,
	toCss,
	scale,
	handleRadius = ANNOTATION_HANDLE_RADIUS_CSS,
}: {
	className?: string;
	width: number;
	height: number;
	selected: Annotation | null;
	hovered: Annotation | null;
	toCss: (point: Point) => Point;
	scale: number;
	handleRadius?: number;
}) {
	const outline = (annotation: Annotation, key: string, emphasis: boolean) => {
		if (annotation.kind === "arrow" || annotation.kind === "line") {
			const from = toCss(annotation.from);
			const to = toCss(annotation.to);
			return (
				<line
					key={key}
					x1={from.x}
					y1={from.y}
					x2={to.x}
					y2={to.y}
					stroke="var(--qs-select)"
					strokeOpacity={emphasis ? 0.9 : 0.55}
					strokeWidth={1}
					strokeDasharray={emphasis ? undefined : "3 3"}
				/>
			);
		}
		if (annotation.kind === "counter") {
			const center = toCss(annotation);
			return (
				<circle
					key={key}
					cx={center.x}
					cy={center.y}
					r={annotation.size * scale + 3}
					fill="none"
					stroke="var(--qs-select)"
					strokeOpacity={emphasis ? 0.95 : 0.6}
					strokeWidth={1.25}
				/>
			);
		}
		const bounds =
			annotation.kind === "text" || annotation.kind === "redact"
				? getAnnotationBounds(annotation, measureTextAnnotation)
				: getVisualBounds(annotation, measureTextAnnotation);
		const topLeft = toCss({ x: bounds.x, y: bounds.y });
		return (
			<rect
				key={key}
				x={topLeft.x - 0.5}
				y={topLeft.y - 0.5}
				width={bounds.w * scale + 1}
				height={bounds.h * scale + 1}
				fill="none"
				stroke="var(--qs-select)"
				strokeOpacity={emphasis ? 0.9 : 0.55}
				strokeWidth={1}
				strokeDasharray={emphasis ? undefined : "3 3"}
				rx={annotation.kind === "text" ? 3 : 0}
			/>
		);
	};

	return (
		<svg
			className={className ?? "pointer-events-none absolute left-0 top-0 overflow-visible"}
			width={width}
			height={height}
			aria-hidden="true"
		>
			{hovered && outline(hovered, `hover-${hovered.id}`, false)}
			{selected && (
				<g>
					{outline(selected, `sel-${selected.id}`, true)}
					{getHandles(selected, measureTextAnnotation).map((handle) => {
						const point = toCss(handle);
						return (
							<circle
								key={handle.id}
								cx={point.x}
								cy={point.y}
								r={handleRadius}
								fill="#fff"
								stroke="var(--qs-select)"
								strokeWidth={1.5}
								style={{ filter: "drop-shadow(0 1px 1.5px rgba(0,0,0,0.35))" }}
							/>
						);
					})}
				</g>
			)}
		</svg>
	);
}

/**
 * The in-place text field shown while a text annotation is being typed. It
 * sits in the surface's CSS pixels, and reports each change plus a finish.
 */
export function AnnotationTextEditor({
	annotation,
	left,
	top,
	scale,
	onChange,
	onFinish,
	className,
}: {
	annotation: TextAnnotation;
	left: number;
	top: number;
	scale: number;
	onChange: (text: string) => void;
	onFinish: () => void;
	className?: string;
}) {
	const ref = useRef<HTMLTextAreaElement>(null);
	const box = measureTextAnnotation(annotation);
	const pill = annotation.style === "pill";
	const textColor = pill ? contrastColor(annotation.color) : annotation.color;

	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		element.focus({ preventScroll: true });
		const end = element.value.length;
		element.setSelectionRange(end, end);
	}, []);

	return (
		<textarea
			ref={ref}
			value={annotation.text}
			spellCheck={false}
			autoCorrect="off"
			autoCapitalize="off"
			rows={1}
			wrap="off"
			aria-label={t("tool.text")}
			onChange={(event) => onChange(event.target.value)}
			onPointerDown={(event) => event.stopPropagation()}
			onDoubleClick={(event) => event.stopPropagation()}
			onKeyDown={(event) => {
				event.stopPropagation();
				const composing = event.nativeEvent.isComposing || event.keyCode === 229;
				if (composing) return;
				if ((event.key === "Enter" && !event.shiftKey) || event.key === "Escape") {
					event.preventDefault();
					onFinish();
				}
			}}
			onBlur={onFinish}
			className={className ?? "absolute z-10 m-0 resize-none overflow-hidden border-0 outline-none"}
			style={{
				left,
				top,
				// Leave room for the caret and the next glyph so the field never scrolls.
				width: box.w * scale + Math.max(12, annotation.size * scale * 0.9),
				height: box.h * scale,
				padding: `${box.padY * scale}px ${box.padX * scale}px`,
				font: `${ANNOTATION_FONT_WEIGHT} ${annotation.size * scale}px ${ANNOTATION_FONT_FAMILY}`,
				lineHeight: `${box.lineHeight * scale}px`,
				color: textColor,
				caretColor: textColor,
				whiteSpace: "pre",
				background: pill ? annotation.color : "transparent",
				borderRadius: pill ? Math.min(box.h / 2, annotation.size * 0.5) * scale : 3,
				boxShadow:
					"0 0 0 1px var(--qs-select), 0 0 0 4px color-mix(in srgb, var(--qs-select) 18%, transparent)",
				textShadow:
					annotation.style === "plain"
						? `0 ${annotation.size * 0.04 * scale}px ${annotation.size * 0.16 * scale}px rgba(0,0,0,0.38)`
						: annotation.style === "outline"
							? `0 0 ${Math.max(1, annotation.size * 0.1 * scale)}px ${contrastColor(annotation.color)}`
							: undefined,
			}}
		/>
	);
}