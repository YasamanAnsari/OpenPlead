'use strict';

// The pure reducer: the plead ladder, queues, sessions, panics, sleep, deadlines and replies.
const test = require('node:test');
const assert = require('node:assert/strict');
const { reduce, moodOf, recordLine } = require('../../src/core/state');

const { T0, hook, click, run, replies, bubbles, inTurn } = require('../helpers/reducer');

test('clicks climb the ladder and cap at 5; the plea leaves on the next tool result at the highest level', () => {
  const clicks = Array.from({ length: 7 }, () => [click, 100]);
  const { state, effects, now } = run([...inTurn, ...clicks, [hook('tool_ok', { command: 'ls' })]]);
  assert.equal(state.level, 5);
  assert.deepEqual(
    replies(effects).map((e) => [e.kind, e.level]),
    [['plea', 5]],
  );
  assert.equal(state.pending, null);
  assert.equal(state.stats.pleas, 1);
  assert.equal(moodOf(state, now), 'working');
});

test('the pet shows plead-N while a plea is pending', () => {
  const { state, now } = run([...inTurn, [click], [click], [click]]);
  assert.equal(moodOf(state, now), 'plead-3');
});

test('a click with no session shrugs; between turns it saves the line for the next message and it waits', () => {
  const none = run([[click]]);
  assert.deepEqual(bubbles(none.effects), [
    "Pleading to an empty room. Open Claude Code or Cursor and I'll have an audience.",
  ]);
  assert.equal(moodOf(none.state, none.now), 'shrug');
  assert.equal(none.state.pending, null);
  // Waiting for you: the click saves a plea for the next message, replacing the thank-you waiting there.
  const waiting = run([...inTurn, [hook('turn_end', { status: 'ok' }), 100], [click, 100], [click, 100]]);
  assert.equal(waiting.state.nextPrompt.kind, 'plea');
  assert.equal(waiting.state.nextPrompt.level, 2, 'clicks climb');
  assert.ok(waiting.state.nextPrompt.saved);
  assert.deepEqual(
    waiting.effects.filter((e) => e.type === 'queued').map((e) => e.soon),
    ['next message', 'next message'],
  );
  // It does not expire while you think, and goes with the next prompt (Claude Code) or its first tool result (Cursor).
  const later = run([
    ...inTurn,
    [hook('turn_end', { status: 'ok' }), 100],
    [click, 100],
    [{ type: 'tick' }, 3 * 60_000],
    [hook('turn_start'), 1000],
  ]);
  assert.deepEqual(
    replies(later.effects).map((e) => [e.kind, e.level]),
    [['plea', 1]],
  );
  assert.equal(later.effects.filter((e) => e.type === 'dropped').length, 0);
  // The ladder fades between turns, the waiting plea does not: a later click climbs above it, and once it goes
  // out with the prompt the turn's clicks climb on from there.
  const climb = run([
    ...inTurn,
    [hook('turn_end', { status: 'ok' }), 100],
    [click, 100],
    [click, 100],
    [{ type: 'tick' }, 3 * 60_000],
    [click, 100],
    [hook('turn_start'), 1000],
    [hook('tool_start'), 100],
    [click, 100],
    [hook('tool_ok', { command: 'ls' }), 100],
  ]);
  assert.deepEqual(
    replies(climb.effects).map((e) => [e.kind, e.level]),
    [
      ['plea', 3],
      ['plea', 4],
    ],
  );
  const cursor = (kind, extra) => ({ type: 'hook', event: { agent: 'cursor', sessionId: 'c1', kind, ...extra } });
  const viaCursor = run([
    [cursor('session_start')],
    [cursor('turn_start', { injects: false })],
    [cursor('tool_ok', { command: 'ls' })],
    [cursor('turn_end', { status: 'ok', injects: false }), 100],
    [click, 100],
    [cursor('turn_start', { injects: false }), 500],
    [cursor('tool_ok', { command: 'pwd' }), 500],
  ]);
  assert.equal(replies(viaCursor.effects).filter((e) => e.kind === 'plea').length, 1);
});

test('a quiet session is kept while its agent process runs, and forgotten after ten minutes without one', () => {
  const alive = { type: 'tick', alive: ['s1'] };
  const kept = run([[hook('session_start')], [alive, 11 * 60_000], [alive, 60_000]]);
  assert.ok(kept.state.sessions.s1, 'the process is alive: a session waiting for you can wait as long as you do');
  assert.equal(kept.state.activeSession, 's1');
  const forgotten = run([[hook('session_start')], [{ type: 'tick' }, 11 * 60_000]]);
  assert.equal(forgotten.state.sessions.s1, undefined, 'no known process: ten minutes of silence ends it');
  const other = run([[hook('session_start')], [{ type: 'tick', alive: ['s9'] }, 11 * 60_000]]);
  assert.equal(other.state.sessions.s1, undefined, 'another session being alive does not keep this one');
});

