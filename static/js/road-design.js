// =====================================================================
// PROJEKTOVANJE ŠUMSKOG PUTA (RD = Road Design) — izdvojeno iz monolita,
// po istom obrascu kao static/js/offline-layer.js (vidi docs/MODULARIZACIJA.md).
// Učitava se <script src>-om, top-level const/function su globalno vidljivi
// narednim inline <script> blokovima u index.html.
//
// FAZA 1 (osnovni end-to-end tok): korisnik postavi tačku A i B, algoritam
// preko DEM-a i principa šestarskog koraka (L = ΔH/i) predloži JEDNU trasu
// koja NIKAD ne prelazi maksimalni dozvoljeni uzdužni nagib. Rezultat se
// pretvara u običnu vlaku (isti obrazac kao ostale metode kreiranja vlake —
// _routeToVlaka u index.html), pa besplatno nasljeđuje postojeći editing
// (buildEditHandles) i profil (_renderElevProfile).
//
// NIJE u Fazi 1 (namjerno, vidi CLAUDE.md/plan): više varijanti trase,
// serpentine, formalna stacionaža+izvoz, poprečni nagib/vodotoci/klizišta
// kao cost-slojevi. Ovaj fajl je pisan tako da se to može dograditi kasnije
// bez prepravke jezgra (rdFindRoute uzima "sampleElev" kao ubrizganu
// funkciju — Faza 2 može ubrizgati sloj koji dodatno penalizuje vodotoke
// bez diranja pathfinding petlje).
//
// Zavisnosti: čisto samostalan modul — sve geo funkcije (azimut, tačka na
// zadanoj udaljenosti/azimutu, haversine) su OVDJE ponovo napisane (ne
// oslanja se na turf/proj4 iz ostatka app-a), da bi jezgro bilo testabilno
// u Node-u bez browsera (vidi tests/js/road-design.test.js). Kod poziva iz
// index.html (glue kod) SLOBODNO koristi postojeće dst()/wgsToMGI/turf —
// ovaj fajl samo ne zavisi od njih.
// =====================================================================

const RD_PARAMS_KEY = 'tvlake_rd_params';

// Sve vrijednosti su podesive (tačka 2 specifikacije) — ovo su samo default-i
// pri prvom otvaranju alata, korisnik ih mijenja u panelu "Parametri trase".
const RD_DEFAULT_PARAMS = {
  nagibMax: 8,              // maksimalni uzdužni nagib (%) — TVRDA granica, nikad se ne prelazi
  nagibPreporuceni: 6,       // preporučeni uzdužni nagib (%) — cilj šestarskog koraka
  nagibMin: 1.5,             // minimalni uzdužni nagib (%) — informativno u Fazi 1 (odvodnjavanje)
  poprecniNagibMax: 60,      // maks. poprečni nagib terena koji se prihvata (%) — rezervisano za Fazu 2
  radijusMin: 12,            // minimalni radijus horizontalne krivine (m) — rezervisano za Fazu 2 (serpentine)
  radijusMax: 60,            // maksimalni radijus po potrebi (m) — rezervisano
  sirinaKolovoza: 3.5,       // m
  sirinaBankine: 0.5,        // m
  sirinaPuta: 4.5,           // m (kolovoz + bankine)
  duzinaMax: 8000,           // maksimalna dozvoljena dužina trase (m) — sigurnosna kočnica pretrage
  toleranNagib: 1,           // dozvoljena tolerancija nagiba (%) — rezervisano za Fazu 2 (blaže upozorenje)
  minRazmakSerpentina: 40    // m — rezervisano za Fazu 2 (serpentine)
};

function rdLoadParams() {
  try {
    const saved = JSON.parse(localStorage.getItem(RD_PARAMS_KEY));
    return Object.assign({}, RD_DEFAULT_PARAMS, saved || {});
  } catch(e) { return Object.assign({}, RD_DEFAULT_PARAMS); }
}

function rdSaveParams(params) {
  try { localStorage.setItem(RD_PARAMS_KEY, JSON.stringify(params)); } catch(e) {}
}

// ─── Geodezija (samostalna, bez vanjskih zavisnosti) ──────────────────────

function rdHaversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const a = Math.sin((lat2-lat1)*Math.PI/360)**2 +
            Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin((lon2-lon1)*Math.PI/360)**2;
  return R*2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Azimut (smjer) od tačke 1 ka tački 2, 0-360°, 0=sjever.
function rdAzimuth(lat1, lon1, lat2, lon2) {
  const φ1 = lat1*Math.PI/180, φ2 = lat2*Math.PI/180, Δλ = (lon2-lon1)*Math.PI/180;
  const y = Math.sin(Δλ)*Math.cos(φ2);
  const x = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);
  return (Math.atan2(y, x)*180/Math.PI + 360) % 360;
}

// Tačka na zadanoj udaljenosti (m) i azimutu (°) od polazne tačke.
function rdDestPoint(lat, lon, azimuthDeg, distM) {
  const R = 6371000;
  const brng = azimuthDeg*Math.PI/180;
  const lat1 = lat*Math.PI/180, lon1 = lon*Math.PI/180;
  const dR = distM/R;
  const lat2 = Math.asin(Math.sin(lat1)*Math.cos(dR) + Math.cos(lat1)*Math.sin(dR)*Math.cos(brng));
  const lon2 = lon1 + Math.atan2(Math.sin(brng)*Math.sin(dR)*Math.cos(lat1), Math.cos(dR)-Math.sin(lat1)*Math.sin(lat2));
  return { lat: lat2*180/Math.PI, lon: ((lon2*180/Math.PI + 540) % 360) - 180 };
}

// Šestarski korak: horizontalna udaljenost potrebna da se savlada visinska
// razlika ΔH uz zadani nagib i (%). L = ΔH / i.  (tačka 3 specifikacije)
function rdSestarKorak(deltaH, nagibPct) {
  const i = Math.max(0.1, nagibPct)/100;
  return Math.abs(deltaH)/i;
}

// ─── Pregled A→B prije generisanja (tačka 1: distanca/azimut/visinska razlika) ──

function rdPreview(startLat, startLon, startElev, endLat, endLon, endElev) {
  const dist = rdHaversine(startLat, startLon, endLat, endLon);
  const az = rdAzimuth(startLat, startLon, endLat, endLon);
  const dh = endElev - startElev;
  return {
    distM: dist,
    azimuthDeg: az,
    elevStart: startElev,
    elevEnd: endElev,
    deltaH: dh,
    directSlopePct: dist > 0 ? Math.abs(dh)/dist*100 : 0
  };
}

// Binarni min-heap za "open" listu A* pretrage. Prvobitna verzija je (kao i
// postojeći _astarRoute u index.html) koristila obično sortiranje niza pri
// svakom skidanju elementa (O(n log n) PO ITERACIJI) — dovoljno brzo za
// kratke trase, ali kod dužih/strmijih (gdje treba puno cik-cak koraka i
// open lista naraste na hiljade) to dominira vremenom izvršavanja i na
// realnom telefonu (sporiji CPU od dev mašine) može izgledati kao da se
// alat zaledio. Heap svodi skidanje/dodavanje na O(log n).
function _rdHeapPush(heap, item) {
  heap.push(item);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (heap[parent].f <= heap[i].f) break;
    const tmp = heap[parent]; heap[parent] = heap[i]; heap[i] = tmp;
    i = parent;
  }
}
function _rdHeapPop(heap) {
  const top = heap[0];
  const last = heap.pop();
  if (heap.length > 0) {
    heap[0] = last;
    let i = 0;
    const n = heap.length;
    while (true) {
      const l = 2*i+1, r = 2*i+2;
      let smallest = i;
      if (l < n && heap[l].f < heap[smallest].f) smallest = l;
      if (r < n && heap[r].f < heap[smallest].f) smallest = r;
      if (smallest === i) break;
      const tmp = heap[smallest]; heap[smallest] = heap[i]; heap[i] = tmp;
      i = smallest;
    }
  }
  return top;
}

