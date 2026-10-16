'use strict';

// Settings on disk: defaults, round trips, the Welcome marker, and migration of old keys.
const test = require('node:test');
const assert = require('node:assert/strict');

// config.js resolves ~/.openplead from HOME at load time, so point it at a scratch directory first.
const { isolateHome } = require('../helpers/fs');
isolateHome('config');
const config = require('../../src/system/config');

test('the Welcome request is a marker the app consumes once', () => {
  assert.equal(config.takeWelcome(), false, 'nothing requested');
  config.requestWelcome();
  assert.equal(config.takeWelcome(), true);
  assert.equal(config.takeWelcome(), false, 'consumed');
});

test('settings load with defaults, save round-trips, and raw() reports only what is on disk', () => {
  assert.equal(config.exists(), false);
  assert.deepEqual(config.raw(), {});
  config.save({ ...config.load(), port: 50000 });
  assert.equal(config.exists(), true);
  assert.equal(config.load().port, 50000);
  assert.equal(config.load().thanks, true, 'defaults still apply');
  assert.equal(config.raw().thanks, true, 'save writes the merged settings');
});

test('an unknown show mode falls back to the default', () => {
  config.save({ port: 1, showMode: 'bogus' });
  assert.equal(config.load().showMode, 'agentFront');
  config.save({ port: 1, showMode: 'session' });
  assert.equal(config.load().showMode, 'session');
});

test('a config.json that does not parse is reported unreadable, so the app never overwrites it', () => {
  const fs = require('node:fs');
  config.save({ port: 1 });
  assert.equal(config.readable(), true);
  fs.writeFileSync(config.FILE, '{ "port": 1, }');
  assert.equal(config.readable(), false);
  assert.equal(config.load().port, 47821, 'load still falls back to defaults for reading');
  fs.unlinkSync(config.FILE);
  assert.equal(config.readable(), true, 'no file yet is fine: there is nothing to protect');
});
