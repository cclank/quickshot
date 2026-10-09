import Foundation

/// Joins the frames of a region that is being scrolled into one tall image.
///
/// Frames are 32-bit BGRA. Each frame is matched against the one before it,
/// a few dozen milliseconds older, so content that changes in place (lazy
/// images, fade-ins, a ticking clock, a hover highlight) never leaves the
/// stitcher holding a stale reference. Rows that stay put at the top and
/// bottom (toolbars, sticky headers, footers) are left out of the search, and
/// rows are compared in column segments, so a change in one part of a row
/// does not hide a match in the rest of it. Segments match when their pixels
/// agree or when their shapes correlate, so text that darkens as it scrolls
/// in still lines up; columns that stay put while the rest scrolls (a sticky
/// sidebar) are left out of the matching altogether.
///
/// The image is a canvas in the first frame's coordinates. Every placed frame
/// paints the rows it shows over the canvas, so the latest view of each row
/// wins: an image that finished loading replaces its placeholder, and a
/// floating button ends up only where it was last seen. The fixed top bar
/// comes from the first frame and the fixed bottom bar from the frame that
/// reached furthest down; a sticky sidebar shows once, above its background.
///
/// Until the first scroll down the stitcher follows the newest frame, which
/// lets the window settle (it turns active once QuickShot steps aside) and
/// lets the user scroll up to where the capture should begin.
///
/// Pure logic with no ScreenCaptureKit, so it can be tested on its own.
final class ScrollStitcher {
    enum Outcome: Equatable {
        /// Nothing moved; content may have changed in place.
        case unchanged
        /// Not started yet; this frame is the new starting point.
        case waiting
        /// The image grew by this many rows.
        case appended(Int)
        /// Scrolled back up over rows that are already in the image.
        case behind
        /// No overlap with the previous frame, e.g. after a very fast scroll.
        case lost
        /// The image reached `maxHeight`; later frames are ignored.
        case full
    }

    /// Luminance of the compared columns plus summaries per row and segment.
    private struct Analysis {
        var luma: [UInt8]
        var hashes: [UInt64]
        /// Rows with some detail, i.e. not one flat colour.
        var detailed: [Bool]
        /// The same per column segment, `segments` per row.
        var segmentDetailed: [Bool]
        var segmentHashes: [UInt64]
        /// Sums of luminance over `profileBands` column bands, per row.
        var profile: [Int32]
    }

    private static let segments = 16
    private static let profileBands = 8
    /// Luminance steps that count as a real difference rather than noise.
    private static let tolerance: Int16 = 24
    /// Share of detailed segments that must line up for a match.
    private static let minimumScore = 0.6
    /// Exact segment matches that make a shift convincing on their own.
    private static let convincingVotes = 24

    let width: Int
    let height: Int
    let maxHeight: Int
    /// Columns compared, from the left. The rest, where an overlay scroll bar
    /// appears while scrolling, is copied but never compared.
    let columns: Int

    /// Development aid: describes each decision. Nil in the agent.
    var trace: ((String) -> Void)?

    /// The canvas while capturing; the finished image after `finish()`.
    private(set) var output: [UInt8] = []
    private(set) var outputRows = 0
    private(set) var isFull = false
    /// Whether the capture has begun, i.e. something scrolled down.
    private(set) var started = false

    private var previous: Analysis?
    /// The previous frame's pixels, kept until the capture begins.
    private var previousPixels: [UInt8] = []
    /// How far the previous frame has scrolled from the first one.
    private var previousScroll = 0
    private var lastShift = 0
    /// Frames in a row that could not be placed.
    private var lostStreak = 0
    /// Numbers for the diagnostics log; never any image content.
    private(set) var framesSeen = 0
    private(set) var framesLost = 0
    private(set) var lostEpisodes = 0
    private(set) var longestLoss = 0
    /// How the first frame of each loss looked, e.g. "f212 band 1180 max 1062 last 240 best 310@0.41/12v still 0.08".
    private(set) var lossNotes: [String] = []
    private var attempt = ""
    /// Column segments that stayed put while the page scrolled (a sticky
    /// sidebar): they say nothing about scrolling, so matching skips them.
    private var stillColumns = [Bool](repeating: false, count: segments)
    /// Frame rows above this are the fixed top bar, taken from the first frame.
    private var headerRows = 0
    private var canvasRows = 0
    /// The frame that reached furthest down supplies the fixed bottom bar.
    private var deepestScroll = 0
    private var deepestBottom = 0
    private var footer: [UInt8] = []

