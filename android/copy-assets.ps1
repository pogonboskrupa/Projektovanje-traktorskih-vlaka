# Kopira web fajlove u android/app/src/main/assets/ (Windows / PowerShell verzija copy-assets.sh)
# Pokrenuti iz KORIJENSKOG direktorija projekta:  .\android\copy-assets.ps1
$ErrorActionPreference = 'Stop'

$AssetsDir = "android/app/src/main/assets"

# Očisti pa ponovo napravi strukturu
if (Test-Path $AssetsDir) { Remove-Item -Recurse -Force $AssetsDir }
foreach ($d in @($AssetsDir, "$AssetsDir/geo", "$AssetsDir/doznaka", "$AssetsDir/PUTEVI", "$AssetsDir/static", "$AssetsDir/.well-known")) {
    New-Item -ItemType Directory -Force -Path $d | Out-Null
}

# Obavezni fajlovi
foreach ($f in @("index.html", "manifest.json", "sw.js", "icon-192.png", "icon-512.png", "apple-touch-icon.png")) {
    Copy-Item $f -Destination $AssetsDir -Force
}

# Opcioni fajlovi/folderi — ne ruši se ako fale
function Copy-Optional($src, $dst) { if (Test-Path $src) { Copy-Item $src -Destination $dst -Recurse -Force } }
Copy-Optional "forwarder.png"       $AssetsDir
Copy-Optional "forwarder.svg"       $AssetsDir
Copy-Optional "FORVARDER IKONA.png" $AssetsDir
Copy-Optional "GRANICE.kml"         $AssetsDir
Copy-Optional "geo/*"        "$AssetsDir/geo/"
Copy-Optional "doznaka/*"    "$AssetsDir/doznaka/"
Copy-Optional "PUTEVI/*"     "$AssetsDir/PUTEVI/"
Copy-Optional "static/*"     "$AssetsDir/static/"
Copy-Optional ".well-known/*" "$AssetsDir/.well-known/"

# Provjera verzije + veličina
$ver = (Select-String -Path "$AssetsDir/index.html" -Pattern "APP_VER = '(v[0-9.]+)'").Matches.Groups[1].Value
$mb  = [math]::Round(((Get-ChildItem -Recurse $AssetsDir | Measure-Object -Property Length -Sum).Sum / 1MB), 1)
Write-Host "Assets kopirani u $AssetsDir/  (verzija $ver, ~$mb MB)"
