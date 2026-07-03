// =====================================================================
// Service Worker — ŠPD Unsko-sanske šume
// Promijeni APP_VERSION pri svakom deploymentu → okida update
// =====================================================================
const APP_VERSION = '3.10.0';
const APP_CACHE   = 'tvlake-app-v' + APP_VERSION;
const TILE_CACHE  = 'tvlake-tiles-v1';
const LIB_CACHE   = 'tvlake-lib-v1';
const ELEV_CACHE  = 'tvlake-elev-v1';
const SLOPE_CACHE = 'tvlake-slope-v1';
const TERR_CACHE  = 'tvlake-terr-v1';
const NV_CACHE    = 'tvlake-nv-v1';     // Open-Meteo elevation (statički, može se keširati)

// App shell koji se uvijek precachira
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './forwarder.svg',
  './PUTEVI/putevi.geojson',
  './.well-known/assetlinks.json'
];

// ─── INSTALL ─────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_CACHE).then(cache =>
      // Otporno precachiranje — jedan nedostajući fajl (npr. u APK assets-u)
      // ne smije srušiti instalaciju cijelog service workera.
      Promise.allSettled(
        APP_SHELL.map(u =>
          fetch(u, { cache: 'reload' })
            .then(r => { if (r.ok) return cache.put(u, r); })
            .catch(() => {})
        )
      )
    )
  );
});

// ─── ACTIVATE ────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith('tvlake-app-') && k !== APP_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── FETCH ───────────────────────────────────────────────────────────

// Helper — cache-then-fetch pattern for tile caches
// OS-S5: tile keš bez limita raste cijelu sezonu; kad origin dostigne kvotu browser
// može evict-ovati CIJELI Cache Storage (sve offline pločice odjednom). Zato FIFO
// trim: povremeno (1 od 50 upisa) ako je keš iznad limita, obriši najstarije unose.
const TILE_CACHE_MAX = 12000;   // ~pločica po kešu (tile/elev/slope/terr zasebno)
let _tilePutCount = 0;
async function _trimTileCache(cache) {
  try {
    const keys = await cache.keys();
    if (keys.length <= TILE_CACHE_MAX) return;
    const drop = keys.slice(0, keys.length - TILE_CACHE_MAX + 1000); // spusti ispod limita
    for (const k of drop) await cache.delete(k);
  } catch (e) {}
}
function _tileRespond(event, cacheName) {
  event.respondWith(
    caches.open(cacheName).then(async cache => {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      try {
        const resp = await fetch(event.request);
        if (resp.ok) {
          try {
            cache.put(event.request, resp.clone());
            if ((++_tilePutCount % 50) === 0) _trimTileCache(cache); // fire-and-forget
          } catch(e) {}
        }
        return resp;
      } catch {
        return cached || new Response('', { status: 503 });
      }
    })
  );
}

self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Terrarium DEM tiles (elevation-tiles-prod S3 bucket)
  if (url.includes('elevation-tiles-prod')) {
    _tileRespond(event, TERR_CACHE);
    return;
  }

  // Specific ArcGIS elevation caches — must come BEFORE the generic arcgisonline.com handler
  if (url.includes('arcgisonline.com') && url.includes('/World_Hillshade/')) {
    _tileRespond(event, ELEV_CACHE);
    return;
  }
  if (url.includes('arcgisonline.com') && url.includes('/World_Shaded_Relief/')) {
    _tileRespond(event, SLOPE_CACHE);
    return;
  }

  if (
    url.includes('tile.opentopomap.org') ||
    url.includes('tile.openstreetmap.org') ||
    url.includes('arcgisonline.com') ||
    url.includes('.google.com/vt/')
  ) {
    _tileRespond(event, TILE_CACHE);
    return;
  }

  // Elevation API — statički podaci terena, keširamo za offline
  if (url.includes('api.open-meteo.com') && url.includes('/v1/elevation')) {
    _tileRespond(event, NV_CACHE);
    return;
  }
  // Ostali API pozivi — nikad ne keširati
  if (url.includes('supabase.co') || url.includes('api.open-meteo.com')) {
    return;
  }

  // CDN biblioteke (Leaflet, proj4, Turf, sql-wasm...) — keš pri prvom učitavanju
  if (
    url.includes('cdnjs.cloudflare.com') ||
    url.includes('cdn.jsdelivr.net') ||
    url.includes('unpkg.com')
  ) {
    event.respondWith(
      caches.open(LIB_CACHE).then(async cache => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        try {
          const resp = await fetch(event.request);
          if (resp.ok) try { cache.put(event.request, resp.clone()); } catch(e) {}
          return resp;
        } catch {
          return cached || new Response('', { status: 503 });
        }
      })
    );
    return;
  }

  if (
    url.startsWith(self.location.origin) ||
    event.request.mode === 'navigate'
  ) {
    // Navigacije (index.html) dohvati BEZ HTTP keša — inače browser/CDN servira staru
    // verziju do isteka max-age (~10 min) pa update kasni. Ostalo: normalan network-first.
    const isNav = event.request.mode === 'navigate';
    const req = isNav ? new Request(event.request, { cache: 'no-store' }) : event.request;
    event.respondWith(
      fetch(req)
        .then(resp => {
          if (resp.ok) {
            try { const rc = resp.clone(); caches.open(APP_CACHE).then(c => c.put(event.request, rc)); } catch(e) {}
          }
          return resp;
        })
        .catch(() => caches.match(event.request))
    );
  }
});

