/* Everything, in one command:

     node site/tests/run.js

   Starts a range-capable server, launches headless Chrome, runs the static
   audit, the answer matcher and the three browser passes, then shuts both
   down again. Exit code is the number of failures, so CI can just run it. */
'use strict';
const { spawnSync, spawn } = require('child_process');
const http = require('http');
const path = require('path');
const { launch, sleep } = require('./cdp.js');

const PORT = Number(process.env.TEST_PORT || 8853);
const CDP = Number(process.env.TEST_CDP || 9333);

function node(file) {
  const res = spawnSync(process.execPath, [path.join(__dirname, '..', file)],
    { stdio: 'inherit', env: process.env });
  return res.status || 0;
}

/* The server runs in a child, not in this process. spawnSync below blocks the
   event loop for as long as a suite runs, so a server listening here would
   accept the connection and then answer nothing — every navigation times out. */
function startServer(port) {
  const child = spawn(process.execPath, [path.join(__dirname, 'serve.js'), String(port)],
    { stdio: 'ignore', detached: false });
  const alive = () => new Promise(res => {
    const req = http.get('http://127.0.0.1:' + port + '/data/index.json', r => {
      r.resume();
      res(r.statusCode === 200);
    });
    req.on('error', () => res(false));
    req.setTimeout(500, () => { req.destroy(); res(false); });
  });
  return (async () => {
    for (let i = 0; i < 40; i++) {
      if (await alive()) return child;
      await sleep(250);
    }
    child.kill();
    throw new Error('the test server never answered on ' + port);
  })();
}

async function main() {
  let failures = 0;

  // No browser needed for these two.
  failures += node('tests/audit.js');
  failures += node('match_test.js');

  let server, chrome;
  try {
    server = await startServer(PORT);
  } catch (e) {
    console.error('\ncould not start the test server on ' + PORT + ': ' + e.message);
    console.error('set TEST_PORT to a free port and try again.');
    process.exit(2);
  }
  process.env.TEST_BASE = 'http://127.0.0.1:' + PORT + '/';
  process.env.TEST_CDP = String(CDP);

  try {
    chrome = await launch(CDP);
  } catch (e) {
    console.error('\ncould not start Chrome: ' + e.message);
    console.error('the browser passes were skipped; the static checks above still ran.');
    server.kill();
    process.exit(failures ? 1 : 2);
  }

  for (const suite of ['tests/app_e2e.js', 'tests/device_e2e.js', 'tests/admin_e2e.js',
                       'tests/paywall_e2e.js', 'tests/exam_e2e.js', 'tests/tasks_e2e.js',
                       'tests/dictation_e2e.js']) {
    failures += node(suite);
  }

  // Chrome is launched detached so it survives the parent shell; kill the
  // process group or the next run trips over its SingletonLock.
  try { process.kill(-chrome.child.pid, 'SIGTERM'); }
  catch (e) { try { chrome.child.kill('SIGTERM'); } catch (e2) { /* already gone */ } }
  server.kill();
  await sleep(300);

  console.error('\n' + (failures ? failures + ' suite(s) failed' : 'everything passed'));
  process.exit(failures ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(2); });
