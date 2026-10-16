'use strict';

// The hook shim may not load app code, so it carries its own copies of the id checks. This keeps them identical.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = (file) => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');
const literal = (text, name) => {
  const m = text.match(new RegExp(`const ${name} = (/.*/[a-z]*);`));
  assert.ok(m, `${name} is defined`);
  return m[1];
};

test('the shim and the hosts module validate session ids and bundle ids with the same patterns', () => {
  const shim = source('bin/openplead-hook.js');
  const hosts = source('src/system/hosts.js');
  for (const name of ['SESSION_ID', 'BUNDLE_ID']) assert.equal(literal(shim, name), literal(hosts, name), name);
});
