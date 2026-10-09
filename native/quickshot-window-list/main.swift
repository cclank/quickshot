import Foundation

// Prints the on-screen application windows, front to back, as JSON.
// Arguments: a PID whose windows to skip (-1 for none), then window numbers
// to skip. See WindowList.swift.

let excludedPid: Int32 = CommandLine.arguments.count > 1
    ? Int32(CommandLine.arguments[1]) ?? -1
    : -1
let excludedWindows = Set(CommandLine.arguments.dropFirst(2).compactMap { Int($0) })

let data = try JSONSerialization.data(
    withJSONObject: listOnScreenWindows(excludingPid: excludedPid, excludingWindows: excludedWindows))
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write(Data("\n".utf8))