    init(width: Int, height: Int, maxHeight: Int, ignoredRight: Int = 0) {
        precondition(width > 0 && height > 0)
        self.width = width
        self.height = height
        self.maxHeight = max(height, maxHeight)
        columns = max(1, width - min(max(0, ignoredRight), width / 4))
    }

    /// How far the latest placed frame has scrolled from the first one, in rows.
    var scrollOffset: Int { previousScroll }

    /// The height `finish()` would produce now.
    var projectedHeight: Int {
        guard previous != nil else { return 0 }
        return started ? min(maxHeight, deepestScroll + height) : height
    }

    func add(_ base: UnsafeRawPointer, bytesPerRow: Int) -> Outcome {
        if isFull { return .full }
        framesSeen += 1
        let frame = analyze(base, bytesPerRow: bytesPerRow)
        guard let last = previous else {
            follow(frame, base, bytesPerRow: bytesPerRow)
            return .waiting
        }

        var top = 0
        while top < height && rowStays(last, frame, top) { top += 1 }
        if top == height { return .unchanged }
        var bottom = height
        while bottom > top && rowStays(last, frame, bottom - 1) { bottom -= 1 }

        let found = findShift(last, frame, top: top, bottom: bottom)
        trace?("band \(top)..<\(bottom) shift \(found.map(String.init) ?? "none")")
        guard let shift = found else {
            if started {
                lostStreak += 1
                framesLost += 1
                longestLoss = max(longestLoss, lostStreak)
                if lostStreak == 1 {
                    lostEpisodes += 1
                    if lossNotes.count < 12 { lossNotes.append("f\(framesSeen) band \(top)..<\(bottom) last \(lastShift) \(attempt)") }
                }
                return .lost
            }
            follow(frame, base, bytesPerRow: bytesPerRow)
            return .waiting
        }
        if !started {
            guard shift > 0 else {
                follow(frame, base, bytesPerRow: bytesPerRow)
                return .waiting
            }
            begin(top: top, bottom: bottom)
        }

        let scroll = previousScroll + shift
        if scroll + height > maxHeight {
            isFull = true
            return .full
        }
        // Never leave a gap below what the canvas already holds. In place,
        // the rows above the change are the page itself and fill it.
        if shift != 0 && scroll + max(top, headerRows) > canvasRows { return .lost }
        let before = projectedHeight
        if shift != 0 { stillColumns = stillSegments(last, frame, shift: shift, top: top, bottom: bottom) }
        paint(base, bytesPerRow: bytesPerRow, scroll: scroll, top: top, bottom: bottom, moved: shift != 0, still: stillColumns)
        previous = frame
        previousScroll = scroll
        lostStreak = 0
        if shift != 0 { lastShift = shift }
        // A few rows short of the deepest point is the end of the page
        // bouncing back, not the user scrolling up.
        if deepestScroll - scroll > height / 10 { return .behind }
        let grown = projectedHeight - before
        return grown > 0 ? .appended(grown) : .unchanged
    }

    /// Completes the image and returns its height, or nil before the first
    /// frame. Afterwards `output` holds the image.
    func finish() -> Int? {
        guard previous != nil else { return nil }
        if started {
            let rows = min(canvasRows, deepestScroll + deepestBottom)
            output.removeSubrange((rows * width * 4)...)
            output.append(contentsOf: footer)
            outputRows = min(maxHeight, rows + height - deepestBottom)
            output.removeSubrange((outputRows * width * 4)...)
        } else {
            output = previousPixels
            outputRows = height
        }
        previous = nil
        previousPixels = []
        footer = []
        return outputRows
    }

    /// The image so far as row segments, top to bottom.
    func withSegments<T>(_ body: ([(pixels: UnsafeRawPointer, rows: Int)]) -> T) -> T {
        if !started {
            return previousPixels.withUnsafeBytes { frame in
                guard previous != nil, let base = frame.baseAddress else { return body([]) }
                return body([(base, height)])
            }
        }
        return output.withUnsafeBytes { canvas in
            footer.withUnsafeBytes { bottomBar in
                var segments: [(pixels: UnsafeRawPointer, rows: Int)] = []
                let rows = min(canvasRows, deepestScroll + deepestBottom)
                if rows > 0, let base = canvas.baseAddress { segments.append((base, rows)) }
                if deepestBottom < height, let base = bottomBar.baseAddress {
                    segments.append((base, height - deepestBottom))
                }
                return body(segments)
            }
        }
    }

