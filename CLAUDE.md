# US-SUME — upute za rad na ovom repozitoriju

## Krajnji cilj: APK, ne webapp

**Konačna, isporučena verzija aplikacije mora biti APK fajl** (Android WebView
app u `android/`), ne samo GitHub Pages webapp. Webapp (`index.html` uživo na
Pages) je koristan za brz razvoj/test, ali korisnik u polju (šumar na terenu)
stvarno koristi **APK instaliran na telefonu** — često bez signala. Svaka
izmjena se smatra završenom tek kad:

1. Radi u APK-u (ne samo u browseru/webapp-u).
2. Radi **offline** — GPS snimanje vlaka/traga/doznake, lokalni queue i sync
   čim se pojavi internet, sve mora preživjeti potpuni gubitak signala.
3. Ne kvari ništa što je već izgrađeno (vidi listu mogućnosti ispod).

## Verzija — TRI mjesta, uvijek zajedno

Svaka izmjena koda mora sinhrono podići verziju na sva tri mjesta, inače APK
i webapp prikazuju različite verzije i teško je znati šta je stvarno na
uređaju:

- `index.html` → `const APP_VER = 'vX.Y.Z';` (~linija 4390-ish, traži `grep -n "const APP_VER"`)
- `sw.js` → `const APP_VERSION = 'X.Y.Z';` (bez `v` prefiksa)
- `android/app/build.gradle` → `versionCode` (+1 svaki put, cijeli broj) i `versionName "X.Y.Z"`

## APK build — assets se NE povlače sami

`android/app/src/main/assets/` **nije git-tracked** i mora se ručno
regenerisati prije svakog builda — inače APK sadrži staru (keširanu) verziju
web koda čak i kad `versionName` u `build.gradle` kaže da je nova.

- **PowerShell (Windows)**: `powershell -ExecutionPolicy Bypass -File android\build-apk.ps1`
  (pull + copy-assets + gradle build u jednom potezu; provjeri `-Branch` default
  u skripti prije pokretanja ako grana nije `claude/branch-072026-sa9wz0`).
- Ili ručno: `android/copy-assets.ps1` / `.sh` pa build kroz Android Studio.
- Kad se mijenja `AndroidManifest.xml` ili bilo koji `.java` fajl (nova
  dozvola, native most i sl.) — **treba pun rebuild u Android Studiju**, samo
  copy-assets nije dovoljan (Java se ne kopira, kompajlira se).

## Mogućnosti izgrađene do sada (ne smiju se pokvariti)

- **Offline-first sync**: `_OL` red čekanja (`static/js/offline-layer.js`) —
  sve upisi (vlake, tragovi, doznaka, projekti) rade lokalno prvo, pa se šalju
  na Supabase čim ima interneta. Idempotentno (klijentski UUID-ovi), sa
  retry/backoff i dedup.
- **GPS snimanje** (vlaka, trag, doznaka pojas) — radi bez signala, crash-
  recovery auto-save na 30s, wake lock, foreground service.
- **Tim/kolege**: vlake i doznaka projekti se dijele preko RLS-a i realtime
  kanala; dodatno postoji **share-code** sistem (šifra tipa RK70ABGH) za
  terenski profil bez članstva u projektu — radi i offline (redeem preko RPC-a
  kad se pojavi internet).
- **QR dijeljenje pojaseva** (doznaka) — potpuno offline, peer-to-peer preko
  kamere, bez servera uopšte (ni pošiljalac ni primalac ne trebaju internet).
- **Print/štampanje**: razmjera, format papira, legenda, sjever, mjerilo.
- **Migracije**: `supabase/migrations/*.sql` postoje ali se **ne pokreću
  automatski** — svaku novu migraciju treba ručno pokrenuti u Supabase SQL
  Editoru (nema CI/migration runnera u ovom projektu).

## Konvencija za svaku izmjenu

1. Sintaks-provjera svih `<script>` blokova u `index.html` (Node `new Function()` na svaki blok).
2. `node tests/js/offline-layer.test.js` ako izmjena dotiče offline sync.
3. Podigni sve tri verzije (vidi gore).
4. Commit poruka na bosanskom, objašnjava UZROK ne samo šta je promijenjeno.
5. Push na `claude/branch-072026-sa9wz0`.
