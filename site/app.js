/* Grammar & Vocabulary in Use — six books, one practice app.
   Engine is vocab-preint's, generalised over a book id.
   UI is bilingual (kk / en); strings live in i18n.js. */
(function () {
  'use strict';

  var BOOKS = window.BOOKS || [];
  var I18N = window.I18N || { kk: {}, en: {} };
  var STORE_KEY = 'agylshyn_v1';
  var MASTER_STREAK = 3;
  // Spaced-review ladder (days). Each correct answer pushes the next review out
  // further; a wrong answer resets it to "due now".
  var REVIEW_INTERVALS = [1, 3, 7, 21, 60];
  // Two states only. The OS preference just picks the default on a first visit.
  var THEMES = ['light', 'dark'];
  var THEME_ICON = { light: '☀', dark: '☾' };

  function bookMeta(id) {
    for (var i = 0; i < BOOKS.length; i++) if (BOOKS[i].id === id) return BOOKS[i];
    return null;
  }

  /* ================= storage ================= */

  var state = load();

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        if (p && p.items) {
          return {
            v: 1,
            items: p.items,
            books: p.books || {},
            daily: p.daily || {},          // 'YYYY-MM-DD' -> answers that day
            last: p.last || null,
            lang: I18N[p.lang] ? p.lang : defaultLang(),
            theme: THEMES.indexOf(p.theme) > -1 ? p.theme : defaultTheme(),
            warnOk: p.warnOk || {},
            ui: p.ui || {}
          };
        }
      }
    } catch (e) { /* corrupt or unavailable storage — start fresh */ }
    return { v: 1, items: {}, books: {}, daily: {}, last: null, lang: defaultLang(), theme: defaultTheme(), warnOk: {}, ui: {} };
  }

  // First visit (or a stored 'auto' from the old three-state toggle): resolve the
  // OS preference once into a concrete theme, then never consult it again.
  function defaultTheme() {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (e) { return 'light'; }
  }

  // First visit: follow the browser, but only into a language we actually have.
  function defaultLang() {
    var nav = (navigator.language || '').toLowerCase();
    return nav.indexOf('en') === 0 ? 'en' : 'kk';
  }

  var saveTimer = null;
  function writeNow() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch (e) { /* quota / private mode — keep working in memory */ }
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeNow, 120);
  }
  // Write immediately, cancelling any pending debounce — used when the page is
  // about to be hidden or closed so the last answer is never lost (AUDIT §Ә1).
  function flush() {
    clearTimeout(saveTimer);
    saveTimer = null;
    writeNow();
  }
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush();
  });

  // A second tab writing the store must not silently wipe this tab's work.
  // Re-read the disk copy and merge record-by-record, newest write winning
  // (records carry `ts`); then repaint the open view (AUDIT §Ә2).
  window.addEventListener('storage', function (e) {
    if (e.key !== STORE_KEY || !e.newValue) return;
    try {
      var disk = JSON.parse(e.newValue);
      if (!disk || !disk.items) return;
      mergeInto(state, disk);
      route();
    } catch (err) { /* ignore a malformed cross-tab payload */ }
  });

  function mergeInto(cur, disk) {
    var di = disk.items || {};
    for (var k in di) {
      var a = cur.items[k], b = di[k];
      if (!a || (b && (b.ts || 0) >= (a.ts || 0))) cur.items[k] = b;
    }
    var dd = disk.daily || {};
    cur.daily = cur.daily || {};
    for (var d in dd) cur.daily[d] = Math.max(cur.daily[d] || 0, dd[d]);
    if (disk.last) cur.last = disk.last;
    cur.books = disk.books || cur.books;
  }

  function todayKey(ts) {
    var d = new Date(ts == null ? Date.now() : ts);
    return d.getFullYear() + '-' +
      ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function bumpDaily() {
    var k = todayKey();
    state.daily[k] = (state.daily[k] || 0) + 1;
  }

  function keyOf(bookId, unit, subNum, n) {
    return bookId + '|' + unit + '|' + subNum + '|' + n;
  }
  function rec(key) { return state.items[key] || null; }
  function ensure(key) {
    if (!state.items[key]) state.items[key] = { streak: 0, wrong: 0, last: null, mastered: false, val: '', self: false };
    return state.items[key];
  }

  /* ================= i18n ================= */

  // t('unit.score', {c: 3, t: 10, p: 30}) — missing keys fall back to kk, then
  // to the key itself so a gap is visible rather than silently blank.
  function t(key, vars) {
    var dict = I18N[state.lang] || I18N.kk;
    var s = dict[key];
    if (s == null) s = I18N.kk[key];
    if (s == null) return key;
    if (!vars) return s;
    return s.replace(/\{(\w+)\}/g, function (m, name) {
      return vars[name] != null ? vars[name] : m;
    });
  }

  function num(n) {
    try { return Number(n).toLocaleString(t('locale')); }
    catch (e) { return String(n); }
  }

  // Fills every element carrying a data-i18n* attribute in the static shell.
  function applyStatic() {
    document.documentElement.lang = t('html.lang');
    document.title = t('app.title');
    [].forEach.call(document.querySelectorAll('[data-i18n]'), function (n) {
      n.textContent = t(n.getAttribute('data-i18n'));
    });
    [].forEach.call(document.querySelectorAll('[data-i18n-placeholder]'), function (n) {
      n.placeholder = t(n.getAttribute('data-i18n-placeholder'));
    });
    [].forEach.call(document.querySelectorAll('[data-i18n-aria]'), function (n) {
      n.setAttribute('aria-label', t(n.getAttribute('data-i18n-aria')));
    });
    [].forEach.call(document.querySelectorAll('.lang-switch button'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-lang') === state.lang);
    });
    applyTheme();     // its tooltip is translated too
  }

  /* ================= theme ================= */

  function applyTheme() {
    var th = THEMES.indexOf(state.theme) > -1 ? state.theme : defaultTheme();
    state.theme = th;
    document.documentElement.setAttribute('data-theme', th);

    [].forEach.call(document.querySelectorAll('[data-theme-btn]'), function (b) {
      b.textContent = THEME_ICON[th];
      b.title = t('theme.' + th);
      b.setAttribute('aria-label', t('theme.' + th));
    });
  }

  function cycleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    save();
    applyTheme();
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-theme-btn]');
    if (b) cycleTheme();
  });

  function setLang(lang) {
    if (!I18N[lang] || lang === state.lang) return;
    state.lang = lang;
    save();
    applyStatic();
    if (!helpModal.hidden) renderHelpInto(helpModalBody);
    route();          // re-render whatever view is open, in the new language
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.lang-switch button');
    if (b) setLang(b.getAttribute('data-lang'));
  });

  /* ================= answer checking ================= */

  // Lowercase, unify quote characters, then keep letters/digits only.
  function norm(s) {
    if (s == null) return '';
    return String(s)
      .toLowerCase()
      .replace(/[‘’‚‛′´`]/g, "'")
      .replace(/[“”„″]/g, '"')
      .replace(/[^\p{L}\p{N}]+/gu, '');
  }

  // "eat (any) lunch" -> ["eat (any) lunch", "eat  lunch"] (both spellings accepted)
  function expandParens(s) {
    var out = [s];
    for (var guard = 0; guard < 8; guard++) {
      var next = [];
      var grew = false;
      for (var i = 0; i < out.length; i++) {
        var cur = out[i];
        var m = /\(([^()]*)\)/.exec(cur);
        next.push(cur);
        if (m) {
          grew = true;
          next.push(cur.slice(0, m.index) + ' ' + cur.slice(m.index + m[0].length));
          next.push(cur.slice(0, m.index) + ' ' + m[1] + ' ' + cur.slice(m.index + m[0].length));
        }
        if (next.length > 64) break;
      }
      out = dedupe(next);
      if (!grew || out.length > 64) break;
    }
    return out;
  }

  // "comes out /is published" -> ["comes out ", "is published"]
  function splitAlternatives(s) {
    return String(s)
      .split(/\s*\/\s*|\s+or\s+/i)
      .filter(function (p) { return p && p.trim(); });
  }

  // A slash often alternates a single word inside a longer phrase:
  // "took/got a train" -> ["took a train", "got a train"].
  function expandSlashTokens(s) {
    var tokens = String(s).trim().split(/\s+/);
    var out = [''];
    for (var i = 0; i < tokens.length; i++) {
      var choices = tokens[i].indexOf('/') > -1
        ? tokens[i].split('/').filter(function (c) { return c; })
        : [tokens[i]];
      if (!choices.length) continue;
      var next = [];
      for (var a = 0; a < out.length; a++) {
        for (var b = 0; b < choices.length; b++) {
          next.push(out[a] ? out[a] + ' ' + choices[b] : choices[b]);
        }
      }
      out = next.slice(0, 64);
    }
    return out;
  }

  function dedupe(arr) {
    var seen = Object.create(null), out = [];
    for (var i = 0; i < arr.length; i++) {
      if (!seen[arr[i]]) { seen[arr[i]] = 1; out.push(arr[i]); }
    }
    return out;
  }

  // All accepted normalised forms of a book answer.
  function buildVariants(answer) {
    var set = Object.create(null);
    var add = function (v) { var k = norm(v); if (k) set[k] = 1; };
    var raw = String(answer == null ? '' : answer);
    var bases = dedupe([raw].concat(expandSlashTokens(raw)));
    for (var i = 0; i < bases.length; i++) {
      var withParens = expandParens(bases[i]);
      for (var j = 0; j < withParens.length; j++) {
        add(withParens[j]);
        var alts = splitAlternatives(withParens[j]);
        for (var k = 0; k < alts.length; k++) add(alts[k]);
      }
    }
    return set;
  }

  // Many answers are a comma-separated list where order does not matter
  // ("furniture, information" ≡ "information, furniture"). Compare them as a
  // set so a correct-but-reordered answer is accepted (AUDIT §3.3, 729 items).
  // Only kicks in when the book answer really is a list of two or more parts.
  function listParts(s) {
    return String(s == null ? '' : s)
      .split(/\s*[,;]\s*|\s+and\s+|\s*&\s*/i)
      .map(norm)
      .filter(function (p) { return p; });
  }
  function matchesAsSet(input, answer) {
    var want = listParts(answer);
    if (want.length < 2) return false;
    var got = listParts(input);
    if (got.length !== want.length) return false;
    want = want.slice().sort();
    got = got.slice().sort();
    for (var i = 0; i < want.length; i++) if (want[i] !== got[i]) return false;
    return true;
  }

  // Accepts the book answer and, where the source has one, the gap-only form:
  // "He’s tying / He is tying" also accepts "’s tying".
  function isMatch(input, it) {
    var typed = norm(input);
    if (!typed) return false;
    if (buildVariants(it.answer)[typed]) return true;
    if (it.blank && buildVariants(it.blank)[typed]) return true;
    return matchesAsSet(input, it.answer);
  }

  /* ================= item classification ================= */

  function isExample(it) { return it.isExample === true; }
  // No reliable key to compare against -> learner marks it themselves.
  function isManual(it) {
    return !isExample(it) &&
      (it.answer == null || it.exampleAnswers === true || it.selfCheck === true || !norm(it.answer));
  }
  function isAuto(it) { return !isExample(it) && !isManual(it); }
  // Counted towards progress — must match tracked() in tools/build_data.py.
  function isTracked(sub, it) {
    return (sub.type === 'items' || sub.type === 'text') && !isExample(it);
  }

  function unitStats(bookId, u) {
    var total = 0, done = 0, correct = 0, mastered = 0, review = 0;
    (u.subExercises || []).forEach(function (sub) {
      (sub.items || []).forEach(function (it) {
        if (!isTracked(sub, it)) return;
        total++;
        var r = rec(keyOf(bookId, u.unit, sub.number, it.n));
        if (!r || !r.last) return;
        done++;
        if (r.last === 'correct') correct++;
        if (r.mastered) mastered++;
        if (r.wrong > 0 && !r.mastered) review++;
      });
    });
    return {
      total: total, done: done, correct: correct, mastered: mastered, review: review,
      pct: total ? Math.round(correct / total * 100) : 0
    };
  }

  function allErrors(bk) {
    var groups = [];
    bk.units.forEach(function (u) {
      var list = [];
      (u.subExercises || []).forEach(function (sub) {
        (sub.items || []).forEach(function (it) {
          if (isExample(it)) return;
          var r = rec(keyOf(bk.id, u.unit, sub.number, it.n));
          if (r && r.wrong > 0 && !r.mastered) list.push({ sub: sub, item: it });
        });
      });
      if (list.length) groups.push({ unit: u, list: list });
    });
    return groups;
  }

  function errorCount(bk) {
    return allErrors(bk).reduce(function (n, g) { return n + g.list.length; }, 0);
  }

  // Exact per-book roll-up, cached so the library page can show a real
  // percentage without loading all six data files.
  function cacheBookStats(bk) {
    var tot = { total: 0, done: 0, correct: 0, mastered: 0, review: 0 };
    bk.units.forEach(function (u) {
      var st = unitStats(bk.id, u);
      tot.total += st.total; tot.done += st.done; tot.correct += st.correct;
      tot.mastered += st.mastered; tot.review += st.review;
    });
    state.books[bk.id] = tot;
    save();
    return tot;
  }

  // Fallback when the book has never been opened in this browser: count the
  // stored records that belong to it. Clamped, since untracked "open" items
  // also leave records behind.
  function roughBookStats(id) {
    if (state.books[id]) return state.books[id];
    var prefix = id + '|', done = 0, correct = 0;
    for (var k in state.items) {
      if (k.lastIndexOf(prefix, 0) !== 0) continue;
      var r = state.items[k];
      if (!r || !r.last) continue;
      done++;
      if (r.last === 'correct') correct++;
    }
    var meta = INDEX[id];
    var total = meta ? meta.tracked : 0;
    return {
      total: total,
      done: Math.min(done, total),
      correct: Math.min(correct, total),
      mastered: 0, review: 0
    };
  }

  /* ================= tiny DOM helpers ================= */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  var body = document.body;
  var main = document.getElementById('main');
  var unitListEl = document.getElementById('unitList');
  var searchEl = document.getElementById('search');
  var errBadge = document.getElementById('errBadge');
  var sidebar = document.getElementById('sidebar');
  var overlay = document.getElementById('overlay');
  var homeEl = document.getElementById('home');
  var bookGrid = document.getElementById('bookGrid');
  var helpModal = document.getElementById('helpModal');
  var pdfPane = document.getElementById('pdfPane');
  var pdfFrame = document.getElementById('pdfFrame');
  var pdfTitle = document.getElementById('pdfTitle');
  var pdfNewTab = document.getElementById('pdfNewTab');
  var pdfFallback = document.getElementById('pdfFallback');
  var dragSidebar = document.getElementById('dragSidebar');
  var dragPdf = document.getElementById('dragPdf');
  var helpModalBody = document.getElementById('helpModalBody');

  // Every exercise lands inside #main, so one mark covers the whole book view.
  // dict.js reads the current language through APP_LANG for its own labels.
  window.APP_LANG = function () { return state.lang; };
  if (window.WordLookup) window.WordLookup.attach(main);

  function setView(name) {
    body.setAttribute('data-view', name);
    homeEl.hidden = name !== 'home';
  }

  /* ================= book loading ================= */

  var INDEX = {};          // id -> {units, tracked}, from data/index.json
  var cache = {};          // id -> {id, meta, units}
  var pending = {};

  function loadIndex() {
    return fetch('data/index.json')
      .then(function (r) { return r.json(); })
      .then(function (list) {
        list.forEach(function (b) { INDEX[b.id] = b; });
        return INDEX;
      })
      .catch(function () { return INDEX; });
  }

  function fetchBook(id) {
    // No 'force-cache' here: it serves a stale copy without revalidating, so a
    // rebuilt data file would never reach a reader who already opened the book.
    return fetch('data/' + id + '.json')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
  }

  function loadBook(id) {
    if (cache[id]) return Promise.resolve(cache[id]);
    if (pending[id]) return pending[id];
    pending[id] = fetchBook(id)
      .catch(function () {
        // one retry: a dropped connection should not strand the reader
        return new Promise(function (res) { setTimeout(res, 400); }).then(function () {
          return fetchBook(id);
        });
      })
      .then(function (d) {
        var bk = { id: id, meta: bookMeta(id), units: d.units || [] };
        cache[id] = bk;
        delete pending[id];
        return bk;
      })
      .catch(function (e) {
        delete pending[id];
        throw e;
      });
    return pending[id];
  }

  /* ================= welcome ================= */

  function renderHome() {
    setView('home');
    var units = 0, items = 0;
    for (var id in INDEX) { units += INDEX[id].units; items += INDEX[id].tracked; }

    var done = 0;
    BOOKS.forEach(function (b) { done += roughBookStats(b.id).done; });

    document.getElementById('hsUnits').textContent = units ? num(units) : '—';
    document.getElementById('hsItems').textContent = items ? num(items) : '—';
    document.getElementById('hsDone').textContent = num(done);

    var resume = document.getElementById('heroResume');
    clear(resume);
    if (state.last && bookMeta(state.last.book)) {
      var m = bookMeta(state.last.book);
      // the three Vocabulary books share a title — the level tells them apart
      var a = el('a', null, t('hero.resume', { book: m.title, level: m.level, n: state.last.unit }));
      a.href = '#/b/' + m.id + '/unit/' + state.last.unit;
      resume.appendChild(a);
      resume.hidden = false;
    } else {
      resume.hidden = true;
    }

    clear(bookGrid);
    ['grammar', 'vocab'].forEach(function (kind) {
      var list = BOOKS.filter(function (b) { return b.kind === kind; });
      if (!list.length) return;
      bookGrid.appendChild(el('div', 'lib-group', t('lib.group.' + kind)));
      var grid = el('div', 'book-grid');
      list.forEach(function (b) { grid.appendChild(bookCard(b)); });
      bookGrid.appendChild(grid);
    });
    window.scrollTo(0, 0);
  }

  /* ================= library ================= */

  function bookCard(b) {
    var st = roughBookStats(b.id);
    var pct = st.total ? Math.round(st.correct / st.total * 100) : 0;
    var idx = INDEX[b.id];

    var card = el('a', 'book-card');
    card.href = '#/b/' + b.id;
    card.style.setProperty('--hue', b.hue);

    var top = el('div', 'bc-top');
    top.appendChild(el('span', 'bc-level', b.level));
    top.appendChild(el('span', 'bc-kind', t('lib.group.' + b.kind)));
    top.appendChild(el('span', 'bc-units', t('card.units', { n: (idx && idx.units) || b.units })));
    card.appendChild(top);

    // Icon only — the card's top row is tight, and the full explanation waits
    // inside the book anyway.
    if (b.warning) {
      var wc = b.warning[state.lang] || b.warning.kk;
      var wrap = el('span', 'bc-warn-wrap');
      wrap.setAttribute('tabindex', '0');
      wrap.appendChild(el('span', 'bc-warn', '⚠'));

      var pop = el('span', 'warn-pop');
      pop.appendChild(el('b', null, (wc && wc.title) || t('warn.badge')));
      ((wc && wc.short) || []).forEach(function (line) {
        pop.appendChild(el('span', null, '• ' + line));
      });
      wrap.appendChild(pop);
      // the card is a link — hovering the marker must not navigate
      wrap.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); });
      top.insertBefore(wrap, top.lastChild);
    }

    card.appendChild(el('div', 'bc-title', b.title));
    card.appendChild(el('div', 'bc-author', b.author));
    card.appendChild(el('div', 'bc-blurb', b.blurb[state.lang] || b.blurb.kk));

    var foot = el('div', 'bc-foot');
    foot.appendChild(el('span', null, st.done ? st.done + '/' + st.total : t('card.notStarted')));
    var bar = el('div', 'bar' + (pct === 100 ? ' full' : ''));
    var fill = el('i');
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    foot.appendChild(bar);
    foot.appendChild(el('span', 'pct' + (pct === 100 ? ' done' : ''), pct + '%'));
    card.appendChild(foot);
    return card;
  }

  /* ================= help ================= */

  function renderHelpInto(container) {
    clear(container);
    var sections = (window.HELP && (window.HELP[state.lang] || window.HELP.kk)) || [];

    sections.forEach(function (sec) {
      var box = el('section', 'help-sec');

      var h = el('h2', 'help-h');
      h.appendChild(el('span', 'help-icon', sec.icon || ''));
      h.appendChild(document.createTextNode(sec.title || ''));
      box.appendChild(h);

      (sec.body || []).forEach(function (para) {
        box.appendChild(el('p', 'help-p', para));
      });

      if (sec.list && sec.list.length) {
        var ul = el('ul', 'help-list');
        sec.list.forEach(function (item) { ul.appendChild(el('li', null, item)); });
        box.appendChild(ul);
      }

      if (sec.rows && sec.rows.length) {
        var tbl = el('div', 'help-rows');
        sec.rows.forEach(function (r) {
          tbl.appendChild(el('div', 'hr-k', r[0]));
          tbl.appendChild(el('div', 'hr-v', r[1]));
        });
        box.appendChild(tbl);
      }

      container.appendChild(box);
    });
  }

  /* The ? inside a book opens the guide as a dialog: reading it must not cost
     you your place in the unit, which a full page navigation would. */
  var helpReturnFocus = null;
  function openHelpModal() {
    renderHelpInto(helpModalBody);
    helpReturnFocus = document.activeElement;   // restore on close
    helpModal.hidden = false;
    var closeBtn = helpModal.querySelector('.modal-close');
    if (closeBtn) closeBtn.focus();
  }

  function closeHelpModal() {
    helpModal.hidden = true;
    if (helpReturnFocus && helpReturnFocus.focus) helpReturnFocus.focus();
    helpReturnFocus = null;
  }

  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    if (e.target.closest('[data-open-help]')) { openHelpModal(); return; }
    if (e.target.closest('[data-close-help]')) closeHelpModal();
  });

  document.addEventListener('keydown', function (e) {
    if (helpModal.hidden) return;
    if (e.key === 'Escape') { closeHelpModal(); return; }
    // Focus trap: keep Tab inside the open dialog (AUDIT §У9).
    if (e.key !== 'Tab') return;
    var f = helpModal.querySelectorAll(
      'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  /* ================= sidebar ================= */

  var book = null;         // currently open book
  var currentUnit = null;

  // Advanced Grammar's revision sets carry `additional`; their visible label
  // is localised rather than baked into the data.
  function unitTitle(u) {
    var base = u.title || '';
    if (u.additional) {
      var pre = t('unit.additional', { n: u.additional });
      return base ? pre + ' — ' + base : pre;
    }
    return base;
  }

  function renderSidebar() {
    if (!book) return;
    var q = (searchEl.value || '').trim().toLowerCase();
    clear(unitListEl);
    var shown = 0;
    book.units.forEach(function (u) {
      if (q) {
        var hay = u.unit + ' ' + (u.title || '').toLowerCase();
        if (hay.indexOf(q) === -1) return;
      }
      shown++;
      var st = unitStats(book.id, u);
      var li = el('li');
      var a = el('a', 'unit-link' + (currentUnit === u.unit ? ' current' : ''));
      a.href = '#/b/' + book.id + '/unit/' + u.unit;
      if (currentUnit === u.unit) a.setAttribute('aria-current', 'page');
      a.appendChild(el('span', 'u-num', String(u.unit)));
      a.appendChild(el('span', 'u-title', unitTitle(u)));
      var full = st.total > 0 && st.pct === 100;
      a.appendChild(el('span', 'u-pct' + (full ? ' done' : ''), full ? '✓' : (st.done ? st.pct + '%' : '')));
      li.appendChild(a);
      unitListEl.appendChild(li);
    });
    if (!shown) unitListEl.appendChild(el('div', 'empty-hint', t('sidebar.empty')));
  }

  function refreshBadge() {
    if (!book) return;
    var n = errorCount(book);
    errBadge.textContent = n;
    errBadge.hidden = n === 0;
  }

  function setTab(name) {
    [].forEach.call(document.querySelectorAll('.tab'), function (t2) {
      var on = t2.getAttribute('data-tab') === name;
      t2.classList.toggle('active', on);
      if (on) t2.setAttribute('aria-current', 'page');
      else t2.removeAttribute('aria-current');
    });
  }

  // Works from the catalogue alone, so the header is right from the first
  // frame — even while the data is still downloading, or if it never arrives.
  function paintChrome(id) {
    var bid = id || (book && book.id);
    var m = bookMeta(bid) || {};
    document.getElementById('brandTitle').textContent = m.title || bid || '';
    document.getElementById('brandSub').textContent =
      (m.level ? m.level + ' · ' : '') + (m.author || '');
    document.getElementById('tabUnits').href = '#/b/' + bid;
    document.getElementById('tabErrors').href = '#/b/' + bid + '/errors';
    document.getElementById('tabStats').href = '#/b/' + bid + '/stats';
  }

  /* ================= resizable panels ================= */

  var SIDEBAR_DEFAULT = 268, PDF_DEFAULT = 520;

  function clampNum(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function sidebarW() { return state.ui.sidebarW || SIDEBAR_DEFAULT; }
  function pdfW() { return state.ui.pdfW || PDF_DEFAULT; }

  // The reading column must keep a usable width, so each panel's ceiling
  // depends on the window and on whether the other panel is open.
  function applyWidths() {
    var win = window.innerWidth || 1280;
    var open = !pdfPane.hidden;
    var sMax = Math.max(180, win - (open ? pdfW() : 0) - 320);
    var sw = clampNum(sidebarW(), 180, sMax);
    document.documentElement.style.setProperty('--sidebar-w', sw + 'px');

    var pMax = Math.max(300, win - sw - 320);
    var pw = clampNum(pdfW(), 300, pMax);
    document.documentElement.style.setProperty('--pdf-w', pw + 'px');
  }

  // `sign` is +1 when dragging right should widen the panel (sidebar) and -1
  // when the handle sits on the panel's left edge (the PDF pane).
  function makeDragger(handle, sign, read, write, reset) {
    var startX = 0, startVal = 0, active = false;

    handle.addEventListener('pointerdown', function (e) {
      active = true;
      startX = e.clientX;
      startVal = read();
      handle.setPointerCapture(e.pointerId);
      handle.classList.add('active');
      document.body.classList.add('dragging');
      e.preventDefault();
    });
    handle.addEventListener('pointermove', function (e) {
      if (!active) return;
      write(startVal + sign * (e.clientX - startX));
      applyWidths();
    });
    function stop(e) {
      if (!active) return;
      active = false;
      handle.classList.remove('active');
      document.body.classList.remove('dragging');
      try { handle.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
      save();
    }
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
    handle.addEventListener('dblclick', function () { reset(); applyWidths(); save(); });
  }

  // The unit list is on the right, so its handle sits on the list's left edge:
  // dragging left widens it. The book pane is on the left, handle on its right.
  makeDragger(dragSidebar, -1,
    sidebarW,
    function (v) { state.ui.sidebarW = clampNum(v, 180, 560); },
    function () { state.ui.sidebarW = SIDEBAR_DEFAULT; });

  makeDragger(dragPdf, 1,
    pdfW,
    function (v) { state.ui.pdfW = clampNum(v, 300, 1200); },
    function () { state.ui.pdfW = PDF_DEFAULT; });

  window.addEventListener('resize', applyWidths);

  /* ================= embedded PDF pane ================= */

  function pdfOpen() { return !pdfPane.hidden; }

  var pdfCurrentUrl = null;

  // Chrome's PDF viewer ignores a fragment-only src change once a document is
  // loaded — it stays on the page it is already showing. Recreating the frame
  // is the only reliable way to send it to a different page.
  function mountPdf(url) {
    var fresh = document.createElement('iframe');
    fresh.id = 'pdfFrame';
    fresh.className = 'pdf-frame';
    fresh.title = 'PDF';
    fresh.addEventListener('load', onPdfLoad);
    pdfFrame.replaceWith(fresh);
    pdfFrame = fresh;
    pdfFrame.src = url;
    pdfCurrentUrl = url;
    watchPdf();
  }

  function showPdf(page) {
    var url = pdfUrl(page);
    if (!url) return;
    pdfPane.hidden = false;
    dragPdf.hidden = false;
    document.body.classList.add('pdf-open');
    if (pdfCurrentUrl !== url) mountPdf(url);
    pdfTitle.textContent = (book.meta && book.meta.title) || '';
    pdfNewTab.href = url;
    state.ui.pdfOpen = true;
    save();
    applyWidths();
  }

  // `remember` false keeps the reader's preference so the pane comes back when
  // they open the next unit — used when switching books, not when they close it.
  function hidePdf(remember) {
    pdfPane.hidden = true;
    dragPdf.hidden = true;
    document.body.classList.remove('pdf-open');
    pdfFrame.removeAttribute('src');
    pdfCurrentUrl = null;
    clearTimeout(pdfWatch);
    pdfPane.classList.remove('loading');
    pdfFallback.hidden = true;
    if (remember !== false) state.ui.pdfOpen = false;
    save();
    applyWidths();
  }

  document.getElementById('pdfClose').addEventListener('click', function () { hidePdf(true); });

  // Some browsers/settings download PDFs instead of displaying them, leaving a
  // blank frame. If nothing loads shortly after opening, show a way out.
  var pdfWatch = null;

  function onPdfLoad() {
    clearTimeout(pdfWatch);
    pdfPane.classList.remove('loading');
    pdfFallback.hidden = true;
  }
  pdfFrame.addEventListener('load', onPdfLoad);

  // Essential Grammar's scan is ~70 MB, so "slow" is normal and must not be
  // mistaken for "broken". Show progress, and only offer a way out much later.
  function watchPdf() {
    clearTimeout(pdfWatch);
    pdfPane.classList.add('loading');
    clear(pdfFallback);
    pdfFallback.appendChild(el('div', null, t('pdf.loading')));
    pdfFallback.hidden = false;

    pdfWatch = setTimeout(function () {
      if (pdfPane.hidden) return;
      clear(pdfFallback);
      pdfFallback.appendChild(el('div', null, t('pdf.fallback')));
      var a = el('a', 'btn small', t('pdf.newTab'));
      a.href = pdfNewTab.href;
      a.target = '_blank';
      a.rel = 'noopener';
      pdfFallback.appendChild(a);
      pdfFallback.hidden = false;
      pdfPane.classList.remove('loading');
    }, 45000);
  }

  /* ================= item row ================= */

  function buildRow(unitNo, sub, it, opts) {
    var review = !!(opts && opts.review);        // rendered on the Mistakes page
    // In review mode the book key stays hidden until the learner answers again
    // this session — otherwise the answer sits in plain sight (AUDIT §У1).
    var reveal = !review;
    var key = keyOf(book.id, unitNo, sub.number, it.n);
    var row = el('div', 'row');
    row.setAttribute('data-key', key);

    row.appendChild(el('div', 'n', it.n != null ? String(it.n) : ''));
    var rbody = el('div', 'row-body');
    row.appendChild(rbody);

    /* --- example: nothing to answer --- */
    if (isExample(it)) {
      row.classList.add('example');
      var ex = el('div', 'example-text');
      ex.appendChild(el('span', 'tag', t('row.example')));
      if (it.question) {
        var b = el('b'); b.textContent = it.question; ex.appendChild(b);
      } else {
        ex.appendChild(document.createTextNode(t('row.readPdf')));
      }
      if (it.answer) ex.appendChild(document.createTextNode(' — ' + it.answer));
      rbody.appendChild(ex);
      return row;
    }

    /* --- question text --- */
    var q = el('div', 'q');
    if (it.question) {
      q.textContent = it.question;
    } else if (sub.type === 'text') {
      q.className = 'q none';
      q.textContent = t('row.gap', { n: it.n });
    } else {
      q.className = 'q none';
      q.textContent = t('row.fromPdf', { n: it.n });
    }
    if (isManual(it)) {
      var tg = el('span', 'tag self', t('row.self'));
      q.insertBefore(tg, q.firstChild);
    }
    rbody.appendChild(q);

    /* --- input + buttons --- */
    var line = el('div', 'answer-line');
    var input = el('input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.autocapitalize = 'off';
    input.spellcheck = false;
    input.placeholder = t('row.placeholder');
    // Screen readers otherwise announce only the placeholder, with no clue
    // which question this box belongs to (AUDIT §У9).
    input.setAttribute('aria-label',
      t('row.aria', { unit: unitNo, sub: sub.number, n: it.n }));
    var r0 = rec(key);
    // On the Mistakes page start from a clean box; the old wrong answer is shown
    // separately as "last time: …" rather than left sitting in the field.
    if (r0 && r0.val && !review) input.value = r0.val;
    if (review && r0 && r0.val) {
      var prev = el('div', 'prev-answer');
      prev.appendChild(el('span', 'pa-label', t('row.lastTime')));
      prev.appendChild(el('span', 'pa-val', r0.val));
      rbody.appendChild(prev);
    }
    line.appendChild(input);

    var feedback = el('div', 'feedback');
    feedback.setAttribute('aria-live', 'polite');

    function paint() {
      var r = rec(key);
      row.classList.remove('correct', 'wrong', 'mastered');
      clear(feedback);
      if (!r || !r.last) return;
      // Review mode: no verdict, no key, until the learner tries again here.
      if (review && !reveal) return;

      if (r.mastered) row.classList.add('mastered');
      else row.classList.add(r.last === 'correct' ? 'correct' : 'wrong');

      var status = el('span', 'status ' + (r.mastered ? 'gold' : (r.last === 'correct' ? 'ok' : 'bad')));
      if (r.last === 'correct') {
        status.textContent = r.mastered
          ? t('row.mastered')
          : t('row.streak', { a: r.streak, b: MASTER_STREAK });
      } else {
        status.textContent = t('row.wrong');
      }
      feedback.appendChild(status);

      if (it.answer) {
        var k = el('span', 'key');
        k.appendChild(document.createTextNode(t('row.bookKey')));
        var kb = el('b'); kb.textContent = it.answer;
        k.appendChild(kb);
        feedback.appendChild(k);
      }
      if (r.self) feedback.appendChild(el('span', 'key', t('row.selfMarked')));

      if (r.last === 'wrong') {
        var ov = el('button', 'btn small ok', t('row.override'));
        ov.addEventListener('click', function () { mark(true, true); });
        feedback.appendChild(ov);
      }
    }

    function mark(correct, self) {
      reveal = true;                 // an answer was given — feedback may show
      var r = ensure(key);
      var now = Date.now();
      var today = todayKey(now);
      r.val = input.value;
      r.self = !!self;
      r.ts = now;                                   // when this answer happened
      r.hist = (r.hist || '').slice(-9) + (correct ? '1' : '0');   // last 10 tries
      if (correct) {
        r.streak = (r.streak || 0) + 1;
        r.last = 'correct';
        // distinct days answered correctly — mastery should survive a night,
        // not just three taps in one minute (AUDIT §5.2). Old records with no
        // `cd` keep whatever `mastered` they already earned.
        if (r.cdDay !== today) { r.cd = (r.cd || 0) + 1; r.cdDay = today; }
        if (r.streak >= MASTER_STREAK && (r.cd || 1) >= 2) r.mastered = true;
        // spaced review: schedule the next due date on a widening ladder.
        var ivl = REVIEW_INTERVALS[Math.min(r.streak - 1, REVIEW_INTERVALS.length - 1)];
        r.ivl = ivl;
        r.due = now + ivl * 864e5;
      } else {
        r.streak = 0;
        r.wrong = (r.wrong || 0) + 1;
        r.last = 'wrong';
        r.mastered = false;
        r.ivl = 0;
        r.due = now;                                // wrong -> review straight away
      }
      bumpDaily();
      save();
      paint();
      afterChange();
    }

    // Returns true when a check actually ran.
    function check() {
      if (!input.value.trim()) { input.focus(); return false; }
      if (isManual(it)) return false;      // needs a manual verdict
      mark(isMatch(input.value, it), false);
      return true;
    }
    row._check = check;

    if (isManual(it)) {
      var okB = el('button', 'btn small ok', t('btn.correct'));
      var badB = el('button', 'btn small bad', t('btn.wrong'));
      okB.addEventListener('click', function () { if (input.value.trim()) mark(true, true); else input.focus(); });
      badB.addEventListener('click', function () { if (input.value.trim()) mark(false, true); else input.focus(); });
      line.appendChild(okB);
      line.appendChild(badB);
    } else {
      var chk = el('button', 'btn small primary', t('btn.check'));
      chk.addEventListener('click', function () { check(); });
      line.appendChild(chk);
    }

    input.addEventListener('input', function () {
      ensure(key).val = input.value;
      save();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      check();
      focusNext(input);
    });

    rbody.appendChild(line);
    rbody.appendChild(feedback);
    paint();
    return row;
  }

  function focusNext(input) {
    var all = [].slice.call(main.querySelectorAll('.answer-line input'));
    var i = all.indexOf(input);
    if (i > -1 && i + 1 < all.length) {
      all[i + 1].focus();
      all[i + 1].select();
    }
  }

  function checkAllIn(scope) {
    [].forEach.call(scope.querySelectorAll('.row'), function (r) {
      if (r._check) r._check();
    });
  }

  /* ================= sub-exercise block ================= */

  function buildSub(unitNo, sub) {
    var box = el('div', 'sub');

    var head = el('div', 'sub-head');
    head.appendChild(el('span', 'sub-num', sub.number));
    head.appendChild(el('span', 'type-tag', t('type.' + sub.type)));
    box.appendChild(head);

    if (sub.instructions) box.appendChild(el('div', 'instructions', sub.instructions));

    // gap-fill passage: shown once, the gaps are numbered in the text
    if (sub.passage) box.appendChild(el('div', 'passage', sub.passage));

    // word bank: the pool of words the answers are drawn from.
    // Some source books give it as one space-separated string.
    var bank = sub.wordBank;
    if (typeof bank === 'string') bank = bank.split(/\s+/).filter(Boolean);
    if (bank && bank.length) {
      var wb = el('div', 'wordbank');
      wb.appendChild(el('span', 'wb-label', t('sub.wordbank')));
      bank.forEach(function (w) { wb.appendChild(el('span', 'wb', w)); });
      box.appendChild(wb);
    }

    // matching exercises: the a/b/c choices, listed once
    if (sub.options && sub.options.length) {
      var ol = el('div', 'options');
      sub.options.forEach(function (o) {
        var chip = el('span', 'opt');
        chip.appendChild(el('b', null, o.letter));
        chip.appendChild(document.createTextNode(' ' + o.text));
        ol.appendChild(chip);
      });
      box.appendChild(ol);
    }

    if (sub.type === 'freeform') {
      if (sub.rawQuestion) box.appendChild(el('div', 'raw', sub.rawQuestion));
      var ansBox = el('div', 'raw answer', sub.rawAnswer || t('sub.noAnswer'));
      ansBox.hidden = true;
      var show = el('button', 'btn small', t('sub.showAnswer'));
      show.addEventListener('click', function () {
        ansBox.hidden = !ansBox.hidden;
        show.textContent = ansBox.hidden ? t('sub.showAnswer') : t('sub.hideAnswer');
      });
      var acts = el('div', 'sub-actions');
      acts.appendChild(show);
      box.appendChild(acts);
      box.appendChild(ansBox);
      return box;
    }

    if (sub.type === 'crossword') {
      box.appendChild(el('div', 'note', t('sub.crossword') + (sub.note ? ' ' + sub.note : '')));
      return box;
    }

    if (sub.note) box.appendChild(el('div', 'note', sub.note));

    var items = sub.items || [];
    if (!items.length) {
      box.appendChild(el('div', 'note', t('sub.doInPdf')));
      return box;
    }

    var hasCheckable = false;
    items.forEach(function (it) {
      box.appendChild(buildRow(unitNo, sub, it));
      if (isAuto(it)) hasCheckable = true;
    });

    var actions = el('div', 'sub-actions');
    if (hasCheckable) {
      var btn = el('button', 'btn small', t('sub.checkExercise'));
      btn.addEventListener('click', function () { checkAllIn(box); });
      actions.appendChild(btn);
    }

    // Some exercises ship a printed key that cannot be matched automatically
    // (prose notes, alternatives). Keep it one click away.
    if (sub.rawAnswer) {
      var keyBox = el('div', 'raw answer', sub.rawAnswer);
      keyBox.hidden = true;
      var showKey = el('button', 'btn small', t('sub.showAnswer'));
      showKey.addEventListener('click', function () {
        keyBox.hidden = !keyBox.hidden;
        showKey.textContent = keyBox.hidden ? t('sub.showAnswer') : t('sub.hideAnswer');
      });
      actions.appendChild(showKey);
      if (actions.childNodes.length) box.appendChild(actions);
      box.appendChild(keyBox);
      return box;
    }

    if (actions.childNodes.length) box.appendChild(actions);
    return box;
  }

  /* ================= pages ================= */

  var afterChange = function () {};

  // A book may set `pdfWholeFileOnly` when its viewer cannot honour #page=;
  // none does today, but the escape hatch stays.
  function pdfUrl(page) {
    var pdf = book.meta && book.meta.pdf;
    if (!pdf) return null;
    if (book.meta.pdfWholeFileOnly || page == null) return pdf;
    return pdf + '#page=' + page;
  }

  // "📄 Жаттығу беті: 9" — a link into the PDF when the book ships one.
  function pageChip(label, pages, page) {
    var url = pdfUrl(page);
    var chip = el(url ? 'button' : 'span', 'chip' + (url ? ' pdf-link' : ''));
    if (url) {
      chip.type = 'button';
      chip.title = t('unit.pageHint');
      chip.addEventListener('click', function () { showPdf(page); });
    }
    chip.appendChild(document.createTextNode(label + ': '));
    chip.appendChild(el('strong', null, pages));
    return chip;
  }

  // Opens the PDF in its own window on the right half of the screen. The window
  // is named, so a second click moves that same window to the new page instead
  // of piling up windows.
  // Always shown — this book stays awkward, so the explanation stays with it.
  function buildWarning() {
    var w = book.meta && book.meta.warning;
    if (!w) return null;
    var c = w[state.lang] || w.kk;
    if (!c) return null;

    var box = el('div', 'warn');
    var head = el('div', 'warn-head');
    head.appendChild(document.createTextNode('⚠️ ' + c.title));
    box.appendChild(head);

    if (c.text) box.appendChild(el('p', null, c.text));
    if (c.list && c.list.length) {
      var ul = el('ul');
      c.list.forEach(function (x) { ul.appendChild(el('li', null, x)); });
      box.appendChild(ul);
    }
    if (c.tip) box.appendChild(el('div', 'warn-tip', c.tip));

    // The page chips cannot target a page in this file, so offer the whole PDF.
    if (book.meta.pdf) {
      var link = el('button', 'btn small', t('warn.openPdf'));
      link.addEventListener('click', function () { showPdf(null); });
      box.appendChild(link);
    }
    return box;
  }

  function renderUnit(no) {
    var u = null;
    for (var i = 0; i < book.units.length; i++) {
      if (book.units[i].unit === no) { u = book.units[i]; break; }
    }
    if (!u) { renderNotFound(no); return; }

    currentUnit = no;
    state.last = { book: book.id, unit: no };
    save();
    setTab('units');
    clear(main);

    var head = el('div', 'page-head');
    head.appendChild(el('h1', null, 'Unit ' + u.unit + ' — ' + unitTitle(u)));

    var chips = el('div', 'chips');
    if (u.pdfIntroPage != null) {
      chips.appendChild(pageChip(t('unit.introPage'), String(u.pdfIntroPage), u.pdfIntroPage));
    }
    if (u.pdfExercisePage != null) {
      var pages = (u.pdfPages && u.pdfPages.length > 1)
        ? u.pdfPages.join('–') : String(u.pdfExercisePage);
      chips.appendChild(pageChip(t('unit.exercisePage'), pages, u.pdfExercisePage));
    }
    if (book.meta && book.meta.pdf) {
      // Start on the explanation page: that is where a unit begins. The two
      // page chips jump to either half of the spread.
      var startPage = u.pdfIntroPage != null ? u.pdfIntroPage : u.pdfExercisePage;
      var toggle = el('button', 'chip chip-btn');
      toggle.title = t('unit.openPdfHint');
      // Shut, this is the one thing the page wants the reader to press, so it
      // wears the loud red CTA; open, it only means "close" and goes quiet.
      function syncToggle() {
        var open = pdfOpen();
        toggle.textContent = open ? t('unit.closePdf') : t('unit.openPdf');
        toggle.classList.toggle('chip-cta', !open);
      }
      syncToggle();
      toggle.addEventListener('click', function () {
        if (pdfOpen()) hidePdf(true); else showPdf(startPage);
        syncToggle();
      });
      chips.appendChild(toggle);

      // A book flagged `needsPdf` has no question text of its own, so it is
      // unusable with the pane shut: open it once, before the reader has ever
      // expressed a preference. Narrow screens keep the drawer shut — there the
      // pane covers the whole page. `hidePdf` records the choice either way.
      if (state.ui.pdfOpen == null && book.meta.needsPdf && window.innerWidth >= 1000) {
        state.ui.pdfOpen = true;
      }

      // reopen where they left off, and follow along as units change
      if (pdfOpen() || state.ui.pdfOpen) showPdf(startPage);
      syncToggle(); // the chip was built before that, so bring it back in step
    }
    head.appendChild(chips);

    var prog = el('div', 'progress-row');
    var bar = el('div', 'bar');
    var fill = el('i');
    bar.appendChild(fill);
    var pctEl = el('span', 'pct');
    prog.appendChild(bar);
    prog.appendChild(pctEl);
    head.appendChild(prog);
    main.appendChild(head);

    var warn = buildWarning();
    if (warn) main.appendChild(warn);

    if (!(u.subExercises && u.subExercises.length)) {
      // A few Essential Grammar units had no answers in the scan at all; keep
      // the unit reachable (title + PDF) rather than showing a blank page.
      main.appendChild(el('div', 'note', t('sub.doInPdf')));
    }
    (u.subExercises || []).forEach(function (sub) { main.appendChild(buildSub(u.unit, sub)); });

    /* footer */
    var foot = el('div', 'unit-foot');
    var score = el('div', 'score');
    foot.appendChild(score);

    var allBtn = el('button', 'btn primary', t('unit.checkAll'));
    allBtn.addEventListener('click', function () { checkAllIn(main); });
    foot.appendChild(allBtn);

    var nav = el('div', 'nav-links');
    var prev = el('span');
    var next = el('span');
    var idx = book.units.indexOf(u);
    if (idx > 0) {
      var pu = book.units[idx - 1];
      var pa = el('a', null, '← Unit ' + pu.unit);
      pa.href = '#/b/' + book.id + '/unit/' + pu.unit;
      prev.appendChild(pa);
    }
    if (idx > -1 && idx < book.units.length - 1) {
      var nu = book.units[idx + 1];
      var na = el('a', null, 'Unit ' + nu.unit + ' →');
      na.href = '#/b/' + book.id + '/unit/' + nu.unit;
      next.appendChild(na);
    }
    nav.appendChild(prev);
    nav.appendChild(next);
    foot.appendChild(nav);
    main.appendChild(foot);

    function refresh() {
      var st = unitStats(book.id, u);
      fill.style.width = st.pct + '%';
      bar.classList.toggle('full', st.pct === 100 && st.total > 0);
      pctEl.textContent = st.pct + '%';
      clear(score);
      score.appendChild(document.createTextNode(
        t('unit.score', { c: st.correct, t: st.total, p: st.pct })));
      score.appendChild(el('span', 'muted',
        t('unit.scoreMeta', { m: st.mastered, r: st.review })));
      renderSidebar();
      refreshBadge();
      cacheBookStats(book);
    }
    afterChange = refresh;
    refresh();
    window.scrollTo(0, 0);
  }

  function renderNotFound(no) {
    clear(main);
    var s = el('div', 'empty-state');
    s.appendChild(el('span', 'big', '🤔'));
    s.appendChild(el('div', null, t('unit.notFound', { n: no })));
    main.appendChild(s);
  }

  function renderErrors() {
    currentUnit = null;
    setTab('errors');
    clear(main);
    afterChange = function () { renderSidebar(); refreshBadge(); cacheBookStats(book); };

    var head = el('div', 'page-head');
    head.appendChild(el('h1', null, t('err.h1')));
    main.appendChild(head);

    var groups = allErrors(book);
    if (!groups.length) {
      var s = el('div', 'empty-state');
      s.appendChild(el('span', 'big', '🎉'));
      s.appendChild(el('div', null, t('err.empty')));
      main.appendChild(s);
      renderSidebar();
      refreshBadge();
      return;
    }

    head.appendChild(el('div', 'instructions', t('err.intro', { n: MASTER_STREAK })));

    groups.forEach(function (g) {
      var box = el('div', 'sub err-group');
      var h = el('div', 'err-head');
      var h2 = el('h2');
      var link = el('a', null, 'Unit ' + g.unit.unit + ' — ' + unitTitle(g.unit));
      link.href = '#/b/' + book.id + '/unit/' + g.unit.unit;
      h2.appendChild(link);
      h.appendChild(h2);
      var meta = '📄 ' +
        (g.unit.pdfExercisePage != null ? t('err.metaPage', { n: g.unit.pdfExercisePage }) : '') +
        t('err.metaCount', { n: g.list.length });
      h.appendChild(el('span', 'meta', meta));
      box.appendChild(h);

      // One instruction heading per exercise, not per question (AUDIT §У3).
      var lastSub = null;
      g.list.forEach(function (e) {
        if (e.sub !== lastSub) {
          box.appendChild(el('div', 'instructions',
            e.sub.number + (e.sub.instructions ? ' · ' + e.sub.instructions : '')));
          lastSub = e.sub;
        }
        box.appendChild(buildRow(g.unit.unit, e.sub, e.item, { review: true }));
      });
      main.appendChild(box);
    });

    renderSidebar();
    refreshBadge();
    window.scrollTo(0, 0);
  }

  // Consecutive days (ending today or yesterday) with at least one answer.
  function dayStreak() {
    var d = new Date();
    if (!state.daily[todayKey(d.getTime())]) d.setDate(d.getDate() - 1);  // today not started yet
    var n = 0;
    for (var guard = 0; guard < 400; guard++) {
      if (!state.daily[todayKey(d.getTime())]) break;
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }

  // Answered questions whose spaced-review date has come due (AUDIT §5.2).
  function dueCount(bk) {
    var now = Date.now(), n = 0;
    bk.units.forEach(function (u) {
      (u.subExercises || []).forEach(function (sub) {
        (sub.items || []).forEach(function (it) {
          if (!isTracked(sub, it)) return;
          var r = rec(keyOf(bk.id, u.unit, sub.number, it.n));
          if (r && r.last && r.due != null && r.due <= now) n++;
        });
      });
    });
    return n;
  }

  function renderStats() {
    currentUnit = null;
    setTab('stats');
    clear(main);
    afterChange = function () { renderSidebar(); refreshBadge(); };

    var rows = book.units.map(function (u) { return { u: u, st: unitStats(book.id, u) }; });
    var tot = rows.reduce(function (a, r) {
      a.total += r.st.total; a.done += r.st.done; a.correct += r.st.correct;
      a.mastered += r.st.mastered; a.review += r.st.review;
      return a;
    }, { total: 0, done: 0, correct: 0, mastered: 0, review: 0 });
    var accuracy = tot.done ? Math.round(tot.correct / tot.done * 100) : 0;
    var coverage = tot.total ? Math.round(tot.done / tot.total * 100) : 0;
    var masteredPct = tot.total ? Math.round(tot.mastered / tot.total * 100) : 0;
    var today = state.daily[todayKey()] || 0;
    var streak = dayStreak();
    var due = dueCount(book);

    var head = el('div', 'page-head');
    head.appendChild(el('h1', null, t('stats.h1')));
    head.appendChild(el('div', 'instructions', (book.meta && book.meta.title) || book.id));
    main.appendChild(head);

    /* ---- headline cards: accuracy is not coverage (AUDIT §Ә3) ---- */
    var cards = el('div', 'cards');
    function card(k, v, sub, cls) {
      var c = el('div', 'card' + (cls ? ' ' + cls : ''));
      c.appendChild(el('div', 'k', k));
      c.appendChild(el('div', 'v', v));
      if (sub != null) c.appendChild(el('div', 'sub', sub));
      cards.appendChild(c);
    }
    card(t('stats.accuracy'), accuracy + '%', tot.correct + ' / ' + tot.done);
    card(t('stats.coverage'), coverage + '%', tot.done + ' / ' + tot.total);
    card(t('stats.mastered'), String(tot.mastered), masteredPct + '%', 'gold');
    card(t('stats.today'),
      num(today),
      streak ? t('stats.streak', { n: streak }) : t('stats.streakNone'),
      streak ? 'hot' : '');
    main.appendChild(cards);

    /* ---- due-for-review banner ---- */
    if (due > 0) {
      var banner = el('div', 'due-banner');
      banner.appendChild(el('span', 'due-n', num(due)));
      banner.appendChild(el('span', null, ' ' + t('stats.dueText')));
      var go = el('a', 'btn small', t('stats.dueGo'));
      go.href = '#/b/' + book.id + '/errors';
      banner.appendChild(go);
      main.appendChild(banner);
    }

    /* ---- 30-day activity sparkline ---- */
    main.appendChild(el('div', 'section-title', t('stats.last30')));
    main.appendChild(buildSparkline(30));

    /* ---- section breakdown (books whose Contents we parsed) ---- */
    var secBox = buildSectionBreakdown(rows);
    if (secBox) {
      main.appendChild(el('div', 'section-title', t('stats.sections')));
      main.appendChild(secBox);
    }

    /* ---- sortable unit table ---- */
    main.appendChild(el('div', 'section-title', t('stats.section')));
    main.appendChild(buildStatsTable(rows));

    /* ---- backup + reset ---- */
    var tools = el('div', 'stats-tools');
    var exp = el('button', 'btn', t('stats.export'));
    exp.addEventListener('click', exportProgress);
    var imp = el('button', 'btn', t('stats.import'));
    imp.addEventListener('click', importProgress);
    tools.appendChild(exp);
    tools.appendChild(imp);
    main.appendChild(tools);

    var reset = el('button', 'btn danger', t('stats.reset'));
    reset.style.marginTop = '14px';
    reset.addEventListener('click', function () {
      if (!confirm(t('stats.confirm', { book: (book.meta && book.meta.title) || book.id }))) return;
      var prefix = book.id + '|';
      for (var k in state.items) {
        if (k.lastIndexOf(prefix, 0) === 0) delete state.items[k];
      }
      delete state.books[book.id];
      save();
      renderStats();
      renderSidebar();
      refreshBadge();
    });
    main.appendChild(reset);

    renderSidebar();
    refreshBadge();
    window.scrollTo(0, 0);
  }

  // Tiny inline bar chart of the last `days` days of activity.
  function buildSparkline(days) {
    var wrap = el('div', 'spark');
    var vals = [];
    var d = new Date();
    d.setDate(d.getDate() - (days - 1));
    for (var i = 0; i < days; i++) {
      vals.push({ k: todayKey(d.getTime()), v: state.daily[todayKey(d.getTime())] || 0 });
      d.setDate(d.getDate() + 1);
    }
    var max = vals.reduce(function (m, x) { return Math.max(m, x.v); }, 0) || 1;
    vals.forEach(function (x) {
      var col = el('div', 'spark-col' + (x.v ? '' : ' empty'));
      var bar = el('i');
      bar.style.height = (x.v ? Math.max(8, Math.round(x.v / max * 100)) : 2) + '%';
      col.title = x.k + ' · ' + x.v;
      col.setAttribute('aria-label', x.k + ': ' + x.v);
      col.appendChild(bar);
      wrap.appendChild(col);
    });
    return wrap;
  }

  // Roll unit stats up by the unit's `section` (only some books carry it).
  function buildSectionBreakdown(rows) {
    var order = [], map = {};
    rows.forEach(function (r) {
      var s = r.u.section;
      if (!s) return;
      if (!map[s]) { map[s] = { total: 0, correct: 0, done: 0 }; order.push(s); }
      map[s].total += r.st.total; map[s].correct += r.st.correct; map[s].done += r.st.done;
    });
    if (!order.length) return null;
    var box = el('div', 'sections');
    // sort weakest (lowest accuracy among started) first so gaps stand out
    order.sort(function (a, b) {
      var pa = map[a].done ? map[a].correct / map[a].done : 2;
      var pb = map[b].done ? map[b].correct / map[b].done : 2;
      return pa - pb;
    });
    order.forEach(function (s) {
      var m = map[s];
      var pct = m.done ? Math.round(m.correct / m.done * 100) : 0;
      var rowEl = el('div', 'sec-row');
      rowEl.appendChild(el('span', 'sec-name', s));
      var bar = el('div', 'bar' + (pct === 100 ? ' full' : ''));
      var f = el('i'); f.style.width = (m.done ? pct : 0) + '%';
      bar.appendChild(f);
      rowEl.appendChild(bar);
      rowEl.appendChild(el('span', 'sec-pct', m.done ? pct + '%' : '—'));
      box.appendChild(rowEl);
    });
    return box;
  }

  var statsSort = { key: 'unit', dir: 1 };

  function buildStatsTable(rows) {
    var wrap = el('div', 'table-wrap');
    var table = el('table');
    var cols = ['unit', 'title', 'done', 'correct', 'review', 'mastered', 'progress'];
    var thead = el('thead');
    var trh = el('tr');
    cols.forEach(function (h, i) {
      var th = el('th', (i >= 2 && i <= 5 ? 'num ' : '') + 'sortable', t('stats.th.' + h));
      if (statsSort.key === h) th.classList.add(statsSort.dir > 0 ? 'asc' : 'desc');
      th.setAttribute('tabindex', '0');
      th.setAttribute('role', 'button');
      function sort() {
        statsSort.dir = statsSort.key === h ? -statsSort.dir : 1;
        statsSort.key = h;
        var fresh = buildStatsTable(rows);
        wrap.replaceWith(fresh);
      }
      th.addEventListener('click', sort);
      th.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sort(); }
      });
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    table.appendChild(thead);

    function val(r, k) {
      if (k === 'unit') return r.u.unit;
      if (k === 'title') return unitTitle(r.u).toLowerCase();
      if (k === 'progress') return r.st.pct;
      return r.st[k] || 0;
    }
    var sorted = rows.slice().sort(function (a, b) {
      // untouched units always sink to the bottom regardless of direction
      var ad = a.st.done > 0, bd = b.st.done > 0;
      if (ad !== bd) return ad ? -1 : 1;
      var va = val(a, statsSort.key), vb = val(b, statsSort.key);
      if (va < vb) return -statsSort.dir;
      if (va > vb) return statsSort.dir;
      return a.u.unit - b.u.unit;
    });

    var tbody = el('tbody');
    sorted.forEach(function (r) {
      var tr = el('tr', r.st.done ? null : 'untouched');
      tr.setAttribute('tabindex', '0');
      tr.setAttribute('role', 'link');
      function open() { location.hash = '#/b/' + book.id + '/unit/' + r.u.unit; }
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); open(); }
      });
      tr.appendChild(el('td', 'num', String(r.u.unit)));
      tr.appendChild(el('td', 't-title', unitTitle(r.u)));
      tr.appendChild(el('td', 'num', r.st.done + '/' + r.st.total));
      tr.appendChild(el('td', 'num', String(r.st.correct)));
      tr.appendChild(el('td', 'num', r.st.review ? String(r.st.review) : '—'));
      tr.appendChild(el('td', 'num', r.st.mastered ? String(r.st.mastered) : '—'));
      var td = el('td');
      var bar = el('div', 'bar' + (r.st.pct === 100 ? ' full' : ''));
      var f = el('i');
      f.style.width = r.st.pct + '%';
      bar.appendChild(f);
      td.appendChild(bar);
      td.appendChild(document.createTextNode(' ' + r.st.pct + '%'));
      tr.appendChild(td);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  /* ================= progress backup ================= */

  // The whole progress lives in one browser's localStorage; a wipe or a new
  // device loses everything. A plain JSON file closes that risk (AUDIT §5.6).
  function exportProgress() {
    try {
      var blob = new Blob([JSON.stringify(state)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'agylshyn-progress-' + todayKey() + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } catch (e) { alert(t('stats.exportBad')); }
  }

  function importProgress() {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json,.json';
    inp.addEventListener('change', function () {
      var file = inp.files && inp.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var incoming = JSON.parse(reader.result);
          if (!incoming || !incoming.items) throw new Error('bad');
          if (!confirm(t('stats.importConfirm'))) return;
          mergeInto(state, incoming);      // newest answer per question wins
          state.books = {};                // force a recount from merged items
          flush();
          route();
          alert(t('stats.importOk'));
        } catch (e) { alert(t('stats.importBad')); }
      };
      reader.readAsText(file);
    });
    inp.click();
  }

  /* ================= routing ================= */

  function showLoading() {
    setView('book');
    clear(main);
    var s = el('div', 'empty-state');
    s.appendChild(el('span', 'big', '📚'));
    s.appendChild(el('div', null, t('load.loading')));
    main.appendChild(s);
  }

  function showError(id, e) {
    clear(main);
    var meta = bookMeta(id);
    var s = el('div', 'empty-state');
    s.appendChild(el('span', 'big', '⚠️'));
    s.appendChild(el('div', null, t('load.failed', { id: (meta && meta.title) || id })));
    s.appendChild(el('div', 'instructions', String((e && e.message) || e)));

    var row = el('div', 'sub-actions');
    row.style.justifyContent = 'center';
    var again = el('button', 'btn primary', t('load.retry'));
    again.addEventListener('click', function () {
      delete cache[id];
      delete pending[id];
      openBook(id, null, null);
    });
    row.appendChild(again);
    var back = el('a', 'btn', t('load.back'));
    back.href = '#/';
    row.appendChild(back);
    s.appendChild(row);
    main.appendChild(s);
  }

  // #/b/<id>[/unit/<n>|/errors|/stats]
  function openBook(id, sub, arg) {
    if (!bookMeta(id)) { location.hash = '#/'; return; }
    if (book && book.id === id) { paintChrome(); renderBookView(sub, arg); return; }
    // Drop the open PDF first: a book's file can be tens of megabytes and a
    // download still in flight can starve the fetch we are about to make.
    if (pdfOpen()) hidePdf(false);
    paintChrome(id);
    currentUnit = null;
    searchEl.value = '';
    clear(unitListEl);
    errBadge.hidden = true;
    showLoading();
    // Two-argument then: the second handler covers download failures only, so a
    // bug thrown while rendering surfaces in the console instead of being
    // disguised as "the book didn't load".
    loadBook(id).then(function (bk) {
      // a later navigation may have won the race
      var m = parseHash(location.hash);
      if (m.view !== 'book' || m.id !== id) return;
      book = bk;
      paintChrome(id);
      cacheBookStats(bk);
      renderBookView(sub, arg);
    }, function (e) { showError(id, e); });
  }

  function renderBookView(sub, arg) {
    setView('book');
    if (sub === 'errors') renderErrors();
    else if (sub === 'stats') renderStats();
    else if (sub === 'unit') renderUnit(arg);
    else renderUnit(book.units.length ? book.units[0].unit : 1);
  }

  function parseHash(h) {
    h = h || '';
    var m = /^#\/b\/([a-z0-9-]+)(?:\/(unit)\/(\d+)|\/(errors|stats))?/.exec(h);
    if (m) {
      return {
        view: 'book',
        id: m[1],
        sub: m[2] ? 'unit' : (m[4] || null),
        arg: m[3] ? parseInt(m[3], 10) : null
      };
    }
    // '#/help' and the old '#/books' both land on home; the guide is a dialog
    if (h.indexOf('#/help') === 0) return { view: 'home', help: true };
    return { view: 'home' };
  }

  function route() {
    closeSidebar();
    if (window.WordLookup) window.WordLookup.hide();
    var r = parseHash(location.hash);
    if (r.view === 'book') { openBook(r.id, r.sub, r.arg); return; }
    if (pdfOpen()) hidePdf(false);
    renderHome();
    if (r.help) openHelpModal();
  }

  /* ================= sidebar toggle (mobile) ================= */

  function openSidebar() { sidebar.classList.add('open'); overlay.hidden = false; }
  function closeSidebar() { sidebar.classList.remove('open'); overlay.hidden = true; }

  // The topbar wraps to two rows on narrow screens, so the drawer and overlay
  // take their offset from its measured height rather than a fixed value.
  var topbarEl = document.querySelector('.topbar');
  function syncTopbarHeight() {
    var h = topbarEl.getBoundingClientRect().height;
    if (h > 0) document.documentElement.style.setProperty('--topbar-h', Math.round(h) + 'px');
  }
  if (window.ResizeObserver) new ResizeObserver(syncTopbarHeight).observe(topbarEl);
  window.addEventListener('resize', syncTopbarHeight);
  syncTopbarHeight();

  document.getElementById('menuBtn').addEventListener('click', function () {
    if (sidebar.classList.contains('open')) closeSidebar(); else openSidebar();
  });
  overlay.addEventListener('click', closeSidebar);
  searchEl.addEventListener('input', renderSidebar);

  window.addEventListener('hashchange', route);

  applyStatic();
  applyWidths();
  loadIndex().then(route);
})();
