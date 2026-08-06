#!/usr/bin/env python3
"""Reads tiers.json — the list of books that need a subscription.

One tiny module rather than three copies of `json.load`, because three tools ask
the same question and a disagreement between them is the failure that matters:
a book the index calls free but split_content.py has moved out of site/data/ is
a card that opens onto a 404, and a book the index calls paid but which is still
sitting in site/data/ is a lock with the file next to it.

A missing or malformed tiers.json means "nothing is paid". That is the right
default for a fork: the app is a static site again and nothing breaks.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
TIERS = os.path.join(HERE, 'tiers.json')

# Where a paid book's JSON lives once split_content.py has moved it out of
# site/data/. Outside site/, so the Pages workflow (which uploads site/ whole)
# cannot publish it by accident, and gitignored, so the repository cannot
# either.
# Overridable so the deploy's own shape can be tested: the Pages runner checks
# out a repository with no content/ at all (it is gitignored on purpose), and a
# tool that quietly assumes the paid books are on disk fails there and nowhere
# else — which is exactly how the sample check blocked three deploys.
CONTENT = os.environ.get('AGYLSHYN_CONTENT') or os.path.join(ROOT, 'content')
DATA = os.path.join(ROOT, 'site', 'data')


def load():
    """The set of paid book ids."""
    try:
        with open(TIERS, encoding='utf-8') as f:
            cfg = json.load(f)
    except (IOError, ValueError):
        return set()
    return set(cfg.get('paid') or [])


def is_paid(book_id, paid=None):
    return book_id in (load() if paid is None else paid)


def source_of(book_id, paid=None):
    """Where this book's JSON is right now, free or paid, or None if unbuilt.

    Both directories are checked whichever way the book is classified: a build
    that has just run writes into site/data/, and split_content.py may not have
    moved it yet. Preferring the tier's own home keeps a stale leftover copy in
    the other directory from winning.
    """
    homes = [CONTENT, DATA] if is_paid(book_id, paid) else [DATA, CONTENT]
    for d in homes:
        p = os.path.join(d, book_id + '.json')
        if os.path.exists(p):
            return p
    return None
