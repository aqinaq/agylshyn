/* A browser driver in ~140 lines, over raw Chrome DevTools Protocol.

   There is no puppeteer here and none is needed: node 22+ has a global
   WebSocket, and everything these tests do is Page.navigate,
   Runtime.evaluate and Fetch.fulfillRequest. That keeps the repository free of
   a 300 MB dependency for a site that ships no build step at all. */
'use strict';
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

function httpJson(url) {
  return new Promise((res, rej) => {
    http.get(url, r => {
      let b = '';
      r.on('data', c => (b += c));
      r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

/* ---------------- launching ---------------- */

function chromePath() {
  const found = CHROME.find(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });
  if (!found) throw new Error('no Chrome found; set one of: ' + CHROME.join(', '));
  return found;
}

async function launch(port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agylshyn-cdp-'));
  const child = spawn(chromePath(), [
    '--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + dir,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--window-size=1440,900', 'about:blank'
  ], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 60; i++) {
    try { await httpJson('http://127.0.0.1:' + port + '/json/version'); return { child, dir }; }
    catch (e) { await sleep(250); }
  }
  throw new Error('Chrome did not answer on ' + port);
}

/* ---------------- the connection ---------------- */

class Conn {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = [];
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        for (const h of this.handlers) {
          if (h.event === msg.method && (!h.sessionId || h.sessionId === msg.sessionId)) h.fn(msg.params);
        }
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }
      }, 45000);
    });
  }
  on(event, fn, sessionId) { this.handlers.push({ event, fn, sessionId }); }
  close() { try { this.ws.close(); } catch (e) { /* already gone */ } }
}

class Session {
  constructor(sessionId, conn) { this.sessionId = sessionId; this.conn = conn; }
  send(method, params) { return this.conn.send(method, params, this.sessionId); }
  on(event, fn) { this.conn.on(event, fn, this.sessionId); }
  async eval(expression, awaitPromise = true) {
    const r = await this.send('Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise, userGesture: true });
    if (r.exceptionDetails) {
      const e = r.exceptionDetails;
      throw new Error('page error: ' + ((e.exception && (e.exception.description || e.exception.value)) || e.text));
    }
    return r.result.value;
  }
}

async function connect(port) {
  const v = await httpJson('http://127.0.0.1:' + port + '/json/version');
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });
  return new Conn(ws);
}

/* Each scenario gets a browser context of its own. The session and the
   progress both live in localStorage, so without this the previous scenario's
   sign-in carries over into the next one. */
async function newContextPage(conn, url, opts) {
  opts = opts || {};
  const { browserContextId } = await conn.send('Target.createBrowserContext', { disposeOnDetach: true });
  const { targetId } = await conn.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await conn.send('Target.attachToTarget', { targetId, flatten: true });
  const s = new Session(sessionId, conn);
  s.targetId = targetId;
  s.browserContextId = browserContextId;
  await s.send('Page.enable');
  await s.send('Runtime.enable');
  await s.send('Network.enable');
  if (!opts.keepServiceWorker) {
    // A service worker cannot be intercepted — it is fetched outside the
    // page's network context — and index.html reloads on controllerchange,
    // which pulls the page out from under an open modal mid-assertion. Only
    // the offline test wants one.
    await s.send('Page.addScriptToEvaluateOnNewDocument', {
      source: 'try{delete Navigator.prototype.serviceWorker}catch(e){}'
    });
  }
  if (url) await goto(s, url);
  return s;
}

async function goto(s, url) {
  // A change to the fragment alone does not reload, so Page.loadEventFired
  // never arrives and the wait below would hang forever. Every navigation
  // carries a unique query instead.
  if (url.indexOf('?') < 0) {
    const i = url.indexOf('#');
    url = i < 0 ? url + '?t=' + Date.now()
                : url.slice(0, i) + '?t=' + Date.now() + url.slice(i);
  }
  const loaded = new Promise(res => s.on('Page.loadEventFired', res));
  await s.send('Page.navigate', { url });
  await loaded;
  await sleep(150);
}

/* Wait for the page to actually be in the state the next assertion needs.

   Fixed sleeps after a navigation were the harness's own flakiest habit: a
   book takes two round trips to open when it is paid, a cold browser profile
   is several times slower than a warm one, and twelve suites in a row means
   the first of them always pays that cost. A poll costs nothing when the page
   is ready and waits when it is not. Returns false on timeout rather than
   throwing, so the assertion that follows reports what it saw. */
async function until(s, expression, ms) {
  const stop = Date.now() + (ms || 10000);
  for (;;) {
    if (await s.eval(expression)) return true;
    if (Date.now() > stop) return false;
    await sleep(120);
  }
}

/* Answer the app's own confirm dialog (ask.js).

   These used to be native window.confirm(), and every suite stubbed it with
   `window.confirm = () => true`. The dialog is the app's now, so a stub would
   test nothing: the button has to be found and pressed like a reader would.
   Waits for it, because ASK.confirm is raised from a click handler and the
   modal is unhidden a frame later.

   `yes: false` presses the cancelling button instead, which is what a suite
   asserting "nothing was deleted" needs. Returns false if no dialog appeared —
   the assertion that follows then reports what it saw rather than hanging. */
async function answerAsk(s, yes) {
  const up = await until(s, `!document.getElementById('askModal').hidden`, 5000);
  if (!up) return false;
  await s.eval(`document.getElementById(${yes === false ? "'askNo'" : "'askYes'"}).click()`);
  await until(s, `document.getElementById('askModal').hidden`, 5000);
  return true;
}

module.exports = { launch, connect, newContextPage, goto, sleep, until, answerAsk, Session };
