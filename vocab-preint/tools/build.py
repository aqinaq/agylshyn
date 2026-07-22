"""Merge the re-extracted exercises with the book's answer key -> exercises.json

Questions come from the exercise pages (tools/ex_raw.json), answers come from
the Answer key at the back of the book (tools/key.json). The key is
authoritative: it is printed as a clean numbered list, so where the two
disagree about item numbering the key wins.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract_ex import page_lines


def unit_title(intro_page):
    """The unit title is the one large heading at the top of its first page."""
    top = [l for l in page_lines(intro_page - 1)
           if l['y'] < 70 and 25 < l['size'] < 40 and not l['text'].isdigit()]
    top.sort(key=lambda l: (-l['size'], l['y']))
    return top[0]['text'] if top else None

OVER_RE = re.compile(r'\bOver to you\b', re.I)
CROSS_RE = re.compile(r'\bcrossword\b', re.I)
OWN_RE = re.compile(r'^(Your own answers?|Possible answers?)', re.I)


def norm(s):
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())


def main():
    ex = json.load(open('tools/ex_raw.json', encoding='utf-8'))
    keyf = json.load(open('tools/key.json', encoding='utf-8'))
    key, kraw = keyf['items'], keyf['raw']
    # the pristine copy, so re-running the build stays reproducible
    old = {u['unit']: u for u in
           json.load(open('tools/exercises.orig.json', encoding='utf-8'))['units']}

    units, report = [], []
    for u in ex:
        subs_out = []
        pages = [s['page'] for s in u['subs']] or [old.get(u['unit'], {}).get('pdfExercisePage', 0)]
        for s in u['subs']:
            num = s['number']
            kitems = key.get(num, {})
            kr = kraw.get(num, '')
            instr = s['instructions'].strip()

            # ---- drop stray page numbers / empty trailing rows ----
            items = [it for it in s['items']
                     if it['question'].strip() or str(it['n']) in kitems]

            # A "complete the text" exercise is one flowing passage with the gap
            # numbers printed inline, so far fewer item rows are recoverable
            # than the key has answers. Show the passage whole instead of
            # chopping it into bogus questions.
            body = s['raw'].strip()
            if instr and body.startswith(instr):
                body = body[len(instr):].strip()
            real = [i for i in items if not i['hand']]
            sparse = len(kitems) >= 3 and len(real) < len(kitems) * 0.7
            if (sparse and s.get('instrBold') and s.get('bodyBold')
                    and (not instr or len(s['bodyBold']) > len(body))):
                # the passage ran into the instruction line; split on the bold run
                instr = s['instrBold'] or instr
                body = s['bodyBold']
            passage_like = sparse and len(body) > 150

            # ---- classify ----
            # "Over to you" is decided before the passage test: its sample
            # answers are long sentences, which otherwise look like a passage.
            if CROSS_RE.search(instr):
                typ = 'crossword'
            elif OVER_RE.search(instr):
                typ = 'items' if kitems else ('open' if items else 'freeform')
            elif passage_like:
                typ = 'text'
            elif not items:
                typ = 'freeform'
            else:
                typ = 'items'

            sub = {'number': num, 'type': typ, 'instructions': instr}
            if s.get('options'):
                sub['options'] = s['options']

            if typ == 'crossword':
                sub['stub'] = True
                sub['note'] = 'Кроссворд торы — PDF-тен шеш.'
                sub['items'] = []
                if kr:
                    sub['rawAnswer'] = kr
            elif typ == 'freeform':
                sub['instructions'] = instr or s.get('instrBold', '')
                sub['rawQuestion'] = s['raw'].strip()
                sub['rawAnswer'] = kr
            elif typ == 'text':
                sub['passage'] = body
                sub['items'] = [{'n': int(n), 'question': None, 'answer': kitems[n]}
                                for n in sorted(kitems, key=int)]
            else:
                # The key starts at 2 exactly when item 1 is the book's worked
                # example, so a missing "1" identifies examples the handwriting
                # font did not catch (some are printed as a circled choice).
                ex1 = bool(kitems) and '1' not in kitems

                out_items = []
                for it in items:
                    n = str(it['n'])
                    ans = kitems.get(n)
                    q = it['question'].strip()
                    row = {'n': it['n'], 'question': q or None, 'answer': ans}
                    if it['hand'] or (ex1 and it['n'] == 1):
                        row['isExample'] = True
                        row['answer'] = None
                    if ans and OWN_RE.match(ans):
                        row['answer'] = re.sub(OWN_RE, '', ans).strip(' :') or None
                        row['exampleAnswers'] = True
                    out_items.append(row)

                # answers the key has but no question was extracted for
                missed = sorted(set(kitems) - {str(i['n']) for i in out_items}, key=int)
                for n in missed:
                    out_items.append({'n': int(n), 'question': None, 'answer': kitems[n]})
                out_items.sort(key=lambda r: r['n'])
                sub['items'] = out_items

                # "Over to you" answers in the key are one person's sample
                # answers, never a right/wrong key — the learner marks these.
                if OWN_RE.match(kr or '') or OVER_RE.search(instr):
                    for r in out_items:
                        if r.get('answer'):
                            r['exampleAnswers'] = True

                if missed:
                    report.append('%s: %d answer(s) with no question text: %s'
                                  % (num, len(missed), ','.join(missed)))
                nofeed = [r for r in out_items
                          if r['answer'] is None and not r.get('isExample')]
                if typ == 'items' and len(nofeed) > 2:
                    report.append('%s: %d item(s) without an answer key' % (num, len(nofeed)))

            subs_out.append(sub)

        o = old.get(u['unit'], {})
        pp = sorted(set(pages))
        # A normal unit puts its explanation on the page before the exercises.
        # The four-page "Study units" interleave both, so their exercises span
        # more than one page and the explanation shares those pages.
        intro = (pp[0] - 1) if len(pp) == 1 else pp[0]
        units.append({
            'unit': u['unit'],
            'title': unit_title(intro) or u['title'],
            'pdfExercisePage': pp[0] if pp else o.get('pdfExercisePage'),
            'pdfPages': pp,
            'pdfIntroPage': intro if pp else o.get('pdfIntroPage'),
            'subExercises': subs_out,
        })

    out = {'book': 'English Vocabulary in Use Pre-Intermediate, 4th Edition (Cambridge)',
           'units': units}
    json.dump(out, open('exercises.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

    n_items = sum(len(s.get('items', [])) for u in units for s in u['subExercises'])
    n_ans = sum(1 for u in units for s in u['subExercises']
                for i in s.get('items', []) if i.get('answer'))
    types = {}
    for u in units:
        for s in u['subExercises']:
            types[s['type']] = types.get(s['type'], 0) + 1
    print('units %d | subs %d | items %d | with answer %d' % (
        len(units), sum(len(u['subExercises']) for u in units), n_items, n_ans))
    print('types:', types)
    open('tools/report.txt', 'w', encoding='utf-8').write('\n'.join(report))
    print('review notes: %d  (tools/report.txt)' % len(report))


if __name__ == '__main__':
    main()
