/* The free sample of a paid book: a locked book opening onto its first units
   instead of a bare lock, everything that has to say it is only a sample, the
   units that are still shut, and the whole book arriving the moment somebody
   pays.

   node site/tests/sample_e2e.js  (or via tests/run.js, which starts the server) */
'use strict';
const fs = require('fs');
const path = require('path');
const { connect, goto, sleep } = require('./cdp.js');
const { Report } = require('./report.js');
const { mock, signedIn, LIVE, PAID, hasBook, NO_BOOK } = require('./supamock.js');

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:8853/';
const PORT = Number(process.env.TEST_CDP || 9333);
const SITE = path.resolve(__dirname, '..');

/* A locked book takes two round trips to open — the paid fetch has to be
   refused before the sample is asked for — and against a mocked Supabase that
   is long enough for a fixed sleep to be a coin toss. Poll instead. */
async function until(s, expr, ms) {
  const stop = Date.now() + (ms || 8000);
  for (;;) {
    if (await s.eval(expr)) return true;
    if (Date.now() > stop) return false;
    await sleep(120);
  }
}

async function run() {
  const r = Report('sample');
  const conn = await connect(PORT);
  const errors = [];

  /* ================= what is on disk ================= */
  r.head('the files');
  const tiers = JSON.parse(fs.readFileSync(path.join(SITE, 'tools/tiers.json'), 'utf8'));
  const cfg = tiers.sample || {};
  const dir = path.join(SITE, 'data/sample');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')) : [];
  const want = [...PAID].filter(id => (cfg[id] !== undefined ? cfg[id] : cfg.default) > 0);
  r.eq('every paid book with a sample has one on disk', files.length, want.length);

  let sane = true, tooMuch = null;
  for (const f of files) {
    const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const id = f.slice(0, -5);
    const take = cfg[id] !== undefined ? cfg[id] : cfg.default;
    if (!s.sample || s.units.length !== take || !s.unitsOf) sane = false;
    // The sample must be a slice, never the book.
    if (s.units.length >= s.unitsOf) tooMuch = id;
  }
  r.ok('each one is flagged, sized and knows the whole book', sane);
  r.ok('and none of them is the whole book', !tooMuch, String(tooMuch));

  /* ================= a reader who has not paid ================= */
  r.head('a locked book');
  let s = await signedIn(conn, { access: null });
  s.on('Runtime.exceptionThrown', p => errors.push(p.exceptionDetails.text));
  await goto(s, BASE + '#/b/vocab-upint/unit/1');
  await until(s, `!!document.querySelector('.sample-bar')`);

  const open = await s.eval(`({
    banner: !!document.querySelector('.sample-bar'),
    text: (document.querySelector('.sample-bar') || {}).textContent || '',
    rows: document.querySelectorAll('.answer-line input').length,
    units: document.querySelectorAll('#unitList .unit-link:not(.locked-link)').length,
    locked: !!document.querySelector('.locked-link'),
    lockScreen: !!document.querySelector('.empty-state')
  })`);
  r.ok('the book opens instead of showing a lock', !open.lockScreen);
  r.ok('there are questions to answer', open.rows > 3, String(open.rows));
  r.ok('a banner says this is a sample', open.banner, open.text.slice(0, 60));
  r.ok('and says how much of the book it is', /\d+/.test(open.text));
  r.eq('the unit list holds the sample only', open.units, 2);
  r.ok('with the rest of the book shown as locked', open.locked);

  const worked = await s.eval(`(() => {
    // Not every row can be machine-marked: the first of a unit may be a worked
    // example, and some are self-check. Take the first with a Check button.
    const btn = document.querySelector('.answer-line .btn.primary');
    const row = btn.closest('.row');
    const input = row.querySelector('.answer-line input');
    input.value = 'something';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    btn.click();
    return { marked: !!document.querySelector('.row.correct, .row.wrong') };
  })()`);
  r.ok('an answer in the sample is marked like any other', worked.marked);
  // The store is written on a debounce.
  await sleep(400);
  const stored = await s.eval(`Object.keys(JSON.parse(localStorage.getItem('agylshyn_v1')).items)
    .filter(k => k.indexOf('vocab-upint|') === 0).length`);
  r.ok('and recorded like any other', stored > 0, String(stored));

  /* ================= what is still shut ================= */
  r.head('the rest of the book');
  await goto(s, BASE + '#/b/vocab-upint/unit/40');
  await until(s, `!!document.querySelector('.empty-state')`);
  const deep = await s.eval(`({
    lock: !!document.querySelector('.empty-state'),
    offer: !!document.querySelector('.offer'),
    notFound: document.body.textContent.indexOf('🤔') > -1
  })`);
  r.ok('a unit outside the sample is locked', deep.lock);
  r.ok('and is not reported as a missing page', !deep.notFound);

  await goto(s, BASE + '#/b/vocab-upint/unlock');
  await until(s, `!!document.querySelector('.empty-state')`);
  const unlock = await s.eval(`({
    lock: !!document.querySelector('.empty-state'),
    plans: document.querySelectorAll('.plan').length
  })`);
  r.ok('the banner button has a page to point at', unlock.lock);

  /* ================= a book with no sample ================= */
  // Every paid book has one today; the code path that matters is a fetch that
  // 404s, which is what a book with `"sample": 0` would do.
  r.head('a book whose sample is missing');
  const gone = await s.eval(`(async () => {
    const r = await fetch('data/sample/does-not-exist.json');
    return r.status;
  })()`);
  r.eq('a missing sample file is a 404, not an error page', gone, 404);

  /* ================= paying ================= */
  // Everything above is about the SAMPLE, which is a published file and is
  // always here. This last part is about what a subscriber gets instead, and
  // that needs the paid book itself — not in a fresh checkout.
  r.head('after paying');
  if (!hasBook('vocab-upint')) {
    r.note(NO_BOOK('vocab-upint'));
  } else {
    await conn.send('Target.closeTarget', { targetId: s.targetId });
    s = await signedIn(conn, { access: LIVE });
    s.on('Runtime.exceptionThrown', p => errors.push(p.exceptionDetails.text));
    await goto(s, BASE + '#/b/vocab-upint/unit/1');
    await until(s, `document.querySelectorAll('#unitList .unit-link').length > 50`);
    const paid = await s.eval(`({
      banner: !!document.querySelector('.sample-bar'),
      units: document.querySelectorAll('#unitList .unit-link').length,
      locked: !!document.querySelector('.locked-link')
    })`);
    r.ok('a subscriber gets the whole book', paid.units > 50, String(paid.units));
    r.ok('with no sample banner', !paid.banner);
    r.ok('and nothing locked in the list', !paid.locked);
  }

  /* ================= a free book is untouched ================= */
  r.head('a free book');
  await goto(s, BASE + '#/b/grammar/unit/1');
  await until(s, `document.querySelectorAll('#unitList .unit-link').length > 50`);
  const free = await s.eval(`({
    banner: !!document.querySelector('.sample-bar'),
    locked: !!document.querySelector('.locked-link')
  })`);
  r.ok('no banner', !free.banner);
  r.ok('nothing locked', !free.locked);

  r.eq('nothing threw', errors.length, 0);
  if (errors.length) r.note(errors.slice(0, 3).join('\n    '));

  await conn.send('Target.closeTarget', { targetId: s.targetId });
  conn.close();
  return r.done();
}

run().then(f => process.exit(f ? 1 : 0), e => { console.error(e); process.exit(2); });
