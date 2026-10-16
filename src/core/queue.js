// @ts-check
'use strict';

// What main keeps next to the reducer's queue: the words of each queued item, and the last outcome shown.

// The words for anything queued are chosen the moment it is queued, so the bubble can show them and the agent
// later receives exactly those words. pick(kind, level) may throw (a broken phrases.json): the item is then
// marked so the file is not re-read on every tick, and the reply itself reports the problem.
/** @param {(err: Error) => void} [onError] */
function fillPhrases(state, pick, onError = () => {}) {
  const fill = (item, kind) => {
    if (!item || item.phrase || item.phraseFailed) return item;
    try {
      return { ...item, phrase: pick(kind, item.level || 0) };
    } catch (err) {
      onError(err);
      return { ...item, phraseFailed: true };
    }
  };
  const pending = fill(state.pending, 'plea');
  const nextPrompt = fill(state.nextPrompt, state.nextPrompt && state.nextPrompt.kind);
  return pending === state.pending && nextPrompt === state.nextPrompt ? state : { ...state, pending, nextPrompt };
}

// The nameplate keeps the last outcome ("Sent ✓", "Dropped …") only until the queue changes: a new item, an item
// gone without a reply or a dropped notice (a reset), or no session left clears it, so an old "Sent ✓" never
// reads as a fresh one.
function keepOutcome(outcome, prev, next, effects) {
  if (!outcome) return null;
  const queued = (s) => s.pending || s.nextPrompt;
  const settled = effects.some((e) => e.type === 'reply' || e.type === 'dropped');
  if (queued(next) && queued(next) !== queued(prev)) return null;
  if (queued(prev) && !queued(next) && !settled) return null;
  if (!Object.keys(next.sessions).length) return null;
  return outcome;
}

module.exports = { fillPhrases, keepOutcome };