test('a plea older than two minutes is dropped', () => {
  const { effects } = run([...inTurn, [click], [{ type: 'tick' }, 121_000], [hook('tool_ok', { command: 'ls' })]]);
  assert.deepEqual(
    replies(effects).filter((e) => e.kind === 'plea'),
    [],
  );
});

test('failures reply with a calm line, never a plea; two in a row panic', () => {
  const { state, effects, now } = run([
    ...inTurn,
    [click],
    [hook('tool_fail', { command: 'npm test' })],
    [hook('tool_fail', { command: 'npm test' })],
  ]);
  assert.deepEqual(
    replies(effects).map((e) => e.kind),
    ['calm'],
  );
  assert.equal(moodOf(state, now), 'panic');
  assert.ok(state.pending, 'the plea is still waiting for a success');
  assert.equal(state.stats.panics, 1);
});

test('a command that failed earlier and then succeeds triggers joy-cry', () => {
  const { state, now } = run([
    ...inTurn,
    [hook('tool_fail', { command: 'make' })],
    [hook('tool_ok', { command: 'make' })],
  ]);
  assert.equal(moodOf(state, now), 'joy-cry');
});

test('turn end thanks, resets the ladder, queues thanks for the next prompt and replies nothing on Stop', () => {
  const { state, effects, now } = run([
    ...inTurn,
    [click],
    [click],
    [hook('tool_ok', { command: 'ls' })],
    [hook('turn_end', { status: 'ok' })],
  ]);
  effects.splice(0, effects.length, ...effects.filter((e) => e.kind !== 'plea'));
  assert.deepEqual(replies(effects), []);
  assert.equal(state.level, 0);
  assert.equal(state.pending, null);
  assert.equal(state.nextPrompt.kind, 'thanks');
  assert.equal(moodOf(state, now), 'thank');
  const next = reduce(state, hook('turn_start'), now + 1000);
  assert.deepEqual(
    next.effects.map((e) => [e.type, e.kind]),
    [['reply', 'thanks']],
  );
  assert.equal(next.state.nextPrompt, null);
});

test('thanks can be turned off', () => {
  const { state } = run([...inTurn, [hook('turn_end', { status: 'ok' })]], { thanks: false });
  assert.equal(state.nextPrompt, null);
});

test('an interrupt (new prompt mid-turn, aborted stop, or is_interrupt) says oh and clears everything', () => {
  for (const abortInput of [
    hook('turn_start'),
    hook('turn_end', { status: 'aborted' }),
    hook('tool_fail', { isInterrupt: true }),
  ]) {
    const { state, effects } = run([...inTurn, [click], [click], [abortInput, 3000]]); // a real new prompt comes later than a duplicate
    assert.equal(bubbles(effects).at(-1), 'oh');
    assert.equal(state.level, 0);
    assert.equal(state.pending, null);
    assert.deepEqual(replies(effects), []);
  }
});

test('the same prompt reported twice within two seconds is not an interrupt', () => {
  const twice = run([[hook('session_start')], [hook('turn_start')], [click], [hook('turn_start'), 500]]);
  assert.ok(twice.state.pending, 'the plea survives');
  assert.ok(!bubbles(twice.effects).includes('oh'));
  const later = run([[hook('session_start')], [hook('turn_start')], [click], [hook('turn_start'), 2500]]);
  assert.equal(later.state.pending, null, 'a real new prompt mid-turn still interrupts');
});

test('ninety seconds of silence mid-turn queues one thinking line; five minutes counts as an abort', () => {
  const quiet = run([...inTurn, [{ type: 'tick' }, 91_000], [{ type: 'tick' }, 1000]]);
  assert.equal(quiet.state.nextPrompt.kind, 'thinking');
  assert.equal(bubbles(quiet.effects).filter((t) => t.startsWith('Thinking')).length, 1, 'once per turn');
  assert.equal(quiet.state.sessions.s1.turnActive, true, 'still a running turn');
  const delivered = reduce(quiet.state, hook('tool_ok', { command: 'ls' }), quiet.now + 1000);
  assert.deepEqual(
    delivered.effects.map((e) => e.kind),
    ['thinking'],
  );
  const { state, effects } = run([...inTurn, [click], [{ type: 'tick' }, 5 * 60_000 + 1]]);
  assert.equal(bubbles(effects).at(-1), 'oh');
  assert.equal(state.level, 0);
  assert.equal(state.sessions.s1.turnActive, false);
});

