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
- **Doznaka — analiza stabala**: KML sa tačkama doznačenih stabala se učitava
  po odjelu (keš u localStorage `tvlake_doz_trees_data`), boji se po dosegu
  vitla (buffer vlaka) i automatski re-analizira kad se vlaka snimi/nacrta/
  uveze. Buffer radijus je JEDAN zajednički (`_syncBufRadiusEverywhere`) za
  Vlake alat + Doznaka buffer + analizu stabala — ne dodavati nove nezavisne
  buffer kontrole.
- **Doznaka — uvoz vlaka iz KML-a**: `dozVlakeLoadKml` pravi PUNE vlake (isti
  oblik objekta kao crtanje/snimanje — vidi `_routeToVlaka` obrazac), ne
  poseban "uvozni" tip. Svaki novi način kreiranja vlake mora pratiti isti
  obrazac polja (`nm/br/kr/color/pts/poly/sbId/projektId/...`).
- **Migracije**: `supabase/migrations/*.sql` postoje ali se **ne pokreću
  automatski** — svaku novu migraciju treba ručno pokrenuti u Supabase SQL
  Editoru (nema CI/migration runnera u ovom projektu). Nakon `ALTER TABLE`
  PostgREST keš šeme zna kasniti (`PGRST204 "could not find column"`) — riješi
  se sa `NOTIFY pgrst, 'reload schema';` ili Settings → API → Reload schema.
