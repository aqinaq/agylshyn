#!/usr/bin/env python3
"""English Vocabulary in Use Elementary -> site/data schema.

Layout of the source PDF (0-based page indices):
  6..127   two pages per unit: even = presentation page, odd = "Exercises"
  128..157 "Answer key", units 1..60
The key is authoritative for answers (it is a clean numbered list); the
exercise pages only contribute instructions and question text.
"""
import json
import re
import os
import sys

import fitz

from textnorm import clean_unit

HERE = os.path.dirname(os.path.abspath(__file__))
# the shipped copy of the book; BOOK_PDF overrides it
SRC = os.environ.get('BOOK_PDF',
                     os.path.join(HERE, '..', 'pdf', 'vocab-elem.pdf'))
KEY_FIRST, KEY_LAST = 128, 157
N_UNITS = 60
# unit N presentation page index; exercises on the next page
INTRO_IDX = lambda u: 2 * u + 6

SUB_RE = re.compile(r'^(\d{1,2}\.\d{1,2})$')
SUB_HEAD = re.compile(r'^(\d{1,2}\.\d{1,2})(?:\s+(\D.*))?$')
INLINE_GAP = re.compile(r'\b\d{1,2}\s*…')
UNIT_RE = re.compile(r'^Unit (\d{1,2})$')
ITEM_RE = re.compile(r'^(\d{1,2})\s+(.*\S)$')
OPEN_RE = re.compile(r'^(Possible|Suggested|Sample|Model)\s+(answers?|sentences?|'
                     r'family tree|meanings?)|^Your own answers?', re.I)
SKIP_RE = re.compile(r'^(Answer key|English Vocabulary in Use Elementary|\d{1,3})$')


def key_lines(doc):
    for i in range(KEY_FIRST, KEY_LAST + 1):
        for ln in doc[i].get_text().split('\n'):
            ln = ln.strip()
            if ln and not SKIP_RE.match(ln):
                yield ln


def parse_key(doc):
    """-> {unit: {sub: {'items': {n: ans}, 'open': bool, 'raw': [lines]}}}"""
    key, unit, sub, last_n = {}, None, None, None
    ended = False   # "Over to you" closes the unit; what follows belongs to no sub
    for ln in key_lines(doc):
        m = UNIT_RE.match(ln)
        if m:
            unit, sub, last_n = int(m.group(1)), None, None
            key.setdefault(unit, {})
            ended = False
            continue
        m = SUB_RE.match(ln)
        if m:
            sub = m.group(1)
            ended = False
            # the key prints sub numbers in unit order; trust the sub's own
            # prefix over the running "Unit N" heading (headings are omitted
            # whenever a unit's key starts mid-page)
            unit = int(sub.split('.')[0])
            key.setdefault(unit, {}).setdefault(
                sub, {'items': {}, 'open': False, 'raw': []})
            last_n = None
            continue
        if sub is None or unit is None or ended:
            continue
        if ln.lower().startswith('over to you'):
            ended = True
            continue
        cur = key[unit][sub]
        cur['raw'].append(ln)
        if OPEN_RE.match(ln):
            cur['open'] = True
            continue
        m = ITEM_RE.match(ln)
        if m:
            n = int(m.group(1))
            # a wrapped continuation never restarts numbering below the last n
            if last_n is not None and n <= last_n and n != 1 and len(m.group(2)) > 60:
                cur['items'][last_n] += ' ' + ln
                continue
            cur['items'][n] = m.group(2)
            last_n = n
        elif last_n is not None and last_n in cur['items']:
            cur['items'][last_n] += ' ' + ln
    return key


# ---------------------------------------------------------------- questions
def span_text(span):
    """Rebuild a span's text, restoring spaces from character gaps.

    The bold instruction font in this PDF carries no space glyphs at all
    ("Lookatthefamilytree"), but word gaps are a clean ~0.12 em while
    intra-word gaps are 0 or negative, so the split is unambiguous.
    """
    chars = span.get('chars') or []
    if not chars:
        return span.get('text', '')
    thresh = max(0.5, 0.06 * span['size'])
    out, prev = [], None
    for c in chars:
        if prev is not None and c['c'] != ' ' and prev != ' ':
            if c['bbox'][0] - prev_x1 > thresh:
                out.append(' ')
        out.append(c['c'])
        prev, prev_x1 = c['c'], c['bbox'][2]
    return ''.join(out)


GAP_PT = 25          # blank-to-fill; ordinary word spacing here is under 2pt
ITEM_START = re.compile(r'^\d{1,2}(\s|$)')