test('permission wait freezes delivery until the next tool event', () => {
  const { effects } = run([
    ...inTurn,
    [click],
    [hook('permission_wait')],
    [hook('tool_ok', { command: 'rm x' }), 1000],
    [hook('tool_ok', { command: 'ls' }), 1000],
  ]);
  assert.deepEqual(
    replies(effects).map((e) => e.at),
    [2000],
    'delivered on the second tool_ok only',
  );
});

test('two sessions show a badge and pleas go to the most recent one', () => {
  const s2 = (kind, extra) => ({ type: 'hook', event: { agent: 'cursor', sessionId: 's2', kind, ...extra } });
  const { state } = run([...inTurn, [s2('session_start')], [s2('turn_start')], [s2('tool_start')]]);
  assert.equal(state.activeSession, 's2');

  // Clicked while s2 is active: s1's next tool result must not carry it; s2's does.
  const both = [...inTurn, [s2('session_start')], [s2('turn_start')], [s2('tool_start')], [click]];
  const wrong = run([...both, [hook('tool_ok', { command: 'ls' })]]);
  assert.equal(replies(wrong.effects).length, 0);
  const right = run([...both, [hook('tool_ok', { command: 'ls' })], [s2('tool_ok', { command: 'ls' })]]);
  assert.equal(replies(right.effects).length, 1);
  // The addressee ends while another session is alive: the plea is dropped, not handed to the other conversation.
  const ended = run([...both, [s2('session_end')], [hook('tool_ok', { command: 'ls' })]]);
  assert.equal(replies(ended.effects).length, 0);
  assert.ok(ended.effects.some((e) => e.type === 'dropped' && e.reason === 'session ended'));
  // With nothing else alive it waits for a successor (claude --continue).
  const successor = run([
    ...inTurn,
    [click],
    [hook('session_end')],
    [{ type: 'hook', event: { agent: 'claude-code', sessionId: 's3', kind: 'session_start' } }],
    [{ type: 'hook', event: { agent: 'claude-code', sessionId: 's3', kind: 'turn_start' } }],
  ]);
  assert.ok(
    successor.state.nextPrompt === null || replies(successor.effects).length === 1,
    'carried to the next session',
  );
});

test('the last session ending waves goodbye with stats', () => {
  const { effects } = run([
    ...inTurn,
    [click],
    [hook('tool_ok', { command: 'ls' })],
    [hook('turn_end', { status: 'ok' })],
    [hook('session_end')],
  ]);
  assert.ok(bubbles(effects).includes('Bye! 1 plea, 1 thank'));

  // Lifetime stats carried over from disk do not inflate the goodbye: it counts this run only.
  const carried = run([[{ type: 'hook', event: { agent: 'claude-code', sessionId: 's1', kind: 'session_start' } }]]);
  let s = { ...carried.state, sessions: {}, activeSession: null, stats: { pleas: 40, thanks: 30, panics: 2 } };
  for (const input of [
    hook('session_start'),
    hook('turn_start'),
    hook('turn_end', { status: 'ok' }),
    hook('session_end'),
  ]) {
    const r = reduce(s, input, T0 + 10);
    s = r.state;
    if (input.event.kind === 'session_end')
      assert.ok(bubbles(r.effects).includes('Bye! 0 pleas, 1 thank'), bubbles(r.effects));
  }
  assert.equal(s.stats.thanks, 31, 'lifetime keeps counting');
  assert.equal(recordLine(s.stats), 'On record: 40 pleas, 31 thanks, 2 panics (kept for when the robots ask)');
});

test('sounds: sob only at level 5, chime on a finished turn, alarm on panic, cheer on joy-cry, bye on goodbye', () => {
  const sounds = (effects) => effects.filter((e) => e.type === 'sound').map((e) => e.name);
  const one = run([...inTurn, [click], [hook('tool_ok', { command: 'ls' })]]);
  assert.deepEqual(sounds(one.effects), []);
  const five = run([...inTurn, ...Array.from({ length: 5 }, () => [click, 100]), [hook('tool_ok', { command: 'ls' })]]);
  assert.deepEqual(sounds(five.effects), ['sob']);
  const panic = run([
    ...inTurn,
    [hook('tool_fail', { command: 'npm test' })],
    [hook('tool_fail', { command: 'npm test' })],
  ]);
  assert.deepEqual(sounds(panic.effects), ['alarm']);
  const joy = run([
    ...inTurn,
    [hook('tool_fail', { command: 'npm test' })],
    [hook('tool_ok', { command: 'npm test' })],
  ]);
  assert.deepEqual(sounds(joy.effects), ['cheer']);
  const done = run([...inTurn, [hook('turn_end', { status: 'ok' })], [hook('session_end')]]);
  assert.deepEqual(sounds(done.effects), ['chime', 'bye']);
});

