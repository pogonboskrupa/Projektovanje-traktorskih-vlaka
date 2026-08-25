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

// ── Regresija: heap-based open lista mora ostati brza i na dužoj/težoj trasi ──
// (prijavljeni bug "dvije tačke su premalo" — duže trase su znale iscrpiti
// iteracije prije nego stignu do rješenja; ovo provjerava da veći budžet
// stvarno stigne na vrijeme, ne samo da JESTE veći)
test('rdFindRoute: duža trasa preko strmog terena i dalje brza uz veći budžet', () => {
  const params = Object.assign({}, RD_DEFAULT_PARAMS, { nagibMax: 8, nagibPreporuceni: 6, duzinaMax: 20000 });
  const climbGrade = 0.20;
  const sampleElev = (lat, lon) => 400 + (lat - lat0)*M_PER_DEG_LAT*climbGrade;
  const startLat = lat0, startLon = lon0;
  const endLat = lat0 + 600/M_PER_DEG_LAT, endLon = lon0 + 50/M_PER_DEG_LAT/Math.cos(lat0*Math.PI/180);

  const t0 = Date.now();
  const res = rdFindRoute({ startLat, startLon, endLat, endLon, sampleElev, params, maxIterations: 40000 });
  const elapsed = Date.now() - t0;
  assert.ok(res.ok, 'trasa mora biti pronađena uz dovoljan budžet: ' + res.reason);
  assert.ok(elapsed < 2000, `pretraga ne smije trajati predugo (${elapsed}ms) — heap regresija?`);
  const val = rdValidateRoute(res.path, params);
  assert.ok(!val.anyExceedsMax);
});

// ── Međutačka (via) — obrazac koji index.html koristi: dva odvojena poziva
// rdFindRoute spojena u jednu trasu. Provjerava da je spajanje ispravno
// (bez duple tačke na spoju) i da hard-cutoff nagiba i dalje važi na OBA
// kraka pojedinačno. ──
test('Međutačka: A→M i M→B spojeni bez duple tačke, oba kraka poštuju max nagib', () => {
  const params = Object.assign({}, RD_DEFAULT_PARAMS);
  const sampleElev = (lat, lon) => 500 + (lat - lat0)*M_PER_DEG_LAT*0.04; // blag 4% nagib
  const start = { lat: lat0, lon: lon0 };
  const via = { lat: lat0 + 150/M_PER_DEG_LAT, lon: lon0 + 30/M_PER_DEG_LAT };
  const end = { lat: lat0 + 300/M_PER_DEG_LAT, lon: lon0 };

  const leg1 = rdFindRoute({ startLat: start.lat, startLon: start.lon, endLat: via.lat, endLon: via.lon, sampleElev, params });
  const leg2 = rdFindRoute({ startLat: via.lat, startLon: via.lon, endLat: end.lat, endLon: end.lon, sampleElev, params });
  assert.ok(leg1.ok && leg2.ok, 'oba kraka moraju uspjeti na blagom terenu');

  const merged = leg1.path.concat(leg2.path.slice(1));
  // Nema duple tačke na spoju (ista lat/lon dva puta zaredom)
  for (let i = 1; i < merged.length; i++) {
    assert.ok(!(merged[i].lat === merged[i-1].lat && merged[i].lon === merged[i-1].lon),
      `duplirana tačka na indeksu ${i}`);
  }
  const val = rdValidateRoute(merged, params);
  assert.ok(!val.anyExceedsMax, 'spojena trasa preko međutačke ne smije prelaziti max nagib ni na jednom kraku');
});

// ── Checkbox "ne pravi serpentine" (params.bezSerpentina) ──────────────────
test('bezSerpentina=true: na terenu koji NE zahtijeva serpentinu, trasa se ipak nađe normalno', () => {
  const params = Object.assign({}, RD_DEFAULT_PARAMS, { bezSerpentina: true });
  const sampleElev = (lat, lon) => 500 + Math.sin(lat*37)*0.3; // isti blagi teren kao TEST 1
  const startLat = lat0, startLon = lon0;
  const endLat = lat0 + 250/M_PER_DEG_LAT, endLon = lon0;

  const res = rdFindRoute({ startLat, startLon, endLat, endLon, sampleElev, params });
  assert.ok(res.ok, 'na blagom terenu bez potrebe za serpentinom, isključena opcija ne smije spriječiti trasu: ' + res.reason);
  const val = rdValidateRoute(res.path, params);
  assert.ok(!val.anyExceedsMax);
});

