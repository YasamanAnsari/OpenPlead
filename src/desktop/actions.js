// @ts-check
'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { menuTemplate, hotkeysFor } = require('./menu');
const { settingsPayload, canSet, canRun, recordSentence } = require('./settings-view');
const { labelOf } = require('../core/tag');
const { agentName } = require('../core/apps');
const { SHOW_MODES } = require('../system/config');
const { quietUntil } = require('../core/quiet');
const { PET } = require('./channels');

// What the user can do from the menu and the settings window, beyond clicking the pet: change a setting, mute, jump
// to the agent's app, save a reply card, import a phrase pack, and the settings window's whole action table. A
// factory over the live pieces main owns, so main stays a wiring diagram.

//   electron: { app, BrowserWindow, Menu, clipboard, dialog, globalShortcut, shell }
//   modules:  phrases, replies, connection, parking, front, tray, settingsWindow() (for dialogs), saveCard,
//             spriteDir, logFile, log, report, health()
//   live:     settings(), saveSettings(patch), state(), patchState(fn), pet (the window), say(), render(),
//             dispatch(), sound(name), resetSounds(), quit(reason), runDemo(), agentApp(), replyAt(at), pinned(),
//             togglePin()
function createActions(ctx) {
  const { app, BrowserWindow, Menu, clipboard, dialog, globalShortcut, shell } = ctx.electron;
  const { phrases, replies, connection, parking, front, tray, saveCard, spriteDir, logFile, log, report } = ctx;
  const { saveSettings, state, patchState, pet, say, render, dispatch, sound, resetSounds, quit } = ctx;
  let cardBusy = false;

  // A global shortcut that climbs the plead ladder without reaching for the mouse (OpenWhip issue #54: "too busy to
  // whip him"). Off by default; a failed registration is reported and leaves it off.
  function setHotkey(accel) {
    globalShortcut.unregisterAll();
    let next = hotkeysFor(process.platform).includes(accel) ? accel : null;
    if (next && !globalShortcut.register(next, () => dispatch({ type: 'click' }))) {
      say(`Could not register ${next}: another app owns it`, 6000);
      next = null;
    }
    saveSettings({ hotkey: next });
    tray.refresh();
  }

  // Settings changes and what each one touches at runtime.
  function setSetting(key, value) {
    saveSettings({ [key]: value });
    switch (key) {
      case 'thanks':
        patchState((s) => ({ ...s, settings: { ...s.settings, thanks: value } }));
        break;
      case 'cursor':
      case 'inviteReply':
        if (connection.installed()) connection.connect({ quiet: true }); // the Cursor entries, or the text hooks
        break;
      case 'sounds':
        if (value) {
          resetSounds();
          sound('chime');
        }
        break;
      case 'showMode':
        if (value !== 'agentFront') front.reset();
        break;
      case 'followDesktops':
        if (pet.win) pet.win.setVisibleOnAllWorkspaces(value, { visibleOnFullScreen: true });
        break;
      default:
        break;
    }
    render();
    tray.refresh();
  }

  function quietFor(minutes) {
    saveSettings({ quietUntil: quietUntil(minutes) });
    if (minutes) say(minutes === -1 ? 'Muted until you turn it off' : `Muted for ${minutes} min`, undefined, 2);
    render();
    tray.refresh();
  }

  // macOS activates the agent's app by bundle id without any permission.
  function focusAgent() {
    const bundle = ctx.agentApp();
    if (!bundle) return say('I do not know where the agent runs yet', 4000, 2);
    if (process.platform !== 'darwin') return say('Only on macOS for now', 4000, 2);
    return execFile('open', ['-b', bundle], (err) => err && report('focusing the agent', err));
  }

  // The reply as a 1200x675 PNG on the Desktop, revealed in the file manager: the shareable unit. One at a time.
  async function saveReplyCard(entry) {
    if (!entry || cardBusy) return;
    cardBusy = true;
    try {
      const file = await saveCard({
        BrowserWindow,
        entry,
        agent: agentName(entry.agent),
        label: labelOf(entry),
        dir: app.getPath('desktop'),
        spriteDir,
      });
      shell.showItemInFolder(file);
      say(`Card saved to the Desktop: ${path.basename(file)}`, undefined, 2);
    } catch (err) {
      report('making the card', err);
      say(`Could not make the card: ${err.message}`, undefined, 2);
    } finally {
      cardBusy = false;
    }
  }

  // A phrase pack (docs/phrase-packs.md): a JSON file whose sets are merged over the current ones once they validate.
  async function importPhrases() {
    const { canceled, filePaths } = await dialog.showOpenDialog(ctx.settingsWindow().window, {
      title: 'Import a phrase pack',
      filters: [{ name: 'Phrase pack', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths.length) return;
    const file = filePaths[0];
    try {
      const count = phrases.importPack(file);
      say(`Loaded ${count} sets from ${path.basename(file)}`, undefined, 2);
    } catch (err) {
      say(`Pack not loaded: ${err.message}`, undefined, 2); // the user's file is wrong, not the app
    }
  }

  // The settings window's two entry points: a validated setting change, and a named action.
  function set(key, value) {
    if (!canSet(key)) return;
    if (key === 'hotkey') setHotkey(value === null || typeof value === 'string' ? value : null);
    else if (key === 'showMode') {
      if (SHOW_MODES.includes(value)) setSetting(key, value);
    } else setSetting(key, Boolean(value));
  }
  function run(name, arg) {
    const table = {
      install: () => connection.connect(),
      uninstall: () => connection.disconnect(),
      openPhrases: () => shell.openPath(phrases.FILE),
      resetPosition: parking.resetPosition,
      unpark: parking.unpark,
      quietFor: () => quietFor(Number(arg) || 0),
      checkConnection: () => log(`connection check: ${connection.check().text}`),
      openLog: () => shell.openPath(logFile),
      focusAgent,
      done: () => saveSettings({ firstRun: false }),
      quit: () => quit('settings'),
      demo: ctx.runDemo,
      resetPhrases: () => phrases.resetToDefaults(),
      chime: () => pet.send(PET.SOUND, { name: 'chime', thanks: 0 }),
      copyRecord: () => clipboard.writeText(recordSentence(state().stats)),
      importPhrases,
      copyReply: () => {
        const entry = ctx.replyAt(arg);
        if (entry) clipboard.writeText(`“${entry.plea}” — ${agentName(entry.agent)}: “${entry.reply}”`);
      },
      replyCard: () => saveReplyCard(ctx.replyAt(arg)),
      clearReplies: () => replies.clear(),
    };
    return canRun(name) ? table[name]() : undefined;
  }

  // The right-click and tray menu, built on every open so the status lines are current.
  function buildMenu() {
    connection.refresh();
    return Menu.buildFromTemplate(
      menuTemplate({
        state: state(),
        settings: ctx.settings(),
        installed: connection.installed(),
        pinned: ctx.pinned(),
        canFocus: process.platform === 'darwin' && Boolean(ctx.agentApp()),
        agentApp: ctx.agentApp(),
        replies: replies.list(3),
        platform: process.platform,
        now: Date.now(),
        actions: {
          dispatch,
          quit,
          setSetting,
          togglePin: ctx.togglePin,
          quietFor,
          focusAgent,
          openSettings: (tab) => ctx.settingsWindow().open(tab || null),
          replyCard: (at) => saveReplyCard(ctx.replyAt(at)),
        },
      }),
    );
  }

  // What the settings window shows.
  function settingsView() {
    return settingsPayload({
      settings: ctx.settings(),
      status: {
        ...ctx.health(),
        port: ctx.settings().port,
        installed: connection.installed(),
        replies: replies.list(10),
        check: connection.lastCheck(),
        logFile,
      },
      platform: process.platform,
      version: app.getVersion(),
    });
  }

  return {
    setHotkey,
    setSetting,
    quietFor,
    focusAgent,
    saveReplyCard,
    importPhrases,
    set,
    run,
    buildMenu,
    settingsView,
  };
}

module.exports = { createActions };
