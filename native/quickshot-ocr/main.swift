import Foundation
import ImageIO
import Vision

private let maximumTextBytes = 2 * 1024 * 1024

private func fail(_ message: String, code: Int32 = 1) -> Never {
    FileHandle.standardError.write(Data("\(message)\n".utf8))
    exit(code)
}

guard CommandLine.arguments.count == 2 else {
    fail("Usage: quickshot-ocr <image-path>", code: 2)
}

let imageURL = URL(fileURLWithPath: CommandLine.arguments[1])
guard
    let imageSource = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
    let image = CGImageSourceCreateImageAtIndex(
        imageSource,
        0,
        [kCGImageSourceShouldCache: false] as CFDictionary
    )
else {
    fail("Could not decode the input image", code: 3)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
request.usesLanguageCorrection = true
if #available(macOS 13.0, *) {
    request.automaticallyDetectsLanguage = true
}

do {
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
    let response: [String: Any] = [
        "text": text,
        "lineCount": lines.count,
    ]
    let responseData = try JSONSerialization.data(withJSONObject: response)
    FileHandle.standardOutput.write(responseData)
    FileHandle.standardOutput.write(Data("\n".utf8))
} catch {
    fail("Text recognition failed: \(error.localizedDescription)", code: 4)
}
