'use strict';

// Sounds: gated by the setting and the window, one cooldown per name, the chime's pitch count passed along.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSounds } = require('../../src/desktop/sounds');

test('a sound plays when enabled and audible, once per cooldown per name', () => {
  let enabled = true;
  let audible = true;
  const sent = [];
  const sounds = createSounds({
    enabled: () => enabled,
    audible: () => audible,
    thanksThisRun: () => 3,
    send: (p) => sent.push(p),
  });
  sounds.play('chime');
  sounds.play('chime');
  sounds.play('sob');
  assert.deepEqual(sent, [
    { name: 'chime', thanks: 3 },
    { name: 'sob', thanks: 3 },
  ]);
  sounds.reset();
  sounds.play('chime');
  assert.equal(sent.length, 3, 'reset forgets the cooldowns');
  enabled = false;
  sounds.play('bye');
  enabled = true;
  audible = false;
  sounds.play('bye');
  assert.equal(sent.length, 3, 'silent when off, hidden, or another app is in front');
});
