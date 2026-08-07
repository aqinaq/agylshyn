/* The main pass through the app in a real browser: the library, a book, an
   answer, the mistakes and statistics pages, a practice session, the word deck,
   a lookup, the placement quiz, search, and every book opening at all.

   node site/tests/app_e2e.js   (or via tests/run.js, which starts the server) */
'use strict';
const { connect, newContextPage, goto, sleep, until } = require('./cdp.js');
const { Report } = require('./report.js');

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:8853/';
const PORT = Number(process.env.TEST_CDP || 9333);

async function run() {
  const r = Report('app');
  const conn = await connect(PORT);
  const errors = [];

  const s = await newContextPage(conn);
  s.on('Runtime.consoleAPICalled', p => {
    if (p.type === 'error') errors.push((p.args || []).map(a => a.value || a.description).join(' '));
  });
  s.on('Runtime.exceptionThrown', p => {
    errors.push(p.exceptionDetails.text + ' ' + ((p.exceptionDetails.exception || {}).description || ''));
  });

  await goto(s, BASE);
  await sleep(700);

  /* ================= the library ================= */
  r.head('library');
  r.eq('the first load throws nothing', errors.length, 0);
  if (errors.length) r.note(errors.slice(0, 4).join('\n    '));

  // The expected totals come out of the shipped index, not out of this file:
  // they move whenever a book is rebuilt, and a test that has to be edited
  // after every build stops being run.
  const want = await s.eval(`(async () => {
    const idx = await (await fetch('data/index.json')).json();
    return { books: idx.length, units: idx.reduce((a,b)=>a+b.units,0),
             items: idx.reduce((a,b)=>a+b.tracked,0) };
  })()`);
  const home = await s.eval(`(() => ({
    view: document.body.getAttribute('data-view'),
    cards: document.querySelectorAll('#bookGrid a, #bookGrid .book-card').length,
    books: (window.BOOKS||[]).length,
    hsBooks: document.getElementById('hsBooks').textContent,
    hsUnits: document.getElementById('hsUnits').textContent,
    hsItems: document.getElementById('hsItems').textContent,
    blank: [...document.querySelectorAll('[data-i18n]')].filter(e=>!e.textContent.trim())
             .map(e=>e.getAttribute('data-i18n'))
  }))()`);
  r.eq('the library is what opens', home.view, 'home');
  r.ok('every book has a card', home.cards >= home.books, home.cards + ' cards for ' + home.books + ' books');
  const digits = t => t.replace(/[\s,  ]/g, '');
  r.eq('the headline book count is the real one', digits(home.hsBooks), String(want.books));
  r.eq('the headline unit count is the real one', digits(home.hsUnits), String(want.units));
  r.eq('the headline question count is the real one', digits(home.hsItems), String(want.items));
  r.ok('no label is left empty', home.blank.length === 0, home.blank.join(', '));

  /* The four tiles add the whole shelf together; the line under them says how
     much of it is coursebooks and how much is IELTS. The two have to reconcile,
     or one of them is lying. */
  const split = await s.eval(`(async () => {
    const box = document.getElementById('heroSplit');
    const idx = await (await fetch('data/index.json')).json();
    const kinds = Object.fromEntries((window.BOOKS||[]).map(b => [b.id, b.kind]));
    const sum = { course: { b:0, u:0, q:0 }, ielts: { b:0, u:0, q:0 } };
    for (const row of idx) {
      const g = sum[kinds[row.id] === 'ielts' ? 'ielts' : 'course'];
      g.b++; g.u += row.units; g.q += row.tracked;
    }
    const digits = t => (t.match(/[\\d][\\d\\s,. ]*/g) || [])
      .map(x => Number(x.replace(/[^\\d]/g, ''))).filter(n => n > 0);
    return {
      hidden: box.hidden,
      rows: [...box.querySelectorAll('.hs-row')].map(x => ({
        tag: x.querySelector('.hs-tag').textContent.trim(),
        nums: digits(x.querySelector('.hs-num').textContent)
      })),
      expected: sum
    };
  })()`);
  r.ok('the shelf is broken down under the tiles', !split.hidden);
  r.eq('into two groups', split.rows.length, 2);
  if (split.rows.length === 2) {
    const [course, ielts] = split.rows;
    r.ok('the IELTS row is labelled IELTS', /IELTS/i.test(ielts.tag), ielts.tag);
    r.ok('the other row is not', !/IELTS/i.test(course.tag), course.tag);
    r.ok('the coursebook figures are the coursebook figures',
      JSON.stringify(course.nums) === JSON.stringify([split.expected.course.b, split.expected.course.u, split.expected.course.q]),
      JSON.stringify(course.nums) + ' vs ' + JSON.stringify(split.expected.course));
    r.ok('the IELTS figures are the IELTS figures',
      JSON.stringify(ielts.nums) === JSON.stringify([split.expected.ielts.b, split.expected.ielts.u, split.expected.ielts.q]),
      JSON.stringify(ielts.nums) + ' vs ' + JSON.stringify(split.expected.ielts));
    // The whole point: the two halves have to be the total the tiles show.
    r.eq('the two halves add up to the headline books', course.nums[0] + ielts.nums[0], want.books);
    r.eq('and to the headline units', course.nums[1] + ielts.nums[1], want.units);
    r.eq('and to the headline questions', course.nums[2] + ielts.nums[2], want.items);
    r.note('course: ' + JSON.stringify(course.nums) + '   IELTS: ' + JSON.stringify(ielts.nums));
  }

  /* "answered" only appears once there is something to report, and then it has
     to be the same arithmetic as the tile. In a context of its own, with the
     progress planted before the document runs — seeding localStorage and then
     reloading does not work, because the reload fires pagehide and app.js
     flushes its empty in-memory state straight over the seed. */
  r.eq('a fresh visitor is not told "0 answered"',
    await s.eval(`document.querySelectorAll('#heroSplit .hs-done').length`), 0);

  {
    const items = {};
    for (let i = 1; i <= 5; i++) items['grammar|1|1.1|' + i] = { streak: 1, wrong: 0, last: 'correct', ts: Date.now(), val: 'x' };
    for (let i = 1; i <= 3; i++) items['ielts-20|1|1-10|' + i] = { streak: 1, wrong: 0, last: 'correct', ts: Date.now(), val: 'x' };
    const seeded = await newContextPage(conn);
    await seeded.send('Page.addScriptToEvaluateOnNewDocument', {
      source: 'try{localStorage.setItem("agylshyn_v1",'
        + JSON.stringify(JSON.stringify({ v: 1, items, daily: {}, books: {} })) + ')}catch(e){}'
    });
    await goto(seeded, BASE);
    await sleep(900);
    const doneRow = await seeded.eval(`(() => ({
      parts: [...document.querySelectorAll('#heroSplit .hs-done')]
               .map(x => Number(x.textContent.replace(/[^\\d]/g, ''))),
      tile: Number(document.getElementById('hsDone').textContent.replace(/[^\\d]/g, ''))
    }))()`);
    r.eq('once answers exist, both halves report their own', doneRow.parts.length, 2);
    r.ok('the coursebook half counts only coursebook answers',
      doneRow.parts[0] === 5, JSON.stringify(doneRow));
    r.ok('and the IELTS half only IELTS answers',
      doneRow.parts[1] === 3, JSON.stringify(doneRow));
    r.eq('together they are the headline "answered"',
      doneRow.parts.reduce((a, b) => a + b, 0), doneRow.tile);
    await seeded.send('Target.closeTarget', { targetId: seeded.targetId }).catch(() => {});
  }

  /* ================= language ================= */
  r.head('language');
  await s.eval(`document.querySelector('[data-lang="en"]').click()`);
  await sleep(300);
  const enH1 = await s.eval(`document.querySelector('.home-hero h1').textContent`);
  r.ok('EN switches the page to English', /[A-Za-z]/.test(enH1) && !/[әғқңөұүһі]/i.test(enH1), enH1);
  await s.eval(`document.querySelector('[data-lang="kk"]').click()`);
  await sleep(300);
  const kkH1 = await s.eval(`document.querySelector('.home-hero h1').textContent`);
  r.ok('KK switches it back', /[әғқңөұүһі]/i.test(kkH1), kkH1);

  /* ================= a book, and an answer ================= */
  r.head('a book, and an answer');
  await goto(s, BASE + '#/b/grammar');
  await sleep(800);
  const book = await s.eval(`(() => ({
    view: document.body.getAttribute('data-view'),
    units: document.querySelectorAll('#unitList li').length,
    inputs: document.querySelectorAll('#main input[type=text]').length,
    title: document.getElementById('brandTitle').textContent
  }))()`);
  r.eq('a book opens on the book page', book.view, 'book');
  r.eq('every unit is in the list', book.units, 145);
  r.ok('the first unit has boxes to type in', book.inputs > 0, String(book.inputs));

  const wrong = await s.eval(`(async () => {
    const i = document.querySelector('#main input[type=text]');
    i.value = 'qqqqzzz';
    i.dispatchEvent(new Event('input', {bubbles:true}));
    i.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}));
    await new Promise(r=>setTimeout(r,350));
    const st = JSON.parse(localStorage.getItem('agylshyn_v1')||'{}');
    const k = Object.keys(st.items||{})[0];
    return { key: k, rec: (st.items||{})[k] };
  })()`);
  r.ok('a wrong answer is filed against the question', !!wrong.rec, JSON.stringify(wrong));
  r.ok('and counted as wrong', wrong.rec && wrong.rec.wrong >= 1, JSON.stringify(wrong.rec));
  r.note('storage key: ' + wrong.key);

  const right = await s.eval(`(async () => {
    const d = await (await fetch('data/grammar.json')).json();
    const sub = d.units[0].subExercises.find(s => (s.items||[]).some(i => i.answer && !i.isExample));
    const item = sub.items.find(i => i.answer && !i.isExample);
    const boxes = [...document.querySelectorAll('#main input[type=text]')];
    const box = boxes.find(b => (b.getAttribute('aria-label')||'').indexOf(String(item.n)) >= 0
                                && (b.getAttribute('aria-label')||'').indexOf(sub.number) >= 0) || boxes[0];
    box.value = String(item.answer).split(' / ')[0];
    box.dispatchEvent(new Event('input', {bubbles:true}));
    box.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}));
    await new Promise(r=>setTimeout(r,350));
    const st = JSON.parse(localStorage.getItem('agylshyn_v1'));
    const hit = Object.values(st.items).some(v => v.streak >= 1);
    return { typed: box.value, wanted: item.answer, hit };
  })()`);
  r.ok('a correct answer is accepted', right.hit, JSON.stringify(right));

  // The "two rows, one number" regression (Advanced Grammar 17.2) lives in
  // tests/paywall_e2e.js now: that book is paid, so opening it needs a
  // subscription, and this pass is deliberately signed out.

  /* ================= the writing pad =================

     An exercise nothing can grade used to be a heading and a "show answer"
     button — a book with the key at the back, which is the one thing this site
     is not for. Collocations unit 1 is four such exercises in a row (1.2-1.5),
     so it is where a pad going missing would show first. */
  r.head('the writing pad');
  await goto(s, BASE + '#/b/collocations/unit/1');
  // A book this pass has not opened before has to come down first; 800 ms is
  // enough for grammar out of the disk cache and not for a cold fetch.
  r.ok('the unit renders', await until(s, `!!document.querySelector('#main .sub')`));
  const pad = await s.eval(`(async () => {
    const d = await (await fetch('data/collocations.json')).json();
    const u = d.units.find(x => Number(x.unit) === 1) || d.units[0];
    const ungradable = (u.subExercises||[]).filter(
      s => s.type === 'freeform' || s.type === 'crossword' || !(s.items||[]).length);
    return {
      wanted: ungradable.length,
      pads: document.querySelectorAll('#main .sub .pad-area').length,
      // Every ungradable exercise must have one, and no exercise two.
      subsWithPad: [...document.querySelectorAll('#main .sub')]
        .filter(x => x.querySelector('.pad-area')).length,
      doubles: [...document.querySelectorAll('#main .sub')]
        .filter(x => x.querySelectorAll('.pad-area').length > 1).length,
      labelled: [...document.querySelectorAll('#main .pad-area')]
        .every(x => (x.getAttribute('aria-label')||'').trim() && (x.placeholder||'').trim())
    };
  })()`);
  r.ok('every exercise the app cannot grade has somewhere to write',
    pad.pads >= pad.wanted && pad.wanted > 0, pad.pads + ' pads for ' + pad.wanted + ' exercises');
  r.eq('and none has two', pad.doubles, 0);
  r.ok('each pad says what it is', pad.labelled);

  const padSave = await s.eval(`(async () => {
    const a = document.querySelector('#main .sub .pad-area');
    a.value = 'a heavy snow, a storm in a tea cup';
    a.dispatchEvent(new Event('input', {bubbles:true}));
    await new Promise(r=>setTimeout(r,600));
    const st = JSON.parse(localStorage.getItem('agylshyn_v1')||'{}');
    const keys = Object.keys(st.writing||{});
    const sub = a.closest('.sub');
    return {
      keys: keys,
      text: keys.length ? st.writing[keys[0]].text : null,
      // The only mark an ungradable exercise can honestly wear.
      tick: !!sub && sub.classList.contains('written'),
      count: sub ? (sub.querySelector('.task-count')||{}).textContent : ''
    };
  })()`);
  r.eq('what is written is filed under one key', padSave.keys.length, 1);
  r.ok('under the book, unit and exercise it belongs to',
    /^collocations\|1\|1\.\d+\|pad$/.test(padSave.keys[0] || ''), padSave.keys[0]);
  r.eq('with the text in it', padSave.text, 'a heavy snow, a storm in a tea cup');
  r.ok('the exercise is ticked once it is written in', padSave.tick);
  r.ok('and the words are counted', /\b9\b/.test(padSave.count || ''), padSave.count);

  await goto(s, BASE + '#/b/collocations/unit/1');
  await until(s, `!!document.querySelector('#main .pad-area')`);
  const padBack = await s.eval(`(() => {
    const a = document.querySelector('#main .sub .pad-area');
    return { val: a ? a.value : null, written: !!a && !!a.closest('.sub.written') };
  })()`);
  r.eq('and it is still there after a reload', padBack.val, 'a heavy snow, a storm in a tea cup');
  r.ok('with the tick still on it', padBack.written);

  /* And the worst case: a unit whose exercises never came off the scan at all.
     Essential Grammar 23 and 66 are a title, a PDF page and nothing else, which
     is where "there is nowhere to write" started. */
  const bare = await s.eval(`(async () => {
    const d = await (await fetch('data/essential-grammar.json')).json();
    const u = d.units.find(x => !(x.subExercises||[]).length);
    return u ? u.unit : null;
  })()`);
  r.ok('a unit with no exercises at all exists to test', bare != null, String(bare));
  if (bare != null) {
    await goto(s, BASE + '#/b/essential-grammar/unit/' + bare);
    await until(s, `!!document.querySelector('#main .pad-area')`);
    const bareOut = await s.eval(`(() => {
      const a = document.querySelector('#main .pad-area');
      if (!a) return { pads: 0 };
      a.value = 'worked through unit ' + ${bare};
      a.dispatchEvent(new Event('input', {bubbles:true}));
      return { pads: document.querySelectorAll('#main .pad-area').length,
               aria: a.getAttribute('aria-label') };
    })()`);
    r.eq('an empty unit gets one pad for the whole unit', bareOut.pads, 1);
    // There is no exercise here to name, so the label must not invent one.
    r.ok('named after the unit rather than a nonexistent exercise',
      (bareOut.aria || '').indexOf(String(bare)) >= 0 &&
      !/exercise|тапсырма/i.test(bareOut.aria || ''), bareOut.aria);
    await sleep(600);
    const bareKey = await s.eval(`Object.keys(JSON.parse(localStorage.getItem('agylshyn_v1')).writing)
      .filter(k => k.indexOf('essential-grammar|') === 0)`);
    r.eq('filed under the unit', bareKey[0], 'essential-grammar|' + bare + '|unit|pad');
  }

  /* ================= a matching exercise spends its options ================= */
  r.head('used options are crossed off');
  await goto(s, BASE + '#/b/grammar/unit/1');
  await sleep(700);
  // 1.2 — "The sentences on the right follow those on the left": eight endings,
  // each one answering exactly one sentence.
  const cross = await s.eval(`(() => {
    const sub = [...document.querySelectorAll('#main .sub')]
      .find(x => x.querySelector('.options') && x.querySelectorAll('.answer-line input').length > 3);
    if (!sub) return { missing: true };
    const chip = L => [...sub.querySelectorAll('.opt')].find(c => c.querySelector('b').textContent.trim() === L);
    const box = sub.querySelector('.answer-line input');
    const type = v => { box.value = v; box.dispatchEvent(new Event('input', {bubbles:true})); };
    const out = {};
    out.before = chip('e').classList.contains('used');
    type('e');
    out.typed = chip('e').classList.contains('used');
    out.others = sub.querySelectorAll('.opt.used').length;
    type('E) ');                       // however the letter gets written
    out.messy = chip('e').classList.contains('used');
    type('');
    out.cleared = chip('e').classList.contains('used');
    return out;
  })()`);
  r.ok('the matching exercise is on the page', !cross.missing);
  r.ok('an untouched pool has nothing crossed off', cross.before === false);
  r.ok('typing a letter crosses that option off, before any checking', cross.typed === true);
  r.eq('and only that one', cross.others, 1);
  r.ok('a letter with punctuation round it still counts', cross.messy === true);
  r.ok('clearing the box puts the option back', cross.cleared === false);

  // Unit 24.1 is not a matching exercise: its four options are groups of
  // statements and an answer is "b and d are true", so the same letter is right
  // in more than one place. Nothing there may be crossed off.
  await goto(s, BASE + '#/b/grammar/unit/24');
  await sleep(700);
  const reuse = await s.eval(`(() => {
    const sub = [...document.querySelectorAll('#main .sub')].find(x => x.querySelector('.options'));
    if (!sub) return { missing: true };
    const box = sub.querySelector('.answer-line input');
    box.value = 'b'; box.dispatchEvent(new Event('input', {bubbles:true}));
    return { used: sub.querySelectorAll('.opt.used').length };
  })()`);
  r.ok('the exercise with repeating options is on the page', !reuse.missing);
  r.eq('and it crosses nothing off', reuse.used, 0);

  /* ================= mistakes and statistics ================= */
  r.head('mistakes and statistics');
  await goto(s, BASE + '#/b/grammar');
  await sleep(600);
  const pages = await s.eval(`(async () => {
    document.getElementById('tabErrors').click();
    await new Promise(r=>setTimeout(r,400));
    const mistakes = document.getElementById('main').textContent.trim().length;
    document.getElementById('tabStats').click();
    await new Promise(r=>setTimeout(r,600));
    const main = document.getElementById('main');
    const labels = [...main.querySelectorAll('button, label')].map(b => b.textContent.trim());
    return { mistakes, table: !!main.querySelector('table'),
             stats: main.textContent.trim().length, labels: labels.slice(0, 14) };
  })()`);
  r.ok('the mistakes page draws something', pages.mistakes > 0, String(pages.mistakes));
  r.ok('the statistics page draws its table', pages.table);
  r.ok('and offers a backup', pages.labels.some(b => /Сақ|Back up|Export/i.test(b)), JSON.stringify(pages.labels));
  r.ok('a restore', pages.labels.some(b => /қалпына келтір|Restore|Import/i.test(b)), JSON.stringify(pages.labels));
  r.ok('and a way to clear this book', pages.labels.some(b => /өшір|Clear|Reset/i.test(b)), JSON.stringify(pages.labels));

  /* ================= practice session ================= */
  r.head('practice session');
  await goto(s, BASE + '#/drill');
  await sleep(800);
  const drill = await s.eval(`(() => ({
    view: document.body.getAttribute('data-view'),
    buttons: document.querySelectorAll('#main button').length,
    sidebar: getComputedStyle(document.getElementById('sidebar')).display,
    text: document.getElementById('main').textContent.trim().slice(0, 60)
  }))()`);
  r.eq('a session is its own page', drill.view, 'drill');
  r.ok('it offers a way to start', drill.buttons > 0, drill.text);
  r.eq('with no unit list beside it', drill.sidebar, 'none');

  /* ================= the word deck ================= */
  r.head('word deck');
  await goto(s, BASE + '#/srs');
  await sleep(700);
  r.eq('the deck is its own page', await s.eval(`document.body.getAttribute('data-view')`), 'srs');

  const deck = await s.eval(`(async () => {
    const a = SRS.addWord({ word: 'ubiquitous', translation: 'кең тараған' });
    const b = SRS.addWord({ word: 'meticulous', translation: 'мұқият' });
    await new Promise(r=>setTimeout(r,300));
    return { added: !!a && !!b, total: SRS.total(), due: SRS.stats().due };
  })()`);
  r.ok('a word can be saved', deck.added, JSON.stringify(deck));
  r.eq('the deck holds both', deck.total, 2);
  r.eq('and both are waiting', deck.due, 2);

  const again = await s.eval(`(() => ({
    added: !!SRS.addWord({ word: '  Ubiquitous ', translation: 'басқа' }), total: SRS.total()
  }))()`);
  r.ok('the same word, differently typed, is not saved twice', !again.added && again.total === 2, JSON.stringify(again));

  await goto(s, BASE + '#/srs/review');
  await sleep(800);
  const review = await s.eval(`(async () => {
    const before = SRS.stats();
    const reveal = [...document.querySelectorAll('#main button')].find(b => /көрсет|Show/i.test(b.textContent));
    if (reveal) reveal.click();
    await new Promise(r=>setTimeout(r,400));
    const grades = [...document.querySelectorAll('#main .srs-grade')];
    const labels = grades.map(g => g.textContent.trim());
    if (grades.length) grades[grades.length - 1].click();
    await new Promise(r=>setTimeout(r,500));
    return { revealed: !!reveal, grades: labels,
             beforeDue: before.due, afterDue: SRS.stats().due, reviewed: SRS.stats().reviewedToday };
  })()`);
  r.ok('the answer can be revealed', review.revealed);
  r.ok('four grades are offered, each showing when the word comes back',
    review.grades.length === 4, JSON.stringify(review.grades));
  r.eq('grading takes the word out of today\'s queue', review.afterDue, review.beforeDue - 1);
  r.ok('and counts towards today', review.reviewed >= 1, String(review.reviewed));

  await goto(s, BASE + '#/srs');
  await sleep(700);
  const kept = await s.eval(`({ total: SRS.total(), due: SRS.stats().due, line: SRS.homeSub(),
                                badge: document.getElementById('srsBadge').textContent })`);
  r.eq('the deck survives a reload', kept.total, 2);
  r.eq('and remembers what was already reviewed', kept.due, 1);
  r.eq('the topbar badge agrees', kept.badge, '1');
  r.note('home line: ' + kept.line);

  /* ================= looking a word up ================= */
  r.head('word lookup');
  await goto(s, BASE + '#/b/grammar/unit/1');
  await sleep(900);
  const look = await s.eval(`(async () => {
    const walk = document.createTreeWalker(document.getElementById('main'), NodeFilter.SHOW_TEXT);
    let node = null;
    while (walk.nextNode()) if (/[A-Za-z]{5,}/.test(walk.currentNode.textContent)) { node = walk.currentNode; break; }
    if (!node) return { no: 'no English text on the page' };
    const m = /[A-Za-z]{5,}/.exec(node.textContent);
    const range = document.createRange();
    range.setStart(node, m.index);
    range.setEnd(node, m.index + m[0].length);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    const box = range.getBoundingClientRect();
    node.parentElement.dispatchEvent(new MouseEvent('dblclick',
      { bubbles: true, clientX: box.left + 2, clientY: box.top + 2 }));
    await new Promise(r=>setTimeout(r,1200));
    const pop = document.querySelector('.wl-pop');
    return { word: m[0], popup: !!pop, text: pop ? pop.textContent.slice(0, 110) : null,
             canSave: !!(pop && [...pop.querySelectorAll('button')].some(b => /＋|\\+/.test(b.textContent))) };
  })()`);
  r.note(JSON.stringify(look));
  r.ok('double-clicking a word opens its translation', !!look.popup, JSON.stringify(look));
  if (look.popup) r.ok('and the popup can save it to the deck', look.canSave);

  /* ================= placement quiz ================= */
  r.head('placement quiz');
  await goto(s, BASE);
  await sleep(600);
  const quiz = await s.eval(`(async () => {
    document.getElementById('homeStart').click();
    await new Promise(r=>setTimeout(r,400));
    const opened = !document.getElementById('placeModal').hidden;
    let asked = 0;
    // Answer until the result appears, and stop there: the retake button is
    // also a button, and clicking past the end just starts the quiz over.
    for (let i = 0; i < 24 && !document.querySelector('#placeBody .plc-result'); i++) {
      const opts = [...document.querySelectorAll('#placeBody .plc-opt')];
      if (opts.length) { asked++; opts[0].click(); }
      else {
        // the intro screen, which has a start button and no options yet
        const go = [...document.querySelectorAll('#placeBody button')]
          .filter(b => !b.classList.contains('modal-close'))[0];
        if (!go) break;
        go.click();
      }
      await new Promise(r=>setTimeout(r,180));
    }
    await new Promise(r=>setTimeout(r,450));
    const st = JSON.parse(localStorage.getItem('agylshyn_v1')||'{}').placement;
    const links = [...document.querySelectorAll('#placeBody a')].map(a => a.getAttribute('href'));
    return { opened, asked, placement: st, links };
  })()`);
  r.ok('the quiz opens from the home page', quiz.opened);
  r.ok('it asks a question at a time', quiz.asked >= 8, String(quiz.asked));
  r.ok('and ends with a level and a band',
    !!(quiz.placement && quiz.placement.track && quiz.placement.band), JSON.stringify(quiz.placement));
  r.ok('the result links to books', (quiz.links || []).some(h => /#\/b\//.test(h || '')), JSON.stringify(quiz.links));
  r.note('result: ' + JSON.stringify(quiz.placement));

  const homeBand = await s.eval(`(async () => {
    document.querySelector('[data-close-place]').click();
    await new Promise(r=>setTimeout(r,400));
    return document.getElementById('homeStartSub').textContent.trim();
  })()`);
  r.ok('and the home page now shows the level', homeBand.length > 0, homeBand);

  /* ================= search ================= */
  r.head('search');
  const find = await s.eval(`(async () => {
    document.querySelector('[data-open-find]').click();
    await new Promise(r=>setTimeout(r,300));
    const input = document.getElementById('findInput');
    input.value = 'weather';
    input.dispatchEvent(new Event('input', {bubbles:true}));
    await new Promise(r=>setTimeout(r,1200));
    const hits = [...document.querySelectorAll('#findResults a, #findResults button')];
    return { open: !document.getElementById('findModal').hidden, hits: hits.length,
             first: hits.length ? (hits[0].getAttribute('href') || hits[0].textContent.slice(0,40)) : null };
  })()`);
  r.ok('search opens', find.open);
  r.ok('and finds "weather" in the books', find.hits > 0, JSON.stringify(find));
  r.note('first hit: ' + find.first);

  /* ================= side trips come back ================= */
  r.head('leaving a book and coming back');
  const back = await s.eval(`(async () => {
    document.querySelector('[data-close-find]').click();
    location.hash = '#/b/grammar/unit/2';
    await new Promise(r=>setTimeout(r,700));
    const hrefs = {};
    for (const trip of ['#/drill', '#/srs', '#/users']) {
      location.hash = trip;
      await new Promise(r=>setTimeout(r,500));
      hrefs[trip] = document.querySelector('.home-link').getAttribute('href');
    }
    return hrefs;
  })()`);
  for (const trip of ['#/drill', '#/srs', '#/users']) {
    r.eq('◇ from ' + trip + ' returns to the open unit', back[trip], '#/b/grammar/unit/2');
  }

  /* ================= every book opens ================= */
  // This pass is signed out, which is what most readers are. A free book has to
  // open whole; a paid one opens onto its free sample — a couple of units and a
  // banner saying so — rather than an error or a bare lock. The lock screen
  // itself, and a subscribed reader, are tests/paywall_e2e.js's job.
  r.head('every book opens');
  const paid = new Set(await s.eval(
    `(window.ENTITLE ? (window.BOOKS||[]).filter(b => ENTITLE.isPaid(b.id)).map(b=>b.id) : [])`));
  for (const id of await s.eval(`(window.BOOKS||[]).map(b=>b.id)`)) {
    const got = await s.eval(`(async () => {
      location.hash = '#/b/${id}';
      await new Promise(r=>setTimeout(r,500));
      return { view: document.body.getAttribute('data-view'),
               units: document.querySelectorAll('#unitList .unit-link:not(.locked-link)').length,
               sample: !!document.querySelector('.sample-bar'),
               unlock: !!document.querySelector('.locked-link, .sample-bar .btn'),
               text: document.getElementById('main').textContent.trim().length,
               title: document.getElementById('brandTitle').textContent };
    })()`);
    if (paid.has(id)) {
      r.ok(id + ' is paid, and opens onto a sample with a way to unlock',
        got.view === 'book' && got.units > 0 && got.units <= 2 && got.sample && got.unlock,
        JSON.stringify(got));
    } else {
      r.ok(id + ' opens with ' + got.units + ' units',
        got.view === 'book' && got.units > 0 && got.text > 40, JSON.stringify(got));
    }
  }

  const real = errors.filter(e => !/favicon|Failed to load resource/i.test(e));
  r.ok('nothing threw anywhere in the pass', real.length === 0, real.slice(0, 5).join(' | '));

  return r.done();
}

if (require.main === module) {
  run().then(f => process.exit(f ? 1 : 0))
       .catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
}
module.exports = { run };
