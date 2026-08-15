/* Does the answer checker accept what a learner would reasonably type?

   Every answer in every book is put through a set of transforms — lowercased,
   a trailing full stop, one side of a "took/got" alternative — and the checker
   has to still say yes. Then the reverse: nonsense has to be rejected.

   This file used to carry its own copy of the matching functions, and the copy
   went stale without a sound: app.js grew a whole branch for "generates,
   generates" answers and the copy never got it, so the numbers below were
   measured against a matcher that had not shipped in months. It reads the real
   functions out of app.js now. A test of a copy is a test of nothing.

   node site/match_test.js — exits non-zero if any rate falls through the floor. */
'use strict';
const fs = require('fs');
const path = require('path');
const { Report } = require('./tests/report.js');

const SITE = __dirname;

/* ---- the matcher itself, lifted out of app.js ---- */

// app.js is one big IIFE around a document that does not exist here, so it
// cannot simply be required. Every function in it is written at one indent
// level and closed by a line that is exactly two spaces and a brace, which is
// enough of a shape to cut on — and cutting on it means the checker under test
// is the checker that ships, not a description of it.
function lift(src, names) {
  const out = [];
  for (const name of names) {
    const head = src.indexOf('\n  function ' + name + '(');
    if (head < 0) throw new Error('app.js has no function ' + name + '() at the top level');
    const end = src.indexOf('\n  }\n', head);
    if (end < 0) throw new Error('could not find the end of ' + name + '() in app.js');
    out.push(src.slice(head + 1, end + 4));
  }
  return out.join('\n');
}

const MATCHER = ['norm', 'expandParens', 'splitAlternatives', 'expandSlashTokens',
  'dedupe', 'buildVariants', 'listParts', 'matchesAsSet', 'editDistance',
  'sameWordVariants', 'isMatch'];
const lifted = lift(fs.readFileSync(path.join(SITE, 'app.js'), 'utf8'), MATCHER);
const { norm, isMatch } = new Function(
  lifted + '\nreturn {' + MATCHER.join(', ') + '};')();

const r = Report('answer matching');

// The lift is a text operation on another file, so it gets checked before
// anything is measured with it. If app.js is reformatted and the cut lands in
// the wrong place, this says so instead of reporting a matcher that accepts
// nothing.
r.head('the matcher came across intact');
r.ok('every function was found', typeof isMatch === 'function' && typeof norm === 'function');
r.ok('an exact answer is accepted', isMatch('sixty-nine', { answer: 'sixty-nine' }));
r.ok('a wrong answer is rejected', !isMatch('sixty-eight', { answer: 'sixty-nine' }));
r.ok('the gap-only form is accepted', isMatch('’s tying', { answer: 'He’s tying', blank: '’s tying' }));
r.ok('a reordered list is accepted', isMatch('information, furniture', { answer: 'furniture, information' }));
// The branch the stale copy was missing, so its absence can never go quiet again.
r.ok('a doubled answer accepts the word once', isMatch('generates', { answer: 'generates, generates' }));

/* ---- the books ---- */

const BOOKS = JSON.parse(fs.readFileSync(path.join(SITE, 'data/index.json'), 'utf8')).map(b => b.id);
// A paid book is not in site/data/ — split_content.py moves it to content/, out
// of the deploy and out of the repository. The matcher still has to be measured
// against it where it exists: those books hold half the answer keys, and a
// checker that only ever sees the free shelf is a checker with a blind spot
// exactly where the answers are hardest. On CI and on a fresh clone they are
// simply not there, and the free shelf is what gets measured.
const CONTENT = process.env.AGYLSHYN_CONTENT || path.join(SITE, '..', 'content');
const bookPath = b => [path.join(SITE, 'data', b + '.json'), path.join(CONTENT, b + '.json')]
  .find(p => fs.existsSync(p));

const loaded = {}, absent = [];
for (const b of BOOKS) {
  const p = bookPath(b);
  if (!p) { absent.push(b); continue; }
  loaded[b] = JSON.parse(fs.readFileSync(p, 'utf8'));
}
const HAVE = BOOKS.filter(b => loaded[b]);
if (absent.length) r.warnIf(true, 'not built here, so unmeasured: ' + absent.join(', '));
r.ok('there are books to measure', HAVE.length > 0);

// Every answerable row of every book that is on disk.
function eachItem(book, fn) {
  for (const u of book.units) {
    for (const s of (u.subExercises || [])) {
      for (const it of (s.items || [])) {
        if (it.isExample) continue;
        const a = String(it.answer || '').trim();
        if (a) fn(it, a);
      }
    }
  }
}

/* ---- what a learner types that must be accepted ----

   `floor` is the share that has to keep passing. 100 means exactly that: a
   single row slipping is a failure, because these are transforms no correct
   answer can be lost to. The three that split alternatives sit a hair below,
   and always have — a handful of answers across 21 562 are written in a shape
   where "the first alternative" is not by itself an answer. The floors are set
   under the measured rate, so they catch a regression rather than noise. */
