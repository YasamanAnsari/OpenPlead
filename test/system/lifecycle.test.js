'use strict';

// The clock: the reducer's tick with the live sessions, dead agents ended, sessions recovered at start, the autostart
// quit, the nudge, the hosts that follow the sessions, and the port move.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLifecycle } = require('../../src/system/lifecycle');

function harness(opts = {}) {
  const dispatched = [];
  const said = [];
  const quits = [];
  const log = [];
  const alive = new Set(opts.alive || [10]);
  const pids = { a: 10, b: 20, ...opts.pids };
  const state = {
    sessions: { a: { agent: 'claude-code' }, b: { agent: 'cursor' } },
    lastHookAt: Date.now(),
    ...opts.state,
  };
  const settings = { cursor: true, showMode: 'agentFront', port: 47821, manageHooks: true, ...opts.settings };
  const registry = {
    pidOf: (id) => pids[id] || null,
    hostCount: () => opts.hosts || 0,
    learned: [],
    ended: [],
    pruned: [],
    learn(id, host, kind) {
      this.learned.push([id, host, kind]);
    },
    end(id) {
      this.ended.push(id);
    },
    prune(sessions, o) {
      this.pruned.push(o);
    },
  };
  const front = {
    resets: 0,
    polls: 0,
    reset() {
      this.resets += 1;
    },
    poll() {
      this.polls += 1;
    },
  };
  const connection = {
    installed: () => opts.installed !== false,
    connects: [],
    connect(o) {
      this.connects.push(o);
    },
  };
  let pinned = Boolean(opts.pinned);
  const saved = [];
  const lifecycle = createLifecycle({
    dispatch: (input) => dispatched.push(input),
    registry,
    liveness: {
      isAlive: (pid) => alive.has(pid),
      deadSessions: (ids, pidOf) => ids.filter((id) => pidOf(id) && !alive.has(pidOf(id))),
      recoverable: (records, _a, { enabled }) => records.filter((r) => enabled(r.agent)),
    },
    records: () => opts.records || [],
    state: () => state,
    settings: () => settings,
    saveSettings: (patch) => (saved.push(patch), Object.assign(settings, patch)),
    connection,
    front,
    pinned: () => pinned,
    unpin: () => (pinned = false),
    settingsOpen: () => Boolean(opts.settingsOpen),
    goodbyePlaying: () => false,
    autostarted: Boolean(opts.autostarted),
    log: (line) => log.push(line),
    quit: (reason) => quits.push(reason),
    say: (text, ms, priority) => said.push([text, ms, priority]),
  });
  return {
    lifecycle,
    dispatched,
    said,
    quits,
    log,
    registry,
    front,
    connection,
    saved,
    state,
    settings,
    pinned: () => pinned,
  };
}

test('each tick carries the sessions whose process still runs; every fifth tick ends the dead ones', () => {
  const h = harness();
  h.lifecycle.tick();
  assert.deepEqual(h.dispatched[0], { type: 'tick', alive: ['a'] });
  for (let i = 0; i < 4; i += 1) h.lifecycle.tick();
  const ended = h.dispatched.filter((d) => d.type === 'hook');
  assert.deepEqual(ended, [{ type: 'hook', event: { agent: 'cursor', sessionId: 'b', kind: 'session_end' } }]);
  assert.match(h.log[0], /session b: agent process 20 is gone/);
});

test('an autostarted pet leaves a minute after the last session, unless pinned or always shown', () => {
  const idle = { sessions: {}, lastHookAt: Date.now() - 61_000 };
  const h = harness({ autostarted: true, state: idle });
  h.lifecycle.tick();
  assert.deepEqual(h.quits, ['no sessions for a minute after autostart']);
  assert.deepEqual(harness({ autostarted: true, state: idle, pinned: true }).lifecycle.tick(), undefined);
  assert.equal(harness({ autostarted: true, state: idle, pinned: true }).quits.length, 0);
  const always = harness({ autostarted: true, state: idle, settings: { showMode: 'always' } });
  always.lifecycle.tick();
  assert.equal(always.quits.length, 0);
  const reading = harness({ autostarted: true, state: idle, settingsOpen: true });
  reading.lifecycle.tick();
  assert.equal(reading.quits.length, 0, 'never under an open Settings window');
  const byHand = harness({ state: idle });
  byHand.lifecycle.tick();
  assert.equal(byHand.quits.length, 0, 'started by hand: stays');
});

