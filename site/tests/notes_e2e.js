/* The Kazakh explanation on a unit page: that it is there where one has been
   written, that it is absent (and silently so) where one has not, and that a
   wrong answer offers it.

   node site/tests/notes_e2e.js  (or via tests/run.js, which starts the server) */
'use strict';
const { connect, newContextPage, goto, sleep } = require('./cdp.js');
const { Report } = require('./report.js');

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:8853/';
const PORT = Number(process.env.TEST_CDP || 9333);

async function until(s, expr, ms) {
  const stop = Date.now() + (ms || 8000);
  for (;;) {
    if (await s.eval(expr)) return true;
    if (Date.now() > stop) return false;
    await sleep(120);
  }
}

async function run() {
  const r = Report('notes');
  const conn = await connect(PORT);
  const errors = [];

  const s = await newContextPage(conn);
  s.on('Runtime.exceptionThrown', p => errors.push(p.exceptionDetails.text));

  /* ================= a unit that has one ================= */
  r.head('a unit with an explanation');
  // Unit 72 is a/an and the — no article exists in Kazakh, which is why it is
  // one of the units that got a note.
  await goto(s, BASE + '#/b/grammar/unit/72');
  await until(s, `!!document.querySelector('.kk-note')`);

  const note = await s.eval(`(() => {
    const n = document.querySelector('.kk-note');
    return {
      open: n.open,
      tag: (n.querySelector('.kn-tag') || {}).textContent,
      title: (n.querySelector('.kn-head b') || {}).textContent,
      paras: n.querySelectorAll('.kn-body > p').length,
      examples: n.querySelectorAll('.kn-ex-line').length,
      watch: n.querySelectorAll('.kn-watch li').length,
      kazakh: /[әіңғүұқөһ]/i.test(n.textContent),
      before: !!(n.compareDocumentPosition(document.querySelector('.sub'))
                 & Node.DOCUMENT_POSITION_FOLLOWING)
    };
  })()`);
  r.ok('the note is open on a unit never worked before', note.open);
  r.ok('it is labelled as Kazakh', /ҚАЗАҚША|IN KAZAKH/.test(note.tag || ''), note.tag);
  r.ok('it has a title', (note.title || '').length > 3, note.title);
  r.ok('an explanation', note.paras > 1, String(note.paras));
  r.ok('examples in both languages', note.examples > 1, String(note.examples));
  r.ok('and a list of the usual mistakes', note.watch > 0, String(note.watch));
  r.ok('the text really is Kazakh', note.kazakh);
  r.ok('and it sits above the exercises', note.before);

  /* ================= a unit that has none ================= */
  r.head('a unit without one');
  await goto(s, BASE + '#/b/grammar/unit/44');
  await sleep(900);
  const none = await s.eval(`({
    note: !!document.querySelector('.kk-note'),
    subs: document.querySelectorAll('.sub').length,
    slot: !!document.querySelector('.kn-slot')
  })`);
  r.ok('no note is drawn', !none.note);
  r.ok('the page is otherwise itself', none.subs > 0, String(none.subs));
  r.ok('and the empty slot leaves nothing visible', none.slot);

  /* ================= a book that has none ================= */
  r.head('a book without notes');
  await goto(s, BASE + '#/b/collocations/unit/1');
  await sleep(1200);
  const otherBook = await s.eval(`({
    note: !!document.querySelector('.kk-note'),
    subs: document.querySelectorAll('.sub').length
  })`);
  r.ok('a book with no notes file shows none', !otherBook.note);
  r.ok('and still renders', otherBook.subs > 0);

  /* ================= from a wrong answer ================= */
  r.head('after getting one wrong');
  await goto(s, BASE + '#/b/grammar/unit/72');
  await until(s, `!!document.querySelector('.kk-note')`);
  const wrong = await s.eval(`(() => {
    document.querySelector('.kk-note').open = false;
    const btn = document.querySelector('.answer-line .btn.primary');
    const row = btn.closest('.row');
    const input = row.querySelector('.answer-line input');
    input.value = 'not the answer at all';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    btn.click();
    const link = [...row.querySelectorAll('.feedback .btn')]
      .find(b => /Қазақша|Kazakh/i.test(b.textContent));
    if (!link) return { found: false };
    link.click();
    return { found: true, open: document.querySelector('.kk-note').open };
  })()`);
  r.ok('a wrong answer offers the Kazakh explanation', wrong.found);
  r.ok('and pressing it opens the note', wrong.open);

  /* ================= a unit already worked ================= */
  r.head('coming back to a unit');
  await goto(s, BASE + '#/b/grammar/unit/72');
  await until(s, `!!document.querySelector('.kk-note')`);
  const again = await s.eval(`document.querySelector('.kk-note').open`);
  r.ok('the note is folded away once the unit has been answered in', !again);

  r.eq('nothing threw', errors.length, 0);
  if (errors.length) r.note(errors.slice(0, 3).join('\n    '));

  await conn.send('Target.closeTarget', { targetId: s.targetId });
  conn.close();
  return r.done();
}

run().then(f => process.exit(f ? 1 : 0), e => { console.error(e); process.exit(2); });