// ─── BACKGROUND RECORDING STATE ──────────────────────────────────────
// Web Lock drži SW živ dok traje snimanje; SW periodično pinga stranicu
let _recLockRelease = null;  // otpušta Web Lock kad snimanje stane
let _swPingTimer    = null;  // interval koji šalje 'sw-ping' stranici

function _startRecLock() {
  if (_recLockRelease || !('locks' in self.navigator || 'locks' in navigator)) return;
  const locks = (self.navigator || navigator).locks;
  if (!locks) return;
  locks.request('gps-rec-bg', { mode: 'shared' }, () =>
    new Promise(resolve => { _recLockRelease = resolve; })
  ).catch(() => {});
  // Periodično pinkaj stranicu — ona restartuje GPS ako se ugasio
  _swPingTimer = setInterval(() => {
    self.clients.matchAll({ type: 'window', includeUncontrolled: false })
      .then(clients => clients.forEach(c => c.postMessage({ type: 'sw-ping' })));
  }, 20000);
}

function _stopRecLock() {
  if (_recLockRelease) { _recLockRelease(); _recLockRelease = null; }
  if (_swPingTimer)    { clearInterval(_swPingTimer); _swPingTimer = null; }
}

// ─── MESSAGE ─────────────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
    return;
  }
  // Heartbeat od stranice tokom GPS snimanja — drži SW budan
  if (event.data?.type === 'gps-heartbeat') {
    event.source?.postMessage({ type: 'heartbeat-ack' });
    return;
  }
  // Pokaži notifikaciju snimanja + uzmi Web Lock (Foreground Service ekvivalent)
  if (event.data?.type === 'show-rec-notification') {
    const { nm, dist } = event.data;
    self.registration.showNotification('🔴 GPS Snimanje — ' + (nm || 'vlaka'), {
      body: dist ? `Snimljeno: ${dist}` : 'Traktorske vlake aktivno snima GPS trag...',
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: 'gps-recording',
      requireInteraction: true,
      silent: true,
      actions: [
        { action: 'pause',  title: '⏸ Pauza' },
        { action: 'stop',   title: '⏹ Stop'  }
      ]
    });
    _startRecLock();
    return;
  }
  // Zatvori notifikaciju i otpusti Web Lock
  if (event.data?.type === 'hide-rec-notification') {
    self.registration.getNotifications({ tag: 'gps-recording' })
      .then(ns => ns.forEach(n => n.close()));
    _stopRecLock();
    return;
  }
  // Notifikacija dijeljene lokacije
  if (event.data?.type === 'show-share-notification') {
    const { name, body, la, lo } = event.data;
    self.registration.showNotification('📍 ' + name, {
      body: body,
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: 'share-loc-' + name,
      data: { la, lo },
      silent: false,
      vibrate: [200, 100, 200]
    });
    return;
  }
});

// ─── NOTIFICATION CLICK ───────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data;
  if (event.action === 'stop' || event.action === 'pause') {
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        clients.forEach(c => c.postMessage({ type: 'rec-action', action: event.action }));
        if (clients.length === 0) self.clients.openWindow('./');
      });
  } else if (data?.la && data?.lo) {
    // Klik na share-loc notifikaciju — fokusiraj app i centriraj na lokaciju
    self.clients.matchAll({ type: 'window' }).then(clients => {
      if (clients.length > 0) {
        clients[0].focus();
        clients[0].postMessage({ type: 'pan-to', la: data.la, lo: data.lo });
      } else {
        self.clients.openWindow('./');
      }
    });
  } else {
    self.clients.matchAll({ type: 'window' }).then(clients => {
      if (clients.length > 0) clients[0].focus();
      else self.clients.openWindow('./');
    });
  }
});
