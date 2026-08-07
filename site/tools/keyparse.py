"""Shared extractor for the "in Use" books whose answer key puts the
sub-exercise label in a left margin column and the answers in body columns.

Both English Collocations in Use Intermediate and Academic Vocabulary in Use
are laid out this way, so the parsing lives here and each book's builder only
supplies its geometry. The key is authoritative for answers; the exercise
pages contribute instructions and question text.

Plain text order is useless for these books — the margin labels come out
detached from the answers they head — so everything is parsed positionally.
"""
import json
import re

import fitz

from textnorm import clean_unit, expand_runs

SUB_RE = re.compile(r'^(\d{1,2}\.\d{1,2})$')
SUB_HEAD = re.compile(r'^(\d{1,2}\.\d{1,2})(?:\s+(\D.*))?$')
# Business prints the first answer inline with the label ("8.2 1 b"), so it
# needs a remainder that may begin with a digit. Only safe because that book
# pins label detection to exact column x positions.
SUB_HEAD_ANY = re.compile(r'^(\d{1,2}\.\d{1,2})(?:\s+(.*))?$')
UNIT_RE = re.compile(r'^Unit (\d{1,2})$')
ITEM_RE = re.compile(r'^(\d{1,2})\s*\t\s*(.*\S)\s*$')
ITEM_RE2 = re.compile(r'^(\d{1,2})\s+(.*\S)$')
# "Personal answers" must stay anchored to the full phrase — a bare ^Personal
# also swallows real answers such as "personal best".
OPEN_RE = re.compile(r'^(Possible|Suggested|Sample|Model)\b|^Personal answers?\b|'
                     r'^Your own|^These are the collocations|^You (might|may)', re.I)


class Book(object):
    """Geometry of one book. Page indices are 0-based."""

    def __init__(self, book_id, src, key_first, key_last, units,
                 ex_index, label_x, run_head, title_size=14, stitch=False,
                 two_col=False, label_xs=None, inline_first_item=False):
        self.id = book_id
        self.src = src
        self.key_first = key_first
        self.key_last = key_last
        self.units = units              # iterable of unit numbers
        self.ex_index = ex_index        # unit number -> exercises page index
        self.label_x = label_x          # labels sit left of this x
        self.run_head = re.compile(run_head)
        self.title_size = title_size
        # True when the book prints answer blanks as empty space, so a
        # question arrives split across a baseline (Academic). Books that
        # print dot leaders (Collocations) already read as one line, and
        # stitching them only risks gluing in a neighbouring column.
        self.stitch = stitch
        # True when the key is printed as two independent columns per page
        self.two_col = two_col
        # x positions where a sub label may start; a two-column key has one
        # per column. Defaults to "anything left of label_x".
        self.label_xs = label_xs
        self.inline_first_item = inline_first_item


GAP_PT = 25          # an answer blank; ordinary word spacing is a couple of pt
ITEM_START = re.compile(r'^\s*\d{1,2}([\s\t]|$)')


def _column_edges(frags):
    """Left edges shared by several continuation fragments.

    A matching exercise prints its endings as a genuine second column, every
    row starting at the same x. A gap-fill's tail starts wherever the blank
    happens to end, so its x wanders. Only the former must stay separate.
    """
    counts = {}
    for f in frags:
        if not f['first']:
            counts[round(f['x'])] = counts.get(round(f['x']), 0) + 1
    return {x for x, c in counts.items() if c >= 3}


