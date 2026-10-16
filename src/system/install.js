// @ts-check
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const config = require('./config');

// Installs the hooks into ~/.claude/settings.json (Claude Code) and ~/.cursor/hooks.json (Cursor). Claude Code gets
// HTTP hooks that POST straight to the app, plus two command hooks through the shim: SessionStart (launches the app)
// and UserPromptSubmit (records the session's host, see hosts.js). Cursor cannot import HTTP hooks, so every entry
// goes through the shim. Each entry carries MARKER, so install/uninstall touch only our own entries; a .bak copy is
// written before each change.

const MARKER = 'openplead';
const SHIM_NAME = 'openplead-hook.js';
// In a packaged app the shim is unpacked next to app.asar (see asarUnpack in package.json) so node can run it.
const SHIM = path.join(__dirname, '..', '..', 'bin', SHIM_NAME).replace('app.asar', 'app.asar.unpacked');
const CLAUDE_SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const CURSOR_HOOKS = path.join(os.homedir(), '.cursor', 'hooks.json');
const HOOK_PATH = '/openplead/hook';

// All synchronous with a short timeout: the app answers in milliseconds, and a connection refused returns
// at once. (async only exists for command hooks, and Claude Code exits without waiting for those anyway.)
const CLAUDE_HOOKS = [
  { event: 'SessionStart', command: true, async: true },
  { event: 'UserPromptSubmit', command: true },
  { event: 'PreToolUse' },
  { event: 'PostToolUse' },
  { event: 'PostToolUseFailure' },
  { event: 'Stop' },
  { event: 'StopFailure' },
  { event: 'Notification', matcher: 'permission_prompt|idle_prompt' },
  // The assistant's text as it is displayed: registered only while "Ask Claude to reply" is on, and fires often.
  { event: 'MessageDisplay', invite: true },
  { event: 'SessionEnd' },
];
// No beforeShellExecution / beforeMCPExecution: those require a permission decision in the reply and
// block the command otherwise, and "allow" or "ask" would change what the user sees. We never decide.
const CURSOR_NATIVE = [
  'sessionStart',
  'sessionEnd',
  'beforeSubmitPrompt',
  'preToolUse',
  'postToolUse',
  'postToolUseFailure',
  'stop',
];
const CURSOR_INVITE = ['afterAgentResponse']; // the assistant's text, per message; only with the invitation on
const HOOK_TIMEOUT_S = 3;

// Absolute node path: hook shells often lack the user's nvm/volta PATH. From inside Electron, process.execPath is
// Electron itself, so look for node on this process's PATH, then ask the user's own login shell (which reads the rc
// files where nvm and Homebrew live), and failing both keep the absolute path already in our entries. Looked up once
// per process: the settings window re-checks the entries every two seconds.
const executable = (file) => {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};
function findNode({ env = process.env, shell = env.SHELL, run = execFileSync, installed = installedNode } = {}) {
  const exe = process.platform === 'win32' ? 'node.exe' : 'node';
  for (const dir of String(env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)) {
    const candidate = path.join(dir, exe);
    if (executable(candidate)) return candidate;
  }
  if (process.platform !== 'win32') {
    for (const sh of [shell, '/bin/zsh', '/bin/bash'].filter(Boolean)) {
      try {
        const out = run(sh, ['-ilc', 'command -v node'], {
          encoding: 'utf8',
          timeout: 5000,
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        const line = String(out).trim().split('\n').pop();
        if (line && path.isAbsolute(line) && executable(line)) return line;
      } catch {
        // ignored: try the next shell
      }
    }
  }
  return installed() || 'node';
}
// The node our current Claude Code entry runs, if it is an absolute path that still exists.
function installedNode() {
  try {
    const hooks = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8')).hooks || {};
    for (const group of Object.values(hooks).flat())
      for (const h of (group && group.hooks) || []) {
        const m = typeof h.command === 'string' && h.command.includes(MARKER) && /^"([^"]+)"/.exec(h.command);
        if (m && path.isAbsolute(m[1]) && executable(m[1])) return m[1];
      }
  } catch {
    // ignored: no settings file yet
  }
  return null;
}
let nodeCache = null;
function nodeBinary() {
  if (!process.versions.electron) return process.execPath;
  if (!nodeCache) nodeCache = findNode();
  return nodeCache;
}

