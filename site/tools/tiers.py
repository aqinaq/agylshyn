#!/usr/bin/env python3
"""Reader for tools/tiers.json — which books are paid, and under which sku.

Three places need the same answer and must never disagree: index_json.py (so a
card can show a lock), split_content.py (so a paid file leaves the public
deploy) and api/main.py (the only one whose opinion is binding). They all come
through here.

Keys beginning with '_' are comments. tiers.json is meant to be read by a human
first, so it carries its own explanation inside it; skipping those keys is what
lets that documentation live next to the data instead of in a separate file.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
TIERS = os.path.join(HERE, 'tiers.json')

FREE = 'free'
WILDCARD = 'all'          # an sku that unlocks every book


def _strip_comments(d):
    return {k: v for k, v in (d or {}).items() if not k.startswith('_')}


def load(path=TIERS):
    """-> {'books': {book_id: sku}, 'features': {feature: sku}}.

    A missing or unreadable file means "everything is free". That is the same
    default as an empty api.config.js on the client, and it is what keeps a
    fresh checkout runnable without any of this machinery being set up.
    """
    try:
        with open(path, encoding='utf-8') as f:
            raw = json.load(f)
    except (IOError, ValueError):
        return {'books': {}, 'features': {}}
    return {
        'books': _strip_comments(raw.get('books')),
        'features': _strip_comments(raw.get('features')),
    }


def sku_of(book_id, tiers=None):
    """The sku a reader must hold to open `book_id`, or FREE."""
    t = tiers if tiers is not None else load()
    return t['books'].get(book_id, FREE)


def is_paid(book_id, tiers=None):
    return sku_of(book_id, tiers) != FREE


def paid_ids(tiers=None):
    t = tiers if tiers is not None else load()
    return sorted(t['books'])


if __name__ == '__main__':
    t = load()
    if not t['books']:
        print('every book is free (tiers.json missing or empty)')
    for book_id in paid_ids(t):
        print('%-20s %s' % (book_id, t['books'][book_id]))
    for feat in sorted(t['features']):
        print('%-20s %s  (client-side only)' % ('feature:' + feat, t['features'][feat]))
