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
# VAŽNO: git.exe ne baca terminating exception na grešku (to nije PowerShell
# cmdlet) — $ErrorActionPreference='Stop' ga NE zaustavlja sam od sebe. Bez
# eksplicitne provjere $LASTEXITCODE, neuspio pull (konflikt, lokalne izmjene,
# offline) prođe NEPRIMIJEĆENO i skripta nastavi da builda STARI lokalni kod —
# APK "uspješno" nastane, ali sa starom verzijom (izgleda kao da build ne radi
# ništa, a zapravo build-a ono što je već bilo na disku prije pokretanja).
Write-Host "[1/3] Git pull..." -ForegroundColor Yellow
Set-Location $ProjectDir

$LocalChanges = git status --porcelain -- index.html sw.js android/app/build.gradle
if ($LocalChanges) {
    Write-Host "`n[GRESKA] Lokalne izmjene u index.html/sw.js/build.gradle blokiraju pull:" -ForegroundColor Red
    Write-Host $LocalChanges -ForegroundColor Red
    Write-Host "Sačuvaj ih (git stash) ili odbaci (git checkout -- <fajl>) pa pokreni skriptu ponovo." -ForegroundColor Red
    exit 1
}

git fetch origin
if ($LASTEXITCODE -ne 0) { Write-Host "`n[GRESKA] git fetch nije uspio (provjeri internet konekciju)." -ForegroundColor Red; exit 1 }

git checkout $Branch
if ($LASTEXITCODE -ne 0) { Write-Host "`n[GRESKA] git checkout $Branch nije uspio." -ForegroundColor Red; exit 1 }

git pull origin $Branch
if ($LASTEXITCODE -ne 0) { Write-Host "`n[GRESKA] git pull nije uspio - vidi poruku iznad." -ForegroundColor Red; exit 1 }

$LocalHead  = git rev-parse HEAD
$RemoteHead = git rev-parse "origin/$Branch"
if ($LocalHead -ne $RemoteHead) {
    Write-Host "`n[GRESKA] Lokalni HEAD ($LocalHead) se ne poklapa sa origin/$Branch ($RemoteHead) ni poslije pull-a." -ForegroundColor Red
    exit 1
}
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
# forwarder.png i "FORVARDER IKONA.png" (~2.3MB svaki) namjerno izostavljeni —
# UI koristi isključivo forwarder.svg, PNG varijante se nigdje ne referenciraju.
$OptFiles = @("forwarder.svg","GRANICE.kml")
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

# Verzija koja IDE u APK — provjeri OVO prije nego čekaš gradle build (par minuta).
# Ako ovo ispiše staru verziju, build gore u [1/3] nije stvarno povukao izmjene.
$AssetVer  = (Select-String -Path "$AssetsDir\index.html" -Pattern "const APP_VER = '(v[0-9.]+)'").Matches.Groups[1].Value
$GradleVer = (Select-String -Path "$AndroidDir\app\build.gradle" -Pattern 'versionName "([0-9.]+)"').Matches.Groups[1].Value
Write-Host "      Verzija u assets/index.html: $AssetVer   |   build.gradle versionName: $GradleVer" -ForegroundColor Cyan
if ($AssetVer -ne "v$GradleVer") {
    Write-Host "`n[GRESKA] Verzije se ne poklapaju (index.html=$AssetVer, build.gradle=v$GradleVer) - stari assets ili stari build.gradle." -ForegroundColor Red
    exit 1
}

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

    # Kopiraj APK na Desktop radi lakšeg pronalaženja. Verzija u imenu fajla —
    # da se na Desktopu ne pomiješa sa starijim .apk fajlovima iz ranijih builda.
    $Desktop = [Environment]::GetFolderPath("Desktop")
    $DestName = "US-SUME-v$GradleVer-$BuildType-$(Get-Date -Format 'yyyyMMdd-HHmm').apk"
    $DestPath = Join-Path $Desktop $DestName
    Copy-Item $ApkPath.FullName $DestPath
    Write-Host "Kopirano na Desktop: $DestName" -ForegroundColor Cyan
    Write-Host "`nPRIJE INSTALACIJE: obriši/deinstaliraj stariju verziju s telefona ako Android" -ForegroundColor Yellow
    Write-Host "ne ponudi 'Update' nego 'App not installed' grešku." -ForegroundColor Yellow
} else {
    Write-Host "APK nije pronađen u outputs/ folderu." -ForegroundColor Red
}
