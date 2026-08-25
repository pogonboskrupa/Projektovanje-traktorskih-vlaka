// =====================================================================
// Testovi za modul projektovanja šumskog puta — static/js/road-design.js
// Pokretanje:  node tests/js/road-design.test.js   (bez zavisnosti)
// ---------------------------------------------------------------------
// Tri scenarija tražena u specifikaciji (ista kota / velika visinska
// razlika / prava linija prelazi max nagib pa mora naći dužu trasu).
// Poseban fokus: algoritam NIKAD ne smije tvrditi da je trasa prihvatljiva
// ako bilo koji segment prelazi maksimalni dozvoljeni nagib — to se
// eksplicitno provjerava na svakom segmentu vraćene trase, ne samo na
// prosjeku.
// =====================================================================
'use strict';
const assert = require('node:assert');

const { RD_DEFAULT_PARAMS, rdHaversine, rdAzimuth, rdSestarKorak, rdFindRoute, rdValidateRoute } =
  require('../../static/js/road-design.js');

let _pass = 0, _fail = 0;
function test(name, fn) {
  try { fn(); _pass++; console.log('  ✓', name); }
  catch (e) { _fail++; console.error('  ✗', name, '\n    →', e.message); }
}

const M_PER_DEG_LAT = 111320;
const lat0 = 44.20, lon0 = 16.40; // negdje u BiH, samo referentna tačka za test

console.log('road-design.test.js\n');

// ── Helper geodezije za testove ────────────────────────────────────────
test('rdHaversine/rdAzimuth osnovna sanity provjera', () => {
  const d = rdHaversine(lat0, lon0, lat0 + 300/M_PER_DEG_LAT, lon0);
  assert.ok(Math.abs(d - 300) < 1, `očekivano ~300m, dobijeno ${d}`);
  const az = rdAzimuth(lat0, lon0, lat0 + 300/M_PER_DEG_LAT, lon0);
  assert.ok(Math.abs(az - 0) < 1, `azimut ka sjeveru mora biti ~0°, dobijeno ${az}`);
});

test('rdSestarKorak: L = ΔH/i (primjer iz specifikacije)', () => {
  const L = rdSestarKorak(10, 8); // ΔH=10, i=0.08 → 125
  assert.ok(Math.abs(L - 125) < 0.01, `očekivano 125, dobijeno ${L}`);
});

// ── TEST 1: A i B na približno istoj koti ──────────────────────────────
test('TEST 1: ista kota → trasa uspješna, nizak nagib, blizu direktne dužine', () => {
  const params = Object.assign({}, RD_DEFAULT_PARAMS);
  const sampleElev = (lat, lon) => 500 + Math.sin(lat*37)*0.3; // skoro ravno, sitan šum
  const startLat = lat0, startLon = lon0;
  const endLat = lat0 + 250/M_PER_DEG_LAT, endLon = lon0;

  const res = rdFindRoute({ startLat, startLon, endLat, endLon, sampleElev, params });
  assert.ok(res.ok, 'trasa mora biti pronađena: ' + res.reason);
  assert.ok(res.path.length >= 2);

  const val = rdValidateRoute(res.path, params);
  assert.ok(!val.anyExceedsMax, 'nijedan segment ne smije prelaziti max nagib');
  assert.ok(val.maxSlopePct < 3, `max nagib treba biti nizak na ravnom terenu, dobijeno ${val.maxSlopePct}`);
  const straight = rdHaversine(startLat, startLon, endLat, endLon);
  assert.ok(val.totalDist < straight * 1.3, `trasa ne bi trebala biti mnogo duža od prave linije na ravnom terenu (${val.totalDist} vs ${straight})`);
});

// ── TEST 2: velika visinska razlika, ali dostižan (jednoličan, prihvatljiv) nagib ──
test('TEST 2: velika visinska razlika → trasa pronađena, nijedan segment ne prelazi max', () => {
  const params = Object.assign({}, RD_DEFAULT_PARAMS); // max 8%, preporučeni 6%
  const grade = 0.055; // 5.5% jednoličan uzdužni nagib terena (ispod max, blizu preporučenog)
  const sampleElev = (lat, lon) => 400 + (lat - lat0)*M_PER_DEG_LAT*grade;
  const startLat = lat0, startLon = lon0;
  const endLat = lat0 + 2000/M_PER_DEG_LAT, endLon = lon0 + 40/M_PER_DEG_LAT/Math.cos(lat0*Math.PI/180);

  const res = rdFindRoute({ startLat, startLon, endLat, endLon, sampleElev, params, maxIterations: 6000 });
  assert.ok(res.ok, 'trasa mora biti pronađena: ' + res.reason);

  const val = rdValidateRoute(res.path, params);
  assert.ok(!val.anyExceedsMax, 'nijedan segment ne smije prelaziti max nagib (' + val.maxSlopePct.toFixed(1) + '%)');
  const dh = Math.abs(sampleElev(endLat, endLon) - sampleElev(startLat, startLon));
  assert.ok(dh > 100, 'test mora pokrivati zaista veliku visinsku razliku (' + dh.toFixed(0) + 'm)');
  const straight = rdHaversine(startLat, startLon, endLat, endLon);
  assert.ok(val.totalDist >= straight - 1, 'trasa preko terena ne može biti kraća od prave linije');
});

