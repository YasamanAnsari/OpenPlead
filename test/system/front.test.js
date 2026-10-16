'use strict';

// Which app is in front: the probes per platform and the watcher that steps the pet aside.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeApp,
  parseProbe,
  parseXpropActive,
  parseXpropWindow,
  parseHyprland,
  parseSway,
  createLinuxProbe,
  createHelperProbe,
  createProbe,
  createFrontWatcher,
} = require('../../src/system/front');

const CURSOR = 'com.todesktop.230313mzl4w4u92';
const CHROME = 'com.google.Chrome';
const answer = (front, visible, frontPid = 1157) => ({ front, frontPid, visible });
const fakeProbe = (reply) => ({ request: (cb) => reply(cb), stop() {} });

test('process names are compared without .exe and case', () => {
  assert.equal(normalizeApp(' Cursor.EXE '), 'cursor');
  assert.equal(normalizeApp('gnome-terminal-server\n'), 'gnome-terminal-server');
  const line = JSON.stringify({ front: 'WindowsTerminal', frontPid: 12, visible: 'WindowsTerminal' });
  assert.deepEqual(
    parseProbe(line, { names: true }),
    { front: 'windowsterminal', frontPid: 12, visible: ['windowsterminal'] },
    'PowerShell collapses a one-element list to a string',
  );
});

test('X11, Hyprland and sway answers are parsed', () => {
  assert.equal(parseXpropActive('_NET_ACTIVE_WINDOW(WINDOW): window id # 0x2a00007'), '0x2a00007');
  assert.equal(parseXpropActive('_NET_ACTIVE_WINDOW:  no such atom'), null);
  assert.deepEqual(parseXpropWindow('_NET_WM_PID(CARDINAL) = 4321\n_NET_WM_STATE(ATOM) = _NET_WM_STATE_HIDDEN'), {
    pid: 4321,
    hidden: true,
  });
  assert.deepEqual(parseXpropWindow('_NET_WM_PID(CARDINAL) = 4321\n_NET_WM_STATE(ATOM) = '), {
    pid: 4321,
    hidden: false,
  });
  assert.equal(parseXpropWindow('_NET_WM_PID:  not found.'), null);
  assert.deepEqual(parseHyprland('{"pid": 77, "class": "cursor"}'), { pid: 77, hidden: false });
  assert.equal(parseHyprland('{}'), null);
  const tree = { nodes: [{ nodes: [{ focused: false, pid: 1 }, { floating_nodes: [{ focused: true, pid: 99 }] }] }] };
  assert.deepEqual(parseSway(JSON.stringify(tree)), { pid: 99, hidden: false });
  assert.equal(parseSway('{"nodes":[]}'), null);
});

