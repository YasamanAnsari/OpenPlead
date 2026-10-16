// @ts-check
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DIR } = require('./config');

// What the hook shim remembers about each agent session, in ~/.openplead/hosts/<session id>: the app it runs in (a
// bundle id on macOS, process names elsewhere), the agent's pid (to notice a death without SessionEnd and to recover
// live sessions at startup) and which agent it is. Written at every session start and prompt, app running or not.

const HOSTS_DIR = path.join(DIR, 'hosts');
const BUNDLE_ID = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
// Windows and Linux identify an app by process name (no ".exe", lower case).
const APP = /^[a-z0-9][a-z0-9 ._-]{0,80}$/;
const MAX_APPS = 8;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const AGENTS = new Set(['claude-code', 'cursor']);
const MAX_AGE_MS = 7 * 24 * 60 * 60_000;

// A value that is not one bundle id is refused: a wrong host would hide the pet over every app, which is
// worse than the fallback of showing it everywhere.
const isBundleId = (v) => typeof v === 'string' && BUNDLE_ID.test(v);
const isPid = (v) => Number.isInteger(v) && v > 1;
const normalizeApp = (s) =>
  String(s || '')
    .trim()
    .replace(/\.exe$/i, '')
    .toLowerCase();
const cleanApps = (list) =>
  [...new Set((Array.isArray(list) ? list : []).map(normalizeApp).filter((a) => APP.test(a)))].slice(0, MAX_APPS);
const fileFor = (dir, id) => (typeof id === 'string' && SESSION_ID.test(id) ? path.join(dir, id) : null);

// One JSON line, or a bare bundle id from an older shim.
function parseRecord(text) {
  const line = String(text).trim();
  if (!line) return null;
  if (line[0] !== '{') return isBundleId(line) ? { host: line, apps: [], pid: null, agent: null } : null;
  try {
    const r = JSON.parse(line);
    const record = {
      host: isBundleId(r.host) ? r.host : null,
      apps: cleanApps(r.apps),
      pid: isPid(r.pid) ? r.pid : null,
      agent: AGENTS.has(r.agent) ? r.agent : null,
    };
    return record.host || record.pid || record.apps.length ? record : null;
  } catch {
    return null;
  }
}

function savedSession(id, dir = HOSTS_DIR) {
  const file = fileFor(dir, id);
  if (!file) return null;
  try {
    return parseRecord(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function forgetHost(id, dir = HOSTS_DIR) {
  const file = fileFor(dir, id);
  if (!file) return;
  try {
    fs.unlinkSync(file);
  } catch {
    // ignored: already gone, or never written
  }
}

// Every remembered session, for recovery at startup.
function liveSessions(dir = HOSTS_DIR) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const id of names) {
    const record = savedSession(id, dir);
    if (!record) continue;
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(path.join(dir, id)).mtimeMs;
    } catch {
      // ignored: raced with a session ending
    }
    out.push({ id, ...record, mtimeMs });
  }
  return out;
}

// Sessions that never sent session_end (a crash, a machine switched off) leave files behind: drop old ones.
function sweep(now = Date.now(), dir = HOSTS_DIR) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      if (now - fs.statSync(file).mtimeMs > MAX_AGE_MS) {
        fs.unlinkSync(file);
        removed += 1;
      }
    } catch {
      // ignored: raced with a shim writing it, or an odd entry
    }
  }
  return removed;
}

module.exports = {
  isBundleId,
  normalizeApp,
  parseRecord,
  savedSession,
  forgetHost,
  liveSessions,
  sweep,
};
