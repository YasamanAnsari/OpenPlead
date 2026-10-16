// @ts-check
'use strict';

// Two pollers that run only while the pet is visible, so they cost nothing the rest of the time.

const { hitTest } = require('./hit');

const EYES_POLL_MS = 100;
const HIT_POLL_MS = 100;
const EYE_RANGE_PX = 300; // the pupils reach the edge of their socket when the pointer is this far from the centre

// Starts or stops an interval; `on(false)` clears it, `on(true)` starts it once.
function createPoller(ms, step) {
  let timer = null;
  return (on) => {
    if (!on) {
      clearInterval(timer);
      timer = null;
      return;
    }
    if (!timer) timer = setInterval(step, ms);
  };
}

// Idle eyes follow the cursor: the direction from the pet's centre goes to the renderer as a unit-box offset.
function createEyeWatcher({ win, screen, send }) {
  let last = '';
  return createPoller(EYES_POLL_MS, () => {
    const w = win();
    if (!w) return;
    const { x, y, width, height } = w.getBounds();
    const cursor = screen.getCursorScreenPoint();
    const dx = Math.max(-1, Math.min(1, (cursor.x - (x + width / 2)) / EYE_RANGE_PX));
    const dy = Math.max(-1, Math.min(1, (cursor.y - (y + height / 2)) / EYE_RANGE_PX));
    const key = `${dx.toFixed(1)}${dy.toFixed(1)}`;
    if (key === last) return;
    last = key;
    send({ dx, dy });
  });
}

// Linux cannot forward mouse moves through a click-through window, so the pet's own rectangles decide when the
// window takes the mouse (hit.js). Elsewhere the renderer's hover does it and this is a no-op.
function createHitWatcher({ win, screen, tagShown, platform = process.platform }) {
  let over = false;
  const poll = createPoller(HIT_POLL_MS, () => {
    const w = win();
    if (!w) return;
    const next = Boolean(hitTest(screen.getCursorScreenPoint(), w.getBounds(), { tag: tagShown() }));
    if (next === over) return;
    over = next;
    w.setIgnoreMouseEvents(!over, { forward: true });
  });
  return platform === 'linux' ? poll : () => {};
}

module.exports = { createEyeWatcher, createHitWatcher };