test('the Linux probe picks a backend from the session and reports the front app by process name', () => {
  const calls = [];
  const readFile = (file) => {
    if (file === '/proc/4321/comm') return 'gnome-terminal-server\n';
    throw new Error('no such pid');
  };
  const xRun = (cmd, args, _opts, cb) => {
    calls.push([cmd, ...args]);
    if (args[0] === '-root') return cb(null, '_NET_ACTIVE_WINDOW(WINDOW): window id # 0x1');
    return cb(null, '_NET_WM_PID(CARDINAL) = 4321\n_NET_WM_STATE(ATOM) = ');
  };
  const x11 = createLinuxProbe({ env: { DISPLAY: ':0' }, run: xRun, readFile });
  x11.request((err, v) =>
    assert.deepEqual(
      [err, v],
      [null, { front: 'gnome-terminal-server', frontPid: 4321, visible: ['gnome-terminal-server'] }],
    ),
  );
  assert.deepEqual(calls[0], ['xprop', '-root', '_NET_ACTIVE_WINDOW']);
  const hidden = createLinuxProbe({
    env: { DISPLAY: ':0' },
    run: (c, a, o, cb) =>
      a[0] === '-root'
        ? cb(null, 'window id # 0x1')
        : cb(null, '_NET_WM_PID(CARDINAL) = 4321\n_NET_WM_STATE(ATOM) = _NET_WM_STATE_HIDDEN'),
    readFile,
  });
  hidden.request((err, v) => assert.deepEqual(v.visible, [], 'minimised: not on screen'));
  const hypr = createLinuxProbe({
    env: { HYPRLAND_INSTANCE_SIGNATURE: 'x' },
    run: (c, a, o, cb) => cb(null, '{"pid":4321}'),
    readFile,
  });
  hypr.request((err, v) => assert.equal(v.front, 'gnome-terminal-server'));
  const sway = createLinuxProbe({
    env: { SWAYSOCK: '/tmp/s' },
    run: (c, a, o, cb) => cb(null, '{"nodes":[{"focused":true,"pid":4321}]}'),
    readFile,
  });
  sway.request((err, v) => assert.equal(v.frontPid, 4321));
  assert.equal(
    createLinuxProbe({ env: { XDG_SESSION_TYPE: 'wayland', DISPLAY: ':0' } }),
    null,
    'GNOME or KDE on Wayland: no probe',
  );
  assert.equal(createProbe({ platform: 'freebsd' }), null);
  const unknownPid = createLinuxProbe({
    env: { DISPLAY: ':0' },
    run: xRun,
    readFile: () => {
      throw new Error('gone');
    },
  });
  unknownPid.request((err, v) => assert.equal(v, null));
});

test('on Windows and Linux the pet matches process names from the session record', () => {
  let reply = { front: 'chrome', frontPid: 5, visible: ['chrome', 'windowsterminal'] };
  const w = createFrontWatcher({
    hosts: () => ['windowsterminal', 'cursor'],
    enabled: () => true,
    onChange() {},
    platform: 'win32',
    selfPid: 1,
    probe: { request: (cb) => cb(null, reply), stop() {} },
  });
  w.poll();
  assert.equal(w.inFront, false);
  reply = { front: 'windowsterminal', frontPid: 6, visible: ['windowsterminal'] };
  w.poll();
  assert.equal(w.inFront, true);
  reply = { front: 'windowsterminal', frontPid: 6, visible: ['chrome'] };
  w.poll();
  assert.equal(w.inFront, false, 'the terminal is active but minimised');
});

test('the watcher holds the screen until the first answer for new apps, and stops hiding after repeated failures', () => {
  let hosts = [];
  let reply = (cb) => cb(null, { front: CHROME, frontPid: 5, visible: [CHROME] });
  const w = createFrontWatcher({
    hosts: () => hosts,
    enabled: () => true,
    onChange() {},
    platform: 'darwin',
    selfPid: 1,
    probe: { request: (cb) => reply(cb), stop() {} },
    maxFailures: 2,
  });
  assert.equal(w.settled, true, 'nothing to probe');
  hosts = [CURSOR];
  let release = null;
  reply = (cb) => (release = cb);
  w.poll();
  assert.equal(w.settled, false, 'a new app: wait for the answer');
  release(null, { front: CHROME, frontPid: 5, visible: [CHROME] });
  assert.equal(w.settled, true);
  assert.equal(w.inFront, false);
  reply = (cb) => cb(new Error('helper exited'));
  w.poll();
  assert.equal(w.inFront, false, 'one miss changes nothing');
  w.poll();
  assert.equal(w.inFront, true, 'a broken probe must not hide the pet for good');
});

