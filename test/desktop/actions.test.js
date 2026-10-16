'use strict';

// Every action the menu and the settings window can trigger, against fakes for Electron and the app's pieces.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createActions } = require('../../src/desktop/actions');
const { hotkeysFor } = require('../../src/desktop/menu');
const { PET } = require('../../src/desktop/channels');
const { initialState } = require('../../src/core/state');

const [, FIRST_KEY, SECOND_KEY] = hotkeysFor(process.platform);

function harness(opts = {}) {
  const calls = [];
  const say = (text, ms, priority) => calls.push(['say', text, ms, priority]);
  const settings = {
    showMode: 'agentFront',
    sounds: true,
    thanks: true,
    cursor: true,
    inviteReply: false,
    hotkey: null,
    port: 47821,
    quietUntil: 0,
    ...opts.settings,
  };
  let state = { ...initialState(Date.now()), stats: { pleas: 3, thanks: 4, panics: 0 } };
  const registered = [];
  const actions = createActions({
    electron: {
      app: { getPath: () => '/Desktop', getVersion: () => '0.1.0' },
      BrowserWindow: class {},
      Menu: { buildFromTemplate: (template) => ({ template }) },
      clipboard: { writeText: (t) => calls.push(['clipboard', t]) },
      dialog: { showOpenDialog: async () => opts.dialog || { canceled: true, filePaths: [] } },
      globalShortcut: {
        unregisterAll: () => calls.push(['unregisterAll']),
        register: (accel) => (registered.push(accel), accel !== SECOND_KEY),
      },
      shell: { openPath: (p) => calls.push(['open', p]), showItemInFolder: (p) => calls.push(['reveal', p]) },
    },
    phrases: {
      FILE: '/phrases.json',
      resetToDefaults: () => calls.push(['resetPhrases']),
      importPack: () => {
        if (opts.badPack) throw new Error('unknown set "x"');
        return 3;
      },
    },
    replies: {
      list: () => [{ at: 1, agent: 'claude-code', plea: 'p', reply: 'r' }],
      clear: () => calls.push(['clearReplies']),
    },
    connection: {
      installed: () => opts.installed !== false,
      connect: (o) => calls.push(['connect', o]),
      disconnect: () => calls.push(['disconnect']),
      refresh: () => calls.push(['refresh']),
      check: () => ({ text: 'all good' }),
      lastCheck: () => ({ ok: true }),
    },
    parking: { resetPosition: () => calls.push(['resetPosition']), unpark: () => calls.push(['unpark']) },
    front: { reset: () => calls.push(['front.reset']) },
    tray: { refresh: () => calls.push(['tray.refresh']) },
    saveCard: opts.saveCard || (async () => '/Desktop/OpenPlead reply.png'),
    spriteDir: '/sprites',
    logFile: '/log',
    log: (line) => calls.push(['log', line]),
    report: (what, err) => calls.push(['report', what, err.message]),
    settings: () => settings,
    saveSettings: (patch) => Object.assign(settings, patch),
    state: () => state,
    patchState: (fn) => (state = fn(state)),
    pet: {
      win: { setVisibleOnAllWorkspaces: (flag) => calls.push(['workspaces', flag]) },
      send: (ch, p) => calls.push(['send', ch, p]),
    },
    say,
    render: () => calls.push(['render']),
    dispatch: (input) => calls.push(['dispatch', input]),
    sound: (name) => calls.push(['sound', name]),
    resetSounds: () => calls.push(['resetSounds']),
    quit: (reason) => calls.push(['quit', reason]),
    runDemo: () => calls.push(['demo']),
    settingsWindow: () => ({ window: null, open: (tab) => calls.push(['openSettings', tab]) }),
    agentApp: () => opts.app || null,
    replyAt: (at) => (String(at) === '1' ? { at: 1, agent: 'claude-code', plea: 'p', reply: 'r' } : null),
    health: () => ({ installed: true }),
    pinned: () => false,
    togglePin: () => calls.push(['togglePin']),
  });
  const names = () => calls.map((c) => c[0]);
  return { actions, calls, names, settings, state: () => state, registered };
}

test('each setting change touches only what it must at runtime', () => {
  const h = harness();
  h.actions.setSetting('thanks', false);
  assert.equal(h.state().settings.thanks, false);
  h.actions.setSetting('cursor', false);
  assert.deepEqual(
    h.calls.find((c) => c[0] === 'connect'),
    ['connect', { quiet: true }],
    'the hook entries follow',
  );
  h.actions.setSetting('sounds', true);
  assert.ok(h.names().includes('resetSounds') && h.calls.some((c) => c[0] === 'sound' && c[1] === 'chime'));
  h.actions.setSetting('showMode', 'session');
  assert.ok(h.names().includes('front.reset'));
  h.actions.setSetting('followDesktops', true);
  assert.deepEqual(
    h.calls.find((c) => c[0] === 'workspaces'),
    ['workspaces', true],
  );
  assert.deepEqual([h.settings.cursor, h.settings.showMode, h.settings.followDesktops], [false, 'session', true]);
  assert.ok(h.names().filter((n) => n === 'render').length >= 5 && h.names().includes('tray.refresh'));
});

test('the settings window may only flip known keys, with the hotkey and the show mode validated', () => {
  const h = harness();
  h.actions.set('port', 1);
  assert.equal(h.settings.port, 47821, 'not settable');
  h.actions.set('showMode', 'bogus');
  assert.equal(h.settings.showMode, 'agentFront');
  h.actions.set('showMode', 'always');
  assert.equal(h.settings.showMode, 'always');
  h.actions.set('sounds', 0);
  assert.equal(h.settings.sounds, false, 'coerced to a boolean');
  h.actions.set('hotkey', FIRST_KEY);
  assert.equal(h.settings.hotkey, FIRST_KEY);
  h.actions.set('hotkey', SECOND_KEY);
  assert.equal(h.settings.hotkey, null, 'another app owns it: reported and left off');
  assert.ok(h.calls.find((c) => c[0] === 'say' && c[1].includes(`Could not register ${SECOND_KEY}`)));
  h.actions.set('hotkey', 'Alt+Q');
  assert.equal(h.settings.hotkey, null, 'not one of the offered keys');
});

