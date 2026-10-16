// @ts-check
'use strict';

// Bubbles replace each other. An outcome ("Sent ✓", "Dropped": priority 2) keeps its spot for a moment against
// ordinary chatter (priority 1); the chatter is shown once the hold ends. Chatter that is still waiting after a while
// (outcomes kept coming) is dropped rather than shown out of context: a goodbye six seconds late is noise.

const HOLD_MS = 3000;
const STALE_MS = 4000;

// How long a transient bubble stays: design systems settle on about five seconds as the floor for a toast, more for
// people who read slowly or in a second language, and warn that quick-fading messages go unnoticed. So: a settle time
// plus an unhurried pace per word, between four and ten seconds.
const READ_FLOOR_MS = 4000;
const READ_CEIL_MS = 10_000;
const SETTLE_MS = 1500;
const PER_WORD_MS = 350;
function readingMs(text) {
  const words = String(text).trim().split(/\s+/).filter(Boolean).length;
  return Math.min(READ_CEIL_MS, Math.max(READ_FLOOR_MS, SETTLE_MS + words * PER_WORD_MS));
}

function createBubbleGate({ now = Date.now, schedule = setTimeout } = {}) {
  let hold = { priority: 0, until: 0 };
  let held = null;
  // Shows the bubble now and returns true, or keeps it until the current hold ends and returns false.
  function offer(bubble, show, since = now()) {
    const t = now();
    if (t - since >= STALE_MS) return false; // waited too long already, hold or no hold
    if (bubble.priority < hold.priority && t < hold.until) {
      held = { bubble, show, since };
      schedule(() => {
        const next = held;
        held = null;
        if (next) offer(next.bubble, next.show, next.since);
      }, hold.until - t);
      return false;
    }
    hold = { priority: bubble.priority, until: t + Math.min(bubble.ms, HOLD_MS) };
    show(bubble);
    return true;
  }
  // Drops whatever is waiting (the demo starts: chatter from before must not surface in the middle of it).
  function clear() {
    held = null;
  }
  return { offer, clear };
}

module.exports = { createBubbleGate, readingMs };
