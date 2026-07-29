/* Word cards — a spaced-repetition deck for the words a reader meets in the books.

   Ported from the standalone vocab-srs app (React client + Express/JSON server).
   The site is a static build served from GitHub Pages and has to keep working
   offline, so the server came along as data rather than as code: the SM-2
   scheduler below is the same algorithm, and the store is localStorage instead
   of data.json. Nothing here talks to a network.

   Where the cards come from matters more than the algorithm. Typing a deck by
   hand is work almost nobody does, so the main way in is the word lookup that
   already exists on every exercise: point at an unknown word, get its Kazakh
   translation, tap ＋. dict.js calls addWord() for that; this file also offers a
   bulk "add everything you looked up" pass, a manual form, and a paste/CSV
   import for a list somebody already has.

   Storage is a key of its own (not app.js's `agylshyn_v1`): a deck is far
   bigger than the answer records and has a different merge rule — per card id,
   newest write wins, with tombstones so a delete on one device does not come
   back from another tab.

   Public surface: window.SRS — see the return block at the bottom. */
window.SRS = (function () {
  'use strict';

  var KEY = 'agylshyn_srs_v1';
  var DAY = 86400000;

  // Cards failed this many times in their lifetime are auto-suspended
  // ("leeches") so they stop resurfacing every single day.
  var LEECH_THRESHOLD = 8;

  // A deleted card leaves a tombstone behind so that another tab (or a restored
  // backup) cannot resurrect it. Two months is longer than any plausible gap
  // between two devices being open.
  var TOMB_TTL = 60 * DAY;

  var DEFAULT_GOAL = 10;

  /* ================= storage ================= */

  var data = load();

  function blank() {
    return { v: 1, cards: [], settings: { dailyGoal: DEFAULT_GOAL }, history: {} };
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var p = JSON.parse(raw);
        if (p && Array.isArray(p.cards)) {
          return {
            v: 1,
            cards: p.cards,
            settings: {
              dailyGoal: p.settings && p.settings.dailyGoal > 0
                ? p.settings.dailyGoal : DEFAULT_GOAL
            },
            history: p.history || {}
          };
        }
      }
    } catch (e) { /* corrupt or unavailable storage — start fresh */ }
    return blank();
  }

  var saveTimer = null;
  function writeNow() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); }
    catch (e) { /* quota / private mode — keep working in memory */ }
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeNow, 150);
    emit();
  }
  function flush() { clearTimeout(saveTimer); saveTimer = null; writeNow(); }
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush();
  });

  // A second tab must not silently wipe this tab's deck: re-read the disk copy
  // and merge card by card, newest write winning (`ts`), tombstones included.
  window.addEventListener('storage', function (e) {
    if (e.key !== KEY || !e.newValue) return;
    try {
      var disk = JSON.parse(e.newValue);
      if (!disk || !Array.isArray(disk.cards)) return;
      mergeIn(disk);
      if (viewIsOpen()) render(currentSub);
      emit();
    } catch (err) { /* ignore a malformed cross-tab payload */ }
  });

  function mergeIn(disk) {
    var byId = {};
    data.cards.forEach(function (c) { byId[c.id] = c; });
    (disk.cards || []).forEach(function (c) {
      if (!c || !c.id) return;
      var mine = byId[c.id];
      if (!mine) { data.cards.push(c); byId[c.id] = c; return; }
      if ((c.ts || 0) > (mine.ts || 0)) {
        for (var k in mine) delete mine[k];
        for (var j in c) mine[j] = c[j];
      }
    });
    var dh = disk.history || {};
    for (var d in dh) {
      var mineDay = data.history[d];
      if (!mineDay) { data.history[d] = dh[d]; continue; }
      // Counters, not records: the higher number is the one that saw more work.
      mineDay.newLearned = Math.max(mineDay.newLearned || 0, dh[d].newLearned || 0);
      mineDay.reviewed = Math.max(mineDay.reviewed || 0, dh[d].reviewed || 0);
    }
    purgeTombs();
  }

  function purgeTombs() {
    var cut = Date.now() - TOMB_TTL;
    data.cards = data.cards.filter(function (c) { return !(c.deleted && c.deleted < cut); });
  }

  var listeners = [];
  function emit() {
    listeners.forEach(function (fn) { try { fn(); } catch (e) {} });
  }

  /* ================= dates ================= */

  function dayKey(ts) {
    var d = new Date(ts == null ? Date.now() : ts);
    return d.getFullYear() + '-' +
      ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  // Reviews are scheduled to the START of the target day rather than to the
  // clock time of the review. Someone who studies at 22:00 and comes back at
  // 08:00 the next morning should find yesterday's cards waiting, not "due in
  // 14 hours" — a day-granular algorithm should behave day-granularly.
  function dueAfter(days) {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + Math.max(0, Math.round(days)));
    return d.getTime();
  }

  function today() { return data.history[dayKey()] || { newLearned: 0, reviewed: 0 }; }
  function todayRow() {
    var k = dayKey();
    if (!data.history[k]) data.history[k] = { newLearned: 0, reviewed: 0 };
    return data.history[k];
  }

  function streak() {
    var d = new Date();
    if (!(data.history[dayKey(d.getTime())] || {}).reviewed) d.setDate(d.getDate() - 1);
    var n = 0;
    for (var guard = 0; guard < 400; guard++) {
      if (!(data.history[dayKey(d.getTime())] || {}).reviewed) break;
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }

  /* ================= SM-2 ================= */

  // quality: 0-5 (0 = total blackout, 5 = perfect recall). Same arithmetic as
  // the standalone server's srs.js — only the "when" is start-of-day now.
  function sm2(card, quality) {
    var q = Math.max(0, Math.min(5, quality));

    if (q < 3) {
      card.repetition = 0;
      card.interval = 1;
      card.lapses = (card.lapses || 0) + 1;
      if (card.lapses >= LEECH_THRESHOLD) card.suspended = true;
    } else {
      if (card.repetition === 0) card.interval = 1;
      else if (card.repetition === 1) card.interval = 6;
      else card.interval = Math.round(card.interval * card.ease);
      card.repetition += 1;
    }

    card.ease = Math.max(1.3, card.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
    card.due = dueAfter(card.interval);
    card.lastReviewed = Date.now();
    card.ts = Date.now();
    return card;
  }

  // What each button would do, without doing it — the interval is printed on
  // the button so grading is a choice with a visible consequence rather than a
  // guess about four synonyms for "sort of".
  function preview(card, quality) {
    if (quality < 3) return 1;
    if (card.repetition === 0) return 1;
    if (card.repetition === 1) return 6;
    return Math.round(card.interval * card.ease);
  }

  function newCard(fields) {
    var now = Date.now();
    return {
      id: uid(),
      word: (fields.word || '').trim(),
      translation: (fields.translation || '').trim(),
      example: (fields.example || '').trim(),
      collocations: fields.collocations || [],
      synonyms: fields.synonyms || [],
      antonyms: fields.antonyms || [],
      src: fields.src || null,          // where it came from: {book, unit} or 'lookup'
      createdAt: now,
      repetition: 0,
      interval: 0,
      ease: 2.5,
      due: now,
      lastReviewed: null,
      lapses: 0,
      suspended: false,
      ts: now
    };
  }

  function uid() {
    try {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    } catch (e) { /* older browser — fall through */ }
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }

  /* ================= deck queries ================= */

  function live() {
    return data.cards.filter(function (c) { return !c.deleted; });
  }

  function norm(w) { return String(w || '').trim().toLowerCase(); }

  function findWord(word) {
    var w = norm(word);
    if (!w) return null;
    var list = live();
    for (var i = 0; i < list.length; i++) if (norm(list[i].word) === w) return list[i];
    return null;
  }

  // Everything waiting right now: overdue reviews first, then as many unseen
  // cards as today's goal still allows. Capping the new ones is the whole point
  // of a daily goal — twenty new words a day is a deck abandoned in a week.
  function queue() {
    var now = Date.now();
    var left = Math.max(0, data.settings.dailyGoal - today().newLearned);
    var list = live().filter(function (c) { return !c.suspended; });
    var due = list.filter(function (c) { return c.repetition > 0 && c.due <= now; });
    var fresh = list.filter(function (c) { return c.repetition === 0; }).slice(0, left);
    return due.concat(fresh);
  }

  function stats() {
    var all = live();
    var h = today();
    return {
      total: all.length,
      due: queue().length,
      newToday: h.newLearned,
      reviewedToday: h.reviewed,
      goal: data.settings.dailyGoal,
      streak: streak()
    };
  }

  /* ================= mutations ================= */

  function add(fields) {
    var card = newCard(fields);
    if (!card.word || !card.translation) return null;
    data.cards.push(card);
    save();
    return card;
  }

  function update(id, fields) {
    var c = byId(id);
    if (!c) return null;
    ['word', 'translation', 'example'].forEach(function (k) {
      if (fields[k] !== undefined) c[k] = String(fields[k]).trim();
    });
    if (fields.suspended !== undefined) c.suspended = !!fields.suspended;
    c.ts = Date.now();
    save();
    return c;
  }

  function remove(id) {
    var c = byId(id);
    if (!c) return;
    // Tombstone, not splice: see TOMB_TTL.
    for (var k in c) if (k !== 'id') delete c[k];
    c.deleted = Date.now();
    c.ts = c.deleted;
    save();
  }

  function byId(id) {
    for (var i = 0; i < data.cards.length; i++) {
      if (data.cards[i].id === id && !data.cards[i].deleted) return data.cards[i];
    }
    return null;
  }

  function grade(card, quality) {
    var before = {
      repetition: card.repetition, interval: card.interval, ease: card.ease,
      due: card.due, lastReviewed: card.lastReviewed, lapses: card.lapses || 0,
      suspended: !!card.suspended
    };
    var wasNew = card.repetition === 0;
    var wasSuspended = !!card.suspended;
    sm2(card, quality);
    var row = todayRow();
    row.reviewed += 1;
    if (wasNew && quality >= 3) row.newLearned += 1;
    save();
    return { before: before, wasNew: wasNew, quality: quality,
             becameLeech: card.suspended && !wasSuspended };
  }

  function ungrade(card, action) {
    for (var k in action.before) card[k] = action.before[k];
    card.ts = Date.now();
    var row = todayRow();
    row.reviewed = Math.max(0, row.reviewed - 1);
    if (action.wasNew && action.quality >= 3) {
      row.newLearned = Math.max(0, row.newLearned - 1);
    }
    save();
  }

  /* ================= i18n / DOM helpers ================= */

  // Same shape as app.js's t(), reading the shared tables: a missing key falls
  // back to Kazakh and then to the key itself, so a gap shows up instead of a
  // blank label.
  function t(key, vars) {
    var lang = (window.APP_LANG && window.APP_LANG()) || 'kk';
    var I = window.I18N || {};
    var s = (I[lang] || {})[key];
    if (s == null) s = (I.kk || {})[key];
    if (s == null) return key;
    if (vars) {
      for (var k in vars) s = s.split('{' + k + '}').join(String(vars[k]));
    }
    return s;
  }

  // English wants "1 day" and "3 days"; Kazakh does not inflect after a
  // numeral at all. A key ending in '.1' is the singular form and exists only
  // in the languages that need one — everywhere else this falls straight
  // through to the plain key, so no table has to carry dead entries.
  function tn(key, n, vars) {
    return t(n === 1 && hasKey(key + '.1') ? key + '.1' : key, vars);
  }

  function hasKey(key) {
    var lang = (window.APP_LANG && window.APP_LANG()) || 'kk';
    var I = window.I18N || {};
    return !!((I[lang] || {})[key] || (I.kk || {})[key]);
  }

  function num(n) {
    try { return Number(n).toLocaleString(t('locale')); }
    catch (e) { return String(n); }
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  function btn(cls, text, onClick) {
    var b = el('button', cls, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  function link(cls, text, href) {
    var a = el('a', cls, text);
    a.href = href;
    return a;
  }

  function mainEl() { return document.getElementById('main'); }
  function viewIsOpen() { return document.body.getAttribute('data-view') === 'srs'; }

  // "3 күн", "1 ай", "2 жыл" — an interval of 400 days is true but unreadable.
  function humanDays(n) {
    if (n <= 0) return t('srs.now');
    if (n < 31) return tn('srs.days', n, { n: n });
    var months = Math.round(n / 30);
    if (n < 365) return tn('srs.months', months, { n: months });
    var years = Math.round(n / 365);
    return tn('srs.years', years, { n: years });
  }

  /* ================= chrome: the row of sub-pages ================= */

  var SUBS = [
    { id: '', key: 'srs.nav.today' },
    { id: 'cards', key: 'srs.nav.cards' },
    { id: 'add', key: 'srs.nav.add' },
    { id: 'import', key: 'srs.nav.import' },
    { id: 'settings', key: 'srs.nav.settings' }
  ];

  function navRow(active) {
    var row = el('div', 'srs-nav');
    SUBS.forEach(function (s) {
      var a = link('srs-nav-btn' + (s.id === active ? ' on' : ''), t(s.key),
        '#/srs' + (s.id ? '/' + s.id : ''));
      if (s.id === 'cards') {
        var n = live().length;
        if (n) a.appendChild(el('span', 'srs-nav-n', num(n)));
      }
      row.appendChild(a);
    });
    return row;
  }

  function head(main, titleKey, subKey) {
    var h = el('div', 'page-head');
    h.appendChild(el('h1', null, t(titleKey)));
    if (subKey) h.appendChild(el('div', 'instructions', t(subKey)));
    main.appendChild(h);
  }

  /* ================= view: today ================= */

  function renderToday(main) {
    var s = stats();

    if (!s.total) { renderEmpty(main); return; }

    head(main, 'srs.today.h');

    var cards = el('div', 'cards');
    function stat(k, v, sub, cls) {
      var c = el('div', 'card' + (cls ? ' ' + cls : ''));
      c.appendChild(el('div', 'k', k));
      c.appendChild(el('div', 'v', v));
      if (sub) c.appendChild(el('div', 'srs-stat-sub', sub));
      cards.appendChild(c);
    }
    stat(t('srs.statNew'), num(s.newToday) + ' / ' + num(s.goal), null,
      s.newToday >= s.goal ? 'good' : '');
    stat(t('srs.statReviewed'), num(s.reviewedToday));
    stat(t('srs.statTotal'), num(s.total));
    main.appendChild(cards);

    // Goal bar: one glance answers "am I done for today?".
    var pct = Math.min(100, Math.round(s.newToday / Math.max(1, s.goal) * 100));
    var bar = el('div', 'srs-goal');
    var fill = el('div', 'srs-goal-fill');
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    main.appendChild(bar);

    var cta = el('div', 'srs-cta');
    if (s.due) {
      cta.appendChild(el('div', 'srs-cta-line', tn('srs.due', s.due, { n: num(s.due) })));
      cta.appendChild(link('btn primary big', t('srs.start'), '#/srs/review'));
    } else {
      cta.appendChild(el('span', 'big', '🎉'));
      cta.appendChild(el('div', 'srs-cta-line', t('srs.dueNone')));
      var next = nextDueText();
      if (next) cta.appendChild(el('div', 'instructions', next));
      cta.appendChild(link('btn', t('srs.addMore'), '#/srs/add'));
    }
    main.appendChild(cta);

    main.appendChild(streakBox());

    // A quiet reminder of where cards come from, for the reader who has a deck
    // but has never noticed the ＋ in the lookup popup.
    var tip = el('div', 'srs-tip');
    tip.appendChild(el('span', 'srs-tip-ico', '💡'));
    tip.appendChild(el('span', null, t('srs.tipLookup')));
    main.appendChild(tip);
  }

  function nextDueText() {
    var list = live().filter(function (c) { return !c.suspended && c.repetition > 0; });
    if (!list.length) return '';
    var soonest = list.reduce(function (a, b) { return a.due < b.due ? a : b; }).due;
    var days = Math.max(0, Math.ceil((soonest - Date.now()) / DAY));
    return t('srs.nextDue', { when: humanDays(days) });
  }

  function streakBox() {
    var box = el('div', 'srs-streak');
    var top = el('div', 'srs-streak-head');
    var n = streak();
    top.appendChild(el('b', null, n ? t('srs.streak', { n: num(n) }) : t('srs.streakNone')));
    box.appendChild(top);

    var row = el('div', 'srs-heat');
    for (var i = 13; i >= 0; i--) {
      var d = new Date(Date.now() - i * DAY);
      var r = (data.history[dayKey(d.getTime())] || {}).reviewed || 0;
      var cell = el('span', 'srs-heat-cell heat-' + heatLevel(r));
      cell.title = d.toLocaleDateString(t('locale')) + ' · ' + tn('srs.heatDay', r, { n: r });
      row.appendChild(cell);
    }
    box.appendChild(row);

    var legend = el('div', 'srs-heat-legend');
    legend.appendChild(el('span', 'muted', t('srs.heatLess')));
    for (var l = 0; l <= 4; l++) legend.appendChild(el('span', 'srs-heat-cell heat-' + l));
    legend.appendChild(el('span', 'muted', t('srs.heatMore')));
    box.appendChild(legend);
    return box;
  }

  function heatLevel(r) {
    if (r <= 0) return 0;
    if (r < 4) return 1;
    if (r < 8) return 2;
    if (r < 15) return 3;
    return 4;
  }

  /* ================= view: first run ================= */

  // An empty deck with a "start review" button that does nothing is a dead end.
  // What a newcomer needs is the three sentences that explain what this page is
  // for, and two buttons that fill the deck without any typing.
  function renderEmpty(main) {
    head(main, 'srs.empty.h', 'srs.empty.p');

    var how = el('div', 'srs-how');
    [['👆', 'srs.how1'], ['🔁', 'srs.how2'], ['📈', 'srs.how3']].forEach(function (row) {
      var r = el('div', 'srs-how-row');
      r.appendChild(el('span', 'srs-how-ico', row[0]));
      r.appendChild(el('span', null, t(row[1])));
      how.appendChild(r);
    });
    main.appendChild(how);

    var actions = el('div', 'srs-empty-actions');
    actions.appendChild(link('btn primary', t('srs.addFirst'), '#/srs/add'));

    var recent = lookupHistory();
    if (recent.length) {
      actions.appendChild(btn('btn', tn('srs.fromLookups', recent.length, { n: num(recent.length) }), function () {
        var n = addMany(recent.map(function (r) {
          return { word: r.word, translation: r.kk, example: r.en, src: 'lookup' };
        }));
        toast(tn('srs.added', n, { n: num(n) }));
        render('');
      }));
    }
    actions.appendChild(link('btn', t('srs.nav.import'), '#/srs/import'));
    main.appendChild(actions);

    if (!recent.length) {
      var hint = el('div', 'srs-tip');
      hint.appendChild(el('span', 'srs-tip-ico', '💡'));
      hint.appendChild(el('span', null, t('srs.tipLookup')));
      main.appendChild(hint);
    }
  }

  // Words this reader has already looked up, newest first — dict.js keeps the
  // list; an older build with no such list simply offers no bulk button.
  function lookupHistory() {
    var list = (window.WordLookup && window.WordLookup.recent && window.WordLookup.recent()) || [];
    return list.filter(function (r) { return r.word && r.kk && !findWord(r.word); });
  }

  function addMany(rows) {
    var n = 0;
    rows.forEach(function (r) {
      if (!r.word || !r.translation) return;
      if (findWord(r.word)) return;               // never a duplicate
      data.cards.push(newCard(r));
      n++;
    });
    if (n) save();
    return n;
  }

  /* ================= view: review session ================= */

  var session = null;

  function renderReview(main) {
    if (!session || session.done) startSession();

    if (!session.queue.length) {
      var s0 = el('div', 'empty-state');
      s0.appendChild(el('span', 'big', '🎉'));
      s0.appendChild(el('div', null, t('srs.dueNone')));
      s0.appendChild(link('btn', t('srs.done.back'), '#/srs'));
      main.appendChild(s0);
      return;
    }

    if (session.i >= session.queue.length) {
      session.done = true;
      var s = el('div', 'empty-state');
      s.appendChild(el('span', 'big', '✅'));
      s.appendChild(el('h2', null, t('srs.done.h')));
      s.appendChild(el('div', null, tn('srs.done.p', session.reviewed, { n: num(session.reviewed) })));
      var again = queue();
      var row = el('div', 'sub-actions');
      row.style.justifyContent = 'center';
      if (again.length) {
        row.appendChild(btn('btn primary', tn('srs.done.again', again.length, { n: num(again.length) }), function () {
          session = null;
          render('review');
        }));
      }
      row.appendChild(link('btn', t('srs.done.back'), '#/srs'));
      s.appendChild(row);
      main.appendChild(s);
      return;
    }

    var card = session.queue[session.i];

    var top = el('div', 'srs-review-top');
    top.appendChild(el('span', 'srs-progress', t('srs.progress',
      { i: session.i + 1, n: session.queue.length })));
    var barWrap = el('div', 'srs-progress-bar');
    var barFill = el('div', 'srs-progress-fill');
    barFill.style.width = Math.round(session.i / session.queue.length * 100) + '%';
    barWrap.appendChild(barFill);
    top.appendChild(barWrap);
    if (session.last) {
      top.appendChild(btn('btn small', '↩ ' + t('srs.undo'), undo));
    }
    // The session hides the deck's own nav row, and the topbar arrow leads out
    // of the deck entirely — so stopping half way needs a door of its own.
    top.appendChild(link('btn small', t('srs.quit'), '#/srs'));
    main.appendChild(top);

    if (session.leech) {
      var warn = el('div', 'srs-leech', t('srs.leech', { w: session.leech }));
      main.appendChild(warn);
    }

    var box = flipCard(card);
    main.appendChild(box);

    var grades = el('div', 'srs-grades');
    var hint = el('div', 'srs-hint');
    main.appendChild(grades);
    main.appendChild(hint);

    // Revealing repaints these two rows in place rather than re-rendering the
    // page: a rebuilt card element would start life already flipped and the
    // turn would never be seen.
    function paintFoot() {
      clear(grades);
      if (session.flipped) {
        [[1, 'again'], [3, 'hard'], [4, 'good'], [5, 'easy']].forEach(function (g, idx) {
          var b = el('button', 'srs-grade g-' + g[1]);
          b.type = 'button';
          b.appendChild(el('b', null, t('srs.grade.' + g[1])));
          b.appendChild(el('span', 'srs-grade-when',
            g[0] < 3 ? t('srs.grade.againWhen') : humanDays(preview(card, g[0]))));
          b.appendChild(el('span', 'srs-grade-key', String(idx + 1)));
          b.addEventListener('click', function () { doGrade(g[0]); });
          grades.appendChild(b);
        });
      } else {
        grades.appendChild(btn('btn primary big', t('srs.review.show'), reveal));
      }
      hint.textContent = session.flipped ? backHint() : frontHint();
    }

    function reveal() {
      if (session.flipped) return;
      session.flipped = true;
      var card2 = box.firstChild;
      card2.classList.add('flipped');
      if (card2.setFaces) card2.setFaces(true);
      attachSwipe(card2);
      paintFoot();
    }
    session.reveal = reveal;
    paintFoot();
  }

  // Telling a phone about the "1–4" keys and Space is noise, and it is the one
  // line under the card where there is no room for noise. A coarse pointer gets
  // the swipe instead.
  function touchOnly() {
    try { return window.matchMedia('(pointer: coarse)').matches; }
    catch (e) { return false; }
  }
  function frontHint() { return t(touchOnly() ? 'srs.review.hintTapTouch' : 'srs.review.hintFront'); }
  function backHint() { return t(touchOnly() ? 'srs.review.hintTouch' : 'srs.review.hintBack'); }

  function startSession() {
    session = {
      queue: queue(), i: 0, flipped: false, reviewed: 0,
      last: null, leech: null, requeued: {}
    };
  }

  function flipCard(card) {
    var stage = el('div', 'srs-stage');
    var box = el('div', 'srs-card' + (session.flipped ? ' flipped' : ''));
    var inner = el('div', 'srs-card-inner');

    var front = el('div', 'srs-face srs-front');
    front.appendChild(el('span', 'srs-word', card.word));
    if (card.repetition === 0) front.appendChild(el('span', 'srs-badge', t('srs.badgeNew')));
    front.appendChild(el('span', 'srs-face-hint', t('srs.review.tap')));

    var back = el('div', 'srs-face srs-back');
    back.appendChild(el('span', 'srs-translation', card.translation));
    if (card.example) back.appendChild(el('p', 'srs-example', card.example));
    [['collocations', 'srs.f.colloc'], ['synonyms', 'srs.f.syn'], ['antonyms', 'srs.f.ant']]
      .forEach(function (f) {
        var items = card[f[0]];
        if (!items || !items.length) return;
        var line = el('div', 'srs-tags');
        line.appendChild(el('span', 'srs-tags-k', t(f[1]) + ':'));
        line.appendChild(el('span', null, ' ' + items.join(', ')));
        back.appendChild(line);
      });
    // Hearing the word is half of knowing it, and the browser's own voice costs
    // nothing; a browser without one simply gets no button.
    if (window.Speech && window.Speech.ok) {
      back.appendChild(btn('srs-say', '🔊', function (e) {
        e.stopPropagation();
        window.Speech.speak(card.word);
      }));
    }

    inner.appendChild(front);
    inner.appendChild(back);
    box.appendChild(inner);
    // The hidden face is hidden visually by a CSS 3-D transform, which a screen
    // reader knows nothing about: without this it would read the answer aloud
    // while the reader is still trying to recall it.
    front.setAttribute('aria-hidden', session.flipped ? 'true' : 'false');
    back.setAttribute('aria-hidden', session.flipped ? 'false' : 'true');
    box.setFaces = function (flipped) {
      front.setAttribute('aria-hidden', flipped ? 'true' : 'false');
      back.setAttribute('aria-hidden', flipped ? 'false' : 'true');
    };

    box.addEventListener('click', function () {
      if (!session.flipped && session.reveal) session.reveal();
    });
    if (session.flipped) attachSwipe(box);

    stage.appendChild(box);
    return stage;
  }

  // Swipe right = Good, left = Again. A thumb on a phone is faster than aiming
  // at one of four small buttons, and the drag shows which way it is going
  // before it is let go.
  function attachSwipe(box) {
    var startX = 0, dx = 0, dragging = false;

    box.addEventListener('pointerdown', function (e) {
      if (e.button != null && e.button !== 0) return;
      dragging = true;
      startX = e.clientX;
      dx = 0;
      box.classList.add('dragging');
      try { box.setPointerCapture(e.pointerId); } catch (err) {}
    });
    box.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      dx = e.clientX - startX;
      box.style.transform = 'translateX(' + dx + 'px) rotate(' + (dx / 26) + 'deg)';
      box.classList.toggle('to-good', dx > 40);
      box.classList.toggle('to-again', dx < -40);
    });
    function end() {
      if (!dragging) return;
      dragging = false;
      box.classList.remove('dragging', 'to-good', 'to-again');
      box.style.transform = '';
      if (Math.abs(dx) > 110) doGrade(dx > 0 ? 4 : 1);
      dx = 0;
    }
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
  }

  function doGrade(quality) {
    var card = session.queue[session.i];
    if (!card) return;
    var action = grade(card, quality);
    session.leech = action.becameLeech ? card.word : null;
    session.reviewed++;
    session.flipped = false;
    session.i++;
    // "Again" means the word was not known, and putting it off until tomorrow
    // wastes the one moment it is on the reader's mind: it comes back at the
    // end of this session too — once, so a word nobody can remember today
    // cannot trap the session in a loop. The stored schedule is untouched;
    // this is the session's own second pass, not a second SM-2 step.
    var requeued = false;
    if (quality < 3 && !card.suspended && !session.requeued[card.id]) {
      session.queue.push(card);
      session.requeued[card.id] = 1;
      requeued = true;
    }
    session.last = { card: card, action: action, index: session.i - 1, requeued: requeued };
    render('review');
  }

  function undo() {
    if (!session || !session.last) return;
    var l = session.last;
    ungrade(l.card, l.action);
    // A card re-queued by "Again" leaves again with it — it is the last one
    // pushed, and undo only ever reverts the most recent grade.
    if (l.requeued) {
      session.queue.pop();
      delete session.requeued[l.card.id];
    }
    session.i = l.index;
    session.flipped = true;      // back to the answer they had just seen
    session.reviewed = Math.max(0, session.reviewed - 1);
    session.last = null;
    session.leech = null;
    render('review');
  }

  // 1-4 grade, space/enter reveal-then-Good, U undo. Bound once, on the
  // document, and inert outside a review session.
  document.addEventListener('keydown', function (e) {
    if (!viewIsOpen() || currentSub !== 'review' || !session) return;
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (session.i >= session.queue.length) return;

    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!session.flipped) { if (session.reveal) session.reveal(); }
      else doGrade(4);
    } else if (session.flipped && e.key >= '1' && e.key <= '4') {
      e.preventDefault();
      doGrade([1, 3, 4, 5][Number(e.key) - 1]);
    } else if ((e.key === 'u' || e.key === 'U') && session.last) {
      e.preventDefault();
      undo();
    }
  });

  /* ================= view: all cards ================= */

  var cardQuery = '';

  function renderCards(main) {
    head(main, 'srs.cards.h');

    var all = live().slice().sort(function (a, b) { return b.createdAt - a.createdAt; });

    var search = el('input', 'srs-search');
    search.type = 'search';
    search.value = cardQuery;
    search.placeholder = t('srs.cards.search');
    search.autocomplete = 'off';
    search.spellcheck = false;
    search.addEventListener('input', function () {
      cardQuery = search.value;
      var list = document.getElementById('srsList');
      if (list) { clear(list); fillList(list, all); }
    });
    main.appendChild(search);

    if (!all.length) {
      var s = el('div', 'empty-state');
      s.appendChild(el('div', null, t('srs.cards.none')));
      s.appendChild(link('btn primary', t('srs.addFirst'), '#/srs/add'));
      main.appendChild(s);
      return;
    }

    var list = el('div', 'srs-list');
    list.id = 'srsList';
    fillList(list, all);
    main.appendChild(list);
  }

  function fillList(list, all) {
    var q = norm(cardQuery);
    var rows = q ? all.filter(function (c) {
      return norm(c.word).indexOf(q) > -1 || norm(c.translation).indexOf(q) > -1;
    }) : all;

    if (!rows.length) { list.appendChild(el('div', 'instructions', t('srs.cards.noneFound'))); return; }
    rows.forEach(function (c) { list.appendChild(cardRow(c, list, all)); });
  }

  function cardRow(c, list, all) {
    var row = el('div', 'srs-row' + (c.suspended ? ' suspended' : ''));

    var main = el('div', 'srs-row-main');
    main.appendChild(el('b', 'srs-row-word', c.word));
    main.appendChild(el('span', 'srs-row-tr', c.translation));
    row.appendChild(main);

    var meta = el('div', 'srs-row-meta');
    meta.appendChild(el('span', 'srs-chip', statusText(c)));
    if (c.lapses) meta.appendChild(el('span', 'srs-chip bad', t('srs.cards.lapses', { n: c.lapses })));
    row.appendChild(meta);

    var acts = el('div', 'srs-row-acts');
    acts.appendChild(btn('btn small', t('srs.cards.edit'), function () {
      editRow(row, c, list, all);
    }));
    acts.appendChild(btn('btn small', c.suspended ? t('srs.cards.resume') : t('srs.cards.suspend'),
      function () {
        update(c.id, { suspended: !c.suspended });
        clear(list); fillList(list, all);
      }));
    acts.appendChild(btn('btn small danger', t('srs.cards.delete'), function () {
      if (!confirm(t('srs.cards.confirmDelete', { w: c.word }))) return;
      remove(c.id);
      var i = all.indexOf(c);
      if (i > -1) all.splice(i, 1);
      clear(list); fillList(list, all);
    }));
    row.appendChild(acts);

    return row;
  }

  function statusText(c) {
    if (c.suspended) return t('srs.cards.suspended');
    if (c.repetition === 0) return t('srs.badgeNew');
    var days = Math.ceil((c.due - Date.now()) / DAY);
    if (days <= 0) return t('srs.cards.dueNow');
    return t('srs.cards.dueIn', { when: humanDays(days) });
  }

  function editRow(row, c, list, all) {
    clear(row);
    row.classList.add('editing');
    var form = el('div', 'srs-edit');
    var w = field(t('srs.add.word'), c.word);
    var tr = field(t('srs.add.translation'), c.translation);
    var ex = field(t('srs.add.example'), c.example);
    form.appendChild(w.wrap); form.appendChild(tr.wrap); form.appendChild(ex.wrap);

    var acts = el('div', 'srs-row-acts');
    acts.appendChild(btn('btn primary small', t('srs.cards.save'), function () {
      if (!w.input.value.trim() || !tr.input.value.trim()) return;
      update(c.id, { word: w.input.value, translation: tr.input.value, example: ex.input.value });
      clear(list); fillList(list, all);
    }));
    acts.appendChild(btn('btn small', t('srs.cards.cancel'), function () {
      clear(list); fillList(list, all);
    }));
    form.appendChild(acts);
    row.appendChild(form);
    w.input.focus();
  }

  function field(label, value, type) {
    var wrap = el('label', 'srs-field');
    wrap.appendChild(el('span', 'srs-field-k', label));
    var input = el('input');
    input.type = type || 'text';
    input.value = value || '';
    input.autocomplete = 'off';
    input.autocapitalize = 'off';
    input.spellcheck = false;
    input.setAttribute('autocorrect', 'off');
    wrap.appendChild(input);
    return { wrap: wrap, input: input };
  }

  /* ================= view: add one ================= */

  function renderAdd(main) {
    head(main, 'srs.add.h', 'srs.add.p');

    var form = el('div', 'srs-form');
    var w = field(t('srs.add.word'), '');
    var tr = field(t('srs.add.translation'), '');
    var ex = field(t('srs.add.example'), '');
    form.appendChild(w.wrap);
    form.appendChild(tr.wrap);
    form.appendChild(ex.wrap);
    tr.wrap.appendChild(el('span', 'srs-field-hint', t('srs.add.hintAuto')));

    var msg = el('div', 'srs-msg');
    form.appendChild(msg);

    // Typing the English word is enough: the bundled dictionary fills the
    // Kazakh side in, and the reader only corrects it if they disagree. `auto`
    // makes sure a hand-typed translation is never overwritten.
    var auto = true, lookupTimer = null;
    tr.input.addEventListener('input', function () { auto = false; });
    w.input.addEventListener('input', function () {
      clearTimeout(lookupTimer);
      var raw = w.input.value.trim();
      if (!auto || !raw || !window.WordLookup) return;
      lookupTimer = setTimeout(function () {
        window.WordLookup.lookup(raw, function (entry) {
          if (!entry || entry.loading || entry.missing) return;
          if (!auto || w.input.value.trim() !== raw) return;
          if (entry.kk) tr.input.value = entry.kk;
          if (entry.en && !ex.input.value) ex.input.value = entry.en;
        });
      }, 350);
    });

    function submit(keepGoing) {
      var word = w.input.value.trim();
      var trans = tr.input.value.trim();
      clear(msg);
      if (!word) { msg.appendChild(el('span', 'bad', t('srs.add.needWord'))); w.input.focus(); return; }
      if (!trans) { msg.appendChild(el('span', 'bad', t('srs.add.needTranslation'))); tr.input.focus(); return; }
      var dup = findWord(word);
      if (dup) { msg.appendChild(el('span', 'bad', t('srs.add.dup', { w: word }))); return; }
      add({ word: word, translation: trans, example: ex.input.value });
      if (keepGoing) {
        w.input.value = ''; tr.input.value = ''; ex.input.value = '';
        auto = true;
        msg.appendChild(el('span', 'ok', t('srs.add.saved', { w: word })));
        w.input.focus();
      } else {
        location.hash = '#/srs';
      }
    }

    w.input.addEventListener('keydown', function (e) { if (e.key === 'Enter') tr.input.focus(); });
    ex.input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(true); });
    tr.input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(true); });

    var acts = el('div', 'sub-actions');
    acts.appendChild(btn('btn primary', t('srs.add.save'), function () { submit(false); }));
    acts.appendChild(btn('btn', t('srs.add.saveMore'), function () { submit(true); }));
    form.appendChild(acts);
    main.appendChild(form);
    w.input.focus();

    var recent = lookupHistory();
    if (recent.length) {
      main.appendChild(el('div', 'section-title', t('srs.add.fromLookupsH')));
      var box = el('div', 'srs-lookups');
      recent.slice(0, 24).forEach(function (r) {
        var b = btn('srs-lookup', r.word, function () {
          add({ word: r.word, translation: r.kk, example: r.en || '', src: 'lookup' });
          b.disabled = true;
          b.classList.add('done');
          b.textContent = '✓ ' + r.word;
        });
        b.title = r.kk;
        box.appendChild(b);
      });
      main.appendChild(box);
      main.appendChild(btn('btn', tn('srs.fromLookups', recent.length, { n: num(recent.length) }), function () {
        var n = addMany(recent.map(function (r) {
          return { word: r.word, translation: r.kk, example: r.en, src: 'lookup' };
        }));
        toast(tn('srs.added', n, { n: num(n) }));
        render('add');
      }));
    }
  }

  /* ================= view: import / backup ================= */

  function renderImport(main) {
    head(main, 'srs.import.h', 'srs.import.p');

    var area = el('textarea', 'srs-paste');
    area.rows = 8;
    area.placeholder = t('srs.import.placeholder');
    main.appendChild(area);

    var out = el('div', 'srs-msg');

    var acts = el('div', 'sub-actions');
    acts.appendChild(btn('btn primary', t('srs.import.go'), function () {
      var parsed = parseRows(area.value);
      clear(out);
      if (!parsed.rows.length) { out.appendChild(el('span', 'bad', t('srs.import.none'))); return; }
      var n = addMany(parsed.rows);
      out.appendChild(el('span', 'ok', tn('srs.added', n, { n: num(n) })));
      // Every line is accounted for: a reader who pastes 40 and gets 31 should
      // not have to work out which nine went missing, or whether they did.
      var skipped = parsed.skipped + (parsed.rows.length - n);
      if (skipped) {
        out.appendChild(el('span', 'muted', ' ' + tn('srs.import.skipped', skipped, { n: num(skipped) })));
      }
      area.value = '';
    }));

    var file = el('input');
    file.type = 'file';
    file.accept = '.csv,.tsv,.txt,.json';
    file.style.display = 'none';
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        clear(out);
        var text = String(reader.result || '');
        if (/\.json$/i.test(f.name)) { restore(text, out); }
        else { area.value = text; out.appendChild(el('span', 'muted', t('srs.import.loaded', { f: f.name }))); }
      };
      reader.readAsText(f);
      file.value = '';
    });
    acts.appendChild(btn('btn', t('srs.import.file'), function () { file.click(); }));
    main.appendChild(acts);
    main.appendChild(file);
    main.appendChild(out);

    main.appendChild(el('div', 'section-title', t('srs.import.backupH')));
    main.appendChild(el('div', 'instructions', t('srs.import.backupP')));
    var backup = el('div', 'sub-actions');
    backup.appendChild(btn('btn', t('srs.import.export'), exportFile));
    backup.appendChild(btn('btn', t('srs.import.restore'), function () { file.click(); }));
    main.appendChild(backup);
  }

  // One card per line: "word<TAB>translation<TAB>example", or the same with a
  // comma or a semicolon. Which one is guessed per line, so a list copied out
  // of a spreadsheet and a list typed by hand both work without a settings
  // dialog asking about delimiters.
  function parseRows(text) {
    var rows = [], skipped = 0;
    String(text || '').split(/\r?\n/).forEach(function (line) {
      if (!line.trim()) return;
      var parts = line.indexOf('\t') > -1 ? line.split('\t')
        : line.indexOf(';') > -1 ? line.split(';')
        : line.indexOf(' - ') > -1 ? line.split(' - ')
        : line.split(',');
      var word = (parts[0] || '').trim().replace(/^["']|["']$/g, '');
      var tr = (parts[1] || '').trim().replace(/^["']|["']$/g, '');
      if (/^word$/i.test(word)) return;             // a header row from a spreadsheet
      if (!word || !tr) { skipped++; return; }
      rows.push({ word: word, translation: tr, example: (parts[2] || '').trim() });
    });
    return { rows: rows, skipped: skipped };
  }

  function exportFile() {
    var payload = {
      v: 1,
      exportedAt: new Date().toISOString(),
      settings: data.settings,
      history: data.history,
      // Tombstones are an internal detail; a backup carries real cards only.
      cards: live()
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'agylshyn-words-' + dayKey() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // Accepts this app's own export and a backup from the standalone vocab-srs
  // server (ISO dates, `easeFactor`/`dueDate` names). Restoring adds to the
  // deck rather than replacing it — losing a deck to a mis-clicked file would
  // be far worse than a few duplicates, which are skipped anyway.
  function restore(text, out) {
    var parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { out.appendChild(el('span', 'bad', t('srs.import.badJson'))); return; }
    if (!parsed || !Array.isArray(parsed.cards)) {
      out.appendChild(el('span', 'bad', t('srs.import.badFile')));
      return;
    }
    var n = 0;
    parsed.cards.forEach(function (raw) {
      if (!raw || !raw.word || !raw.translation) return;
      if (findWord(raw.word)) return;
      var c = newCard({
        word: raw.word, translation: raw.translation, example: raw.example,
        collocations: raw.collocations, synonyms: raw.synonyms, antonyms: raw.antonyms
      });
      c.repetition = raw.repetition || 0;
      c.interval = raw.interval || 0;
      c.ease = raw.ease || raw.easeFactor || 2.5;
      c.due = toMs(raw.due || raw.dueDate) || Date.now();
      c.lastReviewed = toMs(raw.lastReviewed || raw.lastReviewedAt) || null;
      c.createdAt = toMs(raw.createdAt) || Date.now();
      c.lapses = raw.lapses || 0;
      c.suspended = !!raw.suspended;
      data.cards.push(c);
      n++;
    });
    var h = parsed.history || {};
    for (var d in h) {
      if (!data.history[d]) data.history[d] = { newLearned: 0, reviewed: 0 };
      data.history[d].newLearned = Math.max(data.history[d].newLearned, h[d].newLearned || 0);
      data.history[d].reviewed = Math.max(data.history[d].reviewed, h[d].reviewed || 0);
    }
    if (n) save();
    out.appendChild(el('span', 'ok', tn('srs.added', n, { n: num(n) })));
  }

  function toMs(v) {
    if (v == null) return null;
    if (typeof v === 'number') return v;
    var ms = Date.parse(v);
    return isNaN(ms) ? null : ms;
  }

  /* ================= view: settings ================= */

  function renderSettings(main) {
    head(main, 'srs.set.h');

    var form = el('div', 'srs-form');
    var goal = field(t('srs.set.goal'), String(data.settings.dailyGoal), 'number');
    goal.input.min = '1';
    goal.input.max = '100';
    goal.wrap.appendChild(el('span', 'srs-field-hint', t('srs.set.goalHint')));
    form.appendChild(goal.wrap);

    var msg = el('div', 'srs-msg');
    var acts = el('div', 'sub-actions');
    acts.appendChild(btn('btn primary', t('srs.set.save'), function () {
      var v = parseInt(goal.input.value, 10);
      clear(msg);
      if (!v || v < 1) { msg.appendChild(el('span', 'bad', t('srs.set.goalBad'))); return; }
      data.settings.dailyGoal = Math.min(100, v);
      save();
      msg.appendChild(el('span', 'ok', t('srs.set.saved')));
    }));
    form.appendChild(acts);
    form.appendChild(msg);
    main.appendChild(form);

    main.appendChild(el('div', 'section-title', t('srs.set.dangerH')));
    main.appendChild(el('div', 'instructions', t('srs.set.dangerP')));
    var danger = el('div', 'sub-actions');
    danger.appendChild(btn('btn', t('srs.import.export'), exportFile));
    danger.appendChild(btn('btn danger', t('srs.set.wipe'), function () {
      if (!confirm(tn('srs.set.wipeConfirm', live().length, { n: num(live().length) }))) return;
      live().forEach(function (c) { remove(c.id); });
      data.history = {};
      session = null;
      save();
      location.hash = '#/srs';
      render('');
    }));
    main.appendChild(danger);
  }

  /* ================= toast ================= */

  var toastEl = null, toastTimer = null;
  function toast(text) {
    if (!toastEl) {
      toastEl = el('div', 'srs-toast');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
  }

  /* ================= render ================= */

  var currentSub = '';

  function render(sub) {
    currentSub = sub || '';
    var main = mainEl();
    if (!main) return;
    clear(main);
    var wrap = el('div', 'srs-wrap');

    if (currentSub !== 'review') wrap.appendChild(navRow(currentSub));

    if (currentSub === 'review') renderReview(wrap);
    else if (currentSub === 'cards') renderCards(wrap);
    else if (currentSub === 'add') renderAdd(wrap);
    else if (currentSub === 'import') renderImport(wrap);
    else if (currentSub === 'settings') renderSettings(wrap);
    else renderToday(wrap);

    main.appendChild(wrap);
    if (window.WordLookup) window.WordLookup.attach(wrap);
    window.scrollTo(0, 0);
  }

  /* ================= api ================= */

  return {
    // app.js routing: '' | 'review' | 'cards' | 'add' | 'import' | 'settings'
    open: render,
    subs: ['review', 'cards', 'add', 'import', 'settings'],

    stats: stats,
    dueCount: function () { return queue().length; },
    total: function () { return live().length; },

    // The one line under "My words" on the home page. It lives here because it
    // is the deck's own sentence — plural rules and all — and app.js should not
    // have to know which of the three cases applies.
    homeSub: function () {
      var due = queue().length, have = live().length;
      if (due) return tn('srs.home.sub', due, { n: num(due) });
      if (have) return tn('srs.home.subIdle', have, { n: num(have) });
      return t('srs.home.sub0');
    },

    // dict.js's lookup popup: is this word already saved, and save it.
    has: function (word) { return !!findWord(word); },
    addWord: function (fields) {
      if (findWord(fields.word)) return null;
      var c = add(fields);
      if (c) toast(t('srs.savedToast', { w: c.word }));
      return c;
    },

    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },

    // A session survives leaving the page — the same way a practice run does —
    // so checking a word in the list mid-review does not throw the run away.
    // This is the escape hatch for when the deck changes underneath it.
    endSession: function () { session = null; }
  };
})();
