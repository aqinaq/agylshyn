"""Text clean-up shared by the two new book builders.

Deliberately conservative: only defects that were enumerated in the actual
extracted output are repaired. Nothing is guessed at, in line with the
existing decision not to auto-repair OCR spacing without a dictionary.
"""
import re

# Ligature glyphs (ff, fi, fl, ft, ffi) render as one glyph, and the extractor
# emits a space after them. Every case below was enumerated from the output and
# checked by hand; look-alikes that are real English ("left with", "soft
# option", "hi-fi when") are intentionally absent.
LIGATURE = {
    'Aft er': 'After', 'aft er': 'after',
    'Oft en': 'Often', 'oft en': 'often',
    'diff erence': 'difference', 'diff erent': 'different',
    'diff icult': 'difficult', 'diff iculty': 'difficulty',
    'eff ective': 'effective', 'eff ort': 'effort',
    'off ence': 'offence', 'off ice': 'office',
}
_LIG_RE = re.compile(r'\b(' + '|'.join(map(re.escape, LIGATURE)) + r')\b')

# Printed answer gaps come through as long dot leaders. Shipped books have no
# leaders at all, so collapse them to a single ellipsis that still shows where
# the gap falls.
_LEADER_RE = re.compile(r'[.…]{4,}|(?:\s?\.){4,}')


def clean(s):
    if not s:
        return s
    s = _LIG_RE.sub(lambda m: LIGATURE[m.group(1)], s)
    # the leader usually swallows the space in front of it ("a ....... figure")
    s = _LEADER_RE.sub('…', s)
    s = re.sub(r'(?<=[^\s])…', ' …', s)
    s = s.replace('\t', ' ').replace(' ', ' ')
    s = re.sub(r'\s+', ' ', s).strip()
    s = re.sub(r'\s+([,.;:!?])', r'\1', s)
    return s


# A matching exercise whose answers are single tokens is sometimes printed as
# one run ("1 c 2 d 3 e"), which parses as a single very wide answer.
_RUN_RE = re.compile(r'^(\S{1,3})((?:\s+\d{1,2}\s+\S{1,3})+)$')


def expand_runs(sub):
    out, changed = [], False
    for it in sub.get('items', []):
        m = _RUN_RE.match(it.get('answer', ''))
        if not m:
            out.append(it)
            continue
        changed = True
        # The run carries the whole exercise's answers but only the first row's
        # question, and that question is still that row's: keep it, or a
        # matching exercise that parsed perfectly ends up with no prompts at all.
        first = dict(it)
        first['answer'] = m.group(1)
        out.append(first)
        for n, a in re.findall(r'(\d{1,2})\s+(\S{1,3})', m.group(2)):
            out.append({'n': int(n), 'answer': a})
    if changed:
        sub['items'] = sorted({i['n']: i for i in out}.values(),
                              key=lambda i: i['n'])
    return sub


def _is_grid(s):
    """A wordsearch grid extracts as a long run of loose single letters.

    The threshold is deliberately strict: a real answer like "a taxi / a bus"
    is 60% single characters, but they are articles and slashes rather than
    the unbroken run of bare letters a grid produces.
    """
    t = s.split()
    singles = [x for x in t if len(x) == 1]
    return (len(t) >= 8 and len(singles) / len(t) > 0.85
            and all(x.isalpha() for x in singles))


def demote_puzzles(sub):
    """A grid has no typeable answer, so keep it as reference text only."""
    items = sub.get('items', [])
    if items and any(_is_grid(i.get('answer', '')) for i in items):
        sub['rawAnswer'] = ' | '.join(f"{i['n']} {i['answer']}" for i in items)
        sub['items'] = []
        sub['type'] = 'freeform'
    return sub


def clean_unit(u):
    for s in u['subExercises']:
        expand_runs(s)
        demote_puzzles(s)
        for f in ('instructions', 'note', 'rawAnswer', 'rawQuestion'):
            if s.get(f):
                s[f] = clean(s[f])
        for it in s.get('items', []):
            for f in ('question', 'answer'):
                if it.get(f):
                    it[f] = clean(it[f])
    return u
