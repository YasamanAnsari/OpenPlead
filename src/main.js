// @ts-check
'use strict';

// Electron wiring. Every rule lives in the pure reducer (core/state.js); this file feeds it inputs, has its effects
// performed (desktop/effects.js) and composes the runtime pieces (system/* and desktop/* factories) around the
// window and the live state. The user's actions live in desktop/actions.js, the clock in system/lifecycle.js.

const path = require('node:path');
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  powerMonitor,
  screen,
  shell,
} = require('electron');
const config = require('./system/config');
const phrases = require('./core/phrases');
const sessionHosts = require('./system/hosts');
const liveness = require('./system/liveness');
const server = require('./system/server');
const { log, report, FILE: LOG_FILE } = require('./system/log');
const { createFrontWatcher } = require('./system/front');
const { createSessionRegistry } = require('./system/sessions');
const { createConnection } = require('./system/connection');
const { createLifecycle } = require('./system/lifecycle');
const { createHealth } = require('./system/health');
const { createBubbleGate } = require('./desktop/bubbles');
const { fillPhrases, keepOutcome } = require('./core/queue');
const { trayStateOf, createTray } = require('./desktop/tray');
const { isQuiet } = require('./core/quiet');
const replies = require('./core/replies');
const { saveCard } = require('./desktop/card');
const { agentName } = require('./core/apps');
const { createSettingsWindow } = require('./desktop/settings-window');
const { createParking } = require('./desktop/parking');
const { createEyeWatcher, createHitWatcher } = require('./desktop/watchers');
const { createPetWindow } = require('./desktop/pet-window');
const { createEffects } = require('./desktop/effects');
const { createView } = require('./desktop/view');
const { createSounds } = require('./desktop/sounds');
const { createDemoRunner } = require('./desktop/demo-runner');
const { createActions } = require('./desktop/actions');
const { PET } = require('./desktop/channels');
const demo = require('./core/demo');
const { initialState, reduce, turnActive, sessionCount: countSessions } = require('./core/state');
const { labelOf } = require('./core/tag');

const ASSETS = path.join(__dirname, '..', 'assets');
const SPRITE_DIR = path.join(ASSETS, 'sprites');
const WIN = { width: 280, height: 280 }; // bubble above, pet, nameplate below
const TICK_MS = 1000;
const COACH_QUEUED_DELAY_MS = 2500;
const AUTOSTARTED = process.argv.includes('--autostart'); // launched by the hook shim: live and die with the sessions
const HAD_CONFIG = config.exists(); // no config file yet: this is the first run
const HIDDEN = Boolean(process.env.OPENPLEAD_HIDDEN); // test instances never take the screen

let settings = config.load();
let state = null;
let outcome = null; // { kind: 'sent' | 'dropped' | 'reply', text, phrase? }: on the nameplate until the queue changes

const sessionCount = () => countSessions(state);
const agentApp = () => registry.appOf(state.activeSession); // the app the active session runs in, when the shim said
const agentLabel = () => agentName((state.sessions[state.activeSession] || {}).agent || null);
const goodbyePlaying = () => Boolean(state.transient && state.transient.until > Date.now());
const pickPhrase = (kind, level) => phrases.render(phrases.load(), kind, level).phrase; // re-read: edits apply at once
const replyAt = (at) => replies.list(50).find((entry) => String(entry.at) === String(at)) || null;

function quit(reason) {
  log(`quit: ${reason}`);
  app.quit();
}

// Merged over what is on disk: the CLI may have changed the file while the app runs.
function saveSettings(patch) {
  const wasParked = Boolean(settings.parked);
  if (config.readable()) {
    settings = { ...config.load(), ...patch };
    config.save(settings);
  } else {
    settings = { ...settings, ...patch }; // config.json does not parse: keep the change in memory, never overwrite
    warnUnreadable();
  }
  if (wasParked && !settings.parked) parking.keepInside(); // however it was unparked, never left off-screen
}

let unreadableWarned = false;
function warnUnreadable() {
  if (unreadableWarned) return;
  unreadableWarned = true;
  log(`${config.FILE} does not parse; changes stay in memory until it is fixed`);
  bubble('Your config.json has a typo. I will not overwrite it; changes last until I quit.', 8000, 2);
}

// The pet's voice and its coaching live in the view (created below); these names are used by the factories only
// at call time, so declaring them first keeps every factory free of ordering.
const bubble = (text, ms, priority) => view.say(text, ms, priority);
const coach = (moment, detail) => view.coach(moment, detail);

