// @ts-check
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// The settings window may only read the settings view, change a settable key, or run a named action.
// This preload runs sandboxed, and a sandboxed preload cannot require app files, so the channel names are written
// out here; test/desktop/preload-channels.test.js keeps them identical to desktop/channels.js.
const SETTINGS = {
  READ: 'settings:read',
  SET: 'settings:set',
  ACTION: 'settings:action',
  TAB: 'settings:tab',
  PHRASES_READ: 'phrases:read',
  PHRASES_WRITE: 'phrases:write',
};

contextBridge.exposeInMainWorld('openplead', {
  read: () => ipcRenderer.invoke(SETTINGS.READ),
  set: (key, value) => ipcRenderer.invoke(SETTINGS.SET, key, value),
  action: (name, arg) => ipcRenderer.invoke(SETTINGS.ACTION, name, arg),
  onTab: (cb) => ipcRenderer.on(SETTINGS.TAB, (_e, tab) => cb(tab)),
  phrases: () => ipcRenderer.invoke(SETTINGS.PHRASES_READ),
  savePhrases: (sets) => ipcRenderer.invoke(SETTINGS.PHRASES_WRITE, sets),
});
