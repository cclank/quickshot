import type { Language } from "./appSettings";

let currentLanguage: Language = "zh";

export function setMainLanguage(language: Language) {
	currentLanguage = language;
}

export function getMainLanguage() {
	return currentLanguage;
}

const zh = {
	"trayHint.title": "QuickShot 在这里",
	"trayHint.detail": "按 {shortcut} 截图，点击图标打开菜单",
	"menuBarHidden.title": "QuickShot 正在运行，但菜单栏图标被隐藏了",
	"menuBarHidden.detail":
		"随时按 {shortcut} 就能截图。想让图标显示在菜单栏，请在“系统设置 → 菜单栏”的“允许在菜单栏中显示”里打开 QuickShot。",
	"menuBarHidden.openSettings": "打开菜单栏设置",
	"menuBarHidden.ok": "好",
	"tray.capture": "截图",
	"tray.scrollCapture": "滚动截图",
	"tray.captureMode": "选区方式",
	"tray.captureMode.system": "系统选区（支持空格切换窗口）",
	"tray.captureMode.overlay": "QuickShot 选区（悬停识别窗口）",
	"tray.launchAtLogin": "登录时启动",
	"tray.settings": "设置…",
	"tray.checkUpdates": "检查更新…",
	"tray.updateAvailable": "更新到 v{version}…",
	"tray.updateDownloading": "正在下载更新 {percent}%",
	"tray.updateInstalling": "正在安装更新…",
	"tray.guide": "使用指南与权限…",
	"tray.repairShortcut": "修复快捷键",
	"tray.diagnostics": "打开诊断日志",
	"tray.pinned": "悬浮截图（{count}/{max}）",
	"tray.restorePinned": "恢复悬浮截图操作（{shortcut}）",
	"tray.closePinned": "关闭所有悬浮截图",
	"tray.quit": "退出 QuickShot",
	"tray.language": "语言 Language",
	"tray.language.auto": "跟随系统",
	"tray.tooltipShortcutFailed": "QuickShot · 快捷键注册失败，请点击菜单栏图标截图",
	"dialog.saveTitle": "保存截图",
	"dialog.pngFilter": "PNG 图片",
	"ocr.unsupported": "当前系统暂不支持文字提取",
	"ocr.busy": "正在提取文字，请稍候",
	"ocr.failed": "没有成功提取文字，请重试",
	"ocr.timeout": "文字提取超时，请缩小截图范围后重试",
	"ocr.cancelled": "文字提取已取消",
	"ocr.helperMissing": "文字提取组件不可用，请重新安装 QuickShot",
	"ocr.noLanguage": "未找到可用的识别语言，请在 Windows 设置中添加语言包",
	"ocr.tooLarge": "截图尺寸过大，请缩小范围后重试",
	"ocr.unreadable": "无法读取当前截图",
	"ocr.invalidImage": "截图数据无效，请重新截图",
	"text.invalid": "无效的文本内容",
	"text.copyFailed": "复制文本失败，请重试",
	"pin.untrusted": "无法固定当前截图",
	"pin.limit": "最多同时固定 {max} 张截图",
	"pin.failed": "悬浮截图创建失败，请重试",
	"settings.title": "QuickShot 设置",
	"shortcut.invalid": "这个组合不能用作快捷键",
	"shortcut.duplicate": "和另一个快捷键重复了",
	"shortcut.taken": "这个组合已被系统或其他应用占用",
	"update.notifyTitle": "QuickShot v{version} 可以更新了",
	"update.notifyBody": "点这里下载并安装，完成后自动重启。",
	"update.confirmTitle": "更新到 QuickShot v{version}？",
	"update.confirmDetail": "下载完成后 QuickShot 会自动重启，正在编辑或贴在桌面上的截图会关闭。",
	"update.install": "更新",
	"update.later": "稍后",
} as const;

type MainMessageKey = keyof typeof zh;

const en: Record<MainMessageKey, string> = {
	"trayHint.title": "QuickShot lives here",
	"trayHint.detail": "Press {shortcut} to capture, or click the icon for the menu",
	"menuBarHidden.title": "QuickShot is running, but its menu bar icon is hidden",
	"menuBarHidden.detail":
		"Press {shortcut} to capture at any time. To show the icon, turn on QuickShot under “Allow in the Menu Bar” in System Settings → Menu Bar.",
	"menuBarHidden.openSettings": "Open Menu Bar Settings",
	"menuBarHidden.ok": "OK",
	"tray.capture": "Take Screenshot",
	"tray.scrollCapture": "Scrolling Capture",
	"tray.captureMode": "Selection Style",
	"tray.captureMode.system": "System Selection (Space for windows)",
	"tray.captureMode.overlay": "QuickShot Selection (hover to pick windows)",
	"tray.launchAtLogin": "Launch at Login",
	"tray.settings": "Settings…",
	"tray.checkUpdates": "Check for Updates…",
	"tray.updateAvailable": "Update to v{version}…",
	"tray.updateDownloading": "Downloading update {percent}%",
	"tray.updateInstalling": "Installing update…",
	"tray.guide": "Welcome Guide & Permissions…",
	"tray.repairShortcut": "Repair Shortcut",
	"tray.diagnostics": "Show Diagnostics",
	"tray.pinned": "Pinned Screenshots ({count}/{max})",
	"tray.restorePinned": "Restore Pinned Interaction ({shortcut})",
	"tray.closePinned": "Close All Pinned Screenshots",
	"tray.quit": "Quit QuickShot",
	"tray.language": "Language 语言",
	"tray.language.auto": "System Default",
	"tray.tooltipShortcutFailed": "QuickShot · Shortcut unavailable, click the tray icon to capture",
	"dialog.saveTitle": "Save Screenshot",
	"dialog.pngFilter": "PNG Image",
	"ocr.unsupported": "Text extraction is not available on this system",
	"ocr.busy": "Text extraction is already running",
	"ocr.failed": "Text extraction failed, please try again",
	"ocr.timeout": "Text extraction timed out, try a smaller area",
	"ocr.cancelled": "Text extraction was cancelled",
	"ocr.helperMissing": "The text recognition component is missing, please reinstall QuickShot",
	"ocr.noLanguage": "No recognition language is installed. Add a language pack in Windows Settings",
	"ocr.tooLarge": "The capture is too large to read, try a smaller area",
	"ocr.unreadable": "Could not read the current capture",
	"ocr.invalidImage": "The capture data is invalid, please capture again",
	"text.invalid": "Invalid text",
	"text.copyFailed": "Could not copy the text, please try again",
	"pin.untrusted": "Could not pin this capture",
	"pin.limit": "You can pin up to {max} captures at once",
	"pin.failed": "Could not create the pinned capture, please try again",
	"settings.title": "QuickShot Settings",
	"shortcut.invalid": "That combination can't be used as a shortcut",
	"shortcut.duplicate": "That's already the other shortcut",
	"shortcut.taken": "Another app or the system already uses that",
	"update.notifyTitle": "QuickShot v{version} is available",
	"update.notifyBody": "Click to download and install it; QuickShot restarts when it's done.",
	"update.confirmTitle": "Update to QuickShot v{version}?",
	"update.confirmDetail": "QuickShot restarts once the download finishes, closing the editor and pinned screenshots.",
	"update.install": "Update",
	"update.later": "Later",
};

export function mt(key: MainMessageKey, values?: Record<string, string | number>) {
	const template = (currentLanguage === "zh" ? zh : en)[key];
	if (!values) return template;
	return template.replace(/\{(\w+)\}/g, (match, name: string) =>
		name in values ? String(values[name]) : match,
	);
}
