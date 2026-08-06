/* Book catalogue. Order here is the order shown on the library page.
   `kind` is a stable id — its visible label comes from i18n (lib.group.*). */
window.BOOKS = [
  {
    id: 'essential-grammar',
    title: 'Essential Grammar in Use',
    author: 'Raymond Murphy · 2nd edition',
    level: 'A1–A2',
    kind: 'grammar',
    units: 114,
    blurb: {
      kk: 'Бастауыш деңгей. Қысқа юниттер, көп қайталау — негізді бекітуге.',
      en: 'Elementary level. Short units and plenty of repetition to lock the basics in.'
    },
    pdf: 'pdf/essential-grammar.pdf',
    hue: 152,
    // No question text in the data, so the reader has to have the book open —
    // app.js opens the pane by default on a wide screen because of this.
    needsPdf: true,
    // This book's PDF is a pure scan, so its data came out thinner than the
    // rest. Shown on the card and once inside the book.
    warning: {
      kk: {
        title: 'Бұл кітап басқаларынан өзгеше',
        text: 'Осы кітаптың жауап кілті сканерден алынған, сондықтан одан деректі шығару ' +
              'басқа бес кітаптағыдай толық болмады:',
        list: [
          'Сұрақтардың мәтіні жоқ — тек жауаптары бар. Сұрақтың өзін кітаптан оқып отыруың керек.',
          '114 юниттің 14-інің тақырыбы қалпына келмеді, олар «Unit N» болып тұр — оларды нөмір бойынша ізде.',
          'Кейбір нұсқаулықта танудан кеткен қате әріптер кездеседі.'
        ],
        tip: 'Сол себепті бұл кітапта «PDF-ті ашу» аса қажет: кітап оң жақта ашық тұрсын да, ' +
             'сұрақты содан оқып, жауабын осында жаз. PDF керек беттен ашылады.',
        short: [
          'Сұрақтардың мәтіні жоқ — тек жауаптары',
          '14 юниттің тақырыбы қалпына келмеді',
          'Сұрақты PDF-тен оқып отыр'
        ]
      },
      en: {
        title: 'This book works differently from the others',
        text: 'This book\u2019s answer key was pulled out of a scan, so the extraction ' +
              'came out thinner than for the other five books:',
        list: [
          'The questions themselves are missing — only the answers are here. You need to read each question from the book.',
          '14 of the 114 units could not have their titles recovered and show "Unit N" — find those by number.',
          'A few instructions still contain scanning errors.'
        ],
        tip: 'That is exactly why "Open the PDF" matters most in this book: keep the book ' +
             'open on the right, read the question there and type the answer here. The PDF opens at the right page.',
        short: [
          'No question text — answers only',
          '14 unit titles unrecovered',
          'Read the questions from the PDF'
        ]
      }
    }
  },
  {
    id: 'grammar',
    title: 'English Grammar in Use',
    author: 'Raymond Murphy · Blue',
    level: 'B1–B2',
    kind: 'grammar',
    units: 145,
    blurb: {
      kk: 'Ең танымал орта деңгей курсы. Қиын юниттерінде қазақша түсіндірме бар.',
      en: 'The best-known intermediate course. The hard units carry a Kazakh explanation.'
    },
    pdf: 'pdf/grammar.pdf',
    hue: 214
  },
  {
    id: 'advanced-grammar',
    title: 'Advanced Grammar in Use',
    author: 'Martin Hewings · 3rd edition',
    level: 'C1–C2',
    kind: 'grammar',
    units: 116,
    blurb: {
      kk: 'Жоғары деңгей. Соңында 16 қосымша қайталау жаттығуы бар.',
      en: 'Advanced level. Ends with 16 additional revision exercises.'
    },
    pdf: 'pdf/advanced-grammar.pdf',
    hue: 268
  },
  {
    id: 'vocab-elem',
    title: 'Vocabulary in Use — Elementary',
    author: 'Cambridge · 3rd edition',
    level: 'A1–A2',
    kind: 'vocab',
    units: 60,
    blurb: {
      kk: 'Elementary. Ең қажет күнделікті сөздер: отбасы, тамақ, киім, уақыт.',
      en: 'Elementary. The everyday core: family, food, clothes, telling the time.'
    },
    pdf: 'pdf/vocab-elem.pdf',
    hue: 88
  },
  {
    id: 'vocab-preint',
    title: 'Vocabulary in Use — Pre-Intermediate',
    author: 'Cambridge · 4th edition',
    level: 'A2–B1',
    kind: 'vocab',
    units: 100,
    blurb: {
      kk: 'Pre-Intermediate. Күнделікті тақырыптар бойынша сөздік қор.',
      en: 'Pre-Intermediate. Vocabulary for everyday topics.'
    },
    pdf: 'pdf/vocab-preint.pdf',
    hue: 26
  },
  {
    id: 'vocab-upint',
    title: 'Vocabulary in Use — Upper-Intermediate',
    author: 'Cambridge · 4th edition',
    level: 'B2',
    kind: 'vocab',
    units: 101,
    blurb: {
      kk: 'Upper-Intermediate. Идиомалар, фразалық етістіктер, тіркестер.',
      en: 'Upper-Intermediate. Idioms, phrasal verbs and collocations.'
    },
    pdf: 'pdf/vocab-upint.pdf',
    hue: 340
  },
  {
    id: 'vocab-adv',
    title: 'Vocabulary in Use — Advanced',
    author: 'McCarthy & O’Dell',
    level: 'C1–C2',
    kind: 'vocab',
    units: 101,
    blurb: {
      kk: 'Advanced. Академиялық және дерексіз лексика, стиль реңктері.',
      en: 'Advanced. Academic and abstract vocabulary, shades of register.'
    },
    pdf: 'pdf/vocab-adv.pdf',
    hue: 190
  },
  {
    id: 'collocations',
    title: 'Collocations in Use — Intermediate',
    author: 'McCarthy & O’Dell · 2nd edition',
    level: 'B1–B2',
    kind: 'vocab',
    units: 60,
    blurb: {
      kk: 'Қай сөз қай сөзбен тіркеседі: «дұрыс» пен «табиғи» ағылшынның айырмасы.',
      en: 'Which words go together — the difference between correct and natural English.'
    },
    pdf: 'pdf/collocations.pdf',
    hue: 304
  },
  {
    id: 'academic',
    title: 'Academic Vocabulary in Use',
    author: 'McCarthy & O’Dell · 2nd edition',
    level: 'B2–C1',
    kind: 'vocab',
    units: 50,
    blurb: {
      kk: 'Университет пен IELTS тілі: дәріс, зерттеу, эссе, дереккөз лексикасы.',
      en: 'The language of university and IELTS: lectures, research, essays, sources.'
    },
    pdf: 'pdf/academic.pdf',
    hue: 56
  },
  {
    id: 'business',
    title: 'Business Vocabulary in Use — Intermediate',
    author: 'Bill Mascull · 3rd edition',
    level: 'B1–B2',
    kind: 'vocab',
    units: 66,
    blurb: {
      kk: 'Жұмыс пен кеңсе тілі: жұмысқа қабылдау, келіссөз, қаржы, маркетинг.',
      en: 'The language of work: recruitment, meetings, finance and marketing.'
    },
    pdf: 'pdf/business.pdf',
    hue: 120
  },
  {
    id: 'ielts-19',
    title: 'Cambridge IELTS 19 — Academic',
    author: 'Cambridge · 2024',
    level: 'B2–C1',
    kind: 'ielts',
    units: 8,
    blurb: {
      kk: '4 тест, Listening аудиосымен. Уақытпен тапсырып, шамамен band ал.',
      en: 'Four tests with the Listening audio. Sit one against the clock and get a band.'
    },
    pdf: 'pdf/ielts-19.pdf',
    hue: 175,
    // An answer sheet, by design: the questions stay in the book, so the pane
    // has to be open for the page to make sense, and each row is only its
    // number and a box — no "read this in the PDF" on all forty of them.
    needsPdf: true,
    answerSheet: true
  },
  {
    id: 'ielts-20',
    title: 'Cambridge IELTS 20 — Academic',
    author: 'Cambridge · 2025',
    level: 'B2–C1',
    kind: 'ielts',
    // Eight units: Listening and Reading for each of the four tests.
    units: 8,
    blurb: {
      kk: '4 нағыз тест. Аудио, Reading мәтіні, емтихан режимі мен band.',
      en: 'Four authentic tests: audio, the passages, exam conditions and a band.'
    },
    pdf: 'pdf/ielts-20.pdf',
    hue: 12,
    // An answer sheet, by design: the questions stay in the book, so the pane
    // has to be open for the page to make sense, and each row is only its
    // number and a box — no "read this in the PDF" on all forty of them.
    needsPdf: true,
    answerSheet: true
  },
  {
    id: 'ielts-21',
    title: 'Cambridge IELTS 21 — Academic',
    author: 'Cambridge · 2026',
    level: 'B2–C1',
    kind: 'ielts',
    units: 8,
    blurb: {
      kk: 'Ең соңғы жинақ: 4 тест, Writing/Speaking тапсырмалары, аудио мәтіні мен диктант.',
      en: 'The newest collection: four tests, the Writing/Speaking tasks, transcripts and dictation.'
    },
    pdf: 'pdf/ielts-21.pdf',
    hue: 240,
    // An answer sheet, by design: the questions stay in the book, so the pane
    // has to be open for the page to make sense, and each row is only its
    // number and a box — no "read this in the PDF" on all forty of them.
    needsPdf: true,
    answerSheet: true
  }
];
