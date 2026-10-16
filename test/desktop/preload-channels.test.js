'use strict';

// The settings preload runs sandboxed and cannot require desktop/channels.js, so it carries its own copy of the
// channel names. This keeps the copy identical, and keeps the preload free of requires a sandbox would refuse.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PET, SETTINGS } = require('../../src/desktop/channels');

const preload = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'desktop', 'preload-settings.js'), 'utf8');

test('the settings preload names the same channels as desktop/channels.js and requires only electron', () => {
  const block = preload.match(/const SETTINGS = \{([\s\S]*?)\};/);
  assert.ok(block, 'the preload spells out its channel names');
  const copy = Object.fromEntries([...block[1].matchAll(/(\w+): '([^']+)'/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual(copy, SETTINGS);
  const requires = [...preload.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
  assert.deepEqual(requires, ['electron'], 'a sandboxed preload cannot load app files');
});

test('every channel name is unique across both windows', () => {
  const all = [...Object.values(PET), ...Object.values(SETTINGS)];
  assert.equal(new Set(all).size, all.length);
});
