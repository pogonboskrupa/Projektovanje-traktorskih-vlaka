// =====================================================================
// Testovi za ODABIR VLAKE U LISTI (selI u index.html).
// Pokretanje:  node tests/js/vlake-list.test.js
// ---------------------------------------------------------------------
// Zašto ovaj test postoji: lista vlaka se crta SORTIRANO i hijerarhijski
// (rootVlake sort po _stdSortKey + renderWithChildren ubacuje krakove odmah
// ispod roditelja), dok je vlake[] redoslijed nastanka / dolaska sa servera.
// Ta dva redoslijeda se poklapaju samo slučajno.
//
// selI() je ranije tražio red po POZICIJI u DOM-u (`idx === i`), pa je kod
// svakog neslaganja označavao SUSJEDNU vlaku: korisnik vidi istaknuto "T1.1",
// a actI (i time Uredi/Briši/Dodaj tačku) radi nad "T1". Opasno, jer se briše
// nešto drugo od onoga što je istaknuto.
//
// Zato se ovdje ne testira reimplementacija nego STVARNI izvorni kod: selI se
// izvlači direktno iz index.html i pušta nad lažnim DOM-om.
//
// Invarijanta: označen red je UVIJEK onaj čiji data-vi == proslijeđeni indeks,
// bez obzira na redoslijed crtanja.
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
const SRC_SEL_I = extractFn('selI');

// ── Lažni DOM ────────────────────────────────────────────────────────
// Podržava samo ono što selI stvarno koristi: querySelectorAll za redove,
// querySelector po data-vi, classList.toggle i scrollIntoView.
function mkRow(vi, nm) {
  const cls = new Set();
  return {
    nm, vi,
    scrolled: false,
    classList: {
      toggle(c, on) { on ? cls.add(c) : cls.delete(c); },
      contains: c => cls.has(c),
      add: c => cls.add(c)
    },
    scrollIntoView() { this.scrolled = true; }
  };
}

// `rows` je redoslijed CRTANJA (DOM), ne redoslijed u vlake[]
function makeEnv(rows, { withDataVi = true } = {}) {
  const log = [];
  const doc = {
    querySelectorAll(sel) {
      if (/#vl \.vrow/.test(sel)) return withDataVi ? rows : [];
      return [];
    },
    querySelector(sel) {
      const m = sel.match(/data-vi="(\d+)"/);
      if (m && withDataVi) return rows.find(r => r.vi === Number(m[1])) || null;
      return null;
    },
    getElementById: () => null
  };
  const sandbox = {
    document: doc,
    vlake: rows.map(() => ({})),
    actI: null,
    rndList: () => log.push('rndList'),
    updOvl: () => log.push('updOvl'),
    _updFabVisibility: () => log.push('fab'),
    setTimeout: (fn) => { log.push('setTimeout'); fn(); },
    log
  };
  const keys = Object.keys(sandbox);
  const fn = new Function(...keys, SRC_SEL_I + '\nreturn { selI, getActI: () => actI };');
  const api = fn(...keys.map(k => sandbox[k]));
  return { ...api, rows, log };
}

// ── Testovi ──────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✔ ' + name); }
  catch (e) { fail++; console.log('  ✘ ' + name + '\n      ' + e.message); }
}
const actName = rows => (rows.find(r => r.classList.contains('act')) || {}).nm || '(nijedan)';

console.log('selI — označava red po vlake[] indeksu, ne po poziciji u DOM-u:');

t('DOM redoslijed ≠ niz: označi se prava vlaka', () => {
  // vlake[] = [T3, T1, T1.1, T2]  →  crta se sortirano: T1, T1.1, T2, T3
  const rows = [mkRow(1, 'T1'), mkRow(2, 'T1.1'), mkRow(3, 'T2'), mkRow(0, 'T3')];
  const env = makeEnv(rows);
  env.selI(1);                       // vlake[1] === 'T1'
  assert.strictEqual(actName(rows), 'T1');
});

t('krak sa kraja niza (uvezen kasnije) se ispravno označi', () => {
  const rows = [mkRow(1, 'T1'), mkRow(3, 'T1.1'), mkRow(0, 'T2'), mkRow(2, 'T3')];
  const env = makeEnv(rows);
  env.selI(3);
  assert.strictEqual(actName(rows), 'T1.1');
});

t('istovremeno je označen TAČNO jedan red', () => {
  const rows = [mkRow(2, 'T1'), mkRow(0, 'T2'), mkRow(1, 'T3')];
  const env = makeEnv(rows);
  env.selI(0);
  assert.strictEqual(rows.filter(r => r.classList.contains('act')).length, 1);
  env.selI(1);
  assert.strictEqual(rows.filter(r => r.classList.contains('act')).length, 1);
  assert.strictEqual(actName(rows), 'T3');
});

t('prethodni odabir se skida sa starog reda', () => {
  const rows = [mkRow(1, 'T1'), mkRow(0, 'T2')];
  const env = makeEnv(rows);
  env.selI(1);
  env.selI(0);
  assert.strictEqual(rows[0].classList.contains('act'), false, 'T1 mora izgubiti .act');
  assert.strictEqual(actName(rows), 'T2');
});

t('skrol ide na označeni red, ne na susjedni', () => {
  const rows = [mkRow(1, 'T1'), mkRow(2, 'T1.1'), mkRow(0, 'T2')];
  const env = makeEnv(rows);
  env.selI(0);
  assert.strictEqual(rows.filter(r => r.scrolled).map(r => r.nm).join(','), 'T2');
});

console.log('actI i rezervna putanja:');

t('actI se postavi bez obzira na to da li red postoji', () => {
  const rows = [mkRow(0, 'T1')];
  const env = makeEnv(rows);
  env.selI(0);
  assert.strictEqual(env.getActI(), 0);
});

t('red još nije nacrtan → rndList() pa skrol po data-vi', () => {
  const env = makeEnv([mkRow(0, 'T1')], { withDataVi: false });
  env.selI(0);
  assert.ok(env.log.includes('rndList'), 'mora ponovo nacrtati listu');
  assert.strictEqual(env.getActI(), 0);
});

t('updOvl se zove u obje putanje', () => {
  const a = makeEnv([mkRow(0, 'T1')]);              a.selI(0);
  const b = makeEnv([mkRow(0, 'T1')], { withDataVi: false }); b.selI(0);
  assert.ok(a.log.includes('updOvl') && b.log.includes('updOvl'));
});

console.log('\n' + pass + ' prošlo, ' + fail + ' palo');
process.exit(fail ? 1 : 0);
