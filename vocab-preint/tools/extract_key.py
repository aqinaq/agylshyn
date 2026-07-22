"""Extract the book's Answer key (pages 209+) into JSON.

Output: tools/key.json  ->  {"1.4": {"2": "temporary", ...}, ...}
plus raw text per sub-exercise for the non-numbered (freeform) ones.
"""
import json
import re
import sys

sys.path.insert(0, __import__('os').path.dirname(__file__))
from pdflib import doc, lines, columns, clean

SUB_RE = re.compile(r'^(\d{1,3})\.(\d{1,2})$')
UNIT_RE = re.compile(r'^Unit\s+(\d{1,3})$')
ITEM_RE = re.compile(r'^(\d{1,2})\s+(.*)$')
FOOTER_RE = re.compile(r'English Vocabulary in Use|^\d{1,3}$|^Answer key$|^Index$')


def find_key_range():
    """Locate the first and last page of the Answer key section."""
    start = end = None
    for i in range(len(doc())):
        t = doc()[i].get_text()
        if start is None and t.strip().startswith('Answer key'):
            start = i
        if start is not None and 'Index' in t[:400] and i > start + 5:
            end = i
            break
    return start, (end if end else start + 40)


def sub_sections(page_index):
    """Yield (sub_number, [lines]) for each sub-exercise on the page, in order."""
    ls = [l for l in lines(page_index)
          if not FOOTER_RE.search(l['text']) and l['x'] > 5]
    if not ls:
        return []

    # A line that is exactly "6.3" / "Unit 7" is a heading; body text never is.
    # (Matching on text rather than margin position: the key pages use two
    # macro-columns, so headings appear at more than one x.)
    heads = [l for l in ls if SUB_RE.match(l['text']) or UNIT_RE.match(l['text'])]
    heads.sort(key=lambda l: l['y'])

    out = []
    for i, h in enumerate(heads):
        if not SUB_RE.match(h['text']):
            continue
        y0 = h['y']
        y1 = heads[i + 1]['y'] - 1 if i + 1 < len(heads) else 10 ** 6
        body = [l for l in ls
                if l is not h and y0 - 2 <= l['y'] < y1
                and not SUB_RE.match(l['text']) and not UNIT_RE.match(l['text'])]
        out.append((h['text'], body))
    return out


def parse_items(body):
    """Turn a sub-exercise's lines into {item_number: answer} + raw text."""
    ordered = []
    for col in columns(body, tol=40):
        ordered.extend(col)
    raw = ' '.join(l['text'] for l in ordered)

    items, cur = {}, None
    for l in ordered:
        m = ITEM_RE.match(l['text'])
        if m and (cur is None or int(m.group(1)) != 0):
            n = m.group(1)
            # a genuinely new item number, not a continuation starting with a digit
            if n not in items:
                items[n] = m.group(2).strip()
                cur = n
                continue
        if cur is not None:
            items[cur] = (items[cur] + ' ' + l['text']).strip()
    return items, raw


def main():
    start, end = find_key_range()
    print('answer key pages (0-based): %d..%d' % (start, end), file=sys.stderr)
    key, raws = {}, {}
    for p in range(start, end + 1):
        for sub, body in sub_sections(p):
            items, raw = parse_items(body)
            if sub in key:      # sub-exercise continued onto the next page
                key[sub].update(items)
                raws[sub] += ' ' + raw
            else:
                key[sub] = items
                raws[sub] = raw
    json.dump({'items': key, 'raw': raws}, open('tools/key.json', 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    print('sub-exercises found: %d' % len(key), file=sys.stderr)
    print('numbered answers:    %d' % sum(len(v) for v in key.values()), file=sys.stderr)


if __name__ == '__main__':
    main()