    // MARK: - Canvas

    /// Before the capture begins, the newest frame is the starting point.
    private func follow(_ frame: Analysis, _ base: UnsafeRawPointer, bytesPerRow: Int) {
        previous = frame
        previousScroll = 0
        let rowBytes = width * 4
        if previousPixels.count != rowBytes * height {
            previousPixels = [UInt8](repeating: 0, count: rowBytes * height)
        }
        previousPixels.withUnsafeMutableBytes { target in
            for y in 0..<height {
                target.baseAddress!.advanced(by: y * rowBytes).copyMemory(from: base + y * bytesPerRow, byteCount: rowBytes)
            }
        }
    }

    /// The previous frame becomes the top of the image.
    private func begin(top: Int, bottom: Int) {
        let rowBytes = width * 4
        started = true
        headerRows = top
        output.reserveCapacity(rowBytes * min(maxHeight, height * 4))
        output.append(contentsOf: previousPixels[0..<(bottom * rowBytes)])
        canvasRows = bottom
        deepestScroll = 0
        deepestBottom = bottom
        footer = Array(previousPixels[(bottom * rowBytes)...])
        previousScroll = 0
        previousPixels = []
    }

    /// Paints the rows this frame shows onto the canvas. While scrolling, the
    /// top sixth below the fixed bar is left alone: a bar that only sticks
    /// once the page scrolls would otherwise end up in the middle of the image.
    private func paint(
        _ base: UnsafeRawPointer, bytesPerRow: Int, scroll: Int, top: Int, bottom: Int, moved: Bool, still: [Bool]
    ) {
        let rowBytes = width * 4
        let floor = max(top, headerRows)
        var from = moved ? max(floor, headerRows + (height - headerRows) / 6) : floor
        from = max(moved ? floor : headerRows, min(from, canvasRows - scroll))
        from = max(from, headerRows - scroll)
        if bottom > from {
            let existing = canvasRows
            let end = scroll + bottom
            if end > canvasRows {
                output.append(contentsOf: repeatElement(0, count: (end - canvasRows) * rowBytes))
                canvasRows = end
            }
            // Rows already in the image keep the strip on the right where an
            // overlay scroll bar comes and goes, and any column that stayed put
            // while the rest scrolled (a sticky sidebar): repainting those would
            // smear them down the image.
            let segmentWidth = max(1, columns / Self.segments)
            var spans: [(start: Int, count: Int)] = []
            for segment in 0..<Self.segments where !(still.indices.contains(segment) && still[segment]) {
                let start = segment * segmentWidth * 4
                let end = (segment == Self.segments - 1 ? columns : (segment + 1) * segmentWidth) * 4
                if let last = spans.last, last.start + last.count == start {
                    spans[spans.count - 1].count += end - start
                } else {
                    spans.append((start, end - start))
                }
            }
            // New rows get such a column's background instead, so a sticky
            // sidebar shows once at the top, as in a full-page screenshot.
            var fills: [(start: Int, count: Int, pixel: UInt32)] = []
            for segment in still.indices where still[segment] {
                let start = segment * segmentWidth
                let end = segment == Self.segments - 1 ? columns : (segment + 1) * segmentWidth
                fills.append((start, end - start, commonPixel(base, bytesPerRow: bytesPerRow, columns: start..<end, rows: top..<bottom)))
            }
            output.withUnsafeMutableBytes { canvas in
                for y in from..<bottom {
                    let target = canvas.baseAddress!.advanced(by: (scroll + y) * rowBytes)
                    let source = base + y * bytesPerRow
                    if scroll + y >= existing {
                        target.copyMemory(from: source, byteCount: rowBytes)
                        for fill in fills {
                            let pixels = (target + fill.start * 4).assumingMemoryBound(to: UInt32.self)
                            for x in 0..<fill.count { pixels[x] = fill.pixel }
                        }
                    } else {
                        for span in spans { (target + span.start).copyMemory(from: source + span.start, byteCount: span.count) }
                    }
                }
            }
        }
        if scroll >= deepestScroll {
            deepestScroll = scroll
            deepestBottom = bottom
            footer.removeAll(keepingCapacity: true)
            for y in bottom..<height {
                footer.append(contentsOf: UnsafeRawBufferPointer(start: base + y * bytesPerRow, count: rowBytes))
            }
        }
    }

