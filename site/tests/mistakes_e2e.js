/* Wrong answers becoming flash cards: the automatic path (missed twice), the
   button on the Mistakes page, the rules about what cannot become a card, and
   the promise that nothing is ever added twice.

   node site/tests/mistakes_e2e.js  (or via tests/run.js, which starts the server) */
'use strict';
const { connect, newContextPage, goto, sleep, until } = require('./cdp.js');
const { Report } = require('./report.js');

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:8853/';
const PORT = Number(process.env.TEST_CDP || 9333);
const UNIT = '#/b/grammar/unit/1';

/* Answer every box in the open unit wrongly, then check them all.

   The wrong answer carries a pass number, because a row now refuses to grade
   the same text twice: pressing "check" again over an answer that already has
   a verdict is not a second attempt, and counting it as one is what used to
   turn a single slip into the two that make a card. A real second attempt
   means different text in the box. */
const wrongPass = n => `(() => {
  const boxes = [...document.querySelectorAll('.answer-line input')];
  boxes.forEach(b => {
    b.value = 'definitely wrong ${n}';
    b.dispatchEvent(new Event('input', { bubbles: true }));
  });
  [...document.querySelectorAll('.row')].forEach(r => r._check && r._check());
  return boxes.length;
})()`;

const deck = `JSON.parse(localStorage.getItem('agylshyn_srs_v1') || '{"cards":[]}').cards`;

