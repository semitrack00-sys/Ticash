param(
    [string]$DeviceId = '',
    [string]$ApiUrl = 'http://127.0.0.1:4000'
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$mobileRoot = Join-Path $repoRoot 'apps\mobile'
$localPropertiesPath = Join-Path $mobileRoot 'android\local.properties'

if (-not (Test-Path -LiteralPath $localPropertiesPath)) {
    throw "Missing Android local.properties at $localPropertiesPath"
}

$localProperties = @{}
foreach ($line in Get-Content -LiteralPath $localPropertiesPath) {
    if ($line -match '^\s*([^#=]+?)\s*=\s*(.*?)\s*$') {
        $localProperties[$matches[1]] = $matches[2] -replace '\\\\', '\'
    }
}

$androidSdk = $localProperties['sdk.dir']
$flutterSdk = $localProperties['flutter.sdk']
if (-not $androidSdk -or -not (Test-Path -LiteralPath $androidSdk)) {
    throw 'Android SDK path is missing or invalid in android/local.properties.'
}
if (-not $flutterSdk -or -not (Test-Path -LiteralPath $flutterSdk)) {
    throw 'Flutter SDK path is missing or invalid in android/local.properties.'
}

$flutter = Join-Path $flutterSdk 'bin\flutter.bat'
$adb = Join-Path $androidSdk 'platform-tools\adb.exe'
$clang = Join-Path $androidSdk 'ndk\28.2.13676358\toolchains\llvm\prebuilt\windows-x86_64\bin\clang.exe'
$javaHome = 'C:\Program Files\Android\Android Studio\jbr'

foreach ($requiredPath in @($flutter, $adb, $clang, $javaHome)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Required Android build path is unavailable: $requiredPath"
    }
}

& $clang --version | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw @"
The Android NDK compiler cannot execute in this PowerShell session.
Run this script from the normal Windows user account that owns the Android SDK.
Do not disable antivirus, Windows Security, certificate checks, or signing safeguards.
"@
}

$environmentPath = Join-Path $repoRoot '.env'
if (-not (Test-Path -LiteralPath $environmentPath)) {
    throw 'The repository .env file is missing. Configure it locally; never commit it.'
}

$safeConfiguration = @{}
foreach ($line in Get-Content -LiteralPath $environmentPath) {
    if ($line -match '^\s*([^#=]+?)\s*=\s*(.*?)\s*$') {
        $safeConfiguration[$matches[1]] = $matches[2].Trim().ToLowerInvariant()
    }
}

$requiredSafeValues = @{
    'PAYMENTS_MODE' = 'mock'
    'PAYOUTS_MODE' = 'mock'
    'RELOADLY_ENVIRONMENT' = 'sandbox'
    'APPROVED_FOR_LIVE_USE' = 'false'
    'LIVE_MONEY_ENABLED' = 'false'
    'MOBILE_TOPUP_APPROVED_FOR_LIVE_USE' = 'false'
}
foreach ($setting in $requiredSafeValues.GetEnumerator()) {
    $actual = $safeConfiguration[$setting.Key]
    if ($null -ne $actual -and $actual -ne $setting.Value) {
        throw "Unsafe test configuration: $($setting.Key) must be $($setting.Value)."
    }
}

try {
    $health = Invoke-WebRequest -UseBasicParsing `
        -Uri ($ApiUrl.TrimEnd('/') + '/api/health') `
        -TimeoutSec 10
} catch {
    throw "The TiCash API is not reachable at $ApiUrl. Start it before building and installing."
}
if ([int]$health.StatusCode -ne 200) {
    throw "The TiCash API health check returned HTTP $([int]$health.StatusCode); PostgreSQL-backed UAT requires a healthy API."
}

$env:JAVA_HOME = $javaHome
$env:ANDROID_HOME = $androidSdk
$env:ANDROID_SDK_ROOT = $androidSdk
$env:ANDROID_USER_HOME = Join-Path $env:USERPROFILE '.android'
$env:GRADLE_USER_HOME = Join-Path $env:LOCALAPPDATA 'TiCash\Gradle'
$env:PUB_CACHE = Join-Path $env:LOCALAPPDATA 'Pub\Cache'

Push-Location $mobileRoot
try {
    & $flutter clean
    if ($LASTEXITCODE -ne 0) { throw 'flutter clean failed.' }

    & $flutter pub get
    if ($LASTEXITCODE -ne 0) { throw 'flutter pub get failed.' }

    & $flutter analyze
    if ($LASTEXITCODE -ne 0) { throw 'flutter analyze failed.' }

    & $flutter test
    if ($LASTEXITCODE -ne 0) { throw 'flutter test failed.' }

    & $flutter build apk --debug
    if ($LASTEXITCODE -ne 0) { throw 'Android debug APK build failed.' }

    $apk = Join-Path $mobileRoot 'build\app\outputs\flutter-apk\app-debug.apk'
    if (-not (Test-Path -LiteralPath $apk)) {
        throw "The expected APK was not created at $apk"
    }

    $authorizedDevices = @(
        & $adb devices |
            Select-Object -Skip 1 |
            Where-Object { $_ -match '^([^\s]+)\s+device$' } |
            ForEach-Object { $matches[1] }
    )

    if ($DeviceId) {
        if ($authorizedDevices -notcontains $DeviceId) {
            throw "Requested device '$DeviceId' is not connected and authorized."
        }
        $targetDevice = $DeviceId
    } elseif ($authorizedDevices.Count -eq 1) {
        $targetDevice = $authorizedDevices[0]
    } else {
        throw 'Connect exactly one authorized phone or rerun with -DeviceId <serial>.'
    }

    & $adb -s $targetDevice reverse tcp:4000 tcp:4000
    if ($LASTEXITCODE -ne 0) { throw 'ADB reverse for the local API failed.' }

    & $adb -s $targetDevice install -r $apk
    if ($LASTEXITCODE -ne 0) { throw 'APK installation failed.' }

    & $adb -s $targetDevice shell am force-stop com.ticash.app
    & $adb -s $targetDevice shell am start -n com.ticash.app/.MainActivity
    if ($LASTEXITCODE -ne 0) { throw 'TiCash launch failed.' }

    Start-Sleep -Seconds 3
    $appProcess = (& $adb -s $targetDevice shell pidof com.ticash.app).Trim()
    if (-not $appProcess) { throw 'TiCash did not remain running after launch.' }

    Write-Host "TiCash debug APK built, installed, and launched: $apk"
}
finally {
    Pop-Location
}