def page_lines(page):
    """Visual lines, ordered top-to-bottom then left-to-right.

    A gap-fill sentence is stored as several fragments on the same baseline
    with the answer blank as empty space between them ("1 Tim's jeans" /
    "blue and his T-shirt" / "red."). Taking a fragment as a whole question
    truncates it, so fragments sharing a baseline are stitched back together
    and each blank becomes "…". A fragment that opens with its own item number
    starts a new line instead, which keeps two-column item lists apart.
    """
    frags = []
    for b in page.get_text('rawdict')['blocks']:
        for l in b.get('lines', []):
            spans = l.get('spans') or []
            if not spans:
                continue
            txt = re.sub(r'\s+', ' ', ' '.join(span_text(s) for s in spans)).strip()
            if txt:
                frags.append({'text': txt, 'x': l['bbox'][0], 'x1': l['bbox'][2],
                              'y': l['bbox'][1],
                              'size': max(s['size'] for s in spans)})

    frags.sort(key=lambda f: (round(f['y'] / 6), f['x']))
    out, cur, prev_x1 = [], None, None
    for f in frags:
        same_line = (cur is not None and abs(f['y'] - cur['y']) <= 3
                     and not ITEM_START.match(f['text']))
        if same_line:
            cur['text'] += (' … ' if f['x'] - prev_x1 > GAP_PT else ' ') + f['text']
            cur['size'] = max(cur['size'], f['size'])
        else:
            if cur:
                out.append(cur)
            cur = dict(f)
        prev_x1 = f['x1']
    if cur:
        out.append(cur)
    for l in out:
        l['text'] = re.sub(r'\s+', ' ', l['text']).strip()
    return out


def parse_exercises(page):
    """-> {sub: {'instructions': str, 'lines': [str]}} in printed order."""
    subs, cur = {}, None
    for l in page_lines(page):
        t = l['text']
        # The label sits in the margin, so stitching a baseline back together
        # often carries the instruction with it ("1.3 Ask a friend these …").
        # Sometimes it stays on its own line; accept both.
        m = SUB_HEAD.match(t)
        if m:
            cur = m.group(1)
            subs[cur] = {'instructions': (m.group(2) or '').strip(), 'lines': []}
            continue
        if cur is None:
            continue
        if not subs[cur]['instructions'] and len(t) > 12 and not ITEM_RE.match(t):
            subs[cur]['instructions'] = t
        else:
            subs[cur]['lines'].append(t)
    return subs


def unit_title(page):
    """The big heading on the presentation page, right of the unit number."""
    # the unit number is set larger than the title, so exclude bare digits;
    # the section headings ("A", "Family words") sit lower and smaller
    cand = [l for l in page_lines(page) if l['y'] < 70 and l['size'] > 20
            and not l['text'].isdigit()]
    cand.sort(key=lambda l: (-l['size'], l['y'], l['x']))
    return cand[0]['text'] if cand else None


def build():
    doc = fitz.open(SRC)
    key = parse_key(doc)
    units, stats = [], {'items': 0, 'with_q': 0, 'open': 0, 'subs': 0}

    for u in range(1, N_UNITS + 1):
        intro = INTRO_IDX(u)
        ex_page = intro + 1
        qsubs = parse_exercises(doc[ex_page])
        subs_out = []
        for sub in sorted(key.get(u, {}), key=lambda s: int(s.split('.')[1])):
            k = key[u][sub]
            q = qsubs.get(sub, {})
            qlines = {}
            for ln in q.get('lines', []):
                m = ITEM_RE.match(ln)
                if m and len(m.group(2)) > 3:
                    # A "complete the text" exercise is one flowing passage
                    # with its gap numbers printed inline, so the first
                    # fragment swallows the later gaps. Showing it as that
                    # item's question is worse than showing nothing — the
                    # reader is sent to the PDF instead.
                    if INLINE_GAP.search(m.group(2)):
                        continue
                    qlines.setdefault(int(m.group(1)), m.group(2))

            items = []
            for n in sorted(k['items']):
                it = {'n': n, 'answer': k['items'][n]}
                if n in qlines:
                    it['question'] = qlines[n]
                    stats['with_q'] += 1
                items.append(it)
            stats['items'] += len(items)
            stats['subs'] += 1

            out = {'number': sub,
                   'type': 'open' if (k['open'] and not items) else
                           ('items' if items else 'freeform'),
                   'instructions': q.get('instructions', ''),
                   'items': items}
            if k['open']:
                out['note'] = 'Possible answers — not auto-checked.'
                stats['open'] += 1
            if not items:
                out['rawAnswer'] = ' '.join(k['raw'])[:1200]
            subs_out.append({kk: vv for kk, vv in out.items() if vv})

        units.append({'unit': u,
                      'title': unit_title(doc[intro]) or f'Unit {u}',
                      'pdfIntroPage': intro + 1,
                      'pdfExercisePage': ex_page + 1,
                      'pdfPages': [ex_page + 1],
                      'subExercises': subs_out})
    return {'id': 'vocab-elem', 'units': [clean_unit(u) for u in units]}, stats


if __name__ == '__main__':
    data, st = build()
    out = (sys.argv[1] if len(sys.argv) > 1
           else os.path.join(HERE, 'vocab_elem_exercises.json'))
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(f"units={len(data['units'])} subs={st['subs']} items={st['items']} "
          f"with_question={st['with_q']} open_subs={st['open']}")
