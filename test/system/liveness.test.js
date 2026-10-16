'use strict';

// Dead sessions by process id, and which remembered sessions are worth waking up for.
const test = require('node:test');
const assert = require('node:assert/strict');
const { isAlive, deadSessions, recoverable } = require('../../src/system/liveness');

test('dead sessions are the ones whose recorded agent process is gone; unknown pids are left alone', () => {
  const pids = { a: 10, b: 20, c: null };
  const alive = (pid) => pid === 10;
  assert.deepEqual(
    deadSessions(['a', 'b', 'c'], (id) => pids[id], alive),
    ['b'],
  );
  assert.ok(isAlive(process.pid));
  assert.ok(!isAlive(2 ** 22 - 1), 'a pid that cannot be running');
});

test('recovery wakes up only remembered sessions with a known agent and a live process', () => {
  const records = [
    { id: 'live', host: 'com.apple.Terminal', pid: 10, agent: 'claude-code' },
    { id: 'dead', host: 'com.apple.Terminal', pid: 20, agent: 'claude-code' },
    { id: 'no-agent', host: 'com.apple.Terminal', pid: 10, agent: null },
    { id: 'no-pid', host: 'com.apple.Terminal', pid: null, agent: 'cursor' },
  ];
  const now = 1_000_000_000;
  const fresh = records.map((r) => ({ ...r, mtimeMs: now - 1000 }));
  assert.deepEqual(
    recoverable(fresh, (pid) => pid === 10, { now }).map((r) => r.id),
    ['live'],
  );
  assert.deepEqual(
    recoverable(fresh, (pid) => pid === 10, { now, enabled: (a) => a !== 'claude-code' }),
    [],
    'a switched-off agent is not revived',
  );
  assert.deepEqual(
    recoverable(
      fresh.map((r) => ({ ...r, mtimeMs: now - 3 * 60 * 60_000 })),
      () => true,
      { now },
    ),
    [],
    'a stale record (reused pid after a reboot) is not revived',
  );
});
