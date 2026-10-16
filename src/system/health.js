// @ts-check
'use strict';

const { sessionCount } = require('../core/state');

// What GET /health and the settings window report about the running app, assembled from the live pieces.
function createHealth({ version, installed, state, registry, pet, settings, front, hooksCurrent }) {
  return () => ({
    version: version(),
    installed: installed(),
    sessions: sessionCount(state()),
    sessionList: Object.entries(state().sessions).map(([id, s]) => ({
      id,
      agent: s.agent,
      host: registry.hasHost(id),
      pid: registry.pidOf(id),
    })),
    lastHookAt: state().lastHookAt,
    stats: state().stats,
    hosts: registry.appIds(),
    visible: pet.visible(),
    showMode: settings().showMode,
    agentInFront: front.inFront,
    hooksCurrent: hooksCurrent(),
  });
}

module.exports = { createHealth };
