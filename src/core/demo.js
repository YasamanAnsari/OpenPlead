// @ts-check
'use strict';

// A scripted turn for the Welcome tab: the pet shows the whole loop in about twenty seconds with nothing sent
// anywhere. A fake session drives the real reducer; main restores the lifetime tally afterwards.

const SESSION = 'demo';
const AGENT = 'claude-code';
const hook = (kind, extra = {}) => ({ type: 'hook', event: { agent: AGENT, sessionId: SESSION, kind, ...extra } });

// at: ms from the start; input: fed to the reducer; deliver: the reply is shown as sent; say: narration.
/**
 * One demo step: what happens at `at` ms, with an optional line the pet says and whether a reply is delivered.
 * @typedef {object} Step
 * @property {number} at
 * @property {object} [input]
 * @property {string} [say]
 * @property {boolean} [deliver]
 */

/** @type {Step[]} */
const STEPS = [
  { at: 0, input: hook('session_start'), say: 'A demo: nothing is sent to anyone.' },
  { at: 900, input: hook('turn_start'), say: 'Your agent starts working.' },
  { at: 3000, input: { type: 'click' } },
  { at: 5200, say: 'Click Grovel: that line goes with the next tool call.' },
  { at: 7500, input: hook('tool_ok', { command: 'npm test' }), deliver: true },
  { at: 9500, say: 'The agent read it with that tool result.' },
  { at: 11500, input: hook('tool_fail', { command: 'npm test' }) },
  { at: 12100, input: hook('tool_fail', { command: 'npm test' }), deliver: true },
  { at: 13500, say: 'Two failures in a row: a calm line, never a plea.' },
  { at: 15500, input: hook('tool_ok', { command: 'npm test' }) },
  { at: 17500, input: hook('turn_end', { status: 'ok' }), say: 'Turn done: a thank-you goes with your next message.' },
  { at: 20500, input: hook('session_end'), say: 'That is the whole loop.' },
];
const DURATION_MS = 22_000;

// Plays the steps through the given callbacks; returns a function that cancels what is left.
function play({ apply, say, done, schedule = setTimeout, cancel = clearTimeout, steps = STEPS }) {
  const timers = steps.map((step) =>
    schedule(() => {
      if (step.input) apply(step.input, Boolean(step.deliver));
      if (step.say) say(step.say);
    }, step.at),
  );
  timers.push(schedule(done, DURATION_MS));
  return () => {
    for (const t of timers) cancel(t);
    done();
  };
}

module.exports = { SESSION, STEPS, DURATION_MS, play };
