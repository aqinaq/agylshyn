#!/usr/bin/env python3
"""Turn the two Collins 'for IELTS' skill books into the site's unit schema.

These are not test collections like the Cambridge books — they are skill
courses.  Each of the twelve units has three parts (Vocabulary, Practice
exercises, Exam practice), each part a handful of numbered exercises, and a
single answer key at the back covers all of them.

The PDF has a real text layer, but it was OCR'd: letters and digits get
confused ("P arti" for "Part 1", "A f, c, b" for "4 f, c, b", "Sg" for "5g"),
and many "answers" are prose — definitions, suggested answers, explanations —
that cannot be marked automatically.

So each exercise is emitted one of two ways:

  * a clean run of numbered short answers (a letter, TRUE/FALSE, a single
    word) becomes an auto-checked `items` exercise;
  * anything else — prose, multi-word answers, an OCR-tangled run — becomes a
    `freeform` block whose answer key the learner reveals and checks by eye,
    where an OCR slip is visible rather than silently marking them wrong.

The questions themselves stay in the book: like the Cambridge books, these
ship as answer sheets with the PDF pane open.

Run:  python3 site/tools/build_collins.py
"""
import json
import os
import re

import fitz

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'site', 'data')

# The printed page numbers from each book's contents page.  The PDF's own page
# index runs one behind the printed number, so the offset is applied once.
PDF_OFFSET = -1

READING_UNITS = [
    (1, 'Family matters', 8), (2, 'Healthcare', 16), (3, 'Getting an education', 24),
    (4, 'Water', 34), (5, 'Non-verbal clues', 42), (6, 'Scientists at work', 50),
    (7, 'The job market', 60), (8, 'Twenty-somethings', 68), (9, 'Community spirit', 78),
    (10, 'On the move', 86), (11, 'Cultural differences', 94), (12, 'Practice test', 102),
]
READING_KEY_PAGES = (113, 144)

LISTENING_UNITS = [
    (1, 'On the move', 8), (2, 'Being young', 16), (3, 'Climate', 24),
    (4, 'Family structures', 32), (5, 'Starting university', 40), (6, 'Fame', 48),
    (7, 'Alternative energy', 56), (8, 'Migration', 64), (9, 'At the gym', 72),
    (10, 'At the office', 80), (11, 'Local languages', 88), (12, 'Practice test', 96),
]
LISTENING_KEY_PAGES = (133, 145)

# Which CD and track range each Listening unit's recordings occupy, read off
# the "CD1 / 01" cues printed beside each exercise.  Units 1-6 are on CD1,
# 7-12 on CD2; the ranges are contiguous, so the few instruction tracks the
# book does not cue by number still play in order.
LISTENING_AUDIO = {
    1: ('cd1', 1, 7), 2: ('cd1', 8, 14), 3: ('cd1', 15, 20), 4: ('cd1', 21, 26),
    5: ('cd1', 27, 34), 6: ('cd1', 35, 39),
    7: ('cd2', 1, 8), 8: ('cd2', 9, 10), 9: ('cd2', 11, 20), 10: ('cd2', 21, 25),
    11: ('cd2', 26, 32), 12: ('cd2', 33, 39),
}


def listening_audio():
    """Unit -> {tracks:[{label, file}]}.

    Each track is its own player, labelled the way the book cues it ("CD1 · 03")
    so the learner can pick the one printed beside the exercise they are on,
    rather than one player chaining unrelated recordings together."""
    audio = {}
    for unit, (cd, lo, hi) in LISTENING_AUDIO.items():
        tracks = [{'label': f'{cd.upper()} · {t:02d}',
                   'file': f'audio/collins-listening/{cd}-{t:02d}.mp3'}
                  for t in range(lo, hi + 1)]
        audio[unit] = {'tracks': tracks}
    return audio


def read_key(pdf, first, last):
    """The answer-key section as one string, lightly de-OCR'd."""
    doc = fitz.open(pdf)
    out = []
    for i in range(first, min(last, len(doc))):
        out.append(doc[i].get_text())
    doc.close()
    text = '\n'.join(out)
    # Headers the OCR reliably mangles.
    text = re.sub(r'\bP\s*arti\b', 'Part 1', text)
    text = re.sub(r'\bPart i\b', 'Part 1', text)
    return text


PART = re.compile(r'^\s*Part\s*([123])\s*:?\s*$', re.I)
EXERCISE = re.compile(r'^\s*Exercise\s+([0-9A-Z]+)\s*$', re.I)
SECTION = re.compile(r'^\s*(Vocabulary|Practice exercises|Exam practice)\s*$', re.I)
# Junk lines: the running footer and the page-header unit number.
JUNK = re.compile(r'^\s*(Reading|Listening) for IELTS\s*$|^\s*(unit|Unit)\s+[0-9A-Za-z]{1,3}\s*$'
                  r'|^\s*Answer key\s*$|^\s*\d{1,2}\s*$')

