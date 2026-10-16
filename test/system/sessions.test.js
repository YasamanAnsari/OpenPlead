'use strict';

// Session bookkeeping in main: hosts, pids, and pruning.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSessionRegistry } = require('../../src/system/sessions');

function fakeStore(records) {
  const forgotten = [];
  return {
    forgotten,
    isBundleId: (s) => typeof s === 'string' && s.includes('.'),
    savedSession: (id) => records[id] || null,
    forgetHost: (id) => forgotten.push(id),
  };
}

test('a host from the hook wins, the record fills in the pid, and is re-read at each prompt', () => {
  const store = fakeStore({ s1: { host: 'com.apple.Terminal', pid: 42 } });
  const reg = createSessionRegistry({ store, platform: 'darwin' });
  reg.learn('s1', 'com.googlecode.iterm2', 'session_start');
  assert.equal(reg.appOf('s1'), 'com.googlecode.iterm2', 'the hook host is kept over the saved one');
  assert.equal(reg.pidOf('s1'), 42);
  store.savedSession = () => ({ host: 'com.apple.Terminal', pid: 43 });
  reg.learn('s1', undefined, 'turn_end');
  assert.equal(reg.pidOf('s1'), 42, 'not re-read on an ordinary event');
  reg.learn('s1', undefined, 'turn_start');
  assert.equal(reg.pidOf('s1'), 43, 're-read at a prompt');
});

test('on Linux the record lists process names instead of a bundle id', () => {
  const store = fakeStore({ s1: { apps: ['code', 'cursor'], pid: 7 } });
  const reg = createSessionRegistry({ store, platform: 'linux' });
  reg.learn('s1', undefined, 'session_start');
  assert.deepEqual(reg.appIds(), ['code', 'cursor']);
});

test('prune forgets dead sessions, keeps the ended one out of forgetHost, and can hold hosts for the wave', () => {
  const store = fakeStore({ a: { host: 'com.a', pid: 1 }, b: { host: 'com.b', pid: 2 } });
  const reg = createSessionRegistry({ store, platform: 'darwin' });
  reg.learn('a', undefined, 'session_start');
  reg.learn('b', undefined, 'session_start');
  reg.prune({}, { ended: 'a', keepHosts: true });
  assert.deepEqual(store.forgotten, ['b'], 'the ended session was already forgotten by the caller');
  assert.equal(reg.pidOf('a'), null);
  assert.equal(reg.hostCount(), 2, 'hosts stay while the goodbye wave plays');
  reg.prune({});
  assert.equal(reg.hostCount(), 0);
  assert.equal(reg.appOf('a'), null);
});