// A packaged app runs the shim with its own binary in Node mode, so users need no Node at all.
// Limitation: the env-prefix form is POSIX only; Windows packaged builds still look up node on PATH.
const isPackaged = () => Boolean(process.versions.electron) && __dirname.includes('app.asar');

// macOS runs an unsigned app from Downloads at a random AppTranslocation path, and a DMG from /Volumes; both vanish.
// Hook entries pointing there break after a restart, so connecting from such a place is refused with the fix.
function unsafeLocation({ platform = process.platform, execPath = process.execPath, packaged = isPackaged() } = {}) {
  if (!packaged || platform !== 'darwin') return null;
  if (execPath.includes('/AppTranslocation/') || execPath.startsWith('/Volumes/'))
    return 'Move OpenPlead to the Applications folder first, then connect.';
  return null;
}

// What the shim should launch when the app is not running. An AppImage is mounted at a path that vanishes on exit,
// so the AppImage file itself (electron-builder exports APPIMAGE) is the thing to run, not the mounted binary.
function launchSpec({
  platform = process.platform,
  env = process.env,
  execPath = process.execPath,
  packaged = isPackaged(),
} = {}) {
  if (!packaged) return null;
  const cmd = platform === 'linux' && env.APPIMAGE ? env.APPIMAGE : execPath;
  return { cmd, args: ['--autostart'] };
}

