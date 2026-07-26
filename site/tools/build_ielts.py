#!/usr/bin/env python3
"""Turn the Cambridge IELTS practice-test PDFs into the JSON the site reads.

Unlike the grammar/vocabulary books, an IELTS book is not a list of units — it
is four tests, each with a Listening section (4 parts, one audio file per part)
and a Reading section (3 passages).  So these books get their own schema:

  {id, title, source, tests: [
    {n, listening: {parts: [part]}, reading: {passages: [passage]}}]}

  part    = {part, audio: [path], pdfPage, groups: [group]}
  passage = {passage, title, subtitle?, pdfPage, text: [paragraph], groups: [group]}
  group   = {from, to, range, type, instructions: [str], legend?, title?,
             body?, options?, items: [{n, question?, answer}]}

`type` is one of:
  completion      note / form / table / summary / flow-chart / sentence gaps
  mcq             one letter per question
  mcq-multi       "Choose TWO letters" — one answer covers two question numbers
  tfng            TRUE / FALSE / NOT GIVEN
  ynng            YES / NO / NOT GIVEN
  matching        anything answered with a letter from a list: paragraphs,
                  people, sentence endings, opinions from a box, map labels

Run:  python3 site/tools/build_ielts.py
"""
import json
import os
import re

import fitz

import index_json

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'site', 'data')

# Dashes the books use interchangeably in "Questions 1-10".
DASH = r'[-–—]'
RANGE = re.compile(rf'^Questions?\s+(\d+)\s*(?:{DASH}|and)\s*(\d+)\s*\.?$', re.I)
ONE_Q = re.compile(r'^Question\s+(\d+)\s*\.?$', re.I)
PART = re.compile(rf'^PART\s+(\d+)\b', re.I)
# Case-sensitive: the heading is set in capitals, while rubrics say
# "...based on Reading Passage 2" mid-sentence.
PASSAGE = re.compile(r'^READING PASSAGE\s+(\d+)\s*$')
OPTION = re.compile(r'^([A-J])[\s.)]*(.*)$')
NUMBERED = re.compile(r'^(\d+)\b[\s.]*(.*)$')
# The run of leader dots marking a gap.  OCR turns some of them into middle
# dots or hyphens, so the class has to be wider than a full stop.
DOTS = r'(?:[…\.\u00b7\u2027\-]\s*){4,}'
# A numbered gap in a note or table: "7 ……………" or "9£ ……………".
GAP = re.compile(rf'\b(\d+)\s*[£$%]?\s*{DOTS}')
# A gap anywhere in the line, for sentence completion where the number leads.
GAP_ANY = re.compile(DOTS)


def heal_gaps(lines):
    """Rejoin a gap whose number and leader dots fell on different lines."""
    out = []
    for line in lines:
        if out and re.search(r'\b\d+\s*$', out[-1]) and re.match(DOTS, line):
            out[-1] = out[-1].rstrip() + ' ' + line
            continue
        out.append(line)
    return out

LISTENING_PARTS = {1: (1, 10), 2: (11, 20), 3: (21, 30), 4: (31, 40)}
READING_PASSAGES = {1: (1, 13), 2: (14, 26), 3: (27, 40)}


# Cambridge 17 was OCR'd with a Russian-aware engine, so wherever a Cyrillic
# letter looks like a Latin one it won the toss: "Уои should spend about 20
# minutes оп Questions 14-26".  None of these books contain real Cyrillic, so
# every one of these characters is a misread.
HOMOGLYPHS = str.maketrans({
    '\u0410': 'A', '\u0412': 'B', '\u0421': 'C', '\u0415': 'E', '\u041d': 'H',
    '\u041a': 'K', '\u041c': 'M', '\u041e': 'O', '\u0420': 'P', '\u0422': 'T',
    '\u0425': 'X', '\u0423': 'Y', '\u0406': 'I', '\u0417': '3', '\u0405': 'S',
    '\u0430': 'a', '\u0435': 'e', '\u043e': 'o', '\u0440': 'p', '\u0441': 'c',
    '\u0443': 'y', '\u0445': 'x', '\u0456': 'i', '\u043f': 'n', '\u0433': 'r',
    '\u044c': 'b', '\u0431': '6', '\u0451': 'e', '\u0438': 'u', '\u043c': 'm',
})


def latinise(text):
    """Undo the OCR's Cyrillic substitutions."""
    return text.translate(HOMOGLYPHS).replace('\u042b', 'bl').replace('\u044b', 'bl')


def clean_lines(page, junk):
    """Page text as stripped lines, minus watermarks and bare page numbers.

    A bare number is only treated as the page number when it is the first or
    last line — question numbers sit on their own line too, and dropping those
    silently loses a question."""
    out = []
    for raw in page.get_text().split('\n'):
        # Wingdings bullets come through as private-use code points.
        line = raw.replace('\uf06c', '\u2022').replace('\uf0a7', '\u2022').strip()
        if not line or any(j in line for j in junk):
            continue
        out.append(line)
    while out and re.fullmatch(r'\d{1,3}', out[0]):
        out.pop(0)
    while out and re.fullmatch(r'\d{1,3}', out[-1]):
        out.pop()
    return out