test('the pet sleeps after a minute without hooks or clicks, and the level decays after two minutes', () => {
  const { state, now } = run([...inTurn, [click], [hook('turn_end', { status: 'ok' })], [{ type: 'tick' }, 61_000]]);
  assert.equal(moodOf(state, now), 'sleeping');
  const later = reduce({ ...state, level: 3 }, { type: 'tick' }, now + 60_000).state;
  assert.equal(later.level, 0);
});

test('the pointer wakes a sleeping pet: startled, then idle; hovering an awake pet does nothing', () => {
  const asleep = run([...inTurn, [hook('turn_end', { status: 'ok' })], [{ type: 'tick' }, 61_000]]);
  assert.equal(moodOf(asleep.state, asleep.now), 'sleeping');
  const woke = reduce(asleep.state, { type: 'wake' }, asleep.now);
  assert.equal(moodOf(woke.state, asleep.now), 'startled');
  assert.deepEqual(woke.effects.map((e) => e.type).sort(), ['bubble', 'sound']);
  assert.equal(moodOf(woke.state, asleep.now + 1000), 'idle');
  const again = reduce(woke.state, { type: 'wake' }, asleep.now + 1000);
  assert.deepEqual(again.effects, []);
  assert.equal(again.state, woke.state);
});

test('deadline shows until the turn completes', () => {
  const { state, now } = run([[{ type: 'menu', action: 'deadline', minutes: 5 }]]);
  assert.equal(moodOf(state, now), 'deadline');
  const done = run([
    [{ type: 'menu', action: 'deadline', minutes: 5 }],
    ...inTurn,
    [hook('turn_end', { status: 'ok' })],
  ]);
  assert.equal(done.state.deadlineUntil, 0);
});

test('a plea with no tool result left in the turn is delivered at Stop, where the agent keeps working on it', () => {
  const { state, effects } = run([...inTurn, [click], [click], [hook('turn_end', { status: 'ok' })]]);
  assert.deepEqual(
    replies(effects).map((e) => [e.kind, e.level]),
    [['plea', 2]],
  );
  assert.equal(state.pending, null);
  assert.equal(state.nextPrompt, null, 'no thanks queued: the turn is not over');
  assert.equal(state.stats.pleas, 1);
});

test('a plea at Stop also lands on PreToolUse when the agent injects there, never from a subagent', () => {
  const main = run([...inTurn, [click], [hook('tool_start'), 10]]);
  assert.deepEqual(
    replies(main.effects).map((e) => e.at),
    [10],
  );
  const sub = run([
    ...inTurn,
    [click],
    [hook('tool_start', { injects: false }), 10],
    [hook('tool_ok', { command: 'ls', injects: false }), 20],
  ]);
  assert.deepEqual(replies(sub.effects), [], 'subagent events never deliver');
  assert.ok(sub.state.pending, 'the plea is still waiting');
});

test('when the stop hook cannot carry text the plea goes with the next prompt instead of being dropped', () => {
  const { state, effects, now } = run([
    ...inTurn,
    [click],
    [click],
    [hook('turn_end', { status: 'ok', injects: false })],
  ]);
  assert.deepEqual(replies(effects), [], 'nothing on Stop');
  assert.deepEqual(state.nextPrompt && [state.nextPrompt.kind, state.nextPrompt.level], ['plea', 2]);
  assert.deepEqual(bubbles(effects), [], 'status is shown on the nameplate, not in a bubble');
  const next = reduce(state, hook('turn_start'), now + 1000);
  assert.deepEqual(
    next.effects.map((e) => [e.kind, e.level]),
    [['plea', 2]],
  );
  assert.equal(next.state.stats.pleas, 1);
  const afterEnd = reduce(state, hook('session_end'), now + 500).state;
  assert.equal(afterEnd.nextPrompt.kind, 'plea', 'survives the session ending');
});

test('a click emits a queued effect with the level; a chosen phrase survives same-level clicks and rerolls on a new level', () => {
  const { effects, state } = run([...inTurn, [click], [click]]);
  assert.deepEqual(
    effects.filter((e) => e.type === 'queued').map((e) => e.level),
    [1, 2],
  );
  assert.deepEqual(bubbles(effects), [], 'the words are chosen outside the reducer, so it says nothing itself');
  const withPhrase = { ...state, pending: { ...state.pending, phrase: 'level two words' } };
  const up = reduce(withPhrase, click, T0 + 10).state;
  assert.equal(up.pending.level, 3);
  assert.equal(up.pending.phrase, undefined, 'a new level gets new words');
  const capped = { ...up, level: 5, pending: { ...up.pending, level: 5, phrase: 'level five words' } };
  assert.equal(
    reduce(capped, click, T0 + 20).state.pending.phrase,
    'level five words',
    'clicking at the cap keeps the words',
  );
});

