'use strict';

// Session records: which app and which process a session runs in. The shim writes them; the app reads, prunes and
// sweeps them, and never trusts a file it cannot parse.
const test = require('node:test');
const assert = require('node:assert/strict');
const { tmpDir } = require('../helpers/fs');
const { writeRecord } = require('../helpers/hosts');
const fs = require('node:fs');
const path = require('node:path');
const hosts = require('../../src/system/hosts');

const dir = path.join(tmpDir('hosts'), 'hosts');
const savedHost = (id) => {
  const record = hosts.savedSession(id, dir);
  return record ? record.host : null;
};

test("a session's host app is read back, junk and tampering are refused, and ids never leave the folder", () => {
  writeRecord(dir, 'abc-123', { host: 'com.apple.Terminal' });
  assert.equal(savedHost('abc-123'), 'com.apple.Terminal');
  assert.equal(savedHost('unknown'), null);
  writeRecord(dir, 'odd', { host: 'not a bundle id' });
  assert.equal(savedHost('odd'), null, 'a host that is not a bundle id reads as none');
  assert.ok(!hosts.isBundleId('${__CFBundleIdentifier}'), 'an uninterpolated variable is not an app');
  assert.ok(!hosts.isBundleId('com.a, com.b'), 'two values joined into one are not an app');
  for (const bad of ['..', '../x', '.hidden', 'a/b', '', 42])
    assert.equal(hosts.savedSession(bad, dir), null, JSON.stringify(bad));
  fs.writeFileSync(path.join(dir, 'tampered'), 'rm -rf /\n');
  assert.equal(savedHost('tampered'), null, 'a file holding no bundle id is ignored');
  hosts.forgetHost('abc-123', dir);
  assert.equal(savedHost('abc-123'), null);
  hosts.forgetHost('abc-123', dir); // a second time is fine
});

test('a session record carries the host, the agent pid and the agent; older bare bundle ids still read', () => {
  writeRecord(dir, 'rec-1', { host: 'com.apple.Terminal', pid: 4242, agent: 'claude-code' });
  assert.deepEqual(hosts.savedSession('rec-1', dir), {
    host: 'com.apple.Terminal',
    apps: [],
    pid: 4242,
    agent: 'claude-code',
  });
  writeRecord(dir, 'rec-2', { pid: 7, agent: 'cursor' });
  assert.deepEqual(
    hosts.savedSession('rec-2', dir),
    { host: null, apps: [], pid: 7, agent: 'cursor' },
    'no host (Linux, Windows) is still worth keeping',
  );
  writeRecord(dir, 'rec-4', { apps: ['WindowsTerminal.exe', 'Cursor.exe', 'bad/name', 'cursor.EXE'] });
  assert.deepEqual(
    hosts.savedSession('rec-4', dir).apps,
    ['windowsterminal', 'cursor'],
    'Windows and Linux: process names, cleaned',
  );
  hosts.forgetHost('rec-4', dir);
  writeRecord(dir, 'rec-3', { host: 'junk', pid: 1, agent: 'zsh' });
  assert.equal(hosts.savedSession('rec-3', dir), null, 'nothing valid in it: not a record');
  assert.deepEqual(hosts.parseRecord('com.apple.Terminal\n'), {
    host: 'com.apple.Terminal',
    apps: [],
    pid: null,
    agent: null,
  });
  assert.equal(hosts.parseRecord('{"pid": "42"}'), null);
  assert.equal(hosts.parseRecord('{ not json'), null);
  assert.deepEqual(
    hosts
      .liveSessions(dir)
      .map((r) => r.id)
      .sort(),
    ['rec-1', 'rec-2'],
  );
  hosts.forgetHost('rec-1', dir);
  hosts.forgetHost('rec-2', dir);
  hosts.forgetHost('rec-3', dir);
});

test('sweep drops files older than a week and keeps the rest', () => {
  writeRecord(dir, 'old', { host: 'com.apple.Terminal' });
  writeRecord(dir, 'fresh', { host: 'com.apple.Terminal' });
  const old = new Date(Date.now() - 8 * 24 * 3600_000);
  fs.utimesSync(path.join(dir, 'old'), old, old);
  assert.equal(hosts.sweep(Date.now(), dir), 1);
  assert.equal(savedHost('old'), null);
  assert.equal(savedHost('fresh'), 'com.apple.Terminal');
  assert.equal(hosts.sweep(Date.now(), path.join(dir, 'missing')), 0);
});
