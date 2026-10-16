'use strict';

// Shared by the live scripts: an isolated, hidden pet with its own home directory and ports, HTTP helpers against
// it, the pass/fail bookkeeping, and the cleanup. Each script writes its own config into the home before start().
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const puppeteer = require('puppeteer');

const REPO = path.join(__dirname, '..');
const ELECTRON = path.join(REPO, 'node_modules', '.bin', 'electron');
const DEFAULT_PORT = 47999; // the isolated pet's hook port; the user's pet keeps 47821
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A free port for the remote-debugging endpoint, so two runs or a stray instance never collide.
const freePort = () =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

// options.port: the pet's hook port (default 47999, so the user's pet on 47821 is never touched).
function createHarness(name, { port = DEFAULT_PORT } = {}) {
  const PORT = port;
  const HOME = fs.mkdtempSync(path.join(os.tmpdir(), `openplead-${name}-`));
  fs.mkdirSync(path.join(HOME, '.openplead'));
  const t0 = Date.now();
  const log = (...a) => console.log(String(((Date.now() - t0) / 1000).toFixed(1)).padStart(6) + 's', ...a);
  const failures = [];
  const check = (ok, what) => {
    log((ok ? 'PASS' : 'FAIL') + ' ' + what);
    if (!ok) failures.push(what);
  };
  // Polls until fn() is truthy, else records a failure with the last value seen.
  async function until(fn, what, ms = 4000) {
    const end = Date.now() + ms;
    let last;
    while (Date.now() < end) {
      try {
        last = await fn();
        if (last) return last;
      } catch (e) {
        last = e.message;
      }
      await sleep(150);
    }
    check(false, `${what} (timed out; last: ${JSON.stringify(last)})`);
    return null;
  }
  const get = (p) =>
    new Promise((res, rej) =>
      http
        .get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
          let d = '';
          r.on('data', (c) => (d += c));
          r.on('end', () => res(JSON.parse(d)));
        })
        .on('error', rej),
    );
  const post = (p, body) =>
    new Promise((res, rej) => {
      const req = http.request(
        { host: '127.0.0.1', port: PORT, path: p, method: 'POST', headers: { 'content-type': 'application/json' } },
        (r) => {
          let d = '';
          r.on('data', (c) => (d += c));
          r.on('end', () => res({ status: r.statusCode, body: d }));
        },
      );
      req.on('error', rej);
      req.end(JSON.stringify(body));
    });

  const env = { ...process.env, HOME, OPENPLEAD_HIDDEN: '1' };
  delete env.ELECTRON_RUN_AS_NODE; // inherited from an editor, it would turn Electron into plain Node
  const userData = `--user-data-dir=${path.join(HOME, 'userdata')}`;
  let child = null;
  let browser = null;

  // Starts the pet on a free devtools port, waits for its health route and connects to its pages.
  async function start() {
    const devtools = await freePort();
    child = spawn(ELECTRON, ['.', userData, `--remote-debugging-port=${devtools}`], {
      cwd: REPO,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    child.stderr.on('data', (d) => {
      const s = String(d);
      if (/error|exception/i.test(s) && !/Electron Security Warning|Insecure Content|Unsafe Eval/i.test(s))
        process.stdout.write('  [electron] ' + s);
    });
    let up = null;
    for (let i = 0; i < 60 && !up; i++) {
      await sleep(500);
      up = await get('/health').catch(() => null);
    }
    if (!up) throw new Error('the isolated pet did not come up');
    browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${devtools}`, defaultViewport: null });
    return up;
  }
  // A second copy with the same user-data dir: the running pet answers by opening its Settings window (hidden).
  function openSettings() {
    const second = spawn(ELECTRON, ['.', userData], { cwd: REPO, env, stdio: 'ignore', detached: true });
    second.unref();
  }
  // The first page whose URL matches, once it exists.
  async function page(matches, tries = 40) {
    for (let i = 0; i < tries; i++) {
      const found = (await browser.pages()).find((p) => matches(p.url()));
      if (found) return found;
      await sleep(250);
    }
    return null;
  }
  function stop() {
    if (!child) return;
    try {
      process.kill(child.pid, 'SIGTERM');
    } catch {
      // ignored: already gone
    }
    const pid = child.pid;
    setTimeout(() => {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // ignored: it left on its own
      }
    }, 700).unref();
  }
  async function finish() {
    console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASSED');
    if (browser) browser.disconnect();
    stop();
    await sleep(900);
    fs.rmSync(HOME, { recursive: true, force: true });
    process.exit(failures.length ? 1 : 0);
  }
  function fail(e) {
    console.log('ERROR', e.stack || e.message);
    stop();
    process.exit(2);
  }
  return {
    HOME,
    PORT,
    REPO,
    log,
    check,
    until,
    get,
    post,
    start,
    openSettings,
    page,
    finish,
    fail,
    pid: () => child && child.pid,
  };
}

module.exports = { createHarness, sleep, REPO, DEFAULT_PORT };