def classify(instructions, legend):
    """Pick a question type from the instruction wording."""
    text = ' '.join(instructions).lower()
    if 'true' in legend or 'do the following statements agree with the information' in text:
        return 'tfng'
    if 'yes' in legend or 'agree with the claims' in text or 'agree with the views' in text:
        return 'ynng'
    if re.search(r'choose\s+(two|three)\s+letters', text):
        return 'mcq-multi'
    if 'choose the correct letter' in text:
        return 'mcq'
    if re.search(r'\bcomplete\b', text) and 'correct ending' not in text:
        return 'completion'
    if re.search(r'label the (map|plan|diagram)', text):
        return 'matching'
    if re.search(r'which (paragraph|section)|correct ending|match each|choose\s+\w+\s+answers from the box'
                 r'|list of (people|researchers|experts|headings)|write the correct letter', text):
        return 'matching'
    return 'matching'


# Lines that are part of the rubric rather than the questions themselves.
INSTRUCTION_START = re.compile(
    r'^(Complete|Choose|Do the following|Label|Match|Which|Write|In boxes|Answer|Reading Passage \d has|'
    r'Look at the following|NB|Use ONLY|You may use)', re.I)


def split_instructions(lines):
    """Split a group's lines into rubric, TRUE/FALSE-style legend, and body."""
    instructions, legend, rest = [], {}, []
    i = 0
    while i < len(lines):
        line = lines[i]
        key = re.fullmatch(r'(TRUE|FALSE|NOT GIVEN|YES|NO)', line, re.I)
        if key and i + 1 < len(lines) and lines[i + 1].lower().startswith('if '):
            legend[key.group(1).lower()] = lines[i + 1]
            i += 2
            continue
        if INSTRUCTION_START.match(line) and not NUMBERED.match(line):
            instructions.append(line)
            i += 1
            # A rubric that wraps continues on the next line; keep absorbing
            # until the sentence actually ends.
            while i < len(lines) and not re.search(r'[.?:]\s*$', instructions[-1]) \
                    and not NUMBERED.match(lines[i]) and len(lines[i]) > 1:
                instructions[-1] += ' ' + lines[i]
                i += 1
            continue
        break
    rest = lines[i:]
    return instructions, legend, rest


def parse_letter_questions(rest, lo, hi):
    """MCQ and matching bodies: numbered stems, each optionally followed by
    lettered options.  Returns (items, shared_options, title)."""
    items, shared, title = [], [], []
    current = None
    seen_number = False
    for line in rest:
        num = NUMBERED.match(line)
        n = int(num.group(1)) if num else None
        if n is not None and lo <= n <= hi and (current is None or n > current['n']):
            current = {'n': n, 'question': num.group(2).strip(), 'options': []}
            items.append(current)
            seen_number = True
            continue
        opt = OPTION.match(line)
        if opt and (len(line) == 1 or not line[1].isalnum()):
            entry = {'letter': opt.group(1), 'text': opt.group(2).strip()}
            (current['options'] if current else shared).append(entry)
            continue
        if current is not None:
            # continuation of the stem, or of the option just before it
            if current['options']:
                current['options'][-1]['text'] = (current['options'][-1]['text'] + ' ' + line).strip()
            else:
                current['question'] = (current['question'] + ' ' + line).strip()
        elif shared:
            shared[-1]['text'] = (shared[-1]['text'] + ' ' + line).strip()
        elif not seen_number:
            title.append(line)
    return items, shared, ' '.join(title).strip()


def parse_completion(rest, lo, hi):
    """Gap-fill tasks come in two shapes.

    Sentence completion puts each gap on its own numbered line, so those become
    ordinary items with question text.  Note, form, table and summary
    completion bury the gaps inside a block of prose or a table, where the
    numbers cannot be separated from their surroundings — there the block is
    kept verbatim and the items only record which numbers it contains."""
    # Decide the shape before splitting: a sentence-completion task opens each
    # of its items with a bare number, and the gap can fall on a later line
    # once the sentence wraps.
    rest = heal_gaps(rest)
    starts, last = [], lo - 1
    for i, line in enumerate(rest):
        num = NUMBERED.match(line)
        if num and last < int(num.group(1)) <= hi and not GAP.match(line):
            starts.append(i)
            last = int(num.group(1))
    if len(starts) >= 2 and any(GAP_ANY.search(l) for l in rest):
        title = ' '.join(rest[:starts[0]]).strip()
        items = []
        for k, i in enumerate(starts):
            end = starts[k + 1] if k + 1 < len(starts) else len(rest)
            num = NUMBERED.match(rest[i])
            text = ' '.join([num.group(2).strip()] + rest[i + 1:end]).strip()
            items.append({'n': int(num.group(1)), 'question': text})
        return 'sentences', items, '', title

    # A note, form or table is kept exactly as printed, heading included: its
    # column headings and row labels are what the gaps hang off, and a table's
    # first cell ("Name of") reads as a heading but is not one.
    body = list(rest)
    numbers = sorted({int(n) for line in body for n in GAP.findall(line) if lo <= int(n) <= hi})
    return 'block', [{'n': n} for n in numbers], '\n'.join(body), ''


