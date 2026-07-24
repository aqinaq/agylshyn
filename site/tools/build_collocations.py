#!/usr/bin/env python3
"""English Collocations in Use Intermediate -> site/data schema.

Source PDF (0-based indices):
  9..128    two pages per unit: even = presentation page, odd = "Exercises"
  129..160  answer key, units 1..60

The key does not read correctly in plain text order — the sub-exercise labels
sit in a left margin column (x~78, 12.5pt) and the answers in body columns
(x~116 and x~206) — so it is parsed positionally by tools/keyparse.py, which
Academic Vocabulary in Use shares.
"""
import os
import sys

import keyparse

HERE = os.path.dirname(os.path.abspath(__file__))
# the shipped copy of the book; BOOK_PDF overrides it
SRC = os.environ.get('BOOK_PDF', os.path.join(HERE, '..', 'pdf', 'collocations.pdf'))

BOOK = keyparse.Book(
    book_id='collocations',
    src=SRC,
    key_first=129, key_last=160,
    units=range(1, 61),
    ex_index=lambda u: 2 * u + 8,
    label_x=100,
    run_head=r'^(English Collocations in Use Intermediate|www\.|\d{1,3}$)',
)

if __name__ == '__main__':
    out = (sys.argv[1] if len(sys.argv) > 1
           else os.path.join(HERE, 'collocations_exercises.json'))
    keyparse.main(BOOK, out)
