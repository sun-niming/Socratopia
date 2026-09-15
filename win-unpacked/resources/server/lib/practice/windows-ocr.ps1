param(
  [Parameter(Mandatory = $true)][string]$ManifestPath,
  [string]$LanguageTag = "zh-Hans-CN"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime]

$asTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq "AsTask" -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1

function Await-Operation($Operation, [Type]$ResultType) {
  $task = $asTaskMethod.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  return $task.GetAwaiter().GetResult()
}

$available = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages)
$language = $available | Where-Object { $_.LanguageTag -eq $LanguageTag } | Select-Object -First 1
if (-not $language -and $LanguageTag -like "zh-Hant*") {
  $language = $available | Where-Object { $_.LanguageTag -like "zh-Hant*" } | Select-Object -First 1
}
if (-not $language -and ($LanguageTag -like "zh-Hans*" -or $LanguageTag -eq "zh")) {
  $language = $available | Where-Object { $_.LanguageTag -like "zh-Hans*" } | Select-Object -First 1
}
if (-not $language -and $LanguageTag -notlike "zh-*") {
  $language = $available | Where-Object { $_.LanguageTag -like "en-*" } | Select-Object -First 1
}
if (-not $language) { throw "ocr_language_unavailable:$LanguageTag" }

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
if (-not $engine) { throw "Unable to create Windows OCR engine for $($language.LanguageTag)" }

$items = @(Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json)
$results = foreach ($item in $items) {
  $stream = $null
  $bitmap = $null
  try {
    $file = Await-Operation ([Windows.Storage.StorageFile]::GetFileFromPathAsync([string]$item.path)) ([Windows.Storage.StorageFile])
    $stream = Await-Operation ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await-Operation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await-Operation ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $recognized = Await-Operation ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    [PSCustomObject]@{
      page = [int]$item.page
      text = [string]$recognized.Text
      language = [string]$language.LanguageTag
    }
  } catch {
    [PSCustomObject]@{
      page = [int]$item.page
      text = ""
      language = [string]$language.LanguageTag
      error = [string]$_.Exception.Message
    }
  } finally {
    if ($bitmap -and $bitmap -is [System.IDisposable]) { $bitmap.Dispose() }
    if ($stream -and $stream -is [System.IDisposable]) { $stream.Dispose() }
  }
}

@($results) | ConvertTo-Json -Compress -Depth 4