def parse_groups(lines, lo_bound, hi_bound):
    """Slice a section's lines at each "Questions N-M" header."""
    # Every header in the section, so that a group knows where it stops even
    # when the next header belongs to another part.
    stops = [i for i, line in enumerate(lines) if RANGE.match(line) or ONE_Q.match(line)]

    heads = []
    for i, line in enumerate(lines):
        m = RANGE.match(line) or ONE_Q.match(line)
        if not m:
            continue
        lo = int(m.group(1))
        hi = int(m.group(2)) if m.lastindex == 2 else lo
        if not (lo_bound <= lo <= hi_bound):
            continue
        # The books often print the range twice, once as a heading and once
        # above the rubric; and a part header repeats its full range.
        if heads and heads[-1][1] == lo and heads[-1][2] == hi:
            heads[-1] = (i, lo, hi)
            continue
        if heads and lo == heads[-1][1] and hi < heads[-1][2]:
            heads[-1] = (i, lo, hi)   # "Questions 11-20" then "Questions 11-16"
            continue
        heads.append((i, lo, hi))

    groups = []
    for k, (i, lo, hi) in enumerate(heads):
        end = next((s for s in stops if s > i), len(lines))
        # A table sometimes runs past the range its header announces — "Questions
        # 1—6" over a table holding gaps 1 to 10 — so a group may claim any
        # number up to where the next group starts.
        span = (heads[k + 1][1] - 1) if k + 1 < len(heads) else hi_bound
        span = max(hi, min(span, hi_bound))
        instructions, legend, rest = split_instructions(lines[i + 1:end])
        kind = classify(instructions, legend)
        group = {'from': lo, 'to': hi, 'range': f'{lo}-{hi}' if hi > lo else str(lo),
                 'type': kind, 'instructions': instructions}
        if legend:
            group['legend'] = legend
        if kind == 'completion':
            shape, items, body, title = parse_completion(rest, lo, span)
            group['shape'] = shape
            if body:
                group['body'] = body
            group['items'] = items
            group['to'] = max([hi] + [it['n'] for it in items])
            group['range'] = f"{group['from']}-{group['to']}"
        else:
            items, shared, title = parse_letter_questions(rest, lo, hi)
            if shared:
                group['options'] = shared
            group['items'] = [{k2: v for k2, v in it.items() if v} for it in items]
            if not items:
                # "Choose TWO letters" asks one question that two answer boxes
                # share, so there are no numbered stems to find — the prompt is
                # the only text above the options.
                group['prompt'] = title
                group['items'] = [{'n': n} for n in range(lo, hi + 1)]
                title = ''
        if title:
            group['title'] = title
        groups.append(group)
    return groups


LETTER_WORDS = {'T': 'TRUE', 'F': 'FALSE', 'NG': 'NOT GIVEN',
                'Y': 'YES', 'N': 'NO', 'NOTGIVEN': 'NOT GIVEN'}


def normalise_answer(value, kind):
    """The keys abbreviate inconsistently — "F", "NG", "CE", "C/E" — so bring
    each answer to the one form the app compares against."""
    value = value.strip()
    if kind in ('tfng', 'ynng'):
        upper = value.upper()
        # Some keys spell it out, some abbreviate, some do both: "NG (NOT GIVEN)".
        spelled = re.search(r'NOT\s*GIVEN|TRUE|FALSE|YES|NO', upper)
        if spelled:
            return 'NOT GIVEN' if spelled.group().startswith('NOT') else spelled.group()
        return LETTER_WORDS.get(upper.replace(' ', ''), upper)
    if kind == 'mcq-multi':
        letters = sorted(set(re.findall(r'[A-J]', value.upper())))
        return ', '.join(letters) if letters else value
    return value


def attach_answers(groups, key):
    """Write the key onto the parsed questions, one group at a time."""
    for group in groups:
        for item in group['items']:
            item['answer'] = normalise_answer(key.get(item['n'], ''), group['type'])
        if group['type'] == 'mcq-multi':
            # Two question numbers share one pair of letters.  Some keys print
            # the pair against both numbers, others split it one letter per
            # line; either way both boxes accept either letter.
            pair = normalise_answer(' '.join(i['answer'] for i in group['items']), 'mcq-multi')
            for item in group['items']:
                item['answer'] = pair


def parse_answer_key(lines):
    """The key prints "1. fish" or "17–18. A, E"; return {number: answer}."""
    answers = {}
    for line in lines:
        m = re.match(rf'^(\d+)\s*(?:{DASH}\s*(\d+))?\s*[.):]\s*(.+)$', line)
        if not m:
            continue
        lo, hi, value = int(m.group(1)), m.group(2), m.group(3).strip().rstrip('.')
        answers[lo] = value
        if hi:
            answers[int(hi)] = value
    return answers


# --------------------------------------------------------------------------
# Cambridge IELTS 20
# --------------------------------------------------------------------------
# This PDF is a re-typeset edition: clean text layer, Listening and Reading
# only (no Writing, no audioscripts), with the answer key on the last pages.
C20_JUNK = ('shohrukhposts',)

# One misprint in the source: the Test 3 Reading key opens Passage 3 with two
# entries both numbered 28 ("28. A", "28. C"), so question 27 has no answer of
# its own.  The first of the pair belongs to 27.
C20_KEY_FIXES = {(3, 'reading', 27): 'A'}