// ─── Jezgro: A* vođen šestarskim korakom preko kontinualnog DEM prostora ──
//
// Za razliku od rasterskog A* (fiksne susjedne ćelije grida), ovdje se
// kandidati generišu DINAMIČKI za svaki čvor: koristi se šestarski princip
// (L = preostala visinska razlika / preporučeni nagib) da se odredi POD
// KOJIM UGLOM u odnosu na direktan pravac ka cilju treba skrenuti da bi
// pravolinijski korak te dužine ostvario preporučeni nagib (kontura umjesto
// prave linije uzbrdo/nizbrdo) — tačka 3 specifikacije, ne interpolacija.
// Stvarna ostvarena kosina svakog koraka provjerava se PRAVOM DEM
// elevacijom (sampleElev), pa kandidat koji stvarno prelazi nagibMax biva
// ODBAČEN, bez obzira na idealizovanu pretpostavku ugla.
//
// opts: { startLat, startLon, endLat, endLon, sampleElev(lat,lon)->m|null,
//         params, maxIterations }
// Vraća: { ok, path:[{lat,lon,elev}], reason } — reason popunjen kad !ok.
function rdFindRoute(opts) {
  const {
    startLat, startLon, endLat, endLon, sampleElev, params,
    maxIterations = 4000
  } = opts;

  const elevStart = sampleElev(startLat, startLon);
  const elevEnd = sampleElev(endLat, endLon);
  if (elevStart == null || elevEnd == null) {
    return { ok: false, reason: 'DEM_MISSING', path: null };
  }

  const iPreferred = Math.max(0.1, params.nagibPreporuceni)/100;
  const nagibMax = params.nagibMax;
  const reachTol = 15;       // m — smatraj cilj dostignutim unutar ovog radijusa
  const stepMin = 12, stepMax = 60, chunkTarget = 40; // m — granice dužine jednog koraka pretrage
  const dedupCellM = 8;      // m — rezolucija zatvorenog skupa (sprječava eksploziju čvorova)

  // Lokalna ravninska projekcija (equirect. aprox.) SAMO za ključeve zatvorenog
  // skupa — stvarno kretanje i dalje ide preko prave geodezije (rdDestPoint).
  const lat0 = startLat, cosLat0 = Math.max(0.15, Math.cos(lat0*Math.PI/180));
  const keyFor = (lat, lon) => {
    const x = (lon-startLon)*111320*cosLat0;
    const y = (lat-startLat)*111320;
    return Math.round(x/dedupCellM) + ':' + Math.round(y/dedupCellM);
  };

  const startKey = keyFor(startLat, startLon);
  const nodes = new Map();  // key -> {lat,lon,elev,parentKey,g}
  nodes.set(startKey, { lat: startLat, lon: startLon, elev: elevStart, parentKey: null, g: 0 });

  const closed = new Set();
  const open = [];
  _rdHeapPush(open, { f: rdHaversine(startLat, startLon, endLat, endLon), key: startKey });

  const offsets = [0, 20, -20, 45, -45, 70, -70, 100, -100, 135, -135];

  let reachedKey = null;
  let iterations = 0;

  while (open.length && iterations++ < maxIterations) {
    const cur = _rdHeapPop(open);
    if (closed.has(cur.key)) continue;
    closed.add(cur.key);

    const node = nodes.get(cur.key);
    const dRemaining = rdHaversine(node.lat, node.lon, endLat, endLon);
    if (dRemaining <= reachTol) { reachedKey = cur.key; break; }
    if (node.g > params.duzinaMax) continue; // sigurnosna kočnica — predugo, odustani od ove grane

    const azToGoal = rdAzimuth(node.lat, node.lon, endLat, endLon);
    const dhRemaining = elevEnd - node.elev;
    const lNeeded = rdSestarKorak(dhRemaining, params.nagibPreporuceni);

    // Idealan ugao skretanja od direktnog pravca — geometrija šestarskog
    // koraka: hod dužine lNeeded pod uglom phi od direktnog pravca napravi
    // neto napredak dRemaining ka cilju ako je cos(phi) = dRemaining/lNeeded.
    // Kad lNeeded <= dRemaining, teren (uz preporučeni nagib) dozvoljava
    // gotovo direktan pravac — phi ≈ 0.
    let phi = 0;
    if (lNeeded > dRemaining && dRemaining > 0.5) {
      phi = Math.acos(Math.max(-1, Math.min(1, dRemaining/lNeeded))) * 180/Math.PI;
    }
    const stepLen = Math.max(stepMin, Math.min(stepMax, dRemaining <= reachTol*3 ? dRemaining : chunkTarget));

    for (const off of offsets) {
      // Kandidati su centrirani oko ±phi (šestarski ugao) uz direktan (0)
      // pravac kao rezervu ako teren ipak dozvoljava pravolinijski nastavak.
      const angle = off === 0 ? 0 : (off > 0 ? phi + off - 20 : -phi + off + 20);
      const az = (azToGoal + angle + 360) % 360;
      const L = Math.min(stepLen, dRemaining < reachTol ? dRemaining : stepLen);
      if (L < 1) continue;

      const cand = rdDestPoint(node.lat, node.lon, az, L);
      const candElev = sampleElev(cand.lat, cand.lon);
      if (candElev == null) continue; // van DEM pokrivenosti — preskoči pravac

      const slopePct = Math.abs(candElev - node.elev)/L*100;
      if (slopePct > nagibMax) continue; // TVRDO odbačen kandidat — nikad se ne prelazi max nagib

      let penalty = 1;
      if (slopePct > params.nagibPreporuceni*1.5) penalty = 3.5;
      else if (slopePct > params.nagibPreporuceni) penalty = 1.8;
      const angPenalty = 1 + Math.abs(off)/400; // blaga kazna za skretanje, da ne luta bez potrebe

      const candKey = keyFor(cand.lat, cand.lon);
      if (closed.has(candKey)) continue;
      const tentG = node.g + L*penalty*angPenalty;

      const existing = nodes.get(candKey);
      if (!existing || tentG < existing.g) {
        nodes.set(candKey, { lat: cand.lat, lon: cand.lon, elev: candElev, parentKey: cur.key, g: tentG });
        const f = tentG + rdHaversine(cand.lat, cand.lon, endLat, endLon);
        _rdHeapPush(open, { f, key: candKey });
      }
    }
  }

  if (!reachedKey) return { ok: false, reason: 'NO_ROUTE', path: null };

  const path = [];
  let k = reachedKey;
  while (k !== null) {
    const n = nodes.get(k);
    path.unshift({ lat: n.lat, lon: n.lon, elev: n.elev });
    k = n.parentKey;
  }
  // Posljednja tačka pretrage je unutar reachTol od B, ne tačno B — dodaj pravu
  // krajnju tačku da trasa doslovno završi na B (kratak, blag posljednji segment).
  const last = path[path.length-1];
  if (rdHaversine(last.lat, last.lon, endLat, endLon) > 0.5) {
    path.push({ lat: endLat, lon: endLon, elev: elevEnd });
  }
  return { ok: true, reason: null, path };
}

