'use strict';

// The once-only explanations the pet gives, and how they are remembered in the settings.
const test = require('node:test');
const assert = require('node:assert/strict');
const { MOMENTS, coaching, coached } = require('../../src/core/coach');

test('each explanation is given once, names the agent, and is remembered in the settings', () => {
  let settings = {};
  assert.equal(coaching(settings, 'working', 'Claude Code'), 'Claude Code is working. Click me to plead.');
  settings = { ...settings, ...coached(settings, 'working') };
  assert.equal(coaching(settings, 'working', 'Claude Code'), null, 'already explained');
  assert.match(coaching(settings, 'queued', 'Cursor'), /goes to Cursor with its next tool call/);
  assert.match(coaching(settings, 'queued', 'Cursor', 'next message'), /goes with your next message to Cursor/);
  assert.equal(coaching(settings, 'nonsense', 'x'), null);
  assert.deepEqual(MOMENTS, ['working', 'queued', 'sent', 'thanks', 'panic']);
  settings = MOMENTS.reduce((s, m) => ({ ...s, ...coached(s, m) }), settings);
  assert.ok(MOMENTS.every((m) => coaching(settings, m, 'x') === null));
});
