// @ts-check
'use strict';

// Pure state machine: reduce(state, input, now) -> { state, effects }. The shapes live in ./types.js. The words of
// anything queued are chosen outside (main fills pending.phrase / nextPrompt.phrase as soon as an item is queued);
// the reducer only carries them, so the bubble, the nameplate and the agent agree. Nothing here touches the clock,
// the disk, the network or the window. The hook handlers live in ./state-hooks.js, the shared rules in
// ./state-shared.js; this file holds the clicks, the menu, the clock and the entry point.

const {
  sessionCount,
  activeSession,
  turnActive,
  transient,
  resetLadder,
  abort,
  mostRecent,
  queue,
  withPhrase,
  dropped,
  fillSentPhrase,
  MAX_LEVEL,
  PLEA_TTL,
  LEVEL_TTL,
  SLEEP_AFTER,
  SESSION_TTL,
  ABORT_SILENCE,
  THINKING_AFTER,
  PANIC_STREAK,
  TRANSIENT_MS,
} = require('./state-shared');
const { onHook } = require('./state-hooks');

/** @typedef {import('./types').State} State */
/** @typedef {import('./types').Input} Input */
/** @typedef {import('./types').Outcome} Outcome */
/** @typedef {import('./types').Effect} Effect */

/**
 * @param {number} now
 * @param {object} [settings]
 * @returns {State}
 */
function initialState(now, settings = {}) {
  return {
    settings: { thanks: true, ...settings },
    sessions: {},
    activeSession: null,
    level: 0,
    pending: null, // { level, at }
    nextPrompt: null, // { kind: 'thanks', at }
    transient: null, // { mood, until }
    pleadUntil: 0,
    panicUntil: 0,
    deadlineUntil: 0,
    deadlineMinutes: 0,
    permissionWait: false,
    lastClickAt: now,
    lastHookAt: now,
    stats: { pleas: 0, thanks: 0, panics: 0 }, // lifetime, persisted by main
    runStats: null, // stats when the first session of this run began; the goodbye wave shows the difference
  };
}

function moodOf(state, now) {
  const s = activeSession(state);
  if (state.panicUntil > now || (s && s.errorStreak >= PANIC_STREAK)) return 'panic';
  if (state.pleadUntil > now || (state.pending && turnActive(state))) return `plead-${state.level || 1}`;
  if (state.transient && state.transient.until > now) return state.transient.mood;
  if (state.deadlineUntil > now) return 'deadline';
  if (turnActive(state)) return 'working';
  if (now - Math.max(state.lastHookAt, state.lastClickAt) > SLEEP_AFTER) return 'sleeping';
  return 'idle';
}

// Lifetime tally, shown in the tray and by `openplead doctor`. The joke is OpenWhip's roadmap item about
// keeping logs for when the robots come; ours is the record of asking nicely.
function recordLine({ pleas = 0, thanks = 0, panics = 0 } = {}) {
  const n = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
  return `On record: ${n(pleas, 'plea')}, ${n(thanks, 'thank')}, ${n(panics, 'panic')} (kept for when the robots ask)`;
}

// The level of the next click: one above the ladder, or above the plea already waiting for the next message (the
// ladder itself fades between turns; the waiting plea keeps its place).
function nextLevelOf(state) {
  const waiting = state.nextPrompt && state.nextPrompt.kind === 'plea' ? state.nextPrompt.level || 0 : 0;
  return Math.min(MAX_LEVEL, Math.max(state.level, waiting) + 1);
}

// A click while the agent works climbs the ladder and queues the line for its next tool call. Between turns the line
// waits for the next message to this session instead (replacing a thank-you waiting there) and does not expire.
// Without a session there is nothing to plead to, and the pet says so.
function onClick(state, now) {
  /** @type {Effect[]} */
  const effects = [];
  const session = activeSession(state);
  if (!session) {
    effects.push({
      type: 'bubble',
      text: "Pleading to an empty room. Open Claude Code or Cursor and I'll have an audience.",
    });
    return { state: { ...state, lastClickAt: now, transient: transient('shrug', now) }, effects };
  }
  const level = nextLevelOf(state);
  if (!session.turnActive) {
    const kept =
      state.nextPrompt && state.nextPrompt.kind === 'plea' && state.nextPrompt.level === level
        ? state.nextPrompt.phrase
        : undefined;
    effects.push({ type: 'queued', level, soon: 'next message' });
    return {
      state: {
        ...state,
        level,
        nextPrompt: { ...queue(state, now, withPhrase({ kind: 'plea', level }, kept)), saved: true },
        pleadUntil: now + TRANSIENT_MS.plead,
        lastClickAt: now,
      },
      effects,
    };
  }
  // A new level gets new words; clicking at the cap keeps them.
  const phrase = state.pending && state.pending.level === level ? state.pending.phrase : undefined;
  effects.push({ type: 'queued', level, soon: 'next tool call' });
  return {
    state: {
      ...state,
      level,
      pending: queue(state, now, withPhrase({ level }, phrase)),
      pleadUntil: now + TRANSIENT_MS.plead,
      lastClickAt: now,
    },
    effects,
  };
}