// ─── Validacija generisane trase (tačka 13 — osnovna verzija za Fazu 1) ───
// Vraća statistiku po segmentu + globalne min/max/prosjek, i nivo upozorenja
// (crveno/narandžasto/zeleno) po segmentu prema parametrima.
function rdValidateRoute(path, params) {
  const segments = [];
  let totalDist = 0, maxSlope = 0, slopeSum = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i-1], b = path[i];
    const d = rdHaversine(a.lat, a.lon, b.lat, b.lon);
    if (d < 0.01) continue;
    const slopePct = Math.abs(b.elev - a.elev)/d*100;
    const az = rdAzimuth(a.lat, a.lon, b.lat, b.lon);
    let level = 'ok';
    if (slopePct > params.nagibMax) level = 'bad';        // crveno — ne bi smjelo doći do ovoga (hard cutoff u pretrazi)
    else if (slopePct > params.nagibPreporuceni) level = 'warn'; // narandžasto — dozvoljeno, ali iznad preporučenog
    segments.push({ i, distM: d, slopePct, azimuthDeg: az, level, elevFrom: a.elev, elevTo: b.elev });
    totalDist += d;
    maxSlope = Math.max(maxSlope, slopePct);
    slopeSum += slopePct*d;
  }
  return {
    segments,
    totalDist,
    maxSlopePct: maxSlope,
    avgSlopePct: totalDist > 0 ? slopeSum/totalDist : 0,
    anyExceedsMax: segments.some(s => s.level === 'bad')
  };
}

// Node.js test okruženje (tests/js/road-design.test.js) — browser globals se
// ne diraju, isti obrazac kao offline-layer.js.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RD_DEFAULT_PARAMS, rdHaversine, rdAzimuth, rdDestPoint, rdSestarKorak, rdPreview, rdFindRoute, rdValidateRoute };
}
