# agylshyn

Cambridge-тің алты оқулығының жаттығулары — браузерде істейтін, серверсіз
жаттығу сайты. Сұрақтар PDF-тен шығарылып JSON-ға жиналған, жауап бірден
тексеріледі, прогресс `localStorage`-та сақталады.

## Кітаптар

| Кітап | Деңгей | Сұрақ |
|---|---|---|
| Essential Grammar in Use | Elementary | 2 408 |
| English Grammar in Use | Intermediate | 4 214 |
| Advanced Grammar in Use | Advanced | 2 465 |
| Vocabulary in Use — Pre-Intermediate | Pre-Int | 2 389 |
| Vocabulary in Use — Upper-Intermediate | Upper-Int | 2 271 |
| Vocabulary in Use — Advanced | Advanced | 2 327 |

Барлығы 16 074 сұрақ.

## Қалталар

```
site/              біріктірілген сайт — негізгі нұсқа осы (site/README.md)
AUDIT.md           мазмұн дұрыстығы мен функционалдық аудиті

ayaulyayalama/     Essential Grammar in Use    ┐
enginuse/          English Grammar in Use      │ бастапқы жеке қосымшалар.
advancedinuse/     Advanced Grammar in Use     │ site/ солардың деректерінен
vocab-preint/      Vocabulary Pre-Intermediate │ жиналады, өздері өзгертілмейді
vocab-upint/       Vocabulary Upper-Int        │
vocab-adv/         Vocabulary Advanced         ┘
```

## Іске қосу

`fetch()` қолданылатындықтан файлды қос шертіп ашуға болмайды — сервер керек:

```
cd site && python3 -m http.server 8777
# http://localhost:8777
```

Деректерді бастапқы қалталардан қайта жинау:

```
python3 site/tools/build_data.py
```

## Мүмкіндіктері

- Жауапты бірден тексеру, қателер беті, streak / mastered статистикасы
- Сөздік: сөзді меңзе (немесе қос шерт, ұзақ бас) — қазақша аудармасы шығады.
  1 385 сөздік ядро офлайн істейді, қалғаны API арқылы табылып кэштеледі
- Оқулық PDF-і сол беттің ішінде, керекті бетінен ашылады
- Интерфейс екі тілде: қазақша / ағылшынша
- Тақырыбы екеу: ашық / қараңғы

Толық құжаттама — [site/README.md](site/README.md).

## Мазмұн сапасы

[AUDIT.md](AUDIT.md) — әр жауап оқулықтың өз «Key to Exercises» бөлімімен
салыстырылған. Қысқаша: grammar, vocab-preint, vocab-adv (8 930 сұрақ) —
99.5 %+ дәлдік; advanced-grammar — 93.8 %; essential-grammar — 81.5 %
(PDF-і сканерленген, мәтін қабаты жоқ); **vocab-upint — бөтен кітаптың
көшірмесі, қайта жиналуы керек**.
