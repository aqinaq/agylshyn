/* The account panel's admin half and #/users, against a mocked Supabase.

   Nothing here touches the real project — tests/supamock.js answers every
   request to the Supabase host locally, which is also the only way to test the
   cases that matter: a project that never ran the admin half of the schema, and
   a reader who set the flag by hand in devtools.

   node site/tests/admin_e2e.js */
'use strict';
const { connect, goto, sleep, answerAsk } = require('./cdp.js');
const { Report } = require('./report.js');
const { ROSTER, supabaseHost, signedIn } = require('./supamock.js');

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:8853/';
const PORT = Number(process.env.TEST_CDP || 9333);

const SEE_USERS = /Қолданушылар|See all users/;

async function run() {
  const r = Report('admin');
  const conn = await connect(PORT);

  const host = supabaseHost();
  if (!host) {
    r.note('supabase.config.js is empty — accounts are switched off, nothing to test here.');
    return r.done();
  }
  r.note('mocking ' + host);

  /* ============ an admin ============ */
  r.head('signed in as an admin');
  let s = await signedIn(conn, { admin: true });
  await goto(s, BASE);
  await sleep(1000);

  r.ok('the account button appears when a project is configured',
    !(await s.eval(`document.querySelector('.acct-btn').hidden`)));

  const panel = await s.eval(`(async () => {
    document.querySelector('[data-open-auth]').click();
    await new Promise(r=>setTimeout(r,1300));
    const body = document.getElementById('authBody');
    return { open: !document.getElementById('authModal').hidden,
             isAdmin: SYNC.isAdmin(),
             badge: (body.querySelector('.auth-badge')||{}).textContent || null,
             link: [...body.querySelectorAll('button')].some(b => ${SEE_USERS}.test(b.textContent)) };
  })()`);
  r.ok('the panel opens', panel.open);
  r.eq('the server confirms the admin', panel.isAdmin, true);
  r.ok('the name carries a badge', !!panel.badge, JSON.stringify(panel));
  r.ok('and the panel offers the way through to the list', panel.link, JSON.stringify(panel));

  const nav = await s.eval(`(async () => {
    [...document.querySelectorAll('#authBody button')].find(b => ${SEE_USERS}.test(b.textContent)).click();
    await new Promise(r=>setTimeout(r,1500));
    return { hash: location.hash, view: document.body.getAttribute('data-view'),
             modalClosed: document.getElementById('authModal').hidden,
             rows: document.querySelectorAll('#main tbody tr').length,
             columns: [...document.querySelectorAll('#main thead th')].map(t=>t.textContent.trim()),
             count: (document.querySelector('.users-count')||{}).textContent,
             sidebar: getComputedStyle(document.getElementById('sidebar')).display,
             tabs: getComputedStyle(document.querySelector('.tabs')).display };
  })()`);
  r.eq('it routes to #/users', nav.hash, '#/users');
  r.eq('the panel closes behind it', nav.modalClosed, true);
  r.eq('every account is a row', nav.rows, ROSTER.length);
  r.eq('with no unit list beside it', nav.sidebar, 'none');
  r.eq('and no unit tabs', nav.tabs, 'none');
  r.note('columns: ' + JSON.stringify(nav.columns) + '   count: ' + JSON.stringify(nav.count));

  const marks = await s.eval(`(() => {
    const rows = [...document.querySelectorAll('#main tbody tr')];
    return { mine: rows.filter(x => x.classList.contains('me')).length,
             you: !!document.querySelector('.au-you'),
             unconfirmed: !!document.querySelector('.au-warn'),
             admins: document.querySelectorAll('#main tbody .auth-badge').length,
             dashes: [...document.querySelectorAll('#main tbody td')]
                       .filter(td => td.textContent.trim() === '—').length,
             invalid: /Invalid Date|NaN/.test(document.getElementById('main').textContent) };
  })()`);
  r.eq('my own row is picked out', marks.mine, 1);
  r.ok('and labelled "you"', marks.you);
  r.ok('an unconfirmed address is flagged', marks.unconfirmed);
  r.eq('the admin badge shows in the table too', marks.admins, 1);
  r.ok('a date that does not exist reads as —', marks.dashes >= 2, String(marks.dashes));
  r.ok('and never as "Invalid Date"', !marks.invalid);

  // Found by its heading, not by counting columns: the subscription column was
  // inserted second and this test silently started sorting a different column.
  const sorted = await s.eval(`(async () => {
    const heads = [...document.querySelectorAll('#main thead th')];
    const i = heads.findIndex(h => /Жауап|Answers/.test(h.textContent));
    heads[i].click();
    await new Promise(r=>setTimeout(r,300));
    const down = [...document.querySelectorAll('#main tbody tr')].map(x => x.children[i].textContent.trim());
    heads[i].click();
    await new Promise(r=>setTimeout(r,300));
    const up = [...document.querySelectorAll('#main tbody tr')].map(x => x.children[i].textContent.trim());
    return { down, up, column: i };
  })()`);
  r.ok('a column sorts both ways',
    JSON.stringify(sorted.down) === '["412","37","0"]' && JSON.stringify(sorted.up) === '["0","37","412"]',
    JSON.stringify(sorted));

  const filter = await s.eval(`(async () => {
    const f = document.querySelector('.users-find');
    f.focus();
    f.value = 'nurlan'; f.dispatchEvent(new Event('input', {bubbles:true}));
    await new Promise(r=>setTimeout(r,300));
    const one = { rows: document.querySelectorAll('#main tbody tr').length,
                  count: document.querySelector('.users-count').textContent,
                  keptFocus: document.activeElement === f };
    f.value = 'zzzzzz'; f.dispatchEvent(new Event('input', {bubbles:true}));
    await new Promise(r=>setTimeout(r,300));
    const none = { rows: document.querySelectorAll('#main tbody tr').length,
                   says: /Ештеңе|Nothing matches/.test(document.getElementById('main').textContent),
                   notes: document.querySelectorAll('#main .empty-state').length };
    f.value = ''; f.dispatchEvent(new Event('input', {bubbles:true}));
    await new Promise(r=>setTimeout(r,300));
    return { one, none, restored: document.querySelectorAll('#main tbody tr').length };
  })()`);
  r.eq('filtering narrows the table', filter.one.rows, 1);
  r.ok('and keeps the caret in the field', filter.one.keptFocus);
  r.eq('a filter that matches nothing empties it', filter.none.rows, 0);
  r.ok('and says so', filter.none.says);
  r.eq('exactly once, however many keys were pressed', filter.none.notes, 0);
  r.eq('clearing the filter brings everyone back', filter.restored, ROSTER.length);
  r.note('filtered count line: ' + JSON.stringify(filter.one.count));

  /* ---- granting, which is the half of the paywall a person performs ---- */
  // By address, not by position: the sort test above left the table in a
  // different order than ROSTER, and reading row 0 quietly checked the wrong
  // account.
  const subs = await s.eval(`(() => {
    const out = {};
    for (const tr of document.querySelectorAll('#main tbody tr')) {
      const cell = tr.querySelector('.u-sub');
      // The local part is spelled out because textContent runs the badges into
      // the address with no space between them — "…Adminyouowner@example.com".
      const who = (tr.textContent.match(/(owner|aigerim|nurlan)@example\\.com/) || ['?'])[0];
      out[who] = {
        chip: (cell.querySelector('.sub-chip, .sub-none') || {}).textContent || '',
        live: !!cell.querySelector('.sub-chip.live'),
        buttons: [...cell.querySelectorAll('button')].map(b => b.textContent)
      };
    }
    return out;
  })()`);
  const lifer = subs['owner@example.com'] || {}, monthly = subs['aigerim@example.com'] || {},
        nobody = subs['nurlan@example.com'] || {};
  r.ok('a lifetime subscription says so',
    /Мәңгілік|Lifetime/.test(lifer.chip) && lifer.live, JSON.stringify(lifer));
  r.ok('a monthly one shows the date it runs out',
    monthly.live && /\d/.test(monthly.chip), JSON.stringify(monthly));
  r.ok('an account with nothing shows a dash', nobody.chip === '—', JSON.stringify(nobody));
  r.eq('and offers no revoke button, having nothing to revoke', nobody.buttons.length, 2);
  r.eq('a subscriber can be revoked', lifer.buttons.length, 3);

  // The row is patched from what the function returns rather than reloaded, so
  // this also checks that the panel believes the server and not itself.
  const granted = await s.eval(`(async () => {
    const rows = [...document.querySelectorAll('#main tbody tr')];
    const target = rows.find(tr => /nurlan/.test(tr.textContent));
    target.querySelector('.u-sub button').click();     // +30 days
    await new Promise(r=>setTimeout(r,600));
    const after = [...document.querySelectorAll('#main tbody tr')].find(tr => /nurlan/.test(tr.textContent));
    return { chip: after.querySelector('.sub-chip') ? after.querySelector('.sub-chip').textContent : null,
             live: !!after.querySelector('.sub-chip.live'),
             buttons: after.querySelectorAll('.u-sub button').length };
  })()`);
  r.ok('granting a month lands on the row at once', granted.live, JSON.stringify(granted));
  r.eq('and the row grows a revoke button', granted.buttons, 3);
  r.eq('the grant asked for exactly 30 days', (s.mock.calls.grant[0] || {}).p_days, 30);
  r.eq('and named the right account', (s.mock.calls.grant[0] || {}).target, 'u-3');

  // Revoking is the destructive one, so it goes through the app's own dialog.
  // The click and the assertion are separate evaluations now: the confirmation
  // has to be answered from out here, in between.
  await s.eval(`[...[...document.querySelectorAll('#main tbody tr')]
    .find(tr => /nurlan/.test(tr.textContent))
    .querySelectorAll('.u-sub button')][2].click()`);
  r.ok('revoking asks before it takes the subscription away', await answerAsk(s));
  await sleep(600);
  const revoked = await s.eval(`(() => {
    const after = [...document.querySelectorAll('#main tbody tr')].find(tr => /nurlan/.test(tr.textContent));
    return { none: !!after.querySelector('.sub-none'),
             buttons: after.querySelectorAll('.u-sub button').length };
  })()`);
  r.ok('revoking takes it away again', revoked.none, JSON.stringify(revoked));
  r.eq('and the revoke button goes with it', revoked.buttons, 2);
  r.eq('the revoke named the right account', (s.mock.calls.revoke[0] || {}).target, 'u-3');

  /* ============ granting yourself ============ */
  // The commonest grant of all: the owner unlocking their own account. ENTITLE
  // caches "no subscription", so without a re-ask the shelf keeps its locks and
  // the books stay shut until a reload — which reads as the grant not working.
  r.head('granting yourself');
  const before = await s.eval(`(async () => {
    location.hash = '#/';
    await new Promise(r=>setTimeout(r,900));
    return document.querySelectorAll('.bc-lock').length;
  })()`);
  // A lifetime grant is the one grant that asks first (app.js passes it a
  // users.confirmLife message), so the dialog has to be answered here.
  await s.eval(`(async () => {
    location.hash = '#/users';
    await new Promise(r=>setTimeout(r,900));
    const row = [...document.querySelectorAll('tbody tr')]
      .find(tr => tr.textContent.indexOf('owner@example.com') > -1);
    [...row.querySelectorAll('.sub-acts button')]
      .find(b => /Мәңгілік|Lifetime/i.test(b.textContent)).click();
  })()`);
  r.ok('granting a lifetime asks first', await answerAsk(s));
  await sleep(1400);
  const mine = await s.eval(`(async () => {
    location.hash = '#/';
    await new Promise(r=>setTimeout(r,900));
    return { before: ${before}, after: document.querySelectorAll('.bc-lock').length,
             active: window.ENTITLE.active() };
  })()`);
  r.ok('the shelf was locked before the grant', mine.before > 0, String(mine.before));
  r.ok('the app re-asks and the answer is yes', mine.active);
  r.eq('and every lock is off the shelf, with no reload', mine.after, 0);

  const revisit = await s.eval(`(async () => {
    let calls = 0;
    const real = window.fetch;
    window.fetch = function (u) { if (String(u).includes('admin_list_users')) calls++; return real.apply(this, arguments); };
    for (let i = 0; i < 4; i++) {
      location.hash = '#/'; await new Promise(r=>setTimeout(r,200));
      location.hash = '#/users'; await new Promise(r=>setTimeout(r,320));
    }
    window.fetch = real;
    return { calls, rows: document.querySelectorAll('#main tbody tr').length };
  })()`);
  r.eq('leaving and returning does not refetch the roster', revisit.calls, 0);
  r.eq('and the table is still drawn', revisit.rows, ROSTER.length);

  const out = await s.eval(`(async () => {
    await SYNC.signOut();
    await new Promise(r=>setTimeout(r,700));
    return { isAdmin: SYNC.isAdmin(),
             rows: document.querySelectorAll('#main tbody tr').length,
             text: document.getElementById('main').textContent.trim().slice(0, 70) };
  })()`);
  r.eq('signing out forgets the answer', out.isAdmin, null);
  r.eq('and takes the roster off the screen at once', out.rows, 0);
  r.ok('leaving a sign-in prompt', /кір|Sign in/i.test(out.text), out.text);

  /* ============ a signed-in reader who is not an admin ============ */
  r.head('signed in, not an admin');
  s = await signedIn(conn, { admin: false });
  await goto(s, BASE + '#/users');
  await sleep(1500);
  const plain = await s.eval(`(() => ({ isAdmin: SYNC.isAdmin(),
    rows: document.querySelectorAll('#main tbody tr').length,
    text: document.getElementById('main').textContent.slice(0, 90) }))()`);
  r.eq('the server says no', plain.isAdmin, false);
  r.eq('typing the URL shows no table', plain.rows, 0);
  r.ok('it says the page is for admins', /админ|admins only/i.test(plain.text), plain.text);

  const panel2 = await s.eval(`(async () => {
    document.querySelector('[data-open-auth]').click();
    await new Promise(r=>setTimeout(r,1000));
    const body = document.getElementById('authBody');
    return { badge: !!body.querySelector('.auth-badge'),
             link: [...body.querySelectorAll('button')].some(b => ${SEE_USERS}.test(b.textContent)) };
  })()`);
  r.ok('no badge in their panel', !panel2.badge);
  r.ok('and no door to the list', !panel2.link);

  /* ============ a project that never ran the admin half ============ */
  r.head('the schema was never run (404)');
  s = await signedIn(conn, { admin: true, rpc: 404 });
  await goto(s, BASE + '#/users');
  await sleep(1700);
  const missing = await s.eval(`(() => ({
    text: document.getElementById('main').textContent.slice(0, 130),
    retry: [...document.querySelectorAll('#main button')].some(b => /Жаңарту|Refresh/.test(b.textContent))
  }))()`);
  r.ok('it names the missing function rather than spinning',
    /supabase_schema|орнатылмаған|not installed/i.test(missing.text), missing.text);
  r.ok('and offers to try again', missing.retry);

  // The account panel repaints on every sync tick and route() redraws the page
  // after every merge; a lazy load that only guards `list === null` retries a
  // failed request forever.
  const loop = await s.eval(`(async () => {
    let calls = 0;
    const real = window.fetch;
    window.fetch = function (u) { if (String(u).includes('admin_list_users')) calls++; return real.apply(this, arguments); };
    for (let i = 0; i < 5; i++) {
      location.hash = '#/'; await new Promise(r=>setTimeout(r,160));
      location.hash = '#/users'; await new Promise(r=>setTimeout(r,260));
    }
    window.fetch = real;
    return calls;
  })()`);
  r.eq('a failed load is not retried on every repaint', loop, 0);

  /* ============ a flag set by hand in devtools ============ */
  r.head('a forged admin flag (403 from the function)');
  s = await signedIn(conn, { admin: true, rpc: 403 });
  await goto(s, BASE + '#/users');
  await sleep(1700);
  const forged = await s.eval(`(() => ({
    rows: document.querySelectorAll('#main tbody tr').length,
    text: document.getElementById('main').textContent.slice(0, 100) }))()`);
  r.eq('the function refuses and no roster is drawn', forged.rows, 0);
  r.ok('the page says why', /админ|admins only/i.test(forged.text), forged.text);

  return r.done();
}

if (require.main === module) {
  run().then(f => process.exit(f ? 1 : 0))
       .catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
}
module.exports = { run };
