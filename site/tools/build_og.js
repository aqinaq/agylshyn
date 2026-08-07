/* Renders tools/og_card.html to site/og.png, the 1200×630 link-preview image.

     node site/tools/build_og.js

   Run it whenever og_card.html changes — the PNG is committed, because a
   scraper fetches one flat file and there is nothing to render it with.
   Reuses tests/cdp.js, so there is no image library and no puppeteer here
   either: the card is HTML, and the browser that draws the site draws it. */
'use strict';
const fs = require('fs');
const path = require('path');
const { launch, connect, newContextPage, sleep } = require('../tests/cdp.js');

const PORT = Number(process.env.OG_CDP || 9377);
const SRC = path.join(__dirname, 'og_card.html');
const OUT = path.join(__dirname, '..', 'og.png');

async function main() {
  const chrome = await launch(PORT);
  try {
    const conn = await connect(PORT);
    const s = await newContextPage(conn);
    await s.send('Emulation.setDeviceMetricsOverride',
      { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });
    const loaded = new Promise(res => s.on('Page.loadEventFired', res));
    await s.send('Page.navigate', { url: 'file://' + SRC });
    await loaded;
    await sleep(400);                    // let the webfont fallback settle
    const shot = await s.send('Page.captureScreenshot',
      { format: 'png', clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 } });
    fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
    conn.close();
    console.log('wrote ' + path.relative(process.cwd(), OUT) + ' (' +
      Math.round(fs.statSync(OUT).size / 1024) + ' KB)');
  } finally {
    try { process.kill(-chrome.child.pid); } catch (e) { try { chrome.child.kill(); } catch (e2) {} }
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
