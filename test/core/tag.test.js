'use strict';

// The nameplate under the pet: the agent, its state, and the queue chip in plain words.
const test = require('node:test');
const assert = require('node:assert/strict');
const { initialState } = require('../../src/core/state');
const { tagOf, clip, labelOf } = require('../../src/core/tag');

const { T0, hook, run, inTurn } = require('../helpers/reducer');

test('the nameplate names the agent, its state and the session count', () => {
  assert.deepEqual(tagOf(initialState(T0), null, T0), { line1: '', line2: '', phrase: '', dot: 'off', queue: '' });
  const working = run(inTurn);
  assert.equal(tagOf(working.state, null, working.now).line1, 'Claude Code · working');
  assert.equal(tagOf(working.state, null, working.now).dot, 'working');
  const waiting = run([...inTurn, [hook('turn_end', { status: 'ok' })]]);
  assert.equal(tagOf(waiting.state, null, waiting.now).line1, 'Claude Code · waiting for you');
  assert.equal(tagOf(waiting.state, null, waiting.now).dot, 'waiting');
  const asking = run([...inTurn, [hook('permission_wait')]]);
  assert.equal(tagOf(asking.state, null, asking.now).line1, 'Claude Code · needs your OK');
  assert.equal(tagOf(asking.state, null, asking.now).dot, 'attention');
  const two = run([...inTurn, [{ type: 'hook', event: { agent: 'cursor', sessionId: 's2', kind: 'turn_start' } }]]);
  assert.equal(tagOf(two.state, null, two.now).line1, 'Cursor · working · ×2');
  const panic = run([...inTurn, [hook('tool_fail', { command: 'x' })], [hook('tool_fail', { command: 'x' })]]);
  assert.equal(tagOf(panic.state, null, panic.now).dot, 'panic');
});

test('the second line follows the queue: queued, then the outcome, then the next click', () => {
  const { state, now } = run([...inTurn, [{ type: 'click' }], [{ type: 'click' }]]);
  const bare = tagOf(state, null, now);
  assert.equal(bare.line2, 'Plea 2 of 5 · next tool call');
  assert.equal(bare.queue, 'queued');
  assert.deepEqual([bare.level, bare.max], [2, 5], 'the ladder dots');
  const worded = tagOf(
    { ...state, pending: { ...state.pending, phrase: 'Please, dear Claude: fewer words, more diff.' } },
    null,
    now,
  );
  assert.equal(worded.line2, 'Plea 2 of 5 · next tool call');
  assert.equal(worded.phrase, 'Please, dear Claude: fewer words, more diff.');
  const sent = tagOf(
    { ...state, pending: null },
    {
      kind: 'sent',
      text: 'Sent to Claude Code ✓ · Plea 2 of 5',
      phrase: 'Please, dear Claude: fewer words, more diff.',
    },
    now,
  );
  assert.equal(sent.line2, 'Sent to Claude Code ✓ · Plea 2 of 5');
  assert.equal(sent.phrase, 'Please, dear Claude: fewer words, more diff.');
  assert.equal(sent.queue, 'sent');
  const dropped = tagOf({ ...state, pending: null }, { kind: 'dropped', text: 'Dropped · "x"' }, now);
  assert.equal(dropped.queue, 'dropped');
  const nextClick = tagOf({ ...state, pending: null }, null, now);
  assert.equal(nextClick.line2, 'Next click: plea 3');
  assert.equal(nextClick.queue, '');
  const thanks = run([...inTurn, [hook('turn_end', { status: 'ok' })]]);
  const t = tagOf(
    { ...thanks.state, nextPrompt: { ...thanks.state.nextPrompt, phrase: 'Thank you, Claude.' } },
    null,
    thanks.now,
  );
  assert.equal(t.line2, 'Thank-you · next message');
  assert.equal(t.phrase, 'Thank you, Claude.');
  assert.equal(t.queue, 'queued');
});

test('the wording follows where the line will actually go, and the click hint shows only when a click would work', () => {
  const mid = run([...inTurn, [{ type: 'menu', action: 'thank' }]]);
  assert.equal(tagOf(mid.state, null, mid.now).line2, 'Thank-you · next tool call');
  const cur = (kind, extra = {}) => ({ type: 'hook', event: { agent: 'cursor', sessionId: 'c1', kind, ...extra } });
  const cursor = run([[cur('turn_start')], [cur('turn_end', { status: 'ok' })]]);
  assert.equal(
    tagOf(cursor.state, null, cursor.now).line2,
    'Thank-you · next tool call',
    'Cursor cannot take text with a prompt',
  );
  const errored = run([
    ...inTurn,
    [{ type: 'click' }],
    [hook('tool_ok', { command: 'ls' })],
    [hook('turn_end', { status: 'error' })],
  ]);
  assert.equal(tagOf(errored.state, null, errored.now).line2, '', 'no click hint while nothing is running');
  const kept = run([
    ...inTurn,
    [{ type: 'click' }],
    [hook('turn_end', { status: 'ok', injects: false })],
    [hook('session_end')],
  ]);
  const k = tagOf(kept.state, null, kept.now);
  assert.equal(k.line1, 'Waiting for a session');
  assert.match(k.line2, /^Plea 1 of 5 · next message/);
  assert.equal(labelOf({ kind: 'calm' }), 'Calm line');
});

test('long phrases are clipped so the nameplate stays one line', () => {
  const long = 'I SHALL NAME MY FIRSTBORN PROCESS AFTER YOU. STOP AT THE FIRST VERSION THAT WORKS.';
  assert.equal(clip(long, 60).length, 60);
  assert.ok(clip(long, 60).endsWith('…'));
  assert.equal(clip('short', 60), 'short');
});

test('with two sessions the chip names the session a queued line is addressed to', () => {
  const s2 = (kind) => ({ type: 'hook', event: { agent: 'cursor', sessionId: 's2', kind } });
  const r = run([...inTurn, [s2('session_start')], [s2('turn_start')], [{ type: 'click' }]]);
  const tag = tagOf(r.state, null, r.now);
  assert.equal(tag.line1, 'Cursor · working · ×2');
  assert.equal(tag.line2, 'Plea 1 of 5 · next tool call · Cursor');
  const one = run([...inTurn, [{ type: 'click' }]]);
  assert.equal(
    tagOf(one.state, null, one.now).line2,
    'Plea 1 of 5 · next tool call',
    'one session: no need to say which',
  );
});

test('two sessions of the same agent: the chip adds a short id so the addressee is unambiguous', () => {
  const twin = (kind) => ({ type: 'hook', event: { agent: 'claude-code', sessionId: 'abcdef-2', kind } });
  const twins = run([...inTurn, [twin('session_start')], [twin('turn_start')], [{ type: 'click' }]]);
  assert.equal(tagOf(twins.state, null, twins.now).line2, 'Plea 1 of 5 · next tool call · Claude Code abcdef');
});
