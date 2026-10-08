import AppKit
import CoreGraphics
import Foundation
import ImageIO
import ScreenCaptureKit

// A long-lived helper that Electron keeps running on macOS, so a capture does
// not pay for launching a process and starting ScreenCaptureKit every time.
// It reads one JSON request per line on stdin and writes one JSON line per
// request on stdout, echoing its "id":
//
//   {"id":1,"cmd":"display","display":<CGDirectDisplayID>,"path":"/…/a.jpg"}
//       Captures a display, keeps the lossless frame in memory and writes a
//       JPEG preview (quality 1, no chroma subsampling) for the overlay.
//   {"id":2,"cmd":"crop","rect":{"x":0,"y":0,"width":10,"height":10},"path":"/…/b.png"}
//       Writes part of the kept frame, losslessly, in frame pixels.
//   {"id":3,"cmd":"window","window":<CGWindowID>,"path":"/…/c.png"}
//       Captures one window without its shadow, trimmed to its visible pixels.
//   {"id":4,"cmd":"windows","exclude":<pid>}
//   {"id":5,"cmd":"release"}   Drops the kept frame.
//   {"id":6,"cmd":"warm"}
//   {"id":7,"cmd":"app-window","bundle":"com.apple.systempreferences"}
//       The frontmost window of a running app, in global points.
//
// Image requests need macOS 14 (SCScreenshotManager). Older systems answer
// "unsupported" and Electron falls back to /usr/sbin/screencapture.
// The process exits when stdin closes, i.e. when QuickShot quits.

private let outputQueue = DispatchQueue(label: "quickshot.agent.output")

private func send(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
    outputQueue.async {
        FileHandle.standardOutput.write(data + Data("\n".utf8))
    }
}

private func fail(_ id: Int, _ message: String) {
    send(["id": id, "ok": false, "error": message])
}

private func elapsedMilliseconds(since start: Date) -> Int {
    Int((Date().timeIntervalSince(start) * 1000).rounded())
}

private func write(_ image: CGImage, to path: String) -> Bool {
    let isJPEG = path.hasSuffix(".jpg")
    guard let destination = CGImageDestinationCreateWithURL(
        URL(fileURLWithPath: path) as CFURL,
        (isJPEG ? "public.jpeg" : "public.png") as CFString, 1, nil)
    else {
        return false
    }
    // At quality 1 ImageIO also keeps full-resolution colour (4:4:4), so the
    // overlay looks exactly like the screen.
    let options: [CFString: Any] = isJPEG ? [kCGImageDestinationLossyCompressionQuality: 1.0] : [:]
    CGImageDestinationAddImage(destination, image, options as CFDictionary)
    return CGImageDestinationFinalize(destination)
}

