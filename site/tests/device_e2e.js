/* The parts of the app that only misbehave somewhere specific: on a phone, in
   an IELTS answer sheet, with the network cut, and for someone using a keyboard.

   The phone checks are the ones worth keeping honest. Every input under 16px
   makes iOS Safari zoom the page in on focus and never zoom back — one pinch
   per answer — and it is invisible on a desktop.

   node site/tests/device_e2e.js */
'use strict';
const { connect, newContextPage, goto, sleep } = require('./cdp.js');
const { Report } = require('./report.js');
const { signedIn, LIVE, hasBook, NO_BOOK } = require('./supamock.js');

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:8853/';
const PORT = Number(process.env.TEST_CDP || 9333);

/* Each scenario gets a context of its own, and the one before it is closed.
   Leaving them open leaves four renderers running — one of them with a live
   service worker precaching in the background — and the last of them answers
   Runtime.evaluate slowly enough to trip the CDP timeout on a loaded machine. */
async function nextPage(conn, prev, opts) {
  if (prev) {
    try { await conn.send('Target.closeTarget', { targetId: prev.targetId }); }
    catch (e) { /* already gone */ }
  }
  return newContextPage(conn, null, opts);
}

async function run() {
  const r = Report('device');
  const conn = await connect(PORT);

  /* ================= a phone ================= */
  r.head('phone (390 × 844)');
  let s = await nextPage(conn, null);
  await s.send('Emulation.setDeviceMetricsOverride',
    { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await s.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  const noSideways = async (where) => {
    const m = await s.eval(`({ scroll: document.documentElement.scrollWidth,
                               client: document.documentElement.clientWidth })`);
    r.ok(where + ' does not scroll sideways', m.scroll <= m.client + 1, JSON.stringify(m));
  };

  await goto(s, BASE);
  await sleep(800);
  await noSideways('the library');

  await goto(s, BASE + '#/b/grammar/unit/1');
  await sleep(900);
  await noSideways('a book page');
  const phone = await s.eval(`(() => {
    const ins = [...document.querySelectorAll('#main input[type=text]')];
    return {
      fonts: [...new Set(ins.map(i => getComputedStyle(i).fontSize))],
      autocorrect: ins.length ? ins[0].getAttribute('autocorrect') : null,
      enterkeyhint: ins.length ? ins[0].getAttribute('enterkeyhint') : null,
      tabbar: getComputedStyle(document.querySelector('.tabs')).position,
      sidebar: getComputedStyle(document.getElementById('sidebar')).position,
      menu: getComputedStyle(document.getElementById('menuBtn')).display
    };
  })()`);
  r.ok('every answer box is at least 16px, so iOS does not zoom in on focus',
    phone.fonts.every(f => parseFloat(f) >= 16), JSON.stringify(phone.fonts));
  r.eq('answer boxes turn autocorrect off', phone.autocorrect, 'off');
  r.eq('and ask for a "go" key', phone.enterkeyhint, 'go');
  r.eq('the tab bar is pinned to the bottom', phone.tabbar, 'fixed');
  r.eq('the unit list is a drawer, not a column', phone.sidebar, 'fixed');
  r.ok('and ☰ is there to open it', phone.menu !== 'none', phone.menu);

  const drawer = await s.eval(`(async () => {
    document.getElementById('menuBtn').click();
    await new Promise(r=>setTimeout(r,450));
    const sb = document.getElementById('sidebar');
    const foot = document.querySelector('.sidebar-foot');
    const state = { open: sb.classList.contains('open'),
                    overlay: !document.getElementById('overlay').hidden,
                    settings: !!foot && getComputedStyle(foot).display !== 'none',
                    width: sb.getBoundingClientRect().width };
    document.getElementById('overlay').click();
    await new Promise(r=>setTimeout(r,450));
    state.closed = !sb.classList.contains('open') && document.getElementById('overlay').hidden;
    return state;
  })()`);
  r.ok('☰ opens the drawer', drawer.open, JSON.stringify(drawer));
  r.ok('wide enough to read a unit title', drawer.width >= 300, String(drawer.width));
  r.ok('theme and language live inside it on a phone', drawer.settings);
  r.ok('tapping the backdrop closes it', drawer.closed, JSON.stringify(drawer));

  // The deck and the roster hide the drawer, and the drawer is where theme and
  // language live on a phone — so both put them back in the topbar. A practice
  // session deliberately does not: it is a run to finish rather than a place to
  // stay, and ◇ is one tap away. Asserted so the difference stays a decision.
  for (const [hash, name] of [['#/srs', 'the deck'], ['#/users', 'the user list']]) {
    await goto(s, BASE + hash);
    await sleep(600);
    const ctl = await s.eval(`getComputedStyle(document.querySelector('.topbar > .controls')).display`);
    r.ok(name + ' still offers theme and language on a phone', ctl !== 'none', ctl);
    await noSideways(name);
  }
  await goto(s, BASE + '#/drill');
  await sleep(600);
  const session = await s.eval(`({
    controls: getComputedStyle(document.querySelector('.topbar > .controls')).display,
    back: !!document.querySelector('.home-link')
  })`);
  r.eq('a session keeps the topbar clear of settings', session.controls, 'none');
  r.ok('and still has a way out', session.back);
  await noSideways('a session');

  /* ================= IELTS answer sheet ================= */
  // The IELTS books are paid, so this scenario needs a subscription the way a
  // reader would: signed in, with a mocked Supabase answering my_access and
  // handing the book over. Everything after that is the same test it always
  // was — the answer sheet is not supposed to know which road the book took.
  r.head('IELTS answer sheet');
  if (!hasBook('ielts-20')) {
    r.note(NO_BOOK('ielts-20'));
  } else {
    s = await signedIn(conn, { access: LIVE });
    await goto(s, BASE + '#/b/ielts-20/unit/1');
    await sleep(1800);
    const listening = await s.eval(`(() => {
      const a = [...document.querySelectorAll('audio')];
      return { players: a.length,
               src: a.length ? (a[0].currentSrc || a[0].src || (a[0].querySelector('source')||{}).src) : null,
               boxes: document.querySelectorAll('#main input[type=text]').length };
    })()`);
    r.ok('the Listening part comes with its recording', listening.players > 0, JSON.stringify(listening));
    r.eq('forty numbered boxes', listening.boxes, 40);

    const seekable = await s.eval(`(async () => {
      const a = document.querySelector('audio');
      const src = a.currentSrc || a.src || (a.querySelector('source')||{}).src;
      const res = await fetch(src, { headers: { Range: 'bytes=0-1023' } });
      return { status: res.status, range: res.headers.get('content-range'),
               type: res.headers.get('content-type') };
    })()`);
    r.eq('the recording is really on the server', seekable.status, 206);
    r.ok('and can be seeked into', !!seekable.range, JSON.stringify(seekable));

    await goto(s, BASE + '#/b/ielts-20/unit/2');
    await sleep(1600);
    const reading = await s.eval(`(() => {
      const main = document.getElementById('main');
      return { boxes: main.querySelectorAll('input[type=text]').length, length: main.textContent.length };
    })()`);
    r.eq('the Reading part has forty boxes too', reading.boxes, 40);
    r.ok('and carries the passage as selectable text', reading.length > 2000, String(reading.length));

    const graded = await s.eval(`(async () => {
      // Through ENTITLE, not fetch('data/…'): a paid book is not on this host,
      // and this is the same road the app itself took to get it.
      const d = await ENTITLE.fetchBook('ielts-20');
      const first = d.units[1].subExercises[0].items[0];
      const box = document.querySelector('#main input[type=text]');
      box.value = String(first.answer).split(' / ')[0];
      box.dispatchEvent(new Event('input', {bubbles:true}));
      box.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}));
      await new Promise(r=>setTimeout(r,400));
      const items = JSON.parse(localStorage.getItem('agylshyn_v1')).items;
      const k = Object.keys(items).find(x => x.indexOf('ielts-20|') === 0);
      return { key: k, streak: items[k] && items[k].streak, wanted: first.answer };
    })()`);
    r.ok('the printed answer is accepted', graded.streak >= 1, JSON.stringify(graded));
  }

  /* ================= offline ================= */
  r.head('offline');
  s = await nextPage(conn, s, { keepServiceWorker: true });
  await goto(s, BASE);
  await sleep(1200);
  const sw = await s.eval(`(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return { registered: false };
    await navigator.serviceWorker.ready;
    await new Promise(r=>setTimeout(r,2500));      // let the precache finish
    const names = await caches.keys();
    const shell = await caches.open(names.find(n => /shell/.test(n)));
    return { registered: true, caches: names, files: (await shell.keys()).length };
  })()`);
  r.ok('a service worker installs and precaches the shell',
    sw.registered && sw.files >= 15, JSON.stringify(sw));

  await s.send('Network.emulateNetworkConditions',
    { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await goto(s, BASE);
  await sleep(1600);
  const offline = await s.eval(`(() => ({ view: document.body.getAttribute('data-view'),
                                          books: (window.BOOKS||[]).length }))()`);
  r.ok('the library still opens with the network cut',
    offline.view === 'home' && offline.books > 0, JSON.stringify(offline));
  const offlineBook = await s.eval(`(async () => {
    location.hash = '#/b/grammar';
    await new Promise(r=>setTimeout(r,1500));
    return { units: document.querySelectorAll('#unitList li').length,
             boxes: document.querySelectorAll('#main input[type=text]').length };
  })()`);
  r.ok('and a book fetched once opens offline',
    offlineBook.units > 0 && offlineBook.boxes > 0, JSON.stringify(offlineBook));
  await s.send('Network.emulateNetworkConditions',
    { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  /* ================= keyboard and labels ================= */
  r.head('keyboard and labels');
  s = await nextPage(conn, s);
  await goto(s, BASE + '#/b/grammar/unit/1');
  await sleep(900);
  const a11y = await s.eval(`(() => {
    const ins = [...document.querySelectorAll('#main input[type=text]')];
    const btns = [...document.querySelectorAll('button')];
    return {
      inputs: ins.length,
      unlabelled: ins.filter(i => !i.getAttribute('aria-label') && !(i.labels||[]).length).length,
      nameless: btns.filter(b => !b.textContent.trim() && !b.getAttribute('aria-label') && !b.getAttribute('title')).length,
      live: document.querySelectorAll('[aria-live]').length,
      current: document.querySelectorAll('[aria-current]').length
    };
  })()`);
  r.eq('every answer box is labelled for a screen reader', a11y.unlabelled, 0);
  r.eq('no button is left unnamed', a11y.nameless, 0);
  r.ok('verdicts are announced through a live region', a11y.live > 0, String(a11y.live));
  r.ok('the open unit is marked as current', a11y.current > 0, String(a11y.current));

  const keys = await s.eval(`(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', {key:'k', ctrlKey:true, bubbles:true}));
    await new Promise(r=>setTimeout(r,400));
    const opened = !document.getElementById('findModal').hidden;
    const trapped = document.activeElement.closest('#findModal') !== null;
    document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
    await new Promise(r=>setTimeout(r,400));
    return { opened, trapped, closed: document.getElementById('findModal').hidden };
  })()`);
  r.ok('Ctrl+K opens search', keys.opened);
  r.ok('focus moves into the dialog', keys.trapped);
  r.ok('Esc closes it', keys.closed);

  /* ================= the app's own confirm (ask.js) =================
     Every destructive step used to raise a native window.confirm(). The
     replacement has to behave like one in the ways that matter: it blocks
     until answered, Esc and the backdrop mean no, and — the part a native
     dialog gets right for free — a reflex Enter must not be the destructive
     answer. */
  r.head('the confirm dialog');
  const ask = await s.eval(`(async () => {
    const p = ASK.confirm('Delete everything?', { title: 'Careful', yes: 'Delete', danger: true });
    await new Promise(r=>setTimeout(r,200));
    const m = document.getElementById('askModal');
    const out = {
      up: !m.hidden,
      title: (document.getElementById('askTitle')||{}).textContent,
      text: (document.getElementById('askText')||{}).textContent,
      yes: (document.getElementById('askYes')||{}).textContent,
      yesDanger: document.getElementById('askYes').classList.contains('bad'),
      focusOnCancel: document.activeElement === document.getElementById('askNo'),
      trapped: document.activeElement.closest('#askModal') !== null,
      role: m.querySelector('.modal-panel').getAttribute('role')
    };
    document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
    out.escAnswer = await p;
    out.closed = m.hidden;
    return out;
  })()`);
  r.ok('a confirmation opens the app\'s own dialog, not the browser\'s', ask.up);
  r.eq('with the caller\'s title', ask.title, 'Careful');
  r.eq('and the caller\'s question', ask.text, 'Delete everything?');
  r.eq('the confirming button is named for what it does', ask.yes, 'Delete');
  r.ok('a destructive one is coloured as destructive', ask.yesDanger);
  r.ok('it announces itself as an alertdialog', ask.role === 'alertdialog', ask.role);
  r.ok('focus lands on Cancel, so a reflex Enter destroys nothing', ask.focusOnCancel);
  r.ok('focus is inside the dialog', ask.trapped);
  r.eq('Esc answers no', ask.escAnswer, false);
  r.ok('and closes it', ask.closed);

  const askYes = await s.eval(`(async () => {
    const p = ASK.confirm('Go on?');
    await new Promise(r=>setTimeout(r,200));
    document.getElementById('askYes').click();
    return { answer: await p, closed: document.getElementById('askModal').hidden };
  })()`);
  r.eq('pressing the confirming button answers yes', askYes.answer, true);
  r.ok('and closes it too', askYes.closed);

  const tell = await s.eval(`(async () => {
    const p = ASK.tell('Saved.');
    await new Promise(r=>setTimeout(r,200));
    const oneButton = document.getElementById('askNo').hidden;
    document.getElementById('askYes').click();
    await p;
    return { oneButton, closed: document.getElementById('askModal').hidden };
  })()`);
  r.ok('an alert offers one button, not two', tell.oneButton);
  r.ok('and closes when it is pressed', tell.closed);

  return r.done();
}

if (require.main === module) {
  run().then(f => process.exit(f ? 1 : 0))
       .catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
}
module.exports = { run };
