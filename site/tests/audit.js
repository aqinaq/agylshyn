/* Static audit: everything that can be checked without opening a browser.

   The things it is here to catch are the ones that are invisible in review and
   obvious to a reader: a book listed in books.js with no data file behind it, a
   count on the home page that no longer matches the data, a string the code
   asks for that only one of the two languages has, a script that index.html
   loads and sw.js forgets — which is how a reader ends up offline with half an
   app.

   node site/tests/audit.js */
'use strict';
const fs = require('fs');
const path = require('path');
const { Report } = require('./report.js');

const SITE = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(SITE, p), 'utf8');
const json = p => JSON.parse(read(p));
const exists = p => fs.existsSync(path.join(SITE, p));

const r = Report('static audit');

/* The four data files are plain scripts that hang one global off `window`;
   evaluating them in a bare object is enough to read them here. */
function loadGlobal(file, name) {
  const w = {};
  return new Function('window', 'self', read(file) + '\nreturn window.' + name + ';')(w, w);
}
const BOOKS = loadGlobal('books.js', 'BOOKS');
const I18N = loadGlobal('i18n.js', 'I18N');
const PLACEMENT = loadGlobal('placement.js', 'PLACEMENT');
const HELP = loadGlobal('help.js', 'HELP');

/* Which books are paid, and where their JSON has gone. A paid book is not in
   site/data/ — split_content.py moves it to content/ so the deploy cannot
   publish it — so every check below that wants to open a book has to know to
   look in both places. Locally both directories exist; on a fresh clone only
   site/data/ does, and the paid books are simply reported as unbuilt. */
const PAID = new Set((() => {
  try { return JSON.parse(read('tools/tiers.json')).paid || []; } catch (e) { return []; }
})());
const bookFile = id => {
  const homes = PAID.has(id) ? ['../content/', 'data/'] : ['data/', '../content/'];
  return homes.map(d => d + id + '.json').find(exists) || null;
};

const JS = ['app.js', 'srs.js', 'dict.js', 'sync.js', 'entitle.js', 'help.js',
  'pdfview.js', 'placement.js'];
const html = read('index.html');

/* ===================== 1. the two languages ===================== */
r.head('i18n');
r.ok('exactly kk and en', Object.keys(I18N).sort().join(',') === 'en,kk', Object.keys(I18N).join(','));

const kk = I18N.kk, en = I18N.en;
const kkKeys = new Set(Object.keys(kk)), enKeys = new Set(Object.keys(en));

const missingEn = [...kkKeys].filter(k => !enKeys.has(k));
const missingKk = [...enKeys].filter(k => {
  if (kkKeys.has(k)) return false;
  // '<key>.1' is the singular form srs.js's tn() reaches for. Kazakh does not
  // inflect after a numeral, so it deliberately has no such entry and falls
  // through to the plain key. That is the design, not a gap.
  const base = k.replace(/\.1$/, '');
  return !(/\.1$/.test(k) && kkKeys.has(base) && enKeys.has(base));
});
r.ok('every kk key has an en twin', missingEn.length === 0, missingEn.join(', '));
r.ok('every en key has a kk twin (bar the singular forms)', missingKk.length === 0, missingKk.join(', '));

{
  // A repeated literal key is not an error in JS — the later one silently wins —
  // so the only way to see it is to read the source.
  const src = read('i18n.js');
  const seen = new Set(), dupes = [];
  let m;
  const re = /^\s{4}'([^']+)':/gm;
  while ((m = re.exec(src))) {
    const lang = (src.slice(0, m.index).match(/^\s{2}(kk|en):/gm) || []).pop() || '?';
    const id = lang.trim().replace(':', '') + '|' + m[1];
    if (seen.has(id)) dupes.push(id); else seen.add(id);
  }
  r.ok('no key is defined twice', dupes.length === 0, dupes.join(', '));
}

{
  // '{n}' in one language and nothing in the other means one of them prints a
  // sentence with a hole in it.
  const holes = s => (String(s).match(/\{[a-zA-Z]+\}/g) || []).sort().join(',');
  const off = [...kkKeys].filter(k =>
    enKeys.has(k) && typeof kk[k] === 'string' && typeof en[k] === 'string'
    && holes(kk[k]) !== holes(en[k]));
  r.ok('the two languages take the same placeholders', off.length === 0,
    off.map(k => k + ' kk[' + holes(kk[k]) + '] en[' + holes(en[k]) + ']').join('; '));
}

