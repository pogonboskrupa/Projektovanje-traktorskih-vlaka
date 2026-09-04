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

console.log('Sječa/vjetroizvale (GFW integrisani alarmi) i grupisanje po pragu:');

// GLAD/RADD ne pokrivaju Bosnu (tropi), pa se koristi integrisani sloj koji
// uključuje DIST-ALERT — jedini sa globalnom pokrivenošću. Piksel je 30 m
// (ne 375 m kao VIIRS), pa i prag grupisanja i ključ "viđenog" moraju biti finiji.
const SRC5 = [
  SRC_DST,
  extractConst('_POZ_GRUPA_M'),
  extractConst('_SJE_RADIUS_KM'),
  extractConst('_SJE_OKVIRI'),
  extractFn('_poziPouzdanost'),
  extractFn('_poziSatelit'),
  extractFn('_poziGrupisi'),
  extractFn('_poziEvtKljuc'),
  extractFn('_sjeUrl'),
  extractFn('_sjeParse'),
  extractFn('_sjePouzdanost'),
  extractFn('_sjeFilterBlizu'),
  extractFn('_sjeBrojRijec'),
].join('\n');
const api5 = new Function('localStorage', '_SJE_OKVIR_KEY',
  SRC5 + '\nreturn { _sjeUrl, _sjeParse, _sjePouzdanost, _sjeFilterBlizu, _sjeBrojRijec, _poziGrupisi, _poziEvtKljuc };'
)(makeStore(), 'tvlake_sjeca_okvir');

t('_sjeUrl gađa gfw_integrated_alerts (ne GLAD/RADD — oni ne pokrivaju BiH)', () => {
  const u = api5._sjeUrl('30d', { la:44.88, lo:16.15 });
  assert.match(u, /dataset\/gfw_integrated_alerts\/latest\/query\/json/);
  const sql = decodeURIComponent(u.split('sql=')[1]);
  assert.match(sql, /gfw_integrated_alerts__date >= '\d{4}-\d{2}-\d{2}'/);
  assert.match(sql, /latitude >= 44\./);
  assert.match(sql, /LIMIT/);
});

t('_sjeUrl: 90d ide dalje u prošlost nego 7d', () => {
  const d = u => decodeURIComponent(u.split('sql=')[1]).match(/date >= '([\d-]+)'/)[1];
  assert.ok(d(api5._sjeUrl('90d', { la:44.88, lo:16.15 })) < d(api5._sjeUrl('7d', { la:44.88, lo:16.15 })));
});

t('_sjeParse: GFW JSON → ista struktura tačke kao požari, rezolucija 30 m', () => {
  const p = api5._sjeParse(JSON.stringify({ data: [
    { longitude:16.20, latitude:44.91, gfw_integrated_alerts__date:'2026-08-20', gfw_integrated_alerts__confidence:'highest' }
  ]}));
  assert.strictEqual(p.length, 1);
  assert.strictEqual(p[0].la, 44.91);
  assert.strictEqual(p[0].rez, 30, 'DIST-ALERT je 30 m, ne 375 m kao VIIRS');
  assert.ok(p[0].dt.startsWith('2026-08-20'));
});

t('_sjeParse: smeće ne ruši parser', () => {
  assert.deepStrictEqual(api5._sjeParse(''), []);
  assert.deepStrictEqual(api5._sjeParse('<html>403</html>'), []);
  assert.deepStrictEqual(api5._sjeParse('{"greska":"nema kljuca"}'), []);
});