    // MARK: - Matching

    private func analyze(_ base: UnsafeRawPointer, bytesPerRow: Int) -> Analysis {
        let columns = self.columns
        let segments = Self.segments
        let segmentWidth = max(1, columns / segments)
        var luma = [UInt8](repeating: 0, count: columns * height)
        var hashes = [UInt64](repeating: 0, count: height)
        var detailed = [Bool](repeating: false, count: height)
        var segmentDetailed = [Bool](repeating: false, count: height * segments)
        var segmentHashes = [UInt64](repeating: 0, count: height * segments)
        var profile = [Int32](repeating: 0, count: height * Self.profileBands)
        luma.withUnsafeMutableBufferPointer { lumaRows in
            for y in 0..<height {
                let source = base.advanced(by: y * bytesPerRow).assumingMemoryBound(to: UInt8.self)
                let target = lumaRows.baseAddress! + y * columns
                var rowHash: UInt64 = 0xcbf2_9ce4_8422_2325
                var rowLow: UInt8 = 255
                var rowHigh: UInt8 = 0
                for segment in 0..<segments {
                    let start = min(columns, segment * segmentWidth)
                    let end = segment == segments - 1 ? columns : min(columns, start + segmentWidth)
                    var sum: Int32 = 0
                    var hash: UInt64 = 0xcbf2_9ce4_8422_2325 &+ UInt64(segment)
                    var low: UInt8 = 255
                    var high: UInt8 = 0
                    var x = start
                    while x < end {
                        let pixel = source + x * 4
                        let value = UInt8(
                            (UInt32(pixel[2]) * 77 + UInt32(pixel[1]) * 150 + UInt32(pixel[0]) * 29) >> 8)
                        target[x] = value
                        hash = (hash ^ UInt64(value)) &* 0x0000_0100_0000_01b3
                        if value < low { low = value }
                        if value > high { high = value }
                        sum += Int32(value)
                        x += 1
                    }
                    segmentDetailed[y * segments + segment] = end > start && Int16(high) - Int16(low) > Self.tolerance
                    segmentHashes[y * segments + segment] = hash
                    rowHash = (rowHash ^ hash) &* 0x0000_0100_0000_01b3
                    profile[y * Self.profileBands + segment * Self.profileBands / segments] += sum
                    if low < rowLow { rowLow = low }
                    if high > rowHigh { rowHigh = high }
                }
                hashes[y] = rowHash
                detailed[y] = Int16(rowHigh) - Int16(rowLow) > Self.tolerance
            }
        }
        return Analysis(
            luma: luma, hashes: hashes, detailed: detailed, segmentDetailed: segmentDetailed,
            segmentHashes: segmentHashes, profile: profile)
    }

    /// Whether a column segment looks the same in two rows: nearly identical
    /// pixels (allowing anti-aliasing and a caret's edge), or the same shapes
    /// in another shade, as when text fades in while the page scrolls.
    private func segmentMatches(
        _ a: Analysis, _ rowA: Int, _ b: Analysis, _ rowB: Int, _ segment: Int, sameShadeOnly: Bool = false
    ) -> Bool {
        let columns = self.columns
        let segmentWidth = max(1, columns / Self.segments)
        let start = min(columns, segment * segmentWidth)
        let end = segment == Self.segments - 1 ? columns : min(columns, start + segmentWidth)
        let allowed = (end - start) / 25 + 1
        return a.luma.withUnsafeBufferPointer { lumaA in
            b.luma.withUnsafeBufferPointer { lumaB in
                let first = lumaA.baseAddress! + rowA * columns
                let second = lumaB.baseAddress! + rowB * columns
                var differing = 0
                var x = start
                while x < end {
                    let difference = Int16(first[x]) - Int16(second[x])
                    if difference > Self.tolerance || difference < -Self.tolerance {
                        differing += 1
                        if differing > allowed { break }
                    }
                    x += 1
                }
                if differing <= allowed { return true }
                if sameShadeOnly { return false }
                // Normalised correlation ignores a change of brightness or contrast.
                var sumA: Int64 = 0, sumB: Int64 = 0, squaresA: Int64 = 0, squaresB: Int64 = 0, products: Int64 = 0
                for x in start..<end {
                    let p = Int64(first[x])
                    let q = Int64(second[x])
                    sumA += p
                    sumB += q
                    squaresA += p * p
                    squaresB += q * q
                    products += p * q
                }
                let n = Int64(end - start)
                let varianceA = Double(n * squaresA - sumA * sumA)
                let varianceB = Double(n * squaresB - sumB * sumB)
                let covariance = Double(n * products - sumA * sumB)
                // Both need real structure: at least a faint edge across the segment.
                let floor = Double(n * n) * 40
                guard varianceA > floor, varianceB > floor, covariance > 0 else { return false }
                return covariance * covariance >= 0.85 * varianceA * varianceB
            }
        }
    }

