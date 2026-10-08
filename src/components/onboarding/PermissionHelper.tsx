import { ArrowUp } from "lucide-react";
import appIcon from "@/assets/app-icon.svg";
import { t } from "@/lib/i18n";

const SPECTRUM = "conic-gradient(from 200deg, #FF5A7A, #FF9F43, #FFD43B, #38D9A9, #4DABF7, #9775FA, #FF5A7A)";

/**
 * Sits under System Settings while Screen Recording is off. Dragging the icon
 * drags QuickShot.app itself, which the Screen Recording list accepts.
 */
export function PermissionHelper() {
	return (
		<div className="flex h-screen items-center justify-center p-2 select-none">
			<div className="flex h-full w-full items-center gap-3.5 rounded-[18px] border border-white/10 bg-[rgba(28,28,30,0.94)] pl-3 pr-4 text-white shadow-[0_12px_32px_rgba(0,0,0,0.35)] backdrop-blur-xl">
				<span
					draggable
					onDragStart={(event) => {
						event.preventDefault();
						window.electronAPI.permissionHelper?.startDrag();
					}}
					title={t("permissionHelper.dragTitle")}
					className="relative flex h-[62px] w-[62px] shrink-0 cursor-grab items-center justify-center rounded-[16px] active:cursor-grabbing"
				>
					<span className="absolute inset-0 rounded-[16px] p-[2px]" style={{ background: SPECTRUM }}>
						<span className="block h-full w-full rounded-[14px] bg-[rgba(28,28,30,0.94)]" />
					</span>
					<img src={appIcon} alt="QuickShot" draggable={false} className="pointer-events-none relative h-12 w-12" />
				</span>
				<span className="min-w-0 flex-1">
					<span className="flex items-center gap-1.5 text-[13.5px] font-semibold">
						{t("permissionHelper.title")}
						<ArrowUp size={15} strokeWidth={2.4} className="text-[#4DABF7]" />
					</span>
					<span className="mt-0.5 block text-[11.5px] leading-[1.4] text-white/65">{t("permissionHelper.detail")}</span>
				</span>
			</div>
		</div>
	);
}
