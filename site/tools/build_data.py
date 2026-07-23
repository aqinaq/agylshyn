#!/usr/bin/env python3
"""Normalise all six books into the shared unit schema used by site/app.js.

Source folders keep their own historical shapes; everything is converted to:

  {unit, title, pdfExercisePage?, pdfPages?, pdfIntroPage?,
   subExercises: [{number, type, instructions?, note?, wordBank?, options?,
                   passage?, rawQuestion?, rawAnswer?, stub?,
                   items: [{n, question?, answer?, isExample?, exampleAnswers?}]}]}

type is one of: items | text | open | freeform | crossword

Run:  python3 site/tools/build_data.py
"""
import json
import os
import re

import parse_additional

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'site', 'data')


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding='utf-8') as f:
        return json.load(f)


def clean(d):
    """Drop null/empty keys so the shipped JSON stays small."""
    if isinstance(d, dict):
        out = {}
        for k, v in d.items():
            v = clean(v)
            if v is None or v is False or v == '' or v == [] or v == {}:
                continue
            out[k] = v
        return out
    if isinstance(d, list):
        return [clean(x) for x in d]
    return d


def norm_wordbank(wb):
    """Essential Grammar stores the pool as one whitespace-joined string;
    the others already use a list."""
    if wb is None:
        return None
    if isinstance(wb, str):
        return [w for w in wb.split() if w]
    return [str(w) for w in wb if str(w).strip()]


# Titles recovered from the text-layer PDF by tools/essential_titles.py.
try:
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           'essential_titles.json'), encoding='utf-8') as _f:
        RECOVERED_TITLES = json.load(_f)
except (IOError, ValueError):
    RECOVERED_TITLES = {}


def clean_title(title, unit):
    """The Essential Grammar answer key was OCR'd from a scan with no text
    layer, so many unit titles came out as exercise numbers or fragments.
    Prefer a heading read off the replacement PDF when the original is broken;
    otherwise fall back to "Unit N". Never invent a title."""
    t = (title or '').strip()
    junk = (
        not t                                     # empty
        or len(t) <= 5                            # "A", "1", "etc."
        or re.fullmatch(r'Unit\s*\d+', t, re.I)    # placeholder, not a real title
        or re.match(r'^\d', t)                    # "1 w is being repaired."
        or re.match(r'^[^\w\-("\u2018\u2019]', t)   # "^ 52.1 …", "\u25a0 1 Look at …"
        or re.search(r'\.{4,}', t)                # dot leaders from a gap-fill
        or 'XXXXX' in t
        or re.match(r'^(Look|Complete|Write|Use|Put|Answer|Make|Choose|Read)\b', t)
    )
    if not junk:
        return t
    return RECOVERED_TITLES.get(str(unit)) or 'Unit %d' % unit


# A handful of answers picked up the running page footer ("… 337 Key to
# Exercises …") when the key column was read off the scan (AUDIT §3.3). It can
# never be typed, so cut the answer off where the footer begins.
_FOOTER = re.compile(r'\s*\d+\s+Key to (?:Exercises|Additional).*$', re.I | re.S)


def clean_answer(a):
    if not a:
        return a
    a = _FOOTER.sub('', str(a)).strip()
    return a or None


def norm_items(raw):
    items = []
    for it in raw or []:
        blank = it.get('blank')
        # `blank` is the gap-only form of the answer ("’s tying" for
        # "He’s tying"). Kept so the app can accept either spelling.
        if blank and str(blank).strip() == str(it.get('answer') or '').strip():
            blank = None
        items.append({
            'n': it.get('n'),
            'question': it.get('question'),
            'answer': clean_answer(it.get('answer')),
            'blank': clean_answer(blank),
            'isExample': it.get('isExample') is True,
            'exampleAnswers': it.get('exampleAnswers') is True,
        })
    return items


# ---------------------------------------------------------------- vocab preint
def build_vocab_preint():
    """Already the target shape — pass through unchanged."""
    return read('vocab-preint', 'exercises.json')['units']


# ----------------------------------------------------------------- vocab upint
def build_vocab_upint():
    """Fourth-Edition Upper-Intermediate, extracted straight from its own PDF
    answer key (exercises-8). Schema is vocab-adv's `exercises` array, so it is
    converted the same way. The printed page numbers already equal true PDF
    pages (offset 0), and all 101 units are present — no unit-101 patch needed."""
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                               'vocab_upint_sections.json'), encoding='utf-8') as f:
            sections = json.load(f)
    except (IOError, ValueError):
        sections = {}
    units = []
    for u in read('vocab-upint', 'exercises.json')['units']:
        subs = []
        first_page = None
        for s in u.get('exercises', []) or []:
            items = norm_items(s.get('items'))
            if s.get('exampleAnswers') is True:
                for it in items:
                    if not it['isExample']:
                        it['exampleAnswers'] = True
            page = s.get('pdfExercisePage')
            if first_page is None and page is not None:
                first_page = page
            subs.append({
                'number': s.get('number'),
                'type': 'items',
                'instructions': s.get('instructions'),
                'wordBank': norm_wordbank(s.get('wordBank')),
                'items': items,
            })
        units.append({
            'unit': u.get('unit'),
            'title': u.get('title'),
            'section': sections.get(str(u.get('unit'))),
            'pdfExercisePage': first_page,
            'subExercises': subs,
        })
    return units


