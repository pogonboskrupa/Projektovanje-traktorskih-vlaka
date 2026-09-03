// =====================================================================
// Testovi za OBNOVU PODATAKA PRI POKRETANJU (_startupRestore / switchTab).
// Pokretanje:  node tests/js/startup-restore.test.js
// ---------------------------------------------------------------------
// Zašto ovaj test postoji: offline-first ulaz (v3.100.0) zove showApp() ODMAH
// kad postoji keširani profil — dakle dok se tijelo dokumenta JOŠ PARSIRA.
// Skripta se izvršava do ~33857. linije, a #mjtrg-panel je u markupu tek na
// ~35138. switchTab('karta') je taj element čitao BEZ provjere postojanja, pa
// je bacao TypeError, a showApp() nije imao try/catch — sve poslije te linije
// se preskakalo:
//     loadProj, sbInitData, _processOfflineQueue, sqlmapRestoreAll,
//     geojsonOdjeliRestore, _tragRegLoad, _msrRegLoad, _refRepoLoad,
//     _restoreTacke, _restoreFotos, _localKmlRestore, _kmlcInit, _temRestore
// Korisnik je to vidio kao "ponekad ne mogu aktivirati učitane karte": karte su
// uredno na uređaju, ali ih niko nikad nije pokupio. Izmjereno nad stvarnim
// pokretanjem: stari kod obnovi 0 sačuvanih KML slojeva, novi 1.
//
// Testira se STVARNI izvorni kod — _startupRestore i switchTab se izvlače
// direktno iz index.html.
//
// Invarijante:
//   1. switchTab NIKAD ne baca kad neki panel još ne postoji u DOM-u.
//   2. _startupRestore čeka DOMContentLoaded ako dokument još nije gotov.
//   3. Pad jednog koraka NE smije spriječiti ostale.
//   4. Dvostruki poziv obnavlja samo jednom.
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

const SRC_STARTUP = extractFn('_startupRestore');
const SRC_SWITCH  = extractFn('switchTab');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✔ ' + name); }
  catch (e) { fail++; console.log('  ✘ ' + name + '\n      ' + e.message); }
}

// ── Okruženje za _startupRestore ─────────────────────────────────────
// `postojeci` = elementi koji VEĆ postoje u DOM-u; ostali vraćaju null,
// kao dok se dokument još parsira.
function makeEnv({ readyState = 'complete', pucaju = [] } = {}) {
  const log = [];
  const dcl = [];
  const step = n => () => { log.push(n); if (pucaju.includes(n)) throw new Error('pad u ' + n); };
  const sandbox = {
    document: {
      readyState,
      addEventListener: (ev, fn) => { if (ev === 'DOMContentLoaded') dcl.push(fn); },
      getElementById: () => null
    },
    console: { warn: (...a) => log.push('warn:' + a[0]) },
    navigator: { onLine: true, storage: null },
    setTimeout: (fn) => { fn(); },
    sbUser: { id: 'u1' }, sbProfile: { ime: 'T' }, _tragRegistry: [],
    switchTab: step('switchTab'), loadProj: step('loadProj'), sbInitData: step('sbInitData'),
    _processOfflineQueue: step('queue'), sqlmapRestoreAll: step('sqlmapRestore'),
    geojsonOdjeliRestore: step('geojsonOdjeli'), _tragRegLoad: step('tragReg'),
    sbFlushTrag: () => {}, _msrRegLoad: step('msrReg'), _refRepoLoad: step('refRepo'),
    _restoreTacke: step('tacke'), _restoreFotos: step('fotos'),
    _localKmlRestore: step('localKml'), _kmlcInit: step('kmlcInit'),
    _temRestore: step('temRestore'), isVodeci: () => false, showProjectManagement: () => {},
  };
  const keys = Object.keys(sandbox);
  const api = new Function(...keys, SRC_STARTUP + '\nreturn { _startupRestore };')(...keys.map(k => sandbox[k]));
  return { run: api._startupRestore, log, dcl,
           docReady: () => { sandbox.document.readyState = 'interactive'; } };
}

const SVI = ['switchTab','loadProj','sbInitData','queue','sqlmapRestore','geojsonOdjeli',
             'tragReg','msrReg','refRepo','tacke','fotos','localKml','kmlcInit','temRestore'];

