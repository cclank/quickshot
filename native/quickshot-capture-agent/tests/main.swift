import Foundation

// Checks ScrollStitcher against synthetic pages: every frame is cut from a
// known tall image, so a correct stitch reproduces that image exactly.
// Run with `npm run test:scroll-stitcher`.

/// A BGRA image, `width * 4` bytes per row.
struct Bitmap {
    let width: Int
    var height: Int
    var pixels: [UInt8]

    init(width: Int, height: Int, gray: UInt8 = 255) {
        self.width = width
        self.height = height
        pixels = [UInt8](repeating: gray, count: width * height * 4)
    }

    /// Glyph-like ink: random dots of `cell` pixels, so every row differs
    /// from its neighbours the way lines through real letters do.
    mutating func ink(x: Int, y: Int, width w: Int, height h: Int, shade: UInt8, cell: Int, random: inout Random) {
        for top in stride(from: y, to: y + h, by: cell) {
            for left in stride(from: x, to: x + w, by: cell) where random.next(100) < 45 {
                fill(x: left, y: top, width: cell, height: min(cell, y + h - top), b: shade, g: shade, r: shade)
            }
        }
    }

    mutating func fill(x: Int, y: Int, width w: Int, height h: Int, b: UInt8, g: UInt8, r: UInt8) {
        guard max(0, y) < min(height, y + h), max(0, x) < min(width, x + w) else { return }
        for row in max(0, y)..<min(height, y + h) {
            for column in max(0, x)..<min(width, x + w) {
                let index = (row * width + column) * 4
                pixels[index] = b
                pixels[index + 1] = g
                pixels[index + 2] = r
                pixels[index + 3] = 255
            }
        }
    }

    func rows(_ range: Range<Int>) -> ArraySlice<UInt8> {
        pixels[(range.lowerBound * width * 4)..<(range.upperBound * width * 4)]
    }
}

struct Random {
    var state: UInt64
    mutating func next(_ bound: Int) -> Int {
        state ^= state << 13
        state ^= state >> 7
        state ^= state << 17
        return Int(state % UInt64(bound))
    }
}

/// Something like a web page: a coloured title bar, lines of "words",
/// headings, pictures and a long blank gap, then a footer bar.
func makePage(width: Int, height: Int, seed: UInt64 = 7, blankGap: Int = 0) -> Bitmap {
    var page = Bitmap(width: width, height: height)
    var random = Random(state: seed)
    page.fill(x: 0, y: 0, width: width, height: 52, b: 160, g: 90, r: 40)
    page.fill(x: 16, y: 18, width: 120, height: 16, b: 255, g: 255, r: 255)
    var y = 70
    var gapPlaced = blankGap == 0
    while y < height - 60 {
        if !gapPlaced && y > height / 2 {
            y += blankGap
            gapPlaced = true
            continue
        }
        switch random.next(10) {
        case 0:
            // A picture.
            let tall = 80 + random.next(120)
            page.fill(
                x: 24 + random.next(80), y: y, width: width / 2, height: tall,
                b: UInt8(random.next(200)), g: UInt8(random.next(200)), r: UInt8(random.next(200)))
            y += tall + 18
        case 1:
            // A heading.
            var x = 24
            while x < width / 2 {
                let word = 20 + random.next(70)
                page.ink(x: x, y: y, width: word, height: 22, shade: 30, cell: 3, random: &random)
                x += word + 14
            }
            y += 40
        default:
            // A line of text.
            var x = 24
            let end = width - 40 - random.next(width / 3)
            while x < end {
                let word = 8 + random.next(60)
                let shade = UInt8(40 + random.next(60))
                page.ink(x: x, y: y + random.next(3), width: word, height: 12, shade: shade, cell: 2, random: &random)
                x += word + 7
            }
            y += 24
        }
    }
    page.fill(x: 0, y: height - 44, width: width, height: 44, b: 70, g: 70, r: 70)
    page.fill(x: 24, y: height - 30, width: 200, height: 14, b: 210, g: 210, r: 210)
    return page
}

