/* Which books this reader may open, and how a paid one is fetched.

   The split, in one sentence: a free book is a static file under data/ exactly
   as it always was, and a paid book is a row in Supabase that comes back only
   for an account with a live subscription. Everything else here is bookkeeping
   around that.

   What this file is NOT: a security boundary. Every function below can be made
   to return true from a devtools console, and that buys nothing, because the
   JSON of a paid book is not on this host to begin with — split_content.py keeps
   it out of the deploy and out of the repository, and the copy that does exist
   sits behind a row-level policy in Postgres (`book_content_select_subscribed`
   in tools/supabase_schema.sql). That policy is the paywall. This layer exists
   so the app can draw a lock instead of an error, and so it stops asking for
   something it already knows will be refused.

   Why it goes through PostgREST rather than a server of its own: the project
   already runs Supabase for progress sync, the same session token identifies
   the reader, and a book is 650 KB of jsonb that Postgres will happily serve
   under RLS. A second service would be a second thing to host and pay for, and
   would decide exactly the same question.

   With supabase.config.js empty it reports every book free and every fetch goes
   to data/, which is the app's behaviour before any of this existed.

   Public surface: window.ENTITLE — see the return block at the bottom. */
window.ENTITLE = (function () {
  'use strict';

  var CFG = window.SUPABASE || {};
  var URL_BASE = String(CFG.url || '').replace(/\/+$/, '');
  var ANON = String(CFG.anonKey || '');
  var CONFIGURED = !!(URL_BASE && ANON && window.SYNC);

  var paidOf = {};                  // book id -> true, from data/index.json
  var access = null;                // null = never asked; then {plan, until, active}
  var accessFor;                    // whose answer that is: user id, or null when
                                    // signed out. undefined = nobody's yet.
  var loading = null;               // in-flight my_access, shared by callers
  var listeners = [];

  function whoami() {
    var u = SYNC.signedIn() && SYNC.user();
    return (u && u.id) || null;
  }

  function emit() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](); } catch (e) { /* a bad listener must not break loading */ }
    }
  }

  /* ================= what costs what ================= */

  // app.js hands over data/index.json once it has it. The flag travels in the
  // index rather than in books.js because the index is generated from
  // tiers.json, so the two cannot drift; books.js is hand-written and would.
  function setPaid(index) {
    paidOf = {};
    for (var id in index) {
      if (index[id] && index[id].paid) paidOf[id] = true;
    }
    emit();
  }

  function isPaid(id) { return CONFIGURED && !!paidOf[id]; }

  function active() { return !!(access && access.active); }

  function canOpen(id) { return !isPaid(id) || active(); }

  // Undefined until my_access has answered: "locked" and "not asked yet" have to
  // be distinguishable, or the library flashes locks at a paying reader on every
  // reload while the answer is in flight.
  function known() { return !CONFIGURED || access !== null; }

  /* ================= the reader's subscription ================= */

  function rest(path, opts) {
    opts = opts || {};
    return SYNC.token().then(function (tok) {
      var init = {
        method: opts.method || 'GET',
        headers: {
          apikey: ANON,
          Authorization: 'Bearer ' + tok,
          'Content-Type': 'application/json'
        }
      };
      if (opts.body != null) init.body = JSON.stringify(opts.body);
      // A paid book must not sit in the browser's HTTP cache: a lapsed
      // subscription that keeps working from disk is the one failure a paywall
      // cannot have. The service worker ignores this host already (sw.js leaves
      // every cross-origin request alone), so this covers the rest.
      if (opts.noStore) init.cache = 'no-store';
      return fetch(URL_BASE + path, init);
    }).then(function (r) {
      return r.text().then(function (txt) {
        var json = null;
        try { json = txt ? JSON.parse(txt) : null; } catch (e) { /* not JSON */ }
        if (!r.ok) {
          var err = new Error((json && (json.message || json.error)) || ('HTTP ' + r.status));
          err.status = r.status;
          throw err;
        }
        return json;
      });
    });
  }

  // my_access() returns no rows for an account that has never bought anything,
  // which is a definite answer and not a missing one — hence the explicit
  // "nothing" object rather than leaving `access` null and re-asking forever.
  function refresh() {
    if (!CONFIGURED) { return Promise.resolve(null); }
    if (!SYNC.signedIn()) {
      access = { plan: null, until: null, active: false };
      accessFor = null;
      emit();
      return Promise.resolve(access);
    }
    if (loading) return loading;

    var asking = whoami();
    loading = rest('/rest/v1/rpc/my_access', { method: 'POST', body: {} })
      .then(function (rows) {
        var r = (rows && rows[0]) || null;
        access = r
          ? { plan: r.plan || null, until: r.expires_at || null, active: !!r.active }
          : { plan: null, until: null, active: false };
        accessFor = asking;
        loading = null;
        emit();
        return access;
      })
      .catch(function (e) {
        loading = null;
        // A project that has not run the paywall half of supabase_schema.sql
        // answers 404. Treat that as "no paywall here" rather than locking every
        // paid book out of a fork that only wanted progress sync.
        if (e && e.status === 404) {
          paidOf = {};
          access = { plan: null, until: null, active: false };
          accessFor = asking;
          emit();
          return access;
        }
        // Otherwise leave `access` as it was. Overwriting a known-good answer
        // because the network blinked would lock a paying reader out of a book
        // they are in the middle of; the next book they open retries.
        emit();
        throw e;
      });
    return loading;
  }

  /* ================= fetching a book ================= */

  function locked(reason) {
    var e = new Error('locked');
    e.locked = reason || 'paid';      // app.js keys the unlock screen off this
    return e;
  }

  // The one entry point app.js uses. Free books keep their old path exactly —
  // same URL, same service-worker caching, same offline behaviour.
  //
  // A paid book has no offline copy and cannot have one: the whole point is that
  // the answer is re-decided by the server, and a cached book would keep opening
  // for a month after the subscription ran out.
  function fetchBook(id) {
    if (!isPaid(id)) {
      return fetch('data/' + id + '.json').then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
    }
    if (!SYNC.signedIn()) return Promise.reject(locked('signed-out'));

    return rest('/rest/v1/book_content?select=data&book_id=eq.' + encodeURIComponent(id),
                { noStore: true })
      .then(function (rows) {
        // RLS does not refuse — it filters. No subscription therefore looks
        // exactly like no such book, and both come back as an empty array. The
        // difference matters to nobody here: either way there is nothing to
        // open, and the reader is told what to do about the case they can fix.
        if (!rows || !rows.length) {
          // The usual way to arrive here twice is having just paid, so re-ask
          // in the background: a stale "no subscription" is the likeliest
          // reason a book that should be open is not.
          refresh().catch(function () {});
          throw locked('paid');
        }
        return rows[0].data;
      })
      .catch(function (e) {
        if (e && e.locked) throw e;
        // 401 means the session died mid-session. The library has to relock,
        // and the reader has to sign in again.
        if (e && e.status === 401) {
          access = { plan: null, until: null, active: false };
          accessFor = null;
          emit();
          throw locked('signed-out');
        }
        throw e;
      });
  }

  /* ================= admin ================= */

  // The panel's grant buttons. Both functions below are re-decided inside
  // Postgres against the verified token (admin_grant / admin_revoke in
  // tools/supabase_schema.sql), so calling them as anybody else gets an error,
  // not a subscription.
  function grant(userId, plan, days) {
    var body = { target: userId, p_plan: plan };
    if (plan === 'monthly') body.p_days = days || 30;
    return rest('/rest/v1/rpc/admin_grant', { method: 'POST', body: body });
  }

  function revoke(userId) {
    return rest('/rest/v1/rpc/admin_revoke', { method: 'POST', body: { target: userId } });
  }

  // Signing in or out changes the whole library, so re-ask rather than wait for
  // the reader to open something and be surprised.
  if (CONFIGURED) {
    SYNC.onChange(function () {
      // Only when the answer on hand belongs to somebody else — SYNC emits on
      // every status tick, and re-asking on each of them would be a request per
      // answer typed. Comparing the id rather than a signed-in flag also covers
      // the case of one account replacing another without a reload.
      if (accessFor !== whoami()) refresh().catch(function () {});
    });
  }

  return {
    configured: CONFIGURED,
    setPaid: setPaid,
    isPaid: isPaid,
    canOpen: canOpen,
    known: known,
    active: active,
    // {plan, until, active} once asked, null before. The account panel prints it.
    access: function () { return access; },
    refresh: refresh,
    fetchBook: fetchBook,
    grant: grant,
    revoke: revoke,
    onChange: function (fn) { listeners.push(fn); }
  };
})();
