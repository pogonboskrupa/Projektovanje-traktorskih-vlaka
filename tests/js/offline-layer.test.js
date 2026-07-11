// =====================================================================
// Testovi za offline sync sloj (_OL) — static/js/offline-layer.js
// Pokretanje:  node tests/js/offline-layer.test.js   (bez zavisnosti)
// ---------------------------------------------------------------------
// Ovo je istorijski najbuggavije mjesto aplikacije (dupli upisi, tihi
// gubici operacija, ts-kolizije) — svaki od ovih testova čuva ponašanje
// koje je nekad bilo pokvareno ili je lako pokvariti refaktorisanjem.
// =====================================================================
'use strict';
const assert = require('node:assert');

// ── Stubovi browser okruženja (prije require-a modula) ────────────────
const _store = new Map();
global.localStorage = {
  getItem: k => (_store.has(k) ? _store.get(k) : null),
  setItem: (k, v) => _store.set(k, String(v)),
  removeItem: k => _store.delete(k),
  clear: () => _store.clear()
};
let _toasts = [];
global.showToast = msg => _toasts.push(msg);

const { _OL, _genUUID } = require('../../static/js/offline-layer.js');

let _pass = 0, _fail = 0;
function test(name, fn) {
  _store.clear(); _toasts = []; _OL._seq = 0;
  try { fn(); _pass++; console.log('  ✓', name); }
  catch (e) { _fail++; console.error('  ✗', name, '\n    →', e.message); }
}

console.log('offline-layer.test.js\n');

// ── enqueue osnove ────────────────────────────────────────────────────
test('enqueue dodaje op sa _qid, ts i _uid=null (bez prijave)', () => {
  _OL.enqueue({ type: 'upsert_vlaka', payload: { nm: 'T1', korisnik_id: 'u1' } });
  const q = _OL.loadQueue();
  assert.equal(q.length, 1);
  assert.ok(q[0]._qid, '_qid mora postojati');
  assert.ok(q[0].ts > 0);
  assert.equal(q[0]._uid, null);
});

test('_qid jedinstven za dvije operacije u istoj milisekundi (D2-B)', () => {
  _OL.enqueue({ type: 'upsert_log', payload: { datum: 'a', korisnik_id: 'u1' } });
  _OL.enqueue({ type: 'upsert_log', payload: { datum: 'b', korisnik_id: 'u1' } });
  const q = _OL.loadQueue();
  assert.equal(q.length, 2);
  assert.notEqual(q[0]._qid, q[1]._qid, '_qid ne smije kolidirati ni u istoj ms');
});

// ── dedup pravila ─────────────────────────────────────────────────────
test('upsert_vlaka dedup: ista (nm, korisnik, projekt, id) — čuva samo zadnju', () => {
  _OL.enqueue({ type: 'upsert_vlaka', payload: { nm: 'T1', korisnik_id: 'u1', projekt_id: 'p1', pts: [1] } });
  _OL.enqueue({ type: 'upsert_vlaka', payload: { nm: 'T1', korisnik_id: 'u1', projekt_id: 'p1', pts: [1, 2] } });
  const q = _OL.loadQueue();
  assert.equal(q.length, 1);
  assert.equal(q[0].payload.pts.length, 2, 'mora ostati NOVIJA verzija');
});

test('upsert_vlaka dedup NE spaja isto ime iz različitih projekata', () => {
  _OL.enqueue({ type: 'upsert_vlaka', payload: { nm: 'T1', korisnik_id: 'u1', projekt_id: 'p1' } });
  _OL.enqueue({ type: 'upsert_vlaka', payload: { nm: 'T1', korisnik_id: 'u1', projekt_id: 'p2' } });
  assert.equal(_OL.loadQueue().length, 2, 'T1 iz p1 i T1 iz p2 su različite vlake');
});

test('upsert_labels dedup: samo zadnji set po korisniku', () => {
  _OL.enqueue({ type: 'upsert_labels', payload: [{ korisnik_id: 'u1', txt: 'a' }] });
  _OL.enqueue({ type: 'upsert_labels', payload: [{ korisnik_id: 'u1', txt: 'b' }] });
  _OL.enqueue({ type: 'upsert_labels', payload: [{ korisnik_id: 'u2', txt: 'c' }] });
  const q = _OL.loadQueue();
  assert.equal(q.length, 2);
  assert.equal(q.find(o => o.payload[0].korisnik_id === 'u1').payload[0].txt, 'b');
});

