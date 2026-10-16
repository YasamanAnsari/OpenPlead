'use strict';

// Speech bubbles: an outcome holds its spot, chatter waits or is dropped, and reading time follows the word count.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBubbleGate, readingMs } = require('../../src/desktop/bubbles');

test('an outcome bubble holds its spot for a moment; held chatter is shown afterwards, not lost', () => {
  let t = 0;
  const timers = [];
  const shown = [];
  const gate = createBubbleGate({ now: () => t, schedule: (fn, ms) => timers.push([fn, ms]) });
  const show = (b) => shown.push(b.text);
  assert.ok(gate.offer({ text: 'Sent ✓', ms: 3000, priority: 2 }, show));
  t = 1000;
  assert.ok(!gate.offer({ text: 'Bye! 1 plea, 1 thank', ms: 3000, priority: 1 }, show), 'held, not dropped');
  assert.deepEqual(shown, ['Sent ✓']);
  assert.equal(timers[0][1], 2000, 'shown when the hold ends');
  t = 1500;
  assert.ok(
    !gate.offer({ text: 'Thinking a long time…', ms: 4000, priority: 1 }, show),
    'a later one replaces the held one',
  );
  t = 3000;
  for (const [fn] of timers) fn();
  assert.deepEqual(shown, ['Sent ✓', 'Thinking a long time…'], 'only the latest held bubble is shown, once');
  assert.ok(
    gate.offer({ text: 'Dropped', ms: 5000, priority: 2 }, show),
    'an equal or higher priority replaces at once',
  );
});

test('chatter that keeps losing its spot to outcomes is dropped after a while; clear() drops what is held', () => {
  let t = 0;
  const timers = [];
  const shown = [];
  const gate = createBubbleGate({
    now: () => t,
    schedule: (fn, ms) => timers.push([fn, ms]),
  });
  const show = (b) => shown.push(b.text);
  const fire = () => {
    for (const [fn] of timers.splice(0)) fn();
  };
  gate.offer({ text: 'Sent ✓', ms: 3000, priority: 2 }, show);
  t = 1000;
  assert.ok(!gate.offer({ text: 'Bye! 1 plea, 0 thanks', ms: 3000, priority: 1 }, show), 'held behind the outcome');
  t = 3000;
  gate.offer({ text: 'Dropped', ms: 3000, priority: 2 }, show); // a new outcome lands as the hold ends
  fire();
  assert.deepEqual(shown, ['Sent ✓', 'Dropped'], 'the goodbye waits again: two seconds old is not stale');
  t = 6000;
  gate.offer({ text: 'Sent ✓', ms: 3000, priority: 2 }, show);
  fire();
  t = 9000;
  fire();
  assert.deepEqual(shown, ['Sent ✓', 'Dropped', 'Sent ✓'], 'five seconds old when it next got a chance: dropped');
  gate.offer({ text: 'Sent ✓', ms: 3000, priority: 2 }, show);
  t = 9500;
  assert.ok(!gate.offer({ text: 'hello', ms: 3000, priority: 1 }, show));
  gate.clear();
  t = 12000;
  fire();
  assert.ok(!shown.includes('hello'), 'cleared while held: never shown');
  // Re-held just under the limit, then the hold ends with nothing new: still too old to show.
  shown.length = 0;
  t = 20000;
  gate.offer({ text: 'Sent ✓', ms: 3000, priority: 2 }, show);
  t = 20100;
  gate.offer({ text: 'Bye! 2 pleas, 1 thank', ms: 3000, priority: 1 }, show);
  t = 22900;
  gate.offer({ text: 'Dropped', ms: 3000, priority: 2 }, show);
  t = 23000;
  fire();
  t = 25900;
  fire();
  assert.deepEqual(shown, ['Sent ✓', 'Dropped'], 'the goodbye is 5.8 s old when the last hold ends: dropped');
});

test('a transient bubble stays long enough to read: four seconds at least, ten at most, by word count', () => {
  assert.equal(readingMs('Sent'), 4000);
  assert.equal(readingMs('Connected. Grovel appears when an agent session is alive.'), 1500 + 9 * 350, 'nine words');
  assert.equal(readingMs('word '.repeat(40)), 10_000);
});
