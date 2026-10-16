'use strict';

// Friendly names for the agents and the apps they run in.
const test = require('node:test');
const assert = require('node:assert/strict');
const { appName, agentName } = require('../../src/core/apps');

test('apps and agents get friendly names, unknown ids degrade gracefully', () => {
  assert.equal(appName('com.todesktop.230313mzl4w4u92'), 'Cursor');
  assert.equal(appName('windowsterminal'), 'Windows Terminal');
  assert.equal(appName('com.example.SomeTerminal'), 'SomeTerminal');
  assert.equal(appName(null), "the agent's app");
  assert.equal(agentName('claude-code'), 'Claude Code');
  assert.equal(agentName(undefined), 'the agent');
});