def lines(page, run_head, stitch=False, two_col=False):
    """Visual lines, ordered top-to-bottom then left-to-right.

    With stitch=True, fragments sharing a baseline are joined and each blank
    between them becomes "…". Some books print an answer blank as empty space
    rather than dot leaders (Academic does, Collocations does not), which
    otherwise truncates a question to "In a".

    Only exercise pages are stitched. Doing it to a key page would rewrite the
    answers themselves — a two-column answer list would turn "likers lovers"
    into "likers … lovers" and no learner would ever match it.
    """
    frags = []
    for b in page.get_text('dict')['blocks']:
        for l in b.get('lines', []):
            spans = l.get('spans') or []
            t = ''.join(s['text'] for s in spans).rstrip()
            if not t.strip() or run_head.match(t.strip()):
                continue
            frags.append({'text': t, 'x': l['bbox'][0], 'x1': l['bbox'][2],
                          'y': l['bbox'][1],
                          'size': max(s['size'] for s in spans)})

    if two_col:
        # A two-column key page reads down the left column and then down the
        # right, so sorting the whole page by y would interleave them.
        mid = page.rect.width / 2
        frags = (sorted([f for f in frags if f['x'] < mid],
                        key=lambda f: (round(f['y'] / 4), f['x']))
                 + sorted([f for f in frags if f['x'] >= mid],
                          key=lambda f: (round(f['y'] / 4), f['x'])))
    else:
        frags.sort(key=lambda f: (round(f['y'] / 4), f['x']))
    if not stitch:
        return frags

    # mark which fragments open a baseline, then find the real columns
    prev_y = None
    for f in frags:
        f['first'] = prev_y is None or abs(f['y'] - prev_y) > 3
        prev_y = f['y']
    columns = _column_edges(frags)

    out, cur, prev_x1 = [], None, None
    for f in frags:
        if (cur is not None and abs(f['y'] - cur['y']) <= 3
                and not ITEM_START.match(f['text'])
                and round(f['x']) not in columns):
            cur['text'] += (' … ' if f['x'] - prev_x1 > GAP_PT else ' ') + f['text']
            cur['size'] = max(cur['size'], f['size'])
        else:
            if cur:
                out.append(cur)
            cur = dict(f)
        prev_x1 = f['x1']
    if cur:
        out.append(cur)
    return out


def parse_key(doc, bk):
    """-> {unit: {sub: {'items': {n: ans}, 'open': bool, 'raw': [str]}}}"""
    key = {}
    state = {'sub': None, 'unit': None, 'last_n': None,
             # "Over to you" closes the unit; what follows belongs to no sub
             'ended': False}

    def content(raw, t):
        """One line of answer text under the current sub."""
        if state['sub'] is None or state['ended']:
            return
        if t.lower().startswith('over to you'):
            state['ended'] = True
            return
        cur = key[state['unit']][state['sub']]
        cur['raw'].append(t)
        if OPEN_RE.match(t):
            cur['open'] = True
            return
        m = ITEM_RE.match(raw) or ITEM_RE2.match(t)
        if m:
            cur['items'][int(m.group(1))] = m.group(2).strip()
            state['last_n'] = int(m.group(1))
        elif state['last_n'] is not None and state['last_n'] in cur['items']:
            cur['items'][state['last_n']] += ' ' + t.strip()   # a wrapped answer

    for pi in range(bk.key_first, bk.key_last + 1):
        for l in lines(doc[pi], bk.run_head, two_col=bk.two_col):
            t = l['text'].strip()
            # Stitching a baseline can carry text along with the margin label,
            # so accept "7.1" and "7.1 Possible answers:" alike. Matching only
            # the bare label would hand this sub's answers to the previous one.
            if bk.label_xs:
                at_label = any(abs(l['x'] - lx) < 12 for lx in bk.label_xs)
            else:
                at_label = l['x'] < bk.label_x
            head_re = SUB_HEAD_ANY if bk.inline_first_item else SUB_HEAD
            m = head_re.match(t) if at_label else None
            if m:
                state['sub'] = m.group(1)
                state['unit'] = int(m.group(1).split('.')[0])
                key.setdefault(state['unit'], {}).setdefault(
                    state['sub'], {'items': {}, 'open': False, 'raw': []})
                state['last_n'], state['ended'] = None, False
                if m.group(2):
                    content(m.group(2), m.group(2).strip())
                continue
            m = UNIT_RE.match(t)
            if m:
                state['unit'] = int(m.group(1))
                key.setdefault(state['unit'], {})
                state['ended'] = False
                continue
            content(l['text'], t)
    return key


def parse_exercises(page, run_head, stitch=False):
    subs, cur = {}, None
    for l in lines(page, run_head, stitch=stitch):
        t = l['text'].strip()
        m = SUB_HEAD.match(t) if l['x'] < 120 else None
        if m:
            cur = m.group(1)
            subs[cur] = {'instructions': (m.group(2) or '').strip(),
                         'lines': [], 'frags': []}
            continue
        if cur is None:
            continue
        subs[cur]['frags'].append(l)
        m = ITEM_RE.match(l['text']) or ITEM_RE2.match(t)
        if not subs[cur]['instructions'] and not m and len(t) > 12:
            subs[cur]['instructions'] = t
        else:
            subs[cur]['lines'].append(l['text'])
    return subs


