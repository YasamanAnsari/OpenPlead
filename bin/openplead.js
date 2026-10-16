#!/usr/bin/env node
// @ts-check
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const USAGE = `usage: openplead <install|start|uninstall|doctor|version|help>

  install     add the hooks to ~/.claude/settings.json (and ~/.cursor/hooks.json when Cursor is enabled)
              and start the pet; pass --no-start to only write the hooks
  start       launch the pet now (the SessionStart hook does this for you once installed)
  uninstall   remove the hooks again
  doctor      check that the app is reachable, the hooks are registered and their command can run
  version     print the version
  help        print this text
`;

// npx keeps packages in a cache it may prune later; the hooks point at this checkout, so they would break.
const IN_NPX_CACHE = /[\\/]_npx[\\/]/.test(ROOT);

// The Electron this release was built and tested with: pinned exactly in package.json, never a range.
const ELECTRON_VERSION = require('../package.json').devDependencies.electron;
// The npx that came with the running node (a hook shell often has no PATH to speak of).
/** @returns {string} */
function npxCommand() {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const beside = path.join(path.dirname(process.execPath), npx);
  return fs.existsSync(beside) ? beside : npx;
}
// A dev checkout has electron installed locally; a global npm install runs the pinned version through npx.
/** @param {string[]} extra @returns {[string, string[]]} */
function electronCommand(extra) {
  try {
    return [String(require('electron')), [ROOT, ...extra]]; // resolves to the binary path when required from Node
  } catch {
    return [npxCommand(), ['--yes', `electron@${ELECTRON_VERSION}`, ROOT, ...extra]];
  }
}
// A global install has no Electron of its own: fetch the pinned version once, now, with a message, so the first
// session start is not the download. Resolves true when Electron can run.
function ensureElectron() {
  try {
    require('electron');
    return true;
  } catch {
    // ignored: not a checkout; fetched through npx below
  }
  console.log(`Fetching Electron ${ELECTRON_VERSION} once (about 100 MB)…`);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const run = spawnSync(npxCommand(), ['--yes', `electron@${ELECTRON_VERSION}`, '--version'], { stdio: 'ignore', env });
  return run.status === 0;
}

function healthUrl() {
  const install = require('../src/system/install');
  return install.hookUrl(require('../src/system/config').load().port).replace(install.HOOK_PATH, '/health');
}

async function waitForApp(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      await getJson(healthUrl(), 500);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return false;
}

// Resolves to null once the app answers on its port, else to the reason it did not.
function start(extra) {
  const [cmd, args] = electronCommand(extra);
  // Inherited from VS Code or Cursor, this variable would turn Electron into plain Node and the launch would die silently.
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', env, windowsHide: true });
    child.on('error', (err) => resolve(`could not run ${cmd}: ${err.message}`));
    child.unref();
    // Up to 10 s for a cold start; the first global-install start also fetches Electron and can take longer.
    waitForApp(10_000).then((up) =>
      resolve(up ? null : 'no answer on its port after 10 s; see ~/.openplead/openplead.log'),
    );
  });
}

function getJson(url, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
  });
}

