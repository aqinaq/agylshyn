#!/usr/bin/env python3
"""Academic Vocabulary in Use (2nd ed.) -> site/data schema.

Source PDF (0-based indices):
  12..110   two pages per unit: even = presentation page, odd = "Exercises"
  133..159  answer key, units 1..50

Same margin-label key layout as English Collocations in Use, so the parsing
comes from tools/keyparse.py.

Unit 0 ("Before you start") is skipped: its key is nothing but "Personal
answers", so it would add a unit with no checkable question in it.
"""
import os
import sys

import keyparse

HERE = os.path.dirname(os.path.abspath(__file__))
# the shipped copy of the book; BOOK_PDF overrides it
SRC = os.environ.get('BOOK_PDF', os.path.join(HERE, '..', 'pdf', 'academic.pdf'))

BOOK = keyparse.Book(
    book_id='academic',
    src=SRC,
    key_first=133, key_last=159,
    units=range(1, 51),
    ex_index=lambda u: 2 * u + 10,
    label_x=90,
    run_head=r'^(Academic Vocabulary in Use|www\.|\d{1,3}$)',
    # this book leaves the answer blank as empty space, so questions arrive
    # split across a baseline and have to be stitched back together
    stitch=True,
)

if __name__ == '__main__':
    out = (sys.argv[1] if len(sys.argv) > 1
           else os.path.join(HERE, 'academic_exercises.json'))
    keyparse.main(BOOK, out)
