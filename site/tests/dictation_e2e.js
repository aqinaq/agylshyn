/* The transcript and the dictation built on it: the gaps, the marking, the
   best-score memory, the reading mode — and the fact that none of it is within
   reach while an exam is being sat.

   Cambridge 21 is the only book whose audioscripts are in the PDF as text, and
   it is a paid one, so this runs against the mocked Supabase.

   node site/tests/dictation_e2e.js  (or via tests/run.js, which starts the server) */
'use strict';
const { connect, goto, sleep, until, answerAsk } = require('./cdp.js');
const { Report } = require('./report.js');
const { signedIn, LIVE, hasBook, NO_BOOK } = require('./supamock.js');

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:8853/';
const PORT = Number(process.env.TEST_CDP || 9333);
const UNIT = '#/b/ielts-21/unit/1';

const openPanel = `[...document.querySelectorAll('.ia-tools .btn')]
  .find(b => b.textContent.indexOf('✍') === 0).click()`;

const BOOK = 'ielts-21';

async function run() {
  const r = Report('dictation');
  const conn = await connect(PORT);
  const errors = [];

  // Cambridge 21 is the only book with audioscripts, and it is paid, so a
  // checkout without content/ has nothing for this suite to read.
  if (!hasBook(BOOK)) {
    r.note(NO_BOOK(BOOK));
    return r.done();
  }

  const s = await signedIn(conn, { access: LIVE });
  s.on('Runtime.exceptionThrown', p => errors.push(p.exceptionDetails.text));

  /* ================= the data ================= */
  r.head('the transcripts');
  await goto(s, BASE + UNIT);
  await until(s, `document.querySelectorAll('.ielts-audio').length === 4`);

  const parts = await s.eval(`document.querySelectorAll('.ielts-audio').length`);
  r.eq('the test has four recordings', parts, 4);

  const tools = await s.eval(`({
    speeds: [...document.querySelector('.ia-tools').querySelectorAll('.speed')].map(b => b.textContent),
    back: !!document.querySelector('.ia-tools .btn'),
    dict: [...document.querySelectorAll('.ia-tools .btn')].filter(b => b.textContent.indexOf('✍') === 0).length
  })`);
  r.eq('three playback speeds, normal in the middle', tools.speeds.join('|'), '0.75×|1×|1.25×');
  r.eq('and every part offers its transcript', tools.dict, 4);

  /* ================= the exercise ================= */
  r.head('the dictation');
  await s.eval(openPanel);
  await sleep(400);
  const panel = await s.eval(`({
    tabs: document.querySelectorAll('.dict-tab').length,
    lines: document.querySelectorAll('.dict-line').length,
    gaps: document.querySelectorAll('.dict-gap').length,
    hasWords: document.querySelector('.dict-line').textContent.trim().length > 20,
    everyGapKnowsItsWord: [...document.querySelectorAll('.dict-gap')]
      .every(i => (i.getAttribute('data-word') || '').length > 2)
  })`);
  r.ok('the transcript is cut into blocks', panel.tabs > 5, String(panel.tabs));
  r.eq('a block is six sentences', panel.lines, 6);
  r.ok('with gaps to fill', panel.gaps > 3, String(panel.gaps));
  r.ok('and text around them', panel.hasWords);
  r.ok('every gap carries the word it hid', panel.everyGapKnowsItsWord);

  const marked = await s.eval(`(() => {
    const g = [...document.querySelectorAll('.dict-gap')];
    // One right, one right but sloppily typed, one wrong.
    g[0].value = g[0].getAttribute('data-word');
    g[1].value = g[1].getAttribute('data-word').toUpperCase() + '.';
    g[2].value = 'nonsense';
    document.querySelector('.dict-foot .primary').click();
    return {
      score: document.querySelector('.dict-score').textContent,
      ok: g[0].classList.contains('ok'),
      sloppyOk: g[1].classList.contains('ok'),
      bad: g[2].classList.contains('bad'),
      shown: [...document.querySelectorAll('.dict-was')].map(e => e.textContent),
      total: g.length
    };
  })()`);
  r.ok('two of them are marked right', marked.ok && marked.sloppyOk);
  r.ok('case and a stray full stop do not fail an answer', marked.sloppyOk);
  r.ok('a wrong one is marked wrong', marked.bad);
  r.eq('the score counts what was right', marked.score, '2 / ' + marked.total);
  r.ok('and every miss shows what was actually said',
    marked.shown.length === marked.total - 2, JSON.stringify(marked.shown.slice(0, 3)));

  await sleep(400);
  const stored = await s.eval(`(() => {
    const d = JSON.parse(localStorage.getItem('agylshyn_v1')).dictation || {};
    const k = Object.keys(d);
    return { keys: k, first: k.length ? d[k[0]] : null };
  })()`);
  r.eq('the block score is filed under its own key', stored.keys[0], 'ielts-21|d1|1|0');
  r.eq('with what was right', stored.first && stored.first.ok, 2);

  // A worse second attempt must not overwrite a better first one.
  const kept = await s.eval(`(() => {
    document.querySelectorAll('.dict-foot .btn')[2].click();     // clear
    document.querySelector('.dict-foot .primary').click();       // check nothing
    return JSON.parse(localStorage.getItem('agylshyn_v1')).dictation['ielts-21|d1|1|0'].ok;
  })()`);
  r.eq('a worse attempt does not replace the best one', kept, 2);

  const cleared = await s.eval(`(() => {
    document.querySelectorAll('.dict-foot .btn')[2].click();     // clear again
    return {
      values: [...document.querySelectorAll('.dict-gap')].filter(i => i.value).length,
      marks: document.querySelectorAll('.dict-gap.ok, .dict-gap.bad, .dict-was').length
    };
  })()`);
  r.eq('clearing empties the boxes', cleared.values, 0);
  r.eq('and takes the answers back off the page', cleared.marks, 0);

  /* ================= reading mode ================= */
  r.head('reading along');
  const read = await s.eval(`(() => {
    document.querySelector('.dict-head .btn').click();
    return {
      paras: document.querySelectorAll('.dict-script p').length,
      gaps: document.querySelectorAll('.dict-gap').length,
      text: document.querySelector('.dict-script p').textContent.length
    };
  })()`);
  r.ok('the whole transcript is readable', read.paras > 30, String(read.paras));
  r.eq('with nothing hidden', read.gaps, 0);
  r.ok('and it is real text', read.text > 15);

  /* ================= not during an exam ================= */
  r.head('under exam conditions');
  await goto(s, BASE + UNIT + '/exam');
  await until(s, `!!document.querySelector('.exam-card .btn.primary')`);
  await s.eval(`document.querySelector('.exam-card .btn.primary').click()`);
  await sleep(600);
  const inExam = await s.eval(`({
    audio: document.querySelectorAll('.ielts-audio audio').length,
    tools: document.querySelectorAll('.ia-tools').length,
    dict: document.querySelectorAll('.dict-panel').length
  })`);
  r.eq('the recordings are still playable', inExam.audio, 4);
  r.eq('but the transcript is not on the page', inExam.dict, 0);
  r.eq('and neither is the slow-it-down bar', inExam.tools, 0);

  await s.eval(`[...document.querySelectorAll('.exam-bar .btn')][1].click()`);  // abandon
  await answerAsk(s);

  r.eq('nothing threw', errors.length, 0);
  if (errors.length) r.note(errors.slice(0, 3).join('\n    '));

  await conn.send('Target.closeTarget', { targetId: s.targetId });
  conn.close();
  return r.done();
}

run().then(f => process.exit(f ? 1 : 0), e => { console.error(e); process.exit(2); });
