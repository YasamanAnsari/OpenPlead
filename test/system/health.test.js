'use strict';

// The health payload, assembled from the live pieces.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHealth } = require('../../src/system/health');

test('health reports the sessions with their app and process, and the app state', () => {
  const health = createHealth({
    version: () => '0.1.0',
    installed: () => true,
    state: () => ({
      sessions: { a: { agent: 'claude-code' }, b: { agent: 'cursor' } },
      lastHookAt: 5,
      stats: { pleas: 1 },
    }),
    registry: {
      hasHost: (id) => id === 'a',
      pidOf: (id) => (id === 'a' ? 42 : null),
      appIds: () => ['com.apple.Terminal'],
    },
    pet: { visible: () => true },
    settings: () => ({ showMode: 'session' }),
    front: { inFront: false },
    hooksCurrent: () => true,
  });
  assert.deepEqual(health(), {
    version: '0.1.0',
    installed: true,
    sessions: 2,
    sessionList: [
      { id: 'a', agent: 'claude-code', host: true, pid: 42 },
      { id: 'b', agent: 'cursor', host: false, pid: null },
    ],
    lastHookAt: 5,
    stats: { pleas: 1 },
    hosts: ['com.apple.Terminal'],
    visible: true,
    showMode: 'session',
    agentInFront: false,
    hooksCurrent: true,
  });
});
