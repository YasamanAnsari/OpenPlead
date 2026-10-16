'use strict';

// Connecting and disconnecting the hooks: ownership, the file watcher, and what the app is told.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createConnection } = require('../../src/system/connection');

function harness({ installed = false, current = true, manageHooks = true, failInstall = false } = {}) {
  const calls = [];
  let saved = {};
  const install = {
    isInstalled: () => installed,
    isCurrent: () => current,
    install: () => {
      calls.push('install');
      if (failInstall) throw new Error('read-only');
      installed = true;
    },
    uninstall: () => {
      calls.push('uninstall');
      installed = false;
    },
    launchSpec: () => ({ kind: 'test' }),
    watchHookFiles: () => () => calls.push('unwatch'),
  };
  const said = [];
  const connection = createConnection({
    settings: () => ({ cursor: true, port: 1234, inviteReply: false }),
    save: (patch) => (saved = { ...saved, ...patch }),
    reloadManageHooks: () => manageHooks,
    say: (text) => said.push(text),
    report: (context, err) => calls.push(`report:${context}:${err.message}`),
    onChanged: () => calls.push('changed'),
    install,
  });
  return { connection, calls, said, saved: () => saved };
}

test('connect installs, records ownership, watches the files and tells the app once', () => {
  const h = harness();
  h.connection.connect();
  assert.equal(h.connection.installed(), true);
  assert.deepEqual(h.calls, ['install', 'changed']);
  assert.deepEqual(h.saved(), { manageHooks: true, launch: { kind: 'test' } });
  assert.match(h.said[0], /^Connected/);
  assert.equal(h.connection.check().ok, true);
  assert.match(h.connection.lastCheck().text, /Cursor reach Grovel on port 1234/);
});

test('a failed install is reported with its context and shown, and we stay disconnected', () => {
  const h = harness({ failInstall: true });
  h.connection.connect({ quiet: true });
  assert.equal(h.connection.installed(), false);
  assert.ok(h.calls.includes('report:installing the hooks:read-only'));
  assert.match(h.said[0], /Could not connect: read-only/);
  assert.match(h.connection.check().text, /Not connected/);
});

test('disconnect gives up ownership before removing, so the watcher cannot restore the entries', () => {
  const h = harness({ installed: true });
  h.connection.disconnect();
  assert.equal(h.saved().manageHooks, false);
  assert.deepEqual(h.calls, ['uninstall', 'changed']);
  assert.equal(h.connection.installed(), false);
});

test('repair restores missing entries only while we still own them', () => {
  const owned = harness({ installed: true, current: false });
  owned.connection.repair();
  assert.deepEqual(owned.calls, ['install']);
  assert.match(owned.said[0], /Restored/);
  const released = harness({ installed: true, current: false, manageHooks: false });
  released.connection.repair();
  assert.deepEqual(released.calls, ['changed'], 'released: nothing restored, the app only follows the files');
});

test('a disconnect from the command line is followed, not undone, and the app is told', () => {
  let present = true;
  let manage = true;
  let changes = 0;
  const conn = createConnection({
    settings: () => ({ cursor: true, port: 1, inviteReply: false, manageHooks: manage }),
    save: () => {},
    reloadManageHooks: () => manage,
    say: () => {},
    report: () => {},
    onChanged: () => (changes += 1),
    install: {
      isInstalled: () => present,
      isCurrent: () => present,
      install: () => (present = true),
      uninstall: () => (present = false),
      watchHookFiles: () => () => {},
    },
  });
  conn.refresh();
  conn.repair();
  assert.equal(conn.installed(), true);
  manage = false; // the CLI hands ownership back first ...
  present = false; // ... then removes the entries
  conn.repair();
  assert.equal(conn.installed(), false, 'the app follows the files');
  assert.equal(present, false, 'and does not put the entries back');
  assert.equal(changes, 1, 'the window and the menu are told once');
});