def c20_segment(doc):
    """Cut the book into blocks at each section opening.

    Only three page headings start a block: "PART 1" (a Listening section),
    "READING PASSAGE 1" (a Reading section) and "LISTENING Test n" (the answer
    key).  Every other page continues the block it follows — that is what keeps
    the one Test 3 page whose passage and questions are printed out of order
    from splitting the section in two."""
    blocks, current = [], None
    for i, page in enumerate(doc):
        lines = clean_lines(page, C20_JUNK)
        # Headings are set in capitals, and matching case-sensitively is what
        # keeps a rubric that mentions "Reading Passage 1" mid-sentence from
        # being read as the start of a new section.
        head = lines[:3]
        if re.search(r'LISTENING Test \d', ' '.join(head)):
            kind = 'key'
        elif any(re.match(r'READING PASSAGE\s+1\b', l) for l in head):
            kind = 'reading'
        elif any(re.match(r'PART\s+1\b', l) for l in head):
            kind = 'listening'
        else:
            kind = None                     # continues the previous block
        if kind is not None or current is None:
            current = {'kind': kind or 'listening', 'pages': []}
            blocks.append(current)
        current['pages'].append((i, lines))
    return blocks


def c20_passage_text(lines):
    """Split a passage block into title, subtitle and paragraphs.

    A paragraph is a run of lines; the PDF wraps at the printed line width, so
    join them and start a new paragraph when a line ends a sentence short of
    the typical full width."""
    # Drop the heading and the "You should spend about 20 minutes on Questions
    # 1-13 which are based on Reading Passage 1 on pages 1 and 2." rubric, which
    # wraps over two or three lines.
    body, skip = [], False
    for line in lines:
        if PASSAGE.match(line) or line in ('READING', 'LISTENING'):
            continue
        if line.startswith('You should spend'):
            skip = not line.rstrip().endswith('.')
            continue
        if skip:
            skip = not line.rstrip().endswith('.')
            continue
        body.append(line)
    title = body[0] if body else ''
    body = body[1:]
    subtitle = ''
    if body and len(body[0]) < 160 and not body[0][0].isdigit():
        # A one-line standfirst under the title, present on most passages.
        if len(body) > 1 and len(body[0]) < len(max(body[1:3], key=len)) * 0.95:
            subtitle, body = body[0], body[1:]
    # The PDF wraps at a fixed measure, so a short line means the paragraph
    # ended there — but only if the sentence ended too.  Without that second
    # test a line like "They forage on the" starts a new paragraph mid-sentence.
    width = max((len(l) for l in body), default=0)
    paras, buf = [], []
    for line in body:
        buf.append(line)
        if len(line) < width * 0.9 and re.search(r'[.!?][”"\')\]]?$', line):
            paras.append(' '.join(buf))
            buf = []
    if buf:
        paras.append(' '.join(buf))
    return title, subtitle, paras


def build_c20():
    doc = fitz.open(os.path.join(ROOT, 'site', 'pdf', 'ielts-20.pdf'))
    blocks = c20_segment(doc)

    keys = {}          # test number -> {'listening': {...}, 'reading': {...}}
    tests = {}
    test_no = 0
    for block in blocks:
        flat = [l for _, lines in block['pages'] for l in lines]
        first_page = block['pages'][0][0] + 1

        if block['kind'] == 'key':
            for _, lines in block['pages']:
                head = ' '.join(lines[:3])
                n = int(re.search(r'Test (\d)', head).group(1))
                text = '\n'.join(lines)
                listening, _, reading = text.partition('READING')
                keys.setdefault(n, {})['listening'] = parse_answer_key(listening.split('\n'))
                keys[n]['reading'] = parse_answer_key(reading.split('\n'))
            continue

        if block['kind'] == 'listening':
            test_no += 1
            tests.setdefault(test_no, {'n': test_no})
            parts = []
            for part, (lo, hi) in LISTENING_PARTS.items():
                groups = parse_groups(flat, lo, hi)
                page = next((p + 1 for p, lines in block['pages']
                             if any(RANGE.match(l) and lo <= int(RANGE.match(l).group(1)) <= hi
                                    for l in lines)), first_page)
                parts.append({'part': part,
                              'audio': [f'audio/c20/t{test_no}p{part}.m4a'],
                              'pdfPage': page, 'groups': groups})
            tests[test_no]['listening'] = {'parts': parts}
        else:
            passages = []
            for page_no, lines in block['pages']:
                start = next((PASSAGE.match(l) for l in lines[:3] if PASSAGE.match(l)), None)
                if start:
                    passages.append({'passage': int(start.group(1)), 'lines': list(lines),
                                     'pdfPage': page_no + 1})
                elif passages and not any(RANGE.match(l) or ONE_Q.match(l) for l in lines[:3]):
                    passages[-1]['lines'] += lines
            out = []
            for p in passages:
                lo, hi = READING_PASSAGES[p['passage']]
                title, subtitle, paras = c20_passage_text(p['lines'])
                entry = {'passage': p['passage'], 'title': title, 'pdfPage': p['pdfPage'],
                         'text': paras, 'groups': parse_groups(flat, lo, hi)}
                if subtitle:
                    entry['subtitle'] = subtitle
                out.append(entry)
            tests[test_no]['reading'] = {'passages': sorted(out, key=lambda x: x['passage'])}

    for (n, skill, q), value in C20_KEY_FIXES.items():
        keys[n][skill].setdefault(q, value)

    # Attach the answers.
    for n, test in tests.items():
        for part in test.get('listening', {}).get('parts', []):
            attach_answers(part['groups'], keys.get(n, {}).get('listening', {}))
        for passage in test.get('reading', {}).get('passages', []):
            attach_answers(passage['groups'], keys.get(n, {}).get('reading', {}))

    return {
        'id': 'ielts-20',
        'title': 'Cambridge IELTS 20 Academic',
        'skills': ['listening', 'reading'],
        'tests': [tests[n] for n in sorted(tests)],
    }