CLEAN_ANSWER = re.compile(
    r'^(?:[a-jA-J]|[a-jA-J]/[a-jA-J]|TRUE|FALSE|NOT GIVEN|YES|NO|'
    r'\d[\d.,]*|[a-z][a-z-]{1,14})$')


def split_units(text):
    """Cut the key into unit chunks at each 'Vocabulary' heading.

    The unit-number lines the OCR should give here come out as garbage
    ("uim 3", "u m i o", "Ul l l l"), and the "Part 1" heading only survives
    two-thirds of the time.  The section name that opens every unit's key —
    "Vocabulary" — survives far more reliably, so a new Vocabulary heading
    starts a unit.  If one is mangled, that unit's key folds into the previous
    one rather than derailing the whole split."""
    lines = text.split('\n')
    units, current = [], None
    for line in lines:
        if re.match(r'^\s*Vocabulary\s*$', line, re.I):
            current = []
            units.append(current)
        if current is not None:
            current.append(line)
    return units


def parse_items(body):
    """Pull numbered short answers out of an exercise body.

    Returns a list of {n, answer} when the body is a clean run — item numbers
    ascending from 1, each answer a single clean token — and None otherwise, so
    the caller can fall back to showing the raw key.  The item number itself is
    trusted from the ascending sequence, which repairs the OCR digit confusion
    (a '4' read as 'A' still lands in slot 4)."""
    # Join wrapped lines, then split on leading item markers.
    joined = ' '.join(l.strip() for l in body if l.strip())
    parts = re.split(r'(?:^|\s)(\d{1,2}|[A-Z])\s+(?=[A-Za-z0-9])', ' ' + joined)
    # parts = ['', num, text, num, text, ...]
    if len(parts) < 5:
        return None
    items, expect = [], 1
    it = iter(parts[1:])
    for marker, chunk in zip(it, it):
        answer = chunk.strip().rstrip('.,;').strip()
        # Trust the running count for the number; the marker only has to exist.
        if not CLEAN_ANSWER.match(answer):
            return None
        items.append({'n': expect, 'answer': answer})
        expect += 1
    if len(items) < 2:
        return None
    return items


def clean_prose(body):
    """Collapse an exercise's raw key to readable reveal text."""
    text = ' '.join(l.strip() for l in body if l.strip())
    return re.sub(r'\s+', ' ', text).strip()


def parse_key(text):
    """{unit_number: [subExercise, ...]} for the whole book."""
    result = {}
    for idx, unit_lines in enumerate(split_units(text), start=1):
        subs = []
        section = ''
        ex_label = None
        ex_body = []

        def flush():
            if ex_label is None:
                return
            body = [l for l in ex_body if not JUNK.match(l)]
            items = parse_items(body)
            # The section already leads the number ("Vocabulary · Exercise 2"),
            # so it is not repeated as an instruction line.
            number = f'{section} · Exercise {ex_label}' if section else f'Exercise {ex_label}'
            if items:
                subs.append({'number': number, 'type': 'items', 'items': items})
            else:
                prose = clean_prose(body)
                if prose:
                    subs.append({'number': number, 'type': 'freeform', 'rawAnswer': prose})

        for line in unit_lines:
            if SECTION.match(line):
                flush()
                ex_label, ex_body = None, []
                section = SECTION.match(line).group(1)
                continue
            if PART.match(line):
                continue
            m = EXERCISE.match(line)
            if m:
                flush()
                ex_label, ex_body = m.group(1), []
                continue
            if ex_label is not None:
                ex_body.append(line)
        flush()
        result[idx] = subs
    return result


def build(book_id, title, pdf, units_meta, key_pages, audio=None):
    key = parse_key(read_key(pdf, *key_pages))
    units = []
    for n, unit_title, printed in units_meta:
        subs = key.get(n, [])
        unit = {
            'unit': n,
            'title': unit_title,
            'pdfExercisePage': printed + PDF_OFFSET,
            'subExercises': subs,
        }
        if audio and n in audio:
            unit['audio'] = audio[n]
        # The final "Practice test" unit has no teaching exercises and its key
        # did not survive OCR, so it drops out rather than showing empty.
        if subs:
            units.append(unit)
    return {'id': book_id, 'title': title, 'units': units}


def report(data):
    auto = reveal = 0
    for u in data['units']:
        for s in u['subExercises']:
            if s['type'] == 'items':
                auto += len(s['items'])
            else:
                reveal += 1
    print(f"{data['id']:18s} {len(data['units'])} units  "
          f"{auto:4d} auto-checked answers  {reveal:3d} reveal blocks")


if __name__ == '__main__':
    books = [
        build('collins-reading', 'Collins Reading for IELTS',
              os.path.join(ROOT, 'site', 'pdf', 'collins-reading.pdf'),
              READING_UNITS, READING_KEY_PAGES),
        build('collins-listening', 'Collins Listening for IELTS',
              os.path.join(ROOT, 'site', 'pdf', 'collins-listening.pdf'),
              LISTENING_UNITS, LISTENING_KEY_PAGES, audio=listening_audio()),
    ]
    for data in books:
        path = os.path.join(OUT, data['id'] + '.json')
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        report(data)
