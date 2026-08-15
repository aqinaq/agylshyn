/* Classes: opening one, the join code, joining with it, the progress board, and
   the two things that must never happen — a student seeing another class's
   code, and a page that keeps asking a project which has no class tables.

   node site/tests/classes_e2e.js  (or via tests/run.js, which starts the server) */
'use strict';
const { connect, newContextPage, goto, sleep, until, answerAsk } = require('./cdp.js');
const { Report } = require('./report.js');
const { mock, signedIn } = require('./supamock.js');

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:8853/';
const PORT = Number(process.env.TEST_CDP || 9333);
const PAGE = '#/class';


async function run() {
  const r = Report('classes');
  const conn = await connect(PORT);
  const errors = [];

  /* ================= signed out ================= */
  r.head('signed out');
  let s = await newContextPage(conn);
  await mock(s, {});
  s.on('Runtime.exceptionThrown', p => errors.push(p.exceptionDetails.text));
  await goto(s, BASE + PAGE);
  await sleep(900);
  const out = await s.eval(`({
    view: document.body.getAttribute('data-view'),
    text: document.getElementById('main').textContent,
    signIn: !!document.querySelector('#main .btn.primary')
  })`);
  r.eq('the page has a view of its own', out.view, 'class');
  r.ok('and asks for an account first', out.signIn, out.text.slice(0, 80));

  /* ================= a teacher ================= */
  r.head('opening a class');
  await conn.send('Target.closeTarget', { targetId: s.targetId });
  s = await signedIn(conn, {});
  s.on('Runtime.exceptionThrown', p => errors.push(p.exceptionDetails.text));
  await goto(s, BASE + PAGE);
  await until(s, `!!document.querySelector('.cls-form')`);

  const empty = await s.eval(`({
    cards: document.querySelectorAll('.cls-card').length,
    forms: document.querySelectorAll('.cls-form').length,
    privacy: !!document.querySelector('.cls-privacy'),
    says: (document.querySelector('.cls-privacy') || {}).textContent || ''
  })`);
  r.eq('no classes yet', empty.cards, 0);
  r.eq('one form to create, one to join', empty.forms, 2);
  r.ok('the page says what a teacher can see', empty.privacy);
  r.ok('and that it is not what students typed',
    /typed|жазған/i.test(empty.says), empty.says.slice(0, 90));

  await s.eval(`(() => {
    const f = document.querySelectorAll('.cls-form')[0];
    f.querySelector('input').value = '9-A evening';
    f.querySelector('.btn').click();
  })()`);
  await until(s, `!!document.querySelector('.cls-card')`);
  const made = await s.eval(`({
    cards: document.querySelectorAll('.cls-card').length,
    name: (document.querySelector('.cls-name') || {}).textContent,
    code: (document.querySelector('.cls-code') || {}).textContent,
    msg: (document.querySelector('.cls-msg') || {}).textContent || '',
    onServer: 1
  })`);
  r.eq('the class is on the page', made.cards, 1);
  r.eq('under the name it was given', made.name, '9-A evening');
  r.ok('with a join code', /^[A-Z0-9]{5,8}$/.test(made.code || ''), made.code);
  r.ok('and the code is repeated in the confirmation', (made.msg || '').indexOf(made.code) > -1,
    made.msg);

  const server = await s.eval(`(async () => {
    const rows = await CLASSES.mine();
    return rows.map(c => ({ name: c.name, mine: c.mine, code: c.code }));
  })()`);
  r.eq('and it really exists on the server', server.length, 1);
  r.ok('owned by this account', server[0].mine);

  const copied = await s.eval(`(async () => {
    let grabbed = null;
    navigator.clipboard.writeText = (t) => { grabbed = t; return Promise.resolve(); };
    [...document.querySelectorAll('.cls-code-row .btn')][0].click();
    await new Promise(r=>setTimeout(r,120));
    return grabbed;
  })()`);
  r.eq('the code can be copied', copied, made.code);

  /* ================= the board ================= */
  r.head('the progress board');
  await until(s, `!!document.querySelector('.cls-card .btn.primary')`);
  await s.eval(`document.querySelector('.cls-card .btn.primary').click()`);
  await until(s, `!!document.querySelector('.cls-roster') &&
    !/Loading|Жүктелуде/.test(document.querySelector('.cls-roster').textContent)`);
  const emptyRoster = await s.eval(`document.querySelector('.cls-roster').textContent`);
  r.ok('an empty class says to hand out the code',
    /код|code/i.test(emptyRoster), emptyRoster.slice(0, 60));

  // A class with students in it. Seeded as a fresh session rather than by
  // reaching into the page: the board is only ever drawn from what the RPC
  // answers, and that is the thing worth testing.
  await conn.send('Target.closeTarget', { targetId: s.targetId });
  s = await signedIn(conn, {
    classes: [{ id: 'c-1', name: '9-A', code: 'ABC1XY', members: ['s-1', 's-2'] }]
  });
  s.on('Runtime.exceptionThrown', p => errors.push(p.exceptionDetails.text));
  await goto(s, BASE + PAGE);
  await until(s, `!!document.querySelector('.cls-card .btn.primary')`);
  await s.eval(`document.querySelector('.cls-card .btn.primary').click()`);
  await until(s, `!!document.querySelector('.cls-table tbody tr')`);

  const board = await s.eval(`(() => {
    const rows = [...document.querySelectorAll('.cls-table tbody tr')];
    const cells = rows[0] ? [...rows[0].children].map(c => c.textContent.trim()) : [];
    return { rows: rows.length, cells: cells,
             count: (document.querySelector('.cls-count') || {}).textContent };
  })()`);
  r.eq('every student is a row', board.rows, 2);
  r.ok('the card says how many there are', /2/.test(board.count || ''), board.count);
  r.ok('a row carries a name and an address',
    board.cells[0] && board.cells[0].indexOf('@') > -1, JSON.stringify(board.cells[0]));
  r.ok('how much they have answered', /100|\u00a0100/.test(board.cells[1]), board.cells[1]);
  r.eq('and how much of it was right, as a percentage', board.cells[2], '75%');

  // The board is counters. Nothing a student typed may be on it — and the RPC
  // that would return it does not exist, which is the point.
  const noAnswers = await s.eval(`(async () => {
    const rows = await CLASSES.progress('c-1');
    const keys = Object.keys(rows[0] || {});
    return keys.filter(k => /val|answer$|items|text/i.test(k));
  })()`);
  r.eq('and no field of it is a student\u2019s own writing', noAnswers.length, 0);

  /* ================= a student ================= */
  r.head('a student joining');
  await conn.send('Target.closeTarget', { targetId: s.targetId });
  s = await signedIn(conn, {
    classes: [{ id: 'c-9', owner: 'someone-else', name: 'Evening B2',
                code: 'MKJ7PQ', members: [] }]
  });
  s.on('Runtime.exceptionThrown', p => errors.push(p.exceptionDetails.text));
  await goto(s, BASE + PAGE);
  await until(s, `document.querySelectorAll('.cls-form').length === 2`);

  const beforeJoin = await s.eval(`({
    cards: document.querySelectorAll('.cls-card').length
  })`);
  r.eq('somebody else’s class is not on my page yet', beforeJoin.cards, 0);

  await s.eval(`(() => {
    const f = document.querySelectorAll('.cls-form')[1];
    f.querySelector('input').value = 'wrong1';
    f.querySelector('.btn').click();
  })()`);
  await until(s, `!!document.querySelector('.cls-msg.bad')`);
  const bad = await s.eval(`document.querySelector('.cls-msg.bad').textContent`);
  r.ok('a code that does not exist says so plainly',
    /код|code/i.test(bad), bad.slice(0, 70));

  await s.eval(`(() => {
    const f = document.querySelectorAll('.cls-form')[1];
    f.querySelector('input').value = 'mkj7pq';       // lower case on purpose
    f.querySelector('.btn').click();
  })()`);
  await until(s, `!!document.querySelector('.cls-card')`);
  const joined = await s.eval(`({
    cards: document.querySelectorAll('.cls-card').length,
    name: (document.querySelector('.cls-name') || {}).textContent,
    code: !!document.querySelector('.cls-code'),
    teacher: (document.querySelector('.cls-count') || {}).textContent || '',
    leave: !!document.querySelector('.cls-card .btn')
  })`);
  r.eq('the class is now mine to see', joined.cards, 1);
  r.eq('by name', joined.name, 'Evening B2');
  r.ok('a lower-case code still works', joined.cards === 1);
  r.ok('a student is never shown the join code', !joined.code);
  r.ok('but is told whose class it is', /teacher|мұғалім/i.test(joined.teacher), joined.teacher);

  const rosterDenied = await s.eval(`(async () => {
    try { await CLASSES.progress('c-9'); return 'allowed'; }
    catch (e) { return e.status || e.message; }
  })()`);
  r.eq('and cannot read the roster of a class they only study in', rosterDenied, 403);

  // "Left the class" is drawn once and only once: app.js renders classMsg and
  // clears it in the same breath, so the next render of the page — the roster
  // refresh, a sync callback, anything — takes it back off the screen. Waiting
  // for a condition and then reading the DOM in a second round trip is
  // therefore a coin toss, and it came up tails about one run in three.
  //
  // Catching it needs the watching to start before the thing being watched for:
  // an observer set up here records the message the moment it lands, and the
  // assertion below asks for what was recorded. Anything that repaints
  // afterwards is then irrelevant.
  await s.eval(`(() => {
    window.__clsMsgSeen = '';
    new MutationObserver(() => {
      const m = document.querySelector('.cls-msg');
      if (m && !window.__clsMsgSeen) window.__clsMsgSeen = m.textContent || '';
    }).observe(document.body, { childList: true, subtree: true });
  })()`);

  await s.eval(`[...document.querySelectorAll('.cls-card .btn')]
    .find(b => !b.classList.contains('ghost')).click()`);
  r.ok('leaving asks first', await answerAsk(s));
  await until(s, `!!window.__clsMsgSeen && !document.querySelector('.cls-card')`);
  const left = await s.eval(`({
    cards: document.querySelectorAll('.cls-card').length,
    msg: window.__clsMsgSeen || (document.querySelector('.cls-msg') || {}).textContent || ''
  })`);
  r.eq('leaving takes it off the page', left.cards, 0);
  r.ok('and says so', left.msg.length > 3, left.msg);

  /* ================= a project without the tables ================= */
  r.head('a project that never ran the schema');
  await conn.send('Target.closeTarget', { targetId: s.targetId });
  s = await signedIn(conn, { classes: 404 });
  s.on('Runtime.exceptionThrown', p => errors.push(p.exceptionDetails.text));
  await goto(s, BASE + PAGE);
  await sleep(1200);
  const none = await s.eval(`({
    text: document.getElementById('main').textContent,
    forms: document.querySelectorAll('.cls-form').length
  })`);
  r.ok('the page explains itself instead of erroring',
    /schema|кесте/i.test(none.text), none.text.slice(0, 100));
  r.eq('and offers nothing to press', none.forms, 0);

  // The trap this class of page has here: a repaint that retries a failed load
  // for as long as the page is open.
  const asks = await s.eval(`(async () => {
    let n = 0;
    const real = window.fetch;
    window.fetch = function (u) {
      if (String(u).indexOf('my_classes') > -1) n++;
      return real.apply(this, arguments);
    };
    for (let i = 0; i < 4; i++) { location.hash = '#/'; location.hash = '#/class';
      await new Promise(r=>setTimeout(r,150)); }
    return n;
  })()`);
  r.eq('a project with no classes is asked once, not on every repaint', asks, 0);

  r.eq('nothing threw', errors.length, 0);
  if (errors.length) r.note(errors.slice(0, 3).join('\n    '));

  await conn.send('Target.closeTarget', { targetId: s.targetId });
  conn.close();
  return r.done();
}

run().then(f => process.exit(f ? 1 : 0), e => { console.error(e); process.exit(2); });
