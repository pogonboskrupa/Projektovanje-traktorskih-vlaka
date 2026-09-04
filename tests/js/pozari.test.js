// =====================================================================
// Testovi za POŽARE — parsiranje FIRMS CSV-a, filter po udaljenosti,
// normalizacija pouzdanosti i poruke koje korisnik vidi.
// Pokretanje:  node tests/js/pozari.test.js
// ---------------------------------------------------------------------
// Zašto ovaj test postoji: prva verzija sloja požara (v3.103.0) bila je
// rasterski WMS i kod korisnika je ostala PRAZNA — a iz prazne karte se ne
// može zaključiti da li nema požara (najčešći i sasvim ispravan ishod!), da
// li je pao endpoint ili nema CORS-a. Zato se od v3.103.1 detekcije povlače
// kao PODACI i svaki ishod ima jasnu poruku. Ovi testovi čuvaju upravo to:
// da parsiranje radi na oba FIRMS formata (VIIRS i MODIS imaju RAZLIČIT
// raspored kolona), da filter po udaljenosti ne propušta tuđe požare, i da
// "nema požara" nikad ne izgleda kao greška.
//
// Testira se STVARNI izvorni kod — funkcije se izvlače direktno iz index.html.
// =====================================================================
'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');

function extractFn(name) {
  const re = new RegExp('function ' + name + '\\(');
  const start = HTML.search(re);
  assert.ok(start >= 0, 'nije nađena funkcija ' + name + ' u index.html');
  const fstart = HTML.indexOf('function', start);
  let i = HTML.indexOf('{', fstart), depth = 0;
  for (; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') { depth--; if (depth === 0) return HTML.slice(fstart, i + 1); }
  }
  throw new Error('nezatvorena funkcija ' + name);
}

// dst() je jednolinijska deklaracija u index.html — uzmi je doslovno
const SRC_DST = HTML.match(/function dst\(la1,lo1,la2,lo2\)\{[^\n]*\}/)[0];
const SRC = [
  SRC_DST,
  extractFn('_poziParseCsv'),
  extractFn('_poziPouzdanost'),
  extractFn('_poziFilterBlizu'),
  extractFn('_poziBrojRijec'),
  extractFn('_poziSatelit'),
  extractFn('_poziStarost'),
].join('\n');

const api = new Function('_POZ_RADIUS_KM',
  SRC + '\nreturn { _poziParseCsv, _poziPouzdanost, _poziFilterBlizu, _poziBrojRijec, _poziSatelit, _poziStarost };')(150);

let pass = 0, fail = 0;
// Sinhroni test. Ako fn vrati Promise, prebaci ga u red za asinhrone (inače bi
// odbijeno obećanje tiho "prošlo" — test bez zuba je gori od nikakvog testa).
const _async = [];
function t(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') { _async.push({ name, p: r }); return; }
    pass++; console.log('  ✔ ' + name);
  }
  catch (e) { fail++; console.log('  ✘ ' + name + '\n      ' + e.message); }
}

// ── v3.104.0: grupisanje u požare, MAP_KEY Area API, vjetar-prijeti-mi ──────
// Zašto ovo postoji: korisnik je sa STVARNOG telefona prijavio da su sva 4
// FIRMS arhivska CSV izvora "blokiran (CORS/mreža)" — fetch() iz browsera ne
// razlikuje CORS blok od mrtve mreže (isto baca generičku TypeError), pa se
// paralelno umjesto redom-dok-jedan-ne-uspije PROBAJU SVI (brže javlja grešku,
// spaja sve što UPSJE), dodaje se opcioni MAP_KEY (druga ruta servera), i
// višestruke detekcije ISTOG požara (različiti sateliti/preleti) se grupišu —
// inače "12 aktivnih detekcija" zvuči kao 12 požara umjesto 1 praćenog.
function extractConst(name) {
  const re = new RegExp('const ' + name + '\\s*=\\s*[\\s\\S]*?;'); // stani na PRVI ';' (ne na ';\n' — dosta linija ima komentar iza ';')
  const m = re.exec(HTML);
  assert.ok(m, 'nije nađena const ' + name + ' u index.html');
  return m[0];
}
const SRC2 = [
  SRC_DST,
  extractConst('_POZ_GRUPA_M'),
  extractConst('_POZ_BAZA'),
  extractConst('_POZ_IZVORI'),
  extractConst('_POZ_OKVIRI'),
  extractFn('_poziPouzdanost'),
  extractFn('_poziSatelit'),
  extractFn('_poziOkvir'),
  extractFn('_poziOkvirNaziv'),
  extractFn('_poziUrl'),
  extractFn('_poziGrupisi'),
  extractFn('_poziGrupeBlizu'),
  extractFn('_poziEvtKljuc'),
  extractFn('_poziOznaciNove'),
  extractFn('_poziApiUrl'),
  extractFn('_poziGfwUrl'),
  extractFn('_poziParseGfwJson'),
  extractFn('_poziBrojRijecPozar'),
  extractFn('_poziBrojRijecNovih'),
  extractFn('_poziBrojRijecIzvora'),
  extractFn('_poziVjetarPrijeti'),
  extractFn('_poziGreskaTxt'),
  extractFn('_nativeNetDostupan'),   // _poziSavjet pita je li APK ili browser
  extractFn('_poziSavjet'),
].join('\n');