# "a work in shifts" — a lettered choice. Two spaces are common ("a  AS: …"),
# and the letter is always followed by real text, never by another label.
LETTER_LABEL = re.compile(r'^([a-l])[ \t]+(\S.*)$')
# A number opens the *other* column of a matching exercise, so it never
# continues the lettered one.
NUM_START = re.compile(r'^\s*\d{1,2}[\s\t]')


def letter_options(frags):
    """The a/b/c choices printed inside one sub-exercise -> [(letter, text)].

    A matching or reordering exercise prints its choices as a lettered list and
    its key as bare letters, so without this list the app can only say "see the
    question in the PDF" and then ask the learner to type a letter they have
    never been shown. The list is nearly always in the exercise itself; it is
    set as its own column, every label at the same x, so the column is what
    identifies it — a stray "a lot of" mid-sentence is never at that x.

    Frags must come from a stitched pass, so a choice broken by an answer blank
    ("a 'Obviously, my work involves … (travel) a lot.") arrives as one line.
    """
    # candidate labels, grouped by the column they start in
    cols = {}
    for i, f in enumerate(frags):
        m = LETTER_LABEL.match(f['text'].strip())
        # "a … c" is two columns of a table that stitched into one line, not a
        # choice; a real one is a phrase.
        if m and len(m.group(2)) >= 8:
            cols.setdefault(round(f['x'] / 4), []).append((i, m.group(1), m.group(2)))

    best = None
    for _, got in cols.items():
        letters = [g[1] for g in got]
        # a run from 'a', in order, no repeats — anything else is a coincidence
        want = [chr(ord('a') + i) for i in range(len(letters))]
        if len(letters) >= 3 and letters == want:
            if best is None or len(letters) > len(best):
                best = got
    if not best:
        return []

    label_x = frags[best[0][0]]['x']
    right = neighbour_column(frags, label_x)
    # "Match the beginnings (1–6) with the endings (a–f)" prints the letters in
    # the right-hand column, so the numbers wrap on our left as well as our
    # right; both are somebody else's text.
    left = label_x - 4
    starts = [g[0] for g in best]
    out = []
    for j, (i, letter, text) in enumerate(best):
        end = starts[j + 1] if j + 1 < len(starts) else len(frags)
        parts = [text]
        for f in frags[i + 1:end]:
            t = f['text'].strip()
            # The two halves of a matching exercise share baselines, so the
            # other column's lines are interleaved with ours: step over them
            # rather than stopping, or every choice ends at its first neighbour.
            if f['x'] < left or f['x'] >= right or NUM_START.match(f['text']):
                continue
            # a wrapped line of the same choice is indented under the label;
            # a line back at the label's own margin has left the list
            if f['x'] < label_x + 4 or t.lower().startswith('over to you'):
                break
            parts.append(t)
        out.append((letter, ' '.join(parts).strip()))
    return out


# A wrapped line is indented a few points under its label; a second column of
# the exercise starts much further across. Anything past this is the wrap of a
# neighbour, never our own.
COLUMN_GAP = 60


def neighbour_column(frags, label_x):
    """x of the column printed to the right of `label_x`, or infinity.

    A matching exercise sets its two halves side by side, so the lettered
    column's lines and the numbered column's lines share baselines. Both wrap,
    and a wrap carries no label to tell them apart — only the left edge does.
    A real column has several lines starting at the same x; a wrap that happens
    to begin far across (after a long answer blank) has one.
    """
    counts = {}
    for f in frags:
        x = round(f['x'])
        if x > label_x + COLUMN_GAP:
            counts[x] = counts.get(x, 0) + 1
    edges = [x for x, c in counts.items() if c >= 3]
    return min(edges) if edges else float('inf')


# "1 accountant 2 postwoman 3 flight attendant" — a whole numbered list set on
# one line, which otherwise parses as question 1 with the rest of the list
# glued to it and leaves questions 2..n blank.
INLINE_RUN = re.compile(r'\s(\d{1,2})\s+(?=[^\s\d])')