    /// Whether a row stayed put between two frames: identical, or different
    /// in at most one segment (a clock, a hover highlight).
    private func rowStays(_ a: Analysis, _ b: Analysis, _ row: Int) -> Bool {
        if a.hashes[row] == b.hashes[row] { return true }
        var differing = 0
        for segment in 0..<Self.segments where !segmentMatches(a, row, b, row, segment, sameShadeOnly: true) {
            differing += 1
            if differing > 1 { return false }
        }
        return true
    }

    /// How far `current` scrolled from `previous` (positive: down; zero: it
    /// changed in place), or nil when nothing lines up.
    private func findShift(_ previous: Analysis, _ current: Analysis, top: Int, bottom: Int) -> Int? {
        let band = bottom - top
        // A tenth of the band left in common is still plenty to match on.
        let maxShift = max(0, band - max(24, band / 10))
        let votes = segmentVotes(previous, current, top: top, bottom: bottom, maxShift: maxShift)
        let stillVotes = Int(votes[maxShift])
        var ranked: [(shift: Int, votes: Int)] = []
        for (index, count) in votes.enumerated() where count >= 2 && index != maxShift {
            ranked.append((index - maxShift, Int(count)))
        }
        ranked.sort { $0.votes > $1.votes }

        // Overwhelming exact evidence settles it, even while much of the band
        // changes (images loading, a hover moving from card to card).
        if let leader = ranked.first {
            let runnerUp = ranked.dropFirst().first { abs($0.shift - leader.shift) > 2 }?.votes ?? 0
            // A static column (a sticky sidebar) votes for staying put while
            // the rest scrolls, so staying only has to be outweighed by half.
            if leader.votes >= Self.convincingVotes && leader.votes >= 2 * runnerUp && 2 * leader.votes >= stillVotes,
               let score = score(previous, current, shift: leader.shift, from: top, to: bottom, need: 0.15)
            {
                trace?("  votes settle \(leader.shift) (\(leader.votes) vs still \(stillVotes), next \(runnerUp)) score \(String(format: "%.2f", score))")
                return leader.shift
            }
        }
        if stillVotes >= Self.convincingVotes && stillVotes >= 2 * (ranked.first?.votes ?? 0) {
            trace?("  votes settle still (\(stillVotes) vs \(ranked.first?.votes ?? 0))")
            return 0
        }

        var candidates = Array(ranked.prefix(3))
        if maxShift >= 1 {
            candidates += profileShifts(previous, current, top: top, bottom: bottom, maxShift: maxShift).map { ($0, 0) }
            if lastShift != 0 && abs(lastShift) <= maxShift { candidates.append((lastShift, 0)) }
        }
        var moving: (shift: Int, score: Double, votes: Int)?
        var tried = Set<Int>()
        for candidate in candidates where tried.insert(candidate.shift).inserted {
            let votes = Int(votes[candidate.shift + maxShift])
            let score = self.score(previous, current, shift: candidate.shift, from: top, to: bottom, need: Self.minimumScore)
            trace?("  candidate \(candidate.shift) votes \(votes) score \(score.map { String(format: "%.2f", $0) } ?? "-")")
            guard let score, score >= Self.minimumScore else { continue }
            if let leader = moving {
                // Clear winner on score; otherwise more evidence, then the
                // speed the user was already scrolling at.
                if score < leader.score - 0.02 { continue }
                if score <= leader.score + 0.02 {
                    if votes < leader.votes { continue }
                    if votes == leader.votes && abs(candidate.shift - lastShift) >= abs(leader.shift - lastShift) {
                        continue
                    }
                }
            }
            moving = (candidate.shift, score, votes)
        }

        // Changed in place (a video playing, an image loading): most of the band
        // still lines up where it was, or most of the frame stayed put.
        let bandStill = score(previous, current, shift: 0, from: top, to: bottom) ?? 0
        let frameStill = bandStill >= Self.minimumScore
            ? bandStill : (score(previous, current, shift: 0, from: 0, to: height, need: 0.7) ?? 0)
        let still = bandStill >= Self.minimumScore || frameStill >= 0.7
        trace?("  still band \(String(format: "%.2f", bandStill)) frame \(String(format: "%.2f", frameStill)) votes \(stillVotes)")

        if let moving, !still || moving.votes > stillVotes || moving.score > bandStill + 0.05 { return moving.shift }
        if still { return 0 }

        // A big part of the band changed while it scrolled (a picture loading
        // as it comes into view): no shift lines up well, but one may still
        // line up far better than any other.
        var scored: [(shift: Int, score: Double)] = []
        for shift in tried {
            if let value = score(previous, current, shift: shift, from: top, to: bottom) { scored.append((shift, value)) }
        }
        scored.sort { $0.score > $1.score }
        let leading = scored.first.map { "\($0.shift)@\(String(format: "%.2f", $0.score))" } ?? "none"
        let leadingVotes = scored.first.map { Int(votes[$0.shift + maxShift]) } ?? 0
        attempt = "max \(maxShift) best \(leading)/\(leadingVotes)v next \(scored.dropFirst().first.map { String(format: "%.2f", $0.score) } ?? "-") still \(String(format: "%.2f", bandStill))"
        guard let best = scored.first, best.score >= 0.3, best.score >= bandStill + 0.15 else { return nil }
        let second = scored.dropFirst().first { abs($0.shift - best.shift) > 2 }?.score ?? 0
        trace?("  relative \(best.shift) score \(String(format: "%.2f", best.score)) next \(String(format: "%.2f", second))")
        // Once lost for a few frames the previous frame is likely stale (the
        // page changed for good), so a smaller lead is enough to recover.
        let lead = lostStreak >= 3 ? 1.3 : 2
        return best.score >= 0.35 || lostStreak >= 3 ? (best.score >= lead * second ? best.shift : nil) : nil
    }

