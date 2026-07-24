/* Service worker: makes the whole app usable offline (AUDIT §Т2).

   Strategy, by kind of request:
   - app shell (html/js/css/manifest/icon) — NETWORK-first, cache fallback.
     app.js and data must stay in lock-step, so an online reader always gets the
     current build; the cache is only there to keep things working offline.
     (Cache-first would strand a reader on a stale app.js after any update.)
   - data/*.json — network-first, falling back to cache. A rebuilt data file
     must reach a returning reader, so the network wins when it is available.
   - pdf/*.pdf — cache-first at runtime. They are large (25–70 MB) and never
     change, so once fetched they stay; nothing is pre-cached.
*/
// Bump on every shell change (html/js/css). activate() deletes caches whose
// key no longer matches, so a returning reader can't be left on a half-old
// shell — which is exactly what happened when books.js grew to eight books.
var SHELL_VERSION = 'v9';
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
  './placement.js',
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
  // Listening audio goes straight to the network: it is ~490 MB in total, and
  // an <audio> element seeks with Range requests, which a cached whole-file
  // response cannot answer.
  if (/\.(mp3|m4a)$/.test(url.pathname)) return;
  // shell: prefer the network so updated JS/CSS ship immediately; fall back to
  // the cached copy only when offline.
  e.respondWith(networkFirst(req, SHELL_CACHE));
});
