#!/usr/bin/env python3
"""Map every unit to the PDF page where *its* answer key begins.

The printed answer key runs over many pages; a Unit 19 exercise must open the
Unit 19 answers, not Unit 1. For each book we scan its key pages and record the
first page on which each unit's answers appear — found from the "N.N" exercise
markers (which encode the unit) and "Unit N" / "UNIT N" headers.

Writes site/data/answer-key-pages.json  ->  { bookId: { unit: pdfPage } }
where pdfPage is the 1-indexed value the viewer takes as #page=.

Run:  python3 site/tools/build_answer_key_pages.py
"""
import fitz, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)

# (first, last) 0-indexed page of the printed key inside each PDF.
KEY_RANGE = {
    'essential-grammar': (262, 293),
    'grammar':           (347, 379),
    'advanced-grammar':  (262, 290),
    'vocab-preint':      (208, 246),
    'vocab-upint':       (210, 258),
    'vocab-adv':         (211, 276),
    'vocab-elem':        (128, 176),
    'collocations':      (129, 160),
    'academic':          (133, 176),
    'business':          (143, 178),
    'ielts-21':          (117, 140),
}

EXNUM = re.compile(r'\b(\d{1,3})\.\d{1,2}\b')          # 19.1 -> unit 19
UNITHDR = re.compile(r'\b(?:UNIT|Unit)\s+(\d{1,3})\b')  # "Unit 19"
# IELTS 21: "TEST 1 LISTENING", "TEST 1 READING" -> app units 1..8 in order
IELTS_HDR = re.compile(r'\bTEST\s+([1-4])\b.*?\b(LISTENING|READING)\b', re.I | re.S)


def units_on_page(text):
    us = set()
    for m in EXNUM.finditer(text):
        n = int(m.group(1))
        if 1 <= n <= 200:
            us.add(n)
    for m in UNITHDR.finditer(text):
        n = int(m.group(1))
        if 1 <= n <= 200:
            us.add(n)
    return us


def map_book(book):
    lo, hi = KEY_RANGE[book]
    d = fitz.open('%s/pdf/%s.pdf' % (SITE, book))
    out = {}

    if book == 'ielts-21':
        # app units: 1=T1 Listening, 2=T1 Reading, 3=T2 Listening ... 8=T4 Reading
        for i in range(lo, min(hi, len(d))):
            t = d[i].get_text()
            for m in IELTS_HDR.finditer(t):
                test = int(m.group(1)); skill = m.group(2).lower()
                unit = (test - 1) * 2 + (1 if skill == 'listening' else 2)
                out.setdefault(unit, i + 1)
        return out

    for i in range(lo, min(hi, len(d))):
        for u in units_on_page(d[i].get_text()):
            out.setdefault(u, i + 1)      # first page wins
    return out


def main():
    result = {}
    for book in KEY_RANGE:
        m = map_book(book)
        result[book] = {str(k): v for k, v in sorted(m.items())}
        print('%-18s %3d units mapped  (pages %d–%d)'
              % (book, len(m), min(m.values()) if m else 0, max(m.values()) if m else 0))
    path = os.path.join(SITE, 'data', 'answer-key-pages.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, separators=(',', ':'))
    print('wrote', path, '%.1f KB' % (os.path.getsize(path) / 1024))


if __name__ == '__main__':
    main()
