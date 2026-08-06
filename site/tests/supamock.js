/* A Supabase project, faked inside the browser under test.

   Three suites need one: the admin roster, the paywall, and the one device test
   that opens an IELTS book (which is paid, so its JSON is not on the static
   host any more). They used to have no reason to share code; now they answer
   the same six endpoints, and a mock that drifts between them is a test that
   passes for the wrong reason.

   Nothing here touches the real project. Every request to the Supabase host is
   answered locally through Fetch.requestPaused, which is also the only way to
   reach the cases that matter: a project that never ran half the schema, a
   reader who set a flag by hand in devtools, a subscription that ran out
   yesterday.

   Not exported as tests — this file only builds the fake. */
'use strict';
const fs = require('fs');
const path = require('path');
const { newContextPage } = require('./cdp.js');

const SITE = path.resolve(__dirname, '..');
const ROOT = path.resolve(SITE, '..');

const USER = {
  id: 'u-me', email: 'owner@example.com',
  user_metadata: { name: 'Owner' }, created_at: '2026-01-04T10:00:00Z'
};

// Three accounts, one of each subscription state — none, live monthly, lifetime
// — because the roster is where those three have to look different.
const ROSTER = [
  { id: 'u-me', email: 'owner@example.com', name: 'Owner',
    created_at: '2026-01-04T10:00:00Z', last_sign_in_at: '2026-07-29T08:00:00Z',
    confirmed: true, admin: true, books: 3, answers: 412, last_active: '2026-07-29T09:10:00Z',
    plan: 'lifetime', expires_at: null, subscribed: true },
  { id: 'u-2', email: 'aigerim@example.com', name: '',
    created_at: '2026-05-20T10:00:00Z', last_sign_in_at: '2026-07-28T18:00:00Z',
    confirmed: true, admin: false, books: 1, answers: 37, last_active: '2026-07-28T18:20:00Z',
    plan: 'monthly', expires_at: '2099-01-01T00:00:00Z', subscribed: true },
  { id: 'u-3', email: 'nurlan@example.com', name: 'Nurlan',
    created_at: '2026-07-01T10:00:00Z', last_sign_in_at: null,
    confirmed: false, admin: false, books: 0, answers: 0, last_active: null,
    plan: null, expires_at: null, subscribed: false }
];

/* Whatever supabase.config.js points at — a fork's project is not this one. */
function supabaseHost() {
  const cfg = fs.readFileSync(path.join(SITE, 'supabase.config.js'), 'utf8');
  const m = /url:\s*'([^']+)'/.exec(cfg);
  return m ? m[1] : null;
}

const PAID = new Set((() => {
  try { return JSON.parse(fs.readFileSync(path.join(SITE, 'tools/tiers.json'), 'utf8')).paid || []; }
  catch (e) { return []; }
})());

// The paid books live in content/, outside site/, which is the whole point of
// them. Reading from disk here is what lets a subscribed test open one exactly
// as a subscriber's browser would.
function bookJson(id) {
  for (const dir of [path.join(ROOT, 'content'), path.join(SITE, 'data')]) {
    const p = path.join(dir, id + '.json');
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  }
  return null;
}

/* opts:
     admin    true → this account is in public.admins
     rpc      404 | 403 → how admin_list_users fails, if it should
     roster   rows for admin_list_users (default ROSTER)
     access   null | {plan, expires_at, active} → what my_access() answers
     onGrant  (body) => row — called for admin_grant, defaults to a sane row  */