t('_sjePouzdanost: GFW "highest"/"nominal" → ista skala kao požari', () => {
  assert.strictEqual(api5._sjePouzdanost('highest').rang, 3);
  assert.strictEqual(api5._sjePouzdanost('nominal').rang, 2);
  assert.strictEqual(api5._sjePouzdanost('low').rang, 1);
  assert.match(api5._sjePouzdanost('nesto').boja, /^#[0-9a-f]{6}$/i);
});

t('_sjeFilterBlizu koristi UŽI radijus od požara (50 km, ne 150)', () => {
  const pts = [{ la:45.40, lo:16.15 }];   // ~58 km sjeverno
  assert.strictEqual(api5._sjeFilterBlizu(pts, { la:44.88, lo:16.15 }).length, 0);
  assert.strictEqual(api5._sjeFilterBlizu([{ la:45.10, lo:16.15 }], { la:44.88, lo:16.15 }).length, 1);
});

t('_poziGrupisi sa UŽIM pragom razdvaja ono što bi na 1500 m bilo spojeno', () => {
  const pts = [
    { la:44.9100, lo:16.2000, dt:'2026-08-20T00:00:00Z', conf:'highest', sat:'x', frp:NaN },
    { la:44.9150, lo:16.2000, dt:'2026-08-20T00:00:00Z', conf:'highest', sat:'x', frp:NaN }   // ~555 m
  ];
  assert.strictEqual(api5._poziGrupisi(pts).length, 1, 'na 1500 m (požari) je to jedan');
  assert.strictEqual(api5._poziGrupisi(pts, 300).length, 2, 'na 300 m (sječa) su dvije zasebne');
});

t('_poziEvtKljuc: finija preciznost razlikuje ono što gruba spaja', () => {
  // ~333 m razmaka: dvije ZASEBNE sječine. Na grubom ključu (~1 km) dijele
  // isti ključ pa bi druga bila propuštena kao "već viđena"; na finom ne.
  const a = { la:44.9100, lo:16.2000 }, b = { la:44.9130, lo:16.2000 };
  assert.strictEqual(api5._poziEvtKljuc(a), api5._poziEvtKljuc(b), 'na ~1 km isti ključ');
  assert.notStrictEqual(api5._poziEvtKljuc(a, 1000), api5._poziEvtKljuc(b, 1000), 'na ~110 m različit');
});

t('_sjeBrojRijec: 1 alarm / 2+ alarma', () => {
  assert.strictEqual(api5._sjeBrojRijec(1), '1 alarm');
  assert.strictEqual(api5._sjeBrojRijec(3), '3 alarma');
  assert.strictEqual(api5._sjeBrojRijec(7), '7 alarma');
});

console.log('Prekidač sječe je UVIJEK vidljiv (bez ključa ne smije biti blokiran, samo greška):');

// Zašto ovo postoji: korisnik je prijavio da blokirajuća poruka "treba GFW
// ključ" stoji PRIJE nego korisnik i pokuša, sakrivajući prekidač potpuno.
// _sjeLoad već vraća čitljivu grešku (_sjeMeta.greska='nema-kljuca') kad se
// prekidač uključi bez ključa — dupli, blokirajući gate iznad njega je bio
// suvišan i frustrirajući. Ovaj test čuva da se to ne vrati.
const SRC10 = [
  extractConst('_SJE_OKVIRI'),
  extractFn('_sjeOkvir'),
  extractFn('_sjeOkvirNaziv'),
  extractFn('_sjePouzdanost'),
  extractFn('_bearing'),
  extractFn('_azimutSmjer'),
  extractFn('fmtL'),
  extractConst('_SJE_RADIUS_KM'),
  extractFn('_sjeBrojRijec'),
  extractFn('_sjeSazetak'),
  extractFn('_poziStarost'),
  extractFn('_sjeSadrzajHtml'),
].join('\n');

function makeSjeHtml({ on, meta, evts, store }) {
  const sandbox = {
    localStorage: store || { getItem:()=>null, setItem(){}, removeItem(){} },
    _SJE_ON_KEY:'on', _SJE_OKVIR_KEY:'okvir',
    _sjeOn: !!on, _sjeMeta: meta || null, _sjeEvts: evts || [],
    _poziRefTacka: () => ({ la:44.88, lo:16.15, gps:true }),
    _escHtml: (s) => s,
  };
  const keys = Object.keys(sandbox);
  return new Function(...keys, SRC10 + '\nreturn _sjeSadrzajHtml();')(...keys.map(k => sandbox[k]));
}

t('prekidač je vidljiv i BEZ ključa (nema blokirajuće poruke prije uključivanja)', () => {
  const html = makeSjeHtml({ on:false, meta:null, evts:[] });
  assert.match(html, /onchange="_sjeToggle/, 'checkbox mora postojati');
  assert.ok(!/Za ovaj sloj treba/.test(html), 'stara blokirajuća poruka ne smije se vratiti');
});

t('uključen prekidač BEZ ključa → čitljiva poruka sa akcijom, ne sirov "nema-kljuca"', () => {
  const html = makeSjeHtml({ on:true, meta:{ greska:'nema-kljuca' }, evts:[] });
  assert.match(html, /onchange="_sjeToggle/, 'checkbox i dalje vidljiv');
  assert.match(html, /Global Forest Watch ključ/);
  assert.ok(!/>nema-kljuca</.test(html), 'sirovi interni kod greške ne smije procuriti u UI');
});

t('uključen prekidač SA ključem i podacima → normalna lista, ne poruka o ključu', () => {
  const html = makeSjeHtml({ on:true, meta:{ okvir:'30d' }, evts:[
    { la:44.91, lo:16.20, d:5000, conf:'highest', broj:1, zadnji:Date.now(), nov:false }
  ]});
  assert.ok(!/Global Forest Watch ključ/.test(html));
  assert.match(html, /5\.00 km|5 km/);
});

console.log('Upozorenje na nov požar — native most oko WebView Notification zamke:');

// Zašto ovo postoji: korisnik je na STVARNOM telefonu dobio "Ovaj uređaj ne
// podržava obavještenja" pri uključivanju prekidača. Uzrok: Android WebView na
// mnogim OEM verzijama uopšte nema window.Notification ('Notification' in
// window je false), iako sistem sasvim normalno prikazuje prave Android
// notifikacije (dokazano kod GPS snimanja — vidi GpsService, koji ide preko
// native NotificationManager-a). AndroidNotif most (MainActivity.AppNotifBridge)
// zaobilazi to potpuno, isto kao AndroidNet zaobilazi CORS.
const SRC6 = [
  extractFn('_poziNotifNativnoDostupan'),
  extractFn('_poziEvtKljuc'),
].join('\n');

function makeNotifDetekcija(androidNotif) {
  const sandbox = { AndroidNotif: androidNotif };
  const keys = Object.keys(sandbox);
  return new Function(...keys, SRC6 + '\nreturn { _poziNotifNativnoDostupan };')(...keys.map(k => sandbox[k]));
}

t('_poziNotifNativnoDostupan: false bez AndroidNet-olikog objekta (web/browser)', () => {
  assert.strictEqual(makeNotifDetekcija(undefined)._poziNotifNativnoDostupan(), false);
  assert.strictEqual(makeNotifDetekcija({})._poziNotifNativnoDostupan(), false, 'objekat bez show() ne valja');
});

t('_poziNotifNativnoDostupan: true kad AndroidNotif.show postoji (APK)', () => {
  assert.strictEqual(makeNotifDetekcija({ show(){} })._poziNotifNativnoDostupan(), true);
});

// Puna provjera _poziNotifProvjeri: u APK-u MORA zvati AndroidNotif.show, NE
// smije ni pipnuti window.Notification/service worker (koji su tamo ionako
// slomljeni po nalazu s terena).
const SRC7 = [
  SRC_DST,
  extractFn('_bearing'),
  extractFn('_azimutSmjer'),
  extractFn('fmtL'),
  extractFn('_poziPouzdanost'),
  extractFn('_poziBrojRijecPozar'),
  extractFn('_poziEvtKljuc'),
  extractFn('_poziNotifNativnoDostupan'),
  extractFn('_poziNotifOn'),
  extractFn('_poziNotifKm'),
  extractFn('_poziNotifProvjeri'),
].join('\n');

function makeNotifProvjeri({ androidNotif, notifOn, km, evts, ref, store }) {
  let posljednji = null;
  const swPostMessage = () => { throw new Error('SW put NE SMIJE se zvati kad je native dostupan'); };
  const sandbox = {
    localStorage: store || { getItem:()=>null, setItem(){}, removeItem(){} },
    _POZ_NOTIF_KEY: 'on', _POZ_NOTIF_KM: 'km', _POZ_NOTIF_SEEN: 'seen',
    AndroidNotif: androidNotif ? { show: (naslov, tijelo) => { posljednji = { naslov, tijelo }; } } : undefined,
    Notification: { permission: 'granted' },   // namjerno "ispravan" web fallback — native ipak mora pobijediti
    navigator: { serviceWorker: { controller: { postMessage: swPostMessage } } },
    _poziEvts: evts, _poziRefTacka: () => ref,
  };
  sandbox.localStorage.getItem = (k) => k === 'on' ? (notifOn ? '1' : '0') : (k === 'km' ? String(km||25) : null);
  const keys = Object.keys(sandbox);
  const api = new Function(...keys, SRC7 + '\nreturn { _poziNotifProvjeri };')(...keys.map(k => sandbox[k]));
  api._poziNotifProvjeri();
  return posljednji;
}

t('u APK-u (AndroidNotif prisutan) upozorenje ide preko native mosta, ne preko SW-a', () => {
  const evts = [{ la:44.91, lo:16.20, d:5000, conf:'h', zadnji:Date.now() }];
  const r = makeNotifProvjeri({ androidNotif:true, notifOn:true, km:50, evts, ref:{ la:44.88, lo:16.15, gps:true } });
  assert.ok(r, 'AndroidNotif.show mora biti pozvan');
  assert.match(r.naslov, /Nov požar/);
  assert.match(r.tijelo, /5\.00 km|5 km/);
});

t('požar dalji od praga ne javlja ništa', () => {
  const evts = [{ la:45.50, lo:16.90, d:90000, conf:'h', zadnji:Date.now() }]; // 90 km > prag 50 km
  const r = makeNotifProvjeri({ androidNotif:true, notifOn:true, km:50, evts, ref:{ la:44.88, lo:16.15, gps:true } });
  assert.strictEqual(r, null);
});

t('isključen prekidač → ništa se ne javlja čak i kad ima blizak požar', () => {
  const evts = [{ la:44.91, lo:16.20, d:5000, conf:'h', zadnji:Date.now() }];
  const r = makeNotifProvjeri({ androidNotif:true, notifOn:false, km:50, evts, ref:{ la:44.88, lo:16.15, gps:true } });
  assert.strictEqual(r, null);
});

console.log('Trake udaljenosti (do 20 km / 20-40 km / preko 40 km) — RAŠČLANI, ne filtriraj:');

const SRC8 = [
  extractConst('_POZ_TRAKE'),
  extractFn('_poziTraka'),
].join('\n');
const api8 = new Function(SRC8 + '\nreturn { _poziTraka, _POZ_TRAKE };')();

t('granice traka: 19999m blizu, tačno 20000m srednje, tačno 40000m dalje', () => {
  assert.strictEqual(api8._poziTraka(19999).id, 'blizu');
  assert.strictEqual(api8._poziTraka(20000).id, 'sred');
  assert.strictEqual(api8._poziTraka(39999).id, 'sred');
  assert.strictEqual(api8._poziTraka(40000).id, 'dalje');
  assert.strictEqual(api8._poziTraka(149000).id, 'dalje', 'i požar na rubu 150 km kruga mora pasti u neku traku');
});

t('0 m (požar tačno na tvojoj poziciji) je "blizu"', () => {
  assert.strictEqual(api8._poziTraka(0).id, 'blizu');
});

// _poziListaHtml grupiše _poziEvts u tri trake, ali onclick="_poziZoom(i)" MORA
// nositi ORIGINALNI indeks u _poziEvts — ne poziciju unutar trake. Ako bi ta
// veza pukla, klik na "20-40 km" traku bi zumirao na POGREŠAN požar (ista
// klasa bug-a kao dokumentovano "Pozicija u DOM-u NIJE indeks u nizu").
function extractFnBody(name) { return extractFn(name); }
const SRC9 = [
  SRC_DST,
  extractConst('_POZ_TRAKE'),
  extractFn('_poziTraka'),
  extractFn('_bearing'),
  extractFn('_azimutSmjer'),
  extractFn('fmtL'),
  extractFn('_poziPouzdanost'),
  extractFn('_poziStarost'),
  extractFn('_poziRedHtml'),
  extractConst('_POZ_PO_TRACI'),
  extractFn('_poziListaHtml'),
].join('\n');

function makeLista({ evts, on = true, meta = {} }) {
  const sandbox = {
    _poziOn: on, _poziMeta: meta, _poziEvts: evts,
    _poziRefTacka: () => ({ la:44.88, lo:16.15, gps:true }),
    _poziOkvirNaziv: () => '24 sata', _POZ_RADIUS_KM: 150,
    _escHtml: (s) => s,
  };
  const keys = Object.keys(sandbox);
  return new Function(...keys, SRC9 + '\nreturn _poziListaHtml();')(...keys.map(k => sandbox[k]));
}

t('zaglavlja traka se pojavljuju SAMO za trake koje stvarno imaju požar', () => {
  const html = makeLista({ evts: [
    { d:5000,  la:44.9,  lo:16.2,  conf:'h', broj:1, sateliti:['Suomi-NPP'], zadnji:Date.now(), nov:false },
    { d:90000, la:45.5,  lo:17.0,  conf:'h', broj:1, sateliti:['Suomi-NPP'], zadnji:Date.now(), nov:false },
  ]});
  assert.match(html, /Do 20 km/);
  assert.ok(!/20–40 km/.test(html), 'nema požara u srednjoj traci — zaglavlje ne smije postojati');
  assert.match(html, /Preko 40 km/);
});

t('onclick indeksi ostaju ORIGINALNI iz _poziEvts, ne pozicija unutar trake', () => {
  // Namjerno redoslijed koji miješa trake: [blizu, dalje, srednje] — _poziEvts
  // je inače sortiran po udaljenosti, ali test provjerava da grupisanje NE
  // pretpostavlja sortiranost pri računanju indeksa.
  const evts = [
    { d:5000,  la:44.9, lo:16.2, conf:'h', broj:1, sateliti:['A'], zadnji:Date.now(), nov:false },  // i=0, blizu
    { d:90000, la:45.5, lo:17.0, conf:'h', broj:1, sateliti:['A'], zadnji:Date.now(), nov:false },  // i=1, dalje
    { d:25000, la:45.1, lo:16.4, conf:'h', broj:1, sateliti:['A'], zadnji:Date.now(), nov:false },  // i=2, sred
  ];
  const html = makeLista({ evts });
  assert.match(html, /_poziZoom\(0\)/, 'požar iz "blizu" trake mora nositi indeks 0');
  assert.match(html, /_poziZoom\(1\)/, 'požar iz "dalje" trake mora nositi indeks 1 (ne 2 ili 0)');
  assert.match(html, /_poziZoom\(2\)/, 'požar iz "sred" trake mora nositi indeks 2 (ne 1)');
});

t('traka sa više od _POZ_PO_TRACI požara ispiše "i još N", ostale i dalje broji u zaglavlju', () => {
  const evts = Array.from({ length: 9 }, (_, k) => ({
    d: 1000 + k * 100, la:44.9, lo:16.2, conf:'h', broj:1, sateliti:['A'], zadnji:Date.now(), nov:false
  }));
  const html = makeLista({ evts });
  assert.match(html, /Do 20 km.*\(9\)/s, 'zaglavlje mora brojati SVIH 9, ne samo prikazanih');
  assert.match(html, /i još 3 u ovoj traci/);
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
