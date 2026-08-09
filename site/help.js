/* How-to-use guide, shown in a dialog. Rendered by renderHelpInto() in app.js.
   Keep it short — it is a reminder, not a manual: one screen, one idea per
   line. Anything that needs a paragraph belongs in site/README.md instead.
   Section shape: {icon, title, body:[…], list:[…], rows:[[label, text], …]}

   The two languages are the same guide, section for section. A line added to
   one side and not the other is how this file goes stale. */
window.HELP = {

  kk: [
    {
      icon: '🧭',
      title: 'Қайдан бастаймын?',
      list: [
        'Басты беттегі «Қайдан бастаймын?» — 8 қысқа сұрақ, тіркелудің қажеті жоқ. Соңында деңгейің мен содан бастайтын екі кітап шығады, қайта тапсырсаң сұрақтары жаңа болады.',
        'Нақты мақсатың болса — IELTS, жұмыс тілі, академиялық лексика — сол жердегі түймелер тиісті кітапқа апарады.',
        'Ұсынылған кітаптың астында «жаттығуы жазылыммен» не «сұрақтары кітапта» деп жазылып тұрады: ашпай тұрып білесің.'
      ]
    },
    {
      icon: '✍️',
      title: 'Жауап беру',
      list: [
        'Бас әріп, тыныс белгі, тырнақша ескерілмейді: «don’t» да, «do not» да дұрыс.',
        'Сәйкестендіру жаттығуында жауап — әріп: нұсқалар (a–h) сұрақтардың қасында тұрады, өрісте «Әріп (a–h)» деп жазулы, жазған әрібің тізімнен сызылып отырады.',
        '«Тапсырманы тексеру» — сол жаттығуға жазғаныңның бәрін бір-ақ рет тексереді.',
        'Бір ғана дұрыс жауабы жоқ сұрақтар «өзің тексер» белгісімен тұрады — ✓ / ✗ дегенді өзің басасың, неге солай екені қасында жазулы.',
        'Кілті PDF-тен шықпаған жолда «📗 Жауап кілті» түймесі кітаптың кілт бетін ашады.',
        '«Мен дұрыс жаздым» — қате қойылған белгіні кері қайтарады.'
      ],
      rows: [
        ['Enter', 'Тексеру + келесі сұрақ'],
        ['Tab', 'Келесі өріс (тексерусіз)'],
        ['Ctrl/⌘ + K', 'Іздеу']
      ]
    },
    {
      icon: '📝',
      title: 'Осында жаз',
      body: [
        'Машина тексере алмайтын тапсырмаларда да жазатын орын бар: эссе, кроссворд, сканнан сұрағы шықпаған жаттығу, тіпті жаттығуы жоқ юнит. Дәптерге емес, осында жаз — жазғаның өздігінен сақталады.'
      ],
      list: [
        'Сөз саны қасында тұрады; «Көшіру» мен «Тазалау» жазып бастаған соң шығады.',
        'Тапсырманың басында «✓ жазылды» деген белгі қалады — бұл баға емес (мұнда баға қойылмайды), жазғаныңның ізі.',
        'Аккаунтқа кірген болсаң, жазғаның басқа құрылғыда да тұрады.'
      ]
    },
    {
      icon: '⚡',
      title: 'Жаттығу сессиясы',
      body: [
        'Бір экранда бір сұрақ: қателерің, қайталау мерзімі жеткендері және жаңалары араласып келеді — қате бірінші.'
      ],
      list: [
        'Басты беттегі ⚡ — барлық кітаптан аралас; кітаптың ішіндегі ⚡ — сол кітаптан ғана.',
        '10, 20 не 50 сұрақ. Соңында нәтиже мен қате жауаптардың тізімі шығады.',
        'Пернетақтамен: Enter — тексеру, тағы Enter — келесі.'
      ]
    },
    {
      icon: '💡',
      title: 'Көмек',
      list: [
        'Үш саты: жауаптың пішіні мен әріп саны → әр сөздің бірінші әрпі → жауаптың өзі.',
        'Көмекпен берілген жауап есептеледі, бірақ ★ меңгерілгенге жеткізбейді және сұрақ ертең қайта келеді.'
      ]
    },
    {
      icon: '🔎',
      title: 'Іздеу мен сөздік',
      list: [
        'Ctrl/⌘ + K — сұрақтың мәтіні, жауабы, юнит атауы бойынша іздейді; нәтижені бассаң, дәл сол сұраққа апарады.',
        'Іздеу ағылшынша: кітаптардың бәрі ағылшын тілінде, кириллицамен ештеңе табылмайды.',
        'Кез келген ағылшын сөзіне меңзе (немесе қос шерт, телефонда — басып тұр) — қазақша аудармасы шығады.',
        'Сол терезедегі «＋ Сөздеріме» — сөзді өз жинағыңа қосады (🗂).',
        '🔊 — сұрақты, дұрыс жауапты, сөзді браузердің өз даусы оқиды.'
      ]
    },
    {
      icon: '🗂',
      title: 'Сөз карталары',
      body: [
        'Аудармасын қарап шыққан сөзді ＋ арқылы жинағыңа қосасың да, күнде бірнеше минут қайталайсың. Ұмыту қисығына қарсы жұмыс: білген сөз сирей береді, ұмытылғаны жиірек оралады.'
      ],
      list: [
        'Картаны бас — аудармасы шығады. Содан кейін төрт баға: «Қайта», «Қиын», «Білдім», «Оңай». Әр түйменің астында сол сөз келесі рет қашан шығатыны жазулы тұр.',
        'Екі рет қате жауап берген сұрағың өздігінен картаға айналады: беті — сұрақ, арты — жауап. Керек болмаса, «Баптау» бетінен өшіріп қоясың.',
        '«Қателер» бетінде тұрғандардың бәрін бір түймемен қосуға да болады.',
        'Телефонда сырғытуға болады: оңға — білдім, солға — жоқ. Компьютерде 1–4 пернелері, U — кері қайтару.',
        'Күніне қанша жаңа сөз көрсетілетінін «Баптау» бетінен өзгертесің (әдепкі — 10).',
        'Тізімнен (Excel, Google Sheets) импорттауға, бәрін файлға сақтап басқа құрылғыда ашуға болады.'
      ]
    },
    {
      icon: '📕',
      title: 'Кітапты қатар ашу',
      list: [
        '«PDF-ті ашу» — оқулық оң жақтан ашылады, сайттан шықпайсың; юнит ауысса, беті де ауысады.',
        'Кейбір кітаптарда сұрақтың мәтіні сайтта жоқ — Essential Grammar мен үш IELTS жинағы жауап парағы ретінде істейді: сұрақты кітаптан оқисың, сайтқа жауабын жазасың. Ондай беттерде панель өзі ашылады.',
        'Панельдер арасындағы сызықты сүйресең ені өзгереді, қос шертсең — қалпына оралады.'
      ]
    },
    {
      icon: '⭐',
      title: 'Меңгеру мен қайталау',
      list: [
        'Әртүрлі күні қатарынан 3 рет дұрыс — ★ меңгерілді.',
        'Қателер «Қателер» бетіне жиналады, 3 рет дұрыс жауаптан кейін шығады.',
        'Меңгерілмегендер кестемен қайталауға оралады: 1 → 3 → 7 → 21 → 60 күн.'
      ]
    },
    {
      icon: '⏱',
      title: 'IELTS: емтихан режимі',
      body: [
        'Тест бөлімін нағыз емтихандағыдай тапсырасың: уақыт жүреді, жауап бірден тексерілмейді, соңында бәрі бір-ақ рет тексеріліп, балл мен шамамен band шығады.'
      ],
      list: [
        'Кез келген IELTS юнитінің басындағы «⏱ Емтихан режимі» түймесі. Listening — 40 минут, Reading — 60.',
        'Writing бетінде де сол түйме бар: екі тапсырмаға бір сағат, тапсырма сайынғы таймер мен «Тазалау» жабылады. Мұнда балл қойылмайды — соңында уақытың, сөз саның және критерийлер шығады.',
        'Speaking-те емтихан режимі жоқ: ол — әңгіме, беттің өз таймерлері (1 мин дайындық, 2 мин сөйлеу) нағыз дайындығы сол.',
        'Жартылай қалдырып кетсең, уақыты жүріп тұрады да, бетке қайта кірсең сол жерінен жалғайсың.',
        'Соңында: бөлім-бөлім талдау, қате жауаптар және бұрынғы жүгірулердің тізімі. Статистика бетінде «соңғысы / ең жақсысы» болып тұрады.',
        'Band — шамамен есеп: Cambridge бұл кітаптарда ресми кесте бермейді.'
      ]
    },
    {
      icon: '🎧',
      title: 'IELTS: Writing, Speaking және диктант',
      list: [
        'Юниттер тізімі L1 R1 W1 S1 болып тұрады — бір тесттің төрт бөлімі қатар, әрқайсысы өз беті.',
        'Тапсырманың өз мәтіні (кесте, сурет, cue-card) кітапта қалады. Сайттың беретіні — емтихандағы уақыт, сөз санағышы, өзі сақталатын жоба; Speaking-те таймер мен дауыс жазу.',
        'Аудионың астындағы «Мәтін / диктант» — жазбаның мәтінін оқисың немесе әр үшінші сөзі жасырылған диктант істейсің.',
        'Ойнатқышта ↺5 секунд пен 0.75× бар. Емтихан режимінде екеуі де жабық — бұл жаттығу құралы.'
      ]
    },
    {
      icon: '🇰🇿',
      title: 'Қазақша түсіндірме',
      body: [
        'Кітап ағылшынша түсіндіреді. Артикль, present perfect, phrasal verb сияқты тұстар қазақ тілді оқушыға тілдің айырмашылығынан қиын — сондай юниттерде жаттығулардың үстінде қазақша қысқа түсіндірме тұрады.'
      ],
      list: [
        'Бірінші рет кірген юнитте ашық тұрады, кейін жиналып қалады — тақырыбын бассаң қайта ашылады.',
        'Қате жауап бергенде де жанынан «Қазақша түсіндірме» түймесі шығады.'
      ]
    },
    {
      icon: '👩‍🏫',
      title: 'Сынып (мұғалімге)',
      list: [
        'Басты беттегі «Сынып» карточкасы → сынып ашасың, 6 таңбалы кодты оқушыларға бересің.',
        'Оқушы сол беттен кодты жазып қосылады, сен кестеден кім қанша істегенін көресің.',
        'Мұғалім тек санақты көреді: қанша жауап, қаншасы дұрыс, соңғы рет қашан кірген. Жазған жауаптарын ешкім көрмейді.'
      ]
    },
    {
      icon: '🔒',
      title: 'Тегін және ақылы',
      list: [
        'Алты кітап толығымен тегін — аккаунтсыз да, интернетсіз де істейді.',
        'Қалғанының алғашқы юниттері «ҮЛГІ» болып ашық: құлып емес, нағыз жаттығулар. Қалғаны жазылыммен ашылады, бағасы мен төлеу жолы «Ашу» бетінде жазулы.',
        'Оқулықтың PDF-і мен Listening аудиосы — он үш кітаптың бәрінде тегін. Ақылысы — тексерілетін жаттығулары.'
      ]
    },
    {
      icon: '💾',
      title: 'Прогресс',
      list: [
        'Осы браузерде сақталады, әр кітап бөлек; браузер деректерін тазаласаң — өшеді.',
        'Аккаунтқа кірсең (Google, пошта немесе пароль) прогресс бұлтқа жазылып, телефонда да, компьютерде де бір болады. Міндетті емес.',
        'Статистика бетінде прогресті файлға сақтап, кейін қалпына келтіруге болады.',
        'Интернетсіз де ашылады: көрген беттерің мен тегін кітаптар браузерде сақталып қалады.'
      ]
    }
  ],

  en: [
    {
      icon: '🧭',
      title: 'Where do I start?',
      list: [
        '"Where do I start?" on the library page: eight short questions, no sign-up. It ends with your level and the two books to begin with, and a retake draws new questions.',
        'Aiming at something specific — IELTS, work English, academic vocabulary — the buttons there take you straight to the book for it.',
        'A recommended book says under it whether its exercises need a subscription, or whether its questions live in the PDF rather than on the site.'
      ]
    },
    {
      icon: '✍️',
      title: 'Answering',
      list: [
        'Capitals, punctuation and quote marks are ignored: both "don’t" and "do not" count.',
        'A matching exercise is answered with a letter: the choices (a–h) are printed beside the questions, the box asks for "Letter (a–h)", and a letter you use is crossed off the list.',
        '"Check this exercise" marks everything you have written in it at once.',
        'Questions with no single right answer are marked "check it yourself" — you press ✓ or ✗, and the reason it cannot be marked is written beside it.',
        'Where the printed key did not survive extraction, "📗 Answer key" opens the book’s own key.',
        '"I was right" takes back a wrong mark.'
      ],
      rows: [
        ['Enter', 'Check + next question'],
        ['Tab', 'Next box, no check'],
        ['Ctrl/⌘ + K', 'Search']
      ]
    },
    {
      icon: '📝',
      title: 'Write here',
      body: [
        'Exercises nothing can mark still have somewhere to write: essays, crosswords, an exercise whose rows never came off the scan, even a unit with no exercises at all. Write here rather than in a notebook — it saves itself as you type.'
      ],
      list: [
        'A word count sits beside it; Copy and Clear appear once there is something to copy.',
        'The heading gets a "✓ written" mark — not a score, because nothing here can be graded, but the thing you want to see when you scroll back up.',
        'Signed in, what you wrote is on your other devices too.'
      ]
    },
    {
      icon: '⚡',
      title: 'Practice session',
      body: [
        'One question at a time: your mistakes, whatever is due for review, and new questions — mixed, mistakes first.'
      ],
      list: [
        'The ⚡ on the library page mixes every book; the ⚡ inside a book keeps to that book.',
        '10, 20 or 50 questions. The run ends with a score and the list of what you missed.',
        'From the keyboard: Enter checks, Enter again moves on.'
      ]
    },
    {
      icon: '💡',
      title: 'Hints',
      list: [
        'Three steps: the shape of the answer and its letter count → the first letter of each word → the answer.',
        'A hinted answer counts as practice, but earns no ★ mastery, and the question returns tomorrow.'
      ]
    },
    {
      icon: '🔎',
      title: 'Search and dictionary',
      list: [
        'Ctrl/⌘ + K searches question text, answers and unit titles; picking a result takes you straight to that question.',
        'Search in English — every book here is in English, so Cyrillic finds nothing.',
        'Rest the mouse on any English word (or double-click it; press and hold on a phone) for a Kazakh translation.',
        '"＋ Save word" in that popup puts it into your own deck (🗂).',
        '🔊 reads the question, the answer key or the word in the browser’s own voice.'
      ]
    },
    {
      icon: '🗂',
      title: 'Word cards',
      body: [
        'Save a word you looked up with ＋, then review for a few minutes a day. It works against the forgetting curve: words you know come back rarely, the ones you forget come back sooner.'
      ],
      list: [
        'Tap the card to see the answer, then grade it: Again, Hard, Knew it, Easy. Each button says when that word will come back.',
        'A question you get wrong twice becomes a card by itself — the question on the front, the answer on the back. Turn it off in Settings if you would rather it did not.',
        'The Mistakes page can add everything on it to the deck in one press.',
        'On a phone you can swipe: right for knew it, left for not. On a keyboard, 1–4 grade and U undoes.',
        'How many new words a day you meet is yours to set (10 by default).',
        'Import a list from Excel or Google Sheets, and download the whole deck to move it to another device.'
      ]
    },
    {
      icon: '📕',
      title: 'The book beside you',
      list: [
        '"Open the PDF" shows the book on the right — you never leave the site, and it follows you from unit to unit.',
        'Some books keep their questions in the paper: Essential Grammar and the three IELTS collections work as answer sheets — you read the question in the book and write the answer here. There the pane opens itself.',
        'Drag the line between panels to resize; double-click it to reset.'
      ]
    },
    {
      icon: '⭐',
      title: 'Mastery and review',
      list: [
        'Three correct answers in a row, on different days — ★ mastered.',
        'Mistakes collect on the Mistakes page and leave it after three correct answers.',
        'Everything else comes back on a schedule: 1 → 3 → 7 → 21 → 60 days.'
      ]
    },
    {
      icon: '⏱',
      title: 'IELTS under exam conditions',
      body: [
        'Sit a test section the way the real thing works: the clock runs, nothing is marked as you go, and at the end everything is marked at once — a score and an estimated band.'
      ],
      list: [
        'The "⏱ Exam conditions" button at the top of any IELTS unit. Listening is 40 minutes, Reading 60.',
        'The Writing paper is sat the same way: one hour over both tasks, with the per-task clock and Clear taken away. It is not scored — the result reports your hour, the two word counts and the four criteria to read your answer against.',
        'Speaking gets no exam mode: it is an interview, and the clocks on its own page (1 minute to prepare, 2 to speak) are the honest rehearsal.',
        'Walk away and the clock keeps running; come back to the page and you are on the same paper.',
        'At the end: a breakdown part by part, the answers, and every previous run. Statistics keeps latest and best.',
        'The band is an estimate — Cambridge prints no conversion table in these books.'
      ]
    },
    {
      icon: '🎧',
      title: 'IELTS: Writing, Speaking and dictation',
      list: [
        'The unit list reads L1 R1 W1 S1: the four skills of one test, side by side, each its own page.',
        'The task itself — the chart, the picture, the cue card — stays in the book. What the site adds is the exam timing, a word counter, a draft that saves itself, and for Speaking a cue-card clock and a recording.',
        '"Transcript / dictation" under a recording: read along, or fill in every third word as you hear it.',
        'The player has back-five-seconds and 0.75×. Both, and the transcript, are gone under exam conditions.'
      ]
    },
    {
      icon: '🇰🇿',
      title: 'Explanations in Kazakh',
      body: [
        'The book explains English in English. Where the two languages pull apart — articles, present perfect, phrasal verbs — a short Kazakh explanation sits above the exercises.'
      ],
      list: [
        'Open the first time you visit a unit, folded away afterwards; press the title to open it again.',
        'A wrong answer offers it too, next to the book’s own reference page.'
      ]
    },
    {
      icon: '👩‍🏫',
      title: 'Classes (for teachers)',
      list: [
        'The "Classes" card on the home page: open one and read the six-character code out to your students.',
        'They join from the same page by typing the code, and you get a table of how much each of them has done.',
        'You see counters only: answers, how many were right, when they were last here. Never what they typed.'
      ]
    },
    {
      icon: '🔒',
      title: 'Free and paid',
      list: [
        'Six books are free from end to end — no account needed, and they work offline.',
        'The rest open their first units as a SAMPLE: real exercises, not a lock screen. The remainder comes with a subscription, and the Unlock page carries the price and how to pay.',
        'The textbook PDF and the Listening audio are free in all thirteen books. What is paid is the marked exercises.'
      ]
    },
    {
      icon: '💾',
      title: 'Progress',
      list: [
        'Kept in this browser, separately per book; clearing browser data clears it.',
        'Sign in (Google, an email link or a password) and it is kept in the cloud instead — the same progress on your phone and your computer. Entirely optional.',
        'The Stats page can save your progress to a file and restore it later.',
        'It opens without a connection too: pages you have visited and the free books stay in the browser.'
      ]
    }
  ]
};
