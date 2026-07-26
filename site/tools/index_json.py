#!/usr/bin/env python3
"""data/index.json — the one file every builder has to agree on.

app.js reads it to know how many units and questions each book holds without
downloading the book itself: it powers the home-page totals and the "0/2455"
line on a card the reader has never opened.

It used to be written by whichever builder ran last. build_data.py owned ten
books and rewrote the file wholesale, so a later run of it silently dropped the
IELTS rows that build_ielts.py had merged in — the home page then under-counted
by exactly those books.

So the write lives here, once, with merge semantics: a builder hands over only
its own rows and the rest of the file survives. Ordering comes from books.js,
which means the file stays diff-stable no matter which builder ran.
"""
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(ROOT, 'site', 'data')
BOOKS_JS = os.path.join(ROOT, 'site', 'books.js')
INDEX = os.path.join(DATA, 'index.json')


def tracked(units):
    """Questions that count towards progress — must match isTracked() in app.js.

    Only `items` and `text` exercises are counted, and worked examples never
    are: those two rules are what make "done / total" on a card mean the same
    thing as the progress bar inside the book.
    """
    n = 0
    for u in units:
        for s in u.get('subExercises', []) or []:
            if s.get('type') not in ('items', 'text'):
                continue
            for it in s.get('items', []) or []:
                if not it.get('isExample'):
                    n += 1
    return n


def entry(book_id, units):
    return {'id': book_id, 'units': len(units), 'tracked': tracked(units)}


def catalogue_order():
    """Book ids in the order books.js lists them, so index.json follows the
    library page. An id missing from the catalogue still gets written — it is
    just sorted to the end rather than dropped."""
    try:
        with open(BOOKS_JS, encoding='utf-8') as f:
            return re.findall(r"^\s*id:\s*'([a-z0-9-]+)'", f.read(), re.M)
    except IOError:
        return []


def update(entries):
    """Merge `entries` into data/index.json, leaving every other book alone."""
    try:
        with open(INDEX, encoding='utf-8') as f:
            rows = json.load(f)
    except (IOError, ValueError):
        rows = []

    ours = {e['id'] for e in entries}
    rows = [r for r in rows if r.get('id') not in ours] + list(entries)

    order = catalogue_order()
    rows.sort(key=lambda r: (order.index(r['id']) if r['id'] in order else len(order),
                             r['id']))

    os.makedirs(DATA, exist_ok=True)
    with open(INDEX, 'w', encoding='utf-8') as f:
        json.dump(rows, f, ensure_ascii=False, indent=1)
    return rows


def rebuild():
    """Recompute every row from the JSON already sitting in data/.

    The repair path: run it after any builder (or on a fresh checkout) and the
    index matches what is actually shipped, whichever books were rebuilt last.
    """
    entries = []
    for book_id in catalogue_order():
        path = os.path.join(DATA, book_id + '.json')
        try:
            with open(path, encoding='utf-8') as f:
                data = json.load(f)
        except (IOError, ValueError):
            continue                      # book not built yet — leave it out
        entries.append(entry(book_id, data.get('units', [])))
    return update(entries)


if __name__ == '__main__':
    for row in rebuild():
        print('%-20s %3d units  %5d tracked' % (row['id'], row['units'], row['tracked']))
