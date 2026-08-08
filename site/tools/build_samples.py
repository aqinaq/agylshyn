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


def shows_its_work(unit):
    """Can this unit be worked on the site, or only read out of the PDF?

    Not every unit's questions came off the page.  Business unit 1 is nineteen
    rows and eighteen of them say "look this one up in the book" — which, as
    the first thing a reader sees of a book they are being asked to pay for,
    advertises the opposite of what is being sold.  A unit earns its place in
    the sample by holding the questions it asks.
    """
    rows = [it for s in unit.get('subExercises') or []
            for it in s.get('items') or [] if not it.get('isExample')]
    if not rows:
        return False
    printed = sum(1 for it in rows if (it.get('question') or '').strip())
    return printed * 2 >= len(rows)


def sample_units(book, take):
    """The first `take` units worth giving away.

    Order is kept, so the sample is still the front of the book wherever the
    front of the book is usable.  A book whose every unit is an answer sheet —
    the IELTS collections, by design — has nothing to choose between, and falls
    back to its first units rather than giving away nothing at all.
    """
    units = list(book.get('units') or [])
    workable = [u for u in units if shows_its_work(u)]
    return (workable or units)[:take]


def sample_of(book, take):
    """The sample units, plus what the app needs to say so.

    `unitsOf` is the whole book's unit count: the banner says "2 of 145", and a
    sample that could not say what it is a sample of would read as a broken
    book.  Writing and Speaking prompts are left out — they belong to tests
    that are not in the sample.
    """
    units = sample_units(book, take)
    return {'id': book['id'], 'sample': True, 'unitsOf': len(book.get('units') or []),
            'units': units}


def sample_problem(path, take):
    """What is wrong with a sample file judged on its own, or None.

    Used where the paid book itself is not available to rebuild from: the file
    still has to exist, say that it is a sample, hold the agreed number of
    units, and know how many the whole book has — a sample that claims to be
    the whole book is the one mistake that would matter."""
    if not os.path.exists(path):
        return 'missing'
    try:
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
    except (IOError, ValueError):
        return 'unreadable'
    units = data.get('units')
    if not data.get('sample') or not isinstance(units, list):
        return 'not a sample file'
    if len(units) != take:
        return 'has %d units, tiers.json says %d' % (len(units), take)
    if not data.get('unitsOf') or data['unitsOf'] <= len(units):
        return 'does not say what it is a sample of'
    return None


def build(check=False):
    paid = sorted(tiers_mod.load())
    cfg = config()
    if not check and not os.path.isdir(SAMPLE_DIR):
        os.makedirs(SAMPLE_DIR)

    stale, written, unbuilt = [], [], []
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
            # No copy of the paid book on this machine. That is not a fault —
            # it is every fresh checkout, including the deploy runner, because
            # content/ is gitignored precisely so a paid book cannot travel with
            # the repository. So --check verifies what the sample file can
            # answer for on its own and leaves the comparison to a machine that
            # has the book. (Failing here instead is what blocked three
            # deploys: the check demanded a file the runner is designed not to
            # have.)
            problem = sample_problem(out, take)
            if problem:
                stale.append(book_id + ' (' + problem + ')')
            elif not check:
                unbuilt.append(book_id)
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
    if unbuilt:
        # Rebuilding is the whole job of this mode, so being unable to is worth
        # a line — but not an error: the existing sample was checked and is fine.
        print('not rebuilt (the book is not on this machine): ' + ', '.join(unbuilt))
    if not written:
        print('samples already up to date')
    return 0


if __name__ == '__main__':
    sys.exit(build('--check' in sys.argv))
