// @ts-check
'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const { PET } = require('./channels');

// The renderer gets named methods, never a raw channel: it can only say what is listed here.
contextBridge.exposeInMainWorld('openplead', {
  click: () => ipcRenderer.send(PET.CLICK),
  hover: (over) => ipcRenderer.send(PET.HOVER, Boolean(over)),
  move: (dx, dy) => ipcRenderer.send(PET.MOVE, dx, dy),
  moveEnd: () => ipcRenderer.send(PET.MOVE_END),
  contextMenu: () => ipcRenderer.send(PET.CONTEXT_MENU),
  focusAgent: () => ipcRenderer.send(PET.FOCUS_AGENT),
  onView: (cb) => ipcRenderer.on(PET.VIEW, (_e, view) => cb(view)),
  onBubble: (cb) => ipcRenderer.on(PET.BUBBLE, (_e, msg) => cb(msg)),
  onSound: (cb) => ipcRenderer.on(PET.SOUND, (_e, msg) => cb(msg)),
  onEyes: (cb) => ipcRenderer.on(PET.EYES, (_e, msg) => cb(msg)),
});
