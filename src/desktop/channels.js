// @ts-check
'use strict';

// Every IPC channel name, in one place: main, the preloads and the settings window all import from here, so a
// renamed channel fails loudly in every file (an undefined constant) instead of a message that silently goes nowhere.

// The pet window.
const PET = {
  // renderer -> main
  CLICK: 'click',
  HOVER: 'hover',
  MOVE: 'move',
  MOVE_END: 'move-end',
  CONTEXT_MENU: 'contextmenu',
  FOCUS_AGENT: 'focus-agent',
  // main -> renderer
  VIEW: 'view',
  BUBBLE: 'bubble',
  SOUND: 'sound',
  EYES: 'eyes',
};

// The settings window (invoke/handle, plus one push for the tab to open).
const SETTINGS = {
  READ: 'settings:read',
  SET: 'settings:set',
  ACTION: 'settings:action',
  TAB: 'settings:tab',
  PHRASES_READ: 'phrases:read',
  PHRASES_WRITE: 'phrases:write',
};

module.exports = { PET, SETTINGS };