function mock(s, opts) {
  opts = opts || {};
  const calls = { grant: [], revoke: [], content: [] };
  let access = opts.access === undefined ? null : opts.access;
  // Classes this fake project holds. A test can seed some; class_create adds
  // to the same list, so "create it, then see it in the list" is a real round
  // trip rather than two independent fixtures.
  const classes = (opts.classes && opts.classes !== 404 ? opts.classes : []).map(c => ({
    id: c.id, owner: c.owner || USER.id, name: c.name, code: c.code,
    members: c.members ? c.members.slice() : [],
    created_at: c.created_at || '2026-07-01T10:00:00Z'
  }));

  return s.send('Fetch.enable', {
    // Not '*supabase.co*': that also matches supabase.config.js, which would
    // then be fulfilled as JSON, leave window.SUPABASE undefined, and take the
    // account button off the page before the test even starts.
    patterns: [{ urlPattern: 'https://*.supabase.co/*', requestStage: 'Request' }]
  }).then(() => {
    s.on('Fetch.requestPaused', p => {
      const url = p.request.url;
      const headers = [
        { name: 'content-type', value: 'application/json' },
        { name: 'access-control-allow-origin', value: '*' },
        // Every call is cross-origin and carries an apikey header, so every one
        // of them is preflighted; without these the browser sends nothing.
        { name: 'access-control-allow-headers', value: '*' },
        { name: 'access-control-allow-methods', value: '*' }
      ];
      const send = (code, body) => s.send('Fetch.fulfillRequest', {
        requestId: p.requestId, responseCode: code, responseHeaders: headers,
        body: Buffer.from(body).toString('base64')
      });
      const reply = (code, obj) => send(code, JSON.stringify(obj));
      const posted = () => {
        try { return JSON.parse(p.request.postData || '{}'); } catch (e) { return {}; }
      };

      if (p.request.method === 'OPTIONS') {
        return s.send('Fetch.fulfillRequest',
          { requestId: p.requestId, responseCode: 204, responseHeaders: headers });
      }
      if (url.includes('/auth/v1/settings')) return reply(200, { external: { google: false } });
      if (url.includes('/auth/v1/user')) return reply(200, USER);
      if (url.includes('/rest/v1/admins')) return reply(200, opts.admin ? [{ user_id: 'u-me' }] : []);

      if (url.includes('/rest/v1/rpc/admin_list_users')) {
        if (opts.rpc === 404) return reply(404, { message: 'Not Found' });
        if (opts.rpc === 403) return reply(403, { message: 'not an admin' });
        return reply(200, opts.roster || ROSTER);
      }

      /* ---- the paywall ---- */
      if (url.includes('/rest/v1/rpc/my_access')) {
        if (opts.rpc === 404) return reply(404, { message: 'Not Found' });
        return reply(200, access ? [access] : []);
      }
      if (url.includes('/rest/v1/rpc/admin_grant')) {
        const body = posted();
        calls.grant.push(body);
        if (!opts.admin) return reply(403, { message: 'not an admin' });
        const row = opts.onGrant ? opts.onGrant(body) : {
          user_id: body.target, plan: body.p_plan,
          expires_at: body.p_plan === 'lifetime' ? null : '2099-01-01T00:00:00Z'
        };
        // Granting to yourself changes what my_access() answers — on the real
        // server that is automatic, and a mock where it is not lets the app get
        // away with never re-asking.
        if (body.target === USER.id) {
          access = { plan: row.plan, expires_at: row.expires_at, active: true };
        }
        return reply(200, row);
      }
      if (url.includes('/rest/v1/rpc/admin_revoke')) {
        const body = posted();
        calls.revoke.push(body);
        if (!opts.admin) return reply(403, { message: 'not an admin' });
        if (body.target === USER.id) access = null;
        return reply(200, null);
      }
      if (url.includes('/rest/v1/book_content')) {
        const id = decodeURIComponent((/book_id=eq\.([^&]+)/.exec(url) || [, ''])[1]);
        calls.content.push(id);
        // This is the row-level policy, in miniature: without a live
        // subscription the row is not refused, it is simply not there.
        if (!(access && access.active)) return reply(200, []);
        const raw = bookJson(id);
        if (!raw) return reply(200, []);
        return send(200, '[{"data":' + raw + '}]');
      }

      /* ---- classes ----
         A small in-memory Postgres: the rules the real functions enforce
         (a code belongs to its owner, a roster is the owner's alone, a wrong
         code is P0002) are what the page is being tested against, so they are
         reproduced here rather than waved through. `classes: 404` plays a
         project that never ran that half of the schema. */
      if (url.includes('/rest/v1/rpc/class_') || url.includes('/rest/v1/rpc/my_classes')) {
        if (opts.classes === 404) return reply(404, { message: 'Not Found' });
        const body = posted();
        if (url.includes('my_classes')) {
          // The real function's where-clause: mine to teach, or one I joined.
          // Without this the mock would hand back every class on the project,
          // which is the one thing the page must never show.
          return reply(200, classes.filter(
            c => c.owner === USER.id || c.members.indexOf(USER.id) > -1
          ).map(c => ({
            id: c.id, name: c.name,
            code: c.owner === USER.id ? c.code : null,
            mine: c.owner === USER.id,
            students: c.members.length,
            owner_name: c.owner === USER.id ? 'Owner' : 'Another Teacher',
            created_at: c.created_at
          })));
        }
        if (url.includes('class_create')) {
          const row = { id: 'c-' + (classes.length + 1), owner: USER.id,
                        name: String(body.p_name || '').trim().slice(0, 60),
                        code: 'ABC' + (classes.length + 1) + 'XY', members: [],
                        created_at: new Date().toISOString() };
          if (!row.name) return reply(400, { message: 'a class needs a name' });
          classes.push(row);
          return reply(200, row);
        }
        if (url.includes('class_join')) {
          const code = String(body.p_code || '').trim().toUpperCase();
          const row = classes.find(c => c.code === code);
          if (!row) return reply(400, { message: 'no class with that code', code: 'P0002' });
          if (row.owner === USER.id) return reply(400, { message: 'this is your own class' });
          if (row.members.indexOf(USER.id) < 0) row.members.push(USER.id);
          return reply(200, row);
        }
        if (url.includes('class_progress')) {
          const row = classes.find(c => c.id === body.p_class);
          if (!row || row.owner !== USER.id) return reply(403, { message: 'not your class' });
          return reply(200, row.members.map((id, i) => ({
            user_id: id,
            email: id === USER.id ? USER.email : 'student' + i + '@example.com',
            name: id === USER.id ? 'Owner' : 'Student ' + (i + 1),
            joined_at: '2026-07-01T10:00:00Z',
            books: i + 1, answers: 100 * (i + 1), correct: 75 * (i + 1),
            last_active: '2026-08-01T09:00:00Z'
          })));
        }
        if (url.includes('class_leave')) {
          const row = classes.find(c => c.id === body.p_class);
          const target = body.p_user || USER.id;
          if (!row) return reply(200, null);
          if (target !== USER.id && row.owner !== USER.id) {
            return reply(403, { message: 'not your class' });
          }
          row.members = row.members.filter(m => m !== target);
          return reply(200, null);
        }
        if (url.includes('class_delete')) {
          const i = classes.findIndex(c => c.id === body.p_class);
          if (i < 0 || classes[i].owner !== USER.id) {
            return reply(403, { message: 'not your class' });
          }
          classes.splice(i, 1);
          return reply(200, null);
        }
      }

      if (url.includes('/rest/v1/progress')) return reply(200, []);
      return reply(200, {});
    });
  }).then(() => ({
    calls,
    // Lets a test change the answer mid-session — "they have just paid, press
    // Check again" is exactly the case the recheck button exists for.
    setAccess: a => { access = a; },
    classes: () => classes
  }));
}

/* A page that is already signed in, with the mock attached. */
async function signedIn(conn, opts) {
  const s = await newContextPage(conn);
  const handle = await mock(s, opts);
  // Seeded before the document runs, not after: a reload fires pagehide and
  // app.js flushes its empty in-memory state over anything written from outside.
  await s.send('Page.addScriptToEvaluateOnNewDocument', {
    source: 'try{localStorage.setItem("agylshyn_sess_v1",' + JSON.stringify(JSON.stringify({
      access_token: 'test-access', refresh_token: 'test-refresh',
      expires_at: Date.now() + 3600e3,
      user: { id: 'u-me', email: 'owner@example.com', name: 'Owner', createdAt: '2026-01-04T10:00:00Z' }
    })) + ')}catch(e){}'
  });
  s.mock = handle;
  return s;
}

const LIVE = { plan: 'lifetime', expires_at: null, active: true };
const LAPSED = { plan: 'monthly', expires_at: '2026-06-01T00:00:00Z', active: false };

module.exports = { USER, ROSTER, PAID, supabaseHost, mock, signedIn, bookJson, LIVE, LAPSED };
