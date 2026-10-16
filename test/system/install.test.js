'use strict';

// Writing and removing the hook entries in both agents' settings files.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// install.js resolves ~/.claude and ~/.cursor from HOME at load time, so point it at a scratch directory first.
const { isolateHome } = require('../helpers/fs');
isolateHome('install');
const install = require('../../src/system/install');

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('install writes both files, is idempotent and uninstall leaves foreign hooks alone', () => {
  fs.mkdirSync(path.dirname(install.CLAUDE_SETTINGS), { recursive: true });
  fs.writeFileSync(
    install.CLAUDE_SETTINGS,
    JSON.stringify({
      model: 'opus',
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] },
    }),
  );

  const files = install.install({ cursor: true, port: 47821 });
  assert.deepEqual(files.sort(), [install.CLAUDE_SETTINGS, install.CURSOR_HOOKS].sort());
  assert.ok(install.isInstalled());
  assert.ok(install.isCurrent({ cursor: true, port: 47821 }));
  assert.ok(!install.isCurrent({ cursor: true, port: 50000 }), 'a different port is out of date');

  const claude = read(install.CLAUDE_SETTINGS);
  assert.equal(claude.model, 'opus', 'unrelated settings survive');
  assert.equal(claude.hooks.Stop.length, 2, 'the foreign Stop hook is kept next to ours');
  assert.ok(claude.hooks.PostToolUse.some((g) => g.hooks.some((h) => h.url === install.hookUrl(47821))));
  const prompt = claude.hooks.UserPromptSubmit.flatMap((g) => g.hooks).find(
    (h) => h.command && h.command.includes('openplead'),
  );
  assert.ok(
    prompt && prompt.type === 'command' && prompt.timeout === 3,
    'UserPromptSubmit goes through the shim, so the pet learns where the session runs',
  );
  assert.ok(!('beforeShellExecution' in read(install.CURSOR_HOOKS)), 'permission hooks are never registered');

  install.install({ cursor: true, port: 47821 });
  assert.equal(read(install.CLAUDE_SETTINGS).hooks.Stop.length, 2, 'reinstall does not duplicate');

  install.uninstall();
  assert.ok(!install.isInstalled());
  assert.deepEqual(read(install.CLAUDE_SETTINGS).hooks.Stop, [{ hooks: [{ type: 'command', command: 'say done' }] }]);
});

test('install refuses to overwrite a settings file it cannot parse or merge', () => {
  fs.writeFileSync(install.CLAUDE_SETTINGS, '{ not json');
  assert.throws(() => install.install({ cursor: false }), /not valid JSON/);
  assert.equal(fs.readFileSync(install.CLAUDE_SETTINGS, 'utf8'), '{ not json');
  for (const odd of ['null', '"text"', '{"hooks":[]}', '{"hooks":{"Stop":{}}}', '{"hooks":{"Stop":[null]}}']) {
    fs.writeFileSync(install.CLAUDE_SETTINGS, odd);
    assert.throws(() => install.install({ cursor: false }), /fix or move it/, odd);
    assert.equal(fs.readFileSync(install.CLAUDE_SETTINGS, 'utf8'), odd, `${odd} left untouched`);
  }
});

test('a packaged app tells the shim what to launch; an AppImage keeps a copy of the shim outside its mount', () => {
  assert.equal(install.launchSpec({ packaged: false }), null, 'a checkout launches through bin/openplead.js');
  assert.deepEqual(
    install.launchSpec({
      platform: 'darwin',
      packaged: true,
      execPath: '/Applications/OpenPlead.app/Contents/MacOS/OpenPlead',
      env: {},
    }),
    {
      cmd: '/Applications/OpenPlead.app/Contents/MacOS/OpenPlead',
      args: ['--autostart'],
    },
  );
  assert.equal(
    install.launchSpec({
      platform: 'linux',
      packaged: true,
      execPath: '/tmp/.mount_abc/openplead',
      env: { APPIMAGE: '/opt/OpenPlead.AppImage' },
    }).cmd,
    '/opt/OpenPlead.AppImage',
  );
  const source = path.join(__dirname, '..', '..', 'bin', 'openplead-hook.js');
  assert.equal(
    install.shimPath({ packaged: true, env: {}, source }),
    source,
    'no AppImage: the shim stays where it is',
  );
  const copy = install.shimPath({ packaged: true, env: { APPIMAGE: '/opt/OpenPlead.AppImage' }, source, copy: true });
  assert.notEqual(copy, source);
  assert.ok(fs.existsSync(copy));
  assert.equal(fs.readFileSync(copy, 'utf8'), fs.readFileSync(source, 'utf8'));
});