test('bezSerpentina=true: na terenu koji ZAHTIJEVA serpentinu (TEST 3 scenario), algoritam odustaje umjesto da je napravi', () => {
  const params = Object.assign({}, RD_DEFAULT_PARAMS, { nagibMax: 8, nagibPreporuceni: 6, bezSerpentina: true });
  // Identičan teren kao TEST 3 — direktna linija ima ~20% nagib, jedini način
  // da SA serpentinama zadovolji max 8% je cik-cak istok-zapad. Sa isključenim
  // serpentinama, TAJ cik-cak (koji zahtijeva zaokrete preko RD_MAX_TURN_NO_SERPENTINE)
  // mora biti odbačen — algoritam mora vratiti ok:false, NE smije "prevariti"
  // pravilo tako što će jednostavno napraviti serpentinu i dalje.
  const climbGrade = 0.20;
  const sampleElev = (lat, lon) => 400 + (lat - lat0)*M_PER_DEG_LAT*climbGrade;
  const startLat = lat0, startLon = lon0;
  const endLat = lat0 + 60/M_PER_DEG_LAT, endLon = lon0 + 5/M_PER_DEG_LAT/Math.cos(lat0*Math.PI/180);

  const res = rdFindRoute({ startLat, startLon, endLat, endLon, sampleElev, params, maxIterations: 8000 });
  assert.equal(res.ok, false, 'bez serpentina na terenu koje ih zahtijeva, mora vratiti ok:false, ne izmišljenu trasu');

  // Kontrolna provjera — isti teren SA dozvoljenim serpentinama (default) i
  // dalje mora naći trasu (TEST 3 iznad ovo već provjerava, ovdje se samo
  // potvrđuje da je bezSerpentina STVARNI uzrok razlike, ne nešto drugo).
  const paramsAllowed = Object.assign({}, params, { bezSerpentina: false });
  const resAllowed = rdFindRoute({ startLat, startLon, endLat, endLon, sampleElev, params: paramsAllowed, maxIterations: 8000 });
  assert.ok(resAllowed.ok, 'isti teren SA dozvoljenim serpentinama mora naći trasu — bezSerpentina je jedina razlika');
});

// ── "Pro level" zahtjev: nema cik-cak krivudanja na malom prostoru kad teren
// to ne zahtijeva. Prije uvođenja turnPenalty + _rdSmoothPath, dinamička
// pretraga je znala vraćati puno tačaka sa oštrim naizmjeničnim skretanjima
// čak i na skoro ravnom terenu (svaki čvor bira ugao nezavisno prema
// trenutnom azimutu-ka-cilju). Provjerava se DIREKTNO: (1) nijedan zaokret
// između dva uzastopna segmenta ne smije biti oštriji od razumne granice na
// terenu koji ne postavlja nikakvu prepreku, (2) broj tačaka trase mora biti
// blizu minimuma (skoro prava linija), ne desetine sitno izlomljenih koraka. ──
test('Pro level: skoro ravan teren bez prepreka → nema oštrih naizmjeničnih zaokreta, trasa skoro prava linija', () => {
  const params = Object.assign({}, RD_DEFAULT_PARAMS);
  const sampleElev = (lat, lon) => 500 + Math.sin(lat*37)*0.3; // skoro ravno, sitan šum (isto kao TEST 1)
  const startLat = lat0, startLon = lon0;
  const endLat = lat0 + 250/M_PER_DEG_LAT, endLon = lon0;

  const res = rdFindRoute({ startLat, startLon, endLat, endLon, sampleElev, params });
  assert.ok(res.ok, 'trasa mora biti pronađena: ' + res.reason);

  // Nema razloga za krivudanje na ravnom terenu bez prepreka — očekuje se
  // gotovo minimalan broj tačaka (idealno samo A i B).
  assert.ok(res.path.length <= 4, `predugačka izlomljena trasa na ravnom terenu (${res.path.length} tačaka)`);

  for (let i = 1; i < res.path.length - 1; i++) {
    const az1 = rdAzimuth(res.path[i-1].lat, res.path[i-1].lon, res.path[i].lat, res.path[i].lon);
    const az2 = rdAzimuth(res.path[i].lat, res.path[i].lon, res.path[i+1].lat, res.path[i+1].lon);
    let turn = Math.abs(az2 - az1);
    if (turn > 180) turn = 360 - turn;
    assert.ok(turn < 30, `oštar cik-cak zaokret na tački ${i}: ${turn.toFixed(0)}° na terenu bez prepreka`);
  }
});

console.log(`\n${_pass} prošlo, ${_fail} palo`);
process.exit(_fail > 0 ? 1 : 0);