/// What the screen shows with the page scrolled by `scroll`: the first
/// `header` rows and last `footer` rows stay put, the rest moves.
func frame(_ page: Bitmap, height: Int, header: Int, footer: Int, scroll: Int) -> Bitmap {
    var shot = Bitmap(width: page.width, height: height)
    let rowBytes = page.width * 4
    func copy(from sourceRow: Int, to targetRow: Int, count: Int) {
        guard count > 0 else { return }
        shot.pixels.replaceSubrange(
            (targetRow * rowBytes)..<((targetRow + count) * rowBytes),
            with: page.pixels[(sourceRow * rowBytes)..<((sourceRow + count) * rowBytes)])
    }
    copy(from: 0, to: 0, count: header)
    copy(from: header + scroll, to: header, count: height - header - footer)
    copy(from: page.height - footer, to: height - footer, count: footer)
    return shot
}

func maxScroll(_ page: Bitmap, height: Int) -> Int { page.height - height }

final class Run {
    let stitcher: ScrollStitcher
    var outcomes: [ScrollStitcher.Outcome] = []
    init(width: Int, height: Int, maxHeight: Int = 100_000, ignoredRight: Int = 0) {
        stitcher = ScrollStitcher(width: width, height: height, maxHeight: maxHeight, ignoredRight: ignoredRight)
    }
    @discardableResult
    func add(_ shot: Bitmap) -> ScrollStitcher.Outcome {
        let outcome = shot.pixels.withUnsafeBytes { stitcher.add($0.baseAddress!, bytesPerRow: shot.width * 4) }
        outcomes.append(outcome)
        return outcome
    }
    func finish() -> Bitmap {
        let rows = stitcher.finish() ?? 0
        var image = Bitmap(width: stitcher.width, height: rows)
        image.pixels = stitcher.output
        return image
    }
}

var failures = 0
func check(_ condition: Bool, _ message: @autoclosure () -> String) {
    if !condition {
        failures += 1
        print("    FAIL: \(message())")
    }
}

func test(_ name: String, _ body: () -> Void) {
    let before = failures
    body()
    print(failures == before ? "ok   \(name)" : "FAIL \(name)")
}

/// The first row where two images differ, comparing only `columns` columns.
func firstDifference(_ a: Bitmap, _ b: Bitmap, columns: Int? = nil, from left: Int = 0) -> Int? {
    let compared = (columns ?? a.width) * 4
    for row in 0..<min(a.height, b.height) {
        let start = row * a.width * 4
        if a.pixels[(start + left * 4)..<(start + compared)] != b.pixels[(start + left * 4)..<(start + compared)] { return row }
    }
    return a.height == b.height ? nil : min(a.height, b.height)
}

func expectSame(_ result: Bitmap, _ expected: Bitmap, columns: Int? = nil, from left: Int = 0) {
    check(result.height == expected.height, "height \(result.height), expected \(expected.height)")
    if let row = firstDifference(result, expected, columns: columns, from: left) {
        check(false, "images differ from row \(row)")
    }
}

/// Scrolls through the whole page along `positions`.
func stitch(_ page: Bitmap, height: Int, header: Int, footer: Int, positions: [Int], ignoredRight: Int = 0) -> (Run, Bitmap) {
    let run = Run(width: page.width, height: height, ignoredRight: ignoredRight)
    for position in positions {
        run.add(frame(page, height: height, header: header, footer: footer, scroll: position))
    }
    return (run, run.finish())
}

func steps(from start: Int, to end: Int, by step: Int) -> [Int] {
    var values: [Int] = []
    var value = start
    while step > 0 ? value < end : value > end {
        values.append(value)
        value += step
    }
    values.append(end)
    return values
}

let width = 640
let height = 480

test("steady scrolling reproduces the page") {
    let page = makePage(width: width, height: 3000)
    let (_, result) = stitch(page, height: height, header: 0, footer: 0, positions: steps(from: 0, to: maxScroll(page, height: height), by: 37))
    expectSame(result, page)
}