function makeStore() {
  const m = {};
  return { getItem:k => (k in m ? m[k] : null), setItem:(k,v) => { m[k]=String(v); }, removeItem:k => { delete m[k]; } };
}
function makeApi2(store) {
  const keys = ['localStorage', '_POZ_SEEN_KEY', '_POZ_OKVIR_KEY', '_POZ_RADIUS_KM'];
  const vals = [store, 'seen', 'tvlake_pozari_okvir', 150];
  return new Function(...keys,
    SRC2 + '\nreturn { _poziOkvir, _poziOkvirNaziv, _poziUrl, _poziGrupisi, _poziGrupeBlizu, ' +
    '_poziEvtKljuc, _poziOznaciNove, _poziApiUrl, _poziGfwUrl, _poziParseGfwJson, _poziBrojRijecPozar, _poziBrojRijecNovih, _poziBrojRijecIzvora, ' +
    '_poziVjetarPrijeti, _poziGreskaTxt, _poziSavjet };'
  )(...vals);
}

console.log('\n_poziGrupisi — više detekcija ISTOG požara postaju JEDAN događaj:');

t('detekcije unutar _POZ_GRUPA_M se spajaju u jednu grupu', () => {
  const api2 = makeApi2(makeStore());
  const pts = [
    { la:44.910, lo:16.200, dt:'2026-09-03T11:22:00Z', sat:'N', conf:'h', frp:12.7 },
    { la:44.911, lo:16.201, dt:'2026-09-03T13:00:00Z', sat:'1', conf:'n', frp:8.0  }, // ~140m dalje, isti požar
  ];
  const g = api2._poziGrupisi(pts);
  assert.strictEqual(g.length, 1, 'dvije bliske detekcije = JEDAN požar');
  assert.strictEqual(g[0].broj, 2);
  assert.strictEqual(g[0].sateliti.length, 2, 'oba satelita zabilježena');
});

t('udaljene detekcije (>_POZ_GRUPA_M) ostaju ODVOJENI požari', () => {
  const api2 = makeApi2(makeStore());
  const pts = [
    { la:44.910, lo:16.200, dt:'2026-09-03T11:00:00Z', sat:'N', conf:'h', frp:5 },
    { la:45.300, lo:16.150, dt:'2026-09-03T11:00:00Z', sat:'N', conf:'h', frp:5 }, // ~43km dalje
  ];
  const g = api2._poziGrupisi(pts);
  assert.strictEqual(g.length, 2);
});

t('grupa pamti najpouzdaniju detekciju i maksimalni FRP', () => {
  const api2 = makeApi2(makeStore());
  const pts = [
    { la:44.910, lo:16.200, dt:'2026-09-03T11:00:00Z', sat:'N', conf:'l', frp:3.0 },
    { la:44.910, lo:16.200, dt:'2026-09-03T12:00:00Z', sat:'1', conf:'h', frp:22.5 },
  ];
  const g = api2._poziGrupisi(pts);
  assert.strictEqual(g[0].conf, 'h', 'zadržava najvišu pouzdanost, ne posljednju');
  assert.strictEqual(g[0].frpMax, 22.5);
});

t('span (raspon) grupe od jedne tačke je 0, od dvije > 0', () => {
  const api2 = makeApi2(makeStore());
  const jedna = api2._poziGrupisi([{ la:44.91, lo:16.20, dt:'2026-09-03T11:00:00Z', sat:'N', conf:'h', frp:5 }]);
  assert.strictEqual(jedna[0].spanM, 0);
  const dvije = api2._poziGrupisi([
    { la:44.910, lo:16.200, dt:'2026-09-03T11:00:00Z', sat:'N', conf:'h', frp:5 },
    { la:44.912, lo:16.202, dt:'2026-09-03T11:05:00Z', sat:'1', conf:'h', frp:5 }
  ]);
  assert.ok(dvije[0].spanM > 0);
});

