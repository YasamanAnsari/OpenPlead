'use strict';

// Mute: for a while, until turned off, or off.
const test = require('node:test');
const assert = require('node:assert/strict');
const { isQuiet, quietUntil, quietLabel } = require('../../src/core/quiet');

test('quiet mode is a time, forever, or off', () => {
  const now = Date.UTC(2026, 9, 13, 12, 0, 0);
  assert.equal(isQuiet({ quietUntil: 0 }, now), false);
  assert.equal(isQuiet({}, now), false);
  assert.equal(isQuiet({ quietUntil: -1 }, now), true);
  assert.equal(isQuiet({ quietUntil: now + 1 }, now), true);
  assert.equal(isQuiet({ quietUntil: now - 1 }, now), false);
  assert.equal(quietUntil(60, now), now + 3_600_000);
  assert.equal(quietUntil(-1, now), -1);
  assert.equal(quietUntil(0, now), 0);
  assert.equal(quietLabel({ quietUntil: 0 }, now), '');
  assert.equal(quietLabel({ quietUntil: -1 }, now), 'Muted until turned off');
  assert.match(quietLabel({ quietUntil: now + 3_600_000 }, now), /^Muted until \d{1,2}:\d{2}$/);
});
