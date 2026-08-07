#!/usr/bin/env python3
"""Repairs applied to every book after it has been assembled, before it ships.

These fix damage that happened during extraction rather than anything the books
themselves get wrong, so they belong in one place rather than in each builder.

  regap_book()      restore the gap markers, and the words the older extractors
                    split in half, by realigning each question against the PDF
  fix_answer_words()  the same split-word damage in the answer keys
  drop_garbled()      text whose font map came out as control codes
  split_merged_keys() one key holding four questions' answers
  mark_long_answers() prose answers a matcher cannot judge -> self-check

Every one of them is conservative in the same way: a repair is only applied when
the repaired text is provably the same text (same letters, same order) as what
was there before. Nothing is guessed, so nothing can silently become wrong.
"""
import re
import unicodedata

GAP = '…'

# The older per-book extractors (enginuse/, vocab-preint/ and friends) joined the
# PDF's text lines with a plain space. In these books a printed answer gap is a
# ruled blank, not a row of dots — in the text layer it is a line break — so that
# join quietly deleted every gap: "He ....... a shoelace." arrived as "He a
# shoelace.", and a drill card became "the road." with the answer "They're
# crossing". The same join also cut words in half wherever the PDF broke a line
# mid-glyph-run ("cro ss", "le ft", "ne ws").
#
# Both are recoverable, because the PDF still has the line breaks the join threw
# away. Realigning the stored question against the page text puts the gaps back
# and takes the PDF's spelling of every word with them.


# NFKC because these PDFs set "ffi" and "fi" as single ligature glyphs: without
# it "office" and "oﬃce" are different strings and half the matches fail. It has
# to be applied to the page text ITSELF, not only to the comparison key — the key
# carries character offsets back into that text, and normalising one side only
# would shift every offset by however many ligatures came before it.
def _norm(s):
    return unicodedata.normalize('NFKC', s)


def _letters(s):
    """Comparison key: the characters that survive any spacing damage."""
    return re.sub(r'[^0-9a-z]', '', _norm(s).lower())


def _letter_map(text):
    """(key, positions) where positions[i] is where key[i] sits in `text`.

    `text` must already be NFKC-normalised, so the offsets stay valid."""
    key, pos = [], []
    for i, ch in enumerate(text):
        c = ch.lower()
        if c.isalnum() and c.isascii():
            key.append(c)
            pos.append(i)
    return ''.join(key), pos


# Where the gap actually is, is a question about the page's geometry rather than
# its text: these books print a blank as ruled white space, so on the page a gap
# is simply an unusually wide jump between two words. On a typical Grammar in Use
# exercise page the ordinary space between words measures about 5pt and a blank
# measures 70–140pt, so the two are not close to each other.
#
# The threshold is derived per page rather than fixed, because the books are set
# at different sizes: four times the page's own median word spacing, with a floor
# that keeps a widely-tracked heading ("cross  hide  scratch", ~21pt) from
# registering as a blank.
_GAP_FLOOR = 24.0
_GAP_FACTOR = 4.0


def _same_printed_line(prev, w):
    """Are these two words on the same line as the page prints it?

    MuPDF's own line numbering cannot be used for this: a blank wide enough to
    write an answer in ends its "line", so "2 He ....... a shoelace." arrives as
    two lines and the blank disappears into the break — which is exactly the
    thing being recovered here. Shared baseline and left-to-right order are what
    actually define a printed line."""
    if w[0] < prev[2] - 2:                  # runs backwards: a new line or column
        return False
    height = max(prev[3] - prev[1], w[3] - w[1], 1.0)
    return abs(w[1] - prev[1]) < height * 0.6


# The face these books set a worked answer in. Nothing else on the page uses it:
# Grammar in Use and Advanced Grammar print their examples in HandfontPND,
# Vocabulary in Use in CalibanStd, both of them handwriting faces chosen to look
# like something the reader filled in. A book whose PDF uses neither simply
# gains nothing from the pass that reads this — it never guesses from anything
# else on the page.
_ANSWER_FONT = re.compile(r'handfont|caliban', re.I)


def _hand_boxes(page):
    """Where the page prints an answer in its handwriting face."""
    boxes = []
    for block in page.get_text('dict')['blocks']:
        for line in block.get('lines', []):
            for span in line.get('spans', []):
                if span.get('text', '').strip() and _ANSWER_FONT.search(span.get('font') or ''):
                    boxes.append(span['bbox'])
    return boxes