console.log('_poziGrupeBlizu — udaljenost i sortiranje na grupama:');

t('sortira grupe po udaljenosti od reference', () => {
  const api2 = makeApi2(makeStore());
  const grupe = [{ la:45.30, lo:16.15, pts:[] }, { la:44.90, lo:16.15, pts:[] }];
  const r = api2._poziGrupeBlizu(grupe, { la:44.88, lo:16.15 });
  assert.ok(r[0].d < r[1].d);
});

console.log('_poziOznaciNove — "novo od zadnje provjere" preživljava dva učitavanja:');

t('prvi put SVE je novo, drugi put ISTI požar više nije nov', () => {
  const store = makeStore();
  const api2 = makeApi2(store);
  const g = [{ la:44.910, lo:16.200, pts:[] }];
  const prvi = api2._poziOznaciNove(g);
  assert.strictEqual(prvi[0].nov, true);
  const drugi = api2._poziOznaciNove(g);
  assert.strictEqual(drugi[0].nov, false, 'isti požar iz prošlog pregleda nije "nov"');
});

t('sasvim nov požar (druga lokacija) OSTAJE nov i kad stari nestane', () => {
  const store = makeStore();
  const api2 = makeApi2(store);
  api2._poziOznaciNove([{ la:44.910, lo:16.200, pts:[] }]);
  const drugi = api2._poziOznaciNove([{ la:45.500, lo:16.900, pts:[] }]);
  assert.strictEqual(drugi[0].nov, true);
});

console.log('Vremenski okvir (24h/48h/7d):');

t('_poziOkvir vraća 24h kad ništa nije sačuvano ili je sačuvana vrijednost neispravna', () => {
  const store = makeStore();
  const api2 = makeApi2(store);
  assert.strictEqual(api2._poziOkvir(), '24h');
  store.setItem('tvlake_pozari_okvir', 'nepostojeci');
  assert.strictEqual(api2._poziOkvir(), '24h');
});

t('_poziUrl mijenja SAMO sufiks vremenskog okvira, ne i izvor', () => {
  const api2 = makeApi2(makeStore());
  const izv = { pref:'suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Europe_' };
  assert.ok(api2._poziUrl(izv, '24h').endsWith('_Europe_24h.csv'));
  assert.ok(api2._poziUrl(izv, '7d').endsWith('_Europe_7d.csv'));
});

t('_poziOkvirNaziv daje čitljivo bosansko ime', () => {
  const api2 = makeApi2(makeStore());
  assert.strictEqual(api2._poziOkvirNaziv('48h'), '48 sati');
  assert.strictEqual(api2._poziOkvirNaziv('7d'), '7 dana');
});

console.log('_poziApiUrl — bbox oko referentne tačke, MAP_KEY u putanji:');

t('bbox okružuje referentnu tačku (zapad<istok, jug<sjever)', () => {
  const api2 = makeApi2(makeStore());
  const u = api2._poziApiUrl('MOJKLJUC', '24h', { la:44.88, lo:16.15 });
  assert.ok(u.includes('/MOJKLJUC/'), 'ključ mora biti u putanji: ' + u);
  const dijelovi = u.split('/');
  const dani = dijelovi.pop();
  const bboxStr = dijelovi.pop();
  const [w, s, e, n] = bboxStr.split(',').map(Number);
  assert.ok(w < e, 'zapad mora biti manji od istok');
  assert.ok(s < n, 'jug mora biti manji od sjever');
  assert.strictEqual(dani, '1', '24h okvir → 1 dan');
});

t('7d okvir traži 7 dana', () => {
  const api2 = makeApi2(makeStore());
  const u = api2._poziApiUrl('K', '7d', { la:44.88, lo:16.15 });
  assert.ok(u.endsWith('/7'));
});

console.log('Bosanska množina za GRUPISANE požare (muški rod, drugačija sklonidba od detekcija):');

t('1 aktivan požar / 2-4 aktivna požara / 5+ aktivnih požara', () => {
  const api2 = makeApi2(makeStore());
  assert.strictEqual(api2._poziBrojRijecPozar(1), '1 aktivan požar');
  assert.strictEqual(api2._poziBrojRijecPozar(2), '2 aktivna požara');
  assert.strictEqual(api2._poziBrojRijecPozar(5), '5 aktivnih požara');
  assert.strictEqual(api2._poziBrojRijecPozar(11), '11 aktivnih požara');
  assert.strictEqual(api2._poziBrojRijecPozar(21), '21 aktivan požar');
});

