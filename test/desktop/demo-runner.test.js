'use strict';

// The Welcome demo: plays on a state of its own and hands the real one back untouched.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDemoRunner } = require('../../src/desktop/demo-runner');

function harness({ sessions = 0, thanks = true } = {}) {
  const live = { state: { sessions: {}, stats: { pleas: 7 }, real: true }, outcome: { kind: 'sent' } };
  const said = [];
  const applied = [];
  let played = null;
  let cancelled = false;
  let renders = 0;
  let cleared = 0;
  const runner = createDemoRunner({
    demo: {
      SESSION: 'demo',
      STEPS: [
        { at: 0, input: { type: 'click' } },
        { at: 10, input: { type: 'tick' }, say: 'Turn done: thanks go with your next message.' },
      ],
      play: ({ steps, apply, say, done }) => {
        played = { steps, apply, say, done };
        return () => {
          cancelled = true;
        };
      },
    },
    live: { get: () => ({ ...live }), set: (next) => Object.assign(live, next) },
    settings: () => ({ thanks }),
    sessionCount: () => sessions,
    dispatch: (input) => (applied.push(input), { kind: 'plea', level: 1 }),
    onDelivered: (reply) => applied.push(['delivered', reply.kind]),
    say: (text) => said.push(text),
    render: () => (renders += 1),
    clearChatter: () => (cleared += 1),
  });
  return {
    runner,
    live,
    said,
    applied,
    get played() {
      return played;
    },
    get cancelled() {
      return cancelled;
    },
    renders: () => renders,
    cleared: () => cleared,
  };
}

test('the demo plays on a fresh state that keeps the tally, and hands the real state back when done', () => {
  const h = harness();
  h.runner.run();
  assert.equal(h.runner.running(), true);
  assert.equal(h.cleared(), 1);
  assert.deepEqual(
    [h.live.state.sessions, h.live.state.stats.pleas, h.live.state.settings.thanks, h.live.outcome],
    [{}, 7, true, null],
    'a fresh state that keeps the tally',
  );
  assert.equal(h.runner.realState().real, true, 'the tray badge sees the real state');
  h.played.apply({ type: 'click' }, true);
  assert.deepEqual(h.applied, [{ type: 'click' }, ['delivered', 'plea']]);
  h.played.say('hello');
  assert.deepEqual(h.said, ['hello']);
  h.played.done();
  assert.equal(h.runner.running(), false);
  assert.deepEqual([h.live.state.real, h.live.outcome], [true, { kind: 'sent' }]);
  assert.ok(h.renders() >= 2);
});

test('it refuses while a real session is open, can be stopped, and rewords the thanks step when thanks are off', () => {
  const busy = harness({ sessions: 1 });
  busy.runner.run();
  assert.equal(busy.runner.running(), false);
  assert.match(busy.said[0], /Finish the current agent session first/);
  const off = harness({ thanks: false });
  off.runner.run();
  assert.match(off.played.steps[1].say, /that is off in your settings/);
  off.runner.stop();
  assert.equal(off.cancelled, true);
});
