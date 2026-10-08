/**
 * Text recognition on Windows uses the built-in Windows.Media.Ocr engine through
 * Windows PowerShell 5.1, which ships with every supported Windows release and
 * can load WinRT types. No extra binary needs to be bundled or signed.
 */

export const WINDOWS_OCR_NO_LANGUAGE_EXIT_CODE = 6;
export const WINDOWS_OCR_TOO_LARGE_EXIT_CODE = 7;

/**
 * Written to a temporary .ps1 file and run with -File, so the image path is
 * passed as a real argument instead of being spliced into the script text.
 */
export const WINDOWS_OCR_SCRIPT = String.raw`param([Parameter(Mandatory = $true)][string]$ImagePath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation${"`"}1'
} | Select-Object -First 1
function Await($operation, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
  $task.Wait(-1) | Out-Null
  $task.Result
}
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { exit ${WINDOWS_OCR_NO_LANGUAGE_EXIT_CODE} }
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
try {
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $limit = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
  if ($decoder.PixelWidth -gt $limit -or $decoder.PixelHeight -gt $limit) { exit ${WINDOWS_OCR_TOO_LARGE_EXIT_CODE} }
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
} finally {
  $stream.Dispose()
}
$lines = @($result.Lines | ForEach-Object { $_.Text })
$payload = @{ text = ($lines -join "${"`"}n"); lineCount = $lines.Count } | ConvertTo-Json -Compress
[Console]::Out.Write($payload)
`;

/** Windows PowerShell 5.1 by absolute path, never a copy found on PATH. */
export function getWindowsPowerShellPath(systemRoot = process.env["SystemRoot"]) {
	const root = systemRoot && /^[a-z]:\\/i.test(systemRoot) ? systemRoot : "C:\\Windows";
	return `${root.replace(/\\+$/, "")}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
}

export function getWindowsOcrArguments(scriptPath: string, imagePath: string) {
	return [
		"-NoProfile",
		"-NonInteractive",
		"-ExecutionPolicy",
		"Bypass",
		"-File",
		scriptPath,
		"-ImagePath",
		imagePath,
	];
}

const CJK = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}\\u3000-\\u303F\\uFF00-\\uFFEF";
const CJK_GAP = new RegExp(`(?<=[${CJK}])[ \\t]+(?=[${CJK}])`, "gu");

/**
 * Windows OCR returns CJK lines with a space between every character.
 * Removing spaces between two CJK characters restores natural text while
 * keeping the spaces around Latin words.
 */
export function normalizeCjkSpacing(text: string) {
	return text.replace(CJK_GAP, "");
}

export function stripByteOrderMark(text: string) {
	return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
