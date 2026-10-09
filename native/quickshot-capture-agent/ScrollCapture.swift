import CoreGraphics
import CoreMedia
import CoreVideo
import Foundation
import ImageIO
import ScreenCaptureKit

/// A scrolling capture in progress. ScreenCaptureKit streams just the selected
/// region, without the pointer or QuickShot's own windows, into a
/// ScrollStitcher while the user scrolls. Progress goes to Electron as
///
///   {"event":"scroll","status":…,"height":…,"width":…,"preview":…}
///
/// where status is "waiting" (nothing stitched yet), "capturing", "behind"
/// (scrolled back over captured rows), "lost" (no overlap with the last
/// captured frame), "full" or "error", height is what the image would be if
/// finished now, and preview changes whenever the preview JPEG was rewritten.
@available(macOS 14.0, *)
final class ScrollCapture: NSObject, SCStreamOutput, SCStreamDelegate {
    private static let previewSize = CGSize(width: 432, height: 640)
    private static let previewInterval: TimeInterval = 0.35

    private let queue = DispatchQueue(label: "quickshot.agent.scroll")
    private let stitcher: ScrollStitcher
    private let previewPath: String?
    private var stream: SCStream?
    private var fixtureTimer: DispatchSourceTimer?
    private var stopped = false
    private var status = "waiting"
    private var reportedHeight = 0
    private var frames = 0
    private var previewVersion = 0
    private var previewWrittenAt = Date.distantPast
    private var previewScheduled = false

    init(width: Int, height: Int, maxHeight: Int, ignoredRight: Int, previewPath: String?) {
        stitcher = ScrollStitcher(width: width, height: height, maxHeight: maxHeight, ignoredRight: ignoredRight)
        self.previewPath = previewPath
    }

