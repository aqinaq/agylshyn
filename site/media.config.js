/* Where the big files live.

   Two folders make up almost the whole size of this project: site/audio/
   (~340 MB of Listening tracks) and site/pdf/ (~209 MB of coursebooks). Both
   used to be committed and served straight off GitHub Pages, which worked and
   cost 700 MB of git history — permanently, to every clone, forever, for files
   that never change and that git can only store whole.

   They live in object storage now. Nothing in the data files changed: they
   still say "audio/c20/t1p1.m4a" and "pdf/ielts-21.pdf", and the two bases
   below are prefixed in the one place each kind of path becomes a URL
   (audioUrl() and pdfUrl(), both in app.js).

   Empty means "next to the site" — which is exactly right for a local checkout
   that still has the folders, and for anyone who forks this and does ship them.

   ---- what the bucket has to do ----

   AUDIO_BASE needs two things:
     * public read — the app sends no credentials;
     * HTTP range requests (Accept-Ranges: bytes). Without them an <audio>
       element can play a track but not seek inside it.
   CORS is NOT needed for audio: <audio> loads cross-origin media without it,
   and the app never sets crossOrigin on the element.

   PDF_BASE needs both of those AND CORS, because a PDF is not loaded by a tag
   that the browser trusts — pdf.js fetches it, reads the bytes and draws the
   pages itself, and the service worker stores the response so a book opened
   once opens again offline. Both of those are cross-origin reads. Without
   `Access-Control-Allow-Origin` the phone viewer renders nothing and offline
   reading is silently lost, with no error a reader would understand.

   The header set the bucket needs, for the deployed origin:

     Access-Control-Allow-Origin: https://aqinaq.github.io
     Access-Control-Allow-Methods: GET, HEAD
     Access-Control-Allow-Headers: range, content-type
     Access-Control-Expose-Headers: content-range, content-length, accept-ranges

   Expose-Headers matters as much as the first line: a ranged response whose
   content-range the page is not allowed to read is a response pdf.js cannot
   use, and it falls back to pulling all 44 MB of Cambridge 21 for one page.

   ---- putting the files there ----

     python3 site/tools/upload_media.py            # push both folders
     python3 site/tools/upload_media.py --check    # every referenced file is up

   Cloudflare R2, Backblaze B2 and S3 all work; the tool speaks the S3 API that
   all three answer. Keep the folder layout underneath the base exactly as it is
   here (audio/c19/, audio/c20/, audio/c21/, pdf/*.pdf), because the data files
   name those paths and nothing rewrites them. */
window.AUDIO_BASE = '';
window.PDF_BASE = '';