# --------------------------------------------------------------------------
# Cambridge IELTS 21
# --------------------------------------------------------------------------
# A scan of the full book with an OCR text layer.  The body text came through
# well, but the OCR breaks a few headings across lines and repeats the running
# head on every page, so the lines need tidying before the shared parsers see
# them.
C21_RUNNING_HEAD = re.compile(r'^(Test\s?\d|Listening|Reading|Writing|Speaking|Audioscripts)$')


def book_lines(page, tidy=lambda t: t):
    """Clean lines for one page of a full Cambridge book, with the OCR's split
    headings healed and the repeated running head dropped."""
    lines = [tidy(l) for l in clean_lines(page, ())]
    lines = [l for l in lines if l and not C21_RUNNING_HEAD.match(l)]
    out = []
    for line in lines:
        # "READING" / "PASSAGE 2" and "Questions" / "17-20" arrive split.
        if out == ['READING'] or (out and out[-1] == 'READING'):
            m = re.match(r'^PASSAGE\s+(\d+)$', line)
            if m:
                out[-1] = f'READING PASSAGE {m.group(1)}'
                continue
        if out and out[-1] == 'Questions' and re.fullmatch(rf'\d+\s*(?:{DASH}|and)\s*\d+', line):
            out[-1] = f'Questions {line}'
            continue
        out.append(line)
    return [l for l in out if l != 'READING']


def book_sections(doc, tidy=lambda t: t):
    """Label every page with the test number and the section it belongs to."""
    pages, test, kind = [], 0, None
    for i, page in enumerate(doc):
        raw = [tidy(l) for l in clean_lines(page, ())]
        lines = book_lines(page, tidy)
        joined = ' '.join(lines[:6])
        # These two back-matter sections are only identifiable from the running
        # head, which c21_lines strips.
        if any(l == 'Audioscripts' for l in raw[:3]):
            test, kind = 0, 'audioscript'
        elif any('Sample Writing answers' in l for l in raw[:3]):
            test, kind = 0, 'sample'
        elif 'Listening and Reading answer keys' in joined:
            test, kind = 0, 'key'
        elif re.search(r'\bPART\s+1\b', joined) and 'LISTENING' in joined:
            test, kind = test + 1, 'listening'
        elif any(re.match(r'READING PASSAGE\s+1$', l) for l in lines[:6]):
            kind = 'reading'
        elif 'WRITING' in joined and 'TASK 1' in joined:
            kind = 'writing'
        elif 'SPEAKING' in joined and re.search(r'\bPART\s+1\b', joined):
            kind = 'speaking'
        pages.append((test, kind, i, lines))
    return pages