const T = [
  ['exact', 100, a => a],
  ['lowercased', 100, a => a.toLowerCase()],
  ['trailing period', 100, a => a + '.'],
  ['straight quote', 100, a => a.replace(/[’‘]/g, "'")],
  ['no quote at all', 100, a => a.replace(/[’‘']/g, '')],
  ['first alt only', 99, a => a.split('/')[0].trim()],
  ['last alt only', 99, a => a.split('/').pop().trim()],
  ['drop parens', 99, a => a.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()],
  ['keep parens text', 100, a => a.replace(/[()]/g, '')],
  ['extra spaces', 100, a => '  ' + a + '  '],
];

const res = {};
for (const b of HAVE) {
  const c = {};
  T.forEach(([n]) => c[n] = [0, 0]);
  eachItem(loaded[b], (it, a) => {
    for (const [n, , f] of T) {
      let v;
      try { v = f(a); } catch (e) { continue; }
      if (!v || !norm(v)) continue;
      c[n][1]++;
      if (isMatch(v, it)) c[n][0]++;
    }
  });
  res[b] = c;
}

console.log('acceptance rate of learner inputs that should be accepted:');
process.stdout.write('transform'.padEnd(18));
HAVE.forEach(b => process.stdout.write(b.slice(0, 11).padEnd(13)));
console.log();
for (const [n] of T) {
  process.stdout.write(n.padEnd(18));
  for (const b of HAVE) {
    const [ok, tot] = res[b][n];
    process.stdout.write(((100 * ok / (tot || 1)).toFixed(1) + '%').padEnd(13));
  }
  console.log();
}

r.head('inputs that must be accepted');
for (const [n, floor] of T) {
  let ok = 0, tot = 0;
  for (const b of HAVE) { ok += res[b][n][0]; tot += res[b][n][1]; }
  const rate = tot ? 100 * ok / tot : 100;
  r.ok('"' + n + '" is accepted at least ' + floor + '% of the time',
    rate >= floor, rate.toFixed(2) + '% (' + ok + '/' + tot + ')');
}

/* ---- harder shapes: plausible, and not all of them accepted ----

   These are measured and printed but only two are asserted on. The other two
   are known-bad and named as such: an answer of a hundred characters of prose
   cannot be matched from its first clause without accepting half the wrong
   answers too, and the app marks those rows self-checked instead. Printing them
   keeps the number visible; asserting on them would freeze a number nobody
   intends to move. */
const HARD = [
  ['multi-part "a..b.." — types only part a', null,
    a => /(^|\s)a\s/.test(a) && /\sb\s/.test(a), a => a.replace(/^a\s+/, '').split(/\s+b\s+/)[0]],
  ['ellipsis answer — types both words, no dots', 99,
    a => /\.{2,}|…/.test(a), a => a.replace(/\.{2,}|…/g, ' ').replace(/\s+/g, ' ').trim()],
  ['comma list — reversed order', 99,
    a => a.includes(',') && a.split(',').length === 2,
    a => a.split(',').map(s => s.trim()).reverse().join(', ')],
  ['long prose answer — types the first clause', null,
    a => a.length > 90, a => a.split(/[.;(]/)[0].trim()],
];

console.log('\nfalse-negative risk (learner types a reasonable form, app says WRONG):');
const hardTotals = {};
HARD.forEach(([n]) => hardTotals[n] = [0, 0]);
for (const b of HAVE) {
  const c = {};
  HARD.forEach(([n]) => c[n] = [0, 0]);
  eachItem(loaded[b], (it, a) => {
    for (const [n, , pred, f] of HARD) {
      if (!pred(a)) continue;
      const v = f(a);
      if (!v || !norm(v) || norm(v) === norm(a)) continue;
      c[n][1]++;
      if (isMatch(v, it)) c[n][0]++;
    }
  });
  console.log(' ' + b);
  for (const [n] of HARD) {
    const [ok, tot] = c[n];
    hardTotals[n][0] += ok;
    hardTotals[n][1] += tot;
    if (tot) console.log('    ' + n.padEnd(46) + ok + '/' + tot + ' accepted (' + (100 * ok / tot).toFixed(0) + '%)');
  }
}

r.head('harder shapes');
for (const [n, floor] of HARD) {
  const [ok, tot] = hardTotals[n];
  // No rows of this shape is not a pass. It means the books stopped containing
  // the thing being measured, which is worth saying out loud rather than
  // scoring 0/0 as 100%.
  if (!tot) { r.warnIf(true, n + ': no rows of this shape in the books on disk'); continue; }
  const rate = 100 * ok / tot;
  if (floor == null) { r.note(n + ': ' + rate.toFixed(1) + '% — known, not asserted on'); continue; }
  r.ok('"' + n + '" is accepted at least ' + floor + '% of the time',
    rate >= floor, rate.toFixed(2) + '% (' + ok + '/' + tot + ')');
}

/* ---- and the other direction ----

   A checker that accepts everything would score 100% on every line above. The
   ceiling is what stops a fix for a false negative from being paid for with
   false positives — the worse of the two errors, because it teaches the wrong
   answer. It is not zero: "a" and "the" really are the answer to some rows. */
const JUNK = ['qwerty', 'zzz', 'a', 'the', '1', ' '];
const FP_CEILING = 0.5;   // per cent; measured at 0.27
let fp = 0, fpt = 0;
for (const b of HAVE) {
  eachItem(loaded[b], it => {
    for (const junk of JUNK) { fpt++; if (isMatch(junk, it)) fp++; }
  });
}
const fpRate = fpt ? 100 * fp / fpt : 0;
console.log('\nfalse-positive check (nonsense input must be rejected):');
console.log('  nonsense accepted: ' + fp + ' / ' + fpt + ' (' + fpRate.toFixed(2) + '%)');

r.head('inputs that must be rejected');
r.ok('nonsense is accepted on under ' + FP_CEILING + '% of rows',
  fpRate <= FP_CEILING, fpRate.toFixed(2) + '% (' + fp + '/' + fpt + ')');

process.exit(r.done() ? 1 : 0);
