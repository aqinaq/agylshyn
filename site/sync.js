/* Optional account + cloud progress sync (Supabase).

   Why there is no Supabase SDK here: the app is an offline-first PWA whose whole
   shell is precached by sw.js, and it is plain ES5 with no build step. Pulling a
   ~120 KB ESM bundle off a CDN would break offline (a cross-origin script the
   service worker deliberately does not cache, see sw.js) and force a bundler.
   Supabase's two REST surfaces — GoTrue at /auth/v1 and PostgREST at /rest/v1 —
   are small enough to talk to directly with fetch(), which is what this file does.

   Design rules this file follows:
   - The account is OPTIONAL. localStorage stays the source of truth; the cloud is
     a backup that also happens to reach the learner's other devices. With no
     config (supabase.config.js empty) or no network, nothing here runs and the
     app is exactly what it was before.
   - Merging is app.js's mergeInto(): record-by-record, newest `ts` wins. That is
     the same function two browser tabs already use, so a second device is just a
     slower second tab. No answer is ever overwritten by an older one.
   - Progress is stored one row per book (plus a '__meta' row) so a push carries
     the book being practised, not every book ever opened.

   Public surface: window.SYNC — see the return block at the bottom. */
window.SYNC = (function () {
  'use strict';

  var CFG = window.SUPABASE || {};
  var URL_BASE = String(CFG.url || '').replace(/\/+$/, '');
  var ANON = String(CFG.anonKey || '');
  var CONFIGURED = !!(URL_BASE && ANON);

  var SESS_KEY = 'agylshyn_sess_v1';
  var META = '__meta';              // pseudo-book row: daily counts, last, placement
  var PUSH_DELAY = 12000;           // quiet period after the last answer before a push
  var REFRESH_MARGIN = 60000;       // refresh the access token this long before expiry
  // fetch(keepalive) is capped at 64 KB by the spec; a bigger payload silently
  // fails, so an over-size unload push is skipped and left to the next full sync.
  var KEEPALIVE_MAX = 60000;

  var sess = loadSess();            // {access_token, refresh_token, expires_at, user}
  var app = null;                   // bridge installed by app.js via attach()
  var listeners = [];
  var dirty = {};                   // book ids changed since the last successful push
  var pushTimer = null;
  var refreshing = null;            // in-flight token refresh, shared by callers
  var status = 'idle';              // 'idle' | 'syncing' | 'error' | 'offline'
  var lastError = null;             // i18n key of the last failure, for the modal
  var lastSync = null;              // ms epoch of the last successful round trip
  var providers = null;             // which sign-in methods the project actually has

  /* ================= session storage ================= */

  function loadSess() {
    try {
      var raw = localStorage.getItem(SESS_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      return (s && s.access_token && s.refresh_token) ? s : null;
    } catch (e) { return null; }
  }

  function saveSess(s) {
    sess = s;
    try {
      if (s) localStorage.setItem(SESS_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESS_KEY);
    } catch (e) { /* private mode — the session simply won't survive a reload */ }
    emit();
  }

  // GoTrue hands back expires_in (seconds); everything downstream wants an
  // absolute deadline, so convert once here rather than at each call site.
  function sessFrom(json) {
    if (!json || !json.access_token) return null;
    return {
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expires_at: Date.now() + (Number(json.expires_in) || 3600) * 1000,
      user: {
        id: (json.user && json.user.id) || null,
        email: (json.user && json.user.email) || null
      }
    };
  }

  function emit() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](); } catch (e) { /* a bad listener must not stop sync */ }
    }
  }

  function setStatus(s, errKey) {
    status = s;
    lastError = errKey || null;
    emit();
  }

  /* ================= HTTP ================= */

  // Supabase reports failures in three different shapes depending on which
  // service answered; collapse them into one string so callers can just show it.
  function errText(json, res) {
    if (json) {
      if (json.error_description) return String(json.error_description);
      if (json.msg) return String(json.msg);
      if (json.message) return String(json.message);
      if (typeof json.error === 'string') return json.error;
    }
    return 'HTTP ' + ((res && res.status) || '?');
  }

  function request(path, opts) {
    opts = opts || {};
    var headers = { apikey: ANON, 'Content-Type': 'application/json' };
    if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
    if (opts.headers) for (var h in opts.headers) headers[h] = opts.headers[h];
    var init = { method: opts.method || 'GET', headers: headers };
    if (opts.body != null) init.body = JSON.stringify(opts.body);
    if (opts.keepalive) init.keepalive = true;

    return fetch(URL_BASE + path, init).then(function (res) {
      return res.text().then(function (txt) {
        var json = null;
        try { json = txt ? JSON.parse(txt) : null; } catch (e) { /* not JSON */ }
        if (!res.ok) {
          var err = new Error(errText(json, res));
          err.status = res.status;
          throw err;
        }
        return json;
      });
    });
  }

  // Every authenticated call goes through here so token expiry is handled in one
  // place. A refresh_token that Supabase has revoked (password change, sign-out
  // elsewhere) 400s — that is unrecoverable, so drop the session rather than
  // retrying forever.
  function token() {
    if (!sess) return Promise.reject(new Error('signed out'));
    if (Date.now() < sess.expires_at - REFRESH_MARGIN) return Promise.resolve(sess.access_token);
    if (refreshing) return refreshing;
    refreshing = request('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: { refresh_token: sess.refresh_token }
    }).then(function (json) {
      refreshing = null;
      var s = sessFrom(json);
      if (!s) throw new Error('no session');
      saveSess(s);
      return s.access_token;
    }).catch(function (e) {
      refreshing = null;
      if (e.status >= 400 && e.status < 500) saveSess(null);
      throw e;
    });
    return refreshing;
  }

  function auth(path, opts) {
    return token().then(function (tok) {
      opts = opts || {};
      opts.token = tok;
      return request(path, opts);
    });
  }

  /* ================= sign in / out ================= */

  // Where the provider sends the reader back. Must be listed under
  // Authentication → URL Configuration → Redirect URLs in the dashboard, and must
  // carry no hash: the app's router owns the fragment, and OAuth appends its own.
  function redirectTo() {
    return location.origin + location.pathname + location.search;
  }

  // Which providers are switched on is a property of the Supabase project, not of
  // this code, and enabling Google means pasting OAuth credentials into the
  // dashboard. Asking the project keeps the panel honest: a button that would
  // only navigate the reader to a Supabase error page is never drawn.
  var settingsReq = null;
  function loadSettings() {
    if (providers) return Promise.resolve(providers);
    if (settingsReq) return settingsReq;      // opening the panel twice asks once
    settingsReq = request('/auth/v1/settings').then(function (j) {
      settingsReq = null;
      providers = (j && j.external) || {};
      emit();
      return providers;
    }).catch(function () {
      settingsReq = null;
      return null;                            // offline: the panel stays email-only
    });
    return settingsReq;
  }

  function signInPassword(email, password) {
    return request('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: { email: email, password: password }
    }).then(adoptSession);
  }

  // With "Confirm email" on (the Supabase default) signup returns a user but no
  // session — the reader has to click the link first. Report which happened so
  // the modal can say the right thing instead of looking like it did nothing.
  function signUpPassword(email, password) {
    return request('/auth/v1/signup?redirect_to=' + encodeURIComponent(redirectTo()), {
      method: 'POST',
      body: { email: email, password: password }
    }).then(function (json) {
      if (json && json.access_token) { adoptSession(json); return 'signed-in'; }
      return 'confirm-email';
    });
  }

  function sendMagicLink(email) {
    return request('/auth/v1/otp?redirect_to=' + encodeURIComponent(redirectTo()), {
      method: 'POST',
      body: { email: email, create_user: true }
    }).then(function () { return 'sent'; });
  }

  // Full-page redirect. No code_challenge is sent, so GoTrue uses the implicit
  // flow and returns the tokens in the fragment, which captureRedirect() below
  // picks up on the way back.
  function signInGoogle() {
    location.href = URL_BASE + '/auth/v1/authorize?provider=google&redirect_to=' +
      encodeURIComponent(redirectTo());
  }

  function adoptSession(json) {
    var s = sessFrom(json);
    if (!s) throw new Error('no session');
    saveSess(s);
    fullSync();
    return s;
  }

  // Sign-out only clears this device. The local progress is deliberately left
  // alone: it is the reader's work, it was theirs before they ever signed in, and
  // wiping it on sign-out would make a mis-tap catastrophic.
  function signOut() {
    var tok = sess && sess.access_token;
    saveSess(null);
    dirty = {};
    lastSync = null;
    setStatus('idle');
    if (!tok) return Promise.resolve();
    return request('/auth/v1/logout', { method: 'POST', token: tok })
      .catch(function () { /* the local session is gone either way */ });
  }

  /* ================= OAuth / magic-link return ================= */

  // Runs at load, before app.js reads location.hash. The app routes on the
  // fragment ('#/b/grammar/unit/3'), and a provider comes back with its own
  // ('#access_token=…'), so the fragment has to be consumed and erased here or
  // the router would try to open a book called 'access_token=…'.
  function captureRedirect() {
    var h = location.hash || '';
    if (h.indexOf('access_token=') < 0 && h.indexOf('error=') < 0) return;
    var p = new URLSearchParams(h.replace(/^#/, ''));
    var at = p.get('access_token');
    if (at) {
      saveSess({
        access_token: at,
        refresh_token: p.get('refresh_token'),
        expires_at: Date.now() + (Number(p.get('expires_in')) || 3600) * 1000,
        user: { id: null, email: null }     // filled in by fetchUser() below
      });
    } else {
      lastError = p.get('error_description') || p.get('error');
    }
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (e) { location.hash = ''; }
  }

  // The implicit-flow fragment carries no profile, so the modal would have no
  // address to show. One call fills it in.
  function fetchUser() {
    if (!sess || (sess.user && sess.user.email)) return Promise.resolve();
    return auth('/auth/v1/user').then(function (u) {
      if (!sess || !u) return;
      sess.user = { id: u.id || null, email: u.email || null };
      saveSess(sess);
    }).catch(function () { /* cosmetic only */ });
  }

  /* ================= state <-> rows ================= */

  // Answer keys are 'bookId|…' (the same prefix the per-book reset in app.js
  // uses), which is what lets progress be sharded by book without app.js having
  // to tell us which book an answer belonged to.
  function bookOf(key) {
    var i = key.indexOf('|');
    return i > 0 ? key.slice(0, i) : null;
  }

  function splitState(st) {
    var out = {};
    var items = st.items || {};
    for (var k in items) {
      var b = bookOf(k);
      if (!b) continue;                       // malformed key: keep it local only
      if (!out[b]) out[b] = { items: {} };
      out[b].items[k] = items[k];
    }
    // `books` is a derived counter cache (app.js recomputes it), and lang/theme/ui
    // are per-device preferences — none of them belong in the cloud.
    out[META] = {
      daily: st.daily || {},
      last: st.last || null,
      placement: st.placement || null
    };
    return out;
  }

  // Rows -> an object shaped like `state`, so it can go straight into the
  // existing mergeInto() without that function learning anything about sync.
  function rowsToState(rows) {
    var st = { items: {}, daily: {}, last: null, placement: null };
    (rows || []).forEach(function (r) {
      var d = r.data || {};
      if (r.book_id === META) {
        st.daily = d.daily || {};
        st.placement = d.placement || null;
        // `last` is only a "resume where you were" pointer and carries no ts, so
        // a remote one is accepted only when this device has none — otherwise a
        // sync would yank the reader back to another device's book.
        if (d.last && !(app && app.getState().last)) st.last = d.last;
      } else if (d.items) {
        for (var k in d.items) st.items[k] = d.items[k];
      }
    });
    return st;
  }

  function rowsByBook(rows) {
    var m = {};
    (rows || []).forEach(function (r) { m[r.book_id] = r.data || null; });
    return m;
  }

  function upsert(payloads, keepalive) {
    var uid = sess.user && sess.user.id;
    if (!uid) return Promise.reject(new Error('no user id'));
    var body = [];
    for (var b in payloads) {
      body.push({ user_id: uid, book_id: b, data: payloads[b], updated_at: new Date().toISOString() });
    }
    if (!body.length) return Promise.resolve();
    return auth('/rest/v1/progress', {
      method: 'POST',
      body: body,
      keepalive: keepalive,
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }
    });
  }

  /* ================= sync ================= */

  function signedIn() { return !!(CONFIGURED && sess && sess.refresh_token); }
  function ready() { return signedIn() && !!app; }

  // Pull everything, merge it in, then push back only the books that actually
  // differ. Running this at startup is also the recovery path for any push that
  // was lost to a closed tab or a dead connection — nothing needs to remember
  // that it failed, because "local differs from remote" is the whole test.
  function fullSync() {
    if (!ready()) return Promise.resolve();
    if (!navigator.onLine) { setStatus('offline'); return Promise.resolve(); }
    setStatus('syncing');
    // Which books this round trip actually accounts for. A sync takes a second
    // or two, and answers given inside that window re-dirty their book *after*
    // the payload was built — clearing the whole map on success would drop those
    // flags and leave the answers sitting locally until the next full sync.
    var carried = [];
    return fetchUser().then(function () {
      return auth('/rest/v1/progress?select=book_id,data');
    }).then(function (rows) {
      var st = app.getState();
      app.mergeInto(st, rowsToState(rows));
      app.afterMerge();

      var remote = rowsByBook(rows);
      var local = splitState(st);
      var changed = {};
      var any = false;
      for (var b in local) {
        if (JSON.stringify(local[b]) !== JSON.stringify(remote[b] || null)) {
          changed[b] = local[b];
          any = true;
        }
      }
      // Taken here, not earlier: `local` was read a line ago, so everything
      // outstanding at this instant is either in the payload or already
      // identical to the remote copy. Anything flagged from now on is newer.
      carried = Object.keys(dirty);
      if (!any) return null;
      return upsert(changed);
    }).then(function () {
      carried.forEach(function (b) { delete dirty[b]; });
      lastSync = Date.now();
      setStatus('idle');
    }).catch(function (e) {
      setStatus(navigator.onLine ? 'error' : 'offline', e && e.message);
    });
  }

  // The routine path: only the books touched since the last push. The GET first
  // is what keeps a second device's answers from being overwritten — remote is
  // merged in before the row is rewritten, so the upsert carries the union.
  function pushDirty(keepalive) {
    if (!ready()) return Promise.resolve();
    var ids = Object.keys(dirty);
    if (!ids.length) return Promise.resolve();
    if (!navigator.onLine) { setStatus('offline'); return Promise.resolve(); }

    var sending = {};
    dirty = {};

    // On unload there is no time for a round trip, and a keepalive body over
    // 64 KB is dropped by the browser without an error. Send what fits; the next
    // full sync reconciles the rest.
    if (keepalive) {
      var local = splitState(app.getState());
      ids.forEach(function (b) { if (local[b]) sending[b] = local[b]; });
      if (JSON.stringify(sending).length > KEEPALIVE_MAX) {
        ids.forEach(function (b) { dirty[b] = true; });   // try again next load
        return Promise.resolve();
      }
      return upsert(sending, true).catch(function () {
        ids.forEach(function (b) { dirty[b] = true; });
      });
    }

    setStatus('syncing');
    var filter = '?select=book_id,data&book_id=in.(' +
      ids.map(function (b) { return '"' + b + '"'; }).join(',') + ')';
    return auth('/rest/v1/progress' + filter).then(function (rows) {
      var st = app.getState();
      app.mergeInto(st, rowsToState(rows));
      app.afterMerge();
      var merged = splitState(st);
      var remote = rowsByBook(rows);
      ids.forEach(function (b) {
        if (merged[b] && JSON.stringify(merged[b]) !== JSON.stringify(remote[b] || null)) {
          sending[b] = merged[b];
        }
      });
      return upsert(sending);
    }).then(function () {
      lastSync = Date.now();
      setStatus('idle');
    }).catch(function (e) {
      ids.forEach(function (b) { dirty[b] = true; });     // retry on the next tick
      setStatus(navigator.onLine ? 'error' : 'offline', e && e.message);
    });
  }

  // app.js calls this from the one place a verdict is recorded. Answers arrive in
  // bursts (a unit is a dozen in a row), so the push waits for a quiet moment
  // rather than firing per answer.
  function touch(key) {
    if (!signedIn()) return;
    var b = key ? bookOf(key) : null;
    if (b) dirty[b] = true;
    dirty[META] = true;                        // daily counts moved too
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { pushDirty(false); }, PUSH_DELAY);
  }

  function flush() {
    if (!signedIn()) return;
    clearTimeout(pushTimer);
    pushTimer = null;
    pushDirty(true);
  }

  function attach(bridge) {
    app = bridge;
    if (!CONFIGURED) return;
    fullSync();
  }

  if (CONFIGURED) {
    captureRedirect();
    // Leaving the page is the last chance to save the current burst.
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flush();
    });
    // Coming back online after answering offline: reconcile immediately.
    window.addEventListener('online', function () {
      if (ready()) fullSync();
    });
  }

  return {
    configured: CONFIGURED,
    attach: attach,
    onChange: function (fn) { listeners.push(fn); },
    signedIn: signedIn,
    loadSettings: loadSettings,
    providers: function () { return providers; },
    email: function () { return (sess && sess.user && sess.user.email) || null; },
    status: function () { return status; },
    lastError: function () { return lastError; },
    lastSync: function () { return lastSync; },
    pending: function () { return Object.keys(dirty).length; },
    signInPassword: signInPassword,
    signUpPassword: signUpPassword,
    sendMagicLink: sendMagicLink,
    signInGoogle: signInGoogle,
    signOut: signOut,
    syncNow: fullSync,
    touch: touch
  };
})();
