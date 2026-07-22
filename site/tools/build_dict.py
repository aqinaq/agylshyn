#!/usr/bin/env python3
"""Compiles the hand-written core glossary into data/dict.json.

The site looks a word up locally first; only what is missing here goes to the
online providers in dict.js. So this file decides how much of the app works
offline — and how fast the common words feel.

Source is tools/dict_core.tsv, one entry per line:

    word <TAB> kazakh <TAB> simple english <TAB> pos (optional)

Run from the site/ directory:

    python3 tools/build_dict.py            # build + coverage report
    python3 tools/build_dict.py --missing 200   # also list top uncovered words
"""

import json
import glob
import os
import re
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
SRC = os.path.join(HERE, 'dict_core.tsv')
OUT = os.path.join(SITE, 'data', 'dict.json')

WORD_RE = re.compile(r"[A-Za-z][A-Za-z'’-]*")

# OCR debris and app-internal field values that appear in the JSON but are not
# English words a reader would ever look up. Kept out of the coverage report so
# the "still missing" list stays actionable.
NOISE = {
    'wkh', 'dqg', 'iru', 'wr', 'ou', 'th', 'ing', 've', 'll', 'ed', 'er', 'ar',
    'ther', 'un', 're', 'st', 'freeform', 'layout', 'categorization',
    'per-item', 'multi-column', 'word-list', 'pdf', 'extracted', 'verify',
    'items', 'jumbled', 'etc', 'dr', 'mr', 'mrs',
}


def read_core():
    """Parses the TSV. Later lines win, so appending a fix is enough."""
    words = {}
    if not os.path.exists(SRC):
        return words
    with open(SRC, encoding='utf-8') as fh:
        for lineno, raw in enumerate(fh, 1):
            line = raw.rstrip('\n')
            if not line.strip() or line.lstrip().startswith('#'):
                continue
            parts = line.split('\t')
            if len(parts) < 3:
                print('  skip line %d (needs 3 columns): %s' % (lineno, line[:60]))
                continue
            word = parts[0].strip().lower()
            kk = parts[1].strip()
            en = parts[2].strip()
            pos = parts[3].strip() if len(parts) > 3 else ''
            if not word or not kk:
                continue
            words[word] = [kk, en, pos] if pos else [kk, en]
    return words


def base_forms(w):
    """Mirrors baseForms()/stripClitic() in dict.js.

    Kept in step by hand: its only job is to stop the coverage report from
    counting `questions` as missing when `question` is right there."""
    out = []

    def add(x):
        if x and len(x) > 1 and x not in out:
            out.append(x)

    def stem(s):
        add(s)
        add(s + 'e')
        if len(s) > 2 and s[-1] == s[-2] and s[-1] in 'bdgklmnprtz':
            add(s[:-1])

    if w.endswith('ies'):
        add(w[:-3] + 'y')
    if w[-4:] in ('ches', 'shes', 'sses') or w[-3:] in ('xes', 'zes', 'oes'):
        add(w[:-2])
    if w.endswith('s') and not w.endswith('ss'):
        add(w[:-1])
    if w.endswith('ied'):
        add(w[:-3] + 'y')
    if w.endswith('ed'):
        stem(w[:-2])
    if w.endswith('ing'):
        stem(w[:-3])
    if w.endswith('iest'):
        add(w[:-4] + 'y')
    if w.endswith('est'):
        stem(w[:-3])
    if w.endswith('ier'):
        add(w[:-3] + 'y')
    if w.endswith('er'):
        stem(w[:-2])
    if w.endswith('ily'):
        add(w[:-3] + 'y')
    if w.endswith('ly'):
        add(w[:-2])
    for clitic in ("n't", "'s", "'re", "'ve", "'ll", "'d"):
        if w.endswith(clitic):
            stem = w[:-len(clitic)]
            add(stem)
            out.extend(x for x in base_forms(stem) if x not in out)
    return out


def resolves(word, words):
    return word in words or any(f in words for f in base_forms(word))


def corpus_counts():
    counts = Counter()

    def walk(node):
        if isinstance(node, str):
            for w in WORD_RE.findall(node):
                counts[w.lower().replace('’', "'")] += 1
        elif isinstance(node, list):
            for x in node:
                walk(x)
        elif isinstance(node, dict):
            for v in node.values():
                walk(v)

    for path in sorted(glob.glob(os.path.join(SITE, 'data', '*.json'))):
        if os.path.basename(path) in ('dict.json', 'index.json'):
            continue
        with open(path, encoding='utf-8') as fh:
            walk(json.load(fh))
    return counts


def main():
    words = read_core()
    if not words:
        print('no entries in %s — nothing to build' % SRC)
        return 1

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump({'v': 1, 'words': words}, fh, ensure_ascii=False,
                  separators=(',', ':'), sort_keys=True)

    counts = corpus_counts()
    total = sum(counts.values())
    covered = sum(c for w, c in counts.items() if resolves(w, words))
    size = os.path.getsize(OUT) / 1024.0

    print('entries : %d' % len(words))
    print('file    : data/dict.json (%.0f KB)' % size)
    print('coverage: %.1f%% of the %d word occurrences in the exercises'
          % (100.0 * covered / total if total else 0, total))

    if '--missing' in sys.argv:
        i = sys.argv.index('--missing')
        n = int(sys.argv[i + 1]) if len(sys.argv) > i + 1 else 100
        gaps = [(w, c) for w, c in counts.most_common()
                if w not in words and w not in NOISE and len(w) > 1][:n]
        print('\ntop %d words still missing (frequency):' % len(gaps))
        print('\n'.join('%6d  %s' % (c, w) for w, c in gaps))
    return 0


if __name__ == '__main__':
    sys.exit(main())
