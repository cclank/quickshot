import AppKit
import Foundation

guard CommandLine.arguments.count == 2 else {
    fputs("Usage: swift list-mac-app-registrations.swift <bundle-id>\n", stderr)
    exit(2)
}

let identifier = CommandLine.arguments[1]
let workspace = NSWorkspace.shared
let result: [String: Any] = [
    "preferred": workspace.urlForApplication(withBundleIdentifier: identifier)?.path as Any? ?? NSNull(),
    "registered": workspace.urlsForApplications(withBundleIdentifier: identifier).map(\.path),
]
let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
print(String(decoding: data, as: UTF8.self))
