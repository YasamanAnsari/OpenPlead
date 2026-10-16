// @ts-check
'use strict';

const path = require('node:path');
const { SETTINGS } = require('./channels');

// The settings window: one at a time, a plain window, opened on a tab; first run opens it on Welcome. The page may
// only read the view, change a settable key or run a named action, all through main's validated callbacks.
//   view()            -> the payload from settings-view.js
//   set(key, value)   -> validated change
//   run(name, arg)    -> validated action
//   phrases()         -> { sets, file } for the Messages tab
//   savePhrases(sets) -> { error } | {}
//   onClosed()        -> e.g. end the first run
//   placeOn()         -> the work area to centre the window in (the pet's display), or null for Electron's default
const SIZE = { width: 500, height: 640 };
const centerIn = (a) => ({
  x: Math.round(a.x + (a.width - SIZE.width) / 2),
  y: Math.round(a.y + (a.height - SIZE.height) / 2),
});

function createSettingsWindow({
  BrowserWindow,
  ipcMain,
  view,
  set,
  run,
  phrases = () => ({ sets: {}, file: '' }),
  savePhrases = (_sets) => ({}),
  onClosed = () => {},
  placeOn = () => null,
  hidden = false, // test instances (OPENPLEAD_HIDDEN) build the window but never show it
}) {
  let win = null;
  // Without a tab the page reopens on the pane used last (the guidelines' "restore the most recently viewed pane").
  function open(tab = null) {
    if (win) {
      win.focus();
      if (tab) win.webContents.send(SETTINGS.TAB, tab);
      return;
    }
    const area = placeOn();
    win = new BrowserWindow({
      ...SIZE,
      ...(area ? centerIn(area) : {}),
      title: 'OpenPlead',
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      webPreferences: { preload: path.join(__dirname, 'preload-settings.js'), contextIsolation: true, sandbox: true },
    });
    win.setMenuBarVisibility(false);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.loadFile(path.join(__dirname, '..', 'renderer', 'settings.html'), { query: tab ? { tab } : {} });
    if (!hidden) win.once('ready-to-show', () => win.show());
    win.on('closed', () => {
      win = null;
      onClosed();
    });
  }
  ipcMain.handle(SETTINGS.READ, () => view());
  ipcMain.handle(SETTINGS.SET, (_e, key, value) => {
    set(key, value);
    return view();
  });
  ipcMain.handle(SETTINGS.ACTION, async (_e, name, arg) => {
    await run(name, arg); // an action may open a dialog: the page re-reads once it is done
    return view();
  });
  ipcMain.handle(SETTINGS.PHRASES_READ, () => phrases());
  ipcMain.handle(SETTINGS.PHRASES_WRITE, (_e, sets) => savePhrases(sets && typeof sets === 'object' ? sets : {}));
  return {
    open,
    get isOpen() {
      return Boolean(win);
    },
    get window() {
      return win; // the parent for dialogs, so they come up in front of the settings
    },
  };
}

module.exports = { createSettingsWindow };