test('after ten silent minutes the pet nudges once, with the right next step', () => {
  const quietState = { sessions: { a: { agent: 'claude-code' } }, lastHookAt: Date.now() - 11 * 60_000 };
  const h = harness({ state: quietState });
  h.lifecycle.tick();
  h.lifecycle.tick();
  assert.equal(h.said.length, 1);
  assert.match(h.said[0][0], /Start or restart a Claude Code session/);
  const unplugged = harness({ state: quietState, installed: false });
  unplugged.lifecycle.tick();
  assert.match(unplugged.said[0][0], /choose Connect to Claude Code/);
  h.lifecycle.resetNudge();
  h.lifecycle.tick();
  assert.equal(h.said.length, 2, 'a reconnect allows one more nudge');
});

test('sessions whose agent still runs are recovered at start, honoring the Cursor switch', () => {
  const records = [
    { id: 'x', agent: 'claude-code', pid: 1, host: 'com.apple.Terminal' },
    { id: 'y', agent: 'cursor', pid: 2 },
  ];
  const h = harness({ records });
  h.lifecycle.recoverSessions();
  assert.deepEqual(h.dispatched, [
    {
      type: 'hook',
      event: { agent: 'claude-code', sessionId: 'x', kind: 'session_start', host: 'com.apple.Terminal' },
    },
    { type: 'hook', event: { agent: 'cursor', sessionId: 'y', kind: 'session_start', host: undefined } },
  ]);
  assert.match(h.log[0], /recovered 2 live session/);
  const noCursor = harness({ records, settings: { cursor: false } });
  noCursor.lifecycle.recoverSessions();
  assert.equal(noCursor.dispatched.length, 1);
  assert.equal(noCursor.lifecycle.agentEnabled('cursor'), false);
});

test('hosts follow the sessions: learned at each hook, the pin dropped and the record ended at session end', () => {
  const h = harness({ pinned: true });
  h.lifecycle.trackHosts({ type: 'hook', event: { kind: 'turn_start', sessionId: 'a', host: 'com.apple.Terminal' } });
  assert.deepEqual(h.registry.learned, [['a', 'com.apple.Terminal', 'turn_start']]);
  assert.equal(h.front.resets, 1, 'no host known yet: the front watcher is reset');
  h.lifecycle.trackHosts({ type: 'hook', event: { kind: 'session_end', sessionId: 'a' } });
  assert.deepEqual(h.registry.ended, ['a']);
  assert.equal(h.pinned(), false);
  assert.deepEqual(h.registry.pruned[1], { ended: 'a', keepHosts: false });
  const first = harness({ hosts: 1 });
  first.registry.hostCount = (() => {
    let calls = 0;
    return () => (calls++ === 0 ? 0 : 1);
  })();
  first.lifecycle.trackHosts({ type: 'tick' });
  assert.equal(first.front.polls, 1, 'the first known host is polled at once');
});

test('when the port was taken the new one is saved, the hooks follow, and the user is told', () => {
  const h = harness();
  h.lifecycle.onListening(47821);
  assert.deepEqual(h.saved, []);
  h.lifecycle.onListening(50000);
  assert.deepEqual(h.saved, [{ port: 50000 }]);
  assert.deepEqual(h.connection.connects, [{ quiet: true }]);
  assert.match(h.said[0][0], /Port 47821 was taken\. Moved to 50000/);
});
