// @ts-check
'use strict';

const fs = require('node:fs');
const { spawn, execFile } = require('node:child_process');
const { normalizeApp } = require('./hosts');

// Is the pet welcome on screen? Only while the app the agent runs in (see hosts.js) is the front app with a window
// on screen. One long-lived probe per platform: osascript (JXA) on macOS, PowerShell + user32 on Windows, Hyprland
// and sway IPC or xprop on Linux. Other Wayland compositors have no active-window API: no probe, the pet shows
// everywhere. The Windows and Linux probes follow the documented interfaces and are not yet verified on hardware.

const POLL_MS = 750;
const REQUEST_TIMEOUT_MS = 2000;
const FIRST_ANSWER_MS = 8000; // a cold PowerShell start plus the Add-Type compile can take seconds
const BACKOFF_MS = [2000, 5000, 15000, 60000]; // between restarts of a helper that keeps failing
const MAX_FAILURES = 3; // answers missed in a row before the pet gives up hiding

// macOS helper. One probe per input line; prints one JSON line: { front, frontPid, visible }.
// NSData.length arrives as a string in JXA, hence Number(); 17 = on-screen windows only, without desktop elements.
const MAC_HELPER = `
ObjC.import('AppKit');
ObjC.import('CoreGraphics');
const stdin = $.NSFileHandle.fileHandleWithStandardInput;
const stdout = $.NSFileHandle.fileHandleWithStandardOutput;
const id = (app) => { const b = app.bundleIdentifier; return b.isNil() ? null : b.js; };
const probe = () => {
  const front = $.NSWorkspace.sharedWorkspace.frontmostApplication;
  const windows = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(17, 0))) || [];
  const pids = new Set(windows
    .filter((w) => w.kCGWindowLayer === 0 && w.kCGWindowAlpha > 0 && w.kCGWindowBounds && w.kCGWindowBounds.Height > 40)
    .map((w) => w.kCGWindowOwnerPID));
  const visible = [...new Set([...pids].map((pid) => {
    const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
    return app.isNil() ? null : id(app);
  }).filter(Boolean))];
  return { front: front.isNil() ? null : id(front), frontPid: front.isNil() ? 0 : front.processIdentifier, visible };
};
while (true) {
  const data = stdin.availableData;
  if (Number(data.length) === 0) break;
  let line;
  try { line = JSON.stringify(probe()); } catch (err) { line = '{}'; }
  stdout.writeData($(line + '\\n').dataUsingEncoding($.NSUTF8StringEncoding));
}
`;

// Windows helper, same protocol; process names without ".exe", lower-cased by parseProbe. Names are looked up afresh
// on every probe: Windows reuses pids quickly.
const WIN_HELPER = `
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Collections.Generic;
public class OpenPleadWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  public static List<uint> Visible() {
    var r = new List<uint>();
    EnumWindows((h, l) => { if (IsWindowVisible(h) && !IsIconic(h)) { uint p; GetWindowThreadProcessId(h, out p); r.Add(p); } return true; }, IntPtr.Zero);
    return r;
  }
}
"@
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $names = @{}
  function Name($p) { if (-not $names.ContainsKey($p)) { try { $names[$p] = (Get-Process -Id $p -ErrorAction Stop).ProcessName } catch { $names[$p] = $null } } $names[$p] }
  $fp = [uint32]0
  [void][OpenPleadWin]::GetWindowThreadProcessId([OpenPleadWin]::GetForegroundWindow(), [ref]$fp)
  $visible = @([OpenPleadWin]::Visible() | Sort-Object -Unique | ForEach-Object { Name $_ } | Where-Object { $_ } | Sort-Object -Unique)
  $out = @{ front = (Name $fp); frontPid = [int]$fp; visible = $visible } | ConvertTo-Json -Compress
  [Console]::Out.WriteLine($out)
}
`;

// Process names are compared without ".exe" and case-insensitively; bundle ids (macOS) are left alone.
function parseProbe(line, { names = false } = {}) {
  try {
    const p = JSON.parse(line);
    if (!p || typeof p.front !== 'string') return null;
    const list = Array.isArray(p.visible) ? p.visible : typeof p.visible === 'string' ? [p.visible] : [];
    const norm = names ? normalizeApp : (v) => v;
    return {
      front: norm(p.front),
      frontPid: Number(p.frontPid) || 0,
      visible: list.filter((v) => typeof v === 'string').map(norm),
    };
  } catch {
    return null;
  }
}

