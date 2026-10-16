'use strict';

// What the pet shows: when the window is on screen, what the renderer is sent, the voice, the coaching and the pin.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createView } = require('../../src/desktop/view');
const { readingMs } = require('../../src/desktop/bubbles');
const { initialState, reduce } = require('../../src/core/state');
const { PET } = require('../../src/desktop/channels');

// Real reducer states: none, a working Claude Code session, and one with a plea queued and its words chosen.
const now = Date.now();
const none = initialState(now);
const hook = (kind) => ({ type: 'hook', event: { agent: 'claude-code', sessionId: 's1', kind } });
const working = [hook('session_start'), hook('turn_start'), hook('tool_start')].reduce(
  (s, i) => reduce(s, i, now).state,
  none,
);
const clicked = reduce(working, { type: 'click' }, now).state;
const queued = { ...clicked, pending: { ...clicked.pending, phrase: 'be kind' } };

function harness(opts = {}) {
  let shown = false;
  const sent = [];
  const peeks = [];
  const eyes = [];
  const hits = [];
  let moves = 0;
  const settings = { showMode: 'agentFront', parked: null, coached: {}, ...opts.settings };
  const ctx = {
    pet: {
      win: { isVisible: () => shown, showInactive: () => (shown = true), hide: () => (shown = false) },
      visible: () => shown,
      send: (channel, payload) => sent.push([channel, payload]),
      showOnCurrentDesktop: () => (moves += 1),
    },
    front: { settled: true, inFront: true, ...opts.front },
    tray: { sync() {}, refresh() {} },
    parking: { peek: (ms) => peeks.push(ms) },
    eyes: (idle) => eyes.push(idle),
    hit: (on) => hits.push(on),
    spriteDir: '/sprites',
    hidden: Boolean(opts.hidden),
    state: () => opts.state || none,
    outcome: () => null,
    settings: () => settings,
    demoRunning: () => Boolean(opts.demo),
    installed: () => opts.installed !== false,
    sessionCount: () => opts.sessions || 0,
    goodbyePlaying: () => false,
    agentApp: () => opts.app || null,
    agentLabel: () => 'Claude Code',
    quiet: () => Boolean(opts.quiet),
    bubbles: { offer: (b, show) => (show(b), true), clear() {} },
    saveSettings: (patch) => Object.assign(settings, patch),
  };
  return {
    view: createView(ctx),
    sent,
    peeks,
    eyes,
    hits,
    settings,
    get shown() {
      return shown;
    },
    moves: () => moves,
  };
}

test('the window shows only when the rules say so', () => {
  assert.equal(
    (() => {
      const h = harness();
      h.view.render();
      return h.shown;
    })(),
    false,
    'no session: hidden',
  );
  assert.equal(
    (() => {
      const h = harness({ sessions: 1 });
      h.view.render();
      return h.shown;
    })(),
    true,
    'a session, the agent in front',
  );
  assert.equal(
    (() => {
      const h = harness({ sessions: 1, front: { inFront: false } });
      h.view.render();
      return h.shown;
    })(),
    false,
    'agent not in front',
  );
  assert.equal(
    (() => {
      const h = harness({ sessions: 1, front: { inFront: false }, settings: { showMode: 'session' } });
      h.view.render();
      return h.shown;
    })(),
    true,
    'session mode ignores the front app',
  );
  assert.equal(
    (() => {
      const h = harness({ settings: { showMode: 'always' } });
      h.view.render();
      return h.shown;
    })(),
    true,
    'always, even with no session',
  );
  assert.equal(
    (() => {
      const h = harness({ installed: false });
      h.view.render();
      return h.shown;
    })(),
    true,
    'not connected: visible so the prompt is seen',
  );
  assert.equal(
    (() => {
      const h = harness({ sessions: 1, hidden: true });
      h.view.render();
      return h.shown;
    })(),
    false,
    'test instances never take the screen',
  );
  const probing = harness({ sessions: 1, front: { settled: false, inFront: false } });
  probing.view.render();
  assert.equal(probing.shown, false, 'while a new app is probed, nothing changes');
});

test('the renderer gets each view once, and the queued words stay in the bubble', () => {
  const h = harness({ sessions: 1, state: queued, settings: { parked: { side: 'right' } } });
  h.view.render();
  h.view.render();
  assert.deepEqual(
    h.sent.map((s) => s[0]),
    [PET.VIEW, PET.BUBBLE],
    'a second identical render sends nothing',
  );
  assert.equal(h.sent[0][1].mood, 'plead-1');
  assert.match(h.sent[0][1].tag.line2, /Plea 1 of 5 · next tool call/);
  assert.deepEqual(h.sent[1][1], { text: '“be kind”', ms: 0, sticky: true });
  assert.deepEqual(h.peeks, [undefined], 'parked: the words bring the pet out');
  assert.deepEqual(h.eyes, [false, false], 'eyes follow only while idle');
  const idle = harness({ sessions: 1, state: working });
  idle.view.render();
  assert.deepEqual(idle.eyes, [false], 'working, not idle');
  assert.deepEqual(h.hits, [true, true]);
  assert.equal(h.view.tagShown(), true);
  h.view.reset();
  h.view.render();
  assert.equal(h.sent.length, 3, 'after a reset the view is sent again');
});

test('the voice holds chatter while muted, and an outcome brings a parked pet out', () => {
  const quiet = harness({ quiet: true });
  quiet.view.say('chatter');
  quiet.view.say('Sent ✓', 3000, 2);
  assert.deepEqual(
    quiet.sent.map((s) => s[1].text),
    ['Sent ✓'],
  );
  const parked = harness({ settings: { parked: { side: 'left' } } });
  parked.view.say('Dropped', 5000, 2);
  assert.deepEqual(parked.peeks, [5000]);
  parked.view.say('plain');
  assert.deepEqual(parked.sent[1][1], { text: 'plain', ms: readingMs('plain') });
});

test('coaching explains each moment once, only on a visible pet, and remembers it in the settings', () => {
  const h = harness({ sessions: 1 });
  h.view.coach('working');
  assert.equal(h.sent.length, 0, 'not visible yet: nothing');
  h.view.render();
  h.view.coach('working');
  assert.equal(h.sent.at(-1)[1].text, 'Claude Code is working. Click me to plead.');
  assert.equal(h.settings.coached.working, true);
  const before = h.sent.length;
  h.view.coach('working');
  assert.equal(h.sent.length, before, 'already explained');
  const demo = harness({ sessions: 1, demo: true });
  demo.view.render();
  demo.view.coach('working');
  assert.equal(demo.sent.filter((s) => s[0] === PET.BUBBLE && s[1].ms).length, 0, 'never during the demo');
});

test('the pin keeps the pet on screen, moves it to this desktop, and says so when nothing is open', () => {
  const h = harness();
  h.view.togglePin();
  assert.equal(h.view.pinned(), true);
  assert.equal(h.shown, true);
  assert.equal(h.moves(), 1);
  assert.match(h.sent.at(-1)[1].text, /No agent open yet/);
  h.view.unpin();
  h.view.render();
  assert.equal(h.shown, false);
  assert.equal(h.view.tooltip(), 'OpenPlead – Waiting for an agent session');
});
