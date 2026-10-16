'use strict';

// The log file: one line per event, errors reported with their context, never fatal.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isolateHome } = require('../helpers/fs');

const home = isolateHome('log');
const { log, report, FILE } = require('../../src/system/log');

test('log appends timestamped lines under ~/.openplead and report names the context and the error', () => {
  assert.equal(path.dirname(FILE), path.join(home, '.openplead'));
  log('hello');
  report('doing a thing', new Error('it broke'));
  const lines = fs.readFileSync(FILE, 'utf8').trim().split('\n');
  assert.equal(
    lines.filter((l) => /^\d{4}-\d{2}-\d{2}T/.test(l)).length,
    2,
    'one stamped line per call; the stack follows',
  );
  assert.match(lines[0], /^\d{4}-\d{2}-\d{2}T[^ ]+ hello$/);
  assert.match(lines[1], /doing a thing/);
  assert.match(lines[1], /it broke/);
});
