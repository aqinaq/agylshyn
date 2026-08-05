/* Classes: a teacher, a join code, and a progress board.

   Everything here is six RPC calls to Postgres and no logic of its own. That is
   the point: who owns a class, who may see whose counters, and what a code is
   worth are all decided inside SECURITY DEFINER functions against the verified
   token (see the "classes" section of tools/supabase_schema.sql). A client that
   lies to itself gets an error, not a roster.

   What a teacher can see is deliberately narrow: how much a student has
   answered, how much of it was right, and when they were last here. Not what
   they typed. There is no function on the server that would return that, so
   there is nothing here that could ask for it.

   With supabase.config.js empty — or a project that never ran the classes half
   of the schema — `configured` is false and the app simply has no class page.

   Public surface: window.CLASSES — see the return block at the bottom. */
window.CLASSES = (function () {
  'use strict';

  var CFG = window.SUPABASE || {};
  var URL_BASE = String(CFG.url || '').replace(/\/+$/, '');
  var ANON = String(CFG.anonKey || '');
  var CONFIGURED = !!(URL_BASE && ANON && window.SYNC);

  // A project without the classes schema answers 404 to the first call. Asking
  // again on every repaint would be a request per second on a page that repaints
  // on every sync tick, so the answer is remembered.
  var missing = false;

  function rpc(name, body) {
    if (!CONFIGURED) return Promise.reject(new Error('not configured'));
    if (missing) return Promise.reject(notHere());
    return SYNC.token().then(function (tok) {
      return fetch(URL_BASE + '/rest/v1/rpc/' + name, {
        method: 'POST',
        headers: {
          apikey: ANON,
          Authorization: 'Bearer ' + tok,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body || {})
      });
    }).then(function (r) {
      return r.text().then(function (txt) {
        var json = null;
        try { json = txt ? JSON.parse(txt) : null; } catch (e) { /* not JSON */ }
        if (r.status === 404) { missing = true; throw notHere(); }
        if (!r.ok) {
          var err = new Error((json && (json.message || json.error)) || ('HTTP ' + r.status));
          err.status = r.status;
          // Postgres codes, passed through so the page can say the one useful
          // thing: a wrong join code is not a broken app.
          err.code = json && json.code;
          throw err;
        }
        return json;
      });
    });
  }

  function notHere() {
    var e = new Error('classes are not set up on this project');
    e.missing = true;
    return e;
  }

  return {
    configured: CONFIGURED,
    // False only once a call has actually come back 404: "not asked yet" and
    // "not there" have to look different, or the page hides itself on a slow
    // network.
    unavailable: function () { return missing; },

    mine: function () { return rpc('my_classes'); },
    create: function (name) { return rpc('class_create', { p_name: name }); },
    join: function (code) { return rpc('class_join', { p_code: code }); },
    leave: function (classId, userId) {
      return rpc('class_leave', userId ? { p_class: classId, p_user: userId }
                                       : { p_class: classId });
    },
    remove: function (classId) { return rpc('class_delete', { p_class: classId }); },
    progress: function (classId) { return rpc('class_progress', { p_class: classId }); }
  };
})();
