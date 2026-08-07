/* Grammar & Vocabulary in Use — every book in one practice app.
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

  // Per-unit answer-key pages: AK_PAGES[bookId][unit] -> true PDF #page= of that
  // unit's answers in the back of the book. Loaded from data/answer-key-pages.json
  // (built by tools/build_answer_key_pages.py). Powers the "answer key" button on
  // exercises the app can't grade — a Unit 19 task opens the Unit 19 answers, not
  // Unit 1. Books without a machine-locatable key (IELTS 19/20) are absent.
  var AK_PAGES = {};

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
            placement: p.placement || null,   // {track,band,score,ts} from the quiz
            // 'book|unit' -> [{ts,raw,total,secs,skill}] — finished exam runs,
            // newest last. `exam` is the one still being sat, if any.
            exams: p.exams || {},
            exam: p.exam || null,
            // 'bookId|wTEST|wPART' -> {text, ts} — Writing drafts. Kept beside
            // the answers rather than in a store of their own so one export,
            // one import and one sync carry everything a learner has written.
            writing: p.writing || {},
            // 'bookId|dUNIT|PART|BLOCK' -> {ok, total, ts} — best dictation
            // score per block of a transcript.
            dictation: p.dictation || {},
            ui: p.ui || {}
          };
        }
      }
    } catch (e) { /* corrupt or unavailable storage — start fresh */ }
    return { v: 1, items: {}, books: {}, daily: {}, last: null, lang: defaultLang(), theme: defaultTheme(), warnOk: {}, placement: null, exams: {}, exam: null, writing: {}, dictation: {}, ui: {} };
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
    // placement is a one-off preference — let the newest write win across tabs
    if (disk.placement && (!cur.placement || (disk.placement.ts || 0) > (cur.placement.ts || 0))) {
      cur.placement = disk.placement;
    }
    // Exam runs are append-only history: merge per section by timestamp so two
    // devices that each sat a different test end up with both. The half-finished
    // run (`exam`) is deliberately NOT merged — it belongs to the tab sitting
    // the test, and a merge would restart somebody's clock.
    var de = disk.exams || {};
    cur.exams = cur.exams || {};
    for (var ek in de) cur.exams[ek] = mergeRuns(cur.exams[ek], de[ek]);
    // A draft is one text with one timestamp: newest wins, per task. A merge
    // that concatenated two devices' essays would be worse than either.
    var dw = disk.writing || {};
    cur.writing = cur.writing || {};
    for (var wk in dw) {
      var mine = cur.writing[wk];
      if (!mine || (dw[wk] && (dw[wk].ts || 0) > (mine.ts || 0))) cur.writing[wk] = dw[wk];
    }
    // A dictation block keeps its best attempt, so the better of the two wins
    // rather than the newer one.
    var dd2 = disk.dictation || {};
    cur.dictation = cur.dictation || {};
    for (var dk in dd2) {
      var had = cur.dictation[dk];
      if (!had || (dd2[dk] && (dd2[dk].ok || 0) > (had.ok || 0))) cur.dictation[dk] = dd2[dk];
    }
    cur.books = disk.books || cur.books;
  }

  // Two lists of finished runs into one, oldest first, one entry per start time.
  function mergeRuns(a, b) {
    var seen = {}, out = [];
    (a || []).concat(b || []).forEach(function (r) {
      if (!r || seen[r.ts]) return;
      seen[r.ts] = 1;
      out.push(r);
    });
    out.sort(function (x, y) { return (x.ts || 0) - (y.ts || 0); });
    return out;
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

  // What a row is filed under. Normally its printed number — but a few
  // exercises print the same number twice (Advanced Grammar 31.2 is two texts,
  // a and b, each numbered 1-4), and two rows under one key means answering the
  // second overwrites the first and the unit can never be finished. The builder
  // gives every repeat a `k` of its own ('1b'); the number the reader sees is
  // still `n`. See unclash() in tools/build_data.py.
  function itemKey(it) { return it.k != null ? it.k : it.n; }
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

  /* ================= speech ================= */

  // Hearing the sentence matters as much as reading it, and the browser's own
  // voices cost nothing: no download, no API key, works offline. A browser
  // without an engine simply gets no speaker buttons — never a dead one.
  var Speech = (function () {
    var synth = window.speechSynthesis;
    var ok = !!(synth && window.SpeechSynthesisUtterance);
    var voice = null;

    // Prefer a real English voice; the default one is often the OS language,
    // which reads English text with a Kazakh/Russian accent.
    function pick() {
      var list = (ok && synth.getVoices && synth.getVoices()) || [];
      var en = list.filter(function (v) { return /^en/i.test(v.lang || ''); });
      if (!en.length) return null;
      var pref = ['Samantha', 'Daniel', 'Google UK English', 'Google US English', 'Microsoft'];
      for (var i = 0; i < pref.length; i++) {
        for (var j = 0; j < en.length; j++) {
          if ((en[j].name || '').indexOf(pref[i]) === 0) return en[j];
        }
      }
      return en[0];
    }

    if (ok) {
      voice = pick();
      // Chrome fills the voice list asynchronously, after the first paint.
      try { synth.addEventListener('voiceschanged', function () { voice = pick(); }); }
      catch (e) { /* older engines expose the list synchronously */ }
    }

    // Gaps are printed as dots or underscores; read as-is they become noise, so
    // they turn into a short pause instead.
    function clean(text) {
      return String(text == null ? '' : text)
        .replace(/[._]{2,}/g, ' … ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300);
    }

    function speak(text) {
      var say = clean(text);
      if (!ok || !say) return;
      try {
        synth.cancel();                  // one sentence at a time
        var u = new SpeechSynthesisUtterance(say);
        if (!voice) voice = pick();
        if (voice) u.voice = voice;
        u.lang = (voice && voice.lang) || 'en-GB';
        u.rate = 0.92;                   // learner pace, not newsreader pace
        synth.speak(u);
      } catch (e) { /* engine died — silence is an acceptable fallback */ }
    }

    function stop() { try { if (ok) synth.cancel(); } catch (e) {} }

    return { ok: ok, speak: speak, stop: stop };
  })();
  window.Speech = Speech;   // dict.js falls back to it when a word has no audio

  // 🔊 button for a piece of English text. Null when the browser cannot speak.
  function speakBtn(getText, cls) {
    if (!Speech.ok) return null;
    var b = el('button', 'speak' + (cls ? ' ' + cls : ''), '🔊');
    b.type = 'button';
    b.title = t('speak.title');
    b.setAttribute('aria-label', t('speak.title'));
    b.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      Speech.speak(getText());
    });
    return b;
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
    applySideMin();   // ditto: its label and tip flip with the collapsed state
  }

  /* ================= theme ================= */

  function applyTheme() {
    var th = THEMES.indexOf(state.theme) > -1 ? state.theme : defaultTheme();
    state.theme = th;
    document.documentElement.setAttribute('data-theme', th);

    [].forEach.call(document.querySelectorAll('[data-theme-btn]'), function (b) {
      b.textContent = THEME_ICON[th];
      // The hover tip replaces title= — both at once shows the same sentence
      // twice, in two different boxes.
      b.removeAttribute('title');
      b.setAttribute('data-tip-text', t('tip.theme.' + th));
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
    if (placeModal && !placeModal.hidden && placeRepaint) placeRepaint();
    if (authModal && !authModal.hidden && authRepaint) authRepaint();
    refreshAuthButtons();   // its tooltip is translated too
    route();          // re-render whatever view is open, in the new language
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.lang-switch button');
    if (b) setLang(b.getAttribute('data-lang'));
  });

  /* ================= hover tips ================= */

  // The topbar is icons and one-word tabs: "⚡" and "?" say nothing about what
  // they open, and "Қателер" doesn't say the mistakes come back to be redone.
  // Resting on a control for half a second explains it — the browser's own
  // title= tooltip is too slow, unstyled and truncates the second line.
  //
  // Carry a key in data-tip (translated at show time, so a language switch is
  // picked up for free) or ready-made text in data-tip-text for controls whose
  // label is built in JS. First line is the heading, every line after it a
  // bullet — the shape the library card's warning popover already uses.
  var Tips = (function () {
    var DELAY = 500;
    var box = null, timer = 0, host = null;

    // Touch and pen have no hover: there a tip could only appear stuck to the
    // finger after a tap, i.e. on top of the thing it was explaining. The query
    // is kept live (not read once) — a tablet with a mouse plugged in flips it.
    var mouse = null;
    try { mouse = matchMedia('(hover: hover) and (pointer: fine)'); } catch (e) { /* old browser */ }
    function hoverable() { return !mouse || mouse.matches; }

    function textOf(n) {
      var k = n.getAttribute('data-tip');
      return (k ? t(k) : n.getAttribute('data-tip-text')) || '';
    }

    function hide() {
      if (timer) { clearTimeout(timer); timer = 0; }
      host = null;
      if (box) { box.classList.remove('show'); box.hidden = true; }
    }

    function show(n) {
      var raw = textOf(n);
      if (!raw) return;
      if (!box) {
        box = el('div', 'tip');
        box.setAttribute('role', 'tooltip');
        box.hidden = true;
        document.body.appendChild(box);
      }
      clear(box);
      var lines = raw.split('\n');
      box.appendChild(el('b', null, lines[0]));
      for (var i = 1; i < lines.length; i++) box.appendChild(el('span', null, '• ' + lines[i]));

      // Measure before placing: the box is as tall as its text is long.
      box.hidden = false;
      box.style.left = '0px';
      box.style.top = '0px';
      var r = n.getBoundingClientRect();
      var w = box.offsetWidth, h = box.offsetHeight;
      var below = r.bottom + 10 + h <= window.innerHeight || r.top - 10 - h < 0;
      var left = Math.round(r.left + r.width / 2 - w / 2);
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      box.style.left = left + 'px';
      box.style.top = Math.round(below ? r.bottom + 8 : r.top - 8 - h) + 'px';
      box.setAttribute('data-pos', below ? 'below' : 'above');
      // The arrow follows the control, not the box, which drifts when a tip
      // near the edge of the window is clamped back inside it.
      box.style.setProperty('--tip-ax',
        Math.round(Math.max(14, Math.min(r.left + r.width / 2 - left, w - 14))) + 'px');
      box.classList.add('show');
    }

    function target(e) {
      return e.target && e.target.closest ? e.target.closest('[data-tip], [data-tip-text]') : null;
    }

    document.addEventListener('mouseover', function (e) {
      if (!hoverable()) return;
      var n = target(e);
      if (n === host) return;
      hide();
      if (!n) return;
      host = n;
      timer = setTimeout(function () { timer = 0; if (host === n) show(n); }, DELAY);
    });

    // mouseout's own target is the element being left, so the decision has to
    // come from relatedTarget: where the pointer went. Still inside the same
    // control (over a child span) is not a leave.
    document.addEventListener('mouseout', function (e) {
      if (!host) return;
      var to = e.relatedTarget;
      if (to && to.closest && to.closest('[data-tip], [data-tip-text]') === host) return;
      hide();
    });

    // A tip that outlived what it described would point at nothing.
    document.addEventListener('mousedown', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    window.addEventListener('blur', hide);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });

    return { hide: hide };
  })();

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

  function editDistance(a, b) {
    var m = a.length, n = b.length, prev = [], cur = [], i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur[0] = i;
      for (j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1,
          prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
      }
      for (j = 0; j <= n; j++) prev[j] = cur[j];
    }
    return prev[n];
  }

  // True when every comma-part is the same word said twice or in a close
  // variant form: "generates, generates", "indentified, identified",
  // "underlines / underlined". A genuine two-item list ("furniture,
  // information") has unrelated parts and returns false, so it still needs both.
  function sameWordVariants(parts) {
    for (var i = 1; i < parts.length; i++) {
      var a = parts[0], b = parts[i];
      var lcp = 0;
      while (lcp < a.length && lcp < b.length && a.charAt(lcp) === b.charAt(lcp)) lcp++;
      var near = lcp >= 4 || editDistance(a, b) <= 2;
      if (!near) return false;
    }
    return true;
  }

  // Accepts the book answer and, where the source has one, the gap-only form:
  // "He’s tying / He is tying" also accepts "’s tying".
  function isMatch(input, it) {
    var typed = norm(input);
    if (!typed) return false;
    if (buildVariants(it.answer)[typed]) return true;
    if (it.blank && buildVariants(it.blank)[typed]) return true;
    if (matchesAsSet(input, it.answer)) return true;
    // A "same word" pair answer ("generates, generates"; "indentified,
    // identified"; "confirmed, confirms / confirmed") should accept the one
    // word on its own — but only when the parts really are variants of one
    // word, not a list of two different ones.
    var parts = listParts(it.answer);
    if (parts.length >= 2 && sameWordVariants(parts)) {
      var forms = Object.create(null);
      String(it.answer).split(/\s*[,;]\s*|\s+and\s+|\s*&\s*/i).forEach(function (p) {
        splitAlternatives(p).forEach(function (alt) { var k = norm(alt); if (k) forms[k] = 1; });
      });
      if (forms[typed]) return true;
    }
    return false;
  }

  /* ================= hints ================= */

  // What a hint is built from: the first accepted alternative, with the
  // optional "(any)" brackets dropped — the shortest thing that would pass.
  function hintBase(answer) {
    var first = splitAlternatives(String(answer == null ? '' : answer))[0] || '';
    return first.replace(/\([^()]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Level 1 shows the shape ("•••• ••"), level 2 opens the first letter of each
  // word ("t••• ••"). Level 3 is the answer itself and is printed by the caller.
  function hintMask(answer, level) {
    var base = hintBase(answer);
    if (!base) return '';
    return base.split(/\s+/).map(function (w) {
      var out = '';
      for (var i = 0; i < w.length; i++) {
        var ch = w.charAt(i);
        var letter = /[\p{L}\p{N}]/u.test(ch);
        out += (!letter || (level >= 2 && i === 0)) ? ch : '•';
      }
      return out;
    }).join(' ');
  }

  function hintLetters(answer) {
    return hintBase(answer).replace(/[^\p{L}\p{N}]/gu, '').length;
  }

  function hasHint(it) {
    return isAuto(it) && !!hintBase(it.answer);
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

  /* ================= recording a verdict ================= */

  // The one place a verdict becomes a stored record: mastery, the spaced-review
  // ladder and the daily counter all live here, so the unit page, the mistakes
  // page and the drill session can never drift apart.
  function applyAnswer(key, correct, opts) {
    opts = opts || {};
    var r = ensure(key);
    var now = Date.now();
    var today = todayKey(now);
    if (opts.val != null) r.val = opts.val;
    r.self = !!opts.self;
    r.ts = now;                                   // when this answer happened
    r.hist = (r.hist || '').slice(-9) + (correct ? '1' : '0');   // last 10 tries
    if (correct && opts.hinted) {
      // Answered with a hint: it was recognition, not recall. It counts as
      // practice, but it buys neither the mastery streak nor a long holiday
      // from review — the question comes back tomorrow.
      r.hinted = true;
      r.streak = 0;
      r.last = 'correct';
      r.mastered = false;
      r.ivl = 1;
      r.due = now + 864e5;
    } else if (correct) {
      r.hinted = false;
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
      r.hinted = false;
      r.streak = 0;
      r.wrong = (r.wrong || 0) + 1;
      r.last = 'wrong';
      r.mastered = false;
      r.ivl = 0;
      r.due = now;                                // wrong -> review straight away
    }
    bumpDaily();
    save();
    // The one hook cloud sync needs: keys are 'bookId|…', so this is also how it
    // learns which book to push. No-op unless an account is signed in.
    if (window.SYNC) SYNC.touch(key);
    return r;
  }

  function unitStats(bookId, u) {
    var total = 0, done = 0, correct = 0, mastered = 0, review = 0;
    (u.subExercises || []).forEach(function (sub) {
      (sub.items || []).forEach(function (it) {
        if (!isTracked(sub, it)) return;
        total++;
        var r = rec(keyOf(bookId, u.unit, sub.number, itemKey(it)));
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

  /* Wrong answers as flash cards.

     Not every mistake makes one. A card needs a front somebody can be shown
     and a back they can be marked against, so a book that prints its questions
     only in the PDF (the IELTS answer sheets) has nothing to give here, and
     neither has a self-check row whose answer the app never knew. `min` is how
     many times the question must have been missed — the automatic sweep asks
     for two, the button on the Mistakes page takes everything on the page. */
  function mistakeRows(bk, min) {
    var out = [];
    bk.units.forEach(function (u) {
      (u.subExercises || []).forEach(function (sub) {
        (sub.items || []).forEach(function (it) {
          if (isExample(it) || isManual(it)) return;
          if (!it.question || !it.answer) return;
          var key = keyOf(bk.id, u.unit, sub.number, itemKey(it));
          var r = rec(key);
          if (!r || !r.wrong || r.mastered) return;
          if (min && r.wrong < min) return;
          if (window.SRS && SRS.hasSrc(key)) return;
          out.push({
            srcKey: key,
            wrong: r.wrong,
            front: it.question,
            back: it.answer,
            source: ((bk.meta && bk.meta.title) || bk.id) + ' · Unit ' + u.unit,
            src: { book: bk.id, unit: u.unit }
          });
        });
      });
    });
    return out;
  }

  // The automatic half: a question missed twice becomes a card without anybody
  // asking. Off if the reader turned it off in the deck's settings.
  function sweepMistakes(bk) {
    if (!bk || !window.SRS || !SRS.autoMistakes()) return 0;
    return SRS.addMistakes(mistakeRows(bk, 2), { auto: true });
  }

  function allErrors(bk) {
    var groups = [];
    bk.units.forEach(function (u) {
      var list = [];
      (u.subExercises || []).forEach(function (sub) {
        (sub.items || []).forEach(function (it) {
          if (isExample(it)) return;
          var r = rec(keyOf(bk.id, u.unit, sub.number, itemKey(it)));
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
  /* Everything that has to happen after answers in a book changed: its
     counters, and the deck picking up whatever has now been missed twice.
     Both are cheap passes over data already in memory, and keeping them in one
     function is what stops the two drifting apart — every answer path in the
     app goes through here. */
  function bookChanged(bk) {
    cacheBookStats(bk);
    sweepMistakes(bk);
  }

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

  // Outstanding mistakes for a book, from the stored records alone — so the
  // library page can badge every book without loading all six data files.
  function bookMistakes(id) {
    var prefix = id + '|', n = 0;
    for (var k in state.items) {
      if (k.lastIndexOf(prefix, 0) !== 0) continue;
      var r = state.items[k];
      if (r && r.wrong > 0 && !r.mastered) n++;
    }
    return n;
  }

  // Total answers over the last `days` calendar days (today back), from the
  // per-day activity log.
  function lastNDaysCount(days) {
    var total = 0, d = new Date();
    for (var i = 0; i < days; i++) {
      total += state.daily[todayKey(d.getTime())] || 0;
      d.setDate(d.getDate() - 1);
    }
    return total;
  }

  /* ================= tiny DOM helpers ================= */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* Every answer box — in a unit and in a practice session alike.
     The switches are all aimed at phone keyboards: left alone, iOS
     capitalises the first letter and silently "corrects" the very word being
     tested ("dont" → "don't", "recieve" → "receive"), so the reader is marked
     wrong for a mistake the phone made. enterkeyhint labels the return key
     "go", because Enter is what checks the answer.
     `aria` names the question for a screen reader, which would otherwise hear
     only the placeholder and not know which box it belongs to (AUDIT §У9). */
  function answerInput(aria) {
    var input = el('input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.autocapitalize = 'off';
    input.spellcheck = false;
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('enterkeyhint', 'go');
    input.placeholder = t('row.placeholder');
    input.setAttribute('aria-label', aria);
    return input;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  /* Copies a string, and resolves either way rather than rejecting: a caller
     that only wants to say "copied" should not have to handle a failure it can
     do nothing about. navigator.clipboard needs a secure context, which the
     site has over https but not when a file:// copy is opened straight off a
     phone, so the old selection trick stays as the fallback. */
  function copyText(s) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(s).catch(function () { return legacyCopy(s); });
    }
    return Promise.resolve(legacyCopy(s));
  }
  function legacyCopy(s) {
    var ta = el('textarea');
    ta.value = s;
    // Off-screen rather than hidden: display:none cannot be selected.
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* nothing else to try */ }
    document.body.removeChild(ta);
  }

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
    // Keep the skip link aimed at whatever is actually on screen: on the
    // library that is the shelf, everywhere else the working column. A skip
    // link pointing at a hidden element is worse than none — it looks like it
    // did nothing.
    var skip = document.getElementById('skipLink');
    if (skip) skip.setAttribute('href', name === 'home' ? '#bookGrid' : '#main');
  }

  /* ================= book loading ================= */

  var INDEX = {};          // id -> {units, tracked}, from data/index.json
  var cache = {};          // id -> {id, meta, units}
  var pending = {};

  // One fetch, one promise, however many callers: the index says which books
  // are paid, and everything that opens a book has to be able to wait for that
  // answer rather than racing it.
  var indexOnce = null;

  function loadIndex() {
    if (indexOnce) return indexOnce;
    indexOnce = loadIndexNow();
    return indexOnce;
  }

  function loadIndexNow() {
    // The answer-key page map is small and needed the moment a unit renders, so
    // fetch it alongside the index; a failure just means no "answer key" button.
    fetch('data/answer-key-pages.json')
      .then(function (r) { return r.json(); })
      .then(function (m) { AK_PAGES = m || {}; })
      .catch(function () { /* no key button — harmless */ });
    return fetch('data/index.json')
      .then(function (r) { return r.json(); })
      .then(function (list) {
        list.forEach(function (b) { INDEX[b.id] = b; });
        // The index carries each book's `paid` flag, so this is the moment the
        // library learns what costs money. Asking whether this reader has paid
        // comes next and is deliberately not waited on: the page renders on the
        // free shelf, and the locks resolve themselves through ENTITLE.onChange
        // when the answer lands.
        if (window.ENTITLE) {
          ENTITLE.setPaid(INDEX);
          ENTITLE.refresh().catch(function () { /* offline — locks stay as they are */ });
        }
        return INDEX;
      })
      .catch(function () { return INDEX; });
  }

  function fetchBook(id) {
    // A free book is a static file under data/, cached offline by the service
    // worker like the rest of the site. A paid one is a row in Supabase and the
    // only copy that exists — ENTITLE decides which is which, and with
    // supabase.config.js empty it always answers "free", which is the fetch
    // this always was.
    //
    // No 'force-cache' on the static path: it serves a stale copy without
    // revalidating, so a rebuilt data file would never reach a reader who
    // already opened the book.
    if (window.ENTITLE) return ENTITLE.fetchBook(id);
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
      .catch(function (e) {
        // Locked, but not necessarily a dead end: every paid book publishes its
        // first unit or two as a plain static file. Open those instead of the
        // bare lock screen, and let the reader work rather than read about it.
        if (e && e.locked && window.ENTITLE) {
          return ENTITLE.fetchSample(id).catch(function () { throw e; });
        }
        throw e;
      })
      .catch(function (e) {
        // one retry: a dropped connection should not strand the reader.
        // A locked book is a settled answer, not a flaky one — retrying it just
        // doubles the requests and delays the unlock screen by another round trip.
        if (e && e.locked) throw e;
        return new Promise(function (res) { setTimeout(res, 400); }).then(function () {
          return fetchBook(id);
        });
      })
      .then(function (d) {
        // `prompts` — the Writing and Speaking tasks of an IELTS book. They are
        // not units and not gradable, so they hang off the book rather than
        // being forced into the unit shape; only Cambridge 21 has them today.
        var bk = { id: id, meta: bookMeta(id), units: d.units || [], prompts: d.prompts || [] };
        // A sample carries only its first units, and has to say so everywhere:
        // the progress bars, the unit list and the statistics page would all
        // otherwise report a two-unit book as finished.
        if (d.sample) { bk.sample = true; bk.unitsOf = d.unitsOf || bk.units.length; }
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

  // The four tiles above add the whole shelf together, and for two of them that
  // sum is misleading: an IELTS "unit" is a forty-question test section, not a
  // two-page grammar unit, so "937 units" is two different things stacked. This
  // line says which is which — and how far along each one is, which is the
  // number a reader working towards a test actually wants.
  //
  // The split is by `kind`, not by a list of book ids: a list is the trap this
  // codebase has fallen into twice (the library grouping and match_test both
  // used to carry their own hardcoded set, and a new book vanished off the
  // page). A shelf with only one of the two groups gets no line at all — there
  // is nothing to compare, and a fork without the IELTS books should not see an
  // empty row.
  function renderHeroSplit() {
    var box = document.getElementById('heroSplit');
    if (!box) return;
    clear(box);

    var groups = [
      { id: 'course', books: [], units: 0, items: 0, done: 0 },
      { id: 'ielts', books: [], units: 0, items: 0, done: 0 }
    ];
    BOOKS.forEach(function (b) {
      var g = groups[b.kind === 'ielts' ? 1 : 0];
      var row = INDEX[b.id];
      if (!row) return;
      g.books.push(b.id);
      g.units += row.units;
      g.items += row.tracked;
      g.done += roughBookStats(b.id).done;
    });

    var real = groups.filter(function (g) { return g.books.length; });
    if (real.length < 2) { box.hidden = true; return; }

    real.forEach(function (g) {
      var row = el('div', 'hs-row');
      row.appendChild(el('span', 'hs-tag', t('hero.split.' + g.id)));
      // One cell for the figures, so the label column stays a column and the
      // numbers wrap under themselves rather than under the label.
      var vals = el('span', 'hs-vals');
      vals.appendChild(el('span', 'hs-num', t('hero.split.' + g.id + 'Line',
        { b: num(g.books.length), u: num(g.units), q: num(g.items) })));
      // Only once there is something to report: a first-time visitor does not
      // need "0 answered" told to them twice.
      if (g.done) vals.appendChild(el('span', 'hs-done', t('hero.split.done', { n: num(g.done) })));
      row.appendChild(vals);
      box.appendChild(row);
    });
    box.hidden = false;
  }

  // Which CEFR band the library is narrowed to, or null for the whole shelf.
  // In memory only, on purpose — see the filter bar in renderHome().
  var libBand = null;

  function renderHome() {
    setView('home');
    var units = 0, items = 0;
    for (var id in INDEX) { units += INDEX[id].units; items += INDEX[id].tracked; }

    var done = 0, correct = 0, mistakes = 0;
    BOOKS.forEach(function (b) {
      var st = roughBookStats(b.id);
      done += st.done; correct += st.correct;
      mistakes += bookMistakes(b.id);
    });

    document.getElementById('hsBooks').textContent = num(BOOKS.length);
    document.getElementById('hsUnits').textContent = units ? num(units) : '—';
    document.getElementById('hsItems').textContent = items ? num(items) : '—';
    document.getElementById('hsDone').textContent = num(done);
    renderHeroSplit();

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

    // The one button that always has something to do: whatever is wrong or due
    // across every book, mixed into one run. Counted from the stored records
    // alone, so no data file has to be downloaded to show it.
    var drillBox = document.getElementById('heroDrill');
    if (drillBox) {
      clear(drillBox);
      var dueAll = dueAllCount();
      var dcta = el('a', 'drill-cta');
      dcta.href = '#/drill';
      dcta.appendChild(el('span', 'dc-ico', '⚡'));
      var dtxt = el('span', 'dc-txt');
      dtxt.appendChild(el('b', null, t('drill.cta')));
      dtxt.appendChild(el('span', null,
        dueAll ? t('drill.ctaSub', { n: num(dueAll) }) : t('drill.ctaSubNew')));
      dcta.appendChild(dtxt);
      dcta.appendChild(el('span', 'dc-go', '→'));
      drillBox.appendChild(dcta);

      // Second call to action, same shape: the words the reader saved while
      // reading. Sits next to the drill because they are the two things you can
      // do without first choosing a book.
      if (window.SRS) {
        var wcta = el('a', 'drill-cta srs-cta-home' + (SRS.dueCount() ? ' hot' : ''));
        wcta.href = '#/srs';
        wcta.appendChild(el('span', 'dc-ico', '🗂'));
        var wtxt = el('span', 'dc-txt');
        wtxt.appendChild(el('b', null, t('srs.home.title')));
        wtxt.appendChild(el('span', null, SRS.homeSub()));
        wcta.appendChild(wtxt);
        wcta.appendChild(el('span', 'dc-go', '→'));
        drillBox.appendChild(wcta);
      }

      // The class page. A teacher who never opens the account panel would
      // otherwise never learn it exists — and a teacher is the reader least
      // likely to go hunting through a settings dialog.
      if (window.CLASSES && CLASSES.configured && !CLASSES.unavailable()) {
        var ccta = el('a', 'drill-cta');
        ccta.href = '#/class';
        ccta.appendChild(el('span', 'dc-ico', '👩‍🏫'));
        var ctxt = el('span', 'dc-txt');
        ctxt.appendChild(el('b', null, t('cls.home.title')));
        ctxt.appendChild(el('span', null, t('cls.home.sub')));
        ccta.appendChild(ctxt);
        ccta.appendChild(el('span', 'dc-go', '→'));
        drillBox.appendChild(ccta);
      }
    }

    // Right-hand sidebar: the cross-book snapshot, then the month calendar.
    // Books stay on the left, so the page fills its width instead of leaving big
    // empty margins.
    //
    // The snapshot used to appear only once there was progress. Hiding it made
    // the page silently different for a first-time visitor and for a returning
    // one, and a newcomer never learned that any of this is tracked. It is shown
    // from the first visit now; only the accuracy reads "—" rather than 0 %,
    // because nothing answered is not the same as everything wrong.
    //
    // But four zeros and a blank month is not "this is tracked", it is an
    // empty dashboard — the first impression of a whole column, and on a phone
    // the note the page ends on. Before the first answer the same space says
    // what will land here instead; from the first answer on it is the real
    // figures, which is the point of showing it at all.
    var aside = document.getElementById('asideDyn');
    if (aside && !done) {
      clear(aside);
      aside.appendChild(el('div', 'aside-title', t('home.snapshot')));
      var soon = el('div', 'ov-empty');
      soon.appendChild(el('b', null, t('home.snapSoon')));
      soon.appendChild(el('span', null, t('home.snapSoonSub')));
      aside.appendChild(soon);
    } else if (aside) {
      clear(aside);
      aside.appendChild(el('div', 'aside-title', t('home.snapshot')));
      var ovCards = el('div', 'ov-cards');
      function ovCard(k, v, sub, cls) {
        var c = el('div', 'ov-card' + (cls ? ' ' + cls : ''));
        c.appendChild(el('div', 'ov-v', v));
        c.appendChild(el('div', 'ov-k', k));
        if (sub != null) c.appendChild(el('div', 'ov-sub', sub));
        ovCards.appendChild(c);
      }
      var streak = dayStreak();
      ovCard(t('home.ovAccuracy'), done ? Math.round(correct / done * 100) + '%' : '—',
        correct + ' / ' + done);
      ovCard(t('home.ovToday'), num(state.daily[todayKey()] || 0),
        streak ? t('stats.streak', { n: streak }) : t('stats.streakNone'), streak ? 'hot' : '');
      ovCard(t('home.ovWeek'), num(lastNDaysCount(7)), t('home.ovWeekSub'));
      ovCard(t('home.ovMistakes'), num(mistakes), null, mistakes ? 'bad' : '');
      aside.appendChild(ovCards);

      aside.appendChild(el('div', 'aside-title', t('stats.activity')));
      aside.appendChild(buildMonthCalendar());
    }

    clear(bookGrid);

    /* Thirteen cards is five and a half screens on a phone, and a reader who
       knows their level has to scroll past every book that is not theirs to
       reach the one that is. These chips narrow the shelf by CEFR band; the
       levels come out of books.js rather than being listed here, so a book at
       a new band brings its own chip with it. The state is deliberately not
       persisted — a filter that survives a reload is how somebody comes back
       tomorrow and finds half the library missing. */
    var bands = [];
    BOOKS.forEach(function (b) {
      (b.level || '').split('–').forEach(function (lv) {
        lv = lv.trim();
        if (lv && bands.indexOf(lv) < 0) bands.push(lv);
      });
    });
    bands.sort();
    if (bands.length > 1) {
      var bar = el('div', 'lib-filter');
      bar.setAttribute('role', 'group');
      bar.setAttribute('aria-label', t('lib.filterAria'));
      var mkChip = function (lv, label) {
        var c = el('button', 'lib-chip' + (libBand === lv ? ' on' : ''), label);
        c.type = 'button';
        c.setAttribute('aria-pressed', libBand === lv ? 'true' : 'false');
        c.addEventListener('click', function () {
          libBand = libBand === lv ? null : lv;
          renderHome();
        });
        return c;
      };
      bar.appendChild(mkChip(null, t('lib.filterAll')));
      bands.forEach(function (lv) { bar.appendChild(mkChip(lv, lv)); });
      bookGrid.appendChild(bar);
    }

    var shelf = BOOKS.filter(function (b) {
      return !libBand || (b.level || '').indexOf(libBand) > -1;
    });

    // Group order follows books.js, so adding a book with a new kind can never
    // drop it off this page silently.
    var kinds = [];
    shelf.forEach(function (b) {
      if (kinds.indexOf(b.kind) < 0) kinds.push(b.kind);
    });
    kinds.forEach(function (kind) {
      var list = shelf.filter(function (b) { return b.kind === kind; });
      if (!list.length) return;
      bookGrid.appendChild(el('div', 'lib-group', t('lib.group.' + kind)));
      var grid = el('div', 'book-grid');
      list.forEach(function (b) { grid.appendChild(bookCard(b)); });
      bookGrid.appendChild(grid);
    });
    if (!shelf.length) bookGrid.appendChild(el('div', 'find-note', t('lib.filterNone')));
    paintStartBand();
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

    // A lock only once the answer is in. While my_access is still in flight the
    // card stays plain: showing a lock and then removing it half a second later
    // tells a paying reader their subscription vanished, every single reload.
    if (window.ENTITLE && ENTITLE.isPaid(b.id) && ENTITLE.known() && !ENTITLE.canOpen(b.id)) {
      var lock = el('span', 'bc-lock', '🔒');
      lock.title = t('lock.badge');
      top.appendChild(lock);
    }
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

    // How many mistakes are still waiting in this book — the one number a
    // learner deciding "which book needs me" actually wants. It sits above the
    // progress bar, in the blurb's half of the card: the footer is the card's
    // one fixed row, and a line hanging below it left every card a different
    // height.
    var miss = bookMistakes(b.id);
    if (miss > 0) {
      var mline = el('div', 'bc-miss');
      mline.appendChild(el('span', 'bc-miss-n', String(miss)));
      mline.appendChild(document.createTextNode(' ' + t('card.mistakes')));
      card.appendChild(mline);
    }

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

  /* ================= placement quiz ("where do I start?") ================= */

  var placeModal = document.getElementById('placeModal');
  var placeBody = document.getElementById('placeBody');
  var placeReturnFocus = null;
  var placeState = null;      // { i, answers[], qs[] } while a run is in progress
  var placeRepaint = null;    // re-renders the current screen (for a language switch)
  // Ids asked in the last couple of runs, so a retake doesn't repeat them.
  var placeSeen = ((state.placement && state.placement.seen) || []).slice();

  /* One run = one question per blueprint slot, drawn from that slot's level.
     The quiz used to BE its eight questions, which made a retake a memory test
     of the first attempt (and made the level estimate worthless the second time
     round). Now the bank is sampled: questions asked in recent runs are held
     back until the level's pool runs dry, and the options are shuffled too, so a
     remembered position can't give the answer away. */
  function buildPlaceRun() {
    var P = window.PLACEMENT || {};
    var pool = P.pool || [];
    var plan = P.blueprint || [];
    var used = {}, run = [];
    plan.forEach(function (level) {
      var cand = pool.filter(function (q) { return q.level === level && !used[q.id]; });
      if (!cand.length) return;
      var fresh = cand.filter(function (q) { return placeSeen.indexOf(q.id) < 0; });
      var pick = shuffle((fresh.length ? fresh : cand).slice())[0];
      used[pick.id] = 1;
      run.push(placeItem(pick));
    });
    run.forEach(function (q) { placeSeen.push(q.id); });
    // Remember two runs' worth: enough to rotate, short enough that a learner
    // who keeps retaking still meets every question eventually.
    var cap = (plan.length || 8) * 2;
    if (placeSeen.length > cap) placeSeen = placeSeen.slice(placeSeen.length - cap);
    return run;
  }

  // A pool entry copied into a run with its options in a random order; `a` is
  // re-mapped to wherever the correct option landed.
  function placeItem(q) {
    var order = shuffle(q.options.map(function (o, i) { return i; }));
    return {
      id: q.id, level: q.level, q: q.q,
      options: order.map(function (i) { return q.options[i]; }),
      a: order.indexOf(q.a)
    };
  }

  // A raw score (correct answers) maps to exactly one track band.
  function placeTrack(score) {
    var tr = (window.PLACEMENT && PLACEMENT.tracks) || [];
    for (var i = 0; i < tr.length; i++) {
      if (score >= tr[i].min && score <= tr[i].max) return tr[i];
    }
    return tr[tr.length - 1] || null;
  }

  function openPlaceModal() {
    if (!placeModal) return;
    placeReturnFocus = document.activeElement;
    placeState = null;
    renderPlaceIntro();
    placeModal.hidden = false;
    var c = placeModal.querySelector('.modal-close');
    if (c) c.focus();
  }
  function closePlaceModal() {
    if (!placeModal || placeModal.hidden) return;
    placeModal.hidden = true;
    placeRepaint = null;
    if (placeReturnFocus && placeReturnFocus.focus) placeReturnFocus.focus();
    placeReturnFocus = null;
  }

  function renderPlaceIntro() {
    placeRepaint = renderPlaceIntro;
    clear(placeBody);
    var wrap = el('div', 'plc-intro');
    wrap.appendChild(el('h3', 'plc-h', t('plc.introH')));
    wrap.appendChild(el('p', 'plc-p', t('plc.introP')));
    wrap.appendChild(el('p', 'plc-fresh', t('plc.fresh')));
    var start = el('button', 'plc-primary', t('plc.start'));
    start.type = 'button';
    start.addEventListener('click', function () {
      placeState = { i: 0, answers: [], qs: buildPlaceRun() };
      renderPlaceQuestion();
    });
    wrap.appendChild(start);
    placeBody.appendChild(wrap);
  }

  function renderPlaceQuestion() {
    placeRepaint = renderPlaceQuestion;
    if (!placeState || !placeState.qs.length) { renderPlaceIntro(); return; }
    var qs = placeState.qs;
    var i = placeState.i;
    clear(placeBody);

    var head = el('div', 'plc-qhead');
    head.appendChild(el('span', 'plc-count', t('plc.progress', { i: i + 1, n: qs.length })));
    var bar = el('div', 'plc-bar');
    var fill = el('i');
    fill.style.width = Math.round(i / qs.length * 100) + '%';
    bar.appendChild(fill);
    head.appendChild(bar);
    placeBody.appendChild(head);

    var q = qs[i];
    placeBody.appendChild(el('p', 'plc-pick', t('plc.pick')));
    placeBody.appendChild(el('p', 'plc-q', q.q));

    var opts = el('div', 'plc-opts');
    q.options.forEach(function (opt, idx) {
      var b = el('button', 'plc-opt', opt);
      b.type = 'button';
      b.addEventListener('click', function () { answerPlace(idx); });
      opts.appendChild(b);
    });
    placeBody.appendChild(opts);

    var skip = el('button', 'plc-skip', t('plc.dontKnow'));
    skip.type = 'button';
    skip.addEventListener('click', function () { answerPlace(-1); });
    placeBody.appendChild(skip);

    var first = opts.querySelector('.plc-opt');
    if (first) first.focus();
  }

  function answerPlace(idx) {
    if (!placeState) return;
    var qs = placeState.qs;
    placeState.answers.push(idx);
    if (placeState.i < qs.length - 1) { placeState.i++; renderPlaceQuestion(); }
    else finishPlace();
  }

  function finishPlace() {
    var qs = placeState.qs;
    var score = 0;
    placeState.answers.forEach(function (a, i) { if (qs[i] && a === qs[i].a) score++; });
    var track = placeTrack(score);
    state.placement = {
      track: track ? track.id : null,
      band: track ? track.band : '',
      score: score, ts: Date.now(),
      seen: placeSeen.slice()          // so the next retake asks something else
    };
    save();
    if (window.SYNC) SYNC.touch(null);   // the estimate lives in the __meta row
    paintStartBand();
    renderPlaceResult(score, qs.length, track);
  }

  // A recommended-book card inside the result — links into the book and closes.
  function placeRecCard(b) {
    var a = el('a', 'plc-rec');
    a.href = '#/b/' + b.id;
    a.style.setProperty('--hue', b.hue);
    a.appendChild(el('span', 'plc-rec-kind', t('lib.group.' + b.kind)));
    a.appendChild(el('span', 'plc-rec-title', b.title));
    a.appendChild(el('span', 'plc-rec-lvl', b.level));
    a.appendChild(el('span', 'plc-rec-blurb', b.blurb[state.lang] || b.blurb.kk));
    // The quiz sends the lowest band at Essential Grammar, which is the one
    // book that ships no question text at all — so the reader who is least
    // able to work from a scan was the one finding that out by opening it.
    // Say it here, where the recommendation is made.
    if (b.needsPdf) a.appendChild(el('span', 'plc-rec-warn', t('plc.needsPdf')));
    a.appendChild(el('span', 'plc-rec-go', t('plc.openBook')));
    a.addEventListener('click', closePlaceModal);
    return a;
  }

  // `total` is the length of the run that was just taken, not of the whole bank.
  function renderPlaceResult(score, total, track) {
    placeRepaint = function () { renderPlaceResult(score, total, track); };
    clear(placeBody);
    var res = el('div', 'plc-result');

    res.appendChild(el('h3', 'plc-resh', t('plc.resultH', { band: track ? track.band : '—' })));
    res.appendChild(el('p', 'plc-scoreline', t('plc.score', { c: score, n: total })));
    if (track) res.appendChild(el('p', 'plc-why', t('plc.track.' + track.id)));

    res.appendChild(el('div', 'plc-rec-hd', t('plc.startWith')));
    var recs = el('div', 'plc-recs');
    [track && track.grammar, track && track.vocab].forEach(function (id) {
      var b = id && bookMeta(id);
      if (b) recs.appendChild(placeRecCard(b));
    });
    res.appendChild(recs);

    var goals = (window.PLACEMENT && PLACEMENT.goals) || [];
    if (goals.length) {
      res.appendChild(el('div', 'plc-goals-hd', t('plc.goalsH')));
      var grow = el('div', 'plc-goals');
      goals.forEach(function (g) {
        var b = bookMeta(g.book);
        if (!b) return;
        var a = el('a', 'plc-goal');
        a.href = '#/b/' + b.id;
        a.style.setProperty('--hue', b.hue);
        a.appendChild(el('b', null, t('plc.goal.' + g.id)));
        a.appendChild(el('span', null, b.title + ' · ' + b.level));
        a.addEventListener('click', closePlaceModal);
        grow.appendChild(a);
      });
      res.appendChild(grow);
    }

    var foot = el('div', 'plc-resfoot');
    var retake = el('button', 'plc-retake', t('plc.retake'));
    retake.type = 'button';
    retake.addEventListener('click', function () { placeState = null; renderPlaceIntro(); });
    foot.appendChild(retake);
    var lib = el('button', 'plc-tolib', t('plc.toLib'));
    lib.type = 'button';
    lib.addEventListener('click', closePlaceModal);
    foot.appendChild(lib);
    res.appendChild(foot);

    placeBody.appendChild(res);
    var r0 = placeBody.querySelector('.plc-recs a');
    if (r0) r0.focus();
  }

  // Home "where do I start?" band: once the quiz has been taken, swap the
  // generic prompt for the learner's level and the book we point them at.
  function paintStartBand() {
    var sub = document.getElementById('homeStartSub');
    var band = document.getElementById('homeStart');
    if (!sub || !band) return;
    var p = state.placement;
    var tr = p && p.track ? placeTrack(p.score) : null;
    var g = tr && bookMeta(tr.grammar);
    if (p && p.band && g) {
      sub.textContent = t('plc.resultH', { band: p.band }) + ' · ' +
        t('plc.homeRec', { book: g.title }) + ' · ' + t('plc.again');
      band.classList.add('taken');
    } else {
      sub.textContent = t('plc.homeSub');
      band.classList.remove('taken');
    }
  }

  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    if (e.target.closest('[data-open-place]')) { openPlaceModal(); return; }
    if (e.target.closest('[data-close-place]')) closePlaceModal();
  });

  document.addEventListener('keydown', function (e) {
    if (!placeModal || placeModal.hidden) return;
    if (e.key === 'Escape') { closePlaceModal(); return; }
    if (e.key !== 'Tab') return;
    var f = placeModal.querySelectorAll(
      'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  /* ================= account (optional cloud sync) ================= */

  // Everything here is inert unless supabase.config.js has been filled in. The
  // app was local-only by design and stays that way: an account is a backup that
  // also reaches a second device, never a gate in front of the exercises.
  var authModal = document.getElementById('authModal');
  var authBody = document.getElementById('authBody');
  var authReturnFocus = null;
  var authRepaint = null;
  var authMode = 'magic';       // 'magic' | 'password'
  var authSignup = false;       // password mode: sign in vs create account
  var authBusy = false;
  var authMsg = null;           // { text, bad } — the last result, shown in-panel
  var authEmail = '';           // survives a re-render (status ticks repaint us)

  function syncOn() { return !!(window.SYNC && SYNC.configured); }

  function openAuthModal() {
    if (!authModal || !syncOn()) return;
    authReturnFocus = document.activeElement;
    authMsg = null;
    authBusy = false;
    // Both repaint through SYNC.onChange once the answer lands: which providers
    // the project offers, or the profile as the server currently has it (a name
    // or email changed on another device would otherwise show stale here).
    if (SYNC.signedIn()) SYNC.refreshUser(); else SYNC.loadSettings();
    // The panel is where somebody looks after paying, and the subscription line
    // in it is drawn from a cached answer. Re-ask: the reader who was granted a
    // minute ago should not have to reload to see it — nor should the shelf
    // behind the panel keep its locks.
    if (SYNC.signedIn() && window.ENTITLE && ENTITLE.configured) {
      ENTITLE.refresh().catch(function () { /* offline — the cached answer stands */ });
    }
    renderAuth();
    authModal.hidden = false;
    var c = authModal.querySelector('.modal-close');
    if (c) c.focus();
  }
  function closeAuthModal() {
    if (!authModal || authModal.hidden) return;
    authModal.hidden = true;
    authRepaint = null;
    forgetAdminList();          // reopened panel = a fresh list, not last week's
    if (authReturnFocus && authReturnFocus.focus) authReturnFocus.focus();
    authReturnFocus = null;
  }

  function authSay(text, bad) {
    authMsg = { text: text, bad: !!bad };
    authBusy = false;
    renderAuth();
  }

  // Supabase's own error strings are English-only and often jargon ("Invalid
  // login credentials"), so they are wrapped rather than shown bare.
  function authFail(e) {
    if (!navigator.onLine) return authSay(t('auth.offline'), true);
    authSay(t('auth.failed', { msg: (e && e.message) || '' }), true);
  }

  function renderAuth() {
    if (!authBody) return;
    authRepaint = renderAuth;
    clear(authBody);
    if (SYNC.signedIn()) renderAuthAccount();
    else renderAuthSignIn();
    if (authMsg) {
      authBody.appendChild(el('p', 'auth-msg' + (authMsg.bad ? ' bad' : ''), authMsg.text));
    }
    authBody.appendChild(el('p', 'auth-note', t('auth.privacy')));
  }

  function renderAuthSignIn() {
    authBody.appendChild(el('p', 'auth-intro', t('auth.intro')));

    // Only offered when the Supabase project really has Google switched on —
    // otherwise the button's one job would be to navigate away to an error page.
    var prov = SYNC.providers();
    if (prov && prov.google) {
      var g = el('button', 'auth-google', t('auth.google'));
      g.type = 'button';
      g.disabled = authBusy;
      g.addEventListener('click', function () { SYNC.signInGoogle(); });
      authBody.appendChild(g);
      authBody.appendChild(el('div', 'auth-or', t('auth.or')));
    }

    var mail = el('input', 'auth-in');
    mail.type = 'email';
    mail.autocomplete = 'email';
    mail.placeholder = t('auth.emailPh');
    mail.setAttribute('aria-label', t('auth.email'));
    mail.value = authEmail;
    mail.addEventListener('input', function () { authEmail = mail.value; });
    authBody.appendChild(mail);

    var pass = null;
    if (authMode === 'password') {
      pass = el('input', 'auth-in');
      pass.type = 'password';
      pass.autocomplete = authSignup ? 'new-password' : 'current-password';
      pass.placeholder = t('auth.passwordPh');
      pass.setAttribute('aria-label', t('auth.password'));
      authBody.appendChild(pass);
    }

    function submit() {
      var email = (mail.value || '').trim();
      if (!email) return authSay(t('auth.needEmail'), true);
      authEmail = email;
      authBusy = true;
      renderAuth();
      if (authMode === 'magic') {
        SYNC.sendMagicLink(email)
          .then(function () { authSay(t('auth.magicSent'), false); })
          .catch(authFail);
        return;
      }
      var pw = pass ? pass.value : '';
      if (pw.length < 6) return authSay(t('auth.needPassword'), true);
      var p = authSignup ? SYNC.signUpPassword(email, pw) : SYNC.signInPassword(email, pw);
      p.then(function (r) {
        if (r === 'confirm-email') return authSay(t('auth.confirmEmail'), false);
        // Signed in: the panel swaps to the account view, and the busy flag has
        // to be dropped with it. Leaving it set rendered that whole view with
        // every button disabled — dead until the modal was closed and reopened.
        authMsg = null;
        authBusy = false;
        renderAuth();
      }).catch(authFail);
    }

    // Enter submits from either field — a two-field form where only the mouse
    // works is a needless annoyance on mobile keyboards.
    [mail, pass].forEach(function (inp) {
      if (!inp) return;
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
      });
    });

    var go = el('button', 'auth-primary',
      authMode === 'magic' ? t('auth.magic') : (authSignup ? t('auth.signUp') : t('auth.signIn')));
    go.type = 'button';
    go.disabled = authBusy;
    go.addEventListener('click', submit);
    authBody.appendChild(go);

    var alt = el('div', 'auth-alt');
    var swap = el('button', 'auth-link',
      authMode === 'magic' ? t('auth.usePassword') : t('auth.useMagic'));
    swap.type = 'button';
    swap.addEventListener('click', function () {
      authMode = authMode === 'magic' ? 'password' : 'magic';
      authMsg = null;
      renderAuth();
    });
    alt.appendChild(swap);

    if (authMode === 'password') {
      var reg = el('button', 'auth-link', authSignup ? t('auth.haveAccount') : t('auth.noAccount'));
      reg.type = 'button';
      reg.addEventListener('click', function () {
        authSignup = !authSignup;
        authMsg = null;
        renderAuth();
      });
      alt.appendChild(reg);
    }
    authBody.appendChild(alt);
  }

  /* ---- account management ---- */

  function authSection(title) {
    authBody.appendChild(el('div', 'auth-sec', title));
  }

  // One labelled field with its own action button. Every editable thing in the
  // panel is this shape, so they all behave the same: Enter submits, the button
  // greys out while the request is in flight, and the result lands in authMsg.
  function authField(opts) {
    var wrap = el('div', 'auth-field');
    var inp = el('input', 'auth-in');
    inp.type = opts.type || 'text';
    inp.placeholder = opts.placeholder || '';
    inp.setAttribute('aria-label', opts.label);
    if (opts.value) inp.value = opts.value;
    if (opts.autocomplete) inp.autocomplete = opts.autocomplete;

    var go = el('button', 'btn', opts.action);
    go.type = 'button';
    go.disabled = authBusy;

    function run() {
      var v = (inp.value || '').trim();
      var err = opts.validate && opts.validate(v);
      if (err) return authSay(err, true);
      authBusy = true;
      renderAuth();
      // A runner either resolves with its own message or with whatever the API
      // returned — usually the user object. Only a string is a message; without
      // this check the panel cheerfully printed "[object Object]".
      opts.run(v).then(function (m) {
        authSay(typeof m === 'string' && m ? m : t('auth.saved'), false);
      }).catch(authFail);
    }
    go.addEventListener('click', run);
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); run(); }
    });

    wrap.appendChild(inp);
    wrap.appendChild(go);
    authBody.appendChild(wrap);
  }

  function renderAuthAccount() {
    var u = SYNC.user() || {};
    var mail = u.email || '—';

    // Asked here rather than when the modal opens, because signing in happens
    // inside the open modal: a reader who arrives signed out would otherwise
    // have to close the panel and reopen it before the badge appeared. null
    // means "not asked yet"; SYNC shares the in-flight request, so the repaint
    // this triggers does not ask again. Nothing outside this panel needs the
    // answer, so a reader who never opens it never makes the request.
    if (SYNC.isAdmin() === null) SYNC.refreshAdmin();

    var who = el('div', 'auth-who');
    who.appendChild(el('div', 'acct-ava big', (u.name || mail).charAt(0).toUpperCase()));
    var whoText = el('div', 'auth-who-t');
    var line = el('div', 'auth-who-v');
    line.appendChild(document.createTextNode(u.name || mail));
    // The badge is drawn from a flag the server gave us, and it is the only
    // thing that flag does. Everything an admin can actually read is decided
    // again inside Postgres, so faking this in devtools buys a badge and
    // nothing else.
    if (SYNC.isAdmin()) line.appendChild(el('span', 'auth-badge', t('auth.adminBadge')));
    whoText.appendChild(line);
    if (u.name) whoText.appendChild(el('div', 'auth-who-k', mail));
    if (u.createdAt) {
      whoText.appendChild(el('div', 'auth-who-k',
        t('auth.since', { date: new Date(u.createdAt).toLocaleDateString(t('locale')) })));
    }
    who.appendChild(whoText);
    authBody.appendChild(who);

    /* ---- subscription ---- */
    // The one place a reader can see what they hold and when it runs out. It
    // sits above sync because it is the thing they paid for; sync is a feature
    // that happens to need the same account.
    if (window.ENTITLE && ENTITLE.configured) {
      authSection(t('sub.title'));
      var acc = ENTITLE.access();
      if (!acc) {
        authBody.appendChild(el('div', 'auth-sub', t('sub.checking')));
        ENTITLE.refresh().catch(function () {});
      } else if (acc.active) {
        authBody.appendChild(el('div', 'auth-status idle',
          acc.plan === 'lifetime'
            ? t('sub.lifetime')
            : t('sub.until', { date: authDate(acc.until) })));
        authBody.appendChild(el('div', 'auth-sub', t('sub.covers',
          { n: num(paidSize().books) })));
      } else {
        // Expired reads differently from never-bought: one is a renewal and the
        // other is a first purchase, and telling somebody who paid last month
        // that they have "no subscription" is how a renewal turns into a
        // support message.
        authBody.appendChild(el('div', 'auth-sub',
          acc.plan ? t('sub.lapsed', { date: authDate(acc.until) }) : t('sub.none')));
        var offer = offerCard();
        if (offer) authBody.appendChild(offer);
      }

      var subRow = el('div', 'auth-row');
      var recheck = el('button', 'auth-primary', t('sub.recheck'));
      recheck.type = 'button';
      recheck.addEventListener('click', function () {
        recheck.disabled = true;
        ENTITLE.refresh()
          .then(function () { renderAuth(); })
          .catch(function () { recheck.disabled = false; });
      });
      subRow.appendChild(recheck);
      authBody.appendChild(subRow);
    }

    /* ---- users (admins only) ---- */
    // A door, not the room. This panel is about one account — its own sync,
    // name, password — and a roster of everybody else read badly in the middle
    // of that. The list lives at #/users, where it has room for a table.
    if (SYNC.isAdmin()) {
      authSection(t('auth.secUsers'));
      var uRow = el('div', 'auth-row');
      var goUsers = el('button', 'auth-primary', t('auth.usersOpen'));
      goUsers.type = 'button';
      goUsers.addEventListener('click', function () {
        closeAuthModal();
        location.hash = '#/users';
      });
      uRow.appendChild(goUsers);
      authBody.appendChild(uRow);
    }

    /* ---- sync ---- */
    authSection(t('auth.secSync'));
    var st = SYNC.status();
    authBody.appendChild(el('div', 'auth-status ' + st, t('auth.st.' + st)));
    var ls = SYNC.lastSync();
    authBody.appendChild(el('div', 'auth-sub', ls
      ? t('auth.lastSync', { time: new Date(ls).toLocaleTimeString(t('locale')) })
      : t('auth.neverSynced')));
    var pend = SYNC.pending();
    if (pend) authBody.appendChild(el('div', 'auth-sub', t('auth.pending', { n: pend })));

    var syncRow = el('div', 'auth-row');
    var now = el('button', 'auth-primary', t('auth.syncNow'));
    now.type = 'button';
    now.disabled = st === 'syncing';
    now.addEventListener('click', function () { SYNC.syncNow(); });
    syncRow.appendChild(now);
    authBody.appendChild(syncRow);

    /* ---- profile ---- */
    authSection(t('auth.secProfile'));
    authField({
      label: t('auth.name'), placeholder: t('auth.namePh'), value: u.name,
      autocomplete: 'name', action: t('auth.save'),
      run: function (v) { return SYNC.setName(v); }
    });

    /* ---- security ---- */
    authSection(t('auth.secSecurity'));
    authField({
      label: t('auth.newPassword'), placeholder: t('auth.passwordPh'), type: 'password',
      autocomplete: 'new-password', action: t('auth.changePassword'),
      validate: function (v) { return v.length >= 6 ? null : t('auth.needPassword'); },
      run: function (v) { return SYNC.setPassword(v).then(function () { return t('auth.passwordChanged'); }); }
    });

    var secRow = el('div', 'auth-row');
    var everywhere = el('button', 'btn', t('auth.signOutAll'));
    everywhere.type = 'button';
    everywhere.addEventListener('click', function () {
      ASK.confirm(t('auth.signOutAllConfirm'),
        { title: t('auth.signOutAll'), yes: t('auth.signOutAll'), danger: true })
        .then(function (ok) {
          if (!ok) return;
          SYNC.signOutEverywhere().then(function () { authMsg = null; renderAuth(); });
        });
    });
    secRow.appendChild(everywhere);
    authBody.appendChild(secRow);
    authBody.appendChild(el('p', 'auth-note', t('auth.signOutAllNote')));

    /* ---- data ---- */
    authSection(t('auth.secData'));
    var dataRow = el('div', 'auth-row');
    var exp = el('button', 'btn', t('stats.export'));
    exp.type = 'button';
    exp.addEventListener('click', exportProgress);
    var imp = el('button', 'btn', t('stats.import'));
    imp.type = 'button';
    imp.addEventListener('click', importProgress);
    dataRow.appendChild(exp);
    dataRow.appendChild(imp);
    authBody.appendChild(dataRow);
    authBody.appendChild(el('p', 'auth-note', t('auth.dataNote')));

    /* ---- danger zone ---- */
    // Sign-out first and least alarming, then the two that destroy something.
    // None of them touch this browser's localStorage: the reader's work was
    // theirs before the account existed and stays theirs after it is gone.
    authSection(t('auth.secDanger'));
    var dangerRow = el('div', 'auth-row');

    var out = el('button', 'btn', t('auth.signOut'));
    out.type = 'button';
    out.addEventListener('click', function () {
      SYNC.signOut().then(function () {
        authMsg = null;
        forgetAdminList();      // whoever signs in next gets their own answer
        renderAuth();
      });
    });
    dangerRow.appendChild(out);

    var wipe = el('button', 'btn danger', t('auth.wipeCloud'));
    wipe.type = 'button';
    wipe.addEventListener('click', function () {
      ASK.confirm(t('auth.wipeCloudConfirm'),
        { title: t('auth.wipeCloud'), yes: t('auth.wipeCloud'), danger: true })
        .then(function (ok) {
          if (!ok) return;
          authBusy = true;
          renderAuth();
          SYNC.deleteCloudProgress()
            .then(function () { authSay(t('auth.wipeCloudOk'), false); })
            .catch(authFail);
        });
    });
    dangerRow.appendChild(wipe);

    var del = el('button', 'btn danger', t('auth.deleteAccount'));
    del.type = 'button';
    del.addEventListener('click', function () {
      ASK.confirm(t('auth.deleteConfirm'),
        { title: t('auth.deleteAccount'), yes: t('auth.deleteAccount'), danger: true })
        .then(function (ok) {
          if (!ok) return;
          authBusy = true;
          renderAuth();
          SYNC.deleteAccount().then(function () {
            forgetAdminList();
            authSay(t('auth.deleteOk'), false);
          }).catch(function (e) {
            // A project that never ran the delete_me() half of the schema
            // answers 404 here. Saying so beats "Failed: Not Found".
            if (e && e.status === 404) return authSay(t('auth.deleteNoRpc'), true);
            authFail(e);
          });
        });
    });
    dangerRow.appendChild(del);
    authBody.appendChild(dangerRow);

    authBody.appendChild(el('p', 'auth-note', t('auth.signOutNote')));
  }

  /* ---- the user list: state shared with the #/users page ---- */

  // Kept at this level rather than inside the page, so that a repaint (a merged
  // sync calls route(), which redraws whatever page is open) does not re-fetch
  // the whole roster. null = not loaded, [] = loaded and empty.
  var adminUsers = null;
  var adminErr = null;
  var adminLoading = false;

  function forgetAdminList() { adminUsers = null; adminErr = null; forgetClasses(); }

  function loadAdminUsers(done) {
    if (adminLoading) return;
    adminLoading = true;
    adminErr = null;
    SYNC.listUsers().then(function (rows) {
      adminUsers = rows || [];
    }).catch(function (e) {
      // 404: the project never ran the admin half of supabase_schema.sql.
      // 403/42501: the function ran and said no — the badge was stale or forged.
      adminErr = (e && e.status === 404) ? t('users.noRpc')
        : (e && e.status === 403) ? t('users.notAdmin')
        : t('auth.failed', { msg: (e && e.message) || '' });
    }).then(function () {
      adminLoading = false;
      if (done) done();
    });
  }

  function authDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    try {
      return d.toLocaleDateString(t('locale'), { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (e) {
      return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    }
  }

  // This was a bare ○/◉ glyph at first, and it was effectively invisible: a
  // reader who does not already know the app has accounts will never press an
  // unlabelled circle sitting between the search and theme icons. Signed out it
  // is a worded button; signed in it collapses to the initial of the address —
  // the avatar shape the rest of the web uses for "this is your account" — which
  // also keeps it working as the status light.
  function refreshAuthButtons() {
    var on = syncOn();
    [].forEach.call(document.querySelectorAll('.acct-btn'), function (b) {
      b.hidden = !on;
      if (!on) return;
      var inn = SYNC.signedIn();
      var u = SYNC.user() || {};
      var mail = u.email || '';
      // A reader who has set a display name expects to see it here too, not the
      // address they replaced it with in the panel.
      var shown = u.name || mail;
      clear(b);
      // Avatar + word, not a lone glyph: the mark carries "this is a person's
      // account" and the word says what pressing it does. Signed in the avatar
      // holds the initial and the label becomes the address, so the button also
      // answers "which account?" without being opened.
      b.appendChild(el('span', 'acct-ava', inn ? (shown.charAt(0) || '●').toUpperCase() : '👤'));
      b.appendChild(el('span', 'acct-label', inn ? shown : t('auth.signIn')));
      b.classList.toggle('on', inn);
      var label = inn ? t('auth.signedInAs') + ': ' + mail : t('auth.signIn');
      b.removeAttribute('title');   // the hover tip says the same, better
      b.setAttribute('data-tip-text',
        inn ? label + '\n' + t('tip.acctIn') : t('tip.acct'));
      b.setAttribute('aria-label', label);
    });
  }

  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    if (e.target.closest('[data-open-auth]')) { openAuthModal(); return; }
    if (e.target.closest('[data-close-auth]')) closeAuthModal();
  });

  document.addEventListener('keydown', function (e) {
    if (!authModal || authModal.hidden) return;
    if (e.key === 'Escape') { closeAuthModal(); return; }
    if (e.key !== 'Tab') return;
    var f = authModal.querySelectorAll(
      'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // A merge that changed nothing must not repaint: sync runs on a timer, and a
  // pointless re-render would clear whatever the reader is halfway through typing.
  var mergedChanged = false;

  function itemsSig(st) {
    var n = 0, sum = 0;
    for (var k in st.items) { n++; sum += (st.items[k].ts || 0) % 1e9; }
    return n + ':' + sum;
  }

  // The subscription answer arrives after the first paint, and signing in or
  // out changes it. Only the library draws locks, so only the library is
  // redrawn — and never while an answer is being typed, for the same reason
  // afterMerge holds off below.
  if (window.ENTITLE && ENTITLE.configured) {
    ENTITLE.onChange(function () {
      // The account panel carries the subscription section, and the answer that
      // fills it in arrives after the panel can already be open. Without this it
      // would only ever appear on the *second* opening — which reads as "it does
      // not work".
      if (authModal && !authModal.hidden && authRepaint) authRepaint();
      // A reader looking at a sample who has just been granted a subscription
      // must get the whole book, not the two units they were given. The cached
      // copy IS the sample, so it has to go before anything re-renders.
      if (book && book.sample && ENTITLE.active()) {
        var id = book.id;
        delete cache[id];
        delete pending[id];
        book = null;
        openBook(id, null, null);
        return;
      }
      if (body.getAttribute('data-view') !== 'home') return;
      var ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
      route();
    });
  }

  if (window.SYNC) {
    // Who the app currently believes is signed in. SYNC emits on every status
    // tick, and #/users is a whole page rebuild — repainting on all of them
    // would take the filter field's focus away mid-word.
    var lastWho = null;
    SYNC.onChange(function () {
      refreshAuthButtons();
      if (authModal && !authModal.hidden && authRepaint) authRepaint();
      // Signing out (or in as somebody else) has to reach the roster: it is a
      // page of other people's addresses, and leaving it up until the reader
      // happens to navigate is the wrong way for it to go away.
      var who = SYNC.signedIn() ? ((SYNC.user() || {}).id || 'in') : null;
      if (who !== lastWho) {
        lastWho = who;
        forgetAdminList();
        if (body.getAttribute('data-view') === 'users') renderUsers();
      }
    });
    SYNC.attach({
      getState: function () { return state; },
      mergeInto: function (cur, incoming) {
        var before = itemsSig(cur);
        mergeInto(cur, incoming);
        if (itemsSig(cur) !== before) mergedChanged = true;
      },
      afterMerge: function () {
        if (!mergedChanged) return;
        mergedChanged = false;
        state.books = {};          // counters are derived — force a recount
        flush();
        // Never yank the page out from under an answer in progress. The merged
        // records are already in `state`; the view catches up on the next route.
        var ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA') &&
            ae.closest && ae.closest('#main')) return;
        route();
        refreshBadge();
      }
    });
  }

  /* ================= sidebar ================= */

  var book = null;         // currently open book
  var currentUnit = null;
  // The Writing/Speaking page open right now, as 'w1' or 's1' — the rail marks
  // it the way it marks the unit a reader is on. Every other page clears it.
  var currentTask = null;

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

  /* What a unit is called in the list. A grammar book numbers its units and
     that number is what the reader looks for. An IELTS book does not: its
     "unit 5" is Test 3's Listening, and the four skills of one test belong
     together — so the rail reads L1 R1 W1 S1, L2 R2 W2 S2, which is how a
     candidate thinks about a book of four tests. */
  function unitTag(u) {
    if (!(book.meta && book.meta.kind === 'ielts' && u.skill)) return String(u.unit);
    var test = EXAM.testOf(u);
    return (u.skill === 'listening' ? 'L' : 'R') + (test == null ? '' : test);
  }

  function renderSidebar() {
    if (!book) return;
    var q = (searchEl.value || '').trim().toLowerCase();
    var min = sideMin();
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
      var full = st.total > 0 && st.pct === 100;
      var a = el('a', 'unit-link' + (currentUnit === u.unit ? ' current' : '') +
        (full ? ' full' : ''));
      a.href = '#/b/' + book.id + '/unit/' + u.unit;
      if (currentUnit === u.unit) a.setAttribute('aria-current', 'page');
      // Collapsed the title is not on screen, so it moves into the hover tip
      // and the accessible name — a rail of numbers must still be readable.
      var tag = unitTag(u);
      if (min) {
        a.setAttribute('aria-label', tag + '. ' + unitTitle(u));
        a.setAttribute('data-tip-text', tag + '. ' + unitTitle(u) +
          (st.done ? '\n' + st.pct + '%' : ''));
      }
      a.appendChild(el('span', 'u-num', tag));
      a.appendChild(el('span', 'u-title', unitTitle(u)));
      a.appendChild(el('span', 'u-pct' + (full ? ' done' : ''), full ? '✓' : (st.done ? st.pct + '%' : '')));
      li.appendChild(a);
      unitListEl.appendChild(li);

      // Writing and Speaking are not units — nothing in them is marked — but
      // they are two of the four skills of this test, and hiding them under
      // the list made them look like an appendix to the book rather than half
      // of the exam. They follow the Reading of the test they belong to.
      if (!q && u.skill === 'reading' && hasTasks()) {
        var testNo = EXAM.testOf(u);
        [['writing', 'W'], ['speaking', 'S']].forEach(function (pair) {
          if (!bookPrompts(testNo).some(function (p) { return p.skill === pair[0]; })) return;
          var tli = el('li');
          var key = pair[1].toLowerCase() + testNo;
          var here = currentTask === key;
          var ta = el('a', 'unit-link task-link' + (here ? ' current' : ''));
          ta.href = '#/b/' + book.id + '/tasks/' + testNo + '/' + pair[1].toLowerCase();
          if (here) ta.setAttribute('aria-current', 'page');
          var label = pair[1] + testNo;
          var name = t('task.' + pair[0] + 'Unit', { n: testNo });
          ta.appendChild(el('span', 'u-num', label));
          ta.appendChild(el('span', 'u-title', name));
          ta.setAttribute('aria-label', name);
          if (min) ta.setAttribute('data-tip-text', label + '. ' + name);
          tli.appendChild(ta);
          unitListEl.appendChild(tli);
        });
      }
    });
    if (!shown) unitListEl.appendChild(el('div', 'empty-hint', t('sidebar.empty')));

    // What the sample does not include, said where the reader is looking for
    // it: at the bottom of a very short list of units.
    if (book.sample && !q) {
      var rest = (book.unitsOf || book.units.length) - book.units.length;
      var li0 = el('li', 'unit-extra');
      var lock = el('a', 'unit-link ue-link locked-link');
      lock.href = '#/b/' + book.id + '/unlock';
      lock.appendChild(el('span', 'u-num', '🔒'));
      lock.appendChild(el('span', 'u-title', t('sample.more', { n: rest })));
      li0.appendChild(lock);
      unitListEl.appendChild(li0);
    }

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

  /* ================= the ◇ / ← button ================= */

  // The leftmost button in the topbar. Inside a book it is the way out to the
  // library, a diamond. On a practice-session page pointing anywhere else it is
  // one step back — and then it says so with an arrow, because ◇ next to a book
  // title reads as "leave", which is exactly what it must not do there.
  var backHash = '#/';

  function setBackLink(href) {
    var a = document.querySelector('.home-link');
    if (!a) return;
    var out = !href || href === '#/';
    a.href = out ? '#/' : href;
    a.textContent = out ? '◇' : '←';
    var ariaKey = out ? 'library.aria' : 'back.aria';
    a.setAttribute('data-tip', out ? 'tip.home' : 'tip.back');
    a.setAttribute('data-i18n-aria', ariaKey);   // stays right after a language switch
    a.setAttribute('aria-label', t(ariaKey));
  }

  // Works from the catalogue alone, so the header is right from the first
  // frame — even while the data is still downloading, or if it never arrives.
  function paintChrome(id) {
    setBackLink('#/');
    var bid = id || (book && book.id);
    var m = bookMeta(bid) || {};
    document.getElementById('brandTitle').textContent = m.title || bid || '';
    document.getElementById('brandSub').textContent =
      (m.level ? m.level + ' · ' : '') + (m.author || '');
    document.getElementById('tabUnits').href = '#/b/' + bid;
    document.getElementById('tabErrors').href = '#/b/' + bid + '/errors';
    document.getElementById('tabStats').href = '#/b/' + bid + '/stats';
    // ⚡ inside a book means "practise this book"; the library's button is the
    // cross-book one.
    document.getElementById('tabDrill').href = '#/drill/' + bid;
  }

  /* ================= resizable panels ================= */

  /* First-time proportions, as SHARES of the window rather than pixels: the
     book page on the left just under half the screen, the unit list a narrow
     eighth on the right, the exercises taking whatever is between them. Fixed
     defaults (268px / 520px) gave every reader a different split — on a 1792px
     laptop the book pane was a third of what it should be and the exercise
     column sprawled; on a 1100px one there was barely a reading column left.
     Clamps keep both panels usable at either extreme. A stored size (dragged by
     the reader) always wins; double-clicking a handle clears it back to these. */
  var SIDEBAR_SHARE = .125, SIDEBAR_MIN = 210, SIDEBAR_MAX = 320;
  var PDF_SHARE = .48, PDF_MIN = 420, PDF_MAX = 1100;
  // Collapsed unit list: wide enough for a column of unit numbers and nothing
  // else. Must match the rail width in the stylesheet.
  var SIDEBAR_RAIL = 54;
  // Share of the window the book sheet takes on a phone until the reader drags
  // it. Just under half: enough of the page to read, enough of the exercise
  // below it to see which question is being answered.
  var PDF_H_SHARE = .46;
  // Below this the layout stops tiling panels side by side and stacks them —
  // it must match the breakpoint the stylesheet uses.
  var NARROW = 860;

  function clampNum(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function isNarrow() { return (window.innerWidth || 1280) <= NARROW; }
  function winW() { return window.innerWidth || 1280; }
  function sidebarW() {
    if (sideMin()) return SIDEBAR_RAIL;
    return state.ui.sidebarW ||
      clampNum(Math.round(winW() * SIDEBAR_SHARE), SIDEBAR_MIN, SIDEBAR_MAX);
  }
  function pdfW() {
    return state.ui.pdfW || clampNum(Math.round(winW() * PDF_SHARE), PDF_MIN, PDF_MAX);
  }
  function pdfH() {
    return state.ui.pdfH || Math.round((window.innerHeight || 800) * PDF_H_SHARE);
  }

  // The reading column must keep a usable width, so each panel's ceiling
  // depends on the window and on whether the other panel is open.
  function applyWidths() {
    var win = window.innerWidth || 1280;
    var open = !pdfPane.hidden;
    var min = sideMin() ? SIDEBAR_RAIL : 180;
    var sMax = Math.max(min, win - (open ? pdfW() : 0) - 320);
    var sw = clampNum(sidebarW(), min, sMax);
    document.documentElement.style.setProperty('--sidebar-w', sw + 'px');

    var pMax = Math.max(300, win - sw - 320);
    var pw = clampNum(pdfW(), 300, pMax);
    document.documentElement.style.setProperty('--pdf-w', pw + 'px');

    // On a phone the sheet is sized by height instead. Its ceiling leaves room
    // for a question and its answer box underneath — a sheet that fills the
    // screen is the very thing this layout exists to avoid.
    var vh = window.innerHeight || 800;
    document.documentElement.style.setProperty(
      '--pdf-h', clampNum(pdfH(), 130, Math.max(150, vh - 250)) + 'px');
  }

  // `sign` is +1 when dragging right should widen the panel (sidebar) and -1
  // when the handle sits on the panel's left edge (the PDF pane).
  // `axis` is read at pointerdown, not once at wiring time: the PDF handle
  // sizes a width beside the text on a desktop and a height above it on a
  // phone, and the same window can become either by being resized or turned.
  function makeDragger(handle, sign, read, write, reset, axis) {
    var startX = 0, startVal = 0, active = false, vertical = false;

    handle.addEventListener('pointerdown', function (e) {
      active = true;
      vertical = axis ? axis() === 'y' : false;
      startX = vertical ? e.clientY : e.clientX;
      startVal = read();
      handle.setPointerCapture(e.pointerId);
      handle.classList.add('active');
      document.body.classList.add('dragging');
      e.preventDefault();
    });
    handle.addEventListener('pointermove', function (e) {
      if (!active) return;
      write(startVal + sign * ((vertical ? e.clientY : e.clientX) - startX));
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

  // Dragged narrower than this, the list is asking for the rail. Under ~180px
  // every title is an ellipsis anyway, so instead of the drag stopping dead at
  // the minimum width it hands over to the collapsed state — and dragging the
  // rail back out past the same point brings the titles back. It is the very
  // preference the « button sets, so it is stored and restored the same way.
  var SIDEBAR_SNAP = 150;

  // The rail, toggled mid-drag: only when it actually changes, and without the
  // storage write — the drag saves once, when the pointer comes up.
  function setSideMinLive(on) {
    on = !!on && !isNarrow();
    if (on === sideMin()) return;
    state.ui.sideMin = on;
    if (on && searchEl && searchEl.value) searchEl.value = '';
    applySideMin();
    renderSidebar();
    Tips.hide();
  }

  // The unit list is on the right, so its handle sits on the list's left edge:
  // dragging left widens it. The book pane is on the left, handle on its right.
  makeDragger(dragSidebar, -1,
    sidebarW,
    function (v) {
      if (v < SIDEBAR_SNAP) { setSideMinLive(true); return; }
      setSideMinLive(false);
      state.ui.sidebarW = clampNum(v, 180, 560);
    },
    // 0 is falsy, so the width goes back to being a share of the window rather
    // than to whatever pixel count happened to be the default when it was set.
    function () { setSideMinLive(false); state.ui.sidebarW = 0; });

  /* ---- collapsing the unit list down to a rail of numbers ----
     Once a reader knows the book, the titles are dead weight: they are reading
     a unit, not choosing one, and the list is holding an eighth of the window
     to repeat what the page they are on already says. Collapsed, the list keeps
     only the numbers — still a full jump list, at a fifth of the width — and
     the exercises get the room. Only on a wide screen: on a phone the list is a
     drawer over the page, where a rail of bare numbers would save nothing.
     The choice is remembered (`state.ui.sideMin`), so it is a layout preference
     and not something to redo on every visit. */
  function sideMin() { return !!state.ui.sideMin && !isNarrow(); }

  function applySideMin() {
    var on = sideMin();
    document.body.classList.toggle('side-min', on);
    var b = document.getElementById('sideMin');
    if (b) {
      b.textContent = on ? '«' : '»';
      b.setAttribute('aria-expanded', on ? 'false' : 'true');
      b.setAttribute('aria-label', t(on ? 'side.max' : 'side.min'));
      b.setAttribute('data-tip', on ? 'tip.sideMax' : 'tip.sideMin');
    }
    // The handle stays on a rail too: dragging it right past SIDEBAR_SNAP is
    // the other way back to the full list, and a handle that disappeared under
    // the pointer mid-drag would strand the drag that collapsed it.
    if (dragSidebar) dragSidebar.hidden = false;
  }

  function setSideMin(on) {
    state.ui.sideMin = !!on;
    // A filter left behind in the search box would hide most of the rail with
    // nothing on screen to explain why.
    if (on && searchEl && searchEl.value) searchEl.value = '';
    save();
    applySideMin();
    applyWidths();
    renderSidebar();
    Tips.hide();          // the button under the pointer now means the opposite
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-side-min]')) setSideMin(!sideMin());
  });

  // One handle, two jobs. Beside the text it sets the pane's width; stacked
  // above it, dragging down makes the book sheet taller — same +1 sign, since
  // the handle sits on the pane's far edge either way. A double-tap on it
  // clears the stored size and goes back to the default share of the screen.
  makeDragger(dragPdf, 1,
    function () { return isNarrow() ? pdfH() : pdfW(); },
    function (v) {
      if (isNarrow()) state.ui.pdfH = clampNum(v, 130, 2000);
      else state.ui.pdfW = clampNum(v, 300, 1200);
    },
    function () {
      if (isNarrow()) state.ui.pdfH = 0;   // falsy — pdfH() falls back to the share
      else state.ui.pdfW = PDF_DEFAULT;
    },
    function () { return isNarrow() ? 'y' : 'x'; });

  // Crossing the narrow breakpoint turns the rail back into a drawer and back
  // again, so the collapsed state has to be re-read, not just the widths.
  window.addEventListener('resize', function () { applySideMin(); applyWidths(); });

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

  /* Can this browser show a PDF inside the page at all?

     Not "is it a phone" — the honest question is whether an <iframe> will
     render the book. Every desktop browser does, and does it better than we
     could: native scrolling, text selection, find, print. Touch browsers do
     not. iOS Safari paints the first page as a flat picture, ignores the
     `#page=` we send it, and gives no way to reach page two; Android Chrome
     offers a download. Both leave the IELTS books — whose questions exist
     only on the page — impossible to work through.

     A coarse pointer is the test, because that is precisely the population
     without a viewer, and it needs no user-agent sniffing. Desktop browsers
     with the built-in viewer switched off report `pdfViewerEnabled === false`
     and are caught by the second check; they used to land on the "your
     browser would not display this" message and now get the drawn one. */
  function canEmbedPdf() {
    try {
      if (window.matchMedia && matchMedia('(pointer: coarse)').matches) return false;
    } catch (e) { /* no matchMedia — assume a desktop browser */ }
    if (typeof navigator.pdfViewerEnabled === 'boolean') return navigator.pdfViewerEnabled;
    return true;
  }

  function drawPdf() {
    return !canEmbedPdf() && window.PDFVIEW && PDFVIEW.supported();
  }

  var pdfNav = document.getElementById('pdfNav');
  var pdfPos = document.getElementById('pdfPos');
  var pdfCanvas = document.getElementById('pdfCanvas');
  var pdfDrawing = false;      // is the canvas reader the one on screen

  function setPos(n, total) {
    pdfPos.textContent = total ? t('pdf.pos', { n: n, total: total }) : '';
  }

  // Draw the book ourselves. The iframe stays in the DOM but empty, so nothing
  // downloads twice if the reader resizes across the breakpoint.
  function paintPdf(page) {
    pdfDrawing = true;
    pdfFrame.removeAttribute('src');
    pdfFrame.hidden = true;
    pdfCanvas.hidden = false;
    pdfNav.hidden = false;
    clearTimeout(pdfWatch);
    pdfPane.classList.add('loading');
    clear(pdfFallback);
    pdfFallback.appendChild(el('div', null, t('pdf.loading')));
    pdfFallback.hidden = false;
    setPos(page, PDFVIEW.count());

    PDFVIEW.open(pdfCanvas, pdfUrl(null) || '', page, {
      onPage: function (n, total) { setPos(n, total); }
    }).then(function (total) {
      pdfPane.classList.remove('loading');
      pdfFallback.hidden = true;
      setPos(page, total);
    }).catch(function () {
      // Nothing to fall back to in the page itself — offer the file.
      pdfPane.classList.remove('loading');
      clear(pdfFallback);
      pdfFallback.appendChild(el('div', null, t('pdf.fallback')));
      var a = el('a', 'btn small', t('pdf.newTab'));
      a.href = pdfNewTab.href;
      a.target = '_blank';
      a.rel = 'noopener';
      pdfFallback.appendChild(a);
      pdfFallback.hidden = false;
    });
  }

  // `meta` overrides the open book's — the lock screen shows the textbook for a
  // book whose exercises never loaded, so there is no `book` to read it from.
  function showPdf(page, meta) {
    var m = meta || (book && book.meta);
    var url = pdfUrl(page, m);
    if (!url) return;
    pdfPane.hidden = false;
    dragPdf.hidden = false;
    document.body.classList.add('pdf-open');
    if (drawPdf()) paintPdf(page || 1);
    else if (pdfCurrentUrl !== url) mountPdf(url);
    pdfTitle.textContent = (m && m.title) || '';
    pdfNewTab.href = url;
    state.ui.pdfOpen = true;
    save();
    applyWidths();
  }

  pdfCanvas.addEventListener('scroll', function () {
    if (pdfDrawing) setPos(PDFVIEW.page(), PDFVIEW.count());
  });
  document.getElementById('pdfIn').addEventListener('click', function () {
    PDFVIEW.setZoom(PDFVIEW.zoomLevel() * 1.35);
  });
  document.getElementById('pdfOut').addEventListener('click', function () {
    PDFVIEW.setZoom(PDFVIEW.zoomLevel() / 1.35);
  });
  // Dragging the sheet taller or turning the phone changes the fit-to-width
  // scale, and a canvas drawn at the old width would sit there blurred.
  window.addEventListener('resize', function () {
    if (pdfDrawing) PDFVIEW.relayout();
  });

  // `remember` false keeps the reader's preference so the pane comes back when
  // they open the next unit — used when switching books, not when they close it.
  function hidePdf(remember) {
    pdfPane.hidden = true;
    dragPdf.hidden = true;
    document.body.classList.remove('pdf-open');
    pdfFrame.removeAttribute('src');
    pdfCurrentUrl = null;
    // Give the worker and every rasterised page back: a book left open in the
    // background is tens of megabytes of canvas on a device that has none.
    if (pdfDrawing) {
      PDFVIEW.close();
      pdfDrawing = false;
      pdfCanvas.hidden = true;
      pdfNav.hidden = true;
      pdfFrame.hidden = false;
    }
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
    // Under exam conditions a row is a box and nothing else: no Check, no hint,
    // no verdict, and the typing goes into the run rather than into the store.
    // Everything is graded in one pass when the clock stops (finishExam).
    var exam = (opts && opts.exam) || null;
    // The reference page for the unit THIS row belongs to. It has to travel with
    // the row rather than sit in a module variable: the Mistakes page builds rows
    // from a dozen different units in one pass, and a shared variable meant every
    // one of them offered the last-opened unit's page.
    var introPage = (opts && opts.introPage != null) ? opts.introPage : null;
    // In review mode the book key stays hidden until the learner answers again
    // this session — otherwise the answer sits in plain sight (AUDIT §У1).
    var reveal = !review;
    var key = keyOf(book.id, unitNo, sub.number, itemKey(it));
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
    // An answer-sheet book has no question text by design, and its number is
    // already in the column to the left, so "see the question in the PDF" on
    // every one of forty rows would only be noise.
    var sheet = !!(book.meta && book.meta.answerSheet);
    var q = null;
    if (it.question || !sheet) {
      q = el('div', 'q');
      if (it.question) {
        q.textContent = it.question;
      } else if (sub.type === 'text') {
        q.className = 'q none';
        q.textContent = t('row.gap', { n: it.n });
      } else {
        q.className = 'q none';
        q.textContent = t('row.fromPdf', { n: it.n });
      }
      if (it.question) {
        var qSay = speakBtn(function () { return it.question; });
        if (qSay) q.appendChild(qSay);
      }
      rbody.appendChild(q);
    }
    if (isManual(it)) {
      var tg = el('span', 'tag self', t('row.self'));
      // "self-check" on its own reads as the app giving up. The data says which
      // of three quite different reasons applies — the answer is a whole
      // sentence, the printed key did not survive extraction, or the question
      // is genuinely open — and each wants a different thing from the reader.
      var why = 'row.selfWhy.' + (it.selfWhy || 'open');
      tg.title = t(why);
      if (q) q.insertBefore(tg, q.firstChild);
      else rbody.appendChild(tg);
      // Spelled out once per reason per exercise. Six rows in a row that are all
      // self-check for the same reason want the explanation once, not six times;
      // the tag on each of them carries it as a tooltip either way.
      if (!opts || opts.selfNote !== false) rbody.appendChild(el('div', 'self-note', t(why)));
    }

    /* --- input + buttons --- */
    var line = el('div', 'answer-line');
    var input = answerInput(t('row.aria', { unit: unitNo, sub: sub.number, n: it.n }));
    var r0 = rec(key);
    // On the Mistakes page start from a clean box; the old wrong answer is shown
    // separately as "last time: …" rather than left sitting in the field.
    if (exam) input.value = exam.answers[key] || '';
    else if (r0 && r0.val && !review) input.value = r0.val;
    if (review && !exam && r0 && r0.val) {
      var prev = el('div', 'prev-answer');
      prev.appendChild(el('span', 'pa-label', t('row.lastTime')));
      prev.appendChild(el('span', 'pa-val', r0.val));
      rbody.appendChild(prev);
    }
    line.appendChild(input);

    var feedback = el('div', 'feedback');
    feedback.setAttribute('aria-live', 'polite');

    // Hint ladder, per attempt: shape -> first letters -> the answer. Nothing
    // is stored until an answer is actually given; `hintLevel` then travels
    // into applyAnswer so a hinted "correct" cannot buy mastery.
    var hintLevel = 0;
    var hintBox = el('div', 'hint');
    hintBox.hidden = true;

    function showHint() {
      if (hintLevel >= 3) return;
      hintLevel++;
      clear(hintBox);
      hintBox.hidden = false;
      hintBox.appendChild(el('span', 'hint-ico', '💡'));
      if (hintLevel === 1) {
        hintBox.appendChild(el('code', 'hint-mask', hintMask(it.answer, 1)));
        hintBox.appendChild(el('span', 'hint-meta', t('hint.letters', { n: hintLetters(it.answer) })));
      } else if (hintLevel === 2) {
        hintBox.appendChild(el('code', 'hint-mask', hintMask(it.answer, 2)));
      } else {
        hintBox.appendChild(el('b', 'hint-full', hintBase(it.answer)));
      }
      if (hintBtn) hintBtn.textContent = hintLevel >= 3 ? t('hint.done') : t('hint.more');
      input.focus();
    }

    function paint() {
      var r = rec(key);
      row.classList.remove('correct', 'wrong', 'mastered');
      clear(feedback);
      if (exam) return;               // no verdict while the clock is running
      if (!r || !r.last) return;
      // Review mode: no verdict, no key, until the learner tries again here.
      if (review && !reveal) return;

      if (r.mastered) row.classList.add('mastered');
      else row.classList.add(r.last === 'correct' ? 'correct' : 'wrong');

      var status = el('span', 'status ' + (r.mastered ? 'gold' : (r.last === 'correct' ? 'ok' : 'bad')));
      if (r.last === 'correct') {
        // A hinted answer deliberately keeps the streak at 0 (applyAnswer:
        // recognition is not recall), which made the generic line read
        // "✓ correct — 0/3 in a row" and look like the counter was broken.
        // It is not a streak of nought, it is a streak that did not start.
        status.textContent = r.mastered
          ? t('row.mastered')
          : r.hinted ? t('row.streakHinted')
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
        // Hearing the right answer is half the point of getting it wrong.
        var kSay = speakBtn(function () { return hintBase(it.answer) || it.answer; });
        if (kSay) k.appendChild(kSay);
        feedback.appendChild(k);
      }
      if (r.self) feedback.appendChild(el('span', 'key', t('row.selfMarked')));
      // `r.hinted` is only ever set on a correct answer, and row.streakHinted
      // above now says so in the verdict itself — a second "💡 with a hint"
      // chip beside it was the same fact twice.

      if (r.last === 'wrong') {
        // "Why?" — jump to the page that explains the rule they just missed.
        // Showing the key is half the lesson; the reference page is the rest.
        if (introPage != null) {
          var pg = introPage;
          var why = el('button', 'btn small why-btn', t('row.whyPage', { n: pg }));
          why.type = 'button';
          why.title = t('row.whyHint');
          why.addEventListener('click', function () { showPdf(pg); });
          feedback.appendChild(why);
        }
        // The book's page explains the rule in English; this explains it in
        // Kazakh, and for a reader at A2 that is the difference between a
        // reference and an answer.
        var kn = document.querySelector('.kn-slot .kk-note');
        if (kn) {
          var toNote = el('button', 'btn small why-btn', t('note.open'));
          toNote.type = 'button';
          toNote.addEventListener('click', function () {
            kn.open = true;
            kn.scrollIntoView({ block: 'nearest' });
          });
          feedback.appendChild(toNote);
        }

        var ov = el('button', 'btn small ok', t('row.override'));
        ov.addEventListener('click', function () { mark(true, true); });
        feedback.appendChild(ov);
      }
    }

    function mark(correct, self) {
      reveal = true;                 // an answer was given — feedback may show
      applyAnswer(key, correct, { val: input.value, self: self, hinted: hintLevel > 0 });
      hintLevel = 0;
      hintBox.hidden = true;
      if (hintBtn) hintBtn.textContent = t('hint.btn');
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

    var hintBtn = null;
    if (exam) {
      // Nothing beside the box. The one affordance kept is the number itself,
      // which is what a candidate looks for when jumping back to a question
      // they skipped.
      row.classList.add('exam-row');
    } else if (isManual(it)) {
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
      // Stuck is better than quitting: three steps, each one giving away a
      // little more than the last.
      if (hasHint(it)) {
        hintBtn = el('button', 'btn small hint-btn', t('hint.btn'));
        hintBtn.title = t('hint.title');
        hintBtn.addEventListener('click', showHint);
        line.appendChild(hintBtn);
      }
    }

    input.addEventListener('input', function () {
      if (exam) { exam.answers[key] = input.value; save(); return; }
      ensure(key).val = input.value;
      save();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (!exam) check();
      focusNext(input);
    });

    rbody.appendChild(line);
    rbody.appendChild(hintBox);
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

  // The answer-key page for the unit being rendered, set by renderUnit so each
  // exercise's key button opens that unit's answers (not the book's first page).
  var akUnitPage = null;

  // A unit's reference/theory page — the left half of a grammar spread, the page
  // that explains the rule. Powers the "Why?" button on a wrong answer. null when
  // the book ships no PDF or the unit has no intro page (most vocab/IELTS keys).
  // Deliberately a function of the unit rather than a variable set by renderUnit:
  // the Mistakes page renders rows from many units at once, and it must be able
  // to ask this per unit.
  function unitIntroPage(u) {
    return (u && book.meta && book.meta.pdf && u.pdfIntroPage != null) ? u.pdfIntroPage : null;
  }

  // "📗 Answer key" — opens this unit's printed key in the PDF pane. null when
  // the book has no machine-locatable key (IELTS 19/20) or no PDF.
  function answerKeyBtn() {
    var akPage = akUnitPage;
    if (akPage == null || !(book.meta && book.meta.pdf)) return null;
    var b = el('button', 'btn small key-btn');
    b.type = 'button';
    b.title = t('unit.answerKeyHint');
    b.appendChild(document.createTextNode('📗 ' + t('unit.answerKey')));
    b.addEventListener('click', function () { showPdf(akPage); });
    return b;
  }

  // `exam` — a live run from startExam(). Passed down rather than read from a
  // module variable because the result screen re-renders the same exercises
  // with the run finished, and the two must not be able to disagree.
  function buildSub(unitNo, sub, introPage, exam) {
    var box = el('div', 'sub');

    var head = el('div', 'sub-head');
    head.appendChild(el('span', 'sub-num', sub.number));
    // The IELTS books name the task the exam calls it — "TRUE / FALSE / NOT
    // GIVEN" rather than the engine's own "exercise".
    head.appendChild(el('span', 'type-tag', t('type.' + (sub.kind || sub.type))));
    box.appendChild(head);

    if (sub.instructions) box.appendChild(el('div', 'instructions', sub.instructions));

    // the heading printed above a note or table, e.g. "Reclaiming urban rivers"
    if (sub.title) box.appendChild(el('div', 'sub-title', sub.title));

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
      // The reveal text is the extracted (sometimes OCR-mangled) key; the real
      // page in the PDF is the source of truth for an unclear answer.
      var fk = answerKeyBtn();
      if (fk) acts.appendChild(fk);
      box.appendChild(acts);
      box.appendChild(ansBox);
      return box;
    }

    if (sub.type === 'crossword') {
      box.appendChild(el('div', 'note', t('sub.crossword') + (sub.note ? ' ' + sub.note : '')));
      var cwKey = answerKeyBtn();
      if (cwKey) { var cwActs = el('div', 'sub-actions'); cwActs.appendChild(cwKey); box.appendChild(cwActs); }
      return box;
    }

    if (sub.note) box.appendChild(el('div', 'note', sub.note));

    var items = sub.items || [];
    if (!items.length) {
      box.appendChild(el('div', 'note', t('sub.doInPdf')));
      var emptyKey = answerKeyBtn();
      if (emptyKey) { var emptyActs = el('div', 'sub-actions'); emptyActs.appendChild(emptyKey); box.appendChild(emptyActs); }
      return box;
    }

    var hasCheckable = false, hasManual = false, notedWhy = {};
    items.forEach(function (it) {
      var why = isManual(it) ? (it.selfWhy || 'open') : null;
      var first = why != null && !notedWhy[why];
      if (why != null) notedWhy[why] = 1;
      box.appendChild(buildRow(unitNo, sub, it, { introPage: introPage, selfNote: first, exam: exam }));
      if (isAuto(it)) hasCheckable = true;
      else if (isManual(it)) hasManual = true;
    });

    // Under exam conditions there is nothing to press: no per-exercise check,
    // no printed key one click away. The only button on the page is "finish".
    if (exam) return box;

    var actions = el('div', 'sub-actions');
    if (hasCheckable) {
      var btn = el('button', 'btn small', t('sub.checkExercise'));
      btn.addEventListener('click', function () { checkAllIn(box); });
      actions.appendChild(btn);
    }

    // Whenever the exercise holds any item the app can't grade — an open/personal
    // answer, or a key that didn't survive extraction — offer that exercise's
    // printed key in the PDF pane. This now covers mixed exercises too (only some
    // rows self-check), so a "self-check" or wrong-looking answer can be verified
    // against the book page. Purely auto-gradable exercises are left out: their
    // key sits one Check away already and would only tempt cheating.
    if (hasManual) {
      var kb = answerKeyBtn();
      if (kb) actions.appendChild(kb);
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
  function pdfUrl(page, meta) {
    var m = meta || (book && book.meta);
    var pdf = m && m.pdf;
    if (!pdf) return null;
    if (m.pdfWholeFileOnly || page == null) return pdf;
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

  /* The open/close-the-book chip. Shut, it is the one thing the page wants the
     reader to press, so it wears the loud red CTA; open, it only means "close"
     and goes quiet. The unit page and the Writing/Speaking page share it —
     those are the same kind of page to a reader and must not look like two
     different products. Returns null when the book ships no PDF; the caller
     can re-run `chip.sync()` after it has decided the pane's opening state. */
  function pdfToggleChip(startPage) {
    if (!(book && book.meta && book.meta.pdf)) return null;
    var toggle = el('button', 'chip chip-btn');
    toggle.title = t('unit.openPdfHint');
    function sync() {
      var open = pdfOpen();
      toggle.textContent = open ? t('unit.closePdf') : t('unit.openPdf');
      toggle.classList.toggle('chip-cta', !open);
    }
    sync();
    toggle.addEventListener('click', function () {
      if (pdfOpen()) hidePdf(true); else showPdf(startPage);
      sync();
    });
    toggle.sync = sync;
    return toggle;
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

  /* ================= IELTS: audio and reading passages ================= */

  // The data files store audio as site-relative paths ("audio/c20/t1p1.m4a").
  // The folder is ~490 MB and is deliberately not in the repository, so a
  // deployed copy usually serves it from object storage instead: AUDIO_BASE
  // (audio.config.js) is prefixed here, in the one place a path becomes a URL.
  // Empty base — a local checkout, or a deploy that does ship the folder —
  // leaves the path exactly as the data file wrote it.
  var AUDIO_BASE = String(window.AUDIO_BASE || '').replace(/\/+$/, '');

  function audioUrl(path) {
    var p = String(path == null ? '' : path);
    // A data file may name an absolute URL of its own; that always wins.
    if (!p || !AUDIO_BASE || /^(https?:)?\/\//i.test(p)) return p;
    return AUDIO_BASE + '/' + p.replace(/^\.?\//, '');
  }

  // A track that 404s (audio not deployed, or a wrong AUDIO_BASE) makes <audio>
  // fail silently — a player that simply does nothing when pressed. Both
  // builders below route through this so the reader is told instead.
  function audioFallback(audio, box, note) {
    audio.addEventListener('error', function () {
      if (box.querySelector('.' + note)) return;
      box.appendChild(el('div', 'note ' + note, t('ielts.noAudio')));
    });
  }

  /* The recording for one Listening part, shown directly above that part's
     questions. A part is sometimes cut into two files, so the player takes a
     list and moves to the next when one ends — otherwise the reader would have
     to press play again mid-question. */
  function buildAudio(p, exam) {
    var box = el('div', 'ielts-audio');
    var head = el('div', 'ia-head');
    head.appendChild(el('span', 'ia-label', t('ielts.audio')));
    head.appendChild(el('b', null, t('ielts.part', { n: p.part })));
    head.appendChild(el('span', 'muted', t('ielts.questions', { a: p.from, b: p.to })));
    box.appendChild(head);

    if (!p.files || !p.files.length) {
      box.appendChild(el('div', 'note', t('ielts.noAudio')));
      return box;
    }

    var at = 0;
    var audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'none';
    audio.src = audioUrl(p.files[0]);
    audio.addEventListener('ended', function () {
      if (at + 1 >= p.files.length) return;
      at++;
      audio.src = audioUrl(p.files[at]);
      audio.play().catch(function () { /* autoplay blocked — reader presses play */ });
    });
    box.appendChild(audio);
    audioFallback(audio, box, 'audio-missing');

    // Under exam conditions the player is bare. Slowing the recording down,
    // rewinding it and — above all — reading the transcript are practice
    // tools; in a test they would be cheating, and the real exam plays each
    // recording once at one speed.
    if (exam) return box;

    // The two controls a listener actually reaches for and <audio> does not
    // offer: go back five seconds, and slow the speaker down. Both matter more
    // than anything else on this page for somebody working at B1.
    var tools = el('div', 'ia-tools');
    var back = el('button', 'btn small ghost', '↺ 5s');
    back.title = t('ielts.back5');
    back.addEventListener('click', function () {
      audio.currentTime = Math.max(0, audio.currentTime - 5);
    });
    tools.appendChild(back);
    [0.75, 1, 1.25].forEach(function (rate) {
      var b = el('button', 'btn small ghost speed' + (rate === 1 ? ' on' : ''), rate + '×');
      b.addEventListener('click', function () {
        audio.playbackRate = rate;
        [].forEach.call(tools.querySelectorAll('.speed'), function (o) {
          o.classList.toggle('on', o === b);
        });
      });
      tools.appendChild(b);
    });

    // The transcript, where the book prints one. Two things live behind this
    // button: reading along while listening, and a dictation over the same
    // text — the exercise the recording was always capable of and the site
    // never offered.
    if (p.script && p.script.length) {
      var panel = el('div', 'dict-panel');
      panel.hidden = true;
      var open = el('button', 'btn small', '✍ ' + t('dict.open'));
      open.addEventListener('click', function () {
        panel.hidden = !panel.hidden;
        open.textContent = (panel.hidden ? '✍ ' : '✕ ') +
          t(panel.hidden ? 'dict.open' : 'dict.close');
        if (!panel.hidden && !panel.firstChild) buildDictation(panel, p, audio);
      });
      tools.appendChild(open);
      box.appendChild(tools);
      box.appendChild(panel);
      return box;
    }
    box.appendChild(tools);
    return box;
  }

  /* ================= dictation ================= */

  /* An IELTS recording plus its transcript is a dictation exercise waiting to
     happen, and the site was sitting on both. The one thing it does not have is
     an alignment between them — no timestamps, so no way to play sentence four
     on its own. The exercise is therefore built the way a classroom does it
     without editing software: the reader runs the recording themselves (with
     the ↺5s and 0.75× controls above), and fills the gaps in the running
     transcript as they hear them.

     The transcript is cut into blocks of a few sentences so that a fifty-
     sentence part is a series of finishable pieces rather than a wall, and
     every block remembers its best score. */

  var DICT_BLOCK = 6;           // sentences per block
  var DICT_EVERY = 3;           // one gap per this many content words

  // Words never blanked: gapping "the" teaches nothing and reads as noise.
  var DICT_STOP = ('a an and are as at be been but by can could did do does for from '
    + 'had has have he her him his i if in is it its me my no not of on or our out she '
    + 'so than that the their them then there they this to too up was we were what when '
    + 'which who will with would you your').split(' ');

  function dictStop(w) { return DICT_STOP.indexOf(w.toLowerCase()) > -1; }

  // A word as typed against a word as printed: case, punctuation and the
  // curly/straight apostrophe are not what is being tested here.
  function dictNorm(s) {
    return String(s || '').toLowerCase().replace(/[’']/g, "'")
      .replace(/[^a-z0-9'£$%]/g, '');
  }

  function dictKey(p, block) {
    return book.id + '|d' + currentUnit + '|' + p.part + '|' + block;
  }

  function buildDictation(panel, p, audio) {
    var script = p.script || [];
    var blocks = [];
    for (var i = 0; i < script.length; i += DICT_BLOCK) {
      blocks.push(script.slice(i, i + DICT_BLOCK));
    }

    var head = el('div', 'dict-head');
    head.appendChild(el('span', 'muted', t('dict.intro')));
    var readBtn = el('button', 'btn small ghost', t('dict.read'));
    var reading = false;
    head.appendChild(readBtn);
    panel.appendChild(head);

    var body = el('div', 'dict-body');
    panel.appendChild(body);

    // "Read" is the same text with nothing hidden: following a transcript while
    // the recording plays is its own exercise, and the one a reader wants
    // straight after answering the questions.
    readBtn.addEventListener('click', function () {
      reading = !reading;
      readBtn.textContent = t(reading ? 'dict.hideRead' : 'dict.read');
      draw();
    });

    var at = 0;                                   // which block is open
    function draw() {
      clear(body);
      if (reading) {
        var full = el('div', 'dict-script');
        script.forEach(function (s) { full.appendChild(el('p', null, s)); });
        body.appendChild(full);
        return;
      }
      body.appendChild(blockNav());
      body.appendChild(buildDictBlock(p, blocks[at], at, audio));
    }

    function blockNav() {
      var nav = el('div', 'dict-nav');
      blocks.forEach(function (_, i) {
        var r = state.dictation && state.dictation[dictKey(p, i)];
        var b = el('button', 'dict-tab' + (i === at ? ' on' : '') +
          (r && r.ok === r.total ? ' done' : (r ? ' part' : '')), String(i + 1));
        b.title = r ? t('dict.tabScore', { a: r.ok, b: r.total }) : '';
        b.addEventListener('click', function () { at = i; draw(); });
        nav.appendChild(b);
      });
      return nav;
    }

    draw();
  }

  function buildDictBlock(p, sentences, index, audio) {
    var box = el('div', 'dict-block');
    var inputs = [];
    var eligible = 0;

    sentences.forEach(function (sentence) {
      var line = el('p', 'dict-line');
      // Split keeping the separators, so punctuation and spacing come back
      // exactly as printed once the gaps are filled in.
      var bits = String(sentence).split(/(\s+)/);
      bits.forEach(function (bit) {
        if (!bit.trim()) { line.appendChild(document.createTextNode(bit)); return; }
        var core = bit.replace(/^[^A-Za-z0-9£$]+|[^A-Za-z0-9%']+$/g, '');
        var gapworthy = core.length > 2 && !dictStop(core) && /[a-z]/i.test(core);
        if (gapworthy) eligible++;
        if (!gapworthy || eligible % DICT_EVERY !== 0) {
          line.appendChild(document.createTextNode(bit));
          return;
        }
        var lead = bit.slice(0, bit.indexOf(core));
        var tail = bit.slice(bit.indexOf(core) + core.length);
        if (lead) line.appendChild(document.createTextNode(lead));
        var input = answerInput(t('dict.gapAria'));
        input.className = 'dict-gap';
        input.size = Math.max(4, core.length);
        input.setAttribute('data-word', core);
        input.addEventListener('keydown', function (e) {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          var i = inputs.indexOf(input);
          if (i > -1 && i + 1 < inputs.length) inputs[i + 1].focus();
        });
        inputs.push(input);
        line.appendChild(input);
        if (tail) line.appendChild(document.createTextNode(tail));
      });
      box.appendChild(line);
    });

    var foot = el('div', 'dict-foot');
    var score = el('span', 'dict-score');
    var check = el('button', 'btn small primary', t('dict.check'));
    check.addEventListener('click', function () {
      var ok = 0;
      inputs.forEach(function (input) {
        var right = dictNorm(input.value) === dictNorm(input.getAttribute('data-word'));
        input.classList.toggle('ok', right);
        input.classList.toggle('bad', !right);
        if (right) { ok++; return; }
        // Show what was said rather than only that it was wrong: a dictation
        // the reader cannot correct themselves teaches nothing.
        if (!input.nextSibling || !input.nextSibling.classList ||
            !input.nextSibling.classList.contains('dict-was')) {
          var was = el('span', 'dict-was', input.getAttribute('data-word'));
          input.parentNode.insertBefore(was, input.nextSibling);
        }
      });
      score.textContent = t('dict.score', { a: ok, b: inputs.length });
      state.dictation = state.dictation || {};
      var key = dictKey(p, index);
      var prev = state.dictation[key];
      if (!prev || prev.ok < ok) state.dictation[key] = { ok: ok, total: inputs.length, ts: Date.now() };
      save();
      if (window.SYNC) SYNC.touch(key);
    });
    var again = el('button', 'btn small ghost', t('dict.reset'));
    again.addEventListener('click', function () {
      inputs.forEach(function (input) {
        input.value = '';
        input.classList.remove('ok', 'bad');
        var next = input.nextSibling;
        if (next && next.classList && next.classList.contains('dict-was')) {
          input.parentNode.removeChild(next);
        }
      });
      score.textContent = '';
    });
    var play = el('button', 'btn small ghost', '▶ ' + t('dict.play'));
    play.addEventListener('click', function () {
      if (audio.paused) audio.play().catch(function () { /* blocked */ });
      else audio.pause();
    });
    foot.appendChild(play);
    foot.appendChild(check);
    foot.appendChild(again);
    foot.appendChild(score);
    box.appendChild(foot);
    return box;
  }

  /* One Reading passage, above the questions asked about it. Collapsible: it
     is long, and once it has been read the reader wants the boxes, not to
     scroll past the whole text again. */
  function buildPassage(p) {
    var wrap = el('details', 'ip');
    wrap.open = true;
    var sum = el('summary', 'ip-head');
    sum.appendChild(el('span', 'ip-num', t('ielts.passage', { n: p.passage })));
    sum.appendChild(el('b', 'ip-title', p.title || ''));
    sum.appendChild(el('span', 'muted', t('ielts.questions', { a: p.from, b: p.to })));
    wrap.appendChild(sum);
    var body = el('div', 'ip-body');
    if (p.subtitle) body.appendChild(el('p', 'ip-sub', p.subtitle));
    (p.text || []).forEach(function (para) { body.appendChild(el('p', null, para)); });
    wrap.appendChild(body);
    return wrap;
  }

  /* ================= Kazakh explanations ================= */

  /* The one thing the books cannot give a Kazakh learner: the rule explained in
     their own language, and against their own language. English Grammar in Use
     explains English in English, which is exactly the wall somebody at A2 hits.

     These notes are not a translation of the book — translating it would be
     both illegal and useless. They are short, written here, and only for the
     units where Kazakh and English actually pull apart: there is no article in
     Kazakh, no perfect/past split, and no phrasal verb. A unit where nothing
     interferes gets no note and the page looks exactly as it did.

     One file per book, loaded once, and a book with no file simply has none —
     which is every book but `grammar` today. */

  var notes = {};                // bookId -> {unit -> note} | false when absent
  var notesPending = {};

  function loadNotes(bookId, done) {
    if (notes[bookId] !== undefined) { done(); return; }
    // index.json says which books have a notes file (index_json.py stamps it
    // from what is on disk). Without this the other twelve books each fired a
    // request that could only 404 — one wasted round trip per book opened, and
    // a network tab that looks like something is broken. If the index has not
    // landed yet, fall through and ask: a 404 is still handled below, and the
    // notes are worth more than the request.
    if (INDEX[bookId] && !INDEX[bookId].notes) { notes[bookId] = false; done(); return; }
    if (notesPending[bookId]) return;
    notesPending[bookId] = true;
    fetch('data/notes/' + bookId + '.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (d) {
        notes[bookId] = (d && d.notes) || false;
        delete notesPending[bookId];
        done();
      });
  }

  function noteFor(bookId, unitNo) {
    var byUnit = notes[bookId];
    return byUnit ? (byUnit[String(unitNo)] || null) : null;
  }

  // Open the first time and folded away afterwards: a reader who has already
  // worked this unit wants the exercises, not the lecture again.
  function buildNote(note, startOpen) {
    var box = el('details', 'kk-note');
    box.open = !!startOpen;
    var sum = el('summary', 'kn-head');
    sum.appendChild(el('span', 'kn-tag', t('note.tag')));
    sum.appendChild(el('b', null, note.title || ''));
    box.appendChild(sum);

    var body = el('div', 'kn-body');
    if (note.why) body.appendChild(el('p', 'kn-why', note.why));
    (note.body || []).forEach(function (p) { body.appendChild(el('p', null, p)); });

    if (note.examples && note.examples.length) {
      var ex = el('div', 'kn-ex');
      note.examples.forEach(function (pair) {
        var line = el('div', 'kn-ex-line');
        var en = el('b', null, pair[0] || '');
        line.appendChild(en);
        var say = speakBtn(function () { return pair[0] || ''; });
        if (say) line.appendChild(say);
        line.appendChild(el('span', 'kn-kk', pair[1] || ''));
        ex.appendChild(line);
      });
      body.appendChild(ex);
    }

    if (note.watch && note.watch.length) {
      var w = el('div', 'kn-watch');
      w.appendChild(el('span', 'kn-watch-h', t('note.watch')));
      var ul = el('ul');
      note.watch.forEach(function (x) { ul.appendChild(el('li', null, x)); });
      w.appendChild(ul);
      body.appendChild(w);
    }
    box.appendChild(body);
    return box;
  }

  /* ================= IELTS: exam conditions ================= */

  /* Everything above this line grades an answer the moment it is typed, which
     is the right thing for practice and the wrong thing for a mock exam: a
     candidate who learns after question 3 that they were wrong has not sat a
     test. Exam mode is the same exercises with the feedback taken away and a
     clock added — answers are collected, and all forty are graded in one pass
     when the time is up or "finish" is pressed.

     The run is kept in `state.exam` rather than in a module variable so that a
     reload in the fortieth minute of a Reading test does not throw the paper
     away. It is exactly one run: sitting two sections at once is not a thing
     anybody does, and one slot means "is there an exam going on?" is a question
     with a single answer everywhere in the app. */

  var examTick = null;            // countdown interval, cleared on leaving
  var examShowResult = null;      // 'book|unit' whose result screen to draw next

  function examKey(bookId, unitNo) { return bookId + '|' + unitNo; }

  // Every gradable row of a test section, printed order. The exam is scored
  // over these and nothing else, so what counts here is what `tracked` means
  // everywhere else in the app.
  function examRows(u) {
    var out = [];
    (u.subExercises || []).forEach(function (sub) {
      (sub.items || []).forEach(function (it) {
        if (!isTracked(sub, it)) return;
        out.push({ sub: sub, it: it, key: keyOf(book.id, u.unit, sub.number, itemKey(it)) });
      });
    });
    return out;
  }

  // The live run for this unit, or null. A run left behind on another section
  // is not this section's business — it stays in the store and its own page
  // picks it up.
  function liveExam(u) {
    var e = state.exam;
    if (!e || e.book !== book.id || e.unit !== u.unit) return null;
    return e;
  }

  function examLeft(e) { return Math.max(0, Math.round((e.ends - Date.now()) / 1000)); }

  function stopExamTick() {
    if (examTick) { clearInterval(examTick); examTick = null; }
  }

  function startExam(u) {
    stopExamTick();
    state.exam = {
      book: book.id,
      unit: u.unit,
      skill: u.skill,
      start: Date.now(),
      ends: Date.now() + EXAM.limitFor(u.skill) * 1000,
      answers: {}
    };
    flush();                       // a clock that has started must survive a reload
    examShowResult = null;
    renderExam(u.unit);
  }

  // Grade the paper. Every answer given is put through the same matcher the
  // practice rows use and recorded through applyAnswer, so an exam counts
  // towards progress, mistakes, streaks and the review ladder exactly like any
  // other answering — a mock test is not a separate universe. Blanks are
  // recorded as wrong, because in the exam they are.
  function finishExam(u, timedOut) {
    var e = liveExam(u);
    if (!e) return;
    stopExamTick();
    var rows = examRows(u);
    var raw = 0, unanswered = 0;
    rows.forEach(function (r) {
      var val = e.answers[r.key] || '';
      var given = !!val.trim();
      if (!given) unanswered++;
      var ok = given && isAuto(r.it) && isMatch(val, r.it);
      if (ok) raw++;
      // A self-check row cannot be graded by machine; it is left out of the raw
      // score below and the reader is pointed at it on the result screen.
      if (isAuto(r.it)) applyAnswer(r.key, ok, { val: val, exam: true });
    });

    var res = {
      ts: e.start,
      end: Date.now(),
      raw: raw,
      total: rows.length,
      unanswered: unanswered,
      secs: Math.round((Date.now() - e.start) / 1000),
      skill: e.skill,
      timedOut: !!timedOut
    };
    var k = examKey(book.id, u.unit);
    state.exams[k] = (state.exams[k] || []).concat([res]);
    state.exam = null;
    flush();
    if (window.SYNC) SYNC.touch(k);      // the meta row carries exam history
    examShowResult = k;
    bookChanged(book);
    renderSidebar();
    refreshBadge();
    renderExam(u.unit);
  }

  function abandonExam(u) {
    stopExamTick();
    state.exam = null;
    flush();
    renderExam(u.unit);
  }

  // "32/40 · шамамен 7.0" — the line that is the whole point of the feature.
  // The estimate is always labelled: see the note in exam.js about why this
  // number is not a band Cambridge would recognise as official.
  function bandLine(skill, raw) {
    var b = EXAM.bandFor(skill, raw);
    return b == null ? null : t('exam.bandApprox', { b: b.toFixed(1) });
  }

  function renderExam(no) {
    var u = null;
    for (var i = 0; i < book.units.length; i++) {
      if (book.units[i].unit === no) { u = book.units[i]; break; }
    }
    // No unit by that number is a 404; a unit that exists in a book with no
    // exam mode is not — say which.
    if (!u) { renderNotFound(no); return; }
    if (!EXAM.isExamUnit(book.meta, u)) { renderNotFound(no, 'exam'); return; }
    currentUnit = no;
    state.last = { book: book.id, unit: no };
    save();
    setTab('units');
    stopExamTick();
    clear(main);

    var e = liveExam(u);
    if (e) { renderExamPaper(u, e); return; }
    var k = examKey(book.id, u.unit);
    if (examShowResult === k) {
      var runs = state.exams[k] || [];
      examShowResult = null;
      if (runs.length) { renderExamResult(u, runs[runs.length - 1]); return; }
    }
    renderExamDesk(u);
  }

  // The page before the paper: what is about to happen, and what it costs.
  function renderExamDesk(u) {
    var head = el('div', 'page-head');
    head.appendChild(el('h1', null, t('exam.h1', { t: unitTitle(u) })));
    main.appendChild(head);

    var card = el('div', 'exam-card');
    card.appendChild(el('p', null, t('exam.intro')));
    var ul = el('ul', 'exam-rules');
    [
      t('exam.rule.time', { m: Math.round(EXAM.limitFor(u.skill) / 60) }),
      t('exam.rule.noCheck'),
      t('exam.rule.count', { n: examRows(u).length }),
      u.skill === 'listening' ? t('exam.rule.audio') : t('exam.rule.pdf')
    ].forEach(function (s) { ul.appendChild(el('li', null, s)); });
    card.appendChild(ul);

    var go = el('button', 'btn primary big', t('exam.start'));
    go.addEventListener('click', function () { startExam(u); });
    card.appendChild(go);

    var back = el('a', 'btn ghost', t('exam.backToPractice'));
    back.href = '#/b/' + book.id + '/unit/' + u.unit;
    card.appendChild(back);
    main.appendChild(card);

    var hist = examHistory(u);
    if (hist) main.appendChild(hist);
  }

  // Past runs of this section, newest first. Two attempts at the same test say
  // more about a candidate than one, so this is a table rather than a "best".
  function examHistory(u) {
    var runs = (state.exams[examKey(book.id, u.unit)] || []).slice().reverse();
    if (!runs.length) return null;
    var box = el('div', 'exam-hist');
    box.appendChild(el('h2', null, t('exam.past')));
    var tbl = el('table', 'exam-table');
    var thead = el('thead');
    var hr = el('tr');
    [t('exam.th.when'), t('exam.th.score'), t('exam.th.band'), t('exam.th.time')].forEach(function (h) {
      hr.appendChild(el('th', null, h));
    });
    thead.appendChild(hr);
    tbl.appendChild(thead);
    var tb = el('tbody');
    runs.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', null, authDate(new Date(r.ts).toISOString())));
      tr.appendChild(el('td', 'num', r.raw + '/' + r.total));
      var b = EXAM.bandFor(r.skill, r.raw);
      tr.appendChild(el('td', 'num band', b == null ? '—' : b.toFixed(1)));
      tr.appendChild(el('td', 'num', EXAM.clock(r.secs)));
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    box.appendChild(tbl);
    return box;
  }

  // The paper itself: a clock, the exercises with nothing to press, and one
  // button that ends it.
  function renderExamPaper(u, e) {
    var bar = el('div', 'exam-bar');
    bar.appendChild(el('span', 'eb-title', unitTitle(u)));
    var clockEl = el('b', 'eb-clock');
    bar.appendChild(clockEl);
    var doneBtn = el('button', 'btn small primary', t('exam.finish'));
    doneBtn.addEventListener('click', function () {
      ASK.confirm(t('exam.confirmFinish'), { title: t('exam.finish'), yes: t('exam.finish') })
        .then(function (ok) { if (ok) finishExam(u, false); });
    });
    bar.appendChild(doneBtn);
    var quit = el('button', 'btn small ghost', t('exam.abandon'));
    quit.addEventListener('click', function () {
      ASK.confirm(t('exam.confirmAbandon'),
        { title: t('exam.abandon'), yes: t('exam.abandon'), danger: true })
        .then(function (ok) { if (ok) abandonExam(u); });
    });
    bar.appendChild(quit);
    main.appendChild(bar);

    // The book stays available: an IELTS section here is an answer sheet, and
    // the questions are in the PDF. Nothing about exam conditions changes that.
    if (book.meta && book.meta.pdf && !isNarrow()) showPdf(u.pdfExercisePage);

    (u.subExercises || []).forEach(function (sub) {
      if (sub.audio) main.appendChild(buildAudio(sub.audio, true));
      if (sub.reading) main.appendChild(buildPassage(sub.reading));
      main.appendChild(buildSub(u.unit, sub, null, e));
    });

    var foot = el('div', 'unit-foot');
    var endBtn = el('button', 'btn primary big', t('exam.finish'));
    endBtn.addEventListener('click', function () {
      ASK.confirm(t('exam.confirmFinish'), { title: t('exam.finish'), yes: t('exam.finish') })
        .then(function (ok) { if (ok) finishExam(u, false); });
    });
    foot.appendChild(endBtn);
    main.appendChild(foot);

    function paintClock() {
      var left = examLeft(e);
      clockEl.textContent = EXAM.clock(left);
      bar.classList.toggle('low', left <= 300);       // last five minutes
      if (left <= 0) finishExam(u, true);             // hand the paper in
    }
    paintClock();
    examTick = setInterval(paintClock, 1000);
    afterChange = function () {};
  }

  function renderExamResult(u, r) {
    var head = el('div', 'page-head');
    head.appendChild(el('h1', null, t('exam.resultH', { t: unitTitle(u) })));
    main.appendChild(head);

    var card = el('div', 'exam-result');
    var score = el('div', 'er-score');
    score.appendChild(el('b', 'er-raw', r.raw + '/' + r.total));
    var band = EXAM.bandFor(r.skill, r.raw);
    if (band != null) {
      score.appendChild(el('span', 'er-band', band.toFixed(1)));
      score.appendChild(el('span', 'er-bandlab', t('exam.bandLabel')));
    }
    card.appendChild(score);
    card.appendChild(el('div', 'muted er-note', t('exam.bandNote')));

    var meta = el('div', 'er-meta');
    meta.appendChild(el('span', null, t('exam.took', { time: EXAM.clock(r.secs) })));
    if (r.unanswered) meta.appendChild(el('span', null, t('exam.blank', { n: r.unanswered })));
    if (r.timedOut) meta.appendChild(el('span', 'bad', t('exam.timedOut')));
    card.appendChild(meta);

    // Cambridge's own verdict for this very test, where the book prints one.
    var verdict = EXAM.chartFor(book.id, EXAM.testOf(u), r.skill, r.raw);
    if (verdict) {
      var v = el('div', 'er-chart ' + verdict);
      v.appendChild(el('span', 'erc-label', t('exam.chartLabel')));
      v.appendChild(document.createTextNode(t('exam.chart.' + verdict)));
      card.appendChild(v);
    }
    main.appendChild(card);

    // Where the marks went. A Listening part or a Reading passage is the unit a
    // candidate can actually act on ("part 4 again"), so the breakdown is by
    // the group the book prints, not by question type.
    var parts = examBreakdown(u, r);
    if (parts) main.appendChild(parts);

    var acts = el('div', 'exam-actions');
    var see = el('a', 'btn primary', t('exam.seeAnswers'));
    see.href = '#/b/' + book.id + '/unit/' + u.unit;
    acts.appendChild(see);
    var again = el('button', 'btn', t('exam.again'));
    again.addEventListener('click', function () { startExam(u); });
    acts.appendChild(again);
    main.appendChild(acts);

    var hist = examHistory(u);
    if (hist) main.appendChild(hist);
  }

  // Correct-per-group, read back out of the answer records the grading pass
  // just wrote — the run stores a score, not forty verdicts, and re-deriving
  // them here keeps the stored history small.
  function examBreakdown(u, r) {
    var rows = examRows(u);
    if (!rows.length) return null;
    var groups = [], byNum = {};
    rows.forEach(function (row) {
      var label = row.sub.instructions || (t('type.' + (row.sub.kind || row.sub.type)));
      var g = byNum[row.sub.number];
      if (!g) {
        g = byNum[row.sub.number] = { label: label, num: row.sub.number, ok: 0, n: 0 };
        groups.push(g);
      }
      g.n++;
      var rec0 = rec(row.key);
      if (rec0 && rec0.last === 'correct') g.ok++;
    });
    var box = el('div', 'exam-parts');
    box.appendChild(el('h2', null, t('exam.byPart')));
    groups.forEach(function (g) {
      var line = el('div', 'ep-row');
      line.appendChild(el('span', 'ep-num', g.num));
      line.appendChild(el('span', 'ep-label', g.label));
      var barBox = el('div', 'ep-bar');
      var fill = el('i');
      fill.style.width = (g.n ? Math.round(g.ok / g.n * 100) : 0) + '%';
      barBox.appendChild(fill);
      line.appendChild(barBox);
      line.appendChild(el('span', 'ep-score', g.ok + '/' + g.n));
      box.appendChild(line);
    });
    return box;
  }

  /* ================= IELTS: Writing and Speaking ================= */

  /* The half of the exam nothing could grade, and which therefore sat in the
     data file unread: `prompts` — two Writing tasks and three Speaking parts
     per test. A machine cannot mark an essay, but almost everything else about
     practising one can be provided: the task in front of the reader, the clock
     the real exam runs, the word count that decides whether the answer is even
     eligible, a draft that survives closing the tab, and — for Speaking — the
     recording, so a candidate can hear what an examiner would hear.

     What is deliberately NOT here is a score. Inventing a Writing band from a
     word count would be worse than saying nothing; the page gives the criteria
     the examiner uses and leaves the judgement where it belongs. */

  // Minutes and minimum words, as the exam sets them.
  var WRITE_SPEC = { 1: { min: 20, words: 150 }, 2: { min: 40, words: 250 } };
  // Speaking: preparation and talking time. Only Part 2 (the long turn) is
  // clocked in the real test; parts 1 and 3 are a conversation.
  var SPEAK_SPEC = { 2: { prep: 60, talk: 120 } };

  function writeKey(bookId, test, part) { return bookId + '|w' + test + '|' + part; }

  function draft(key) {
    state.writing = state.writing || {};
    return state.writing[key] || null;
  }

  function saveDraft(key, text, secs) {
    state.writing = state.writing || {};
    var d = state.writing[key] || {};
    d.text = text;
    if (secs != null) d.secs = secs;
    d.ts = Date.now();
    state.writing[key] = d;
    save();
    if (window.SYNC) SYNC.touch(key);
  }

  function wordCount(s) {
    var m = String(s || '').trim();
    if (!m) return 0;
    return m.split(/\s+/).length;
  }

  function bookPrompts(test) {
    return (book.prompts || []).filter(function (p) { return Number(p.test) === Number(test); });
  }

  function promptTests() {
    var seen = {}, out = [];
    (book.prompts || []).forEach(function (p) {
      var n = Number(p.test);
      if (!seen[n]) { seen[n] = 1; out.push(n); }
    });
    out.sort(function (a, b) { return a - b; });
    return out;
  }

  function hasTasks() { return !!(book && book.prompts && book.prompts.length); }

  function renderTasks(testNo, only) {
    var tests = promptTests();
    // Writing and Speaking exist only in a book that ships prompts — today
    // just ielts-21. Elsewhere this route is not a missing unit, it is a
    // feature the book does not have.
    if (!tests.length) { renderNotFound(testNo || 1, 'tasks'); return; }
    var test = tests.indexOf(Number(testNo)) > -1 ? Number(testNo) : tests[0];
    currentUnit = null;
    currentTask = only ? only + test : null;
    setTab('units');
    clear(main);
    afterChange = function () {};

    var list = bookPrompts(test);
    var byPart = function (a, b) { return Number(a.part) - Number(b.part); };
    var writing = list.filter(function (p) { return p.skill === 'writing'; }).sort(byPart);
    var speaking = list.filter(function (p) { return p.skill === 'speaking'; }).sort(byPart);
    // What this page is showing. W1 and S1 are separate entries in the rail and
    // separate pages; everything below reads from `shown`, so nothing on a
    // Speaking page can be decided by a Writing task that is not on it.
    var shown = only === 'w' ? writing : (only === 's' ? speaking : writing.concat(speaking));

    /* The head a unit page has: the title of the section, the page it is on in
       the book, the button that opens the book, and — on Writing — the same
       "⏱ Емтихан режимі" chip a Listening page carries. L1 and W1 are the same
       kind of page to a reader and now look it. What still differs is what a
       page can honestly offer: no score anywhere here, so no progress bar, and
       no exam mode on Speaking, which is an interview rather than a paper.

       The chip across to the other skill is gone. W1 and S1 are their own
       entries in the rail, one click away on every page of the book, and a
       "switch to Speaking" button in the head only made the two pages look like
       two halves of one thing the reader has to toggle between. */
    var head = el('div', 'page-head');
    head.appendChild(el('h1', null, t(
      only === 'w' ? 'task.writingUnit' : (only === 's' ? 'task.speakingUnit' : 'task.h1'),
      { n: test })));

    // The page the shown half of the test starts on — a Speaking page must open
    // the book at the Speaking card, not at whatever Writing came before it.
    var firstPage = null;
    for (var pi = 0; pi < shown.length; pi++) {
      if (shown[pi].pdfPage != null) { firstPage = Number(shown[pi].pdfPage); break; }
    }

    var chips = el('div', 'chips');
    if (firstPage != null) {
      chips.appendChild(pageChip('📄 ' + t('task.inBook'), String(firstPage), firstPage));
    }
    var toggle = pdfToggleChip(firstPage);
    if (toggle) chips.appendChild(toggle);
    // The Writing paper can be sat, the same way a Listening section can. Only
    // on the Writing page: on the page that carries both skills the chip would
    // have to mean "sit half of what is below you", which is not a thing.
    if (only === 'w' && EXAM.isExamTask(book.meta, 'writing', writing)) {
      var xc = el('a', 'chip chip-btn exam-chip', '⏱ ' + t('exam.chip'));
      xc.href = '#/b/' + book.id + '/tasks/' + test + '/w/exam';
      xc.title = t('exam.chipHint', { m: Math.round(EXAM.limitFor('writing') / 60) });
      chips.appendChild(xc);
    }
    head.appendChild(chips);
    head.appendChild(el('div', 'instructions', t('task.intro')));

    // A paper abandoned by navigating away rather than finishing: the clock is
    // still going, exactly as on a unit page.
    if (only === 'w' && liveWriteExam(test)) {
      var resume = el('div', 'exam-resume');
      resume.appendChild(document.createTextNode(t('exam.resumeNote')));
      var rlink = el('a', 'btn small primary', t('exam.resume'));
      rlink.href = '#/b/' + book.id + '/tasks/' + test + '/w/exam';
      resume.appendChild(rlink);
      head.appendChild(resume);
    }
    main.appendChild(head);

    // The Writing task IS a chart in the book — the words alone are half the
    // task — so the pane goes to its page rather than staying wherever the last
    // unit left it, on the same first-visit rule a unit page uses: never on a
    // phone, where the pane covers everything.
    if (firstPage != null && book.meta && book.meta.pdf && !isNarrow()) {
      if (state.ui.pdfOpen == null && window.innerWidth >= 1000) state.ui.pdfOpen = true;
      if (pdfOpen() || state.ui.pdfOpen) showPdf(firstPage);
      if (toggle) toggle.sync();
    }

    // With one skill on the page the h1 already names it; the band would only
    // repeat itself. It earns its place on the page that carries both.
    if (writing.length && only !== 's') {
      if (!only) main.appendChild(el('div', 'section-title', t('task.writing')));
      writing.forEach(function (p) { main.appendChild(buildWritingTask(test, p)); });
    }
    if (speaking.length && only !== 'w') {
      if (!only) main.appendChild(el('div', 'section-title', t('task.speaking')));
      speaking.forEach(function (p) { main.appendChild(buildSpeakingTask(test, p)); });
    }
    // Opened straight from a link, this page is the first thing rendered for
    // the book — and nothing else here draws the unit list, so without this the
    // whole rail is blank and the reader cannot get back to L1.
    renderSidebar();
    refreshBadge();
    window.scrollTo(0, 0);
  }

  /* Where the task is. Deliberately not the task itself: a Writing Task 1 is a
     chart, and words without the chart are a task nobody can answer; the
     Speaking cards come off the scan with the margin note spliced into them.
     The book has both, printed properly, one click away — and this page is
     for what the book cannot do: the clock, the word count, the draft that
     saves itself, the recording. Same rule the rest of these books follow. */
  function promptBody(p) {
    var box = el('div', 'task-inbook');
    box.appendChild(document.createTextNode(t('task.inBookNote')));
    var open = pdfChipFor(p);
    if (open) box.appendChild(open);
    return box;
  }

  function pdfChipFor(p) {
    if (p.pdfPage == null || !(book.meta && book.meta.pdf)) return null;
    return pageChip(t('task.inBook'), String(p.pdfPage), Number(p.pdfPage));
  }

  /* A countdown a reader starts themselves. Returns the element; the caller
     decides what the end of it means — for Writing nothing happens, because an
     essay two minutes over time is still worth finishing, and the exam's own
     "you should spend about 20 minutes" is advice rather than a bell. */
  function taskTimer(seconds, onEnd) {
    var wrap = el('div', 'task-timer');
    var left = seconds, timer = null, running = false;
    var out = el('b', 'tt-clock', EXAM.clock(left));
    var go = el('button', 'btn small', t('task.timerStart'));
    var reset = el('button', 'btn small ghost', t('task.timerReset'));

    function paint() {
      out.textContent = EXAM.clock(Math.abs(left));
      wrap.classList.toggle('over', left <= 0);
      go.textContent = running ? t('task.timerPause') : t('task.timerStart');
    }
    function stop() {
      running = false;
      if (timer) { clearInterval(timer); timer = null; }
      paint();
    }
    go.addEventListener('click', function () {
      if (running) { stop(); return; }
      running = true;
      paint();
      timer = setInterval(function () {
        left--;
        if (left <= 0) {
          left = 0;
          stop();
          wrap.classList.add('over');
          if (onEnd) onEnd();
          return;
        }
        paint();
      }, 1000);
    });
    reset.addEventListener('click', function () { stop(); left = seconds; paint(); });
    // Leaving the page must not leave an interval ticking in a dead DOM.
    taskTimers.push(stop);

    wrap.appendChild(out);
    wrap.appendChild(go);
    wrap.appendChild(reset);
    paint();
    return wrap;
  }

  var taskTimers = [];
  function stopTaskTimers() {
    taskTimers.forEach(function (fn) { try { fn(); } catch (e) { /* already gone */ } });
    taskTimers = [];
  }

  /* `exam` — this card is on the exam paper rather than the practice page.
     What changes is the same thing that changes on an exam row: the practice
     furniture goes. One clock runs the hour in the bar above, so the per-task
     countdown would be a second, contradictory clock; Clear is a button nobody
     wants within reach of an essay they are sixteen minutes into; and the
     marking criteria are for reading your answer against afterwards, so they
     wait for the result screen. The word count stays — it is printed on the
     real question paper as a rule, not offered as feedback — and so does the
     draft, under the same key, because the essay is the reader's either way. */
  function buildWritingTask(test, p, exam) {
    var part = Number(p.part) || 1;
    var spec = WRITE_SPEC[part] || WRITE_SPEC[1];
    var key = writeKey(book.id, test, 'w' + part);
    var box = el('div', 'task-card' + (exam ? ' exam-task' : ''));

    var head = el('div', 'task-head');
    head.appendChild(el('b', null, t('task.writingPart', { n: part })));
    head.appendChild(el('span', 'task-chip', t('task.minutes', { n: spec.min })));
    head.appendChild(el('span', 'task-chip', t('task.minWords', { n: spec.words })));
    box.appendChild(head);
    box.appendChild(promptBody(p));
    if (!exam) box.appendChild(taskTimer(spec.min * 60));

    var d = draft(key);
    var area = el('textarea', 'task-area');
    area.value = (d && d.text) || '';
    area.rows = 14;
    area.spellcheck = true;
    area.setAttribute('aria-label', t('task.writingPart', { n: part }));
    box.appendChild(area);

    var foot = el('div', 'task-foot');
    var count = el('span', 'task-count');
    foot.appendChild(count);
    var saved = el('span', 'muted task-saved');
    foot.appendChild(saved);

    if (!exam) {
      var copy = el('button', 'btn small ghost', t('task.copy'));
      copy.addEventListener('click', function () {
        copyText(area.value);
        copy.textContent = t('task.copied');
        setTimeout(function () { copy.textContent = t('task.copy'); }, 1500);
      });
      foot.appendChild(copy);

      var wipe = el('button', 'btn small ghost', t('task.clear'));
      wipe.addEventListener('click', function () {
        if (!area.value) return;
        ASK.confirm(t('task.clearConfirm'),
          { title: t('task.clear'), yes: t('task.clear'), danger: true })
          .then(function (ok) {
            if (!ok) return;
            area.value = '';
            saveDraft(key, '');
            paintCount();
          });
      });
      foot.appendChild(wipe);
    }
    box.appendChild(foot);

    if (!exam) box.appendChild(buildCriteria());

    function paintCount() {
      var n = wordCount(area.value);
      count.textContent = t('task.words', { n: n, min: spec.words });
      count.classList.toggle('ok', n >= spec.words);
      count.classList.toggle('low', n > 0 && n < spec.words);
    }
    var writeTimer = null;
    area.addEventListener('input', function () {
      paintCount();
      clearTimeout(writeTimer);
      writeTimer = setTimeout(function () {
        saveDraft(key, area.value);
        saved.textContent = t('task.saved');
      }, 400);
    });
    paintCount();
    if (d && d.ts) saved.textContent = t('task.savedAt', { d: authDate(new Date(d.ts).toISOString()) });
    return box;
  }

  // The four things an examiner is actually marking. Not a score — a reminder
  // to read your own answer against the criteria before deciding it is done.
  function buildCriteria(open) {
    var crit = el('details', 'task-crit');
    if (open) crit.open = true;
    crit.appendChild(el('summary', null, t('task.criteria')));
    var ul = el('ul');
    ['task.crit1', 'task.crit2', 'task.crit3', 'task.crit4'].forEach(function (k) {
      ul.appendChild(el('li', null, t(k)));
    });
    crit.appendChild(ul);
    return crit;
  }

  /* ========== IELTS: the Writing paper under exam conditions ==========

     Everything the practice page offers is an aid: a countdown per task you
     start when you feel ready, a Clear button, the criteria open beside you.
     The exam gives none of that. It gives one hour, two tasks, and no idea how
     you did until somebody marks it — and the hour is the part candidates lose,
     because Task 2 is worth twice Task 1 and is the one that gets ten minutes.
     So this is the same two boxes with the aids taken away and a single clock
     over both, which is exactly what exam mode means everywhere else here.

     What it cannot do is put a number on the answer. A band invented out of a
     word count would be worse than no band, so the result screen reports the
     hour, the two counts against the minimums the exam sets, and the criteria
     to read the answer against — the same refusal the practice page makes, at
     the moment it matters most. The essays stay in the ordinary drafts, so
     "read what you wrote" is just the page this was started from. */

  var writeShowResult = null;      // 'book|w<test>' whose result screen to draw

  // A Writing run is filed beside the Listening ones, under 'w<test>' where a
  // section run is filed under a unit number — so one `state.exam` slot still
  // answers "is there an exam going on?" and the two can never collide.
  function writeExamKey(test) { return 'w' + test; }

  function liveWriteExam(test) {
    var e = state.exam;
    if (!e || e.book !== book.id || e.unit !== writeExamKey(test)) return null;
    return e;
  }

  function writingOf(test) {
    return bookPrompts(test)
      .filter(function (p) { return p.skill === 'writing'; })
      .sort(function (a, b) { return Number(a.part) - Number(b.part); });
  }

  // What the reader has actually written, per task, read back out of the drafts
  // the boxes save into. This is the only measurable thing a Writing run
  // produces, and it is reported as a count — never converted into a verdict.
  function writeWords(test, list) {
    return list.map(function (p) {
      var part = Number(p.part) || 1;
      var spec = WRITE_SPEC[part] || WRITE_SPEC[1];
      var d = draft(writeKey(book.id, test, 'w' + part));
      return { part: part, n: wordCount(d && d.text), min: spec.words };
    });
  }

  function startWriteExam(test) {
    stopExamTick();
    state.exam = {
      book: book.id,
      unit: writeExamKey(test),
      test: test,
      skill: 'writing',
      start: Date.now(),
      ends: Date.now() + EXAM.limitFor('writing') * 1000,
      answers: {}
    };
    flush();                       // a clock that has started must survive a reload
    writeShowResult = null;
    renderWriteExam(test);
  }

  function finishWriteExam(test, list, timedOut) {
    var e = liveWriteExam(test);
    if (!e) return;
    stopExamTick();
    var res = {
      ts: e.start,
      end: Date.now(),
      secs: Math.round((Date.now() - e.start) / 1000),
      skill: 'writing',
      test: test,
      words: writeWords(test, list),
      timedOut: !!timedOut
    };
    var k = examKey(book.id, writeExamKey(test));
    state.exams[k] = (state.exams[k] || []).concat([res]);
    state.exam = null;
    flush();
    if (window.SYNC) SYNC.touch(k);
    writeShowResult = k;
    renderWriteExam(test);
  }

  function abandonWriteExam(test) {
    stopExamTick();
    state.exam = null;
    flush();
    renderWriteExam(test);
  }

  function renderWriteExam(testNo) {
    var tests = promptTests();
    if (!tests.length) { renderNotFound(testNo || 1, 'tasks'); return; }
    var test = tests.indexOf(Number(testNo)) > -1 ? Number(testNo) : tests[0];
    var list = writingOf(test);
    // '/s/exam' is a URL the route regex will match and nothing offers: an
    // interview is not a paper. Nor is a book whose prompts carry no Writing.
    if (taskSkill !== 'w' || !EXAM.isExamTask(book.meta, 'writing', list)) {
      renderNotFound(test, 'exam');
      renderSidebar();
      return;
    }
    currentUnit = null;
    currentTask = 'w' + test;
    setTab('units');
    stopExamTick();
    clear(main);
    afterChange = function () {};

    var e = liveWriteExam(test);
    if (e) renderWritePaper(test, list, e);
    else {
      var k = examKey(book.id, writeExamKey(test));
      var runs = writeShowResult === k ? (state.exams[k] || []) : [];
      writeShowResult = null;
      if (runs.length) renderWriteResult(test, list, runs[runs.length - 1]);
      else renderWriteDesk(test, list);
    }
    // Nothing above draws the unit list, and this page is reachable from a
    // bookmark — without it the rail is blank and there is no way back to W1.
    renderSidebar();
    refreshBadge();
    window.scrollTo(0, 0);
  }

  // The page before the paper: what is about to happen, and what it costs.
  function renderWriteDesk(test, list) {
    var head = el('div', 'page-head');
    head.appendChild(el('h1', null, t('exam.h1', { t: t('task.writingUnit', { n: test }) })));
    main.appendChild(head);

    var card = el('div', 'exam-card');
    card.appendChild(el('p', null, t('wexam.intro')));
    var ul = el('ul', 'exam-rules');
    [
      t('exam.rule.time', { m: Math.round(EXAM.limitFor('writing') / 60) }),
      t('wexam.rule.split'),
      t('wexam.rule.noBand'),
      t('exam.rule.pdf')
    ].forEach(function (s) { ul.appendChild(el('li', null, s)); });
    card.appendChild(ul);

    var go = el('button', 'btn primary big', t('exam.start'));
    go.addEventListener('click', function () { startWriteExam(test); });
    card.appendChild(go);

    var back = el('a', 'btn ghost', t('exam.backToPractice'));
    back.href = '#/b/' + book.id + '/tasks/' + test + '/w';
    card.appendChild(back);
    main.appendChild(card);

    var hist = writeHistory(test);
    if (hist) main.appendChild(hist);
  }

  // The paper: a clock, the two tasks with nothing to press, one button to end.
  function renderWritePaper(test, list, e) {
    var bar = el('div', 'exam-bar');
    bar.appendChild(el('span', 'eb-title', t('task.writingUnit', { n: test })));
    var clockEl = el('b', 'eb-clock');
    bar.appendChild(clockEl);
    var doneBtn = el('button', 'btn small primary', t('exam.finish'));
    doneBtn.addEventListener('click', confirmFinish);
    bar.appendChild(doneBtn);
    var quit = el('button', 'btn small ghost', t('exam.abandon'));
    quit.addEventListener('click', function () {
      ASK.confirm(t('wexam.confirmAbandon'),
        { title: t('exam.abandon'), yes: t('exam.abandon'), danger: true })
        .then(function (ok) { if (ok) abandonWriteExam(test); });
    });
    bar.appendChild(quit);
    main.appendChild(bar);

    // The task IS the chart on page 30. Exam conditions do not change that —
    // they are the reason the book has to be open.
    var firstPage = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].pdfPage != null) { firstPage = Number(list[i].pdfPage); break; }
    }
    if (firstPage != null && book.meta && book.meta.pdf && !isNarrow()) showPdf(firstPage);

    list.forEach(function (p) { main.appendChild(buildWritingTask(test, p, true)); });

    var foot = el('div', 'unit-foot');
    var endBtn = el('button', 'btn primary big', t('exam.finish'));
    endBtn.addEventListener('click', confirmFinish);
    foot.appendChild(endBtn);
    main.appendChild(foot);

    function confirmFinish() {
      ASK.confirm(t('wexam.confirmFinish'), { title: t('exam.finish'), yes: t('exam.finish') })
        .then(function (ok) { if (ok) finishWriteExam(test, list, false); });
    }

    function paintClock() {
      var left = examLeft(e);
      clockEl.textContent = EXAM.clock(left);
      bar.classList.toggle('low', left <= 300);       // last five minutes
      if (left <= 0) finishWriteExam(test, list, true);
    }
    paintClock();
    examTick = setInterval(paintClock, 1000);
  }

  // No score, by design. What there is: the hour, the two counts, and the four
  // things to read your own answer against.
  function renderWriteResult(test, list, r) {
    var head = el('div', 'page-head');
    head.appendChild(el('h1', null,
      t('exam.resultH', { t: t('task.writingUnit', { n: test }) })));
    main.appendChild(head);

    var card = el('div', 'exam-result');
    var meta = el('div', 'er-meta');
    meta.appendChild(el('span', null, t('exam.took', { time: EXAM.clock(r.secs) })));
    if (r.timedOut) meta.appendChild(el('span', 'bad', t('exam.timedOut')));
    card.appendChild(meta);
    card.appendChild(el('div', 'muted er-note', t('wexam.noBand')));
    main.appendChild(card);

    // Word count per task against the minimum. Under it and the answer is not
    // eligible for a full band whatever else is right about it, so this is the
    // one place a machine can say something definite about an essay.
    var box = el('div', 'exam-parts');
    box.appendChild(el('h2', null, t('wexam.byTask')));
    (r.words || writeWords(test, list)).forEach(function (w) {
      var line = el('div', 'ep-row');
      line.appendChild(el('span', 'ep-num', 'T' + w.part));
      line.appendChild(el('span', 'ep-label', t('task.writingPart', { n: w.part })));
      var barBox = el('div', 'ep-bar');
      var fill = el('i');
      fill.style.width = Math.min(100, Math.round(w.n / w.min * 100)) + '%';
      barBox.appendChild(fill);
      line.appendChild(barBox);
      var sc = el('span', 'ep-score' + (w.n >= w.min ? ' ok' : ' low'), w.n + '/' + w.min);
      line.appendChild(sc);
      box.appendChild(line);
    });
    main.appendChild(box);

    main.appendChild(buildCriteria(true));

    var acts = el('div', 'exam-actions');
    var see = el('a', 'btn primary', t('wexam.seeDraft'));
    see.href = '#/b/' + book.id + '/tasks/' + test + '/w';
    acts.appendChild(see);
    var again = el('button', 'btn', t('exam.again'));
    again.addEventListener('click', function () { startWriteExam(test); });
    acts.appendChild(again);
    main.appendChild(acts);

    var hist = writeHistory(test);
    if (hist) main.appendChild(hist);
  }

  // Past sittings of this paper, newest first. No band column: there is no band.
  function writeHistory(test) {
    var runs = (state.exams[examKey(book.id, writeExamKey(test))] || []).slice().reverse();
    if (!runs.length) return null;
    var box = el('div', 'exam-hist');
    box.appendChild(el('h2', null, t('exam.past')));
    var tbl = el('table', 'exam-table');
    var thead = el('thead');
    var hr = el('tr');
    [t('exam.th.when'), t('wexam.th.words'), t('exam.th.time')].forEach(function (h) {
      hr.appendChild(el('th', null, h));
    });
    thead.appendChild(hr);
    tbl.appendChild(thead);
    var tb = el('tbody');
    runs.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', null, authDate(new Date(r.ts).toISOString())));
      var words = (r.words || []).map(function (w) { return w.n; }).join(' + ') || '—';
      tr.appendChild(el('td', 'num', words));
      tr.appendChild(el('td', 'num', EXAM.clock(r.secs)));
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    box.appendChild(tbl);
    return box;
  }

  function buildSpeakingTask(test, p) {
    var part = Number(p.part) || 1;
    var box = el('div', 'task-card');

    var head = el('div', 'task-head');
    head.appendChild(el('b', null, t('task.speakingPart', { n: part })));
    var spec = SPEAK_SPEC[part];
    if (spec) {
      head.appendChild(el('span', 'task-chip', t('task.prep', { n: spec.prep })));
      head.appendChild(el('span', 'task-chip', t('task.talk', { n: Math.round(spec.talk / 60) })));
    }
    box.appendChild(head);
    box.appendChild(promptBody(p));

    // Part 2 is the one with a clock in the real exam: a minute to prepare,
    // then one to two minutes of uninterrupted speech.
    if (spec) {
      var row = el('div', 'task-two-timers');
      var prep = el('div', 'tt-wrap');
      prep.appendChild(el('span', 'tt-label', t('task.prepLabel')));
      prep.appendChild(taskTimer(spec.prep));
      row.appendChild(prep);
      var talk = el('div', 'tt-wrap');
      talk.appendChild(el('span', 'tt-label', t('task.talkLabel')));
      talk.appendChild(taskTimer(spec.talk));
      row.appendChild(talk);
      box.appendChild(row);
    }

    box.appendChild(buildRecorder(test, part));
    return box;
  }

  /* Record the answer and play it back. Everything happens in the page: the
     blob never leaves the browser and is deliberately NOT stored — a couple of
     minutes of audio is megabytes, localStorage is a few, and silently filling
     it would break progress saving, which matters more. The download button is
     the way to keep one. */
  function buildRecorder(test, part) {
    var box = el('div', 'task-rec');
    var canRecord = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia &&
      window.MediaRecorder);
    if (!canRecord) {
      box.appendChild(el('div', 'note', t('task.noRec')));
      return box;
    }

    var btn = el('button', 'btn small rec-btn', '⏺ ' + t('task.record'));
    var note = el('span', 'muted');
    box.appendChild(btn);
    box.appendChild(note);
    var player = el('div', 'rec-player');
    box.appendChild(player);
    box.appendChild(el('div', 'note', t('task.recNote')));

    var recorder = null, chunks = [], stream = null;

    function stopStream() {
      if (stream) { stream.getTracks().forEach(function (tr) { tr.stop(); }); stream = null; }
    }

    btn.addEventListener('click', function () {
      if (recorder && recorder.state === 'recording') { recorder.stop(); return; }
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (st) {
        stream = st;
        chunks = [];
        recorder = new MediaRecorder(st);
        recorder.addEventListener('dataavailable', function (e) {
          if (e.data && e.data.size) chunks.push(e.data);
        });
        recorder.addEventListener('stop', function () {
          stopStream();
          btn.classList.remove('on');
          btn.textContent = '⏺ ' + t('task.record');
          note.textContent = '';
          var blob = new Blob(chunks, { type: chunks.length ? chunks[0].type : 'audio/webm' });
          var url = URL.createObjectURL(blob);
          clear(player);
          var audio = document.createElement('audio');
          audio.controls = true;
          audio.src = url;
          player.appendChild(audio);
          var dl = el('a', 'btn small ghost', '⭳ ' + t('task.download'));
          dl.href = url;
          dl.download = book.id + '-test' + test + '-speaking-part' + part + '.webm';
          player.appendChild(dl);
        });
        recorder.start();
        btn.classList.add('on');
        btn.textContent = '⏹ ' + t('task.stopRec');
        note.textContent = t('task.recording');
      }).catch(function () {
        note.textContent = t('task.micDenied');
      });
    });
    // Navigating away mid-recording must release the microphone.
    taskTimers.push(function () {
      if (recorder && recorder.state === 'recording') { try { recorder.stop(); } catch (e) { /* gone */ } }
      stopStream();
    });
    return box;
  }

  /* The line that has to be on every page of a sample: this is two units of a
     book, not a book. Without it a reader finishes unit 2, sees 100%, and
     concludes the product is tiny — which is the opposite of what a sample is
     for. */
  function sampleBanner() {
    if (!book || !book.sample) return null;
    var box = el('div', 'sample-bar');
    box.appendChild(el('span', 'sb-tag', t('sample.tag')));
    box.appendChild(document.createTextNode(
      t('sample.body', { n: book.units.length, of: book.unitsOf || book.units.length })));
    var go = el('a', 'btn small primary', t('sample.unlock'));
    go.href = '#/b/' + book.id + '/unlock';
    box.appendChild(go);
    return box;
  }

  function renderUnit(no) {
    var u = null;
    for (var i = 0; i < book.units.length; i++) {
      if (book.units[i].unit === no) { u = book.units[i]; break; }
    }
    // In a sample every other unit of the book exists — it is simply not in
    // this file. That is a lock, not a missing page.
    if (!u && book.sample) { showLocked(book.id, 'paid'); return; }
    if (!u) { renderNotFound(no); return; }
    stopExamTick();

    currentUnit = no;
    // this unit's answer-key page, so each exercise's key button lands on the
    // right unit's answers; may carry an explicit u.answerKeyPage from the data.
    akUnitPage = (u.answerKeyPage != null)
      ? u.answerKeyPage
      : ((AK_PAGES[book.id] || {})[no] || null);
    var introPage = unitIntroPage(u);   // for this unit's wrong-answer "Why?" buttons
    state.last = { book: book.id, unit: no };
    save();
    setTab('units');
    clear(main);

    var sb = sampleBanner();
    if (sb) main.appendChild(sb);

    var head = el('div', 'page-head');
    // An IELTS unit is a test section, and its title already says so
    // ("Test 1 — Listening"); "Unit 1 — " in front of that reads as noise.
    head.appendChild(el('h1', null,
      u.skill ? unitTitle(u) : 'Unit ' + u.unit + ' — ' + unitTitle(u)));

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
      var toggle = pdfToggleChip(startPage);
      chips.appendChild(toggle);

      // First visit, before the reader has ever expressed a preference: open the
      // pane. A book flagged `needsPdf` has no question text of its own and is
      // unusable without it, but even a fully extracted book is meant to be
      // worked WITH the page open — that three-panel split (book · exercises ·
      // units) is the layout, and a first-time reader should be handed it rather
      // than have to discover the button. Narrow screens keep it shut: there the
      // pane covers the whole page. `hidePdf` records the choice either way.
      if (state.ui.pdfOpen == null && window.innerWidth >= 1000) {
        state.ui.pdfOpen = true;
      }

      // reopen where they left off, and follow along as units change
      if (pdfOpen() || state.ui.pdfOpen) showPdf(startPage);
      toggle.sync(); // the chip was built before that, so bring it back in step
    }

    // A test section can be sat rather than practised. The chip is only on the
    // books where that means something — a grammar unit is not a timed paper.
    if (EXAM.isExamUnit(book.meta, u)) {
      var ex = el('a', 'chip chip-btn exam-chip', '⏱ ' + t('exam.chip'));
      ex.href = '#/b/' + book.id + '/unit/' + u.unit + '/exam';
      ex.title = t('exam.chipHint', { m: Math.round(EXAM.limitFor(u.skill) / 60) });
      chips.appendChild(ex);

      // The other two skills of the same test, where the book carries them.
      var testNo = EXAM.testOf(u);
      if (hasTasks() && promptTests().indexOf(testNo) > -1) {
        var tc = el('a', 'chip chip-btn', '✍ ' + t('task.chip'));
        tc.href = '#/b/' + book.id + '/tasks/' + testNo;
        chips.appendChild(tc);
      }
    }
    head.appendChild(chips);

    // A run abandoned by navigating away rather than finishing: the clock is
    // still going, and the reader is unlikely to guess that from this page.
    if (liveExam(u)) {
      var resume = el('div', 'exam-resume');
      resume.appendChild(document.createTextNode(t('exam.resumeNote')));
      var rlink = el('a', 'btn small primary', t('exam.resume'));
      rlink.href = '#/b/' + book.id + '/unit/' + u.unit + '/exam';
      resume.appendChild(rlink);
      head.appendChild(resume);
    }

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

    // The Kazakh explanation of this unit, if one has been written. The slot is
    // put in place now and filled when the file lands, so a slow fetch cannot
    // reorder the page under a reader who has started answering.
    var noteSlot = el('div', 'kn-slot');
    main.appendChild(noteSlot);
    loadNotes(book.id, function () {
      // The slot is looked up again rather than closed over: the first render
      // of a book can be replaced by a second (the index landing, a sync merge)
      // while the notes file is still in flight, and the captured element would
      // by then be an orphan — which is precisely how this feature managed to
      // work on every unit except the first one opened.
      if (currentUnit !== no) return;
      var slot = main.querySelector('.kn-slot');
      if (!slot || slot.firstChild) return;
      var note = noteFor(book.id, no);
      if (!note) return;
      slot.appendChild(buildNote(note, unitStats(book.id, u).done === 0));
    });

    if (!(u.subExercises && u.subExercises.length)) {
      // A few Essential Grammar units had no answers in the scan at all; keep
      // the unit reachable (title + PDF) rather than showing a blank page.
      main.appendChild(el('div', 'note', t('sub.doInPdf')));
    }
    (u.subExercises || []).forEach(function (sub) {
      // An IELTS group opens the part it belongs to, so its recording or its
      // reading passage goes in front of it rather than at the top of the page.
      if (sub.audio) main.appendChild(buildAudio(sub.audio));
      if (sub.reading) main.appendChild(buildPassage(sub.reading));
      main.appendChild(buildSub(u.unit, sub, introPage));
    });

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
      // On a test section the score out of forty has a band next to it. Shown
      // from the practice page too, not only after a timed run: a candidate
      // working through a Reading test wants to know where they landed.
      if (EXAM.isExamUnit(book.meta, u)) {
        var bl = bandLine(u.skill, st.correct);
        if (bl) score.appendChild(el('span', 'band-chip', bl));
      }
      renderSidebar();
      refreshBadge();
      bookChanged(book);
    }
    afterChange = refresh;
    refresh();
    focusPending();
  }

  /* `kind` says which of three different things went wrong, because they used
     to share one sentence. A link to #/b/<id>/unit/9 in a book with 8 units is
     a missing unit; /exam on a grammar book and /tasks on an IELTS collection
     that carries no prompts are not — those units exist, the *feature* does
     not apply to that book, and "Unit 1 not found." is simply untrue there.
     All three now get a way onwards as well: a dead end with no link out is
     the one screen in the app a reader can arrive at and be stuck on. */
  function renderNotFound(no, kind) {
    clear(main);
    var s = el('div', 'empty-state');
    s.appendChild(el('span', 'big', '🤔'));
    var msg = kind === 'exam' ? t('unit.noExam')
            : kind === 'tasks' ? t('unit.noTasks')
            : t('unit.notFound', { n: no });
    s.appendChild(el('div', null, msg));

    var row = el('div', 'sub-actions');
    row.style.justifyContent = 'center';
    if (book && book.units && book.units.length) {
      var first = el('a', 'btn primary', t('unit.toFirst'));
      first.href = '#/b/' + book.id + '/unit/' + book.units[0].unit;
      row.appendChild(first);
    }
    var lib = el('a', 'btn', t('load.back'));
    lib.href = '#/';
    row.appendChild(lib);
    s.appendChild(row);
    main.appendChild(s);
  }

  function renderErrors() {
    currentUnit = null;
    setTab('errors');
    clear(main);
    afterChange = function () { renderSidebar(); refreshBadge(); bookChanged(book); };

    var sbE = sampleBanner();
    if (sbE) main.appendChild(sbE);
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

    // Working through a long list by hand is a chore; one button turns it into
    // a timed-feeling run instead.
    var runBar = el('div', 'sub-actions err-run');
    var run = el('a', 'btn primary', t('drill.startHere'));
    run.href = '#/drill/' + book.id;
    runBar.appendChild(run);

    // The other thing to do with a list of mistakes: keep them. A card outlives
    // the mistakes page — this list empties itself as soon as the question is
    // answered right, and the deck is what brings it back a week later.
    if (window.SRS) {
      var pending = mistakeRows(book, 1);
      if (pending.length) {
        var toDeck = el('button', 'btn', t('err.toDeck', { n: pending.length }));
        toDeck.title = t('err.toDeckHint');
        toDeck.addEventListener('click', function () {
          var n = SRS.addMistakes(pending);
          toDeck.disabled = true;
          toDeck.textContent = t('err.toDeckDone', { n: n });
          refreshSrsBadge();
        });
        runBar.appendChild(toDeck);
      }
    }
    main.appendChild(runBar);

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
      // Every row in this group belongs to g.unit, so its "Why?" button points
      // at that unit's reference page — the next group gets its own.
      var groupIntro = unitIntroPage(g.unit);
      g.list.forEach(function (e) {
        if (e.sub !== lastSub) {
          box.appendChild(el('div', 'instructions',
            e.sub.number + (e.sub.instructions ? ' · ' + e.sub.instructions : '')));
          lastSub = e.sub;
        }
        box.appendChild(buildRow(g.unit.unit, e.sub, e.item,
          { review: true, introPage: groupIntro }));
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
          var r = rec(keyOf(bk.id, u.unit, sub.number, itemKey(it)));
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

    var sbS = sampleBanner();
    if (sbS) main.appendChild(sbS);
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
      var goDrill = el('a', 'btn small primary', t('drill.startHere'));
      goDrill.href = '#/drill/' + book.id;
      banner.appendChild(goDrill);
      var go = el('a', 'btn small', t('stats.dueGo'));
      go.href = '#/b/' + book.id + '/errors';
      banner.appendChild(go);
      main.appendChild(banner);
    }

    /* ---- monthly activity calendar ---- */
    main.appendChild(el('div', 'section-title', t('stats.activity')));
    main.appendChild(buildMonthCalendar());

    /* ---- mock exams (IELTS books only) ---- */
    var examBox = buildExamSummary();
    if (examBox) {
      main.appendChild(el('div', 'section-title', t('stats.exams')));
      main.appendChild(examBox);
    }

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
    // The file backup and the account solve the same problem, so the way to the
    // stronger one belongs right here rather than only behind a topbar icon.
    if (syncOn()) {
      var cloud = el('button', 'btn', t('stats.cloud'));
      cloud.addEventListener('click', openAuthModal);
      tools.appendChild(cloud);
    }
    main.appendChild(tools);

    var reset = el('button', 'btn danger', t('stats.reset'));
    reset.style.marginTop = '14px';
    reset.addEventListener('click', function () {
      ASK.confirm(t('stats.confirm', { book: (book.meta && book.meta.title) || book.id }),
        { title: t('stats.reset'), yes: t('stats.reset'), danger: true })
        .then(function (ok) {
          if (!ok) return;
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
    });
    main.appendChild(reset);

    renderSidebar();
    refreshBadge();
    window.scrollTo(0, 0);
  }

  /* Every section of this book that has been sat at least once: the newest
     band, the best one, and how many runs it took. A candidate's real question
     is "am I moving?", so latest and best sit side by side — a single "best"
     would hide a bad week and a single "latest" would hide the progress. Null
     for any book with no timed runs, which is every non-IELTS book. */
  function buildExamSummary() {
    var rows = [];
    book.units.forEach(function (u) {
      if (!EXAM.isExamUnit(book.meta, u)) return;
      var runs = state.exams[examKey(book.id, u.unit)] || [];
      if (!runs.length) return;
      var last = runs[runs.length - 1];
      var best = runs.reduce(function (a, r) { return r.raw > a.raw ? r : a; }, runs[0]);
      rows.push({ u: u, runs: runs, last: last, best: best });
    });
    if (!rows.length) return null;

    var tbl = el('table', 'exam-table');
    var thead = el('thead');
    var hr = el('tr');
    [t('stats.th.unit'), t('exam.th.score'), t('exam.th.band'), t('exam.thBest'), t('exam.thRuns')]
      .forEach(function (h) { hr.appendChild(el('th', null, h)); });
    thead.appendChild(hr);
    tbl.appendChild(thead);
    var tb = el('tbody');
    rows.forEach(function (r) {
      var tr = el('tr');
      var td = el('td');
      var a = el('a', null, unitTitle(r.u));
      a.href = '#/b/' + book.id + '/unit/' + r.u.unit + '/exam';
      td.appendChild(a);
      tr.appendChild(td);
      tr.appendChild(el('td', 'num', r.last.raw + '/' + r.last.total));
      var lb = EXAM.bandFor(r.last.skill, r.last.raw);
      var bb = EXAM.bandFor(r.best.skill, r.best.raw);
      tr.appendChild(el('td', 'num band', lb == null ? '—' : lb.toFixed(1)));
      tr.appendChild(el('td', 'num', bb == null ? '—' : bb.toFixed(1)));
      tr.appendChild(el('td', 'num', String(r.runs.length)));
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    return tbl;
  }

  // Colour bucket for a day's answer count — a GitHub-style five-step scale.
  function activityLevel(v) {
    if (!v) return 0;
    if (v <= 2) return 1;
    if (v <= 5) return 2;
    if (v <= 10) return 3;
    return 4;
  }

  function monthLabel(d) {
    try { return d.toLocaleDateString(t('locale'), { month: 'long', year: 'numeric' }); }
    catch (e) { return (d.getMonth() + 1) + '/' + d.getFullYear(); }
  }

  // One month of activity as a calendar heat-map. Arrows or a horizontal swipe
  // move between months; the future is blocked past the current month.
  function buildMonthCalendar() {
    var view = new Date();
    view.setDate(1);
    var wrap = el('div', 'cal');

    function atCurrentMonth() {
      var now = new Date();
      return view.getFullYear() === now.getFullYear() && view.getMonth() === now.getMonth();
    }
    function step(delta) {
      if (delta > 0 && atCurrentMonth()) return;   // no future months
      view.setMonth(view.getMonth() + delta);
      render();
    }

    function render() {
      clear(wrap);
      var y = view.getFullYear(), mo = view.getMonth();

      var head = el('div', 'cal-head');
      var prev = el('button', 'cal-nav', '‹');
      prev.type = 'button';
      prev.setAttribute('aria-label', t('cal.prev'));
      prev.addEventListener('click', function () { step(-1); });
      var next = el('button', 'cal-nav', '›');
      next.type = 'button';
      next.setAttribute('aria-label', t('cal.next'));
      next.disabled = atCurrentMonth();
      next.addEventListener('click', function () { step(1); });
      head.appendChild(prev);
      head.appendChild(el('div', 'cal-title', monthLabel(view)));
      head.appendChild(next);
      wrap.appendChild(head);

      var wl = el('div', 'cal-week');
      t('cal.days').split(',').forEach(function (d) { wl.appendChild(el('span', null, d)); });
      wrap.appendChild(wl);

      var grid = el('div', 'cal-grid');

      // One floating tooltip, shown just above whichever day the pointer rests
      // on for a moment (or a day is tapped / focused on touch + keyboard).
      var tip = el('div', 'cal-tip');
      tip.hidden = true;
      var hoverTimer = null;
      function dayText(ddate, dv) {
        var label;
        try { label = ddate.toLocaleDateString(t('locale'), { day: 'numeric', month: 'long' }); }
        catch (e) { label = String(ddate.getDate()); }
        return t('cal.dayCount', { date: label, n: dv });
      }
      function showTip(dcell, ddate, dv) {
        tip.textContent = dayText(ddate, dv);
        tip.style.left = (dcell.offsetLeft + dcell.offsetWidth / 2) + 'px';
        tip.style.top = (dcell.offsetTop - 6) + 'px';
        tip.hidden = false;
      }
      function hideTip() { clearTimeout(hoverTimer); tip.hidden = true; }

      var lead = (new Date(y, mo, 1).getDay() + 6) % 7;   // Monday-first offset
      for (var i = 0; i < lead; i++) grid.appendChild(el('span', 'cal-cell blank'));
      var daysInMonth = new Date(y, mo + 1, 0).getDate();
      var total = 0;
      for (var d = 1; d <= daysInMonth; d++) {
        var date = new Date(y, mo, d);
        var key = todayKey(date.getTime());
        var v = state.daily[key] || 0;
        total += v;
        var cell = el('span', 'cal-cell cal-l' + activityLevel(v), String(d));
        if (key === todayKey()) cell.classList.add('today');
        cell.setAttribute('aria-label', key + ': ' + v);
        (function (dv, ddate, dcell) {
          dcell.setAttribute('tabindex', '0');
          dcell.addEventListener('mouseenter', function () {
            clearTimeout(hoverTimer);
            hoverTimer = setTimeout(function () { showTip(dcell, ddate, dv); }, 120);
          });
          dcell.addEventListener('mouseleave', hideTip);
          dcell.addEventListener('focus', function () { showTip(dcell, ddate, dv); });
          dcell.addEventListener('blur', hideTip);
          // touch: a tap flashes the tooltip (no hover on phones)
          dcell.addEventListener('click', function () { showTip(dcell, ddate, dv); });
        })(v, date, cell);
        grid.appendChild(cell);
      }
      // Pad to a full 6-week grid (42 cells) so the calendar is the same height
      // every month — no jump when navigating between a 5- and a 6-row month.
      for (var pad = lead + daysInMonth; pad < 42; pad++) {
        grid.appendChild(el('span', 'cal-cell blank'));
      }
      grid.appendChild(tip);        // positioned relative to the grid
      wrap.appendChild(grid);
      wrap.appendChild(el('div', 'cal-foot', t('cal.total', { n: total })));
    }

    var sx = null;
    wrap.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; }, { passive: true });
    wrap.addEventListener('touchend', function (e) {
      if (sx == null) return;
      var dx = e.changedTouches[0].clientX - sx;
      sx = null;
      if (Math.abs(dx) < 40) return;
      step(dx < 0 ? 1 : -1);      // swipe left = forward in time
    }, { passive: true });

    render();
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

  /* ================= drill session ================= */

  // A mixed run through one book or all six: mistakes first, then whatever the
  // review ladder says is due, then new questions. Until now the spaced-review
  // data was only ever reported on; this is the page that actually uses it.

  var DRILL_SIZES = [10, 20, 50];
  var drill = null;          // live session, or null

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  // Outstanding work across every book, straight from the stored records — so
  // the library page can offer a session without downloading a data file.
  function dueAllCount() {
    var now = Date.now(), n = 0;
    for (var k in state.items) {
      var r = state.items[k];
      if (!r || !r.last) continue;
      // Records outlive the catalogue: a book that has been dropped leaves its
      // rows in storage, and counting them would promise cards the session
      // cannot deal.
      if (!bookMeta(k.slice(0, k.indexOf('|')))) continue;
      if ((r.wrong > 0 && !r.mastered) || (r.due != null && r.due <= now)) n++;
    }
    return n;
  }

  function drillPool(books) {
    var now = Date.now();
    var wrong = [], due = [], fresh = [], touched = {};
    books.forEach(function (bk) {
      (bk.units || []).forEach(function (u) {
        (u.subExercises || []).forEach(function (sub) {
          (sub.items || []).forEach(function (it) {
            // A drill card stands on its own: it needs printed question text
            // and a key that can be checked without the learner's judgement.
            if (!isTracked(sub, it) || !isAuto(it) || !it.question) return;
            var card = {
              bookId: bk.id, book: bk, unit: u, sub: sub, item: it,
              key: keyOf(bk.id, u.unit, sub.number, itemKey(it))
            };
            var r = rec(card.key);
            if (!r || !r.last) { fresh.push(card); return; }
            touched[bk.id + '|' + u.unit] = 1;
            if (r.wrong > 0 && !r.mastered) { card.due = r.due || 0; wrong.push(card); }
            else if (r.due != null && r.due <= now) { card.due = r.due; due.push(card); }
          });
        });
      });
    });
    var byDue = function (a, b) { return (a.due || 0) - (b.due || 0); };
    wrong.sort(byDue);
    due.sort(byDue);
    // New questions are drawn from where the reader already is: units they have
    // started, and only then the ones further down the book.
    fresh.sort(function (a, b) {
      var ta = touched[a.bookId + '|' + a.unit.unit] ? 0 : 1;
      var tb = touched[b.bookId + '|' + b.unit.unit] ? 0 : 1;
      if (ta !== tb) return ta - tb;
      return a.unit.unit - b.unit.unit;
    });
    return { wrong: wrong, due: due, fresh: fresh };
  }

  function drillQueue(pool, size) {
    var q = pool.wrong.slice(0, size);
    if (q.length < size) q = q.concat(pool.due.slice(0, size - q.length));
    if (q.length < size) q = q.concat(pool.fresh.slice(0, size - q.length));
    return shuffle(q);
  }

  function paintDrillChrome(scope) {
    var m = scope === 'all' ? null : bookMeta(scope);
    document.getElementById('brandTitle').textContent = t('drill.title');
    document.getElementById('brandSub').textContent =
      m ? (m.title + (m.level ? ' · ' + m.level : '')) : t('drill.allBooks');
    // Opened straight from a link, with no page behind it, a session scoped to
    // one book still has an obvious "back": that book.
    var to = backHash !== '#/' ? backHash : (m ? '#/b/' + scope : '#/');
    setBackLink(to);
  }

  /* ================= word cards ================= */

  // #/srs[/review|cards|add|import|settings] — the deck lives in srs.js, which
  // owns its own storage and draws its own pages. All this side does is give it
  // the shell: the book chrome, minus the sidebar and the section tabs.
  function openSrs(sub) {
    if (!window.SRS) { location.hash = '#/'; return; }
    setView('srs');
    document.getElementById('brandTitle').textContent = t('srs.title');
    document.getElementById('brandSub').textContent = t('srs.sub');
    setBackLink(backHash);
    SRS.open(sub);
    refreshSrsBadge();
  }

  // The count of words waiting, on the tab that opens them. Kept in the topbar
  // rather than only on the home page, because the moment a reader saves a word
  // from an exercise is the moment they want to know the deck is filling up.
  function refreshSrsBadge() {
    var badge = document.getElementById('srsBadge');
    var tab = document.getElementById('tabSrs');
    if (!badge || !window.SRS) return;
    var n = SRS.dueCount();
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.hidden = n === 0;
    if (tab) tab.setAttribute('aria-label', t('srs.title'));
  }

  /* ================= users (admin only) ================= */

  // #/users — who has an account here. A page rather than a section inside the
  // account panel: that panel is about one account, and a roster grows, so it
  // wants room to be sorted and filtered. The chrome is the same one the deck
  // and the sessions use — no sidebar, no unit tabs.
  //
  // Anyone can type this URL and nobody else can get anything out of it: the
  // account panel only links here for an admin, and the rows come from a
  // SECURITY DEFINER function that re-decides that question inside Postgres.
  // A stranger gets this page with a message where the table would be.
  // The key must be one of the column names below — anything else silently
  // sorts by nothing at all, since val() falls through to r[key].
  var usersSort = { key: 'joined', dir: -1 };    // newest signup first
  var usersFilter = '';

  function openUsers() {
    setView('users');
    document.getElementById('brandTitle').textContent = t('users.title');
    document.getElementById('brandSub').textContent = t('users.sub');
    setBackLink(backHash);
    renderUsers();
  }

  // Every path out of here ends in "draw something on this page", so the guard
  // against a repaint arriving after the reader has navigated away lives in one
  // place: the view attribute.
  function onUsersPage() { return body.getAttribute('data-view') === 'users'; }

  function usersNote(msg, withSignIn) {
    var s = el('div', 'empty-state');
    s.appendChild(el('span', 'big', '👥'));
    s.appendChild(el('div', null, msg));
    if (withSignIn) {
      var row = el('div', 'sub-actions');
      row.style.justifyContent = 'center';
      var b = el('button', 'btn primary', t('auth.signIn'));
      b.addEventListener('click', openAuthModal);
      row.appendChild(b);
      s.appendChild(row);
    }
    main.appendChild(s);
  }

  function renderUsers() {
    if (!onUsersPage()) return;
    clear(main);

    if (!syncOn() || !SYNC.signedIn()) return usersNote(t('users.needSignIn'), syncOn());

    // Landing here straight from a bookmark, the admin flag has not been asked
    // for yet — the account panel is what normally asks. Ask, and come back.
    if (SYNC.isAdmin() === null) {
      usersNote(t('users.loading'));
      SYNC.refreshAdmin().then(function () { renderUsers(); });
      return;
    }
    if (!SYNC.isAdmin()) return usersNote(t('users.notAdmin'));

    if (adminErr) {
      usersNote(adminErr);
      var again = el('div', 'sub-actions');
      again.style.justifyContent = 'center';
      again.appendChild(usersReloadBtn());
      main.appendChild(again);
      return;
    }
    if (adminUsers === null) {
      usersNote(t('users.loading'));
      loadAdminUsers(renderUsers);
      return;
    }
    // Nobody has signed up yet: a search field over nothing is furniture, and
    // drawing it would also put the "no accounts" line in the wrong box, once
    // per keystroke.
    if (!adminUsers.length) return usersNote(t('users.empty'));

    var bar = el('div', 'users-bar');
    var find = el('input', 'users-find');
    find.type = 'search';
    find.placeholder = t('users.filter');
    find.setAttribute('aria-label', t('users.filter'));
    find.value = usersFilter;
    bar.appendChild(find);
    var count = el('span', 'users-count');
    bar.appendChild(count);
    bar.appendChild(usersReloadBtn());
    main.appendChild(bar);

    var host = el('div');
    main.appendChild(host);
    main.appendChild(el('p', 'instructions', t('users.note')));

    // Only the table is redrawn while filtering, so the field keeps focus and
    // the caret — rebuilding the page on every keystroke would not.
    function paint() {
      clear(host);
      var f = usersFilter.trim().toLowerCase();
      var rows = adminUsers.filter(function (r) {
        return !f || (String(r.email || '') + ' ' + String(r.name || '')).toLowerCase().indexOf(f) >= 0;
      });
      count.textContent = f
        ? t('users.countFiltered', { n: rows.length, all: adminUsers.length })
        : t('users.count', { n: adminUsers.length });
      if (!rows.length) {
        host.appendChild(el('div', 'instructions', t('users.noMatch')));
        return;
      }
      host.appendChild(buildUsersTable(rows, paint));
    }

    find.addEventListener('input', function () { usersFilter = find.value; paint(); });
    paint();
    window.scrollTo(0, 0);
  }

  function usersReloadBtn() {
    var b = el('button', 'btn', t('users.reload'));
    b.type = 'button';
    b.disabled = adminLoading;
    b.addEventListener('click', function () {
      forgetAdminList();
      renderUsers();
    });
    return b;
  }

  function buildUsersTable(rows, repaint) {
    var me = SYNC.user() || {};
    var wrap = el('div', 'table-wrap users-table');
    var table = el('table');
    // The subscription column sits second, next to the name: it is the reason
    // this page gets opened at all once money is involved, and a column that
    // needs a sideways scroll to reach is a column that gets missed. A project
    // without the paywall half of the schema simply never draws it.
    var cols = window.ENTITLE && ENTITLE.configured
      ? ['user', 'sub', 'joined', 'seen', 'books', 'answers', 'active']
      : ['user', 'joined', 'seen', 'books', 'answers', 'active'];

    var trh = el('tr');
    cols.forEach(function (c) {
      var th = el('th', (c === 'books' || c === 'answers' ? 'num ' : '') + 'sortable',
        t('users.th.' + c));
      if (usersSort.key === c) th.classList.add(usersSort.dir > 0 ? 'asc' : 'desc');
      th.setAttribute('tabindex', '0');
      th.setAttribute('role', 'button');
      function sort() {
        usersSort.dir = usersSort.key === c ? -usersSort.dir : (c === 'user' ? 1 : -1);
        usersSort.key = c;
        repaint();
      }
      th.addEventListener('click', sort);
      th.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sort(); }
      });
      trh.appendChild(th);
    });
    var thead = el('thead');
    thead.appendChild(trh);
    table.appendChild(thead);

    function val(r, k) {
      if (k === 'user') return String(r.name || r.email || '').toLowerCase();
      if (k === 'joined') return Date.parse(r.created_at) || 0;
      if (k === 'seen') return Date.parse(r.last_sign_in_at) || 0;
      if (k === 'active') return Date.parse(r.last_active) || 0;
      // Sorting by subscription puts lifetime at the top, then the monthly ones
      // by how long they have left, then everybody who has never paid. A lapsed
      // month keeps its date and so sorts just under the live ones, which is
      // where the renewals to chase are.
      if (k === 'sub') {
        if (r.plan === 'lifetime') return 8.64e15;
        return Date.parse(r.expires_at) || 0;
      }
      return r[k] || 0;
    }
    var sorted = rows.slice().sort(function (a, b) {
      var va = val(a, usersSort.key), vb = val(b, usersSort.key);
      if (va < vb) return -usersSort.dir;
      if (va > vb) return usersSort.dir;
      return (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0);
    });

    var tbody = el('tbody');
    sorted.forEach(function (r) {
      var mail = r.email || '—';
      var shown = r.name || mail;
      var isMe = r.id && me.id === r.id;
      var tr = el('tr', isMe ? 'me' : null);

      var c1 = el('td');
      var cell = el('div', 'u-cell');
      cell.appendChild(el('span', 'acct-ava sm', (shown.charAt(0) || '●').toUpperCase()));
      var txt = el('div', 'u-t');
      var top = el('div', 'u-name');
      top.appendChild(document.createTextNode(shown));
      if (r.admin) top.appendChild(el('span', 'auth-badge', t('auth.adminBadge')));
      if (isMe) top.appendChild(el('span', 'au-you', t('users.you')));
      if (!r.confirmed) top.appendChild(el('span', 'au-warn', t('users.unconfirmed')));
      txt.appendChild(top);
      // The address only repeats when the name above is not already it.
      if (r.name) txt.appendChild(el('div', 'u-mail', mail));
      cell.appendChild(txt);
      c1.appendChild(cell);
      tr.appendChild(c1);

      if (cols.indexOf('sub') > 0) tr.appendChild(subCell(r, repaint));
      tr.appendChild(el('td', null, authDate(r.created_at)));
      tr.appendChild(el('td', null, authDate(r.last_sign_in_at)));
      tr.appendChild(el('td', 'num', String(r.books || 0)));
      tr.appendChild(el('td', 'num', String(r.answers || 0)));
      tr.appendChild(el('td', null, authDate(r.last_active)));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  // What this account holds, and the two buttons that change it. Payment is a
  // Kaspi transfer and this is the other half of it: you see the money arrive,
  // you press a button here. Both buttons are re-decided inside Postgres
  // against the verified token, so they are a convenience and not the control.
  function subCell(r, repaint) {
    var td = el('td', 'u-sub');

    var chip;
    if (r.subscribed) {
      chip = el('span', 'sub-chip live', r.plan === 'lifetime'
        ? t('users.sub.lifetime')
        : authDate(r.expires_at));
    } else if (r.plan) {
      // A lapsed row keeps its date rather than collapsing to a dash: "ran out
      // on the 4th" is the row worth writing to, and it is invisible otherwise.
      chip = el('span', 'sub-chip dead', authDate(r.expires_at));
      chip.title = t('users.sub.lapsed');
    } else {
      chip = el('span', 'sub-none', '—');
    }
    td.appendChild(chip);

    var acts = el('div', 'sub-acts');

    function run(label, cls, fn, confirmMsg) {
      var b = el('button', 'btn ' + cls, label);
      b.type = 'button';
      function go() {
        var all = acts.querySelectorAll('button');
        for (var i = 0; i < all.length; i++) all[i].disabled = true;
        fn().then(function (row) {
          // Patch the row in place rather than reloading the whole roster: a
          // reload would lose the filter's caret and the scroll position, and
          // the function hands back exactly the row that changed.
          var got = (row && row.length ? row[0] : row) || null;
          r.plan = got ? got.plan : null;
          r.expires_at = got ? got.expires_at : null;
          r.subscribed = !!(got && (got.plan === 'lifetime' ||
            (Date.parse(got.expires_at) || 0) > Date.now()));
          repaint();
          // Granting to yourself is the most common grant there is — the owner
          // testing, or unlocking their own account. ENTITLE caches the "no
          // subscription" answer, so without this the shelf keeps its locks and
          // the books stay shut until a reload, which reads as the grant not
          // having worked.
          var me = window.SYNC && SYNC.user();
          if (me && r.id === me.id && window.ENTITLE) {
            ENTITLE.refresh().catch(function () { /* the next page load re-asks */ });
          }
        }).catch(function (e) {
          for (var j = 0; j < all.length; j++) all[j].disabled = false;
          ASK.tell(String((e && e.message) || e), { title: t('users.failed') });
        });
      }

      b.addEventListener('click', function () {
        // No message means the action is not destructive — granting a month —
        // so it runs straight away. Revoking asks first.
        if (!confirmMsg) return go();
        ASK.confirm(confirmMsg, { title: label, yes: label, danger: true })
          .then(function (ok) { if (ok) go(); });
      });
      acts.appendChild(b);
    }

    var who = r.email || r.id;
    run(t('users.grantMonth'), '', function () {
      return ENTITLE.grant(r.id, 'monthly', 30);
    });
    run(t('users.grantLife'), '', function () {
      return ENTITLE.grant(r.id, 'lifetime');
    }, t('users.confirmLife', { email: who }));
    if (r.plan) {
      run(t('users.revoke'), 'sub-x', function () {
        return ENTITLE.revoke(r.id).then(function () { return null; });
      }, t('users.confirmRevoke', { email: who }));
    }

    td.appendChild(acts);
    return td;
  }

  // #/drill or #/drill/<book>
  /* ================= classes ================= */

  /* A teacher with a group of students, which is how English is actually
     studied here, had no way to use any of this: everything in the app is one
     learner's own progress, and the only view of anybody else's is the admin
     roster — the whole database, which is not a thing to hand to a tutor.

     A class is a name, a six-character code, and whoever typed that code. The
     owner sees counters: answered, right, last seen. Never what a student
     typed. Every rule about who may see what is enforced in Postgres
     (tools/supabase_schema.sql, "classes"); this page can only ask.

     `classList` is module-level so that the sync tick, which repaints this page
     like every other, does not refetch on each pass — the same trap the admin
     roster hit, including the one that matters: the ERROR branch has to be
     remembered too, or a failed request is retried forever. */

  var classList = null;        // [{id,name,code,mine,students,...}] once loaded
  var classErr = null;
  var classRoster = {};        // class id -> rows, loaded when one is opened
  var classOpen = null;        // which class's roster is on screen
  var classBusy = false;
  var classMsg = null;         // {text, bad} — the last thing that happened

  function forgetClasses() {
    classList = null;
    classErr = null;
    classRoster = {};
    classOpen = null;
  }

  function openClasses() {
    setView('class');
    document.getElementById('brandTitle').textContent = t('cls.title');
    document.getElementById('brandSub').textContent = t('cls.sub');
    setBackLink(backHash);
    renderClasses();
  }

  function onClassPage() { return body.getAttribute('data-view') === 'class'; }

  function classNote(msg, withSignIn) {
    var s = el('div', 'empty-state');
    s.appendChild(el('span', 'big', '👩‍🏫'));
    s.appendChild(el('div', null, msg));
    if (withSignIn) {
      var row = el('div', 'sub-actions');
      row.style.justifyContent = 'center';
      var b = el('button', 'btn primary', t('auth.signIn'));
      b.addEventListener('click', openAuthModal);
      row.appendChild(b);
      s.appendChild(row);
    }
    main.appendChild(s);
  }

  function classFail(e) {
    classMsg = { text: (e && e.message) || String(e), bad: true };
    classBusy = false;
    renderClasses();
  }

  function renderClasses() {
    if (!onClassPage()) return;
    clear(main);

    if (!window.CLASSES || !CLASSES.configured) return classNote(t('cls.noSync'));
    if (!syncOn() || !SYNC.signedIn()) return classNote(t('cls.needSignIn'), true);
    if (CLASSES.unavailable()) return classNote(t('cls.notSetUp'));

    if (classErr) {
      classNote(classErr);
      var again = el('div', 'sub-actions');
      again.style.justifyContent = 'center';
      var btn = el('button', 'btn', t('users.reload'));
      btn.addEventListener('click', function () { forgetClasses(); renderClasses(); });
      again.appendChild(btn);
      main.appendChild(again);
      return;
    }
    if (classList === null) {
      classNote(t('cls.loading'));
      CLASSES.mine().then(function (rows) {
        classList = rows || [];
        renderClasses();
      }, function (e) {
        classErr = e && e.missing ? t('cls.notSetUp') : ((e && e.message) || String(e));
        renderClasses();
      });
      return;
    }

    var head = el('div', 'page-head');
    head.appendChild(el('h1', null, t('cls.h1')));
    head.appendChild(el('div', 'instructions', t('cls.intro')));
    main.appendChild(head);

    if (classMsg) {
      main.appendChild(el('div', 'cls-msg ' + (classMsg.bad ? 'bad' : 'ok'), classMsg.text));
      classMsg = null;
    }

    var teaching = classList.filter(function (c) { return c.mine; });
    var studying = classList.filter(function (c) { return !c.mine; });

    main.appendChild(el('div', 'section-title', t('cls.teaching')));
    if (!teaching.length) main.appendChild(el('div', 'note', t('cls.noneTeaching')));
    teaching.forEach(function (c) { main.appendChild(classCard(c)); });
    main.appendChild(classCreateForm());

    main.appendChild(el('div', 'section-title', t('cls.studying')));
    if (!studying.length) main.appendChild(el('div', 'note', t('cls.noneStudying')));
    studying.forEach(function (c) { main.appendChild(classCard(c)); });
    main.appendChild(classJoinForm());

    // What a teacher can see, said where a student can read it. A progress
    // board that does not say what it shows is a surprise waiting to happen.
    main.appendChild(el('div', 'note cls-privacy', t('cls.privacy')));
  }

  function classCard(c) {
    var box = el('div', 'cls-card');
    var head = el('div', 'cls-head');
    head.appendChild(el('b', 'cls-name', c.name));
    if (c.mine) {
      head.appendChild(el('span', 'cls-count', t('cls.students', { n: c.students })));
    } else {
      head.appendChild(el('span', 'cls-count', t('cls.by', { name: c.owner_name || '—' })));
    }
    box.appendChild(head);

    if (c.mine && c.code) {
      // The code is the whole product for a teacher: they read it out once and
      // the class exists. It gets the big treatment and a copy button.
      var codeRow = el('div', 'cls-code-row');
      codeRow.appendChild(el('span', 'muted', t('cls.code')));
      codeRow.appendChild(el('b', 'cls-code', c.code));
      var copy = el('button', 'btn small ghost', t('cls.copy'));
      copy.addEventListener('click', function () {
        copyText(c.code);
        copy.textContent = t('cls.copied');
        setTimeout(function () { copy.textContent = t('cls.copy'); }, 1500);
      });
      codeRow.appendChild(copy);
      box.appendChild(codeRow);
    }

    var acts = el('div', 'sub-actions');
    if (c.mine) {
      var open = el('button', 'btn small primary',
        t(classOpen === c.id ? 'cls.hide' : 'cls.open'));
      open.addEventListener('click', function () {
        classOpen = classOpen === c.id ? null : c.id;
        renderClasses();
      });
      acts.appendChild(open);

      var del = el('button', 'btn small danger', t('cls.delete'));
      del.addEventListener('click', function () {
        ASK.confirm(t('cls.deleteConfirm', { name: c.name }),
          { title: t('cls.delete'), yes: t('cls.delete'), danger: true })
          .then(function (ok) {
            if (!ok) return;
            CLASSES.remove(c.id).then(function () {
              forgetClasses();
              classMsg = { text: t('cls.deleted', { name: c.name }) };
              renderClasses();
            }, classFail);
          });
      });
      acts.appendChild(del);
    } else {
      var leave = el('button', 'btn small', t('cls.leave'));
      leave.addEventListener('click', function () {
        ASK.confirm(t('cls.leaveConfirm', { name: c.name }),
          { title: t('cls.leave'), yes: t('cls.leave'), danger: true })
          .then(function (ok) {
            if (!ok) return;
            CLASSES.leave(c.id).then(function () {
              forgetClasses();
              classMsg = { text: t('cls.left', { name: c.name }) };
              renderClasses();
            }, classFail);
          });
      });
      acts.appendChild(leave);
    }
    box.appendChild(acts);

    if (c.mine && classOpen === c.id) box.appendChild(classRosterBox(c));
    return box;
  }

  function classRosterBox(c) {
    var box = el('div', 'cls-roster');
    var rows = classRoster[c.id];
    if (rows === undefined) {
      box.appendChild(el('div', 'note', t('cls.loading')));
      CLASSES.progress(c.id).then(function (list) {
        classRoster[c.id] = list || [];
        renderClasses();
      }, function (e) {
        // Remember the failure as a value, or the repaint that follows asks
        // again, and again, for as long as the page is open.
        classRoster[c.id] = [];
        classMsg = { text: (e && e.message) || String(e), bad: true };
        renderClasses();
      });
      return box;
    }
    if (!rows.length) {
      box.appendChild(el('div', 'note', t('cls.empty')));
      return box;
    }

    var tbl = el('table', 'cls-table');
    var thead = el('thead');
    var hr = el('tr');
    [t('cls.th.student'), t('cls.th.answers'), t('cls.th.accuracy'),
     t('cls.th.books'), t('cls.th.seen'), ''].forEach(function (h) {
      hr.appendChild(el('th', null, h));
    });
    thead.appendChild(hr);
    tbl.appendChild(thead);

    var tb = el('tbody');
    rows.forEach(function (r) {
      var tr = el('tr');
      var who = el('td');
      who.appendChild(el('b', null, r.name || (r.email || '').split('@')[0]));
      who.appendChild(el('span', 'muted cls-mail', r.email || ''));
      tr.appendChild(who);
      tr.appendChild(el('td', 'num', num(r.answers || 0)));
      var acc = r.answers ? Math.round((r.correct || 0) / r.answers * 100) : 0;
      tr.appendChild(el('td', 'num', r.answers ? acc + '%' : '—'));
      tr.appendChild(el('td', 'num', String(r.books || 0)));
      tr.appendChild(el('td', null, r.last_active ? authDate(r.last_active) : '—'));
      var act = el('td');
      var kick = el('button', 'btn small ghost', t('cls.remove'));
      kick.addEventListener('click', function () {
        ASK.confirm(t('cls.removeConfirm', { name: r.name || r.email }),
          { title: t('cls.remove'), yes: t('cls.remove'), danger: true })
          .then(function (ok) {
            if (!ok) return;
            CLASSES.leave(c.id, r.user_id).then(function () {
              delete classRoster[c.id];
              classList = null;             // the student count moved
              renderClasses();
            }, classFail);
          });
      });
      act.appendChild(kick);
      tr.appendChild(act);
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    box.appendChild(tbl);
    return box;
  }

  function classCreateForm() {
    var box = el('div', 'cls-form');
    var input = el('input', 'cls-in');
    input.type = 'text';
    input.placeholder = t('cls.namePh');
    input.setAttribute('aria-label', t('cls.namePh'));
    input.maxLength = 60;
    var go = el('button', 'btn primary', t('cls.create'));
    function submit() {
      var name = input.value.trim();
      if (!name || classBusy) { input.focus(); return; }
      classBusy = true;
      go.disabled = true;
      CLASSES.create(name).then(function (row) {
        classBusy = false;
        forgetClasses();
        var made = (row && row.length ? row[0] : row) || {};
        classMsg = { text: t('cls.created', { name: made.name || name, code: made.code || '' }) };
        renderClasses();
      }, classFail);
    }
    go.addEventListener('click', submit);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    box.appendChild(input);
    box.appendChild(go);
    return box;
  }

  function classJoinForm() {
    var box = el('div', 'cls-form');
    var input = el('input', 'cls-in cls-code-in');
    input.type = 'text';
    input.placeholder = t('cls.codePh');
    input.setAttribute('aria-label', t('cls.codePh'));
    input.maxLength = 6;
    input.autocapitalize = 'characters';
    var go = el('button', 'btn primary', t('cls.join'));
    function submit() {
      var code = input.value.trim().toUpperCase();
      if (!code || classBusy) { input.focus(); return; }
      classBusy = true;
      go.disabled = true;
      CLASSES.join(code).then(function (row) {
        classBusy = false;
        forgetClasses();
        var got = (row && row.length ? row[0] : row) || {};
        classMsg = { text: t('cls.joined', { name: got.name || code }) };
        renderClasses();
      }, function (e) {
        // The one error worth a sentence of its own: a code that does not
        // exist is a typo, not a broken app.
        if (e && (e.code === 'P0002' || /no class with that code/i.test(e.message || ''))) {
          classBusy = false;
          classMsg = { text: t('cls.badCode'), bad: true };
          renderClasses();
          return;
        }
        classFail(e);
      });
    }
    go.addEventListener('click', submit);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    box.appendChild(input);
    box.appendChild(go);
    return box;
  }

  function openDrill(scope) {
    if (scope !== 'all' && !bookMeta(scope)) { location.hash = '#/drill'; return; }
    setView('drill');
    paintDrillChrome(scope);
    // A session in progress survives leaving the page and coming back.
    if (drill && drill.scope === scope && !drill.done) { paintDrill(); return; }
    drill = null;

    clear(main);
    var wait = el('div', 'empty-state');
    wait.appendChild(el('span', 'big', '⚡'));
    wait.appendChild(el('div', null, t('drill.loading')));
    main.appendChild(wait);

    var ids = scope === 'all' ? BOOKS.map(function (b) { return b.id; }) : [scope];
    Promise.all(ids.map(loadBook)).then(function (bks) {
      var r = parseHash(location.hash);
      if (r.view !== 'drill' || r.id !== scope) return;   // navigated away meanwhile
      renderDrillSetup(scope, bks);
    }, function (e) {
      // showError's retry belongs to the book view; here the same hash is the
      // retry, so the message stays plain.
      clear(main);
      var s = el('div', 'empty-state');
      s.appendChild(el('span', 'big', '⚠️'));
      s.appendChild(el('div', null, t('load.failed', { id: t('drill.title') })));
      s.appendChild(el('div', 'instructions', String((e && e.message) || e)));
      var row = el('div', 'sub-actions');
      row.style.justifyContent = 'center';
      var again = el('button', 'btn primary', t('load.retry'));
      again.addEventListener('click', function () { openDrill(scope); });
      row.appendChild(again);
      var back = el('a', 'btn', t('load.back'));
      back.href = '#/';
      row.appendChild(back);
      s.appendChild(row);
      main.appendChild(s);
    });
  }

  function renderDrillSetup(scope, books) {
    clear(main);
    var pool = drillPool(books);
    var total = pool.wrong.length + pool.due.length + pool.fresh.length;

    var head = el('div', 'page-head');
    head.appendChild(el('h1', null, t('drill.setupH')));
    head.appendChild(el('div', 'instructions', t('drill.setupP')));
    var today = state.daily[todayKey()] || 0;
    var streak = dayStreak();
    var line = el('div', 'drill-today');
    line.appendChild(el('span', null, t('drill.today', { n: num(today) })));
    if (streak) line.appendChild(el('span', 'dt-streak', t('stats.streak', { n: streak })));
    head.appendChild(line);
    main.appendChild(head);

    if (!total) {
      var s = el('div', 'empty-state');
      s.appendChild(el('span', 'big', '🎉'));
      s.appendChild(el('div', null, t('drill.empty')));
      var back = el('a', 'btn', t('drill.home'));
      back.href = '#/';
      s.appendChild(back);
      main.appendChild(s);
      return;
    }

    var cards = el('div', 'cards');
    function pc(k, v, cls) {
      var c = el('div', 'card' + (cls ? ' ' + cls : ''));
      c.appendChild(el('div', 'k', k));
      c.appendChild(el('div', 'v', num(v)));
      cards.appendChild(c);
    }
    pc(t('drill.poolWrong'), pool.wrong.length, pool.wrong.length ? 'bad' : '');
    pc(t('drill.poolDue'), pool.due.length);
    pc(t('drill.poolNew'), pool.fresh.length);
    main.appendChild(cards);

    var box = el('div', 'drill-setup');
    box.appendChild(el('div', 'ds-label', t('drill.size')));
    var row = el('div', 'ds-sizes');
    DRILL_SIZES.forEach(function (n) {
      var b = el('button', 'btn' + (n === 20 ? ' primary' : ''), t('drill.sizeN', { n: n }));
      b.addEventListener('click', function () { startDrill(scope, books, n); });
      row.appendChild(b);
    });
    box.appendChild(row);
    main.appendChild(box);

    if (scope !== 'all') {
      var all = el('a', 'btn drill-alt', t('drill.goAll'));
      all.href = '#/drill';
      main.appendChild(all);
    }

    // Across all the books "7 mistakes" says nothing about where they are. The
    // breakdown answers that before the run starts, not after it.
    if (books.length > 1) {
      var per = {};
      function bump(list, field) {
        list.forEach(function (c) {
          var row = per[c.bookId] || (per[c.bookId] = { book: c.book, wrong: 0, due: 0, fresh: 0 });
          row[field]++;
        });
      }
      bump(pool.wrong, 'wrong');
      bump(pool.due, 'due');
      bump(pool.fresh, 'fresh');

      var rows = BOOKS.map(function (b) { return per[b.id]; }).filter(Boolean);
      if (rows.length) {
        main.appendChild(el('div', 'section-title', t('drill.fromBooks')));
        var list = el('div', 'drill-books');
        rows.forEach(function (r) {
          var row = el('div', 'db-row');
          var link = el('a', 'db-name', (r.book.meta && r.book.meta.title) || r.book.id);
          link.href = '#/drill/' + r.book.id;
          link.title = t('drill.onlyThis');
          row.appendChild(link);
          var counts = el('div', 'db-counts');
          if (r.wrong) counts.appendChild(el('span', 'db-wrong', r.wrong + ' ' + t('drill.poolWrong').toLowerCase()));
          if (r.due) counts.appendChild(el('span', 'db-due', r.due + ' ' + t('drill.poolDue').toLowerCase()));
          counts.appendChild(el('span', 'db-fresh', num(r.fresh) + ' ' + t('drill.poolNew').toLowerCase()));
          row.appendChild(counts);
          list.appendChild(row);
        });
        main.appendChild(list);
      }
    }

    /* ---- what a run actually looks like ---- */
    main.appendChild(el('div', 'section-title', t('drill.how')));
    var how = el('div', 'drill-how');
    [['⌨️', t('drill.how1')], ['💡', t('drill.how2')],
     // only promised where the browser can actually speak
     Speech.ok ? ['🔊', t('drill.how3')] : null,
     ['🎯', t('drill.how4')]].filter(Boolean).forEach(function (h) {
      var row = el('div', 'dh-row');
      row.appendChild(el('span', 'dh-ico', h[0]));
      row.appendChild(el('span', 'dh-txt', h[1]));
      how.appendChild(row);
    });
    main.appendChild(how);
    window.scrollTo(0, 0);
  }

  function startDrill(scope, books, size) {
    var cards = drillQueue(drillPool(books), size);
    if (!cards.length) { renderDrillSetup(scope, books); return; }
    drill = {
      scope: scope, books: books, cards: cards,
      i: 0, right: 0, missed: [], done: false
    };
    paintDrill();
  }

  function paintDrill() {
    if (!drill) return;
    if (drill.done) renderDrillEnd(); else renderDrillCard();
  }

  function finishDrill() {
    drill.done = true;
    // The library page reads cached per-book totals; a session just changed them.
    drill.books.forEach(function (bk) { bookChanged(bk); });
    renderDrillEnd();
  }

  function renderDrillCard() {
    Speech.stop();
    clear(main);
    var c = drill.cards[drill.i];
    var n = drill.cards.length;
    var it = c.item;

    var wrap = el('div', 'drill');

    /* --- progress strip --- */
    var top = el('div', 'drill-top');
    var bar = el('div', 'drill-bar');
    var fill = el('i');
    fill.style.width = Math.round(drill.i / n * 100) + '%';
    bar.appendChild(fill);
    top.appendChild(bar);

    var meta = el('div', 'drill-meta');
    meta.appendChild(el('span', 'dm-i', t('drill.progress', { i: drill.i + 1, n: n })));
    var okCount = el('span', 'dm-ok', '✓ ' + drill.right);
    var badCount = el('span', 'dm-bad', '✗ ' + drill.missed.length);
    meta.appendChild(okCount);
    meta.appendChild(badCount);
    var quit = el('button', 'btn small dm-quit', t('drill.quit'));
    quit.addEventListener('click', finishDrill);
    meta.appendChild(quit);
    top.appendChild(meta);
    wrap.appendChild(top);

    /* --- the question --- */
    var box = el('div', 'drill-card');
    var src = el('div', 'dc-src');
    src.textContent = ((c.book.meta && c.book.meta.title) || c.bookId) +
      ' · Unit ' + c.unit.unit + ' · ' + c.sub.number;
    box.appendChild(src);
    if (c.sub.instructions) box.appendChild(el('div', 'dc-instr', c.sub.instructions));

    // Some exercises are unanswerable without their word pool, so it comes along.
    var bank = c.sub.wordBank;
    if (typeof bank === 'string') bank = bank.split(/\s+/).filter(Boolean);
    if (bank && bank.length && bank.length <= 24) {
      var wb = el('div', 'wordbank');
      bank.forEach(function (w) { wb.appendChild(el('span', 'wb', w)); });
      box.appendChild(wb);
    }
    if (c.sub.options && c.sub.options.length && c.sub.options.length <= 12) {
      var ol = el('div', 'options');
      c.sub.options.forEach(function (o) {
        var chip = el('span', 'opt');
        chip.appendChild(el('b', null, o.letter));
        chip.appendChild(document.createTextNode(' ' + o.text));
        ol.appendChild(chip);
      });
      box.appendChild(ol);
    }

    var q = el('div', 'dc-q');
    q.textContent = it.question;
    var qSay = speakBtn(function () { return it.question; });
    if (qSay) q.appendChild(qSay);
    box.appendChild(q);

    /* --- answer --- */
    var line = el('div', 'answer-line');
    var input = answerInput(t('row.aria', { unit: c.unit.unit, sub: c.sub.number, n: it.n }));
    line.appendChild(input);

    var chk = el('button', 'btn primary', t('btn.check'));
    line.appendChild(chk);

    var hintLevel = 0;
    var hintBox = el('div', 'hint');
    hintBox.hidden = true;
    var hintBtn = null;
    if (hasHint(it)) {
      hintBtn = el('button', 'btn hint-btn', t('hint.btn'));
      hintBtn.addEventListener('click', function () {
        if (answered || hintLevel >= 3) return;
        hintLevel++;
        clear(hintBox);
        hintBox.hidden = false;
        hintBox.appendChild(el('span', 'hint-ico', '💡'));
        if (hintLevel === 1) {
          hintBox.appendChild(el('code', 'hint-mask', hintMask(it.answer, 1)));
          hintBox.appendChild(el('span', 'hint-meta', t('hint.letters', { n: hintLetters(it.answer) })));
        } else if (hintLevel === 2) {
          hintBox.appendChild(el('code', 'hint-mask', hintMask(it.answer, 2)));
        } else {
          hintBox.appendChild(el('b', 'hint-full', hintBase(it.answer)));
        }
        hintBtn.textContent = hintLevel >= 3 ? t('hint.done') : t('hint.more');
        input.focus();
      });
      line.appendChild(hintBtn);
    }
    box.appendChild(line);
    box.appendChild(hintBox);

    var feedback = el('div', 'dc-feedback');
    feedback.setAttribute('aria-live', 'polite');
    box.appendChild(feedback);

    var nav = el('div', 'dc-nav');
    var nextBtn = el('button', 'btn primary',
      drill.i + 1 >= n ? t('drill.finish') : t('drill.next'));
    nextBtn.hidden = true;
    nav.appendChild(nextBtn);
    box.appendChild(nav);

    wrap.appendChild(box);
    main.appendChild(wrap);

    var answered = false;

    function verdict(correct, self) {
      // The tally sits above the card and must move with the answer, not wait
      // for the next question to redraw it.
      okCount.textContent = '✓ ' + drill.right;
      badCount.textContent = '✗ ' + drill.missed.length;
      clear(feedback);
      box.classList.remove('ok', 'bad');
      box.classList.add(correct ? 'ok' : 'bad');
      feedback.appendChild(el('div', 'dc-verdict ' + (correct ? 'ok' : 'bad'),
        correct ? t('drill.right') : t('drill.wrongV')));

      var k = el('div', 'dc-key');
      k.appendChild(document.createTextNode(t('row.bookKey')));
      k.appendChild(el('b', null, it.answer));
      var kSay = speakBtn(function () { return hintBase(it.answer) || it.answer; });
      if (kSay) k.appendChild(kSay);
      feedback.appendChild(k);

      if (!correct && input.value.trim()) {
        var yours = el('div', 'dc-yours');
        yours.appendChild(document.createTextNode(t('drill.yours')));
        yours.appendChild(el('b', null, input.value));
        feedback.appendChild(yours);
      }
      if (hintLevel > 0 && correct) feedback.appendChild(el('div', 'dc-hinted', t('hint.used')));
      if (self) feedback.appendChild(el('div', 'dc-hinted', t('row.selfMarked')));

      // Matching is good but not perfect; the learner keeps the last word.
      if (!correct && !self) {
        // The book's page explains the rule in English; this explains it in
        // Kazakh, and for a reader at A2 that is the difference between a
        // reference and an answer.
        var kn = document.querySelector('.kn-slot .kk-note');
        if (kn) {
          var toNote = el('button', 'btn small why-btn', t('note.open'));
          toNote.type = 'button';
          toNote.addEventListener('click', function () {
            kn.open = true;
            kn.scrollIntoView({ block: 'nearest' });
          });
          feedback.appendChild(toNote);
        }

        var ov = el('button', 'btn small ok', t('row.override'));
        ov.addEventListener('click', override);
        feedback.appendChild(ov);
      }

      input.disabled = true;
      chk.hidden = true;
      if (hintBtn) hintBtn.hidden = true;
      nextBtn.hidden = false;
      nextBtn.focus();
    }

    function commit(correct) {
      if (answered) return;
      answered = true;
      // Remembered on the card, not just in this closure: switching language
      // (or a write from another tab) redraws the screen, and the answer must
      // not be counted a second time.
      c.answered = true;
      c.correct = correct;
      c.val = input.value;
      applyAnswer(c.key, correct, { val: input.value, hinted: hintLevel > 0 });
      if (correct) drill.right++;
      else drill.missed.push({ card: c, val: input.value });
      verdict(correct, false);
    }

    function override() {
      c.correct = true;
      c.self = true;
      applyAnswer(c.key, true, { val: input.value, self: true, hinted: hintLevel > 0 });
      for (var i = drill.missed.length - 1; i >= 0; i--) {
        if (drill.missed[i].card === c) { drill.missed.splice(i, 1); break; }
      }
      drill.right++;
      verdict(true, true);
    }

    function next() {
      Speech.stop();
      drill.i++;
      if (drill.i >= drill.cards.length) finishDrill();
      else renderDrillCard();
    }

    chk.addEventListener('click', function () {
      if (!input.value.trim()) { input.focus(); return; }
      commit(isMatch(input.value, it));
    });
    nextBtn.addEventListener('click', next);
    input.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (!input.value.trim()) return;
      commit(isMatch(input.value, it));
    });
    // Enter again moves on — the whole run should be doable from the keyboard.
    nextBtn.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); next(); }
    });

    // Redrawn after it was already answered: restore the verdict rather than
    // offering the question again.
    if (c.answered) {
      answered = true;
      input.value = c.val || '';
      verdict(c.correct === true, c.self === true);
    } else {
      input.focus();
    }
    window.scrollTo(0, 0);
  }

  function renderDrillEnd() {
    clear(main);
    var answered = drill.right + drill.missed.length;
    var pct = answered ? Math.round(drill.right / answered * 100) : 0;

    var s = el('div', 'drill-end');
    s.appendChild(el('div', 'de-mark', drill.missed.length === 0 && answered ? '🏆' : '🎯'));
    s.appendChild(el('h1', null, t('drill.doneH')));
    s.appendChild(el('div', 'de-score', t('drill.score', { c: drill.right, n: answered })));
    s.appendChild(el('div', 'de-pct', pct + '%'));
    if (answered && !drill.missed.length) s.appendChild(el('div', 'de-perfect', t('drill.perfect')));

    var acts = el('div', 'de-acts');
    var again = el('button', 'btn primary', t('drill.again'));
    again.addEventListener('click', function () {
      var scope = drill.scope, books = drill.books;
      drill = null;
      renderDrillSetup(scope, books);
    });
    acts.appendChild(again);
    var home = el('a', 'btn', t('drill.home'));
    home.href = '#/';
    acts.appendChild(home);
    s.appendChild(acts);
    main.appendChild(s);

    if (drill.missed.length) {
      main.appendChild(el('div', 'section-title', t('drill.missed')));
      var list = el('div', 'de-missed');
      drill.missed.forEach(function (m) {
        var c = m.card;
        var row = el('div', 'de-row');
        row.appendChild(el('div', 'de-src',
          ((c.book.meta && c.book.meta.title) || c.bookId) + ' · Unit ' + c.unit.unit));
        var q = el('div', 'de-q', c.item.question);
        var say = speakBtn(function () { return c.item.question; });
        if (say) q.appendChild(say);
        row.appendChild(q);
        if (m.val) {
          var y = el('div', 'de-yours');
          y.appendChild(document.createTextNode(t('drill.yours')));
          y.appendChild(el('b', null, m.val));
          row.appendChild(y);
        }
        var k = el('div', 'de-key');
        k.appendChild(document.createTextNode(t('row.bookKey')));
        k.appendChild(el('b', null, c.item.answer));
        row.appendChild(k);
        var go = el('a', 'de-go', t('drill.openUnit'));
        go.href = '#/b/' + c.bookId + '/unit/' + c.unit.unit;
        go.addEventListener('click', function () { pendingFocus = c.key; });
        row.appendChild(go);
        list.appendChild(row);
      });
      main.appendChild(list);
    }
    window.scrollTo(0, 0);
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
    } catch (e) { ASK.tell(t('stats.exportBad')); }
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
        var incoming;
        try {
          incoming = JSON.parse(reader.result);
          if (!incoming || !incoming.items) throw new Error('bad');
        } catch (e) { return ASK.tell(t('stats.importBad')); }
        // The parse has to finish before the question is asked: confirming no
        // longer blocks, so the work below happens in the answer's callback.
        ASK.confirm(t('stats.importConfirm'), { title: t('stats.import'), yes: t('stats.import') })
          .then(function (ok) {
            if (!ok) return;
            try {
              mergeInto(state, incoming);  // newest answer per question wins
              state.books = {};            // force a recount from merged items
              flush();
              route();
              ASK.tell(t('stats.importOk'));
            } catch (e) { ASK.tell(t('stats.importBad')); }
          });
      };
      reader.readAsText(file);
    });
    inp.click();
  }

  /* ================= find (Ctrl+K) ================= */

  // The sidebar filter only ever knew unit numbers and titles. This one reads
  // the questions themselves, so "where do I practise *used to*?" has an answer.
  var findModal = document.getElementById('findModal');
  var findInput = document.getElementById('findInput');
  var findResults = document.getElementById('findResults');
  var findScopeRow = document.getElementById('findScope');
  var findFoot = document.getElementById('findFoot');
  var findScope = 'book';         // 'all' searches every book, once loaded
  var findLoading = false;
  var findReturnFocus = null;
  var findTimer = null;
  var pendingFocus = null;        // row key to jump to once a unit is rendered
  var FIND_MAX = 40;

  // `book` keeps pointing at the last book opened even after a return to the
  // library, so "am I in a book?" has to come from the route, not from it.
  function inBook() {
    return !!book && parseHash(location.hash).view === 'book';
  }

  function findBooks() {
    if (findScope === 'all' || !inBook()) {
      return BOOKS.map(function (b) { return cache[b.id]; }).filter(Boolean);
    }
    return [book];
  }

  function findAllLoaded() {
    return BOOKS.every(function (b) { return !!cache[b.id]; });
  }

  function findSearch(q) {
    var out = [], seen = 0;
    var books = findBooks();
    for (var bi = 0; bi < books.length && out.length < FIND_MAX * 3; bi++) {
      var bk = books[bi];
      var title = (bk.meta && bk.meta.title) || bk.id;
      for (var ui = 0; ui < bk.units.length; ui++) {
        var u = bk.units[ui];
        var ut = unitTitle(u);
        if (ut && ut.toLowerCase().indexOf(q) > -1) {
          out.push({ rank: 0, bookId: bk.id, bookTitle: title, unit: u.unit, text: 'Unit ' + u.unit + ' — ' + ut });
        }
        var subs = u.subExercises || [];
        for (var si = 0; si < subs.length; si++) {
          var sub = subs[si];
          var items = sub.items || [];
          for (var ii = 0; ii < items.length; ii++) {
            var it = items[ii];
            seen++;
            var hay = (it.question || '');
            var inQ = hay && hay.toLowerCase().indexOf(q) > -1;
            var inA = !inQ && it.answer && String(it.answer).toLowerCase().indexOf(q) > -1;
            if (!inQ && !inA) continue;
            out.push({
              rank: inQ ? 1 : 2,
              bookId: bk.id, bookTitle: title, unit: u.unit,
              sub: sub.number,
              key: keyOf(bk.id, u.unit, sub.number, itemKey(it)),
              text: inQ ? hay : String(it.answer),
              note: inA ? t('find.inAnswer') : ''
            });
            if (out.length >= FIND_MAX * 3) break;
          }
          if (out.length >= FIND_MAX * 3) break;
        }
      }
    }
    out.sort(function (a, b) { return a.rank - b.rank; });
    return { list: out.slice(0, FIND_MAX), more: Math.max(0, out.length - FIND_MAX), scanned: seen };
  }

  // Show the match in place, with the hit picked out, rather than a bare snippet.
  function findSnippet(text, q) {
    var wrap = el('div', 'fr-text');
    var low = text.toLowerCase();
    var at = low.indexOf(q);
    if (at < 0) { wrap.textContent = text; return wrap; }
    var from = Math.max(0, at - 40);
    if (from > 0) wrap.appendChild(document.createTextNode('…'));
    wrap.appendChild(document.createTextNode(text.slice(from, at)));
    wrap.appendChild(el('mark', null, text.slice(at, at + q.length)));
    var tail = text.slice(at + q.length);
    wrap.appendChild(document.createTextNode(tail.length > 90 ? tail.slice(0, 90) + '…' : tail));
    return wrap;
  }

  function findGo(r) {
    pendingFocus = r.key || null;
    closeFind();
    var target = '#/b/' + r.bookId + '/unit/' + r.unit;
    if (location.hash === target) route(); else location.hash = target;
  }

  function findRender() {
    clear(findResults);
    clear(findFoot);
    var q = (findInput.value || '').trim().toLowerCase();

    if (findLoading) {
      findResults.appendChild(el('div', 'find-note', t('find.loading')));
      return;
    }
    if (q.length < 2) {
      findResults.appendChild(el('div', 'find-note', t('find.hint')));
      return;
    }
    if (!findBooks().length) {
      findResults.appendChild(el('div', 'find-note', t('find.noBooks')));
      return;
    }

    var res = findSearch(q);
    if (!res.list.length) {
      var none = el('div', 'find-note', t('find.none'));
      // Everything indexed here is English — the questions and the answer keys
      // of English coursebooks. A Kazakh speaker typing a Kazakh word gets a
      // flat "Nothing found." and no way to tell a missing word from a search
      // that could never have matched. Say which it is.
      // Any Cyrillic at all (U+0400–U+04FF covers both Kazakh and Russian).
      if (/[Ѐ-ӿ]/.test(q)) {
        none.appendChild(el('span', 'find-none-why', t('find.noneKk')));
      }
      findResults.appendChild(none);
      return;
    }
    res.list.forEach(function (r) {
      var row = el('button', 'find-row');
      row.type = 'button';
      var src = el('div', 'fr-src');
      src.appendChild(el('span', 'fr-book', r.bookTitle));
      src.appendChild(el('span', 'fr-unit', 'Unit ' + r.unit + (r.sub ? ' · ' + r.sub : '')));
      if (r.note) src.appendChild(el('span', 'fr-note', r.note));
      row.appendChild(src);
      row.appendChild(findSnippet(r.text, q));
      row.addEventListener('click', function () { findGo(r); });
      findResults.appendChild(row);
    });
    if (res.more) findFoot.appendChild(el('span', null, t('find.more', { n: res.more })));
  }

  function findSetScope(scope) {
    if (scope === 'all' && !findAllLoaded()) {
      findLoading = true;
      findScope = 'all';
      findPaintScope();
      findRender();
      Promise.all(BOOKS.map(function (b) { return loadBook(b.id).catch(function () { return null; }); }))
        .then(function () {
          findLoading = false;
          if (!findModal.hidden) { findPaintScope(); findRender(); }
        });
      return;
    }
    findScope = scope;
    findPaintScope();
    findRender();
  }

  function findPaintScope() {
    clear(findScopeRow);
    if (!inBook()) return;      // outside a book there is nothing else to pick
    [['book', t('find.scopeBook')], ['all', t('find.scopeAll')]].forEach(function (o) {
      var b = el('button', 'fs' + (findScope === o[0] ? ' on' : ''), o[1]);
      b.type = 'button';
      b.addEventListener('click', function () { findSetScope(o[0]); });
      findScopeRow.appendChild(b);
    });
  }

  function openFind() {
    if (!findModal) return;
    findReturnFocus = document.activeElement;
    // Inside a book, start with that book; from the library there is no other
    // sensible scope, so everything gets pulled in.
    findScope = inBook() ? 'book' : 'all';
    findModal.hidden = false;
    findPaintScope();
    if (findScope === 'all') findSetScope('all'); else findRender();
    findInput.value = '';
    findInput.focus();
  }

  function closeFind() {
    if (!findModal || findModal.hidden) return;
    findModal.hidden = true;
    if (findReturnFocus && findReturnFocus.focus) findReturnFocus.focus();
    findReturnFocus = null;
  }

  if (findModal) {
    findInput.addEventListener('input', function () {
      clearTimeout(findTimer);
      findTimer = setTimeout(findRender, 120);
    });
    // Enter opens the first hit — search, glance, jump, without the mouse.
    findInput.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var first = findResults.querySelector('.find-row');
      if (first) { e.preventDefault(); first.click(); }
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest) return;
      if (e.target.closest('[data-open-find]')) { openFind(); return; }
      if (e.target.closest('[data-close-find]')) closeFind();
    });
  }

  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      if (findModal && findModal.hidden) openFind(); else closeFind();
      return;
    }
    if (e.key === 'Escape') closeFind();
  });

  // After a jump from search or from a drill summary, land on the exact row
  // rather than at the top of a forty-question unit.
  function focusPending() {
    var key = pendingFocus;
    pendingFocus = null;
    var row = key && main.querySelector('.row[data-key="' + key + '"]');
    if (!row) { window.scrollTo(0, 0); return; }
    row.scrollIntoView({ block: 'center' });
    row.classList.add('flash');
    setTimeout(function () { row.classList.remove('flash'); }, 1800);
    var inp = row.querySelector('input');
    if (inp) inp.focus();
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

  /* ================= the lock screen ================= */

  // pricing.js carries {kk, en} pairs the way books.js does.
  function langPick(o) {
    if (!o) return '';
    return o[state.lang] || o.kk || '';
  }

  // What a subscription contains, counted rather than written down: every book
  // in index.json marked paid, and the questions inside them. tools/tiers.json
  // is the only place that decides membership, so the offer can never advertise
  // a book that has since gone free.
  function paidSize() {
    var books = 0, items = 0;
    for (var id in INDEX) {
      if (!INDEX[id].paid) continue;
      books++;
      items += INDEX[id].tracked || 0;
    }
    return { books: books, items: items };
  }

  // One plan — a price, what it buys, and the button that starts paying for it.
  function planCard(name, plan) {
    var cfg = window.PRICING || {};
    var box = el('div', 'plan' + (plan.best ? ' best' : ''));
    box.appendChild(el('div', 'plan-name', langPick(plan.title) || name));

    var price = el('div', 'plan-price');
    price.appendChild(el('strong', null, num(plan.price) + ' ' + (plan.currency || '')));
    if (plan.per) price.appendChild(el('span', null, ' ' + langPick(plan.per)));
    box.appendChild(price);

    if (plan.note) box.appendChild(el('div', 'plan-note', langPick(plan.note)));

    // With a Kaspi link the button pays; without one the sale happens in a
    // conversation, so it writes instead. Two buttons would leave a reader
    // choosing between steps that are actually sequential.
    var href = plan.link || (cfg.contact && cfg.contact.href);
    if (href) {
      var go = el('a', 'btn' + (plan.best ? ' primary' : '') + ' plan-go',
        plan.link ? t('offer.pay') : (langPick(cfg.contact.cta) || cfg.contact.label));
      go.href = href;
      go.target = '_blank';
      // An outside site; noopener keeps it from reaching back into this page
      // through window.opener.
      go.rel = 'noopener noreferrer';
      box.appendChild(go);
    }
    return box;
  }

  // The "here is what it costs and how to pay" card. Returns null when there is
  // nothing honest to show — no pricing.js, or no plan with a price — rather
  // than an empty box or a button that does nothing.
  function offerCard() {
    var cfg = window.PRICING || {};
    var plans = cfg.plans || {};
    var contact = cfg.contact || {};
    var names = ['monthly', 'lifetime'].filter(function (n) {
      return plans[n] && (plans[n].price > 0 || plans[n].link);
    });
    if (!names.length && !cfg.kaspi && !contact.label) return null;

    var box = el('div', 'offer');

    var size = paidSize();
    if (size.books) {
      box.appendChild(el('div', 'offer-size',
        t('offer.size', { books: num(size.books), items: num(size.items) })));
    }

    if (names.length) {
      var grid = el('div', 'plan-grid');
      names.forEach(function (n) { grid.appendChild(planCard(n, plans[n])); });
      box.appendChild(grid);
    }

    if (cfg.kaspi) {
      var k = el('div', 'offer-kaspi');
      k.appendChild(document.createTextNode(t('offer.kaspi') + ' '));
      k.appendChild(el('strong', null, cfg.kaspi));
      box.appendChild(k);
    }

    // The step that actually gets the book opened while granting is by hand. It
    // matters more than the price, so it is never hidden behind a missing one.
    if (contact.label) box.appendChild(howToBuy(cfg, names, plans, contact));

    return box;
  }

  // Granting is manual: money arrives as a Kaspi transfer carrying a name, and
  // nothing in it says which account to open. So this is not one sentence but
  // the actual procedure, numbered, with the one piece the reader has to supply
  // spelled out — and, when they are signed in, their address printed for them
  // to copy. A learner who sends the wrong address has paid and stays locked,
  // which is the worst failure this screen has, and it is entirely avoidable by
  // never asking anybody to remember which mailbox they signed up with.
  function howToBuy(cfg, names, plans, contact) {
    var how = el('div', 'offer-how');
    how.appendChild(el('div', 'offer-how-t', t('offer.how')));

    // With no way to pay published — no link, no number — paying itself has to
    // be arranged in the conversation, so it cannot be step one.
    var payable = cfg.kaspi || names.some(function (n) { return plans[n].link; });
    var steps = el('ol', 'offer-steps');

    if (payable) steps.appendChild(el('li', null, t('offer.step.pay')));

    var send = el('li');
    send.appendChild(document.createTextNode(t(payable ? 'offer.step.send' : 'offer.step.ask') + ' '));
    if (contact.href) {
      var a = el('a', null, contact.label);
      a.href = contact.href;
      a.target = '_blank';
      // An outside site; noopener keeps it from reaching back into this page.
      a.rel = 'noopener noreferrer';
      send.appendChild(a);
    } else {
      send.appendChild(el('strong', null, contact.label));
    }
    steps.appendChild(send);

    // "press Check again on this page" — but that button only exists once the
    // reader is signed in, so signed out the last step was pointing at a
    // control that was not on the screen. Signed out, the step is signing in.
    var mail = (window.SYNC && SYNC.email && SYNC.email()) || null;
    steps.appendChild(el('li', null, t(mail ? 'offer.step.wait' : 'offer.step.waitOut')));
    how.appendChild(steps);

    // Signed in: print the address, because "the email you registered with" is
    // a question a lot of people get wrong about themselves. Signed out: say
    // that an account has to exist first — there is nothing to open otherwise.
    if (mail) {
      var box = el('div', 'offer-mail');
      box.appendChild(el('span', 'offer-mail-k', t('offer.yourEmail')));
      box.appendChild(el('strong', null, mail));
      var copy = el('button', 'btn tiny offer-mail-c', t('offer.copy'));
      copy.addEventListener('click', function () {
        copyText(mail).then(function () {
          copy.textContent = t('offer.copied');
          copy.disabled = true;
        });
      });
      box.appendChild(copy);
      how.appendChild(box);
    } else {
      how.appendChild(el('div', 'offer-mail', t('offer.noAccount')));
    }

    return how;
  }

  // A locked book is not a failure, so it does not get the failure screen: no
  // "try again", no error text, and a way forward instead. The two cases differ
  // by one question — is there an account yet — because for a signed-out reader
  // the next step is signing in, not paying.
  function showLocked(id, reason) {
    clear(main);
    var meta = bookMeta(id);
    var signedIn = !!(window.SYNC && SYNC.signedIn() && reason !== 'signed-out');
    var s = el('div', 'empty-state');
    s.appendChild(el('span', 'big', '🔒'));
    s.appendChild(el('div', null, t('lock.title', { id: (meta && meta.title) || id })));
    s.appendChild(el('div', 'instructions', t(signedIn ? 'lock.body' : 'lock.signedOut')));

    var offer = offerCard();
    if (offer) s.appendChild(offer);

    var row = el('div', 'sub-actions');
    row.style.justifyContent = 'center';

    if (!signedIn && window.SYNC && SYNC.configured) {
      var login = el('button', 'btn primary', t('lock.signIn'));
      login.addEventListener('click', openAuthModal);
      row.appendChild(login);
    } else if (signedIn) {
      // The reader who has just paid and is staring at a lock. ENTITLE caches
      // the answer, so the fix is almost always "ask again" — offering it as a
      // button is cheaper than a support message.
      var again = el('button', 'btn primary', t('lock.recheck'));
      again.addEventListener('click', function () {
        again.disabled = true;
        ENTITLE.refresh().then(function () {
          delete cache[id];
          delete pending[id];
          openBook(id, null, null);
        }).catch(function () { again.disabled = false; });
      });
      row.appendChild(again);
    }

    // The textbook itself is never gated — only the exercises around it are. A
    // locked book still opens its PDF, which is what keeps this screen from
    // being a dead end and lets somebody decide whether the book is worth
    // buying by reading it first.
    if (meta && meta.pdf) {
      var read = el('button', 'btn', t('lock.readPdf'));
      read.addEventListener('click', function () { showPdf(null, meta); });
      row.appendChild(read);
    }

    var back = el('a', 'btn', t('load.back'));
    back.href = '#/';
    row.appendChild(back);
    s.appendChild(row);
    main.appendChild(s);
  }

  function showError(id, e) {
    if (e && e.locked) return showLocked(id, e.locked);
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
    // The index first, always. Whether a book is paid is decided by the flag
    // that arrives with it, and a book opened before that answer lands is
    // fetched as a free one — a 404 for a paid book, which then retries and
    // ends on a lock screen with the free sample never asked for. That race is
    // reachable in the app itself: sync.js emitting makes ENTITLE re-ask, which
    // re-routes, which opened the book while data/index.json was still in
    // flight. loadIndex() is one shared promise, so this costs nothing after
    // the first call.
    //
    // Two-argument then: the second handler covers download failures only, so a
    // bug thrown while rendering surfaces in the console instead of being
    // disguised as "the book didn't load".
    loadIndex().then(function () { return loadBook(id); }).then(function (bk) {
      // a later navigation may have won the race
      var m = parseHash(location.hash);
      if (m.view !== 'book' || m.id !== id) return;
      book = bk;
      paintChrome(id);
      bookChanged(bk);
      renderBookView(sub, arg);
    }, function (e) { showError(id, e); });
  }

  var taskSkill = null;        // 'w' | 's' | null — set by route() before rendering

  function renderBookView(sub, arg) {
    setView('book');
    // The book sheet is pinned to a unit's pages, and on a phone it costs half
    // the screen. Mistakes draws on every unit at once and Statistics is a
    // dashboard, so on those two the page it is showing is the wrong one and
    // the room is better spent. `false` keeps the reader's preference: the
    // sheet comes back by itself with the next unit.
    if (pdfOpen() && (sub === 'errors' || sub === 'stats') && window.innerWidth <= 860) {
      hidePdf(false);
    }
    // Every other branch paints the rail on its way through. This one returned
    // before it did, so /unlock — the page a buyer is most likely to land on
    // from a link — showed an empty sidebar next to the offer. The sample units
    // are exactly what somebody deciding whether to pay wants to see.
    if (sub === 'unlock') { renderSidebar(); showLocked(book.id, 'paid'); return; }
    if (sub === 'errors') renderErrors();
    else if (sub === 'stats') renderStats();
    else if (sub === 'exam') renderExam(arg);
    else if (sub === 'taskexam') renderWriteExam(arg);
    else if (sub === 'tasks') renderTasks(arg, taskSkill);
    else if (sub === 'unit') renderUnit(arg);
    else renderUnit(book.units.length ? book.units[0].unit : 1);
  }

  function parseHash(h) {
    h = h || '';
    // '#/drill' is cross-book; '#/drill/<book>' narrows it to one.
    var d = /^#\/drill(?:\/([a-z0-9-]+))?/.exec(h);
    if (d) return { view: 'drill', id: d[1] || 'all' };
    // The word deck. Sub-pages are srs.js's own; an unknown one lands on Today
    // rather than 404-ing, so a stale bookmark still opens something useful.
    var s = /^#\/srs(?:\/([a-z]+))?/.exec(h);
    if (s) {
      var sub = s[1] || '';
      if (sub && (!window.SRS || SRS.subs.indexOf(sub) < 0)) sub = '';
      return { view: 'srs', sub: sub };
    }
    // '#/b/<id>/unit/<n>/exam' is a page of its own rather than a flag on the
    // unit, so a reload in the middle of a mock test comes back to the paper
    // and the browser's back button means "leave the exam".
    // '#/b/<id>/tasks/<test>' — the Writing and Speaking half of an IELTS test.
    // '#/b/<id>/tasks/<test>' — both skills; '/w' or '/s' — one of them, which
    // is what the W1 and S1 entries in the unit list point at. '/w/exam' is the
    // Writing paper under exam conditions, a page of its own for the same
    // reason a Listening one is: a reload in the fiftieth minute comes back to
    // the paper, and Back means "leave the exam".
    var tk = /^#\/b\/([a-z0-9-]+)\/tasks(?:\/(\d+)(?:\/(w|s)(\/exam)?)?)?/.exec(h);
    if (tk) {
      return { view: 'book', id: tk[1], sub: tk[4] ? 'taskexam' : 'tasks',
               arg: tk[2] ? parseInt(tk[2], 10) : null, skill: tk[3] || null };
    }
    var m = /^#\/b\/([a-z0-9-]+)(?:\/(unit)\/(\d+)(\/exam)?|\/(errors|stats|unlock))?/.exec(h);
    if (m) {
      return {
        view: 'book',
        id: m[1],
        sub: m[4] ? 'exam' : (m[2] ? 'unit' : (m[5] || null)),
        arg: m[3] ? parseInt(m[3], 10) : null
      };
    }
    if (h.indexOf('#/users') === 0) return { view: 'users' };
    if (h.indexOf('#/class') === 0) return { view: 'class' };
    // '#/help' and the old '#/books' both land on home; the guide is a dialog
    if (h.indexOf('#/help') === 0) return { view: 'home', help: true };
    return { view: 'home' };
  }

  function route() {
    closeSidebar();
    // Any navigation leaves the exam paper behind. The run itself survives in
    // the store — only its clock display is torn down here, and the page that
    // re-renders the paper starts a new one.
    stopExamTick();
    stopTaskTimers();
    currentTask = null;   // only the page about to render may claim the rail
    if (window.WordLookup) window.WordLookup.hide();
    var r = parseHash(location.hash);
    // Where ◇ goes back to from a session. Every page that is not a session
    // records itself, so "back" is the page the session was started from — the
    // book, at the unit that was open — and not the library the reader would
    // otherwise be thrown out to. Two sessions in a row (one book → all books)
    // keep pointing at the same book, since neither of them overwrites this.
    // The deck is a destination like a session is: leaving a book for it and
    // coming back should land on the unit that was open, not on the library.
    // The user list is the same kind of side trip.
    var aside = r.view === 'drill' || r.view === 'srs' || r.view === 'users' ||
      r.view === 'class';
    if (!aside) backHash = location.hash || '#/';
    // Speech is the exception: a session and the deck keep reading, but leaving
    // a book for the roster is leaving the book.
    if (r.view !== 'drill' && r.view !== 'srs') Speech.stop();
    if (r.view === 'drill') { if (pdfOpen()) hidePdf(false); openDrill(r.id); return; }
    if (r.view === 'srs') { if (pdfOpen()) hidePdf(false); openSrs(r.sub); return; }
    if (r.view === 'users') { if (pdfOpen()) hidePdf(false); openUsers(); return; }
    if (r.view === 'class') { if (pdfOpen()) hidePdf(false); openClasses(); return; }
    if (r.view === 'book') { taskSkill = r.skill || null; openBook(r.id, r.sub, r.arg); return; }
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
  refreshAuthButtons();
  // The deck's badge is driven by srs.js, not by a route: a word saved from a
  // lookup while reading has to show up in the topbar there and then.
  if (window.SRS) {
    refreshSrsBadge();
    SRS.onChange(refreshSrsBadge);
  }
  loadIndex().then(route);
})();
