import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

struct Snapshot {
  let image: CGImage
  let pixels: [UInt8]
}

enum SnapshotError: LocalizedError {
  case usage
  case decode(String)
  case dimensions
  case context
  case encode(String)

  var errorDescription: String? {
    switch self {
    case .usage:
      return "Usage: swift scripts/compare-preview-snapshots.swift <reference.png> <candidate.png> [diff.png]"
    case .decode(let path):
      return "Unable to decode snapshot: \(path)"
    case .dimensions:
      return "Snapshot dimensions do not match"
    case .context:
      return "Unable to create an RGBA bitmap context"
    case .encode(let path):
      return "Unable to write diff image: \(path)"
    }
  }
}

func loadSnapshot(at path: String) throws -> Snapshot {
  let url = URL(fileURLWithPath: path) as CFURL
  guard
    let source = CGImageSourceCreateWithURL(url, nil),
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
  else {
    throw SnapshotError.decode(path)
  }

  var pixels = [UInt8](repeating: 0, count: image.width * image.height * 4)
  let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
  let bitmapInfo =
    CGBitmapInfo.byteOrder32Big.rawValue
    | CGImageAlphaInfo.premultipliedLast.rawValue
  let rendered = pixels.withUnsafeMutableBytes { bytes -> Bool in
    guard
      let context = CGContext(
        data: bytes.baseAddress,
        width: image.width,
        height: image.height,
        bitsPerComponent: 8,
        bytesPerRow: image.width * 4,
        space: colorSpace,
        bitmapInfo: bitmapInfo
      )
    else {
      return false
    }
    context.interpolationQuality = .none
    context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
    return true
  }
  guard rendered else { throw SnapshotError.context }
  return Snapshot(image: image, pixels: pixels)
}

func writeDiff(
  pixels: [UInt8],
  width: Int,
  height: Int,
  to path: String
) throws {
  let data = Data(pixels) as CFData
  guard
    let provider = CGDataProvider(data: data),
    let image = CGImage(
      width: width,
      height: height,
      bitsPerComponent: 8,
      bitsPerPixel: 32,
      bytesPerRow: width * 4,
      space: CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGBitmapInfo(
        rawValue: CGBitmapInfo.byteOrder32Big.rawValue
          | CGImageAlphaInfo.premultipliedLast.rawValue
      ),
      provider: provider,
      decode: nil,
      shouldInterpolate: false,
      intent: .defaultIntent
    ),
    let destination = CGImageDestinationCreateWithURL(
      URL(fileURLWithPath: path) as CFURL,
      UTType.png.identifier as CFString,
      1,
      nil
    )
  else {
    throw SnapshotError.encode(path)
  }
  CGImageDestinationAddImage(destination, image, nil)
  guard CGImageDestinationFinalize(destination) else {
    throw SnapshotError.encode(path)
  }
}

do {
  guard CommandLine.arguments.count == 3 || CommandLine.arguments.count == 4 else {
    throw SnapshotError.usage
  }
  let reference = try loadSnapshot(at: CommandLine.arguments[1])
  let candidate = try loadSnapshot(at: CommandLine.arguments[2])
  guard
    reference.image.width == candidate.image.width,
    reference.image.height == candidate.image.height
  else {
    throw SnapshotError.dimensions
  }

  let width = reference.image.width
  let height = reference.image.height
  let pixelCount = width * height
  var absoluteDelta = 0
  var maximumDelta = 0
  var visiblyDifferentPixels = 0
  var diffPixels = [UInt8](repeating: 255, count: pixelCount * 4)

  for pixelIndex in 0..<pixelCount {
    let offset = pixelIndex * 4
    var pixelMaximum = 0
    for channel in 0..<3 {
      let delta = abs(Int(reference.pixels[offset + channel]) - Int(candidate.pixels[offset + channel]))
      absoluteDelta += delta
      pixelMaximum = max(pixelMaximum, delta)
      maximumDelta = max(maximumDelta, delta)
    }
    if pixelMaximum >= 24 {
      visiblyDifferentPixels += 1
    }
    diffPixels[offset] = UInt8(pixelMaximum)
    diffPixels[offset + 1] = UInt8(min(pixelMaximum * 2, 255))
    diffPixels[offset + 2] = 0
  }

  if CommandLine.arguments.count == 4 {
    try writeDiff(
      pixels: diffPixels,
      width: width,
      height: height,
      to: CommandLine.arguments[3]
    )
  }

  let result: [String: Any] = [
    "width": width,
    "height": height,
    "meanAbsoluteChannelError": Double(absoluteDelta) / Double(pixelCount * 3 * 255),
    "maximumChannelDelta": maximumDelta,
    "visiblyDifferentPixelRatio": Double(visiblyDifferentPixels) / Double(pixelCount),
  ]
  let json = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
  print(String(decoding: json, as: UTF8.self))
} catch {
  FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
  exit(1)
}
