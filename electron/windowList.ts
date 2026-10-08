export type ScreenWindow = {
	/** macOS CGWindowID, used to capture this one window; absent on Windows. */
	id?: number;
	x: number;
	y: number;
	width: number;
	height: number;
	app: string;
	title: string;
};

export type Bounds = { x: number; y: number; width: number; height: number };

const MAX_WINDOWS = 200;
const MIN_VISIBLE_SIZE = 24;

/** Validates helper output; anything malformed is dropped rather than trusted. */
export function parseWindowList(stdout: string): ScreenWindow[] {
	let value: unknown;
	try {
		value = JSON.parse(stdout.replace(/^﻿/, "").trim() || "[]");
	} catch {
		return [];
	}
	return normalizeWindowList(value);
}

/** Validates an already-parsed window list, e.g. from the capture agent. */
export function normalizeWindowList(value: unknown): ScreenWindow[] {
	if (!Array.isArray(value)) return [];
	const windows: ScreenWindow[] = [];
	for (const entry of value.slice(0, MAX_WINDOWS)) {
		if (!entry || typeof entry !== "object") continue;
		const { id, x, y, width, height, app, title } = entry as Record<string, unknown>;
		if (
			![x, y, width, height].every((number) => typeof number === "number" && Number.isFinite(number)) ||
			(width as number) <= 0 ||
			(height as number) <= 0
		) {
			continue;
		}
		windows.push({
			...(typeof id === "number" && Number.isInteger(id) && id > 0 ? { id } : {}),
			x: x as number,
			y: y as number,
			width: width as number,
			height: height as number,
			app: typeof app === "string" ? app.slice(0, 80) : "",
			title: typeof title === "string" ? title.slice(0, 120) : "",
		});
	}
	return windows;
}

/**
 * Clips windows (in global DIP coordinates, front to back) to one display and
 * converts them to that display's local coordinates, which is the overlay's
 * CSS pixel space.
 */
export function toDisplayLocalWindows(windows: ScreenWindow[], display: Bounds): ScreenWindow[] {
	const result: ScreenWindow[] = [];
	for (const window of windows) {
		const left = Math.max(window.x, display.x);
		const top = Math.max(window.y, display.y);
		const right = Math.min(window.x + window.width, display.x + display.width);
		const bottom = Math.min(window.y + window.height, display.y + display.height);
		if (right - left < MIN_VISIBLE_SIZE || bottom - top < MIN_VISIBLE_SIZE) continue;
		result.push({
			...window,
			x: Math.round(left - display.x),
			y: Math.round(top - display.y),
			width: Math.round(right - left),
			height: Math.round(bottom - top),
		});
	}
	return result;
}

/**
 * Enumerates visible top-level windows on Windows in Z order (front first).
 * DWM's extended frame bounds exclude the invisible resize borders and are
 * reported in physical pixels regardless of the caller's DPI awareness.
 * The compiled helper is cached next to the script so later captures skip
 * the C# compile step.
 */
export const WINDOWS_WINDOW_LIST_SCRIPT = String.raw`param([int]$ExcludePid = -1, [string]$CachePath = '')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$source = @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class QuickShotWindowList {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hWnd, int index);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out RECT value, int size);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out int value, int size);

  static string Escape(string value) {
    var builder = new StringBuilder();
    foreach (char c in value) {
      if (c == '"' || c == '\\') { builder.Append('\\').Append(c); }
      else if (c < ' ') { builder.Append("\\u").Append(((int)c).ToString("x4")); }
      else { builder.Append(c); }
    }
    return builder.ToString();
  }

  public static string List(uint excludePid) {
    var json = new StringBuilder("[");
    int count = 0;
    EnumWindows((hWnd, lParam) => {
      if (count >= 200 || !IsWindowVisible(hWnd) || IsIconic(hWnd)) return true;
      if ((GetWindowLong(hWnd, -20) & 0x80) != 0) return true;
      int cloaked;
      if (DwmGetWindowAttribute(hWnd, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
      var className = new StringBuilder(256);
      GetClassName(hWnd, className, className.Capacity);
      string kind = className.ToString();
      if (kind == "Progman" || kind == "WorkerW" || kind == "Shell_TrayWnd") return true;
      uint processId;
      GetWindowThreadProcessId(hWnd, out processId);
      if (processId == excludePid) return true;
      RECT bounds;
      if (DwmGetWindowAttribute(hWnd, 9, out bounds, Marshal.SizeOf(typeof(RECT))) != 0) return true;
      int width = bounds.Right - bounds.Left;
      int height = bounds.Bottom - bounds.Top;
      if (width < 40 || height < 40) return true;
      var title = new StringBuilder(512);
      GetWindowText(hWnd, title, title.Capacity);
      string app = "";
      try { app = Process.GetProcessById((int)processId).ProcessName; } catch { }
      if (count > 0) json.Append(',');
      json.Append("{\"x\":").Append(bounds.Left).Append(",\"y\":").Append(bounds.Top)
        .Append(",\"width\":").Append(width).Append(",\"height\":").Append(height)
        .Append(",\"app\":\"").Append(Escape(app)).Append("\",\"title\":\"").Append(Escape(title.ToString())).Append("\"}");
      count++;
      return true;
    }, IntPtr.Zero);
    return json.Append(']').ToString();
  }
}
'@
$loaded = $false
if ($CachePath -and (Test-Path -LiteralPath $CachePath)) {
  try { Add-Type -LiteralPath $CachePath; $loaded = $true } catch { $loaded = $false }
}
if (-not $loaded -and $CachePath) {
  try {
    Add-Type -TypeDefinition $source -OutputAssembly $CachePath -OutputType Library
    Add-Type -LiteralPath $CachePath
    $loaded = $true
  } catch { $loaded = $false }
}
if (-not $loaded) { Add-Type -TypeDefinition $source }
[Console]::Out.Write([QuickShotWindowList]::List([uint32]$ExcludePid))
`;

export function getWindowsWindowListArguments(
	scriptPath: string,
	excludePid: number,
	cachePath: string,
) {
	return [
		"-NoProfile",
		"-NonInteractive",
		"-ExecutionPolicy",
		"Bypass",
		"-File",
		scriptPath,
		"-ExcludePid",
		String(excludePid),
		"-CachePath",
		cachePath,
	];
}
