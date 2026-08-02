/* Static server for site/, used by the browser tests.

   Not interchangeable with `python3 -m http.server`: pdf.js only asks for a
   byte range if the FIRST, un-ranged response already advertised
   `Accept-Ranges: bytes`, and python's server sends neither that header nor a
   206. A test run against it would silently exercise the whole-file path and
   pass while the real thing pulled 44 MB per page. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.woff2': 'font/woff2'
};

function start(port) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, path.normalize(p));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404).end('not found'); return; }
      const base = {
        'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
        'accept-ranges': 'bytes',
        // The tests check what the app does with a fresh build, never what the
        // browser kept from the last one.
        'cache-control': 'no-cache'
      };
      const range = req.headers.range;
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
        const start = m[1] ? parseInt(m[1], 10) : 0;
        const end = m[2] ? parseInt(m[2], 10) : st.size - 1;
        res.writeHead(206, Object.assign({}, base, {
          'content-range': 'bytes ' + start + '-' + end + '/' + st.size,
          'content-length': end - start + 1
        }));
        fs.createReadStream(file, { start, end }).pipe(res);
      } else {
        res.writeHead(200, Object.assign({}, base, { 'content-length': st.size }));
        fs.createReadStream(file).pipe(res);
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, () => resolve(server));
  });
}

module.exports = { start, ROOT };

if (require.main === module) {
  const port = Number(process.argv[2] || 8853);
  start(port).then(() => console.log('serving ' + ROOT + ' on ' + port));
}
