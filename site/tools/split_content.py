#!/usr/bin/env python3
"""Move paid books out of the public deploy and into the API's private copy.

The reason this exists: site/ is served as static files, so anything left in
site/data/ can be fetched by anyone who guesses the filename — no account, no
payment, no way to stop it. A paywall over a public URL is decoration. So the
paid files do not live there at all; they live in api/content/, which is only
ever read by api/main.py after it has checked an entitlement.

    site/data/<id>.json     free books   → deployed to Pages/R2, cached offline
    api/content/<id>.json   paid books   → deployed to Railway, never served raw

Builders (build_data.py, build_ielts.py) always write to site/data/. They do not
need to know about tiers. This runs after them and relocates what should not be
public — one command, rerunnable, and it prints what it moved.

    python3 site/tools/split_content.py            # move, then report
    python3 site/tools/split_content.py --check    # report only, exit 1 if wrong

--check is the one to put in CI: it fails the build if a paid book is sitting in
the public folder, which is the mistake that costs money and cannot be undone
once a crawler has been past.
"""
import argparse
import json
import os
import shutil
import sys

import tiers as tiers_mod

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
DATA = os.path.join(ROOT, 'site', 'data')
PRIVATE = os.path.join(ROOT, 'api', 'content')


def _paths(book_id):
    return (os.path.join(DATA, book_id + '.json'),
            os.path.join(PRIVATE, book_id + '.json'))


def audit():
    """-> (leaked, missing, ok) book ids.

    leaked  — paid, still in site/data/: the deploy would give it away
    missing — paid, in neither place: the book cannot be served at all
    ok      — paid, private copy only
    """
    leaked, missing, ok = [], [], []
    for book_id in tiers_mod.paid_ids():
        pub, priv = _paths(book_id)
        if os.path.exists(pub):
            leaked.append(book_id)
        elif os.path.exists(priv):
            ok.append(book_id)
        else:
            missing.append(book_id)
    return leaked, missing, ok


def move(book_id):
    """Relocate one book. Returns a one-line description of what happened."""
    pub, priv = _paths(book_id)
    if not os.path.exists(pub):
        return None
    os.makedirs(PRIVATE, exist_ok=True)

    # Read both before writing either: a paid file that is already private may
    # be newer than a stale public copy left over from an earlier build, and
    # silently overwriting the good one with the stale one would be a data loss
    # that no error message announces.
    with open(pub, encoding='utf-8') as f:
        fresh = f.read()
    if os.path.exists(priv):
        with open(priv, encoding='utf-8') as f:
            old = f.read()
        if old == fresh:
            os.remove(pub)
            return '%-20s already private, dropped the public copy' % book_id

    shutil.move(pub, priv)
    return '%-20s → api/content/' % book_id


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--check', action='store_true',
                    help='report only; exit 1 if a paid book is public or missing')
    args = ap.parse_args()

    leaked, missing, ok = audit()

    if args.check:
        for book_id in leaked:
            print('PUBLIC   %s — paid, but sitting in site/data/' % book_id)
        for book_id in missing:
            print('MISSING  %s — paid, but built nowhere' % book_id)
        for book_id in ok:
            print('ok       %s' % book_id)
        if leaked or missing:
            print('\n%d public, %d missing — run split_content.py (or rebuild)'
                  % (len(leaked), len(missing)), file=sys.stderr)
            return 1
        print('\n%d paid books, all private.' % len(ok))
        return 0

    moved = [m for m in (move(b) for b in tiers_mod.paid_ids()) if m]
    for line in moved:
        print(line)
    if not moved:
        print('nothing to move — %d paid books already private.' % len(ok))

    leaked, missing, _ = audit()
    if missing:
        print('\nnot built: %s' % ', '.join(missing), file=sys.stderr)
    return 1 if leaked else 0


if __name__ == '__main__':
    sys.exit(main())
