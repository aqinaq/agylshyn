#!/usr/bin/env python3
"""Cuts a free sample out of every paid book.

    python3 site/tools/build_samples.py            # rebuild them all
    python3 site/tools/build_samples.py --check    # report only, exit 1 if stale

A lock with nothing behind it asks somebody to pay for a thing they have never
used.  The books have always had one honest answer to that — the PDF opens even
when the exercises do not — but reading a page is not the same as working one,
and what is being sold here is the working, not the text.

So each paid book gives away its first unit or two: the same JSON the app
already knows how to render, trimmed, written to site/data/sample/<id>.json and
published like any other static file.  That directory is deliberately inside
site/: this is content meant to be free, unlike content/, which is the paid
copy and never leaves the machine it was built on.

How much is given away is a business decision, not a technical one, so it lives
in tiers.json under `sample` rather than here.  An IELTS "unit" is a whole
forty-question test section, which is why it is worth less of one than a
two-page grammar unit.

Run it after any rebuild of a paid book; --check is what the deploy runs.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tiers as tiers_mod

SAMPLE_DIR = os.path.join(tiers_mod.DATA, 'sample')
DEFAULT_UNITS = 2


def config():
    """The `sample` block of tiers.json: {'default': n, '<book>': n}."""
    try:
        with open(tiers_mod.TIERS, encoding='utf-8') as f:
            cfg = json.load(f)
    except (IOError, ValueError):
        return {}
    block = cfg.get('sample')
    return block if isinstance(block, dict) else {}


def units_for(book_id, cfg):
    n = cfg.get(book_id, cfg.get('default', DEFAULT_UNITS))
    try:
        return max(0, int(n))
    except (TypeError, ValueError):
        return DEFAULT_UNITS


def sample_of(book, take):
    """The first `take` units, plus what the app needs to say so.

    `unitsOf` is the whole book's unit count: the banner says "2 of 145", and a
    sample that could not say what it is a sample of would read as a broken
    book.  Writing and Speaking prompts are left out — they belong to tests
    that are not in the sample.
    """
    units = list(book.get('units') or [])[:take]
    return {'id': book['id'], 'sample': True, 'unitsOf': len(book.get('units') or []),
            'units': units}


def build(check=False):
    paid = sorted(tiers_mod.load())
    cfg = config()
    if not check and not os.path.isdir(SAMPLE_DIR):
        os.makedirs(SAMPLE_DIR)

    stale, written = [], []
    keep = set()
    for book_id in paid:
        take = units_for(book_id, cfg)
        out = os.path.join(SAMPLE_DIR, book_id + '.json')
        if not take:
            # Explicitly no sample for this book: make sure an old one is gone.
            if os.path.exists(out):
                stale.append(book_id + ' (should have no sample)')
                if not check:
                    os.remove(out)
            continue
        keep.add(book_id + '.json')
        source = tiers_mod.source_of(book_id, paid)
        if not source:
            stale.append(book_id + ' (never built)')
            continue
        with open(source, encoding='utf-8') as f:
            book = json.load(f)
        data = sample_of(book, take)
        text = json.dumps(data, ensure_ascii=False, indent=1)
        old = None
        if os.path.exists(out):
            with open(out, encoding='utf-8') as f:
                old = f.read()
        if old == text:
            continue
        stale.append(book_id)
        if check:
            continue
        with open(out, 'w', encoding='utf-8') as f:
            f.write(text)
        written.append((book_id, take, len(data['units']), len(text)))

    # A book that stopped being paid leaves its sample behind, and a stale
    # sample is a free copy of a book nobody meant to give away.
    if os.path.isdir(SAMPLE_DIR):
        for name in sorted(os.listdir(SAMPLE_DIR)):
            if name.endswith('.json') and name not in keep:
                stale.append(name[:-5] + ' (no longer paid)')
                if not check:
                    os.remove(os.path.join(SAMPLE_DIR, name))

    if check:
        if stale:
            print('samples are out of date: ' + ', '.join(stale))
            print('run: python3 site/tools/build_samples.py')
            return 1
        print('samples up to date (%d books)' % len(keep))
        return 0

    for book_id, take, got, size in written:
        print('%-18s %d unit(s), %5.1f KB' % (book_id, got, size / 1024.0))
    if not written:
        print('samples already up to date')
    return 0


if __name__ == '__main__':
    sys.exit(build('--check' in sys.argv))
