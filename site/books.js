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
      kk: 'Ең танымал орта деңгей курсы. Шақтар, модальдар, шартты сөйлемдер.',
      en: 'The best-known intermediate course. Tenses, modals, conditionals.'
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
  }
];
