import CoreGraphics
import Foundation

// Shared by quickshot-window-list and quickshot-capture-agent.

// System chrome that sits in the same layers as app panels.
private let systemOwners: Set<String> = [
    "Window Server", "Dock", "Control Center", "SystemUIServer", "Notification Center",
    "NotificationCenter", "Spotlight", "screencaptureui", "loginwindow", "WindowManager",
    "TextInputMenuAgent", "TextInputSwitcher", "Wallpaper", "CursorUIViewService",
]

// Regular windows (0) up to pop-up panels (101), which covers floating
// utility windows and menu bar apps' popovers; overlays and the screen saver
// sit above that.
private let maximumLayer = Int(CGWindowLevelForKey(.popUpMenuWindow))

private func activeDisplayBounds() -> [CGRect] {
    var displayCount: UInt32 = 0
    CGGetActiveDisplayList(0, nil, &displayCount)
    var displayIDs = [CGDirectDisplayID](repeating: 0, count: Int(displayCount))
    CGGetActiveDisplayList(displayCount, &displayIDs, &displayCount)
    return displayIDs.prefix(Int(displayCount)).map { CGDisplayBounds($0) }
}

/// On-screen application windows, front to back, in global display points with
/// a top-left origin (Electron's screen space). `id` is the CGWindowID that
/// `screencapture -l` and ScreenCaptureKit use to capture one window.
/// Windows of `excludedPid`, and the windows numbered in `excludedWindows`,
/// are left out.
func listOnScreenWindows(excludingPid excludedPid: Int32, excludingWindows excludedWindows: Set<Int> = []) -> [[String: Any]] {
    let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    let entries = (CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]]) ?? []
    let displayBounds = activeDisplayBounds()

    var windows: [[String: Any]] = []
    for entry in entries {
        guard
            let layer = entry[kCGWindowLayer as String] as? Int, layer >= 0, layer <= maximumLayer,
            let pid = entry[kCGWindowOwnerPID as String] as? Int32, pid != excludedPid,
            let number = entry[kCGWindowNumber as String] as? Int, !excludedWindows.contains(number),
            let boundsDictionary = entry[kCGWindowBounds as String] as? NSDictionary,
            let bounds = CGRect(dictionaryRepresentation: boundsDictionary as CFDictionary),
            bounds.width >= 40, bounds.height >= 40
        else {
            continue
        }
        let owner = entry[kCGWindowOwnerName as String] as? String ?? ""
        if systemOwners.contains(owner) { continue }
        if let alpha = entry[kCGWindowAlpha as String] as? Double, alpha <= 0.01 { continue }
        // Floating windows that blanket a whole display are overlays
        // (recorders, dimmers, HUDs), never something to capture on their own.
        if layer != 0 && displayBounds.contains(where: { bounds.insetBy(dx: -1, dy: -1).contains($0) }) {
            continue
        }
        windows.append([
            "id": number,
            "x": bounds.origin.x,
            "y": bounds.origin.y,
            "width": bounds.width,
            "height": bounds.height,
            "app": owner,
            "title": entry[kCGWindowName as String] as? String ?? "",
        ])
        if windows.count >= 200 { break }
    }
    return windows
}