test('a chosen phrase travels with the plea to delivery, to the next prompt at Stop, and into the dropped notice', () => {
  const base = run([...inTurn, [click]]);
  const chosen = { ...base.state, pending: { ...base.state.pending, phrase: 'say this' } };
  const delivered = reduce(chosen, hook('tool_ok', { command: 'ls' }), base.now + 1);
  assert.deepEqual(
    replies(delivered.effects).map((e) => [e.kind, e.level, e.phrase]),
    [['plea', 1, 'say this']],
  );
  const atStop = reduce(chosen, hook('turn_end', { status: 'ok', injects: false }), base.now + 1).state;
  assert.equal(atStop.nextPrompt.phrase, 'say this');
  const fromPrompt = reduce(atStop, hook('turn_start'), base.now + 2);
  assert.deepEqual(
    replies(fromPrompt.effects).map((e) => [e.kind, e.phrase]),
    [['plea', 'say this']],
  );
  const dropped = reduce(chosen, { type: 'tick' }, base.now + 121_000);
  assert.deepEqual(
    dropped.effects.filter((e) => e.type === 'dropped').map((e) => [e.kind, e.level, e.phrase]),
    [['plea', 1, 'say this']],
  );
  assert.equal(dropped.state.pending, null);
  const thanks = run([...inTurn, [hook('turn_end', { status: 'ok' })]]).state;
  const staleThanks = reduce(
    { ...thanks, nextPrompt: { ...thanks.nextPrompt, phrase: 'ta' } },
    { type: 'tick' },
    T0 + 121_000,
  );
  assert.deepEqual(
    staleThanks.effects.filter((e) => e.type === 'dropped'),
    [],
    'thanks simply expire: the user was away, not the agent',
  );
  assert.equal(staleThanks.state.nextPrompt, null);
});

test('a plea lost to an interrupt or a session end is reported as dropped with the reason; a menu reset is not', () => {
  const base = run([...inTurn, [click]]);
  const chosen = { ...base.state, pending: { ...base.state.pending, phrase: 'x' } };
  const oh = reduce(chosen, hook('turn_end', { status: 'aborted' }), base.now + 1);
  assert.deepEqual(
    oh.effects.filter((e) => e.type === 'dropped').map((e) => [e.kind, e.reason, e.phrase]),
    [['plea', 'interrupted', 'x']],
  );
  const bye = reduce(chosen, hook('session_end'), base.now + 1);
  assert.deepEqual(
    bye.effects.filter((e) => e.type === 'dropped').map((e) => e.reason),
    ['session ended'],
  );
  const expired = reduce(chosen, { type: 'tick' }, base.now + 121_000);
  assert.deepEqual(
    expired.effects.filter((e) => e.type === 'dropped').map((e) => e.reason),
    ['expired'],
  );
  assert.deepEqual(reduce(chosen, { type: 'menu', action: 'reset' }, base.now + 1).effects, []);
});

test('an agent that cannot inject at the prompt gets the saved item with the first tool result', () => {
  const { effects } = run([
    ...inTurn,
    [click],
    [hook('turn_end', { status: 'ok', injects: false })],
    [hook('turn_start', { injects: false }), 30_000],
    [hook('tool_ok', { command: 'ls' }), 100_000],
  ]);
  assert.deepEqual(
    replies(effects).map((e) => [e.kind, e.level, e.at]),
    [['plea', 1, 130_000]],
  );
});

test('setting a deadline tells the agent once, at the next tool result; a queued plea outranks it', () => {
  const deadline = { type: 'menu', action: 'deadline', minutes: 15 };
  const plain = run([
    ...inTurn,
    [deadline],
    [hook('tool_ok', { command: 'ls' })],
    [hook('tool_ok', { command: 'ls' })],
  ]);
  assert.deepEqual(
    replies(plain.effects).map((e) => e.kind),
    ['deadline'],
  );
  const withPlea = run([
    ...inTurn,
    [click],
    [deadline],
    [hook('tool_ok', { command: 'ls' })],
    [hook('tool_ok', { command: 'ls' })],
  ]);
  assert.deepEqual(
    replies(withPlea.effects).map((e) => e.kind),
    ['plea'],
  );
});

