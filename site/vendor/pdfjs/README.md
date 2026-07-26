# pdf.js — vendored, not a dependency to install

`pdfjs-dist@4.10.38`, `legacy/build/` (the transpiled build — the default one
uses syntax older Safari cannot parse, and this app is meant to run on the
phone somebody already owns). Apache-2.0, see LICENSE.

Only two files are needed, and only these two are copied — renamed from
`.mjs` to `.js` on the way in. They are still ES modules and are still loaded
with `import()`; what the extension decides is the Content-Type a static host
sends, and a module served as `application/octet-stream` is refused by the
browser. `.js` is `text/javascript` everywhere, `.mjs` is not:

    pdf.min.js          the API          (upstream pdf.min.mjs)
    pdf.worker.min.js   the parser and renderer, on a worker thread

`cmaps/` (CJK encodings) and `standard_fonts/` (substitutes for the 14 base
PDF fonts) are deliberately NOT here: every book in `site/pdf/` embeds its own
subsetted Latin fonts, so both would be ~2.4 MB nobody ever downloads. If a
future book renders with the wrong typeface, copy `standard_fonts/` in and
point `StandardFontDataUrl` at it — that is the symptom it fixes.

To update: `npm pack pdfjs-dist@<version>`, unpack, copy the same two files
from `package/legacy/build/` under the names above, and re-read a book on a phone before shipping.
Nothing here is minified or built by us — these are the published artefacts.
