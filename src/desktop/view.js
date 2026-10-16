// @ts-check
'use strict';

const { moodOf } = require('../core/state');
const { tagOf } = require('../core/tag');
const { tooltipFor } = require('./tray');
const { appName } = require('../core/apps');
const { PET } = require('./channels');
const { readingMs } = require('./bubbles');
const { coaching, coached } = require('../core/coach');

// What the pet shows: whether the window is on screen at all, the mood and nameplate the renderer draws, the sticky
// words in the bubble, and the tray tooltip. Owns the dedup of what was last sent to the renderer; nothing else.

//   pet                  the window (win, visible(), send())
//   state(), outcome(), settings(), demoRunning(), installed(), sessionCount(), goodbyePlaying(), say()
//   front, tray, parking, eyes(idle), hit(shown)
//   agentApp(), agentLabel(), spriteDir, hidden, bubbles (the gate), saveSettings(patch), quiet()
function createView(ctx) {
  const { pet, front, tray, parking, eyes, hit, spriteDir, bubbles } = ctx;
  let lastView = '';
  let stickyWords = ''; // the queued words shown in the bubble, so they are sent once
  let tagShown = false;
  let pinned = false; // tray click: keep the pet on screen until the next session ends

  // The pet's voice. Chatter (priority 1) is held back while muted; outcomes (priority 2) always show and bring a
  // parked pet out for a moment.
  function say(text, ms = readingMs(text), priority = 1) {
    if (priority < 2 && ctx.quiet()) return;
    if (ctx.settings().parked && priority >= 2) parking.peek(ms);
    bubbles.offer({ text, ms, priority }, (b) => pet.send(PET.BUBBLE, { text: b.text, ms: b.ms }));
  }

  // One explanation per moment, the first time it happens, only when it can be seen.
  function coach(moment, detail) {
    if (!pet.visible() || ctx.demoRunning()) return;
    const text = coaching(ctx.settings(), moment, ctx.agentLabel(), detail);
    if (!text) return;
    ctx.saveSettings(coached(ctx.settings(), moment));
    say(text, readingMs(text), 2);
  }

  // On screen only while an agent session is alive, unless the show mode is 'always'. Before the hooks are installed
  // it stays visible so the install prompt can be seen.
  function shouldShow() {
    if (ctx.hidden) return false;
    if (pinned || ctx.settings().showMode === 'always' || !ctx.installed() || ctx.demoRunning()) return true;
    if (!ctx.sessionCount() && !ctx.goodbyePlaying()) return false;
    if (ctx.settings().showMode !== 'agentFront') return true;
    if (!front.settled) return pet.visible(); // a new app is being probed: no change until the answer is in
    return front.inFront;
  }

  function tooltip() {
    return tooltipFor({
      installed: ctx.installed(),
      sessions: ctx.sessionCount(),
      visible: pet.visible(),
      appName: appName(ctx.agentApp()),
      quiet: ctx.quiet(),
    });
  }

  function render() {
    const win = pet.win;
    if (!win) return;
    const show = shouldShow();
    if (show !== win.isVisible()) show ? win.showInactive() : win.hide();
    tray.sync();
    const now = Date.now();
    const view = { mood: moodOf(ctx.state(), now), tag: tagOf(ctx.state(), ctx.outcome(), now), spriteDir };
    eyes(view.mood === 'idle' && show); // before the dedup: visibility can change while the mood does not
    tagShown = Boolean(view.tag.line1);
    hit(show);
    const key = view.mood + JSON.stringify(view.tag);
    if (key === lastView) return;
    lastView = key;
    pet.send(PET.VIEW, view);
    tray.refresh();
    // The words of whatever is queued stay in the bubble until they go out; the nameplate shows only the status.
    const words = view.tag.queue === 'queued' ? view.tag.phrase : '';
    if (words === stickyWords) return;
    stickyWords = words;
    if (ctx.settings().parked && words) parking.peek();
    pet.send(PET.BUBBLE, { text: words ? `“${words}”` : '', ms: 0, sticky: true });
  }

  // Keep the pet on screen until the next session ends: the tray click, or the menu where the tray has no click.
  function togglePin() {
    if (!ctx.state()) return;
    pinned = !pinned;
    render();
    tray.refresh();
    if (pinned) pet.showOnCurrentDesktop(); // wherever it was, bring it to this desktop
    if (pinned && !ctx.sessionCount()) say('No agent open yet. I stay on screen until one ends.');
  }

  return {
    render,
    say,
    coach,
    tooltip,
    togglePin,
    pinned: () => pinned,
    unpin: () => {
      pinned = false;
    },
    tagShown: () => tagShown,
    reset: () => {
      lastView = ''; // the renderer reloaded or the machine woke: send the view again
    },
  };
}

module.exports = { createView };