# ------------------------------------------------------------------- vocab adv
def build_vocab_adv():
    """exercises -> subExercises; type inferred from overToYou/freeformAnswer."""
    units = []
    for u in read('vocab-adv', 'exercises.json'):
        subs = []
        for s in u.get('exercises', []) or []:
            items = norm_items(s.get('items'))
            # sub-level exampleAnswers applies to every item in the block
            if s.get('exampleAnswers') is True:
                for it in items:
                    if not it['isExample']:
                        it['exampleAnswers'] = True

            if s.get('freeformAnswer'):
                stype = 'freeform'
            elif s.get('overToYou') is True:
                stype = 'open'
            else:
                stype = 'items'

            subs.append({
                'number': s.get('number'),
                'type': stype,
                'instructions': s.get('instructions'),
                'wordBank': norm_wordbank(s.get('wordBank')),
                'rawAnswer': s.get('freeformAnswer'),
                'note': s.get('qualityWarning'),
                'items': items,
            })
        units.append({
            'unit': u.get('unit'),
            'title': u.get('title'),
            'pdfExercisePage': u.get('pdfExercisePage'),
            'pdfIntroPage': u.get('pdfReferencePage'),
            'subExercises': subs,
        })
    return units


# ------------------------------------------------------------ advanced grammar
def build_advanced_grammar():
    """numbered -> items, clozePassage -> text; the 16 revision sets become
    extra units numbered 101+ so they stay reachable from the sidebar."""
    src = read('advancedinuse', 'exercises.json')
    units = []
    for u in src['units']:
        subs = []
        for s in u.get('subExercises', []) or []:
            stype = 'text' if s.get('type') == 'clozePassage' else 'items'
            subs.append({
                'number': s.get('number'),
                'type': stype,
                'instructions': s.get('instructions'),
                'passage': s.get('passageText'),
                'note': s.get('exampleAnswersNote'),
                'items': norm_items(s.get('items')),
            })
        units.append({
            'unit': u.get('unit'),
            'title': u.get('title'),
            'pdfExercisePage': u.get('pdfExercisePage'),
            'subExercises': subs,
        })

    # Page numbers for the revision section, located in the PDF by
    # tools/find_extra_pages (results checked in as JSON).
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                               'advanced_extra_pages.json'), encoding='utf-8') as f:
            extra_pages = json.load(f)
    except (IOError, ValueError):
        extra_pages = {}

    for a in src.get('additionalExercises', []) or []:
        n = a.get('exercise')
        page = extra_pages.get(str(n))
        instr, bank, items = parse_additional.build(
            a.get('instructionsAndItemsRaw'), a.get('answerKeyRaw'))

        covers = a.get('unitsCovered') or ''
        if len(items) >= 4:
            # split cleanly enough to answer question by question
            sub = {
                'number': 'A' + str(n),
                'type': 'items',
                'instructions': (covers + ' — ' + instr).strip(' —') if instr else covers,
                'wordBank': bank,
                'items': items,
                # the printed key stays reachable: several of these exercises
                # have prose answers that cannot be matched automatically
                'rawAnswer': a.get('answerKeyRaw'),
            }
        else:
            # layout too irregular to split — show it as it stands
            sub = {
                'number': 'A' + str(n),
                'type': 'freeform',
                'instructions': covers,
                'rawQuestion': a.get('instructionsAndItemsRaw'),
                'rawAnswer': a.get('answerKeyRaw'),
                'items': [],
            }

        units.append({
            'unit': 100 + int(n),
            # already true PDF pages, so shield them from the book-wide offset
            'pdfExercisePage': page,
            'pdfNoShift': True,
            # `additional` makes app.js prefix the title with a localised
            # "Additional N" — keep the label out of the data itself.
            'additional': int(n),
            'title': a.get('title') or '',
            'subExercises': [sub],
        })
    return units


# Unit titles + sections read off the PDF Contents pages (tools/grammar_titles.py).
# The source file took titles from arbitrary page text, so 36 came out wrong
# (AUDIT §3.2); the Contents is the book's own authoritative list.
try:
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           'grammar_titles.json'), encoding='utf-8') as _f:
        _GT = json.load(_f)
        GRAMMAR_TITLES = {int(k): v for k, v in _GT.get('titles', {}).items()}
        GRAMMAR_SECTIONS = {int(k): v for k, v in _GT.get('sections', {}).items()}
