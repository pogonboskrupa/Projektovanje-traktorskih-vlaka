# Backup podataka

Terenski podaci (vlake, projekti, doznaka) su skupi za ponovno snimanje —
backup je obavezan. Dvije linije odbrane:

## 1. Supabase Point-in-Time Recovery (preporučeno, uz backup skriptu)

Dashboard → Database → Backups. Besplatni plan ima dnevne backupe (7 dana);
PITR (vraćanje na tačnu minutu) je plaćeni dodatak. Uključiti ako budžet
dozvoljava — pokriva i greške tipa "slučajno obrisao projekat juče u 14h".

## 2. Lokalna backup skripta (odmah upotrebljivo)

`scripts/backup-supabase.ps1` skida sve redove ključnih tabela u
`backups/backup-YYYYMMDD-HHmm.zip` (JSON po tabeli, paginirano, čuva
zadnjih 30 arhiva).

```powershell
$env:SUPABASE_URL         = "https://<PROJECT>.supabase.co"
$env:SUPABASE_SERVICE_KEY = "<service_role key>"   # Dashboard → Settings → API
powershell -ExecutionPolicy Bypass -File scripts\backup-supabase.ps1
```

**Automatizacija (Windows Task Scheduler):** Create Task → Trigger: Daily →
Action: `powershell.exe` s argumentima
`-ExecutionPolicy Bypass -File C:\putanja\do\US-SUME\scripts\backup-supabase.ps1`,
uz env varijable postavljene kroz sistemske Environment Variables (User scope).

## Sigurnosne napomene

- `service_role` ključ **zaobilazi RLS** (zato backup i vidi sve podatke).
  Nikad ga ne commitovati, ne slati, ne ugrađivati u aplikaciju.
- `backups/` je u `.gitignore` — arhive sadrže lične podatke (imena, GPS)
  i ne smiju u repozitorij (repo je javan).
- Iz istog razloga backup NIJE realizovan kao GitHub Action: artifacts na
  javnom repou su dostupni prijavljenim korisnicima GitHuba.

## Vraćanje podataka

JSON fajlovi su 1:1 slike tabela — vraćanje pojedinačnih redova ide kroz
Supabase SQL Editor / Table Editor (insert iz JSON-a), a potpuno vraćanje
kroz PITR/dnevni backup na Dashboardu.
