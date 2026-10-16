// @ts-check
'use strict';

const path = require('node:path');
const { isQuiet } = require('../core/quiet');

// Which icon the tray shows: the pet's state at a glance, which matters most while he is hidden behind another app.
// Precedence: not connected, then the agent waiting on the user, then something queued, then quiet, then the base icon.
// Quiet mode silences chatter and sounds, not the fact that the agent is blocked on you.
const STATES = ['base', 'attention', 'queued', 'quiet', 'off'];

function trayStateOf({ state, settings, installed, now = Date.now() }) {
  if (!installed) return 'off';
  if (state.permissionWait) return 'attention';
  if (state.pending || state.nextPrompt) return 'queued';
  if (isQuiet(settings, now)) return 'quiet';
  return 'base';
}

// Two icon families (scripts/render-tray.js): the macOS menu bar takes black-and-clear template images, which Electron
// recognises by the "Template" suffix and the system tints for light and dark bars; Windows and Linux take the colour
// icons with a status overlay. assets/tray/tray.png is the base; the variants sit beside it, each with an @2x file.
function iconFile(name, { scale = 1, platform = process.platform } = {}) {
  const stem = name === 'base' ? 'tray' : `tray-${name}`;
  return `${stem}${platform === 'darwin' ? 'Template' : ''}${scale === 2 ? '@2x' : ''}.png`;
}

// The tray tooltip: "program – status", a sentence fragment, nothing about how to click (the Windows infotip rules),
// within the 127 characters Windows shows.
const TOOLTIP_MAX = 127;
function tooltipFor({ installed, sessions, visible, appName, quiet }) {
  const status = !installed
    ? 'Not connected'
    : !sessions
      ? 'Waiting for an agent session'
      : visible
        ? 'Grovel is on screen'
        : `Hidden until ${appName} is in front`;
  return `OpenPlead – ${status}${quiet ? ' · Muted' : ''}`.slice(0, TOOLTIP_MAX);
}

// The live tray: icon and tooltip follow the state (a badge while the agent waits on you or words are queued, dimmed in
// quiet mode, grey until connected). Linux trays cannot pop a menu on demand, so theirs is set up front and refreshed.
// macOS: "display a menu when people click your menu bar extra" (HIG). Windows: a click shows what people most likely
// want to see, the pet; the context menu stays on the right button.
function createTray({
  Tray,
  nativeImage,
  iconDir,
  stateNow,
  tooltipNow,
  buildMenu,
  onClick,
  platform = process.platform,
}) {
  const icons = new Map();
  let tray = null;
  let shown = '';
  let lastTip = '';

  function icon(name) {
    if (!icons.has(name)) {
      const image = nativeImage.createFromPath(path.join(iconDir, iconFile(name, { platform })));
      // A variant missing from a build must not blank the tray: the base icon stands in.
      icons.set(name, image.isEmpty() && name !== 'base' ? icon('base') : image);
    }
    return icons.get(name);
  }

  function updateIcon() {
    if (!tray) return;
    const next = stateNow();
    if (next === shown) return;
    shown = next;
    tray.setImage(icon(next));
  }

  // Icon and tooltip; string compares, cheap enough for every tick.
  function sync() {
    if (!tray) return;
    updateIcon();
    const tip = tooltipNow();
    if (tip !== lastTip) {
      lastTip = tip;
      tray.setToolTip(tip);
    }
  }

  // Icon, and on Linux the menu with it.
  function refresh() {
    updateIcon();
    if (tray && platform === 'linux') tray.setContextMenu(buildMenu());
  }

  function build() {
    shown = stateNow();
    tray = new Tray(icon(shown));
    tray.setToolTip(tooltipNow());
    if (platform === 'linux') {
      refresh();
      return;
    }
    tray.on('click', () => (platform === 'darwin' ? tray.popUpContextMenu(buildMenu()) : onClick()));
    tray.on('right-click', () => tray.popUpContextMenu(buildMenu()));
  }

  return { build, sync, refresh };
}

module.exports = { STATES, trayStateOf, iconFile, tooltipFor, TOOLTIP_MAX, createTray };
