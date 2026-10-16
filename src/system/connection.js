// @ts-check
'use strict';

// Whether the agents can reach the app: the hook entries in their settings files, kept installed, current and
// repaired when another tool rewrites those files. The one place that knows if we are connected.

const installer = require('./install');

function createConnection({ settings, save, reloadManageHooks, say, report, onChanged, install = installer }) {
  let installed = false;
  let stopWatching = null;
  let lastCheck = null; // { ok, text, at } from "Check the connection" in Settings

  const options = () => ({ cursor: settings().cursor, port: settings().port, invite: settings().inviteReply });
  const isCurrent = () => install.isCurrent(options());

  // Re-reads the files; `onChanged` is told only when connect or disconnect ran.
  function refresh() {
    installed = install.isInstalled();
  }

  function connect({ quiet = false } = {}) {
    const blocked = install.unsafeLocation ? install.unsafeLocation() : null;
    if (blocked) {
      say(blocked, 10_000);
      refresh();
      onChanged();
      return;
    }
    try {
      install.install(options());
      save({ manageHooks: true, launch: install.launchSpec() });
      watch();
      if (!quiet) say('Connected. Grovel appears when an agent session is alive.', 8000);
    } catch (err) {
      report('installing the hooks', err);
      say(`Could not connect: ${err.message}`, 8000);
    }
    refresh();
    onChanged();
  }

  function disconnect() {
    save({ manageHooks: false }); // first, so the watcher does not put them straight back
    try {
      install.uninstall();
      say('Disconnected.');
    } catch (err) {
      report('removing the hooks', err);
      say(`Could not disconnect: ${err.message}`, 8000);
    }
    refresh();
    onChanged();
  }

  // Our entries vanished from an agent's settings file (another tool rewrote it): put them back.
  function repair() {
    if (!reloadManageHooks()) {
      // `openplead uninstall` ran meanwhile: follow it instead of restoring, and let the window and menu know.
      const was = installed;
      installed = install.isInstalled();
      if (was !== installed) onChanged();
      return;
    }
    if (isCurrent()) return;
    try {
      install.install(options());
      say('Another tool removed the connection. Restored.', 6000);
    } catch (err) {
      report('restoring the hooks', err);
    }
  }

  function watch() {
    if (stopWatching) return;
    stopWatching = install.watchHookFiles({
      onChange: repair,
      onError: (err) => report('watching the hook files', err),
    });
  }

  // The answer in one plain sentence, kept until the next check.
  function check() {
    installed = install.isInstalled();
    const current = installed && isCurrent();
    const text = !installed
      ? 'Not connected. Press Connect to add the hook entries.'
      : !current
        ? 'The hook entries are missing or out of date. Press Connect again.'
        : `Claude Code${settings().cursor ? ' and Cursor' : ''} reach Grovel on port ${settings().port}. The hook entries are in place.`;
    lastCheck = { ok: Boolean(installed && current), text, at: Date.now() };
    return lastCheck;
  }

  function stop() {
    if (stopWatching) stopWatching();
    stopWatching = null;
  }

  return {
    connect,
    disconnect,
    repair,
    check,
    refresh,
    stop,
    isCurrent,
    installed: () => installed,
    lastCheck: () => lastCheck,
  };
}

module.exports = { createConnection };
