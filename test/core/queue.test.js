'use strict';

// What main keeps next to the reducer's queue: the words chosen per item and the last outcome shown.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fillPhrases, keepOutcome } = require('../../src/core/queue');

test('phrases are picked once per queued item, failures are remembered, untouched state keeps its identity', () => {
  const picks = [];
  const pick = (kind, level) => {
    picks.push([kind, level]);
    if (kind === 'thanks') throw new Error('bad set');
    return `words ${level}`;
  };
  const errors = [];
  const s0 = { pending: { level: 2 }, nextPrompt: { kind: 'thanks' }, sessions: {} };
  const s1 = fillPhrases(s0, pick, (e) => errors.push(e.message));
  assert.equal(s1.pending.phrase, 'words 2');
  assert.equal(s1.nextPrompt.phraseFailed, true);
  assert.deepEqual(errors, ['bad set']);
  const s2 = fillPhrases(s1, pick);
  assert.equal(s2, s1, 'nothing left to pick: same object, no re-read');
  assert.equal(picks.length, 2);
  assert.equal(fillPhrases({ pending: null, nextPrompt: null, sessions: {} }, pick).pending, null);
});

test('the last outcome survives only until the queue changes or no session is left', () => {
  const sessions = { s1: {} };
  const sent = { kind: 'sent', text: 'Sent ✓ L1/5' };
  const idle = { pending: null, nextPrompt: null, sessions };
  const queued = { pending: { level: 1 }, nextPrompt: null, sessions };
  assert.equal(keepOutcome(sent, idle, idle, []), sent, 'nothing happened');
  assert.equal(keepOutcome(sent, idle, queued, [{ type: 'queued' }]), null, 'a new item replaces it');
  assert.equal(keepOutcome(sent, queued, idle, []), null, 'an item vanished without a word (reset)');
  assert.equal(
    keepOutcome(sent, queued, idle, [{ type: 'reply' }]),
    sent,
    'delivered: onDelivered will set the new one',
  );
  assert.equal(
    keepOutcome(sent, queued, idle, [{ type: 'dropped' }]),
    sent,
    'dropped: the effect handler sets the new one',
  );
  assert.equal(keepOutcome(sent, idle, { ...idle, sessions: {} }, []), null, 'last session gone');
  assert.equal(keepOutcome(null, idle, queued, []), null);
});
