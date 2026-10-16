// @ts-check
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DIR } = require('../system/config');

const FILE = path.join(DIR, 'phrases.json');
const DEFAULT_FILE = path.join(__dirname, 'phrases.default.json');

// Seeds ~/.openplead/phrases.json from the defaults on first run so users can edit it. The user's file
// is laid over the defaults, so a set missing from an older or trimmed file still has lines.
function load() {
  if (!fs.existsSync(FILE)) {
    fs.mkdirSync(DIR, { recursive: true });
    fs.copyFileSync(DEFAULT_FILE, FILE);
  }
  const defaults = JSON.parse(fs.readFileSync(DEFAULT_FILE, 'utf8'));
  const user = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  return { ...defaults, ...user, plea: { ...defaults.plea, ...(user.plea || {}) } };
}

// Never the same line twice in a row for the same set.
const lastPicked = new Map();

function pick(list, name) {
  if (!Array.isArray(list) || !list.length) throw new Error(`phrases.json: "${name}" must be a non-empty list`);
  const candidates = list.length > 1 ? list.filter((p) => p !== lastPicked.get(name)) : list;
  const phrase = candidates[Math.floor(Math.random() * candidates.length)];
  lastPicked.set(name, phrase);
  return phrase;
}

// Returns { phrase, text }: phrase is what the pet shows, text what the agent receives, always a fact about the user,
// never a request. A phrase chosen when the item was queued is used verbatim. With the opt-in `invite` one clause is
// added that leaves room for an answer without asking for one.
const INVITE = ' A one-line answer is welcome.';
const INVITED = new Set(['plea', 'thanks', 'hug', 'zen', 'apology']); // not the calm line, the deadline note or the nudge
function render(phrases, kind, level, chosen, { invite = false } = {}) {
  const tail = invite && INVITED.has(kind) ? INVITE : '';
  switch (kind) {
    case 'plea': {
      const phrase = chosen || pick((phrases.plea || {})[String(level)], `plea.${level}`);
      return {
        phrase,
        text: `The user pressed OpenPlead's plead button (level ${level} of 5) and says: "${phrase}"${tail}`,
      };
    }
    default: {
      const phrase = chosen || pick(phrases[kind], kind);
      return { phrase, text: `The user, through OpenPlead, says: "${phrase}"${tail}` };
    }
  }
}

// The sets as the settings window shows and edits them: "plea.1" … "plea.5" and the named sets, one line each.
const KINDS = ['thanks', 'calm', 'deadline', 'thinking', 'suspicious', 'hug', 'zen', 'apology'];
// Each set with a plain name and when Grovel uses it, in the order the settings window lists them.
const SET_INFO = [
  { key: 'plea.1', name: 'Plea 1 · polite', when: 'Your first click' },
  { key: 'plea.2', name: 'Plea 2 · hopeful', when: 'Your second click' },
  { key: 'plea.3', name: 'Plea 3 · worried', when: 'Your third click' },
  { key: 'plea.4', name: 'Plea 4 · desperate', when: 'Your fourth click' },
  { key: 'plea.5', name: 'Plea 5 · sobbing', when: 'Your fifth click, and every one after' },
  { key: 'thanks', name: 'Thank you', when: 'After every finished task, when the switch is on' },
  { key: 'hug', name: "It's okay, carry on", when: 'Reassure, from the menu' },
  { key: 'zen', name: 'Take your time', when: 'Reassure, from the menu' },
  { key: 'apology', name: 'Sorry for my tone', when: 'Reassure, from the menu' },
  { key: 'deadline', name: 'Deadline', when: 'When you set a deadline' },
  { key: 'calm', name: 'Calm down', when: 'After two failures in a row' },
  { key: 'thinking', name: 'Thinking a long time', when: 'After ninety seconds of silence' },
  { key: 'suspicious', name: 'Did the tests really pass?', when: 'After three failures and a clean finish' },
];
const nameOf = (key) => (SET_INFO.find((s) => s.key === key) || { name: key }).name;
const MAX_LINE = 240;

function sets(phrases = load()) {
  const out = {};
  for (let level = 1; level <= 5; level += 1) out[`plea.${level}`] = [...((phrases.plea || {})[String(level)] || [])];
  for (const kind of KINDS) out[kind] = [...(phrases[kind] || [])];
  return out;
}

// Turns edited sets back into the file's shape. Every set needs at least one line; lines are trimmed and capped.
function fromSets(edited) {
  const clean = (list) =>
    (Array.isArray(list) ? list : String(list || '').split('\n'))
      .map((l) => String(l).trim().slice(0, MAX_LINE))
      .filter(Boolean);
  const out = { plea: {} };
  for (let level = 1; level <= 5; level += 1) {
    const lines = clean(edited[`plea.${level}`]);
    if (!lines.length) return { error: `${nameOf(`plea.${level}`)} needs at least one line` };
    out.plea[String(level)] = lines;
  }
  for (const kind of KINDS) {
    const lines = clean(edited[kind]);
    if (!lines.length) return { error: `${nameOf(kind)} needs at least one line` };
    out[kind] = lines;
  }
  return { phrases: out };
}

function saveSets(edited) {
  const result = fromSets(edited);
  if (result.error) return result;
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`; // whole file or nothing: the app reads it on every pick
  fs.writeFileSync(tmp, JSON.stringify(result.phrases, null, 2) + '\n');
  fs.renameSync(tmp, FILE);
  return result;
}

function resetToDefaults() {
  fs.mkdirSync(DIR, { recursive: true });
  fs.copyFileSync(DEFAULT_FILE, FILE);
}

// A phrase pack (docs/phrase-packs.md): a JSON file whose sets are merged over the current ones once they validate.
// Returns how many sets were loaded; throws with a message for the user when the file is not a pack.
function importPack(file) {
  const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
  const known = new Set(Object.keys(sets()));
  const unknown = Object.keys(pack).filter((k) => !known.has(k) && !k.startsWith('_'));
  if (unknown.length) throw new Error(`unknown set "${unknown[0]}"`);
  const chosen = Object.fromEntries(Object.entries(pack).filter(([k]) => known.has(k)));
  for (const [name, lines] of Object.entries(chosen)) {
    if (!Array.isArray(lines) || lines.some((l) => typeof l !== 'string'))
      throw new Error(`"${name}" must be a list of strings`);
  }
  const result = saveSets({ ...sets(), ...chosen });
  if (result.error) throw new Error(result.error);
  return Object.keys(chosen).length;
}

module.exports = { FILE, KINDS, INVITE, load, render, sets, fromSets, saveSets, resetToDefaults, importPack, SET_INFO };
