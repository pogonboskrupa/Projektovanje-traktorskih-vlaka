// =====================================================================
// Testovi za Terrarium DEM grid resampling (index.html: _demFetchGridTerrarium
// i pomoćne Mercator funkcije). Pokretanje: node tests/js/dem-terrarium.test.js
// ---------------------------------------------------------------------
// _demFetchGridTerrarium živi unutar index.html (zavisi od document/canvas
// za dekodiranje PNG pločica), pa se ne može direktno require()-ovati u
// Node-u bez DOM-a. Ovdje se testira ono što JESTE čist JS i najosjetljivije
// na off-by-one greške: Mercator koordinatne konverzije (kopija iz
// index.html — mora ostati IDENTIČNA) i logika resample-a (reimplementirana
// nad SINTETIČKIM dekodiranim pločicama, provjerava indeksiranje tile/piksel
// bez stvarnog PNG dekodiranja).
// =====================================================================
'use strict';
const assert = require('node:assert');

// ── Kopija Mercator pomoćnih funkcija iz index.html (moraju ostati identične) ──
function _tile2lat(y, z) {
  const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}
function _tile2lon(x, z) { return x / Math.pow(2, z) * 360 - 180; }
function _termLon2x(lon, z) { return (lon + 180) / 360 * Math.pow(2, z); }
function _termLat2y(lat, z) {
  const r = lat * Math.PI / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z);
}

// ── Reimplementacija resample petlje iz _demFetchGridTerrarium, nad
// ubrizganim (sintetičkim) dekodiranim pločicama umjesto stvarnog PNG-a ──
function resampleFromTiles(s, n, w, e, step, rows, cols, z, txMin, txMax, tyMin, tyMax, tileElevs) {
  const grid = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    const lat = s + r * step;
    const fy = _termLat2y(lat, z);
    const ty = Math.max(tyMin, Math.min(tyMax, Math.floor(fy)));
    const py = Math.max(0, Math.min(255, Math.round((fy - ty) * 256)));
    for (let c = 0; c < cols; c++) {
      const lon = w + c * step;
      const fx = _termLon2x(lon, z);
      const tx = Math.max(txMin, Math.min(txMax, Math.floor(fx)));
      const px = Math.max(0, Math.min(255, Math.round((fx - tx) * 256)));
      const tileElev = tileElevs.get(tx + ':' + ty);
      grid[r * cols + c] = tileElev ? tileElev[py * 256 + px] : NaN;
    }
  }
  return grid;
}

let _pass = 0, _fail = 0;
function test(name, fn) {
  try { fn(); _pass++; console.log('  ✓', name); }
  catch (e) { _fail++; console.error('  ✗', name, '\n    →', e.message); }
}

console.log('dem-terrarium.test.js\n');

test('Mercator round-trip: lon→x→lon i lat→y→lat konzistentni', () => {
  const z = 12;
  for (const lon of [16.0, 16.4, 18.9, -179.9]) {
    const x = _termLon2x(lon, z);
    const backLon = _tile2lon(x, z);
    assert.ok(Math.abs(backLon - lon) < 1e-6, `lon ${lon} → ${backLon}`);
  }
  for (const lat of [0, 44.7, 60, -44.7]) {
    const y = _termLat2y(lat, z);
    const backLat = _tile2lat(y, z);
    assert.ok(Math.abs(backLat - lat) < 1e-6, `lat ${lat} → ${backLat}`);
  }
});

test('_termLat2y: veći lat (sjevernije) daje MANJI y (Web Mercator ide sjever→jug)', () => {
  const z = 10;
  const yNorth = _termLat2y(45, z);
  const ySouth = _termLat2y(44, z);
  assert.ok(yNorth < ySouth, 'sjevernija tačka mora imati manji tile-y');
});

test('resample: tačka u centru jedne pločice čita očekivani piksel', () => {
  const z = 12;
  // Odaberi proizvoljnu tačku, nađi joj tile, napravi sintetičku pločicu
  // gdje je elev[py*256+px] = py*1000+px (deterministički, lako provjeriti).
  const lat = 44.75, lon = 16.40;
  const fx = _termLon2x(lon, z), fy = _termLat2y(lat, z);
  const tx = Math.floor(fx), ty = Math.floor(fy);
  const expectedPx = Math.round((fx - tx) * 256);
  const expectedPy = Math.round((fy - ty) * 256);

  const tileElevs = new Map();
  const synthetic = new Float32Array(256 * 256);
  for (let py = 0; py < 256; py++)
    for (let px = 0; px < 256; px++)
      synthetic[py * 256 + px] = py * 1000 + px;
  tileElevs.set(tx + ':' + ty, synthetic);

  // Grid od tačno jedne ćelije, tačno na (lat,lon).
  const grid = resampleFromTiles(lat, lat, lon, lon, 0.0001, 1, 1, z, tx, tx, ty, ty, tileElevs);
  const expected = expectedPy * 1000 + expectedPx;
  assert.equal(grid[0], expected, `očekivano ${expected} (py=${expectedPy},px=${expectedPx}), dobijeno ${grid[0]}`);
});

test('resample: grid koji prelazi granicu dvije pločice čita iz OBJE ispravno', () => {
  const z = 12;
  // Nađi tačnu granicu tile x=tx/tx+1 na ovoj širini, postavi tačke odmah
  // lijevo i desno od granice — moraju pasti u različite pločice.
  const lat = 44.75;
  const anyLon = 16.40, anyFx = _termLon2x(anyLon, z);
  const tx = Math.floor(anyFx);
  const lonAtBoundary = _tile2lon(tx + 1, z); // lon tačno na granici tx|tx+1
  const lonLeft  = lonAtBoundary - 0.0005;  // malo unutar lijeve (tx) pločice
  const lonRight = lonAtBoundary + 0.0005;  // malo unutar desne (tx+1) pločice
  const fyAt = _termLat2y(lat, z);
  const ty = Math.floor(fyAt);

  const tileElevs = new Map();
  const mkTile = (fillValue) => { const a = new Float32Array(256*256); a.fill(fillValue); return a; };
  tileElevs.set(tx + ':' + ty, mkTile(111));
  tileElevs.set((tx+1) + ':' + ty, mkTile(222));

  const gLeft  = resampleFromTiles(lat, lat, lonLeft, lonLeft, 0.0001, 1, 1, z, tx, tx+1, ty, ty, tileElevs);
  const gRight = resampleFromTiles(lat, lat, lonRight, lonRight, 0.0001, 1, 1, z, tx, tx+1, ty, ty, tileElevs);
  assert.equal(gLeft[0], 111, 'tačka lijevo od granice mora čitati iz lijeve (tx) pločice');
  assert.equal(gRight[0], 222, 'tačka desno od granice mora čitati iz desne (tx+1) pločice');
});

test('resample: nedostajuća pločica (null) daje NaN, ne padne', () => {
  const z = 12;
  const tileElevs = new Map(); // prazna — nijedna pločica "preuzeta"
  const grid = resampleFromTiles(44.75, 44.75, 16.40, 16.40, 0.0001, 1, 1, z, 0, 100000, 0, 100000, tileElevs);
  assert.ok(Number.isNaN(grid[0]), 'nedostajuća pločica mora dati NaN (poziva _demFetchGridTerrarium onda baca grešku)');
});

console.log(`\n${_pass} prošlo, ${_fail} palo`);
process.exit(_fail > 0 ? 1 : 0);
