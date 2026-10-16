// @ts-check
'use strict';

// Agent processes die without a SessionEnd (a crash, a closed terminal, a killed tab). The shim records each
// session's agent pid; the pet asks the OS whether that process still exists, and recovers sessions whose process
// is alive when the pet itself (re)starts, so it wakes up at once instead of waiting for the next hook.

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // alive, owned by someone else
  }
}

// Session ids whose recorded agent process is gone. Sessions with no recorded pid are left to the hook timeouts.
function deadSessions(sessionIds, pidOf, alive = isAlive) {
  return sessionIds.filter((id) => {
    const pid = pidOf(id);
    return Boolean(pid) && !alive(pid);
  });
}

// Remembered sessions worth waking up for: a known, enabled agent, a process that still runs, and a record written
// recently (pids are reused after a reboot, and Cursor's pid is a long-lived helper).
const RECENT_MS = 2 * 60 * 60_000;
function recoverable(records, alive = isAlive, { now = Date.now(), enabled = (_agent) => true } = {}) {
  return records.filter(
    (r) =>
      Boolean(r.pid) && Boolean(r.agent) && enabled(r.agent) && now - (r.mtimeMs || 0) <= RECENT_MS && alive(r.pid),
  );
}

module.exports = { isAlive, deadSessions, recoverable };
