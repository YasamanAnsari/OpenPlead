// @ts-check
'use strict';

const { PET } = require('./channels');

// The pet's window: transparent, always on top, click-through until the pointer is over the pet. Main decides when
// it shows; this file only creates it and moves it between desktops.

//   box                  { width, height }
//   parking              startPosition() for the first placement
//   settings()           followDesktops, live
//   onLoaded()           the renderer is ready for its first view
function createPetWindow({ BrowserWindow, box, preload, html, parking, settings, onLoaded }) {
  let win = null;
  function create() {
    win = new BrowserWindow({
      ...box,
      ...parking.startPosition(),
      show: false,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      hasShadow: false,
      focusable: false,
      webPreferences: { preload, contextIsolation: true, sandbox: false },
    });
    win.setVisibleOnAllWorkspaces(Boolean(settings().followDesktops), { visibleOnFullScreen: true });
    win.setIgnoreMouseEvents(true, { forward: true });
    win.loadFile(html);
    win.webContents.on('did-finish-load', onLoaded);
    win.on('closed', () => {
      win = null;
    });
  }
  // macOS keeps a window on the desktop it first appeared on. Only the tray click moves it, by showing it on all
  // desktops for an instant and releasing it to the current one. No-op when it follows the user anyway.
  function showOnCurrentDesktop() {
    if (!win) return;
    if (!settings().followDesktops) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.showInactive();
    if (!settings().followDesktops) win.setVisibleOnAllWorkspaces(false, { visibleOnFullScreen: true });
  }
  // The renderer's messages: pointer over the pet, a click, a drag, the context menu, the nameplate click.
  function bind({ ipcMain, hover, click, move, moveEnd, contextMenu, focusAgent }) {
    ipcMain.on(PET.HOVER, (_e, over) => {
      hover(over);
      if (win && process.platform !== 'linux') win.setIgnoreMouseEvents(!over, { forward: true }); // Linux: the hit poll owns this
    });
    ipcMain.on(PET.CLICK, () => click());
    ipcMain.on(PET.MOVE, (_e, dx, dy) => move(dx, dy));
    ipcMain.on(PET.MOVE_END, () => moveEnd());
    ipcMain.on(PET.CONTEXT_MENU, () => contextMenu().popup({ window: win }));
    ipcMain.on(PET.FOCUS_AGENT, () => focusAgent());
  }
  return {
    create,
    bind,
    showOnCurrentDesktop,
    get win() {
      return win;
    },
    visible: () => Boolean(win && win.isVisible()),
    send: (channel, payload) => win && win.webContents.send(channel, payload),
  };
}

module.exports = { createPetWindow };
