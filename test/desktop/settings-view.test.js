'use strict';

// What the settings window may show and change, per platform.
const test = require('node:test');
const assert = require('node:assert/strict');
const { settingsPayload, canSet, canRun, recordSentence } = require('../../src/desktop/settings-view');

const status = {
  installed: true,
  hooksCurrent: true,
  port: 47821,
  sessionList: [{ id: 'abc', agent: 'claude-code', host: true, pid: 1 }],
  hosts: ['com.apple.Terminal'],
  visible: true,
  showMode: 'agentFront',
  agentInFront: true,
  stats: { pleas: 1, thanks: 2, panics: 0 },
  logFile: '/tmp/openplead.log',
};

test('the settings view answers five questions in plain words, per platform', () => {
  const mac = settingsPayload({
    settings: { thanks: true, hotkey: 'Control+Shift+P', showMode: 'session', sounds: true },
    status,
    platform: 'darwin',
    version: '0.1.0',
  });
  assert.equal(mac.show.mode, 'session');
  assert.deepEqual(
    mac.show.options.map((o) => o.value),
    ['agentFront', 'session', 'always'],
  );
  assert.equal(mac.show.followDesktops.available, true);
  assert.equal(mac.sound.sounds, true);
  assert.equal(mac.sound.mute.value, 0);
  assert.equal(mac.sound.mute.label, 'Not muted');
  assert.equal(mac.hotkeys.find((h) => h.on).label, 'Control Shift P');
  assert.equal(mac.messages.thanks, true);
  assert.equal(mac.messages.inviteReply, false);
  assert.equal(mac.phraseSets.length, 13);
  assert.equal(mac.phraseSets[0].name, 'Plea 1 · polite');
  assert.equal(mac.firstRun, true, 'unset means a first run');
  assert.equal(mac.canFocus, true);
  assert.deepEqual(mac.status.hostNames, ['Terminal']);
  assert.equal(mac.status.logFile, '/tmp/openplead.log');
  assert.equal(mac.record, 'You pleaded 1 time. Claude was thanked 2 times. 0 panics.');
  const win = settingsPayload({
    settings: { firstRun: false, quietUntil: -1, alwaysShow: true },
    status: { ...status, hosts: [] },
    platform: 'win32',
    version: '0.1.0',
  });
  assert.equal(win.show.mode, 'agentFront', 'an unknown or missing mode shows the default');
  assert.equal(win.show.followDesktops.available, false);
  assert.equal(win.sound.mute.value, -1);
  assert.equal(win.sound.mute.label, 'Muted until turned off');
  assert.ok(win.hotkeys.some((h) => h.accel === 'Control+Alt+P'));
  assert.equal(win.firstRun, false);
  assert.equal(win.canFocus, false);
  assert.equal(win.status.sessions[0].name, 'Claude Code', 'the window shows the agent by name, not by id');
  assert.equal(
    recordSentence({ pleas: 124, thanks: 263, panics: 1 }),
    'You pleaded 124 times. Claude was thanked 263 times. 1 panic.',
  );
});

test('only known keys and actions are accepted from the window', () => {
  assert.ok(canSet('sounds') && canSet('hotkey') && canSet('showMode'));
  assert.ok(!canSet('alwaysShow') && !canSet('onlyOverAgent'), 'the two old switches are gone');
  assert.ok(!canSet('port') && !canSet('manageHooks') && !canSet('__proto__'));
  assert.ok(canRun('install') && canRun('done') && canRun('unpark') && canRun('checkConnection') && canRun('openLog'));
  assert.ok(canRun('copyRecord') && canRun('importPhrases'));
  assert.ok(canRun('copyReply') && canRun('replyCard') && canRun('clearReplies'), 'the reply actions');
  assert.ok(!canRun('eval') && !canRun('constructor') && !canRun('readFile'), 'nothing else');
});
