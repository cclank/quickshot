import type { CompositionLayout } from "@/editor/composition";
import type { Rect } from "@/editor/types";

export function CropOverlay({ crop, layout, scale }: { crop: Rect | null; layout: CompositionLayout; scale: number }) {
	const image = layout.image;
	if (!crop) return null;
	const { x, y, w, h } = crop;
	const points = [[x, y], [x + w / 2, y], [x + w, y], [x + w, y + h / 2],
		[x + w, y + h], [x + w / 2, y + h], [x, y + h], [x, y + h / 2]];
	const handle = 7 / scale;
	return (
		<svg data-quickshot-crop-overlay aria-hidden="true" className="pointer-events-none absolute"
			style={{ left: image.x * scale, top: image.y * scale, width: image.w * scale, height: image.h * scale }}
			viewBox={`0 0 ${image.w} ${image.h}`}>
			<path d={`M0 0H${image.w}V${image.h}H0Z M${x} ${y}H${x + w}V${y + h}H${x}Z`} fill="rgba(0,0,0,0.5)" fillRule="evenodd" />
			<rect x={x} y={y} width={w} height={h} fill="none" stroke="white" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
			{[1, 2].map((third) => <g key={third} stroke="rgba(255,255,255,0.4)" strokeWidth={0.7}>
				<line x1={x + w * third / 3} x2={x + w * third / 3} y1={y} y2={y + h} vectorEffect="non-scaling-stroke" />
				<line x1={x} x2={x + w} y1={y + h * third / 3} y2={y + h * third / 3} vectorEffect="non-scaling-stroke" />
			</g>)}
			{points.map(([px, py], index) => <rect key={index} x={px - handle / 2} y={py - handle / 2}
				width={handle} height={handle} rx={1 / scale} fill="white" stroke="rgba(0,0,0,0.4)" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
		</svg>
	);
}
