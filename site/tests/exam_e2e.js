/* Sitting a mock IELTS test in a real browser: the clock, answers that are not
   marked until the end, the score, the estimated band, the book's own verdict,
   and the run surviving a reload.

   Cambridge 19 is the book used throughout — it is the free one, so nothing
   here needs a subscription or a mocked Supabase.

   node site/tests/exam_e2e.js   (or via tests/run.js, which starts the server) */
'use strict';
const { connect, newContextPage, goto, sleep } = require('./cdp.js');
const { Report } = require('./report.js');

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:8853/';
const PORT = Number(process.env.TEST_CDP || 9333);
const UNIT = '#/b/ielts-19/unit/1';          // Test 1 — Listening

async function run() {
  const r = Report('exam');
  const conn = await connect(PORT);
  const errors = [];

  const s = await newContextPage(conn);
  s.on('Runtime.exceptionThrown', p => errors.push(p.exceptionDetails.text));

  /* ================= the tables ================= */
  r.head('the conversion tables');
  await goto(s, BASE);
  await sleep(500);

  const tables = await s.eval(`({
    l40: EXAM.bandFor('listening', 40),
    l30: EXAM.bandFor('listening', 30),
    l23: EXAM.bandFor('listening', 23),
    r30: EXAM.bandFor('reading', 30),
    r23: EXAM.bandFor('reading', 23),
    l2: EXAM.bandFor('listening', 2),
    monotone: (() => {
      for (const skill of ['listening','reading']) {
        let prev = -1;
        for (let n = 0; n <= 40; n++) {
          const b = EXAM.bandFor(skill, n);
          if (b == null) continue;
          if (b < prev) return skill + ' falls at ' + n;
          prev = b;
        }
      }
      return 'ok';
    })(),
    clock: [EXAM.clock(59), EXAM.clock(600), EXAM.clock(3600)].join('|'),
    limits: [EXAM.limitFor('listening'), EXAM.limitFor('reading')].join('|')
  })`);
  r.eq('40 right is band 9', tables.l40, 9);
  r.eq('30 in Listening is band 7', tables.l30, 7);
  r.eq('23 in Listening is band 6', tables.l23, 6);
  r.eq('30 in Reading is band 7', tables.r30, 7);
  r.eq('Reading is the harsher table at 23', tables.r23, 6);
  r.eq('a score too low to convert gets no band', tables.l2, null);
  r.eq('a higher raw score never means a lower band', tables.monotone, 'ok');
  r.eq('the clock reads mm:ss and grows an hour', tables.clock, '0:59|10:00|1:00:00');
  r.eq('the two sections have their own time', tables.limits, '2400|3600');

  // The chart is the book's own, and only where a book prints one we have read.
  const chart = await s.eval(`({
    low: EXAM.chartFor('ielts-21', 1, 'listening', 10),
    mid: EXAM.chartFor('ielts-21', 1, 'listening', 25),
    high: EXAM.chartFor('ielts-21', 1, 'listening', 35),
    edgeLow: EXAM.chartFor('ielts-21', 1, 'listening', 19),
    edgeMid: EXAM.chartFor('ielts-21', 1, 'listening', 20),
    perTest: EXAM.chartFor('ielts-21', 4, 'listening', 17),
    unknownBook: EXAM.chartFor('ielts-19', 1, 'listening', 30)
  })`);
  r.eq('a low score is the bottom verdict', chart.low, 'low');
  r.eq('a middling one is the middle verdict', chart.mid, 'mid');
  r.eq('a strong one is the top verdict', chart.high, 'high');
  r.eq('the bottom band includes its own top', chart.edgeLow, 'low');
  r.eq('and one more is the next band up', chart.edgeMid, 'mid');
  r.eq('Test 4 breaks at a different score than Test 1', chart.perTest, 'mid');
  r.eq('a book whose chart we never read offers none', chart.unknownBook, null);

  /* ================= the way in ================= */
  r.head('the way in');
  await goto(s, BASE + UNIT);
  await sleep(700);
  const entry = await s.eval(`({
    chip: !!document.querySelector('.exam-chip'),
    href: (document.querySelector('.exam-chip')||{}).getAttribute
            ? document.querySelector('.exam-chip').getAttribute('href') : null,
    band: !!document.querySelector('.band-chip')
  })`);
  r.ok('a test section offers exam conditions', entry.chip);
  r.eq('and the chip is a link to its own page', entry.href, UNIT + '/exam');

  // A grammar unit is not a paper and must not pretend to be one.
  await goto(s, BASE + '#/b/grammar/unit/1');
  await sleep(700);
  const grammar = await s.eval(`({
    chip: !!document.querySelector('.exam-chip'),
    band: !!document.querySelector('.band-chip')
  })`);
  r.ok('a grammar unit offers no exam', !grammar.chip);
  r.ok('and no band estimate', !grammar.band);

  /* ================= the paper ================= */
  r.head('the paper');
  await goto(s, BASE + UNIT + '/exam');
  await sleep(700);
  const desk = await s.eval(`({
    start: !!document.querySelector('.exam-card .btn.primary'),
    rules: document.querySelectorAll('.exam-rules li').length,
    running: !!window.localStorage.getItem('agylshyn_v1') &&
             !!(JSON.parse(localStorage.getItem('agylshyn_v1')).exam)
  })`);
  r.ok('the desk explains itself before anything starts', desk.start);
  r.eq('four rules', desk.rules, 4);
  r.ok('and no clock is running yet', !desk.running);

  await s.eval(`document.querySelector('.exam-card .btn.primary').click()`);
  await sleep(400);
  const paper = await s.eval(`({
    boxes: document.querySelectorAll('.answer-line input').length,
    checks: document.querySelectorAll('.answer-line .btn').length,
    keys: document.querySelectorAll('.key-btn').length,
    hints: document.querySelectorAll('.hint-btn').length,
    clock: (document.querySelector('.eb-clock')||{}).textContent,
    audio: document.querySelectorAll('.ielts-audio audio').length
  })`);
  r.eq('all forty questions are on the paper', paper.boxes, 40);
  r.eq('with nothing to press beside a box', paper.checks, 0);
  r.eq('no printed key within reach', paper.keys, 0);
  r.eq('no hints', paper.hints, 0);
  r.eq('the recordings are still there', paper.audio, 4);
  r.ok('and the clock is counting from forty minutes', /^(39|40):/.test(paper.clock || ''), paper.clock);

  // Answer the first ten correctly, straight out of the book's own key.
  const typed = await s.eval(`(async () => {
    const bk = await (await fetch('data/ielts-19.json')).json();
    const u = bk.units.find(x => x.unit === 1);
    const key = [];
    u.subExercises.forEach(s => s.items.forEach(it => key.push(it.answer)));
    const boxes = [...document.querySelectorAll('.answer-line input')];
    for (let i = 0; i < 10; i++) {
      boxes[i].value = String(key[i]).split('/')[0].trim();
      boxes[i].dispatchEvent(new Event('input', { bubbles: true }));
    }
    boxes[10].value = 'definitely not the answer';
    boxes[10].dispatchEvent(new Event('input', { bubbles: true }));
    return { first: boxes[0].value, marked: document.querySelectorAll('.row.correct, .row.wrong').length };
  })()`);
  r.ok('an answer can be typed', !!typed.first);
  r.eq('and nothing is marked while the clock runs', typed.marked, 0);

  /* ================= a reload mid-test ================= */
  r.head('a reload mid-test');
  await goto(s, BASE + UNIT + '/exam');
  await sleep(700);
  const after = await s.eval(`({
    onPaper: !!document.querySelector('.eb-clock'),
    kept: (document.querySelectorAll('.answer-line input')[0] || {}).value,
    boxes: document.querySelectorAll('.answer-line input').length
  })`);
  r.ok('the paper comes back rather than the desk', after.onPaper);
  r.eq('with the answers still in their boxes', after.kept, typed.first);

  /* ================= handing it in ================= */
  r.head('handing it in');
  await s.eval(`window.confirm = () => true`);
  await s.eval(`[...document.querySelectorAll('.exam-bar .btn')][0].click()`);
  await sleep(500);
  const result = await s.eval(`({
    raw: (document.querySelector('.er-raw')||{}).textContent,
    band: (document.querySelector('.er-band')||{}).textContent,
    note: !!document.querySelector('.er-note'),
    parts: document.querySelectorAll('.ep-row').length,
    hist: document.querySelectorAll('.exam-hist tbody tr').length,
    stored: (JSON.parse(localStorage.getItem('agylshyn_v1')).exams['ielts-19|1']||[]).length,
    live: !!JSON.parse(localStorage.getItem('agylshyn_v1')).exam,
    chart: !!document.querySelector('.er-chart')
  })`);
  r.eq('ten right out of forty', result.raw, '10/40');
  r.eq('which is band 4', result.band, '4.0');
  r.ok('the estimate says it is an estimate', result.note);
  r.eq('the marks are broken down by part', result.parts, 4);
  r.eq('the run is written to history', result.stored, 1);
  r.ok('and the clock is no longer running', !result.live);
  r.ok('Cambridge 19 prints no chart, so none is shown', !result.chart);

  // The marking is real: it went through applyAnswer like any other answer.
  const progress = await s.eval(`(() => {
    const st = JSON.parse(localStorage.getItem('agylshyn_v1'));
    const rows = Object.entries(st.items).filter(([k]) => k.indexOf('ielts-19|1|') === 0);
    return {
      correct: rows.filter(([,v]) => v.last === 'correct').length,
      wrong: rows.filter(([,v]) => v.last === 'wrong').length,
      total: rows.length
    };
  })()`);
  r.eq('every question was marked, including the blanks', progress.total, 40);
  r.eq('ten correct', progress.correct, 10);
  r.eq('and thirty wrong', progress.wrong, 30);

  /* ================= back on the practice page ================= */
  r.head('back on the practice page');
  await goto(s, BASE + UNIT);
  await sleep(700);
  const practice = await s.eval(`({
    band: (document.querySelector('.band-chip')||{}).textContent,
    verdicts: document.querySelectorAll('.row.correct, .row.wrong').length,
    resume: !!document.querySelector('.exam-resume')
  })`);
  r.ok('the score line now carries a band', /4\.0/.test(practice.band || ''), practice.band);
  r.eq('and every row shows its verdict again', practice.verdicts, 40);
  r.ok('no half-finished run is claimed', !practice.resume);

  const stats = await (async () => {
    await goto(s, BASE + '#/b/ielts-19/stats');
    await sleep(700);
    return s.eval(`({
      rows: document.querySelectorAll('.exam-table tbody tr').length,
      band: (document.querySelector('.exam-table .band')||{}).textContent
    })`);
  })();
  r.eq('statistics lists the sitting', stats.rows, 1);
  r.eq('with its band', stats.band, '4.0');

  r.eq('nothing threw', errors.length, 0);
  if (errors.length) r.note(errors.slice(0, 3).join('\n    '));

  await conn.send('Target.closeTarget', { targetId: s.targetId });
  conn.close();
  return r.done();
}

run().then(f => process.exit(f ? 1 : 0), e => { console.error(e); process.exit(2); });
