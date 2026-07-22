/* How-to-use guide, shown in a dialog. Rendered by renderHelpInto() in app.js.
   Keep it short — it is a reminder, not a manual.
   Section shape: {icon, title, body:[…], list:[…], rows:[[label, text], …]} */
window.HELP = {

  kk: [
    {
      icon: '✍️',
      title: 'Жауап беру',
      list: [
        'Бас әріп, тыныс белгі, тырнақша ескерілмейді. «don’t» да, «do not» да дұрыс.',
        'Жазғаның өзі сақталады.'
      ],
      rows: [
        ['Enter', 'Тексеру + келесі сұрақ'],
        ['Tab', 'Келесі өріс (тексерусіз)']
      ]
    },
    {
      icon: '📕',
      title: 'Кітапты қатар ашу',
      list: [
        '«PDF-ті ашу» — кітап оң жақтан ашылады, сайттан шықпайсың.',
        'Панельдер арасындағы сызықты сүйресең, ені өзгереді. Қос шертсең — бастапқы қалпына оралады.',
        'Юниттен юнитке өткенде PDF өзі керек бетке көшеді.'
      ]
    },
    {
      icon: '📖',
      title: 'Сөздің аудармасы',
      body: [
        'Жаттығудағы кез келген ағылшын сөзінің қазақша аудармасы мен қарапайым ағылшынша түсініктемесін бірден көруге болады.'
      ],
      list: [
        'Тінтуірді сөздің үстіне апарып, сәл ұстап тұр — өзі шығады.',
        'Немесе қос шерт, не сөзді белгіле. Телефонда — саусақпен басып тұр.',
        'Жиі кездесетін сөздер сайттың өзінде тұр, интернетсіз де шығады. Сирек сөздер интернеттен бір рет алынып, есте сақталады.',
        'Меңзегенде шығуы мазаласа — терезенің төменгі жағындағы «Меңзегенде шықсын» дегенді өшір.'
      ]
    },
    {
      icon: '🔍',
      title: 'Өзің тексеретін сұрақтар',
      body: [
        'Бір ғана дұрыс жауабы жоқ сұрақтар «өзің тексер» белгісімен тұрады.'
      ],
      list: [
        'Жазып болып, ✓ немесе ✗ дегенді өзің басасың.',
        '«Мен дұрыс жаздым» — қате белгіні кері қайтарады.'
      ]
    },
    {
      icon: '⭐',
      title: 'Меңгеру мен қателер',
      list: [
        'Қатарынан 3 рет дұрыс — ★ меңгерілді.',
        'Қате сұрақтар «Қателер» бетіне жиналады да, 3 рет дұрыс жауап берген соң шығады.'
      ]
    },
    {
      icon: '💾',
      title: 'Прогресс',
      list: [
        'Осы браузерде сақталады, әр кітап бөлек.',
        'Браузер деректерін тазаласаң — өшеді.'
      ]
    }
  ],

  en: [
    {
      icon: '✍️',
      title: 'Answering',
      list: [
        'Capitals, punctuation and quote marks are ignored. Both "don’t" and "do not" count.',
        'What you type saves itself.'
      ],
      rows: [
        ['Enter', 'Check + next question'],
        ['Tab', 'Next box, no check']
      ]
    },
    {
      icon: '📕',
      title: 'The book beside you',
      list: [
        '"Open the PDF" shows the book on the right — you never leave the site.',
        'Drag the line between panels to resize. Double-click it to reset.',
        'Moving to another unit turns the PDF to the right page.'
      ]
    },
    {
      icon: '📖',
      title: 'What does this word mean?',
      body: [
        'Any English word in an exercise can show you a Kazakh translation and a plain-English explanation.'
      ],
      list: [
        'Rest the mouse on the word for a moment — the card appears.',
        'Or double-click it, or select it. On a phone, press and hold.',
        'Common words are built into the site and work offline; rarer ones are fetched once and remembered.',
        'If the hover card gets in the way, switch off "Show on hover" at the bottom of it.'
      ]
    },
    {
      icon: '🔍',
      title: 'Self-check questions',
      body: [
        'Questions with no single right answer carry a "self-check" tag.'
      ],
      list: [
        'Type your answer, then mark it ✓ or ✗ yourself.',
        '"I was right" undoes a wrong mark.'
      ]
    },
    {
      icon: '⭐',
      title: 'Mastery and mistakes',
      list: [
        'Three correct in a row — ★ mastered.',
        'Wrong answers collect on the "Mistakes" page and leave it after three correct answers.'
      ]
    },
    {
      icon: '💾',
      title: 'Progress',
      list: [
        'Saved in this browser, separately per book.',
        'Clearing your browser data clears it too.'
      ]
    }
  ]
};