def _in_boxes(w, boxes):
    """Is this word inside one of them? Compared on the word's centre, because
    a span's box is drawn to the glyphs and a word's to its cell, so the two
    overlap without either containing the other."""
    x, y = (w[0] + w[2]) / 2, (w[1] + w[3]) / 2
    return any(b[0] <= x <= b[2] and b[1] <= y <= b[3] for b in boxes)


def _page_string(page):
    """The page as text, with every printed blank written out as GAP.

    Returns (text, handwritten) where `handwritten` is the character ranges of
    `text` the book set in the answer face — see PageIndex.handwritten."""
    words = page.get_text('words')          # x0, y0, x1, y1, word, block, line, n
    if not words:
        return '', []

    spacings = []
    prev = None
    for w in words:
        if prev is not None and _same_printed_line(prev, w):
            d = w[0] - prev[2]
            if 0 < d < 40:                  # ignore blanks when sizing a space
                spacings.append(d)
        prev = w
    spacings.sort()
    median = spacings[len(spacings) // 2] if spacings else 5.0
    threshold = max(_GAP_FLOOR, _GAP_FACTOR * median)

    boxes = _hand_boxes(page)

    # Each word is normalised on its own. Normalising the finished string would
    # decompose the GAP marker itself — NFKC turns "…" into three full stops.
    out, hand, at, prev = [], [], 0, None
    for w in words:
        if prev is not None:
            if not _same_printed_line(prev, w):
                join = '\n'
            else:
                join = ' %s ' % GAP if (w[0] - prev[2]) > threshold else ' '
            out.append(join)
            at += len(join)
        text = _norm(w[4])
        out.append(text)
        if boxes and _in_boxes(w, boxes):
            hand.append((at, at + len(text)))
        at += len(text)
        prev = w
    return ''.join(out), hand


def _tidy(s):
    s = re.sub(r'[ \t\r\n]+', ' ', s).strip()
    s = re.sub(r'\s+([,.;:!?])', r'\1', s)
    s = re.sub(r'(%s)\s+([,.;:!?])' % GAP, r'\1\2', s)
    return s


class PageIndex:
    """One unit's pages, searchable by letters so damaged spacing still matches."""

    def __init__(self, doc, pages):
        chunks, hand, at = [], [], 0
        for p in pages:
            if 1 <= p <= doc.page_count:
                text, spans = _page_string(doc[p - 1])
                hand += [(a + at, b + at) for a, b in spans]
                chunks.append(text)
                at += len(text) + 1          # + the '\n' the join puts back
        self.text = '\n'.join(chunks)
        self.hand = hand
        self.key, self.pos = _letter_map(self.text)
        self.cursor = 0          # keeps the alignment moving forward, in reading order

    def locate(self, question):
        """Where the page prints `question`, as (start, end) offsets into
        self.text, or None when it is not there.

        Matching is on letters alone, so "cro ss" finds "cross" and the span
        that comes back covers the book's spelling with the book's blanks —
        which is the whole point. Because the comparison key is identical either
        way, a replacement can add spacing and punctuation but never a different
        word.
        """
        want = _letters(question)
        if not want:
            return None
        # A short question ("the road.") is only placed when the page holds
        # exactly one copy of it; a longer one is distinctive enough to trust the
        # first match at or after wherever the previous item ended.
        if len(want) < 8:
            first = self.key.find(want)
            if first < 0 or self.key.find(want, first + 1) >= 0:
                return None
            at = first
        else:
            at = self.key.find(want, self.cursor)
            if at < 0:               # a page's items are not always in order
                at = self.key.find(want)
                if at < 0:
                    return None
        end = at + len(want) - 1
        self.cursor = end + 1
        start_c, end_c = self.pos[at], self.pos[end] + 1

        # The match runs from the first letter to the last, so punctuation that
        # belongs to the sentence sits just outside it at both ends: the opening
        # bracket of "(I / look) for Sophie", the full stop that closes it. Take
        # what is touching, and at the tail allow the one stray space these
        # extractions leave before a full stop ("the day off .").
        head = re.search(r"[(\[“\"'‘]+$", self.text[max(0, start_c - 3):start_c])
        if head:
            start_c -= len(head.group(0))
        tail = re.match(r"""(?:\s?[.,;:!?)\]'’"”])*""", self.text[end_c:])
        if tail and tail.group(0):
            end_c += tail.end()
        return start_c, end_c

    def handwritten(self, span):
        """Does the book print an answer of its own inside this span?"""
        start, end = span
        return any(a < end and b > start for a, b in self.hand)

    def find(self, question):
        """The page's own rendering of `question`, or None when it is not there."""
        span = self.locate(question)
        if span is None:
            return None
        start_c, end_c = span
        fixed = _tidy(self.text[start_c:end_c])

        # A blank that opens the sentence ("…… the road.") falls before the
        # match, between the item's printed number and its first word.
        before = self.text[max(0, start_c - 24):start_c]
        # A standalone item number only. Allowing any punctuation here would
        # read the jump between two columns as a blank.
        if re.search(r'(?:^|[\s\n])\d{1,2}[.)]?\s*%s\s*$' % GAP, before):
            fixed = GAP + ' ' + fixed
        return fixed


# Geometry alone cannot always tell a blank from a layout space: a two-column
# dialogue ("A  Kate won't be late, will she?   B  No, she's never late.") has
# jumps as wide as any answer line. The answer key settles it — an item with one
# answer has one blank — so a reconstruction that produces more blanks than the
# key accounts for is not trusted, and ships as plain text rather than as a
# question with a blank in the wrong place.
def _expected_gaps(it):
    ans = it.get('answer')
    if it.get('isExample') or not isinstance(ans, str) or not ans.strip():
        return 0
    return 1 + len(re.findall(r'\s(?:%s|\.{3,})\s' % GAP, ans))


def _strip_gaps(s):
    return _tidy(re.sub(r'\s*%s\s*' % GAP, ' ', s))


def _settle_gaps(fixed, it):
    """Keep the reconstructed blanks only where the key agrees with them."""
    want = _expected_gaps(it)
    got = fixed.count(GAP)
    if want == 0 or got > want:
        return _strip_gaps(fixed)
    # A blank at the very end of a printed line has no word after it to measure
    # against, so it is the one kind geometry cannot see. An answered question
    # that stops without any closing punctuation is that case.
    if got == 0 and want and not re.search(r'[.?!:,]["”’\')\]]*$', fixed):
        return fixed + ' ' + GAP
    return fixed


def regap_book(units, doc, pages_of):
    """Realign every question in `units` against the book's own pages.

    `pages_of(unit)` returns the PDF pages that unit's exercises are printed on.
    Returns (questions_regapped, questions_respelled) for the build log.
    """
    gaps = words = 0
    for u in units:
        pages = pages_of(u)
        if not pages:
            continue
        index = PageIndex(doc, pages)
        for s in u.get('subExercises', []) or []:
            for field in ('instructions', 'note', 'passage'):
                cur = s.get(field)
                if not cur:
                    continue
                fixed = index.find(cur)
                # Instructions have no gaps to restore; they are realigned only
                # for the split words, so a marker here would be noise.
                if fixed and fixed.replace(GAP, '').split() != cur.split():
                    s[field] = re.sub(r'\s*%s\s*' % GAP, ' ', fixed).strip()
                    words += 1
            for it in s.get('items', []) or []:
                cur = it.get('question')
                if not cur:
                    continue
                fixed = index.find(cur)
                if not fixed:
                    continue
                fixed = _settle_gaps(fixed, it)
                # The invariant that makes all of this safe to run unattended:
                # the repaired question is the same letters in the same order as
                # the one it replaces. Spacing and punctuation may move; a word
                # may never change. Anything else is a bug, and is dropped.
                if _letters(fixed) != _letters(cur):
                    continue
                if fixed == cur:
                    continue
                if GAP in fixed and GAP not in cur:
                    gaps += 1
                if _strip_gaps(fixed).split() != _strip_gaps(cur).split():
                    words += 1
                it['question'] = fixed
    return gaps, words


# ---------------------------------------------------------------------------
# examples the extractors missed
# ---------------------------------------------------------------------------

# An exercise opens with a worked example, and the extractors were told to
# expect one. Ninety of them print two — Grammar in Use 1.4 answers both "I'm
# trying" and "It isn't raining" before the learner starts — and the second one
# arrived as an ordinary question: the book's answer sitting in the middle of
# its own prompt, nothing in the key to check against. The app could only offer
# it as a question to type and then self-check, with the answer printed in front
# of the learner, and it counted towards the unit's total.
#
# The page knows which rows are worked, because it sets those answers in a
# handwriting face (see _ANSWER_FONT). A row with no key of its own, whose text
# on the page carries that face, is an example.


def mark_printed_examples(units, doc, pages_of):
    """Mark the rows the book has already answered. Returns how many.

    Conservative in both directions: a row that has a key is never touched, and
    a row is only marked when its own text — located on the page, not guessed at
    from its neighbours — is what the handwriting sits inside.
    """
    marked = 0
    for u in units:
        pages = pages_of(u)
        if not pages:
            continue
        index = PageIndex(doc, pages)
        if not index.hand:
            continue
        for s in u.get('subExercises', []) or []:
            for it in s.get('items', []) or []:
                if not it.get('question'):
                    continue
                # Located for every item, not only the candidates: the cursor is
                # what keeps the alignment in reading order, and skipping a row
                # would let a later one match the wrong copy of its own words.
                span = index.locate(it['question'])
                if span is None or it.get('isExample'):
                    continue
                if (it.get('answer') or '').strip() or (it.get('blank') or '').strip():
                    continue
                if index.handwritten(span):
                    it['isExample'] = True
                    marked += 1
    return marked


# ---------------------------------------------------------------------------
# questions that never made it off the page
# ---------------------------------------------------------------------------

# Some rows shipped with no prompt at all, or with a scrap of one: Grammar in
# Use 2.5 item 2 is the page number, "5", where the book prints "I won't tell
# anybody what you said. …….", and 18.3 items 3-6 kept nothing but the word
# "but". The answer is in the key, so the row is a question the learner is asked
# and given nothing to answer.
#
# The rows that did survive bracket the ones that did not: on the page, item 2
# is printed between item 1 and item 3, and the printed item numbers inside that
# strip say where one row ends and the next begins. So the text is recoverable
# without guessing — it is read off the page, in the place the page keeps it.
#
# Rows that are pictures, and there are a few dozen of them, have no text there
# to find; they are left as they are and the app goes on pointing at the PDF.

_RECOVER_MAX = 300       # a printed item is not longer than this
_SCRAP_MAX = 20          # and a scrap of one is no longer than this


_WORD = re.compile(r'[A-Za-z]{3}')

# A blank, however the row spells it: the marker this module uses, and the two
# the extractors left behind ("hail ___", "strong.........").
_BLANK = re.compile(r'%s|_{2,}|\.{3,}' % GAP)

# Where the row below starts: a number on a line of its own. It is what ends a
# recovered piece, and it is also what keeps the page's furniture out of one —
# the "8 ➜ Additional exercise 9" that follows the last item of a unit is a line
# beginning with a number just as an item is.
_NEXT_ROW = re.compile(r'(?:^|\n)\s*\d{1,3}[.)]?(?:[ \t\n]|$)')


def _needs_question(it):
    """A row whose prompt is missing or is a scrap of one.

    The scraps are what the extractor swept up instead of the sentence, so the
    first test is not "short" but "not a sentence": no run of letters long
    enough to be a word ("5", "(4)", "1 … 2 13", ""). The second is a single
    short word left behind where a whole line should be ("but", "I") — short
    because Upper-intermediate arrived with the spaces missing from its
    questions, and every sentence in it is one long "word"."""
    q = (it.get('question') or '').strip()
    if it.get('isExample'):
        return False
    if not _WORD.search(q):
        return True
    return len(_strip_gaps(q).split()) <= 1 and len(q) <= _SCRAP_MAX


def _strip_number(text, n):
    """`text` from just after the printed item number `n`, or None."""
    m = re.search(r'(?:^|[\s\n])%d[.)]?[\s\n]' % n, text)
    return text[m.end():] if m else None


def _next_number(text, numbers):
    """Where another row of the same exercise starts inside `text`.

    A matching exercise prints both its columns on one line, so the row below
    does not always begin a line of its own — but it does begin with its own
    printed number, and a number the exercise uses as a row is not something a
    sentence in that exercise ends with."""
    for m in re.finditer(r'[\s\n](\d{1,2})[.)]?[\s\n]', text):
        if int(m.group(1)) in numbers:
            return m
    return None


def recover_questions(units, doc, pages_of):
    """Read back the missing prompts from the pages. Returns how many.

    A run of empty rows is only filled when every one of its numbers is printed
    in the strip its neighbours bracket, in order, and every piece that comes
    out reads as a sentence. Anything less and the whole run is left alone —
    half a recovery would put one row's text against another row's number.
    """
    filled = 0
    for u in units:
        pages = pages_of(u)
        if not pages:
            continue
        index = PageIndex(doc, pages)
        for s in u.get('subExercises', []) or []:
            if s.get('type') not in ('items', 'text'):
                continue
            items = s.get('items') or []
            if not any(_needs_question(it) for it in items):
                continue

            # Anchors first, in reading order, so the strips between them are
            # the page's own. A scrap is never an anchor: "but" would place
            # itself at the first "but" on the page and drag the strip with it.
            spans = []
            for it in items:
                # An example row is exempt from _needs_question, so it can reach
                # here with no question at all; there is nothing to locate.
                anchor = (it.get('question') and not _needs_question(it)
                          and isinstance(it.get('n'), int)
                          and index.locate(it['question']))
                spans.append(anchor or None)

            # A matching exercise prints its two halves as two columns of the
            # same lines, so the strip for "estranged ……." holds the right-hand
            # column of that line as well ("estranged ……. separation") — a word
            # belonging to another row. Two things give such an exercise away:
            # its key is a bare letter, and the rows that did survive stop at
            # the blank. Where either says so, the recovered rows stop there too.
            anchored = [items[k]['question'] for k, sp in enumerate(spans) if sp]
            ends_at_gap = [q for q in anchored if q.rstrip().endswith(GAP)]
            lettered = [it for it in items
                        if re.fullmatch(r'[a-l]', (it.get('answer') or '').strip() or 'x')]
            column = ((len(anchored) >= 2 and len(ends_at_gap) * 2 >= len(anchored))
                      or len(lettered) * 2 >= len(items))
            numbers = {it['n'] for it in items if isinstance(it.get('n'), int)}

            i = 0
            while i < len(items):
                if spans[i] or not isinstance(items[i].get('n'), int):
                    i += 1
                    continue
                run = i
                while run < len(items) and not spans[run]:
                    run += 1
                # Both ends are needed: without the one below, the strip runs to
                # the end of the page and swallows the next exercise.
                before = spans[i - 1][1] if i and spans[i - 1] else None
                after = spans[run][0] if run < len(items) else None
                if before is not None and after is not None and before < after:
                    filled += _fill_run(items[i:run], index.text[before:after],
                                        column, numbers)
                i = run + 1
    return filled


def _fill_run(run, strip, column, numbers):
    """Split one strip of page between the rows printed on it."""
    pieces = []
    for k, it in enumerate(run):
        rest = _strip_number(strip, it['n'])
        if rest is None:
            return 0
        # The row ends where the next printed row begins, whether or not that
        # row is one of the ones being filled, and whether it begins a line of
        # its own or opens the second column of this one.
        ends = [m.start() for m in (_NEXT_ROW.search(rest),
                                    _next_number(rest, numbers - {it['n']})) if m]
        piece = _tidy(rest[:min(ends)] if ends else rest)
        cut = piece.find(GAP, 1)
        if column and cut > 0:
            piece = _tidy(piece[:cut + len(GAP)])
        if not _WORD.search(piece) or len(piece) > _RECOVER_MAX:
            return 0
        piece = _settle_gaps(piece, it)
        # A scrap is only replaced by the line of page it came off: whatever was
        # there has to still be there afterwards, blanks included. A row that
        # already knows where its blank is keeps it — read back off a
        # two-column line, "……. Euro" picks up the blank of the column beside
        # it, and settling the blanks against the key then drops both.
        cur = it.get('question') or ''
        if _WORD.search(cur) and _letters(cur) not in _letters(piece):
            return 0
        if len(_BLANK.findall(cur)) > len(_BLANK.findall(piece)):
            return 0
        pieces.append(piece)
        strip = rest

    filled = 0
    for it, piece in zip(run, pieces):
        if piece != it.get('question'):
            it['question'] = piece
            filled += 1
    return filled


# ---------------------------------------------------------------------------
# split words in the answer keys
# ---------------------------------------------------------------------------

# The keys are printed on their own pages at the back, so the realignment above
# cannot reach them, and the damage is the same: "news" arrived as "ne ws",
# "make" as "mak e". A learner who types the right word is told they are wrong,
# which is the worst failure this app has.
#
# The repair needs to know which strings are words. Rather than depend on a
# system dictionary — which would make the build's output differ by machine —
# the vocabulary is read out of the book's own PDF: every word the book prints
# is a word, and a fragment the book never prints on its own is not.

_STUB = 3        # one side of a real split is nearly always this short or shorter

# The ligature clusters these books set as a single glyph. When the extractor
# breaks after one, the left fragment ends here: "offi ce", "traffi c", "aff
# ect", "benefi t", "fift y". Such a fragment turns up in the book's own
# vocabulary — the page is full of them — so it cannot be used as evidence that
# the fragment is a word. That is the one case where the vocabulary lies, and
# the only reason for this exception.
_LIGATURE_TAIL = re.compile(r'(?:ffi|ffl|ff|fi|fl|ft)$', re.I)


def book_vocabulary(doc, max_pages=None):
    words = set()
    pages = range(doc.page_count if max_pages is None else min(max_pages, doc.page_count))
    for i in pages:
        # NFKC first: an "ffi" ligature glyph is not in [A-Za-z], so without it
        # "o<ffi>ce" tokenises as "o" and "ce" and the book never appears to
        # contain the word "office" — which is exactly the word being repaired.
        for w in re.findall(r"[A-Za-z']{1,}", _norm(doc[i].get_text())):
            w = w.strip("'").lower()
            if w:
                words.add(w)
    return words


# A token as (leading punctuation, letters, trailing punctuation).
_TOKEN = re.compile(r'^([^A-Za-z]*)([A-Za-z]+)([^A-Za-z]*)$')


def _split_token(tok):
    m = _TOKEN.match(tok or '')
    return m.groups() if m else None


def _should_join(a, b, vocab):
    """Are these two tokens one word the extractor cut in half?"""
    # One side has to be a stub. Two full-length words beside each other are a
    # phrase, however well they would read joined up.
    if len(a) > _STUB and len(b) > _STUB:
        return False
    if (a + b).lower() not in vocab:
        return False
    # The decisive test: a left part that is itself a word the book prints is a
    # word, not half of one. "in form" and "no one" stop here; "Ther e" does
    # not, because the book never prints "Ther". A fragment ending in a ligature
    # is exempt, for the reason given at _LIGATURE_TAIL — and it is still only
    # joined when the result is a word the book prints, which is what keeps
    # "the cliff is" and "a gift for" out.
    if a.lower() in vocab and not _LIGATURE_TAIL.search(a):
        return False
    # A right part long enough to be a word of its own needs the same doubt; a
    # one- or two-letter tail ("e", "ce", "ws") does not. After a ligature the
    # vocabulary is no evidence either way, for the same reason as above: "ect"
    # and "cer" are in it only because "aff ect" and "offi cer" are on the page.
    if len(b) >= _STUB and b.lower() in vocab and not _LIGATURE_TAIL.search(a):
        return False
    return True


def fix_split_words(text, vocab):
    """Rejoin "ne ws" -> "news", leaving "no one" and "in form" alone.

    Walks the tokens rather than running a regex over the string: a pattern
    matching two words at a time consumes the pair it rejects, so in "the offi
    ce" it would test "the offi", decline, and resume past "offi" — never
    looking at the one pair that needed joining."""
    if not text or ' ' not in text:
        return text
    parts = re.split(r'(\s+)', text)          # word, gap, word, gap, ...
    out, i = [], 0
    while i + 2 < len(parts):
        left, right = _split_token(parts[i]), _split_token(parts[i + 2])
        # Nothing may stand between the halves: a full stop after the first, or
        # an opening quote before the second, means these are two words. Without
        # this "from the offi ce." never joins, because "ce." is not a bare word.
        if (parts[i + 1] == ' ' and left and right and not left[2] and not right[0]
                and _should_join(left[1], right[1], vocab)):
            parts[i + 2] = left[0] + left[1] + right[1] + right[2]
            i += 2                                  # allow a three-way split
            continue
        out.append(parts[i])
        i += 1
    return ''.join(out + parts[i:])


def fix_answer_words(units, vocab):
    """Rejoin split words everywhere text is shown. Returns how many changed.

    Questions go through here too, even though they have just been realigned
    against the page: the PDF sets "ffi" and "ft" as single ligature glyphs and
    puts a space after them, so "offi ce" and "fift y" are how the page itself
    reads. The realignment faithfully reproduces that; this undoes it."""
    n = 0
    for u in units:
        for s in u.get('subExercises', []) or []:
            for field in ('rawAnswer', 'instructions', 'note', 'passage'):
                if s.get(field):
                    fixed = fix_split_words(s[field], vocab)
                    if fixed != s[field]:
                        s[field] = fixed
                        n += 1
            for it in s.get('items', []) or []:
                for field in ('answer', 'blank', 'question'):
                    if it.get(field):
                        fixed = fix_split_words(it[field], vocab)
                        if fixed != it[field]:
                            it[field] = fixed
                            n += 1
    return n


# ---------------------------------------------------------------------------
# garbled text
# ---------------------------------------------------------------------------

# A few pages carry a broken font ToUnicode map, so their text extracts as glyph
# indexes rather than letters: ",W\x03ZDV\x03LQ" for "It was in". The old test
# looked for three shifted forms of common words, which missed every string that
# was only half-damaged — 27 of them were still shipping, inside Advanced Grammar
# units 1, 4, 8, 15, 42, 49, 60 and Collocations 44.
#
# The reliable signal is simpler: real book text never contains a C0 control
# character, and every one of these strings does (\x03 stands for the space).
_CONTROL = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f]')
_SHIFT_WORDS = re.compile(
    r'\b(WKH|DQG|ZDV|WKDW|RXW|LQJ|YRX|WLPH|KDYH|ZLOO|WKLV|IURP|EHHQ|QRW|DUH|IRU|WKHLU)\b')


