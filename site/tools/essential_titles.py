#!/usr/bin/env python3
"""Pull Essential Grammar unit titles out of the text-layer PDF.

The original data came from a scan with no text layer, so 43 of the 114 units
lost their titles. `Essential-Grammar-in-Use.pdf` is the same edition (299
pages, identical pagination) but carries text, so the headings can be read
directly off each unit's left-hand explanation page.

The text layer is still OCR, so anything that does not look like a real title
is rejected rather than guessed at — those units keep "Unit N".

Writes site/tools/essential_titles.json, consumed by build_data.py.
"""
import json
import os
import re
import sys

import fitz

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PDF = os.path.join(ROOT, 'site', 'pdf', 'essential-grammar.pdf')
OUT = os.path.join(ROOT, 'site', 'tools', 'essential_titles.json')

JUNK_ONLY = re.compile(r'^[\W\d_]*$')

# Units whose heading the scan mangles beyond rescue — checked by hand against
# the page. They keep "Unit N" rather than carry a wrong title.
REJECT = {49, 54, 69, 83, 110}


def bands(page):
    """Text spans in the top third of the page, grouped by font size."""
    out = {}
    height = page.rect.height
    for blk in page.get_text('dict').get('blocks', []):
        for line in blk.get('lines', []):
            for sp in line.get('spans', []):
                txt = sp['text'].strip()
                if not txt or sp['bbox'][1] > height * 0.34:
                    continue
                if re.fullmatch(r'UNIT', txt, re.I):
                    continue
                out.setdefault(round(sp['size'], 1), []).append(
                    (sp['bbox'][1], sp['bbox'][0], txt))
    return out


def tidy(txt, unit):
    txt = re.sub(r'\s+', ' ', txt).strip()
    txt = re.sub(r'^UNIT\s*', '', txt, flags=re.I)
    txt = re.sub(r'^\W*%d\b\W*' % unit, '', txt)      # the big unit number
    txt = re.sub(r'^[^\w(]+', '', txt)                # leading OCR specks
    txt = re.sub(r'\s*[|^~]+\s*$', '', txt)
    # strip leading stray tokens the scan invented ("T J", "j l", "0", "J jjiJ")
    for _ in range(3):
        m = re.match(r'^(\S{1,4})\s+(?=\S)', txt)
        if not m:
            break
        head = m.group(1)
        if re.fullmatch(r"[A-Za-z]{1,2}|\d+|[^\w]+|[a-z]{1,2}[A-Z]\w*", head) \
                and head.lower() not in ('a', 'i', 'an', 'be', 'do', 'go', 'no', 'so', 'to', 'up', 'we', 'it', 'is'):
            txt = txt[m.end():]
        else:
            break
    return txt.strip()


def looks_like_ocr_noise(txt):
    """OCR turns decorative art into letter soup. Reject that."""
    if len(txt) < 5 or len(txt) > 90:
        return True
    if JUNK_ONLY.match(txt):
        return True
    letters = sum(c.isalpha() for c in txt)
    if letters < len(txt) * 0.55:                     # mostly symbols/digits
        return True
    tokens = txt.split()
    if not tokens:
        return True
    # a pile of stray one-character tokens is the giveaway
    stray = sum(1 for w in tokens
                if len(w) == 1 and w.lower() not in ('a', 'i'))
    if stray >= 3 or stray > len(tokens) * 0.34:
        return True
    if re.search(r'[|]{1,}', txt):
        return True
    if re.search(r'\bUN\s+IT\b', txt):                 # split "UNIT" heading
        return True
    if txt.count('(') != txt.count(')'):                # truncated mid-bracket
        return True
    # headings are labels, not sentences lifted out of the body text
    if re.search(r'\b(We use|You can|This is|There (is|are))\b', txt, re.I):
        return True
    if len(txt.split()) > 12:
        return True
    # a full sentence lifted from the body, not a heading
    if (txt.endswith('.') and len(txt.split()) >= 4
            and '/' not in txt and '(' not in txt):
        return True
    return False


def heading(page, unit):
    groups = bands(page)
    for size in sorted(groups, reverse=True):
        spans = sorted(groups[size], key=lambda s: (round(s[0]), s[1]))
        txt = tidy(' '.join(s[2] for s in spans), unit)
        if txt and not looks_like_ocr_noise(txt):
            return txt
    return None


def main():
    if not os.path.exists(PDF):
        sys.exit('missing %s' % PDF)
    doc = fitz.open(PDF)
    data = json.load(open(os.path.join(ROOT, 'site', 'data', 'essential-grammar.json'),
                          encoding='utf-8'))

    titles, rejected = {}, []
    for u in data['units']:
        page = u.get('pdfExercisePage')
        if not page or page - 2 < 0:
            continue
        h = None if u['unit'] in REJECT else heading(doc[page - 2], u['unit'])
        if h:
            titles[str(u['unit'])] = h
        else:
            rejected.append(u['unit'])

    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(titles, f, ensure_ascii=False, indent=1, sort_keys=True)

    print('titles recovered: %d / %d' % (len(titles), len(data['units'])))
    print('left as "Unit N": %s' % (rejected or 'none'))


if __name__ == '__main__':
    main()
