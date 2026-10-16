#!/usr/bin/env node
// Startup smoke test: starts the app the way a user's machine would (its own home, its own user-data directory, a
// free port), waits for it to answer on that port, walks one agent session through the hook endpoint, and stops it.
// Runs on macOS, Windows and Linux; on Linux without a display it wraps itself in xvfb-run. Exit code 0 means the
// app starts, serves, takes hooks and shuts down on this platform.
//
//   npm run smoke

'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));
const START_TIMEOUT_MS = 90_000; // a cold start on a CI runner can be slow
const EXIT_TIMEOUT_MS = 10_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function request(port, method, p, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path: p, headers: body ? { 'content-type': 'application/json' } : {} },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
      },
    );
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}
const health = async (port) => (await request(port, 'GET', '/health')).body;

async function waitForHealth(port, deadline, child) {
  while (Date.now() < deadline) {
    if (gone(child)) throw new Error(`the app exited early (code ${child.exitCode}, signal ${child.signalCode})`);
    try {
      return await health(port);
    } catch {
      await sleep(300);
    }
  }
  throw new Error(`no answer on port ${port} within ${START_TIMEOUT_MS / 1000} s`);
}

function launch(home) {
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    OPENPLEAD_HIDDEN: '1', // the window stays hidden: a smoke run must not flash a pet over the user's screen
  };
  delete env.ELECTRON_RUN_AS_NODE; // inherited from an editor, it would turn Electron into plain Node
  let cmd = require('electron'); // the binary's path when required from Node
  let args = [ROOT, `--user-data-dir=${path.join(home, 'userdata')}`];
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    if (spawnSync('which', ['xvfb-run']).status !== 0) {
      throw new Error('no display and no xvfb-run: install xvfb (apt-get install xvfb) or set DISPLAY');
    }
    args = ['-a', cmd, ...args];
    cmd = 'xvfb-run';
  }
  if (process.platform === 'linux' && process.env.CI) args.push('--no-sandbox'); // CI runners lack user namespaces for Chromium's sandbox
  // Its own process group on POSIX: xvfb-run is a shell script, and a signal to it alone would orphan Electron and Xvfb.
  return spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
}

const gone = (child) => child.exitCode !== null || child.signalCode !== null;
const signal = (child, sig) => {
  try {
    process.kill(-child.pid, sig); // the whole group
  } catch {
    try {
      child.kill(sig);
    } catch {
      // already gone
    }
  }
};
function stop(child) {
  child.stdout.destroy();
  child.stderr.destroy();
  if (gone(child)) return Promise.resolve();
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f']);
  else signal(child, 'SIGTERM');
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      if (process.platform !== 'win32') signal(child, 'SIGKILL');
      resolve();
    }, EXIT_TIMEOUT_MS);
    child.on('exit', () => {
      clearTimeout(t);
      resolve();
    });
  });
}

async function main() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openplead-smoke-'));
  const port = await freePort();
  fs.mkdirSync(path.join(home, '.openplead'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.openplead', 'config.json'),
    JSON.stringify({ port, firstRun: false, showMode: 'session', sounds: false }),
  );
  const child = launch(home);
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  const started = Date.now();
  try {
    const first = await waitForHealth(port, started + START_TIMEOUT_MS, child);
    assert.equal(first.ok, true, 'health answers');
    assert.equal(first.version, pkg.version, 'the running version is this checkout');
    assert.equal(first.installed, false, 'a fresh home has no hooks');
    assert.equal(first.sessions, 0, 'no session yet');
    const hook = async (name, extra = {}) => {
      const res = await request(port, 'POST', '/openplead/hook', {
        hook_event_name: name,
        session_id: 'smoke-1',
        ...extra,
      });
      assert.equal(res.status, 200, `${name} accepted`);
      return res.body;
    };
    await hook('SessionStart');
    await hook('UserPromptSubmit', { prompt: 'smoke' });
    await hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } });
    assert.equal((await health(port)).sessions, 1, 'the session is on record');
    await hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: { stdout: '' } });
    assert.deepEqual(await hook('Stop'), {}, 'a Stop with nothing queued is not blocked');
    await hook('SessionEnd');
    assert.equal((await health(port)).sessions, 0, 'the session is gone');
    const log = fs.readFileSync(path.join(home, '.openplead', 'openplead.log'), 'utf8');
    assert.match(log, /start v/, 'the log has the start line');
    const rejected = await request(port, 'POST', '/openplead/hook', { hook_event_name: 'Stop', session_id: 'x' }).catch(
      () => null,
    );
    assert.ok(rejected && rejected.status === 200, 'the endpoint stays up after a session');
    console.log(
      `smoke ok on ${process.platform}: v${first.version} answered on port ${port} after ${((Date.now() - started) / 1000).toFixed(1)} s; one session in and out`,
    );
  } catch (err) {
    console.error(`smoke failed on ${process.platform}: ${err.message}`);
    if (output.trim()) console.error(`--- app output ---\n${output.trim()}`);
    process.exitCode = 1;
  } finally {
    await stop(child);
    try {
      fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); // Windows releases handles late
    } catch (err) {
      console.warn(`could not remove ${home}: ${err.message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
