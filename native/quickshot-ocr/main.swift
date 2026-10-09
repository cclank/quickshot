import Foundation
import ImageIO
import Vision

private let maximumTextBytes = 2 * 1024 * 1024

private func fail(_ message: String, code: Int32 = 1) -> Never {
    FileHandle.standardError.write(Data("\(message)\n".utf8))
    exit(code)
}

// quickshot-ocr <image-path>          the text, line by line
// quickshot-ocr --words <image-path>  every word with its box, for smart redaction
let arguments = Array(CommandLine.arguments.dropFirst())
let wordsMode = arguments.count == 2 && arguments[0] == "--words"
guard arguments.count == 1 || wordsMode else {
    fail("Usage: quickshot-ocr [--words] <image-path>", code: 2)
}

let imageURL = URL(fileURLWithPath: arguments[arguments.count - 1])
guard
    let imageSource = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
    let image = CGImageSourceCreateImageAtIndex(
        imageSource,
        0,
        // Words mode crops the image into tiles, so decode it once up front.
        [kCGImageSourceShouldCache: false, kCGImageSourceShouldCacheImmediately: wordsMode] as CFDictionary
    )
else {
    fail("Could not decode the input image", code: 3)
}

private func makeRequest(languageCorrection: Bool) -> VNRecognizeTextRequest {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
    request.usesLanguageCorrection = languageCorrection
    if #available(macOS 13.0, *) {
        request.automaticallyDetectsLanguage = true
    }
    return request
}

private func writeJSON(_ response: [String: Any]) throws {
    let responseData = try JSONSerialization.data(withJSONObject: response)
    FileHandle.standardOutput.write(responseData)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

/// Tiles along one side. Vision scales an image down to a fixed budget before
/// reading it, so small text on a large or long capture comes out unreadable;
/// tiles of at most `tile` pixels keep it legible. Neighbouring tiles overlap,
/// and each keeps the words centred in its share of the overlap.
private func spans(length: Int, tile: Int, overlap: Int) -> [(start: Int, end: Int, keepFrom: Int, keepTo: Int)] {
    guard length > tile else { return [(0, length, 0, length)] }
    let step = tile - overlap
    let count = Int((Double(length - overlap) / Double(step)).rounded(.up))
    let starts = (0..<count).map { min($0 * step, length - tile) }
    return starts.enumerated().map { index, start in
        let end = start + tile
        let keepFrom = index == 0 ? 0 : (start + starts[index - 1] + tile) / 2
        let keepTo = index == count - 1 ? length : (starts[index + 1] + end) / 2
        return (start, end, keepFrom, keepTo)
    }
}

private func recognizeWords() throws {
    let width = image.width
    let height = image.height
    var words: [[String: Any]] = []
    var textBytes = 0
    var line = 0
    for row in spans(length: height, tile: 2048, overlap: 256) {
        for column in spans(length: width, tile: 2048, overlap: 512) {
            let tileRect = CGRect(x: column.start, y: row.start, width: column.end - column.start, height: row.end - row.start)
            guard let tile = image.cropping(to: tileRect) else { continue }
            // Identifiers are not dictionary words: keep what is on screen.
            let request = makeRequest(languageCorrection: false)
            try VNImageRequestHandler(cgImage: tile, orientation: .up).perform([request])
            let tileWidth = Double(tileRect.width)
            let tileHeight = Double(tileRect.height)
            for observation in request.results ?? [] {
                guard let candidate = observation.topCandidates(1).first else { continue }
                let string = candidate.string
                var lineWords: [[String: Any]] = []
                var index = string.startIndex
                while index < string.endIndex {
                    guard let start = string[index...].firstIndex(where: { !$0.isWhitespace }) else { break }
                    let end = string[start...].firstIndex(where: { $0.isWhitespace }) ?? string.endIndex
                    index = end
                    // Vision's box for part of a line; normalized, origin bottom left.
                    let box = (try? candidate.boundingBox(for: start..<end))?.boundingBox ?? observation.boundingBox
                    let x = Double(tileRect.minX) + box.minX * tileWidth
                    let y = Double(tileRect.minY) + (1 - box.maxY) * tileHeight
                    let w = box.width * tileWidth
                    let h = box.height * tileHeight
                    let centreX = Int(x + w / 2)
                    let centreY = Int(y + h / 2)
                    guard
                        centreX >= column.keepFrom, centreX < column.keepTo,
                        centreY >= row.keepFrom, centreY < row.keepTo
                    else { continue }
                    let text = String(string[start..<end])
                    textBytes += text.lengthOfBytes(using: .utf8)
                    lineWords.append([
                        "text": text, "line": line,
                        "x": Int(x.rounded()), "y": Int(y.rounded()),
                        "w": Int(w.rounded()), "h": Int(h.rounded()),
                    ])
                }
                guard !lineWords.isEmpty else { continue }
                words.append(contentsOf: lineWords)
                line += 1
            }
            guard textBytes <= maximumTextBytes else {
                fail("Recognized text exceeds the output limit", code: 5)
            }
        }
    }
    try writeJSON(["width": width, "height": height, "words": words])
}

private func recognizeText() throws {
    let request = makeRequest(languageCorrection: true)
    let handler = VNImageRequestHandler(cgImage: image, orientation: .up)
    try handler.perform([request])

    let lines = (request.results ?? []).compactMap {
        $0.topCandidates(1).first?.string
    }
    let text = lines
        .joined(separator: "\n")
        .trimmingCharacters(in: .whitespacesAndNewlines)
    guard text.lengthOfBytes(using: .utf8) <= maximumTextBytes else {
        fail("Recognized text exceeds the output limit", code: 5)
    }
    try writeJSON([
        "text": text,
        "lineCount": lines.count,
    ])
}

do {
    if wordsMode {
        try recognizeWords()
    } else {
        try recognizeText()
    }
} catch {
    fail("Text recognition failed: \(error.localizedDescription)", code: 4)
}