def split_inline_items(qlines):
    """Break a one-line numbered list into a question per number, in place."""
    for n in list(qlines):
        text = qlines[n]
        cuts = [(m.start(), int(m.group(1)), m.end()) for m in
                INLINE_RUN.finditer(text)]
        # only a genuine list: 2, 3, 4 … following on from this line's own
        # number, with nothing else already parsed under those numbers
        wanted = list(range(n + 1, n + 1 + len(cuts)))
        if len(cuts) < 2 or [c[1] for c in cuts] != wanted:
            continue
        if any(w in qlines for w in wanted):
            continue
        parts, prev = [], 0
        for start, num, end in cuts:
            parts.append(text[prev:start].strip())
            prev = end
        parts.append(text[prev:].strip())
        if any(len(p) < 2 for p in parts):
            continue
        for num, part in zip([n] + wanted, parts):
            qlines[num] = part


def match_options(items, frags):
    """The lettered choices for a matching/reordering exercise, or [].

    Attached only when the printed key really is those letters — every answer
    opening with one of them. That is what makes the list the thing the learner
    picks from, rather than an unrelated a/b/c list somewhere on the page.
    """
    if len(items) < 2 or not frags:
        return []
    firsts = [str(i.get('answer', '')).split(' ')[0].strip('.,;)') for i in items]
    if not all(len(f) == 1 and 'a' <= f <= 'l' for f in firsts):
        return []
    opts = letter_options(frags)
    got = {l for l, _ in opts}
    if not got or not set(firsts) <= got:
        return []
    return opts


def unit_title(page, bk):
    cand = [l for l in lines(page, bk.run_head)
            if l['y'] < 80 and l['size'] > bk.title_size
            and not l['text'].strip().isdigit()]
    cand.sort(key=lambda l: (-l['size'], l['y'], l['x']))
    return cand[0]['text'].strip() if cand else None


def build(bk):
    doc = fitz.open(bk.src)
    key = parse_key(doc, bk)
    st = {'items': 0, 'with_q': 0, 'open': 0, 'subs': 0, 'opts': 0}
    out_units = []

    for u in bk.units:
        ex = bk.ex_index(u)
        qsubs = parse_exercises(doc[ex], bk.run_head, bk.stitch)
        # The lettered choices only read correctly off a stitched page, whether
        # or not this book's question text wants stitching.
        osubs = (qsubs if bk.stitch
                 else parse_exercises(doc[ex], bk.run_head, stitch=True))
        subs_out = []
        for sub in sorted(key.get(u, {}), key=lambda s: int(s.split('.')[1])):
            k = key[u][sub]
            q = qsubs.get(sub, {})
            qlines = {}
            for ln in q.get('lines', []):
                m = ITEM_RE.match(ln) or ITEM_RE2.match(ln.strip())
                if m and len(m.group(2)) > 3:
                    qlines.setdefault(int(m.group(1)), m.group(2).strip())
            split_inline_items(qlines)

            # Expand a one-line run of answers ("1 c 2 d 3 e") before the
            # questions are attached, not after: the rows it splits into are
            # rows the page prints questions for, and clean_unit runs too late
            # to give them any.
            items = expand_runs({'items': [{'n': n, 'answer': k['items'][n]}
                                           for n in sorted(k['items'])]})['items']
            for it in items:
                if it['n'] in qlines:
                    it['question'] = qlines[it['n']]
                    st['with_q'] += 1
            st['items'] += len(items)
            st['subs'] += 1

            opts = match_options(items, osubs.get(sub, {}).get('frags', []))
            if opts:
                st['opts'] += 1

            o = {'number': sub,
                 'type': 'open' if (k['open'] and not items) else
                         ('items' if items else 'freeform'),
                 'instructions': q.get('instructions', ''),
                 'options': [{'letter': l, 'text': tx} for l, tx in opts],
                 'items': items}
            if k['open']:
                o['note'] = 'Possible answers — not auto-checked.'
                st['open'] += 1
            if not items:
                o['rawAnswer'] = ' '.join(k['raw'])[:1200]
            subs_out.append({kk: vv for kk, vv in o.items() if vv})

        out_units.append({'unit': u,
                          'title': unit_title(doc[ex - 1], bk) or 'Unit %d' % u,
                          'pdfIntroPage': ex,
                          'pdfExercisePage': ex + 1,
                          'pdfPages': [ex + 1],
                          'subExercises': subs_out})
    return {'id': bk.id, 'units': [clean_unit(u) for u in out_units]}, st


def main(bk, out_path):
    data, st = build(bk)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print("units=%d subs=%d items=%d with_question=%d open_subs=%d with_options=%d"
          % (len(data['units']), st['subs'], st['items'], st['with_q'],
             st['open'], st['opts']))