// X11: the active window id, then its owner pid and whether it is hidden (minimised or on another desktop).
const parseXpropActive = (out) => (/window id # (0x[0-9a-f]+)/i.exec(out) || [])[1] || null;
function parseXpropWindow(out) {
  const pid = Number((/_NET_WM_PID\(CARDINAL\) = (\d+)/.exec(out) || [])[1]);
  return pid ? { pid, hidden: /_NET_WM_STATE_HIDDEN/.test(out) } : null;
}
// Hyprland: `hyprctl activewindow -j`; sway: the focused node of `swaymsg -t get_tree`.
function parseHyprland(json) {
  try {
    const w = JSON.parse(json);
    return w && Number(w.pid) > 0 ? { pid: Number(w.pid), hidden: false } : null;
  } catch {
    return null;
  }
}
function parseSway(json) {
  try {
    const walk = (node) => {
      if (!node || typeof node !== 'object') return null;
      if (node.focused && Number(node.pid) > 0) return { pid: Number(node.pid), hidden: false };
      for (const child of [...(node.nodes || []), ...(node.floating_nodes || [])]) {
        const hit = walk(child);
        if (hit) return hit;
      }
      return null;
    };
    return walk(JSON.parse(json));
  } catch {
    return null;
  }
}

const commOf = (pid, readFile = fs.readFileSync) => {
  try {
    return normalizeApp(readFile(`/proc/${pid}/comm`, 'utf8'));
  } catch {
    return null;
  }
};

// A long-lived helper (macOS, Windows): started on the first request, restarted after a failure with growing pauses,
// one request in flight at a time. The first answer gets a longer timeout: it includes the helper's start-up.
function createHelperProbe({
  command,
  args,
  spawnProcess = spawn,
  names = false,
  now = Date.now,
  firstAnswerMs = FIRST_ANSWER_MS,
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
}) {
  let child = null;
  let buffer = '';
  let waiting = null; // { cb, timer }
  let fresh = false; // no answer yet from this helper process
  let failures = 0;
  let nextSpawnAt = 0;
  const settle = (err, value) => {
    const w = waiting;
    waiting = null;
    if (!w) return;
    clearTimeout(w.timer);
    w.cb(err, value);
  };
  const drop = (reason) => {
    const c = child;
    child = null;
    if (c) c.kill();
    settle(new Error(reason));
  };
  const fail = (reason) => {
    failures += 1;
    nextSpawnAt = now() + BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1];
    drop(reason);
  };
  function ensure() {
    if (child) return;
    fresh = true;
    const c = spawnProcess(command, args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    child = c;
    buffer = '';
    c.stdin.on('error', () => {}); // a dead helper: the exit handler restarts it on the next request
    c.stdout.on('data', (chunk) => {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        fresh = false;
        failures = 0;
        settle(null, parseProbe(line, { names }));
      }
    });
    c.on('error', () => fail('helper failed to start'));
    c.on('exit', () => {
      if (child === c) fail('helper exited');
    });
  }
  function request(cb) {
    if (waiting) return cb(new Error('probe busy'));
    if (!child && now() < nextSpawnAt) return cb(new Error('helper backing off'));
    ensure();
    const timer = setTimeout(() => fail('helper timed out'), fresh ? firstAnswerMs : requestTimeoutMs);
    waiting = { cb, timer };
    child.stdin.write('\n');
  }
  return { request, stop: () => drop('stopped') };
}