t('"N izvora" — 1 izvor, ne "1 izvora"', () => {
  const api2 = makeApi2(makeStore());
  assert.strictEqual(api2._poziBrojRijecIzvora(1), '1 izvor');
  assert.strictEqual(api2._poziBrojRijecIzvora(4), '4 izvora');
  assert.strictEqual(api2._poziBrojRijecIzvora(11), '11 izvora');
});

t('"N novih" — 1 novi, 2-4 nova, 5+ novih (bug: prije je pisalo "1 novih")', () => {
  const api2 = makeApi2(makeStore());
  assert.strictEqual(api2._poziBrojRijecNovih(1), '1 novi');
  assert.strictEqual(api2._poziBrojRijecNovih(2), '2 nova');
  assert.strictEqual(api2._poziBrojRijecNovih(5), '5 novih');
});

console.log('Global Forest Watch — drugi server za ISTE VIIRS detekcije:');

// Zašto GFW uopšte: detekcije su iste (GFW preuzima NASA VIIRS), ali server je
// tuđi i ima svoju CORS politiku — jedini razlog dodavanja je DRUGI PUT do
// istih podataka. NAMJERNO nisu dodati GLAD/RADD alarmi za sječu: GLAD-L radi
// samo 30°N-30°S, RADD samo u vlažnim tropima, a Bosna je na ~44.9°N.
t('_poziGfwUrl: bbox oko korisnika i datum od kojeg se traži su u SQL-u', () => {
  const api2 = makeApi2(makeStore());
  const u = api2._poziGfwUrl('24h', { la:44.88, lo:16.15 });
  assert.ok(u.startsWith('https://data-api.globalforestwatch.org/dataset/nasa_viirs_fire_alerts/latest/query/json?sql='), u.slice(0,90));
  const sql = decodeURIComponent(u.split('sql=')[1]);
  assert.match(sql, /FROM results/);
  assert.match(sql, /alert__date >= '\d{4}-\d{2}-\d{2}'/);
  assert.match(sql, /latitude >= 43\./,  'južna granica oko 44.88 - 1.35°');
  assert.match(sql, /latitude <= 46\./,  'sjeverna granica');
  assert.match(sql, /LIMIT/);
});

t('_poziGfwUrl: 7d traži stariji datum nego 24h', () => {
  const api2 = makeApi2(makeStore());
  const d = u => decodeURIComponent(u.split('sql=')[1]).match(/alert__date >= '([\d-]+)'/)[1];
  const a = d(api2._poziGfwUrl('24h', { la:44.88, lo:16.15 }));
  const b = d(api2._poziGfwUrl('7d',  { la:44.88, lo:16.15 }));
  assert.ok(b < a, '7d mora ići dalje u prošlost: ' + b + ' vs ' + a);
});

t('_poziParseGfwJson: GFW JSON se svede na ISTI oblik tačke kao FIRMS CSV', () => {
  const api2 = makeApi2(makeStore());
  const p = api2._poziParseGfwJson(JSON.stringify({ data: [
    { longitude:16.20, latitude:44.91, alert__date:'2026-09-03', alert__time_utc:'11:22:00', confidence__cat:'h' },
    { longitude:16.05, latitude:44.80, alert__date:'2026-09-03', alert__time_utc:'0234',     confidence__cat:'n' }
  ]}));
  assert.strictEqual(p.length, 2);
  assert.strictEqual(p[0].la, 44.91);
  assert.strictEqual(p[0].conf, 'h');
  assert.ok(p[0].dt.endsWith('T11:22:00Z'), 'dobiveno: ' + p[0].dt);
  assert.ok(p[1].dt.endsWith('T02:34:00Z'), '"0234" bez dvotačke mora dati 02:34, dobiveno: ' + p[1].dt);
  assert.strictEqual(p[0].rez, 375, 'VIIRS rezolucija za grupisanje');
});

t('_poziParseGfwJson: FRP je NaN (GFW ga ne vraća), ne 0 — 0 bi značilo "nema snage"', () => {
  const api2 = makeApi2(makeStore());
  const p = api2._poziParseGfwJson('{"data":[{"longitude":16.2,"latitude":44.9,"alert__date":"2026-09-03","confidence__cat":"h"}]}');
  assert.ok(Number.isNaN(p[0].frp));
});