test('the text hooks exist only while the invitation is on, for both agents', () => {
  const events = (data) => Object.keys(data.hooks || {}).sort();
  fs.writeFileSync(install.CLAUDE_SETTINGS, '{}'); // an earlier test leaves a deliberately broken file behind
  fs.rmSync(install.CURSOR_HOOKS, { force: true });
  install.install({ cursor: true, port: 47821 });
  assert.ok(!events(read(install.CLAUDE_SETTINGS)).includes('MessageDisplay'), 'off by default: no per-message hook');
  assert.ok(!events(read(install.CURSOR_HOOKS)).includes('afterAgentResponse'));
  assert.ok(!install.isCurrent({ cursor: true, port: 47821, invite: true }), 'turning it on is a change');
  install.install({ cursor: true, port: 47821, invite: true });
  assert.ok(events(read(install.CLAUDE_SETTINGS)).includes('MessageDisplay'));
  assert.ok(events(read(install.CURSOR_HOOKS)).includes('afterAgentResponse'));
  assert.ok(install.isCurrent({ cursor: true, port: 47821, invite: true }));
  assert.ok(!install.isCurrent({ cursor: true, port: 47821 }), 'turning it off is a change too');
  install.install({ cursor: true, port: 47821 });
  assert.ok(!events(read(install.CLAUDE_SETTINGS)).includes('MessageDisplay'), 'and removes them again');
});

test('node is found on PATH first, then in a login shell, and an absolute path is never traded for a bare one', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openplead-node-'));
  const fake = path.join(dir, process.platform === 'win32' ? 'node.exe' : 'node');
  fs.writeFileSync(fake, '#!/bin/sh\n');
  fs.chmodSync(fake, 0o755);
  assert.equal(install.findNode({ env: { PATH: dir }, run: () => '' }), fake, 'PATH wins');
  if (process.platform !== 'win32') {
    const shelled = install.findNode({
      env: { PATH: '/nowhere' },
      shell: '/bin/sh',
      run: () => `motd noise\n${fake}\n`,
    });
    assert.equal(shelled, fake, 'the last line of a login shell, which may print a greeting first');
  }
  const kept = install.findNode({
    env: { PATH: '/nowhere' },
    shell: '/bin/sh',
    run: () => {
      throw new Error('no');
    },
    installed: () => '/opt/node/bin/node',
  });
  assert.equal(kept, '/opt/node/bin/node', 'nothing found: keep the absolute path already installed');
  assert.equal(
    install.findNode({
      env: { PATH: '' },
      run: () => {
        throw new Error('no');
      },
      installed: () => null,
    }),
    'node',
  );
});

test('a translocated or mounted macOS app refuses to write its temporary path into the hooks', () => {
  const at = (execPath) => install.unsafeLocation({ platform: 'darwin', packaged: true, execPath });
  assert.match(
    at('/private/var/folders/x/AppTranslocation/ABC/d/OpenPlead.app/Contents/MacOS/OpenPlead'),
    /Applications/,
  );
  assert.match(at('/Volumes/OpenPlead/OpenPlead.app/Contents/MacOS/OpenPlead'), /Applications/);
  assert.equal(at('/Applications/OpenPlead.app/Contents/MacOS/OpenPlead'), null);
  assert.equal(
    install.unsafeLocation({ platform: 'darwin', packaged: false, execPath: '/Volumes/x' }),
    null,
    'a checkout is fine',
  );
});
