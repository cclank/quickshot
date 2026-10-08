export type GradientBlob = {
	/** Centre, relative to the canvas (0–1). */
	x: number;
	y: number;
	/** Radius, relative to the canvas diagonal. */
	r: number;
	color: string;
};

export type GradientPreset = {
	id: string;
	angle: number;
	stops: string[];
	blobs: GradientBlob[];
	/** Whether the gradient reads as light, for choosing watermark and UI contrast. */
	light?: boolean;
};

export const GRADIENT_PRESETS: GradientPreset[] = [
	{
		id: "sunset",
		angle: 135,
		stops: ["#FA709A", "#FEE140"],
		blobs: [
			{ x: 0.12, y: 0.1, r: 0.55, color: "rgba(255,255,255,0.22)" },
			{ x: 0.92, y: 0.95, r: 0.5, color: "rgba(255,120,80,0.28)" },
		],
	},
	{
		id: "aurora",
		angle: 160,
		stops: ["#0B1A2F", "#123B52", "#0F2027"],
		blobs: [
			{ x: 0.2, y: 0.15, r: 0.55, color: "rgba(56,249,215,0.34)" },
			{ x: 0.85, y: 0.25, r: 0.5, color: "rgba(122,162,255,0.36)" },
			{ x: 0.55, y: 0.95, r: 0.55, color: "rgba(215,150,255,0.26)" },
		],
	},
	{
		id: "ocean",
		angle: 135,
		stops: ["#4FACFE", "#00F2FE"],
		blobs: [
			{ x: 0.9, y: 0.1, r: 0.5, color: "rgba(255,255,255,0.2)" },
			{ x: 0.1, y: 0.9, r: 0.55, color: "rgba(44,90,255,0.3)" },
		],
	},
	{
		id: "grape",
		angle: 135,
		stops: ["#667EEA", "#764BA2"],
		blobs: [
			{ x: 0.85, y: 0.15, r: 0.5, color: "rgba(255,140,220,0.3)" },
			{ x: 0.1, y: 0.85, r: 0.5, color: "rgba(80,200,255,0.22)" },
		],
	},
	{
		id: "peach",
		angle: 135,
		stops: ["#FFECD2", "#FCB69F"],
		light: true,
		blobs: [
			{ x: 0.9, y: 0.9, r: 0.55, color: "rgba(255,138,128,0.32)" },
			{ x: 0.1, y: 0.1, r: 0.45, color: "rgba(255,255,255,0.45)" },
		],
	},
	{
		id: "mint",
		angle: 135,
		stops: ["#43E97B", "#38F9D7"],
		light: true,
		blobs: [
			{ x: 0.9, y: 0.9, r: 0.55, color: "rgba(30,120,255,0.24)" },
			{ x: 0.1, y: 0.1, r: 0.45, color: "rgba(255,255,255,0.3)" },
		],
	},
	{
		id: "lavender",
		angle: 135,
		stops: ["#A18CD1", "#FBC2EB"],
		light: true,
		blobs: [
			{ x: 0.15, y: 0.9, r: 0.5, color: "rgba(120,110,255,0.26)" },
			{ x: 0.9, y: 0.1, r: 0.45, color: "rgba(255,255,255,0.32)" },
		],
	},
	{
		id: "midnight",
		angle: 145,
		stops: ["#30CFD0", "#330867"],
		blobs: [
			{ x: 0.85, y: 0.9, r: 0.55, color: "rgba(255,80,180,0.24)" },
			{ x: 0.1, y: 0.1, r: 0.4, color: "rgba(255,255,255,0.14)" },
		],
	},
	{
		id: "rose",
		angle: 135,
		stops: ["#F093FB", "#F5576C"],
		blobs: [
			{ x: 0.1, y: 0.1, r: 0.5, color: "rgba(255,255,255,0.22)" },
			{ x: 0.9, y: 0.9, r: 0.5, color: "rgba(255,160,60,0.26)" },
		],
	},
	{
		id: "ember",
		angle: 125,
		stops: ["#FF9A8B", "#FF6A88", "#FF99AC"],
		blobs: [
			{ x: 0.85, y: 0.1, r: 0.5, color: "rgba(255,210,120,0.34)" },
			{ x: 0.1, y: 0.95, r: 0.55, color: "rgba(130,60,255,0.22)" },
		],
	},
	{
		id: "graphite",
		angle: 160,
		stops: ["#2B2D33", "#101114"],
		blobs: [
			{ x: 0.2, y: 0.1, r: 0.6, color: "rgba(120,150,255,0.16)" },
			{ x: 0.9, y: 0.9, r: 0.5, color: "rgba(255,255,255,0.06)" },
		],
	},
	{
		id: "cloud",
		angle: 160,
		stops: ["#F5F7FA", "#DDE4EE"],
		light: true,
		blobs: [
			{ x: 0.15, y: 0.1, r: 0.55, color: "rgba(160,190,255,0.3)" },
			{ x: 0.9, y: 0.9, r: 0.5, color: "rgba(255,200,220,0.28)" },
		],
	},
];

export const SOLID_COLORS = [
	"#0F172A",
	"#111113",
	"#1E293B",
	"#312E81",
	"#F5F5F0",
	"#FFFFFF",
	"#FDE68A",
	"#DCFCE7",
] as const;

export const WALLPAPER_COUNT = 12;

export type WallpaperAsset = {
	index: number;
	value: string;
	thumbnail: string;
};

export const WALLPAPERS: WallpaperAsset[] = Array.from(
	{ length: WALLPAPER_COUNT },
	(_, i) => ({
		index: i + 1,
		value: `wallpapers/wallpaper${i + 1}.jpg`,
		thumbnail: `wallpapers/thumbnails/wallpaper${i + 1}.jpg`,
	}),
);

export type BackgroundSpec =
	| { kind: "gradient"; preset: GradientPreset }
	| { kind: "wallpaper"; asset: WallpaperAsset }
	| { kind: "solid"; color: string }
	| { kind: "blur" }
	| { kind: "transparent" };

export function parseBackground(id: string): BackgroundSpec {
	if (id === "blur") return { kind: "blur" };
	if (id === "transparent") return { kind: "transparent" };
	const [kind, value = ""] = id.split(":");
	if (kind === "solid" && /^#[0-9a-f]{6}$/i.test(value)) {
		return { kind: "solid", color: value };
	}
	if (kind === "wallpaper") {
		const asset = WALLPAPERS.find((item) => String(item.index) === value);
		if (asset) return { kind: "wallpaper", asset };
	}
	const preset =
		GRADIENT_PRESETS.find((item) => item.id === value) ?? GRADIENT_PRESETS[0];
	return { kind: "gradient", preset };
}

export function isLightBackground(spec: BackgroundSpec): boolean {
	switch (spec.kind) {
		case "gradient":
			return Boolean(spec.preset.light);
		case "solid": {
			const value = Number.parseInt(spec.color.slice(1), 16);
			const r = (value >> 16) & 255;
			const g = (value >> 8) & 255;
			const b = value & 255;
			return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
		}
		default:
			return false;
	}
}