/// The smallest rectangle holding every pixel more opaque than `threshold`.
/// Some apps draw their window inside a larger transparent frame; cropping to
/// this leaves just the window. Returns nil when the image is fully clear.
private func opaqueBounds(of image: CGImage, threshold: UInt8 = 8) -> CGRect? {
    let width = image.width
    let height = image.height
    guard width > 0, height > 0,
          let context = CGContext(
              data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
              space: CGColorSpaceCreateDeviceRGB(),
              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
          let pixels = context.data?.bindMemory(to: UInt8.self, capacity: width * height * 4)
    else {
        return nil
    }
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    // Rows run top to bottom in the context's memory.
    func opaque(_ x: Int, _ y: Int) -> Bool { pixels[(y * width + x) * 4 + 3] > threshold }
    func rowHasPixel(_ y: Int) -> Bool { (0..<width).contains { opaque($0, y) } }
    var top = 0
    while top < height && !rowHasPixel(top) { top += 1 }
    if top == height { return nil }
    var bottom = height - 1
    while bottom > top && !rowHasPixel(bottom) { bottom -= 1 }
    func columnHasPixel(_ x: Int) -> Bool { (top...bottom).contains { opaque(x, $0) } }
    var left = 0
    while left < width && !columnHasPixel(left) { left += 1 }
    var right = width - 1
    while right > left && !columnHasPixel(right) { right -= 1 }
    return CGRect(x: left, y: top, width: right - left + 1, height: bottom - top + 1)
}

@available(macOS 14.0, *)
private final class Capturer {
    private let queue = DispatchQueue(label: "quickshot.agent.capture")
    private var cached: SCShareableContent?
    private var cachedAt = Date.distantPast
    /// The last display capture, kept losslessly until the overlay is done.
    private var frame: CGImage?

    /// Building shareable content is the slow part. Displays rarely change,
    /// so display captures reuse a recent copy; window captures ask afresh.
    func content(maxAge: TimeInterval, _ done: @escaping (SCShareableContent?, String?) -> Void) {
        queue.async {
            if let cached = self.cached, Date().timeIntervalSince(self.cachedAt) < maxAge {
                done(cached, nil)
                return
            }
            SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: true) { content, error in
                self.queue.async {
                    if let content {
                        self.cached = content
                        self.cachedAt = Date()
                    }
                    done(content, error.map { String(describing: $0) })
                }
            }
        }
    }

    private func capture(
        _ filter: SCContentFilter, singleWindow: Bool, _ done: @escaping (CGImage?, String?) -> Void
    ) {
        let configuration = SCStreamConfiguration()
        let scale = CGFloat(filter.pointPixelScale)
        configuration.width = max(1, Int((filter.contentRect.width * scale).rounded()))
        configuration.height = max(1, Int((filter.contentRect.height * scale).rounded()))
        configuration.showsCursor = false
        configuration.captureResolution = .best
        if singleWindow {
            // Like the system's window capture: no shadow, transparent corners.
            configuration.ignoreShadowsSingleWindow = true
            configuration.shouldBeOpaque = false
        }
        SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration) { image, error in
            done(image, image == nil ? (error.map { String(describing: $0) } ?? "no image") : nil)
        }
    }

    func captureDisplay(_ displayID: CGDirectDisplayID, path: String, id: Int) {
        let start = Date()
        let finish: (SCDisplay) -> Void = { display in
            let shot = Date()
            self.capture(SCContentFilter(display: display, excludingWindows: []), singleWindow: false) { image, error in
                guard let image else {
                    fail(id, error ?? "no image")
                    return
                }
                let captured = Date()
                self.queue.async { self.frame = image }
                guard write(image, to: path) else {
                    fail(id, "could not write the image")
                    return
                }
                send([
                    "id": id, "ok": true, "width": image.width, "height": image.height,
                    "ms": elapsedMilliseconds(since: start),
                    "captureMs": Int((captured.timeIntervalSince(shot) * 1000).rounded()),
                    "encodeMs": elapsedMilliseconds(since: captured),
                ])
            }
        }
        // A cached display stays usable until it is unplugged or changes mode.
        let current = CGDisplayBounds(displayID).size
        content(maxAge: .infinity) { content, _ in
            if let display = content?.displays.first(where: { $0.displayID == displayID }),
               display.frame.size == current
            {
                finish(display)
                return
            }
            // The cached copy predates a display change; look once more.
            self.content(maxAge: 0) { content, error in
                guard let display = content?.displays.first(where: { $0.displayID == displayID }) else {
                    fail(id, error ?? "display not found")
                    return
                }
                finish(display)
            }
        }
    }

    func crop(_ rect: CGRect, path: String, id: Int) {
        queue.async {
            guard let frame = self.frame else {
                fail(id, "no frame")
                return
            }
            let bounds = CGRect(x: 0, y: 0, width: frame.width, height: frame.height)
            guard bounds.contains(rect), let cropped = frame.cropping(to: rect) else {
                fail(id, "bad rect")
                return
            }
            guard write(cropped, to: path) else {
                fail(id, "could not write the image")
                return
            }
            send(["id": id, "ok": true, "width": cropped.width, "height": cropped.height])
        }
    }

    func release() {
        queue.async { self.frame = nil }
    }

    func captureWindow(_ windowID: CGWindowID, path: String, id: Int) {
        let start = Date()
        content(maxAge: 0) { content, error in
            guard let window = content?.windows.first(where: { $0.windowID == windowID }) else {
                fail(id, error ?? "window not found")
                return
            }
            self.capture(SCContentFilter(desktopIndependentWindow: window), singleWindow: true) { captured, error in
                guard var image = captured else {
                    fail(id, error ?? "no image")
                    return
                }
                guard let bounds = opaqueBounds(of: image) else {
                    fail(id, "window image is empty")
                    return
                }
                if bounds.width < CGFloat(image.width) || bounds.height < CGFloat(image.height),
                   let trimmed = image.cropping(to: bounds)
                {
                    image = trimmed
                }
                guard write(image, to: path) else {
                    fail(id, "could not write the image")
                    return
                }
                send([
                    "id": id, "ok": true, "width": image.width, "height": image.height,
                    "ms": elapsedMilliseconds(since: start),
                ])
            }
        }
    }
}