t('_poziParseGfwJson: smeće/HTML/prazno ne ruši parser', () => {
  const api2 = makeApi2(makeStore());
  assert.deepStrictEqual(api2._poziParseGfwJson(''), []);
  assert.deepStrictEqual(api2._poziParseGfwJson('<html>403</html>'), []);
  assert.deepStrictEqual(api2._poziParseGfwJson('{"greska":"nema kljuca"}'), []);
});

console.log('Native most (APK) — jedini put oko CORS-a:');

// Terenski dokaz: dobra veza (215 KB/s), okvir 24h, unesen MAP_KEY → svih pet
// izvora "odbijeno odmah". CORS je pravilo browsera; u APK-u zahtjev ide kroz
// Java sloj koji ga nema. Ovdje se testira JS polovina tog mosta.
const SRC3 = [
  extractFn('_nativeNetDostupan'),
  extractFn('_nativeNetOdgovor'),
  extractFn('_nativeNetFetch'),
].join('\n');

function makeNet(androidNet) {
  const sandbox = {
    AndroidNet: androidNet,
    atob: (b64) => Buffer.from(b64, 'base64').toString('binary'),
    TextDecoder,
    setTimeout, clearTimeout,
    _NET_ceka: {}, _netSeq: 0,
  };
  const keys = Object.keys(sandbox);
  return new Function(...keys,
    'let _netSeq2=0;' + SRC3 + '\nreturn { _nativeNetDostupan, _nativeNetOdgovor, _nativeNetFetch, _NET_ceka };'
  )(...keys.map(k => sandbox[k]));
}

t('bez AndroidNet objekta most se ne koristi (webapp put ostaje netaknut)', () => {
  assert.strictEqual(makeNet(undefined)._nativeNetDostupan(), false);
  assert.strictEqual(makeNet({})._nativeNetDostupan(), false, 'objekat bez fetchText ne valja');
  assert.strictEqual(makeNet({ fetchText(){} })._nativeNetDostupan(), true);
});

t('Base64 tijelo se dekodira u ISPRAVAN UTF-8 (dijakritika u CSV-u)', async () => {
  let zadnji = null;
  const api3 = makeNet({ fetchText(id) { zadnji = id; } });
  const p = api3._nativeNetFetch('https://firms.modaps.eosdis.nasa.gov/x', 1000);
  const csv = 'latitude,longitude,naziv\n44.9,16.2,Bosanska Krupa — šuma';
  api3._nativeNetOdgovor(zadnji, 200, Buffer.from(csv, 'utf8').toString('base64'), null);
  const r = await p;
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.text, csv, 'dijakritika mora preživjeti prenos');
});

t('greška sa native strane odbija obećanje, ne visi', async () => {
  let zadnji = null;
  const api3 = makeNet({ fetchText(id) { zadnji = id; } });
  const p = api3._nativeNetFetch('https://firms.modaps.eosdis.nasa.gov/x', 1000);
  api3._nativeNetOdgovor(zadnji, 0, '', 'UnknownHostException: nema DNS-a');
  await assert.rejects(p, /UnknownHostException/);
});

t('ako native strana NIKAD ne odgovori, obećanje ipak istekne (ne visi zauvijek)', async () => {
  const api3 = makeNet({ fetchText() { /* namjerno tišina */ } });
  const p = api3._nativeNetFetch('https://firms.modaps.eosdis.nasa.gov/x', 20);
  await assert.rejects(p, e => e.name === 'TimeoutError');
});

t('odgovor za nepoznat/već obrađen id se ignoriše (nema duplog resolve-a)', () => {
  const api3 = makeNet({ fetchText() {} });
  api3._nativeNetOdgovor('nepostojeci', 200, '', null);   // ne smije baciti
});

console.log('Razlikovanje kvarova (sa terena: 1× "odbijeno odmah" + 4× "veza visi"):');

t('TypeError = odbijeno odmah, TimeoutError = veza visi — NE ista poruka', () => {
  const api2 = makeApi2(makeStore());
  const a = api2._poziGreskaTxt({ name: 'TypeError', message: 'Failed to fetch' });
  const b = api2._poziGreskaTxt({ name: 'TimeoutError', message: 'signal timed out' });
  assert.match(a, /odbijeno odmah/);
  assert.match(b, /veza visi/);
  assert.notStrictEqual(a, b, 'dva različita kvara ne smiju davati istu poruku');
});