test("a fixed header and footer appear once") {
    let page = makePage(width: width, height: 3200, seed: 11)
    let (_, result) = stitch(page, height: height, header: 52, footer: 44, positions: steps(from: 0, to: maxScroll(page, height: height), by: 61))
    expectSame(result, page)
}

test("uneven speed, pauses and scrolling back up") {
    let page = makePage(width: width, height: 4000, seed: 23)
    let end = maxScroll(page, height: height)
    var positions = [0, 0, 3, 9, 30, 30, 30, 90, 200, 360]
    positions += [300, 220, 150, 220, 300, 400, 410]
    positions += steps(from: 410, to: end, by: 133)
    positions += [end, end]
    let (run, result) = stitch(page, height: height, header: 52, footer: 44, positions: positions)
    expectSame(result, page)
    check(run.outcomes.contains(.behind), "scrolling back up is reported")
    check(run.outcomes.contains(.unchanged), "a frame that did not move is reported")
}

test("a long blank gap does not break the stitch") {
    let page = makePage(width: width, height: 3600, seed: 5, blankGap: 220)
    let (_, result) = stitch(page, height: height, header: 52, footer: 44, positions: steps(from: 0, to: maxScroll(page, height: height), by: 45))
    expectSame(result, page)
}

test("a scroll past the overlap is lost and found again") {
    let page = makePage(width: width, height: 3000, seed: 31)
    let end = maxScroll(page, height: height)
    let run = Run(width: width, height: height)
    for position in [0, 100, 200, 1200] { run.add(frame(page, height: height, header: 52, footer: 44, scroll: position)) }
    check(run.outcomes.last == .lost, "a jump past the overlap is lost, got \(String(describing: run.outcomes.last))")
    for position in [600, 300] + steps(from: 300, to: end, by: 90) {
        run.add(frame(page, height: height, header: 52, footer: 44, scroll: position))
    }
    expectSame(run.finish(), page)
}

test("the capture starts where scrolling down begins") {
    let page = makePage(width: width, height: 3000, seed: 41)
    let end = maxScroll(page, height: height)
    // Starts half way down, scrolls up to 200 first, then down to the end.
    let positions = [900, 700, 500, 350, 200] + steps(from: 200, to: end, by: 70)
    let (_, result) = stitch(page, height: height, header: 52, footer: 44, positions: positions)
    var expected = Bitmap(width: width, height: page.height - 200)
    expected.pixels = Array(page.rows(0..<52)) + Array(page.rows(252..<page.height))
    expectSame(result, expected)
}

test("the first frames follow the window as it settles") {
    let page = makePage(width: width, height: 2600, seed: 43)
    let run = Run(width: width, height: height)
    // An inactive window: a grey title bar instead of the coloured one.
    var inactive = frame(page, height: height, header: 52, footer: 44, scroll: 0)
    inactive.fill(x: 0, y: 0, width: width, height: 52, b: 200, g: 200, r: 200)
    run.add(inactive)
    for position in steps(from: 0, to: maxScroll(page, height: height), by: 50) {
        run.add(frame(page, height: height, header: 52, footer: 44, scroll: position))
    }
    expectSame(run.finish(), page)
}

test("an overlay scroll bar in the ignored columns is tolerated") {
    let page = makePage(width: width, height: 3000, seed: 53)
    let end = maxScroll(page, height: height)
    let run = Run(width: width, height: height, ignoredRight: 20)
    for position in steps(from: 0, to: end, by: 55) {
        var shot = frame(page, height: height, header: 0, footer: 0, scroll: position)
        // The thumb moves with the scroll position and the track darkens.
        shot.fill(x: width - 14, y: 0, width: 10, height: height, b: 225, g: 225, r: 225)
        shot.fill(x: width - 12, y: position * (height - 80) / max(1, end), width: 6, height: 80, b: 120, g: 120, r: 120)
        run.add(shot)
    }
    expectSame(run.finish(), page, columns: width - 20)
}

