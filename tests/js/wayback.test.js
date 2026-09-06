// =====================================================================
// Testovi za VREMENSKU TRAKU (Esri World Imagery Wayback, v3.111.0).
// Pokretanje:  node tests/js/wayback.test.js
// ---------------------------------------------------------------------
// Google Earth nema besplatan API bez ključa za istorijske snimke — Esri
// besplatno i bez ključa nudi isto: arhivu prošlih verzija SVOJE World
// Imagery podloge (koju app već koristi kao "🛰 Satelit"). Datum je
// ugniježđen u waybackconfig.json polju `itemTitle` ("World Imagery
// (Wayback 2026-08-05)"), ne poseban JSON field — _wbParsiraj to izvlači
// regexom. Testovi izvlače STVARNI kod iz index.html, ne reimplementaciju.
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
  let fstart = HTML.indexOf('function', start);
  // _wbUcitajReleases je "async function" — bez ovoga bi se "async " prefiks
  // odsjekao pri izvlačenju i unutrašnji await bi pukao van async konteksta.
  if (HTML.slice(Math.max(0, fstart - 6), fstart) === 'async ') fstart -= 6;
  let i = HTML.indexOf('{', fstart), depth = 0;
  for (; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') { depth--; if (depth === 0) return HTML.slice(fstart, i + 1); }
  }
  throw new Error('nezatvorena funkcija ' + name);
}
function extractConst(name) {
  const re = new RegExp('const ' + name + '\\s*=');
  const start = HTML.search(re);
  assert.ok(start >= 0, 'nije nađena konstanta ' + name + ' u index.html');
  const end = HTML.indexOf(';', start);
  assert.ok(end > start, 'konstanta ' + name + ' nema ";" — provjeri obrazac');
  return HTML.slice(start, end + 1);
}

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

console.log('_wbParsiraj — waybackconfig.json → [{date,url}], najnoviji prvi:');

const SRC1 = [extractFn('_wbParsiraj')].join('\n');
const { _wbParsiraj } = new Function(SRC1 + '\nreturn { _wbParsiraj };')();

t('ispravan config: izvlači datum iz itemTitle i sortira OPADAJUĆE', () => {
  const json = {
    '100': { itemTitle: 'World Imagery (Wayback 2020-06-01)', itemURL: 'https://x/100/{level}/{row}/{col}' },
    '200': { itemTitle: 'World Imagery (Wayback 2023-01-15)', itemURL: 'https://x/200/{level}/{row}/{col}' },
    '50':  { itemTitle: 'World Imagery (Wayback 2018-12-20)', itemURL: 'https://x/50/{level}/{row}/{col}' },
  };
  const out = _wbParsiraj(json);
  assert.strictEqual(out.length, 3);
  assert.deepStrictEqual(out.map(r => r.date), ['2023-01-15', '2020-06-01', '2018-12-20']);
  assert.strictEqual(out[0].url, 'https://x/200/{level}/{row}/{col}');
});

t('unosi bez prepoznatljivog datuma u itemTitle ili bez itemURL se PRESKAČU, ne ruše parser', () => {
  const json = {
    '1': { itemTitle: 'nešto bez datuma', itemURL: 'https://x/1' },
    '2': { itemTitle: 'World Imagery (Wayback 2021-07-04)' }, // nema itemURL
    '3': { itemTitle: 'World Imagery (Wayback 2021-07-05)', itemURL: 'https://x/3' },
  };
  const out = _wbParsiraj(json);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].date, '2021-07-05');
});

t('prazan/null config vraća prazan niz, ne baca grešku', () => {
  assert.deepStrictEqual(_wbParsiraj(null), []);
  assert.deepStrictEqual(_wbParsiraj({}), []);
});

console.log('_wbNajblizaZima — pronalazi NAJNOVIJI zimski (dec/jan/feb) release:');

const SRC2 = [extractFn('_wbNajblizaZima')].join('\n');

function makeZima(releases) {
  const sandbox = { _wbReleases: releases };
  const keys = Object.keys(sandbox);
  return new Function(...keys, SRC2 + '\nreturn _wbNajblizaZima();')(...keys.map(k => sandbox[k]));
}

t('lista sortirana najnoviji-prvo: vraća PRVI zimski na koji naiđe (najnoviji zimski)', () => {
  const r = makeZima([
    { date: '2023-08-10', url: 'a' },
    { date: '2023-01-20', url: 'b' },  // najnoviji zimski
    { date: '2022-01-05', url: 'c' },
  ]);
  assert.strictEqual(r.url, 'b');
});

