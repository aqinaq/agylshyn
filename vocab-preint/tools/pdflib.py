"""Shared PDF reading helpers.

The book is laid out in columns. PyMuPDF returns lines in row-major order, which
interleaves the columns and produces the scrambled text that the original
exercises.json suffers from. Everything here works on *lines with coordinates*
and rebuilds the true reading order (column by column, top to bottom).
"""
import re
import fitz

PDF = '/Users/akbopebakytkeldy/Downloads/2_English_Vocabulary_In_Use_Pre-Intermediate_Cambridge_-_Fourth_Edition.pdf'

_doc = None


def doc():
    global _doc
    if _doc is None:
        _doc = fitz.open(PDF)
    return _doc


def clean(s):
    """Normalise the ligatures/quotes the PDF font table produces."""
    s = s.replace('ﬀ', 'ff').replace('ﬁ', 'fi').replace('ﬂ', 'fl')
    s = s.replace('ﬃ', 'ffi').replace('ﬄ', 'ffl')
    s = s.replace('’', '’').replace('‘', '‘')
    s = s.replace('\xa0', ' ')
    return re.sub(r'[ \t]+', ' ', s).strip()


def lines(page_index):
    """All non-empty text lines on a page: dicts with x, y, x1, y1, text, size."""
    out = []
    for b in doc()[page_index].get_text('dict')['blocks']:
        for l in b.get('lines', []):
            txt = clean(''.join(s['text'] for s in l['spans']))
            if not txt:
                continue
            size = max((s['size'] for s in l['spans']), default=0)
            bold = any('Bold' in s.get('font', '') for s in l['spans'])
            out.append({
                'x': l['bbox'][0], 'y': l['bbox'][1],
                'x1': l['bbox'][2], 'y1': l['bbox'][3],
                'text': txt, 'size': round(size, 1), 'bold': bold,
            })
    return out


def columns(ls, tol=45):
    """Group lines into columns by x, then order each column top-to-bottom.

    Returns a list of columns (left to right); each column is a list of lines.
    """
    if not ls:
        return []
    cols = []
    for ln in sorted(ls, key=lambda l: l['x']):
        for c in cols:
            if abs(c['x'] - ln['x']) <= tol:
                c['lines'].append(ln)
                c['x'] = min(c['x'], ln['x'])
                break
        else:
            cols.append({'x': ln['x'], 'lines': [ln]})
    cols.sort(key=lambda c: c['x'])
    for c in cols:
        c['lines'].sort(key=lambda l: l['y'])
    return [c['lines'] for c in cols]


def reading_order(ls, tol=45):
    """Flatten lines into true reading order (column-major)."""
    out = []
    for col in columns(ls, tol):
        out.extend(col)
    return out
