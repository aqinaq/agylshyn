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

/* A locked book takes two round trips to draw — the paid fetch has to be
   refused before the sample is asked for — and under a full suite run the
   machine is busy enough that a fixed sleep is a coin toss. Poll instead. */
async function until(s, expr, ms) {
  const stop = Date.now() + (ms || 8000);
  for (;;) {
    if (await s.eval(expr)) return true;
    if (Date.now() > stop) return false;
    await sleep(120);
  }
}
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

  // A paid book opens onto its free sample rather than a bare lock — a couple
  // of units, published as a static file on purpose, and a banner that says how
  // little of the book that is.
  await s.eval(`location.hash = '#/b/${PAID_BOOK}'`);
  await until(s, `!!document.querySelector('.sample-bar')`);
  const sample = await s.eval(`(async () => {
    return { units: document.querySelectorAll('#unitList .unit-link:not(.locked-link)').length,
             banner: !!document.querySelector('.sample-bar'),
             ofBook: (document.querySelector('.sample-bar')||{}).textContent || '',
             locked: !!document.querySelector('.locked-link'),
             rows: document.querySelectorAll('.answer-line input').length };
  })()`);
  r.ok('a paid book opens onto a sample', sample.banner && sample.units > 0,
    JSON.stringify(sample));
  r.ok('which is a couple of units, not the book', sample.units <= 2, String(sample.units));
  r.ok('there is real work in it', sample.rows > 3, String(sample.rows));
  r.ok('and the rest of the book is shown as locked', sample.locked);

  const wall = await s.eval(`(async () => {
    location.hash = '#/b/${PAID_BOOK}/unlock';
    await new Promise(r=>setTimeout(r,1200));
    const main = document.getElementById('main');
    return { units: document.querySelectorAll('#unitList .unit-link:not(.locked-link)').length,
             lock: !!main.querySelector('.empty-state'),
             text: main.textContent,
             prices: [...main.querySelectorAll('.plan-price strong')].map(e => e.textContent.trim()),
             buttons: [...main.querySelectorAll('button, .btn')].map(b => b.textContent.trim()) };
  })()`);
  r.ok('and the whole book is still withheld', wall.units <= 2, String(wall.units));
  r.ok('the unlock page shows the lock screen', wall.lock, wall.text.slice(0, 80));
  r.ok('which says an account comes first',
    /кір|Sign in/i.test(wall.buttons.join(' ')), JSON.stringify(wall.buttons));
  r.ok('both prices are on it', wall.prices.length === 2, JSON.stringify(wall.prices));
  r.ok('and they are the ones in pricing.js',
    wall.prices.join(' ').includes('2') && wall.prices.join(' ').includes('5'),
    JSON.stringify(wall.prices));
  r.ok('the textbook itself is still offered',
    /Кітапты оқу|Read the book/i.test(wall.buttons.join(' ')), JSON.stringify(wall.buttons));
  // Nobody signed in has an address to be granted against, and saying so here
  // is cheaper than a payment that arrives with no account to attach it to.
  r.ok('and with no account it says to make one first',
    /аккаунт аш|Make an account/i.test(wall.text), wall.text.slice(-160));

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
  await goto(s, BASE + '#/b/' + PAID_BOOK + '/unlock');
  await until(s, `!!document.querySelector('#main .offer')`);
  const nosub = await s.eval(`(() => {
    const main = document.getElementById('main');
    return { units: document.querySelectorAll('#unitList .unit-link:not(.locked-link)').length,
             text: main.textContent,
             steps: [...main.querySelectorAll('.offer-steps li')].map(e => e.textContent.trim()),
             mail: (main.querySelector('.offer-mail strong') || {}).textContent,
             buttons: [...main.querySelectorAll('button, .btn')].map(b => b.textContent.trim()) };
  })()`);
  r.ok('still only the sample', nosub.units <= 2, String(nosub.units));
  r.ok('the way forward is paying, not signing in',
    /Қайта тексеру|Check again/i.test(nosub.buttons.join(' ')), JSON.stringify(nosub.buttons));
  r.ok('and the offer names a contact',
    /alacorda|Telegram/i.test(nosub.text), nosub.text.slice(-120));

  /* The manual grant runs on one piece of information the reader supplies, and
     a wrong one means money in and no book out. So: it must be asked for, and
     the reader must not have to remember it. */
  r.ok('the steps are spelled out, not one sentence',
    nosub.steps.length >= 2, JSON.stringify(nosub.steps));
  r.ok('and they ask for a name and the registered email',
    /есім|name/i.test(nosub.steps.join(' ')) && /пошта|email/i.test(nosub.steps.join(' ')),
    JSON.stringify(nosub.steps));
  r.eq('the address itself is printed, so it cannot be misremembered',
    nosub.mail, 'owner@example.com');

  const copied = await s.eval(`(async () => {
    let grabbed = null;
    navigator.clipboard.writeText = (s) => { grabbed = s; return Promise.resolve(); };
    document.querySelector('.offer-mail-c').click();
    await new Promise(r=>setTimeout(r,120));
    return { grabbed, label: document.querySelector('.offer-mail-c').textContent.trim() };
  })()`);
  r.eq('and copying it puts it on the clipboard', copied.grabbed, 'owner@example.com');
  r.ok('with the button saying so', /Көшірілді|Copied/i.test(copied.label), copied.label);

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

  /* ============ paid for, never uploaded ============ */

  /* The failure that actually happened: six of the seven paid books had no row
     in book_content, and RLS filters rather than refuses, so a live
     subscription got the same empty array as a stranger. The app read that as
     "you have not paid" and drew the paywall at people who had — which is both
     the wrong thing to say and the reason nobody could tell it apart from a
     working lock. A live subscription plus no row is now an error, not a
     price. */
  r.head('a subscriber whose book was never uploaded');
  s = await signedIn(conn, { access: LIVE, missing: [PAID_BOOK] });
  await goto(s, BASE + '#/b/' + PAID_BOOK);
  await until(s, `!!document.querySelector('.empty-state')`);
  const gone = await s.eval(`(() => ({
    text: document.getElementById('main').textContent,
    offer: !!document.querySelector('.offer-card'),
    units: document.querySelectorAll('#unitList li').length,
    sample: !!document.querySelector('.sample-bar') }))()`);
  r.ok('no lock and no price is asked of somebody who already paid',
    !gone.offer && !/🔒/.test(gone.text), JSON.stringify({ offer: gone.offer }));
  r.ok('it says the subscription is fine and the content is not there',
    /жазылым/i.test(gone.text) || /subscription is fine/i.test(gone.text),
    gone.text.slice(0, 200));
  r.ok('and it does not quietly hand over the sample instead',
    !gone.sample && gone.units === 0, JSON.stringify({ sample: gone.sample, units: gone.units }));

  /* ============ the subscription that ran out ============ */
  r.head('a subscription that has lapsed');
  s = await signedIn(conn, { access: LAPSED });
  await goto(s, BASE + '#/b/' + PAID_BOOK);
  await until(s, `!!document.querySelector('.sample-bar')`);
  const lapsed = await s.eval(`(() => ({
    units: document.querySelectorAll('#unitList .unit-link:not(.locked-link)').length,
    sample: !!document.querySelector('.sample-bar'),
    text: document.getElementById('main').textContent }))()`);
  // Back to what a stranger gets: the sample, and the offer behind it.
  r.ok('the book shuts back to its sample', lapsed.sample && lapsed.units <= 2,
    JSON.stringify({ units: lapsed.units, sample: lapsed.sample }));

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
  // The unlock page is where a reader who has paid ends up: the sample banner's
  // button, or the locked unit they tried to open.
  await goto(s, BASE + '#/b/' + PAID_BOOK + '/unlock');
  await until(s, `!!document.querySelector('#main .offer')`);
  s.mock.setAccess(LIVE);                       // you press Grant, they press this
  const recheck = await s.eval(`(async () => {
    const b = [...document.querySelectorAll('#main button')]
      .find(x => /Қайта тексеру|Check again/i.test(x.textContent));
    if (!b) return { found: false };
    b.click();
    await new Promise(r=>setTimeout(r,1800));
    return { found: true, view: document.body.getAttribute('data-view'),
             units: document.querySelectorAll('#unitList .unit-link').length };
  })()`);
  r.ok('"check again" is on the lock screen', recheck.found);
  r.ok('and it opens the whole book without a reload', recheck.units > 2,
    JSON.stringify(recheck));

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
    await new Promise(r=>setTimeout(r,1800));
    // The sample is published on purpose, so what a forged flag must not buy is
    // the rest: the unit list stays the sample's, and a unit outside it locks.
    const sample = document.querySelectorAll('#unitList .unit-link:not(.locked-link)').length;
    location.hash = '#/b/${PAID_BOOK}/unit/40';
    await new Promise(r=>setTimeout(r,900));
    return { units: sample,
             lock: !!document.querySelector('#main .empty-state') };
  })()`);
  r.ok('a client that lies to itself still gets no more than the sample',
    forged.units > 0 && forged.units <= 2, String(forged.units));
  r.ok('and lands back on the lock screen', forged.lock);

  return r.done();
}

if (require.main === module) {
  run().then(f => process.exit(f ? 1 : 0))
       .catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
}
module.exports = { run };