/* keys the code asks for */
const src = JS.map(read).join('\n');
const used = new Set();
for (const m of src.matchAll(/\bt\(\s*'([^']+)'/g)) used.add(m[1]);
for (const m of src.matchAll(/\bt\(\s*"([^"]+)"/g)) used.add(m[1]);
for (const m of src.matchAll(/\btn\(\s*'([^']+)'/g)) used.add(m[1]);

// Some keys are assembled at run time ('users.th.' + column). Collect the
// prefixes so those are not reported as missing or as dead.
const prefixes = new Set();
for (const m of src.matchAll(/\bt n?\(\s*'([^']*\.)'\s*\+/g)) prefixes.add(m[1]);
for (const m of src.matchAll(/\bt\(\s*'([^']*\.)'\s*\+/g)) prefixes.add(m[1]);
for (const m of src.matchAll(/=\s*'([a-zA-Z]+(?:\.[a-zA-Z]+)+\.)'\s*\+/g)) prefixes.add(m[1]);
const dynamic = k => [...prefixes].some(p => k.startsWith(p));

const absent = [...used].filter(k => k !== 'locale' && !kkKeys.has(k) && !dynamic(k));
r.ok('every string the code asks for exists', absent.length === 0, absent.join(', '));
r.note('run-time key prefixes: ' + [...prefixes].join(' '));

{
  const miss = [];
  for (const m of html.matchAll(/data-(?:i18n|i18n-aria|i18n-placeholder|tip)="([^"]+)"/g)) {
    if (!kkKeys.has(m[1])) miss.push(m[1]);
  }
  r.ok('every string index.html asks for exists', miss.length === 0, miss.join(', '));
}

{
  const all = src + html;
  const dead = [...kkKeys].filter(k =>
    k !== 'locale' && !dynamic(k) && !all.includes("'" + k + "'") && !all.includes('"' + k + '"'));
  r.warnIf(dead.length > 0, dead.length + ' strings are translated but never used: ' + dead.join(', '));
}

/* ===================== 2. the shelf ===================== */
r.head('books and data');
const index = json('data/index.json');
const byId = Object.fromEntries(index.map(b => [b.id, b]));
r.eq('books.js and index.json hold the same number of books', BOOKS.length, index.length);

// The one rule that has to stay in step with isTracked() in app.js and
// tracked() in tools/index_json.py: an item counts if its exercise is answerable
// and it is not the worked example.
function trackedIn(book) {
  let n = 0;
  for (const u of book.units) {
    for (const s of (u.subExercises || [])) {
      if (s.type !== 'items' && s.type !== 'text') continue;
      for (const it of (s.items || [])) if (!it.isExample) n++;
    }
  }
  return n;
}

const data = {};
let units = 0, tracked = 0;
for (const b of BOOKS) {
  const file = bookFile(b.id);
  if (!r.ok(b.id + ': has a data file', !!file, 'neither site/data/ nor content/')) continue;
  const d = json(file);
  data[b.id] = d;
  r.eq(b.id + ': the file knows its own id', d.id, b.id);
  r.eq(b.id + ': books.js unit count matches the data', b.units, d.units.length);
  const row = byId[b.id];
  if (!r.ok(b.id + ': is listed in index.json', !!row)) continue;
  r.eq(b.id + ': index.json unit count matches', row.units, d.units.length);
  r.eq(b.id + ': index.json question count matches', row.tracked, trackedIn(d));
  if (b.pdf) r.ok(b.id + ': its PDF is there', exists(b.pdf), b.pdf);
  units += d.units.length;
  tracked += trackedIn(d);
}
r.note('shelf: ' + BOOKS.length + ' books, ' + units + ' units, ' + tracked + ' questions');

{
  // The home page prints these two groups under the headline tiles, because an
  // IELTS "unit" is a forty-question test section and a grammar unit is two
  // pages — adding them into one number says less than it looks like it does.
  const split = { course: { b: 0, u: 0, q: 0 }, ielts: { b: 0, u: 0, q: 0 } };
  for (const b of BOOKS) {
    const row = byId[b.id];
    if (!row) continue;
    const g = split[b.kind === 'ielts' ? 'ielts' : 'course'];
    g.b++; g.u += row.units; g.q += row.tracked;
  }
  const line = g => g.b + ' books, ' + g.u + ' units, ' + g.q + ' questions';
  r.note('  coursebooks: ' + line(split.course));
  r.note('  IELTS:       ' + line(split.ielts));
  r.eq('the two groups account for every book', split.course.b + split.ielts.b, BOOKS.length);
  r.eq('and for every unit', split.course.u + split.ielts.u, units);
  r.eq('and for every question', split.course.q + split.ielts.q, tracked);
  // A shelf with nothing on one side would draw a split of one row, which the
  // app hides — worth knowing if it ever happens rather than wondering why the
  // line vanished.
  r.ok('both groups have books in them', split.course.b > 0 && split.ielts.b > 0,
    JSON.stringify(split));
  for (const g of ['course', 'ielts']) {
    for (const key of ['hero.split.' + g, 'hero.split.' + g + 'Line']) {
      r.ok('"' + key + '" exists in both languages', kkKeys.has(key) && enKeys.has(key));
    }
  }
}

for (const row of index) {
  r.ok('index.json row "' + row.id + '" has a book behind it', BOOKS.some(b => b.id === row.id));
}
for (const kind of new Set(BOOKS.map(b => b.kind))) {
  r.ok('shelf heading exists for kind "' + kind + '"', kkKeys.has('lib.group.' + kind));
}

/* ===================== 2b. the paywall ===================== */
// The failure this section exists for: a paid book still sitting in site/data/,
// which the deploy would publish and which turns the lock in the app into a
// picture of a lock. Everything else here guards the smaller version of the
// same mistake — an index that says free where tiers.json says paid, so the
// library never draws the lock in the first place.
r.head('paid shelf');
{
  r.ok('tiers.json lists at least one paid book', PAID.size > 0, [...PAID].join(', '));
  for (const id of PAID) {
    r.ok('paid book "' + id + '" is a real book', BOOKS.some(b => b.id === id));
    r.ok('paid book "' + id + '" is NOT in site/data/', !exists('data/' + id + '.json'),
      'run: python3 site/tools/split_content.py');
  }
  for (const row of index) {
    r.eq('index.json marks "' + row.id + '" correctly', !!row.paid, PAID.has(row.id));
  }
  // A free shelf big enough to learn on is the whole funnel; if it ever empties
  // out, the app has no way to earn the sale it is asking for.
  r.ok('some books are still free', index.some(row => !row.paid),
    index.filter(row => !row.paid).map(row => row.id).join(', '));

  const PRICING = loadGlobal('pricing.js', 'PRICING');
  const plans = (PRICING && PRICING.plans) || {};
  // The keys have to be the two the database will accept — the check constraint
  // on subscriptions.plan — or the panel draws a plan nobody can grant.
  r.ok('the plans are exactly monthly and lifetime',
    Object.keys(plans).sort().join(',') === 'lifetime,monthly', Object.keys(plans).join(','));
  for (const [name, p] of Object.entries(plans)) {
    r.ok('plan "' + name + '" has a price', p.price > 0, String(p.price));
    r.ok('plan "' + name + '" names itself in both languages',
      !!(p.title && p.title.kk && p.title.en));
  }
  // Somewhere to send the money. Without either a pay link or a contact, the
  // lock screen is a wall with no door.
  const contactable = !!((PRICING.contact && PRICING.contact.label) ||
    Object.values(plans).some(p => p.link));
  r.ok('there is a way to actually pay', contactable);

  // The SQL is the paywall; the client is decoration. These two names are what
  // entitle.js calls, so a rename that lands in one file and not the other is a
  // library that locks everybody out.
  const sql = read('tools/supabase_schema.sql');
  const entitle = read('entitle.js');
  for (const fn of ['has_access', 'my_access', 'admin_grant', 'admin_revoke']) {
    r.ok('supabase_schema.sql defines ' + fn + '()', sql.includes('function public.' + fn + '('));
  }
  // has_access() is not in this list: the client never calls it. It is what the
  // row-level policy calls, which is exactly the point — the decision is made
  // in Postgres whether or not anything in the browser asks for it.
  for (const rpc of ['my_access', 'admin_grant', 'admin_revoke']) {
    r.ok('entitle.js calls rpc/' + rpc, entitle.includes('rpc/' + rpc));
  }
  r.ok('book_content has a select policy tied to has_access()',
    /create policy book_content_select_subscribed[\s\S]{0,200}public\.has_access\(\)/.test(sql));
}

/* ===================== 3. inside the data ===================== */
r.head('data integrity');
let collisions = 0, blankTitles = 0, badPages = 0, controls = 0, manual = 0, unanswerable = 0;
const perBook = {};
for (const b of BOOKS) {
  const d = data[b.id];
  if (!d) continue;
  const seenUnits = new Set();
  let bManual = 0;
  for (const u of d.units) {
    if (seenUnits.has(u.unit)) r.ok(b.id + ': unit ' + u.unit + ' appears once', false);
    seenUnits.add(u.unit);
    if (!String(u.title || '').trim()) blankTitles++;
    for (const p of (u.pdfPages || [])) if (!(p > 0)) badPages++;
    const seenSubs = new Set();
    for (const s of (u.subExercises || [])) {
      if (s.number != null) {
        if (seenSubs.has(s.number)) r.ok(b.id + ' unit ' + u.unit + ': exercise ' + s.number + ' appears once', false);
        seenSubs.add(s.number);
      }
      // What the app files an answer under. `k` is the builder's escape hatch
      // for an exercise that prints the same number twice (unclash() in
      // tools/build_data.py); examples never reach storage at all.
      const keys = new Set();
      for (const it of (s.items || [])) {
        if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(JSON.stringify(it))) controls++;
        if (s.type !== 'items' && s.type !== 'text') continue;
        if (it.isExample) continue;
        const key = it.k != null ? it.k : it.n;
        if (key != null) {
          if (keys.has(key)) collisions++;
          keys.add(key);
        }
        const answered = String(it.answer || '').trim() || String(it.blank || '').trim();
        if (!answered) {
          bManual++;
          if (!it.selfCheck && !/[A-Za-z]{3}/.test(String(it.question || ''))) unanswerable++;
        }
      }
    }
  }
  perBook[b.id] = bManual;
  manual += bManual;
}
r.eq('no two rows share a storage key', collisions, 0);
r.eq('no unit is left without a title', blankTitles, 0);

{
  // essential-grammar came out of a scan and some titles never came back. The
  // book's own warning card names a number; if a rebuild recovers more (or
  // fewer) that number has to move with it, or the card starts lying.
  for (const b of BOOKS) {
    const d = data[b.id];
    if (!d) continue;
    const unnamed = d.units.filter(u => /^Unit \d+$/.test(String(u.title || '').trim())).length;
    if (!unnamed) continue;
    r.note(b.id + ': ' + unnamed + ' unit titles never recovered from the scan');
    // "114 юниттің 14-інің тақырыбы…" / "14 of the 114 units…" — the count is
    // the one attached to the titles, not the size of the book.
    const text = JSON.stringify(b.warning || '');
    const claims = [/(\d+)-[іi]н[іi]ң тақырыбы/, /(\d+) of the \d+ units/, /(\d+) unit titles/]
      .map(re => (text.match(re) || [])[1]).filter(Boolean).map(Number);
    for (const claimed of claims) {
      r.eq(b.id + ': the warning card names the right number', claimed, unnamed);
    }
  }
}
r.eq('no PDF page number is zero or negative', badPages, 0);
r.eq('no control characters survived extraction', controls, 0);
r.eq('no row is impossible to answer or to check', unanswerable, 0);
r.note('self-check rows (marked by the reader, not auto-graded): ' + manual + ' — '
  + Object.entries(perBook).filter(([, v]) => v).map(([k, v]) => k + ':' + v).join(' '));

{
  const akp = json('data/answer-key-pages.json');
  for (const id of Object.keys(akp)) {
    r.ok('answer-key page map: "' + id + '" is a real book', BOOKS.some(b => b.id === id));
  }
}

/* ===================== 4. the listening audio ===================== */
r.head('audio');
{
  const missing = [];
  let refs = 0;
  const walk = (bid, o) => {
    if (!o || typeof o !== 'object') return;
    if (o.audio) {
      const files = Array.isArray(o.audio.files) ? o.audio.files
        : typeof o.audio === 'string' ? [o.audio]
        : o.audio.src ? [o.audio.src] : [];
      for (const f of files) {
        refs++;
        if (!exists(String(f).replace(/^\.?\//, ''))) missing.push(bid + ' ' + f);
      }
    }
    for (const k in o) if (o[k] && typeof o[k] === 'object') walk(bid, o[k]);
  };
  for (const b of BOOKS) if (data[b.id]) for (const u of data[b.id].units) walk(b.id, u);
  r.ok('every recording a book points at is on disk', missing.length === 0, missing.slice(0, 8).join(', '));
  r.note(refs + ' recordings referenced');
}

/* ===================== 5. wiring ===================== */
r.head('wiring');
{
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  const gone = scripts.filter(s => !exists(s));
  r.ok('every script index.html loads exists', gone.length === 0, gone.join(', '));

  const sw = read('sw.js');
  const shell = (sw.match(/var SHELL = \[([\s\S]*?)\];/) || [, ''])[1]
    .split('\n').map(l => (l.match(/'([^']+)'/) || [, ''])[1]).filter(Boolean);
  const unshelled = scripts.filter(s => !shell.includes('./' + s));
  // A script missing from the shell is not visible online at all: it only shows
  // up as a broken app the first time a reader opens it with no network.
  r.ok('every script is precached for offline', unshelled.length === 0, unshelled.join(', '));
  r.ok('style.css is precached too', shell.includes('./style.css'));
  const ghostShell = shell.filter(s => s !== './' && !exists(s.replace('./', '')));
  r.ok('the shell list has no dead entries', ghostShell.length === 0, ghostShell.join(', '));

  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  const built = new Set([...src.matchAll(/\.id\s*=\s*'([^']+)'/g)].map(m => m[1]));
  const asked = new Set([...src.matchAll(/getElementById\(\s*'([^']+)'/g)].map(m => m[1]));
  const nowhere = [...asked].filter(i => !ids.has(i) && !built.has(i));
  r.ok('every element the code reaches for exists', nowhere.length === 0, nowhere.join(', '));

  const css = read('style.css');
  const styled = new Set([...css.matchAll(/data-view="([^"]+)"/g)].map(m => m[1]));
  const set = new Set([...read('app.js').matchAll(/setView\(\s*'([^']+)'/g)].map(m => m[1]));
  for (const v of set) {
    // 'home' is the default the HTML ships with and needs no rule of its own.
    if (v !== 'home') r.ok('page "' + v + '" is styled', styled.has(v));
  }
  r.note('pages: ' + [...set].join(', '));
}

/* ===================== 6. the placement quiz ===================== */
r.head('placement quiz');
{
  const { pool, blueprint, tracks, goals } = PLACEMENT;
  r.ok('there is a question bank', Array.isArray(pool) && pool.length > 0, String((pool || []).length));
  const ids = new Set();
  let dupes = 0, misplaced = 0;
  for (const q of pool) {
    if (ids.has(q.id)) dupes++;
    ids.add(q.id);
    if (!(q.a >= 0 && q.a < q.options.length)) r.ok('item ' + q.id + ': its answer is one of its options', false);
    // app.js shuffles and re-maps, and the shuffle test asserts on this.
    if (q.a !== 0) misplaced++;
  }
  r.eq('every question id is unique', dupes, 0);
  r.eq('every authored answer sits at index 0', misplaced, 0);

  const need = {};
  for (const level of blueprint) need[level] = (need[level] || 0) + 1;
  const have = {};
  for (const q of pool) have[q.level] = (have[q.level] || 0) + 1;
  for (const level in need) {
    // A retake must be able to draw entirely different items, or the second
    // estimate is a memory test of the first.
    r.ok('level ' + level + ' has two runs\' worth of questions (' + (have[level] || 0) + ' for ' + need[level] + ')',
      (have[level] || 0) >= need[level] * 2);
  }

  const cover = new Array(blueprint.length + 1).fill(0);
  for (const tr of tracks) {
    for (let s = tr.min; s <= (tr.max == null ? blueprint.length : tr.max); s++) {
      if (s >= 0 && s <= blueprint.length) cover[s]++;
    }
  }
  const gaps = cover.map((c, i) => [i, c]).filter(([, c]) => c !== 1);
  r.ok('every possible score maps to exactly one recommendation',
    gaps.length === 0, gaps.map(([i, c]) => 'score ' + i + ' → ' + c + ' tracks').join(', '));

  for (const tr of tracks) {
    for (const slot of ['grammar', 'vocab']) {
      if (tr[slot]) r.ok('track "' + tr.id + '" points at a real ' + slot + ' book (' + tr[slot] + ')',
        BOOKS.some(b => b.id === tr[slot]));
    }
    r.ok('track "' + tr.id + '" names a band', !!tr.band);
    r.ok('track "' + tr.id + '" has a label in both languages',
      kkKeys.has('plc.track.' + tr.id) && enKeys.has('plc.track.' + tr.id));
  }
  for (const g of (goals || [])) {
    const ids = g.books || (g.book ? [g.book] : []);
    r.ok('goal "' + g.id + '" names at least one book', ids.length > 0);
    for (const id of ids) {
      r.ok('goal "' + g.id + '" points at a real book (' + id + ')', BOOKS.some(b => b.id === id));
    }
    r.ok('goal "' + g.id + '" has a label in both languages',
      kkKeys.has('plc.goal.' + g.id) && enKeys.has('plc.goal.' + g.id));
  }
}

/* ===================== 6b. the Kazakh notes ===================== */
// A note is written by hand against a unit number, which is exactly the kind of
// reference that rots: a rebuilt book can renumber, and a note pinned to a unit
// that no longer exists is invisible with no error anywhere.
r.head('Kazakh notes');
{
  const dir = path.join(SITE, 'data/notes');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')) : [];
  r.ok('there are notes to check', files.length > 0, String(files.length));
  for (const file of files) {
    const bookId = file.slice(0, -5);
    const data = json('data/notes/' + file);
    const bookPath = 'data/' + bookId + '.json';
    r.ok(bookId + ': the book it belongs to is on the site', exists(bookPath));
    if (!exists(bookPath)) continue;
    const units = new Set(json(bookPath).units.map(u => u.unit));
    const entries = Object.entries(data.notes || {});
    r.ok(bookId + ': has notes in it', entries.length > 0, String(entries.length));
    for (const [unit, note] of entries) {
      r.ok(bookId + ' unit ' + unit + ': the unit exists', units.has(Number(unit)));
      r.ok(bookId + ' unit ' + unit + ': has a title and a body',
        !!note.title && Array.isArray(note.body) && note.body.length > 0);
      // Every example is a pair — English, then the Kazakh for it. A one-sided
      // pair renders as a blank line rather than as an error.
      const bad = (note.examples || []).filter(e => !Array.isArray(e) || !e[0] || !e[1]);
      r.ok(bookId + ' unit ' + unit + ': every example has both languages',
        bad.length === 0, JSON.stringify(bad.slice(0, 2)));
    }
  }
}

/* ============ 6c. the checks the deploy runs ============ */
// Run exactly as the Pages workflow runs them, and in the shape the workflow
// has: a checkout with no content/ directory, because the paid books are
// gitignored. Both of these failing there and nowhere else is what stopped
// three deploys after the samples landed.
r.head('deploy checks');
{
  const { spawnSync } = require('child_process');
  const env = Object.assign({}, process.env, { AGYLSHYN_CONTENT: '/nonexistent-on-purpose' });
  for (const tool of ['split_content.py', 'build_samples.py']) {
    const run = spawnSync('python3', [path.join(SITE, 'tools', tool), '--check'],
      { env, encoding: 'utf8' });
    r.ok(tool + ' --check passes without the paid books on disk',
      run.status === 0, (run.stdout || '') + (run.stderr || ''));
  }
}

/* ===================== 7. the guide ===================== */
r.head('help');
r.ok('help.js exports its sections', !!HELP);
if (HELP && HELP.kk && HELP.en) {
  r.ok('the guide has the same shape in both languages',
    JSON.stringify(Object.keys(HELP.kk)) === JSON.stringify(Object.keys(HELP.en)));
}

process.exit(r.done() ? 1 : 0);
