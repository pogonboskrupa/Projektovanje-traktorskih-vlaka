// =====================================================================
// Service Worker — Traktorske Vlake
// Verzija se mijenja pri svakom deploymentu da bi se okidao update
// =====================================================================
const APP_VERSION = '1.0.4';
const APP_CACHE   = 'tvlake-app-v' + APP_VERSION;
const TILE_CACHE  = 'tvlake-tiles-v1';   // dijeli se s glavnom stranicom

// Fajlovi koji se uvijek cacheiraju pri instalaciji
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json'
];

// ─── INSTALL ─────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  // skipWaiting → odmah postane aktivan (ne čeka zatvaranje tabova)
  self.skipWaiting();
  event.waitUntil(
    caches.open(APP_CACHE).then(cache => cache.addAll(APP_SHELL))
  );
});

// ─── ACTIVATE ────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith('tvlake-app-') && k !== APP_CACHE)
          .map(k => caches.delete(k))   // briše stare app cacheove
      )
    ).then(() => self.clients.claim())  // preuzme kontrolu nad svim tabovima odmah
  );
});

// ─── FETCH ───────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Tile zahtjevi → cache-first (offline karta)
  if (
    url.includes('tile.opentopomap.org') ||
    url.includes('tile.openstreetmap.org') ||
    url.includes('arcgisonline.com')
  ) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async cache => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        try {
          const resp = await fetch(event.request);
          if (resp.ok) cache.put(event.request, resp.clone());
          return resp;
        } catch {
          return cached || new Response('', { status: 503 });
        }
      })
    );
    return;
  }

  // Supabase i vanjski API pozivi → uvijek network (nikad cache)
  if (
    url.includes('supabase.co') ||
    url.includes('cdnjs.cloudflare') ||
    url.includes('unpkg.com')
  ) {
    return; // default browser handling
  }

  // App shell (index.html, manifest) → network-first s fallback na cache
  if (
    url.includes(self.location.origin) ||
    event.request.mode === 'navigate'
  ) {
    event.respondWith(
      fetch(event.request)
        .then(resp => {
          if (resp.ok) {
            caches.open(APP_CACHE).then(c => c.put(event.request, resp.clone()));
          }
          return resp;
        })
        .catch(() => caches.match(event.request))
    );
  }
});

// ─── MESSAGE ─────────────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