def is_garbled(s):
    return bool(s) and (bool(_CONTROL.search(s)) or len(_SHIFT_WORDS.findall(s)) >= 3)


def drop_garbled(units):
    """Remove unreadable text rather than print it.

    A garbled question becomes no question, which the app already renders as
    "read it in the PDF" — honest, and the page reference is right there. A
    garbled answer becomes a self-check row, so a broken key can never mark a
    right answer wrong."""
    dropped = 0
    for u in units:
        for s in u.get('subExercises', []) or []:
            for field in ('instructions', 'passage', 'note'):
                if is_garbled(s.get(field)):
                    s[field] = None
                    dropped += 1
            for it in s.get('items', []) or []:
                if is_garbled(it.get('question')):
                    it['question'] = None
                    dropped += 1
                if is_garbled(it.get('answer')):
                    it['answer'] = it['blank'] = None
                    it['selfCheck'] = True
                    it['selfWhy'] = 'key'
                    dropped += 1
    return dropped


# ---------------------------------------------------------------------------
# merged answer keys
# ---------------------------------------------------------------------------

# The key pages print a whole exercise on one line — "2 Harry 3 Tatyana 4 Andrey"
# — and where the parser failed to split it, one item ended up holding four
# items' answers while the next three held none. Those questions could not be
# answered at all.
#
# The run has to be strictly consecutive and has to start at this item's own
# number plus one, which is what keeps "to meet at 8 o'clock" out of it.

