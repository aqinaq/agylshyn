/* ===================================================================
   Grammar Practice — English Grammar in Use
   Жауап парағы + автотексеру + прогресс (сұрақ мәтіні PDF-те)
   =================================================================== */

const DATA = window.EGU_DATA;
const SKEY = 'egu_v1';
const MASTER_STREAK = 3;   // қатарынан осынша дұрыс → меңгерілді

/* -------------------------------------------------------------------
   1. Жауапты тазалау / нормалау / салыстыру
   ------------------------------------------------------------------- */

// PDF extraction қалдықтарын кесу ("336 Key to Exercises" т.б.)
function cleanAnswer(raw){
  if (raw == null) return null;
  let s = String(raw);
  s = s.split(/\s*\d*\s*Key to Exercises/i)[0];
  s = s.split(/\s+(?:You can also use|For the present perfect|Example answers are given)\b/i)[0];
  s = s.replace(/\s+\d{3}\s*$/, '');          // соңындағы бет нөмірі
  s = s.replace(/ /g, ' ')               // қатты бос орын
       .replace(/\s{2,}/g, ' ')
       .trim();

  // PDF-тен келген жырық сөздерді біріктіру (тек көрсету үшін —
  // салыстыруға әсер етпейді, себебі norm() бос орынды әйтеуір алып тастайды).
  s = s
    .replace(/([’'])\s+(m|s|t|d|re|ve|ll)\b/g, '$1$2')                    // "I’ m"  → "I’m"
    .replace(/\b([A-Za-z]{2,})\s+([a-z]{1,2}[’'](?:re|s|t|d|ve|ll|m))\b/g, '$1$2') // "The y’re" → "They’re"
    // "w alked" → "walked". Жалғыз әріптің алдында міндетті түрде бос орын
    // болуы керек — әйтпесе "don’t use" → "don’tuse" болып бүлінеді.
    .replace(/(^|\s)([b-hj-z])\s+([a-z]{2,})/g, '$1$2$3');

  // "…" немесе "—" сияқты бос орынбасар → жауап кілті жоқ деп санаймыз
  return /[a-z0-9]/i.test(s) ? s : null;
}

// Салыстыруға арналған кілт: тек әріп/сан қалады.
// Бұл PDF-тен келген "The y’re", "c auses" сияқты жырық сөздерді де,
// тыныс белгісі мен апострофтағы айырмашылықты да жояды.
function norm(s){
  return String(s)
    .toLowerCase()
    .replace(/[‘’ʼ´`]/g, "'")
    .replace(/[^a-z0-9]/g, '');
}

// Жақшадағы бөлікті бар/жоқ етіп нұсқалар жасау:
// "She didn’t have (any) lunch." → екеуі де қабылданады
function expandParens(s){
  const groups = [];
  const re = /\(([^()]*)\)/g;
  let m;
  while ((m = re.exec(s)) && groups.length < 5) groups.push(m[0]);
  if (!groups.length) return [s];

  const out = [];
  const total = 1 << groups.length;
  for (let mask = 0; mask < total; mask++){
    let v = s;
    groups.forEach((g, i) => {
      v = v.replace(g, (mask >> i) & 1 ? g.slice(1, -1) : ' ');
    });
    out.push(v);
  }
  return out;
}

// "a / b", "a or b" — балама жауаптарға бөлу
function splitAlternatives(s){
  return s.split(/\s*\/\s*|\s+\bor\b\s+/i)
          .map(p => p.trim())
          .filter(Boolean);
}

// Бір жауаптан қабылданатын барлық нормаланған нұсқа.
// Кітапта балама жиі "… eat (any) lunch" түрінде қысқартылып беріледі —
// мұндайда бірінші нұсқаның басы + осы соңы деп құрастырамыз.
const ELLIPSIS_START = /^\s*(?:…|\.\.\.)\s*/;

function buildVariants(answer){
  const set = new Set();
  const add = s => expandParens(s).forEach(v => {
    const n = norm(v);
    if (n) set.add(n);
  });

  const parts = splitAlternatives(answer);
  const base  = (parts[0] || answer).replace(/…|\.\.\./g, ' ').trim();
  const baseWords = base ? base.split(/\s+/) : [];

  add(answer);                       // толық жол да жарайды
  parts.forEach((p, i) => {
    if (i > 0 && ELLIPSIS_START.test(p)){
      const tail = p.replace(ELLIPSIS_START, '');
      for (let k = 0; k <= baseWords.length; k++){
        add(baseWords.slice(0, k).join(' ') + ' ' + tail);
      }
    } else {
      add(p);
    }
  });
  return set;
}

// blank — кітаптағы бос орынға жазылатын қысқа форма
// ("He ’s tying" толық жауабының blank-і "’s tying"), ол да дұрыс саналады.
function isMatch(typed, answer, blank){
  const t = norm(typed);
  if (!t) return false;
  if (buildVariants(answer).has(t)) return true;
  return blank ? buildVariants(blank).has(t) : false;
}

/* -------------------------------------------------------------------
   2. Деректерді жалпақ тізімге жинау
   ------------------------------------------------------------------- */

const FLAT = [];
const BY_UNIT = new Map();

DATA.forEach(u => {
  const list = [];
  u.exercises.forEach(ex => {
    ex.items.forEach(it => {
      const rec = {
        key:    `${u.unit}|${ex.number}|${it.n}`,
        unit:   u.unit,
        title:  u.title,
        page:   (u.pdfPages && u.pdfPages[1]) || (u.pdfPages && u.pdfPages[0]) || null,
        exNum:  ex.number,
        n:      it.n,
        answer: cleanAnswer(it.answer),  // null → өзім тексеремін
        blank:  cleanAnswer(it.blank),   // тек бос орынға жазылатын қысқа форма
        question: (it.question || '').trim(),
        isExample: !!it.isExample        // кітаптағы дайын мысал — жаттығу емес
      };
      FLAT.push(rec);
      list.push(rec);
    });
  });
  BY_UNIT.set(u.unit, list);
});

const ITEM_BY_KEY = new Map(FLAT.map(r => [r.key, r]));

// Мысалдар саналмайды — прогресс тек нақты жаттығу item-деріне қатысты
const PRACTICE = FLAT.filter(r => !r.isExample);

/* -------------------------------------------------------------------
   3. localStorage прогресс
   ------------------------------------------------------------------- */

let store = loadStore();

function loadStore(){
  try {
    const raw = JSON.parse(localStorage.getItem(SKEY));
    if (raw && raw.items) return raw;
  } catch (e) { /* бүлінген дерек — таза бастаймыз */ }
  return { v: 1, items: {} };
}

let saveTimer = null;
function save(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(SKEY, JSON.stringify(store)); }
    catch (e) { console.warn('Прогресті сақтау мүмкін болмады', e); }
  }, 120);
}

function progressOf(key){
  return store.items[key] || null;
}
function progressFor(key){
  return store.items[key] || (store.items[key] = {
    streak: 0, wrong: 0, last: null, mastered: false, val: ''
  });
}

// Нәтижені жазу. correct=true/false, self=өзім белгіледім бе
function recordResult(key, correct, typed, self){
  const p = progressFor(key);
  if (typeof typed === 'string') p.val = typed;
  p.last = correct ? 'correct' : 'wrong';
  p.self = !!self;
  if (correct){
    p.streak += 1;
    if (p.streak >= MASTER_STREAK) p.mastered = true;
  } else {
    p.streak = 0;
    p.wrong += 1;
    p.mastered = false;
  }
  save();
}

function unitStats(unitNo){
  const items = (BY_UNIT.get(unitNo) || []).filter(it => !it.isExample);
  let correct = 0, pending = 0, mastered = 0, attempted = 0;
  items.forEach(it => {
    const p = progressOf(it.key);
    if (!p || !p.last) return;
    attempted++;
    if (p.last === 'correct') correct++;
    if (p.wrong > 0 && !p.mastered) pending++;   // қайталауды күтеді
    if (p.mastered) mastered++;
  });
  return {
    total: items.length, attempted, correct, pending, mastered,
    pct: items.length ? Math.round(correct / items.length * 100) : 0
  };
}

function errorItems(){
  return PRACTICE.filter(it => {
    const p = progressOf(it.key);
    return p && p.wrong > 0 && !p.mastered;
  });
}

/* -------------------------------------------------------------------
   4. Утилиталар
   ------------------------------------------------------------------- */

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

/* -------------------------------------------------------------------
   5. Жол (item) рендері — unit бетінде де, қателер бетінде де ортақ
   ------------------------------------------------------------------- */

function rowHTML(it, opts = {}){
  // Кітаптағы дайын мысал: жауап өрісі жоқ, мәтіні бірден көрінеді
  if (it.isExample){
    return `
    <div class="row example" data-key="${esc(it.key)}">
      <span class="num">${it.n}</span>
      <div class="example-body">
        <span class="example-tag">мысал</span>
        <span class="example-text">${esc(it.question || it.answer || '')}</span>
      </div>
    </div>`;
  }

  const p = progressOf(it.key);
  const cls = [
    'row',
    p && p.last === 'correct' ? 'correct' : '',
    p && p.last === 'wrong'   ? 'wrong'   : '',
    p && p.mastered ? 'mastered' : ''
  ].filter(Boolean).join(' ');

  const val   = p ? esc(p.val || '') : '';
  const isSelf = it.answer == null;
  const tag   = opts.showTag
    ? `<span class="tag">U${it.unit} · ${esc(it.exNum)} · б.${it.page ?? '—'}</span>` : '';

  const actions = isSelf
    ? `<button class="btn tiny ok"  data-act="self-ok">✓ Дұрыс</button>
       <button class="btn tiny bad" data-act="self-bad">✗ Қате</button>`
    : `<button class="btn" data-act="check">Тексеру</button>`;

  const question = it.question
    ? `<div class="q-text">${esc(it.question)}</div>` : '';

  return `
  <div class="${cls}" data-key="${esc(it.key)}">
    <span class="num">${it.n}</span>
    <div class="row-body">
      ${question}
      <div class="row-input">
        <input class="ans" type="text" value="${val}" autocomplete="off"
               spellcheck="false" placeholder="${isSelf ? 'өз жауабыңды жаз…' : ''}"
               aria-label="Жауап ${it.n}">
        <span class="row-actions">${tag}${actions}</span>
      </div>
      <div class="feedback">${feedbackHTML(it)}</div>
    </div>
  </div>`;
}

/* Сәйкестендіру жаттығуларының a–h нұсқалары */
function optionsHTML(ex){
  if (!ex.options) return '';
  const rows = Object.keys(ex.options)
    .map(k => `<li><b>${esc(k)}</b> ${esc(ex.options[k])}</li>`)
    .join('');
  return `<ul class="ex-options">${rows}</ul>`;
}

function feedbackHTML(it){
  const p = progressOf(it.key);
  if (!p || !p.last) {
    return it.answer == null
      ? `<span class="self-note">Кітаптан тексер — жауап кілті берілмеген</span>` : '';
  }
  const ok = p.last === 'correct';
  let html = `<span class="verdict ${ok ? 'ok' : 'bad'}">${ok ? '✓ Дұрыс' : '✗ Қате'}</span>`;
  if (it.answer != null){
    html += `<span class="book">Кітап: <b>${esc(it.answer)}</b></span>`;
  }
  if (!ok && it.answer != null){
    html += `<button class="btn tiny ok" data-act="override">Мен дұрыс жаздым</button>`;
  }
  if (p.mastered) html += `<span class="self-note">★ меңгерілді</span>`;
  else if (p.streak > 0 && ok) html += `<span class="self-note">${p.streak}/${MASTER_STREAK} қатарынан</span>`;
  return html;
}

function refreshRow(rowEl){
  const it = ITEM_BY_KEY.get(rowEl.dataset.key);
  const p  = progressOf(it.key);
  rowEl.classList.toggle('correct',  !!p && p.last === 'correct');
  rowEl.classList.toggle('wrong',    !!p && p.last === 'wrong');
  rowEl.classList.toggle('mastered', !!p && p.mastered);
  $('.feedback', rowEl).innerHTML = feedbackHTML(it);
}

/* Бір жолды тексеру. mode: 'auto' | 'ok' | 'bad' */
function checkRow(rowEl, mode = 'auto'){
  const it    = ITEM_BY_KEY.get(rowEl.dataset.key);
  const input = $('.ans', rowEl);
  const typed = input.value;

  if (mode === 'auto'){
    if (it.answer == null) return;              // өзім тексеретін item
    if (!typed.trim()) { input.focus(); return; }
    recordResult(it.key, isMatch(typed, it.answer, it.blank), typed, false);
  } else {
    recordResult(it.key, mode === 'ok', typed, true);
  }
  refreshRow(rowEl);
  updateScores();
}

function focusNextInput(rowEl){
  const inputs = $$('.ans', $('#main'));
  const i = inputs.indexOf($('.ans', rowEl));
  if (i > -1 && inputs[i + 1]) inputs[i + 1].focus();
}

/* -------------------------------------------------------------------
   6. Беттер
   ------------------------------------------------------------------- */

function renderUnit(unitNo){
  const u = DATA.find(x => x.unit === unitNo);
  if (!u) return renderNotFound();

  const html = `
    <div class="unit-head">
      <h1><span class="u-num">Unit ${u.unit}</span> — ${esc(u.title)}</h1>
      <div class="meta-row">
        <span class="pdf-chip">📄 PDF б. ${u.pdfPages ? u.pdfPages.join(' / ') : '—'}</span>
        <span class="progress"><i id="unit-bar" style="width:0%"></i></span>
        <span class="progress-label" id="unit-bar-label"></span>
      </div>
    </div>

    ${u.exercises.map(ex => `
      <section class="exercise" data-ex="${esc(ex.number)}">
        <div class="ex-head"><span class="ex-num">${esc(ex.number)}</span></div>
        <p class="ex-instr">${esc(ex.instructions || '')}</p>
        ${optionsHTML(ex)}
        <div class="rows">
          ${ex.items.map(it => {
            const rec = ITEM_BY_KEY.get(`${u.unit}|${ex.number}|${it.n}`);
            return rowHTML(rec);
          }).join('')}
        </div>
        <div class="ex-foot">
          <button class="btn" data-act="check-ex">Тапсырманы тексеру</button>
          <span class="score" data-ex-score="${esc(ex.number)}"></span>
        </div>
      </section>`).join('')}

    <div class="unit-summary">
      <span class="big" id="unit-score">—</span>
      <span class="progress-label" id="unit-master"></span>
      <span class="unit-nav">
        ${unitNo > 1   ? `<a class="btn" href="#/unit/${unitNo - 1}">← Unit ${unitNo - 1}</a>` : ''}
        <button class="btn primary" data-act="check-unit">Барлығын тексеру</button>
        ${unitNo < 145 ? `<a class="btn" href="#/unit/${unitNo + 1}">Unit ${unitNo + 1} →</a>` : ''}
      </span>
    </div>`;

  $('#main').innerHTML = html;
  window.scrollTo(0, 0);
  updateScores();
}

function renderErrors(){
  const errs = errorItems();
  if (!errs.length){
    $('#main').innerHTML = `
      <div class="page-head"><h1>Қателер</h1></div>
      <div class="empty">
        <span class="big">🎉</span>
        Қайталайтын қате жоқ.<br>
        Қате жіберген item-дер осында жиналады да, қатарынан
        ${MASTER_STREAK} рет дұрыс жасағанда тізімнен шығады.
      </div>`;
    return;
  }

  const groups = new Map();
  errs.forEach(it => {
    if (!groups.has(it.unit)) groups.set(it.unit, []);
    groups.get(it.unit).push(it);
  });

  $('#main').innerHTML = `
    <div class="page-head">
      <h1>Қателер</h1>
      <p>${errs.length} item қайталауды күтіп тұр. Қатарынан ${MASTER_STREAK} рет дұрыс болса — тізімнен шығады (★).</p>
    </div>
    ${[...groups.entries()].map(([unitNo, items]) => {
      const u = DATA.find(x => x.unit === unitNo);
      const page = u && u.pdfPages ? u.pdfPages.join(' / ') : '—';
      return `
      <div class="err-group">
        <h3>
          <a href="#/unit/${unitNo}">Unit ${unitNo} — ${esc(u ? u.title : '')}</a>
          <span class="sub">📄 PDF б. ${page} · ${items.length} item</span>
        </h3>
        <div class="rows">
          ${items.map(it => rowHTML(it, { showTag: true })).join('')}
        </div>
      </div>`;
    }).join('')}`;
  window.scrollTo(0, 0);
}

function renderStats(){
  let total = PRACTICE.length, correct = 0, mastered = 0, attempted = 0;
  PRACTICE.forEach(it => {
    const p = progressOf(it.key);
    if (!p || !p.last) return;
    attempted++;
    if (p.last === 'correct') correct++;
    if (p.mastered) mastered++;
  });
  const pending = errorItems().length;
  const pct = total ? Math.round(correct / total * 100) : 0;

  const rows = DATA.map(u => ({ u, s: unitStats(u.unit) }));
  const touched   = rows.filter(r => r.s.attempted > 0)
                        .sort((a, b) => (a.s.correct / a.s.attempted) - (b.s.correct / b.s.attempted)
                                     || b.s.pending - a.s.pending);
  const untouched = rows.filter(r => r.s.attempted === 0);

  const tr = r => `
    <tr data-unit="${r.u.unit}">
      <td><b>${r.u.unit}</b> — ${esc(r.u.title)}</td>
      <td class="n">${r.s.attempted}/${r.s.total}</td>
      <td class="n">${r.s.correct}</td>
      <td class="n">${r.s.pending || ''}</td>
      <td class="n">${r.s.mastered}</td>
      <td class="n">
        <span class="bar"><i style="width:${r.s.pct}%"></i></span>
        <span style="margin-left:6px">${r.s.pct}%</span>
      </td>
    </tr>`;

  $('#main').innerHTML = `
    <div class="page-head">
      <h1>Статистика</h1>
      <p>145 unit · ${total} item</p>
    </div>

    <div class="stat-cards">
      <div class="card"><div class="k">Жалпы прогресс</div><div class="v">${pct}<small>%</small></div></div>
      <div class="card"><div class="k">Жасалды</div><div class="v">${attempted}<small> / ${total}</small></div></div>
      <div class="card"><div class="k">Меңгерілді ★</div><div class="v">${mastered}</div></div>
      <div class="card"><div class="k">Қайталауды күтеді</div><div class="v">${pending}</div></div>
    </div>

    <table class="stats">
      <thead><tr>
        <th>Unit</th><th class="n">Жасалды</th><th class="n">Дұрыс</th>
        <th class="n">Қайталау</th><th class="n">★</th><th class="n">Прогресс</th>
      </tr></thead>
      <tbody>
        ${touched.map(tr).join('')}
        ${untouched.length ? `<tr><td colspan="6" style="color:var(--ink-soft);font-size:13px">— әлі басталмаған unit-тар —</td></tr>` : ''}
        ${untouched.map(tr).join('')}
      </tbody>
    </table>

    <div class="danger-zone">
      <button class="btn danger" data-act="reset">Барлық прогресті өшіру</button>
    </div>`;
  window.scrollTo(0, 0);
}

function renderNotFound(){
  $('#main').innerHTML = `<div class="empty">Бет табылмады.</div>`;
}

/* Ұпайларды жаңарту (unit беті) */
function updateScores(){
  const main = $('#main');
  if (!main) return;

  $$('.exercise', main).forEach(sec => {
    let done = 0, ok = 0, tot = 0;
    $$('.row:not(.example)', sec).forEach(r => {
      tot++;
      const p = progressOf(r.dataset.key);
      if (p && p.last){ done++; if (p.last === 'correct') ok++; }
    });
    const el = $(`[data-ex-score]`, sec);
    if (el) el.innerHTML = done
      ? `<b>${ok}/${done}</b> дұрыс${done < tot ? ` · ${tot - done} қалды` : ''}`
      : `${tot} item`;
  });

  const scoreEl = $('#unit-score');
  if (!scoreEl) return;
  const unitNo = Number(location.hash.split('/')[2]);
  const s = unitStats(unitNo);
  scoreEl.textContent = s.attempted
    ? `${s.correct}/${s.attempted} дұрыс — ${Math.round(s.correct / s.attempted * 100)}%`
    : 'Әлі басталмады';
  $('#unit-master').textContent = `${s.attempted}/${s.total} жасалды · ★ ${s.mastered} меңгерілді`;

  const bar = $('#unit-bar');
  if (bar){
    bar.style.width = s.pct + '%';
    $('#unit-bar-label').textContent = s.pct + '%';
  }
  renderUnitList($('#unit-search').value);
  updateErrBadge();
}

/* -------------------------------------------------------------------
   7. Sidebar
   ------------------------------------------------------------------- */

function renderUnitList(filter = ''){
  const q = filter.trim().toLowerCase();
  const active = location.hash.startsWith('#/unit/') ? Number(location.hash.split('/')[2]) : null;

  const html = DATA
    .filter(u => !q || String(u.unit) === q ||
                 u.title.toLowerCase().includes(q) ||
                 String(u.unit).startsWith(q))
    .map(u => {
      const s = unitStats(u.unit);
      const done = s.pct === 100;
      return `
      <a class="unit-item ${active === u.unit ? 'active' : ''}" href="#/unit/${u.unit}">
        <span class="u-no">${u.unit}</span>
        <span class="u-title" title="${esc(u.title)}">${esc(u.title)}</span>
        <span class="u-pct ${done ? 'done' : ''}">${done ? '✓' : (s.attempted ? s.pct + '%' : '')}</span>
      </a>`;
    }).join('');

  $('#unit-list').innerHTML = html || `<div style="padding:14px;color:var(--ink-soft);font-size:13px">Табылмады</div>`;
}

function updateErrBadge(){
  const n = errorItems().length;
  const b = $('#err-badge');
  b.textContent = n;
  b.classList.toggle('show', n > 0);
}

function setActiveTab(){
  const h = location.hash;
  const tab = h.startsWith('#/errors') ? 'errors'
            : h.startsWith('#/stats')  ? 'stats' : 'units';
  $$('.tabs a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
}

/* -------------------------------------------------------------------
   8. Роутер + оқиғалар
   ------------------------------------------------------------------- */

function route(){
  const h = location.hash || '#/units';
  setActiveTab();

  if (h.startsWith('#/unit/'))       renderUnit(Number(h.split('/')[2]));
  else if (h.startsWith('#/errors')) renderErrors();
  else if (h.startsWith('#/stats'))  renderStats();
  else {
    $('#main').innerHTML = `
      <div class="page-head">
        <h1>Grammar Practice</h1>
        <p>Сол жақтан unit таңда. Сұрақтардың мәтіні PDF-те — мұнда тек жауап өрістері.</p>
      </div>
      <div class="empty">
        <span class="big">📄 ＋ ✍️</span>
        Оң жақта PDF-ті аш, сол жақта жауапты тер.<br>
        <span style="font-size:13px">Enter — тексеру, автоматты түрде келесі жолға өтеді.</span>
      </div>`;
  }
  renderUnitList($('#unit-search').value);
  updateErrBadge();
}

/* Оқиғаларды делегациямен ұстаймыз */
$('#main').addEventListener('click', e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const row = btn.closest('.row');

  if (act === 'check')     return checkRow(row, 'auto');
  if (act === 'self-ok')   return checkRow(row, 'ok');
  if (act === 'self-bad')  return checkRow(row, 'bad');
  if (act === 'override')  return checkRow(row, 'ok');

  if (act === 'check-ex'){
    $$('.row:not(.example)', btn.closest('.exercise')).forEach(r => {
      if ($('.ans', r).value.trim()) checkRow(r, 'auto');
    });
    return;
  }
  if (act === 'check-unit'){
    $$('.row:not(.example)', $('#main')).forEach(r => {
      if ($('.ans', r).value.trim()) checkRow(r, 'auto');
    });
    return;
  }
  if (act === 'reset'){
    if (confirm('Барлық прогресс өшеді. Сенімдісің бе?')){
      store = { v: 1, items: {} };
      localStorage.removeItem(SKEY);
      route();
    }
  }
});

/* Enter → тексеру + келесі өріс; терген мәтінді сақтап отыру */
$('#main').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const row = e.target.closest('.row');
  if (!row) return;
  e.preventDefault();
  const it = ITEM_BY_KEY.get(row.dataset.key);
  if (it.answer != null) checkRow(row, 'auto');
  focusNextInput(row);
});

$('#main').addEventListener('input', e => {
  if (!e.target.classList.contains('ans')) return;
  const row = e.target.closest('.row');
  progressFor(row.dataset.key).val = e.target.value;
  save();
});

/* Кестедегі жолды бассаң — сол unit ашылады */
$('#main').addEventListener('click', e => {
  const tr = e.target.closest('tr[data-unit]');
  if (tr) location.hash = `#/unit/${tr.dataset.unit}`;
});

$('#unit-search').addEventListener('input', e => renderUnitList(e.target.value));

window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', () => {
  clearTimeout(saveTimer);
  try { localStorage.setItem(SKEY, JSON.stringify(store)); } catch (e) {}
});

route();
