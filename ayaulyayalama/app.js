/* Essential Grammar Practice — vanilla JS, серверсіз */
(function () {
"use strict";

/* ---------------------------------------------------------------- деректер */
var UNITS = window.EGU_DATA.map(function (u) {
  return {
    unit: u[0], title: u[1], pdf: u[2],
    exercises: u[3].map(function (e) {
      var flags = e[3] || 0;
      return {
        number: e[0], instructions: e[1], wordBank: e[2],
        firstIsExample: (flags & 1) === 1,
        exampleAnswers: (flags & 2) === 2,
        items: e[4].map(function (a, i) {
          return { n: i + 1, answer: a, isExample: i === 0 && (flags & 1) === 1 };
        })
      };
    })
  };
});
var UNIT_BY_NUM = {};
UNITS.forEach(function (u) { UNIT_BY_NUM[u.unit] = u; });

/* ---------------------------------------------------------------- прогресс */
var STORE_KEY = "egu_essential_v1";
var MASTER_STREAK = 3;
var progress = load();

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
  catch (e) { return {}; }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(progress)); }
  catch (e) { /* quota — үнсіз өтеміз */ }
}
function key(unit, exNum, n) { return unit + "|" + exNum + "|" + n; }
function stateOf(k) { return progress[k] || { s: 0, w: 0, m: false, l: null }; }
function record(k, correct) {
  var st = stateOf(k);
  if (correct) {
    st.s = (st.s || 0) + 1;
    st.l = "ok";
    if (st.s >= MASTER_STREAK) st.m = true;
  } else {
    st.s = 0; st.l = "bad"; st.m = false;
    st.w = (st.w || 0) + 1;
  }
  progress[k] = st; save();
}

/* Бағаланатын item-дер (үлгілерден басқасы) */
function gradableItems(u) {
  var out = [];
  u.exercises.forEach(function (ex) {
    ex.items.forEach(function (it) {
      if (!it.isExample) out.push({ ex: ex, item: it });
    });
  });
  return out;
}
function unitStats(u) {
  var list = gradableItems(u), ok = 0, mastered = 0, wrong = 0;
  list.forEach(function (g) {
    var st = stateOf(key(u.unit, g.ex.number, g.item.n));
    if (st.l === "ok") ok++;
    if (st.m) mastered++;
    if (st.w > 0 && !st.m) wrong++;
  });
  return { total: list.length, ok: ok, mastered: mastered, wrong: wrong,
           pct: list.length ? Math.round(ok / list.length * 100) : 0 };
}
function errorList() {
  var out = [];
  UNITS.forEach(function (u) {
    u.exercises.forEach(function (ex) {
      ex.items.forEach(function (it) {
        if (it.isExample) return;
        var st = stateOf(key(u.unit, ex.number, it.n));
        if (st.w > 0 && !st.m) out.push({ u: u, ex: ex, item: it, st: st });
      });
    });
  });
  out.sort(function (a, b) { return b.st.w - a.st.w; });
  return out;
}