# A run of numbers embedded in one field: "Harry 3 Tatyana 4 Andrey 5 Alice".
_EMBEDDED_N = re.compile(r'(?:^|\s)(\d{1,2})[.)]?\s+(?=\S)')


def _fragments(text, own_n):
    """Split a field that swallowed the items after it, or None if it did not.

    Numbers must climb, and must be higher than the field\u2019s own item number;
    the caller decides whether the result is believable."""
    if not isinstance(text, str) or not text.strip():
        return None
    cuts = []
    for m in _EMBEDDED_N.finditer(text):
        num = int(m.group(1))
        if num <= own_n or (cuts and num <= cuts[-1][0]):
            continue
        cuts.append((num, m.start(), m.end()))
    if not cuts:
        return None
    out = [(own_n, text[:cuts[0][1]].strip())]
    for i, (num, _, after) in enumerate(cuts):
        stop = cuts[i + 1][1] if i + 1 < len(cuts) else len(text)
        out.append((num, text[after:stop].strip()))
    return out


def split_merged_keys(units):
    """Give back the questions and answers that landed inside a neighbour\u2019s row.

    Some exercises are printed in two columns, and the extractor read them column
    by column: item 1 ended up holding the text of questions 1, 3 and 5, item 2
    holding 2, 4 and 6, and the key line "1 Sophie 2 Harry 3 Tatyana ..." split
    only at its first number. What shipped was two impossible rows where the book
    has six ordinary ones.

    Rebuilding is only attempted when the pieces account for a complete run
    1..N with nothing overwritten — a field that merely contains a number ("to
    meet at 8 o\u2019clock") cannot produce that, so it is left alone. Returns the
    number of items recovered."""
    recovered = 0
    for u in units:
        for s in u.get('subExercises', []) or []:
            if s.get('type') not in ('items', 'text'):
                continue
            items = s.get('items') or []
            if not items or any(not isinstance(it.get('n'), int) for it in items):
                continue

            pieces = {}          # n -> {'question': str, 'answer': str}
            split_any = False
            for it in items:
                for field in ('question', 'answer'):
                    parts = _fragments(it.get(field), it['n'])
                    if parts is None:
                        parts = [(it['n'], it.get(field))]
                    elif len(parts) > 1:
                        split_any = True
                    for num, text in parts:
                        slot = pieces.setdefault(num, {})
                        if text and slot.get(field):
                            slot = None          # two sources for one cell
                            break
                        if text:
                            slot[field] = text
                    if slot is None:
                        break
                if slot is None:
                    break
            if slot is None or not split_any:
                continue

            numbers = sorted(pieces)
            # The run has to be the whole exercise, 1..N, and has to be bigger
            # than what is there now — otherwise this is not a merge at all.
            if numbers != list(range(1, len(numbers) + 1)) or len(numbers) <= len(items):
                continue
            if any(not (pieces[n].get('question') or pieces[n].get('answer')) for n in numbers):
                continue
            # No row may come out of this poorer than it went in. Without this a
            # question that merely opens with a number ("2 When I mentioned to
            # Nokes ...") hands its whole text to a new row and leaves the
            # original one blank — a split that loses more than it recovers.
            if any((it.get(f) or '').strip() and not (pieces[it['n']].get(f) or '').strip()
                   for it in items for f in ('question', 'answer')):
                continue

            by_n = {it['n']: it for it in items}
            rebuilt = []
            for n in numbers:
                it = by_n.get(n) or {'n': n, 'isExample': False}
                it['question'] = pieces[n].get('question')
                it['answer'] = pieces[n].get('answer')
                it['blank'] = None
                rebuilt.append(it)
                if n not in by_n:
                    recovered += 1
            s['items'] = rebuilt
    return recovered


