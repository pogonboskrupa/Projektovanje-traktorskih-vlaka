# Projekat tab — analiza i unapređenje (v3.16.0)

Datum: 2026-07-04

## 1. Analiza postojećeg stanja

### Struktura taba (`#proj-panel`, index.html ~3400-3565)
| Sekcija | Sadržaj |
|---|---|
| Projekti (`#proj-list-sec`) | lista kartica grupisana po GJ, pretraga (>5 projekata), "+ Novi", import vlake iz KML/GPX |
| Novi projekat (`#nov-proj-sec`) | odjel, GJ (5 fiksnih + custom), površina ha, datum |
| Detalj (`#proj-detalji-sec`) | info linija, članovi (dodaj/ukloni), aktiviraj/deaktiviraj, zoom na odjel, crtaj vlaku ručno, sakrij/prikaži vlake, izvoz KML, predaja projekta, brisanje |
| Rekap (`#rekap-card`) | zbirno za AKTIVNI projekat + PDF izvoz |
| Terenske statistike | visine, usponi/padovi, nagibi, gustoća |
| Boje vlaka / STD / Dnevnik radova / Izvještaji po odjelima / KML dijeljenje | pomoćne sekcije |

### Ključne funkcije
- `sbLoadProjekti()` — učitavanje (vlasnik + dijeljeni; admin sve read-only; ŠPD teren ništa), offline keš
- `rndProjektiList()` / `_renderProjGroup()` — kartice: odjel, AKTIVAN badge, datum, ha, 👥 članovi, 📐 vlake chip
- `showProjektDetalji(id)` — detalj; `aktivirajProjekt`/`deaktivirajProjekt`
- `saveNovProjekt()` — kreiranje (offline-safe, temp UUID + queue)
- `updProjStats()` / `_calcTerenStats()` — rekap i terenske statistike za aktivni projekat
- Uloge: `isSpdField()` ne vidi tab; admin read-only (bez kreiranja/brisanja/crtanja)

### Uočene praznine
1. **Detalj projekta siromašan** — samo info linija (GJ/površina/datum/vlasnik + zbroj vlaka),
   dok admin modal "Upravljanje projektima" (`_pmBuildDetail`) ima KPI grid, tabelu svih vlaka
   s krakovima i lager oznakama, tabelu lagera, uspon/pad — a podaci za to postoje LOKALNO.
2. Nema uređivanja projekta (odjel/GJ/površina/datum) poslije kreiranja — samo kreiraj + obriši.
3. Doznake imaju `project_id` vezu, ali se u detalju projekta ne vide (broj doznaka, površina).
4. Nema statusa projekta (U toku / Završen) — tražilo bi kolonu u `projekti` tabeli (migracija).

Korisnik odabrao za v3.16.0: **samo #1 (bogati detalj)** — bez izmjena baze.
Stavke #2-#4 ostaju zabilježene kao budući rad.

## 2. Šta je urađeno (v3.16.0)

### Zajednički renderer `_vlakeStatsSecsHtml(pov, rows)`
Iz `_pmBuildDetail` izvučene tri sekcije u zajedničku funkciju (bez promjene izgleda):
- **📐 Vlake** — KPI grid: glavnih vlaka, krakova, ukupna dužina, gustoća (m/ha), uspon, pad
- **📊 Statistike vlaka** — tabela svih vlaka: dužina, uspon, pad, projektant; krakovi
  ugniježđeni pod glavnom vlakom (└), oznake "✏ ručno" i "🏷 lager"; red Ukupno
- **🏷 Lageri** — tabela: lager, vlaka, projektant

Ulaz: `pov` (površina ha) + `rows` niz `{nm, br, kr, pts, lager, projektant_ime,
korisnik_id?, _enriched?}`. Ime projektanta: `projektant_ime`, pa `_pmUserName(korisnik_id)`,
pa "—". `_pmBuildDetail` sada poziva helper — admin prikaz identičan kao prije.

### Projekat tab — "📊 Detaljna statistika" u detalju projekta
- Novo dugme `#pd-stats-btn` odmah ispod info kartice u detalju projekta
- Klik → `_pdToggleStats()`: lokalne vlake projekta
  (`vlake.filter(v => v.projektId === id && v.pts.length >= 2)`) se mapiraju u redove
  (`projektant_ime` iz `v.projektantIme`) i renderuju kroz `_vlakeStatsSecsHtml`
- Projekat bez vlaka → poruka "Nema snimljenih vlaka za ovaj projekat na ovom uređaju"
- Otvaranje drugog projekta → sekcija se resetuje na sklopljeno (svježi podaci)
- Radi za sve uloge (samo prikaz); admin vidi ono što ima lokalno keširano

### Kako se koristi
Projekat → tap na karticu projekta → **📊 Detaljna statistika** → prikaz KPI + tabela +
lageri; ponovni tap ("📊 Sakrij statistiku") sklapa sekciju.

## 3. Tehnička napomena
- Bez novih localStorage/IDB ključeva i bez izmjena baze — čisto izvedeno iz postojećih
  lokalnih podataka (`vlake`), pa nema uticaja na offline sync ni wipe higijenu.
- `pm-*` CSS klase su globalne i dijele se između admin modala i Projekat taba.
- Fajlovi: `index.html` (helper + HTML + `_pdToggleStats` + reset u `showProjektDetalji`),
  `sw.js` 3.16.0, `android/app/build.gradle` versionCode 102 / versionName 3.16.0.
