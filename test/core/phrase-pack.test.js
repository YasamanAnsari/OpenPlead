'use strict';

// The example pack ships every built-in line (plus a few extras), so the two files cannot drift apart unnoticed.
const test = require('node:test');
const assert = require('node:assert/strict');
const pack = require('../../assets/phrase-packs/default.json');
const defaults = require('../../src/core/phrases.default.json');
const { fromSets } = require('../../src/core/phrases');

test('the default pack contains every built-in line and is a valid pack', () => {
  const packLines = new Set(
    Object.entries(pack)
      .filter(([k]) => k !== '_credit')
      .flatMap(([, v]) => v),
  );
  const builtIn = [
    ...Object.values(defaults.plea).flat(),
    ...Object.entries(defaults)
      .filter(([k]) => k !== 'plea')
      .flatMap(([, v]) => v),
  ];
  const missing = builtIn.filter((line) => !packLines.has(line));
  assert.deepEqual(missing, [], 'built-in lines missing from the pack');
  const { _credit, ...sets } = pack;
  assert.equal(typeof _credit, 'string');
  assert.equal(fromSets(sets).error, undefined, 'the pack passes the same validation as an edit');
});