const registry = createSessionRegistry({ store: sessionHosts });
const connection = createConnection({
  settings: () => settings,
  save: saveSettings,
  reloadManageHooks: () => {
    settings = { ...settings, manageHooks: config.load().manageHooks };
    return settings.manageHooks;
  },
  say: (text, ms) => bubble(text, ms),
  report,
  onChanged: () => {
    if (connection.installed()) lifecycle.resetNudge();
    render();
  },
});
const front = createFrontWatcher({
  hosts: () => registry.appIds(),
  enabled: () => settings.showMode === 'agentFront',
  onChange: () => render(),
});
const bubbles = createBubbleGate();
const parking = createParking({
  win: () => pet.win,
  screen,
  settings: () => settings,
  save: saveSettings,
  say: (text, ms, priority) => bubble(text, ms, priority),
  box: WIN,
});
const pet = createPetWindow({
  BrowserWindow,
  box: WIN,
  preload: path.join(__dirname, 'desktop', 'preload.js'),
  html: path.join(__dirname, 'renderer', 'index.html'),
  parking,
  settings: () => settings,
  onLoaded: () => {
    view.reset();
    render();
    if (!connection.installed()) bubble('Right-click me and choose Connect to Claude Code', 8000);
  },
});
const eyes = createEyeWatcher({ win: () => pet.win, screen, send: (msg) => pet.send(PET.EYES, msg) });
const hit = createHitWatcher({ win: () => pet.win, screen, tagShown: () => view.tagShown() });
const tray = createTray({
  Tray,
  nativeImage,
  iconDir: path.join(ASSETS, 'tray'),
  stateNow: () => trayStateOf({ state: demoRunner.realState(), settings, installed: connection.installed() }), // a demo never lights the badge
  tooltipNow: () => view.tooltip(),
  buildMenu: () => actions.buildMenu(),
  onClick: () => view.togglePin(),
});
const sounds = createSounds({
  enabled: () => Boolean(settings.sounds) && !isQuiet(settings),
  audible: () => pet.visible() && front.inFront,
  thanksThisRun: () => state.stats.thanks - (state.runStats ? state.runStats.thanks : 0),
  send: (payload) => pet.send(PET.SOUND, payload),
});
const view = createView({
  pet,
  front,
  tray,
  parking,
  eyes,
  hit,
  spriteDir: SPRITE_DIR,
  hidden: HIDDEN,
  state: () => state,
  outcome: () => outcome,
  settings: () => settings,
  demoRunning: () => demoRunner.running(),
  installed: () => connection.installed(),
  sessionCount,
  goodbyePlaying,
  agentApp,
  agentLabel,
  quiet: () => isQuiet(settings),
  bubbles,
  saveSettings,
});
const render = () => view.render();
const demoRunner = createDemoRunner({
  live: {
    get: () => ({ state, outcome }),
    set: (next) => {
      ({ state, outcome } = next);
    },
  },
  settings: () => settings,
  sessionCount,
  dispatch,
  onDelivered,
  say: bubble,
  render,
  clearChatter: () => bubbles.clear(),
});
const effects = createEffects({
  say: bubble,
  sound: (name) => sounds.play(name),
  phrases,
  replies,
  inviteReply: () => settings.inviteReply,
  log,
  report,
});
const lifecycle = createLifecycle({
  dispatch,
  registry,
  liveness,
  records: () => sessionHosts.liveSessions(),
  state: () => state,
  settings: () => settings,
  saveSettings,
  connection,
  front,
  pinned: () => view.pinned(),
  unpin: () => view.unpin(),
  settingsOpen: () => settingsWindow.isOpen,
  goodbyePlaying,
  autostarted: AUTOSTARTED,
  log,
  quit,
  say: bubble,
});

// Applies one input to the state machine, performs its effects and returns the reply to deliver, if any,
// as { text, kind, level, phrase }.
function dispatch(input) {
  if (demoRunner.running() && input.type === 'hook' && input.event.sessionId !== demo.SESSION) demoRunner.stop(); // a real session: the demo yields
  if (input.type === 'hook') {
    // The lines carry whether the agent was invited to answer; without the invitation its text is never read.
    const invite = Boolean(settings.inviteReply);
    if (!invite && input.event.kind === 'assistant_text') return null;
    input = { ...input, event: { ...input.event, invite, lastMessage: invite ? input.event.lastMessage : undefined } };
  }
  const prev = state;
  const result = reduce(state, input, Date.now());
  state = fillPhrases(result.state, pickPhrase, (err) => report('choosing a phrase', err));
  outcome = keepOutcome(outcome, prev, state, result.effects);
  if (!demoRunner.running()) lifecycle.trackHosts(input);
  let reply = null;
  for (const effect of result.effects) {
    const done = effects.perform(effect, { state, input });
    if (done.state) state = done.state;
    if (done.outcome) outcome = done.outcome;
    if (done.reply) reply = done.reply;
  }
  render();
  if (input.type === 'hook') {
    const { kind } = input.event;
    if (kind === 'turn_start' && turnActive(state)) coach('working');
    if (kind === 'turn_end' && state.nextPrompt && state.nextPrompt.kind === 'thanks') coach('thanks');
  }
  const queued = result.effects.find((effect) => effect.type === 'queued');
  if (queued) {
    setTimeout(() => {
      if (state.pending || state.nextPrompt) coach('queued', queued.soon); // not if it already went out
    }, COACH_QUEUED_DELAY_MS);
  }
  return reply;
}

function onDelivered({ kind, level, phrase }) {
  outcome = { kind: 'sent', text: `Sent to ${agentLabel()} ✓ · ${labelOf({ kind, level })}`, phrase };
  bubble(`Sent to ${agentLabel()} ✓`, undefined, 2);
  render();
  tray.refresh();
  if (kind === 'plea') coach('sent');
  if (kind === 'calm') coach('panic');
}

