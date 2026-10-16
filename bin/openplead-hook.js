#!/usr/bin/env node
// @ts-check
'use strict';

// Hook shim: reads the hook payload on stdin, forwards it to the running app and prints the reply. Anything wrong
// prints {} and exits 0 within 1.5 s, so the agent is never blocked. A Claude Code SessionStart (async, cannot block)
// launches the app and waits up to 8 s for it; prompts and Cursor session starts launch it without waiting.
// At every session start and prompt it also writes ~/.openplead/hosts/<session id> (see src/system/hosts.js): the
// app the session runs in, the agent's pid and which agent it is. The http hooks cannot carry this: Claude Code
// interpolates only upper-case variables into hook headers.

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const DEADLINE_MS = 1500;
const AUTOSTART_DEADLINE_MS = 8000;
const RETRY_MS = 250;
const DEFAULT_PORT = 47821;
const PS_MS = 200; // per `ps` call while looking for the agent's process: at most four, inside the deadline

const LAUNCH_EVENTS = new Set(['sessionStart', 'SessionStart', 'beforeSubmitPrompt', 'UserPromptSubmit']);
const REMEMBER_AT = new Set(['SessionStart', 'sessionStart', 'UserPromptSubmit', 'beforeSubmitPrompt']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'fish', 'ksh', 'tcsh', 'csh', 'cmd', 'powershell', 'pwsh']);
// Not apps anyone works in: the agent's own runtime, service managers, remote logins, the desktop shell.
const NOISE = new Set([
  'node',
  'claude',
  'cursor-agent',
  'npx',
  'python',
  'python3',
  'conhost',
  'systemd',
  'init',
  'launchd',
  'sshd',
  'login',
  'sudo',
  'su',
  'tmux',
  'screen',
  'explorer',
  'services',
  'svchost',
  'wininit',
]);
const BUNDLE_ID = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(os.homedir(), '.openplead', 'config.json'), 'utf8'));
  } catch {
    return {};
  }
}

function port(config) {
  if (process.env.OPENPLEAD_PORT) return Number(process.env.OPENPLEAD_PORT);
  return config.port || DEFAULT_PORT;
}

// A packaged app records what to launch (see src/system/install.js launchSpec). Otherwise, packaged: this file is unpacked
// beside app.asar, so walk up to the app executable; a checkout or npm install: go through bin/openplead.js.
function launchCommand(config) {
  if (config.launch && typeof config.launch.cmd === 'string')
    return [config.launch.cmd, config.launch.args || ['--autostart']];
  if (__dirname.includes('app.asar.unpacked')) {
    const resources = path.resolve(__dirname, '..', '..');
    if (process.platform === 'darwin') return [path.join(resources, '..', 'MacOS', 'OpenPlead'), ['--autostart']];
    return [path.join(resources, '..', process.platform === 'win32' ? 'OpenPlead.exe' : 'openplead'), ['--autostart']];
  }
  return [process.execPath, [path.join(__dirname, 'openplead.js'), 'start', '--autostart']];
}

// Inherited from VS Code or Cursor, this variable would turn Electron into plain Node and the launch would die silently.
function childEnv() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function launchApp(config) {
  const [cmd, args] = launchCommand(config);
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true, env: childEnv() });
  child.on('error', () => {});
  child.unref();
}

const normalizeApp = (s) =>
  String(s || '')
    .trim()
    .replace(/\.exe$/i, '')
    .toLowerCase();
const isApp = (a) => a && !SHELLS.has(a) && !NOISE.has(a);

// POSIX: the parent process and its command name.
function psParent(pid) {
  try {
    const out = execFileSync('ps', ['-o', 'ppid=,comm=', '-p', String(pid)], { encoding: 'utf8', timeout: PS_MS });
    const m = /^\s*(\d+)\s+(.*)$/.exec(out.trim());
    return m ? { ppid: Number(m[1]), comm: normalizeApp(path.basename(m[2].trim())) } : null;
  } catch {
    return null;
  }
}

// The agent's own process: the hook runs under a shell the agent spawned, so walk up past shells. Lets the pet notice
// an agent that died without a SessionEnd and recover live sessions when it starts.
function agentPid() {
  let pid = process.ppid;
  for (let depth = 0; depth < 4 && pid > 1; depth += 1) {
    const parent = psParent(pid);
    if (!parent) return null;
    if (!SHELLS.has(parent.comm)) return pid;
    pid = parent.ppid;
  }
  return null;
}

// Linux has no bundle id: the pet stays over the apps in the hook's ancestry instead (the terminal, the editor).
function linuxApps() {
  const apps = [];
  let pid = process.ppid;
  for (let depth = 0; depth < 8 && pid > 1; depth += 1) {
    let stat;
    try {
      apps.push(normalizeApp(fs.readFileSync(`/proc/${pid}/comm`, 'utf8')));
      stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    } catch {
      break;
    }
    const after = stat
      .slice(stat.lastIndexOf(')') + 1)
      .trim()
      .split(/\s+/); // "pid (comm) state ppid ..."
    pid = Number(after[1]);
    if (!pid) break;
  }
  return [...new Set(apps.filter(isApp))].slice(0, 8);
}