    /// The most frequent pixel in part of a frame, sampled sparsely.
    private func commonPixel(_ base: UnsafeRawPointer, bytesPerRow: Int, columns: Range<Int>, rows: Range<Int>) -> UInt32 {
        var counts: [UInt32: Int] = [:]
        var y = rows.lowerBound
        while y < rows.upperBound {
            let row = (base + y * bytesPerRow).assumingMemoryBound(to: UInt32.self)
            var x = columns.lowerBound
            while x < columns.upperBound {
                counts[row[x], default: 0] += 1
                x += 4
            }
            y += 4
        }
        return counts.max { $0.value < $1.value }?.key ?? 0xFFFF_FFFF
    }

    /// Column segments that stayed exactly where they were while the band
    /// scrolled by `shift`, such as a sticky sidebar.
    private func stillSegments(_ previous: Analysis, _ current: Analysis, shift: Int, top: Int, bottom: Int) -> [Bool] {
        let segments = Self.segments
        var stayed = [Int](repeating: 0, count: segments)
        var moved = [Int](repeating: 0, count: segments)
        var y = top
        while y < bottom {
            let row = y + shift
            for segment in 0..<segments where current.segmentDetailed[y * segments + segment] {
                let hash = current.segmentHashes[y * segments + segment]
                if previous.segmentHashes[y * segments + segment] == hash { stayed[segment] += 1 }
                if row >= top && row < bottom && previous.segmentHashes[row * segments + segment] == hash { moved[segment] += 1 }
            }
            y += 2
        }
        var still = (0..<segments).map { stayed[$0] >= 6 && stayed[$0] > 2 * moved[$0] }
        // A flat stretch between two still segments belongs to the same column.
        for segment in 1..<(segments - 1) where still[segment - 1] && still[segment + 1] { still[segment] = true }
        // A column that is still everywhere is a page that did not scroll.
        return still.allSatisfy { $0 } ? [Bool](repeating: false, count: segments) : still
    }

