'use strict';

// Two sessions at once: one session's turn end or interrupt never delivers, drops or replaces a line meant for the
// other, and an API error never leaves the "needs your OK" state behind.
const test = require('node:test');
const assert = require('node:assert/strict');
const { initialState, reduce } = require('../../src/core/state');

const T0 = 1_000_000;
const on = (sessionId, kind, extra = {}) => ({
  type: 'hook',
  event: { agent: 'claude-code', sessionId, kind, ...extra },
});
function run(steps) {
  let state = initialState(T0);
  const effects = [];
  let now = T0;
  for (const input of steps) {
    now += 100;
    const r = reduce(state, input, now);
    state = r.state;
    effects.push(...r.effects.map((e) => ({ ...e, at: now })));
  }
  return { state, effects };
}
// A and B both working; B started first, A took the last prompt, so A is in front.
const bothWorking = [
  on('B', 'session_start'),
  on('B', 'turn_start'),
  on('B', 'tool_start'),
  on('A', 'session_start'),
  on('A', 'turn_start'),
  on('A', 'tool_start'),
];

test("B's turn end neither receives nor drops a plea clicked for A", () => {
  const { state, effects } = run([...bothWorking, { type: 'click' }, on('B', 'turn_end', { status: 'ok' })]);
  assert.deepEqual(
    effects.filter((e) => e.type === 'reply' && e.kind === 'plea'),
    [],
    'B got no plea',
  );
  assert.equal(state.pending && state.pending.to, 'A', "the plea still waits for A's next tool call");
  const later = reduce(state, on('A', 'tool_ok', { command: 'ls' }), T0 + 5000);
  assert.deepEqual(
    later.effects.filter((e) => e.type === 'reply').map((e) => e.kind),
    ['plea'],
    'A gets it',
  );
});

test("a plea saved for A's next message survives B's turn end, and B's thanks does not replace it", () => {
  const { state, effects } = run([
    ...bothWorking,
    on('A', 'turn_end', { status: 'ok' }),
    { type: 'click' }, // A waits for the user: saved for A's next message
    on('B', 'turn_end', { status: 'ok' }),
  ]);
  assert.equal(state.nextPrompt.kind, 'plea');
  assert.equal(state.nextPrompt.to, 'A');
  assert.equal(effects.filter((e) => e.type === 'dropped').length, 0, 'nothing dropped silently or otherwise');
});

test("an interrupt in B ends B's turn only, and A's plea is neither dropped nor cleared", () => {
  const { state, effects } = run([
    ...bothWorking,
    { type: 'click' },
    on('B', 'tool_fail', { command: 'x', isInterrupt: true }),
  ]);
  assert.equal(state.sessions.B.turnActive, false, 'B was interrupted');
  assert.equal(state.sessions.A.turnActive, true, 'A keeps working');
  assert.equal(state.pending && state.pending.to, 'A');
  assert.equal(effects.filter((e) => e.type === 'dropped').length, 0);
  const aborted = run([...bothWorking, { type: 'click' }, on('B', 'turn_end', { status: 'aborted' })]);
  assert.equal(aborted.state.sessions.A.turnActive, true);
  assert.equal(aborted.state.pending && aborted.state.pending.to, 'A');
});

test("an interrupt in the session in front still drops that session's plea, as before", () => {
  const { state, effects } = run([
    ...bothWorking,
    { type: 'click' },
    on('A', 'tool_fail', { command: 'x', isInterrupt: true }),
  ]);
  assert.equal(state.pending, null);
  assert.deepEqual(
    effects.filter((e) => e.type === 'dropped').map((e) => e.reason),
    ['interrupted'],
  );
});

test('an API error at the end of a turn clears a leftover permission wait', () => {
  const { state } = run([
    on('A', 'session_start'),
    on('A', 'turn_start'),
    on('A', 'permission_wait'),
    on('A', 'turn_end', { status: 'error' }),
  ]);
  assert.equal(state.permissionWait, false);
});
