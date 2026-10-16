'use strict';

// The tray icon and its tooltip per state, scale and platform.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { STATES, trayStateOf, iconFile, tooltipFor, TOOLTIP_MAX } = require('../../src/desktop/tray');

const base = { sessions: {}, permissionWait: false, pending: null, nextPrompt: null };
const settings = { quietUntil: 0 };
const at = (state, extra = {}) => trayStateOf({ state, settings, installed: true, ...extra });

test('the tray icon follows what matters most: connection, the agent waiting on you, queued words, quiet', () => {
  assert.equal(at(base, { installed: false }), 'off');
  assert.equal(at(base), 'base');
  assert.equal(at({ ...base, pending: { level: 2 } }), 'queued');
  assert.equal(at({ ...base, nextPrompt: { kind: 'thanks' } }), 'queued');
  assert.equal(
    at({ ...base, permissionWait: true, pending: { level: 1 } }),
    'attention',
    'blocked on you beats queued',
  );
  assert.equal(at(base, { settings: { quietUntil: -1 } }), 'quiet', 'quiet until turned off');
  assert.equal(at(base, { settings: { quietUntil: 9000 }, now: 8000 }), 'quiet');
  assert.equal(at(base, { settings: { quietUntil: 5000 }, now: 6000 }), 'base', 'quiet that has run out');
  assert.equal(
    at({ ...base, permissionWait: true }, { settings: { quietUntil: -1 } }),
    'attention',
    'quiet silences chatter, not the agent waiting on you',
  );
  assert.equal(
    at({ ...base, permissionWait: true }, { installed: false }),
    'off',
    'nothing reaches an unconnected pet',
  );
});

test('every state has its icon at both scales in both families, named so Electron pairs and recognises them', () => {
  for (const platform of ['darwin', 'win32', 'linux']) {
    for (const name of STATES) {
      for (const scale of [1, 2]) {
        const file = path.join(__dirname, '..', '..', 'assets', 'tray', iconFile(name, { scale, platform }));
        assert.ok(fs.existsSync(file), `${path.basename(file)} exists`);
      }
    }
  }
  assert.equal(iconFile('base', { platform: 'win32' }), 'tray.png');
  assert.equal(iconFile('base', { scale: 2, platform: 'linux' }), 'tray@2x.png');
  assert.equal(iconFile('attention', { scale: 2, platform: 'win32' }), 'tray-attention@2x.png');
  assert.equal(iconFile('base', { platform: 'darwin' }), 'trayTemplate.png', 'the menu bar takes a template image');
  assert.equal(iconFile('queued', { scale: 2, platform: 'darwin' }), 'tray-queuedTemplate@2x.png');
});

test('the tooltip is a status statement, never a how-to, and fits what Windows shows', () => {
  const tip = (over) => tooltipFor({ installed: true, sessions: 1, visible: false, appName: over, quiet: false });
  assert.equal(tooltipFor({ installed: false }), 'OpenPlead – Not connected');
  assert.equal(tooltipFor({ installed: true, sessions: 0 }), 'OpenPlead – Waiting for an agent session');
  assert.equal(tooltipFor({ installed: true, sessions: 1, visible: true }), 'OpenPlead – Grovel is on screen');
  assert.equal(tip('Cursor'), 'OpenPlead – Hidden until Cursor is in front');
  assert.equal(
    tooltipFor({ installed: true, sessions: 1, visible: true, quiet: true }),
    'OpenPlead – Grovel is on screen · Muted',
  );
  assert.ok(!/click|right-click/i.test(tip('Cursor')), 'the infotip rules: no instructions on how to interact');
  assert.ok(tip('x'.repeat(200)).length <= TOOLTIP_MAX);
});
