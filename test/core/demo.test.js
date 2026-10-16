'use strict';

// The scripted demo turn: ordered, bounded, cancellable, and played through the real reducer.
const test = require('node:test');
const assert = require('node:assert/strict');
const { STEPS, DURATION_MS, play, SESSION } = require('../../src/core/demo');
const { initialState, reduce } = require('../../src/core/state');

test('the demo script is ordered, bounded, and walks the real reducer through the whole loop', () => {
  for (let i = 1; i < STEPS.length; i += 1) assert.ok(STEPS[i].at > STEPS[i - 1].at, 'steps are in time order');
  assert.ok(STEPS.at(-1).at < DURATION_MS);
  let state = initialState(0);
  const kinds = [];
  for (const step of STEPS) {
    if (!step.input) continue;
    const r = reduce(state, step.input, step.at);
    state = r.state;
    kinds.push(...r.effects.filter((e) => e.type === 'reply').map((e) => e.kind));
  }
  assert.deepEqual(kinds, ['plea', 'calm'], 'a plea is delivered, then a calm line; thanks waits for the next prompt');
  assert.deepEqual(Object.keys(state.sessions), [], 'the fake session is gone at the end');
  assert.ok(STEPS.every((s) => !s.input || s.input.type !== 'hook' || s.input.event.sessionId === SESSION));
});

test('play schedules every step and done, and cancel clears what is left and still reports done once', () => {
  const scheduled = [];
  const cancelled = [];
  let doneCount = 0;
  const applied = [];
  const said = [];
  const cancel = play({
    apply: (input, deliver) => applied.push([input.type, deliver]),
    say: (text) => said.push(text),
    done: () => (doneCount += 1),
    schedule: (fn, at) => (scheduled.push({ fn, at }), scheduled.length),
    cancel: (id) => cancelled.push(id),
  });
  assert.equal(scheduled.length, STEPS.length + 1);
  scheduled[0].fn();
  scheduled[2].fn();
  assert.deepEqual(applied, [
    ['hook', false],
    ['click', false],
  ]);
  assert.equal(said[0], 'A demo: nothing is sent to anyone.');
  cancel();
  assert.equal(cancelled.length, STEPS.length + 1);
  assert.equal(doneCount, 1);
});