- **Nagib vlaka (preklopnik na karti)**: checkbox u 🗄 Slojevi karte → Dodatni
  slojevi, funkcija `_vlNagibToggle`. Boji SVE trenutno vidljive vlake bojom po
  strmini (`_gradeColor`/`_updateSteepOverlay`, ista skala kao admin "Analiza
  nagiba"). NAMJERNO je snapshot na klik, ne prati GPS uživo — ne kačiti ga u
  `rndList()` ni GPS hot-path (`_vlakaProcessGpsPoint`), usporilo bi snimanje.
  Dijeli `v._steepPolys` sa admin analizom (`_pmNagibAnaliza`/`_nagibAnalysisStop`
  u modalu nadzora) — zadnji poziv pobjeđuje, bezopasno u rijetkom preklopu.

## Poznate zamke (naučeno na stvarnim bugovima)

- **WebView JS dijalozi**: `MainActivity` ima override za `onJsAlert` i
  `onJsConfirm` (naslov = ime app-a). `onJsPrompt` NIJE override-ovan — za
  unos teksta koristi postojeći `_dlgPrompt`/`_dlgConfirm` (HTML dijalozi u
  index.html), ne native `prompt()`.
- **`WebView.onPause()` pauzira geolocation** — `MainActivity.onPause()` ga
  namjerno PRESKAČE dok traje snimanje (`isRecordingActive` preko GpsBridge).
  Ne "popravljati" to nazad; bez toga pozadinsko snimanje umire.
- **`LOAD_CACHE_ELSE_NETWORK` nikad ne koristiti** — servira ustajale Supabase
  odgovore i offline i online. Cache mode je `LOAD_DEFAULT` + Supabase klijent
  ima `cache:'no-store'` fetch. Ne dirati ni jedno ni drugo.
- **Pokretanje je OFFLINE-FIRST — nikad ne čekati mrežu da se odluči šta
  prikazati** (v3.100.0). Ovo je najčešće prijavljivan bug s terena, vraćao se
  u više oblika: login ekran preko uredno prijavljenog korisnika na slabom
  signalu. Uzrok je uvijek isti obrazac: `navigator.onLine` na terenu laže
  `true` na mrtvoj vezi (OS-S4), pa mrežni poziv ne padne nego **VISI** — a
  startup logika koja čeka njegov ishod stoji s njim. Pravilo: ako postoji
  keširani profil (`_OL.PROFILE`), `initAuth()` ulazi u app **odmah**
  (`showApp()`), a prava Supabase sesija se dohvaća tiho u pozadini
  (`_upgradeToOnlineSession()`). Iz toga slijedi:
  - `_appEntered` se postavlja na **jednom jedinom mjestu** — u `showApp()`,
    tek POSLIJE gate-a odobrenja. Nijedna auth putanja ne smije dizati login
    ekran ni zvati `showApp()` drugi put kad je ta zastavica `true` (drugi
    poziv = dupli restore svih slojeva karte).
  - `sbUser` iz keša nosi `_cachedStub: true` — po tome se zna da prava sesija
    još nije dobijena. Svaka provjera "imamo li sesiju" mora glasiti
    `sbUser && !sbUser._cachedStub`, ne samo `sbUser`.
  - Tajmer-sigurnosne mreže (npr. onaj koji forsira login ako se ništa ne
    prikaže) moraju biti **sporije** od najsporijeg legitimnog offline puta —
    inače baš one izazovu bug koji treba spriječiti (bio 2000ms vs legitimnih
    4500ms → v3.99.3).
  - Testovi: `tests/js/auth-offline-first.test.js` izvlači STVARNI `initAuth`
    iz `index.html` i pušta ga nad mockovima (mreža koja visi, opoziv pristupa,
    nema keša...). Pokrenuti ga pri svakoj izmjeni auth/startup toka.
- **Autofill na dijeljenim uređajima**: login polja imaju `autocomplete="off"`
  i PIN se NE pre-popunjava — sprječava prijavu pod tuđim nalogom.
- **Sintaks-checker** (regex nad `<script>` blokovima) se zbuni ako komentar
  sadrži doslovno `<script>` — u komentarima pisati "JS blok".
- **Canvas pane iznad drugog "pojede" sve klikove** (v3.101.0): karta je
  `preferCanvas:true`, a svaki Leaflet canvas renderer je JEDAN `<canvas>` preko
  CIJELE karte koji sam hvata DOM klik pa tek onda traži svoj sloj pod prstom.
  Uvezeni KML/SHP se crta u podrazumijevanom canvas-u (`overlayPane`, z-index
  400), vlake u svom (`_vlakeRenderer`, pane `vlakeLines`, **također 400** ali
  kasnije u DOM-u = iznad). Čim u projektu postoji makar JEDNA vlaka — bilo gdje
  na svijetu, geometrija nije bitna — gornji canvas pokupi svaki klik i
  `layer.on('click')` na KML sloju nikad ne opali: uvezeni KML izgleda "mrtav"
  (hover tooltip radi, klik ne radi). Isto važi za `tragMsrLines` (410) čim se
  nacrta trag/izmjera. Zato vlake odavno imaju proximity fallback u
  `map.on('click')`, a od v3.101.0 ga ima i KML (`_kmlHitTest` → `_kmlOpenPopup`,
  koristi Leafletov `_containsPoint` gdje postoji + piksel-tolerancije za prst).
  **Novi interaktivni canvas pane = novi sloj koji krade klikove svemu ispod** —
  ili mu daj vlastiti fallback, ili ga ne pravi. Test:
  `tests/js/kml-click.test.js` (izvlači STVARNI `_kmlHitTest` iz index.html).
- **Pokretanje dira DOM koji JOŠ NE POSTOJI** (v3.102.2) — najskuplja posljedica
  offline-first ulaza. `showApp()` se iz keširanog profila zove ODMAH, dok se
  tijelo dokumenta još parsira: skripta ide do ~33857. linije, a `#mjtrg-panel`
  je u markupu tek na ~35138. `switchTab('karta')` je taj element čitao bez
  provjere → `TypeError`, a `showApp()` nije imao `try/catch` — pa se SVE ispod
  te linije preskakalo: `sqlmapRestoreAll` (offline SQLite karte),
  `_localKmlRestore`, `_restoreTacke`, `_restoreFotos`, `_tragRegLoad`,
  `_msrRegLoad`, `_refRepoLoad`, `_temRestore`, `_kmlcInit`, `loadProj`,
  `sbInitData`, `_processOfflineQueue`. Korisnik je to prijavio kao "ponekad ne
  mogu aktivirati učitane karte" — karte su bile uredno na uređaju, samo ih
  niko nije pokupio. Izmjereno nad stvarnim pokretanjem: stari kod obnovi **0**
  sačuvanih KML slojeva, novi **1**. Pravila koja iz toga slijede:
  - Sav startup rad koji dira DOM ide kroz **`_startupRestore()`** — čeka
    `DOMContentLoaded` ako `document.readyState === 'loading'`, idempotentan je,
    i **svaki korak ima vlastiti `try/catch`** (pad jednog ne obara ostale).
  - Novi korak obnove se dodaje SAMO tamo, kroz `korak('ime', () => …)`.
  - Funkcije koje se zovu pri pokretanju ne smiju čitati `.style` elementa bez
    provjere postojanja — pola panela u `switchTab` je tu provjeru već imalo,
    pola nije.
  - Test: `tests/js/startup-restore.test.js` (7 testova; nad starim kodom pada 6).
- **Offline karta se NIKAD ne briše sama** (v3.102.2): `_sqlCrashCheck` je poslije
  3 prekinuta učitavanja TRAJNO brisao SQLite kartu (IDB + OPFS). Ali marker
  "učitavam" ostaje i kad app ubije OEM battery manager, kad korisnik zatvori
  app usred učitavanja ili kad ponestane RAM-a — ništa od toga ne znači da je
  karta neispravna, a brisao se fajl od više stotina MB koji offline nema odakle
  vratiti. Sada se karta samo isključi iz AUTOMATSKOG učitavanja
  (`tvlake_sqlmap_skip_autoload`), vidi se u listi offline karata i vraća
  dugmetom "Pokušaj ponovo" (`sqlmapRetryOne`).
- **Karta ne smije ostati bez podloge**: `_restoreLastMap` namjerno preskoči tile
  sloj kad je zadnja aktivna bila SQLite (da nema bljeska Topo-a) i računa na
  `sqlmapRestoreAll`. Ako taj restore ne uspije, bez `_sqlEnsureBaseLayer()`
  ostaje siva praznina i prazna lista karata — nema se šta ni aktivirati.
- **Dvije funkcije istog imena — zadnja tiho pobjeđuje** (v3.102.1): fajl ima
  ~1430 `function` deklaracija u jednom `<script>` bloku; deklaracije se
  hoistuju pa kasnija bez ikakve greške zamijeni raniju. Tako je string-verzija
  `_hexToRgb` (vraća `"r,g,b"` za `rgba()`) gazila niz-verziju (`[r,g,b]`), pa
  je `const [r,g,b] = _hexToRgb(c)` destrukturirao PRVA TRI ZNAKA stringa i
  `_gradeColor` je vraćao boje tipa `#0aNaN34`. **Canvas neispravnu boju ne
  prijavi nego je tiho ignoriše i zadrži prethodnu** — segmenti "Analize
  nagiba" su dobijali boju nasumične druge vlake, bez ijedne poruke u konzoli.
  Sad su to `_hexToRgb` (niz) i `_hexToRgbCsv` (string). Test
  `tests/js/boje-nagiba.test.js` čuva i skalu boja i pravilo "nijedno ime
  funkcije se ne smije pojaviti dva puta".
- **Mrežni poziv bez roka na terenu VISI, ne pada** (v3.102.1): `navigator
  .onLine` laže `true` na mrtvoj vezi (OS-S4), pa `await fetch(...)` bez
  `signal` nikad ne završi — "Profil" se otvori i ostane prazan zauvijek
  (izmjereno: stari kod visi i poslije 20 s, novi vrati `null` za 12 s i
  pređe na DEM fallback). Za svaki poziv van uređaja koristiti `_fetchT(url,
  ms, opts)`; catch/fallback grane koje već postoje onda rade svoj posao.
  Za Supabase pozive (nisu `fetch()`, nemaju `signal`) koristiti `_withTimeout
  (promise, ms)` — isti razlog, npr. periodični sync na 60s (`sb.auth.getSession()`).
- **Tab labela mora odgovarati sadržaju, sadržaj se ne premješta radi labele**
  (v3.102.3): "Postavke" tab je nekad zvučao kao opšta prikazna podešavanja, a
  sadržavao je samo admin email obavještenja o registraciji — preimenovan u
  "Obavještenja". NIJE premješteno obratno (stil linija/boje vlaka iz Projekat
  taba tamo) jer je taj tab vidljiv **samo adminu** (`isAdm` gate) — premještanje
  bi svakodnevne alate sakrilo od svih projektanata koji nisu admin. Prije
  premještanja bilo čega u tab, provjeriti ko ga uopšte vidi.
- **Panel taba bez zadane širine se na telefonu ne raširi** (v3.102.1):
  paneli su flex-djeca `#main`-a; bez pravila šire se koliko im sadržaj traži,
  pa je ispadalo nasumično (Korisnici 305px, Tragovi 341px, a pored njih virio
  komad karte). Svaki NOVI tab-panel mora ući u `@media (max-width:580px)`
  pravilo za punu širinu. Pažnja: pravilo mora biti **iza** definicije samog
  `#id`-a u fajlu — inače ga ta kasnija definicija (iste specifičnosti)
  pregazi, što se i desilo `#doznaka-panel`-u.
- **Pozicija u DOM-u NIJE indeks u nizu** (v3.102.0): lista vlaka se crta
  sortirano i hijerarhijski (`rootVlake` sort + `renderWithChildren` gura
  krakove ispod roditelja), a `vlake[]` je redoslijed nastanka/dolaska sa
  servera — poklope se samo slučajno. `selI()` je ranije tražio red po poziciji
  (`idx === i`) pa je označavao SUSJEDNU vlaku: korisnik vidi istaknuto "T1.1",
  a `actI` (Uredi/Briši/Dodaj tačku) radi nad "T1". Sada svaki red nosi
  `data-vi` i traži se `#vl .vrow[data-vi="N"]`. **Svaka nova lista koja se
  sortira ili grupiše mora nositi indeks na elementu** — nikad ne vezivati
  podatak za redni broj u DOM-u. Test: `tests/js/vlake-list.test.js`.
- **DOM polje nije baza podataka** (v3.102.0): `_projPovrsinaHa()` je površinu
  čitao ISKLJUČIVO iz skrivenog `#p-povrsina`, koje puni samo
  `_applyProjektFields` (aktiviranje projekta). Kad se do aktivnog projekta
  dođe drugim putem (obnova iz keša pri pokretanju, realtime izmjena s drugog
  uređaja, aktivacija iz modala nadzora), polje ostane prazno pa su "Površina",
  "Gustoća mreže" i m/ha bedž pokazivali "—" iznad kartice na kojoj piše
  42.50 ha. Izvor istine je zapis u `_projekti`, DOM polje je samo prikaz.
- **UI keševi nisu izvor istine**: `_dozVlakeIdxs` i slični nizovi indeksa su
  samo za prikaz liste — svaka analiza/izračun mora raditi svjež filter nad
  `vlake[]` (bug "Osvježi analizu ne vidi nove vlake").
- **Trajne UI postavke** idu u localStorage sa `tvlake_` prefiksom (postojeći:
  `tvlake_doz_hidden_odjeli`, `tvlake_doz_boundary_style`,
  `tvlake_doz_trees_style`, `tvlake_doz_trees_data`) — isti obrazac
  get/set + restore pri otvaranju panela.
- **Splash/drawable resursi**: bitmap u density-generičkom `drawable/` folderu
  se crta u "px kao dp" veličini — fiksirati prikaznu veličinu u layer-list
  XML-u (`android:width/height`), ne oslanjati se na veličinu PNG-a.
- **Adaptivna ikonica aplikacije** (`mipmap-*/ic_launcher_foreground.png`):
  sadržaj MORA stati unutar "safe zone" kruga (dijagonala okvira crteža ≤ 61%
  platna, idealno ≤ 60% zbog margine) — inače je različiti launcheri (krug/
  skvirkl/zaobljeni kvadrat) sijeku nekonzistentno, izgleda drugačije na
  različitim telefonima. Pozadina ide isključivo kroz `ic_launcher_background`
  boju u `values/colors.xml` (trenutno bijela) — foreground PNG ne smije imati
  pozadinu popunjenu do ivice, samo providan crtež. Izvor grafike:
  `drawable/splash_logo.png` (zeleni crtež na bijeloj kartici, providna
  pozadina) — od njega se izvlači sam "ink" (linija crteža), ne od starog
  `ic_launcher_foreground.png` (imao je zelenu popunjenu do ruba, bez marže —
  otud "zelen vrh/bjelkasto dno" izgled na nekim telefonima, popravljeno u
  v3.81.0). Legacy `ic_launcher.png`/`ic_launcher_round.png` (fallback za
  starije launchere) su odvojeno generisani flattened PNG-ovi (bijela
  pozadina + centriran crtež), ne oslanjaju se na OS maskiranje.
  Od v3.91.0 se crtež izvlači SAMO iz gornjeg dijela splash_logo.png (satelit +
  krug + jelke), BEZ dvoreda teksta ispod — puni grb sa tekstom je na 48dp
  (stvarna veličina ikonice na telefonu) bio nečitljiv, čitao se kao mutna
  mrlja. Tekst ostaje na splash ekranu (drawable/splash_logo.png se ne mijenja,
  koristi se samo dio njegovog sadržaja za mipmap ikonice), gubi se samo sa
  ikonice na početnom ekranu.
- **v3.92.0 "Dendro Map" rebrend — nova ikonica i login logo**: korisnik je
  dao gotovu grafiku `docs/DENDRO_MAP_source.jpg` (2816×1536 mockup: zlatni
  grb — kompas/planine/jelka/pin/valovi — na tamnozelenoj zaobljenoj kartici,
  natpis "DENDRO MAP" + "ŠPD Unsko sanske šume d.o.o." ispod) i tražio da to
  postane i app ikonica i slika na login ekranu. Postupak (ponoviti isto ako
  se master grafika ponovo mijenja):
  - Grb (bez teksta, bez kartice/border-a) izvučen iz mockupa preko
    `scipy.ndimage.label` connected-component analize nad "gold" maskom
    (prag boje), NE prostim bounding-box crop-om — mockup ima svoj zlatni
    border oko kartice koji bi automatski pravougaoni crop pokupio zajedno s
    grbom. Border je jedna velika povezana komponenta (obuhvata skoro cijelu
    karticu) — izbaci se po labelu; sitni ostaci (< 150px, npr. antialiasing
    fragment gornjeg ruba border-a) izbace se i filterom po veličini
    komponente. Rezultat: providan PNG, samo "ink" (isti princip kao ranije
    za splash_logo.png, ovdje automatizovano jer izvor NIJE bio čist crtež na
    jednobojnoj pozadini nego prezentacijski mockup s bordurom i tekstom).
  - `ic_launcher_background` promijenjen sa bijele (`#FFFFFF`, v3.81.0) na
    `#42523C` — tamnozelena uzorkovana medijanom piksela iz praznine između
    grba i teksta na mockupu (`np.median`, ne mean — paper-texture zrnavost u
    JPEG-u vuče mean previsoko). Namjerna promjena: novi brend je DIZAJNIRAN
    kao zlatno na tamnozelenom, bijela pozadina bi to osiromašila. Safe-zone
    pravilo (≤ 60% dijagonale) i "bez teksta na ikonici" pravilo iz v3.81.0/
    v3.91.0 i dalje važe nepromijenjeno — samo se boja pozadine i sam crtež
    mijenjaju.
  - `icon-192.png`/`icon-512.png` (PWA manifest, `sw.js` notifikacije) su isto
    regenerisani iz istog grba/boje radi konzistentnosti — inače bi Android
    notifikacija (koristi `icon-192.png`) i home-screen ikonica pokazivale
    različit brend.
  - Login logo (`index.html`, `.auth-logo-box img`, inline
    `data:image/jpeg;base64,...`) zamijenjen punim lockup-om (grb + oba reda
    teksta), izrezanim direktno iz mockupa uz malu marginu oko zlatnog
    border-a kartice — na login ekranu (veći prikaz, 115px) tekst je čitljiv
    pa se ne izbacuje kao kod ikonice. Ovo je JEDINO mjesto u `index.html` s
    `src="data:image/jpeg;base64,"` — sigurno za regex/string zamjenu bez
    parsiranja HTML-a.
  - `drawable/splash_logo.png` (nativni Android splash prije nego se WebView
    učita) i `colorSplash` (`#376638`) NISU dirani — korisnik je tražio samo
    "ikonu aplikacije i početnu sliku kod logina", što je login-ekran logo,
    ne native splash. Ako se i splash treba rebrendirati, to je odvojena,
    eksplicitno tražena izmjena.
- **Neodobrena registracija ističe za 7 dana** (`20260730_isticanje_
  registracije.sql`) — automatski se briše (korisnici + auth.users) ako admin
  ne odobri na vrijeme. Kolona `prvo_odobren_at` (nikad se ne resetuje nazad na
  NULL) razlikuje "čeka PRVO odobrenje" (briše se) od "opozvan nakon što je
  ranije bio odobren" (NE briše se) — obje imaju `odobren=false`, pa **nikad
  ne filtrirati čišćenje samo po `odobren`**, uvijek i po `prvo_odobren_at IS
  NULL`. Nema pg_cron-a (projekat namjerno bez CI/scheduled infrastrukture) —
  čišćenje se okida iz `admin_get_all_users()` (svaki put kad admin otvori tab
  Korisnici) i iz `check_own_pending_expiry()` (svaki put kad korisnik na
  ekranu "Čeka se odobrenje" klikne "Provjeri ponovo").
- **Ikonice glavne trake** (`#tab-bar`, Meni + 7 tabova) su od v3.83.0 crtane
  inline SVG (`.tbi` CSS klasa), ne emoji — emoji izgleda različito na svakom
  OEM-u/verziji Androida, nekad i kao prazan kvadratić. `stroke="currentColor"`
  znači da ikonica prati boju dugmeta identično tekstu (zelena pri aktivnom
  tabu preko `.tab-btn.active`, ili trajna amber/ljubičasta/zelena za
  Korisnici/Postavke/Teren preko inline `style="color:..."`) — **ne** hardkodovati
  boju u SVG-u, pokvario bi se taj mehanizam. Veličina je `em`, ne `px` — prati
  `font-size` dugmeta pa automatski postaje manja na mobilnom breakpointu bez
  posebne media-query grane. Emoji verzija (za vraćanje ako ustreba):
  `docs/BACKUP_traka_ikonice_emoji.md`.
- **Ikonice dugmadi u panelima** (v3.84.0): isti razlog i isti mehanizam, ali
  preko **SVG sprite-a** odmah iza `<body>` (65 `<symbol id="ic-...">`), pa se
  koristi `<svg class="ic"><use href="#ic-NAZIV"/></svg>`. Zamijenjeno je 398
  mjesta unutar `<button>` elemenata; emoji u toastovima, dijalozima i
  naslovima sekcija je NAMJERNO ostao. **SVG u dugmadima ne smije imati
  jednostruke navodnike ni backtick** — dio dugmadi se gradi u JS stringovima
  (`'...'` / `` `...` ``), pa bi ih to prekinulo; sve definicije koriste samo
  dvostruke navodnike. Mapiranje emoji→ikonica i postupak vraćanja:
  `docs/BACKUP_ikonice_dugmadi.md`.
- **Ikonica koja se čita iz mape/objekta (`neka_mapa[key]`) je automatska
  provjera preskočila** — lovila je samo doslovne `'...'` stringove sa emojijem,
  ne i indirektne lookup-e. Baš zbog toga je dugme za promjenu podloge karte
  (`layer-switch-btn`, `setLayer()` u index.html) gubilo ikonicu i vraćalo se na
  emoji čim korisnik izabere Topo/Satelit/Karta/Google — popravljeno u v3.91.0
  (`iconSvg[key]` umjesto starog `icons[key]` + `textContent`). Kod dodavanja
  NOVOG tile sloja u `TL` objektu, novi ključ mora ući i u `iconSvg` (dva mjesta:
  startup restore + `setLayer()`) i u `map2id`/`map2row`/`_CMGR_ROWS`, inače mu
  aktivni highlight, MB bedž ili offline keš pregled tiho ne rade.
- **Pristup firme se provjerava NA SERVERU, ne u JS-u**: od
  `20260727_pristup_odobrenje.sql` postoji `je_odobren()` (admin je implicitno
  odobren) i **RESTRICTIVE** politika `zzz_odobren` na svim tabelama s
  podacima. Restrictive politike se I-uju s postojećim permissive politikama,
  pa se nova tabela štiti dodavanjem te politike — **ne** prepisivanjem
  postojećih. `SECURITY DEFINER` funkcije zaobilaze RLS, pa svaka nova mora
  **sama** pozvati `je_odobren()` na početku. Gate u `showApp()` je samo UX.
- **`korisnici` ima trigger `korisnici_zastita`**: RLS ne zna ograničiti
  kolonu, pa se `odobren`/`is_admin`/`je_vodeci`/`sumarija`/`login_email`/`id`
  vraćaju na staru vrijednost pri UPDATE-u i prisilno gase pri INSERT-u (osim
  za admina i service_role). Zato **nikad ne pisati u TUĐI red `korisnici`** iz
  klijenta — to je nekad radio backfill boje kolega i baš zbog njega je tabela
  morala imati široku UPDATE politiku (= svako se mogao sam promovisati u
  admina). Boja bez zapisa se računa iz `_bojaZaId(id)`.
- **Uloge se ne izvode iz imena**: "vodeći projektant" je kolona
  `korisnici.je_vodeci` (postavlja je samo admin preko `admin_set_vodeci`).
  Regex nad imenom postoji još samo kao fallback za keš od prije migracije.
- **Nove kolone u upitima na `korisnici`**: koristiti `select('*')`, ne
  nabrajanje — migracije se pokreću ručno, pa eksplicitno traženje kolone koja
  još ne postoji obori cijeli upit (PostgREST vraća grešku).
- **GPS snimanje prekinuto telefonskim pozivom (ili sličnim)**: WebView-
  preživljavanje + native GPS bafer (`GpsService`, vidi `_drainNativeGpsBuffer`
  u index.html) štite od Activity-only uništenja (swipe iz recent apps), ali
  NE od OEM "battery manager"-a (Xiaomi/Samsung/Huawei i sl.) koji ubiju
  CIJELI proces — foreground servis i sve — kad procijene da app treba stati,
  klasično baš kad stigne poziv. Jedina prenosiva odbrana je izuzeće od Doze/
  App Standby (`GpsBridge.hasBatteryOptExemption/requestBatteryOptExemption`,
  `_checkBatteryOptHint` u index.html, pita se jednom pri prvom startu bilo
  kojeg snimanja) — OEM-specifične "autostart/protected apps" postavke se ne
  mogu tražiti programski.

## Kandidati za čišćenje (nisu hitni)

- ~~`copy-assets` kopira `forwarder.png`/`FORVARDER IKONA.png`~~ — riješeno:
  sve tri copy-assets skripte (`.sh`/`.ps1`/`build-apk.ps1`) sad kopiraju samo
  `forwarder.svg`, koji je jedini stvarno referenciran u index.html.
- ~~`_escHtml` definisan dva puta~~ — riješeno: uklonjena starija (nepotpuna,
  bez quote-escaping-a) definicija na ~8696, ostala jedna kod ~14820.
- ~~Neiskorišteni fajlovi u repou~~ — riješeno: `Gemini_Generated_Image_*.png`
  i `images (4).jpeg` obrisani (nigdje referencirani).

## Konvencija za svaku izmjenu

1. Sintaks-provjera svih `<script>` blokova u `index.html` (Node `new Function()` na svaki blok).
2. `node tests/js/offline-layer.test.js` ako izmjena dotiče offline sync.
3. Podigni sve tri verzije (vidi gore). Izmjene samo dokumentacije (ovaj fajl,
   README) ne traže bump verzije.
4. Commit poruka na bosanskom, objašnjava UZROK ne samo šta je promijenjeno.
5. Push na `claude/branch-072026-sa9wz0` (PR #30 se sam ažurira).
