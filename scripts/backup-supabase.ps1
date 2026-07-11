# =====================================================================
# Backup Supabase podataka — US-SUME
# ---------------------------------------------------------------------
# Skida SVE redove ključnih tabela (paginirano) kao JSON fajlove u
# backups/backup-YYYYMMDD-HHmm/ i zapakuje ih u .zip.
#
# POKRETANJE (PowerShell, iz korijena projekta):
#   $env:SUPABASE_URL         = "https://<PROJECT>.supabase.co"
#   $env:SUPABASE_SERVICE_KEY = "<service_role key>"
#   powershell -ExecutionPolicy Bypass -File scripts\backup-supabase.ps1
#
# service_role ključ: Supabase Dashboard → Settings → API → service_role.
# NIKAD ga ne commitovati niti slati — zaobilazi RLS (zato backup i vidi
# sve korisnike). backups/ je u .gitignore.
#
# Preporuka: Windows Task Scheduler, jednom dnevno. Vidi docs/BACKUP.md.
# =====================================================================
$ErrorActionPreference = "Stop"

$Url = $env:SUPABASE_URL
$Key = $env:SUPABASE_SERVICE_KEY
if (-not $Url -or -not $Key) {
    Write-Host "GRESKA: postavi SUPABASE_URL i SUPABASE_SERVICE_KEY env varijable (vidi zaglavlje skripte)." -ForegroundColor Red
    exit 1
}

$Tables = @(
    "korisnici", "projekti", "projekt_clanovi", "vlake", "tragovi",
    "dnevni_log", "text_labels", "odjeli", "share_codes", "kml_styles_global",
    "doz_projects", "doz_project_members", "doz_area_markings", "doz_track_points",
    "admin_notify_emails"
)

$Stamp  = Get-Date -Format "yyyyMMdd-HHmm"
$OutDir = Join-Path "backups" "backup-$Stamp"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$Headers = @{ apikey = $Key; Authorization = "Bearer $Key" }
$PageSize = 1000
$total = 0

foreach ($t in $Tables) {
    $rows = @()
    $offset = 0
    while ($true) {
        $uri = "$Url/rest/v1/$t`?select=*&limit=$PageSize&offset=$offset"
        try {
            $page = Invoke-RestMethod -Uri $uri -Headers $Headers -Method Get
        } catch {
            # Tabela ne postoji (npr. migracija nije primijenjena) — preskoci uz poruku
            Write-Host ("  ! {0}: preskocena ({1})" -f $t, $_.Exception.Message) -ForegroundColor Yellow
            $rows = $null; break
        }
        if (-not $page -or $page.Count -eq 0) { break }
        $rows += $page
        if ($page.Count -lt $PageSize) { break }
        $offset += $PageSize
    }
    if ($null -eq $rows) { continue }
    $rows | ConvertTo-Json -Depth 20 -Compress | Out-File -Encoding utf8 (Join-Path $OutDir "$t.json")
    $total += $rows.Count
    Write-Host ("  {0}: {1} redova" -f $t, $rows.Count) -ForegroundColor Green
}

Compress-Archive -Path "$OutDir\*" -DestinationPath "$OutDir.zip" -Force
Remove-Item -Recurse -Force $OutDir
Write-Host "`nBackup gotov: $OutDir.zip  (ukupno $total redova)" -ForegroundColor Cyan

# Zadrzi zadnjih 30 backupa — starije obrisi
Get-ChildItem "backups\backup-*.zip" | Sort-Object Name -Descending | Select-Object -Skip 30 | Remove-Item -Force
