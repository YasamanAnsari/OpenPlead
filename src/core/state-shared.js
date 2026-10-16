// @ts-check
'use strict';

// What the reducer's parts share: the timing constants, the session and ladder helpers, and the queue rules (what is
// addressed to whom, what is fresh, how a queued line goes out). Pure, like everything in the reducer.

const { match: matchReply } = require('./replies');

/** @typedef {import('./types').Session} Session */

const MAX_LEVEL = 5;
const PLEA_TTL = 2 * 60_000;
const LEVEL_TTL = 2 * 60_000;
const SLEEP_AFTER = 60_000;
const SESSION_TTL = 10 * 60_000;
// A turn with no hooks for this long is treated as interrupted. Long thinking and long text answers are
// silent too, so this must be generous; 90 s of silence only queues a "thinking too long" line.
const ABORT_SILENCE = 5 * 60_000;
const THINKING_AFTER = 90_000;
const PANIC_STREAK = 2;
// Cursor runs both its native prompt hook and the imported Claude Code one, so one prompt can arrive twice.
const DUPLICATE_TURN_MS = 2000;

const TRANSIENT_MS = { shrug: 1500, 'joy-cry': 2000, thank: 3000, panic: 2000, plead: 3000, startled: 900 };

// Three or more tool failures in one turn and a clean finish: ask whether the tests passed or were persuaded.
const SUSPICIOUS_FAILURES = 3;

/** The sessions the reducer knows about, alive or waiting. */
const sessionCount = (state) => Object.keys(state.sessions).length;

function activeSession(state) {
  return state.activeSession ? state.sessions[state.activeSession] : null;
}

function turnActive(state) {
  const s = activeSession(state);
  return Boolean(s && s.turnActive);
}

function transient(mood, now) {
  return { mood, until: now + TRANSIENT_MS[mood] };
}

/** @returns {Session} */
function freshSession(agent, now) {
  return {
    agent,
    lastSeen: now,
    turnActive: false,
    turnSince: 0,
    errorStreak: 0,
    failedCommands: [],
    turnFailures: 0,
    thinkingSent: false,
    sent: [], // the lines that went out this turn: { kind, level, phrase, invite }
  };
}

function resetLadder(state) {
  return { ...state, level: 0, pending: null, nextPrompt: null, pleadUntil: 0 };
}

// Clears what is queued for session `id` and leaves lines addressed to another session alone. The ladder and the
// deadline belong to the session the nameplate shows, so they reset only when that is `id`.
function clearFor(state, id) {
  const mine = (item) => Boolean(item) && addressed(item, id);
  const front = !state.activeSession || state.activeSession === id;
  return {
    ...state,
    pending: mine(state.pending) ? null : state.pending,
    nextPrompt: mine(state.nextPrompt) ? null : state.nextPrompt,
    ...(front ? { level: 0, pleadUntil: 0, deadlineUntil: 0, deadlineMinutes: 0 } : {}),
  };
}

// The user interrupted session `id` (by default the one in front): its turn ends, and a plea queued for it is
// reported as dropped. Another session's turn and lines are untouched.
function abort(state, now, effects, id = state.activeSession) {
  effects.push({ type: 'bubble', text: 'oh' });
  const mine = (item) => Boolean(item) && addressed(item, id);
  const plea = mine(state.pending)
    ? state.pending
    : mine(state.nextPrompt) && state.nextPrompt.kind === 'plea'
      ? state.nextPrompt
      : null;
  if (plea) effects.push(dropped('plea', plea, 'interrupted'));
  const s = id ? state.sessions[id] : null;
  const sessions = s
    ? { ...state.sessions, [id]: { ...s, turnActive: false, errorStreak: 0, failedCommands: [] } }
    : state.sessions;
  return { ...clearFor(state, id), sessions, transient: null, permissionWait: false };
}

function mostRecent(sessions) {
  let best = null;
  for (const [id, s] of Object.entries(sessions)) if (!best || s.lastSeen > sessions[best].lastSeen) best = id;
  return best;
}

function deliverNextPrompt(state, effects) {
  const { kind, level = 0, phrase } = state.nextPrompt;
  effects.push(withPhrase({ type: 'reply', kind, level }, phrase));
  const next = { ...state, nextPrompt: null };
  return kind === 'plea'
    ? { ...next, level: Math.max(next.level, level), stats: { ...next.stats, pleas: next.stats.pleas + 1 } }
    : next;
}

