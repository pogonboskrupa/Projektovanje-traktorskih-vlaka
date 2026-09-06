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
- **Panel Požari (v3.103.1, iz Menija od v3.103.2)**: detekcija sa satelita (NASA FIRMS), prijava požara
  sa terena, opožarene površine i indeks opasnosti (Copernicus EFFIS), hitni
  brojevi. Detekcije se povlače kao **PODACI (CSV), ne kao rasterski sloj** —
  prva verzija je bila WMS slika i ostala je PRAZNA kod korisnika, a iz prazne
  karte se ne vidi da li nema požara (najčešći i ISPRAVAN ishod), je li pao
  endpoint ili nema CORS-a. Podaci daju jednoznačan odgovor ("0 detekcija u
  krugu 150 km"), udaljenost/azimut od korisnika, popup sa vremenom i FRP-om,
  rade na svakom zumu i keširaju se za offline. `_poziLoad`/`_poziParseCsv`.
  **"Provjeri izvore" (`_poziProvjeriIzvore`) je alat za teren** — testira
  svaki izvor i ispiše HTTP status/CORS grešku, jer se iz razvojnog okruženja
  nijedan vanjski server ne može dozvati. Prijava požara je obična tačka
  (`_createTacka`) — namjerno, jer tačke već imaju offline rad, sync i
  dijeljenje. Test: `tests/js/pozari.test.js`.
- **Požari — "najbolji mogući podaci" (v3.104.0)**: korisnik je sa STVARNOG
  telefona (pravi internet, ne sandbox) prijavio da su sva 4 FIRMS arhivska
  CSV izvora "blokiran (CORS/mreža)". Istraženo (WebSearch, jer sandbox ne
  može dozvati `firms.modaps.eosdis.nasa.gov` ni za dokumentaciju): NASA-in
  arhivski CSV server (`/data/active_fire/.../csv/...`) je napravljen za
  wget/curl direktan preuzimanje, ne za browser `fetch()` — vrlo vjerovatno
  NE šalje `Access-Control-Allow-Origin` zaglavlje, pa ga ISPRAVNO
  konfigurisan browser odbija bez obzira na mrežu. **`fetch()` namjerno NE
  razlikuje CORS blok od mrtve mreže** (obje bacaju istu generičku
  `TypeError` — sigurnosno pravilo browsera), pa se to ne može pouzdano
  utvrditi iz JS-a; poruke u `_poziDohvati`/`_poziProvjeriIzvore` to sada
  eksplicitno objašnjavaju umjesto da pogađaju jedno od dvoje.
  Promjene:
  - **Svi izvori paralelno i SPOJENI** (`Promise.all`, bilo je redom-dok-
    jedan-ne-uspije) — VIIRS S-NPP/NOAA-20/NOAA-21 i MODIS imaju RAZLIČITE
    prelete, uzimanje samo prvog znači svjesno odbacivanje detekcija koje su
    OSTALI vidjeli. I brže javlja grešku (~15s umjesto do 60s).
  - **Grupisanje u požare** (`_poziGrupisi`, prag `_POZ_GRUPA_M`=1500m): isti
    požar vide RAZLIČITI sateliti/preleti — bez grupisanja "12 aktivnih
    detekcija" zvuči kao 12 požara umjesto 1 praćenog. Lista/sažetak/toast
    sad broje POŽARE (`_poziBrojRijecPozar`, muški rod — zaseban od
    `_poziBrojRijec` jer sklonidba mijenja i pridjev, ne samo imenicu).
  - **Vremenski okvir 24h/48h/7d** (`_poziOkvir`/`_POZ_OKVIRI`) — FIRMS iste
    izvore objavljuje u tri prozora, korisnik bira.
  - **"Novo od zadnje provjere"** (`_poziOznaciNove`, `localStorage
    tvlake_pozari_vidjeno`) — ključ požara (zaokružene koordinate) se pamti
    između učitavanja; forester na terenu odmah vidi ŠTA je novo bez da
    upoređuje ručno.
  - **Opcioni FIRMS MAP_KEY** (`_poziMapKey`/`_poziApiUrl`, `localStorage
    tvlake_pozari_mapkey`) — korisnik se SAM besplatno registruje na
    `firms.modaps.eosdis.nasa.gov/api/map_key/` (samo email, aplikacija taj
    email nikad ne vidi ni ne šalje) i zalijepi ključ u panelu. Dodaje Area
    API kao PETI, bbox-scoped izvor na DRUGAČIJOJ ruti servera (`/api/` vs
    `/data/`) — moguće da ima drugačiju CORS politiku od arhive.
  - **Vjetar kod najbližeg požara** (`_poziVrijeme`/`_poziOsvjeziMeteo`,
    Open-Meteo — ISTI API/pattern već dokazano CORS-prijateljski u ovoj app
    za N.V./elevaciju) + `_poziVjetarPrijeti` upozorenje kad vjetar duva OD
    požara KA korisniku (meteorološka konvencija: `wind_direction` je smjer
    ODAKLE vjetar duva, vatra ide u suprotnom). **Namjerno se NE kešira za
    offline** — prikazati JUČERAŠNJI smjer vjetra kao trenutan bi bilo opasno
    pogrešno usred stvarnog požara; bez mreže kartica se jednostavno ne
    prikaže.
  - **Namjerno NIJE dodato**: procjena izgorjele površine u hektarima iz broja
    detekcija — VIIRS/MODIS piksel je "vreo piksel", ne stvarna granica
    požara, i app već ima ISPRAVAN, precizniji alat za to (EFFIS opožarene
    površine, `_OVL.opozareno`). Umjesto toga grupa nosi `spanM` (najveća
    udaljenost između dvije detekcije u grupi) — geometrijska činjenica iz
    GPS koordinata, ne izmišljen broj.
- **Paralelno NIJE uvijek brže — na izgladnjeloj vezi je gore** (v3.104.1):
  drugi terenski test (sa MAP_KEY-em, VPN-om i vezom od ~1.4 KB/s, okvir "7
  dana") dao je 1× "blokiran" + 4× `signal timed out`. To je bio dokaz da
  v3.104.0 paralelizacija ima naličje: arhivski FIRMS CSV-ovi su izvozi za
  CIJELU Evropu (7-dnevni ide u megabajte), pa četiri istovremena preuzimanja
  dijele istu mrvicu propusnosti i **nijedno** ne stigne prije isteka —
  redom bi barem jedno prošlo. Zato sada:
  - Kad MAP_KEY POSTOJI, dohvaća se **samo** bbox Area API (krug oko
    korisnika, djelić veličine), a arhive se preskaču; ako ključ padne,
    arhive ostaju kao rezerva (`_poziDohvati` → `_poziDohvatiArhive`).
    Provjereno u browseru: bez ključa 4 arhive/0 API, sa ključem 0 arhiva/1
    API, sa neispravnim ključem 1 API + 4 arhive (rezerva radi).
  - Timeout za arhive podignut na 30s (veliki fajlovi), API ostaje 20s.
  - **Tip kvara se sada razlikuje i prevodi** (`_poziGreskaTxt`): `TypeError`
    → "odbijeno odmah (CORS ili nema mreže)", `TimeoutError`/`AbortError` →
    "nema odgovora na vrijeme (veza visi)". To su različiti problemi sa
    različitim rješenjima, a ranije je kroz UI curila sirova engleska poruka
    `signal timed out` iz `AbortSignal.timeout()`.
  - `_poziSavjet` bira savjet prema tipu kvara (sve isteklo → skrati okvir na
    24h, isključi VPN, unesi MAP_KEY; sve odbijeno → CORS/nema mreže objašnjenje),
    umjesto da uvijek ispisuje isti tekst o CORS-u.
- **Native HTTP most `AndroidNet` — CORS se NE može zaobići iz JS-a** (v3.105.0):
  treći terenski test je bio presudan — dobra veza (215 KB/s), najmanji okvir
  (24h), unesen MAP_KEY, i **svih pet izvora "odbijeno odmah"**, uključujući
  `/api/` rutu. Time je potvrđeno: FIRMS ne šalje CORS zaglavlja ni za arhivu
  ni za Area API, a CORS je pravilo BROWSERA koje JavaScript ne može zaobići
  nikakvim trikom (proxy servisi su tuđi serveri — nepouzdani i nisu rješenje
  za alat na koji se oslanja neko na terenu).
  - **U APK-u rješenje postoji**: native Java HTTP poziv nema CORS. Dodan je
    `MainActivity.NetBridge` (`webView.addJavascriptInterface(..., "AndroidNet")`,
    isti obrazac kao `AndroidGps`/`AndroidShare`). JS strana:
    `_nativeNetDostupan`/`_nativeNetFetch`/`_nativeNetOdgovor`, a
    `_poziDohvatiJedan` prvo proba most pa tek onda `fetch()`.
  - **Most NIJE opšti proxy** — samo `https` i samo `*.modaps.eosdis.nasa.gov`.
    Bez tog ograničenja bi bilo koji JS na stranici (uključujući nešto ubačeno
    kroz uvezeni KML/GeoJSON) mogao preko native sloja dohvatiti bilo šta,
    zaobilazeći sve zaštite koje browser inače nameće. Novi izvor koji treba
    most = novi unos u `dozvoljenHost`, svjesno i namjerno.
  - Tijelo se prenosi kao **Base64** (`Base64.NO_WRAP` → `atob` + `TextDecoder`)
    jer bi CSV sa navodnicima/prelomima reda/dijakritikom razbio ubacivanje u
    JS; svaki string koji ide u `evaluateJavascript` se escape-uje (`jsStr`).
  - **U web verziji (GitHub Pages) blokada OSTAJE** — tamo `AndroidNet` ne
    postoji pa se koristi stari `fetch()` put. `_poziSavjet` to sad i kaže
    otvoreno umjesto da nudi MAP_KEY kao rješenje (terenski test je dokazao
    da ključ ne pomaže protiv CORS-a). "Provjeri izvore" u prvom redu ispiše
    **način pristupa** (native vs browser) — bez toga se ne može znati koji
    je put uopšte testiran.
  - **Traži pun rebuild u Android Studiju** (mijenjan je `.java`) — sam
    `copy-assets` NE prenosi Javu, vidi pravilo o APK buildu gore.
  - Test: `tests/js/pozari.test.js` (JS polovina mosta — Base64/UTF-8,
    odbijanje, istek kad native strana zanijemi). Java se iz sandboxa ne može
    kompajlirati (nema Android SDK-a), pa je provjerena strukturno.
- **Global Forest Watch kao DRUGI SERVER za iste detekcije (v3.106.0)**: GFW
  preuzima NASA VIIRS podatke i servira ih sa `data-api.globalforestwatch.org`,
  koji ima SVOJU CORS politiku. Pošto je GFW-ova vlastita karta browser-app
  koja zove baš taj API, postoji realna šansa da prolazi tamo gdje NASA-in ne
  prolazi — i to je JEDINI razlog dodavanja (nije "više podataka", nego DRUGI
  PUT do istih). `_poziGfwUrl`/`_poziParseGfwJson`/`_poziGfwKljuc`.
  - Traži besplatan ključ sa GFW naloga, šalje se kao **`x-api-key` zaglavlje**.
    Vlastito zaglavlje u browseru okida **CORS preflight (OPTIONS)** — ako ga
    GFW ne odobri, pada i prije upita. U APK-u ne smeta (native most nema CORS),
    pa `_poziDohvatiJedan` sad prima `opts.headers` i prosljeđuje ih i native
    mostu (`NetBridge.fetchText` četvrti parametar, JSON sa zaglavljima) i
    `fetch()`-u. `data-api.globalforestwatch.org` je dodan u `dozvoljenHost`.
  - Parser je **pluggable** (`opts.parser`/`opts.provjera`) jer FIRMS vraća CSV
    a GFW JSON; sve ostalo (native/fetch put, mjerenje, prevod greške) je isto
    pa se ne duplira. GFW tačka se svede na ISTI oblik kao FIRMS (`la/lo/dt/
    sat/conf/frp/noc/rez`) da grupisanje/keš/prikaz ne moraju znati porijeklo.
  - **FRP je `NaN`, ne 0** — GFW u ovom pogledu ne vraća snagu požara, a 0 bi
    značilo "izmjereno nula", što nije isto kao "nije izmjereno".
  - **NAMJERNO NISU dodati GFW alarmi za sječu (GLAD-L/GLAD-S2/RADD)**, koliko
    god zvučali kao savršena stvar za šumariju: GLAD-L pokriva samo pojas
    30°N–30°S, GLAD-S2 samo Amazon, RADD samo vlažne trope. **Bosna je na
    ~44.9°N — daleko van svih.** Dodati ih značilo bi trajno prazan sloj iz
    kojeg se ne vidi je li mirno ili je pao izvor — tačno ona greška zbog koje
    je rasterski sloj iz v3.103.0 i bačen. Jedini GFW alarm sa GLOBALNOM
    pokrivenošću je **DIST-ALERT** (sve vegetacijske smetnje, ne samo šuma) —
    on bi pokrivao BiH i vrijedan je kandidat, ali je zaseban proizvod (nije
    "požar") pa nije nabacan uz ovu izmjenu.
  - Sažetak sad IMENUJE izvor kad je samo jedan ("Global Forest Watch") umjesto
    da broji ("1 izvor") — sa terena je važnije znati KOJI je server prošao.
    Sklonidba: `_poziBrojRijecIzvora` (1 izvor / 2+ izvora).
- **Udaljenost do požara i klik-navigacija (v3.106.1)**: dva stvarna bug-a sa
  ekipe koja testira na terenu.
  - **Udaljenost je tiho padala na centar karte** kad GPS nema fix
    (`_poziRefTacka` fallback) — za alat o BEZBJEDNOSTI to nije samo manje
    precizno, nego aktivno POGREŠNO: korisnik je mogao ranije pomjeriti/
    zumirati kartu bilo gdje (drugi odjel, drugi kraj karte), pa bi "5 km"
    prikazano na osnovu centra karte moglo biti kilometrima pogrešno u odnosu
    na stvarnu udaljenost. `_poziToggle(true)` sad, ako `lastP` (GPS fix) još
    ne postoji, pokreće GPS (`startGPS()`, ISTI watch koji koristi 📍 dugme na
    karti — `fabLokacija`) i tiho ponovo učita čim stigne prvi fix
    (`_poziCekajGps`, poll na 500ms / odustani nakon 15s, isti obrazac kao
    `fabLokacija`). Dok se čeka, `_poziMeta.refGps` je `false` i `_poziSazetak`
    to NAPADNO ispisuje ("⚠ od centra karte, ne tvoje pozicije") umjesto tihe
    fusnote — ranije je to pisalo SAMO u popup-u pojedinačnog markera, ne i u
    statusnoj liniji/listi/toast-u gdje ga korisnik prvo vidi.
  - **Klik na požar u listi nije vidljivo navigirao nigdje** — `_poziZoom`
    je pomjerao `map.setView(...)`, ali #pozari-panel je OTVOREN PREKO CIJELE
    KARTE (isti obrazac kao Doznaka/Vlake), pa je karta iza njega SAKRIVENA.
    Korisnik klikne, ništa se vidljivo ne desi, i mora ručno otići na Kartu da
    provjeri je li se uopšte nešto pomjerilo. Sad `_poziZoom` prvo zove
    `switchTab('karta')` (isti obrazac kao `_poziPrijavi`), pa TEK POSLIJE
    (unutar `setTimeout` — `switchTab('karta')` sam zove `map.invalidateSize()`
    poslije 50ms jer je karta bila `display:none` i Leaflet ne zna svoju pravu
    veličinu) pomjera pogled i otvara popup markera.
  - Provjereno u browseru (Playwright): klik na požar mijenja aktivni tab na
    "Karta" i centrira TAČNO na koordinate požara; GPS mock koji "uhvati"
    fix poslije 1.5s pokazuje upozorenje prije toga i ispravnu udaljenost
    (5.16 km, ne udaljenost od stare pozicije karte) poslije. 3 nova testa u
    `tests/js/pozari.test.js` (52 ukupno) za `_poziSazetak` upozorenje.
- **Podtab Sječa/vjetroizvale, markeri grupisanja, upozorenja (v3.107.0)**:
  - **Podtabovi u panelu** (`_poziPodtab`/`_poziPostaviPodtab`, `localStorage
    tvlake_pozari_podtab`): "🔥 Požari" i "🪵 Sječa / vjetroizvale". Sječa je
    ZASEBAN satelitski proizvod (smetnja vegetacije), ne požar — ali dijeli
    kontekst "šta se dešava u mojoj šumi", pa dijeli panel umjesto da traži
    svoj tab u traci (koja je puna). `_poziRenderPanel` sad samo crta traku
    podtabova i delegira na `_poziSadrzajHtml`/`_sjeSadrzajHtml`.
  - **Sječa koristi `gfw_integrated_alerts`, NE `umd_glad_dist_alerts`
    zasebno** — integrisani sloj objedinjuje GLAD-L, GLAD-S2, RADD i
    **DIST-ALERT**, a DIST-ALERT je JEDINI od njih sa globalnom pokrivenošću
    (ostali su tropi; BiH je na ~44.9°N). Imena polja su mu dosljedna
    (`gfw_integrated_alerts__date`/`__confidence`), dok dokumentacija za
    zaseban DIST-ALERT dataset miješa `umd_glad_landsat_alerts__*` polja.
    Traži isti GFW ključ kao požari. `_sjeUrl`/`_sjeParse`/`_sjeLoad`.
  - **Parametri grupisanja se RAZLIKUJU po proizvodu**: VIIRS piksel je 375 m
    (prag 1500 m), DIST-ALERT je 30 m (prag `_SJE_GRUPA_M`=300 m). Zato su
    `_poziGrupisi(pts, pragM)` i `_poziOznaciNove(grupe, kljuc, preciznost)`
    parametrizovani. **`_poziEvtKljuc` preciznost je bitna**: podrazumijevanih
    100 (~1.1 km) bi za sječu spojilo dvije sječine na 400 m u isti ključ i
    druga nikad ne bi bila "nova" — zato sječa koristi 1000 (~110 m).
  - **Površina se procjenjuje SAMO za sječu, ne za požare**: DIST-ALERT piksel
    od 30 m označava stvarno izmijenjenu vegetaciju pa `broj × 900 m²` ima
    smisla kao "≈ X ha"; VIIRS piksel je "vreo piksel", ne izgorjela površina,
    i tamo takva računica ostaje NAMJERNO izostavljena (v3.104.0).
  - **Markeri grupisanja na karti**: lista je odavno pokazivala "1 požar, 6
    detekcija", ali karta je i dalje crtala 6 pinova jedan preko drugog. Sad
    grupa ima JEDAN marker sa brojem (`.poz-mk-grupa`), a pojedinačni pikseli
    ostaju kao sitne tačke (`.poz-mk-mala`) — broj kaže koliko puta je viđen,
    tačke pokazuju stvarni doseg (piksel je podatak, ne smije se sakriti).
    Sječa ima kvadratne markere (`.sje-mk*`) da se razlikuje od požara i kad
    su boje slične. `_poziZoom`/`_sjeZoom` sad koriste `g._mk` (referenca
    zakačena pri crtanju) umjesto traženja po indeksu u nizu.
  - **Upozorenje na nov požar** (`_poziNotifToggle`, prag 10/25/50 km,
    provjera na 15 min, `show-pozar-notification` u `sw.js`). **Dometu se ne
    laže**: radi dok je aplikacija pokrenuta (i u pozadini dok je Android ne
    ugasi), NE kad je potpuno zatvorena — CLAUDE.md već dokumentuje da OEM
    battery manager ubija cijeli proces, pa bi obećanje "javićemo ti i ugašeno"
    bilo lažno. UI to kaže otvoreno. `_POZ_NOTIF_SEEN` pamti za šta je već
    javljeno da isti požar ne zvoni pri svakom osvježavanju.
  - Provjereno u browseru: 16 detekcija → 2 požara, marker sa "12", 16 sitnih
    tačaka; sječa 3 alarma → 2 grupe; notifikacija poslana ka SW-u sa tačnim
    naslovom/tijelom; klik na alarm prebacuje na Kartu i centrira. 61 test.
  - **Zamka pri Playwright testiranju**: `p.evaluate(() => map.setView(...))`
    BEZ vitičastih zagrada vraća Leafletov map objekat, koji Playwright
    pokušava serijalizovati (cikličan, sa DOM čvorovima) i pukne uz poruku
    "Execution context was destroyed, most likely because of a navigation" —
    koja navodi na pogrešan trag (nema nikakve navigacije). Uvijek pisati
    `() => { map.setView(...); }`. Usput: app NAMJERNO reloada stranicu kad
    SW preuzme kontrolu (v3.111.4: vremenski prag 5s po tabu, ne "najviše
    jednom ikad" — vidi zamku "Više verzija zaredom u istoj kartici" ispod),
    pa test treba sačekati `sessionStorage.getItem('sw-reloaded-at')` da
    postoji prije mjerenja.
- **Trake udaljenosti u listi požara (v3.108.0)**: lista se RAŠČLANJUJE na tri
  trake (`_POZ_TRAKE` — do 20 km / 20–40 km / preko 40 km), ne filtrira —
  požar na 90 km je i dalje u krugu od 150 km i ostaje vidljiv, samo pod
  zaglavljem "Preko 40 km" da ne konkuriše vizuelno onome na 5 km. `_poziEvts`
  je već sortiran po udaljenosti pa se svaka traka izdvaja jednim filter-om;
  `onclick="_poziZoom(i)"` MORA nositi ORIGINALNI indeks iz `_poziEvts` (ne
  poziciju unutar trake) — ista klasa greške kao dokumentovano "Pozicija u
  DOM-u NIJE indeks u nizu" gore, ovdje pokrivena testom koji namjerno miješa
  redoslijed traka da uhvati baš tu zamku. Svaka traka prikazuje do
  `_POZ_PO_TRACI`=6 požara pa "…i još N", a brojka u zaglavlju ("Preko 40 km
  (12)") uvijek broji SVE u toj traci, ne samo prikazane.
- **Sort/filter liste požara + suženje radijusa na 100 km (v3.110.0)**: na
  eksplicitan zahtjev dodan je `_POZ_SORTOVI` izbor iznad liste — "Bliže prvo"
  (zadano), "Dalje prvo", "Novije prvo" (`_poziSort`/`_poziPostaviSort`,
  `localStorage tvlake_pozari_sort`). **Trake udaljenosti (v3.108.0) imaju
  smisla SAMO za "bliže prvo"** — taj sort ih zadržava nepromijenjene jer je
  `_poziEvts` već rastuće sortiran po udaljenosti; ostala dva načina namjerno
  prikazuju RAVNU listu bez traka (kapa `_POZ_LISTA_MAX`=18, "…i još N") jer bi
  sortiranje po vremenu miješalo bliske i daleke požare pa bi podjela na trake
  bila zbunjujuća. `_poziListaHtml` u sva tri slučaja pravi NOVI poredak nad
  kopijom parova `{g,i}` — `i` (indeks koji `onclick="_poziZoom(i)"` nosi)
  ostaje ORIGINALNI indeks u `_poziEvts`, isti princip kao kod traka. Uz to je
  `_POZ_RADIUS_KM` sužen sa 150 na 100 km (eksplicitan zahtjev) — utiče na sve
  što ga čita (`_poziFilterBlizu`, tekst "krug X km" u statusu/toastu/karticama)
  bez posebne izmjene na tim mjestima jer svi čitaju istu konstantu.
- **Blokirajuća poruka PRIJE pokušaja je gora od greške POSLIJE pokušaja**
  (v3.108.1): podtab Sječa je pri uvođenju (v3.107.0) sakrivao CIJELI prekidač
  i sadržaj iza teksta "za ovaj sloj treba GFW ključ" ako ključ nije unesen —
  korisnik ne bi mogao ni pokušati dok ne ode do drugog podtaba. `_sjeLoad` je
  već imao ISPRAVNO ponašanje (`_sjeMeta.greska='nema-kljuca'` kad se prekidač
  uključi bez ključa) — blokada iznad njega je bila suvišan DRUGI gate koji je
  samo dodavao trenje. Uklonjen: prekidač je sad UVIJEK vidljiv (isti obrazac
  kao Požari), a nedostatak ključa se prikazuje kao obična, čitljiva greška
  TEK kad korisnik stvarno pokuša — sa uputstvom šta uraditi, ne sirovim
  internim kodom `'nema-kljuca'` (taj sentinel se prevodi u `_sjeSadrzajHtml`,
  ne procuri u UI). Isti princip kao Požari-jev `_poziProvjeriIzvore`: pusti
  korisnika da proba, objasni šta je pošlo po zlu tek ako pođe.
- **Panel bez svog taba u traci MORA imati dugme Nazad** (v3.103.2): Požari se
  otvaraju iz Menija (`switchTab('pozari')` u `.mdrop-item`), a ne iz `#tab-bar`
  — traka je već puna sa 7 tabova i požari nisu svakodnevni alat kao Vlake/
  Doznaka. Posljedica: `switchTab` označava aktivni tab tako što traži
  `.tab-btn` čiji `onclick` sadrži `switchTab('<tab>')`, pa kad tog dugmeta nema
  **nijedan tab nije istaknut** — korisnik ostane u panelu bez očitog povratka
  (mora pogoditi da klikne Karta). Zato `#pozari-panel` ima u zaglavlju dugme
  `switchTab('karta')` (`#ic-nazad`). Svaki NOVI panel koji se otvara iz Menija
  umjesto iz trake treba isto dugme.
- **Slojevi karte (v3.103.0)**: Konture (izohipse) i Pokrivenost zemljišta
  (ESA WorldCover — zamijenio EOX Sentinel-2 na istom mjestu u layer-sheetu,
  vidi `TL['🌍 Sentinel']`). Konture su BESPLATNE mrežno
  — crtaju se iz VEĆ preuzetog Terrarium DEM-a (`_getTerrariumTile`/`_TERR_CACHE`,
  isti keš kao Nagib/N.V./Ekspozicija), marching-squares u `_drawContours`/
  `_msCellSegments`. WorldCover i EFFIS slojevi su WMS servisi (bbox `GetMap`, ne XYZ
  predložak) — `makeCachedTileLayer(cacheName, L.TileLayer.WMS)` (drugi
  parametar, opcion) daje im ISTU keš/timeout/retry logiku kao Topo/Satelit/
  Karta. Test: `tests/js/dem-contours.test.js`.
- **Vremenska traka — Esri World Imagery Wayback (v3.111.0)**: na zahtjev "kao
  Google Earth, da mogu vraćati snimak" — Google sam nema besplatan API bez
  ključa za istorijske snimke, ali Esri javno i bez ključa nudi ISTO: arhivu
  prošlih verzija SVOJE World Imagery podloge (ista koju app već koristi kao
  "🛰 Satelit"), unazad do 2014, novi release otprilike mjesečno. Bitno za
  korisnika: ZIMSKI snimak (bez lišća na lišćarima) mnogo jasnije pokazuje
  četinare, šumske puteve i prosjeke nego ljetni — dugme "🌨 Zima" u pikeru
  skače na najnoviji zimski release (`_wbNajblizaZima`, mjesec 12/01/02).
  **NIJE dnevni snimak za bilo koju tačku svijeta** — mozaik se ažurira po
  dijelovima svijeta u različitim intervalima, pa izabrani datum znači "ovo
  je bilo najnovije dostupno u tom release-u", ne garantovano baš taj dan na
  tvojoj lokaciji — status ispod pikera to izričito piše, ne samo datum.
  - Config JSON (`waybackconfig.json`, `s3-us-west-2.amazonaws.com`, javan,
    bez ključa — potvrđeno uživo prije ožičavanja, ne nagađano kao GFW
    prognoza koja je odbijena) daje listu release-a; svaki već nosi PUN tile
    URL template (`{level}/{row}/{col}` = standardni Web Mercator XYZ), ne
    treba ručno slagati URL. Datum je ugniježđen u `itemTitle`
    ("World Imagery (Wayback 2026-08-05)"), NIJE poseban JSON field — prvi
    regex pokušaj (`/\((\d{4}...)\)/`, tražio `(` NEPOSREDNO prije datuma) je
    promašio jer je stvarni format "(Wayback DATUM)" — datum prati "Wayback "
    razmak, ne otvorenu zagradu. Uhvaćeno testom (`tests/js/wayback.test.js`)
    prije push-a, ne na terenu.
  - Wayback PRIVREMENO zamjenjuje bazni sloj (`_wbHideBase`/`_wbRestoreBase`)
    dok je uključen — NAMJERNO ne dira `_saveLastMap`/`_activeLayerKey` stanje
    trajno, jer bi inače ponovno otvaranje app-a moglo tiho pokazati snimak iz
    2019. umjesto trenutnog stanja. Isti `_wbTileLayer` (jedna instanca) mijenja
    URL preko `.setUrl()` kad korisnik promijeni datum — ne pravi se nova
    instanca po datumu.
  - CORS na `wayback.maptiles.arcgis.com` NIJE bilo moguće potvrditi iz
    sandboxa (isti domen-egress limit kao za svaki nov mrežni sloj — vidi
    zamke ispod) — ista ArcGIS Server infrastruktura kao već dokazano radeći
    `server.arcgisonline.com`, razumna pretpostavka, ali treba potvrdu na
    uređaju. `makeCachedTileLayer` (isti obrazac kao Topo/Satelit) već tretira
    pali fetch kao praznu providnu pločicu, ne rušenje.
  - Novi keš bucket `tvlake-wayback-v1` — dodat u `_CMGR_ROWS` (Upravljanje
    keširanim kartama) i u `sw.js` routing (`_tileRespond`), isti obrazac kao
    svaki dosadašnji tile host. Config JSON se NE kešira u Cache Storage —
    ima svoj `localStorage` keš (`_wbUcitajReleases`, offline-first isti
    obrazac kao FIRMS detekcije) jer je to lista release-a, ne pločica.

## Zamke specifične za dodavanje NOVOG mrežnog sloja karte

- **Sandbox ne može provjeriti NIJEDAN vanjski tile server** — čak ni
  `tile.opentopomap.org`/`tiles.maps.eox.at` (postojeći, uredno rade na
  telefonu) vraćaju `HTTP 000` odavde; `curl -sS "$HTTPS_PROXY/__agentproxy/
  status"` pokaže `connect_rejected` za SVAKI novi domen (allowlist je uzak i
  ne znači da servis ne radi). Jedini domen koji je do sada odgovarao je
  `elevation-tiles-prod.s3.amazonaws.com`. Zaključak: nemoguće je uživo
  potvrditi da je WMS layer-name/endpoint tačan prije nego korisnik proba na
  telefonu — zato svaki takav sloj mora imati graceful failure (postojeći
  `makeCachedTileLayer` već tretira pali fetch kao "prazna providna pločica",
  ne rušenje) i jasan komentar u kodu da endpoint treba terensku potvrdu.
  Umjesto uživo provjere, testirati END-TO-END kroz Playwright `page.route()`
  presretanje (mock 200 odgovor) — potvrđuje da app GRADI ispravan URL (bbox,
  layer-name, format), ne da server stvarno postoji.
- **Novi `TL[key]` ili `_OVL[key]` mora ući na SVA mjesta koja CLAUDE.md već
  navodi za postojeće slojeve** (`iconSvg` ×2, `map2id`/`map2row`, `_CMGR_ROWS`,
  `layer-opt` dugme) — ALI ako se KLJUČ ne mijenja (samo sadržaj ispod njega,
  kao kod WorldCover zamjene za Sentinel), sva ta mjesta koja čitaju ključ kao
  string ostaju netaknuta; mijenjaju se samo VIDLJIVI tekstovi (dugme, sub-
  labela) i `_CMGR_ROWS` red (id/name/cache/host). Provjeriti prije nego se
  ključ mijenja: da li je ijedan JS `const TL = {...}` blok definisan PRIJE
  keš-konstante koju referenciše (JS `const` nije hoistovan — vidi kako su
  `_WC_CACHE`/`CachedWCover` morali biti pomjereni ISPRED `const TL = {`).

## Poznate zamke (naučeno na stvarnim bugovima)

- **Više verzija zaredom u istoj dugo otvorenoj kartici — auto-update stane
  poslije PRVOG reload-a** (v3.111.4): korisnik je tri puta zaredom prijavio
  ISTI render-bug (mreža linija na karti) poslije tri različite popravke
  (v3.111.1/v3.111.2/v3.111.3), svaki put "opet isto"/"i dalje ima" — iako je
  treća popravka (v3.111.3) provjereno bila ISPRAVNA i live na GitHub Pages
  (potvrđeno preko `actions_list`/`list_workflow_runs`: deploy je uspješno
  završen za tačan commit koji korisnik testira). Uzrok NIJE bio u popravci
  nego u SW auto-update mehanizmu: `sw-reloaded` je bio boolean koji se
  postavi na `'1'` NAKON PRVOG `controllerchange` i nikad se ne resetuje u
  toj sesiji taba — svaki SLJEDEĆI `controllerchange` (a njih ima tačno
  onoliko koliko je verzija objavljeno dok je tab otvoren) je tiho preskočen.
  Service worker ISPOD je i dalje uredno napredovao na najnoviju verziju, ali
  stranica U MEMORIJI (HTML/CSS/JS) je ostajala zaglavljena na verziji iz
  PRVOG reload-a — bez ijednog vidljivog znaka da postoji razlika, jer
  `showUpdateToast()` iskoči SAMO dok traje snimanje (GPS/trag/doznaka), ne i
  u ovom "tihom" putu. Rezultat: korisnik koji drži tab otvoren cijeli dan
  dok stižu popravke ostaje zauvijek jednu (ili više) verziju iza, i svaki
  test ispada "nije popravljeno" bez obzira koliko puta se stvarno popravi.
  Riješeno zamjenom booleana VREMENSKIM pragom (`sw-reloaded-at`, 5s) —
  sprječava pravu petlju (dva reload-a odmah jedan za drugim), ali dozvoljava
  SVAKI sljedeći reload kad su verzije razmaknute minutama/satima, što je
  stvarni obrazac rada na ovom projektu (više popravki u istoj sesiji).
  **Pouka**: kad se ista prijava ponovi i poslije popravke koja djeluje
  ispravno u kodu, PRIJE nagađanja o kodu provjeriti da li je popravka uopšte
  STIGLA do korisnika — `mcp__github__actions_list` (`list_workflow_runs` za
  `deploy.yml`) potvrđuje da li je deploy za taj tačan commit uspio, a ako
  jeste, sljedeća sumnja ide na SW/keš isporuku na klijentu, ne na sadržaj
  popravke.
- **Vidljiva mreža/šahovska tabla preko CIJELE karte, na SVAKOJ podlozi**
  (v3.111.2 → pravi uzrok nađen u v3.111.3): korisnik je prijavio linije "kao
  ispisani meridijani" — pravilna mreža vodoravnih i uspravnih linija preko
  cijelog ekrana, na SVIM podlogama UKLJUČUJUĆI offline SQLite/MBTiles karte
  (dakle nije mogao biti nijedan mrežni/WMS sloj — zajednički imenilac je bio
  LEAFLET-OV TILE RENDERING SAM PO SEBI, ne izvor pločica).
  - **v3.111.2 (NEDOVOLJNO)**: uklonjen `.leaflet-tile { image-rendering:
    pixelated }` — razumna prva pretpostavka (isključuje browser-ovo glačanje
    između pločica), ali korisnik je poslao screenshot i prijavio "opet isto"
    — mreža je i dalje bila tu.
  - **v3.111.3 (POTVRĐEN pravi uzrok)**: umjesto nagađanja treći put,
    napravljena je IZOLOVANA Playwright reprodukcija — lokalni Leaflet
    (postojeći `static/libs/leaflet.min.js`, isti fajl kao APK fallback) +
    stvarni `makeCachedTileLayer` izvučen iz `index.html` + stvarne CSS
    definicije, sa dvobojnim (crvena/plava) lažnim pločicama preko lokalnog
    HTTP servera i magenta pozadinom iza tile-pane (da se BILO KAKAV razmak
    vidi eksplicitno) — mjereno piksel-po-piksel dekodiranjem PNG-a (ne
    okom po screenshotu, koji chat-alat sam skalira i može UNIJETI lažne
    linije kompresijom/resize-om). Rezultat: 45 magenta piksela tačno na
    granici dvije pločice kad `.leaflet-tile-container` I `.leaflet-tile-pane`
    oba nose `will-change: transform` — svaka pločica se promoviše u ZASEBAN
    compositor layer, i bilinearno uzorkovanje na ivici te teksture pokupi
    providnu/pozadinsku boju umjesto susjedne pločice. Uklanjanjem
    `will-change` SA TA DVA SELEKTORA (ne i sa `.leaflet-map-pane`/
    `.leaflet-proxy`/`.leaflet-zoom-animated`, koji ostaju GPU-ubrzani za
    glatko panovanje/zumiranje) nestaje 0/9625 piksela na granici u istom
    testu, potvrđeno na DPR 1/2.75/3 i poslije simuliranog panovanja.
  - Pouka za sljedeći put: kad se render-bug ne da lako dijagnosticirati
    pogledom, a postoji LOKALNA kopija biblioteke (vidi `static/libs/`),
    napraviti izolovanu Playwright reprodukciju sa lažnim (kontrastnim)
    pločicama i PIKSELIMA, ne nagađati redom koji CSS red "izgleda sumnjivo"
    — druga pretpostavka (v3.111.2) je bila stvarna ali NEDOVOLJNA promjena,
    i bez piksel-tačne provjere bi treći pokušaj opet bio nagađanje.
  - **v3.111.4 (deploy provjeren, ali korisnik i dalje "opet isto")**: prije
    daljeg nagađanja provjereno preko `mcp__github__actions_list`
    (`list_workflow_runs` za `deploy.yml`) da je deploy za v3.111.3 stvarno
    uspio i da korisnik (potvrđeno preko broja verzije u Meniju) STVARNO
    gleda tu verziju — dakle popravka sa v3.111.3 JESTE live, a linije SU I
    DALJE tu. Ovo je važno razlikovati od ranijih "opet isto" javljanja gdje
    je uzrok bio isporuka (v. zamku "Više verzija zaredom u istoj kartici"
    gore), ne sadržaj popravke.
  - **v3.111.5 (i dalje NEPOTVRĐENO na stvarnom uređaju)**: pošto je izolovana
    Playwright reprodukcija (softverski renderovan Chromium bez pravog GPU-a)
    potvrdila da je `will-change` mehanizam uklonjen, a stvarni Android
    telefon i dalje pokazuje mrežu, zaključak je da REALAN GPU/drajver ima
    DODATNI ili DRUGAČIJI mehanizam koji sandbox ne može reprodukovati.
    Dodano: `backface-visibility:hidden` uklonjen i sa `.leaflet-tile` (i on
    je, nezavisno od will-change, poznat kao trigger za promociju u zaseban
    compositor layer na nekim GPU-ima), plus `outline:1px solid transparent`
    — poseban, dobro dokumentovan trik iz Leaflet zajednice (GitHub issue
    #3575) za hairline razmake koji dolaze od Blink layout sub-piksel
    zaokruživanja, DRUGAČIJI mehanizam od GPU compositor-slojeva riješenog u
    v3.111.3. Isključeno testom da GOOGLE MAPS na ISTOM telefonu NEMA ovaj
    problem — dakle nije hardver/ekran/OS-podešavanje, nego nešto specifično
    za Leaflet-ov raster-tile pristup (Google Maps koristi WebGL/vektorske
    pločice, ne DOM `<img>` rastere). Ako i OVO ne pomogne, sljedeći korak
    nije još jedna CSS pretpostavka nego drugačija dijagnostika (npr. screen
    recording sa terena, ili razmatranje da se ukloni blob-URL pristup u
    `createTile` u korist direktnog `img.src = url`, jer blob: URL-ovi na
    nekim Android Chrome verzijama dobijaju vlastitu compositor promociju
    NEZAVISNO od CSS-a, što bi objasnilo zašto sandbox (koji ne pravi tu
    promociju) ne vidi bug koji stvaran telefon vidi).
  - **v3.111.6 (drugačiji mehanizam, ne još jedna CSS pretpostavka)**: v3.111.5
    NIJE pomogao ("i dalje isto") — screenshot je i dalje pokazivao MALE
    "slomljene slike" ikonice (sivi kvadrat sa oblakom/planinom) u istim
    relativnim pozicijama kao u PRETHODNOM screenshotu, dosljedno kroz više
    javljanja. To je bio trag da problem NIJE kozmetički CSS razmak nego
    STVARNI gubitak sadržaja pločice. Uzrok pronađen u `createTile`: sve tri
    grane (mrežni uspjeh, keš pogodak, zamućeni roditelj-fallback) su zvale
    `URL.revokeObjectURL(u)` ODMAH na `img.onload` — razumno na prvi pogled
    ("slika je gotova"), ali Leaflet REUSE-uje `<img>` tile elemente
    (`keepBuffer`, zoom in pa out — vidi napomenu u kodu), pa prikazana
    pločica ostaje u DOM-u i van ekrana. Ako mobilni browser pod pritiskom
    memorije (uobičajeno na telefonu, rijetko na desktopu sa mnogo RAM-a)
    odluči da ODBACI dekodiranu bitmapu i kasnije je PONOVO dekodira iz
    `src`-a (npr. kad se pločica vrati u vidno polje ili promoviše u novi
    compositor layer), a blob URL je već revoke-ovan, dekodiranje TRAJNO
    puca — otud slomljena ikonica, i to specifično SPORADIČNO (zavisi koje
    su pločice trenutno van ekrana kad memorija zafali), što objašnjava zašto
    su iste ikonice viđene u istim OKVIRNIM pozicijama kroz više javljanja.
    Ovo je i objasnilo zašto NIJEDNA CSS izmjena (v3.111.2/.3/.5) nije
    pomogla — uzrok nije bio kompozitorski razmak nego stvaran gubitak
    slikovnih podataka. Riješeno: blob URL se čuva na `img._blobUrl` i
    revoke-uje se TEK na `tileunload` (kad Leaflet stvarno napusti pločicu,
    van `keepBuffer` opsega) ili kad se ISTOM img elementu dodijeli NOVI blob
    (retry), preko `setSrc()` helpera — nikad prije. Test:
    `tests/js/tile-bloburl.test.js`, izvlači stvarni `makeCachedTileLayer` i
    provjerava da revoke NIKAD ne prethodi tileunload-u/zamjeni, i da retry
    ne curi memoriju (stari blob se ipak revoke-uje, samo kasnije).
    **Zamka pri pisanju OVOG testa**: testovi mutiraju STVARNE Node globals
    (`global.URL`/`fetch`/`caches`/`document`) jer je to ono što
    `makeCachedTileLayer` referencira — obrazac "pokreni sve testove pa čekaj
    na kraju" (koji koriste drugi test fajlovi sa `new Function` sandbox-om
    za PRAVU izolaciju) bi ovdje značio da kasniji test svojim `makeEnv()`
    pozivom prepiše globals dok je raniji test još u letu — testovi ovdje
    zato idu striktno redom, svaki čeka svoj kraj prije sljedećeg.
- **Odgovor 200 OK koji NIJE slika = slomljena pločica = siva MREŽA preko
  karte** (v3.111.7 — konačan uzrok mreže linija, poslije pet promašenih
  pokušaja): ključni trag je bio POLOŽAJ malih "slomljena slika" ikonica na
  korisnikovim screenshot-ovima — one su tačno u GORNJEM LIJEVOM UGLU svake
  ćelije mreže, a razmak ćelija je (uz DPR uređaja) tačno 256 CSS px. Dakle
  linije NISU spojevi pločica podloge (kako su pretpostavljale sve CSS
  popravke v3.111.2/.3/.5), nego IVICE SLOMLJENIH SLIKA jednog sloja PREKO
  karte: browser za `<img>` čiji se sadržaj ne može dekodirati crta ikonu
  slomljene slike u gornjem lijevom uglu i vidljivu kutiju — 256px do 256px
  = mreža preko cijelog ekrana. Zato se vidjelo na SVAKOJ podlozi (uklj.
  offline MBTiles) — jer je krivac bio OVERLAY iznad njih, a ne podloga.
  - Uzrok u `createTile`: svaki `r.ok` odgovor je tretiran kao slika. WMS
    server sa POGREŠNIM imenom sloja/endpointom klasično vraća **200 OK sa
    XML ServiceException** (ne 404!) — a EFFIS (`_OVL.fwi`/`_OVL.opozareno`)
    i WorldCover su upravo takvi, NIKAD PROVJERENI endpointi (CLAUDE.md to
    izričito piše od v3.103.0). Taj XML je pretvaran u blob, upisivan u KEŠ
    i dodjeljivan `img.src` → slomljena slika po pločici, i to TRAJNO jer se
    otrovan zapis servirao iz keša i offline. `_ovlState` se čuva u
    localStorage i vraća pri svakom pokretanju → problem "uvijek tu".
  - Popravka: `jeSlika(r)` provjerava `Content-Type` prije nego odgovor
    postane slika (prazan CT se DOPUŠTA — neki tile serveri ga ne šalju, a
    pogrešan sadržaj u praksi uvijek dolazi kao text/xml ili text/html);
    ne-slika se ne kešira i ne postaje `img.src`. Keš se usput ČISTI: zapis
    koji nije slika se briše pri prvom nailasku (otrovani zapisi upisani
    starijim verzijama nestaju sami).
  - Uz to: `_wbTileLayer` (Vremenska traka) je konstruisan sa PRAZNIM URL
    predloškom dok korisnik ne izabere datum — `fetch('')` dohvata SAMU
    STRANICU (HTML, 200 OK!), što bi kroz isti put dalo istu slomljenu
    mrežu. Sad `createTile` odmah odustane ako je URL prazan.
  - **Pouka**: kad se render-bug opire CSS popravkama, pogledati DA LI ima
    ikonica slomljene slike i GDJE su — položaj (gornji lijevi ugao ćelije)
    i razmak (256 CSS px) odmah razlikuju "spoj pločica" od "pločica čiji
    sadržaj nije slika". I: nikad ne pretpostaviti da je `r.ok` ⇒ slika.
  - Test: `tests/js/tile-bloburl.test.js` (XML/HTML odgovor se odbija, prazan
    Content-Type se dopušta, otrovan keš zapis se briše, prazan URL ne dira
    mrežu).
- **"Script error." bez linije/poruke = maskirana cross-origin greška**
  (v3.111.1): korisnik je na webapp-u (browseru) prijavio crveni baner "JS
  GREŠKA: Script error. (linija 0)" odmah pri otvaranju. `window.onerror`
  prima `message='Script error.'` i `lineno=0` (bez pravog fajla/linije/poruke)
  kad greška nastane UNUTAR `<script src="...">` sa DRUGOG porijekla
  (cdnjs.cloudflare.com/cdn.jsdelivr.net za Leaflet/proj4/Turf/Supabase/
  Shapefile) BEZ `crossorigin="anonymous"` atributa — ovo je namjerno
  sigurnosno ponašanje browsera (sprječava curenje sadržaja tuđeg skripta), ne
  bug u app-u. Postojeći `_libErr`/`onerror="..."` na tim `<script>` tagovima
  hvata samo MREŽNI neuspjeh učitavanja (404, prekinuta konekcija) i tad pada
  na lokalni `appassets.androidplatform.net` fallback (radi SAMO u APK-u, ne
  na webapp-u) — ne hvata grešku KOJA SE DESI DOK se već preuzeta biblioteka
  izvršava (npr. djelimično/oštećeno preuzimanje na slaboj vezi koje browser
  ipak tretira kao "uspješno učitano"). Ta druga vrsta greške ide na
  `window.onerror`, i bez `crossorigin` atributa detalji su POTPUNO skriveni —
  ni iz konzole na terenu se ne bi vidjelo ništa korisno. Dodano: svih 5 CDN
  `<script>` tagova sada ima `crossorigin="anonymous"` (cdnjs/jsdelivr su
  standardni javni CDN-ovi dizajnirani baš za ovo, isti obrazac kao SRI —
  siguran, dobro dokumentovan zahtjev, za razliku od institucionalnih API-ja
  poput FIRMS/GFW/EFFIS koji NISU pravljeni za proizvoljno cross-origin
  učitavanje) — sljedeći put će `window.onerror` dobiti STVARNU poruku/liniju.
  `window.onerror` handler uz to sad prepoznaje baš OVAJ obrazac
  (`m==='Script error.' && !l`) i dodaje kratko objašnjenje ("vjerovatno
  prekinuto učitavanje eksterne biblioteke... Osvježi stranicu") umjesto da
  ostavi korisnika sa neupotrebljivim sirovim tekstom — isti princip kao
  `_poziGreskaTxt` za mrežne greške u Požarima. Nije bilo moguće reproducirati
  iz sandboxa (ni CDN ni `appassets.androidplatform.net` nisu dostižni odavde,
  Playwright reprodukcija je pokazala SAMO artefakte sandbox mrežnog
  ograničenja, ne stvaran uzrok) — ako se ponovi, sljedeći baner će reći
  TAČNO koja biblioteka i koja linija.
- **Android WebView nema `window.Notification`** (v3.107.1): korisnik je na
  STVARNOM telefonu, pri uključivanju "Javi mi kad se pojavi nov požar", dobio
  "Ovaj uređaj ne podržava obavještenja". Uzrok: `'Notification' in window`
  je `false` na mnogim OEM WebView verzijama — JS Notifications API (`new
  Notification(...)`) tu jednostavno nije implementiran, ISTA zamka koja je
  već davno riješena za GPS snimanje (`GpsService` u Javi koristi
  `NotificationManager` direktno, ne ide kroz `window.Notification`). Rasterski
  reflex "znači notifikacije ne rade u WebView-u" bio bi pogrešan — Android
  sasvim normalno prikazuje prave notifikacije, samo ne kroz TAJ JS API.
  Rješenje je isti obrazac kao `AndroidGps`/`AndroidNet`: nova native klasa
  `MainActivity.AppNotifBridge` (`webView.addJavascriptInterface(...,
  "AndroidNotif")`) sa `NotificationManagerCompat` + vlastitim kanalom
  (`IMPORTANCE_HIGH`, za razliku od GPS-ovog `IMPORTANCE_LOW` — upozorenje na
  požar MORA upasti u oči, GPS snimanje je namjerno tiho). JS strana
  (`_poziNotifNativnoDostupan`/`_poziNotifToggle`/`_poziNotifProvjeri`) prvo
  proba `AndroidNotif.show(naslov, tijelo)`, i SAMO ako mosta nema (webapp na
  GitHub Pages) pada na stari `window.Notification` put. `POST_NOTIFICATIONS`
  dozvola se već traži pri prvom pokretanju app-a (`requestPermissions()`),
  pa native put ne mora ništa dodatno pitati. **Traži pun rebuild u Android
  Studiju** (mijenjan `.java`). Test: `tests/js/pozari.test.js` (mock
  `AndroidNotif`, provjera da web `Notification`/service worker put NIJE
  dotaknut kad je native dostupan — SW poziv namjerno baca u testu ako se
  ipak pozove).


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
