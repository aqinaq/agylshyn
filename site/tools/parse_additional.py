#!/usr/bin/env python3
"""Turn Advanced Grammar's revision exercises into answerable items.

`additionalExercises` in the source is one undivided blob per exercise:

    box. Use the present simple … put read tell weigh 1 a If I'm not too busy,
    I promise to help you … b I'll try to get over on Saturday, but I to be
    there. 2 a I made a cup of coffee while she the letter. b …

plus a separate answer key:

    1 b 'm not promising / don't promise 2 a was reading / read b read 3 a …

Both are regular enough to split into numbered a/b items, which turns a wall of
text into the same fill-in rows the rest of the site uses.

Used by build_data.py; run directly to see what it makes of each exercise.
"""
import re

# "240 Additional exercises <next exercise title> Units 3 & 6" — the page
# footer and the following exercise's heading, swept up by the extraction.
TRAILING_JUNK = re.compile(r'\s*\d{2,3}\s+Additional exercises\b.*$', re.S)
LEADING_JUNK = re.compile(r'^\s*(?:Additional exercises\s*)?', re.I)

# the run of bare lowercase words that forms the word bank, just before "1 a"
WORDBANK = re.compile(r'((?:\b[a-z][a-z\-\']{1,14}\s+){3,})(?=\d+\s+a\s)')

ITEM = re.compile(r'(?<!\d)(\d{1,2})\s+a\s+(.*?)(?:\s+b\s+(.*?))?(?=(?<!\d)\d{1,2}\s+a\s|$)', re.S)


def split_items(raw):
    """-> (instructions, wordbank list, [(n, a_text, b_text), …])"""
    if not raw:
        return '', [], []
    body = TRAILING_JUNK.sub('', raw).strip()

    first = re.search(r'(?<!\d)\d{1,2}\s+a\s', body)
    head, rest = (body[:first.start()], body[first.start():]) if first else (body, '')

    bank = []
    m = WORDBANK.search(head + ' 1 a ')
    if m:
        words = m.group(1).split()
        # a word bank is a list of bare words, not the tail of a sentence
        if len(words) >= 4 and not any(w.endswith(('.', ',', ':')) for w in words):
            bank = words
            head = head[:m.start(1)]

    instructions = LEADING_JUNK.sub('', head).strip(' .')
    items = [(int(n), (a or '').strip(), (b or '').strip())
             for n, a, b in ITEM.findall(rest)]
    return instructions, bank, items


def split_answers(raw):
    """-> {'1a': 'answer', '1b': …} from "1 b x 2 a y b z"."""
    out = {}
    if not raw:
        return out
    for chunk in re.finditer(r'(?<!\d)(\d{1,2})\s+((?:[ab]\s+.*?)+?)(?=(?<!\d)\d{1,2}\s+[ab]\s|$)',
                             raw.strip(), re.S):
        n = chunk.group(1)
        for part in re.finditer(r'\b([ab])\s+(.*?)(?=\s+\b[ab]\s|$)', chunk.group(2), re.S):
            ans = part.group(2).strip(' .')
            if ans:
                out[n + part.group(1)] = ans
    return out


def walk_numbered(text, first=1):
    """Split "1 … 2 … 3 …" by walking the sequence, so stray numbers inside a
    sentence ("over 100 kilos") do not start a new item."""
    if not text:
        return []
    out, n = [], first
    pos = re.search(r'(?<!\d)%d(?!\d)\s' % n, text)
    if not pos:
        return []
    cur = pos.end()
    while True:
        nxt = re.search(r'(?<!\d)%d(?!\d)\s' % (n + 1), text[cur:])
        if nxt:
            out.append((n, text[cur:cur + nxt.start()].strip()))
            cur += nxt.end()
            n += 1
        else:
            out.append((n, text[cur:].strip()))
            break
        if n > 40:
            break
    return out


def split_plain(raw):
    """Exercises shaped "1 sentence. 2 sentence." with no a/b halves."""
    if not raw:
        return '', [], []
    body = TRAILING_JUNK.sub('', raw).strip()
    first = re.search(r'(?<!\d)1(?!\d)\s', body)
    head, rest = (body[:first.start()], body[first.start():]) if first else (body, '')
    rows = walk_numbered(rest)
    return LEADING_JUNK.sub('', head).strip(' .'), [], rows


def build(raw_items, raw_key):
    """-> (instructions, wordbank, items[]) in the site's item shape.

    Two shapes appear in this section: a/b pairs and plain numbered lists.
    Whichever yields more answerable rows wins."""
    answers_ab = split_answers(raw_key)
    instructions, bank, rows = split_items(raw_items)

    ab = []
    for n, a_text, b_text in rows:
        for letter, text in (('a', a_text), ('b', b_text)):
            if not text:
                continue
            key = '%d%s' % (n, letter)
            ab.append({
                'n': key,
                'question': text,
                'answer': answers_ab.get(key),
                # no key for this half means the book prints it as the example
                'isExample': key not in answers_ab and letter == 'a' and n == 1,
                'exampleAnswers': False,
            })

    p_instr, _, p_rows = split_plain(raw_items)
    plain_answers = dict(walk_numbered(raw_key or ''))
    plain = [{
        'n': n,
        'question': text,
        'answer': plain_answers.get(n),
        'isExample': False,
        'exampleAnswers': False,
    } for n, text in p_rows if text]

    scored = max((ab, instructions, bank), (plain, p_instr, []),
                 key=lambda c: (sum(1 for i in c[0] if i['answer']), len(c[0])))
    items, instr, wb = scored
    return instr, wb, items


if __name__ == '__main__':
    import json
    import os
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    src = json.load(open(os.path.join(root, 'advancedinuse', 'exercises.json'),
                         encoding='utf-8'))
    for a in src['additionalExercises']:
        instr, bank, items = build(a.get('instructionsAndItemsRaw'),
                                   a.get('answerKeyRaw'))
        answered = sum(1 for i in items if i['answer'])
        print('ex %-3s %-46s items %2d  with answer %2d  bank %2d'
              % (a['exercise'], (a.get('title') or '')[:44], len(items), answered, len(bank)))
        if a['exercise'] == 1:
            print('    instructions: %r' % instr[:90])
            print('    bank: %s' % bank)
            for i in items[:4]:
                print('    %-4s %-58r -> %r' % (i['n'], i['question'][:56], i['answer']))
