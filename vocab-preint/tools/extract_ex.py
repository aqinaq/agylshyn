"""Rebuild the exercises from the PDF with correct reading order.

Why: the book prints exercises in columns, and some exercises put the item
NUMBER in the right margin with the sentence on the left (e.g. 4.2, 19.4).
Reading the page naively pairs the wrong number with the wrong sentence, which
is what produced the off-by-one questions in the original exercises.json.

Approach
  1. rows   - group the page's text lines by baseline (y)
  2. number - find the segments that are item numbers, cluster them by x
  3. layout - >=2 x-clusters means a two-column exercise, otherwise one flow
  4. items  - a number labels its own row; unnumbered rows continue the item

The handwriting font (CalibanStd) is only used for answers the book has already
filled in, so it marks example items exactly.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pdflib import doc, clean

HEAD_RE = re.compile(r'^(\d{1,3})\.(\d{1,2})$')
NUM_RE = re.compile(r'^(\d{1,2})(?:\s+(.*))?$')
FOOTER_RE = re.compile(r'^English Vocabulary in Use|^Exercises$|^Answer key')
HAND_FONT = 'CalibanStd'
SECTION_RE = re.compile(r'^[A-H]$')
OPT_RE = re.compile(r'^([a-h])\s+(\S.*)$')


def page_lines(pi):
    """Text lines with geometry + whether they use the handwriting font."""
    out = []
    for b in doc()[pi].get_text('dict')['blocks']:
        for l in b.get('lines', []):
            txt = clean(''.join(s['text'] for s in l['spans']))
            if not txt or FOOTER_RE.match(txt):
                continue
            if txt.isdigit() and l['bbox'][1] > 940:   # page number in the footer
                continue
            sizes = [s['size'] for s in l['spans']]
            out.append({
                'x': round(l['bbox'][0], 1), 'y': round(l['bbox'][1], 1),
                'x1': round(l['bbox'][2], 1),
                'text': txt,
                'size': round(max(sizes), 1),
                'hand': any(HAND_FONT in s.get('font', '') for s in l['spans']),
                'bold': any('Bold' in s.get('font', '') for s in l['spans']),
                'page': pi,
            })
    return out


def answer_key_start():
    """First page of the Answer key — exercises live strictly before it."""
    for i in range(len(doc())):
        if doc()[i].get_text().strip().startswith('Answer key'):
            return i
    return len(doc())


def find_headers():
    """{unit: [(sub_number, page, x, y)]} for every '<unit>.<n>' heading."""
    heads = {}
    for pi in range(answer_key_start()):
        for l in page_lines(pi):
            m = HEAD_RE.match(l['text'])
            if not m or l['size'] < 15 or not l['bold']:
                continue
            u = int(m.group(1))
            heads.setdefault(u, []).append((l['text'], pi, l['x'], l['y']))
    for u in heads:
        heads[u].sort(key=lambda h: (h[1], h[3]))
    return heads


def rows_of(ls, tol=7):
    """Group lines that share a baseline into rows, each sorted left to right."""
    rows = []
    for l in sorted(ls, key=lambda l: (l['y'], l['x'])):
        if rows and abs(l['y'] - rows[-1][0]['y']) <= tol:
            rows[-1].append(l)
        else:
            rows.append([l])
    for r in rows:
        r.sort(key=lambda l: l['x'])
    return rows


def cluster(xs, tol=45):
    out = []
    for x in sorted(xs):
        if out and x - out[-1][-1] <= tol:
            out[-1].append(x)
        else:
            out.append([x])
    return [sum(c) / len(c) for c in out]


def find_options(rows):
    """Matching exercises print the choices as 'a with rain', 'b fog', ... in
    their own column. Pull them out so they are listed once instead of being
    glued onto whichever question shares their row."""
    cand = {}
    for row in rows:
        for seg in row:
            m = OPT_RE.match(seg['text'])
            if m:
                cand.setdefault(round(seg['x'] / 45), []).append((m.group(1), m.group(2), seg))
    for _, group in sorted(cand.items()):
        letters = [g[0] for g in group]
        if len(letters) >= 3 and letters == sorted(letters) and letters[0] == 'a' \
                and len(set(letters)) == len(letters):
            opts = [{'letter': g[0], 'text': g[1]} for g in group]
            return opts, {id(g[2]) for g in group}
    return None, set()


def parse_region(region):
    """Split one sub-exercise's lines into instruction text and numbered items."""
    rows = rows_of(region)
    options, opt_ids = find_options(rows)
    if opt_ids:
        rows = [[seg for seg in row if id(seg) not in opt_ids] for row in rows]
        rows = [r for r in rows if r]

    # Which segments look like an item number?
    marks = []          # (row_index, segment_index, number, x)
    for ri, row in enumerate(rows):
        for si, seg in enumerate(row):
            m = NUM_RE.match(seg['text'])
            if not m:
                continue
            n = int(m.group(1))
            if not (1 <= n <= 30):
                continue
            # a bare number, or a number followed by text
            marks.append((ri, si, n, seg['x']))

    if not marks:
        return None, [], rows, 1, options

    # Keep only the numbering scheme that actually forms a run 1,2,3...
    xs = cluster([m[3] for m in marks])
    best, best_score = None, -1
    for cx in xs:
        got = sorted({m[2] for m in marks if abs(m[3] - cx) <= 45})
        score = len([n for i, n in enumerate(got) if n == i + 1])
        if score > best_score:
            best, best_score = cx, score
    cols = [cx for cx in xs if len({m[2] for m in marks if abs(m[3] - cx) <= 45}) >= 2]
    if best is not None and best not in cols:
        cols.append(best)
    cols.sort()

    # Two-column exercise only when several columns each hold a numbered run
    multi = len(cols) >= 2 and all(
        len({m[2] for m in marks if abs(m[3] - c) <= 45}) >= 2 for c in cols)

    first_item_row = min(m[0] for m in marks)
    instr = ' '.join(seg['text'] for r in rows[:first_item_row] for seg in r).strip()

    # Instructions are set in bold, passage text is not. Used for
    # "complete the text" exercises, where the passage otherwise runs into the
    # instruction line because its gap numbers are inline.
    bold_split = len(rows)
    for ri, row in enumerate(rows):
        if ri and not any(seg['bold'] for seg in row):
            bold_split = ri
            break

    items = {}
    order = []

    def push(n, seg_texts, hand):
        if n not in items:
            items[n] = {'n': n, 'text': [], 'hand': False}
            order.append(n)
        items[n]['text'].extend(t for t in seg_texts if t)
        items[n]['hand'] = items[n]['hand'] or hand

    if multi:
        bounds = [(cols[i] + cols[i + 1]) / 2 for i in range(len(cols) - 1)]

        def col_of(x):
            i = 0
            while i < len(bounds) and x >= bounds[i]:
                i += 1
            return i

        cur = {}
        for row in rows[first_item_row:]:
            for seg in row:
                ci = col_of(seg['x'])
                m = NUM_RE.match(seg['text'])
                is_num = m and 1 <= int(m.group(1)) <= 30 and abs(seg['x'] - cols[ci]) <= 45
                if is_num:
                    cur[ci] = int(m.group(1))
                    push(cur[ci], [m.group(2) or ''], seg['hand'])
                elif ci in cur:
                    push(cur[ci], [seg['text']], seg['hand'])
    else:
        cur = None
        for row in rows[first_item_row:]:
            # A row can hold a whole horizontal list ("1 knee  2 comb  3 castle").
            # Two or more "<number> <word>" segments side by side means one item
            # each, not one item with the rest swallowed.
            inline = [s for s in row
                      if NUM_RE.match(s['text']) and NUM_RE.match(s['text']).group(2)
                      and 1 <= int(NUM_RE.match(s['text']).group(1)) <= 30]
            if len({int(NUM_RE.match(s['text']).group(1)) for s in inline}) >= 2:
                for seg in row:
                    m = NUM_RE.match(seg['text'])
                    if m and m.group(2) and 1 <= int(m.group(1)) <= 30:
                        cur = int(m.group(1))
                        push(cur, [m.group(2)], seg['hand'])
                    elif cur is not None:
                        push(cur, [seg['text']], seg['hand'])
                continue

            num, rest = None, []
            for seg in row:
                m = NUM_RE.match(seg['text'])
                if num is None and m and 1 <= int(m.group(1)) <= 30:
                    num = int(m.group(1))
                    if m.group(2):
                        rest.append((seg['x'], m.group(2), seg['hand']))
                else:
                    rest.append((seg['x'], seg['text'], seg['hand']))
            rest.sort(key=lambda r: r[0])
            if num is not None:
                cur = num
                push(num, [r[1] for r in rest], any(r[2] for r in rest))
            elif cur is not None:
                push(cur, [r[1] for r in rest], any(r[2] for r in rest))

    out = []
    for n in sorted(items):
        it = items[n]
        out.append({'n': n, 'question': clean(' '.join(it['text'])), 'hand': it['hand']})
    return instr, out, rows, bold_split, options