test('a helper gets a long first timeout and backs off between restarts', () => {
  const { EventEmitter } = require('node:events');
  let t = 1000;
  const spawned = [];
  const spawnProcess = () => {
    const c = new EventEmitter();
    c.stdout = new EventEmitter();
    c.stdin = Object.assign(new EventEmitter(), { write() {} });
    c.kill = () => {};
    spawned.push(c);
    return c;
  };
  const probe = createHelperProbe({
    command: 'x',
    args: [],
    spawnProcess,
    now: () => t,
    firstAnswerMs: 8000,
    requestTimeoutMs: 2000,
  });
  const got = [];
  probe.request((err) => got.push(err && err.message));
  assert.equal(spawned.length, 1);
  spawned[0].emit('exit', 1);
  assert.deepEqual(got, ['helper exited']);
  probe.request((err) => got.push(err && err.message));
  assert.equal(spawned.length, 1, 'no respawn during the back-off');
  assert.equal(got.at(-1), 'helper backing off');
  t += 2001;
  probe.request((err) => got.push(err && err.message));
  assert.equal(spawned.length, 2, 'respawned once the pause is over');
  spawned[1].stdout.emit('data', JSON.stringify({ front: CURSOR, frontPid: 7, visible: [CURSOR] }) + '\n');
  assert.equal(got.at(-1), null, 'an answer');
  probe.stop();
});

test('probe lines are validated before they are trusted', () => {
  assert.deepEqual(parseProbe(JSON.stringify(answer(CHROME, [CHROME]))), {
    front: CHROME,
    frontPid: 1157,
    visible: [CHROME],
  });
  assert.equal(parseProbe('{}'), null);
  assert.equal(parseProbe('garbage'), null);
  assert.deepEqual(parseProbe(JSON.stringify({ front: CURSOR, visible: [CURSOR, 7] })).visible, [CURSOR]);
});

test("the pet is in front only while the agent's app is active and has a window on screen", () => {
  let hosts = [CURSOR];
  let reply = answer(CHROME, [CHROME, CURSOR]);
  const changes = [];
  const w = createFrontWatcher({
    hosts: () => hosts,
    enabled: () => true,
    onChange: (v) => changes.push(v),
    platform: 'darwin',
    selfPid: 1,
    probe: fakeProbe((cb) => cb(null, reply)),
  });
  assert.equal(w.inFront, true);
  w.poll();
  assert.equal(w.inFront, false, 'Chrome is active; the agent runs in Cursor');
  reply = answer(CURSOR, [CHROME, CURSOR]);
  w.poll();
  assert.equal(w.inFront, true, 'Cursor active with a window on screen');
  reply = answer(CURSOR, [CHROME]);
  w.poll();
  assert.equal(w.inFront, false, 'Cursor active but minimised: no window on screen');
  reply = answer(CURSOR, [CURSOR]);
  w.poll();
  hosts = [];
  reply = answer(CHROME, [CHROME]);
  w.poll();
  assert.equal(w.inFront, true, 'no known app: the pet shows everywhere');
  assert.deepEqual(changes, [false, true, false, true]);
});

test('the probe guards: the pet itself, a failed or slow answer, an overlapping poll, the setting off, no probe', () => {
  const probes = [];
  let enabled = true;
  let reply = (cb) => cb(null, answer(CHROME, [CHROME], 1));
  const w = createFrontWatcher({
    hosts: () => [CURSOR],
    enabled: () => enabled,
    onChange: (v) => probes.push(v),
    platform: 'darwin',
    selfPid: 1,
    probe: fakeProbe((cb) => reply(cb)),
  });
  w.poll();
  assert.equal(w.inFront, true, 'the pet itself is in front for a moment after it launches');
  reply = (cb) => cb(new Error('helper exited'));
  w.poll();
  assert.equal(w.inFront, true);
  let release = null;
  reply = (cb) => (release = cb);
  w.poll();
  w.poll(); // while the first probe is still running
  release(null, answer(CHROME, [CHROME]));
  assert.equal(w.inFront, false);
  enabled = false;
  reply = () => assert.fail('no probe while the setting is off');
  w.poll();
  w.reset();
  assert.equal(w.inFront, true);
  assert.deepEqual(probes, [false, true]);
  const other = createFrontWatcher({
    hosts: () => ['x'],
    enabled: () => true,
    onChange: () => assert.fail('no probe here'),
    platform: 'freebsd',
  });
  other.poll();
  assert.equal(other.inFront, true, 'no probe for this desktop: the pet shows everywhere');
});
