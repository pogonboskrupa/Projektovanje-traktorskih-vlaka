// =====================================================================
// Testovi za OFFLINE-FIRST ulazak u aplikaciju (initAuth u index.html).
// Pokretanje:  node tests/js/auth-offline-first.test.js
// ---------------------------------------------------------------------
// Zašto ovaj test postoji: ovo je najviše puta prijavljeni bug s terena —
// login ekran se pojavi korisniku koji je uredno prijavljen, na slabom ili
// nikakvom signalu. Uzrok je uvijek bio isti oblik greške: startup logika
// je ČEKALA mrežu da odluči šta prikazati, a na slaboj vezi mrežni poziv ne
// padne nego VISI. Zato se ovdje ne testira reimplementacija nego STVARNI
// izvorni kod: initAuth i _upgradeToOnlineSession se izvlače direktno iz
// index.html i izvršavaju nad lažnim (mock) okruženjem.
//
// Ključna invarijanta koju svi testovi čuvaju:
//   Ako postoji keširani profil, korisnik ulazi u app ODMAH i NIJEDNA
//   kasnija mrežna putanja ne smije podići login ekran preko njega.
// =====================================================================
'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');

// ── Izvuci funkciju iz index.html po imenu (brace matching) ───────────
function extractFn(name) {
  const start = HTML.indexOf('async function ' + name + '(');
  assert.ok(start >= 0, 'nije nađena funkcija ' + name + ' u index.html');
  let i = HTML.indexOf('{', start), depth = 0;
  for (; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') { depth--; if (depth === 0) return HTML.slice(start, i + 1); }
  }
  throw new Error('nezatvorena funkcija ' + name);
}

const SRC_INIT_AUTH = extractFn('initAuth');
const SRC_UPGRADE   = extractFn('_upgradeToOnlineSession');
const SRC_SHOW_APP  = extractFn('showApp');

// _revealApp nije async — izvuci ga posebno
function extractPlainFn(name) {
  const start = HTML.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'nije nađena funkcija ' + name);
  let i = HTML.indexOf('{', start), depth = 0;
  for (; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') { depth--; if (depth === 0) return HTML.slice(start, i + 1); }
  }
  throw new Error('nezatvorena funkcija ' + name);
}
const SRC_REVEAL = extractPlainFn('_revealApp');

// ── Mock okruženje ────────────────────────────────────────────────────
// Vraća { run, adv, log, state } — `run` pokreće initAuth, `adv` pomjera
// lažne tajmere, `log` bilježi šta je pozvano.
function makeEnv({ cached = null, saved = null, online = true, sb = null } = {}) {
  const log = [];
  const timers = [];
  let profileAfterLoad = null;   // šta server "vrati" pri sbLoadProfile u nadogradnji
  let __setProfile = () => {};
  const state = { sbUser: null, sbProfile: null, offlineMode: null, appEntered: false };

  const env = {
    _OL: { PROFILE: 'p', load: () => cached },
    _loadSavedUser: () => saved,
    navigator: { onLine: online },
    console: { error: () => {}, warn: () => {}, log: () => {} },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },

    __log: (m) => log.push(m),
    showToast: (t) => log.push('toast:' + t),
    _showAuthScreen: () => log.push('AUTH_SCREEN'),
    authShowPending: () => log.push('PENDING'),
    sbLoadProfile: async () => { log.push('sbLoadProfile'); if (profileAfterLoad) __setProfile(profileAfterLoad); },
    sbStartRealtime: () => log.push('sbStartRealtime'),
    _reloadCoreData: () => log.push('_reloadCoreData'),
    _processOfflineQueue: () => log.push('_processOfflineQueue'),
    _isOfflineMode: false,
    _appEntered: false,
    sb,
  };

  // Sandbox: globalne koje kod MIJENJA (sbUser, sbProfile, _appEntered,
  // _isOfflineMode) moraju živjeti UNUTAR sandboxa kao let — inače im dodjela
  // iz izvučenog koda ne bi bila vidljiva. showApp i _setOfflineMode se isto
  // definišu unutar, jer u pravoj aplikaciji baš one postavljaju _appEntered i
  // _isOfflineMode; mock im služi samo za bilježenje poziva.
  const params = Object.keys(env).filter(k => !['_appEntered', '_isOfflineMode'].includes(k));
  const factory = new Function(
    params.join(','),
    `let sbUser = null, sbProfile = null, _appEntered = false, _isOfflineMode = false;
     function showApp() { _appEntered = true; __log('showApp'); }
     function _setOfflineMode(v) { _isOfflineMode = v; __log('offlineMode:' + v); }
     ${SRC_UPGRADE}
     ${SRC_INIT_AUTH}
     return { initAuth, setProfile: (p) => { sbProfile = p; },
              snapshot: () => ({ sbUser, sbProfile, _appEntered, _isOfflineMode }) };`
  );
  const api = factory(...params.map(k => env[k]));

  __setProfile = api.setProfile;

  return {
    log,
    state,
    snapshot: api.snapshot,
    __setProfileAfterLoad: (p) => { profileAfterLoad = p; },
    run: () => api.initAuth(),
    // Pokreni sve zakazane tajmere do zadanog vremena. NAMJERNO bez await na
    // callback: u scenariju slabog signala taj callback ostaje zauvijek visiti
    // (upravo to i testiramo) — await bi zaglavio sam test. Umjesto toga
    // pustimo mikrotaskove da se slegnu i onda gledamo šta je log zabilježio.
    adv: async (untilMs) => {
      timers.filter(t => t.ms <= untilMs).forEach(t => { try { t.fn(); } catch(e) {} });
      await new Promise(r => setImmediate(r));
      await new Promise(r => setImmediate(r));
    },
  };
}

