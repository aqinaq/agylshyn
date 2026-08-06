/* How-to-use guide, shown in a dialog. Rendered by renderHelpInto() in app.js.
   Keep it short — it is a reminder, not a manual: one screen, one idea per
   line. Anything that needs a paragraph belongs in site/README.md instead.
   Section shape: {icon, title, body:[…], list:[…], rows:[[label, text], …]} */
window.HELP = {

  kk: [
    {
      icon: '✍️',
      title: 'Жауап беру',
      list: [
        'Бас әріп, тыныс белгі, тырнақша ескерілмейді: «don’t» да, «do not» да дұрыс.',
        'Бір ғана дұрыс жауабы жоқ сұрақтар «өзің тексер» белгісімен тұрады — ✓ / ✗ дегенді өзің басасың.',
        '«Мен дұрыс жаздым» — қате қойылған белгіні кері қайтарады.'
      ],
      rows: [
        ['Enter', 'Тексеру + келесі сұрақ'],
        ['Tab', 'Келесі өріс (тексерусіз)'],
        ['Ctrl/⌘ + K', 'Іздеу']
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
        'Жартылай қалдырып кетсең, уақыты жүріп тұрады да, бетке қайта кірсең сол жерінен жалғайсың.',
        'Соңында: бөлім-бөлім талдау, қате жауаптар және бұрынғы жүгірулердің тізімі. Статистика бетінде «соңғысы / ең жақсысы» болып тұрады.',
        'Band — шамамен есеп: Cambridge бұл кітаптарда ресми кесте бермейді.'
      ]
    },
    {
      icon: '🎧',
      title: 'IELTS: Writing, Speaking және диктант',
      list: [
        'Юниттің басындағы «✍ Writing / Speaking» — тапсырманың өзі, емтихандағы уақыт, сөз санағышы, өзі сақталатын жоба; Speaking-те таймер мен дауыс жазу.',
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
        'Аккаунттағы «Сыныптар» → сынып ашасың, 6 таңбалы кодты оқушыларға бересің.',
        'Олар сол кодты жазып қосылады, сен кестеден кім қанша істегенін көресің.',
        'Мұғалім тек санақты көреді: қанша жауап, қаншасы дұрыс, соңғы рет қашан кірген. Жазған жауаптарын ешкім көрмейді.'
      ]
    },
    {
      icon: '💾',
      title: 'Прогресс',
      list: [
        'Осы браузерде сақталады, әр кітап бөлек; браузер деректерін тазаласаң — өшеді.',
        'Статистика бетінде прогресті файлға сақтап, кейін қалпына келтіруге болады.'
      ]
    }
  ],

  en: [
    {
      icon: '✍️',
      title: 'Answering',
      list: [
        'Capitals, punctuation and quote marks are ignored: both "don’t" and "do not" count.',
        'Questions with no single right answer are marked "check it yourself" — you press ✓ or ✗.',
        '"I was right" takes back a wrong mark.'
      ],
      rows: [
        ['Enter', 'Check + next question'],
        ['Tab', 'Next box, no check'],
        ['Ctrl/⌘ + K', 'Search']
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
        'Walk away and the clock keeps running; come back to the page and you are on the same paper.',
        'At the end: a breakdown part by part, the answers, and every previous run. Statistics keeps latest and best.',
        'The band is an estimate — Cambridge prints no conversion table in these books.'
      ]
    },
    {
      icon: '🎧',
      title: 'IELTS: Writing, Speaking and dictation',
      list: [
        '"✍ Writing / Speaking" on a unit: the task itself, the exam timing, a word counter, a draft that saves itself, and for Speaking a cue-card clock and a recording.',
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
        'Account panel → Classes: open one and read the six-character code out to your students.',
        'They type the code to join, and you get a table of how much each of them has done.',
        'You see counters only: answers, how many were right, when they were last here. Never what they typed.'
      ]
    },
    {
      icon: '💾',
      title: 'Progress',
      list: [
        'Kept in this browser, separately per book; clearing browser data clears it.',
        'The Stats page can save your progress to a file and restore it later.'
      ]
    }
  ]
};
