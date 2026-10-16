'use strict';

// Label capitalization per platform: title style on macOS, sentence style elsewhere.
const test = require('node:test');
const assert = require('node:assert/strict');
const { titleCase, labelFor } = require('../../src/renderer/case');

test('title style capitalizes every word but small ones, and always the first and last', () => {
  assert.equal(titleCase('Keep Grovel on screen'), 'Keep Grovel on Screen');
  assert.equal(titleCase('Park Grovel at the screen edge'), 'Park Grovel at the Screen Edge');
  assert.equal(titleCase('Thank it with my next message'), 'Thank It with My Next Message');
  assert.equal(titleCase('Until I turn it off'), 'Until I Turn It Off');
  assert.equal(titleCase('For an hour'), 'For an Hour');
  assert.equal(titleCase('Reset to defaults'), 'Reset to Defaults');
  assert.equal(titleCase('Go to the agent’s app'), 'Go to the Agent’s App');
  assert.equal(titleCase('of'), 'Of', 'a single word is first and last');
});

test('names, acronyms, ellipses and parentheses survive', () => {
  assert.equal(titleCase('Connect to Claude Code and Cursor'), 'Connect to Claude Code and Cursor');
  assert.equal(titleCase('Quit OpenPlead'), 'Quit OpenPlead');
  assert.equal(titleCase('Edit phrases…'), 'Edit Phrases…');
  assert.equal(titleCase('Plead (plea 2 of 5)'), 'Plead (Plea 2 of 5)');
  assert.equal(titleCase('Show me (20 s)'), 'Show Me (20 s)', 'a unit stays as it is');
  assert.equal(
    titleCase('Keep Grovel on screen until the session ends'),
    'Keep Grovel on Screen Until the Session Ends',
  );
  assert.equal(titleCase('needs your OK'), 'Needs Your OK');
  assert.equal(titleCase('Queue a thank-you for my next message'), 'Queue a Thank-You for My Next Message');
  assert.equal(titleCase('Hug (it is okay, carry on)'), 'Hug (It Is Okay, Carry On)', 'inside parentheses too');
});

test('the platform decides: title style on macOS, the label as written elsewhere', () => {
  assert.equal(labelFor('darwin', 'Play the chime'), 'Play the Chime');
  assert.equal(labelFor('win32', 'Play the chime'), 'Play the chime');
  assert.equal(labelFor('linux', 'Play the chime'), 'Play the chime');
});