const actions = createActions({
  electron: { app, BrowserWindow, Menu, clipboard, dialog, globalShortcut, shell },
  health: () => health(),
  pinned: () => view.pinned(),
  togglePin: () => view.togglePin(),
  phrases,
  replies,
  connection,
  parking,
  front,
  tray,
  saveCard,
  spriteDir: SPRITE_DIR,
  logFile: LOG_FILE,
  log,
  report,
  settings: () => settings,
  saveSettings,
  state: () => state,
  patchState: (fn) => {
    state = fn(state);
  },
  pet,
  say: bubble,
  render,
  dispatch,
  sound: (name) => sounds.play(name),
  resetSounds: () => sounds.reset(),
  quit,
  runDemo: () => demoRunner.run(),
  settingsWindow: () => settingsWindow,
  agentApp,
  replyAt,
});

const settingsWindow = createSettingsWindow({
  BrowserWindow,
  ipcMain,
  view: () => actions.settingsView(),
  set: actions.set,
  run: actions.run,
  phrases: () => ({ sets: phrases.sets(), file: phrases.FILE }),
  savePhrases: (sets) => {
    const result = phrases.saveSets(sets);
    return result.error ? { error: result.error } : {};
  },
  placeOn: () => parking.userDisplay().workArea, // never on another screen than the pet (or the user, before the pet)
  onClosed: () => saveSettings({ firstRun: false }), // closing the Welcome tab counts as having seen it
  hidden: HIDDEN,
});

const health = createHealth({
  version: () => app.getVersion(),
  installed: () => connection.installed(),
  state: () => state,
  registry,
  pet,
  settings: () => settings,
  front,
  hooksCurrent: () => connection.isCurrent(),
});

pet.bind({
  ipcMain,
  hover: (over) => {
    parking.hover(over);
    if (over) dispatch({ type: 'wake' }); // no-op unless the pet is asleep
  },
  click: () => dispatch({ type: 'click' }),
  move: parking.drag,
  moveEnd: parking.drop,
  contextMenu: () => actions.buildMenu(),
  focusAgent: actions.focusAgent,
});

function start() {
  log(`start v${app.getVersion()} pid ${process.pid}${AUTOSTARTED ? ' (autostart)' : ''}`);
  try {
    phrases.load(); // seeds ~/.openplead/phrases.json on first run
  } catch (err) {
    report('loading the phrases', err); // the pet still runs; the first reply shows the same message in a bubble
  }
  state = initialState(Date.now(), { thanks: settings.thanks });
  state = { ...state, stats: { ...state.stats, ...settings.stats } };
  sessionHosts.sweep();
  if (process.platform === 'darwin') app.dock?.hide();
  connection.refresh();
  // Re-register on every launch: the hook command and port follow the app, and an upgrade may change them.
  if (settings.manageHooks) connection.connect({ quiet: true });
  pet.create();
  tray.build();
  lifecycle.recoverSessions();
  // The Welcome tab, once: on the first run with no config yet, never when a hook launched the pet.
  const firstRun = config.takeWelcome() || !HAD_CONFIG;
  if (firstRun && !AUTOSTARTED) settingsWindow.open('welcome');
  else if (settings.firstRun !== false) saveSettings({ firstRun: false });
  server.start({
    port: settings.port,
    handle: dispatch,
    onDelivered,
    enabled: lifecycle.agentEnabled,
    onError: (err) => report('server', err),
    health,
    onListening: lifecycle.onListening,
  });
  setInterval(lifecycle.tick, TICK_MS);
  front.start();
  if (settings.hotkey) actions.setHotkey(settings.hotkey);
  // After sleep the APNG may be frozen and the settings files or front app may have changed.
  powerMonitor.on('suspend', () => log('suspend'));
  powerMonitor.on('resume', () => {
    log('resume');
    view.reset();
    render();
    connection.repair();
    front.poll();
  });
}

// A second instance (two hooks launching at once, or the user starting the app again) must stop here, before it
// binds the port or shows a window; the running instance answers by opening Settings, or Welcome when asked for it.
if (!app.requestSingleInstanceLock()) app.quit();
else {
  // A hook launching the app while it already runs (several hooks fire at once on a new chat) must stay silent;
  // only a launch by the user, or `openplead install` asking for Welcome, opens the window.
  app.on('second-instance', (_e, argv) => {
    const welcome = config.takeWelcome();
    if (!welcome && argv.includes('--autostart')) return;
    settingsWindow.open(welcome ? 'welcome' : null);
  });
  app.whenReady().then(start);
}

// Only the tally is written at quit: every other change was saved when it was made, and the file may have been
// changed by the CLI meanwhile.
app.on('before-quit', () => {
  demoRunner.stop(); // back to the real tally
  if (config.readable()) config.save({ ...config.load(), stats: state ? state.stats : settings.stats });
});
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  connection.stop();
  front.stop();
});
app.on('window-all-closed', () => quit('window closed'));
