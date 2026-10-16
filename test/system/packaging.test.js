'use strict';

// What ships, and how: the Electron version is pinned exactly, and the npm package carries the app and nothing else.
const test = require('node:test');
const assert = require('node:assert/strict');
const pkg = require('../../package.json');

test('Electron is pinned to one exact version, in one place', () => {
  assert.match(
    pkg.devDependencies.electron,
    /^\d+\.\d+\.\d+$/,
    'no range: a global install must fetch the tested build',
  );
  assert.equal(pkg.dependencies, undefined, 'no runtime dependencies');
});

test('the npm package carries the app, the licence files and the sprites, not the tests or docs', () => {
  for (const must of [
    'bin',
    'src',
    'LICENSE',
    'NOTICE',
    'assets/sprites/*.apng',
    'assets/tray/*.png',
    'assets/icon.png',
  ])
    assert.ok(pkg.files.includes(must), must);
  assert.ok(!pkg.files.some((f) => /^(test|docs|scripts)/.test(f)));
  assert.equal(pkg.engines.node, '>=22');
});