def extract_unit(unit, heads):
    """All sub-exercises of one unit."""
    hs = heads.get(unit, [])
    subs = []
    for i, (num, pi, hx, hy) in enumerate(hs):
        nxt = hs[i + 1] if i + 1 < len(hs) else None
        pls = page_lines(pi)
        # region: below this header, above the next one, right of its left edge
        region = [l for l in pls
                  if l['y'] >= hy - 3 and l['x'] >= hx - 6 and not HEAD_RE.match(l['text'])]
        if nxt and nxt[1] == pi:
            region = [l for l in region if l['y'] < nxt[3] - 3]
        # In the four-page "Study units" the exercises are interleaved with the
        # explanation sections. Those sections open with a lone capital letter
        # marker (A, B, C ...) — stop there so the theory text does not leak
        # into the questions.
        stops = [l['y'] for l in pls
                 if SECTION_RE.match(l['text']) and l['size'] >= 16 and l['y'] > hy + 5]
        if stops:
            region = [l for l in region if l['y'] < min(stops) - 3]
        instr, items, rows, bsplit, options = parse_region(region)
        subs.append({'number': num, 'page': pi + 1, 'instructions': instr or '',
                     'items': items,
                     'raw': ' '.join(s['text'] for r in rows for s in r),
                     'instrBold': ' '.join(s['text'] for r in rows[:bsplit] for s in r).strip(),
                     'bodyBold': ' '.join(s['text'] for r in rows[bsplit:] for s in r).strip(),
                     'options': options})
    return subs


def main():
    heads = find_headers()
    old = json.load(open('exercises.json', encoding='utf-8'))
    out = []
    for u in old['units']:
        out.append({'unit': u['unit'], 'title': u['title'],
                    'subs': extract_unit(u['unit'], heads)})
    json.dump(out, open('tools/ex_raw.json', 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    print('units: %d, sub-exercises: %d, items: %d' % (
        len(out), sum(len(u['subs']) for u in out),
        sum(len(s['items']) for u in out for s in u['subs'])), file=sys.stderr)


if __name__ == '__main__':
    main()
