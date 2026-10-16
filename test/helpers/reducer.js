'use strict';

// Shared scaffolding for tests that drive the pure reducer: a fixed clock, a Claude Code hook event, and a runner that
// plays a scripted sequence of inputs and collects every effect with its offset from the start.
const { initialState, reduce } = require('../../src/core/state');

const T0 = 1_000_000;
const hook = (kind, extra = {}) => ({ type: 'hook', event: { agent: 'claude-code', sessionId: 's1', kind, ...extra } });
const click = { type: 'click' };

// Runs [input, offsetMs] steps from a fresh state and returns the final state, every effect and the clock.
function run(steps, settings) {
  let state = initialState(T0, settings);
  const effects = [];
  let now = T0;
  for (const [input, dt = 0] of steps) {
    now += dt;
    const r = reduce(state, input, now);
    state = r.state;
    effects.push(...r.effects.map((e) => ({ ...e, at: now - T0 })));
  }
  return { state, effects, now };
}
const replies = (effects) => effects.filter((e) => e.type === 'reply');
const bubbles = (effects) => effects.filter((e) => e.type === 'bubble').map((e) => e.text);
// A session that has started a turn and is running its first tool.
const inTurn = [[hook('session_start')], [hook('turn_start')], [hook('tool_start')]];

module.exports = { T0, hook, click, run, replies, bubbles, inTurn };