async function run() {
  const r = Report('mistakes');
  const conn = await connect(PORT);
  const errors = [];

  const s = await newContextPage(conn);
  s.on('Runtime.exceptionThrown', p => errors.push(p.exceptionDetails.text));

  /* ================= once is not enough ================= */
  r.head('one mistake');
  await goto(s, BASE + UNIT);
  await until(s, `document.querySelectorAll('.answer-line input').length > 0`);
  const n = await s.eval(wrongPass(1));
  r.ok('the unit has answers to get wrong', n > 3, String(n));
  await sleep(400);
  const afterOne = await s.eval(`(${deck}).length`);
  r.eq('a single slip does not fill the deck', afterOne, 0);

  /* ================= twice does it ================= */
  r.head('the same mistake twice');
  // Pressing check again over the same answer is not a second attempt.
  await s.eval(wrongPass(1));
  await sleep(400);
  r.eq('re-checking the same answer does not count as a second miss',
    await s.eval(`(${deck}).length`), 0);
  await s.eval(wrongPass(2));
  await sleep(500);
  const cards = await s.eval(`(() => {
    const c = ${deck};
    return {
      n: c.length,
      kind: (c[0] || {}).kind,
      front: (c[0] || {}).word,
      back: (c[0] || {}).translation,
      source: (c[0] || {}).example,
      src: (c[0] || {}).srcKey,
      due: (c[0] || {}).due <= Date.now()
    };
  })()`);
  r.ok('missing a question twice makes a card', cards.n > 0, String(cards.n));
  r.eq('and it is a gap card, not a vocabulary one', cards.kind, 'gap');
  r.ok('the question is on the front', (cards.front || '').length > 5, cards.front);
  r.ok('the answer is on the back', (cards.back || '').length > 0, cards.back);
  r.ok('and it says which book and unit it came from',
    /Unit 1/.test(cards.source || ''), cards.source);
  r.ok('the card knows the answer it was made from',
    /^grammar\|1\|/.test(cards.src || ''), cards.src);
  r.ok('and it is due straight away', cards.due);

  // A third wrong answer must not add the same question again.
  await s.eval(wrongPass(3));
  await sleep(500);
  const again = await s.eval(`(${deck}).length`);
  r.eq('a third miss adds nothing new', again, cards.n);

  /* ================= the card is answerable =================

     A card whose only control is "show me" tests recognition, not recall — and
     a gap card lifted out of an exercise ("… the road.") cannot even be
     recognised without the instruction it came with. Both belong on the front. */
  r.head('reviewing the card');
  await goto(s, BASE + '#/srs/review');
  await until(s, `!!document.querySelector('.srs-card')`);
  const face = await s.eval(`(() => {
    const box = document.querySelector('.srs-answer');
    return {
      box: !!box,
      enabled: box ? !box.disabled : false,
      prompt: (document.querySelector('.srs-prompt') || {}).textContent || '',
      word: (document.querySelector('.srs-word') || {}).textContent || ''
    };
  })()`);
  r.ok('the card has somewhere to write', face.box);
  r.ok('and the box is ready to type in', face.enabled);
  r.ok('the exercise instruction is on the front', face.prompt.length > 10, face.prompt);
  r.ok('and so is the sentence', face.word.length > 3, face.word);

  const compared = await s.eval(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const back = document.querySelector('.srs-translation').textContent;
    const box = document.querySelector('.srs-answer');
    box.value = String(back).split(' / ')[0];
    box.dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('button')]
      .find(b => b.offsetParent && /show/i.test(b.className + ' ' + b.textContent)).click();
    await wait(400);
    const mine = document.querySelector('.srs-mine');
    return {
      shown: !!mine && !mine.hidden,
      hit: !!mine && mine.classList.contains('hit'),
      locked: document.querySelector('.srs-answer').disabled,
      text: mine ? mine.textContent : ''
    };
  })()`);
  r.ok('what was typed is set against the answer', compared.shown, compared.text);
  r.ok('and typing the key counts as a hit', compared.hit, compared.text);
  r.ok('the box is closed once the card is turned', compared.locked);

  await goto(s, BASE + UNIT);
  await until(s, `document.querySelectorAll('.answer-line input').length > 0`);

  /* ================= getting it right ================= */
  r.head('answering it right');
  const before = await s.eval(`(${deck}).length`);
  await s.eval(`(() => {
    // Answer the first row correctly by reading the key off the page.
    const row = document.querySelector('.row.wrong');
    const key = row.querySelector('.feedback .key b').textContent;
    const input = row.querySelector('.answer-line input');
    input.value = key;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    row._check();
  })()`);
  await sleep(400);
  const kept = await s.eval(`(${deck}).length`);
  r.eq('a card already made is not taken back', kept, before);

  /* ================= the button ================= */
  // A second unit, answered wrong exactly once: those are the mistakes the
  // automatic sweep leaves alone and the button on the page exists for.
  r.head('the Mistakes page');
  await goto(s, BASE + '#/b/grammar/unit/2');
  await until(s, `document.querySelectorAll('.answer-line input').length > 0`);
  await s.eval(wrongPass(1));
  await sleep(400);

  await goto(s, BASE + '#/b/grammar/errors');
  await until(s, `!!document.querySelector('.err-run')`);
  const page = await s.eval(`({
    button: !!document.querySelector('.err-run .btn:not(.primary)'),
    label: (document.querySelector('.err-run .btn:not(.primary)') || {}).textContent
  })`);
  r.ok('the page offers to keep the rest', page.button, page.label);

  const before2 = await s.eval(`${deck}.length`);
  const added = await s.eval(`(() => {
    document.querySelector('.err-run .btn:not(.primary)').click();
    return { label: document.querySelector('.err-run .btn:not(.primary)').textContent,
             off: document.querySelector('.err-run .btn:not(.primary)').disabled };
  })()`);
  // The deck saves on a debounce, so read it back after it has settled.
  await sleep(500);
  added.before = before2;
  added.after = await s.eval(`${deck}.length`);
  r.ok('pressing it adds the ones missed only once', added.after > added.before,
    added.before + ' -> ' + added.after);
  r.ok('the button says what it did', /\d/.test(added.label), added.label);
  r.ok('and cannot be pressed twice', added.off);

  await goto(s, BASE + '#/b/grammar/errors');
  await until(s, `!!document.querySelector('.err-run')`);
  const twice = await s.eval(`({
    button: !!document.querySelector('.err-run .btn:not(.primary)'),
    cards: ${deck}.length
  })`);
  r.ok('with nothing left to add, the button is gone', !twice.button);
  r.eq('and the deck did not grow again', twice.cards, added.after);

  /* ================= what cannot become a card ================= */
  r.head('an answer sheet has nothing to give');
  await goto(s, BASE + '#/b/ielts-19/unit/1');
  await until(s, `document.querySelectorAll('.answer-line input').length > 0`);
  await s.eval(wrongPass(1));
  await s.eval(wrongPass(2));
  await sleep(500);
  const sheet = await s.eval(`(() => {
    const c = ${deck};
    return { total: c.length, fromIelts: c.filter(x => (x.srcKey||'').indexOf('ielts') === 0).length };
  })()`);
  r.eq('an IELTS answer sheet makes no cards', sheet.fromIelts, 0);
  r.ok('and the deck is otherwise untouched', sheet.total === twice.cards,
    sheet.total + ' vs ' + twice.cards);

  /* ================= the switch ================= */
  r.head('turning it off');
  await goto(s, BASE + '#/srs/settings');
  await until(s, `!!document.querySelector('.srs-check input')`);
  const setting = await s.eval(`(() => {
    const box = document.querySelector('.srs-check input');
    if (!box) return { found: false };
    const was = box.checked;
    box.checked = false;
    document.querySelector('.srs-form .btn.primary').click();
    return { found: true, was: was };
  })()`);
  await sleep(500);
  setting.saved = await s.eval(
    `JSON.parse(localStorage.getItem('agylshyn_srs_v1')).settings.autoMistakes`);
  r.ok('the deck settings carry the switch', setting.found);
  r.ok('and it starts on', setting.was);
  r.eq('turning it off is remembered', setting.saved, false);

  await goto(s, BASE + '#/b/vocab-preint/unit/1');
  await until(s, `document.querySelectorAll('.answer-line input').length > 0`);
  await s.eval(wrongPass(1));
  await s.eval(wrongPass(2));
  await sleep(500);
  const off = await s.eval(`${deck}.filter(c => (c.srcKey||'').indexOf('vocab-preint') === 0).length`);
  r.eq('with it off, nothing is added on its own', off, 0);

  r.eq('nothing threw', errors.length, 0);
  if (errors.length) r.note(errors.slice(0, 3).join('\n    '));

  await conn.send('Target.closeTarget', { targetId: s.targetId });
  conn.close();
  return r.done();
}

run().then(f => process.exit(f ? 1 : 0), e => { console.error(e); process.exit(2); });