def rotated_lines(page):
    """Rebuild the reading order of a page whose text layer is rotated.

    The answer keys are printed sideways in two columns, and the flat text
    stream interleaves them.  Working from word positions instead: with a 90°
    rotation a visual line is a set of words sharing an x, and a visual column
    is a band of y, with the left-hand column being the one with the higher y.
    """
    words = [w for w in page.get_text('words') if w[4].strip()]
    if not words:
        return []
    rows = {}
    for w in words:
        rows.setdefault(round(w[0] / 4), []).append(w)
    for key in rows:
        rows[key].sort(key=lambda w: -w[1])

    # The two columns overlap in y once long answers are allowed to run into
    # the gutter, so no single empty band separates them.  Instead, look at
    # where lines jump across the page and take the middle of those jumps.
    jumps = []
    for line in rows.values():
        for a, b in zip(line, line[1:]):
            if a[1] - b[3] > 40:
                jumps.append((a[1] + b[3]) / 2)
    split = sorted(jumps)[len(jumps) // 2] if len(jumps) >= 3 else None

    if split is None:
        return [' '.join(w[4] for w in rows[k]).strip() for k in sorted(rows)
                if rows[k]]

    # Cut each line at its own gutter rather than at one global y, so that a
    # long answer running past the column edge stays with its question.
    left, right = {}, {}
    for key, line in rows.items():
        cut = len(line)
        best = None
        for i, (a, b) in enumerate(zip(line, line[1:])):
            if a[1] - b[3] < 25:
                continue
            distance = abs((a[1] + b[3]) / 2 - split)
            if best is None or distance < best:
                best, cut = distance, i + 1
        if best is None:                       # no gutter: whole line is one column
            cut = len(line) if line[0][1] > split else 0
        left[key], right[key] = line[:cut], line[cut:]

    out = []
    for column in (left, right):
        for key in sorted(column):
            line = ' '.join(w[4] for w in column[key]).strip()
            if line:
                out.append(line)
    return out


def book_key_pages(doc, pages, tidy=lambda t: t):
    """Read the two-column answer-key pages.

    The key is typeset around a band-score chart, so the text stream mixes
    "1 / 10/ten" answer pairs with sentences from the chart.  Walking the
    stream while expecting the next question number in order is what keeps the
    chart's own numbers ("0-19", "20-28") out of the answers."""
    keys = {}
    order, flat = [], []
    for test, kind, i, lines in pages:
        if kind != 'key':
            continue
        joined = ' '.join(lines[:8])
        skill = 'listening' if 'LISTENING' in joined else 'reading'
        order.append((skill, [tidy(l) for l in rotated_lines(doc[i])]))
        flat.append(lines)

    for idx, (skill, lines) in enumerate(order):
        n = idx // 2 + 1
        answers, pending, pair = {}, None, None
        for line in lines:
            line = line.strip()
            if not line or line.startswith('Part') or line.startswith('Reading Passage'):
                pending = None
                continue
            both = re.match(rf'^(\d+)\s*&\s*(\d+)\b(.*)$', line)
            if both and int(both.group(1)) <= 40:
                pair = [int(both.group(1)), int(both.group(2)), []]
                pending = None
                line = both.group(3).strip()
                if not line:
                    continue
            if pair is not None:
                if re.fullmatch(r'IN (EITHER|ANY) ORDER', line, re.I):
                    continue
                pair[2] += re.findall(r'\b([A-J])\b', line)
                if len(pair[2]) >= 2:
                    value = ', '.join(sorted(set(pair[2][:2])))
                    answers[pair[0]] = answers[pair[1]] = value
                    pair = None
                continue
            if pending is not None:
                # A line that opens with its own number is the next question,
                # not the pending one's answer — better to leave the gap for
                # the second pass than to record something wrong.
                if not re.match(r'\d+\s', line):
                    answers[pending] = line
                    pending = None
                    continue
                pending = None
            solo = re.fullmatch(r'(\d+)', line)
            if solo and 1 <= int(solo.group(1)) <= 40:
                pending = int(solo.group(1))     # the answer is on the next line
                continue
            both = re.fullmatch(r'(\d+)\s+(\S.*)', line)
            if both and 1 <= int(both.group(1)) <= 40:
                answers[int(both.group(1))] = both.group(2).strip()
        keys.setdefault(n, {})[skill] = answers

    # The two readings of the page fail in different places: the column
    # reconstruction can drop an answer at a column edge, the flat text stream
    # can interleave the columns.  Fill each one's gaps from the other.
    for idx, (skill, _) in enumerate(order):
        n = idx // 2 + 1
        answers = keys[n][skill]
        lines = flat[idx]
        for i, line in enumerate(lines[:-1]):
            solo = re.fullmatch(r'(\d+)', line.strip())
            if not solo or not 1 <= int(solo.group(1)) <= 40:
                continue
            value = lines[i + 1].strip()
            if value and not re.fullmatch(r'\d+', value):
                answers.setdefault(int(solo.group(1)), value)
    return keys


def audio_files(folder, test, part):
    """Audio paths for one Listening part, in order.

    Cambridge 21's recordings are split mid-part in places, so a part can map
    to several files ("t1p1a.mp3", "t1p1b.mp3") that play one after another."""
    directory = os.path.join(ROOT, 'site', 'audio', folder)
    if not os.path.isdir(directory):
        return []
    stem = f't{test}p{part}'
    names = sorted(f for f in os.listdir(directory)
                   if re.fullmatch(rf'{stem}[a-z]?\.(mp3|m4a)', f))
    return [f'audio/{folder}/{f}' for f in names]


def build_full_book(book_id, title, audio_folder, tidy=lambda t: t):
    """Cambridge 17 and 21 are both scans of the complete book, laid out the
    same way: four tests of Listening, Reading, Writing and Speaking, then
    audioscripts, the answer keys and sample Writing answers."""
    doc = fitz.open(os.path.join(ROOT, 'site', 'pdf', book_id + '.pdf'))
    pages = book_sections(doc, tidy)
    keys = book_key_pages(doc, pages, tidy)

    def section(test, kind):
        return [(i, lines) for t, k, i, lines in pages if t == test and k == kind]

    tests = []
    for n in (1, 2, 3, 4):
        listening = section(n, 'listening')
        flat = [l for _, lines in listening for l in lines]
        parts = []
        for part, (lo, hi) in LISTENING_PARTS.items():
            page = next((i + 1 for i, lines in listening
                         if any(re.match(rf'PART\s+{part}\b', l) for l in lines)),
                        listening[0][0] + 1 if listening else 0)
            parts.append({'part': part, 'audio': audio_files(audio_folder, n, part),
                          'pdfPage': page, 'groups': parse_groups(flat, lo, hi)})

        reading = section(n, 'reading')
        rflat = [l for _, lines in reading for l in lines]
        passages, current = [], None
        for i, lines in reading:
            start = next((PASSAGE.match(l) for l in lines[:4] if PASSAGE.match(l)), None)
            if start:
                current = {'passage': int(start.group(1)), 'lines': list(lines), 'pdfPage': i + 1}
                passages.append(current)
            elif current and not any(RANGE.match(l) or ONE_Q.match(l) for l in lines[:3]):
                current['lines'] += lines
        out = []
        for p in passages:
            lo, hi = READING_PASSAGES[p['passage']]
            heading, subtitle, paras = c20_passage_text(p['lines'])
            entry = {'passage': p['passage'], 'title': heading, 'pdfPage': p['pdfPage'],
                     'text': paras, 'groups': parse_groups(rflat, lo, hi)}
            if subtitle:
                entry['subtitle'] = subtitle
            out.append(entry)

        test = {'n': n,
                'listening': {'parts': parts},
                'reading': {'passages': sorted(out, key=lambda x: x['passage'])},
                'writing': {'tasks': parse_writing(section(n, 'writing'))},
                'speaking': {'parts': parse_speaking(section(n, 'speaking'))}}

        for part in test['listening']['parts']:
            attach_answers(part['groups'], keys.get(n, {}).get('listening', {}))
        for passage in test['reading']['passages']:
            attach_answers(passage['groups'], keys.get(n, {}).get('reading', {}))
        tests.append(test)

    return {
        'id': book_id,
        'title': title,
        'skills': ['listening', 'reading', 'writing', 'speaking'],
        'tests': tests,
    }


TASK = re.compile(r'^(?:WRITING\s+)?TASK\s+([12])\b')


def parse_writing(section_pages):
    """The two Writing prompts.  Task 1 describes a chart that only exists as
    an image, so the page number is kept for the reader to open the PDF at."""
    tasks = []
    for i, lines in section_pages:
        current = None
        for line in lines:
            m = TASK.match(line)
            if m:
                current = {'task': int(m.group(1)), 'pdfPage': i + 1, 'prompt': []}
                tasks.append(current)
                continue
            if current is not None and line not in ('WRITING',):
                current['prompt'].append(line)
    for t in tasks:
        t['prompt'] = ' '.join(t['prompt']).strip()
        t['needsPdf'] = t['task'] == 1        # the chart or diagram is a picture
    return tasks


def parse_speaking(section_pages):
    """The three Speaking parts, kept as plain prompt text."""
    parts, current = [], None
    for i, lines in section_pages:
        for line in lines:
            m = re.match(r'^PART\s+([123])\b', line)
            if m:
                current = {'part': int(m.group(1)), 'pdfPage': i + 1, 'prompt': []}
                parts.append(current)
                continue
            if current is not None and line != 'SPEAKING':
                current['prompt'].append(line)
    for p in parts:
        p['prompt'] = '\n'.join(p['prompt']).strip()
    return parts


def validate(data):
    """Report how much of a book came out of the PDF intact.

    Every Academic test is 40 Listening and 40 Reading questions, so anything
    short of 320 with an answer each means the source scan did not give the
    parser enough to work with."""
    found = answered = 0
    for test in data['tests']:
        sections = list(test['listening']['parts']) + list(test['reading']['passages'])
        for section in sections:
            for group in section['groups']:
                found += len(group['items'])
                answered += sum(1 for i in group['items'] if i.get('answer'))
    return found, answered


# --------------------------------------------------------------------------
# Output in the shape site/app.js already reads
# --------------------------------------------------------------------------
# The reader has one engine — units made of sub-exercises made of items — so a
# test section becomes a unit rather than a new kind of page, and progress,
# mistakes, drill, search and statistics all keep working untouched.
#
#   unit 1 = Test 1 Listening (questions 1-40, one recording per part)
#   unit 2 = Test 1 Reading   (questions 1-40, three passages)
#   unit 3 = Test 2 Listening ... and so on, eight units per book.
#
# The page works as an answer sheet: the questions themselves are read from the
# book in the PDF pane, and the site holds only the numbered boxes to write the
# answers into.  A gap-fill table or a multiple-choice stem loses too much of
# its layout in extraction to be worth reprinting badly next to the real thing.
# What the site does keep is what the PDF cannot give: the recording for each
# Listening part, and each Reading passage as selectable text — and each sits
# directly above the questions it belongs to.


def group_to_sub(group):
    """One question group as a sub-exercise of numbered answer boxes.

    The rubric is kept because it says how to answer — the word limit above
    all — but a line that asks the question itself ("Which TWO things does
    Heather explain about kilns?") is left in the book with the rest."""
    rubric = [line for line in group['instructions']
              if not re.match(r'^(Which|What|Who|How|Why)\b', line)]
    sub = {
        'number': group['range'],
        'type': 'items',
        'kind': group['type'],
        'instructions': ' '.join(rubric),
    }
    if group.get('legend'):
        sub['note'] = ' · '.join(f'{k.upper()} — {v}' for k, v in group['legend'].items())
    sub['items'] = [{'n': item['n'], 'answer': item.get('answer', '')}
                    for item in group['items']]
    return sub


def to_units(book):
    """Flatten the parsed tests into the unit list the site loads."""
    units = []
    for test in book['tests']:
        subs = []
        for part in test['listening']['parts']:
            for k, group in enumerate(part['groups']):
                sub = group_to_sub(group)
                # The player goes on the first group of the part, so it renders
                # immediately above the questions it is the recording for.
                if k == 0 and part['audio']:
                    sub['audio'] = {'part': part['part'], 'files': part['audio'],
                                    'from': LISTENING_PARTS[part['part']][0],
                                    'to': LISTENING_PARTS[part['part']][1]}
                subs.append(sub)
        units.append({
            'unit': len(units) + 1,
            'title': f"Test {test['n']} — Listening",
            'skill': 'listening',
            'pdfExercisePage': test['listening']['parts'][0]['pdfPage'],
            'subExercises': subs,
        })

        subs = []
        for passage in test['reading']['passages']:
            for k, group in enumerate(passage['groups']):
                sub = group_to_sub(group)
                if k == 0:
                    sub['reading'] = {
                        'passage': passage['passage'], 'title': passage['title'],
                        'subtitle': passage.get('subtitle', ''), 'text': passage['text'],
                        'from': READING_PASSAGES[passage['passage']][0],
                        'to': READING_PASSAGES[passage['passage']][1],
                    }
                subs.append(sub)
        units.append({
            'unit': len(units) + 1,
            'title': f"Test {test['n']} — Reading",
            'skill': 'reading',
            'pdfExercisePage': test['reading']['passages'][0]['pdfPage'],
            'subExercises': subs,
        })

    out = {'id': book['id'], 'units': units}
    # Writing and Speaking have no key to mark against, so they are carried as
    # prompts the reader can open the PDF at rather than as answerable units.
    prompts = []
    for test in book['tests']:
        for task in test.get('writing', {}).get('tasks', []):
            prompts.append({'test': test['n'], 'skill': 'writing',
                            'part': task['task'], 'pdfPage': task['pdfPage'],
                            'prompt': task['prompt']})
        for part in test.get('speaking', {}).get('parts', []):
            prompts.append({'test': test['n'], 'skill': 'speaking',
                            'part': part['part'], 'pdfPage': part['pdfPage'],
                            'prompt': part['prompt']})
    if prompts:
        out['prompts'] = prompts
    return out


# --------------------------------------------------------------------------
# Cambridge IELTS 19
# --------------------------------------------------------------------------
# This PDF is Cambridge's own born-digital excerpt spliced onto a scan of the
# rest of the book: only the front matter and part of Test 1 carry a text
# layer, and every question page and answer key is an image.  Nothing can
# parse it.
#
# But the book ships as an answer sheet, and an answer sheet needs the key,
# not the questions — and the key, though a scan, is perfectly legible.  So it
# was read off pages 120-127 by eye into tools/ielts-19-key.json, and the
# questions stay where they already were: in the book, in the PDF pane.
#
# The result has one block per Listening part and per Reading passage, which
# is as fine-grained as the key itself goes.


# Where each section starts, as a 1-based PDF page.  Nothing in this file can
# be parsed, and the printed page numbers do not line up with the PDF's own —
# the excerpt pages spliced into the front shift everything after them by one —
# so these were found by looking at the pages.
C19_PAGES = {
    (1, 'listening'): 10, (1, 'reading'): 16,
    (2, 'listening'): 34, (2, 'reading'): 41,
    (3, 'listening'): 56, (3, 'reading'): 63,
    (4, 'listening'): 79, (4, 'reading'): 85,
}


def build_c19():
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           'ielts-19-key.json'), encoding='utf-8') as f:
        key = json.load(f)

    def blocks(test, skill, spans, label):
        subs = []
        for n, (lo, hi) in spans.items():
            answers = {}
            for printed, value in key[str(test)][skill].items():
                for number in (int(x) for x in printed.split('&')):
                    if lo <= number <= hi:
                        answers[number] = value
            sub = {'number': f'{lo}-{hi}', 'type': 'items',
                   'instructions': f'{label} {n}',
                   'items': [{'n': i, 'answer': answers[i]}
                             for i in sorted(answers)]}
            subs.append((n, sub))
        return subs

    units = []
    for test in (1, 2, 3, 4):
        subs = []
        for part, sub in blocks(test, 'listening', LISTENING_PARTS, 'Part'):
            files = audio_files('c19', test, part)
            if files:
                sub['audio'] = {'part': part, 'files': files,
                                'from': LISTENING_PARTS[part][0],
                                'to': LISTENING_PARTS[part][1]}
            subs.append(sub)
        units.append({'unit': len(units) + 1, 'title': f'Test {test} — Listening',
                      'skill': 'listening',
                      'pdfExercisePage': C19_PAGES[(test, 'listening')],
                      'subExercises': subs})

        subs = [sub for _, sub in
                blocks(test, 'reading', READING_PASSAGES, 'Reading Passage')]
        units.append({'unit': len(units) + 1, 'title': f'Test {test} — Reading',
                      'skill': 'reading',
                      'pdfExercisePage': C19_PAGES[(test, 'reading')],
                      'subExercises': subs})

    return {'id': 'ielts-19', 'units': units}