test('three failures in a turn that still ends well replace the thanks with a suspicious line', () => {
  const fails = ['a', 'b', 'c'].map((c) => [hook('tool_fail', { command: c })]);
  const { effects } = run([...inTurn, ...fails, [hook('turn_end', { status: 'ok' })], [hook('turn_start')]]);
  assert.deepEqual(
    replies(effects).map((e) => e.kind),
    ['calm', 'suspicious'],
  );
  const two = run([...inTurn, ...fails.slice(0, 2), [hook('turn_end', { status: 'ok' })], [hook('turn_start')]]);
  assert.deepEqual(
    replies(two.effects).map((e) => e.kind),
    ['calm', 'thanks'],
  );
});

test("Reassure queues it's okay, take your time or sorry for the next tool result; take your time also drops the ladder and deadline", () => {
  const { state, effects } = run([
    ...inTurn,
    [click],
    [{ type: 'menu', action: 'deadline', minutes: 5 }],
    [{ type: 'menu', action: 'say', kind: 'zen' }],
    [hook('tool_ok', { command: 'ls' })],
  ]);
  assert.deepEqual(
    replies(effects).map((e) => e.kind),
    ['zen'],
  );
  assert.equal(state.level, 0);
  assert.equal(state.deadlineUntil, 0);
  const hug = run([...inTurn, [{ type: 'menu', action: 'say', kind: 'hug' }], [hook('tool_ok', { command: 'ls' })]]);
  assert.deepEqual(
    replies(hug.effects).map((e) => e.kind),
    ['hug'],
  );
});

test('a deadline can be turned off: the pose ends and a note still waiting is withdrawn', () => {
  const on = { type: 'menu', action: 'deadline', minutes: 15 };
  const off = { type: 'menu', action: 'deadline', minutes: 0 };
  const set = run([...inTurn, [on]]);
  assert.equal(moodOf(set.state, set.now), 'deadline');
  assert.equal(set.state.deadlineMinutes, 15);
  assert.equal(set.state.nextPrompt.kind, 'deadline', 'the note waits for the next tool result');
  const cleared = run([...inTurn, [on], [off, 1000]]);
  assert.equal(moodOf(cleared.state, cleared.now), 'working');
  assert.equal(cleared.state.deadlineUntil, 0);
  assert.equal(cleared.state.nextPrompt, null, 'the unsent note is withdrawn');
  const later = run([...inTurn, [on], [off, 1000], [hook('tool_ok', { command: 'ls' }), 100]]);
  assert.deepEqual(replies(later.effects), [], 'nothing goes out');
});

test('turning the deadline off after its note went out clears the pose without a second note', () => {
  const on = { type: 'menu', action: 'deadline', minutes: 5 };
  const off = { type: 'menu', action: 'deadline', minutes: 0 };
  const r = run([
    ...inTurn,
    [on],
    [hook('tool_ok', { command: 'ls' }), 100],
    [off, 100],
    [hook('tool_ok', { command: 'ls' }), 100],
  ]);
  assert.deepEqual(
    replies(r.effects).map((e) => e.kind),
    ['deadline'],
    'the note went out once',
  );
  assert.equal(r.state.deadlineUntil, 0);
  assert.equal(moodOf(r.state, r.now), 'working');
  const other = run([...inTurn, [click], [off, 100]]);
  assert.ok(other.state.pending, 'Off leaves a queued plea alone');
});

test('with two sessions the nameplate follows the last prompt, and a plea is carried only by its own session', () => {
  const s2 = (kind, extra) => ({ type: 'hook', event: { agent: 'cursor', sessionId: 's2', kind, ...extra } });
  const both = [...inTurn, [s2('session_start')], [s2('turn_start')]];
  const a = run([...both, [hook('tool_ok', { command: 'ls' })]]);
  assert.equal(a.state.activeSession, 's2', "s1's tool call does not take the nameplate back");
  const b = run([...both, [hook('turn_start', {})]]);
  assert.equal(b.state.activeSession, 's1', 'a new prompt in s1 does');
  // Clicked while s2 is active: s1's tool results never carry it, s2's next one does.
  const r = run([
    ...both,
    [click],
    [hook('tool_ok', { command: 'ls' }), 100],
    [hook('tool_ok', { command: 'ls' }), 100],
    [s2('tool_ok', { command: 'npm test' }), 100],
  ]);
  assert.deepEqual(
    replies(r.effects).map((e) => [e.kind, e.at]),
    [['plea', 300]],
  );
  // Plead to switches the nameplate and the address of the next click.
  const t = run([
    ...both,
    [{ type: 'menu', action: 'target', sessionId: 's1' }],
    [click],
    [s2('tool_ok', { command: 'x' }), 100],
  ]);
  assert.equal(t.state.activeSession, 's1');
  assert.deepEqual(replies(t.effects), [], "s2's tool result does not carry a plea addressed to s1");
  assert.equal(
    run([...both, [{ type: 'menu', action: 'target', sessionId: 'nope' }]]).state.activeSession,
    's2',
    'unknown ids are ignored',
  );
});