const CACHED = { id: 'u1', email: 'u1@x.com', ime: 'Test', prezime: 'Korisnik' };

let _pass = 0, _fail = 0;
async function test(name, fn) {
  try { await fn(); _pass++; console.log('  ✓', name); }
  catch (e) { _fail++; console.error('  ✗', name, '\n    →', e.message); }
}

(async () => {
console.log('auth-offline-first.test.js\n');

// ── 1. Keširan profil + STVARNO offline ────────────────────────────────
await test('Keširan profil + offline → app ODMAH, bez login ekrana', async () => {
  const env = makeEnv({ cached: CACHED, online: false, sb: {} });
  await env.run();
  assert.ok(env.log.includes('showApp'), 'showApp mora biti pozvan odmah');
  assert.ok(!env.log.includes('AUTH_SCREEN'), 'login ekran se NE smije prikazati');
  assert.ok(env.log.includes('offlineMode:true'), 'offline oznaka mora biti upaljena');
  assert.equal(env.snapshot().sbProfile.id, 'u1', 'profil se preuzima iz keša');
});

// ── 2. NAJVAŽNIJI SLUČAJ: navigator.onLine laže 'true', mreža visi ─────
// Ovo je tačan scenario prijavljen s terena (slab signal): svaki mrežni
// poziv ostaje neriješen zauvijek. Korisnik SVEJEDNO mora ući odmah.
await test('Slab signal (onLine laže true, svi pozivi VISE) → app ODMAH, login se nikad ne pojavi', async () => {
  const hang = () => new Promise(() => {});           // nikad se ne riješi
  const env = makeEnv({
    cached: CACHED, saved: { ime: 'Test', prezime: 'Korisnik', pin: '1234' }, online: true,
    sb: {
      auth: { onAuthStateChange: () => {}, signInWithPassword: hang, getUser: hang },
      rpc: hang,
    },
  });
  await env.run();
  assert.ok(env.log.includes('showApp'), 'app mora biti otvoren ODMAH, bez čekanja mreže');
  const idxShowApp = env.log.indexOf('showApp');
  assert.ok(idxShowApp >= 0 && idxShowApp <= 2, 'showApp mora biti među PRVIM potezima, ne poslije mrežnih pokušaja');

  // Pusti sve tajmere (800ms auto-login, 4500ms fallback) — i dalje ništa ne smije
  // podići login ekran preko korisnika koji već radi.
  await env.adv(5000);
  assert.ok(!env.log.includes('AUTH_SCREEN'), 'login ekran se NE smije pojaviti ni poslije isteka svih fallback tajmera');
});

// ── 3. Stvarno online: tiha nadogradnja na punu sesiju ────────────────
await test('Ima signala → poslije trenutnog ulaska tiho se nadogradi na pravu sesiju (bez drugog showApp)', async () => {
  let authCb = null;
  const env = makeEnv({
    cached: CACHED, online: true,
    sb: { auth: { onAuthStateChange: (cb) => { authCb = cb; } } },
  });
  await env.run();
  assert.ok(env.log.includes('showApp'), 'app se otvara odmah iz keša');
  assert.ok(typeof authCb === 'function', 'onAuthStateChange mora biti registrovan kad ima (navodno) mreže');

  // Supabase potvrdi stvarnu sesiju
  await authCb('INITIAL_SESSION', { user: { id: 'u1', email: 'u1@x.com' } });

  assert.equal(env.log.filter(x => x === 'showApp').length, 1,
    'showApp NE smije biti pozvan drugi put (dupli restore slojeva karte)');
  assert.ok(env.log.includes('_reloadCoreData'), 'poslije nadogradnje moraju se povući svježi podaci');
  assert.ok(env.log.includes('_processOfflineQueue'), 'red čekanja mora biti poslan na server');
  assert.ok(env.log.includes('sbStartRealtime'), 'realtime kanali se moraju uključiti');
  assert.equal(env.snapshot().sbUser.id, 'u1');
  assert.ok(!env.snapshot().sbUser._cachedStub, 'sbUser više ne smije biti keš-zamjena nego prava sesija');
});

// ── 4. Bez keširanog profila — login je jedina opcija ─────────────────
await test('Nema keširanog profila → login ekran (nema se na šta osloniti)', async () => {
  const env = makeEnv({ cached: null, online: true, sb: { auth: { onAuthStateChange: () => {} } } });
  await env.run();
  assert.ok(env.log.includes('AUTH_SCREEN'), 'bez keša mora tražiti prijavu');
  assert.ok(!env.log.includes('showApp'), 'bez keša NE smije otvoriti app');
});

// ── 5. Regresija: Supabase klijent uopšte ne postoji ──────────────────
await test('Keširan profil + Supabase klijent nedostupan → app ODMAH (ne login)', async () => {
  const env = makeEnv({ cached: CACHED, online: true, sb: null });
  await env.run();
  assert.ok(env.log.includes('showApp'), 'keš mora pustiti korisnika u app i bez Supabase klijenta');
  assert.ok(!env.log.includes('AUTH_SCREEN'), 'login ekran se NE smije prikazati');
});

// ── 6. Opoziv pristupa otkriven tek pri online nadogradnji ───────────
await test('Pristup opozvan dok se radilo offline → nadogradnja ga uhvati (pending ekran)', async () => {
  let authCb = null;
  const env = makeEnv({
    cached: CACHED, online: true,
    sb: { auth: { onAuthStateChange: (cb) => { authCb = cb; } } },
  });
  // Server pri nadogradnji javi da korisnik VIŠE nije odobren
  env.__setProfileAfterLoad({ id: 'u1', odobren: false, is_admin: false });
  await env.run();
  await authCb('INITIAL_SESSION', { user: { id: 'u1' } });
  assert.ok(env.log.includes('AUTH_SCREEN') && env.log.includes('PENDING'),
    'opozvan pristup mora odmah završiti na ekranu "čeka se odobrenje"');
  assert.ok(!env.log.includes('_reloadCoreData'),
    'opozvanom korisniku se NE smiju povlačiti podaci sa servera');
});

// ── 7. Logo se NE smije zadržati na ekranu poslije uspješne prijave ──
// Prijavljeno: "ne smije se pokazivati slika poslije logovanja". showApp() je
// ranije sklanjao login ekran TEK poslije _checkDeviceUserSwitch (i eventualne
// 3s provjere odobrenja) — sve to vrijeme je uvećani logo stajao preko app-a.
await test('showApp: login ekran (logo) se sklanja PRIJE sporih provjera, ne poslije', async () => {
  const seen = [];
  const el = () => ({ style: new Proxy({}, { set: (t, k, v) => { t[k] = v; return true; } }) });
  const els = { 'auth-screen': el(), 'wrapper': el() };
  let switchResolved = false;

  const env = {
    document: { getElementById: (id) => els[id] || el() },
    // Odobren korisnik (odobren nije false) — gate ne blokira. MORA biti
    // postavljeno PRIJE konstrukcije sandboxa: vrijednosti se hvataju tada.
    sbProfile: { id: 'u1', odobren: true },
    sbUser: { id: 'u1' },
    // Namjerno SPORA provjera promjene korisnika — simulira stvarni slučaj
    _checkDeviceUserSwitch: async () => {
      // U trenutku dok ovo traje, login ekran već MORA biti sklonjen.
      seen.push('switch:auth-screen=' + els['auth-screen'].style.display);
      await new Promise(r => setTimeout(r, 20));
      switchResolved = true;
    },
    _showAuthScreen: () => seen.push('AUTH_SCREEN'),
    authShowPending: () => {}, _OL: { save: () => {}, PROFILE: 'p' },
    sb: null, switchTab: () => {}, loadProj: () => {}, sbInitData: () => {},
    _processOfflineQueue: () => {}, sqlmapRestoreAll: () => {}, _setOfflineMode: () => {},
    navigator: { onLine: true, storage: null }, isVodeci: () => false,
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    console: { error(){}, warn(){}, log(){} },
  };
  const params = Object.keys(env);
  const api = new Function(params.join(','),
    `let _appEntered = false;
     ${SRC_REVEAL}
     ${SRC_SHOW_APP}
     return { showApp, entered: () => _appEntered };`)(...params.map(k => env[k]));

  const p = api.showApp();
  // ODMAH, prije nego se ijedan await razriješi:
  assert.equal(els['auth-screen'].style.display, 'none',
    'login ekran mora biti sklonjen ODMAH, ne poslije provjera');
  assert.equal(els['wrapper'].style.display, 'flex', 'glavni prozor mora biti prikazan odmah');
  assert.ok(!switchResolved, 'test mora provjeravati stanje PRIJE nego spora provjera završi');
  await p;
  assert.ok(seen.some(s => s === 'switch:auth-screen=none'),
    'i tokom spore provjere promjene korisnika logo mora već biti sklonjen');
  assert.ok(!seen.includes('AUTH_SCREEN'), 'odobrenom korisniku se login ekran ne smije vratiti');
});

console.log(`\n${_pass} prošlo, ${_fail} palo`);
process.exit(_fail > 0 ? 1 : 0);
})();
