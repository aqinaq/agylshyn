/* Service worker: makes the whole app usable offline (AUDIT §Т2).

   Strategy, by kind of request:
   - app shell (html/js/css/manifest/icon) — cache-first, refreshed in the
     background; bump SHELL_VERSION when any of these files change so the new
     copy actually ships.
   - data/*.json — network-first, falling back to cache. A rebuilt data file
     must reach a returning reader, so the network wins when it is available.
   - pdf/*.pdf — cache-first at runtime. They are large (25–70 MB) and never
     change, so once fetched they stay; nothing is pre-cached.
*/
var SHELL_VERSION = 'v1';
var SHELL_CACHE = 'agylshyn-shell-' + SHELL_VERSION;
var DATA_CACHE = 'agylshyn-data';
var PDF_CACHE = 'agylshyn-pdf';

var SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './i18n.js',
  './help.js',
  './books.js',
  './dict.js',
  './manifest.webmanifest',
  './icon.svg',
  './data/index.json',
  './data/dict.json'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(SHELL_CACHE).then(function (c) {
    // Don't let one missing file abort the whole install.
    return Promise.all(SHELL.map(function (u) {
      return c.add(u).catch(function () { /* skip, fetch it live later */ });
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) {
      // drop old shell versions; keep data + pdf caches
      if (k !== SHELL_CACHE && k !== DATA_CACHE && k !== PDF_CACHE) return caches.delete(k);
    }));
  }).then(function () { return self.clients.claim(); }));
});

function networkFirst(req, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return fetch(req).then(function (res) {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    }).catch(function () {
      return cache.match(req).then(function (hit) {
        if (hit) return hit;
        throw new Error('offline and not cached');
      });
    });
  });
}

function cacheFirst(req, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      });
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // e.g. translation API — leave alone

  if (/\/data\/.*\.json$/.test(url.pathname)) { e.respondWith(networkFirst(req, DATA_CACHE)); return; }
  if (/\.pdf$/.test(url.pathname)) { e.respondWith(cacheFirst(req, PDF_CACHE)); return; }
  // shell: try cache, fall back to network (and cache it for next time)
  e.respondWith(
    caches.match(req).then(function (hit) {
      return hit || cacheFirst(req, SHELL_CACHE);
    })
  );
});
