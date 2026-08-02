/* The paywall, from both sides.

   What it is here to catch, in order of how expensive the mistake would be:

     1. a paid book opening for somebody who has not paid,
     2. a paid book NOT opening for somebody who has,
     3. a lock drawn at a paying reader for the half second before the answer
        lands, which reads as "my subscription vanished" on every reload,
     4. a lock screen that is a wall with no door — no price, no way to pay.

   The server half cannot be tested from a browser at all: it is a row-level
   policy, and the audit checks it exists. What is tested here is that the app
   asks, believes the answer, and behaves when the answer is no.

   node site/tests/paywall_e2e.js */
'use strict';
const { connect, newContextPage, goto, sleep } = require('./cdp.js');
const { Report } = require('./report.js');
const { PAID, supabaseHost, mock, signedIn, LIVE, LAPSED } = require('./supamock.js');

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:8853/';
const PORT = Number(process.env.TEST_CDP || 9333);

// One of each, chosen from tiers.json rather than written down, so moving a
// book between free and paid never leaves this file testing the wrong one.
const PAID_BOOK = [...PAID][0];
const FREE_BOOK = 'grammar';

async function run() {
  const r = Report('paywall');
  const conn = await connect(PORT);

  if (!supabaseHost()) {
    r.note('supabase.config.js is empty — every book is free, nothing to test here.');
    return r.done();
  }
  if (!PAID_BOOK) {
    r.note('tools/tiers.json lists no paid book — nothing to test here.');
    return r.done();
  }
  r.note('paid: ' + PAID_BOOK + '   free: ' + FREE_BOOK);

  /* ============ nobody signed in ============ */
  r.head('a visitor with no account');
  let s = await newContextPage(conn);
  await mock(s, {});
  await goto(s, BASE);
  await sleep(1200);

  const shelf = await s.eval(`(() => {
    const cards = [...document.querySelectorAll('.book-card')];
    const of = id => cards.find(c => c.getAttribute('href') === '#/b/' + id);
    return { locked: !!of('${PAID_BOOK}').querySelector('.bc-lock'),
             free: !!of('${FREE_BOOK}').querySelector('.bc-lock'),
             locks: document.querySelectorAll('.bc-lock').length };
  })()`);
  r.ok('a paid book wears a lock', shelf.locked);
  r.ok('a free one does not', !shelf.free);
  r.eq('as many locks as there are paid books', shelf.locks, PAID.size);

  const free = await s.eval(`(async () => {
    location.hash = '#/b/${FREE_BOOK}';
    await new Promise(r=>setTimeout(r,900));
    return { view: document.body.getAttribute('data-view'),
             units: document.querySelectorAll('#unitList li').length };
  })()`);
  r.ok('a free book still opens for anybody', free.view === 'book' && free.units > 0,
    JSON.stringify(free));

  const wall = await s.eval(`(async () => {
    location.hash = '#/b/${PAID_BOOK}';
    await new Promise(r=>setTimeout(r,1200));
    const main = document.getElementById('main');
    return { units: document.querySelectorAll('#unitList li').length,
             lock: !!main.querySelector('.empty-state'),
             text: main.textContent,
             prices: [...main.querySelectorAll('.plan-price strong')].map(e => e.textContent.trim()),
             buttons: [...main.querySelectorAll('button, .btn')].map(b => b.textContent.trim()) };
  })()`);
  r.eq('a paid book hands over no units', wall.units, 0);
  r.ok('it shows the lock screen instead', wall.lock, wall.text.slice(0, 80));
  r.ok('which says an account comes first',
    /кір|Sign in/i.test(wall.buttons.join(' ')), JSON.stringify(wall.buttons));
  r.ok('both prices are on it', wall.prices.length === 2, JSON.stringify(wall.prices));
  r.ok('and they are the ones in pricing.js',
    wall.prices.join(' ').includes('2') && wall.prices.join(' ').includes('5'),
    JSON.stringify(wall.prices));
  r.ok('the textbook itself is still offered',
    /Кітапты оқу|Read the book/i.test(wall.buttons.join(' ')), JSON.stringify(wall.buttons));

  // The one thing a paywall must never do: hand the content over anyway.
  const direct = await s.eval(`(async () => {
    const res = await fetch('data/${PAID_BOOK}.json');
    return { status: res.status };
  })()`);
  r.ok('and the file is not on the site to be fetched directly',
    direct.status === 404, 'GET data/' + PAID_BOOK + '.json -> ' + direct.status);

  /* ============ signed in, nothing bought ============ */
  r.head('an account with no subscription');
  s = await signedIn(conn, { access: null });
  await goto(s, BASE + '#/b/' + PAID_BOOK);
  await sleep(1500);
  const nosub = await s.eval(`(() => {
    const main = document.getElementById('main');
    return { units: document.querySelectorAll('#unitList li').length,
             text: main.textContent,
             buttons: [...main.querySelectorAll('button, .btn')].map(b => b.textContent.trim()) };
  })()`);
  r.eq('still no units', nosub.units, 0);
  r.ok('the way forward is paying, not signing in',
    /Қайта тексеру|Check again/i.test(nosub.buttons.join(' ')), JSON.stringify(nosub.buttons));
  r.ok('and the offer names a contact',
    /alacorda|Telegram/i.test(nosub.text), nosub.text.slice(-120));

  /* ============ a subscriber ============ */
  r.head('a subscriber');
  s = await signedIn(conn, { access: LIVE });
  await goto(s, BASE);
  await sleep(1400);
  const open = await s.eval(`(async () => {
    const before = document.querySelectorAll('.bc-lock').length;
    location.hash = '#/b/${PAID_BOOK}';
    await new Promise(r=>setTimeout(r,1600));
    return { locks: before,
             view: document.body.getAttribute('data-view'),
             units: document.querySelectorAll('#unitList li').length };
  })()`);
  r.eq('no locks anywhere on the shelf', open.locks, 0);
  r.ok('the paid book opens like any other', open.view === 'book' && open.units > 0,
    JSON.stringify(open));
  r.ok('and it came from Supabase, not from data/',
    s.mock.calls.content.includes(PAID_BOOK), JSON.stringify(s.mock.calls.content));

  // Answering inside a paid book has to record progress exactly as a free one
  // does — the book arrives by a different road, and nothing downstream of
  // loadBook() is supposed to know that.
  const answered = await s.eval(`(async () => {
    const inp = document.querySelector('#main input');
    if (!inp) return { typed: false };
    inp.value = 'zzzz';
    inp.dispatchEvent(new Event('input', {bubbles:true}));
    inp.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',bubbles:true}));
    await new Promise(r=>setTimeout(r,500));
    const items = JSON.parse(localStorage.getItem('agylshyn_v1')).items;
    return { typed: true, keys: Object.keys(items).filter(k => k.indexOf('${PAID_BOOK}|') === 0).length };
  })()`);
  r.ok('an answer inside it is recorded like any other',
    answered.typed && answered.keys > 0, JSON.stringify(answered));

  /* An exercise that prints the same number twice used to file both rows under
     one key: the second answer overwrote the first and the unit could never be
     finished. Advanced Grammar 17.2 runs 1-10 and then 1-7 again. The book is
     paid, so the regression can only be checked from inside a subscription —
     which is why this lives here rather than in app_e2e.js. */
  r.head('two rows, one number (advanced-grammar 17.2)');
  await goto(s, BASE + '#/b/advanced-grammar/unit/17');
  await sleep(1600);
  const clash = await s.eval(`(async () => {
    const all = [...document.querySelectorAll('#main input')]
      .filter(i => (i.getAttribute('aria-label')||'').indexOf('17.2') >= 0);
    const ones = all.filter(i => /(№1 |№1$|question 1$)/.test(i.getAttribute('aria-label')));
    if (ones.length < 2) return { rows: all.length, ones: ones.length };
    ones[0].value = 'AAAAA'; ones[0].dispatchEvent(new Event('input',{bubbles:true}));
    ones[0].dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    await new Promise(r=>setTimeout(r,300));
    ones[1].value = 'BBBBB'; ones[1].dispatchEvent(new Event('input',{bubbles:true}));
    ones[1].dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    await new Promise(r=>setTimeout(r,400));
    const items = JSON.parse(localStorage.getItem('agylshyn_v1')).items;
    const keys = Object.keys(items).filter(k => k.indexOf('advanced-grammar|17|17.2|') === 0).sort();
    return { rows: all.length, ones: ones.length, keys, vals: keys.map(k => items[k].val),
             boxes: ones.map(i => i.value) };
  })()`);
  r.note(JSON.stringify(clash));
  r.eq('both rows numbered 1 are there', clash.ones, 2);
  r.ok('and each keeps its own answer',
    (clash.vals || []).filter(v => v === 'AAAAA').length === 1
    && (clash.vals || []).filter(v => v === 'BBBBB').length === 1,
    'one record per row, not one shared between them');

  /* ============ the subscription that ran out ============ */
  r.head('a subscription that has lapsed');
  s = await signedIn(conn, { access: LAPSED });
  await goto(s, BASE + '#/b/' + PAID_BOOK);
  await sleep(1500);
  const lapsed = await s.eval(`(() => ({
    units: document.querySelectorAll('#unitList li').length,
    text: document.getElementById('main').textContent }))()`);
  r.eq('the book shuts again', lapsed.units, 0);

  const panel = await s.eval(`(async () => {
    location.hash = '#/';
    await new Promise(r=>setTimeout(r,400));
    document.querySelector('[data-open-auth]').click();
    await new Promise(r=>setTimeout(r,1400));
    return { text: document.getElementById('authBody').textContent };
  })()`);
  // "You have no subscription" to somebody who paid last month is how a renewal
  // turns into a support message; it has to say when it ran out.
  r.ok('the account panel says it ran out, and when',
    /бітті|ran out/i.test(panel.text), panel.text.slice(0, 200));

  /* ============ having just paid ============ */
  r.head('the reader who has just paid');
  s = await signedIn(conn, { access: null });
  await goto(s, BASE + '#/b/' + PAID_BOOK);
  await sleep(1500);
  s.mock.setAccess(LIVE);                       // you press Grant, they press this
  const recheck = await s.eval(`(async () => {
    const b = [...document.querySelectorAll('#main button')]
      .find(x => /Қайта тексеру|Check again/i.test(x.textContent));
    if (!b) return { found: false };
    b.click();
    await new Promise(r=>setTimeout(r,1800));
    return { found: true, view: document.body.getAttribute('data-view'),
             units: document.querySelectorAll('#unitList li').length };
  })()`);
  r.ok('"check again" is on the lock screen', recheck.found);
  r.ok('and it opens the book without a reload', recheck.units > 0, JSON.stringify(recheck));

  /* ============ the flag flipped in devtools ============ */
  r.head('a forged answer in the console');
  s = await signedIn(conn, { access: null });
  await goto(s, BASE);
  await sleep(1400);
  const forged = await s.eval(`(async () => {
    // Everything the client knows, said to be yes. The book still has to come
    // from somewhere, and the server is the somewhere.
    ENTITLE.access().active = true;
    location.hash = '#/b/${PAID_BOOK}';
    await new Promise(r=>setTimeout(r,1600));
    return { units: document.querySelectorAll('#unitList li').length,
             lock: !!document.querySelector('#main .empty-state') };
  })()`);
  r.eq('a client that lies to itself still gets no book', forged.units, 0);
  r.ok('and lands back on the lock screen', forged.lock);

  return r.done();
}

if (require.main === module) {
  run().then(f => process.exit(f ? 1 : 0))
       .catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
}
module.exports = { run };
