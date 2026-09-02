// =====================================================================
// Testovi za KLIK NA UVEZENI KML/SHP SLOJ (_kmlHitTest u index.html).
// Pokretanje:  node tests/js/kml-click.test.js
// ---------------------------------------------------------------------
// Zašto ovaj test postoji: karta radi u canvas modu (preferCanvas:true), a
// svaki Leaflet canvas renderer je JEDAN <canvas> preko cijele karte koji sam
// hvata DOM klik. Uvezeni KML crta se u podrazumijevanom canvas-u (overlayPane,
// z-index 400), a vlake u svom (pane 'vlakeLines', TAKOĐE 400 ali kasnije u
// DOM-u = iznad). Čim postoji makar jedna vlaka, gornji canvas pokupi SVAKI
// klik na karti — bez obzira gdje je vlaka nacrtana — pa `layer.on('click')`
// na KML sloju nikad ne opali i uvezeni KML izgleda "mrtav".
//
// Rješenje je fallback u map.on('click') koji sam provjeri KML slojeve
// (_kmlHitTest). Ovdje se testira STVARNI izvorni kod: _kmlHitTest i
// _kmlRingDistPx se izvlače direktno iz index.html i puštaju nad lažnom
// (mock) Leaflet mapom sa jednostavnom, predvidivom projekcijom.
//
// Invarijante koje testovi čuvaju:
//   1. Klik unutar uvezenog poligona ga pronađe (i kad je canvas "pokraden").
//   2. Tačka i linija se pogode u razumnoj toleranciji za prst na telefonu.
//   3. Sakriven sloj (vis:false ili skinut s karte) se NE hvata.
//   4. `onlyPolygons` (odabir odjela u doznaci) ignoriše linije i tačke.
//   5. Kasnije uvezen sloj ima prednost (isto kao redoslijed crtanja).
//   6. Ugniježđeni SHP slojevi (featureGroup → geoJSON grupa → path) se nađu.
// =====================================================================
'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');

function extractFn(name) {
  const start = HTML.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'nije nađena funkcija ' + name + ' u index.html');
  let i = HTML.indexOf('{', start), depth = 0;
  for (; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') { depth--; if (depth === 0) return HTML.slice(start, i + 1); }
  }
  throw new Error('nezatvorena funkcija ' + name);
}

const SRC_HIT  = extractFn('_kmlHitTest');
const SRC_RING = extractFn('_kmlRingDistPx');
const SRC_SEG  = extractFn('_distToSegPx');

// ── Lažni Leaflet/mapa ───────────────────────────────────────────────
// Projekcija: 1 stepen = 10000 px u oba smjera, y raste prema jugu. Time su
// piksel-tolerancije iz koda (20/16/12 px) lako izrazive u stepenima:
// 20 px = 0.002°.
const PX_PER_DEG = 10000;
const pt = (x, y) => ({
  x, y,
  distanceTo(o) { return Math.hypot(this.x - o.x, this.y - o.y); }
});
const proj = ll => pt(ll.lng * PX_PER_DEG, -ll.lat * PX_PER_DEG);

function latLng(lat, lng) {
  return { lat, lng };
}

// Minimalni "sloj" — dovoljno API-ja koliko ga _kmlHitTest stvarno koristi.
function mkPolygon(ring, name, extra = {}) {
  return {
    _kmlIsPolygon: true, _kmlName: name, ...extra,
    getLatLngs: () => [ring.map(([la, lo]) => latLng(la, lo))],
    getBounds() {
      const las = ring.map(r => r[0]), los = ring.map(r => r[1]);
      return mkBounds(Math.min(...las), Math.min(...los), Math.max(...las), Math.max(...los));
    },
    // Ista semantika kao Leafletov Polygon._containsPoint: ray-cast u layer px.
    _containsPoint(p) {
      const ring2 = ring.map(([la, lo]) => proj(latLng(la, lo)));
      let inside = false;
      for (let i = 0, j = ring2.length - 1; i < ring2.length; j = i++) {
        const a = ring2[i], b = ring2[j];
        if ((a.y > p.y) !== (b.y > p.y) &&
            p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
      }
      return inside;
    }
  };
}

function mkBounds(s, w, n, e) {
  return {
    contains: ll => ll.lat >= s && ll.lat <= n && ll.lng >= w && ll.lng <= e,
    pad(r) {
      const dy = (n - s) * r, dx = (e - w) * r;
      return mkBounds(s - dy, w - dx, n + dy, e + dx);
    }
  };
}

function mkLine(pts, name) {
  return {
    _kmlName: name,
    getLatLngs: () => pts.map(([la, lo]) => latLng(la, lo))
  };
}

function mkPoint(la, lo, name) {
  return { _kmlIsPoint: true, _kmlName: name, getLatLng: () => latLng(la, lo) };
}

function mkGroup(layers) {
  return {
    _layers: layers,
    eachLayer(fn) { layers.forEach(fn); }
  };
}

// Pokreni _kmlHitTest nad zadanim kmlLs
function hit(kmlLs, lat, lng, onlyPolygons, onMap = () => true) {
  const map = {
    latLngToLayerPoint: proj,
    latLngToContainerPoint: proj,
    hasLayer: onMap
  };
  const fn = new Function('map', 'kmlLs', 'L',
    SRC_SEG + '\n' + SRC_RING + '\n' + SRC_HIT + '\n' +
    'return _kmlHitTest(arguments[3], arguments[4]);');
  return fn(map, kmlLs, {}, latLng(lat, lng), onlyPolygons);
}

// ── Testovi ──────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✔ ' + name); }
  catch (e) { fail++; console.log('  ✘ ' + name + '\n      ' + e.message); }
}