test("a hover highlight under a still pointer is tolerated") {
    let page = makePage(width: width, height: 3000, seed: 61)
    let run = Run(width: width, height: height)
    for position in steps(from: 0, to: maxScroll(page, height: height), by: 64) {
        var shot = frame(page, height: height, header: 0, footer: 0, scroll: position)
        // Whatever row sits under the pointer at y = 200 turns light blue.
        for row in 188..<212 {
            for column in 0..<width {
                let index = (row * width + column) * 4
                shot.pixels[index] = shot.pixels[index] / 2 + 120
            }
        }
        run.add(shot)
    }
    let result = run.finish()
    check(result.height == page.height, "height \(result.height), expected \(page.height)")
    // The latest view of each row wins, so only the last frame's highlight is left.
    let last = maxScroll(page, height: height)
    var dirty: [Int] = []
    for row in 0..<result.height where result.rows(row..<(row + 1)) != page.rows(row..<(row + 1)) { dirty.append(row) }
    check(dirty.allSatisfy { (last + 188)..<(last + 212) ~= $0 }, "rows differ outside the last highlight: \(dirty.prefix(5))")
}

test("content changing in place keeps the capture going") {
    let page = makePage(width: width, height: 3000, seed: 101)
    let run = Run(width: width, height: height)
    var loaded = page
    // A picture that finishes loading while the page stands still.
    loaded.fill(x: 100, y: 700, width: 300, height: 120, b: 20, g: 140, r: 220)
    for position in [0, 60, 120, 180] { run.add(frame(page, height: height, header: 52, footer: 44, scroll: position)) }
    run.add(frame(loaded, height: height, header: 52, footer: 44, scroll: 180))
    for position in steps(from: 180, to: maxScroll(page, height: height), by: 70) {
        run.add(frame(loaded, height: height, header: 52, footer: 44, scroll: position))
    }
    check(!run.outcomes.contains(.lost), "nothing is lost: \(run.outcomes)")
    expectSame(run.finish(), loaded)
}

test("a picture that loads while scrolling ends up loaded") {
    let page = makePage(width: width, height: 3000, seed: 103)
    var loaded = page
    loaded.fill(x: 60, y: 900, width: 500, height: 160, b: 200, g: 60, r: 120)
    let run = Run(width: width, height: height)
    for position in steps(from: 0, to: maxScroll(page, height: height), by: 50) {
        // Still a placeholder until the page has scrolled past 700.
        run.add(frame(position < 700 ? page : loaded, height: height, header: 52, footer: 44, scroll: position))
    }
    check(!run.outcomes.contains(.lost), "nothing is lost")
    expectSame(run.finish(), loaded)
}

test("text fading in while the page scrolls is followed") {
    let page = makePage(width: width, height: 3000, seed: 107)
    let run = Run(width: width, height: height)
    for (index, position) in steps(from: 0, to: maxScroll(page, height: height), by: 45).enumerated() {
        var shot = frame(page, height: height, header: 0, footer: 0, scroll: position)
        // Every third frame shows the lower half still fading in: lighter ink.
        if index % 3 == 1 {
            for row in (height / 2)..<height {
                for column in 0..<width {
                    let i = (row * width + column) * 4
                    for channel in 0..<3 { shot.pixels[i + channel] = UInt8(255 - (255 - Int(shot.pixels[i + channel])) * 6 / 10) }
                }
            }
        }
        run.add(shot)
    }
    check(!run.outcomes.contains(.lost), "nothing is lost")
    let result = run.finish()
    check(result.height == page.height, "height \(result.height), expected \(page.height)")
}

