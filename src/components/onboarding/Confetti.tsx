import { useEffect, useRef } from "react";

const COLORS = ["#FF5A7A", "#FF9F43", "#FFD43B", "#38D9A9", "#4DABF7", "#9775FA"];
const DURATION_MS = 3200;

type Piece = {
	x: number;
	y: number;
	vx: number;
	vy: number;
	size: number;
	color: string;
	angle: number;
	spin: number;
	wobble: number;
	wobbleSpeed: number;
	shape: "strip" | "dot";
};

/**
 * A short burst of confetti in QuickShot's spectrum, fired once from both
 * lower corners. It never takes clicks and skips itself when the system asks
 * for reduced motion.
 */
export function Confetti() {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		const context = canvas?.getContext("2d");
		if (!canvas || !context || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		const ratio = window.devicePixelRatio || 1;
		const width = window.innerWidth;
		const height = window.innerHeight;
		canvas.width = Math.round(width * ratio);
		canvas.height = Math.round(height * ratio);
		context.scale(ratio, ratio);

		const pieces: Piece[] = [];
		const launch = (fromLeft: boolean, count: number) => {
			for (let index = 0; index < count; index += 1) {
				// Up and inwards, spread over a fan of angles.
				const angle = (fromLeft ? -60 : -120) + (Math.random() - 0.5) * 50;
				const speed = 9 + Math.random() * 9;
				pieces.push({
					x: fromLeft ? -10 : width + 10,
					y: height * 0.78,
					vx: Math.cos((angle * Math.PI) / 180) * speed,
					vy: Math.sin((angle * Math.PI) / 180) * speed,
					size: 6 + Math.random() * 6,
					color: COLORS[Math.floor(Math.random() * COLORS.length)],
					angle: Math.random() * Math.PI,
					spin: (Math.random() - 0.5) * 0.3,
					wobble: Math.random() * Math.PI * 2,
					wobbleSpeed: 0.05 + Math.random() * 0.08,
					shape: Math.random() < 0.75 ? "strip" : "dot",
				});
			}
		};
		launch(true, 70);
		launch(false, 70);
		// A second, smaller pop a moment later.
		const second = window.setTimeout(() => {
			launch(true, 35);
			launch(false, 35);
		}, 260);

		const started = performance.now();
		let frame = 0;
		const draw = (now: number) => {
			const elapsed = now - started;
			context.clearRect(0, 0, width, height);
			const fade = elapsed > DURATION_MS - 700 ? Math.max(0, (DURATION_MS - elapsed) / 700) : 1;
			for (const piece of pieces) {
				piece.vy += 0.32;
				piece.vx *= 0.985;
				piece.vy *= 0.985;
				piece.wobble += piece.wobbleSpeed;
				piece.x += piece.vx + Math.sin(piece.wobble) * 0.8;
				piece.y += piece.vy;
				piece.angle += piece.spin;
				if (piece.y > height + 20) continue;
				context.save();
				context.globalAlpha = fade;
				context.translate(piece.x, piece.y);
				context.rotate(piece.angle);
				context.fillStyle = piece.color;
				if (piece.shape === "strip") {
					// Flipping paper: the strip narrows as it turns over.
					context.scale(1, Math.abs(Math.cos(piece.wobble)) * 0.8 + 0.2);
					context.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
				} else {
					context.beginPath();
					context.arc(0, 0, piece.size / 3, 0, Math.PI * 2);
					context.fill();
				}
				context.restore();
			}
			if (elapsed < DURATION_MS) {
				frame = requestAnimationFrame(draw);
			} else {
				context.clearRect(0, 0, width, height);
				canvas.width = 0;
				canvas.height = 0;
			}
		};
		frame = requestAnimationFrame(draw);
		return () => {
			window.clearTimeout(second);
			cancelAnimationFrame(frame);
		};
	}, []);

	return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none fixed inset-0 z-50 h-full w-full" />;
}