    /// Exact matches of column segments vote for the shift between them,
    /// zero included. Only segments with detail that occur at most a few
    /// times in the band take part.
    private func segmentVotes(_ previous: Analysis, _ current: Analysis, top: Int, bottom: Int, maxShift: Int) -> [Int32] {
        let segments = Self.segments
        var rowsByHash: [UInt64: [Int32]] = [:]
        rowsByHash.reserveCapacity((bottom - top) * 4)
        for y in top..<bottom {
            for segment in 0..<segments where previous.segmentDetailed[y * segments + segment] && !stillColumns[segment] {
                rowsByHash[previous.segmentHashes[y * segments + segment], default: []].append(Int32(y))
            }
        }
        var votes = [Int32](repeating: 0, count: 2 * maxShift + 1)
        for y in top..<bottom {
            for segment in 0..<segments where current.segmentDetailed[y * segments + segment] && !stillColumns[segment] {
                guard let rows = rowsByHash[current.segmentHashes[y * segments + segment]], rows.count <= 3 else {
                    continue
                }
                for row in rows {
                    let shift = Int(row) - y
                    if abs(shift) <= maxShift { votes[shift + maxShift] += 1 }
                }
            }
        }
        return votes
    }

    /// For content that never repeats a row exactly (scaled or re-rendered
    /// text): the shifts where coarse row profiles agree best.
    private func profileShifts(
        _ previous: Analysis, _ current: Analysis, top: Int, bottom: Int, maxShift: Int
    ) -> [Int] {
        let bands = Self.profileBands
        var costs = [Double](repeating: .infinity, count: 2 * maxShift + 1)
        previous.profile.withUnsafeBufferPointer { first in
            current.profile.withUnsafeBufferPointer { second in
                for shift in -maxShift...maxShift where shift != 0 {
                    let from = max(top, top - shift)
                    let to = min(bottom, bottom - shift)
                    var total: Int64 = 0
                    var rows = 0
                    var y = from
                    while y < to {
                        let a = (y + shift) * bands
                        let b = y * bands
                        for band in 0..<bands { total += Int64(abs(first[a + band] - second[b + band])) }
                        rows += 1
                        y += 2
                    }
                    if rows > 0 { costs[shift + maxShift] = Double(total) / Double(rows) }
                }
            }
        }
        var minima: [(shift: Int, cost: Double)] = []
        for index in costs.indices where costs[index].isFinite {
            let left = index > 0 ? costs[index - 1] : .infinity
            let right = index + 1 < costs.count ? costs[index + 1] : .infinity
            if costs[index] <= left && costs[index] <= right { minima.append((index - maxShift, costs[index])) }
        }
        minima.sort { $0.cost < $1.cost }
        return minima.prefix(3).map(\.shift)
    }

    /// The share of detailed segments in rows `from..<to` that line up at
    /// `shift` (every other row), or nil when too few carry detail to tell.
    /// Gives up with nil once the share can no longer reach `need`.
    private func score(
        _ previous: Analysis, _ current: Analysis, shift: Int, from: Int, to: Int, need: Double = 0
    ) -> Double? {
        let low = max(from, from - shift)
        let high = min(to, to - shift)
        guard high > low else { return nil }
        let segments = Self.segments
        var total = 0
        var y = low
        while y < high {
            let row = y + shift
            for segment in 0..<segments
            where !stillColumns[segment]
                && (current.segmentDetailed[y * segments + segment] || previous.segmentDetailed[row * segments + segment])
            {
                total += 1
            }
            y += 2
        }
        guard total >= 24 else { return nil }
        let allowedMisses = need > 0 ? Int(Double(total) * (1 - need)) : total
        var misses = 0
        y = low
        while y < high {
            let row = y + shift
            if previous.hashes[row] != current.hashes[y] {
                for segment in 0..<segments
                where !stillColumns[segment]
                    && (current.segmentDetailed[y * segments + segment] || previous.segmentDetailed[row * segments + segment])
                {
                    if !segmentMatches(previous, row, current, y, segment) {
                        misses += 1
                        if misses > allowedMisses { return nil }
                    }
                }
            }
            y += 2
        }
        return Double(total - misses) / Double(total)
    }
}
