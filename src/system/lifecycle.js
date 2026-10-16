// @ts-check
'use strict';

const { turnActive, sessionCount: countSessions } = require('../core/state');

// The clock of the running app: the reducer's tick, the check for agents that died without a goodbye, the recovery of
// live sessions at start, and the autostart rule (leave a minute after the last session). Glue over what main hands
// it; nothing here owns state.

const QUIT_AFTER_MS = 60_000;
const SILENT_HOOKS_MS = 10 * 60_000;
const LIVENESS_EVERY_TICKS = 5;

//   dispatch(input)      the reducer entry in main
//   registry             the session registry (pidOf)
//   liveness, records()  src/system/liveness and the remembered session records
//   state(), settings()  the live values
//   log, quit(reason), say(text, ms, priority)
function createLifecycle({
  dispatch,
  registry,
  liveness,
  records,
  state,
  settings,
  saveSettings,
  connection,
  front,
  pinned,
  unpin,
  settingsOpen = () => false,
  goodbyePlaying,
  autostarted,
  log,
  quit,
  say,
}) {
  let ticks = 0;
  let nudged = false;
  const sessionCount = () => countSessions(state());
  const agentEnabled = (agent) => agent !== 'cursor' || Boolean(settings().cursor);

  // Sessions whose agent process still runs: the reducer keeps them through any silence.
  const liveSessionIds = () =>
    Object.keys(state().sessions).filter((id) => registry.pidOf(id) && liveness.isAlive(registry.pidOf(id)));

  // An agent that died without a SessionEnd: end its session here, so the pet does not wait ten minutes for it.
  function checkLiveness() {
    for (const id of liveness.deadSessions(Object.keys(state().sessions), registry.pidOf)) {
      log(`session ${id.slice(0, 8)}: agent process ${registry.pidOf(id)} is gone`);
      dispatch({ type: 'hook', event: { agent: state().sessions[id].agent, sessionId: id, kind: 'session_end' } });
    }
  }

  // Sessions whose agent still runs when the pet starts: wake up for them now instead of at their next hook.
  function recoverSessions() {
    const found = liveness.recoverable(records(), undefined, { enabled: agentEnabled });
    for (const r of found) {
      dispatch({
        type: 'hook',
        event: { agent: r.agent, sessionId: r.id, kind: 'session_start', host: r.host || undefined },
      });
    }
    if (found.length) log(`recovered ${found.length} live session(s)`);
  }

  function tick() {
    dispatch({ type: 'tick', alive: liveSessionIds() });
    if ((ticks += 1) % LIVENESS_EVERY_TICKS === 0) checkLiveness();
    const idle = Date.now() - state().lastHookAt;
    const away = !pinned() && !settingsOpen() && settings().showMode !== 'always';
    if (autostarted && away && !sessionCount() && idle > QUIT_AFTER_MS) {
      quit('no sessions for a minute after autostart');
      return;
    }
    if (!nudged && !turnActive(state()) && idle > SILENT_HOOKS_MS) {
      nudged = true;
      say(
        connection.installed()
          ? 'No agent activity yet. Start or restart a Claude Code session?'
          : 'Right-click me and choose Connect to Claude Code',
        8000,
        2,
      );
    }
  }

  // Hosts and pids follow the sessions the reducer has. The last session's host is kept while the goodbye wave
  // plays, so the wave is seen over the agent's app only.
  function trackHosts(input) {
    const hadHosts = registry.hostCount() > 0;
    let ended = null;
    if (input.type === 'hook') {
      const { kind, sessionId, host } = input.event;
      registry.learn(sessionId, host, kind);
      if (kind === 'session_end') {
        unpin();
        ended = sessionId;
        registry.end(sessionId);
      }
    }
    registry.prune(state().sessions, { ended, keepHosts: !sessionCount() && goodbyePlaying() });
    if (!registry.hostCount()) front.reset();
    else if (!hadHosts) front.poll(); // the first known host: do not leave the pet over the wrong app for a poll interval
  }

  // Something else owned the port: the hooks must follow the app to the one it got.
  function onListening(port) {
    if (port === settings().port) return;
    const taken = settings().port;
    saveSettings({ port });
    if (settings().manageHooks) connection.connect({ quiet: true });
    say(`Port ${taken} was taken. Moved to ${port}; restart open Claude Code sessions.`, 8000);
  }

  return {
    tick,
    recoverSessions,
    trackHosts,
    onListening,
    agentEnabled,
    resetNudge: () => {
      nudged = false;
    },
  };
}

module.exports = { createLifecycle };
