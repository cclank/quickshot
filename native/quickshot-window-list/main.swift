import Foundation

// Prints the on-screen application windows, front to back, as JSON.
// Pass QuickShot's own PID to skip it. See WindowList.swift.

let excludedPid: Int32 = CommandLine.arguments.count > 1
    ? Int32(CommandLine.arguments[1]) ?? -1
    : -1

let data = try JSONSerialization.data(withJSONObject: listOnScreenWindows(excludingPid: excludedPid))
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write(Data("\n".utf8))