    /// Streams `sourceRect` (display points) of a display at the stitcher's size.
    func start(displayID: CGDirectDisplayID, sourceRect: CGRect, excludingPid: pid_t, id: Int) {
        SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: true) { content, error in
            guard let content, let display = content.displays.first(where: { $0.displayID == displayID }) else {
                fail(id, error.map { String(describing: $0) } ?? "display not found")
                return
            }
            let own = content.applications.filter { $0.processID == excludingPid }
            let filter = SCContentFilter(display: display, excludingApplications: own, exceptingWindows: [])
            let configuration = SCStreamConfiguration()
            configuration.sourceRect = sourceRect
            configuration.width = self.stitcher.width
            configuration.height = self.stitcher.height
            configuration.showsCursor = false
            configuration.pixelFormat = kCVPixelFormatType_32BGRA
            configuration.colorSpaceName = CGColorSpace.sRGB
            configuration.captureResolution = .best
            // Frequent frames keep the step between two of them small, even
            // when a trackpad flick sends the page flying.
            configuration.minimumFrameInterval = CMTime(value: 1, timescale: 30)
            configuration.queueDepth = 5
            let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
            do {
                try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: self.queue)
            } catch {
                fail(id, String(describing: error))
                return
            }
            let cancelled = self.queue.sync { () -> Bool in
                if !self.stopped { self.stream = stream }
                return self.stopped
            }
            if cancelled {
                fail(id, "cancelled")
                return
            }
            stream.startCapture { error in
                if let error {
                    fail(id, String(describing: error))
                    return
                }
                send(["id": id, "ok": true, "width": self.stitcher.width, "height": self.stitcher.height])
            }
        }
    }

    /// Development only: "scrolls" through a tall image instead of the screen,
    /// with a fixed band at the top and bottom, so the whole flow can be tried
    /// without Screen Recording permission.
    func startFixture(path: String, id: Int) {
        guard
            let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
            let image = CGImageSourceCreateImageAtIndex(source, 0, nil), image.width > 0
        else {
            fail(id, "fixture unreadable")
            return
        }
        let width = stitcher.width
        let height = stitcher.height
        let pageHeight = max(height, Int((Double(image.height) * Double(width) / Double(image.width)).rounded()))
        var page = [UInt8](repeating: 255, count: width * pageHeight * 4)
        let drawn = page.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = bgraContext(buffer.baseAddress, width: width, height: pageHeight) else { return false }
            context.interpolationQuality = .high
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: pageHeight))
            return true
        }
        guard drawn else {
            fail(id, "fixture unreadable")
            return
        }
        let header = height / 10
        let footer = height / 12
        let end = pageHeight - height
        let unit = Double(height)
        // Wait, scroll a third of the way, pause, back up a little, then on to the end.
        let route: [(seconds: Double, to: Double)] = [
            (0.8, 0), (Double(end) / 3 / (unit * 1.2), Double(end) / 3), (0.5, Double(end) / 3),
            (0.4, max(0, Double(end) / 3 - unit * 0.4)), (Double(end) / (unit * 1.6), Double(end)),
        ]
        func position(at time: Double) -> Int {
            var elapsed = time
            var from = 0.0
            for step in route {
                if elapsed < step.seconds {
                    return Int((from + (step.to - from) * elapsed / max(step.seconds, 0.001)).rounded())
                }
                elapsed -= step.seconds
                from = step.to
            }
            return end
        }
        var shot = [UInt8](repeating: 0, count: width * height * 4)
        let rowBytes = width * 4
        let started = Date()
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now(), repeating: .milliseconds(50))
        timer.setEventHandler { [weak self] in
            guard let self, !self.stopped else { return }
            let scroll = max(0, min(end, position(at: Date().timeIntervalSince(started))))
            page.withUnsafeBytes { source in
                shot.withUnsafeMutableBytes { target in
                    let from = source.baseAddress!
                    let to = target.baseAddress!
                    to.copyMemory(from: from, byteCount: header * rowBytes)
                    (to + header * rowBytes).copyMemory(
                        from: from + (header + scroll) * rowBytes, byteCount: (height - header - footer) * rowBytes)
                    (to + (height - footer) * rowBytes).copyMemory(
                        from: from + (pageHeight - footer) * rowBytes, byteCount: footer * rowBytes)
                }
            }
            shot.withUnsafeBytes { self.consume($0.baseAddress!, bytesPerRow: rowBytes) }
        }
        queue.sync {
            fixtureTimer = timer
            timer.resume()
        }
        send(["id": id, "ok": true, "width": width, "height": height])
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard
            type == .screen, !stopped, sampleBuffer.isValid,
            let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false)
                as? [[SCStreamFrameInfo: Any]],
            let rawStatus = attachments.first?[.status] as? Int,
            SCFrameStatus(rawValue: rawStatus) == .complete,
            let pixelBuffer = sampleBuffer.imageBuffer
        else {
            return
        }
        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }
        guard
            CVPixelBufferGetWidth(pixelBuffer) >= stitcher.width,
            CVPixelBufferGetHeight(pixelBuffer) >= stitcher.height,
            let base = CVPixelBufferGetBaseAddress(pixelBuffer)
        else {
            return
        }
        consume(base, bytesPerRow: CVPixelBufferGetBytesPerRow(pixelBuffer))
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        queue.async {
            guard !self.stopped else { return }
            self.status = "error"
            self.report()
        }
    }

    /// Stops capturing and drops everything; with an id, replies with the counts.
    func stop(id: Int? = nil) {
        queue.async {
            self.halt()
            if let id { send(["id": id, "ok": true, "stats": self.stats()]) }
        }
    }

    /// Numbers for QuickShot's diagnostics log: how the stitching went.
    private func stats() -> [String: Any] {
        [
            "frames": stitcher.framesSeen, "lost": stitcher.framesLost, "losses": stitcher.lostEpisodes,
            "longestLoss": stitcher.longestLoss, "notes": stitcher.lossNotes,
        ]
    }

    /// Stops capturing and writes the stitched image as a PNG.
    func finish(path: String, id: Int) {
        queue.async {
            self.halt()
            guard let rows = self.stitcher.finish() else {
                fail(id, "no frames")
                return
            }
            let width = self.stitcher.width
            let written = self.stitcher.output.withUnsafeBytes { buffer -> Bool in
                guard let image = bgraImage(buffer.baseAddress!, width: width, rows: rows) else { return false }
                return write(image, to: path)
            }
            if written {
                send(["id": id, "ok": true, "width": width, "height": rows, "frames": self.frames, "stats": self.stats()])
            } else {
                fail(id, "could not write the image")
            }
        }
    }

    // MARK: - On the capture queue

    private func halt() {
        stopped = true
        fixtureTimer?.cancel()
        fixtureTimer = nil
        stream?.stopCapture { _ in }
        stream = nil
    }

    private func consume(_ base: UnsafeRawPointer, bytesPerRow: Int) {
        guard !stopped else { return }
        frames += 1
        let previous = status
        switch stitcher.add(base, bytesPerRow: bytesPerRow) {
        case .unchanged:
            break
        case .waiting:
            status = "waiting"
            schedulePreview()
        case .appended:
            status = "capturing"
            schedulePreview()
        case .behind:
            status = "behind"
        case .lost:
            status = "lost"
        case .full:
            status = "full"
            schedulePreview()
        }
        if status != previous || stitcher.projectedHeight != reportedHeight { report() }
    }

    private func report() {
        reportedHeight = stitcher.projectedHeight
        send([
            "event": "scroll", "status": status, "height": reportedHeight, "width": stitcher.width,
            "preview": previewVersion,
        ])
    }

    /// Rewrites the preview at most every `previewInterval`, always catching
    /// up with the latest rows.
    private func schedulePreview() {
        guard previewPath != nil, !previewScheduled else { return }
        let wait = Self.previewInterval - Date().timeIntervalSince(previewWrittenAt)
        if wait <= 0 {
            writePreview()
            return
        }
        previewScheduled = true
        queue.asyncAfter(deadline: .now() + wait) {
            self.previewScheduled = false
            guard !self.stopped else { return }
            self.writePreview()
        }
    }

    private func writePreview() {
        guard let previewPath else { return }
        previewWrittenAt = Date()
        let width = stitcher.width
        let image: CGImage? = stitcher.withSegments { segments in
            let total = segments.reduce(0) { $0 + $1.rows }
            guard total > 0 else { return nil }
            // As wide as the panel shows it; a long image keeps only its newest rows.
            let scale = min(1, Self.previewSize.width / CGFloat(width))
            let targetWidth = max(1, Int((CGFloat(width) * scale).rounded()))
            let targetHeight = max(1, min(Int(Self.previewSize.height), Int((CGFloat(total) * scale).rounded())))
            guard let context = bgraContext(nil, width: targetWidth, height: targetHeight) else { return nil }
            context.interpolationQuality = .medium
            var above = 0
            for segment in segments {
                if let part = bgraImage(segment.pixels, width: width, rows: segment.rows) {
                    // Core Graphics counts from the bottom, so the newest rows
                    // land in the context and older ones fall off the top.
                    let y = CGFloat(total - above - segment.rows) * scale
                    context.draw(
                        part, in: CGRect(x: 0, y: y, width: CGFloat(targetWidth), height: CGFloat(segment.rows) * scale))
                }
                above += segment.rows
            }
            return context.makeImage()
        }
        guard let image else { return }
        let temporary = previewPath + ".part.jpg"
        guard write(image, to: temporary, quality: 0.82) else { return }
        guard rename(temporary, previewPath) == 0 else {
            unlink(temporary)
            return
        }
        previewVersion += 1
        report()
    }
}

/// An opaque 32-bit BGRA bitmap context, the layout ScreenCaptureKit delivers.
private func bgraContext(_ data: UnsafeMutableRawPointer?, width: Int, height: Int) -> CGContext? {
    CGContext(
        data: data, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
        space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
}

/// Wraps BGRA rows without copying; the image must not outlive `pixels`.
private func bgraImage(_ pixels: UnsafeRawPointer, width: Int, rows: Int) -> CGImage? {
    guard
        let provider = CGDataProvider(
            dataInfo: nil, data: pixels, size: width * rows * 4, releaseData: { _, _, _ in })
    else {
        return nil
    }
    return CGImage(
        width: width, height: rows, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4,
        space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGBitmapInfo(
            rawValue: CGImageAlphaInfo.noneSkipFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue),
        provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent)
}
