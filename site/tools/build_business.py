#!/usr/bin/env python3
"""Business Vocabulary in Use Intermediate (3rd ed.) -> site/data schema.

Source PDF (0-based indices):
  12..142   two pages per unit: even = presentation page, odd = "Exercises"
  143..177  answer key, units 1..66

Unlike the other two books driven by tools/keyparse.py, this key is set as two
independent columns per page, each with its own label position, and it prints
the first answer inline with the label ("8.2 1 b").
"""
import os
import sys

import keyparse

HERE = os.path.dirname(os.path.abspath(__file__))
# the shipped copy of the book; BOOK_PDF overrides it
SRC = os.environ.get('BOOK_PDF', os.path.join(HERE, '..', 'pdf', 'business.pdf'))

BOOK = keyparse.Book(
    book_id='business',
    src=SRC,
    key_first=143, key_last=177,
    units=range(1, 67),
    ex_index=lambda u: 2 * u + 10,
    label_x=60,
    # labels are right-aligned, so a two-digit unit number shifts the x;
    # both variants occur in each of the two page columns
    label_xs=(34, 51, 289, 306),
    two_col=True,
    inline_first_item=True,
    run_head=r'^(Business Vocabulary in Use Intermediate|www\.|\d{1,3}$)',
)

if __name__ == '__main__':
    out = (sys.argv[1] if len(sys.argv) > 1
           else os.path.join(HERE, 'business_exercises.json'))
    keyparse.main(BOOK, out)