function onMenu(state, input, now) {
  switch (input.action) {
    case 'reset':
      return { state: resetLadder(state), effects: [] };
    case 'thank':
      return {
        state: { ...state, transient: transient('thank', now), nextPrompt: queue(state, now, { kind: 'thanks' }) },
        effects: [],
      };
    case 'deadline': {
      const minutes = Number(input.minutes) || 0;
      if (!minutes) {
        // Off: the pose ends now, and a deadline note still waiting to go out is withdrawn.
        const note = state.nextPrompt && state.nextPrompt.kind === 'deadline';
        return {
          state: { ...state, deadlineUntil: 0, deadlineMinutes: 0, nextPrompt: note ? null : state.nextPrompt },
          effects: [],
        };
      }
      // Tell the agent once, at the next event that can carry text; a queued plea outranks it.
      const nextPrompt = state.pending || state.nextPrompt ? state.nextPrompt : queue(state, now, { kind: 'deadline' });
      return {
        state: { ...state, deadlineUntil: now + minutes * 60_000, deadlineMinutes: minutes, nextPrompt },
        effects: [],
      };
    }
    // Talk to: with more than one session alive, the user picks which one the nameplate (and the next plea) is for.
    case 'target':
      return {
        state: state.sessions[input.sessionId] ? { ...state, activeSession: input.sessionId } : state,
        effects: [],
      };
    // Reassure lines (hug, zen, apology): queued like thanks, sent with the next tool result or prompt.
    case 'say': {
      const zen = input.kind === 'zen';
      const base = zen ? { ...resetLadder(state), deadlineUntil: 0, deadlineMinutes: 0 } : state;
      return {
        state: { ...base, transient: transient('thank', now), nextPrompt: queue(state, now, { kind: input.kind }) },
        effects: [],
      };
    }
    default:
      return { state, effects: [] };
  }
}

// running: ids of sessions whose agent process is known to still run. Those are never forgotten for silence (a session
// waiting for you can wait an hour; the liveness check ends it when the process goes). Only sessions with no known
// process fall to the ten-minute rule.
// A turn silent for too long is aborted; before that, one "thinking" line is queued if nothing else is waiting.
function watchSilence(state, now, effects) {
  const s = activeSession(state);
  if (!s || !s.turnActive) return state;
  if (now - s.lastSeen > ABORT_SILENCE) return abort(state, now, effects);
  if (s.thinkingSent || now - s.lastSeen <= THINKING_AFTER || state.pending || state.nextPrompt) return state;
  effects.push({ type: 'bubble', text: 'Thinking a long time…' });
  return {
    ...state,
    nextPrompt: queue(state, now, { kind: 'thinking' }),
    sessions: { ...state.sessions, [state.activeSession]: { ...s, thinkingSent: true } },
  };
}

function onTick(state, now, running = []) {
  let next = state;
  const keep = new Set(running);
  const effects = [];
  if (next.pending && now - next.pending.at > PLEA_TTL) {
    effects.push(dropped('plea', next.pending, 'expired'));
    next = { ...next, pending: null };
  }
  if (next.nextPrompt && !next.nextPrompt.saved && now - next.nextPrompt.at > PLEA_TTL) {
    // Thanks and the like simply expire: the user was away, not the agent. A plea is reported.
    if (next.nextPrompt.kind === 'plea') effects.push(dropped('plea', next.nextPrompt, 'expired'));
    next = { ...next, nextPrompt: null };
  }
  if (next.level && !turnActive(next) && now - next.lastClickAt > LEVEL_TTL) next = { ...next, level: 0 };

  next = watchSilence(next, now, effects);

  const alive = Object.fromEntries(
    Object.entries(next.sessions).filter(([id, sess]) => keep.has(id) || now - sess.lastSeen <= SESSION_TTL),
  );
  if (Object.keys(alive).length !== Object.keys(next.sessions).length) {
    const active = alive[next.activeSession] ? next.activeSession : mostRecent(alive);
    next = { ...next, sessions: alive, activeSession: active };
  }
  return { state: next, effects };
}

/**
 * @param {State} state
 * @param {Input} input
 * @param {number} now
 * @returns {Outcome}
 */
function reduce(state, input, now) {
  switch (input.type) {
    case 'click':
      return onClick(state, now);
    case 'menu':
      return onMenu(state, input, now);
    case 'tick':
      return onTick(state, now, input.alive);
    case 'wake': // the pointer touched a sleeping pet
      if (moodOf(state, now) !== 'sleeping') return { state, effects: [] };
      return {
        state: { ...state, lastClickAt: now, transient: transient('startled', now) },
        effects: [
          { type: 'bubble', text: "I WASN'T ASLEEP. I WAS CACHING.", ms: 2000 },
          { type: 'sound', name: 'startle' },
        ],
      };
    case 'hook':
      return onHook(state, input.event, now);
    default:
      return { state, effects: [] };
  }
}

module.exports = {
  initialState,
  sessionCount,
  reduce,
  moodOf,
  recordLine,
  turnActive,
  nextLevelOf,
  fillSentPhrase,
  MAX_LEVEL,
};
