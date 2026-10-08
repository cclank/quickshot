import { Check } from "lucide-react";
import { memo, type CSSProperties, type ReactNode } from "react";
import {
	GRADIENT_PRESETS,
	SOLID_COLORS,
	WALLPAPERS,
} from "@/editor/backgrounds";
import {
	ASPECT_RATIOS,
	DEFAULT_STYLE_SETTINGS,
	FRAME_STYLES,
	type FrameStyle,
	PADDING_RANGE,
	RADIUS_RANGE,
	SHADOW_RANGE,
	type StyleSettings,
	WATERMARK_FONTS,
	WATERMARK_OPACITY_RANGE,
	WATERMARK_SIZE_RANGE,
	WATERMARK_WEIGHTS,
	type WatermarkSettings,
} from "@/editor/composition";
import {
	AUTO_WATERMARK_COLOR,
	WATERMARK_FONT_STACKS,
	WATERMARK_PRESET_COLORS,
} from "@/editor/watermark";
import { t, type MessageKey } from "@/lib/i18n";
import { Section, Segmented, Slider, Swatch, Switch } from "./ui";

type InspectorProps = {
	settings: StyleSettings;
	onChange: (patch: Partial<StyleSettings>) => void;
	onWatermarkChange: (patch: Partial<WatermarkSettings>) => void;
	outputSize: { w: number; h: number };
	gradientThumbs: Record<string, string>;
	wallpaperThumbs: Record<string, string>;
	blurThumb: string;
	/** Whether the current style differs from the saved default. */
	canSaveDefault: boolean;
	/** What "reset" goes back to, or null when there is nothing to reset. */
	restoreTarget: "default" | "builtIn" | null;
	onSaveDefault: () => void;
	onRestoreDefault: () => void;
	/** Shown above the style sections while several captures are stitched. */
	stitchSection?: ReactNode;
};

const WEIGHT_CSS = { light: 300, regular: 500, bold: 700 } as const;

function SubLabel({ children }: { children: ReactNode }) {
	return (
		<div className="mb-1.5 mt-3 text-[11px] font-medium text-[var(--qs-text-3)] first:mt-0">
			{children}
		</div>
	);
}

function FramePreview({ style }: { style: FrameStyle }) {
	const image: CSSProperties = {
		background: "linear-gradient(135deg, #7aa2ff, #c084fc 60%, #f9a8d4)",
	};
	const dots = (
		<span className="flex gap-[2px]">
			<span className="h-[3px] w-[3px] rounded-full bg-[#ff5f57]" />
			<span className="h-[3px] w-[3px] rounded-full bg-[#febc2e]" />
			<span className="h-[3px] w-[3px] rounded-full bg-[#28c840]" />
		</span>
	);
	switch (style) {
		case "none":
			return <span className="block h-[22px] w-[34px] rounded-[3px] shadow-[0_2px_5px_rgba(0,0,0,0.3)]" style={image} />;
		case "classic":
			return (
				<span className="flex h-[28px] w-[40px] flex-col gap-[2px] rounded-[5px] bg-[#1d1f25] p-[3px] shadow-[0_2px_6px_rgba(0,0,0,0.4),inset_0_0_0_0.5px_rgba(255,255,255,0.25)]">
					{dots}
					<span className="block flex-1 rounded-[3px]" style={image} />
				</span>
			);
		case "glass":
			return (
				<span className="flex h-[28px] w-[40px] rounded-[6px] bg-white/30 p-[3px] shadow-[0_2px_6px_rgba(0,0,0,0.3),inset_0_0_0_0.5px_rgba(255,255,255,0.6)] backdrop-blur">
					<span className="block flex-1 rounded-[4px]" style={image} />
				</span>
			);
		case "macos-dark":
		case "macos-light":
		case "browser": {
			const light = style === "macos-light";
			return (
				<span
					className="flex h-[28px] w-[40px] flex-col overflow-hidden rounded-[4px] shadow-[0_2px_6px_rgba(0,0,0,0.3)]"
					style={{ boxShadow: `0 2px 6px rgba(0,0,0,0.4), inset 0 0 0 0.5px ${light ? "rgba(0,0,0,0.2)" : "rgba(255,255,255,0.25)"}` }}
				>
					<span
						className="flex items-center gap-[4px] px-[3px]"
						style={{
							height: style === "browser" ? 9 : 7,
							background: light ? "#ececee" : "#303136",
						}}
					>
						{dots}
						{style === "browser" && <span className="h-[3px] flex-1 rounded-full bg-white/20" />}
					</span>
					<span className="block flex-1" style={image} />
				</span>
			);
		}
	}
}