test('the action table does what each button says, and refuses unknown names', () => {
  const h = harness();
  assert.equal(h.actions.run('eval', 'x'), undefined);
  h.actions.run('install');
  h.actions.run('uninstall');
  h.actions.run('quietFor', '60');
  assert.ok(h.settings.quietUntil > Date.now(), 'muted for an hour');
  assert.match(h.calls.find((c) => c[0] === 'say' && /Muted/.test(c[1]))[1], /Muted for 60 min/);
  h.actions.run('checkConnection');
  assert.deepEqual(
    h.calls.find((c) => c[0] === 'log'),
    ['log', 'connection check: all good'],
  );
  h.actions.run('openLog');
  h.actions.run('openPhrases');
  h.actions.run('done');
  assert.equal(h.settings.firstRun, false);
  h.actions.run('copyRecord');
  assert.deepEqual(
    h.calls.find((c) => c[0] === 'clipboard'),
    ['clipboard', 'You pleaded 3 times. Claude was thanked 4 times. 0 panics.'],
  );
  h.actions.run('copyReply', '1');
  assert.deepEqual(h.calls.filter((c) => c[0] === 'clipboard')[1], ['clipboard', '“p” — Claude Code: “r”']);
  h.actions.run('chime');
  assert.deepEqual(
    h.calls.find((c) => c[0] === 'send'),
    ['send', PET.SOUND, { name: 'chime', thanks: 0 }],
  );
  for (const name of ['resetPosition', 'unpark', 'resetPhrases', 'clearReplies', 'demo', 'quit']) h.actions.run(name);
  const seen = h.names();
  for (const n of [
    'connect',
    'disconnect',
    'open',
    'resetPosition',
    'unpark',
    'resetPhrases',
    'clearReplies',
    'demo',
    'quit',
  ])
    assert.ok(seen.includes(n), n);
});

test('the menu is built from the live state and the settings view from health and the settings', () => {
  const h = harness({ app: 'com.apple.Terminal' });
  const menu = h.actions.buildMenu();
  const find = (items, re) => {
    for (const i of items) {
      if (re.test(i.label || '')) return i;
      const hit = i.submenu && find(i.submenu, re);
      if (hit) return hit;
    }
    return null;
  };
  assert.ok(find(menu.template, /^Plead with/), 'the real template, built from the live state');
  assert.equal(find(menu.template, /^No agent open$/).enabled, false, 'the status line: no session in this state');
  assert.equal(
    find(menu.template, /^Go to Terminal$/).enabled,
    process.platform === 'darwin',
    'the agent app from agentApp()',
  );
  find(menu.template, /^See all replies…$/i).click();
  assert.deepEqual(
    h.calls.find((c) => c[0] === 'openSettings'),
    ['openSettings', 'replies'],
  );
  assert.ok(h.names().includes('refresh'), 'the connection is re-read on every open');
  const view = h.actions.settingsView();
  assert.deepEqual(
    [view.status.installed, view.status.port, view.status.logFile, view.version, view.status.check],
    [true, 47821, '/log', '0.1.0', { ok: true }],
  );
  assert.equal(view.status.replies.length, 1);
});

test('the reply card is saved once at a time and revealed; a failure is reported in a bubble', async () => {
  let saves = 0;
  const slow = harness({
    saveCard: () => new Promise((r) => setTimeout(() => ((saves += 1), r('/Desktop/card.png')), 20)),
  });
  await Promise.all([slow.actions.saveReplyCard({ at: 1 }), slow.actions.saveReplyCard({ at: 1 })]);
  assert.equal(saves, 1, 'one card at a time');
  assert.deepEqual(
    slow.calls.find((c) => c[0] === 'reveal'),
    ['reveal', '/Desktop/card.png'],
  );
  assert.match(slow.calls.find((c) => c[0] === 'say')[1], /Card saved to the Desktop: card\.png/);
  const failing = harness({
    saveCard: async () => {
      throw new Error('no sprite');
    },
  });
  await failing.actions.saveReplyCard({ at: 1 });
  assert.deepEqual(
    failing.calls.find((c) => c[0] === 'report'),
    ['report', 'making the card', 'no sprite'],
  );
  assert.match(failing.calls.find((c) => c[0] === 'say')[1], /Could not make the card: no sprite/);
  await failing.actions.saveReplyCard(null);
});

test('a phrase pack is imported through the dialog, and a bad pack is explained, not thrown', async () => {
  const none = harness();
  await none.actions.importPhrases();
  assert.equal(none.calls.filter((c) => c[0] === 'say').length, 0, 'cancelled: silence');
  const ok = harness({ dialog: { canceled: false, filePaths: ['/packs/pirate.json'] } });
  await ok.actions.importPhrases();
  assert.match(ok.calls.find((c) => c[0] === 'say')[1], /Loaded 3 sets from pirate\.json/);
  const bad = harness({ dialog: { canceled: false, filePaths: ['/packs/bad.json'] }, badPack: true });
  await bad.actions.importPhrases();
  assert.match(bad.calls.find((c) => c[0] === 'say')[1], /Pack not loaded: unknown set "x"/);
});

test('focusing the agent needs a known app', () => {
  const h = harness();
  h.actions.focusAgent();
  assert.match(h.calls.find((c) => c[0] === 'say')[1], /do not know where the agent runs/);
});
