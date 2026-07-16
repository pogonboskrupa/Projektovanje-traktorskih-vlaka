# build-apk.ps1 — Pull, kopiraj assets, buildi APK
# Pokrenuti iz korijena projekta: powershell -ExecutionPolicy Bypass -File android\build-apk.ps1
# Ili iz android/ foldera:         powershell -ExecutionPolicy Bypass -File build-apk.ps1

param(
    [string]$Branch  = "claude/branch-072026-sa9wz0",
    [string]$BuildType = "debug"   # "debug" ili "release"
)

$ErrorActionPreference = "Stop"

# ── Pronađi korijen projekta ─────────────────────────────────────────────────
$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = if (Test-Path "$ScriptDir\..\index.html") { Resolve-Path "$ScriptDir\.." } else { $ScriptDir }
$AndroidDir = Join-Path $ProjectDir "android"
$GradleBat  = Join-Path $AndroidDir "gradlew.bat"

Write-Host "`n=== US-SUME APK Builder ===" -ForegroundColor Cyan
Write-Host "Projekt: $ProjectDir"
Write-Host "Branch:  $Branch"
Write-Host "Tip:     $BuildType`n"

# ── 1. Git pull ──────────────────────────────────────────────────────────────
Write-Host "[1/3] Git pull..." -ForegroundColor Yellow
Set-Location $ProjectDir
git fetch origin
git checkout $Branch
git pull origin $Branch
Write-Host "      OK - zadnji commit: $(git log -1 --oneline)" -ForegroundColor Green

# ── 2. Kopiraj assets ────────────────────────────────────────────────────────
Write-Host "`n[2/3] Kopiranje assets u android/app/src/main/assets/..." -ForegroundColor Yellow

$AssetsDir = Join-Path $AndroidDir "app\src\main\assets"

# Očisti i napravi foldere
if (Test-Path $AssetsDir) { Remove-Item $AssetsDir -Recurse -Force }
$null = New-Item -ItemType Directory -Path $AssetsDir
$null = New-Item -ItemType Directory -Path "$AssetsDir\geo"
$null = New-Item -ItemType Directory -Path "$AssetsDir\doznaka"
$null = New-Item -ItemType Directory -Path "$AssetsDir\PUTEVI"
$null = New-Item -ItemType Directory -Path "$AssetsDir\static"
$null = New-Item -ItemType Directory -Path "$AssetsDir\.well-known"

# Glavni fajlovi
$MainFiles = @("index.html","manifest.json","sw.js","icon-192.png","icon-512.png","apple-touch-icon.png")
foreach ($f in $MainFiles) {
    $src = Join-Path $ProjectDir $f
    if (Test-Path $src) { Copy-Item $src "$AssetsDir\" }
}

# Opcionalni fajlovi (ne grešiti ako ne postoje)
$OptFiles = @("forwarder.png","forwarder.svg","FORVARDER IKONA.png","GRANICE.kml")
foreach ($f in $OptFiles) {
    $src = Join-Path $ProjectDir $f
    if (Test-Path $src) { Copy-Item $src "$AssetsDir\" }
}

# Folderi s podacima
$Folders = @("geo","doznaka","PUTEVI","static",".well-known")
foreach ($folder in $Folders) {
    $src = Join-Path $ProjectDir $folder
    if (Test-Path $src) {
        Copy-Item "$src\*" "$AssetsDir\$folder\" -Recurse -Force -ErrorAction SilentlyContinue
    }
}

$sizeKB = [math]::Round((Get-ChildItem $AssetsDir -Recurse | Measure-Object -Property Length -Sum).Sum / 1KB)
Write-Host "      OK - Ukupna velicina assets: $sizeKB KB" -ForegroundColor Green

# ── 3. Gradle build ──────────────────────────────────────────────────────────
Write-Host "`n[3/3] Gradle build ($BuildType)..." -ForegroundColor Yellow
Set-Location $AndroidDir

$Task = if ($BuildType -eq "release") { "assembleRelease" } else { "assembleDebug" }
& $GradleBat $Task

if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[GRESKA] Gradle build nije uspio!" -ForegroundColor Red
    exit 1
}

# ── Pronađi APK ──────────────────────────────────────────────────────────────
$ApkPath = Get-ChildItem "$AndroidDir\app\build\outputs\apk\$BuildType\*.apk" -ErrorAction SilentlyContinue | Select-Object -First 1

Write-Host "`n=============================" -ForegroundColor Cyan
if ($ApkPath) {
    $sizeMB = [math]::Round($ApkPath.Length / 1MB, 1)
    Write-Host "APK uspjesno buildovan! ($sizeMB MB)" -ForegroundColor Green
    Write-Host "Lokacija: $($ApkPath.FullName)" -ForegroundColor White
    Write-Host "=============================" -ForegroundColor Cyan

    # Kopiraj APK na Desktop radi lakšeg pronalaženja
    $Desktop = [Environment]::GetFolderPath("Desktop")
    $DestName = "US-SUME-$BuildType-$(Get-Date -Format 'yyyyMMdd-HHmm').apk"
    $DestPath = Join-Path $Desktop $DestName
    Copy-Item $ApkPath.FullName $DestPath
    Write-Host "Kopirano na Desktop: $DestName" -ForegroundColor Cyan
} else {
    Write-Host "APK nije pronađen u outputs/ folderu." -ForegroundColor Red
}
