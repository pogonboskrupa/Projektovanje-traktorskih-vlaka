// =====================================================================
// Testovi za BOJE PO NAGIBU (_gradeColor / _steepColor u index.html).
// Pokretanje:  node tests/js/boje-nagiba.test.js
// ---------------------------------------------------------------------
// Zašto ovaj test postoji: u index.html su POSTOJALE DVIJE funkcije istog
// imena `_hexToRgb` — jedna vraća NIZ [r,g,b] (za računanje boja), druga
// string "r,g,b" (za rgba(...) u CSS-u). Deklaracije funkcija se hoistuju i
// zadnja tiho pobjeđuje, pa su pozivaoci koji rade
//     const [r,g,b] = _hexToRgb(c)
// dobijali string i destrukturirali mu PRVA TRI ZNAKA ('5','9',','). Rezultat:
// _gradeColor je vraćao boje tipa "#0aNaN34". Canvas neispravnu boju NE prijavi
// kao grešku nego je tiho ignoriše i zadrži prethodnu, pa su segmenti u
// "Analizi nagiba" dobijali boju nasumične druge vlake — skala zelena→žuta→
// crvena nije radila, a ništa u konzoli to nije odalo.
//
// Zato se ovdje ne testira reimplementacija nego STVARNI izvorni kod: funkcije
// se izvlače direktno iz index.html.
//
// Invarijante:
//   1. Svaka vraćena boja je ISPRAVAN #rrggbb (nikad NaN).
//   2. Skala raste zelena → žuta → crvena kako nagib raste.
//   3. U index.html ne smije postojati DVIJE funkcije istog imena.
// =====================================================================
'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');

function extractFn(name) {
  const re = new RegExp('^\\s*(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'm');
  const m = re.exec(HTML);
  assert.ok(m, 'nije nađena funkcija ' + name + ' u index.html');
  const start = m.index + m[0].indexOf('function');
  let i = HTML.indexOf('{', start), depth = 0;
  for (; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') { depth--; if (depth === 0) return HTML.slice(start, i + 1); }
  }
  throw new Error('nezatvorena funkcija ' + name);
}
function extractConst(name) {
  const start = HTML.indexOf('const ' + name + ' = [');
  assert.ok(start >= 0, 'nije nađena konstanta ' + name);
  const end = HTML.indexOf('];', start);
  return HTML.slice(start, end + 2);
}

const SRC = [
  extractFn('_hexToRgb'),
  extractFn('_rgbToHex'),
  extractFn('_hexToRgbCsv'),
  extractFn('_steepColor'),
  extractConst('_GRADE_STOPS'),
  extractFn('_gradeColor'),
].join('\n');

const api = new Function(SRC + '\nreturn { _hexToRgb, _rgbToHex, _hexToRgbCsv, _steepColor, _gradeColor, _GRADE_STOPS };')();

const HEX = /^#[0-9a-f]{6}$/i;
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✔ ' + name); }
  catch (e) { fail++; console.log('  ✘ ' + name + '\n      ' + e.message); }
}

console.log('Nema duplih imena funkcija u index.html:');

t('svako "function ime(" je definisano tačno jednom', () => {
  const names = HTML.match(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)
    .map(s => s.replace(/^\s*(?:async\s+)?function\s+/, '').replace(/\s*\($/, ''));
  const seen = new Map();
  names.forEach(n => seen.set(n, (seen.get(n) || 0) + 1));
  const dupes = [...seen].filter(([, c]) => c > 1).map(([n, c]) => `${n} ×${c}`);
  assert.deepStrictEqual(dupes, [],
    'duple definicije tiho gaze jedna drugu (zadnja pobjeđuje): ' + dupes.join(', '));
});

console.log('_hexToRgb — osnovni ugovor:');

t('vraća NIZ od tri broja, ne string', () => {
  const v = api._hexToRgb('#3b82f6');
  assert.ok(Array.isArray(v), 'mora biti niz, dobiveno: ' + typeof v);
  assert.deepStrictEqual(v, [59, 130, 246]);
});

t('podržava i kratki zapis #abc', () => {
  assert.deepStrictEqual(api._hexToRgb('#f00'), [255, 0, 0]);
});

t('_hexToRgbCsv daje "r,g,b" za rgba() u CSS-u', () => {
  assert.strictEqual(api._hexToRgbCsv('#3b82f6'), '59,130,246');
  assert.strictEqual(api._hexToRgbCsv('#f00'), '255,0,0');  // i kratki zapis
});

t('_rgbToHex je inverz _hexToRgb', () => {
  ['#22c55e', '#000000', '#ffffff', '#f97316'].forEach(h =>
    assert.strictEqual(api._rgbToHex(...api._hexToRgb(h)), h));
});

console.log('_gradeColor — skala boja po nagibu:');

t('nijedna boja nije NaN (0–60% u koracima od 1%)', () => {
  const lose = [];
  for (let g = 0; g <= 60; g++) {
    const c = api._gradeColor(g);
    if (!HEX.test(c)) lose.push(g + '% → ' + c);
  }
  assert.deepStrictEqual(lose.slice(0, 8), [], lose.length + ' neispravnih boja');
});

t('tačke skale se vraćaju doslovno', () => {
  api._GRADE_STOPS.forEach(([g, c]) => assert.strictEqual(api._gradeColor(g), c, 'na ' + g + '%'));
});

t('crvena raste, zelena pada kako nagib raste', () => {
  const c0 = rgb(api._gradeColor(0)), c40 = rgb(api._gradeColor(40));
  assert.ok(c40[0] > c0[0], 'crvena mora rasti: ' + c0[0] + ' → ' + c40[0]);
  assert.ok(c40[1] < c0[1], 'zelena mora padati: ' + c0[1] + ' → ' + c40[1]);
});

t('međuvrijednost je stvarno između susjednih tačaka skale', () => {
  // 12% je između stopa 10 (#a3e635) i 15 (#facc15)
  const [r] = rgb(api._gradeColor(12));
  const [r10] = rgb('#a3e635'), [r15] = rgb('#facc15');
  assert.ok(r > r10 && r < r15, `crvena na 12% (${r}) mora biti između ${r10} i ${r15}`);
});

t('negativan nagib ne ruši funkciju', () => {
  assert.ok(HEX.test(api._gradeColor(-5)));
});

console.log('_steepColor:');

t('vraća ispravan hex za sve nagibe', () => {
  for (let g = 0; g <= 60; g += 5) assert.ok(HEX.test(api._steepColor('#22c55e', g)), 'nagib ' + g);
});

t('na 20% i ispod ostaje bazna boja, iznad se pomjera ka crvenoj', () => {
  assert.strictEqual(api._steepColor('#22c55e', 20), '#22c55e');
  assert.ok(rgb(api._steepColor('#22c55e', 40))[0] > rgb('#22c55e')[0], 'crvena mora rasti');
});

console.log('\n' + pass + ' prošlo, ' + fail + ' palo');
process.exit(fail ? 1 : 0);
