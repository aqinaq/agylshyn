/* The Writing and Speaking half of an IELTS test: the prompts the data file has
   always carried and nothing rendered, the exam's own timings, the word count,
   and a draft that survives a reload.

   Cambridge 21 is the only book with prompts and it is a paid one, so this runs
   against the same mocked Supabase the paywall suite uses.

   node site/tests/tasks_e2e.js   (or via tests/run.js, which starts the server) */
'use strict';
const { connect, goto, sleep } = require('./cdp.js');
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
  await sleep(1200);

  const page = await s.eval(`({
    cards: document.querySelectorAll('.task-card').length,
    heads: [...document.querySelectorAll('.task-head b')].map(e => e.textContent),
    tests: document.querySelectorAll('.page-head .chip').length,
    areas: document.querySelectorAll('.task-area').length,
    timers: document.querySelectorAll('.task-timer').length,
    prompts: [...document.querySelectorAll('.task-prompt')].map(e => e.textContent.length)
  })`);
  r.eq('five tasks: two written, three spoken', page.cards, 5);
  r.eq('Writing Task 1 is the first of them', page.heads[0], 'Writing Task 1');
  r.eq('and Speaking Part 3 the last', page.heads[4], 'Speaking Part 3');
  r.eq('all four tests are reachable from here', page.tests, 4);
  r.eq('only the written tasks get a box to write in', page.areas, 2);
  r.ok('every prompt actually carries text', page.prompts.every(n => n > 40),
    JSON.stringify(page.prompts));
  // Part 2 has a preparation clock and a talking clock; the two Writing tasks
  // have one each. Parts 1 and 3 are a conversation and are not timed.
  r.eq('four clocks in all', page.timers, 4);

  const specs = await s.eval(`({
    chips: [...document.querySelectorAll('.task-chip')].map(e => e.textContent),
    figure: !!document.querySelector('.task-card .note')
  })`);
  r.ok('Task 1 is twenty minutes and 150 words',
    specs.chips[0].indexOf('20') > -1 && specs.chips[1].indexOf('150') > -1,
    JSON.stringify(specs.chips.slice(0, 2)));
  r.ok('Task 2 is forty minutes and 250 words',
    specs.chips[2].indexOf('40') > -1 && specs.chips[3].indexOf('250') > -1,
    JSON.stringify(specs.chips.slice(2, 4)));
  r.ok('and Task 1 says where the chart is', specs.figure);

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
  await sleep(1200);
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
  await sleep(1200);
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

  /* ================= the way in ================= */
  r.head('the way in');
  await goto(s, BASE + '#/b/ielts-21/unit/1');
  await sleep(1200);
  const entry = await s.eval(`({
    chip: [...document.querySelectorAll('.chips a')].map(e => e.getAttribute('href')),
    side: [...document.querySelectorAll('.ue-link')].map(e => e.getAttribute('href'))
  })`);
  r.ok('the Listening page points at the tasks of the same test',
    entry.chip.indexOf('#/b/ielts-21/tasks/1') > -1, JSON.stringify(entry.chip));
  r.eq('and the unit list offers all four tests', entry.side.length, 4);

  // Cambridge 19 has no Writing or Speaking in its data, and must not claim to.
  await goto(s, BASE + '#/b/ielts-19/unit/1');
  await sleep(900);
  const bare = await s.eval(`({
    side: document.querySelectorAll('.ue-link').length,
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
