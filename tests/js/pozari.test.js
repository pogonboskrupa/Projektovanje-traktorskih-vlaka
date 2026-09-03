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
function t(name, fn) {
  try { fn(); pass++; console.log('  ✔ ' + name); }
  catch (e) { fail++; console.log('  ✘ ' + name + '\n      ' + e.message); }
}

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

console.log('\n' + pass + ' prošlo, ' + fail + ' palo');
process.exit(fail ? 1 : 0);
