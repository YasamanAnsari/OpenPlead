'use strict';

// Each reducer effect, performed against fakes: what is said, played, recorded, and what main gets back.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEffects } = require('../../src/desktop/effects');

function harness(overrides = {}) {
  const said = [];
  const sounds = [];
  const recorded = [];
  const reported = [];
  const logged = [];
  const effects = createEffects({
    say: (text, ms, priority) => said.push([text, ms, priority]),
    sound: (name) => sounds.push(name),
    phrases: {
      load: () => ({}),
      render: (_p, kind, level, chosen) => ({ phrase: chosen || `${kind}-${level}`, text: `line: ${chosen || kind}` }),
    },
    replies: { record: (entry) => recorded.push(entry) },
    inviteReply: () => false,
    log: (line) => logged.push(line),
    report: (what, err) => reported.push([what, err.message]),
    ...overrides,
  });
  return { effects, said, sounds, recorded, reported, logged };
}
const state = { pending: null, nextPrompt: null, sessions: { s1: { sent: [{ kind: 'plea', level: 2 }] } } };
const hook = { type: 'hook', event: { sessionId: 's1' } };

test('bubbles and sounds pass straight through', () => {
  const h = harness();
  assert.deepEqual(
    h.effects.perform({ type: 'bubble', text: 'hi', ms: 4000, priority: 2 }, { state, input: hook }),
    {},
  );
  assert.deepEqual(h.said, [['hi', 4000, 2]]);
  h.effects.perform({ type: 'sound', name: 'chime' }, { state, input: hook });
  assert.deepEqual(h.sounds, ['chime']);
});

test('a queued plea is announced only while its words are not yet chosen', () => {
  const h = harness();
  h.effects.perform({ type: 'queued', level: 2 }, { state, input: hook });
  h.effects.perform({ type: 'queued', level: 3, soon: 'next message' }, { state, input: hook });
  h.effects.perform({ type: 'queued', level: 4 }, { state: { pending: { phrase: 'words' } }, input: hook });
  assert.deepEqual(
    h.said.map((s) => s[0]),
    ['Plea 2 of 5 queued', 'Plea 3 of 5 saved for your next message'],
  );
});

test('a dropped plea becomes an outcome, and an expired one is explained', () => {
  const h = harness();
  const quiet = h.effects.perform(
    { type: 'dropped', kind: 'plea', level: 3, reason: 'interrupted', phrase: 'p' },
    { state, input: hook },
  );
  assert.deepEqual(quiet.outcome, { kind: 'dropped', text: 'Dropped · Plea 3 of 5 · interrupted', phrase: 'p' });
  assert.equal(h.said.length, 0);
  h.effects.perform({ type: 'dropped', kind: 'plea', level: 1, reason: 'expired' }, { state, input: hook });
  assert.match(h.said[0][0], /Dropped after 2 min/);
});

test('a reply the agent gave is shown, kept, logged without its words, and put on the nameplate', () => {
  const h = harness();
  const out = h.effects.perform(
    {
      type: 'reply-seen',
      agent: 'claude-code',
      kind: 'plea',
      level: 2,
      plea: 'the plea',
      reply: 'Thanks for the trust.',
    },
    { state, input: hook },
  );
  assert.deepEqual(h.said[0], ['Claude Code: “Thanks for the trust.”', undefined, 2]);
  assert.equal(h.recorded.length, 1);
  assert.deepEqual(
    [h.recorded[0].plea, h.recorded[0].reply, h.recorded[0].level],
    ['the plea', 'Thanks for the trust.', 2],
  );
  assert.ok(typeof h.recorded[0].at === 'number');
  assert.deepEqual(h.logged, ['reply from claude-code (21 chars)']);
  assert.deepEqual(out.outcome, {
    kind: 'reply',
    text: 'Claude replied · right-click for the card',
    phrase: 'Thanks for the trust.',
  });
  const broken = harness({
    replies: {
      record: () => {
        throw new Error('disk full');
      },
    },
  });
  broken.effects.perform(
    { type: 'reply-seen', agent: 'claude-code', kind: 'plea', level: 1, plea: 'p', reply: 'r' },
    { state, input: hook },
  );
  assert.deepEqual(broken.reported, [['keeping the reply', 'disk full']]);
});

test('a reply to deliver is rendered with the chosen words, and the sent phrase is written back on a hook', () => {
  const h = harness();
  const out = h.effects.perform({ type: 'reply', kind: 'plea', level: 2, phrase: 'chosen' }, { state, input: hook });
  assert.deepEqual(out.reply, { type: 'reply', kind: 'plea', level: 2, phrase: 'chosen', text: 'line: chosen' });
  assert.equal(out.state.sessions.s1.sent[0].phrase, 'chosen', 'the sent line gets its words for the log and the card');
  const click = h.effects.perform({ type: 'reply', kind: 'calm', level: 0 }, { state, input: { type: 'click' } });
  assert.equal(click.state, state, 'nothing to write back without a session');
  const broken = harness({
    phrases: {
      load: () => {
        throw new Error('phrases.json: bad');
      },
      render() {},
    },
  });
  assert.deepEqual(broken.effects.perform({ type: 'reply', kind: 'plea', level: 1 }, { state, input: hook }), {});
  assert.deepEqual(broken.said, [['phrases.json: bad', 8000, 2]]);
  assert.deepEqual(broken.reported, [['rendering the line', 'phrases.json: bad']]);
  assert.deepEqual(h.effects.perform({ type: 'whatever' }, { state, input: hook }), {});
});
