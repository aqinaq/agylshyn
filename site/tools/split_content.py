#!/usr/bin/env python3
"""Moves the paid books out of the published site.

    python3 site/tools/split_content.py          # move them
    python3 site/tools/split_content.py --check   # only report, exit 1 if wrong

site/ is uploaded whole by .github/workflows/pages.yml, and the repository is
public, so a paid book left in site/data/ is a paid book anyone can download —
the lock in the app would be a picture of a lock. This tool is what makes the
paywall real: paid books live in content/, which is outside site/ and is
gitignored, and reach a reader only through Supabase, where a row-level policy
asks whether that reader has a live subscription.

Reversing it is symmetric: take a book out of tiers.json and run this again, and
the file moves back to site/data/ and is a static file once more.

The --check mode is what the deploy workflow runs. It never moves anything; it
just refuses a deploy that would publish content somebody is being charged for.
"""
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tiers as tiers_mod

DATA = tiers_mod.DATA
CONTENT = tiers_mod.CONTENT


def plan():
    """(to_content, to_data): files sitting in the wrong directory."""
    paid = tiers_mod.load()
    out, back = [], []
    for name in sorted(os.listdir(DATA)) if os.path.isdir(DATA) else []:
        if not name.endswith('.json'):
            continue
        book_id = name[:-5]
        # index.json, dict.json and answer-key-pages.json are not books and are
        # never paid; they are simply not in tiers.json, so they never match.
        if book_id in paid:
            out.append(book_id)
    for name in sorted(os.listdir(CONTENT)) if os.path.isdir(CONTENT) else []:
        if name.endswith('.json') and name[:-5] not in paid:
            back.append(name[:-5])
    return out, back


def move(book_id, src_dir, dst_dir):
    os.makedirs(dst_dir, exist_ok=True)
    src = os.path.join(src_dir, book_id + '.json')
    dst = os.path.join(dst_dir, book_id + '.json')
    # Overwrite rather than refuse: the usual reason a copy is already there is
    # a rebuild that wrote a fresh file into data/, and the fresh one is the one
    # that should survive.
    shutil.move(src, dst)
    return dst


def main(argv):
    check = '--check' in argv
    out, back = plan()

    if check:
        if out:
            print('PAID CONTENT IS IN THE PUBLIC SITE:')
            for b in out:
                print('  site/data/%s.json' % b)
            print('\nRun: python3 site/tools/split_content.py')
            return 1
        print('ok — no paid book in site/data/ (%d paid, %d in content/)'
              % (len(tiers_mod.load()),
                 len([n for n in os.listdir(CONTENT) if n.endswith('.json')])
                 if os.path.isdir(CONTENT) else 0))
        return 0

    for b in out:
        print('paid  site/data/%s.json  ->  content/' % b)
        move(b, DATA, CONTENT)
    for b in back:
        print('free  content/%s.json  ->  site/data/' % b)
        move(b, CONTENT, DATA)
    if not out and not back:
        print('nothing to move')
    else:
        print('\nNow rerun:  python3 site/tools/index_json.py'
              '  and  python3 site/tools/upload_content.py')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
