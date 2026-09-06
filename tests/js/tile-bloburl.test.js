// =====================================================================
// Testovi za odgođeno revoke-ovanje blob URL-a u makeCachedTileLayer
// (v3.111.6). Pokretanje:  node tests/js/tile-bloburl.test.js
// ---------------------------------------------------------------------
// Prije ove izmjene, `URL.revokeObjectURL(u)` se zvao ODMAH na `img.onload` —
// razumno na prvi pogled (slika je "gotova"), ali Leaflet REUSE-uje <img>
// tile elemente (keepBuffer, zoom in pa out) i ostavlja ih u DOM-u van
// ekrana. Ako mobilni browser pod pritiskom memorije odluči da ponovo
// dekodira tu sliku (npr. poslije GPU compositor promocije), a blob URL je
// već revoke-ovan, dekodiranje puca — pločica ostaje TRAJNO slomljena dok se
// panom ne izađe iz keepBuffer opsega. Ovi testovi provjeravaju da
// `revokeObjectURL` NIKAD ne stigne prije `tileunload` (ili prije zamjene
// istog img-a NOVIM blob URL-om), izvlačeći STVARNI `makeCachedTileLayer`
// iz index.html, ne reimplementaciju.
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

const SRC = extractFn('makeCachedTileLayer');

let pass = 0, fail = 0;
// Testovi ovdje mutiraju STVARNE Node globals (global.URL/fetch/caches/document)
// jer je to ono što makeCachedTileLayer stvarno referencira. Za razliku od
// drugih test fajlova u ovom repou (gdje new Function(...) sandbox daje pravu
// izolaciju po testu), ovdje bi "sinhrono pokreni sve pa čekaj na kraju" obrazac
// (_async niz) značio da KASNIJI test svojim makeEnv() pozivom PREPIŠE globals
// dok je RANIJI test još u letu (mikrozadatak/setTimeout) — pogrešan test bi
// tiho "pao" jer njegov createObjectURL/revokeObjectURL poziv završi u TUĐEM
// closure-u. Zato testovi ovdje idu STROGO REDOM, svaki čeka svoj kraj prije
// sljedećeg (async niz testova ispod, ne t()+odgođeno čekanje).
const _tests = [];
function t(name, fn) { _tests.push({ name, fn }); }

// Minimalan L.TileLayer.extend() — samo dovoljno da makeCachedTileLayer
// konstruiše klasu i da test instancira objekat i pozove createTile direktno,
// bez stvarnog Leaflet-a (nedostupan u čistom Node okruženju).
function makeFakeL() {
  class FakeLayer {
    constructor(opts) { Object.assign(this, opts || {}); this._handlers = {}; }
    on(evt, fn) { (this._handlers[evt] = this._handlers[evt] || []).push(fn); }
    fire(evt, data) { (this._handlers[evt] || []).forEach(fn => fn(data)); }
  }
  return {
    TileLayer: {
      extend(proto) {
        class Extended extends FakeLayer {}
        Object.assign(Extended.prototype, proto);
        return Extended;
      }
    }
  };
}

// Minimalan <img>/document/caches/fetch mock. `revokes`/`created` bilježe
// svaki poziv radi provjere REDOSLIJEDA i BROJA revoke-a.
function makeEnv({ networkOk = true, cacheHit = null } = {}) {
  const revokes = [];
  const created = [];
  let nextId = 1;
  const blobStore = new Map();

  class FakeBlob { constructor(tag) { this.tag = tag; } }
  class FakeImg {
    constructor() { this._src = ''; this.alt = ''; this._onload = null; this._onerror = null; }
    set onload(fn) { this._onload = fn; }
    set onerror(fn) { this._onerror = fn; }
    set src(u) {
      this._src = u;
      // Simuliraj async decode: uspije ako je blob URL i dalje "živ" (nije revoke-ovan).
      setTimeout(() => {
        if (blobStore.has(u)) { if (this._onload) this._onload(); }
        else { if (this._onerror) this._onerror(); }
      }, 0);
    }
    get src() { return this._src; }
  }

  global.window = global; // kod provjerava `'caches' in window` — u Node-u nema window-a
  global.document = { createElement: (tag) => (tag === 'img' ? new FakeImg() : { getContext: () => ({}), toBlob: (cb) => cb(new FakeBlob('canvas')) }) };
  global.URL = {
    createObjectURL: (blob) => { const u = 'blob:' + (nextId++); blobStore.set(u, blob); created.push(u); return u; },
    revokeObjectURL: (u) => { revokes.push(u); blobStore.delete(u); },
  };
  global.AbortController = class { constructor() { this.signal = {}; } abort() {} };
  global.caches = {
    open: async () => ({
      match: async (u) => (cacheHit && u === cacheHit ? { blob: async () => new FakeBlob('cache:' + u) } : undefined),
      put: async () => {},
      delete: async () => {},
    }),
  };
  global.fetch = async (u) => {
    if (!networkOk) throw new Error('mreza pala');
    return { ok: true, clone: () => ({}), blob: async () => new FakeBlob('net:' + u) };
  };
  global.createImageBitmap = async () => ({});

  return { revokes, created, FakeImg };
}

