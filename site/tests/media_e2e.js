/* AUDIO_BASE and PDF_BASE: does the app actually use them?

   The two folders they point at are ~550 MB, and moving them out of the
   repository is only safe if the app really does look for them where the config
   says. The failure is quiet in the worst way: with both bases empty every path
   still resolves against the site's own origin, which is exactly right locally
   and exactly wrong on a deploy that no longer ships the folders. Nothing
   throws. The IELTS books just lose their recordings, and every book loses its
   PDF, on the live site, for everybody.

   So this asks the question the deploy asks: serve a media.config.js with the
   bases filled in, and look at the URLs the page ends up using.

   node site/tests/media_e2e.js */
'use strict';
const fs = require('fs');
const path = require('path');
const { connect, newContextPage, goto, sleep } = require('./cdp.js');
const { Report } = require('./report.js');

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:8853/';
const PORT = Number(process.env.TEST_CDP || 9333);
const SITE = path.resolve(__dirname, '..');

const AUDIO_AT = 'https://media.example.test/agylshyn-audio';
const PDF_AT = 'https://media.example.test/agylshyn-pdf';

/* A page whose media.config.js says the folders live elsewhere. Intercepted
   rather than edited on disk: the file under test is the real one, and a test
   that rewrites a tracked file is a test that can leave the repository dirty
   when it fails halfway. */
async function pageWithBases(conn, audio, pdf) {
  const s = await newContextPage(conn);
  await s.send('Fetch.enable', {
    patterns: [{ urlPattern: '*media.config.js*', requestStage: 'Request' }]
  });
  s.on('Fetch.requestPaused', p => {
    const body = "window.AUDIO_BASE = '" + audio + "';\nwindow.PDF_BASE = '" + pdf + "';\n";
    return s.send('Fetch.fulfillRequest', {
      requestId: p.requestId,
      responseCode: 200,
      responseHeaders: [{ name: 'content-type', value: 'application/javascript' }],
      body: Buffer.from(body).toString('base64')
    });
  });
  await goto(s, BASE);
  await sleep(700);
  return s;
}

// A free IELTS book: it is the one kind with both halves of the question in it,
// a PDF and forty questions' worth of Listening.
const BOOK = 'ielts-19';

async function openUnit(s, unit) {
  await s.eval(`location.hash = '#/b/${BOOK}/unit/${unit}'`);
  for (let i = 0; i < 40; i++) {
    if (await s.eval(`!!document.querySelector('audio source, audio[src]')`)) break;
    await sleep(150);
  }
}

async function run() {
  const r = Report('where the audio and the PDFs are');
  const conn = await connect(PORT);

  /* ---- the shipped default ---- */
  r.head('bases empty: everything is next to the site');
  {
    const cfg = fs.readFileSync(path.join(SITE, 'media.config.js'), 'utf8');
    // The committed file must stay empty. A base accidentally committed with a
    // real bucket in it would work on the deploy and break every fork and every
    // offline checkout, which is the kind of bug nobody reports.
    r.ok('media.config.js ships both bases empty',
      /window\.AUDIO_BASE\s*=\s*''/.test(cfg) && /window\.PDF_BASE\s*=\s*''/.test(cfg));

    const s = await pageWithBases(conn, '', '');
    await openUnit(s, 1);
    const urls = await s.eval(`(() => {
      const a = document.querySelector('audio source, audio[src]');
      return { audio: a ? (a.src || a.getAttribute('src')) : null };
    })()`);
    r.ok('a recording is served from the site itself',
      !!urls.audio && urls.audio.indexOf(location0()) === 0, String(urls.audio));
    r.ok('and its path is the one the data file wrote',
      /\/audio\/c19\//.test(String(urls.audio)), String(urls.audio));
  }

  /* ---- the deployed shape ---- */
  r.head('bases set: everything is at the bucket');
  {
    const s = await pageWithBases(conn, AUDIO_AT, PDF_AT);
    await openUnit(s, 1);

    const audio = await s.eval(`(() => {
      const a = document.querySelector('audio source, audio[src]');
      return a ? (a.src || a.getAttribute('src')) : null;
    })()`);
    r.ok('the recording comes from AUDIO_BASE',
      String(audio).indexOf(AUDIO_AT + '/audio/') === 0, String(audio));
    // The folder layout underneath the base is load-bearing: upload_media.py
    // preserves it and the data files name it, so a base that swallowed the
    // "audio/" segment would 404 every track.
    r.ok('with the folder layout kept underneath it',
      /\/audio\/c19\/t1p1\./.test(String(audio)), String(audio));

    const pdf = await s.eval(`(() => {
      const el = document.getElementById('pdfNewTab');
      return el ? el.getAttribute('href') : null;
    })()`);
    r.ok('and the PDF comes from PDF_BASE',
      String(pdf).indexOf(PDF_AT + '/pdf/') === 0, String(pdf));
    r.ok('with its page anchor still on the end',
      /#page=\d+$/.test(String(pdf)), String(pdf));

    // Nothing in the data files should have had to change for any of this.
    const dataUntouched = await s.eval(`(async () => {
      const d = await (await fetch('data/${BOOK}.json')).json();
      const first = JSON.stringify(d).match(/"(audio\\/[^"]+)"/);
      return first ? first[1] : null;
    })()`);
    r.ok('the data file still stores a plain site-relative path',
      /^audio\/c19\//.test(String(dataUntouched)), String(dataUntouched));
  }

  return r.done();
}

// The origin the test server is on, for the "served from the site itself" check.
function location0() {
  return BASE.replace(/\/+$/, '');
}

run().then(n => process.exit(n ? 1 : 0),
  e => { console.error(e); process.exit(1); });