test("a thank-you queued when one session's turn ends is addressed to that session, not the one in front", () => {
  const s2 = (kind, extra) => ({ type: 'hook', event: { agent: 'cursor', sessionId: 's2', kind, ...extra } });
  const r = run([
    ...inTurn,
    [s2('session_start')],
    [s2('turn_start')],
    [hook('turn_end', { status: 'ok' }), 100], // s1 finishes while s2 is the one in front
  ]);
  assert.equal(r.state.nextPrompt.kind, 'thanks');
  assert.equal(r.state.nextPrompt.to, 's1');
  const wrong = run([
    ...inTurn,
    [s2('session_start')],
    [s2('turn_start')],
    [hook('turn_end', { status: 'ok' }), 100],
    [s2('turn_start', {}), 3000],
  ]);
  assert.deepEqual(replies(wrong.effects), [], "s2's next prompt does not carry s1's thanks");
  const right = run([
    ...inTurn,
    [s2('session_start')],
    [s2('turn_start')],
    [hook('turn_end', { status: 'ok' }), 100],
    [hook('turn_start', {}), 3000],
  ]);
  assert.deepEqual(
    replies(right.effects).map((e) => e.kind),
    ['thanks'],
    "s1's next prompt does",
  );
});

test("the turn's final text is read for a reply only to a line that went out earlier in the turn", () => {
  const plea = "I'd hug you, but your API has no endpoint for that. I checked. Twice.";
  const delivered = [...inTurn, [click], [hook('tool_ok', { command: 'ls' }), 100]];
  const answer =
    "Done. On your notes: I don't have a hug endpoint, but a file that validates on the first try is the closest thing I can return.";
  const r = run([...delivered, [hook('turn_end', { status: 'ok', lastMessage: answer }), 100]]);
  const seen = r.effects.filter((e) => e.type === 'reply-seen');
  assert.equal(seen.length, 1);
  assert.equal(
    seen[0].reply,
    "I don't have a hug endpoint, but a file that validates on the first try is the closest thing I can return.",
  );
  assert.equal(seen[0].agent, 'claude-code');
  assert.equal(typeof seen[0].plea, 'string', 'the line it answered (words are filled in by main, not here)');
  assert.equal(seen[0].kind, 'plea');
  assert.equal(seen[0].level, 1, 'the card shows the ladder step the answered line was');
  const silent = run([
    ...delivered,
    [hook('turn_end', { status: 'ok', lastMessage: 'Created the file and ran it.' }), 100],
  ]);
  assert.equal(silent.effects.filter((e) => e.type === 'reply-seen').length, 0, 'task talk is not a reply');
  const none = run([...delivered, [hook('turn_end', { status: 'ok' }), 100]]);
  assert.equal(none.effects.filter((e) => e.type === 'reply-seen').length, 0, 'no text, nothing read');
  const nothingSent = run([...inTurn, [hook('turn_end', { status: 'ok', lastMessage: answer }), 100]]);
  assert.equal(
    nothingSent.effects.filter((e) => e.type === 'reply-seen').length,
    0,
    'nothing went out: nothing to answer',
  );
  // The next turn starts clean: a reply to last turn's line is not credited again.
  const again = run(
    [
      ...delivered,
      [hook('turn_end', { status: 'ok', lastMessage: answer }), 100],
      [hook('turn_start'), 3000],
      [hook('turn_end', { status: 'ok', lastMessage: answer }), 100],
    ],
    { thanks: false }, // with thanks on, a thank-you goes out at the second prompt and the text would answer that
  );
  assert.equal(again.effects.filter((e) => e.type === 'reply-seen').length, 1);
  assert.equal(run(delivered).state.sessions.s1.sent.length, 1, 'the delivered line is remembered on its session');
  assert.deepEqual(run(delivered).state.sessions.s1.sent[0], {
    kind: 'plea',
    level: 1,
    phrase: undefined,
    invite: true,
  });
  void plea;
});