function makeLayer(TILE_CACHE_NAME) {
  const L = makeFakeL();
  const fn = new Function('L', 'TILE_CACHE_NAME', SRC + '\nreturn makeCachedTileLayer;')(L, TILE_CACHE_NAME || 'test-cache');
  const Cls = fn('test-cache');
  const layer = new Cls();
  layer.getTileUrl = (c) => `https://x/${c.z}/${c.x}/${c.y}.png`;
  layer.getTileSize = () => ({ x: 256, y: 256 });
  layer._map = { on() {} };
  return layer;
}

console.log('Blob URL se NE revoke-uje prerano (samo na tileunload/zamjenu):');

t('mrežni uspjeh: onload NE revoke-uje blob odmah', async () => {
  const { revokes, created } = makeEnv({ networkOk: true });
  const layer = makeLayer();
  const img = await new Promise(res => layer.createTile({ z: 10, x: 1, y: 1 }, (err, tile) => res(tile)));
  await new Promise(r => setTimeout(r, 5)); // pusti onload mikro-tasak da odradi
  assert.strictEqual(created.length, 1, 'jedan blob URL kreiran');
  assert.strictEqual(revokes.length, 0, 'NIJEDAN revoke prije tileunload-a: ' + JSON.stringify(revokes));
});

t('keš pogodak: onload NE revoke-uje blob odmah', async () => {
  const cacheUrl = 'https://x/10/1/1.png';
  const { revokes, created } = makeEnv({ networkOk: false, cacheHit: cacheUrl });
  const layer = makeLayer();
  const img = await new Promise(res => layer.createTile({ z: 10, x: 1, y: 1 }, (err, tile) => res(tile)));
  await new Promise(r => setTimeout(r, 5));
  assert.strictEqual(created.length, 1);
  assert.strictEqual(revokes.length, 0);
});

t('tileunload REVOKE-UJE aktivni blob URL pločice', async () => {
  const { revokes, created } = makeEnv({ networkOk: true });
  const layer = makeLayer();
  const img = await new Promise(res => layer.createTile({ z: 10, x: 1, y: 1 }, (err, tile) => res(tile)));
  await new Promise(r => setTimeout(r, 5));
  assert.strictEqual(revokes.length, 0, 'prije unload-a još nema revoke-a');
  layer.fire('tileunload', { tile: img });
  assert.strictEqual(revokes.length, 1, 'tileunload mora revoke-ovati tačno jednom');
  assert.strictEqual(revokes[0], created[0]);
});

t('retry na istom img-u revoke-uje STARI blob prije dodjele NOVOG (ne curi memorija)', async () => {
  const { revokes, created } = makeEnv({ networkOk: true });
  const layer = makeLayer();
  const img = await new Promise(res => layer.createTile({ z: 10, x: 1, y: 1 }, (err, tile) => res(tile)));
  await new Promise(r => setTimeout(r, 5));
  assert.strictEqual(created.length, 1);
  assert.strictEqual(revokes.length, 0);
  // _retryEmpty poziva img._load(true) direktno na već postojećem elementu
  img._load(true);
  await new Promise(r => setTimeout(r, 15));
  assert.strictEqual(created.length, 2, 'drugi (retry) blob URL kreiran');
  assert.strictEqual(revokes.length, 1, 'PRVI blob URL mora biti revoke-ovan čim se dodijeli drugi — ne poslije tileunload-a');
  assert.strictEqual(revokes[0], created[0], 'revoke-ovan mora biti baš PRVI (stari), ne drugi (novi, još aktivan)');
});

(async () => {
  for (const { name, fn } of _tests) {
    try { await fn(); pass++; console.log('  ✔ ' + name); }
    catch (e) { fail++; console.log('  ✘ ' + name + '\n      ' + e.message); }
  }
  console.log('\n' + pass + ' prošlo, ' + fail + ' palo');
  process.exit(fail ? 1 : 0);
})();
