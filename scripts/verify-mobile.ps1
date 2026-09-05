param(
    [ValidateSet('debug', 'release')]
    [string]$BuildMode = 'debug',
    [string]$ApiBaseUrl = 'http://127.0.0.1:4000/api'
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$mobileDirectory = Join-Path $repositoryRoot 'apps\mobile'
$localProperties = Join-Path $mobileDirectory 'android\local.properties'

if (-not (Test-Path -LiteralPath $localProperties)) {
    throw 'android/local.properties is missing. Open the Android project once with Flutter first.'
}

$flutterSdkLine = Get-Content -LiteralPath $localProperties |
    Where-Object { $_ -match '^flutter\.sdk=' } |
    Select-Object -First 1
if (-not $flutterSdkLine) {
    throw 'flutter.sdk is not configured in android/local.properties.'
}

$flutterSdk = $flutterSdkLine.Substring('flutter.sdk='.Length) -replace '\\\\', '\'
$flutter = Join-Path $flutterSdk 'bin\flutter.bat'
$dart = Join-Path $flutterSdk 'bin\dart.bat'
if (-not (Test-Path -LiteralPath $flutter) -or -not (Test-Path -LiteralPath $dart)) {
    throw "Flutter was not found at $flutterSdk."
}

Push-Location $mobileDirectory
try {
    & $flutter pub get
    if ($LASTEXITCODE -ne 0) { throw 'flutter pub get failed.' }
    & $dart format lib test
    if ($LASTEXITCODE -ne 0) { throw 'Dart formatting failed.' }
    & $flutter analyze
    if ($LASTEXITCODE -ne 0) { throw 'flutter analyze failed.' }
    & $flutter test
    if ($LASTEXITCODE -ne 0) { throw 'flutter test failed.' }
    & $flutter build apk "--$BuildMode" "--dart-define=API_BASE_URL=$ApiBaseUrl"
    if ($LASTEXITCODE -ne 0) { throw 'Flutter APK build failed.' }
} finally {
    Pop-Location
}

Write-Host "TiCash mobile verification and $BuildMode APK build completed." -ForegroundColor Green
