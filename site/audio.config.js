/* Where the listening audio lives.

   The data files store audio as site-relative paths ("audio/c20/t1p1.m4a"), and
   in a local checkout that is exactly right: the files sit in site/audio/.

   A deployed copy usually cannot do that. The audio is ~340 MB across three
   folders, so a build that leaves site/audio/ behind ships every path but none
   of the files, and all three Cambridge IELTS books lose the one thing they are
   for. Uploading the folder to object storage and pointing AUDIO_BASE at it
   fixes that without touching a single data file.

   Set it to the URL that site/audio/ was uploaded to, keeping the same folder
   layout underneath (c19/, c20/, c21/):

     window.AUDIO_BASE = 'https://pub-xxxx.r2.dev/agylshyn-audio/';

   Cloudflare R2, Backblaze B2 and S3 all work. Two requirements on the bucket:

     * public read access — the app sends no credentials;
     * HTTP range requests (Accept-Ranges: bytes), which every one of those
       services does by default. Without them an <audio> element can play a
       track but not seek inside it.

   CORS headers are NOT needed: <audio> loads cross-origin media without them,
   and the app never sets crossOrigin on the element.

   Empty means "next to the site", which is the right default for a local
   checkout and for anyone who does ship the audio folder. */
window.AUDIO_BASE = '';
