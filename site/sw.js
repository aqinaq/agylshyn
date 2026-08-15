/* Service worker: makes the whole app usable offline (AUDIT §Т2).

   Strategy, by kind of request:
   - app shell (html/js/css/manifest/icon) — NETWORK-first, cache fallback.
     app.js and data must stay in lock-step, so an online reader always gets the
     current build; the cache is only there to keep things working offline.
     (Cache-first would strand a reader on a stale app.js after any update.)
   - data/*.json — network-first, falling back to cache. A rebuilt data file
     must reach a returning reader, so the network wins when it is available.
   - pdf/*.pdf — cache-first at runtime. They are large (25–70 MB) and never
     change, so once fetched they stay; nothing is pre-cached. Ranged requests
     are the exception and are not touched at all — see the fetch handler.
   - vendor/* (pdf.js) — cache-first, in a cache of its own so that bumping the
     shell version does not make every phone re-fetch 1.8 MB.
*/
// Bump on every shell change (html/js/css). activate() deletes caches whose
// key no longer matches, so a returning reader can't be left on a half-old
// shell — which is exactly what happened when books.js grew to eight books.
var SHELL_VERSION = 'v39';
var SHELL_CACHE = 'agylshyn-shell-' + SHELL_VERSION;
var DATA_CACHE = 'agylshyn-data';
var PDF_CACHE = 'agylshyn-pdf';
// pdf.js, kept out of the versioned shell: it is 1.8 MB that never changes,
// and re-downloading it on every release would be the most expensive thing
// about a deploy for the readers who need it most.
var VENDOR_CACHE = 'agylshyn-vendor';

var SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './i18n.js',
  './ask.js',
  './help.js',
  './books.js',
  './placement.js',
  './supabase.config.js',
  './sync.js',
  './entitle.js',
  './pricing.js',
  './dict.js',
  './srs.js',
  './exam.js',
  './classes.js',
  './pdfview.js',
  './media.config.js',
  './manifest.webmanifest',
  './icon.svg',
  './data/index.json',
  './data/dict.json',
  './data/answer-key-pages.json'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(SHELL_CACHE).then(function (c) {
    // Don't let one missing file abort the whole install.
    return Promise.all(SHELL.map(function (u) {
      // Same reason as networkFirst: a precache filled from the HTTP cache can
      // seed a brand-new shell version with the previous build's files.
      return c.add(new Request(u, { cache: 'reload' }))
        .catch(function () { /* skip, fetch it live later */ });
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) {
      // drop old shell versions; keep data, pdf and vendor caches
      if (k !== SHELL_CACHE && k !== DATA_CACHE && k !== PDF_CACHE &&
          k !== VENDOR_CACHE) return caches.delete(k);
    }));
  }).then(function () { return self.clients.claim(); }));
});

// "Network first" was a lie in practice: plain fetch() inside a worker still
// goes through the browser's HTTP cache, and GitHub Pages serves everything with
// max-age=600. For ten minutes after a deploy a reader could therefore get the
// NEW index.html together with the OLD cached app.js and style.css — a shell
// spliced from two builds, which is worse than either. That is exactly how a
// freshly redesigned account button came back as the small circle it replaced.
// `cache: 'reload'` bypasses the HTTP cache, so the network really is consulted
// first and the SW cache remains what it was meant to be: the offline copy.
function bustCache(req) {
  try {
    return new Request(req.url, {
      cache: 'reload',
      credentials: 'same-origin',
      headers: req.headers,
      mode: req.mode === 'navigate' ? 'same-origin' : req.mode,
      redirect: 'follow'
    });
  } catch (e) {
    return req;          // very old browsers: fall back to the plain request
  }
}

function networkFirst(req, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return fetch(bustCache(req)).then(function (res) {
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
  // The PDFs are checked before the cross-origin bail-out below, because they
  // ARE cross-origin now: PDF_BASE points at object storage. Leaving them to
  // the network would quietly cost the one thing this cache is for — a book
  // read once is a book readable on the metro — and unlike the audio bucket
  // there is nothing about a PDF that a whole-file cache entry breaks, as long
  // as ranged requests are still let through untouched.
  //
  // This needs CORS on the bucket. pdf.js reads the bytes itself, so an opaque
  // response is no use to it and none of this works without the headers listed
  // in media.config.js — but nor would the plain fetch without a service
  // worker, so nothing is made worse by caching it.
  if (/\.pdf$/.test(url.pathname)) {
    // A ranged request goes straight to the network, untouched. On a phone we
    // render the book ourselves and pdf.js asks for the few hundred kilobytes
    // a page needs — answering that with the whole cached file (the only thing
    // the Cache API can do) makes it give up on ranges and pull all 44 MB.
    if (req.headers.get('range')) return;
    e.respondWith(cacheFirst(req, PDF_CACHE));
    return;
  }

  // Anything else on another host is left entirely alone — the translation API,
  // the listening audio when AUDIO_BASE points at object storage, and Supabase.
  // Intercepting the audio bucket would only break the Range requests <audio>
  // depends on, and caching Supabase would mean a lapsed subscription keeps
  // opening paid books from disk — the one failure a paywall cannot have.
  // Offline for a paid book would need a leased key, not a cache entry.
  if (url.origin !== self.location.origin) return;

  // Only the free books are in data/ — split_content.py moves the paid ones out
  // — so this cache is the offline library and stays exactly what it was.
  if (/\/data\/.*\.json$/.test(url.pathname)) { e.respondWith(networkFirst(req, DATA_CACHE)); return; }
  // pdf.js: immutable, so cache-first, and in its own cache so a shell bump
  // does not throw it away.
  if (/\/vendor\//.test(url.pathname)) { e.respondWith(cacheFirst(req, VENDOR_CACHE)); return; }
  // Listening audio goes straight to the network: it is ~490 MB in total, and
  // an <audio> element seeks with Range requests, which a cached whole-file
  // response cannot answer.
  if (/\.(mp3|m4a)$/.test(url.pathname)) return;
  // shell: prefer the network so updated JS/CSS ship immediately; fall back to
  // the cached copy only when offline.
  e.respondWith(networkFirst(req, SHELL_CACHE));
});