t('sirova engleska poruka iz browsera ("signal timed out") se NE prikazuje korisniku', () => {
  const api2 = makeApi2(makeStore());
  const txt = api2._poziGreskaTxt({ name: 'TimeoutError', message: 'signal timed out' });
  assert.ok(!/signal timed out/.test(txt), 'dobiveno: ' + txt);
});

t('AbortError se tretira kao istek, ne kao nepoznata greška', () => {
  const api2 = makeApi2(makeStore());
  assert.match(api2._poziGreskaTxt({ name: 'AbortError' }), /veza visi/);
});

console.log('_poziSavjet — savjet prati TIP kvara, ne samo činjenicu da ga ima:');

t('sve isteklo → savjetuje 24h okvir, VPN i MAP_KEY (ne tvrdi da je CORS)', () => {
  const api2 = makeApi2(makeStore());
  const s = api2._poziSavjet('VIIRS: nema odgovora na vrijeme (veza visi) · MODIS: nema odgovora na vrijeme (veza visi)');
  assert.match(s, /24 sata/);
  assert.match(s, /VPN/);
  assert.ok(!/CORS blokada nego/.test(s) || /nije CORS/.test(s), 'ne smije tvrditi da je CORS');
});

t('sve odbijeno odmah u BROWSERU → kaže da je CORS i da APK radi, i NE obećava MAP_KEY', () => {
  const api2 = makeApi2(makeStore());   // bez AndroidNet → web verzija
  const s = api2._poziSavjet('VIIRS: odbijeno odmah (CORS ili nema mreže)');
  assert.match(s, /CORS/);
  assert.match(s, /APK/);
  // Terenski dokaz: sa unesenim MAP_KEY-em API ruta je odbijena JEDNAKO kao
  // arhiva, pa savjet "unesi ključ" ovdje ne smije stajati — bio bi laž.
  assert.ok(!/MAP_KEY/.test(s), 'ne smije nuditi ključ kao rješenje CORS-a u browseru');
});

t('miješano → savjet pokriva oboje', () => {
  const api2 = makeApi2(makeStore());
  const s = api2._poziSavjet('A: odbijeno odmah (CORS ili nema mreže) · B: nema odgovora na vrijeme (veza visi)');
  assert.match(s, /dio/i);
});

console.log('_poziVjetarPrijeti — meteorološka konvencija (smjer ODAKLE vjetar duva):');

t('vjetar iz smjera požara (u odnosu na mene) → prijeti', () => {
  const api2 = makeApi2(makeStore());
  // Požar je SJEVERNO od mene (azimut od požara ka meni = jug = 180°).
  // Vjetar duva IZ smjera sjevera (0°) → nosi vatru ka jugu (180°) → ka meni.
  assert.strictEqual(api2._poziVjetarPrijeti(180, 0), true);
});

t('vjetar duva u SUPROTNOM smjeru → ne prijeti', () => {
  const api2 = makeApi2(makeStore());
  // Isti geometrijski slučaj, ali vjetar duva IZ juga (180°) → nosi ka sjeveru,
  // dakle OD mene, nazad ka požaru.
  assert.strictEqual(api2._poziVjetarPrijeti(180, 180), false);
});

t('granica ±45° se poštuje', () => {
  const api2 = makeApi2(makeStore());
  assert.strictEqual(api2._poziVjetarPrijeti(180, 44), true);   // 180-(44+180)=44° unutra
  assert.strictEqual(api2._poziVjetarPrijeti(180, 46), false);  // 46° van granice
});


// Pravi FIRMS formati — VIIRS i MODIS NEMAJU isti raspored kolona
const CSV_VIIRS = `country_id,latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight
BIH,44.9100,16.2000,331.5,0.45,0.42,2026-09-03,1122,N,VIIRS,h,2.0NRT,289.1,12.7,D
BIH,44.8000,16.0500,305.2,0.51,0.48,2026-09-03,234,N,VIIRS,n,2.0NRT,280.4,3.4,N`;

const CSV_MODIS = `latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight
44.9500,16.1000,330.1,1.1,1.0,2026-09-03,1015,Terra,MODIS,78,6.1NRT,291.0,21.5,D`;

console.log('_poziParseCsv — oba FIRMS formata:');