// Windows: the same, from a process table; too slow for the hook itself, so it runs in the background (--record).
function windowsRecord(fromPid) {
  const script =
    'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.Name)" }';
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  });
  const table = new Map();
  for (const line of out.split(/\r?\n/)) {
    const m = /^(\d+) (\d+) (.+)$/.exec(line.trim());
    if (m) table.set(Number(m[1]), { ppid: Number(m[2]), name: normalizeApp(m[3]) });
  }
  const apps = [];
  let pid = null;
  let cur = fromPid;
  for (let depth = 0; depth < 8 && table.has(cur); depth += 1) {
    const { ppid, name } = table.get(cur);
    if (pid === null && !SHELLS.has(name)) pid = cur; // the first non-shell ancestor is the agent
    apps.push(name);
    cur = ppid;
  }
  return { apps: [...new Set(apps.filter(isApp))].slice(0, 8), pid };
}

function writeRecord(id, record) {
  if (!record.host && !record.pid && !record.apps.length) return;
  const dir = path.join(os.homedir(), '.openplead', 'hosts');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, id), `${JSON.stringify(record)}\n`);
}

function rememberSession(payload) {
  let p;
  try {
    p = JSON.parse(payload.toString());
  } catch {
    return;
  }
  if (!p || !REMEMBER_AT.has(p.hook_event_name)) return;
  const id = p.session_id || p.conversation_id;
  if (typeof id !== 'string' || !SESSION_ID.test(id)) return;
  const bundle = process.env.__CFBundleIdentifier;
  const host = bundle && BUNDLE_ID.test(bundle) ? bundle : null;
  const agent = p.cursor_version ? 'cursor' : 'claude-code';
  if (process.platform === 'win32') {
    // Finished by a detached copy of this script, so the hook itself is never held up by PowerShell.
    const job = JSON.stringify({ id, host, agent, from: process.ppid });
    const child = spawn(process.execPath, [__filename, '--record', job], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: childEnv(),
    });
    child.on('error', () => {});
    child.unref();
    return;
  }
  writeRecord(id, { host, apps: process.platform === 'linux' ? linuxApps() : [], pid: agentPid(), agent });
}

if (process.argv[2] === '--record') {
  try {
    const { id, host, agent, from } = JSON.parse(process.argv[3]);
    if (typeof id === 'string' && SESSION_ID.test(id)) {
      const { apps, pid } = windowsRecord(Number(from));
      writeRecord(id, { host: host || null, apps, pid, agent });
    }
  } catch {
    // best effort: the record only helps the pet find the app; the hook must not fail
  }
  process.exit(0);
}

let done = false;
function finish(body) {
  if (done) return;
  done = true;
  process.stdout.write(body || '{}');
  process.exit(0);
}

const config = readConfig();

// macOS gives every process the bundle id of the app it was started from (Cursor, Terminal, iTerm...).
// The pet uses it to show only while that app is in front.
function withHost(payload) {
  const host = process.env.__CFBundleIdentifier;
  if (!host) return payload;
  try {
    return Buffer.from(JSON.stringify({ ...JSON.parse(payload.toString()), openplead_host: host }));
  } catch {
    return payload;
  }
}

function post(payload, onReply, onError) {
  const req = http.request(
    {
      host: '127.0.0.1',
      port: port(config),
      path: '/hook',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    },
    (res) => {
      const out = [];
      res.on('data', (c) => out.push(c));
      res.on('end', () => onReply(res.statusCode === 200 ? Buffer.concat(out).toString() : '{}'));
    },
  );
  req.on('error', onError);
  req.end(payload);
}

// 'wait': launch and hold this event until the app takes it (Claude Code SessionStart is async).
// 'launch': launch and return at once; Cursor may run the hook synchronously, so it must not wait.
function launchMode(payload) {
  let p;
  try {
    p = JSON.parse(payload.toString());
  } catch {
    return null;
  }
  if (!p.cursor_version) {
    if (p.hook_event_name === 'SessionStart') return 'wait';
    return p.hook_event_name === 'UserPromptSubmit' ? 'launch' : null;
  }
  return config.cursor !== false && LAUNCH_EVENTS.has(p.hook_event_name) ? 'launch' : null;
}

const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('error', () => finish('{}'));
process.stdin.on('end', () => {
  const payload = withHost(Buffer.concat(chunks));
  const mode = launchMode(payload);
  // The deadline comes first; it also bounds the record step below. finish() exits, so nothing leaks.
  setTimeout(() => finish('{}'), mode === 'wait' ? AUTOSTART_DEADLINE_MS : DEADLINE_MS);
  try {
    rememberSession(payload);
  } catch {
    // best effort: the pet then shows everywhere for this session and cannot see it die
  }
  post(payload, finish, () => {
    if (!mode) return finish('{}');
    launchApp(config);
    if (mode === 'launch') return finish('{}');
    const retry = () => post(payload, finish, () => setTimeout(retry, RETRY_MS));
    setTimeout(retry, RETRY_MS);
  });
});
