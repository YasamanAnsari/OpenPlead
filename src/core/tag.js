// @ts-check
'use strict';

const { moodOf, sessionCount, MAX_LEVEL } = require('./state');
const { agentName } = require('./apps');

// The nameplate under the pet: which agent is doing what, the queue status in plain words with where the line
// goes, and the words themselves for the bubble. Pure: main hands it the state plus the last outcome it recorded
// ({ kind: 'sent' | 'dropped', text, phrase? }).

const KIND_LABELS = {
  thanks: 'Thank-you',
  suspicious: 'Question',
  deadline: 'Deadline note',
  thinking: 'Nudge',
  hug: 'Reassurance',
  zen: 'Take your time',
  apology: 'Apology',
  calm: 'Calm line',
};
const MAX_PHRASE = 90;

const clip = (s, n = MAX_PHRASE) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function labelOf({ kind, level = 0 }) {
  return kind === 'plea' ? `Plea ${level} of ${MAX_LEVEL}` : KIND_LABELS[kind] || kind;
}

// The status dot beside the name: off without a session, else the most urgent of panic, attention, working.
function dotFor(state, session, now) {
  if (!session) return 'off';
  if (moodOf(state, now) === 'panic') return 'panic';
  if (state.permissionWait) return 'attention';
  return session.turnActive ? 'working' : 'waiting';
}

function tagOf(state, outcome, now) {
  const session = state.activeSession ? state.sessions[state.activeSession] : null;
  const count = sessionCount(state);
  // The agent's state as the user experiences it: working, blocked on a permission, or done and waiting.
  const doing = state.permissionWait ? 'needs your OK' : session && session.turnActive ? 'working' : 'waiting for you';
  const line1 = session
    ? `${agentName(session.agent)} · ${doing}${count > 1 ? ` · ×${count}` : ''}`
    : state.nextPrompt
      ? 'Waiting for a session'
      : '';
  // Where a saved line actually goes: mid-turn, and always for Cursor, it rides on the next tool call.
  const soon = session && (session.turnActive || session.agent === 'cursor') ? 'next tool call' : 'next message';
  const dot = dotFor(state, session, now);
  const words = (item) => (item && item.phrase ? clip(item.phrase) : '');
  // With more than one session alive, the chip names the one a queued line is addressed to.
  const addressee = (item) => {
    const target = item && item.to && count > 1 ? state.sessions[item.to] : null;
    if (!target) return '';
    const name = agentName(target.agent);
    const twins = Object.values(state.sessions).filter((s) => s.agent === target.agent).length > 1;
    return ` · ${name}${twins ? ` ${item.to.slice(0, 6)}` : ''}`; // two of the same agent: the id tells them apart
  };
  if (state.pending) {
    return {
      line1,
      line2: `${labelOf({ kind: 'plea', level: state.pending.level })} · next tool call${addressee(state.pending)}`,
      phrase: words(state.pending),
      dot,
      queue: 'queued',
      level: state.pending.level,
      max: MAX_LEVEL,
    };
  }
  if (state.nextPrompt)
    return {
      line1,
      line2: `${labelOf(state.nextPrompt)} · ${soon}${addressee(state.nextPrompt)}`,
      phrase: words(state.nextPrompt),
      dot,
      queue: 'queued',
    };
  if (outcome) return { line1, line2: outcome.text, phrase: words(outcome), dot, queue: outcome.kind };
  if (state.level > 0 && session && session.turnActive) {
    return { line1, line2: `Next click: plea ${Math.min(MAX_LEVEL, state.level + 1)}`, phrase: '', dot, queue: '' };
  }
  return { line1, line2: '', phrase: '', dot, queue: '' };
}

module.exports = { clip, labelOf, tagOf };
