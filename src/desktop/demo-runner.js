// @ts-check
'use strict';

const coreDemo = require('../core/demo');
const { initialState } = require('../core/state');

// The Welcome demo: a fake session through the real reducer on a state of its own, so nothing it does can reach a
// real agent; the live state and the nameplate come back untouched. Any real hook ends it.

//   live                 { get(): { state, outcome }, set({ state, outcome }) } the values main owns
//   settings(), sessionCount(), dispatch(input), onDelivered(reply), say(text), render(), clearChatter()
function createDemoRunner({
  demo = coreDemo, // a test hands in a scripted one
  live,
  settings,
  sessionCount,
  dispatch,
  onDelivered,
  say,
  render,
  clearChatter,
}) {
  let cancel = null; // the cancel function while the demo plays
  let real = null; // what was set aside

  function run() {
    if (cancel || !live.get().state) return;
    if (sessionCount()) return say('Finish the current agent session first, then try the demo.', 5000, 2);
    clearChatter(); // chatter from before must not surface in the middle of the demo
    real = live.get();
    live.set({
      state: { ...initialState(Date.now(), { thanks: settings().thanks }), stats: real.state.stats },
      outcome: null,
    });
    const steps = settings().thanks
      ? demo.STEPS
      : demo.STEPS.map((step) =>
          step.say && step.say.startsWith('Turn done')
            ? { ...step, say: 'Turn done. A thank-you would go with your next message; that is off in your settings.' }
            : step,
        );
    cancel = demo.play({
      steps,
      apply: (input, deliver) => {
        const reply = dispatch(input);
        if (deliver && reply) onDelivered(reply);
      },
      say: (text) => say(text, undefined, 2),
      done: () => {
        cancel = null;
        live.set(real);
        real = null;
        render();
      },
    });
    render();
    return undefined;
  }

  return {
    run,
    running: () => Boolean(cancel),
    // A real session arrived, or the app quits: back to the real state at once.
    stop: () => cancel && cancel(),
    // The live state a demo must not disturb, for the tray badge.
    realState: () => (real ? real.state : live.get().state),
  };
}

module.exports = { createDemoRunner };
