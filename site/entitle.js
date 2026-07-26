/* Which books this reader may open, and how a paid one is fetched.

   The split, in one sentence: a free book is a static file exactly as it always
   was, and a paid book is a request to api/main.py carrying a Supabase access
   token. Everything else here is bookkeeping around that.

   What this file is NOT: a security boundary. Every function below can be made
   to return true by anyone with a devtools console, and that costs them nothing,
   because the paid book JSON is not on the static host to begin with — the
   server decides, and it decides again on every request. This layer exists so
   the app can draw a lock instead of an error, and so it can stop asking for
   something it already knows will be refused.

   Unconfigured (api.config.js empty) it reports everything as free and every
   fetch goes to data/, which is the app's behaviour before any of this existed.

   Public surface: window.ENTITLE — see the return block at the bottom. */
window.ENTITLE = (function () {
  'use strict';

  var BASE = String(window.API_BASE || '').replace(/\/+$/, '');
  var CONFIGURED = !!BASE;

  var FREE = 'free';
  var WILDCARD = 'all';                 // an sku that unlocks every book

  var tierOf = {};                      // book id -> sku, from data/index.json
  var skus = null;                      // null = never asked; {} = asked, owns nothing
  var features = {};                    // feature -> owned?
  var loading = null;                   // in-flight /v1/me, shared by callers
  var listeners = [];

  function emit() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](); } catch (e) { /* a bad listener must not break loading */ }
    }
  }

  /* ================= what costs what ================= */

  // app.js hands over data/index.json once it has it. The tier travels in the
  // index rather than books.js because the index is generated from tiers.json,
  // so the two cannot drift; books.js is hand-written and would.
  function setTiers(index) {
    tierOf = {};
    for (var id in index) {
      if (index[id] && index[id].tier) tierOf[id] = index[id].tier;
    }
    emit();
  }

  function tier(id) { return tierOf[id] || FREE; }
  function isPaid(id) { return CONFIGURED && tier(id) !== FREE; }

  function owns(sku) {
    if (!sku || sku === FREE) return true;
    if (!skus) return false;
    return Object.prototype.hasOwnProperty.call(skus, sku) ||
           Object.prototype.hasOwnProperty.call(skus, WILDCARD);
  }

  function canOpen(id) { return !isPaid(id) || owns(tier(id)); }

  // Undefined until /v1/me has answered: "locked" and "not asked yet" have to be
  // distinguishable, or the library flashes locks at a paying reader on every
  // reload while the answer is in flight.
  function known() { return !CONFIGURED || skus !== null; }

  function hasFeature(name) {
    if (!CONFIGURED) return true;
    return !!features[name];
  }

  /* ================= the reader's purchases ================= */

  function refresh() {
    if (!CONFIGURED || !window.SYNC || !SYNC.signedIn()) {
      // Signed out is a definite answer, not an unknown one: a reader with no
      // account owns nothing, and the library should say so immediately.
      skus = CONFIGURED ? {} : null;
      features = {};
      emit();
      return Promise.resolve(skus || {});
    }
    if (loading) return loading;

    loading = SYNC.token().then(function (tok) {
      return fetch(BASE + '/v1/me', {
        headers: { Authorization: 'Bearer ' + tok }
      });
    }).then(function (r) {
      if (r.status === 401) return { skus: {}, features: [] };   // session died
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      skus = j.skus || {};
      features = {};
      (j.features || []).forEach(function (f) { features[f] = true; });
      loading = null;
      emit();
      return skus;
    }).catch(function (e) {
      loading = null;
      // Leave `skus` as it was. Overwriting a known-good list with {} because
      // the network blinked would lock a paying reader out of a book they are
      // in the middle of; the next refresh, or the next book they open, retries.
      emit();
      throw e;
    });
    return loading;
  }

  /* ================= fetching a book ================= */

  function staticUrl(id) { return 'data/' + id + '.json'; }

  function locked(sku) {
    var e = new Error('locked');
    e.locked = sku || true;             // app.js keys the unlock screen off this
    return e;
  }

  // The one entry point app.js uses. Free books keep their old path exactly —
  // same URL, same service-worker caching, same offline behaviour.
  function fetchBook(id) {
    if (!isPaid(id)) {
      return fetch(staticUrl(id)).then(readJson);
    }
    if (!window.SYNC || !SYNC.signedIn()) return Promise.reject(locked(tier(id)));

    return SYNC.token().then(function (tok) {
      return fetch(BASE + '/v1/content/' + encodeURIComponent(id), {
        headers: { Authorization: 'Bearer ' + tok },
        // The server already sends no-store; asking here too keeps a paid book
        // out of the HTTP cache even if a proxy rewrites the response headers.
        cache: 'no-store'
      });
    }).then(function (r) {
      if (r.status === 402) {
        // The reader is signed in and has not bought this. Refresh the purchase
        // list in the background: the usual way to arrive here twice is having
        // just paid, and a stale cached {} is the reason it would still be shut.
        return r.text().then(function (txt) {
          var sku = tier(id);
          try { sku = JSON.parse(txt).error || sku; } catch (e) { /* keep the tier */ }
          refresh().catch(function () {});
          throw locked(sku);
        });
      }
      if (r.status === 401) {
        skus = {};                      // the session is gone; the library relocks
        emit();
        throw locked(tier(id));
      }
      return readJson(r);
    });
  }

  function readJson(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  /* ================= big files ================= */

  // The textbook PDF is public for every book, paid or not — that is a product
  // decision, not an oversight: a reader can page through the book and decide
  // whether the exercises are worth buying. app.js does not even come through
  // here for it; books.js holds the path and always has.
  //
  // Listening audio is different. It is not the book, it is the material an
  // exercise is built on, so for a paid book it goes through the server, which
  // hands back a short-lived signed R2 url — used immediately, never stored,
  // expired within R2_SIGN_TTL.
  function fileUrl(id, kind, name) {
    if (kind === 'pdf') return Promise.resolve('pdf/' + id + '.pdf');
    if (!isPaid(id)) return Promise.resolve('audio/' + id + '/' + name);
    if (!window.SYNC || !SYNC.signedIn()) return Promise.reject(locked(tier(id)));

    // Only audio reaches here — the pdf case returned above.
    return SYNC.token().then(function (tok) {
      return fetch(BASE + '/v1/file/' + encodeURIComponent(id) + '/audio' +
                   '?name=' + encodeURIComponent(name), {
        headers: { Authorization: 'Bearer ' + tok }
      });
    }).then(function (r) {
      if (r.status === 402 || r.status === 401) throw locked(tier(id));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) { return j.url; });
  }

  // Signing in or out changes the whole library, so re-ask rather than wait for
  // the reader to open something and be surprised.
  if (CONFIGURED && window.SYNC) {
    SYNC.onChange(function () { refresh().catch(function () {}); });
  }

  return {
    configured: CONFIGURED,
    setTiers: setTiers,
    tier: tier,
    isPaid: isPaid,
    owns: owns,
    canOpen: canOpen,
    known: known,
    hasFeature: hasFeature,
    skus: function () { return skus || {}; },
    refresh: refresh,
    fetchBook: fetchBook,
    fileUrl: fileUrl,
    onChange: function (fn) { listeners.push(fn); }
  };
})();