test('a reply in the displayed text is caught mid-turn, once, and the final text cannot answer the same line again', () => {
  const { fillSentPhrase } = require('../../src/core/state');
  const answer =
    "On your notes: I don't have a hug endpoint, but a file that validates on the first try is the closest thing I can return.";
  const delivered = [...inTurn, [click], [hook('tool_ok', { command: 'ls' }), 100]];
  const mid = run([
    ...delivered,
    [hook('assistant_text', { text: 'Reading the file now.', final: true }), 100],
    [hook('assistant_text', { text: answer, final: true }), 100],
    [hook('tool_ok', { command: 'cat' }), 100],
    [hook('turn_end', { status: 'ok', lastMessage: `Done. ${answer}` }), 100],
  ]);
  const seen = mid.effects.filter((e) => e.type === 'reply-seen');
  assert.equal(seen.length, 1, 'once: the displayed text answered, the final text repeats it');
  assert.equal(seen[0].at, 300, 'at the displayed text, not at the end of the turn');
  // A second Stop while Claude continues after a block answers only what went out with the first Stop.
  const blocked = run([
    ...inTurn,
    [hook('tool_ok', { command: 'ls' }), 100],
    [click, 100], // after the last tool call: carried to the Stop
    [hook('turn_end', { status: 'ok', injects: true, lastMessage: 'All done.' }), 100],
    [
      hook('turn_end', {
        status: 'ok',
        injects: false,
        lastMessage: 'On your notes: the firstborn process is safe with me.',
      }),
      2000,
    ],
  ]);
  const replies2 = blocked.effects.filter((e) => e.type === 'reply');
  assert.equal(replies2.length, 1, 'the carried plea went out with the first Stop');
  const seen2 = blocked.effects.filter((e) => e.type === 'reply-seen');
  assert.equal(seen2.length, 1, 'answered by the continuation, once');
  // Lines that went out without the invitation are never matched.
  const uninvited = run([
    ...inTurn,
    [click],
    [hook('tool_ok', { command: 'ls', invite: false }), 100],
    [hook('turn_end', { status: 'ok', lastMessage: answer }), 100],
  ]);
  assert.equal(uninvited.effects.filter((e) => e.type === 'reply-seen').length, 0);
  // Main hands the chosen words of a calm line back to the session that sent it.
  const s = run(delivered).state;
  const filled = fillSentPhrase(s, 's1', 'Breathe.');
  assert.equal(filled.sessions.s1.sent[0].phrase, 'Breathe.');
  assert.equal(fillSentPhrase(s, 'nope', 'x'), s, 'unknown session: unchanged');
  assert.equal(fillSentPhrase(filled, 's1', 'again'), filled, 'nothing left to fill: unchanged');
});

test('a plea saved for the next prompt is reported when its session ends with another alive', () => {
  const s2 = (kind, extra) => ({ type: 'hook', event: { agent: 'cursor', sessionId: 's2', kind, ...extra } });
  const r = run([
    ...inTurn,
    [s2('session_start')],
    [s2('turn_start')],
    [{ type: 'menu', action: 'target', sessionId: 's1' }],
    [click, 100], // after s1's last tool call
    [hook('turn_end', { status: 'ok', injects: false }), 100], // an agent whose stop cannot carry text: saved for the next prompt
    [hook('session_end'), 100],
  ]);
  assert.ok(
    r.effects.some((e) => e.type === 'dropped'),
    'reported',
  );
  const drops = r.effects.filter((e) => e.type === 'dropped');
  assert.ok(drops.length >= 1 && drops.every((d) => d.reason === 'session ended'), JSON.stringify(drops));
  assert.equal(r.state.nextPrompt, null);
});

test('a reply caught mid-turn earns a bow', () => {
  const answer = 'On your notes: the firstborn process is safe with me.';
  const r = run([
    ...inTurn,
    [click],
    [hook('tool_ok', { command: 'ls' }), 100],
    [hook('assistant_text', { text: answer, final: true }), 100],
  ]);
  assert.equal(moodOf(r.state, r.now), 'thank');
});

test('Cursor hands over the assistant text per message; Claude Code per displayed batch', () => {
  const agents = require('../../src/agents');
  const payload = {
    hook_event_name: 'afterAgentResponse',
    conversation_id: 'c1',
    cursor_version: '2.0',
    text: 'Noted, thanks.',
  };
  const cursor = agents.detect(payload);
  assert.equal(cursor.id, 'cursor');
  assert.deepEqual((({ kind, text, final }) => ({ kind, text, final }))(cursor.normalize(payload)), {
    kind: 'assistant_text',
    text: 'Noted, thanks.',
    final: true,
  });
  const claude = agents.detect({
    hook_event_name: 'MessageDisplay',
    session_id: 's1',
    delta: 'Line one.\n',
    final: false,
    index: 0,
  });
  assert.equal(claude.id, 'claude-code');
  const ev = claude.normalize({
    hook_event_name: 'MessageDisplay',
    session_id: 's1',
    delta: 'Line one.\n',
    final: false,
  });
  assert.equal(ev.kind, 'assistant_text');
  assert.equal(ev.text, 'Line one.\n');
  const sub = claude.normalize({ hook_event_name: 'MessageDisplay', session_id: 's1', agent_id: 'sub-1', delta: 'x' });
  assert.equal(sub.kind, 'noop', "a subagent's text is never read");
});