if __name__ == '__main__':
    books = [
        build_c20(),
        build_full_book('ielts-21', 'Cambridge IELTS 21 Academic', 'c21'),
        build_full_book('ielts-17', 'Cambridge IELTS 17 Academic', 'c17', latinise),
    ]
    index = []
    # Cambridge 19 is assembled from its key rather than parsed, so it skips
    # the extraction report and goes straight out.
    c19 = build_c19()
    books.append(c19)

    for data in books:
        if data is c19:
            units = data['units']
            answered = sum(len(s['items']) for u in units for s in u['subExercises'])
            path = os.path.join(OUT, 'ielts-19.json')
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
            index.append(index_json.entry('ielts-19', units))
            print(f"{'ielts-19':10s} {answered:3d}/320 answers from the transcribed key"
                  f"  {os.path.getsize(path) // 1024:3d} KB  shipped")
            continue
        found, answered = validate(data)
        # A book only reaches site/data once every question has an answer;
        # anything less would put wrong or blank answers in front of a reader.
        # Cambridge 17's scan is too degraded so far, so it parks in tools/.
        complete = answered == 320
        path = os.path.join(OUT if complete else os.path.dirname(__file__),
                            data['id'] + ('.json' if complete else '.wip.json'))
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(to_units(data) if complete else data, f,
                      ensure_ascii=False, separators=(',', ':'))
        size = os.path.getsize(path) // 1024
        state = 'shipped' if complete else 'INCOMPLETE — kept out of site/data'
        print(f"{data['id']:10s} {found:3d}/320 questions, {answered:3d} answered"
              f"  {size:3d} KB  {state}")
        if complete:
            index.append(index_json.entry(data['id'], to_units(data)['units']))
    index_json.update(index)
    print(f'index.json updated with {len(index)} book(s)')