console.log('_startupRestore — svi koraci obnove se izvrše:');

t('dokument gotov → svih 14 koraka odmah', () => {
  const e = makeEnv();
  e.run();
  assert.deepStrictEqual(e.log.filter(x => !x.startsWith('warn:')), SVI);
});

t('dokument se još parsira → čeka DOMContentLoaded, ne radi ništa prije', () => {
  const e = makeEnv({ readyState: 'loading' });
  e.run();
  assert.deepStrictEqual(e.log, [], 'ništa se ne smije izvršiti dok dokument nije gotov');
  assert.strictEqual(e.dcl.length, 1, 'mora se zakačiti na DOMContentLoaded');
  e.docReady();                                 // browser prvo mijenja readyState…
  e.dcl[0]();                                   // …pa okine DOMContentLoaded
  assert.deepStrictEqual(e.log.filter(x => !x.startsWith('warn:')), SVI);
});

console.log('Pad jednog koraka ne obara ostale:');

t('switchTab puca (nedostaje panel) → obnove svejedno prolaze', () => {
  // Tačno stari scenarij: TypeError u switchTab je ranije preskočio SVE ispod.
  const e = makeEnv({ pucaju: ['switchTab'] });
  e.run();
  const izvrseni = e.log.filter(x => !x.startsWith('warn:'));
  assert.ok(izvrseni.includes('sqlmapRestore'), 'offline karte se MORAJU obnoviti');
  assert.ok(izvrseni.includes('localKml'), 'KML slojevi se MORAJU obnoviti');
  assert.deepStrictEqual(izvrseni, SVI);
});

t('pad usred niza ne prekida ostatak', () => {
  const e = makeEnv({ pucaju: ['sqlmapRestore', 'tacke'] });
  e.run();
  assert.deepStrictEqual(e.log.filter(x => !x.startsWith('warn:')), SVI);
});

t('svaki pad se zabilježi u konzolu', () => {
  const e = makeEnv({ pucaju: ['localKml'] });
  e.run();
  assert.ok(e.log.some(x => x === 'warn:startup:localKml'), 'pad mora ostaviti trag');
});

console.log('Idempotentnost:');

t('dvostruki poziv obnavlja samo jednom', () => {
  const e = makeEnv();
  e.run(); const prvi = e.log.length;
  e.run();
  assert.strictEqual(e.log.length, prvi, 'drugi poziv ne smije ponoviti obnovu');
});

console.log('switchTab — nedostajući paneli:');

t('ne baca kad NIJEDAN panel još ne postoji u DOM-u', () => {
  const log = [];
  const el = () => ({ style: {}, classList: { toggle(){}, add(){}, remove(){} } });
  const sandbox = {
    document: {
      getElementById: () => null,               // ništa još nije isparsirano
      querySelectorAll: () => [],
    },
    _activeTab: null, map: { invalidateSize(){} }, setTimeout: fn => fn(),
    dozCancelDraw(){}, _dozGpsOn: false, showToast(){}, _guideOn: false, _guideCancel(){},
    _msrOn: false, msrStop(){}, adminLoadUsers(){}, postavkeLoadEmails(){},
    terenRender(){}, terenRenderTragovi(){}, _tragoviRender(){}, _tragoviUpdBtn(){},
    _updFabVisibility(){}, _mapFullScreen: false, _setMapUIVisible(){},
    _notifClear(){}, _reloadCoreData(){}, vlake: [], _projekti: [],
    updProjStats(){}, rndLog(){}, rndKolege(){}, rndKolegeVlakeList(){}, _rndBojaPresets(){},
    dozInit(){}, msrActivateIfNeeded(){}, _tragRegRender(){}, _demLegendUpdate(){},
  };
  const keys = Object.keys(sandbox);
  const api = new Function(...keys, SRC_SWITCH + '\nreturn { switchTab };')(...keys.map(k => sandbox[k]));
  api.switchTab('karta');   // ranije: TypeError na pmjtrg.style
  api.switchTab('vlake');
  api.switchTab('doznaka');
});

console.log('\n' + pass + ' prošlo, ' + fail + ' palo');
process.exit(fail ? 1 : 0);
