// @ts-check
'use strict';

// What main knows about each live session beyond the reducer's view: the app it runs in (so the pet can stay over
// it), the agent's process id (so a silent death is noticed) and whether its record on disk has been read. Learned
// from the hook itself when it carries a host, else from the record the shim wrote (hosts.js), read once per session
// and again at each prompt so a pet started after the session, or upgraded under it, still catches up.

function createSessionRegistry({ store, platform = process.platform }) {
  const hosts = new Map(); // session id -> app identities (a bundle id, or process names)
  const pids = new Map(); // session id -> the agent's process id
  const read = new Set(); // sessions whose record has been read

  function learn(sessionId, fromHook, kind) {
    if (store.isBundleId(fromHook)) hosts.set(sessionId, [fromHook]);
    if (read.has(sessionId) && kind !== 'turn_start') return;
    read.add(sessionId);
    const saved = store.savedSession(sessionId);
    if (!saved) return;
    const ids = platform === 'darwin' ? (saved.host ? [saved.host] : []) : saved.apps || [];
    if (ids.length && !hosts.has(sessionId)) hosts.set(sessionId, ids);
    if (saved.pid) pids.set(sessionId, saved.pid);
  }

  // Drops everything about sessions the reducer no longer has. `ended` is the session a session_end just closed
  // (its record is forgotten by the caller); `keepHosts` keeps the last host while the goodbye wave plays over it.
  function prune(sessions, { ended = null, keepHosts = false } = {}) {
    for (const id of read) {
      if (sessions[id]) continue;
      read.delete(id);
      pids.delete(id);
      if (id !== ended) store.forgetHost(id);
    }
    if (!keepHosts) for (const id of hosts.keys()) if (!sessions[id]) hosts.delete(id);
  }

  function end(sessionId) {
    store.forgetHost(sessionId);
  }

  const appOf = (sessionId) => (sessionId && (hosts.get(sessionId) || [])[0]) || null;
  const appIds = () => [...new Set([...hosts.values()].flat())];
  const pidOf = (sessionId) => pids.get(sessionId) || null;
  const hasHost = (sessionId) => hosts.has(sessionId);
  const hostCount = () => hosts.size;

  return { learn, prune, end, appOf, appIds, pidOf, hasHost, hostCount };
}

module.exports = { createSessionRegistry };
