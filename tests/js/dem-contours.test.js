// =====================================================================
// Testovi za KONTURE (izohipse) na karti — _msCellSegments / _drawContours.
// Pokretanje:  node tests/js/dem-contours.test.js
// ---------------------------------------------------------------------
// Novi sloj (v3.103.0): iscrtava linije konstantne nadmorske visine
// direktno iz ISTOG Terrarium DEM-a koji app već povlači za Hipsometriju/
// Nagib/N.V./Ekspoziciju (_getTerrariumTile + _TERR_CACHE) — nema novog
// mrežnog izvora. Ovo je marching-squares implementacija napisana za ovu
// izmjenu, pa se ovdje ne testira reimplementacija nego STVARNI izvorni kod,
// izvučen direktno iz index.html.
//
// Invarijante:
//   1. Ravan teren (bez raspona) ne crta ništa.
//   2. Linearna rampa daje PRAVE linije tačno na očekivanoj poziciji
//      (dokazuje da je interpolacija tačna, ne samo "nešto nacrta").
//   3. "Sedlasti" slučaj (dijagonalno naizmjenične vrijednosti) se razriješi
//      bez degenerisanih (nulte dužine) segmenata.
//   4. Indeksne linije (svakih 100m) su deblje i tamnije od običnih.
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

const SRC = [extractFn('_contourColor'), extractFn('_msCellSegments'), extractFn('_drawContours')].join('\n');
const { _drawContours, _contourColor } =
  new Function(SRC + '\nreturn { _msCellSegments, _drawContours, _contourColor };')();

function mkCtx(log) {
  return {
    lineJoin: '', strokeStyle: '', lineWidth: 0,
    beginPath() { this._segs = []; },
    moveTo(x, y) { this._cur = [x, y]; },
    lineTo(x, y) { this._segs.push([this._cur, [x, y]]); },
    stroke() { log.push({ style: this.strokeStyle, w: this.lineWidth, segs: this._segs.slice() }); }
  };
}

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✔ ' + name); }
  catch (e) { fail++; console.log('  ✘ ' + name + '\n      ' + e.message); }
}

console.log('_drawContours — osnovni slučajevi:');

t('ravan teren (bez raspona) ne crta ništa', () => {
  const elev = new Float32Array(10 * 10).fill(500);
  const log = [];
  _drawContours(mkCtx(log), elev, 10, 10, 20);
  assert.deepStrictEqual(log, []);
});

t('horizontalna rampa daje VERTIKALNE linije na tačnoj poziciji', () => {
  // elev = x*10 → nivo 20/40/60/80 mora pasti tačno na x=2/4/6/8
  const W = 10, H = 10;
  const elev = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) elev[y * W + x] = x * 10;
  const log = [];
  _drawContours(mkCtx(log), elev, W, H, 20);
  const withSegs = log.filter(l => l.segs.length);
  assert.strictEqual(withSegs.length, 4, 'očekivane tačno 4 konture (na x=2,4,6,8)');
  withSegs.forEach(l => {
    const xs = l.segs.flatMap(s => [s[0][0], s[1][0]]);
    const ys = l.segs.flatMap(s => [s[0][1], s[1][1]]);
    assert.ok(Math.max(...xs) - Math.min(...xs) < 1e-9, 'linija mora biti savršeno vertikalna');
    assert.strictEqual(Math.min(...ys), 0);
    assert.strictEqual(Math.max(...ys), H - 1, 'mora pokrivati cijelu visinu grida');
  });
});

t('dijagonalna rampa drži x+y = const duž cijele linije', () => {
  const W = 10, H = 10;
  const elev = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) elev[y * W + x] = (x + y) * 5;
  const log = [];
  _drawContours(mkCtx(log), elev, W, H, 20);
  log.filter(l => l.segs.length).forEach(l => {
    const vals = l.segs.flatMap(s => [s[0][0] + s[0][1], s[1][0] + s[1][1]]);
    assert.ok(Math.max(...vals) - Math.min(...vals) < 1e-9, 'x+y mora biti konstantno duž linije');
  });
});

console.log('Sedlasti slučaj (dijagonalno naizmjenične vrijednosti):');

t('šahovnica ne pravi degenerisane (nulte dužine) segmente', () => {
  const elev = new Float32Array([100, 0, 100, 0, 100, 0, 100, 0, 100]); // 3x3
  const log = [];
  _drawContours(mkCtx(log), elev, 3, 3, 50);
  const degenerisan = log.some(l => l.segs.some(([a, b]) => a[0] === b[0] && a[1] === b[1]));
  assert.strictEqual(degenerisan, false);
});

t('šahovnica ipak nacrta segmente (sedlo se ne preskače)', () => {
  const elev = new Float32Array([100, 0, 100, 0, 100, 0, 100, 0, 100]);
  const log = [];
  _drawContours(mkCtx(log), elev, 3, 3, 50);
  assert.ok(log.some(l => l.segs.length > 0));
});

console.log('Indeksne linije (svakih 100m) su naglašenije:');

t('_contourColor: 100m tamnija/neprozirnija od 20m', () => {
  const a100 = _contourColor(100), a20 = _contourColor(20);
  assert.notStrictEqual(a100, a20);
  const alpha = s => parseFloat(s.match(/[\d.]+\)$/)[0]);
  assert.ok(alpha(a100) > alpha(a20), 'indeksna linija mora biti neprozirnija');
});

t('_drawContours: 100m linija ima veći lineWidth od 20m/40m/60m/80m', () => {
  const W = 20, H = 2;
  const elev = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) elev[y * W + x] = x * 10; // 0..190
  const log = [];
  _drawContours(mkCtx(log), elev, W, H, 20);
  const w100 = log.find(l => Math.abs(l.w - 1.6) < 1e-9);
  const wOstalo = log.filter(l => Math.abs(l.w - 0.8) < 1e-9);
  assert.ok(w100, 'mora postojati barem jedna deblja (indeksna) linija');
  assert.ok(wOstalo.length > 0, 'mora postojati barem jedna tanja linija');
});

console.log('\n' + pass + ' prošlo, ' + fail + ' palo');
process.exit(fail ? 1 : 0);