test("a sticky sidebar shows once, above blank space") {
    let page = makePage(width: width, height: 3000, seed: 109)
    let run = Run(width: width, height: height)
    var sidebar = Bitmap(width: 120, height: height)
    for row in stride(from: 70, to: height - 40, by: 26) { sidebar.fill(x: 14, y: row, width: 80, height: 10, b: 160, g: 90, r: 40) }
    for position in steps(from: 0, to: maxScroll(page, height: height), by: 60) {
        var shot = frame(page, height: height, header: 52, footer: 44, scroll: position)
        for row in 52..<(height - 44) {
            let target = (row * width) * 4
            shot.pixels.replaceSubrange(target..<(target + 120 * 4), with: sidebar.pixels[(row * 120 * 4)..<((row + 1) * 120 * 4)])
        }
        run.add(shot)
    }
    check(!run.outcomes.contains(.lost), "nothing is lost")
    let result = run.finish()
    check(result.height == page.height, "height \(result.height), expected \(page.height)")
    // Well below the first screen the sidebar column is plain background.
    var marked = 0
    for row in (height + 200)..<(result.height - height) {
        for column in 0..<110 where result.pixels[(row * width + column) * 4] != 255 { marked += 1 }
    }
    check(marked == 0, "\(marked) sidebar pixels repeated down the image")
    expectSame(Bitmap(width: width, height: result.height).withPixels(result.pixels[...]), page, columns: nil, from: 120)
}

test("the image stops at the maximum height") {
    let page = makePage(width: width, height: 5000, seed: 71)
    let run = Run(width: width, height: height, maxHeight: 2000)
    for position in steps(from: 0, to: maxScroll(page, height: height), by: 80) {
        run.add(frame(page, height: height, header: 52, footer: 44, scroll: position))
    }
    check(run.outcomes.contains(.full), "reaching the maximum is reported")
    let result = run.finish()
    check(result.height == 2000, "height \(result.height), expected 2000")
    if let row = firstDifference(result, Bitmap(width: width, height: 1956).withPixels(page.rows(0..<1956))) {
        check(row >= 1956, "content differs from row \(row)")
    }
}

test("a frame that never moves gives that frame") {
    let page = makePage(width: width, height: 2000, seed: 83)
    let still = frame(page, height: height, header: 52, footer: 44, scroll: 300)
    let (run, result) = stitch(page, height: height, header: 52, footer: 44, positions: [300, 300, 300])
    expectSame(result, still)
    check(run.outcomes == [.waiting, .unchanged, .unchanged], "outcomes \(run.outcomes)")
}

test("progress reports the height so far") {
    let page = makePage(width: width, height: 2400, seed: 89)
    let run = Run(width: width, height: height)
    run.add(frame(page, height: height, header: 52, footer: 44, scroll: 0))
    check(run.stitcher.projectedHeight == height, "first frame height \(run.stitcher.projectedHeight)")
    run.add(frame(page, height: height, header: 52, footer: 44, scroll: 120))
    check(run.stitcher.projectedHeight == height + 120, "after 120 rows \(run.stitcher.projectedHeight)")
    var rows = 0
    run.stitcher.withSegments { segments in rows = segments.reduce(0) { $0 + $1.rows } }
    check(rows == height + 120, "segments hold \(rows) rows")
}

test("a large frame stitches quickly") {
    let large = makePage(width: 1600, height: 9000, seed: 97)
    let run = Run(width: 1600, height: 1800, ignoredRight: 40)
    let frames = steps(from: 0, to: maxScroll(large, height: 1800), by: 180).map {
        frame(large, height: 1800, header: 52, footer: 44, scroll: $0)
    }
    let start = Date()
    for shot in frames { run.add(shot) }
    let perFrame = Date().timeIntervalSince(start) / Double(frames.count) * 1000
    print(String(format: "     %.1f ms per 1600x1800 frame", perFrame))
    check(perFrame < 60, "too slow for live capture")
    expectSame(run.finish(), large, columns: 1560)
}

extension Bitmap {
    func withPixels(_ slice: ArraySlice<UInt8>) -> Bitmap {
        var copy = self
        copy.pixels = Array(slice)
        copy.height = slice.count / (width * 4)
        return copy
    }
}

if failures > 0 {
    print("\(failures) check(s) failed")
    exit(1)
}
print("All scroll stitcher checks passed")
