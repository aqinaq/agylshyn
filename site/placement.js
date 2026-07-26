/* Placement quiz: eight graded grammar items that estimate a rough CEFR level
   for a brand-new visitor, then point them at the two books to start with.

   The questions themselves are English, so they are not translated — the whole
   point is to read English. Only the surrounding UI (in i18n.js, `plc.*`) is
   bilingual. Keep answers unambiguous: this decides which shelf a beginner lands
   on, so a trick question that a strong learner could misread would misplace them.

   `pool` is a BANK, not a fixed test: every run draws one question per
   `blueprint` slot from that slot's level, and app.js holds back what the
   previous runs already asked (and shuffles the options), so a retake is a new
   test rather than a memory check of the last one. That means each level needs
   several interchangeable items of the SAME difficulty — a slot must be safe to
   fill with any of them. Ids are stable and must stay unique: they are what the
   "already asked" memory stores (in `state.placement.seen`).

   `a` is the index of the correct option as authored here (app.js re-maps it
   after shuffling). `tracks` maps a raw score (0–8 correct) to one
   recommendation; the two book ids MUST exist in books.js, because app.js looks
   them up and links straight to them. Order the tracks low → high and cover
   0..blueprint.length with no gaps. */
window.PLACEMENT = {
  // One run, slot by slot. Length also sets the score range the tracks tile.
  blueprint: ['A1', 'A1', 'A2', 'A2', 'B1', 'B1', 'B2', 'C1'],

  pool: [
    /* ---- A1: to be, present simple, basic questions and possessives ---- */
    { id: 'a1-1', level: 'A1', q: 'My sister ___ a doctor.',
      options: ['is', 'are', 'am', 'be'], a: 0 },
    { id: 'a1-2', level: 'A1', q: '___ you like tea?',
      options: ['Do', 'Does', 'Is', 'Are'], a: 0 },
    { id: 'a1-3', level: 'A1', q: 'There ___ two books on the table.',
      options: ['are', 'is', 'be', 'am'], a: 0 },
    { id: 'a1-4', level: 'A1', q: 'This is my bag, and that one is ___ bag.',
      options: ['her', 'she', 'hers', "she's"], a: 0 },
    { id: 'a1-5', level: 'A1', q: 'He ___ get up early on Sundays.',
      options: ["doesn't", "don't", "isn't", 'not'], a: 0 },
    { id: 'a1-6', level: 'A1', q: '___ is your birthday? — In May.',
      options: ['When', 'Where', 'Who', 'How'], a: 0 },
    { id: 'a1-7', level: 'A1', q: 'We ___ football every Saturday.',
      options: ['play', 'plays', 'playing', 'are play'], a: 0 },
    { id: 'a1-8', level: 'A1', q: 'Look — the children ___ in the garden.',
      options: ['are playing', 'is playing', 'play is', 'plays'], a: 0 },

    /* ---- A2: past simple, present perfect basics, futures, quantifiers ---- */
    { id: 'a2-1', level: 'A2', q: 'Yesterday I ___ to the shop.',
      options: ['went', 'go', 'gone', 'going'], a: 0 },
    { id: 'a2-2', level: 'A2', q: 'She has worked here ___ 2019.',
      options: ['since', 'for', 'from', 'at'], a: 0 },
    { id: 'a2-3', level: 'A2', q: 'This film is ___ than the book.',
      options: ['better', 'more good', 'gooder', 'best'], a: 0 },
    { id: 'a2-4', level: 'A2', q: "I can't talk now — I ___ dinner.",
      options: ['am cooking', 'cook', 'cooks', 'cooked'], a: 0 },
    { id: 'a2-5', level: 'A2', q: 'There isn’t ___ milk in the fridge.',
      options: ['any', 'some', 'many', 'a'], a: 0 },
    { id: 'a2-6', level: 'A2', q: 'He was tired, ___ he went to bed early.',
      options: ['so', 'but', 'because', 'although'], a: 0 },
    { id: 'a2-7', level: 'A2', q: 'We ___ visit my grandmother next weekend.',
      options: ['are going to', 'go to', 'went to', 'are'], a: 0 },
    { id: 'a2-8', level: 'A2', q: 'I ___ never been to Spain.',
      options: ['have', 'has', 'am', 'was'], a: 0 },

    /* ---- B1: conditionals, gerunds, passive, reported speech, modals ---- */
    { id: 'b1-1', level: 'B1', q: 'If it rains tomorrow, we ___ at home.',
      options: ['will stay', 'stay', 'stayed', 'would stay'], a: 0 },
    { id: 'b1-2', level: 'B1', q: "I'm not used to ___ up early.",
      options: ['getting', 'get', 'got', 'to get'], a: 0 },
    { id: 'b1-3', level: 'B1', q: 'The bridge ___ last year.',
      options: ['was built', 'built', 'has built', 'is building'], a: 0 },
    { id: 'b1-4', level: 'B1', q: 'She asked me where I ___ from.',
      options: ['came', 'come', 'coming', 'do come'], a: 0 },
    { id: 'b1-5', level: 'B1', q: 'You ___ pay — the ticket is free.',
      options: ["don't have to", "mustn't", "can't", "shouldn't"], a: 0 },
    { id: 'b1-6', level: 'B1', q: 'He said he ___ finished the report.',
      options: ['had', 'has', 'have', 'was'], a: 0 },
    { id: 'b1-7', level: 'B1', q: "It's the ___ interesting book I've read.",
      options: ['most', 'more', 'much', 'very'], a: 0 },
    { id: 'b1-8', level: 'B1', q: "I'll call you as soon as I ___ home.",
      options: ['get', 'will get', 'am getting', 'got'], a: 0 },

    /* ---- B2: perfect futures, unreal past, relatives, verb patterns ---- */
    { id: 'b2-1', level: 'B2', q: 'By next June, they ___ here for ten years.',
      options: ['will have lived', 'live', 'will live', 'lived'], a: 0 },
    { id: 'b2-2', level: 'B2', q: "I'd rather you ___ smoke in here.",
      options: ["didn't", "don't", "wouldn't", "aren't"], a: 0 },
    { id: 'b2-3', level: 'B2', q: '___ the heavy traffic, we arrived on time.',
      options: ['Despite', 'Although', 'However', 'In spite'], a: 0 },
    { id: 'b2-4', level: 'B2', q: "It's high time we ___ something about it.",
      options: ['did', 'do', 'will do', 'have done'], a: 0 },
    { id: 'b2-5', level: 'B2', q: "She's the woman ___ car was stolen.",
      options: ['whose', 'which', "who's", 'that'], a: 0 },
    { id: 'b2-6', level: 'B2', q: 'He denied ___ the money.',
      options: ['taking', 'to take', 'take', 'been taking'], a: 0 },
    { id: 'b2-7', level: 'B2', q: 'I wish I ___ more free time.',
      options: ['had', 'have', 'will have', 'having'], a: 0 },
    { id: 'b2-8', level: 'B2', q: 'The report needs ___ before Friday.',
      options: ['finishing', 'finish', 'to finishing', 'finished'], a: 0 },

    /* ---- C1: inversion, unreal past forms, fixed structures ---- */
    { id: 'c1-1', level: 'C1', q: '___ harder, she would have passed the exam.',
      options: ['Had she studied', 'If she studied', 'Did she study', 'If she study'], a: 0 },
    { id: 'c1-2', level: 'C1', q: 'No sooner ___ the door than the phone rang.',
      options: ['had I opened', 'I had opened', 'I opened', 'did I open'], a: 0 },
    { id: 'c1-3', level: 'C1', q: 'Little ___ that he was being watched.',
      options: ['did he know', 'he knew', 'he did know', 'knew he'], a: 0 },
    { id: 'c1-4', level: 'C1', q: 'Not only ___ the deadline, but he also improved the design.',
      options: ['did he meet', 'he met', 'met he', 'he did meet'], a: 0 },
    { id: 'c1-5', level: 'C1', q: 'Had it not been ___ your help, we would have failed.',
      options: ['for', 'of', 'to', 'with'], a: 0 },
    { id: 'c1-6', level: 'C1', q: 'The committee turned the proposal ___ without a vote.',
      options: ['down', 'off', 'over', 'up'], a: 0 },
    { id: 'c1-7', level: 'C1', q: 'She is fluent in Japanese, ___ she has never lived there.',
      options: ['even though', 'despite', 'in spite of', 'however'], a: 0 },
    { id: 'c1-8', level: 'C1', q: 'Only after the meeting ___ how serious it was.',
      options: ['did we realise', 'we realised', 'we did realise', 'realised we'], a: 0 }
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
