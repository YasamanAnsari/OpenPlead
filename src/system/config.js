// @ts-check
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DIR = path.join(os.homedir(), '.openplead');
const FILE = path.join(DIR, 'config.json');
// position: [x, y] of the pet window, saved after a drag; followDesktops: show on every Space/desktop.
const DEFAULTS = {
  port: 47821,
  thanks: true,
  // Where Grovel is on screen: 'agentFront' (only while the agent's app is in front), 'session' (whenever an agent
  // session is open, over any app) or 'always' (even with no agent).
  showMode: 'agentFront',
  cursor: true,
  manageHooks: false, // set by Connect; the app then keeps the entries present until Disconnect
  followDesktops: false,
  sounds: true,
  inviteReply: false, // adds "A one-line answer is welcome." to each line; off, the agent is never asked anything
  hotkey: null, // Electron accelerator that climbs the plead ladder, e.g. 'Control+Shift+P' (literal Control: on macOS
  // CommandOrControl would be Cmd+Shift+P, the editor's command palette)
  position: null,
  firstRun: true, // the settings window opens on its Welcome tab until the user presses Done
  launch: null, // { cmd, args } written by a packaged app at install: what the shim starts when the pet is not running
  quietUntil: 0, // Quiet mode: no sounds and no chatter until this time; -1 means until turned off
  stats: { pleas: 0, thanks: 0, panics: 0 },
  coached: {}, // the once-only explanations the pet has already given
  parked: null, // mini mode: { side: 'left' | 'right', display } while Grovel is parked at a screen edge
};

const exists = () => fs.existsSync(FILE);

// `openplead install` asks the app to open its Welcome tab through a marker file, not a settings key: a running app
// rewrites the settings file and would lose the key, and a second launch can pick the marker up at once.
const WELCOME = path.join(DIR, 'show-welcome');
function requestWelcome() {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(WELCOME, '');
}
function takeWelcome() {
  try {
    fs.unlinkSync(WELCOME);
    return true;
  } catch {
    return false;
  }
}

// The file as written, without defaults: tells an explicit first-run request from an old file without the key.
function raw() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

const SHOW_MODES = ['agentFront', 'session', 'always'];

// False when config.json exists but cannot be parsed (a hand edit gone wrong): the app then keeps its settings in
// memory and writes nothing, so the user's file is never replaced with defaults.
function readable() {
  try {
    JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return true;
  } catch (err) {
    return err.code === 'ENOENT';
  }
}

function load() {
  try {
    const file = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const showMode = SHOW_MODES.includes(file.showMode) ? file.showMode : DEFAULTS.showMode;
    return { ...DEFAULTS, ...file, showMode };
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`openplead: ignoring unreadable ${FILE}: ${err.message}`);
    return { ...DEFAULTS };
  }
}

// Written beside and renamed over: a crash or kill mid-write (it is written at quit) leaves the old file, not a
// truncated one that would drop every setting, the hook port included.
function save(config) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(config, null, 2) + '\n');
  fs.renameSync(`${FILE}.tmp`, FILE);
}

module.exports = { DIR, FILE, SHOW_MODES, exists, raw, readable, load, save, requestWelcome, takeWelcome };
