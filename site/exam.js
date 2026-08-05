/* What a raw IELTS score means, and how long a test section is allowed to take.

   The site holds the answers to three Cambridge IELTS books, so it already
   knows how many of forty a reader got right. The number a candidate actually
   cares about is the band, and until now nothing here converted one into the
   other — the reader was left counting ticks and guessing.

   Two different things are offered, and they must not be confused with each
   other, which is why they live in separate tables:

   1. `chart` — what the BOOK ITSELF prints. Every Cambridge practice test ends
      with a three-way "If you score …" chart telling the candidate whether they
      are ready to sit the exam. Those thresholds are per test, not per book
      (Cambridge 21 Test 1 Listening breaks at 19/28, Test 4 at 16/26), and the
      ones below were read straight out of site/pdf/ielts-21.pdf. This is
      Cambridge's own judgement and is quoted as such.

   2. `band` — the raw-score-to-band conversion. Cambridge does NOT print one in
      these books: a real band comes from the version of the test actually sat,
      and the published tables are the long-standing averages. So it is offered
      as an estimate and the UI says so, every time, in both languages.

   Where the chart is missing, the estimate still works — that is the point of
   keeping them apart. Only Cambridge 21 ships a text layer over those pages;
   19's are a scan and 20 does not include the interpretation pages at all. Add
   a book to `chart` the day somebody reads its charts by eye, exactly the way
   ielts-19-key.json was filled in.

   Public surface: window.EXAM — see the return block at the bottom. */
window.EXAM = (function () {
  'use strict';

  /* ================= band estimate ================= */

  // Descending [minimum raw score, band]. First row whose minimum is met wins;
  // below the last row the estimate is not meaningful and bandFor returns null
  // rather than inventing a number for a score of two.
  var BAND = {
    listening: [
      [39, 9], [37, 8.5], [35, 8], [32, 7.5], [30, 7], [26, 6.5], [23, 6],
      [18, 5.5], [16, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5]
    ],
    // Academic Reading. All three books here are Academic; a General Training
    // module converts on a different (harsher) table, so if one is ever added
    // it needs its own row rather than this one.
    reading: [
      [39, 9], [37, 8.5], [35, 8], [33, 7.5], [30, 7], [27, 6.5], [23, 6],
      [19, 5.5], [15, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5]
    ]
  };

  function bandFor(skill, raw) {
    var table = BAND[skill];
    if (!table || raw == null) return null;
    for (var i = 0; i < table.length; i++) {
      if (raw >= table[i][0]) return table[i][1];
    }
    return null;
  }

  /* ================= the book's own chart ================= */

  // bookId -> test number -> skill -> [top of the bottom band, top of the
  // middle band]. Read from the "If you score" charts printed after each
  // answer key in Cambridge 21 (pages 117–124 of the PDF).
  var CHART = {
    'ielts-21': {
      1: { listening: [19, 28], reading: [18, 27] },
      2: { listening: [19, 28], reading: [19, 28] },
      3: { listening: [18, 27], reading: [17, 26] },
      4: { listening: [16, 26], reading: [17, 26] }
    }
  };

  // 'low' | 'mid' | 'high', or null when this test prints no chart we have read.
  // The three verdicts are Cambridge's own wording, translated in i18n.js under
  // exam.chart.*.
  function chartFor(bookId, test, skill, raw) {
    var byTest = CHART[bookId];
    var row = byTest && byTest[test] && byTest[test][skill];
    if (!row || raw == null) return null;
    if (raw <= row[0]) return 'low';
    if (raw <= row[1]) return 'mid';
    return 'high';
  }

  /* ================= the clock ================= */

  // Seconds a section is allowed. Reading is the exam's own hour. Listening in
  // the real exam is the length of the recording plus ten minutes to copy
  // answers onto the answer sheet; here the reader starts the recording
  // themselves, so the allowance is the usual ~30 minutes of audio plus that
  // transfer time. Both are deliberately round numbers a learner can hold in
  // their head, and both can be turned off — the timer is a rehearsal aid, not
  // a lock.
  var LIMIT = { listening: 40 * 60, reading: 60 * 60 };

  function limitFor(skill) { return LIMIT[skill] || 60 * 60; }

  // 'mm:ss', or 'h:mm:ss' once an hour is on the clock. Used for the countdown
  // and for "you took …" on the result screen, so it has to read well small.
  function clock(secs) {
    var s = Math.max(0, Math.round(secs));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    var mm = (h ? ('0' + m).slice(-2) : String(m));
    return (h ? h + ':' : '') + mm + ':' + ('0' + r).slice(-2);
  }

  /* ================= the shape of a test section ================= */

  // An IELTS unit here is one section of one test: "Test 3 — Listening". The
  // test number is not stored as a field — it is in the title the builder wrote
  // and in the unit number (units run 1..8, listening odd, reading even) — so
  // both are tried, title first.
  function testOf(unit) {
    if (!unit) return null;
    var m = /(\d+)/.exec(String(unit.title || ''));
    if (m) return Number(m[1]);
    if (unit.unit != null) return Math.ceil(Number(unit.unit) / 2);
    return null;
  }

  function isExamUnit(bookMeta, unit) {
    return !!(bookMeta && bookMeta.kind === 'ielts' && unit && unit.skill &&
      (unit.skill === 'listening' || unit.skill === 'reading'));
  }

  return {
    bandFor: bandFor,
    chartFor: chartFor,
    hasChart: function (bookId) { return !!CHART[bookId]; },
    limitFor: limitFor,
    clock: clock,
    testOf: testOf,
    isExamUnit: isExamUnit
  };
})();