private let capturer: AnyObject? = {
    if #available(macOS 14.0, *) { return Capturer() }
    return nil
}()

private func imagePath(_ request: [String: Any], _ extensions: [String]) -> String? {
    guard let path = request["path"] as? String, extensions.contains(where: { path.hasSuffix($0) }) else {
        return nil
    }
    return path
}

private func handle(_ request: [String: Any]) {
    guard let id = request["id"] as? Int, let command = request["cmd"] as? String else { return }
    if command == "windows" {
        let exclude = (request["exclude"] as? Int).map { Int32(truncatingIfNeeded: $0) } ?? -1
        send(["id": id, "ok": true, "windows": listOnScreenWindows(excludingPid: exclude)])
        return
    }
    if command == "app-window" {
        // Where another app's main window is, e.g. System Settings, so a
        // helper can sit next to it. Bounds need no Screen Recording access.
        let bundle = request["bundle"] as? String ?? "com.apple.systempreferences"
        guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundle).first else {
            fail(id, "not running")
            return
        }
        let entries = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
            as? [[String: Any]]) ?? []
        for entry in entries {
            guard
                let pid = entry[kCGWindowOwnerPID as String] as? Int32, pid == app.processIdentifier,
                let layer = entry[kCGWindowLayer as String] as? Int, layer == 0,
                let boundsDictionary = entry[kCGWindowBounds as String] as? NSDictionary,
                let bounds = CGRect(dictionaryRepresentation: boundsDictionary as CFDictionary),
                bounds.width >= 200, bounds.height >= 150
            else {
                continue
            }
            send([
                "id": id, "ok": true, "x": bounds.origin.x, "y": bounds.origin.y,
                "width": bounds.width, "height": bounds.height, "active": app.isActive,
            ])
            return
        }
        fail(id, "no window")
        return
    }
    guard #available(macOS 14.0, *), let capturer = capturer as? Capturer else {
        fail(id, "unsupported")
        return
    }
    switch command {
    case "warm":
        // Only with permission: asking ScreenCaptureKit without it would
        // prompt the user at launch instead of at their first capture.
        guard CGPreflightScreenCaptureAccess() else {
            fail(id, "no permission")
            return
        }
        let start = Date()
        capturer.content(maxAge: 0) { content, error in
            if content == nil {
                fail(id, error ?? "no content")
            } else {
                send(["id": id, "ok": true, "ms": elapsedMilliseconds(since: start)])
            }
        }
    case "display":
        guard let path = imagePath(request, [".jpg", ".png"]), let display = request["display"] as? Int else {
            fail(id, "bad request")
            return
        }
        capturer.captureDisplay(CGDirectDisplayID(truncatingIfNeeded: display), path: path, id: id)
    case "window":
        guard let path = imagePath(request, [".png"]), let window = request["window"] as? Int else {
            fail(id, "bad request")
            return
        }
        capturer.captureWindow(CGWindowID(truncatingIfNeeded: window), path: path, id: id)
    case "crop":
        guard
            let path = imagePath(request, [".png"]),
            let rect = request["rect"] as? [String: Any],
            let x = rect["x"] as? Int, let y = rect["y"] as? Int,
            let width = rect["width"] as? Int, let height = rect["height"] as? Int,
            width > 0, height > 0
        else {
            fail(id, "bad request")
            return
        }
        capturer.crop(CGRect(x: x, y: y, width: width, height: height), path: path, id: id)
    case "release":
        capturer.release()
        send(["id": id, "ok": true])
    default:
        fail(id, "unknown command")
    }
}

DispatchQueue.global(qos: .userInitiated).async {
    while let line = readLine() {
        guard
            let data = line.data(using: .utf8),
            let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else {
            continue
        }
        handle(request)
    }
    // Wait for queued replies before leaving.
    outputQueue.sync {}
    exit(0)
}

dispatchMain()