// One line per check; exit 1 when any check fails.
async function doctor() {
  const install = require('../src/system/install');
  const { cursor, port } = require('../src/system/config').load();
  const checks = [];
  const check = (ok, label, detail) => checks.push({ ok, label, detail });

  let health = null;
  try {
    health = await getJson(install.hookUrl(port).replace(install.HOOK_PATH, '/health'));
    check(true, `app reachable on port ${port}`, `v${health.version}, ${health.sessions} session(s)`);
    if (health.stats)
      check(
        true,
        'record',
        require('../src/core/state')
          .recordLine(health.stats)
          .replace(/^On record: /, ''),
      );
  } catch (err) {
    check(
      false,
      `app reachable on port ${port}`,
      `${err.message}; it starts with the next agent session, or run \`openplead start\``,
    );
  }
  if (health) {
    const age = health.lastHookAt ? `${Math.round((Date.now() - health.lastHookAt) / 1000)} s ago` : 'never';
    check(true, 'last hook event', age);
    if (process.platform === 'darwin') {
      const over = (health.hosts || []).map(require('../src/core/apps').appName).join(', ');
      const where =
        health.showMode !== 'agentFront'
          ? `any app (Settings: ${health.showMode === 'always' ? 'always' : 'whenever a session is open'})`
          : over || 'any app: no session has said where its agent runs';
      const now = health.visible
        ? '; on screen now'
        : health.agentInFront === false
          ? "; hidden now: the agent's app is not in front with a window on screen"
          : '';
      check(true, 'stays over', `${where}${now}`);
      const blind = (health.sessionList || []).filter((s) => !s.host);
      if (health.showMode === 'agentFront' && blind.length)
        check(
          true,
          'sessions with no known app',
          `${blind.map((s) => `${s.id.slice(0, 8)} (${s.agent})`).join(', ')}: the pet shows everywhere until their next prompt`,
        );
    }
  }

  check(install.isInstalled(), 'hooks registered', install.CLAUDE_SETTINGS);
  const invite = Boolean(require('../src/system/config').load().inviteReply); // the reply hooks exist only while on
  check(
    install.isCurrent({ cursor, port, invite }),
    'hooks up to date',
    cursor ? 'Claude Code and Cursor' : 'Claude Code only (Cursor disabled)',
  );

  const cmd = install.command();
  const binary = cmd.match(/"([^"]+)"/)[1];
  const shim = cmd.match(/"([^"]+)"\s*$/)[1];
  check(fs.existsSync(binary), 'hook runtime present', binary);
  check(fs.existsSync(shim), 'hook shim present', shim);

  for (const { ok, label, detail } of checks)
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `: ${detail}` : ''}`);
  return checks.every((c) => c.ok) ? 0 : 1;
}

async function main(cmd) {
  switch (cmd) {
    case 'start': {
      const failed = await start(process.argv.slice(3)); // e.g. --autostart from the SessionStart hook
      if (failed) {
        console.error(`openplead: ${failed}`);
        return 1;
      }
      console.log('OpenPlead is up. Grovel appears when an agent session starts; right-click him for the menu.');
      return 0;
    }
    case 'install': {
      if (IN_NPX_CACHE) {
        console.error(
          'openplead: running from the npx cache, which npm may delete later and break the hooks.\n  Install it for good instead:  npm install -g openplead && openplead install',
        );
        return 1;
      }
      const config = require('../src/system/config');
      const settings = { ...config.load(), manageHooks: true };
      const files = require('../src/system/install').install({
        cursor: settings.cursor,
        port: settings.port,
        invite: Boolean(settings.inviteReply),
      });
      config.save(settings);
      config.requestWelcome(); // the app opens its Welcome tab, now or when it next starts
      if (!ensureElectron())
        console.error('openplead: could not fetch Electron; the pet starts once it can (check your network).');
      console.log(
        `Connected. Entries written to:\n  ${files.join('\n  ')}\nOpen sessions pick them up at their next prompt; restart a session that stays silent.`,
      );
      if (!process.argv.includes('--no-start')) {
        const failed = await start([]);
        if (failed) {
          console.error(`openplead: ${failed}`);
          return 1;
        }
        console.log('Grovel is up and will appear when an agent session starts. A Welcome window explains the rest.');
      }
      return 0;
    }
    case 'uninstall': {
      const cfg = require('../src/system/config');
      cfg.save({ ...cfg.load(), manageHooks: false }); // first, so a running app's watcher does not restore them
      const files = require('../src/system/install').uninstall();
      console.log(`Hooks removed from:\n  ${files.join('\n  ')}`);
      return 0;
    }
    case 'doctor':
      return doctor();
    case 'version':
    case '--version':
    case '-v':
      console.log(require('../package.json').version);
      return 0;
    case 'help':
    case '--help':
    case '-h':
      console.log(USAGE);
      return 0;
    default:
      console.error(USAGE);
      return cmd ? 1 : 0;
  }
}

Promise.resolve()
  .then(() => main(process.argv[2]))
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`openplead: ${err.message}`);
    process.exit(1);
  });
