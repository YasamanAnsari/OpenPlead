// @ts-check
'use strict';

// Sounds are synthesized in the renderer; main decides whether one plays. Each name has its own cooldown, and
// nothing plays while the pet is hidden, muted, or another app is in front: the sound belongs to the agent's window.

const SOUND_COOLDOWN_MS = 10_000;

//   enabled()            the Sounds setting and not muted
//   audible()            the pet is visible and the agent's app is in front
//   thanksThisRun()      the count the chime's pitch climbs with
//   send(payload)        to the renderer
function createSounds({ enabled, audible, thanksThisRun, send }) {
  const last = new Map();
  function play(name) {
    if (!enabled() || !audible()) return;
    const now = Date.now();
    if (now - (last.get(name) || 0) < SOUND_COOLDOWN_MS) return;
    last.set(name, now);
    send({ name, thanks: thanksThisRun() });
  }
  return { play, reset: () => last.clear() };
}

module.exports = { createSounds };
