/* English Vocabulary in Use — Pre-Intermediate
   Offline practice app. No build step, no network. */
(function () {
  'use strict';

  var DATA = window.EVU_DATA || { units: [] };
  var UNITS = DATA.units || [];
  var STORE_KEY = 'evu_v1';
  var MASTER_STREAK = 3;

  /* ================= storage ================= */

  var state = load();

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        if (p && p.items) return { v: 1, items: p.items };
      }
    } catch (e) { /* corrupt or unavailable storage — start fresh */ }
    return { v: 1, items: {} };
  }

  var saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
      catch (e) { /* quota / private mode — keep working in memory */ }
    }, 120);
  }

  function keyOf(unit, subNum, n) { return unit + '|' + subNum + '|' + n; }
  function rec(key) { return state.items[key] || null; }
  function ensure(key) {
    if (!state.items[key]) state.items[key] = { streak: 0, wrong: 0, last: null, mastered: false, val: '', self: false };
    return state.items[key];
  }

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
          // without the bracketed part
          next.push(cur.slice(0, m.index) + ' ' + cur.slice(m.index + m[0].length));
          // with the brackets removed but content kept
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
    // word-level slash choices, plus the untouched original
    var bases = dedupe([raw].concat(expandSlashTokens(raw)));
    for (var i = 0; i < bases.length; i++) {
      var withParens = expandParens(bases[i]);   // optional "(...)" parts
      for (var j = 0; j < withParens.length; j++) {
        add(withParens[j]);                      // whole string as one answer
        var alts = splitAlternatives(withParens[j]);   // phrase-level "/" and " or "
        for (var k = 0; k < alts.length; k++) add(alts[k]);
      }
    }
    return set;
  }

  function isMatch(input, answer) {
    var typed = norm(input);
    if (!typed) return false;
    return !!buildVariants(answer)[typed];
  }

  /* ================= item classification ================= */

  function isExample(it) { return it.isExample === true; }
  // No reliable key to compare against -> learner marks it themselves.
  // `norm(answer)` is empty for keys like "" or "–" (OCR gaps, "no article"),
  // which can never be typed — treat those as self-checked too.
  function isManual(it) {
    return !isExample(it) &&
      (it.answer == null || it.exampleAnswers === true || it.selfCheck === true || !norm(it.answer));
  }
  function isAuto(it) { return !isExample(it) && !isManual(it); }
  // Counted towards progress: everything the learner can answer in a block that
  // has a real answer key ("items" and gap-fill "text" passages).
  function isTracked(sub, it) {
    return (sub.type === 'items' || sub.type === 'text') && !isExample(it);
  }

  function unitStats(u) {
    var total = 0, done = 0, correct = 0, mastered = 0, review = 0;
    (u.subExercises || []).forEach(function (sub) {
      (sub.items || []).forEach(function (it) {
        if (!isTracked(sub, it)) return;
        total++;
        var r = rec(keyOf(u.unit, sub.number, it.n));
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

  function allErrors() {
    var groups = [];
    UNITS.forEach(function (u) {
      var list = [];
      (u.subExercises || []).forEach(function (sub) {
        (sub.items || []).forEach(function (it) {
          if (isExample(it)) return;
          var r = rec(keyOf(u.unit, sub.number, it.n));
          if (r && r.wrong > 0 && !r.mastered) list.push({ sub: sub, item: it });
        });
      });
      if (list.length) groups.push({ unit: u, list: list });
    });
    return groups;
  }

  function errorCount() {
    return allErrors().reduce(function (n, g) { return n + g.list.length; }, 0);
  }

  /* ================= tiny DOM helpers ================= */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  var main = document.getElementById('main');
  var unitListEl = document.getElementById('unitList');
  var searchEl = document.getElementById('search');
  var errBadge = document.getElementById('errBadge');
  var sidebar = document.getElementById('sidebar');
  var overlay = document.getElementById('overlay');

  /* ================= sidebar ================= */

  var currentUnit = null;

  function renderSidebar() {
    var q = (searchEl.value || '').trim().toLowerCase();
    clear(unitListEl);
    var shown = 0;
    UNITS.forEach(function (u) {
      if (q) {
        var hay = u.unit + ' ' + (u.title || '').toLowerCase();
        if (hay.indexOf(q) === -1) return;
      }
      shown++;
      var st = unitStats(u);
      var li = el('li');
      var a = el('a', 'unit-link' + (currentUnit === u.unit ? ' current' : ''));
      a.href = '#/unit/' + u.unit;
      a.appendChild(el('span', 'u-num', String(u.unit)));
      a.appendChild(el('span', 'u-title', u.title || ''));
      var full = st.total > 0 && st.pct === 100;
      a.appendChild(el('span', 'u-pct' + (full ? ' done' : ''), full ? '✓' : (st.done ? st.pct + '%' : '')));
      li.appendChild(a);
      unitListEl.appendChild(li);
    });
    if (!shown) unitListEl.appendChild(el('div', 'empty-hint', 'Ештеңе табылмады.'));
  }

  function refreshBadge() {
    var n = errorCount();
    errBadge.textContent = n;
    errBadge.hidden = n === 0;
  }

  function setTab(name) {
    [].forEach.call(document.querySelectorAll('.tab'), function (t) {
      t.classList.toggle('active', t.getAttribute('data-tab') === name);
    });
  }

  /* ================= item row ================= */

  // Builds one interactive row. Returns the element.
  function buildRow(unitNo, sub, it) {
    var key = keyOf(unitNo, sub.number, it.n);
    var row = el('div', 'row');
    row.setAttribute('data-key', key);

    row.appendChild(el('div', 'n', it.n != null ? String(it.n) : ''));
    var body = el('div', 'row-body');
    row.appendChild(body);

    /* --- example: nothing to answer --- */
    if (isExample(it)) {
      row.classList.add('example');
      var ex = el('div', 'example-text');
      ex.appendChild(el('span', 'tag', 'мысал'));
      if (it.question) {
        var b = el('b'); b.textContent = it.question; ex.appendChild(b);
      } else {
        ex.appendChild(document.createTextNode('PDF-тен оқы'));
      }
      if (it.answer) ex.appendChild(document.createTextNode(' — ' + it.answer));
      body.appendChild(ex);
      return row;
    }

    /* --- question text --- */
    var q = el('div', 'q');
    if (it.question) {
      q.textContent = it.question;
    } else if (sub.type === 'text') {
      // the passage above already shows the numbered gap
      q.className = 'q none';
      q.textContent = '№' + it.n + ' бос орын';
    } else {
      q.className = 'q none';
      q.textContent = 'Сурет/кесте — PDF-тен қара';
    }
    if (isManual(it)) {
      var tg = el('span', 'tag self', 'өзің тексер');
      q.insertBefore(tg, q.firstChild);
    }
    body.appendChild(q);

    /* --- input + buttons --- */
    var line = el('div', 'answer-line');
    var input = el('input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.autocapitalize = 'off';
    input.spellcheck = false;
    input.placeholder = 'Жауабың…';
    var r0 = rec(key);
    if (r0 && r0.val) input.value = r0.val;
    line.appendChild(input);

    var feedback = el('div', 'feedback');

    function paint() {
      var r = rec(key);
      row.classList.remove('correct', 'wrong', 'mastered');
      clear(feedback);
      if (!r || !r.last) return;

      if (r.mastered) row.classList.add('mastered');
      else row.classList.add(r.last === 'correct' ? 'correct' : 'wrong');

      var status = el('span', 'status ' + (r.mastered ? 'gold' : (r.last === 'correct' ? 'ok' : 'bad')));
      if (r.last === 'correct') {
        status.textContent = r.mastered ? '★ меңгерілді' : '✓ дұрыс — ' + r.streak + '/' + MASTER_STREAK + ' қатарынан';
      } else {
        status.textContent = '✗ қате';
      }
      feedback.appendChild(status);

      if (it.answer) {
        var k = el('span', 'key');
        k.appendChild(document.createTextNode('Кітап: '));
        var kb = el('b'); kb.textContent = it.answer;
        k.appendChild(kb);
        feedback.appendChild(k);
      }
      if (r.self) feedback.appendChild(el('span', 'key', '(өзің белгіледің)'));

      if (r.last === 'wrong') {
        var ov = el('button', 'btn small ok', 'Мен дұрыс жаздым');
        ov.addEventListener('click', function () { mark(true, true); });
        feedback.appendChild(ov);
      }
    }

    function mark(correct, self) {
      var r = ensure(key);
      r.val = input.value;
      r.self = !!self;
      if (correct) {
        r.streak = (r.streak || 0) + 1;
        r.last = 'correct';
        if (r.streak >= MASTER_STREAK) r.mastered = true;
      } else {
        r.streak = 0;
        r.wrong = (r.wrong || 0) + 1;
        r.last = 'wrong';
        r.mastered = false;
      }
      save();
      paint();
      afterChange();
    }

    // Returns true when a check actually ran.
    function check() {
      if (!input.value.trim()) { input.focus(); return false; }
      if (isManual(it)) return false;      // needs a manual verdict
      mark(isMatch(input.value, it.answer), false);
      return true;
    }
    row._check = check;
    row._input = input;

    if (isManual(it)) {
      var okB = el('button', 'btn small ok', '✓ Дұрыс');
      var badB = el('button', 'btn small bad', '✗ Қате');
      okB.addEventListener('click', function () { if (input.value.trim()) mark(true, true); else input.focus(); });
      badB.addEventListener('click', function () { if (input.value.trim()) mark(false, true); else input.focus(); });
      line.appendChild(okB);
      line.appendChild(badB);
    } else {
      var chk = el('button', 'btn small primary', 'Тексеру');
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

    body.appendChild(line);
    body.appendChild(feedback);
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
    var labels = { items: 'жаттығу', open: 'өз ойың', freeform: 'еркін',
                   crossword: 'кроссворд', text: 'мәтін' };
    head.appendChild(el('span', 'type-tag', labels[sub.type] || sub.type));
    box.appendChild(head);

    if (sub.instructions) box.appendChild(el('div', 'instructions', sub.instructions));

    // gap-fill passage: shown once, the gaps are numbered in the text
    if (sub.passage) box.appendChild(el('div', 'passage', sub.passage));

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
      var ansBox = el('div', 'raw answer', sub.rawAnswer || 'Жауап жоқ — PDF-тен қара');
      ansBox.hidden = true;
      var show = el('button', 'btn small', 'Жауапты көрсету');
      show.addEventListener('click', function () {
        ansBox.hidden = !ansBox.hidden;
        show.textContent = ansBox.hidden ? 'Жауапты көрсету' : 'Жауапты жасыру';
      });
      var acts = el('div', 'sub-actions');
      acts.appendChild(show);
      box.appendChild(acts);
      box.appendChild(ansBox);
      return box;
    }

    if (sub.type === 'crossword') {
      box.appendChild(el('div', 'note', '🧩 Бұл кроссворд — торды PDF-тен шеш.' + (sub.note ? ' ' + sub.note : '')));
      return box;
    }

    var items = sub.items || [];
    if (!items.length) {
      box.appendChild(el('div', 'note', 'Бұл тапсырманы PDF-тен орында.'));
      return box;
    }

    var hasCheckable = false;
    items.forEach(function (it) {
      box.appendChild(buildRow(unitNo, sub, it));
      if (isAuto(it)) hasCheckable = true;
    });

    if (hasCheckable) {
      var actions = el('div', 'sub-actions');
      var btn = el('button', 'btn small', 'Тапсырманы тексеру');
      btn.addEventListener('click', function () { checkAllIn(box); });
      actions.appendChild(btn);
      box.appendChild(actions);
    }
    return box;
  }

  /* ================= pages ================= */

  var afterChange = function () {};

  function renderUnit(no) {
    var u = null;
    for (var i = 0; i < UNITS.length; i++) if (UNITS[i].unit === no) { u = UNITS[i]; break; }
    if (!u) { renderNotFound(no); return; }

    currentUnit = no;
    setTab('units');
    clear(main);

    var head = el('div', 'page-head');
    head.appendChild(el('h1', null, 'Unit ' + u.unit + ' — ' + (u.title || '')));

    var chips = el('div', 'chips');
    if (u.pdfExercisePage != null) {
      var pages = (u.pdfPages && u.pdfPages.length > 1)
        ? u.pdfPages.join('–') : String(u.pdfExercisePage);
      var c1 = el('span', 'chip');
      c1.appendChild(document.createTextNode('📄 Жаттығу беті: '));
      c1.appendChild(el('strong', null, pages));
      chips.appendChild(c1);
    }
    if (u.pdfIntroPage != null) {
      var c2 = el('span', 'chip');
      c2.appendChild(document.createTextNode('📖 Теория беті: '));
      c2.appendChild(el('strong', null, String(u.pdfIntroPage)));
      chips.appendChild(c2);
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

    (u.subExercises || []).forEach(function (sub) { main.appendChild(buildSub(u.unit, sub)); });

    /* footer */
    var foot = el('div', 'unit-foot');
    var score = el('div', 'score');
    foot.appendChild(score);

    var allBtn = el('button', 'btn primary', 'Барлығын тексеру');
    allBtn.addEventListener('click', function () { checkAllIn(main); });
    foot.appendChild(allBtn);

    var nav = el('div', 'nav-links');
    var prev = el('span');
    var next = el('span');
    if (no > 1) {
      var pa = el('a', null, '← Unit ' + (no - 1));
      pa.href = '#/unit/' + (no - 1);
      prev.appendChild(pa);
    }
    if (no < UNITS[UNITS.length - 1].unit) {
      var na = el('a', null, 'Unit ' + (no + 1) + ' →');
      na.href = '#/unit/' + (no + 1);
      next.appendChild(na);
    }
    nav.appendChild(prev);
    nav.appendChild(next);
    foot.appendChild(nav);
    main.appendChild(foot);

    function refresh() {
      var st = unitStats(u);
      fill.style.width = st.pct + '%';
      bar.classList.toggle('full', st.pct === 100 && st.total > 0);
      pctEl.textContent = st.pct + '%';
      clear(score);
      score.appendChild(document.createTextNode(st.correct + '/' + st.total + ' дұрыс — ' + st.pct + '%'));
      score.appendChild(el('span', 'muted', '  ·  ★ меңгерілді: ' + st.mastered + '  ·  қайталау: ' + st.review));
      renderSidebar();
      refreshBadge();
    }
    afterChange = refresh;
    refresh();
    window.scrollTo(0, 0);
  }

  function renderNotFound(no) {
    clear(main);
    var s = el('div', 'empty-state');
    s.appendChild(el('span', 'big', '🤔'));
    s.appendChild(el('div', null, 'Unit ' + no + ' табылмады.'));
    main.appendChild(s);
  }

  function renderErrors() {
    currentUnit = null;
    setTab('errors');
    clear(main);
    afterChange = function () { renderSidebar(); refreshBadge(); };

    var head = el('div', 'page-head');
    head.appendChild(el('h1', null, 'Қателер — қайталау'));
    main.appendChild(head);

    var groups = allErrors();
    if (!groups.length) {
      var s = el('div', 'empty-state');
      s.appendChild(el('span', 'big', '🎉'));
      s.appendChild(el('div', null, 'Қайталайтын қате жоқ.'));
      main.appendChild(s);
      renderSidebar();
      refreshBadge();
      return;
    }

    head.appendChild(el('div', 'instructions',
      'Қате жіберген және әлі меңгерілмеген сұрақтар. Қатарынан ' + MASTER_STREAK + ' рет дұрыс жауап берсең, тізімнен шығады.'));

    groups.forEach(function (g) {
      var box = el('div', 'sub err-group');
      var h = el('div', 'err-head');
      var t = el('h2');
      var link = el('a', null, 'Unit ' + g.unit.unit + ' — ' + (g.unit.title || ''));
      link.href = '#/unit/' + g.unit.unit;
      t.appendChild(link);
      h.appendChild(t);
      var meta = '📄 ' + (g.unit.pdfExercisePage != null ? 'бет ' + g.unit.pdfExercisePage + ' · ' : '') + g.list.length + ' сұрақ';
      h.appendChild(el('span', 'meta', meta));
      box.appendChild(h);

      g.list.forEach(function (e) {
        var lbl = el('div', 'instructions', e.sub.number + ' · ' + (e.sub.instructions || ''));
        box.appendChild(lbl);
        box.appendChild(buildRow(g.unit.unit, e.sub, e.item));
      });
      main.appendChild(box);
    });

    renderSidebar();
    refreshBadge();
    window.scrollTo(0, 0);
  }

  function renderStats() {
    currentUnit = null;
    setTab('stats');
    clear(main);
    afterChange = function () { renderSidebar(); refreshBadge(); };

    var rows = UNITS.map(function (u) { return { u: u, st: unitStats(u) }; });
    var tot = rows.reduce(function (a, r) {
      a.total += r.st.total; a.done += r.st.done; a.correct += r.st.correct;
      a.mastered += r.st.mastered; a.review += r.st.review;
      return a;
    }, { total: 0, done: 0, correct: 0, mastered: 0, review: 0 });
    var totalPct = tot.total ? Math.round(tot.correct / tot.total * 100) : 0;

    var head = el('div', 'page-head');
    head.appendChild(el('h1', null, 'Статистика'));
    main.appendChild(head);

    var cards = el('div', 'cards');
    function card(k, v, cls) {
      var c = el('div', 'card' + (cls ? ' ' + cls : ''));
      c.appendChild(el('div', 'k', k));
      c.appendChild(el('div', 'v', v));
      cards.appendChild(c);
    }
    card('Жалпы прогресс', totalPct + '%');
    card('Жасалған сұрақ', tot.done + ' / ' + tot.total);
    card('★ Меңгерілді', String(tot.mastered), 'gold');
    card('Қайталауды күтеді', String(tot.review), tot.review ? 'bad' : '');
    main.appendChild(cards);

    var active = rows.filter(function (r) { return r.st.done > 0; })
      .sort(function (a, b) { return a.st.pct - b.st.pct || a.u.unit - b.u.unit; });
    var idle = rows.filter(function (r) { return r.st.done === 0; });

    var wrap = el('div', 'table-wrap');
    var table = el('table');
    var thead = el('thead');
    var trh = el('tr');
    ['Unit', 'Тақырып', 'Жасалды', 'Дұрыс', 'Қайталау', '★', 'Прогресс'].forEach(function (h, i) {
      var th = el('th', i >= 2 && i <= 5 ? 'num' : null, h);
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    table.appendChild(thead);

    var tbody = el('tbody');
    function addRow(r, dim) {
      var tr = el('tr', dim ? 'untouched' : null);
      tr.addEventListener('click', function () { location.hash = '#/unit/' + r.u.unit; });
      tr.appendChild(el('td', 'num', String(r.u.unit)));
      tr.appendChild(el('td', 't-title', r.u.title || ''));
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
    }
    active.forEach(function (r) { addRow(r, false); });
    idle.forEach(function (r) { addRow(r, true); });
    table.appendChild(tbody);
    wrap.appendChild(table);

    if (active.length) main.appendChild(el('div', 'section-title', 'Барлық units (басталғандары жоғарыда)'));
    main.appendChild(wrap);

    var reset = el('button', 'btn danger', 'Барлық прогресті өшіру');
    reset.style.marginTop = '20px';
    reset.addEventListener('click', function () {
      if (!confirm('Барлық прогресс өшеді. Сенімдісің бе?')) return;
      state = { v: 1, items: {} };
      try { localStorage.removeItem(STORE_KEY); } catch (e) {}
      renderStats();
      renderSidebar();
      refreshBadge();
    });
    main.appendChild(reset);

    renderSidebar();
    refreshBadge();
    window.scrollTo(0, 0);
  }

  /* ================= routing ================= */

  function route() {
    closeSidebar();
    var h = location.hash || '';
    var m = /^#\/unit\/(\d+)/.exec(h);
    if (m) { renderUnit(parseInt(m[1], 10)); }
    else if (h.indexOf('#/errors') === 0) { renderErrors(); }
    else if (h.indexOf('#/stats') === 0) { renderStats(); }
    else { renderUnit(UNITS.length ? UNITS[0].unit : 1); }
  }

  /* ================= sidebar toggle (mobile) ================= */

  function openSidebar() { sidebar.classList.add('open'); overlay.hidden = false; }
  function closeSidebar() { sidebar.classList.remove('open'); overlay.hidden = true; }

  document.getElementById('menuBtn').addEventListener('click', function () {
    if (sidebar.classList.contains('open')) closeSidebar(); else openSidebar();
  });
  overlay.addEventListener('click', closeSidebar);
  searchEl.addEventListener('input', renderSidebar);

  window.addEventListener('hashchange', route);

  renderSidebar();
  refreshBadge();
  route();
})();