// ── TEST 3: prava linija A-B ima nagib veći od dozvoljenog ─────────────
test('TEST 3: direktna linija prelazi max nagib → algoritam nalazi DUŽU trasu, NIJEDAN segment ne prelazi max', () => {
  const params = Object.assign({}, RD_DEFAULT_PARAMS, { nagibMax: 8, nagibPreporuceni: 6 });
  // Teren = čista funkcija geografske širine (sjever-jug) — strm nagib 20% u
  // tom pravcu, ALI potpuno ravan istok-zapad. B je skoro pravo sjeverno od A,
  // pa direktna linija ima ~20% nagib (daleko iznad max 8%), a jedini način da
  // algoritam ostvari dozvoljen nagib je da "cik-cak" hoda istok-zapad dok
  // polako dobija na sjevernom pomaku (isti princip kao serpentina na terenu
  // gdje je visina f(pravac_pada_terena) samo).
  const climbGrade = 0.20;
  const sampleElev = (lat, lon) => 400 + (lat - lat0)*M_PER_DEG_LAT*climbGrade;
  const startLat = lat0, startLon = lon0;
  const endLat = lat0 + 60/M_PER_DEG_LAT, endLon = lon0 + 5/M_PER_DEG_LAT/Math.cos(lat0*Math.PI/180);

  const straightDist = rdHaversine(startLat, startLon, endLat, endLon);
  const straightDh = Math.abs(sampleElev(endLat, endLon) - sampleElev(startLat, startLon));
  const straightSlope = straightDh/straightDist*100;
  assert.ok(straightSlope > params.nagibMax, 'test mora imati direktan nagib veći od max (' + straightSlope.toFixed(0) + '%)');

  const res = rdFindRoute({ startLat, startLon, endLat, endLon, sampleElev, params, maxIterations: 8000 });
  assert.ok(res.ok, 'algoritam mora naći trasu čak i kad je prava linija prestrma: ' + res.reason);

  const val = rdValidateRoute(res.path, params);
  // KRITIČNA PROVJERA — najvažniji zahtjev iz specifikacije: NIJEDAN
  // segment vraćene trase ne smije prelaziti maksimalni dozvoljeni nagib,
  // bez obzira na sve ostalo. Provjerava se segment-po-segment, ne prosjek.
  for (const seg of val.segments) {
    assert.ok(seg.slopePct <= params.nagibMax + 1e-6,
      `segment ${seg.i} prelazi max nagib: ${seg.slopePct.toFixed(1)}% > ${params.nagibMax}%`);
  }
  assert.ok(!val.anyExceedsMax);
  assert.ok(val.totalDist > straightDist * 1.15,
    `trasa mora biti primjetno duža od prave linije kad prava linija ne zadovoljava nagib (${val.totalDist.toFixed(0)}m vs ${straightDist.toFixed(0)}m)`);
});

test('rdFindRoute: nema DEM podataka → ok=false, reason=DEM_MISSING', () => {
  const params = Object.assign({}, RD_DEFAULT_PARAMS);
  const res = rdFindRoute({
    startLat: lat0, startLon: lon0, endLat: lat0+0.01, endLon: lon0,
    sampleElev: () => null, params
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'DEM_MISSING');
});

test('rdFindRoute: nedostižan cilj (okružen prestrmim terenom) → ok=false, ne visi', () => {
  const params = Object.assign({}, RD_DEFAULT_PARAMS, { duzinaMax: 500 });
  // Litica visine 200m odmah oko starta u SVIM pravcima osim onog gdje je
  // isto tako prestrmo — nema prihvatljivog izlaza, algoritam mora odustati
  // (ok:false), a ne visiti u petlji ili tvrditi lažni uspjeh.
  const sampleElev = (lat, lon) => {
    const d = rdHaversine(lat0, lon0, lat, lon);
    return 400 + d*5; // svaki metar udaljenosti od centra = 5m visine (500% nagib)
  };
  const t0 = Date.now();
  const res = rdFindRoute({
    startLat: lat0, startLon: lon0,
    endLat: lat0 + 400/M_PER_DEG_LAT, endLon: lon0,
    sampleElev, params, maxIterations: 3000
  });
  assert.ok(Date.now() - t0 < 5000, 'pretraga ne smije trajati predugo ni kad nema rješenja');
  assert.equal(res.ok, false, 'nedostižan cilj mora vratiti ok:false, ne izmišljenu trasu');
});

console.log(`\n${_pass} prošlo, ${_fail} palo`);
process.exit(_fail > 0 ? 1 : 0);