export const Inspector = memo(function Inspector({
	settings,
	onChange,
	onWatermarkChange,
	outputSize,
	gradientThumbs,
	wallpaperThumbs,
	blurThumb,
	canSaveDefault,
	restoreTarget,
	onSaveDefault,
	onRestoreDefault,
	stitchSection,
}: InspectorProps) {
	const { watermark } = settings;
	const background = settings.background;

	return (
		<aside
			data-quickshot-inspector
			aria-label={t("inspector.title")}
			className="flex w-[272px] shrink-0 flex-col border-l border-[var(--qs-border)] bg-[var(--qs-panel)]"
		>
			<div className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--qs-border)] px-4">
				<span className="text-[13px] font-semibold text-[var(--qs-text)]">{t("inspector.title")}</span>
				<label className="flex items-center gap-2 text-[12px] text-[var(--qs-text-2)]">
					{t("inspector.beautify")}
					<Switch
						checked={settings.beautify}
						onChange={(beautify) => onChange({ beautify })}
						label={t("inspector.beautify")}
					/>
				</label>
			</div>

			<div className="qs-scroll min-h-0 flex-1 overflow-y-auto">
				{stitchSection}
				{!settings.beautify ? (
					<p className="border-b border-[var(--qs-border)] px-4 py-3.5 text-[12px] leading-5 text-[var(--qs-text-3)]">
						{t("inspector.beautifyOff")}
					</p>
				) : (
					<>
						<Section title={t("inspector.background")}>
							<div role="radiogroup" aria-label={t("inspector.background")}>
								<SubLabel>{t("inspector.bg.smart")}</SubLabel>
								<div className="grid grid-cols-6 gap-1.5">
									<Swatch
										className="aspect-square"
										label={t("inspector.bg.blur")}
										selected={background === "blur"}
										onClick={() => onChange({ background: "blur" })}
										style={{ backgroundImage: blurThumb ? `url("${blurThumb}")` : undefined, backgroundColor: "#333" }}
									/>
									<Swatch
										className="qs-checker aspect-square"
										label={t("inspector.bg.transparent")}
										selected={background === "transparent"}
										onClick={() => onChange({ background: "transparent" })}
									/>
								</div>

								<SubLabel>{t("inspector.bg.gradients")}</SubLabel>
								<div className="grid grid-cols-6 gap-1.5">
									{GRADIENT_PRESETS.map((preset) => {
										const id = `gradient:${preset.id}`;
										return (
											<Swatch
												key={preset.id}
												className="aspect-square"
												label={`${t("inspector.bg.gradients")} ${preset.id}`}
												selected={background === id}
												onClick={() => onChange({ background: id })}
												style={{
													backgroundImage: gradientThumbs[preset.id]
														? `url("${gradientThumbs[preset.id]}")`
														: `linear-gradient(${preset.angle}deg, ${preset.stops.join(", ")})`,
												}}
											/>
										);
									})}
								</div>

								<SubLabel>{t("inspector.bg.solids")}</SubLabel>
								<div className="grid grid-cols-6 gap-1.5">
									{SOLID_COLORS.map((color) => {
										const id = `solid:${color}`;
										return (
											<Swatch
												key={color}
												className="aspect-square"
												label={`${t("inspector.bg.solids")} ${color}`}
												selected={background.toUpperCase() === id.toUpperCase()}
												onClick={() => onChange({ background: id })}
												style={{ background: color }}
											/>
										);
									})}
									<label
										className="relative aspect-square overflow-hidden rounded-[8px] shadow-[inset_0_0_0_1px_var(--qs-border)] focus-within:ring-2 focus-within:ring-[var(--qs-select)]"
										title={t("style.customColor")}
										style={{
											background:
												background.startsWith("solid:") &&
												!SOLID_COLORS.some((color) => `solid:${color}`.toUpperCase() === background.toUpperCase())
													? background.slice(6)
													: "conic-gradient(from 180deg, #ff3b30, #ffcc00, #34c759, #0a84ff, #af52de, #ff3b30)",
										}}
									>
										<input
											type="color"
											className="absolute inset-0 opacity-0"
											aria-label={t("style.customColor")}
											value={background.startsWith("solid:") ? background.slice(6) : "#1E293B"}
											onChange={(event) => onChange({ background: `solid:${event.target.value.toUpperCase()}` })}
										/>
									</label>
								</div>

								<SubLabel>{t("inspector.bg.wallpapers")}</SubLabel>
								<div className="grid grid-cols-4 gap-1.5">
									{WALLPAPERS.map((wallpaper) => {
										const id = `wallpaper:${wallpaper.index}`;
										const thumb = wallpaperThumbs[wallpaper.value];
										return (
											<Swatch
												key={wallpaper.value}
												className="aspect-[4/3]"
												label={`${t("inspector.bg.wallpapers")} ${wallpaper.index}`}
												selected={background === id}
												onClick={() => onChange({ background: id })}
												style={{
													backgroundColor: "var(--qs-field)",
													backgroundImage: thumb ? `url("${thumb}")` : undefined,
												}}
											/>
										);
									})}
								</div>
							</div>
						</Section>

						<Section title={t("inspector.layout")}>
							<div className="space-y-3">
								<Slider
									label={t("inspector.padding")}
									value={settings.padding}
									min={PADDING_RANGE.min}
									max={PADDING_RANGE.max}
									step={PADDING_RANGE.step}
									onChange={(padding) => onChange({ padding })}
									onReset={() => onChange({ padding: DEFAULT_STYLE_SETTINGS.padding })}
								/>
								<Slider
									label={t("inspector.radius")}
									value={settings.radius}
									min={RADIUS_RANGE.min}
									max={RADIUS_RANGE.max}
									step={RADIUS_RANGE.step}
									onChange={(radius) => onChange({ radius })}
									onReset={() => onChange({ radius: DEFAULT_STYLE_SETTINGS.radius })}
								/>
								<Slider
									label={t("inspector.shadow")}
									value={settings.shadow}
									min={SHADOW_RANGE.min}
									max={SHADOW_RANGE.max}
									step={SHADOW_RANGE.step}
									format={(value) => `${value}%`}
									onChange={(shadow) => onChange({ shadow })}
									onReset={() => onChange({ shadow: DEFAULT_STYLE_SETTINGS.shadow })}
								/>
								<div>
									<div className="mb-1.5 text-[12px] text-[var(--qs-text-2)]">{t("inspector.aspect")}</div>
									<Segmented
										label={t("inspector.aspect")}
										value={settings.aspect}
										onChange={(aspect) => onChange({ aspect })}
										options={ASPECT_RATIOS.map((aspect) => ({
											value: aspect,
											label: aspect === "auto" ? t("inspector.aspect.auto") : aspect,
										}))}
									/>
								</div>
							</div>
						</Section>

						<Section title={t("inspector.frame")}>
							<div role="radiogroup" aria-label={t("inspector.frame")} className="grid grid-cols-3 gap-1.5">
								{FRAME_STYLES.map((frame) => {
									const selected = settings.frame === frame;
									return (
										<button
											key={frame}
											type="button"
											role="radio"
											aria-checked={selected}
											onClick={() => onChange({ frame })}
											className={`flex h-[70px] flex-col items-center justify-center gap-1.5 rounded-[9px] text-[11px] transition-[background-color,box-shadow,color] duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--qs-select)] ${
												selected
													? "bg-[var(--qs-active)] text-[var(--qs-text)] shadow-[inset_0_0_0_1px_var(--qs-border-strong)]"
													: "bg-[var(--qs-field)] text-[var(--qs-text-2)] hover:bg-[var(--qs-hover)] hover:text-[var(--qs-text)]"
											}`}
										>
											<span
												className="flex h-[38px] w-[54px] items-center justify-center rounded-[6px]"
												style={{ background: "linear-gradient(135deg, #fbd3c0, #f6b8c8 55%, #c9c3f5)" }}
											>
												<FramePreview style={frame} />
											</span>
											{t(`frame.${frame}` as MessageKey)}
										</button>
									);
								})}
							</div>
						</Section>
					</>
				)}

				<Section
					title={t("inspector.signature")}
					action={
						<Switch
							checked={watermark.enabled}
							onChange={(enabled) => onWatermarkChange({ enabled })}
							label={t("inspector.signature")}
						/>
					}
				>
					<input
						type="text"
						value={watermark.text}
						maxLength={80}
						placeholder={t("inspector.signaturePlaceholder")}
						aria-label={t("inspector.signature")}
						onChange={(event) => {
							const text = event.target.value;
							onWatermarkChange({ text, enabled: text.trim().length > 0 });
						}}
						className="h-8 w-full rounded-[8px] bg-[var(--qs-field)] px-2.5 text-[12.5px] text-[var(--qs-text)] outline-none shadow-[inset_0_0_0_1px_var(--qs-border)] placeholder:text-[var(--qs-text-3)] focus:shadow-[inset_0_0_0_1px_var(--qs-select)]"
					/>
					<div className={`mt-2.5 ${watermark.enabled ? "" : "opacity-50"}`}>
						<Segmented
							label={t("inspector.signaturePlacement")}
							value={watermark.placement}
							onChange={(placement) => onWatermarkChange({ placement })}
							options={[
								{ value: "margin", label: t("inspector.placement.margin") },
								{ value: "image", label: t("inspector.placement.image") },
							]}
						/>
					</div>
					<div className={`mt-3.5 ${watermark.enabled ? "" : "opacity-50"}`}>
						<SubLabel>{t("inspector.signatureFont")}</SubLabel>
						<div
							role="radiogroup"
							aria-label={t("inspector.signatureFont")}
							className="grid grid-cols-5 gap-1.5"
						>
							{WATERMARK_FONTS.map((font) => {
								const selected = watermark.font === font;
								return (
									<button
										key={font}
										type="button"
										role="radio"
										aria-checked={selected}
										onClick={() => onWatermarkChange({ font })}
										className={`flex h-[48px] min-w-0 flex-col items-center justify-center gap-1 rounded-[8px] transition-[background-color,box-shadow,color] duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--qs-select)] ${
											selected
												? "bg-[var(--qs-active)] text-[var(--qs-text)] shadow-[inset_0_0_0_1px_var(--qs-border-strong)]"
												: "bg-[var(--qs-field)] text-[var(--qs-text-2)] hover:bg-[var(--qs-hover)] hover:text-[var(--qs-text)]"
										}`}
									>
										<span
											className="text-[17px] leading-none"
											style={{
												fontFamily: WATERMARK_FONT_STACKS[font].family,
												fontWeight: WEIGHT_CSS[watermark.weight],
											}}
										>
											Aa
										</span>
										<span className="max-w-full truncate px-0.5 text-[10px] leading-none">
											{t(`inspector.font.${font}` as MessageKey)}
										</span>
									</button>
								);
							})}
						</div>
						<div className="mt-2">
							<Segmented
								label={t("inspector.signatureWeight")}
								value={watermark.weight}
								onChange={(weight) => onWatermarkChange({ weight })}
								options={WATERMARK_WEIGHTS.map((weight) => ({
									value: weight,
									label: t(`inspector.weight.${weight}` as MessageKey),
								}))}
							/>
						</div>
						<div className="mt-3">
							<Slider
								label={t("inspector.signatureSize")}
								value={watermark.size}
								min={WATERMARK_SIZE_RANGE.min}
								max={WATERMARK_SIZE_RANGE.max}
								step={WATERMARK_SIZE_RANGE.step}
								format={(value) => `${value}%`}
								onChange={(size) => onWatermarkChange({ size })}
								onReset={() => onWatermarkChange({ size: DEFAULT_STYLE_SETTINGS.watermark.size })}
							/>
						</div>
						<SubLabel>{t("inspector.signatureColor")}</SubLabel>
					</div>
					<div
						role="radiogroup"
						aria-label={t("inspector.signatureColor")}
						className={`flex items-center gap-1.5 ${watermark.enabled ? "" : "opacity-50"}`}
					>
						<button
							type="button"
							role="radio"
							aria-checked={watermark.color === AUTO_WATERMARK_COLOR}
							onClick={() => onWatermarkChange({ color: AUTO_WATERMARK_COLOR })}
							className={`h-6 rounded-[6px] px-2 text-[11px] font-medium transition-colors ${
								watermark.color === AUTO_WATERMARK_COLOR
									? "bg-[var(--qs-active)] text-[var(--qs-text)] shadow-[inset_0_0_0_1px_var(--qs-border-strong)]"
									: "bg-[var(--qs-field)] text-[var(--qs-text-2)] hover:text-[var(--qs-text)]"
							}`}
						>
							{t("inspector.signatureAuto")}
						</button>
						{WATERMARK_PRESET_COLORS.map((color) => (
							<Swatch
								key={color}
								className="h-5 w-5 !rounded-full"
								label={`${t("inspector.signatureColor")} ${color}`}
								selected={watermark.color.toUpperCase() === color}
								onClick={() => onWatermarkChange({ color })}
								style={{ background: color }}
							/>
						))}
					</div>
					<div className={`mt-3 ${watermark.enabled ? "" : "opacity-50"}`}>
						<Slider
							label={t("inspector.signatureOpacity")}
							value={watermark.opacity}
							min={WATERMARK_OPACITY_RANGE.min}
							max={WATERMARK_OPACITY_RANGE.max}
							format={(value) => `${value}%`}
							onChange={(opacity) => onWatermarkChange({ opacity })}
							onReset={() => onWatermarkChange({ opacity: DEFAULT_STYLE_SETTINGS.watermark.opacity })}
						/>
					</div>
				</Section>
			</div>

			<div className="shrink-0 border-t border-[var(--qs-border)] px-3 pb-2.5 pt-2.5">
				<div className="flex gap-1.5">
					<button
						type="button"
						data-quickshot-action="restore-default"
						onClick={onRestoreDefault}
						disabled={!restoreTarget}
						title={
							restoreTarget === "builtIn"
								? t("inspector.restoreBuiltInHint")
								: t("inspector.restoreDefaultHint")
						}
						className="h-7 min-w-0 flex-1 truncate rounded-[8px] bg-[var(--qs-field)] px-2 text-[12px] font-medium text-[var(--qs-text-2)] shadow-[inset_0_0_0_1px_var(--qs-border)] transition-colors duration-100 hover:bg-[var(--qs-hover)] hover:text-[var(--qs-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--qs-select)] disabled:pointer-events-none disabled:opacity-45"
					>
						{restoreTarget === "builtIn" ? t("inspector.restoreBuiltIn") : t("inspector.restoreDefault")}
					</button>
					<button
						type="button"
						data-quickshot-action="save-default"
						onClick={onSaveDefault}
						disabled={!canSaveDefault}
						title={t("inspector.saveDefaultHint")}
						className="flex h-7 min-w-0 flex-1 items-center justify-center gap-1 truncate rounded-[8px] bg-[var(--qs-primary)] px-2 text-[12px] font-semibold text-[var(--qs-primary-text)] shadow-[0_1px_2px_rgba(0,0,0,0.14)] transition-colors duration-100 hover:bg-[var(--qs-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--qs-select)] disabled:bg-[var(--qs-field)] disabled:font-medium disabled:text-[var(--qs-text-3)] disabled:shadow-[inset_0_0_0_1px_var(--qs-border)]"
					>
						{canSaveDefault ? (
							t("inspector.saveDefault")
						) : (
							<>
								<Check size={13} strokeWidth={2.25} />
								{t("inspector.isDefault")}
							</>
						)}
					</button>
				</div>
				<div className="mt-2 flex items-center justify-between px-1 text-[11px] tabular-nums text-[var(--qs-text-3)]">
					<span>{t("inspector.output", { w: outputSize.w, h: outputSize.h })}</span>
					<span>PNG</span>
				</div>
			</div>
		</aside>
	);
});
