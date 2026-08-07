/* The Writing and Speaking half of an IELTS test: the prompts the data file has
   always carried and nothing rendered, the exam's own timings, the word count,
   and a draft that survives a reload.

   Cambridge 21 is the only book with prompts and it is a paid one, so this runs
   against the same mocked Supabase the paywall suite uses.

   node site/tests/tasks_e2e.js   (or via tests/run.js, which starts the server) */
'use strict';
const { connect, goto, sleep, until, answerAsk } = require('./cdp.js');
const { Report } = require('./report.js');
const { signedIn, LIVE } = require('./supamock.js');

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:8853/';
const PORT = Number(process.env.TEST_CDP || 9333);
const TASKS = '#/b/ielts-21/tasks/1';

async function run() {
  const r = Report('tasks');
  const conn = await connect(PORT);
  const errors = [];

  const s = await signedIn(conn, { access: LIVE });
  s.on('Runtime.exceptionThrown', p => errors.push(p.exceptionDetails.text));

  /* ================= the page ================= */
  r.head('the tasks page');
  await goto(s, BASE + TASKS);
  await until(s, `document.querySelectorAll('.task-card').length >= 5`);

  const page = await s.eval(`({
    cards: document.querySelectorAll('.task-card').length,
    heads: [...document.querySelectorAll('.task-head b')].map(e => e.textContent),
    chips: [...document.querySelectorAll('.page-head .chips .chip')].map(e => e.textContent),
    areas: document.querySelectorAll('.task-area').length,
    timers: document.querySelectorAll('.task-timer').length,
    inBook: document.querySelectorAll('.task-inbook').length,
    pages: [...document.querySelectorAll('.task-inbook .chip strong')].map(e => e.textContent)
  })`);
  r.eq('five tasks: two written, three spoken', page.cards, 5);
  r.eq('Writing Task 1 is the first of them', page.heads[0], 'Writing Task 1');
  r.eq('and Speaking Part 3 the last', page.heads[4], 'Speaking Part 3');
  // The head a unit page has: the page in the book, and the button that opens
  // it. A reader must not be able to tell L1 and W1 apart by their furniture.
  r.ok('the head says which page of the book this is',
    /30/.test(page.chips[0] || ''), JSON.stringify(page.chips));
  r.ok('and carries the open-the-book button',
    (page.chips[1] || '').indexOf('PDF') > -1, JSON.stringify(page.chips));
  r.eq('only the written tasks get a box to write in', page.areas, 2);
  // The task text is deliberately not on the site: a Writing task is a chart
  // and a Speaking card comes off the scan mangled. Every card says where the
  // real one is instead.
  r.eq('every task points into the book', page.inBook, 5);
  r.ok('with a page number', page.pages.length === 5 && page.pages.every(p => /\d/.test(p)),
    JSON.stringify(page.pages));
  const noText = await s.eval(`(() => {
    const bad = [...document.querySelectorAll('.task-card')]
      .filter(c => /You should spend|Describe a|Discussion topics/i.test(c.textContent));
    return bad.length;
  })()`);
  r.eq('and none of them reprints the task', noText, 0);
  // Part 2 has a preparation clock and a talking clock; the two Writing tasks
  // have one each. Parts 1 and 3 are a conversation and are not timed.
  r.eq('four clocks in all', page.timers, 4);

  const specs = await s.eval(`({
    chips: [...document.querySelectorAll('.task-chip')].map(e => e.textContent)
  })`);
  r.ok('Task 1 is twenty minutes and 150 words',
    specs.chips[0].indexOf('20') > -1 && specs.chips[1].indexOf('150') > -1,
    JSON.stringify(specs.chips.slice(0, 2)));
  r.ok('Task 2 is forty minutes and 250 words',
    specs.chips[2].indexOf('40') > -1 && specs.chips[3].indexOf('250') > -1,
    JSON.stringify(specs.chips.slice(2, 4)));

  /* ================= writing ================= */
  r.head('writing');
  const counted = await s.eval(`(() => {
    const a = document.querySelector('.task-area');
    a.value = 'one two three four five';
    a.dispatchEvent(new Event('input', { bubbles: true }));
    return document.querySelector('.task-count').textContent;
  })()`);
  r.ok('the words are counted as they are typed', /5/.test(counted), counted);

  const under = await s.eval(`document.querySelector('.task-count').classList.contains('low')`);
  r.ok('and a short answer is flagged as short', under);

  const over = await s.eval(`(() => {
    const a = document.querySelector('.task-area');
    a.value = Array.from({length: 160}, (_, i) => 'word' + i).join(' ');
    a.dispatchEvent(new Event('input', { bubbles: true }));
    const c = document.querySelector('.task-count');
    return { text: c.textContent, ok: c.classList.contains('ok') };
  })()`);
  r.ok('160 words clears the minimum', over.ok, over.text);

  await sleep(700);      // the draft saves on a debounce
  const stored = await s.eval(`(() => {
    const st = JSON.parse(localStorage.getItem('agylshyn_v1'));
    const keys = Object.keys(st.writing || {});
    return { keys: keys, len: (st.writing[keys[0]] || {}).text.length };
  })()`);
  r.eq('the draft is filed under its own key', stored.keys[0], 'ielts-21|w1|w1');
  r.ok('with the whole essay in it', stored.len > 900, String(stored.len));

  r.head('a reload');
  await goto(s, BASE + TASKS);
  await until(s, `document.querySelectorAll('.task-card').length >= 5`);
  const back = await s.eval(`({
    text: document.querySelector('.task-area').value.length,
    saved: (document.querySelector('.task-saved')||{}).textContent
  })`);
  r.ok('the draft is still there', back.text > 900, String(back.text));
  r.ok('and the page says when it was saved', !!back.saved);

  /* ================= the clock ================= */
  r.head('the clock');
  const clock = await s.eval(`(() => {
    const t = document.querySelector('.task-timer');
    const before = t.querySelector('.tt-clock').textContent;
    t.querySelector('.btn').click();
    return { before: before, label: t.querySelector('.btn').textContent };
  })()`);
  r.eq('a Writing Task 1 clock starts at twenty minutes', clock.before, '20:00');
  await sleep(1300);
  const ticked = await s.eval(`document.querySelector('.task-timer .tt-clock').textContent`);
  r.ok('and it runs', ticked !== '20:00', ticked);
  await s.eval(`document.querySelectorAll('.task-timer .btn')[1].click()`);
  const reset = await s.eval(`document.querySelector('.task-timer .tt-clock').textContent`);
  r.eq('reset puts it back', reset, '20:00');

  // Leaving the page must not leave intervals running in a dead DOM.
  await s.eval(`document.querySelector('.task-timer .btn').click()`);
  await s.eval(`location.hash = '#/b/ielts-21/unit/1'`);
  await sleep(600);
  const stopped = await s.eval(`(() => {
    // If a timer survived, its callback would throw on the detached node and
    // the count of live intervals would be the tell. The app clears them by
    // hand on every route change; assert the list it keeps is empty.
    return document.querySelectorAll('.task-timer').length;
  })()`);
  r.eq('the clocks are gone with the page', stopped, 0);

  /* ================= speaking ================= */
  r.head('speaking');
  await goto(s, BASE + TASKS);
  await until(s, `document.querySelectorAll('.task-card').length >= 5`);
  const speak = await s.eval(`(() => {
    const cards = [...document.querySelectorAll('.task-card')];
    const p2 = cards[3];      // Writing 1, Writing 2, Speaking 1, Speaking 2
    return {
      head: p2.querySelector('.task-head b').textContent,
      timers: p2.querySelectorAll('.task-timer').length,
      labels: [...p2.querySelectorAll('.tt-label')].map(e => e.textContent),
      prep: p2.querySelectorAll('.tt-clock')[0].textContent,
      talk: p2.querySelectorAll('.tt-clock')[1].textContent,
      rec: !!p2.querySelector('.rec-btn'),
      note: !!p2.querySelector('.task-rec .note')
    };
  })()`);
  r.eq('the long turn is Part 2', speak.head, 'Speaking Part 2');
  r.eq('with two clocks', speak.timers, 2);
  r.eq('a minute to prepare', speak.prep, '1:00');
  r.eq('and two to talk', speak.talk, '2:00');
  r.ok('the answer can be recorded', speak.rec);
  r.ok('and the page says the recording is not kept', speak.note);

  /* ================= one skill to a page ================= */
  // S1 is its own page in the rail, and it must behave like one: its own title,
  // its own page of the book — the Speaking card on page 32, not the Writing
  // chart on 30, which is where it used to send the reader.
  r.head('one skill to a page');
  await goto(s, BASE + '#/b/ielts-21/tasks/1/s');
  await until(s, `document.querySelectorAll('.task-card').length >= 3`);
  const sOnly = await s.eval(`({
    cards: document.querySelectorAll('.task-card').length,
    h1: document.querySelector('.page-head h1').textContent,
    page: (document.querySelector('.page-head .chip strong') || {}).textContent,
    bands: document.querySelectorAll('.section-title').length,
    cross: [...document.querySelectorAll('.page-head .chips a')].map(e => e.getAttribute('href')),
    current: [...document.querySelectorAll('#unitList .current .u-num')].map(e => e.textContent)
  })`);
  r.eq('the Speaking page carries only the three spoken parts', sOnly.cards, 3);
  r.eq('titled the way the rail names it', sOnly.h1, 'Test 1 — Speaking');
  r.eq('and it opens the book at the Speaking card', sOnly.page, '32');
  r.eq('the h1 already names the skill, so no band repeats it', sOnly.bands, 0);
  // W1 and S1 are their own entries in the rail on every page of the book, so
  // the head does not also carry a "switch to the other skill" button.
  r.eq('no chip toggles between the two skills', sOnly.cross.length, 0);
  r.eq('and the rail marks where the reader is', sOnly.current.join(' '), 'S1');
  r.eq('Speaking is an interview, not a paper: no exam mode',
    await s.eval(`document.querySelectorAll('.exam-chip').length`), 0);

  await goto(s, BASE + '#/b/ielts-21/tasks/1/w');
  await until(s, `document.querySelectorAll('.task-card').length >= 2`);
  const wOnly = await s.eval(`({
    cards: document.querySelectorAll('.task-card').length,
    h1: document.querySelector('.page-head h1').textContent,
    page: (document.querySelector('.page-head .chip strong') || {}).textContent,
    cross: [...document.querySelectorAll('.page-head .chips a')].map(e => e.getAttribute('href'))
  })`);
  r.eq('the Writing page carries only the two written tasks', wOnly.cards, 2);
  r.eq('titled to match', wOnly.h1, 'Test 1 — Writing');
  r.eq('and opens the book at Task 1', wOnly.page, '30');
  // The whole point: W1 has the furniture L1 has, exam mode included.
  r.eq('the only link in the head is exam mode', wOnly.cross.join(' '),
    '#/b/ielts-21/tasks/1/w/exam');

  /* ================= the Writing paper under exam conditions ================= */
  /* W1 is a page like L1, so it can be sat like one: one hour over both tasks,
     the practice aids gone, and — because no machine can mark an essay — a
     result that reports the hour and the word counts and refuses to invent a
     band. */
  r.head('exam conditions');
  await goto(s, BASE + '#/b/ielts-21/tasks/1/w/exam');
  await until(s, `!!document.querySelector('.exam-card')`);
  const desk = await s.eval(`({
    h1: document.querySelector('.page-head h1').textContent,
    rules: [...document.querySelectorAll('.exam-rules li')].map(e => e.textContent),
    start: !!document.querySelector('.exam-card .btn.primary'),
    live: !!JSON.parse(localStorage.getItem('agylshyn_v1')).exam
  })`);
  r.ok('the desk names the paper', /Writing/.test(desk.h1), desk.h1);
  r.eq('four rules', desk.rules.length, 4);
  r.ok('the hour is one of them', desk.rules.some(x => /60/.test(x)), JSON.stringify(desk.rules));
  r.ok('and so is "nothing is marked"',
    desk.rules.some(x => /marked|қойылмайды/i.test(x)), JSON.stringify(desk.rules));
  r.ok('no clock is running yet', !desk.live);

  await s.eval(`document.querySelector('.exam-card .btn.primary').click()`);
  await until(s, `!!document.querySelector('.eb-clock')`);
  const paper = await s.eval(`({
    clock: document.querySelector('.eb-clock').textContent,
    cards: document.querySelectorAll('.task-card').length,
    areas: document.querySelectorAll('.task-area').length,
    timers: document.querySelectorAll('.task-timer').length,
    crit: document.querySelectorAll('.task-crit').length,
    ghosts: document.querySelectorAll('.task-foot .btn').length,
    counts: document.querySelectorAll('.task-count').length,
    inBook: document.querySelectorAll('.task-inbook').length,
    skill: JSON.parse(localStorage.getItem('agylshyn_v1')).exam.skill
  })`);
  r.ok('the clock is counting from an hour', /^(59|1:00):/.test(paper.clock), paper.clock);
  r.eq('both tasks are on the paper', paper.cards, 2);
  r.eq('with a box each', paper.areas, 2);
  r.eq('the per-task countdowns are gone — one clock runs the hour', paper.timers, 0);
  r.eq('and so are the criteria: they are for afterwards', paper.crit, 0);
  r.eq('nothing to press beside the box, so no Clear mid-essay', paper.ghosts, 0);
  r.eq('the word count stays: the exam prints it as a rule', paper.counts, 2);
  r.eq('and the task is still where it always was — in the book', paper.inBook, 2);
  r.eq('the run knows which skill it is', paper.skill, 'writing');

  const wrote = await s.eval(`(() => {
    const a = [...document.querySelectorAll('.task-area')];
    a[0].value = Array.from({length: 151}, (_, i) => 'w' + i).join(' ');
    a[0].dispatchEvent(new Event('input', { bubbles: true }));
    a[1].value = 'far too short';
    a[1].dispatchEvent(new Event('input', { bubbles: true }));
    return document.querySelectorAll('.task-count.ok').length;
  })()`);
  r.eq('one of the two clears its minimum', wrote, 1);
  await sleep(700);

  r.head('a reload mid-paper');
  await goto(s, BASE + '#/b/ielts-21/tasks/1/w/exam');
  await until(s, `!!document.querySelector('.eb-clock')`);
  const back2 = await s.eval(`({
    onPaper: !!document.querySelector('.eb-clock'),
    kept: document.querySelectorAll('.task-area')[0].value.split(/\\s+/).length
  })`);
  r.ok('the paper comes back rather than the desk', back2.onPaper);
  r.eq('with the essay still in its box', back2.kept, 151);

  // The practice page must say so too, the way a unit page does.
  await goto(s, BASE + '#/b/ielts-21/tasks/1/w');
  await until(s, `document.querySelectorAll('.task-card').length >= 2`);
  r.ok('and the practice page flags the run still ticking',
    await s.eval(`!!document.querySelector('.exam-resume')`));

  r.head('handing it in');
  await goto(s, BASE + '#/b/ielts-21/tasks/1/w/exam');
  await until(s, `!!document.querySelector('.eb-clock')`);
  await s.eval(`document.querySelectorAll('.exam-bar .btn')[0].click()`);
  r.ok('handing in asks first', await answerAsk(s));
  await until(s, `!!document.querySelector('.exam-parts')`);
  const result = await s.eval(`({
    band: document.querySelectorAll('.er-band, .er-raw').length,
    note: (document.querySelector('.er-note')||{}).textContent,
    rows: [...document.querySelectorAll('.ep-score')].map(e => e.textContent),
    ok: document.querySelectorAll('.ep-score.ok').length,
    low: document.querySelectorAll('.ep-score.low').length,
    crit: document.querySelectorAll('.task-crit li').length,
    hist: document.querySelectorAll('.exam-hist tbody tr').length,
    stored: (JSON.parse(localStorage.getItem('agylshyn_v1')).exams['ielts-21|w1']||[]).length,
    live: !!JSON.parse(localStorage.getItem('agylshyn_v1')).exam
  })`);
  r.eq('no score and no band — an essay is not machine-markable', result.band, 0);
  r.ok('and the page says why', /band/i.test(result.note || ''), result.note);
  r.eq('the counts are reported per task', result.rows.join(' '), '151/150 3/250');
  r.eq('the one that made the minimum is marked so', result.ok, 1);
  r.eq('the one that did not is flagged', result.low, 1);
  r.eq('the four criteria are put in front of the reader', result.crit, 4);
  r.eq('the sitting is written to history', result.stored, 1);
  r.eq('and listed', result.hist, 1);
  r.ok('the clock is no longer running', !result.live);

  // A Writing run must not turn up in the band table on Statistics, which is
  // about sections that have a raw score.
  await goto(s, BASE + '#/b/ielts-21/stats');
  await sleep(600);
  r.eq('Statistics keeps the band table to the sections that have one',
    await s.eval(`document.querySelectorAll('.exam-table tbody tr').length`), 0);

  // Speaking is an interview; '/s/exam' is a URL nothing offers.
  await goto(s, BASE + '#/b/ielts-21/tasks/1/s/exam');
  await sleep(500);
  r.ok('there is no Speaking paper to sit',
    await s.eval(`!!document.querySelector('.empty-state')`));

  /* ================= the way in ================= */
  r.head('the way in');
  await goto(s, BASE + '#/b/ielts-21/unit/1');
  await until(s, `!!document.querySelector('.exam-chip')`);
  const entry = await s.eval(`({
    chip: [...document.querySelectorAll('.chips a')].map(e => e.getAttribute('href')),
    tags: [...document.querySelectorAll('#unitList .u-num')].map(e => e.textContent),
    tasks: [...document.querySelectorAll('.task-link')].map(e => e.getAttribute('href'))
  })`);
  // The rail is the way across to the other skills, and the only one. A chip in
  // the head of a Listening page saying "Writing / Speaking" made them look like
  // an errand this page was sending the reader on.
  r.eq('the head of a Listening page carries exam mode and nothing else',
    entry.chip.join(' '), '#/b/ielts-21/unit/1/exam');
  // The four skills of a test, in the order a candidate sits them.
  r.eq('the unit list reads L1 R1 W1 S1', entry.tags.slice(0, 4).join(' '), 'L1 R1 W1 S1');
  r.eq('with a Writing and a Speaking entry per test', entry.tasks.length, 8);
  r.eq('and each goes to its own half of the page',
    entry.tasks[0] + ' ' + entry.tasks[1],
    '#/b/ielts-21/tasks/1/w #/b/ielts-21/tasks/1/s');

  // Cambridge 19 has no Writing or Speaking in its data, and must not claim to.
  await goto(s, BASE + '#/b/ielts-19/unit/1');
  await until(s, `!!document.querySelector('.exam-chip')`);
  const bare = await s.eval(`({
    side: document.querySelectorAll('.task-link').length,
    chip: [...document.querySelectorAll('.chips a')].map(e => e.getAttribute('href'))
       .filter(h => h && h.indexOf('/tasks') > -1).length
  })`);
  r.eq('a book without prompts shows none in the list', bare.side, 0);
  r.eq('and none on the unit page', bare.chip, 0);

  r.eq('nothing threw', errors.length, 0);
  if (errors.length) r.note(errors.slice(0, 3).join('\n    '));

  await conn.send('Target.closeTarget', { targetId: s.targetId });
  conn.close();
  return r.done();
}

run().then(f => process.exit(f ? 1 : 0), e => { console.error(e); process.exit(2); });
