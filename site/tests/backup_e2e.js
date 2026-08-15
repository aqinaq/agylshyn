/* The "your progress is only in this browser" nudge.

   Progress lives in localStorage, and localStorage is exactly as durable as the
   browser holding it. The app's answer is an optional account, and the account
   button is a small avatar in the top corner — a reader forty units deep has
   never had a reason to press it and so has never learned what it is for. The
   nudge is the ask, moved to where the reader actually is.

   Two ways to get this wrong, and this file is about both:

     1. it never appears, and the feature is decoration;
     2. it appears too often, or to the wrong person — a first visit, a reader
        who is already signed in, a reader who said "later" one screen ago —
        and it becomes a nag, which is dismissed without being read and would
        have been better not built.

   node site/tests/backup_e2e.js */
'use strict';
const { connect, newContextPage, goto, sleep } = require('./cdp.js');
const { Report } = require('./report.js');
const { supabaseHost, mock, signedIn } = require('./supamock.js');

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:8853/';
const PORT = Number(process.env.TEST_CDP || 9333);

// The thresholds in app.js. Named here rather than inlined so a change there
// that this file has not been told about reads as a failing test, not as a
// mysterious empty banner.
const FIRST = 40, SECOND = 200;

/* A state object with `n` answered questions in it, seeded before the document
   runs. Seeding after load does not work: a reload fires pagehide and app.js
   flushes its own in-memory state straight over the seed. */
function seed(n, ui) {
  const items = {};
  for (let i = 1; i <= n; i++) {
    items['grammar|1|1.1|' + i] = { streak: 1, wrong: 0, last: 'correct', ts: Date.now(), val: 'x' };
  }
  return JSON.stringify({ v: 1, items, daily: {}, books: {}, ui: ui || {} });
}

async function page(conn, n, ui) {
  const s = await newContextPage(conn);
  await mock(s, {});
  if (n !== null) {
    await s.send('Page.addScriptToEvaluateOnNewDocument', {
      source: 'try{localStorage.setItem("agylshyn_v1",' + JSON.stringify(seed(n, ui)) + ')}catch(e){}'
    });
  }
  await goto(s, BASE);
  await sleep(900);
  return s;
}

const shown = s => s.eval(`(() => {
  const box = document.getElementById('homeBackup');
  if (!box || box.hidden) return null;
  const card = box.querySelector('.backup-card');
  if (!card) return null;
  return { title: card.querySelector('.bk-txt b').textContent,
           body: card.querySelector('.bk-txt span').textContent,
           go: !!card.querySelector('.bk-go'),
           later: !!card.querySelector('.bk-later') };
})()`);

async function run() {
  const r = Report('progress backup nudge');
  const conn = await connect(PORT);

  // With no Supabase configured there is no cloud to offer, and the nudge is
  // correct to stay away — a fork running this off the filesystem should never
  // see an ask it cannot fulfil.
  if (!supabaseHost()) {
    r.note('supabase.config.js is empty — there is no account to nudge towards.');
    return r.done();
  }

  r.head('who is asked, and when');

  let s = await page(conn, null);
  r.ok('a first-time visitor is not asked', (await shown(s)) === null);

  s = await page(conn, FIRST - 1);
  r.ok('nor is one with ' + (FIRST - 1) + ' answers', (await shown(s)) === null);

  s = await page(conn, FIRST);
  const card = await shown(s);
  r.ok('at ' + FIRST + ' answers the ask appears', !!card, JSON.stringify(card));
  if (card) {
    r.ok('it says what is at stake', /browser|браузер/i.test(card.title), card.title);
    // The count is the whole argument — "40 questions" is why this is worth
    // reading and a blank there is a banner that says nothing in particular.
    r.ok('and how much of it there is', card.body.indexOf(String(FIRST)) > -1, card.body);
    r.ok('it offers a way to fix it', card.go);
    r.ok('and a way to say no', card.later);
  }

  const inn = await signedIn(conn, {});
  await inn.send('Page.addScriptToEvaluateOnNewDocument', {
    source: 'try{localStorage.setItem("agylshyn_v1",' + JSON.stringify(seed(SECOND)) + ')}catch(e){}'
  });
  await goto(inn, BASE);
  await sleep(1200);
  r.ok('a signed-in reader is never asked', (await shown(inn)) === null);

  r.head('"later" is an answer');

  s = await page(conn, FIRST);
  await s.eval(`document.querySelector('.backup-card .bk-later').click()`);
  await sleep(200);
  r.ok('pressing it puts the card away', (await shown(s)) === null);
  const stored = await s.eval(
    `(JSON.parse(localStorage.getItem('agylshyn_v1')).ui || {}).backupAsked || 0`);
  r.eq('and records the size it was asked at', stored, FIRST);

  // The dismissal has to survive a reload or it is not a dismissal, it is a
  // fade-out.
  s = await page(conn, FIRST + 10, { backupAsked: FIRST });
  r.ok('it stays away on the next visit', (await shown(s)) === null);

  r.head('and it comes back when the question changes');

  // "Later" at forty answers is an answer about forty answers. Two hundred is
  // a different amount to lose, so it is worth asking once more — and only
  // once more per step, which the two checks above already hold it to.
  s = await page(conn, SECOND, { backupAsked: FIRST });
  const again = await shown(s);
  r.ok('at ' + SECOND + ' answers it asks again', !!again);
  if (again) r.ok('with the new number in it', again.body.indexOf(String(SECOND)) > -1, again.body);

  s = await page(conn, SECOND, { backupAsked: SECOND });
  r.ok('but not twice at the same size', (await shown(s)) === null);

  return r.done();
}

run().then(n => process.exit(n ? 1 : 0),
  e => { console.error(e); process.exit(1); });