t('VIIRS: parsira sve redove sa koordinatama', () => {
  const p = api._poziParseCsv(CSV_VIIRS);
  assert.strictEqual(p.length, 2);
  assert.strictEqual(p[0].la, 44.91);
  assert.strictEqual(p[0].lo, 16.20);
  assert.strictEqual(p[0].conf, 'h');
  assert.strictEqual(p[0].frp, 12.7);
});

t('MODIS: kolone su na DRUGIM pozicijama, i dalje se čitaju ispravno', () => {
  const p = api._poziParseCsv(CSV_MODIS);
  assert.strictEqual(p.length, 1);
  assert.strictEqual(p[0].la, 44.95);
  assert.strictEqual(p[0].conf, '78');       // MODIS daje broj, ne slovo
  assert.strictEqual(p[0].frp, 21.5);
});

t('acq_time "234" (bez vodeće nule) → 02:34 UTC, ne 23:40', () => {
  const p = api._poziParseCsv(CSV_VIIRS);
  assert.ok(p[1].dt.endsWith('T02:34:00Z'), 'dobiveno: ' + p[1].dt);
});

t('dan/noć zastavica', () => {
  const p = api._poziParseCsv(CSV_VIIRS);
  assert.strictEqual(p[0].noc, false);   // D
  assert.strictEqual(p[1].noc, true);    // N
});

t('prazan ulaz / smeće ne ruši parser', () => {
  assert.deepStrictEqual(api._poziParseCsv(''), []);
  assert.deepStrictEqual(api._poziParseCsv(null), []);
  assert.deepStrictEqual(api._poziParseCsv('<html>404</html>'), []);
});

t('CSV bez latitude kolone se odbija (nije FIRMS)', () => {
  assert.deepStrictEqual(api._poziParseCsv('a,b,c\n1,2,3'), []);
});

console.log('_poziFilterBlizu — samo ono što je stvarno blizu:');

t('udaljeni požar (Grčka) se odbacuje, blizak zadržava', () => {
  const pts = [
    { la: 44.91, lo: 16.20 },   // ~5 km od Bos. Krupe
    { la: 38.10, lo: 23.70 }    // Grčka, ~900 km
  ];
  const r = api._poziFilterBlizu(pts, { la: 44.88, lo: 16.15 });
  assert.strictEqual(r.length, 1);
  assert.ok(r[0].d < 10000, 'zadržan mora biti onaj blizu, d=' + r[0].d);
});

t('sortirano po udaljenosti — najbliži prvi', () => {
  const pts = [{ la: 45.30, lo: 16.15 }, { la: 44.90, lo: 16.15 }, { la: 45.10, lo: 16.15 }];
  const r = api._poziFilterBlizu(pts, { la: 44.88, lo: 16.15 });
  assert.deepStrictEqual(r.map(x => Math.round(x.d / 1000)), [2, 24, 47]);
});

t('nema detekcija u okolini → prazan niz (ne greška)', () => {
  const r = api._poziFilterBlizu([{ la: 38.1, lo: 23.7 }], { la: 44.88, lo: 16.15 });
  assert.deepStrictEqual(r, []);
});

console.log('_poziPouzdanost — VIIRS slova i MODIS brojevi na isto:');

t('VIIRS l/n/h', () => {
  assert.strictEqual(api._poziPouzdanost('h').rang, 3);
  assert.strictEqual(api._poziPouzdanost('n').rang, 2);
  assert.strictEqual(api._poziPouzdanost('l').rang, 1);
});

t('MODIS 0-100 → isti rangovi', () => {
  assert.strictEqual(api._poziPouzdanost('85').rang, 3);
  assert.strictEqual(api._poziPouzdanost('60').rang, 2);
  assert.strictEqual(api._poziPouzdanost('20').rang, 1);
});