// Linux: one short command per request (two for X11). The front app and whether it is hidden; nothing else is
// cheap to know, so "visible" is the front app itself unless it is hidden.
function createLinuxProbe({ env = process.env, run = execFile, readFile = fs.readFileSync } = {}) {
  const exec = (cmd, args, cb) =>
    run(cmd, args, { timeout: REQUEST_TIMEOUT_MS }, (err, out) => cb(err, err ? '' : String(out)));
  const answer = (cb, win) => {
    if (!win) return cb(null, null);
    const front = commOf(win.pid, readFile);
    if (!front) return cb(null, null);
    cb(null, { front, frontPid: win.pid, visible: win.hidden ? [] : [front] });
  };
  let backend = null;
  if (env.HYPRLAND_INSTANCE_SIGNATURE) {
    backend = (cb) =>
      exec('hyprctl', ['activewindow', '-j'], (err, out) => (err ? cb(err) : answer(cb, parseHyprland(out))));
  } else if (env.SWAYSOCK) {
    backend = (cb) => exec('swaymsg', ['-t', 'get_tree'], (err, out) => (err ? cb(err) : answer(cb, parseSway(out))));
  } else if (env.DISPLAY && env.XDG_SESSION_TYPE !== 'wayland') {
    backend = (cb) =>
      exec('xprop', ['-root', '_NET_ACTIVE_WINDOW'], (err, out) => {
        const id = err ? null : parseXpropActive(out);
        if (!id) return cb(err || new Error('no active window'));
        exec('xprop', ['-id', id, '_NET_WM_PID', '_NET_WM_STATE'], (err2, out2) =>
          err2 ? cb(err2) : answer(cb, parseXpropWindow(out2)),
        );
      });
  }
  return backend ? { request: backend, stop() {} } : null;
}

const encodeCommand = (script) => Buffer.from(script, 'utf16le').toString('base64');

// The probe for this platform, or null when there is none (then the pet shows everywhere).
function createProbe({ platform = process.platform, env = process.env, spawnProcess = spawn } = {}) {
  if (platform === 'darwin')
    return createHelperProbe({ command: 'osascript', args: ['-l', 'JavaScript', '-e', MAC_HELPER], spawnProcess });
  if (platform === 'win32') {
    const args = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      encodeCommand(WIN_HELPER),
    ];
    return createHelperProbe({ command: 'powershell.exe', args, spawnProcess, names: true });
  }
  if (platform === 'linux') return createLinuxProbe({ env });
  return null;
}

// hosts(): the app identities the pet may show over; enabled(): the user's setting; onChange(inFront): redraw.
// `settled` is false from the moment the apps change until the probe has answered once, so a caller can hold the
// screen as it is instead of flashing the pet over the wrong app. A probe that keeps failing stops hiding the pet.
function createFrontWatcher({
  hosts,
  enabled,
  onChange,
  platform = process.platform,
  probe = undefined,
  selfPid = process.pid,
  maxFailures = MAX_FAILURES,
}) {
  let inFront = true;
  let polling = false;
  let settled = true;
  let lastHosts = '';
  let failures = 0;
  const set = (next) => {
    if (next === inFront) return;
    inFront = next;
    onChange(inFront);
  };
  function poll() {
    if (polling || !enabled()) return;
    const known = hosts();
    const key = known.join('|');
    if (key !== lastHosts) {
      lastHosts = key;
      settled = !known.length;
      failures = 0;
    }
    if (!known.length) return set(true);
    if (probe === undefined) probe = createProbe({ platform });
    if (!probe) {
      settled = true;
      return set(true); // no probe for this desktop: the pet shows everywhere
    }
    polling = true;
    probe.request((err, front) => {
      polling = false;
      if (err || !front) {
        if ((failures += 1) >= maxFailures) {
          settled = true;
          set(true); // a broken probe must not hide the pet for good
        }
        return;
      }
      failures = 0;
      settled = true;
      if (front.frontPid === selfPid) return; // the pet itself is in front for a moment after it launches
      const current = hosts(); // the sessions may have changed while the probe ran
      if (!current.length) return set(true);
      set(current.includes(front.front) && front.visible.includes(front.front));
    });
  }
  return {
    poll,
    start: () => setInterval(poll, POLL_MS),
    reset: () => set(true),
    stop: () => probe && probe.stop(),
    get inFront() {
      return inFront;
    },
    get settled() {
      return settled;
    },
  };
}

module.exports = {
  normalizeApp,
  parseProbe,
  parseXpropActive,
  parseXpropWindow,
  parseHyprland,
  parseSway,
  createHelperProbe,
  createLinuxProbe,
  createProbe,
  createFrontWatcher,
};