// ── klijentski ID (OS-S2, idempotentni retry) ────────────────────────
test('insert_projekt bez id dobija klijentski UUID; upsert_trag NE dobija', () => {
  _OL.enqueue({ type: 'insert_projekt', payload: { odjel: '70' } });
  _OL.enqueue({ type: 'upsert_trag', payload: { nm: 'Trag 1', korisnik_id: 'u1' } });
  const q = _OL.loadQueue();
  assert.match(q[0].payload.id, /^[0-9a-f-]{36}$/, 'insert_projekt mora dobiti UUID');
  assert.equal(q[1].payload.id, undefined, 'upsert_trag bira granu po id — ne smije ga dobiti');
});

// ── removeFromQueue / bumpRetry ───────────────────────────────────────
test('removeFromQueue briše TAČNO jednu operaciju po _qid', () => {
  _OL.enqueue({ type: 'upsert_log', payload: { datum: 'a', korisnik_id: 'u1' } });
  _OL.enqueue({ type: 'upsert_log', payload: { datum: 'b', korisnik_id: 'u1' } });
  const q = _OL.loadQueue();
  _OL.removeFromQueue(q[0]._qid);
  const after = _OL.loadQueue();
  assert.equal(after.length, 1);
  assert.equal(after[0].payload.datum, 'b');
});

test('bumpRetry: 4x false (op ostaje), 5. put true (op uklonjena)', () => {
  _OL.enqueue({ type: 'upsert_vlaka', payload: { nm: 'T1', korisnik_id: 'u1' } });
  const qid = _OL.loadQueue()[0]._qid;
  for (let i = 1; i <= 4; i++) {
    assert.equal(_OL.bumpRetry(qid, 5), false, `pokušaj ${i} ne smije odbaciti`);
    assert.equal(_OL.loadQueue().length, 1, 'op mora ostati u redu');
  }
  assert.equal(_OL.bumpRetry(qid, 5), true, '5. pokušaj mora odbaciti');
  assert.equal(_OL.loadQueue().length, 0);
});

test('bumpRetry za nepostojeći ključ vraća false i ne dira red', () => {
  _OL.enqueue({ type: 'upsert_vlaka', payload: { nm: 'T1', korisnik_id: 'u1' } });
  assert.equal(_OL.bumpRetry('nema-me', 5), false);
  assert.equal(_OL.loadQueue().length, 1);
});

// ── kapacitet i korupcija ─────────────────────────────────────────────
test('red ograničen na 500 — najstarije ispadaju uz upozorenje', () => {
  for (let i = 0; i < 501; i++) {
    _OL.enqueue({ type: 'upsert_log', payload: { datum: 'd' + i, korisnik_id: 'u1' } });
  }
  const q = _OL.loadQueue();
  assert.equal(q.length, 500);
  assert.equal(q[0].payload.datum, 'd1', 'najstarija (d0) mora ispasti');
  assert.ok(_toasts.some(t => t.includes('prepun')), 'korisnik mora vidjeti upozorenje');
});

test('korumpiran JSON u redu/kešu ne ruši ništa — vraća prazno/null', () => {
  localStorage.setItem(_OL.QUEUE, '{nevalidno');
  localStorage.setItem(_OL.VLAKE, '[takođe nevalidno');
  assert.deepEqual(_OL.loadQueue(), []);
  assert.equal(_OL.load(_OL.VLAKE), null);
  _OL.enqueue({ type: 'upsert_vlaka', payload: { nm: 'T1', korisnik_id: 'u1' } });
  assert.equal(_OL.loadQueue().length, 1, 'enqueue mora raditi preko korumpiranog stanja');
});

test('save/load roundtrip čuva strukturu podataka', () => {
  const rows = [{ nm: 'T1', pts: [{ la: 44.1, lo: 16.2 }] }];
  _OL.save(_OL.VLAKE, rows);
  assert.deepEqual(_OL.load(_OL.VLAKE), rows);
});

// ── _genUUID fallback ─────────────────────────────────────────────────
test('_genUUID vraća v4 format i bez crypto.randomUUID (stari WebView)', () => {
  const u1 = _genUUID();
  assert.match(u1, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  // global.crypto je getter-only u Node-u — ukloni samo randomUUID metodu
  const saved = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(crypto), 'randomUUID');
  Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
  try {
    const u2 = _genUUID();
    assert.match(u2, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(u2, _genUUID());
  } finally { delete crypto.randomUUID; }
});

console.log(`\n${_pass} prošlo, ${_fail} palo`);
process.exit(_fail ? 1 : 0);