// Kvadrat 44.10–44.11 / 16.10–16.11
const RING = [[44.10, 16.10], [44.10, 16.11], [44.11, 16.11], [44.11, 16.10], [44.10, 16.10]];
const mkLayer = (layers, over = {}) => ({ grp: mkGroup(layers), vis: true, ...over });

console.log('_kmlHitTest — uvezeni KML se mora moći kliknuti:');

t('klik unutar poligona ga pronađe', () => {
  const l = hit([mkLayer([mkPolygon(RING, 'Odjel 12')])], 44.105, 16.105);
  assert.strictEqual(l && l._kmlName, 'Odjel 12');
});

t('klik izvan poligona ne pronađe ništa', () => {
  assert.strictEqual(hit([mkLayer([mkPolygon(RING, 'Odjel 12')])], 44.090, 16.105), null);
});

t('tačka se pogađa u toleranciji (16 px = 0.0016°)', () => {
  const ls = [mkLayer([mkPoint(44.105, 16.105, 'T1')])];
  assert.strictEqual(hit(ls, 44.1051, 16.1051)?._kmlName, 'T1', 'blizu — mora pogoditi');
  assert.strictEqual(hit(ls, 44.108, 16.108), null, 'daleko — ne smije pogoditi');
});

t('linija se pogađa u toleranciji (20 px = 0.002°)', () => {
  const ls = [mkLayer([mkLine([[44.105, 16.100], [44.105, 16.110]], 'Linija A')])];
  assert.strictEqual(hit(ls, 44.1051, 16.105)?._kmlName, 'Linija A', 'blizu linije');
  assert.strictEqual(hit(ls, 44.109, 16.105), null, 'daleko od linije');
});

t('tačka ima prednost nad poligonom u kojem leži', () => {
  const ls = [mkLayer([mkPolygon(RING, 'Odjel 12'), mkPoint(44.105, 16.105, 'T1')])];
  assert.strictEqual(hit(ls, 44.105, 16.105)?._kmlName, 'T1');
});

t('linija ima prednost nad poligonom u kojem leži', () => {
  const ls = [mkLayer([mkPolygon(RING, 'Odjel 12'), mkLine([[44.105, 16.100], [44.105, 16.110]], 'L')])];
  assert.strictEqual(hit(ls, 44.105, 16.105)?._kmlName, 'L');
});

console.log('Vidljivost sloja:');

t('sloj sa vis:false se ne hvata', () => {
  assert.strictEqual(hit([mkLayer([mkPolygon(RING, 'Odjel 12')], { vis: false })], 44.105, 16.105), null);
});

t('sloj koji nije na karti se ne hvata', () => {
  assert.strictEqual(hit([mkLayer([mkPolygon(RING, 'Odjel 12')])], 44.105, 16.105, false, () => false), null);
});

t('placeholder sloj (grp:null, nije preuzet) ne ruši hit-test', () => {
  const ls = [{ grp: null, vis: true }, mkLayer([mkPolygon(RING, 'Odjel 12')])];
  assert.strictEqual(hit(ls, 44.105, 16.105)?._kmlName, 'Odjel 12');
});

console.log('Doznaka — odabir odjela (onlyPolygons):');

t('onlyPolygons ignoriše tačke i linije', () => {
  const ls = [mkLayer([
    mkPolygon(RING, 'Odjel 12'),
    mkPoint(44.105, 16.105, 'T1'),
    mkLine([[44.105, 16.100], [44.105, 16.110]], 'L')
  ])];
  assert.strictEqual(hit(ls, 44.105, 16.105, true)?._kmlName, 'Odjel 12');
});

t('onlyPolygons bez poligona pod prstom vraća null', () => {
  const ls = [mkLayer([mkPoint(44.105, 16.105, 'T1')])];
  assert.strictEqual(hit(ls, 44.105, 16.105, true), null);
});

console.log('Redoslijed i ugniježđeni (SHP) slojevi:');

t('kasnije uvezen sloj ima prednost', () => {
  const ls = [mkLayer([mkPolygon(RING, 'Stari')]), mkLayer([mkPolygon(RING, 'Novi')])];
  assert.strictEqual(hit(ls, 44.105, 16.105)?._kmlName, 'Novi');
});

t('SHP: featureGroup → geoJSON grupa → path se pronađe', () => {
  // Ugniježđeno kao u _loadOneShp: grupa BEZ _kmlName sadrži prave geometrije.
  const inner = mkGroup([mkPolygon(RING, 'Odsjek 3a')]);
  const ls = [{ grp: mkGroup([inner]), vis: true }];
  assert.strictEqual(hit(ls, 44.105, 16.105)?._kmlName, 'Odsjek 3a');
});

t('prazan kmlLs ne ruši ništa', () => {
  assert.strictEqual(hit([], 44.105, 16.105), null);
});

console.log('\n' + pass + ' prošlo, ' + fail + ' palo');
process.exit(fail ? 1 : 0);