// The shim the hooks run. Inside an AppImage it would vanish with the mount, so a copy lives next to the config.
function shimPath({ env = process.env, packaged = isPackaged(), source = SHIM, copy = false } = {}) {
  if (!(packaged && env.APPIMAGE)) return source;
  const target = path.join(config.DIR, SHIM_NAME);
  if (copy) {
    // Written whole and renamed into place: a hook starting mid-copy must never load half a file.
    fs.mkdirSync(config.DIR, { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    fs.copyFileSync(source, tmp);
    fs.renameSync(tmp, target);
  }
  return target;
}

function command() {
  const packaged = isPackaged();
  const shim = shimPath();
  if (packaged && process.platform !== 'win32') return `ELECTRON_RUN_AS_NODE=1 "${launchSpec().cmd}" "${shim}"`;
  return `"${nodeBinary()}" "${shim}"`;
}

function hookUrl(port) {
  return `http://127.0.0.1:${port}${HOOK_PATH}`;
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// The settings files are read, merged and written back, so anything we cannot merge safely stops the
// install with a message naming the file, rather than being skipped or overwritten.
function readJson(file) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new Error(`${file} is not valid JSON (${err.message}); fix or move it and retry`);
  }
  if (!isObject(data) || (data.hooks != null && !isObject(data.hooks))) {
    throw new Error(
      `${file} does not look like a settings file (expected an object with a "hooks" object); fix or move it and retry`,
    );
  }
  for (const [event, groups] of Object.entries(data.hooks || {})) {
    const list = Array.isArray(groups) ? groups : null;
    if (!list || !list.every((g) => isObject(g) && (g.hooks === undefined || Array.isArray(g.hooks)))) {
      throw new Error(`${file}: "hooks.${event}" is not a list of hook entries; fix or move it and retry`);
    }
  }
  return data;
}

// Structural comparison: the agents may reformat their files, and that must not count as a change.
function sameJson(file, data) {
  try {
    return JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8'))) === JSON.stringify(data);
  } catch {
    return false;
  }
}

// Returns true when the file changed. Unchanged content is not rewritten, so re-registering on every
// launch is free and does not trigger the agents' own config watchers.
// Written beside the real file and renamed over it: the agents watch these files, and a reader must never see a half
// written one. A symlinked dotfile is resolved first, so the link survives.
function writeJson(file, data) {
  if (sameJson(file, data)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const real = fs.existsSync(file) ? fs.realpathSync(file) : file;
  if (fs.existsSync(real)) fs.copyFileSync(real, `${real}.bak`);
  const tmp = `${real}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, real);
  return true;
}

const isOurs = (h) => [h.command, h.url].some((s) => typeof s === 'string' && s.includes(MARKER));

function stripClaude(hooks) {
  const out = {};
  for (const [event, groups] of Object.entries(hooks || {})) {
    const kept = (groups || [])
      .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isOurs(h)) }))
      .filter((g) => g.hooks.length);
    if (kept.length) out[event] = kept;
  }
  return out;
}

function stripCursor(hooks) {
  const out = {};
  for (const [event, list] of Object.entries(hooks || {})) {
    const kept = (list || []).filter((h) => !isOurs(h));
    if (kept.length) out[event] = kept;
  }
  return out;
}

function claudeEntries(port, invite = false) {
  const hooks = {};
  for (const { event, command: isCommand, async, matcher, invite: needsInvite } of CLAUDE_HOOKS) {
    if (needsInvite && !invite) continue;
    const hook = isCommand
      ? { type: 'command', command: command() }
      : { type: 'http', url: hookUrl(port), timeout: HOOK_TIMEOUT_S };
    if (isCommand && !async) hook.timeout = HOOK_TIMEOUT_S;
    if (async) hook.async = true;
    const group = { hooks: [hook] };
    if (matcher) group.matcher = matcher;
    hooks[event] = [group];
  }
  return hooks;
}

// What both files should contain: the user's other hooks untouched, ours added (Cursor's only when enabled).
function desired({ cursor, port, invite = false }) {
  const settings = readJson(CLAUDE_SETTINGS);
  const hooks = stripClaude(settings.hooks);
  for (const [event, groups] of Object.entries(claudeEntries(port, invite)))
    hooks[event] = [...(hooks[event] || []), ...groups];
  const out = [[CLAUDE_SETTINGS, { ...settings, hooks }]];

  const cursorFile = readJson(CURSOR_HOOKS);
  const cursorHooks = stripCursor(cursorFile.hooks);
  if (cursor) {
    for (const event of [...CURSOR_NATIVE, ...(invite ? CURSOR_INVITE : [])])
      cursorHooks[event] = [...(cursorHooks[event] || []), { command: command(), timeout: HOOK_TIMEOUT_S }];
  }
  if (cursor || cursorFile.hooks) out.push([CURSOR_HOOKS, { version: 1, ...cursorFile, hooks: cursorHooks }]);
  return out;
}

// Claude Code hooks always; the native Cursor entries only when Cursor support is enabled.
function install({ cursor = false, port = 47821, invite = false } = {}) {
  shimPath({ copy: true });
  const files = desired({ cursor, port, invite });
  for (const [file, data] of files) writeJson(file, data);
  return files.map(([file]) => file);
}

// True when both files already hold exactly what install() would write (used by the repair watcher).
// A file we cannot read or merge counts as "not current"; install() then reports why.
function isCurrent({ cursor = false, port = 47821, invite = false } = {}) {
  try {
    return desired({ cursor, port, invite }).every(([file, data]) => sameJson(file, data));
  } catch {
    return false;
  }
}

function uninstall() {
  const settings = readJson(CLAUDE_SETTINGS);
  if (settings.hooks) writeJson(CLAUDE_SETTINGS, { ...settings, hooks: stripClaude(settings.hooks) });
  const cursor = readJson(CURSOR_HOOKS);
  if (cursor.hooks) writeJson(CURSOR_HOOKS, { ...cursor, hooks: stripCursor(cursor.hooks) });
  return [CLAUDE_SETTINGS, CURSOR_HOOKS];
}

function isInstalled() {
  try {
    const hooks = readJson(CLAUDE_SETTINGS).hooks || {};
    return Object.values(hooks).some((groups) => (groups || []).some((g) => (g.hooks || []).some(isOurs)));
  } catch {
    return false;
  }
}

// Agents and other tools rewrite their settings files; when ours change, `onChange` runs once the writes settle.
// Watching the directories (not the files) survives editors that replace the file on save.
const REPAIR_DEBOUNCE_MS = 5000;
function watchHookFiles({ onChange, onError }) {
  const watchers = [];
  let timer = null;
  for (const file of [CLAUDE_SETTINGS, CURSOR_HOOKS]) {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) continue;
    const watcher = fs.watch(dir, (_event, name) => {
      if (name !== path.basename(file) || timer) return;
      timer = setTimeout(() => {
        timer = null;
        onChange();
      }, REPAIR_DEBOUNCE_MS);
    });
    watcher.on('error', onError);
    watchers.push(watcher);
  }
  return () => {
    clearTimeout(timer);
    for (const w of watchers) w.close();
  };
}

module.exports = {
  unsafeLocation,
  findNode,
  launchSpec,
  shimPath,
  install,
  uninstall,
  watchHookFiles,
  isInstalled,
  isCurrent,
  command,
  hookUrl,
  CLAUDE_SETTINGS,
  CURSOR_HOOKS,
  HOOK_PATH,
};