t('svaka pouzdanost ima boju u hex formatu', () => {
  ['h','n','l','85','20','', 'xyz'].forEach(c =>
    assert.match(api._poziPouzdanost(c).boja, /^#[0-9a-f]{6}$/i, 'za "' + c + '"'));
});

console.log('Poruke koje korisnik vidi:');

t('bosanska množina: 1 / 2-4 / 5+', () => {
  assert.strictEqual(api._poziBrojRijec(1),  '1 aktivna detekcija');
  assert.strictEqual(api._poziBrojRijec(2),  '2 aktivne detekcije');
  assert.strictEqual(api._poziBrojRijec(4),  '4 aktivne detekcije');
  assert.strictEqual(api._poziBrojRijec(5),  '5 aktivnih detekcija');
  assert.strictEqual(api._poziBrojRijec(11), '11 aktivnih detekcija');  // ne "11 aktivna"
  assert.strictEqual(api._poziBrojRijec(21), '21 aktivna detekcija');
  assert.strictEqual(api._poziBrojRijec(22), '22 aktivne detekcije');
});

t('kodovi satelita se razvijaju u imena', () => {
  assert.strictEqual(api._poziSatelit('N'), 'Suomi-NPP');
  assert.strictEqual(api._poziSatelit('1'), 'NOAA-20');
  assert.strictEqual(api._poziSatelit('Terra'), 'Terra');
  assert.strictEqual(api._poziSatelit(''), '—');
});

t('starost podatka: "upravo" za svjež, sati/dani za stariji', () => {
  const now = Date.now();
  assert.strictEqual(api._poziStarost(now), 'upravo');
  assert.strictEqual(api._poziStarost(now - 30 * 60000), 'prije 30 min');
  assert.strictEqual(api._poziStarost(now - 5 * 3600000), 'prije 5 h');
  assert.ok(/dana$/.test(api._poziStarost(now - 4 * 86400000)));
});

console.log('_poziSazetak — upozorenje kad udaljenost NIJE od stvarne GPS pozicije:');

// Zašto ovo postoji: prije ove izmjene je udaljenost do požara tiho padala na
// centar karte kad GPS nema fix — za alat o bezbjednosti to je aktivno
// pogrešno (korisnik je mogao ranije pomjeriti kartu bilo gdje), ne samo manje
// precizno. _poziToggle sad pokreće GPS i _poziMeta pamti refGps; _poziSazetak
// mora to napadno pokazati dok se ne popravi.
const SRC4 = [
  SRC_DST,
  extractFn('_bearing'),
  extractFn('_azimutSmjer'),
  extractFn('fmtL'),
  extractFn('_poziStarost'),
  extractFn('_poziBrojRijecPozar'),
  extractFn('_poziBrojRijecNovih'),
  extractFn('_poziBrojRijecIzvora'),
  extractConst('_POZ_OKVIRI'),
  extractFn('_poziOkvirNaziv'),
  extractFn('_poziSazetak'),
].join('\n');

function makeSazetak({ meta, evts, ref }) {
  const sandbox = {
    _POZ_RADIUS_KM: 150,
    _poziMeta: meta,
    _poziEvts: evts,
    _poziRefTacka: () => ref,
  };
  const keys = Object.keys(sandbox);
  return new Function(...keys, SRC4 + '\nreturn _poziSazetak();')(...keys.map(k => sandbox[k]));
}

t('BEZ GPS fixa (refGps:false) — kratko I toast nose upozorenje, čak i kad nema požara', () => {
  const s = makeSazetak({
    meta: { izvori:['VIIRS S-NPP'], dohvacenoMs:Date.now(), okvir:'24h', refGps:false },
    evts: [], ref: { la:44.88, lo:16.15, gps:false }
  });
  assert.match(s.kratko, /centra karte/, 'kratko: ' + s.kratko);
  assert.match(s.toast, /centra karte/, 'toast: ' + s.toast);
});

t('SA GPS fixom (refGps:true) — upozorenja NEMA', () => {
  const s = makeSazetak({
    meta: { izvori:['VIIRS S-NPP'], dohvacenoMs:Date.now(), okvir:'24h', refGps:true },
    evts: [], ref: { la:44.88, lo:16.15, gps:true }
  });
  assert.ok(!/centra karte/.test(s.kratko), 'kratko: ' + s.kratko);
  assert.ok(!/centra karte/.test(s.toast), 'toast: ' + s.toast);
});

t('upozorenje se pojavljuje i kad IMA požara, ne samo u praznom slučaju', () => {
  const s = makeSazetak({
    meta: { izvori:['VIIRS S-NPP'], dohvacenoMs:Date.now(), okvir:'24h', refGps:false },
    evts: [{ la:44.91, lo:16.20, d:5000, broj:1, sateliti:['Suomi-NPP'], zadnji:Date.now(), nov:true }],
    ref: { la:44.88, lo:16.15, gps:false }
  });
  assert.match(s.kratko, /centra karte/, 'kratko: ' + s.kratko);
});

(async () => {
  for (const a of _async) {
    try { await a.p; pass++; console.log('  ✔ ' + a.name); }
    catch (e) { fail++; console.log('  ✘ ' + a.name + '\n      ' + e.message); }
  }
  console.log('\n' + pass + ' prošlo, ' + fail + ' palo');
  process.exit(fail ? 1 : 0);
})();