except (IOError, ValueError):
    GRAMMAR_TITLES, GRAMMAR_SECTIONS = {}, {}


# ------------------------------------------------------------- english grammar
def build_grammar():
    """exercises -> subExercises; options dict {a: ...} -> [{letter, text}]."""
    units = []
    for u in read('enginuse', 'exercises.json'):
        subs = []
        for s in u.get('exercises', []) or []:
            opts = None
            if isinstance(s.get('options'), dict):
                opts = [{'letter': k, 'text': v} for k, v in s['options'].items()]
            subs.append({
                'number': s.get('number'),
                'type': 'items',
                'instructions': s.get('instructions'),
                'options': opts,
                'items': norm_items(s.get('items')),
            })
        pages = u.get('pdfPages') or []
        n = u.get('unit')
        units.append({
            'unit': n,
            'title': GRAMMAR_TITLES.get(n) or u.get('title'),
            'section': GRAMMAR_SECTIONS.get(n),
            'pdfExercisePage': pages[0] if pages else None,
            'pdfPages': pages,
            'subExercises': subs,
        })
    return units


# ----------------------------------------------------------- essential grammar
def build_essential_grammar():
    """Answer-key only book: items carry no question text, the learner reads
    the prompt from the PDF page."""
    units = []
    for u in read('ayaulyayalama', 'essential_exercises.json'):
        subs = []
        for s in u.get('exercises', []) or []:
            items = norm_items(s.get('items'))
            if s.get('exampleAnswers') is True:
                for it in items:
                    if not it['isExample']:
                        it['exampleAnswers'] = True
            # Drop "ghost" rows the OCR left behind: no answer AND no question
            # text. They can never be answered, yet counted in the denominator,
            # so 100% was unreachable and stats read falsely low (AUDIT §3.1).
            items = [it for it in items if it.get('isExample')
                     or (it.get('answer') or '').strip()
                     or (it.get('question') or '').strip()]
            if not items:
                continue
            subs.append({
                'number': s.get('number'),
                'type': 'items',
                'instructions': s.get('instructions'),
                'wordBank': norm_wordbank(s.get('wordBank')),
                'items': items,
            })
        units.append({
            'unit': u.get('unit'),
            'title': clean_title(u.get('title'), u.get('unit')),
            'pdfExercisePage': u.get('pdfExercisePage'),
            'subExercises': subs,
        })
    return units


# The page numbers in the source files were recorded against different
# front-matter assumptions, so each book needs shifting onto true PDF pages.
# Measured by locating each unit's exercise numbers in the shipped PDF —
# see the table in README. Re-check these if a PDF is ever replaced.
PDF_PAGE_OFFSET = {
    'essential-grammar': 0,
    'grammar': 1,
    'advanced-grammar': 11,
    'vocab-preint': 0,
    'vocab-upint': 0,
    'vocab-adv': 2,
}


def fix_pages(bid, units):
    """Shift recorded pages onto real PDF pages, and make sure every unit knows
    its reference page — in all six books it is the left half of the spread."""
    off = PDF_PAGE_OFFSET.get(bid, 0)
    for u in units:
        if u.pop('pdfNoShift', False):
            continue
        ex = u.get('pdfExercisePage')
        if ex is not None:
            ex += off
            u['pdfExercisePage'] = ex
        if u.get('pdfPages'):
            u['pdfPages'] = [p + off for p in u['pdfPages']]

        intro = u.get('pdfIntroPage')
        if intro is not None:
            u['pdfIntroPage'] = intro + off
        elif ex is not None:
            u['pdfIntroPage'] = max(1, ex - 1)
    return units


BOOKS = [
    ('essential-grammar', build_essential_grammar),
    ('grammar', build_grammar),
    ('advanced-grammar', build_advanced_grammar),
    ('vocab-preint', build_vocab_preint),
    ('vocab-upint', build_vocab_upint),
    ('vocab-adv', build_vocab_adv),
]


def tracked(units):
    """Questions that count towards progress — must match isTracked() in app.js."""
    n = 0
    for u in units:
        for s in u.get('subExercises', []) or []:
            if s.get('type') not in ('items', 'text'):
                continue
            for it in s.get('items', []) or []:
                if not it.get('isExample'):
                    n += 1
    return n


def main():
    os.makedirs(OUT, exist_ok=True)
    index = []
    for bid, fn in BOOKS:
        units = clean(fix_pages(bid, fn()))
        path = os.path.join(OUT, bid + '.json')
        with open(path, 'w', encoding='utf-8') as f:
            json.dump({'id': bid, 'units': units}, f, ensure_ascii=False,
                      separators=(',', ':'))
        t = tracked(units)
        index.append({'id': bid, 'units': len(units), 'tracked': t})
        print('%-18s %3d units  %5d tracked  %6.0f KB'
              % (bid, len(units), t, os.path.getsize(path) / 1024))

    with open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