/* ------------------------------------------------------- икемді салыстыру */
function norm(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[.,!?;:"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function isDash(s) {
  var n = norm(s).replace(/[()\-]/g, " ").replace(/\s+/g, " ").trim();
  return n === "" || n === "no preposition";
}
function noApos(s) { return s.replace(/'/g, ""); }
/* "they're/they are cold" → [they're, they, are, cold] */
function allTokens(s) { return norm(s).split(/[\s/]+/).filter(Boolean); }
/* Кітапта "/" әртүрлі ұзындықтағы баламаны білдіреді (they’re / they are).
   Сондықтан кірісті жауап токендерінің реттік ішкі тізбегі ретінде де қабылдаймыз. */
function subsequenceOk(input, answer) {
  var got = norm(input).split(/\s+/).filter(Boolean);
  var toks = allTokens(answer);
  if (!got.length || !toks.length) return false;
  if (got.length * 2 < toks.length) return false;           // тым қысқа жауап
  var pos = 0;
  for (var i = 0; i < got.length; i++) {
    var at = -1;
    for (var j = pos; j < toks.length; j++) {
      if (toks[j] === got[i] || noApos(toks[j]) === noApos(got[i])) { at = j; break; }
    }
    if (at < 0) return false;
    pos = at + 1;
  }
  return got[got.length - 1] === toks[toks.length - 1] ||
         noApos(got[got.length - 1]) === noApos(toks[toks.length - 1]);
}
/* "a/b c" → ["a c","b c"] (токен деңгейінде, комбинация саны шектеулі) */
function slashExpand(str) {
  var toks = str.split(" "), out = [""], cap = 32;
  for (var i = 0; i < toks.length; i++) {
    var opts = toks[i].indexOf("/") > -1 ? toks[i].split("/") : [toks[i]];
    var next = [];
    for (var a = 0; a < out.length; a++)
      for (var b = 0; b < opts.length; b++) {
        next.push(out[a] ? out[a] + " " + opts[b] : opts[b]);
        if (next.length > cap) break;
      }
    out = next;
    if (out.length > cap) break;
  }
  return out;
}
/* Жауаптан қабылданатын нұсқалар жинағын жасау */
function variantsOf(answer) {
  var seeds = [answer];
  // "or" арқылы берілген баламалар
  var alts = [];
  seeds.forEach(function (s) {
    s.split(/\s+or\s+/i).forEach(function (p) { if (p.trim()) alts.push(p.trim()); });
  });
  seeds = alts.length ? alts : seeds;
  // жақшалар: мазмұнымен де, онсыз да
  var withParens = [];
  seeds.forEach(function (s) {
    withParens.push(s.replace(/[()]/g, " "));
    withParens.push(s.replace(/\([^)]*\)/g, " "));
  });
  // қиғаш сызық
  var final = [];
  withParens.forEach(function (s) {
    var n = norm(s);
    if (n) final.push(n);
    if (s.indexOf("/") > -1) {
      slashExpand(n).forEach(function (v) { if (v) final.push(norm(v)); });
      n.split("/").forEach(function (v) { if (norm(v)) final.push(norm(v)); });
    }
  });
  var seen = {}, uniq = [];
  final.forEach(function (v) { if (v && !seen[v]) { seen[v] = 1; uniq.push(v); } });
  return uniq;
}
function levRatio(a, b) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  var prev = [], cur = [], i, j;
  for (j = 0; j <= b.length; j++) prev[j] = j;
  for (i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1,
                        prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
    }
    prev = cur.slice();
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}
/* → {ok:bool, close:bool} */
function checkAnswer(input, answer) {
  var got = norm(input);
  if (!got) return { ok: false, close: false };
  if (isDash(answer)) return { ok: isDash(input), close: false };

  var vars = variantsOf(answer), best = 0;
  for (var i = 0; i < vars.length; i++) {
    var v = vars[i];
    if (v.indexOf("...") > -1) {           // "is ... are" — бөліктері реті бойынша
      var parts = v.split("...").map(function (p) { return p.trim(); }).filter(Boolean);
      var pos = 0, all = true;
      for (var p = 0; p < parts.length; p++) {
        var at = got.indexOf(parts[p], pos);
        if (at < 0) { all = false; break; }
        pos = at + parts[p].length;
      }
      if (all) return { ok: true, close: false };
      continue;
    }
    if (got === v) return { ok: true, close: false };
    if (noApos(got) === noApos(v)) return { ok: true, close: true };  // апостроф түсіп қалған
    best = Math.max(best, levRatio(got, v));
  }
  if (answer.indexOf("/") > -1 && subsequenceOk(input, answer)) return { ok: true, close: false };
  if (best >= 0.92) return { ok: true, close: true };   // ұсақ айырма — кешіреміз
  return { ok: false, close: false };
}

/* ---------------------------------------------------------------- көрініс */
var view = document.getElementById("view");
var unitListEl = document.getElementById("unitList");
var searchEl = document.getElementById("search");
var sidebar = document.getElementById("sidebar");
var state = { view: "units", unit: UNITS[0].unit, q: "" };

function el(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/* ---- sidebar ---- */
function renderSidebar() {
  unitListEl.innerHTML = "";
  var q = state.q.toLowerCase();
  UNITS.forEach(function (u) {
    var label = u.unit + " — " + u.title;
    if (q && label.toLowerCase().indexOf(q) < 0) return;
    var st = unitStats(u);
    var b = el("button", "unit-item" + (u.unit === state.unit && state.view === "units" ? " active" : "") + (st.pct === 100 ? " done" : ""));
    b.appendChild(el("span", "num", String(u.unit)));
    b.appendChild(el("span", "name", u.title));
    b.appendChild(el("span", "pct", st.pct === 100 ? "✓" : (st.pct ? st.pct + "%" : "")));
    b.onclick = function () { openUnit(u.unit); };
    unitListEl.appendChild(b);
  });
}
function openUnit(n) {
  state.view = "units"; state.unit = n;
  setTab("units"); sidebar.classList.remove("open");
  render(); window.scrollTo(0, 0);
}

/* ---- unit беті ---- */
function renderUnit() {
  var u = UNIT_BY_NUM[state.unit];
  view.innerHTML = "";

  var head = el("div", "unit-head");
  head.appendChild(el("div", "eyebrow", "Unit " + u.unit));
  head.appendChild(el("h2", null, u.title));
  head.appendChild(el("span", "pdf-tag", "📄 PDF б. " + u.pdf));
  head.appendChild(el("div", "hint", "Сұрақ сөйлемдерін PDF-тен оқы — мұнда тек жауап өрістері."));
  view.appendChild(head);

  u.exercises.forEach(function (ex) { view.appendChild(renderExercise(u, ex)); });

  var foot = el("div", "unit-score");
  foot.id = "unitScore";
  view.appendChild(foot);
  updateUnitScore();
}

function renderExercise(u, ex) {
  var box = el("div", "ex");
  var h = el("div", "ex-head");
  h.appendChild(el("span", "ex-num", ex.number));
  if (ex.instructions) h.appendChild(el("span", "ex-instr", ex.instructions));
  if (ex.exampleAnswers) h.appendChild(el("span", "ex-note", "example answers — өзің тексер"));
  box.appendChild(h);

  if (ex.wordBank) {
    var wb = el("div", "wordbank");
    ex.wordBank.split(/\s+/).forEach(function (w) { if (w) wb.appendChild(el("span", "chip", w)); });
    box.appendChild(wb);
  }

  var gradable = ex.items.filter(function (i) { return !i.isExample; });
  if (!gradable.length) {
    box.appendChild(el("div", "empty-note", "Бұл тапсырманың жауап кілті жоқ — PDF-тен қарап өзің орында."));
    return box;
  }

  var rows = el("div", "rows");
  ex.items.forEach(function (it) {
    rows.appendChild(it.isExample ? exampleRow(it) : itemRow(u, ex, it));
  });
  box.appendChild(rows);

  var foot = el("div", "ex-foot");
  var checkAll = el("button", "btn primary", "Бәрін тексеру");
  checkAll.onclick = function () {
    box.querySelectorAll(".row[data-k]").forEach(function (r) {
      var inp = r.querySelector("input");
      if (inp && inp.value.trim()) r._check();
    });
  };
  foot.appendChild(checkAll);
  var clear = el("button", "btn", "Тазарту");
  clear.onclick = function () {
    box.querySelectorAll(".row[data-k]").forEach(function (r) {
      var inp = r.querySelector("input");
      if (inp) inp.value = "";
      r.className = "row";
      var fb = r.nextSibling;
      if (fb && fb.classList && fb.classList.contains("feedback")) fb.remove();
    });
  };
  foot.appendChild(clear);
  box.appendChild(foot);
  return box;
}

function exampleRow(it) {
  var r = el("div", "row example");
  r.appendChild(el("span", "n", it.n + "."));
  r.appendChild(el("span", null, "үлгі (кітапта дайын жауап)"));
  return r;
}

function itemRow(u, ex, it) {
  var k = key(u.unit, ex.number, it.n);
  var st = stateOf(k);
  var selfCheck = it.answer == null || ex.exampleAnswers;

  var r = el("div", "row");
  r.setAttribute("data-k", k);
  r.appendChild(el("span", "n", it.n + "."));

  var inp = document.createElement("input");
  inp.type = "text";
  inp.autocomplete = "off"; inp.autocapitalize = "off"; inp.spellcheck = false;
  inp.placeholder = selfCheck ? "жауабыңды жаз, содан кейін кітаппен салыстыр" : "";
  r.appendChild(inp);

  function feedback(cls, html) {
    var nx = r.nextSibling;
    if (nx && nx.classList && nx.classList.contains("feedback")) nx.remove();
    var f = el("div", "feedback " + cls);
    f.innerHTML = html;
    r.parentNode.insertBefore(f, r.nextSibling);
  }
  function mark(ok, note) {
    r.className = "row " + (ok ? "ok" : "bad");
    record(k, ok);
    var s = stateOf(k);
    var tail = s.m ? ' <span class="mastered">✓ меңгерілді</span>'
                   : ' <span class="key">(қатарынан ' + s.s + "/" + MASTER_STREAK + ")</span>";
    feedback(ok ? "ok" : "bad", (ok ? "✓ Дұрыс" : "✗ Қате") + (note || "") + tail);
    updateUnitScore(); renderSidebar(); updateBadge();
  }

  if (selfCheck) {
    var okB = el("button", "btn ghost-ok", "✓ Дұрыс");
    var badB = el("button", "btn ghost-bad", "✗ Қате");
    okB.onclick = function () { mark(true, it.answer ? ' <span class="key">кітап: <b>' + escapeHtml(it.answer) + "</b></span>" : ""); };
    badB.onclick = function () { mark(false, it.answer ? ' <span class="key">кітап: <b>' + escapeHtml(it.answer) + "</b></span>" : ""); };
    r.appendChild(okB); r.appendChild(badB);
    r._check = function () { /* өзі-тексеру: автотексеру жоқ */ };
  } else {
    var btn = el("button", "btn", "Тексеру");
    r._check = function () {
      var res = checkAnswer(inp.value, it.answer);
      var note = "";
      if (res.ok && res.close) note = ' <span class="key">(кітапта: <b>' + escapeHtml(it.answer) + "</b>)</span>";
      if (!res.ok) note = ' <span class="key">кітап: <b>' + escapeHtml(it.answer) + "</b></span>";
      mark(res.ok, note);
    };
    btn.onclick = r._check;
    inp.onkeydown = function (e) { if (e.key === "Enter") r._check(); };
    r.appendChild(btn);
  }

  if (st.m) r.classList.add("ok");
  return r;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}

function updateUnitScore() {
  var box = document.getElementById("unitScore");
  if (!box) return;
  var u = UNIT_BY_NUM[state.unit], s = unitStats(u);
  box.innerHTML = "";
  box.appendChild(el("span", null, "Unit " + u.unit + " нәтижесі:"));
  var b = el("b", null, s.ok + "/" + s.total);
  box.appendChild(b);
  box.appendChild(el("span", null, "— " + s.pct + "%"));
  if (s.mastered) box.appendChild(el("span", "score", "меңгерілген: " + s.mastered));
  if (s.wrong) box.appendChild(el("span", "score", "қайталау керек: " + s.wrong));
}

/* ---- Қателер беті ---- */
function renderErrors() {
  view.innerHTML = "";
  var list = errorList();
  var head = el("div", "page-head");
  head.appendChild(el("h2", null, "Қателермен жұмыс"));
  head.appendChild(el("p", null, list.length
    ? "Қатарынан " + MASTER_STREAK + " рет дұрыс жауап берсең, item тізімнен шығады."
    : "Қате жоқ — тізім бос. 🎉"));
  view.appendChild(head);

  list.forEach(function (e) {
    var box = el("div", "err-item");
    var meta = el("div", "err-meta");
    var lnk = el("span", "lnk", "Unit " + e.u.unit + " · " + e.ex.number + " · №" + e.item.n);
    lnk.onclick = function () { openUnit(e.u.unit); };
    meta.appendChild(lnk);
    meta.appendChild(el("span", null, "📄 PDF б. " + e.u.pdf));
    meta.appendChild(el("span", "streak", "қате: " + e.st.w + " · қатарынан дұрыс: " + (e.st.s || 0) + "/" + MASTER_STREAK));
    box.appendChild(meta);
    if (e.ex.instructions) box.appendChild(el("div", "ex-instr", e.ex.instructions));
    if (e.ex.wordBank) {
      var wb = el("div", "wordbank");
      e.ex.wordBank.split(/\s+/).forEach(function (w) { if (w) wb.appendChild(el("span", "chip", w)); });
      box.appendChild(wb);
    }
    var rows = el("div", "rows");
    rows.appendChild(itemRow(e.u, e.ex, e.item));
    box.appendChild(rows);
    view.appendChild(box);
  });
}

/* ---- Статистика беті ---- */
function renderStats() {
  view.innerHTML = "";
  var head = el("div", "page-head");
  head.appendChild(el("h2", null, "Статистика"));
  head.appendChild(el("p", null, "Ең әлсіз unit-тар алдымен. Жолға бассаң — сол unit ашылады."));
  view.appendChild(head);

  var total = 0, ok = 0, mastered = 0, wrong = 0;
  var rows = UNITS.map(function (u) {
    var s = unitStats(u);
    total += s.total; ok += s.ok; mastered += s.mastered; wrong += s.wrong;
    return { u: u, s: s };
  });

  var cards = el("div", "cards");
  [["Барлық item", total], ["Дұрыс жауап берілген", ok], ["Меңгерілген", mastered], ["Қайталауды күтеді", wrong]]
    .forEach(function (c) {
      var card = el("div", "card");
      card.appendChild(el("div", "v", String(c[1])));
      card.appendChild(el("div", "l", c[0]));
      cards.appendChild(card);
    });
  view.appendChild(cards);

  var touched = rows.filter(function (r) { return r.s.ok > 0 || r.s.wrong > 0; });
  var rest = rows.filter(function (r) { return !(r.s.ok > 0 || r.s.wrong > 0); });
  touched.sort(function (a, b) {
    if (b.s.wrong !== a.s.wrong) return b.s.wrong - a.s.wrong;
    return a.s.pct - b.s.pct;
  });

  var wrap = el("div", "table-wrap");
  var t = document.createElement("table");
  t.innerHTML = "<thead><tr><th>Unit</th><th>Тақырып</th><th>PDF</th><th>Прогресс</th><th>Дұрыс</th><th>Меңгерілген</th><th>Қате</th></tr></thead>";
  var tb = document.createElement("tbody");
  touched.concat(rest).forEach(function (r) {
    var tr = document.createElement("tr");
    tr.onclick = function () { openUnit(r.u.unit); };
    function td(x) { var d = document.createElement("td"); if (x instanceof Node) d.appendChild(x); else d.textContent = x; tr.appendChild(d); }
    td(String(r.u.unit));
    td(r.u.title);
    td("б. " + r.u.pdf);
    var bar = el("div", "bar"); var fill = el("i"); fill.style.width = r.s.pct + "%"; bar.appendChild(fill);
    td(bar);
    td(r.s.ok + "/" + r.s.total);
    td(String(r.s.mastered));
    td(r.s.wrong ? String(r.s.wrong) : "—");
    tb.appendChild(tr);
  });
  t.appendChild(tb); wrap.appendChild(t); view.appendChild(wrap);

  var foot = el("div", "ex-foot");
  var del = el("button", "btn danger", "Барлық прогресті өшіру");
  del.onclick = function () {
    if (confirm("Барлық прогресс пен қателер тізімі өшеді. Сенімдісің бе?")) {
      progress = {}; save(); render(); renderSidebar(); updateBadge();
    }
  };
  foot.appendChild(del);
  view.appendChild(foot);
}

/* ---------------------------------------------------------------- роутинг */
function setTab(name) {
  document.querySelectorAll(".tab").forEach(function (t) {
    t.classList.toggle("active", t.getAttribute("data-view") === name);
  });
}
function updateBadge() {
  var b = document.getElementById("errBadge");
  var n = errorList().length;
  b.textContent = n ? String(n) : "";
  b.classList.toggle("on", n > 0);
}
function render() {
  if (state.view === "units") renderUnit();
  else if (state.view === "errors") renderErrors();
  else renderStats();
  renderSidebar();
}

document.querySelectorAll(".tab").forEach(function (t) {
  t.onclick = function () {
    state.view = t.getAttribute("data-view");
    setTab(state.view); render(); window.scrollTo(0, 0);
  };
});
searchEl.oninput = function () { state.q = searchEl.value; renderSidebar(); };
document.getElementById("menuBtn").onclick = function () { sidebar.classList.toggle("open"); };

updateBadge();
render();
})();