t('decembar i februar se prepoznaju kao zima, ne samo januar', () => {
  assert.strictEqual(makeZima([{ date: '2022-12-15', url: 'dec' }]).url, 'dec');
  assert.strictEqual(makeZima([{ date: '2022-02-15', url: 'feb' }]).url, 'feb');
  assert.strictEqual(makeZima([{ date: '2022-06-15', url: 'jun' }]), null);
});

t('nema zimskog release-a u arhivi → null, ne baca grešku', () => {
  assert.strictEqual(makeZima([{ date: '2022-07-01', url: 'x' }]), null);
  assert.strictEqual(makeZima([]), null);
  assert.strictEqual(makeZima(null), null);
});

console.log('_wbUcitajReleases — mreža/keš/greška (offline-first obrazac):');

const SRC3 = [
  // _wbReleases mora biti LOKALNA `let` ovdje, ne implicitni global — inače bi
  // (u non-strict Function-konstruktoru) sve makeUcitaj() sandbox-instance
  // dijelile ISTU globalnu promjenljivu, pa bi async testovi koji se izvršavaju
  // isprepleteno (mikrozadaci) čitali TUĐ, race-condition rezultat.
  'let _wbReleases = null;',
  extractFn('_wbParsiraj'),
  extractConst('_WB_CONFIG_URL'),
  extractConst('_WB_CACHE_KEY'),
  extractFn('_wbUcitajReleases'),
].join('\n');

function makeUcitaj({ fetchImpl, store = {}, toasts = [] }) {
  const sandbox = {
    _fetchT: fetchImpl,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = v; },
    },
    showToast: (msg) => toasts.push(msg),
  };
  const keys = Object.keys(sandbox);
  return new Function(...keys,
    SRC3 + '\nreturn (tiho) => _wbUcitajReleases(tiho).then(ok => ({ ok, _wbReleases }));'
  )(...keys.map(k => sandbox[k]));
}

t('uspješan fetch: parsira, upisuje u localStorage, vraća true', async () => {
  const store = {};
  const run = makeUcitaj({
    fetchImpl: async () => ({ ok: true, json: async () => ({
      '1': { itemTitle: 'World Imagery (Wayback 2024-03-10)', itemURL: 'https://x/1' }
    }) }),
    store,
  });
  const res = await run(false);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res._wbReleases.length, 1);
  const saved = JSON.parse(store['tvlake_wayback_releases']);
  assert.strictEqual(saved[0].date, '2024-03-10');
});

t('mreža padne, ali postoji ranije sačuvan keš → koristi keš, vraća true, BEZ toasta', async () => {
  const toasts = [];
  const cached = [{ date: '2019-01-01', url: 'https://cached' }];
  const run = makeUcitaj({
    fetchImpl: async () => { throw new Error('mreza pala'); },
    store: { tvlake_wayback_releases: JSON.stringify(cached) },
    toasts,
  });
  const res = await run(false);
  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual(res._wbReleases, cached);
  assert.strictEqual(toasts.length, 0, 'keš je uspio — nema razloga za grešku korisniku');
});

t('mreža padne I nema keša → false, toast upozorava (osim ako je "tiho")', async () => {
  const toasts1 = [];
  const run1 = makeUcitaj({ fetchImpl: async () => { throw new Error('x'); }, toasts: toasts1 });
  const res1 = await run1(false);
  assert.strictEqual(res1.ok, false);
  assert.strictEqual(toasts1.length, 1);

  const toasts2 = [];
  const run2 = makeUcitaj({ fetchImpl: async () => { throw new Error('x'); }, toasts: toasts2 });
  const res2 = await run2(true);
  assert.strictEqual(res2.ok, false);
  assert.strictEqual(toasts2.length, 0, 'tiho=true ne smije prikazati toast');
});

t('korumpiran JSON u kešu ne ruši ništa — tretira se kao "nema keša"', async () => {
  const toasts = [];
  const run = makeUcitaj({
    fetchImpl: async () => { throw new Error('x'); },
    store: { tvlake_wayback_releases: '{ne je json' },
    toasts,
  });
  const res = await run(false);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(toasts.length, 1);
});

(async () => {
  for (const a of _async) {
    try { await a.p; pass++; console.log('  ✔ ' + a.name); }
    catch (e) { fail++; console.log('  ✘ ' + a.name + '\n      ' + e.message); }
  }
  console.log('\n' + pass + ' prošlo, ' + fail + ' palo');
  process.exit(fail ? 1 : 0);
})();