function deliverPending(state, effects) {
  effects.push(withPhrase({ type: 'reply', kind: 'plea', level: state.pending.level }, state.pending.phrase));
  if (state.pending.level === MAX_LEVEL) effects.push({ type: 'sound', name: 'sob' });
  return { ...state, pending: null, pleadUntil: 0, stats: { ...state.stats, pleas: state.stats.pleas + 1 } };
}

const fresh = (item, now) => Boolean(item) && (item.saved || now - item.at <= PLEA_TTL); // saved: waits for the prompt

// Everything queued is addressed to one session (null: any session): what the user clicks goes to the session the
// nameplate shows, what a turn produces (thanks, a carried plea) goes to that turn's session. A line is delivered only
// by an event of the session it is addressed to, so with two agents alive nothing lands in the wrong tool result.
const queue = (state, now, item, to = state.activeSession) => ({ ...item, at: now, to });

const withPhrase = (item, phrase) => (phrase ? { ...item, phrase } : item);

// reason: 'expired' (nothing to attach it to for two minutes), 'interrupted', 'session ended'.
const dropped = (kind, item, reason) =>
  withPhrase({ type: 'dropped', kind, level: item.level || 0, reason }, item.phrase);

const addressed = (item, sessionId) => !item.to || item.to === sessionId;

// At an event that can carry text: the clicked plea first, otherwise whatever was saved for this turn.
function deliverQueued(state, now, effects, sessionId) {
  if (state.permissionWait) return state;
  if (fresh(state.pending, now) && addressed(state.pending, sessionId)) return deliverPending(state, effects);
  if (fresh(state.nextPrompt, now) && addressed(state.nextPrompt, sessionId)) return deliverNextPrompt(state, effects);
  return state;
}

// The nameplate, and with it the address of a clicked plea, follows the conversation the user last wrote in: a
// session becomes the active one when it starts or takes a prompt, not for every tool call it makes while another
// session is the one in front.
const FOLLOW = new Set(['session_start', 'turn_start']);

const follows = (state, event, id) =>
  FOLLOW.has(event.kind) || !state.activeSession || !state.sessions[state.activeSession] ? id : state.activeSession;

// The reply in `text` to one of the session's invited lines: the effect to emit and the lines left (the answered one
// is taken off the list, so it cannot be answered twice).
function answerIn(text, sess) {
  const candidates = (sess.sent || []).map((line, i) => ({ ...line, i })).filter((line) => line.invite !== false);
  const m = matchReply(text, candidates);
  if (!m) return null;
  const line = candidates[m.index];
  return {
    effect: {
      type: 'reply-seen',
      agent: sess.agent,
      plea: line.phrase || '',
      kind: line.kind,
      level: line.level || 0,
      reply: m.reply,
    },
    sent: sess.sent.filter((_, i) => i !== line.i),
  };
}

// Main picks the words of a calm or suspicious line only when it goes out; it hands them back here so the log and
// the card can show what the agent answered.
function fillSentPhrase(state, sessionId, phrase) {
  const sess = state.sessions[sessionId];
  if (!sess || !phrase) return state;
  const sent = [...(sess.sent || [])];
  for (let i = sent.length - 1; i >= 0; i -= 1) {
    if (!sent[i].phrase) {
      sent[i] = { ...sent[i], phrase };
      return { ...state, sessions: { ...state.sessions, [sessionId]: { ...sess, sent } } };
    }
  }
  return state;
}

module.exports = {
  sessionCount,
  clearFor,
  activeSession,
  turnActive,
  transient,
  freshSession,
  resetLadder,
  abort,
  mostRecent,
  deliverNextPrompt,
  deliverPending,
  fresh,
  queue,
  withPhrase,
  dropped,
  addressed,
  deliverQueued,
  follows,
  answerIn,
  fillSentPhrase,
  MAX_LEVEL,
  PLEA_TTL,
  LEVEL_TTL,
  SLEEP_AFTER,
  SESSION_TTL,
  ABORT_SILENCE,
  THINKING_AFTER,
  PANIC_STREAK,
  DUPLICATE_TURN_MS,
  TRANSIENT_MS,
  SUSPICIOUS_FAILURES,
};