# ---------------------------------------------------------------------------
# prose answers
# ---------------------------------------------------------------------------

# Roughly one auto-checked answer in ten is a whole sentence — a rewrite, a
# suggested wording, an explanation. No string comparison can judge those: a
# learner who writes a perfectly good paraphrase is marked wrong, which then
# drags the question into the Mistakes list and the review queue. The app
# already has the right mode for this; these answers just were not in it.
#
# Self-check still shows the book's wording after the learner has committed, so
# nothing is lost — the verdict simply moves to the person who can actually make
# it.

LONG_ANSWER = 60


def mark_long_answers(units, limit=LONG_ANSWER):
    """Turn prose answers into self-check rows. Returns how many moved."""
    n = 0
    for u in units:
        for s in u.get('subExercises', []) or []:
            for it in s.get('items', []) or []:
                if it.get('isExample') or it.get('selfCheck'):
                    continue
                ans = it.get('answer')
                if not isinstance(ans, str) or len(ans) <= limit:
                    continue
                # A long answer that is really a short list of alternatives
                # ("comes out / is published / appears / …") is still checkable:
                # every branch is short, so the matcher can hit one of them.
                branches = [b.strip() for b in re.split(r'\s*/\s*', ans) if b.strip()]
                if branches and max(len(b) for b in branches) <= limit:
                    continue
                it['selfCheck'] = True
                it['selfWhy'] = 'long'
                n += 1
    return n
