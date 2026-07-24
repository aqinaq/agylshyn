/* Placement quiz: eight graded grammar items that estimate a rough CEFR level
   for a brand-new visitor, then point them at the two books to start with.

   The questions themselves are English, so they are not translated — the whole
   point is to read English. Only the surrounding UI (in i18n.js, `plc.*`) is
   bilingual. Questions are ordered easy → hard; `a` is the index of the correct
   option. Keep answers unambiguous: this decides which shelf a beginner lands on,
   so a trick question that a strong learner could misread would misplace them.

   `tracks` maps a raw score (0–8 correct) to one recommendation. The two book
   ids MUST exist in books.js; app.js looks them up and links straight to them.
   Order the tracks low → high and cover 0..questions.length with no gaps. */
window.PLACEMENT = {
  questions: [
    { level: 'A1', q: 'My sister ___ a doctor.',
      options: ['is', 'are', 'am', 'be'], a: 0 },
    { level: 'A1', q: '___ you like tea?',
      options: ['Do', 'Does', 'Is', 'Are'], a: 0 },
    { level: 'A2', q: 'Yesterday I ___ to the shop.',
      options: ['go', 'went', 'gone', 'going'], a: 1 },
    { level: 'A2', q: 'She has worked here ___ 2019.',
      options: ['since', 'for', 'from', 'at'], a: 0 },
    { level: 'B1', q: 'If it rains tomorrow, we ___ at home.',
      options: ['stay', 'will stay', 'stayed', 'would stay'], a: 1 },
    { level: 'B1', q: "I'm not used to ___ up early.",
      options: ['get', 'getting', 'got', 'to get'], a: 1 },
    { level: 'B2', q: 'By next June, they ___ here for ten years.',
      options: ['live', 'will live', 'will have lived', 'lived'], a: 2 },
    { level: 'C1', q: '___ harder, she would have passed the exam.',
      options: ['If she studied', 'Had she studied', 'Did she study', 'If she study'], a: 1 }
  ],

  // min/max are inclusive, in "questions correct". Bands must tile 0..8.
  tracks: [
    { id: 'beginner',     min: 0, max: 3, band: 'A1–A2',
      grammar: 'essential-grammar', vocab: 'vocab-elem' },
    { id: 'intermediate', min: 4, max: 6, band: 'B1–B2',
      grammar: 'grammar',           vocab: 'vocab-preint' },
    { id: 'advanced',     min: 7, max: 8, band: 'C1–C2',
      grammar: 'advanced-grammar',  vocab: 'vocab-adv' }
  ],

  // Goal shortcuts shown under every result, independent of the level score —
  // someone at B1 may still be aiming at IELTS. Book ids must exist in books.js.
  goals: [
    { id: 'ielts',    book: 'ielts-21' },
    { id: 'business', book: 'business' },
    { id: 'academic', book: 'academic' }
  ]
};
